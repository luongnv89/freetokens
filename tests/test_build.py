"""Tests for scripts/build.py — stdlib unittest, run with:

python3 -m unittest discover -s tests -v
"""

import datetime as dt
import html
import io
import json
import os
import re
import subprocess
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


class OfferClickMarkupTests(unittest.TestCase):
    """F6 / Task 3.4: outbound links carry offer_id, provider, category."""

    def _page_with_one(self, **overrides):
        offer = build.validate_offer(dict(VALID, **overrides), "a.yaml")
        offer.setdefault("slug", "test-offer")
        return build.render_html(build.build_index([offer]))

    def test_link_carries_attribution_attributes(self):
        page = self._page_with_one(category="coding", provider="Alpha AI")
        self.assertIn('data-ft-offer-id="test-offer"', page)
        self.assertIn('data-ft-provider="Alpha AI"', page)
        self.assertIn('data-ft-category="coding"', page)

    def test_attributes_match_every_seeded_offer(self):
        offers = build.load_offers(str(REPO / "offers"))
        index = build.build_index(offers)
        page = build.render_html(index)
        for offer in index["offers"]:
            with self.subTest(slug=offer["slug"]):
                self.assertEqual(
                    page.count(
                        f'data-ft-offer-id="{html.escape(offer["slug"], quote=True)}"'
                    ),
                    1,
                )
                self.assertIn(
                    f'data-ft-provider='
                    f'"{html.escape(offer["provider"], quote=True)}"',
                    page,
                )
                self.assertIn(
                    f'data-ft-offer-category='
                    f'"{html.escape(offer["category"], quote=True)}"',
                    page,
                )

    def test_hostile_provider_is_attribute_safe(self):
        page = self._page_with_one(provider='A&B "Quotes"')
        self.assertIn('data-ft-provider="A&amp;B &quot;Quotes&quot;"', page)

    def test_empty_page_has_no_offer_links(self):
        empty_index = {
            "generated_at": "2026-08-21T00:00:00Z",
            "count": 0,
            "offers": [],
        }
        page = build.render_html(empty_index)
        self.assertNotIn("data-ft-offer-id", page)


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
        self.assertIn('<ul class="grid" id="ft-grid">', page)
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
        # Build-time empty state stays off; the client-side no-results panel
        # ships hidden and only reveals after a filtering interaction.
        self.assertNotIn("No live offers right now", page)
        self.assertIn('id="ft-no-results" hidden', page)
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


class MastheadStatsTests(unittest.TestCase):
    """#49: masthead surfaces total, ongoing, and verified deal counters."""

    def _index(self, expiries):
        offers = []
        for i, expiry in enumerate(expiries):
            offer = build.validate_offer(
                dict(VALID, title=f"Offer {i}", expiry_date=expiry), "a.yaml"
            )
            offer.setdefault("slug", f"offer-{i}")
            offers.append(offer)
        return build.build_index(offers)

    def _count_line(self, page):
        start = page.index('<p class="count">')
        return page[start : page.index("</p>", start)]

    def test_masthead_shows_total_ongoing_and_verified_counts(self):
        future = (dt.date.today() + dt.timedelta(days=30)).isoformat()
        page = build.render_html(self._index([None, None, future]))
        line = self._count_line(page)
        self.assertIn("<strong>3</strong> live offers", line)
        self.assertIn("<strong>2</strong> ongoing", line)
        self.assertIn("<strong>3</strong> verified", line)

    def test_dated_expiries_are_not_counted_as_ongoing(self):
        page = build.render_html(
            self._index([None, "2026-12-31"])
        )
        line = self._count_line(page)
        self.assertIn("<strong>1</strong> ongoing", line)

    def test_empty_index_renders_zero_counters(self):
        index = {"generated_at": "2026-08-21T00:00:00Z", "count": 0, "offers": []}
        page = build.render_html(index)
        line = self._count_line(page)
        self.assertIn("<strong>0</strong> live offers", line)
        self.assertIn("<strong>0</strong> ongoing", line)
        self.assertIn("<strong>0</strong> verified", line)

    def test_stats_match_the_built_seed_catalog(self):
        offers = build.load_offers(str(REPO / "offers"))
        index = build.build_index(build.filter_expired(offers))
        page = build.render_html(index)
        ongoing = sum(1 for o in index["offers"] if o["expiry_date"] is None)
        line = self._count_line(page)
        self.assertIn(f"<strong>{index['count']}</strong> live offers", line)
        self.assertIn(f"<strong>{ongoing}</strong> ongoing", line)
        # Every published offer carries a non-null verified_date (validator
        # enforces it), so the verified counter always equals the total.
        self.assertIn(f"<strong>{index['count']}</strong> verified", line)


