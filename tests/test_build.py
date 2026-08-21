"""Tests for scripts/build.py — stdlib unittest, run with:

python3 -m unittest discover -s tests -v
"""

import datetime as dt
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import build  # noqa: E402


def setUpModule():
    # Keep analytics hermetic: tests opt in explicitly via patch.dict.
    os.environ.pop(build.MEASUREMENT_ID_ENV_VAR, None)

VALID = {
    "title": "Test Offer",
    "provider": "Test Provider",
    "category": "api_provider",
    "amount": "$10 in credits",
    "expiry_date": None,
    "source_url": "https://example.com/offer",
    "verified_date": dt.date.today().isoformat(),
}


def offer_text(**overrides):
    data = dict(VALID)
    for key, value in overrides.items():
        if value is None and key in ("expiry_date",):
            data[key] = None
        else:
            data[key] = value
    lines = []
    for key, value in data.items():
        if value is None:
            lines.append(f"{key}: null")
        else:
            lines.append(f"{key}: {value}")
    return "\n".join(lines) + "\n"


class ParseTests(unittest.TestCase):
    def test_parses_flat_document(self):
        data = build.parse_offer_text(offer_text(), "a.yaml")
        self.assertEqual(data["title"], "Test Offer")
        self.assertEqual(data["category"], "api_provider")

    def test_null_variants_parse_as_none(self):
        for token in ("null", "~", ""):
            text = offer_text(expiry_date=None).replace(
                "expiry_date: null", f"expiry_date: {token}"
            )
            data = build.parse_offer_text(text, "a.yaml")
            self.assertIsNone(data["expiry_date"])

    def test_quoted_value_is_unquoted(self):
        data = build.parse_offer_text('title: "My: Offer"\n', "a.yaml")
        self.assertEqual(data["title"], "My: Offer")

    def test_comments_and_blank_lines_ignored(self):
        data = build.parse_offer_text("# note\n\ntitle: X\n", "a.yaml")
        self.assertEqual(data, {"title": "X"})

    def test_nested_line_rejected(self):
        with self.assertRaises(build.OfferError):
            build.parse_offer_text("title: X\n  bad: y\n", "a.yaml")

    def test_missing_colon_rejected(self):
        with self.assertRaises(build.OfferError):
            build.parse_offer_text("just a line\n", "a.yaml")

    def test_duplicate_field_rejected(self):
        with self.assertRaises(build.OfferError):
            build.parse_offer_text("title: A\ntitle: B\n", "a.yaml")


class ValidateTests(unittest.TestCase):
    def test_valid_offer_passes(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        self.assertEqual(offer["category"], "api_provider")

    def test_missing_field_names_file_and_field(self):
        data = {k: v for k, v in VALID.items() if k != "provider"}
        with self.assertRaisesRegex(build.OfferError, "provider"):
            build.validate_offer(data, "bad.yaml")

    def test_unknown_field_rejected(self):
        data = dict(VALID, extra="nope")
        with self.assertRaisesRegex(build.OfferError, "unknown fields"):
            build.validate_offer(data, "a.yaml")

    def test_bad_category_rejected(self):
        with self.assertRaisesRegex(build.OfferError, "category"):
            build.validate_offer(dict(VALID, category="audio"), "a.yaml")

    def test_bad_date_format_rejected(self):
        with self.assertRaisesRegex(build.OfferError, "YYYY-MM-DD"):
            build.validate_offer(dict(VALID, verified_date="Aug 21 2026"), "a.yaml")

    def test_future_verified_date_rejected(self):
        future = (dt.date.today() + dt.timedelta(days=1)).isoformat()
        with self.assertRaisesRegex(build.OfferError, "future"):
            build.validate_offer(dict(VALID, verified_date=future), "a.yaml")

    def test_non_http_source_url_rejected(self):
        with self.assertRaisesRegex(build.OfferError, "source_url"):
            build.validate_offer(dict(VALID, source_url="ftp://x.com"), "a.yaml")

    def test_empty_title_rejected(self):
        with self.assertRaisesRegex(build.OfferError, "title"):
            build.validate_offer(dict(VALID, title="  "), "a.yaml")

    def test_expiry_date_parsed_to_date_object(self):
        offer = build.validate_offer(dict(VALID, expiry_date="2026-12-31"), "a.yaml")
        self.assertEqual(offer["expiry_date"], dt.date(2026, 12, 31))

    def test_null_verified_date_fails_with_format_hint_not_type_error(self):
        with self.assertRaisesRegex(build.OfferError, "YYYY-MM-DD"):
            build.validate_offer(dict(VALID, verified_date=None), "a.yaml")

    def test_duplicate_slug_across_fixtures_names_both_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            Path(offers_dir, "alpha.yaml").write_text(offer_text(), encoding="utf-8")
            Path(offers_dir, "alpha.yml").write_text(
                offer_text(title="Alpha Again"), encoding="utf-8"
            )
            with self.assertRaisesRegex(build.OfferError, "duplicate slug") as cm:
                build.load_offers(offers_dir)
            self.assertIn("alpha.yaml", str(cm.exception))
            self.assertIn("alpha.yml", str(cm.exception))

    def test_seed_offers_have_unique_slugs(self):
        offers = build.load_offers(str(REPO / "offers"))
        slugs = [o["slug"] for o in offers]
        self.assertEqual(len(slugs), len(set(slugs)))


class SeedContentTests(unittest.TestCase):
    """The seed offers committed under offers/ must satisfy the schema."""

    @classmethod
    def setUpClass(cls):
        cls.offers = build.load_offers(str(REPO / "offers"))

    def test_at_least_five_seed_offers(self):
        self.assertGreaterEqual(len(self.offers), 5)

    def test_all_seed_files_parse_and_validate(self):
        for offer in self.offers:
            self.assertIn(offer["category"], build.CATEGORIES)

    def test_at_least_three_distinct_categories(self):
        categories = {o["category"] for o in self.offers}
        self.assertGreaterEqual(len(categories), 3)

    def test_at_least_one_nullable_expiry(self):
        self.assertTrue(any(o["expiry_date"] is None for o in self.offers))

    def test_every_seed_has_https_source_and_verified_date(self):
        for offer in self.offers:
            self.assertTrue(offer["source_url"].startswith("https://"))
            self.assertIsInstance(offer["verified_date"], dt.date)


class BuildOutputTests(unittest.TestCase):
    def _write_offers(self, tmp):
        offers_dir = os.path.join(tmp, "offers")
        os.makedirs(offers_dir)
        Path(offers_dir, "alpha.yaml").write_text(offer_text(), encoding="utf-8")
        beta = offer_text(title="Beta <script>", category="image")
        Path(offers_dir, "beta.yaml").write_text(beta, encoding="utf-8")
        return offers_dir

    def test_main_writes_index_json_and_html(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write_offers(tmp)
            out = os.path.join(tmp, "out")
            buf = io.StringIO()
            with redirect_stdout(buf):
                code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            index = json.loads(Path(out, "index.json").read_text(encoding="utf-8"))
            self.assertEqual(index["count"], 2)
            self.assertEqual([o["slug"] for o in index["offers"]], ["alpha", "beta"])
            page = Path(out, "site", "index.html").read_text(encoding="utf-8")
            self.assertIn("Free AI Credits", page)
            self.assertIn("Test Offer", page)

    def test_html_escapes_titles(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write_offers(tmp)
            out = os.path.join(tmp, "out")
            build.main(["--offers-dir", offers_dir, "--out", out])
            page = Path(out, "site", "index.html").read_text(encoding="utf-8")
            self.assertNotIn("<script>", page)
            self.assertIn("&lt;script&gt;", page)

    def test_invalid_offer_fails_build_with_exit_1(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write_offers(tmp)
            Path(offers_dir, "broken.yaml").write_text(
                "title: Only\n", encoding="utf-8"
            )
            err = io.StringIO()
            with redirect_stdout(err):
                code = build.main(["--offers-dir", offers_dir, "--out", tmp])
            self.assertEqual(code, 1)

    def test_empty_offers_dir_fails_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "empty")
            os.makedirs(offers_dir)
            code = build.main(["--offers-dir", offers_dir, "--out", tmp])
            self.assertEqual(code, 1)

    def test_index_json_serializes_dates_isoformat(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write_offers(tmp)
            dated = offer_text(expiry_date="2026-12-31")
            Path(offers_dir, "dated.yaml").write_text(dated, encoding="utf-8")
            out = os.path.join(tmp, "out")
            build.main(["--offers-dir", offers_dir, "--out", out])
            index = json.loads(Path(out, "index.json").read_text(encoding="utf-8"))
            dated_entry = next(o for o in index["offers"] if o["slug"] == "dated")
            self.assertEqual(dated_entry["expiry_date"], "2026-12-31")
            alpha = next(o for o in index["offers"] if o["slug"] == "alpha")
            self.assertIsNone(alpha["expiry_date"])


class ExpiryFilterTests(unittest.TestCase):
    """Build-time expiry: past expiry dropped, today/null kept (issue #9)."""

    def _offer(self, slug, expiry):
        return dict(
            build.validate_offer(
                dict(VALID, title=f"Offer {slug}", expiry_date=expiry), "a.yaml"
            ),
            slug=slug,
        )

    def test_null_expiry_is_ongoing_and_included(self):
        offers = [self._offer("ongoing", None)]
        self.assertEqual([o["slug"] for o in build.filter_expired(offers)], ["ongoing"])

    def test_expiry_today_included(self):
        today = dt.date.today()
        offers = [self._offer("today", today.isoformat())]
        self.assertEqual([o["slug"] for o in build.filter_expired(offers)], ["today"])

    def test_expiry_yesterday_excluded(self):
        yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
        offers = [self._offer("stale", yesterday)]
        self.assertEqual(build.filter_expired(offers), [])

    def test_future_expiry_included(self):
        future = (dt.date.today() + dt.timedelta(days=30)).isoformat()
        offers = [self._offer("fresh", future)]
        self.assertEqual([o["slug"] for o in build.filter_expired(offers)], ["fresh"])

    def test_main_drops_expired_offer_from_built_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            Path(offers_dir, "live.yaml").write_text(offer_text(), encoding="utf-8")
            expired = offer_text(
                title="Expired Offer",
                expiry_date=(dt.date.today() - dt.timedelta(days=1)).isoformat(),
            )
            Path(offers_dir, "expired.yaml").write_text(expired, encoding="utf-8")
            out = os.path.join(tmp, "out")
            code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            index = json.loads(Path(out, "index.json").read_text(encoding="utf-8"))
            self.assertEqual([o["slug"] for o in index["offers"]], ["live"])
            page = Path(out, "site", "index.html").read_text(encoding="utf-8")
            self.assertNotIn("Expired Offer", page)


class RenderTests(unittest.TestCase):
    def _render(self, offers):
        for i, offer in enumerate(offers):
            offer.setdefault("slug", f"offer-{i}")
        return build.render_html(build.build_index(offers))

    def _page_with_one(self, **overrides):
        return self._render([build.validate_offer(dict(VALID, **overrides), "a.yaml")])

    def test_null_expiry_renders_ongoing(self):
        page = self._page_with_one()
        self.assertIn("ongoing", page)
        self.assertNotIn("expires", page)
        self.assertIn('class="dot"', page)

    def test_dated_expiry_renders_time_element(self):
        page = self._page_with_one(expiry_date="2026-12-31")
        self.assertIn('<time datetime="2026-12-31">Dec 31, 2026</time>', page)
        self.assertIn("expires", page)

    def test_human_date_formats_month_day_year(self):
        self.assertEqual(build._human_date("2026-12-31"), "Dec 31, 2026")
        self.assertEqual(build._human_date("2026-01-05"), "Jan 5, 2026")

    def test_category_rendered_as_badge(self):
        page = self._page_with_one(category="voice")
        self.assertIn('<span class="badge">voice</span>', page)

    def test_outbound_link_hardened_and_described(self):
        page = self._page_with_one()
        self.assertIn('href="https://example.com/offer"', page)
        self.assertIn('target="_blank"', page)
        self.assertIn('rel="noopener noreferrer"', page)
        self.assertIn('aria-label="Claim Test Offer from Test Provider"', page)

    def test_quote_in_title_cannot_break_aria_label_attribute(self):
        page = self._page_with_one(title='Say "hi"')
        self.assertIn(
            'aria-label="Claim Say &quot;hi&quot; from Test Provider"', page
        )
        self.assertNotIn('aria-label="Claim Say "hi""', page)

    def test_all_seed_offers_present_in_built_page(self):
        offers = build.load_offers(str(REPO / "offers"))
        page = self._render(offers)
        for offer in offers:
            self.assertIn(offer["title"], page)
            self.assertIn(offer["provider"], page)
            self.assertIn(f'class="badge">{offer["category"]}</span>', page)
        self.assertEqual(page.count("<article"), len(offers))

    def test_verified_date_on_every_card(self):
        page = self._page_with_one()
        self.assertIn(f'verified <time datetime="{VALID["verified_date"]}">', page)


class SemanticPageTests(unittest.TestCase):
    """F1 / §5.4: landmark structure, list semantics, responsive + a11y CSS."""

    def _render_many(self, n=2):
        offers = [
            build.validate_offer(
                dict(VALID, title=f"Offer {i}", category="coding"), "a.yaml"
            )
            for i in range(n)
        ]
        for i, offer in enumerate(offers):
            offer.setdefault("slug", f"offer-{i}")
        return build.render_html(build.build_index(offers))

    def test_landmarks_header_main_footer(self):
        page = self._render_many()
        self.assertIn("<header", page)
        self.assertIn("<main>", page)
        self.assertIn("<footer", page)

    def test_cards_are_list_items_inside_unordered_grid(self):
        page = self._render_many()
        self.assertIn('<ul class="grid">', page)
        self.assertEqual(page.count("<li "), page.count("<article"))

    def test_responsive_viewport_and_fluid_layout_css(self):
        page = self._render_many()
        self.assertIn(
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            page,
        )
        self.assertIn("grid-template-columns: repeat(auto-fill", page)
        self.assertIn("clamp(", page)

    def test_focus_visible_and_reduced_motion_css_present(self):
        page = self._render_many()
        self.assertIn("a:focus-visible", page)
        self.assertIn("@media (prefers-reduced-motion: no-preference)", page)

    def test_stagger_index_style_on_cards(self):
        page = self._render_many(n=3)
        self.assertIn('--i:0"', page)
        self.assertIn('--i:2"', page)


class EmptyStateTests(unittest.TestCase):
    """F1 edge case: zero non-expired offers must render a friendly page."""

    def _empty_index(self):
        return {
            "generated_at": "2026-08-21T00:00:00Z",
            "count": 0,
            "offers": [],
        }

    def test_zero_offers_render_empty_state_not_blank_page(self):
        page = build.render_html(self._empty_index())
        self.assertIn("No live offers right now", page)
        self.assertIn('class="empty"', page)
        self.assertNotIn("<article", page)

    def test_empty_state_is_friendly_and_actionable(self):
        page = build.render_html(self._empty_index())
        self.assertIn("check back soon", page.lower())
        self.assertIn("checked by hand", page.lower())

    def test_nonzero_offers_do_not_render_empty_state(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer.setdefault("slug", "offer-0")
        page = build.render_html(build.build_index([offer]))
        self.assertNotIn('class="empty"', page)
        self.assertIn("<article", page)

    def test_main_all_expired_renders_empty_state_exit_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            expired = offer_text(
                title="Expired Offer",
                expiry_date=(dt.date.today() - dt.timedelta(days=1)).isoformat(),
            )
            Path(offers_dir, "expired.yaml").write_text(expired, encoding="utf-8")
            out = os.path.join(tmp, "out")
            code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            page = Path(out, "site", "index.html").read_text(encoding="utf-8")
            self.assertIn("No live offers right now", page)
            self.assertNotIn("<article", page)
            index = json.loads(Path(out, "index.json").read_text(encoding="utf-8"))
            self.assertEqual(index["count"], 0)


class MeasurementIdTests(unittest.TestCase):
    """F7: GA4 is build-time opt-in via the GA_MEASUREMENT_ID env var."""

    def test_unset_env_disables_analytics(self):
        with mock.patch.dict(os.environ):
            os.environ.pop(build.MEASUREMENT_ID_ENV_VAR, None)
            self.assertEqual(build.get_measurement_id(), "")

    def test_empty_value_disables_analytics(self):
        self.assertEqual(build.resolve_measurement_id(""), "")
        self.assertEqual(build.resolve_measurement_id("   "), "")

    def test_valid_measurement_id_is_accepted(self):
        self.assertEqual(
            build.resolve_measurement_id("G-ABCDEF12345"), "G-ABCDEF12345"
        )

    def test_surrounding_whitespace_is_stripped(self):
        self.assertEqual(
            build.resolve_measurement_id("  G-ABCDEF12345 \n"), "G-ABCDEF12345"
        )

    def test_malformed_id_is_rejected_with_warning(self):
        for bad in ("G-abcdef", "UA-12345", "G-", "not-an-id", "G-ABCDEF123456789"):
            err = io.StringIO()
            with redirect_stderr(err):
                self.assertEqual(build.resolve_measurement_id(bad), "")
            self.assertIn("analytics disabled", err.getvalue())

    def test_malformed_id_never_breaks_the_build(self):
        # A typo in the secret must degrade silently, not fail CI.
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            Path(offers_dir, "a.yaml").write_text(offer_text(), encoding="utf-8")
            out = os.path.join(tmp, "out")
            with mock.patch.dict(
                os.environ, {build.MEASUREMENT_ID_ENV_VAR: "oops"}
            ):
                code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            page = Path(out, "site", "index.html").read_text(encoding="utf-8")
            self.assertNotIn("googletagmanager", page)


class GtagSnippetTests(unittest.TestCase):
    """F7: consent-gated gtag bootstrap with IP anonymization."""

    MID = "G-ABCDEF12345"

    def test_disabled_yields_no_snippets(self):
        self.assertEqual(build.build_consent_head(""), "")
        self.assertEqual(build.build_analytics_init(""), "")

    def test_consent_defaults_are_denied_in_head(self):
        head = build.build_consent_head(self.MID)
        self.assertIn("gtag('consent', 'default'", head)
        for field in (
            "ad_storage: 'denied'",
            "ad_user_data: 'denied'",
            "ad_personalization: 'denied'",
            "analytics_storage: 'denied'",
        ):
            self.assertIn(field, head)

    def test_init_loads_gtag_only_after_grant(self):
        init = build.build_analytics_init(self.MID)
        self.assertIn("googletagmanager.com/gtag/js?id=", init)
        grant_pos = init.index("function ftGrant")
        loader_pos = init.index("ftLoadGa();", grant_pos)
        self.assertLess(grant_pos, loader_pos)

    def test_ip_anonymization_enabled_on_config(self):
        init = build.build_analytics_init(self.MID)
        self.assertIn('anonymize_ip: true', init)

    def test_page_view_carries_page_path(self):
        init = build.build_analytics_init(self.MID)
        self.assertIn('"event", "page_view"', init)
        self.assertIn("page_path: window.location.pathname", init)

    def test_config_disables_automatic_page_view(self):
        # config() auto-sends page_view unless told not to; the explicit
        # event must be the only one or every load is double-counted.
        init = build.build_analytics_init(self.MID)
        self.assertIn("send_page_view: false", init)

    def test_page_view_does_not_leak_query_string(self):
        # Only origin + pathname may reach GA; raw query strings stay local.
        init = build.build_analytics_init(self.MID)
        self.assertIn(
            "page_location: window.location.origin + window.location.pathname",
            init,
        )
        self.assertNotIn("window.location.search", init)

    def test_eu_heuristic_uses_configured_prefixes(self):
        init = build.build_analytics_init(self.MID)
        self.assertIn(json.dumps(list(build.EU_TIMEZONE_PREFIXES)), init)
        self.assertTrue(build.EU_TIMEZONE_PREFIXES[0].startswith("Europe"))

    def test_is_eu_timezone_pure_function(self):
        self.assertTrue(build.is_eu_timezone("Europe/Berlin"))
        self.assertTrue(build.is_eu_timezone("Europe/London"))
        self.assertFalse(build.is_eu_timezone("America/New_York"))
        self.assertFalse(build.is_eu_timezone("UTC"))
        self.assertFalse(build.is_eu_timezone(None))
        self.assertFalse(build.is_eu_timezone(""))

    def test_consent_decision_persisted_in_localstorage(self):
        init = build.build_analytics_init(self.MID)
        self.assertIn(build.CONSENT_STORAGE_KEY, init)
        self.assertIn('localStorage.setItem(STORAGE_KEY, value)', init)

    def test_init_runs_after_window_load_idle(self):
        init = build.build_analytics_init(self.MID)
        self.assertIn('addEventListener("load"', init)
        self.assertIn("requestIdleCallback", init)

    def test_measurement_id_safely_quoted(self):
        init = build.build_analytics_init(self.MID)
        self.assertIn(json.dumps(self.MID), init)


class ConsentBannerTests(unittest.TestCase):
    """F7: lightweight banner, keyboard accessible, only when GA4 configured."""

    def _index(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer.setdefault("slug", "offer-0")
        return build.build_index([offer])

    def test_banner_absent_when_analytics_disabled(self):
        page = build.render_html(self._index())
        self.assertNotIn("ft-consent-banner", page)
        self.assertNotIn("googletagmanager", page)
        self.assertNotIn("dataLayer", page)

    def test_default_render_stays_analytics_free(self):
        page = build.render_html(self._index())
        self.assertNotIn("<script>", page)

    def test_banner_present_and_hidden_when_enabled(self):
        page = build.render_html(self._index(), measurement_id="G-ABCDEF12345")
        self.assertIn('id="ft-consent-banner"', page)
        self.assertRegex(page, r'id="ft-consent-banner"[^>]*\bhidden\b')

    def test_banner_is_keyboard_accessible_region(self):
        page = build.render_html(self._index(), measurement_id="G-ABCDEF12345")
        self.assertIn('role="region"', page)
        self.assertIn('aria-label="Analytics consent"', page)
        self.assertIn('<button type="button" id="ft-consent-accept">Accept</button>', page)
        self.assertIn('<button type="button" id="ft-consent-decline">Decline</button>', page)

    def test_decline_prevents_tracking_calls(self):
        init = build.build_analytics_init("G-ABCDEF12345")
        reject = init.index("function ftReject")
        decline_body = init[reject:init.index("}", init.index("ftDecline();", reject))]
        self.assertIn('ftStoreDecision("denied")', decline_body)
        self.assertNotIn("ftGrant()", decline_body)


class AnalyticsBuildOutputTests(unittest.TestCase):
    """End-to-end: analytics assets are emitted exactly when configured."""

    def _write_offers(self, tmp):
        offers_dir = os.path.join(tmp, "offers")
        os.makedirs(offers_dir)
        Path(offers_dir, "alpha.yaml").write_text(offer_text(), encoding="utf-8")
        return offers_dir

    def test_main_without_id_emits_no_tracking_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write_offers(tmp)
            out = os.path.join(tmp, "out")
            with mock.patch.dict(os.environ):
                os.environ.pop(build.MEASUREMENT_ID_ENV_VAR, None)
                code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            page = Path(out, "site", "index.html").read_text(encoding="utf-8")
            for marker in ("googletagmanager", "dataLayer", "ft-consent-banner"):
                self.assertNotIn(marker, page)

    def test_main_with_id_emits_gtag_consent_and_banner(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write_offers(tmp)
            out = os.path.join(tmp, "out")
            env = {build.MEASUREMENT_ID_ENV_VAR: "G-ABCDEF12345"}
            with mock.patch.dict(os.environ, env):
                code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            page = Path(out, "site", "index.html").read_text(encoding="utf-8")
            self.assertIn("googletagmanager.com/gtag/js", page)
            self.assertIn("analytics_storage: 'denied'", page)
            self.assertIn("anonymize_ip: true", page)
            self.assertIn('"page_view"', page)
            self.assertIn('id="ft-consent-banner"', page)
            index = json.loads(Path(out, "index.json").read_text(encoding="utf-8"))
            self.assertEqual(index["count"], 1)


if __name__ == "__main__":
    unittest.main()