class FooterContactTests(unittest.TestCase):
    """#50: maintainer contact links (X, LinkedIn, website) on every page."""

    def _home(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer.setdefault("slug", "offer-0")
        return build.render_html(build.build_index([offer]))

    def _privacy(self):
        return build.render_privacy_html("2026-08-21T00:00:00Z")

    def _contact_segment(self, page):
        start = page.index('aria-label="Contact"')
        return page[start : page.index("</nav>", start)]

    def test_contact_nav_present_on_home_and_privacy_pages(self):
        for name, page in (("home", self._home()), ("privacy", self._privacy())):
            with self.subTest(page=name):
                self.assertIn('<nav class="foot-nav" aria-label="Contact">', page)

    def test_links_point_at_maintainer_profiles(self):
        segment = self._contact_segment(self._home())
        self.assertIn('href="https://x.com/luongnv89"', segment)
        self.assertIn('href="https://linkedin.com/in/luongnv89"', segment)
        self.assertIn('href="https://luongnv.com"', segment)

    def test_labels_name_x_linkedin_and_website(self):
        segment = self._contact_segment(self._home())
        for label in ("X", "LinkedIn", "Website"):
            self.assertIn(f">{label}</a>", segment)

    def test_external_links_open_new_tab_with_noopener_hardening(self):
        segment = self._contact_segment(self._home())
        self.assertEqual(segment.count('target="_blank"'), 3)
        self.assertEqual(segment.count('rel="noopener noreferrer"'), 3)

    def test_exactly_three_contact_links_separated_by_middots(self):
        segment = self._contact_segment(self._home())
        self.assertEqual(segment.count("<a "), 3)
        self.assertEqual(segment.count("&middot;"), 2)
        self.assertFalse(segment.startswith("<span"))

    def test_contact_links_follow_site_nav_and_never_carry_current(self):
        home = self._home()
        privacy = self._privacy()
        for name, page in (("home", home), ("privacy", privacy)):
            with self.subTest(page=name):
                self.assertLess(
                    page.index('aria-label="Site"'),
                    page.index('aria-label="Contact"'),
                )
                self.assertNotIn("aria-current", self._contact_segment(page))
        # The aria-current contract of the site nav itself stays intact.
        self.assertIn('href="./" aria-current="page"', home)
        self.assertIn('href="privacy.html" aria-current="page"', privacy)

    def test_committed_artifacts_carry_contact_nav_and_stats(self):
        for artifact in ("site/index.html", "site/privacy.html"):
            with self.subTest(artifact=artifact):
                page = (REPO / artifact).read_text(encoding="utf-8")
                self.assertIn('aria-label="Contact"', page)
        home = (REPO / "site/index.html").read_text(encoding="utf-8")
        self.assertIn("</strong> ongoing &middot;", home)


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
        # The site script ships unconditionally; analytics code must not.
        page = build.render_html(self._index())
        for marker in ("googletagmanager", "dataLayer", "gtag", "ft-consent-banner"):
            self.assertNotIn(marker, page)
        self.assertIn('id="ft-app"', page)

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


class ToolbarMarkupTests(unittest.TestCase):
    """F2/#13: search + category chips emitted with offers, a11y wired."""

    def _page(self, n=2):
        offers = [
            build.validate_offer(
                dict(VALID, title=f"Offer {i}", category="coding"), "a.yaml"
            )
            for i in range(n)
        ]
        for i, offer in enumerate(offers):
            offer.setdefault("slug", f"offer-{i}")
        return build.render_html(build.build_index(offers))

    def test_toolbar_present_with_search_and_chips(self):
        page = self._page()
        self.assertIn('aria-label="Search and filter offers"', page)
        self.assertIn('id="ft-search"', page)
        self.assertIn('type="search"', page)
        self.assertIn('for="ft-search"', page)
        self.assertIn("placeholder=", page)

    def test_all_five_categories_plus_all_chip(self):
        page = self._page()
        self.assertIn('data-ft-category=""', page)
        for category in build.CATEGORIES:
            self.assertIn(f'data-ft-category="{category}"', page)
        self.assertEqual(page.count('data-ft-category='), len(build.CATEGORIES) + 1)

    def test_all_chip_pressed_others_not(self):
        page = self._page()
        all_chip = page[page.index('data-ft-category=""'):]
        self.assertIn('aria-pressed="true"', all_chip[:200])
        self.assertEqual(page.count('aria-pressed="false"'), len(build.CATEGORIES))

    def test_results_status_is_live_region_seeded_with_count(self):
        page = self._page(n=4)
        self.assertIn('id="ft-results-status"', page)
        self.assertIn('role="status"', page)
        self.assertIn("Showing all 4 offers", page)

    def test_client_empty_panel_hidden_with_working_reset(self):
        page = self._page()
        self.assertIn('id="ft-no-results" hidden', page)
        self.assertIn('id="ft-reset-filters"', page)
        reset_pos = page.index('id="ft-reset-filters"')
        self.assertIn("<button", page[max(0, reset_pos - 80):reset_pos])

    def test_app_script_emitted_once(self):
        page = self._page()
        self.assertEqual(page.count('<script id="ft-app">'), 1)

    def test_chips_have_visible_focus_without_analytics_css(self):
        # The banner CSS (which owns button:focus-visible) ships only when
        # GA4 is configured; the toolbar must own its focus styles too.
        page = self._page()
        self.assertIn(".chip:focus-visible", page)
        self.assertIn("#ft-search:focus-visible", page)

    def test_no_toolbar_when_zero_offers(self):
        index = {"generated_at": "2026-08-21T00:00:00Z", "count": 0, "offers": []}
        page = build.render_html(index)
        self.assertNotIn('id="ft-search"', page)
        self.assertNotIn("ft-app", page)
        self.assertIn("No live offers right now", page)


class AppJsSourceTests(unittest.TestCase):
    """F2/F3 static guarantees over the generated site script."""

    JS = build.build_app_js()

    def test_categories_injected_from_build_constant(self):
        self.assertIn(json.dumps(list(build.CATEGORIES)), self.JS)
        self.assertNotIn("__FT_CATEGORIES__", self.JS)

    def test_debounce_uses_configured_ms_under_200_budget(self):
        self.assertIn(f"var DEBOUNCE_MS = {build.SEARCH_DEBOUNCE_MS};", self.JS)
        self.assertLess(build.SEARCH_DEBOUNCE_MS, 200)
        self.assertIn("setTimeout(", self.JS)
        self.assertIn("clearTimeout(", self.JS)

    def test_url_state_via_history_api(self):
        self.assertIn("history.pushState(", self.JS)
        self.assertIn('addEventListener("popstate"', self.JS)
        self.assertIn("URLSearchParams", self.JS)

    def test_unknown_category_param_rejected_on_restore(self):
        parse_pos = self.JS.index("function ftParseState")
        body = self.JS[parse_pos:self.JS.index("function ftSerializeState")]
        self.assertIn("indexOf(category) === -1", body)

    def test_and_combination_requires_both_category_and_query(self):
        matches = self.JS[self.JS.index("function ftMatches"):]
        category_check = matches.index('getAttribute("data-category")')
        query_check = matches.index("ftNormalize")
        self.assertLess(category_check, query_check)
        # Both checks must gate the same boolean result (early returns).
        self.assertIn("return false;", matches[:query_check])

    def test_filter_event_carries_category_only(self):
        self.assertIn('"filter_use", { category:', self.JS)

    def test_search_event_carries_query_length_never_raw_query(self):
        self.assertIn('"search", { query_length: state.q.length }', self.JS)
        track_call = self.JS[self.JS.index("function commit"):]
        self.assertNotIn("q: ", track_call[track_call.index("ftTrack"):])
        self.assertNotIn("search_term", self.JS)

    def test_events_dispatch_guarded_for_absent_analytics(self):
        self.assertIn('typeof window.ftTrackEvent === "function"', self.JS)

    def test_deep_link_restore_runs_without_committing_history_or_events(self):
        init_body = self.JS[self.JS.index("function ftInitApp"):]
        restore = init_body.rindex("apply(); // deep-link restore")
        self.assertNotIn("commit(", init_body[restore:])
        popstate = init_body[init_body.index('addEventListener("popstate"'):]
        self.assertIn("apply(); // restore view", popstate)

    def test_open_detail_guarded_for_missing_dialog_support(self):
        open_fn = self.JS[self.JS.index("function ftOpenDetail"):]
        body = open_fn[:open_fn.index("function ", 10)]
        self.assertIn('getElementById("ft-detail-" + slug)', body)
        self.assertIn('typeof dlg.showModal !== "function"', body)
        # Opening is best-effort: a throwing showModal must not break the page.
        self.assertIn("try {", body)
        self.assertIn("catch (err)", body)

    def test_detail_event_carries_offer_id_only(self):
        self.assertIn('"offer_details_open", { offer_id: slug }', self.JS)
        # No panel content ever reaches analytics.
        self.assertNotIn("offer_details_open", self.JS.split("ftOpenDetail")[0])

    def test_delegated_trigger_walk_reads_data_ft_detail(self):
        walk = self.JS[self.JS.index("// Detail triggers"):]
        walk = walk[:walk.index("\n    function syncControls")]
        self.assertIn('getAttribute("data-ft-detail")', walk)
        self.assertIn("ftOpenDetail(slug);", walk)


class FilterEventGateTests(unittest.TestCase):
    """/#13,#14: filter/search events ride the consent-gated event bus."""

    MID = "G-ABCDEF12345"

    def test_analytics_init_exposes_consent_gated_ft_track_event(self):
        init = build.build_analytics_init(self.MID)
        self.assertIn("var TRACKING_ACTIVE = false;", init)
        self.assertIn("function ftTrackEvent(name, params)", init)
        self.assertIn("window.ftTrackEvent = ftTrackEvent;", init)
        gate = init.index("function ftTrackEvent")
        body = init[gate:init.index("}", init.index("!TRACKING_ACTIVE"))]
        self.assertIn("!TRACKING_ACTIVE", body)
        self.assertIn('typeof gtag !== "function"', body)

    def test_grant_activates_tracking_before_loading_gtag(self):
        init = build.build_analytics_init(self.MID)
        grant = init.index("function ftGrant")
        active = init.index("TRACKING_ACTIVE = true;", grant)
        loader = init.index("ftLoadGa();", grant)
        self.assertLess(active, loader)

    def test_decline_deactivates_tracking(self):
        init = build.build_analytics_init(self.MID)
        decline = init.index("function ftDecline")
        self.assertIn(
            "TRACKING_ACTIVE = false;",
            init[decline:decline + 120],
        )

    def test_disabled_analytics_ships_no_gate_but_site_script_still_works(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer.setdefault("slug", "offer-0")
        page = build.render_html(build.build_index([offer]))
        # Gate definition absent; the guarded call site remains (no-op).
        self.assertNotIn("window.ftTrackEvent = ftTrackEvent;", page)
        self.assertNotIn("TRACKING_ACTIVE", page)
        self.assertIn('typeof window.ftTrackEvent === "function"', page)


class DetailLoadTests(unittest.TestCase):
    """#48: offers/details/<slug>.json loading and strict validation."""

    def _load(self, tmp, payloads_by_slug):
        details_dir = os.path.join(tmp, "details")
        os.makedirs(details_dir, exist_ok=True)
        for slug, payload in payloads_by_slug.items():
            Path(details_dir, f"{slug}.json").write_text(
                json.dumps(payload), encoding="utf-8"
            )
        return build.load_details(tmp, {"alpha", "beta"})

    def test_missing_details_dir_yields_no_details(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(build.load_details(tmp, {"alpha"}), {})

    def test_valid_documents_load_keyed_by_slug(self):
        with tempfile.TemporaryDirectory() as tmp:
            details = self._load(
                tmp,
                {
                    "alpha": {"summary": "Alpha detail."},
                    "beta": {
                        "claim_steps": ["Step one.", "Step two."],
                        "social_proof": [
                            {
                                "type": "x",
                                "url": "https://x.com/dev/status/123",
                                "author": "Dev",
                                "handle": "@dev",
                                "text": "Great free tier!",
                            }
                        ],
                    },
                },
            )
            self.assertEqual(details["alpha"], {"summary": "Alpha detail."})
            self.assertEqual(details["beta"]["claim_steps"], ["Step one.", "Step two."])

    def test_orphan_slug_is_a_named_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build.OfferError, "no offer named 'ghost'"):
                self._load(tmp, {"ghost": {"summary": "Orphan."}})

    def test_invalid_json_names_file_position(self):
        with tempfile.TemporaryDirectory() as tmp:
            details_dir = os.path.join(tmp, "details")
            os.makedirs(details_dir)
            Path(details_dir, "alpha.json").write_text("{oops", encoding="utf-8")
            with self.assertRaisesRegex(build.OfferError, "invalid JSON"):
                build.load_details(tmp, {"alpha"})

    def test_non_object_document_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build.OfferError, "JSON object"):
                self._load(tmp, {"alpha": [1, 2]})

    def test_unknown_field_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build.OfferError, "unknown fields: rating"):
                self._load(tmp, {"alpha": {"summary": "x", "rating": 5}})

    def test_document_without_any_known_field_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build.OfferError, "at least one of"):
                self._load(tmp, {"alpha": {}})

    def test_claim_steps_must_be_non_empty_string_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            for bad in ([], "one", [""]):
                with self.subTest(bad=bad):
                    with self.assertRaisesRegex(build.OfferError, "claim_steps"):
                        self._load(tmp, {"alpha": {"claim_steps": bad}})

    def test_claim_steps_capped_at_twelve(self):
        with tempfile.TemporaryDirectory() as tmp:
            steps = [f"Step {i}" for i in range(13)]
            with self.assertRaisesRegex(build.OfferError, "at most 12"):
                self._load(tmp, {"alpha": {"claim_steps": steps}})

    def test_summary_length_cap_enforced(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build.OfferError, "summary exceeds"):
                self._load(
                    tmp, {"alpha": {"summary": "x" * (build.SUMMARY_MAX_CHARS + 1)}}
                )

    def test_social_proof_type_must_be_known(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build.OfferError, "type must be one of"):
                self._load(
                    tmp,
                    {
                        "alpha": {
                            "social_proof": [{"type": "tiktok", "url": "https://x.co"}]
                        }
                    },
                )

    def test_linked_proofs_require_http_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build.OfferError, "url must be an http"):
                self._load(
                    tmp,
                    {
                        "alpha": {
                            "social_proof": [
                                {
                                    "type": "reddit",
                                    "url": "javascript:alert(1)",
                                    "author": "a",
                                    "text": "t",
                                }
                            ]
                        }
                    },
                )
            with self.assertRaisesRegex(
                build.OfferError, "url must be a non-empty string"
            ):
                self._load(
                    tmp,
                    {
                        "alpha": {
                            "social_proof": [
                                {"type": "reddit", "author": "a", "text": "t"}
                            ]
                        }
                    },
                )

    def test_link_entry_requires_title(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build.OfferError, "title"):
                self._load(
                    tmp,
                    {
                        "alpha": {
                            "social_proof": [
                                {"type": "link", "url": "https://blog.example/post"}
                            ]
                        }
                    },
                )

    def test_screenshot_requires_local_image_and_caption(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = [
                {"type": "screenshot", "image": "../escape.png", "caption": "c"},
                {"type": "screenshot", "image": "/abs/path.png", "caption": "c"},
                {"type": "screenshot", "caption": "c"},
            ]
            for entry in bad:
                with self.subTest(entry=entry):
                    with self.assertRaisesRegex(build.OfferError, "image"):
                        self._load(tmp, {"alpha": {"social_proof": [entry]}})

    def test_unknown_proof_field_rejected_per_type(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build.OfferError, "unknown fields: handle"):
                self._load(
                    tmp,
                    {
                        "alpha": {
                            "social_proof": [
                                {
                                    "type": "reddit",
                                    "url": "https://reddit.com/r/AI/1",
                                    "author": "a",
                                    "text": "t",
                                    "handle": "@x",
                                }
                            ]
                        }
                    },
                )


def _detail_render(offers, details=None):
    """Render the home page from validated offers plus a detail map."""
    rendered = []
    for i, offer in enumerate(offers):
        offer.setdefault("slug", f"offer-{i}")
        rendered.append(offer)
    return build.render_html(build.build_index(rendered), "", details or {})


class DetailRenderTests(unittest.TestCase):
    """#48: every offer gets a trigger button and a full detail dialog."""

    def _offer(self, **overrides):
        return build.validate_offer(dict(VALID, **overrides), "a.yaml")

    def test_every_card_has_trigger_button_wired_to_dialog(self):
        page = _detail_render([self._offer()])
        self.assertIn('data-ft-detail="offer-0"', page)
        self.assertIn('aria-haspopup="dialog"', page)
        self.assertIn('aria-controls="ft-detail-offer-0"', page)
        self.assertIn('id="ft-detail-offer-0"', page)

    def test_dialog_carries_core_fields_beyond_list_summary(self):
        page = _detail_render(
            [self._offer(title="Detail Me", provider="Prov Co")],
            {"offer-0": {"summary": "Longer description here."}},
        )
        start = page.index('id="ft-detail-offer-0"')
        seg = page[start : page.index("</dialog>", start)]
        self.assertIn("<h3", seg)
        self.assertIn("Prov Co", seg)
        self.assertIn("$10 in credits", seg)
        self.assertIn("verified <time", seg)
        self.assertIn("Longer description here.", seg)

    def test_claim_steps_render_as_ordered_list(self):
        page = _detail_render(
            [self._offer()],
            {"offer-0": {"claim_steps": ["Sign up.", "Claim credits."]}},
        )
        seg = page[page.index('<section class="od-steps">') :]
        self.assertIn("<h4>How to claim</h4>", seg)
        self.assertIn("<ol><li>Sign up.</li><li>Claim credits.</li></ol>", seg)

    def test_fallback_claim_steps_without_detail_data(self):
        page = _detail_render([self._offer()])
        self.assertIn("Open the official offer page.", page)
        self.assertIn("How to claim</h4>", page)

    def test_social_proof_variants_render_embed_style_cards(self):
        details = {
            "offer-0": {
                "social_proof": [
                    {
                        "type": "x",
                        "url": "https://x.com/dev/status/1",
                        "author": "Dev One",
                        "handle": "@devone",
                        "text": "Loving this free tier!",
                    },
                    {
                        "type": "reddit",
                        "url": "https://www.reddit.com/r/AI/comments/x/",
                        "author": "red_user",
                        "community": "r/AI",
                        "text": "Works as advertised.",
                    },
                    {
                        "type": "link",
                        "url": "https://blog.example/news",
                        "title": "Big launch post",
                    },
                ]
            }
        }
        page = _detail_render([self._offer()], details)
        self.assertIn('class="proof-card proof-x"', page)
        self.assertIn("@devone", page)
        self.assertIn("Loving this free tier!", page)
        self.assertIn("View post on X", page)
        self.assertIn("r/AI", page)
        self.assertIn("View on Reddit", page)
        self.assertIn("<strong>Big launch post</strong>", page)
        self.assertIn("Open source", page)
        self.assertEqual(page.count('rel="noopener noreferrer"'), page.count("proof-card"))

    def test_screenshot_proof_renders_lazy_figure(self):
        page = _detail_render(
            [self._offer()],
            {
                "offer-0": {
                    "social_proof": [
                        {
                            "type": "screenshot",
                            "image": "assets/shots/pricing.png",
                            "caption": "Pricing table showing $0 plan",
                        }
                    ]
                }
            },
        )
        self.assertIn('src="assets/shots/pricing.png"', page)
        self.assertIn('alt="Pricing table showing $0 plan"', page)
        self.assertIn('loading="lazy"', page)
        self.assertIn("<figcaption>Pricing table showing $0 plan</figcaption>", page)

    def test_dialog_escapes_hostile_content(self):
        page = _detail_render(
            [self._offer(title='Bad <script>alert(1)</script>', provider='Q"uote')],
            {
                "offer-0": {
                    "summary": "<script>evil()</script>",
                    "social_proof": [
                        {
                            "type": "x",
                            "url": 'https://x.com/h/status/9"><script>',
                            "author": '<img src=x onerror=alert(1)>',
                            "text": '"quoted" & <b>bold</b>',
                        }
                    ],
                }
            },
        )
        self.assertNotIn("<script>alert(1)</script>", page)
        self.assertNotIn("onerror=alert(1)>", page.replace("&quot;", '"'))
        self.assertIn("&lt;script&gt;", page)
        self.assertIn("&quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;", page)

    def test_cta_link_points_at_source_and_opens_new_tab(self):
        page = _detail_render([self._offer()])
        self.assertIn(
            '<a class="od-cta" href="https://example.com/offer"'
            ' target="_blank" rel="noopener noreferrer">Claim at Test Provider',
            page,
        )

    def test_detail_css_and_js_ship_with_offers(self):
        page = _detail_render([self._offer()])
        self.assertIn(".detail-btn", page)
        self.assertIn(".detail::backdrop", page)
        self.assertIn("ftOpenDetail", page)

    def test_zero_offers_ships_no_dialogs_or_triggers(self):
        index = {"generated_at": "2026-08-21T00:00:00Z", "count": 0, "offers": []}
        page = build.render_html(index)
        self.assertNotIn("<dialog", page)
        self.assertNotIn("data-ft-detail", page)


class LargeFixtureBuildTests(unittest.TestCase):
    """F3 scale check: the build pipeline handles a 500-offer directory."""

    def test_main_builds_500_offers_with_toolbar(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            categories = list(build.CATEGORIES)
            for i in range(500):
                Path(offers_dir, f"offer-{i:04d}.yaml").write_text(
                    offer_text(
                        title=f"Offer number {i} unique token zz{i}",
                        category=categories[i % len(categories)],
                    ),
                    encoding="utf-8",
                )
            out = os.path.join(tmp, "out")
            code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            index = json.loads(Path(out, "index.json").read_text(encoding="utf-8"))
            self.assertEqual(index["count"], 500)
            page = Path(out, "site", "index.html").read_text(encoding="utf-8")
            self.assertEqual(page.count("<article"), 500)
            self.assertIn('id="ft-search"', page)
            self.assertIn('id="ft-grid"', page)


def _probe_node():
    """True when a runnable node exists; gates the VM behavioral tests."""
    try:
        proc = subprocess.run(
            ["node", "-e", "process.stdout.write('ok')"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return proc.returncode == 0 and proc.stdout.strip() == "ok"
    except (OSError, subprocess.SubprocessError):
        return False


HAS_NODE = _probe_node()


class NodeAppJsTests(unittest.TestCase):
    """Behavioral tests driving _APP_JS in a Node VM with DOM stubs.

    Skipped when no runnable node exists (e.g. CI installs Python only);
    run locally via e.g. `mise x node@22 -- python3 -m unittest discover`.
    """

    HARNESS = Path(__file__).resolve().parent / "app_js_harness.js"

    def _run(self, steps, cards=None, init_search="", track_enabled=True,
             track_mode="record"):
        page_script = build.build_app_js()
        bare = page_script[
            page_script.index(">") + 1 : page_script.rindex("</script>")
        ]
        with tempfile.NamedTemporaryFile(
            "w", suffix=".js", delete=False
        ) as fh:
            fh.write(bare)
            app_path = fh.name
        self.addCleanup(os.unlink, app_path)
        scenario = {
            "app": app_path,
            "cards": cards
            or [
                {"slug": "alpha", "category": "image", "text": "Alpha Studio Image Google"},
                {"slug": "copilot", "category": "coding", "text": "Copilot Coding GitHub"},
                {"slug": "mistral", "category": "api_provider", "text": "Mistral API Provider"},
            ],
            "init_search": init_search,
            "track_enabled": track_enabled,
            "track_mode": track_mode,
            "valid_categories": list(build.CATEGORIES),
            "steps": steps,
        }
        proc = subprocess.run(
            ["node", str(self.HARNESS)],
            input=json.dumps(scenario),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(
            proc.returncode, 0, f"harness failed: {proc.stderr}"
        )
        return json.loads(proc.stdout)

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_deep_link_restores_combined_state_without_events(self):
        snaps = self._run([], init_search="?category=coding&q=copilot")
        first = snaps[0]
        self.assertEqual(first["visible"], ["copilot"])
        self.assertEqual(first["status"], "Showing 1 of 3 offers")
        self.assertEqual(first["pressed"]["coding"], "true")
        self.assertEqual(first["pressed"]["all"], "false")
        self.assertEqual(first["events"], [])
        self.assertEqual(first["historyUrls"], [])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_deep_link_with_mixed_case_query_matches_case_insensitively(self):
        combined = self._run([], init_search="?category=coding&q=Copilot")[0]
        self.assertEqual(combined["visible"], ["copilot"])
        query_only = self._run([], init_search="?q=Mistral")[0]
        self.assertEqual(query_only["visible"], ["mistral"])
        self.assertEqual(query_only["status"], "Showing 1 of 3 offers")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_debounced_typing_narrows_and_fires_single_search_event(self):
        snaps = self._run(
            [
                {"op": "type", "value": "mi"},
                {"op": "advance", "ms": 50},
                {"op": "type", "value": "mistral"},
                {"op": "advance", "ms": 200},
                {"op": "snapshot"},
            ]
        )
        after_partial = snaps[2]  # before debounce window elapsed
        self.assertEqual(after_partial["historyUrls"], [])
        self.assertEqual(len(after_partial["visible"]), 3)
        final = snaps[-1]
        self.assertEqual(final["visible"], ["mistral"])
        self.assertEqual(final["historyUrls"], ["?q=mistral"])
        self.assertEqual(final["events"], [["search", {"query_length": 7}]])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_combined_search_and_filter_uses_and_semantics_with_empty_state(self):
        snaps = self._run(
            [
                {"op": "type", "value": "google"},
                {"op": "advance", "ms": 200},
            ],
            init_search="?category=coding",
        )
        final = snaps[-1]
        # "google" matches only the image card; coding filter excludes it.
        self.assertEqual(final["visible"], [])
        self.assertEqual(final["status"], "Showing 0 of 3 offers")
        self.assertFalse(final["emptyHidden"])
        self.assertEqual(final["historyUrls"], ["?category=coding&q=google"])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_category_click_updates_url_and_fires_filter_use_once(self):
        snaps = self._run(
            [
                {"op": "click_chip", "value": "image"},
                {"op": "click_chip", "value": ""},
            ]
        )
        after_image = snaps[1]
        self.assertEqual(after_image["visible"], ["alpha"])
        self.assertEqual(after_image["historyUrls"], ["?category=image"])
        self.assertEqual(
            after_image["events"], [["filter_use", {"category": "image"}]]
        )
        final = snaps[2]  # All resets
        self.assertEqual(final["historyUrls"][-1], "/")
        self.assertEqual(final["pressed"]["all"], "true")
        self.assertEqual([e[0] for e in final["events"]],
                         ["filter_use", "filter_use"])
        self.assertEqual(final["events"][-1],
                         ["filter_use", {"category": "all"}])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_popstate_restores_view_without_new_events_or_history(self):
        snaps = self._run(
            [
                {"op": "click_chip", "value": "coding"},
                {"op": "popstate", "search": "?category=image"},
                {"op": "snapshot"},
            ]
        )
        restored = snaps[-1]
        self.assertEqual(restored["visible"], ["alpha"])
        self.assertEqual(restored["pressed"]["image"], "true")
        self.assertEqual(restored["pressed"]["coding"], "false")
        self.assertEqual(
            restored["events"], [["filter_use", {"category": "coding"}]]
        )
        self.assertEqual(restored["historyUrls"], ["?category=coding"])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_reset_clears_state_url_and_input(self):
        snaps = self._run(
            [
                {"op": "type", "value": "copilot"},
                {"op": "advance", "ms": 200},
                {"op": "click_reset"},
            ],
            init_search="?category=image",
        )
        final = snaps[-1]
        self.assertEqual(len(final["visible"]), 3)
        self.assertEqual(final["inputValue"], "")
        self.assertEqual(final["locationSearch"], "")
        self.assertEqual(final["historyUrls"][-1], "/")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_whitespace_only_query_never_commits(self):
        snaps = self._run(
            [
                {"op": "type", "value": "   "},
                {"op": "advance", "ms": 200},
            ]
        )
        final = snaps[-1]
        self.assertEqual(final["historyUrls"], [])
        self.assertEqual(final["events"], [])
        self.assertEqual(len(final["visible"]), 3)

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_invalid_category_param_ignored_on_restore(self):
        first = self._run([], init_search="?category=bogus")[0]
        self.assertEqual(len(first["visible"]), 3)
        self.assertEqual(first["pressed"]["all"], "true")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_redundant_filter_click_does_not_spam_history(self):
        snaps = self._run(
            [
                {"op": "click_chip", "value": "image"},
                {"op": "click_chip", "value": "image"},
                {"op": "click_reset"},
            ]
        )
        final = snaps[-1]
        # One entry per distinct state: image, then the reset to "/".
        self.assertEqual(
            final["historyUrls"], ["?category=image", "/"]
        )
        self.assertEqual(len(final["events"]), 3)  # each click still applies

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_silent_when_analytics_absent(self):
        snaps = self._run(
            [{"op": "click_chip", "value": "video"}, {"op": "click_reset"}],
            track_enabled=False,
        )
        final = snaps[-1]
        self.assertEqual(final["events"], [])  # recorder never registered
        self.assertEqual(len(final["visible"]), 3)
        self.assertNotIn("ftTrackEvent", json.dumps(final))

    # --- F10 sort behavior (issue #22) --------------------------------------

    SORT_CARDS = [
        {
            "slug": "old", "category": "coding",
            "text": "Old Coding", "verified": "2026-01-01",
            "expiry": "2026-09-30", "amount_sort": "80",
        },
        {
            "slug": "new", "category": "image",
            "text": "New Image", "verified": "2026-08-21",
            "expiry": "", "amount_sort": "300",
        },
        {
            "slug": "mid", "category": "api_provider",
            "text": "Mid API", "verified": "2026-05-05",
            "expiry": "2026-08-25", "amount_sort": "10000",
        },
    ]

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_expiring_soon_sorts_ascending_with_null_expiry_last(self):
        snaps = self._run(
            [{"op": "set_sort", "value": "expiring"}], cards=self.SORT_CARDS
        )
        final = snaps[-1]
        self.assertEqual(final["visible"], ["mid", "old", "new"])
        self.assertEqual(final["sortValue"], "expiring")
        self.assertEqual(final["historyUrls"], ["?sort=expiring"])
        self.assertEqual(
            final["events"], [["sort_use", {"sort_option": "expiring"}]]
        )

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_newest_sorts_verified_date_descending(self):
        snaps = self._run(
            [{"op": "set_sort", "value": "newest"}], cards=self.SORT_CARDS
        )
        final = snaps[-1]
        self.assertEqual(final["visible"], ["new", "mid", "old"])
        self.assertEqual(
            final["events"], [["sort_use", {"sort_option": "newest"}]]
        )

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_amount_sorts_descending(self):
        snaps = self._run(
            [{"op": "set_sort", "value": "amount"}], cards=self.SORT_CARDS
        )
        final = snaps[-1]
        self.assertEqual(final["visible"], ["mid", "new", "old"])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_default_restores_build_order_and_reports_default_option(self):
        snaps = self._run(
            [
                {"op": "set_sort", "value": "amount"},
                {"op": "set_sort", "value": ""},
            ],
            cards=self.SORT_CARDS,
        )
        final = snaps[-1]
        self.assertEqual(final["visible"], ["old", "new", "mid"])  # build order
        self.assertEqual(final["sortValue"], "")
        self.assertEqual(final["locationSearch"], "")
        self.assertEqual(
            final["events"],
            [
                ["sort_use", {"sort_option": "amount"}],
                ["sort_use", {"sort_option": "default"}],
            ],
        )

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_deep_link_sort_param_reorders_on_load_without_events(self):
        first = self._run([], init_search="?sort=expiring", cards=self.SORT_CARDS)[0]
        self.assertEqual(first["visible"], ["mid", "old", "new"])
        self.assertEqual(first["sortValue"], "expiring")
        self.assertEqual(first["events"], [])
        self.assertEqual(first["historyUrls"], [])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_invalid_sort_param_ignored_on_restore(self):
        first = self._run([], init_search="?sort=bogus")[0]
        self.assertEqual(len(first["visible"]), 3)
        self.assertEqual(first["sortValue"], "")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_popstate_restores_sort_without_new_events_or_history(self):
        snaps = self._run(
            [
                {"op": "set_sort", "value": "expiring"},
                {"op": "popstate", "search": "?sort=newest"},
                {"op": "snapshot"},
            ],
            cards=self.SORT_CARDS,
        )
        restored = snaps[-1]
        self.assertEqual(restored["visible"], ["new", "mid", "old"])
        self.assertEqual(restored["sortValue"], "newest")
        self.assertEqual(restored["historyUrls"], ["?sort=expiring"])
        self.assertEqual(
            restored["events"], [["sort_use", {"sort_option": "expiring"}]]
        )

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_redundant_sort_change_neither_commits_nor_tracks(self):
        snaps = self._run(
            [
                {"op": "set_sort", "value": "expiring"},
                {"op": "set_sort", "value": "expiring"},
            ],
            cards=self.SORT_CARDS,
        )
        final = snaps[-1]
        self.assertEqual(final["historyUrls"], ["?sort=expiring"])
        self.assertEqual(
            final["events"], [["sort_use", {"sort_option": "expiring"}]]
        )

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_sort_and_filter_compose_hidden_items_stay_sorted(self):
        snaps = self._run(
            [
                {"op": "set_sort", "value": "newest"},
                {"op": "click_chip", "value": "coding"},
            ],
            cards=self.SORT_CARDS,
        )
        final = snaps[-1]
        self.assertEqual(final["visible"], ["old"])  # only coding offer shows
        self.assertEqual(final["locationSearch"], "?category=coding&sort=newest")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_resort_of_25_offers_completes_under_200ms(self):
        many_cards = []
        for i in range(25):
            many_cards.append(
                {
                    "slug": f"offer-{i:02d}",
                    "category": "coding",
                    "text": f"Offer {i}",
                    "verified": f"2026-01-{(i % 28) + 1:02d}",
                    "expiry": "" if i % 5 == 0 else "2026-12-01",
                    "amount_sort": str((i * 37) % 900),
                }
            )
        snaps = self._run(
            [{"op": "perf_sort", "value": "expiring"}], cards=many_cards
        )
        final = snaps[-1]
        self.assertLess(final["perf_ms"], 200)
        ongoing_last = [
            s for s in final["visible"] if not many_cards[int(s[-2:])]["expiry"]
        ]
        self.assertEqual(ongoing_last, final["visible"][-5:])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_offer_click_fires_once_with_matching_params(self):
        cards = [
            {"slug": "copilot", "category": "coding", "provider": "GitHub", "text": "Copilot Coding GitHub"},
        ]
        snaps = self._run(
            [{"op": "click_offer", "value": "copilot"}], cards=cards
        )
        final = snaps[-1]
        self.assertEqual(
            final["events"],
            [["offer_click", {
                "offer_id": "copilot",
                "provider": "GitHub",
                "category": "coding",
            }]],
        )

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_rapid_double_click_yields_single_event(self):
        snaps = self._run(
            [
                {"op": "click_offer", "value": "alpha"},
                {"op": "click_offer", "value": "alpha"},
                {"op": "click_offer", "value": "alpha"},
            ]
        )
        final = snaps[-1]
        self.assertEqual(len(final["events"]), 1)
        self.assertEqual(final["events"][0][1]["offer_id"], "alpha")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_second_click_after_dedupe_window_fires_again(self):
        snaps = self._run(
            [
                {"op": "click_offer", "value": "mistral"},
                {"op": "advance", "ms": build.OFFER_CLICK_DEDUPE_MS + 500},
                {"op": "click_offer", "value": "mistral"},
            ]
        )
        final = snaps[-1]
        self.assertEqual(len(final["events"]), 2)
        self.assertEqual(
            [e[1]["offer_id"] for e in final["events"]],
            ["mistral", "mistral"],
        )

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_distinct_offers_both_fire_in_rapid_succession(self):
        snaps = self._run(
            [
                {"op": "click_offer", "value": "alpha"},
                {"op": "click_offer", "value": "copilot"},
            ]
        )
        final = snaps[-1]
        self.assertEqual(
            [e[1]["offer_id"] for e in final["events"]], ["alpha", "copilot"]
        )

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_click_on_inner_span_resolves_to_enclosing_offer(self):
        snaps = self._run([{"op": "click_span", "value": "alpha"}])
        final = snaps[-1]
        self.assertEqual(len(final["events"]), 1)
        self.assertEqual(final["events"][0][1]["offer_id"], "alpha")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_grid_click_without_offer_link_is_ignored(self):
        snaps = self._run([{"op": "click_grid"}])
        self.assertEqual(snaps[-1]["events"], [])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_navigation_never_prevented_even_when_tracker_throws(self):
        snaps = self._run(
            [{"op": "click_offer", "value": "copilot"}],
            track_mode="throw",
        )
        final = snaps[-1]
        # The blocked GA4 call must not break the click: no exception leaves
        # the handler and the default navigation is never prevented.
        self.assertEqual(final["preventDefaults"], 0)
        self.assertEqual(final["events"], [])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_silent_when_analytics_absent_but_links_still_live(self):
        snaps = self._run(
            [{"op": "click_offer", "value": "alpha"}], track_enabled=False
        )
        final = snaps[-1]
        self.assertEqual(final["events"], [])
        self.assertEqual(final["preventDefaults"], 0)

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_clicking_detail_button_opens_dialog_and_tracks_once(self):
        snaps = self._run([{"op": "click_detail", "value": "copilot"}])
        final = snaps[-1]
        self.assertEqual(final["openDialogs"], ["copilot"])
        self.assertEqual(
            final["events"],
            [["offer_details_open", {"offer_id": "copilot"}]],
        )

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_detail_click_never_fires_offer_click(self):
        snaps = self._run([{"op": "click_detail", "value": "alpha"}])
        final = snaps[-1]
        kinds = [e[0] for e in final["events"]]
        self.assertEqual(kinds, ["offer_details_open"])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_dialog_stays_open_after_opening_a_second_offer(self):
        snaps = self._run(
            [
                {"op": "click_detail", "value": "alpha"},
                {"op": "click_detail", "value": "mistral"},
            ]
        )
        final = snaps[-1]
        self.assertEqual(final["openDialogs"], ["alpha", "mistral"])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_detail_opening_silent_when_analytics_absent(self):
        snaps = self._run(
            [{"op": "click_detail", "value": "mistral"}], track_enabled=False
        )
        final = snaps[-1]
        self.assertEqual(final["openDialogs"], ["mistral"])
        self.assertEqual(final["events"], [])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_filtering_still_works_with_dialogs_present(self):
        snaps = self._run(
            [
                {"op": "click_detail", "value": "copilot"},
                {"op": "type", "value": "mistral"},
                {"op": "advance", "ms": 200},
            ]
        )
        final = snaps[-1]
        self.assertEqual(final["visible"], ["mistral"])
        self.assertEqual(final["openDialogs"], ["copilot"])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_filter_settle_under_200ms_over_500_offers(self):
        cards = [
            {
                "slug": f"offer-{i:04d}",
                "category": list(build.CATEGORIES)[i % len(build.CATEGORIES)],
                "text": f"Offer number {i} provider token zz{i}",
            }
            for i in range(500)
        ]
        snaps = self._run(
            [{"op": "perf_type_settle", "value": "zz499"}], cards=cards
        )
        perf = snaps[-1]["perf_ms"]
        self.assertLess(perf, 200, f"settle took {perf}ms over 500 offers")
        self.assertEqual(snaps[-1]["visible"], ["offer-0499"])


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


class PrivacyPageTests(unittest.TestCase):
    """Task 3.5 / §5.2: generated policy page sharing site chrome."""

    MID = "G-ABCDEF12345"

    def _built(self):
        return "2026-08-21T00:00:00Z"

    def _render(self, mid=""):
        return build.render_privacy_html(self._built(), measurement_id=mid)

    def _home_with_one(self, **overrides):
        offer = build.validate_offer(dict(VALID, **overrides), "a.yaml")
        offer.setdefault("slug", "offer-0")
        return build.render_html(build.build_index([offer]))

    # --- generation wiring -------------------------------------------------

    def test_main_writes_privacy_page_alongside_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            Path(offers_dir, "alpha.yaml").write_text(offer_text(), encoding="utf-8")
            out = os.path.join(tmp, "out")
            code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            page = Path(out, "site", "privacy.html").read_text(encoding="utf-8")
            self.assertIn("Privacy Policy", page)

    def test_policy_page_built_even_when_analytics_disabled(self):
        with mock.patch.dict(os.environ):
            os.environ.pop(build.MEASUREMENT_ID_ENV_VAR, None)
            page = self._render()
            self.assertIn("Privacy Policy", page)
            for marker in ("googletagmanager", "dataLayer", "ft-consent-banner"):
                self.assertNotIn(marker, page)

    def test_policy_page_ships_analytics_when_configured(self):
        page = self._render(self.MID)
        self.assertIn("googletagmanager.com/gtag/js", page)
        self.assertIn("anonymize_ip: true", page)

    # --- consistent chrome / responsive design ------------------------------

    def test_shares_site_chrome_and_styling(self):
        home = self._home_with_one()
        page = self._render()
        for marker in (
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            '<footer class="foot">',
            "--ink:",
            '"Bricolage Grotesque"',
            'class="wrap"',
        ):
            self.assertIn(marker, home)
            self.assertIn(marker, page)

    def test_fluid_css_keeps_layout_responsive(self):
        page = self._render()
        self.assertIn("clamp(", page)
        self.assertIn("max-width:", page)

    # --- footer links on every page -----------------------------------------

    def test_home_footer_links_to_privacy_relatively(self):
        page = self._home_with_one()
        self.assertIn('<a href="privacy.html">Privacy policy</a>', page)
        self.assertNotIn('href="/privacy', page)  # deploy-base safe

    def test_privacy_footer_links_back_to_offers_relatively(self):
        page = self._render()
        self.assertIn('<a href="./">Offers</a>', page)
        self.assertNotIn('href="/index', page)

    def test_aria_current_marks_active_page_only(self):
        home = self._home_with_one()
        privacy = self._render()
        # The stylesheet carries the [aria-current] selector on both pages;
        # only the active page's link element carries the attribute itself.
        self.assertIn('href="./" aria-current="page"', home)
        self.assertNotIn('aria-current="page">Privacy', home)
        self.assertIn('href="privacy.html" aria-current="page"', privacy)
        self.assertNotIn('aria-current="page">Offers', privacy)

    def test_footer_nav_present_on_both_pages(self):
        home = self._home_with_one()
        page = self._render()
        for marker in ('aria-label="Site"', 'class="foot-nav"'):
            self.assertIn(marker, home)
            self.assertIn(marker, page)

    # --- accuracy against implemented behavior ------------------------------

    def test_policy_states_raw_search_text_never_collected_length_only(self):
        page = self._render()
        self.assertIn("never</strong> collected", page)
        self.assertIn("query_length", page)
        self.assertIn("number of characters typed", page)

    def test_policy_states_ip_anonymization(self):
        page = self._render()
        self.assertIn("Anonymized IP addresses", page)
        self.assertIn("IP anonymization", page)

    def test_policy_states_consent_gating_and_decline_means_zero_calls(self):
        page = self._render()
        self.assertIn("zero tracking requests", page)
        self.assertIn("not even loaded until permission", page)

    def test_policy_names_real_localstorage_key_and_no_own_cookies(self):
        page = self._render()
        self.assertIn(build.CONSENT_STORAGE_KEY, page)
        self.assertIn("sets no cookies of its own", page)

    def test_policy_describes_eu_banner_heuristic_honestly(self):
        page = self._render()
        self.assertIn("time zone indicates they are likely in the EU", page)
        self.assertIn("counted without showing the banner", page)

    def test_policy_covers_events_recorded(self):
        page = self._render().lower()
        for claim in (
            "page views",
            "offer clicks",
            "which filter category you picked",
        ):
            self.assertIn(claim, page)

    def test_policy_states_no_forms_no_pii_storage(self):
        page = self._render()
        self.assertIn("no forms", page.lower())
        self.assertIn("no accounts", page.lower())

    def test_policy_discloses_google_third_party_processing(self):
        page = self._render()
        self.assertIn(
            'href="https://policies.google.com/privacy"', page
        )
        self.assertIn("Google Fonts", page)
        self.assertIn("privacy policy applies, not this one", page.lower())

    def test_policy_offers_block_and_still_works_choice(self):
        page = self._render()
        self.assertRegex(page, r"[Bb]lock everything")
        self.assertIn("keeps working exactly the same", page)

    def test_policy_has_contact_path(self):
        page = self._render()
        self.assertIn(
            'href="https://github.com/luongnv89/freetokens/issues"', page
        )

    # --- accessibility spot-check -------------------------------------------

    def test_single_h1_and_labelled_sections(self):
        page = self._render()
        self.assertEqual(page.count("<h1>"), 1)
        # Every section owns exactly one heading (8 sections, 8 h2s).
        self.assertEqual(page.count("<h2"), page.count("</section>"))
        self.assertIn('id="privacy-summary"', page)
        self.assertIn('aria-labelledby="privacy-summary"', page)

    def test_keyboard_focus_styles_present(self):
        page = self._render()
        self.assertIn("a:focus-visible", page)
        self.assertIn("outline: 3px solid var(--ink)", page)

    def test_contrast_palette_matches_site_tokens(self):
        # Same ink-on-paper tokens as the home page: #000 on #fff body copy;
        # --gray (#6b7280) reserved for small mono metadata only.
        page = self._render()
        self.assertIn("--ink: #000000;", page)
        self.assertIn("--paper: #ffffff;", page)
        self.assertIn('--gray: #6b7280;', page)


class LaunchGateTests(unittest.TestCase):
    """Task 3.7 / §8.1: favicon, meta tags, and responsive guards on all pages."""

    FAVICON_LINK = '<link rel="icon" type="image/svg+xml" href="./favicon.svg">'

    def _home_with_one(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer.setdefault("slug", "offer-0")
        return build.render_html(build.build_index([offer]))

    def _empty_home(self):
        index = {"generated_at": "2026-08-21T00:00:00Z", "count": 0, "offers": []}
        return build.render_html(index)

    def _privacy(self):
        return build.render_privacy_html("2026-08-21T00:00:00Z")

    # --- favicon ------------------------------------------------------------

    def test_favicon_emitted_next_to_html(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            Path(offers_dir, "alpha.yaml").write_text(offer_text(), encoding="utf-8")
            out = os.path.join(tmp, "out")
            code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            icon = Path(out, "site", "favicon.svg").read_text(encoding="utf-8")
            self.assertIn("<svg", icon)
            self.assertIn('xmlns="http://www.w3.org/2000/svg"', icon)
            self.assertIn("</svg>", icon)

    def test_every_generated_page_links_the_favicon_relatively(self):
        for page in (self._home_with_one(), self._empty_home(), self._privacy()):
            with self.subTest(page=page[:40]):
                self.assertIn(self.FAVICON_LINK, page)
                # Relative href only: absolute /favicon paths break under
                # the GitHub Pages /<repo>/ project base.
                self.assertNotIn('href="/favicon', page)

    def test_favicon_is_valid_xml(self):
        import xml.etree.ElementTree as ET

        root = ET.fromstring(build._FAVICON_SVG)
        self.assertEqual(root.tag, "{http://www.w3.org/2000/svg}svg")

    # --- title + meta description on every page ------------------------------

    def test_title_and_meta_description_on_every_page(self):
        pages = {
            "home": self._home_with_one(),
            "home-empty": self._empty_home(),
            "privacy": self._privacy(),
        }
        for name, page in pages.items():
            with self.subTest(page=name):
                self.assertRegex(page, r"<title>[^<]+</title>")
                self.assertRegex(
                    page, r'<meta name="description" content="[^"]{10,}"'
                )

    def test_titles_differ_between_pages(self):
        home_title = re.search(r"<title>([^<]+)</title>", self._home_with_one())
        privacy_title = re.search(r"<title>([^<]+)</title>", self._privacy())
        self.assertNotEqual(home_title.group(1), privacy_title.group(1))

    # --- 320 px + touch guards ------------------------------------------------

    def test_layout_guards_for_320px_viewport(self):
        page = self._home_with_one()
        # Fluid grid that can never demand more than one column of space.
        self.assertIn("repeat(auto-fill, minmax(min(100%, 19rem), 1fr))", page)
        # Fluid gutters and type scale instead of fixed pixel widths.
        self.assertIn("padding: clamp(1.25rem, 4vw, 3rem)", page)
        # Long words/URLs wrap instead of forcing horizontal scroll.
        self.assertIn("overflow-wrap", page)
        # iOS text inflation must not fight the viewport meta.
        self.assertIn("-webkit-text-size-adjust: 100%", page)

    def test_touch_targets_meet_44px_on_coarse_pointers(self):
        home = self._home_with_one()
        self.assertIn("@media (pointer: coarse)", home)
        coarse_block = home[home.index("@media (pointer: coarse)"):]
        self.assertIn(".chip,", coarse_block[:200])
        self.assertIn("#ft-sort { min-height: 44px; }", coarse_block[:200])
        # The consent banner ships its own copy of the rule because its CSS
        # is emitted only when GA4 is configured.
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer.setdefault("slug", "offer-0")
        banner_page = build.render_html(
            build.build_index([offer]),
            measurement_id="G-ABCDEF12345",
        )
        self.assertIn(".consent-actions button { min-height: 44px; }", banner_page)


class AmountSortValueTests(unittest.TestCase):
    """F10 sort key heuristic: first-number magnitude with k/M suffixes."""

    def test_dollar_amount(self):
        self.assertEqual(build.amount_sort_value("$300 in credits"), 300.0)

    def test_thousands_separator(self):
        self.assertEqual(
            build.amount_sort_value("2,000 completions + 50 chat requests"),
            2000.0,
        )

    def test_k_suffix(self):
        self.assertEqual(build.amount_sort_value("10k credits/month"), 10000.0)

    def test_m_suffix_case_insensitive(self):
        self.assertEqual(build.amount_sort_value("5M tokens"), 5_000_000.0)
        self.assertEqual(build.amount_sort_value("3m requests"), 3_000_000.0)

    def test_no_number_is_zero(self):
        self.assertEqual(build.amount_sort_value("Free tier"), 0.0)
        self.assertEqual(build.amount_sort_value(""), 0.0)

    def test_never_crashes_on_hostile_input(self):
        for junk in ("..", ",,,", "1.2.3 things", "9.", "-"):
            self.assertIsInstance(build.amount_sort_value(junk), float)


class SortMarkupTests(unittest.TestCase):
    """Build-time markup behind F10: select control + per-card sort keys."""

    def _home_with_one(self, **overrides):
        offer = build.validate_offer(dict(VALID, **overrides), "a.yaml")
        offer.setdefault("slug", "offer-0")
        return build.render_html(build.build_index([offer]))

    def test_toolbar_has_sort_select_with_default_plus_three_modes(self):
        page = self._home_with_one()
        self.assertIn('<select id="ft-sort">', page)
        self.assertIn('<option value="">Default</option>', page)
        for mode in build.SORT_MODES:
            self.assertIn(f'<option value="{mode}">', page)
        self.assertIn('<label class="tool-label" for="ft-sort">Sort</label>', page)

    def test_option_labels_match_constants(self):
        page = self._home_with_one()
        for mode, label in build.SORT_LABELS.items():
            self.assertIn(f">{label}</option>", page)

    def test_card_carries_verified_expiry_and_amount_sort_keys(self):
        page = self._page = self._home_with_one(
            expiry_date="2026-12-31", amount="$300 in credits"
        )
        self.assertIn(f'data-verified="{VALID["verified_date"]}"', page)
        self.assertIn('data-expiry="2026-12-31"', page)
        self.assertIn('data-amount-sort="300"', page)

    def test_ongoing_offer_has_empty_expiry_key(self):
        page = self._home_with_one()
        self.assertIn('data-expiry=""', page)

    def test_empty_page_has_no_toolbar_or_select(self):
        index = {"generated_at": "2026-01-01T00:00:00Z", "count": 0, "offers": []}
        page = build.render_html(index)
        self.assertNotIn('id="ft-sort"', page)


if __name__ == "__main__":
    unittest.main()
