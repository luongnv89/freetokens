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
from urllib.parse import quote

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

    def _dated_offer(self, slug, verified):
        return dict(
            build.validate_offer(
                dict(VALID, title=f"Offer {slug}", verified_date=verified),
                "a.yaml",
            ),
            slug=slug,
        )

    def test_index_orders_newest_verified_first(self):
        # #70: the default listing order is latest-added first; verified_date
        # doubles as the add stamp in the frozen seven-field schema.
        offers = [
            self._dated_offer("old", "2026-01-01"),
            self._dated_offer("new", "2026-08-21"),
            self._dated_offer("mid", "2026-05-05"),
        ]
        index = build.build_index(offers)
        self.assertEqual([o["slug"] for o in index["offers"]], ["new", "mid", "old"])

    def test_index_order_stable_on_verified_date_ties(self):
        # #70: equal verified dates keep slug-ascending order so re-sorts and
        # rebuilds never shuffle same-day additions.
        offers = [
            self._dated_offer("zeta", "2026-08-21"),
            self._dated_offer("alpha", "2026-08-21"),
            self._dated_offer("mid", "2026-08-21"),
        ]
        index = build.build_index(offers)
        self.assertEqual([o["slug"] for o in index["offers"]], ["alpha", "mid", "zeta"])

    def test_home_page_renders_newest_added_card_first(self):
        # #70: with no ?sort= param the first card on the home page is the
        # most recently added offer.
        offers = [
            self._dated_offer("old", "2026-01-01"),
            self._dated_offer("new", "2026-08-21"),
        ]
        page = build.render_html(build.build_index(offers))
        first = re.search(r'data-ft-offer-id="([^"]+)"', page)
        self.assertEqual(first.group(1), "new")

    def test_html_escapes_titles(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write_offers(tmp)
            out = os.path.join(tmp, "out")
            # Scrub tracker config so consent-gate scripts (#72) are never
            # emitted; the assertion below relies on a script-free page.
            with mock.patch.dict(os.environ):
                os.environ.pop(build.MEASUREMENT_ID_ENV_VAR, None)
                os.environ.pop(build.STATS_SITE_ENV_VAR, None)
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

    def test_main_retains_expired_offer_in_index_flagged_not_rendered(self):
        # v2.0 retain-and-flag (#25): the expired offer stays in index.json
        # with a build-time status, but the home page never shows it.
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
            self.assertEqual(
                [(o["slug"], o["status"]) for o in index["offers"]],
                [("expired", "expired"), ("live", "active")],
            )
            self.assertEqual(index["count"], 2)
            self.assertEqual(index["active_count"], 1)
            self.assertEqual(index["expired_count"], 1)
            page = Path(out, "site", "index.html").read_text(encoding="utf-8")
            self.assertNotIn("Expired Offer", page)
            self.assertIn("Test Offer", page)


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
        self.assertIn('aria-label="Claim Say &quot;hi&quot; from Test Provider"', page)
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
                    f'data-ft-provider="{html.escape(offer["provider"], quote=True)}"',
                    page,
                )
                self.assertIn(
                    f"data-ft-offer-category="
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
            # The empty state points visitors at the archive (#26).
            self.assertIn('href="archive.html"', page)
            index = json.loads(Path(out, "index.json").read_text(encoding="utf-8"))
            # Retain-and-flag: the entry survives in the index; only its
            # visibility changes.
            self.assertEqual(index["count"], 1)
            self.assertEqual(index["active_count"], 0)
            self.assertEqual(index["expired_count"], 1)
            self.assertEqual(index["offers"][0]["status"], "expired")


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
        page = build.render_html(self._index([None, "2026-12-31"]))
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
        self.assertEqual(build.resolve_measurement_id("G-ABCDEF12345"), "G-ABCDEF12345")

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
            with mock.patch.dict(os.environ, {build.MEASUREMENT_ID_ENV_VAR: "oops"}):
                os.environ.pop(build.STATS_SITE_ENV_VAR, None)
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
        self.assertIn("anonymize_ip: true", init)

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

    def test_eu_heuristic_no_longer_gates_the_banner(self):
        # #72: every first-time visitor is asked, so the client runtime
        # carries no time-zone gating at all any more.
        init = build.build_analytics_init(self.MID)
        self.assertNotIn("EU_PREFIXES", init)
        self.assertNotIn("ftIsEuTimeZone", init)
        self.assertNotIn("resolvedOptions().timeZone", init)
        # The server-side helper stays available for diagnostics.
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
        self.assertIn("localStorage.setItem(STORAGE_KEY, value)", init)

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
        self.assertIn(
            '<button type="button" id="ft-consent-accept">Allow</button>', page
        )
        self.assertIn(
            '<button type="button" id="ft-consent-decline">Decline</button>', page
        )

    def test_decline_prevents_tracking_calls(self):
        init = build.build_analytics_init("G-ABCDEF12345")
        reject = init.index("function ftReject")
        decline_body = init[
            reject : init.index("}", init.index("ftDecline();", reject))
        ]
        self.assertIn('ftStoreDecision("denied")', decline_body)
        self.assertNotIn("ftGrant()", decline_body)


class StatsConfigTests(unittest.TestCase):
    """#62: GoatCounter site-URL resolution, mirroring GA4 gating."""

    def test_unset_env_disables_traffic_stats(self):
        self.assertEqual(build.get_traffic_stats_site({}), "")

    def test_empty_value_disables_traffic_stats_silently(self):
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(
                build.get_traffic_stats_site({build.STATS_SITE_ENV_VAR: ""}), ""
            )
        self.assertEqual(err.getvalue(), "")

    def test_valid_url_accepted_and_trailing_slash_normalized(self):
        site = build.get_traffic_stats_site(
            {build.STATS_SITE_ENV_VAR: "https://luongnv89.goatcounter.com/"}
        )
        self.assertEqual(site, "https://luongnv89.goatcounter.com")

    def test_whitespace_around_value_is_stripped(self):
        site = build.get_traffic_stats_site(
            {build.STATS_SITE_ENV_VAR: "  https://ok.goatcounter.com \n"}
        )
        self.assertEqual(site, "https://ok.goatcounter.com")

    def test_malformed_site_warns_and_disables(self):
        for bad in (
            "http://stats.example.com",
            "ftp://files.example.com",
            "javascript:alert(1)",
            "https://",
            "stats.example.com",
            'https://evil.com/" onmouseover="x',
            "https://a b.example.com",
            "https://x.example.com/<script>",
        ):
            with self.subTest(bad=bad):
                err = io.StringIO()
                with redirect_stderr(err):
                    self.assertEqual(build.resolve_stats_site(bad), "")
                self.assertIn("traffic stats disabled", err.getvalue())

    def test_site_never_carries_path_query_or_userinfo(self):
        for bad in (
            "https://stats.example.com/api?x=1",
            "https://user:pw@stats.example.com",
            "https://stats.example.com/#frag",
        ):
            with self.subTest(bad=bad):
                self.assertEqual(build.resolve_stats_site(bad), "")

    def test_reads_from_process_environ_by_default(self):
        env = {build.STATS_SITE_ENV_VAR: "https://live.goatcounter.com"}
        with mock.patch.dict(os.environ, env):
            self.assertEqual(
                build.get_traffic_stats_site(),
                "https://live.goatcounter.com",
            )


class StatsBeaconTests(unittest.TestCase):
    """#62: tracker snippet + strip markup builders ('' when disabled)."""

    SITE = "https://gc.example.com"

    def test_disabled_yields_no_beacon(self):
        self.assertEqual(build.build_stats_beacon(""), "")

    def test_beacon_is_consent_gated_loader(self):
        # #72: no plain async tracker script any more — a loader that only
        # injects gc.zgo.at after a stored grant, or the live grant event.
        beacon = build.build_stats_beacon(self.SITE)
        self.assertTrue(beacon.startswith("<script"))
        self.assertTrue(beacon.endswith("</script>"))
        self.assertNotIn("<script async src=", beacon)
        self.assertIn('"https://gc.zgo.at/count.js"', beacon)
        self.assertIn(json.dumps(f"{self.SITE}/count"), beacon)
        self.assertIn('=== "granted"', beacon)
        self.assertIn('addEventListener("ft-consent-granted", ftGcLoad)', beacon)

    def test_beacon_loader_never_fires_without_consent(self):
        beacon = build.build_stats_beacon(self.SITE)
        load_pos = beacon.index("function ftGcLoad")
        granted_check = beacon.index('=== "granted"')
        event_hook = beacon.index("ft-consent-granted")
        self.assertLess(granted_check, event_hook)
        # The loader body itself is defined before either trigger runs it.
        self.assertLess(load_pos, granted_check)

    def test_beacon_escapes_hostile_values_defensively(self):
        beacon = build.build_stats_beacon('https://e.com/x" onerror="y')
        self.assertNotIn('" onerror="', beacon)
        # Embedded as a JSON string applied via setAttribute, never raw HTML.
        self.assertIn(json.dumps('https://e.com/x" onerror="y/count'), beacon)

    def test_strip_builder_disabled_yields_nothing(self):
        self.assertEqual(build.build_traffic_strip(""), "")

    def test_strip_builder_emits_hidden_status_region_with_dashboard_link(self):
        strip = build.build_traffic_strip(self.SITE)
        self.assertIn(f'id="{build.TRAFFIC_STRIP_ID}"', strip)
        self.assertRegex(strip, r'id="ft-traffic"[^>]*\bhidden\b')
        self.assertIn('role="status"', strip)
        self.assertIn('aria-live="polite"', strip)
        self.assertIn(f'href="{self.SITE}" rel="noopener noreferrer"', strip)


class TrafficStripMarkupTests(unittest.TestCase):
    """#62: gating of beacon/strip/module across every generated page."""

    SITE = "https://gc.example.com"

    def _home(self, site=""):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer.setdefault("slug", "offer-0")
        return build.render_html(
            build.build_index([offer]),
            stats_site=site,
        )

    def _detail(self, site=""):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer["slug"] = "test-offer"
        index = build.build_index([offer])
        return build.render_offer_html(
            index["offers"][0],
            None,
            index["generated_at"],
            stats_site=site,
        )

    def test_default_render_ships_zero_stats_markers(self):
        page = self._home()
        for marker in (
            "count.js",
            "ft-traffic",
            "ftInitStats",
            "counter/TOTAL.json",
            ".foot-traffic",
        ):
            self.assertNotIn(marker, page)

    def test_configured_home_ships_beacon_hidden_strip_and_css(self):
        page = self._home(self.SITE)
        self.assertIn('"https://gc.zgo.at/count.js"', page)
        self.assertIn('id="ft-traffic" role="status" aria-live="polite" hidden', page)
        self.assertIn(".foot-traffic", page)
        self.assertIn(json.dumps(self.SITE), page)
        self.assertNotIn("__FT_STATS_", page)
        self.assertNotIn("__FT_STRIP_ID__", page)

    def test_strip_wording_distinct_from_build_time_deal_counters(self):
        # History hazard (#49): masthead deal counters say "live offers";
        # the traffic strip must never borrow that vocabulary.
        page = self._home(self.SITE)
        seg = page[page.index('id="ft-traffic"') :]
        seg = seg[: seg.index("</p>")]
        self.assertIn("live traffic", seg)
        self.assertIn("visitors today", seg)
        self.assertIn("in 90 days", seg)
        self.assertNotIn("live offers", seg)
        self.assertNotIn('class="count"', seg)

    def test_archive_privacy_detail_get_beacon_but_not_strip(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer["slug"] = "test-offer"
        index = build.build_index([offer])
        pages = {
            "archive": build.render_archive_html(index, stats_site=self.SITE),
            "privacy": build.render_privacy_html(
                "2026-08-21T00:00:00Z",
                stats_site=self.SITE,
            ),
            "detail": self._detail(self.SITE),
        }
        for name, page in pages.items():
            with self.subTest(page=name):
                self.assertIn('"https://gc.zgo.at/count.js"', page)
                self.assertNotIn('id="ft-traffic"', page)
                self.assertNotIn("ftInitStats", page)

    def test_empty_home_keeps_beacon_but_no_strip_or_module(self):
        empty = {"generated_at": "2026-08-21T00:00:00Z", "count": 0, "offers": []}
        page = build.render_html(empty, stats_site=self.SITE)
        self.assertIn('"https://gc.zgo.at/count.js"', page)
        self.assertNotIn('id="ft-traffic"', page)
        self.assertNotIn("ftInitStats", page)

    def test_unconfigured_pages_stay_clean_even_with_other_analytics(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer.setdefault("slug", "offer-0")
        page = build.render_html(
            build.build_index([offer]), measurement_id="G-ABCDEF12345"
        )
        for marker in ("count.js", "ft-traffic"):
            self.assertNotIn(marker, page)
        self.assertIn("googletagmanager", page)  # GA4 path unaffected


class StatsModuleSourceTests(unittest.TestCase):
    """#62 static guarantees over the spliced live-traffic module."""

    SITE = "https://gc.example.com"

    @classmethod
    def setUpClass(cls):
        cls.js_on = build.build_app_js(stats_site=cls.SITE)
        cls.js_off = build.build_app_js()

    def test_unconfigured_script_has_no_stats_code_or_tokens(self):
        for marker in (
            "ftInitStats",
            "counter/TOTAL.json",
            "__FT_STATS_",
            "__FT_STRIP_ID__",
            "ftFormatCount",
        ):
            self.assertNotIn(marker, self.js_off)

    def test_configured_placeholders_fully_resolved(self):
        self.assertIn(json.dumps(self.SITE), self.js_on)
        for token in (
            "__FT_STATS_SITE__",
            "__FT_STRIP_ID__",
            "__FT_STATS_BOOT__",
            "__FT_STATS_MODULE__",
        ):
            self.assertNotIn(token, self.js_on)

    def test_boot_hooks_stats_after_offer_app_guards(self):
        boot_pos = self.js_on.index("function ftBoot")
        body = self.js_on[boot_pos : self.js_on.index("document.readyState")]
        app_guard = body.index("ftInitApp();")
        stats_hook = body.index("ftInitStats();")
        self.assertLess(app_guard, stats_hook)
        # Each feature is independently try/catch-wrapped.
        self.assertEqual(body.count("} catch (err) {}"), 2)

    def test_fetch_api_guarded_before_use(self):
        pos = self.js_on.index("function ftInitStats")
        body = self.js_on[pos:]
        guard_pos = body.index('typeof window.fetch !== "function"')
        slot_pos = body.index(f'getElementById("{build.TRAFFIC_STRIP_ID}")')
        fetch_pos = body.index("window.fetch(ftCounterUrl(")
        self.assertLess(max(guard_pos, slot_pos), fetch_pos)

    def test_http_error_status_short_circuits_rendering(self):
        self.assertIn("!responses[0].ok || !responses[1].ok", self.js_on)

    def test_network_and_parse_errors_are_swallowed(self):
        pos = self.js_on.index("function ftInitStats")
        tail = self.js_on[pos:]
        self.assertIn(".catch(function () {})", tail)

    def test_counts_rendered_via_textcontent_never_innerhtml(self):
        self.assertIn(".textContent =", self.js_on)
        self.assertNotIn("innerHTML", self.js_on)

    def test_query_urls_target_counter_route_with_date_range(self):
        pos = self.js_on.index("function ftCounterUrl")
        body = self.js_on[pos : self.js_on.index("function ftFormatCount")]
        self.assertIn("/counter/TOTAL.json?start=", body)
        self.assertIn("&end=", body)
        self.assertEqual(body.count("ftIsoDate("), 2)  # start + end

    def test_only_digits_derived_non_negative_counts_are_trusted(self):
        pos = self.js_on.index("function ftStatNumber")
        body = self.js_on[pos : self.js_on.index("function ftFillTraffic")]
        self.assertIn('typeof data.count !== "string"', body)
        self.assertIn("[^0-9]", body)
        self.assertIn("!isFinite(n)", body)
        self.assertIn("n < 0", body)

    def test_period_window_labeled_not_claimed_all_time(self):
        # Copy states the fixed window; it must not overclaim all-time totals.
        self.assertIn("in 90 days", build._TRAFFIC_STRIP_TMPL)
        self.assertNotIn("all-time", build._TRAFFIC_STRIP_TMPL.lower())


class LiveTrafficPrivacyTests(unittest.TestCase):
    """#62 acceptance criterion 4: new collection reflected on the policy."""

    BUILT = "2026-08-21T00:00:00Z"

    def _render(self):
        return build.render_privacy_html(self.BUILT)

    def test_policy_discloses_hosted_cookieless_counter(self):
        low = self._render().lower()
        self.assertIn("goatcounter", low)
        self.assertIn("no cookies", low)

    def test_policy_states_aggregate_public_display(self):
        page = self._render()
        self.assertIn("anonymous aggregate totals", page)

    def test_policy_lists_goatcounter_as_processor_when_enabled(self):
        page = self._render()
        self.assertIn("goatcounter.com/privacy", page)

    def test_summary_bullet_names_live_traffic_counter(self):
        page = self._render()
        start = page.index('id="privacy-summary"')
        seg = page[start : page.index("</ul>", start)]
        self.assertIn("live traffic counter", seg)

    def test_new_section_labelled_single_heading_per_section(self):
        page = self._render()
        self.assertIn('id="privacy-live-traffic"', page)
        self.assertEqual(page.count("<h2"), page.count("</section>"))

    def test_blocking_counter_changes_nothing_else(self):
        page = self._render().lower()
        self.assertIn("blocking the counter", page)
        self.assertIn("keep working exactly the same", page)


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
        self.assertEqual(page.count("data-ft-category="), len(build.CATEGORIES) + 1)

    def test_all_chip_pressed_others_not(self):
        page = self._page()
        all_chip = page[page.index('data-ft-category=""') :]
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
        self.assertIn("<button", page[max(0, reset_pos - 80) : reset_pos])

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
        body = self.JS[parse_pos : self.JS.index("function ftSerializeState")]
        self.assertIn("indexOf(category) === -1", body)

    def test_and_combination_requires_both_category_and_query(self):
        matches = self.JS[self.JS.index("function ftMatches") :]
        category_check = matches.index('getAttribute("data-category")')
        query_check = matches.index("ftNormalize")
        self.assertLess(category_check, query_check)
        # Both checks must gate the same boolean result (early returns).
        self.assertIn("return false;", matches[:query_check])

    def test_filter_event_carries_category_only(self):
        self.assertIn('"filter_use", { category:', self.JS)

    def test_search_event_carries_query_length_never_raw_query(self):
        self.assertIn('"search", { query_length: state.q.length }', self.JS)
        track_call = self.JS[self.JS.index("function commit") :]
        self.assertNotIn("q: ", track_call[track_call.index("ftTrack") :])
        self.assertNotIn("search_term", self.JS)

    def test_events_dispatch_guarded_for_absent_analytics(self):
        self.assertIn('typeof window.ftTrackEvent === "function"', self.JS)

    def test_deep_link_restore_runs_without_committing_history_or_events(self):
        init_body = self.JS[self.JS.index("function ftInitApp") :]
        restore = init_body.rindex("apply(); // deep-link restore")
        self.assertNotIn("commit(", init_body[restore:])
        popstate = init_body[init_body.index('addEventListener("popstate"') :]
        self.assertIn("apply(); // restore view", popstate)

    def test_no_dialog_wiring_ships_in_site_script(self):
        # #60: detail affordances are plain navigational links; every
        # scripted dialog hook was removed with them.
        for marker in (
            "ftOpenDetail",
            "data-ft-detail",
            "showModal",
            "offer_details_open",
            'getElementById("ft-detail-',
        ):
            self.assertNotIn(marker, self.JS)


class FilterEventGateTests(unittest.TestCase):
    """/#13,#14: filter/search events ride the consent-gated event bus."""

    MID = "G-ABCDEF12345"

    def test_analytics_init_exposes_consent_gated_ft_track_event(self):
        init = build.build_analytics_init(self.MID)
        self.assertIn("var TRACKING_ACTIVE = false;", init)
        self.assertIn("function ftTrackEvent(name, params)", init)
        self.assertIn("window.ftTrackEvent = ftTrackEvent;", init)
        gate = init.index("function ftTrackEvent")
        body = init[gate : init.index("}", init.index("!TRACKING_ACTIVE"))]
        self.assertIn("!TRACKING_ACTIVE", body)

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
            init[decline : decline + 120],
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


class DetailPageTests(unittest.TestCase):
    """#60: every offer emits a dedicated page at site/offers/<slug>.html."""

    def _build(self, offers_by_name, details_by_slug=None):
        """Run build.main over a temp offers dir; return the site Path."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        offers_dir = os.path.join(tmp.name, "offers")
        os.makedirs(offers_dir)
        for name, text in offers_by_name.items():
            Path(offers_dir, f"{name}.yaml").write_text(text, encoding="utf-8")
        for slug, payload in (details_by_slug or {}).items():
            details_dir = os.path.join(offers_dir, "details")
            os.makedirs(details_dir, exist_ok=True)
            Path(details_dir, f"{slug}.json").write_text(
                json.dumps(payload), encoding="utf-8"
            )
        out = os.path.join(tmp.name, "out")
        code = build.main(["--offers-dir", offers_dir, "--out", out])
        self.assertEqual(code, 0)
        return Path(out, "site")

    def _two_offer_site(self, details=None):
        return self._build(
            {"alpha": offer_text(), "beta": offer_text(title="Beta", category="image")},
            details,
        )

    # --- emission ------------------------------------------------------------

    def test_main_emits_one_page_per_offer(self):
        site = self._two_offer_site()
        for slug in ("alpha", "beta"):
            page = (site / "offers" / f"{slug}.html").read_text(encoding="utf-8")
            self.assertIn("Free AI Credits", page)
            self.assertIn("<article", page)

    def test_every_offer_slug_yields_its_named_page(self):
        offers = {
            "alpha": offer_text(),
            "beta-two": offer_text(title="Beta Two", category="coding"),
            "gamma-3": offer_text(title="Gamma 3", category="image"),
        }
        site = self._build(offers)
        for slug in offers:
            page = (site / "offers" / f"{slug}.html").read_text(encoding="utf-8")
            self.assertIn(offers[slug].split("title: ")[1].split("\n")[0], page)

    def test_expired_offers_get_pages_too(self):
        expired = offer_text(
            title="Expired Offer",
            expiry_date=(dt.date.today() - dt.timedelta(days=1)).isoformat(),
        )
        site = self._build({"live": offer_text(), "expired": expired})
        page = (site / "offers" / "expired.html").read_text(encoding="utf-8")
        self.assertIn("Expired Offer", page)
        self.assertIn('<span class="badge badge-expired">Expired</span>', page)
        self.assertNotIn('class="od-cta"', page)
        self.assertIn("nothing here is claimable anymore", page)
        live_page = (site / "offers" / "live.html").read_text(encoding="utf-8")
        self.assertIn('class="od-cta"', live_page)
        self.assertNotIn('<span class="badge badge-expired">Expired</span>', live_page)

    # --- content parity -------------------------------------------------------

    def test_page_carries_card_and_dialog_content(self):
        site = self._two_offer_site(
            {
                "alpha": {
                    "summary": "Longer description here.",
                    "claim_steps": ["Sign up.", "Claim credits."],
                    "social_proof": [
                        {
                            "type": "x",
                            "url": "https://x.com/dev/status/1",
                            "author": "Dev One",
                            "handle": "@devone",
                            "text": "Loving this free tier!",
                        }
                    ],
                }
            }
        )
        page = (site / "offers" / "alpha.html").read_text(encoding="utf-8")
        start = page.index('class="offer-detail"')
        seg = page[start : page.index("</article>", start)]
        self.assertIn("$10 in credits", seg)
        self.assertIn("<h2>How to claim</h2>", seg)
        self.assertIn("<ol><li>Sign up.</li><li>Claim credits.</li></ol>", seg)
        self.assertIn("Longer description here.", seg)
        self.assertIn('<section class="od-proof"><h2>Social proof</h2>', seg)
        self.assertIn("@devone", seg)
        self.assertIn("View post on X", seg)

    def test_page_header_carries_core_fields_and_status(self):
        site = self._build(
            {
                "alpha": offer_text(
                    title="Header Me",
                    category="voice",
                    expiry_date="2026-12-31",
                )
            },
            {"alpha": {"summary": "Summary blurb."}},
        )
        page = (site / "offers" / "alpha.html").read_text(encoding="utf-8")
        header = page[page.index("<header") : page.index("</header>")]
        self.assertEqual(header.count("<h1>"), 1)
        self.assertIn("<h1>Header Me</h1>", header)
        self.assertIn("Test Provider", header)
        self.assertIn(
            f'hand-verified on <time datetime="{VALID["verified_date"]}">', header
        )
        self.assertIn('<time datetime="2026-12-31">Dec 31, 2026</time>', header)

    def test_page_without_detail_file_falls_back_like_dialogs_did(self):
        site = self._two_offer_site({"beta": {"summary": "Only beta has detail."}})
        page = (site / "offers" / "alpha.html").read_text(encoding="utf-8")
        self.assertIn("Open the official offer page.", page)
        self.assertIn("How to claim</h2>", page)
        self.assertNotIn("Social proof", page)
        beta = (site / "offers" / "beta.html").read_text(encoding="utf-8")
        self.assertIn("Only beta has detail.", beta)

    def test_cta_link_points_at_source_and_opens_new_tab(self):
        site = self._two_offer_site()
        page = (site / "offers" / "alpha.html").read_text(encoding="utf-8")
        self.assertIn(
            '<a class="od-cta" href="https://example.com/offer"'
            ' target="_blank" rel="noopener noreferrer">Claim at Test Provider',
            page,
        )

    def test_screenshot_proof_renders_lazy_figure_on_page(self):
        site = self._two_offer_site(
            {
                "alpha": {
                    "social_proof": [
                        {
                            "type": "screenshot",
                            "image": "assets/shots/pricing.png",
                            "caption": "Pricing table showing $0 plan",
                        }
                    ]
                }
            }
        )
        page = (site / "offers" / "alpha.html").read_text(encoding="utf-8")
        self.assertIn('src="../assets/shots/pricing.png"', page)
        self.assertIn('loading="lazy"', page)

    def test_screenshot_src_leaves_absolute_and_external_paths_alone(self):
        # Schema validation only admits site-relative image paths, so the
        # escape guards are exercised directly on the resolver.
        self.assertEqual(
            build._resolve_asset("shots/local.png", "../"),
            "../shots/local.png",
        )
        self.assertEqual(
            build._resolve_asset("../shots/up.png", "../"), "../shots/up.png"
        )
        self.assertEqual(
            build._resolve_asset("./shots/here.png", "../"),
            "./shots/here.png",
        )
        self.assertEqual(
            build._resolve_asset("/abs/shots/x.png", "../"),
            "/abs/shots/x.png",
        )
        self.assertEqual(
            build._resolve_asset("https://example.com/s.png", "../"),
            "https://example.com/s.png",
        )
        self.assertEqual(
            build._resolve_asset("shots/root-page.png", ""), "shots/root-page.png"
        )

    def test_reddit_and_link_proofs_render_embed_style_cards(self):
        site = self._two_offer_site(
            {
                "alpha": {
                    "social_proof": [
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
        )
        page = (site / "offers" / "alpha.html").read_text(encoding="utf-8")
        self.assertIn('class="proof-card proof-reddit"', page)
        self.assertIn("r/AI", page)
        self.assertIn("View on Reddit", page)
        self.assertIn("<strong>Big launch post</strong>", page)
        self.assertIn("Open source", page)
        proof_seg = page[
            page.index('<section class="od-proof">') : page.index('<a class="od-cta"')
        ]
        self.assertEqual(
            proof_seg.count('rel="noopener noreferrer"'),
            proof_seg.count("proof-card"),
        )

    def test_page_escapes_hostile_content(self):
        site = self._build(
            {"alpha": offer_text(title="Bad <script>alert(1)</script>")},
            {
                "alpha": {
                    "summary": "<script>evil()</script>",
                    "social_proof": [
                        {
                            "type": "x",
                            "url": 'https://x.com/h/status/9"><script>',
                            "author": "<img src=x onerror=alert(1)>",
                            "text": '"quoted" & <b>bold</b>',
                        }
                    ],
                }
            },
        )
        page = (site / "offers" / "alpha.html").read_text(encoding="utf-8")
        self.assertNotIn("<script>alert(1)</script>", page)
        self.assertNotIn("onerror=alert(1)>", page.replace("&quot;", '"'))
        self.assertIn("&lt;script&gt;", page)
        self.assertIn("&quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;", page)

    # --- depth-correct chrome --------------------------------------------------

    def test_offer_page_chrome_climbs_one_level(self):
        site = self._two_offer_site()
        page = (site / "offers" / "alpha.html").read_text(encoding="utf-8")
        for marker in (
            '<link rel="icon" type="image/svg+xml" href="../favicon.svg">',
            '<a href="../">Offers</a>',
            '<a href="../archive.html">Archive</a>',
            '<a href="../privacy.html">Privacy policy</a>',
            '<a href="../feed.xml">RSS</a>',
            'href="../feed.xml">',
            'href="../">',
        ):
            self.assertIn(marker, page)
        # No absolute-root hrefs may leak onto subdirectory pages (GitHub
        # Pages serves this under /<repo>/); external https anchors excepted.
        self.assertNotIn(
            'href="/',
            page.replace('href="https://fonts', "").replace('href="https://x.com', ""),
        )

    def test_root_pages_keep_shallow_chrome(self):
        site = self._two_offer_site()
        index = (site / "index.html").read_text(encoding="utf-8")
        archive = (site / "archive.html").read_text(encoding="utf-8")
        privacy = (site / "privacy.html").read_text(encoding="utf-8")
        for page in (index, archive, privacy):
            self.assertIn(
                '<link rel="icon" type="image/svg+xml" href="./favicon.svg">', page
            )
            self.assertIn('href="feed.xml">', page)
        self.assertIn('<a href="./" aria-current="page">Offers</a>', index)
        self.assertNotIn('href="/favicon', index)

    # --- link consistency across index/archive/feed -----------------------------

    def test_index_cards_link_to_each_offer_page(self):
        site = self._two_offer_site()
        index = (site / "index.html").read_text(encoding="utf-8")
        for slug in ("alpha", "beta"):
            self.assertEqual(index.count(f'href="offers/{slug}.html"'), 1)
        self.assertNotIn("data-ft-detail", index)
        self.assertNotIn("<dialog", index)

    def test_archive_rows_link_to_expired_offer_pages(self):
        expired = offer_text(
            title="Expired Offer",
            expiry_date=(dt.date.today() - dt.timedelta(days=1)).isoformat(),
        )
        site = self._build({"live": offer_text(), "expired": expired})
        archive = (site / "archive.html").read_text(encoding="utf-8")
        self.assertIn('href="offers/expired.html"', archive)
        self.assertTrue((site / "offers" / "expired.html").is_file())

    def test_feed_items_link_to_detail_pages(self):
        site = self._two_offer_site()
        feed = (site / "feed.xml").read_text(encoding="utf-8")
        base = build.DEFAULT_BASE_URL
        for slug in ("alpha", "beta"):
            expected = f"<link>{base}/offers/{slug}.html</link>"
            self.assertIn(expected, feed)
            self.assertIn(
                f'<guid isPermaLink="true">{base}/offers/{slug}.html</guid>', feed
            )
        self.assertNotIn("#offer-", feed)

    # --- no dialog machinery anywhere --------------------------------------------

    def test_dialog_machinery_gone_from_all_outputs(self):
        site = self._two_offer_site({"alpha": {"summary": "s"}})
        pages = [
            (site / "index.html").read_text(encoding="utf-8"),
            (site / "archive.html").read_text(encoding="utf-8"),
            (site / "privacy.html").read_text(encoding="utf-8"),
            (site / "offers" / "alpha.html").read_text(encoding="utf-8"),
        ]
        for page in pages:
            for marker in ("<dialog", "data-ft-detail", "ftOpenDetail", "showModal"):
                self.assertNotIn(marker, page)

    def test_offer_pages_never_mark_site_nav_current(self):
        site = self._two_offer_site()
        page = (site / "offers" / "alpha.html").read_text(encoding="utf-8")
        # The stylesheet mentions the [aria-current] selector; no link on a
        # detail page may actually carry the attribute.
        self.assertNotRegex(page, r'href="[^"]*" aria-current="page"')

    def test_committed_site_ships_one_page_per_seed_offer(self):
        offers = build.load_offers(str(REPO / "offers"))
        for offer in offers:
            path = REPO / "site" / "offers" / f"{offer['slug']}.html"
            self.assertTrue(path.is_file(), offer["slug"])
            page = path.read_text(encoding="utf-8")
            self.assertIn(f"<h1>{offer['title']}</h1>", page)


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

    def _run(
        self,
        steps,
        cards=None,
        init_search="",
        track_enabled=True,
        track_mode="record",
        stats_site="",
        stats_mode="none",
        stats_payloads=None,
    ):
        page_script = build.build_app_js(stats_site)
        bare = page_script[page_script.index(">") + 1 : page_script.rindex("</script>")]
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(bare)
            app_path = fh.name
        self.addCleanup(os.unlink, app_path)
        scenario = {
            "app": app_path,
            "cards": cards
            or [
                {
                    "slug": "alpha",
                    "category": "image",
                    "text": "Alpha Studio Image Google",
                },
                {
                    "slug": "copilot",
                    "category": "coding",
                    "text": "Copilot Coding GitHub",
                },
                {
                    "slug": "mistral",
                    "category": "api_provider",
                    "text": "Mistral API Provider",
                },
            ],
            "init_search": init_search,
            "track_enabled": track_enabled,
            "track_mode": track_mode,
            "valid_categories": list(build.CATEGORIES),
            "stats_mode": stats_mode,
            "stats_payloads": stats_payloads or {},
            "steps": steps,
        }
        proc = subprocess.run(
            ["node", str(self.HARNESS)],
            input=json.dumps(scenario),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(proc.returncode, 0, f"harness failed: {proc.stderr}")
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
        self.assertEqual(after_image["events"], [["filter_use", {"category": "image"}]])
        final = snaps[2]  # All resets
        self.assertEqual(final["historyUrls"][-1], "/")
        self.assertEqual(final["pressed"]["all"], "true")
        self.assertEqual([e[0] for e in final["events"]], ["filter_use", "filter_use"])
        self.assertEqual(final["events"][-1], ["filter_use", {"category": "all"}])

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
        self.assertEqual(restored["events"], [["filter_use", {"category": "coding"}]])
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
        self.assertEqual(final["historyUrls"], ["?category=image", "/"])
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
            "slug": "old",
            "category": "coding",
            "text": "Old Coding",
            "verified": "2026-01-01",
            "expiry": "2026-09-30",
            "amount_sort": "80",
        },
        {
            "slug": "new",
            "category": "image",
            "text": "New Image",
            "verified": "2026-08-21",
            "expiry": "",
            "amount_sort": "300",
        },
        {
            "slug": "mid",
            "category": "api_provider",
            "text": "Mid API",
            "verified": "2026-05-05",
            "expiry": "2026-08-25",
            "amount_sort": "10000",
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
        self.assertEqual(final["events"], [["sort_use", {"sort_option": "expiring"}]])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_newest_sorts_verified_date_descending(self):
        snaps = self._run(
            [{"op": "set_sort", "value": "newest"}], cards=self.SORT_CARDS
        )
        final = snaps[-1]
        self.assertEqual(final["visible"], ["new", "mid", "old"])
        self.assertEqual(final["events"], [["sort_use", {"sort_option": "newest"}]])

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
        self.assertEqual(final["events"], [["sort_use", {"sort_option": "expiring"}]])

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
        snaps = self._run([{"op": "perf_sort", "value": "expiring"}], cards=many_cards)
        final = snaps[-1]
        self.assertLess(final["perf_ms"], 200)
        ongoing_last = [
            s for s in final["visible"] if not many_cards[int(s[-2:])]["expiry"]
        ]
        self.assertEqual(ongoing_last, final["visible"][-5:])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_offer_click_fires_once_with_matching_params(self):
        cards = [
            {
                "slug": "copilot",
                "category": "coding",
                "provider": "GitHub",
                "text": "Copilot Coding GitHub",
            },
        ]
        snaps = self._run([{"op": "click_offer", "value": "copilot"}], cards=cards)
        final = snaps[-1]
        self.assertEqual(
            final["events"],
            [
                [
                    "offer_click",
                    {
                        "offer_id": "copilot",
                        "provider": "GitHub",
                        "category": "coding",
                    },
                ]
            ],
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
    def test_detail_affordance_is_plain_navigation_never_scripted(self):
        # #60: the card's detail affordance is a plain link to the offer's
        # page. Clicking it must produce zero events and never preventDefault
        # — navigation stays fully native.
        snaps = self._run([{"op": "click_detail_link", "value": "copilot"}])
        final = snaps[-1]
        self.assertEqual(final["detailLinks"]["copilot"], "offers/copilot.html")
        self.assertEqual(final["events"], [])
        self.assertEqual(final["preventDefaults"], 0)

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_every_card_ships_a_navigational_detail_link(self):
        snaps = self._run([])
        final = snaps[-1]
        self.assertEqual(
            final["detailLinks"],
            {
                "alpha": "offers/alpha.html",
                "copilot": "offers/copilot.html",
                "mistral": "offers/mistral.html",
            },
        )

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
        snaps = self._run([{"op": "perf_type_settle", "value": "zz499"}], cards=cards)
        perf = snaps[-1]["perf_ms"]
        self.assertLess(perf, 200, f"settle took {perf}ms over 500 offers")
        self.assertEqual(snaps[-1]["visible"], ["offer-0499"])

    # --- live traffic strip (#62) --------------------------------------------

    SITE = "https://gc.example.com"

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_traffic_success_fills_and_reveals_strip(self):
        snaps = self._run(
            [
                {"op": "settle"},
                {"op": "snapshot"},
            ],
            stats_site=self.SITE,
            stats_mode="ok",
            stats_payloads={"today": {"count": "8"}, "period": {"count": "321"}},
        )
        final = snaps[-1]
        self.assertFalse(final["trafficHidden"])
        self.assertEqual(final["trafficToday"], "8")
        self.assertEqual(final["trafficPeriod"], "321")
        # The strip is display-only: no analytics events, no history churn.
        self.assertEqual(final["events"], [])
        self.assertEqual(final["historyUrls"], [])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_traffic_counts_get_thousands_separators(self):
        final = self._run(
            [{"op": "settle"}],
            stats_site=self.SITE,
            stats_mode="ok",
            stats_payloads={
                "today": {"count": "1,234"},
                "period": {"count": "1,234,567"},
            },
        )[-1]
        self.assertEqual(final["trafficToday"], "1,234")
        self.assertEqual(final["trafficPeriod"], "1,234,567")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_traffic_empty_data_renders_zeros_gracefully(self):
        # A brand-new deployment returns zeroed totals; that must still
        # reveal the strip with honest zeros rather than staying hidden.
        final = self._run(
            [{"op": "settle"}],
            stats_site=self.SITE,
            stats_mode="ok",
            stats_payloads={"today": {"count": "0"}, "period": {"count": "0"}},
        )[-1]
        self.assertFalse(final["trafficHidden"])
        self.assertEqual(final["trafficToday"], "0")
        self.assertEqual(final["trafficPeriod"], "0")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_traffic_http_error_leaves_strip_inert(self):
        final = self._run(
            [{"op": "settle"}, {"op": "snapshot"}],
            stats_site=self.SITE,
            stats_mode="http_error",
        )[-1]
        self.assertTrue(final["trafficHidden"])
        self.assertEqual(final["trafficToday"], "\u2014")
        self.assertEqual(final["trafficPeriod"], "\u2014")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_traffic_network_rejection_leaves_strip_inert(self):
        final = self._run(
            [{"op": "settle"}, {"op": "snapshot"}],
            stats_site=self.SITE,
            stats_mode="network_error",
        )[-1]
        self.assertTrue(final["trafficHidden"])
        self.assertEqual(final["trafficToday"], "\u2014")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_traffic_malformed_payload_leaves_strip_inert(self):
        # A string where a number belongs means "no trustworthy data".
        final = self._run(
            [{"op": "settle"}, {"op": "snapshot"}],
            stats_site=self.SITE,
            stats_mode="ok",
            stats_payloads={"today": {"count": "many"}, "period": {"count": "5"}},
        )[-1]
        self.assertTrue(final["trafficHidden"])
        self.assertEqual(final["trafficPeriod"], "\u2014")

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_traffic_bad_json_leaves_strip_inert(self):
        final = self._run(
            [{"op": "settle"}, {"op": "snapshot"}],
            stats_site=self.SITE,
            stats_mode="bad_json",
        )[-1]
        self.assertTrue(final["trafficHidden"])

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_traffic_absent_fetch_api_is_silent_no_op(self):
        # Script configured but fetch missing (old browsers, hardened VMs):
        # the guard must bail before any call and the page keeps working.
        snaps = self._run(
            [
                {"op": "click_chip", "value": "image"},
                {"op": "settle"},
                {"op": "snapshot"},
            ],
            stats_site=self.SITE,
            stats_mode="none",
        )
        final = snaps[-1]
        self.assertTrue(final["trafficHidden"])
        self.assertEqual(final["visible"], ["alpha"])  # filtering unaffected

    @unittest.skipUnless(HAS_NODE, "node runtime unavailable")
    def test_unconfigured_script_never_touches_strip_slots(self):
        final = self._run([{"op": "settle"}, {"op": "snapshot"}])[-1]
        self.assertTrue(final["trafficHidden"])
        self.assertEqual(final["trafficToday"], "\u2014")


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
                os.environ.pop(build.STATS_SITE_ENV_VAR, None)
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


class StatsBuildOutputTests(unittest.TestCase):
    """End-to-end: live traffic assets are emitted exactly when configured."""

    SITE = "https://gc.example.com"

    def _write_offers(self, tmp):
        offers_dir = os.path.join(tmp, "offers")
        os.makedirs(offers_dir)
        Path(offers_dir, "alpha.yaml").write_text(offer_text(), encoding="utf-8")
        return offers_dir

    def _build(self, tmp, env):
        offers_dir = self._write_offers(tmp)
        out = os.path.join(tmp, "out")
        err = io.StringIO()
        # clear=True: CI exports GOATCOUNTER_SITE_URL into the step env, so
        # merging over os.environ would leak the real secret into builds
        # this test expects to be unconfigured.
        with mock.patch.dict(os.environ, env, clear=True), redirect_stderr(err):
            code = build.main(["--offers-dir", offers_dir, "--out", out])
        self.assertEqual(code, 0)
        return out, err.getvalue()

    def test_main_with_stats_emits_beacon_and_home_strip_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, _ = self._build(
                tmp,
                {build.STATS_SITE_ENV_VAR: self.SITE},
            )
            home = Path(out, "site", "index.html").read_text(encoding="utf-8")
            self.assertIn('"https://gc.zgo.at/count.js"', home)
            self.assertIn('id="ft-traffic"', home)
            for name in ("privacy.html", "archive.html"):
                page = Path(out, "site", name).read_text(encoding="utf-8")
                with self.subTest(page=name):
                    self.assertIn('"https://gc.zgo.at/count.js"', page)
                    self.assertNotIn('id="ft-traffic"', page)
            detail = Path(out, "site", "offers", "alpha.html").read_text(
                encoding="utf-8"
            )
            self.assertIn('"https://gc.zgo.at/count.js"', detail)
            self.assertNotIn('id="ft-traffic"', detail)

    def test_main_without_stats_emits_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, _ = self._build(tmp, {})
            for name in ("index.html", "privacy.html", "archive.html"):
                page = Path(out, "site", name).read_text(encoding="utf-8")
                with self.subTest(page=name):
                    self.assertNotIn("count.js", page)
                    self.assertNotIn("ft-traffic", page)

    def test_malformed_stats_env_never_breaks_the_build(self):
        # A typo in a secret must degrade silently, not fail CI.
        with tempfile.TemporaryDirectory() as tmp:
            out, warnings = self._build(
                tmp,
                {build.STATS_SITE_ENV_VAR: "not-a-url"},
            )
            self.assertIn("traffic stats disabled", warnings)
            page = Path(out, "site", "index.html").read_text(encoding="utf-8")
            self.assertNotIn("count.js", page)


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
        self.assertIn("no counting code is loaded until permission", page)

    def test_policy_names_real_localstorage_key_and_no_own_cookies(self):
        page = self._render()
        self.assertIn(build.CONSENT_STORAGE_KEY, page)
        self.assertIn("sets no cookies of its own", page)

    def test_policy_describes_all_visitor_banner_and_change_of_mind(self):
        # #72: the banner is universal, and consent is revisitable.
        page = self._render()
        self.assertIn("Every first-time visitor sees a small banner", page)
        self.assertIn("Cookie settings", page)
        self.assertNotIn("time zone indicates they are likely in the EU", page)
        self.assertNotIn("counted without showing the banner", page)

    def test_policy_covers_share_event(self):
        self.assertIn("share button", self._render())

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
        self.assertIn('href="https://policies.google.com/privacy"', page)
        self.assertIn("Google Fonts", page)
        self.assertIn("privacy policy applies, not this one", page.lower())

    def test_policy_offers_block_and_still_works_choice(self):
        page = self._render()
        self.assertRegex(page, r"[Bb]lock everything")
        self.assertIn("keeps working exactly the same", page)

    def test_policy_has_contact_path(self):
        page = self._render()
        self.assertIn('href="https://github.com/luongnv89/freetokens/issues"', page)

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
        self.assertIn("--gray: #6b7280;", page)


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
                self.assertRegex(page, r'<meta name="description" content="[^"]{10,}"')

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
        coarse_block = home[home.index("@media (pointer: coarse)") :]
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


class RelativeDateTests(unittest.TestCase):
    """The listing shows verification age, computed against the build date."""

    TODAY = dt.date(2026, 8, 23)

    def test_same_day_and_future_read_as_today(self):
        self.assertEqual(build._relative_date("2026-08-23", self.TODAY), "today")
        # A verified_date ahead of the build clock must not render "-2d ago".
        self.assertEqual(build._relative_date("2026-08-25", self.TODAY), "today")

    def test_day_and_week_buckets_inside_the_relative_window(self):
        cases = {
            "2026-08-22": "yesterday",
            "2026-08-20": "3d ago",
            "2026-08-16": "1w ago",
            "2026-08-11": "1w ago",
        }
        for iso, expected in cases.items():
            with self.subTest(iso=iso):
                self.assertEqual(build._relative_date(iso, self.TODAY), expected)

    def test_stale_dates_fall_back_to_the_absolute_date(self):
        # A build that has not run in weeks must not keep claiming an offer
        # was verified "1mo ago" — past the window the reader gets the date
        # and judges staleness themselves.
        cases = {
            "2026-08-09": "Aug 9, 2026",   # exactly RELATIVE_DATE_MAX_DAYS
            "2026-07-20": "Jul 20, 2026",
            "2025-08-23": "Aug 23, 2025",
        }
        for iso, expected in cases.items():
            with self.subTest(iso=iso):
                self.assertEqual(build._relative_date(iso, self.TODAY), expected)

    def test_relative_window_boundary_is_exact(self):
        edge = self.TODAY - dt.timedelta(days=build.RELATIVE_DATE_MAX_DAYS - 1)
        self.assertEqual(build._relative_date(edge.isoformat(), self.TODAY), "1w ago")
        past = self.TODAY - dt.timedelta(days=build.RELATIVE_DATE_MAX_DAYS)
        self.assertEqual(
            build._relative_date(past.isoformat(), self.TODAY),
            build._human_date(past.isoformat()),
        )

    def test_malformed_input_degrades_to_the_raw_string(self):
        self.assertEqual(build._relative_date("not-a-date", self.TODAY), "not-a-date")
        self.assertEqual(build._relative_date("", self.TODAY), "")

    def test_build_date_comes_from_generated_at_not_the_wall_clock(self):
        self.assertEqual(
            build._build_date("2026-08-23T18:39:18Z"), dt.date(2026, 8, 23)
        )

    def test_build_date_falls_back_when_generated_at_is_unusable(self):
        self.assertIsInstance(build._build_date("garbage"), dt.date)


class HomeListingTests(unittest.TestCase):
    """#89: the home page renders ranked rows, not the card grid."""

    def _page(self, n=3, **overrides):
        offers = []
        for i in range(n):
            offer = build.validate_offer(
                dict(VALID, title=f"Offer {i}", **overrides), "a.yaml"
            )
            offer.setdefault("slug", f"offer-{i}")
            offers.append(offer)
        return build.render_html(build.build_index(offers))

    def test_rank_is_a_css_counter_not_baked_into_markup(self):
        # Baked-in numbers would go stale the moment a filter or re-sort ran;
        # the counter is what makes a filtered list read 1..n on its own.
        page = self._page()
        self.assertIn("counter-reset: ftrank;", page)
        self.assertIn("counter-increment: ftrank;", page)
        self.assertIn('content: counter(ftrank) ".";', page)

    def test_hidden_rows_are_hidden_despite_the_id_scoped_display_rule(self):
        # #ft-grid > li sets `display: grid`, which out-specifies the shared
        # `.grid li[hidden]` rule from _APP_CSS. Without an id-scoped hide
        # rule, filtering would stop hiding anything.
        page = self._page()
        self.assertIn("#ft-grid > li[hidden] { display: none; }", page)
        app_css_pos = page.index(".grid li[hidden]")
        home_css_pos = page.index("#ft-grid > li[hidden]")
        self.assertLess(app_css_pos, home_css_pos, "home CSS must win the cascade")

    def test_amount_wraps_so_prose_amounts_cannot_force_page_scroll(self):
        # Several real offers put a full eligibility sentence in `amount`.
        page = self._page(amount="Legacy accounts only: 5M chars/month " * 4)
        amount_css = page[page.index(".r-amount {") : page.index(".r-amount {") + 220]
        self.assertNotIn("white-space: nowrap", amount_css)
        self.assertIn("overflow-wrap: anywhere", amount_css)

    def test_row_shows_amount_provider_category_expiry_verified_and_details(self):
        page = self._page(n=1, amount="$50 credit", provider="Alpha AI")
        row = page[page.index('<li style="--i:0">') : page.index("</li>")]
        self.assertIn('<span class="r-amount">$50 credit</span>', row)
        self.assertIn('<span class="badge">api_provider</span>', row)
        self.assertIn('<span class="r-prov">Alpha AI</span>', row)
        self.assertIn("verified <time", row)
        self.assertIn('<a class="r-details" href="offers/offer-0.html">details</a>', row)

    def test_verified_cell_carries_both_relative_text_and_exact_date(self):
        page = self._page(n=1)
        self.assertIn(f'title="verified {build._human_date(VALID["verified_date"])}"', page)
        self.assertIn(f'<time datetime="{VALID["verified_date"]}">', page)

    def test_listing_fades_as_one_block_instead_of_staggering_32_rows(self):
        page = self._page()
        self.assertIn("#ft-grid .card { animation: none; }", page)
        self.assertIn("#ft-grid { animation: rise", page)

    def test_home_row_styles_never_reach_the_archive(self):
        # The archive keeps the card vocabulary; its grid has a different id,
        # and _HOME_CSS is home-only, so none of it may ship there.
        expired = build.validate_offer(dict(VALID, expiry_date="2020-01-01"), "a.yaml")
        expired.setdefault("slug", "old-offer")
        index = build.build_index([expired])
        archive = build.render_archive_html(index)
        self.assertIn('id="ft-archive-grid"', archive)
        for marker in ("#ft-grid", "counter-reset: ftrank", ".r-amount", ".row-meta"):
            with self.subTest(marker=marker):
                self.assertNotIn(marker, archive)

    def test_masthead_bar_styles_ship_even_with_zero_offers(self):
        index = {"generated_at": "2026-08-21T00:00:00Z", "count": 0, "offers": []}
        page = build.render_html(index)
        self.assertIn('class="masthead masthead-home"', page)
        self.assertIn(".masthead-home .bar {", page)


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


class RetainAndFlagTests(unittest.TestCase):
    """#25: expired offers stay in the index with a build-time status."""

    TODAY = dt.date(2026, 8, 22)

    def _offer(self, slug, expiry):
        return dict(
            build.validate_offer(
                dict(
                    VALID,
                    title=f"Offer {slug}",
                    expiry_date=expiry.isoformat() if expiry else None,
                ),
                "a.yaml",
            ),
            slug=slug,
        )

    def _index(self, expiries):
        return build.build_index(
            [self._offer(f"offer-{i}", e) for i, e in enumerate(expiries)],
            today=self.TODAY,
        )

    def test_expired_offer_retained_with_status_flag(self):
        index = self._index([self.TODAY - dt.timedelta(days=1)])
        self.assertEqual(index["count"], 1)
        self.assertEqual(index["expired_count"], 1)
        self.assertEqual(index["active_count"], 0)
        self.assertEqual(index["offers"][0]["status"], "expired")

    def test_null_expiry_is_active_regardless_of_build_date(self):
        for today in (
            dt.date(2026, 8, 22),
            dt.date(2030, 1, 1),
        ):
            with self.subTest(today=today):
                index = build.build_index([self._offer("ongoing", None)], today=today)
                self.assertEqual(index["offers"][0]["status"], "active")
                self.assertEqual(index["active_count"], 1)

    def test_expiry_today_still_active_expiry_yesterday_expired(self):
        index = self._index([self.TODAY, self.TODAY - dt.timedelta(days=1)])
        statuses = {o["slug"]: o["status"] for o in index["offers"]}
        self.assertEqual(statuses["offer-0"], "active")
        self.assertEqual(statuses["offer-1"], "expired")
        self.assertEqual((index["active_count"], index["expired_count"]), (1, 1))

    def test_future_expiry_is_active(self):
        index = self._index([self.TODAY + dt.timedelta(days=30)])
        self.assertEqual(index["offers"][0]["status"], "active")

    def test_home_page_never_renders_expired_entries(self):
        offer = self._offer("live", None)
        stale = self._offer("stale", self.TODAY - dt.timedelta(days=1))
        page = build.render_html(build.build_index([offer, stale], today=self.TODAY))
        self.assertIn("Offer live", page)
        self.assertNotIn("Offer stale", page)

    def test_render_treats_missing_status_as_active(self):
        # Indexes built before v2.0 carry no status field; their entries
        # must still render.
        legacy = {
            "generated_at": "2026-01-01T00:00:00Z",
            "count": 1,
            "offers": [
                {
                    "slug": "legacy",
                    "title": "Legacy Offer",
                    "provider": "P",
                    "category": "coding",
                    "amount": "$5",
                    "expiry_date": None,
                    "source_url": "https://example.com/x",
                    "verified_date": "2026-01-01",
                }
            ],
        }
        page = build.render_html(legacy)
        self.assertIn("Legacy Offer", page)


class ArchivePageTests(unittest.TestCase):
    """#26 / F11: static archive over expired entries with Expired badges."""

    TODAY = dt.date(2026, 8, 22)

    def _offer(self, slug, expiry, **overrides):
        if isinstance(expiry, dt.date):
            expiry = expiry.isoformat()
        return dict(
            build.validate_offer(
                dict(
                    VALID,
                    title=overrides.pop("title", f"Offer {slug}"),
                    expiry_date=expiry,
                    **overrides,
                ),
                "a.yaml",
            ),
            slug=slug,
        )

    def _render(self, offers):
        return build.render_archive_html(build.build_index(offers, today=self.TODAY))

    def _mixed_index(self):
        return [
            self._offer("old", "2026-07-01"),
            self._offer("mid", "2026-07-15", category="image", amount="$40 in credits"),
            self._offer("new", "2026-08-01"),
            self._offer("live", None),
            self._offer("fresh", "2026-12-25"),
        ]

    def test_only_expired_offers_render_newest_expiration_first(self):
        page = self._render(self._mixed_index())
        order = [page.index(f"Offer {slug}") for slug in ("new", "mid", "old")]
        self.assertEqual(order, sorted(order))
        self.assertNotIn("Offer live", page)
        self.assertNotIn("Offer fresh", page)

    def test_every_archived_card_carries_text_expired_badge(self):
        page = self._render(self._mixed_index())
        self.assertEqual(
            page.count('<span class="badge badge-expired">Expired</span>'), 3
        )
        self.assertIn(".badge-expired", page)  # styled, but text is the signal

    def test_card_shows_provider_amount_original_expiry_category_and_link(self):
        page = self._render(
            [
                self._offer(
                    "mid", "2026-07-15", category="image", amount="$40 in credits"
                )
            ]
        )
        card = page[page.index("<article") : page.index("</article>")]
        self.assertIn('href="https://example.com/offer"', card)
        self.assertIn('target="_blank"', card)
        self.assertIn('rel="noopener noreferrer"', card)
        self.assertIn("$40 in credits", card)
        self.assertIn('<span class="badge">image</span>', card)
        self.assertIn("Test Provider", card)
        self.assertIn('<time datetime="2026-07-15">Jul 15, 2026</time>', card)
        self.assertIn("expired <time", card)

    def test_zero_expired_offers_render_friendly_empty_state(self):
        page = self._render([self._offer("live", None)])
        self.assertIn("The archive is empty", page)
        self.assertNotIn("<article", page)
        self.assertIn('<a href="./">Browse the live offers</a>', page)

    def test_archive_linked_from_home_empty_state_and_footer(self):
        stale = self._offer("stale", self.TODAY - dt.timedelta(days=1))
        empty_home = build.render_html(build.build_index([stale], today=self.TODAY))
        home = build.render_html(
            build.build_index([self._offer("live", None)], today=self.TODAY)
        )
        archive = self._render([stale])
        self.assertIn('<a href="archive.html">browse the archive</a>', empty_home)
        self.assertIn('<a href="archive.html">Archive</a>', home)
        self.assertIn(">Archive</a>", archive)
        # The archive page marks itself current; home never does.
        self.assertRegex(archive, r'<a href="archive\.html" aria-current="page">')
        self.assertNotIn('aria-current="page">Archive', home)

    def test_archive_shares_chrome_and_320px_guards(self):
        page = self._render([self._offer("old", "2026-07-01")])
        self.assertIn(
            '<meta name="viewport" content="width=device-width, initial-scale=1">', page
        )
        self.assertIn("repeat(auto-fill, minmax(min(100%, 19rem), 1fr))", page)
        self.assertIn("padding: clamp(1.25rem, 4vw, 3rem)", page)
        self.assertIn("overflow-wrap", page)
        self.assertEqual(page.count("<h1>"), 1)
        self.assertIn("<footer", page)

    def test_main_writes_archive_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            Path(offers_dir, "live.yaml").write_text(offer_text(), encoding="utf-8")
            out = os.path.join(tmp, "out")
            code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            page = Path(out, "site", "archive.html").read_text(encoding="utf-8")
            self.assertIn("The archive is empty", page)


class FeedTests(unittest.TestCase):
    """#27 / F12: valid RSS 2.0 emitted at build time for active offers."""

    TODAY = dt.date(2026, 8, 22)
    BASE = "https://luongnv89.github.io/freetokens"

    def _offer(self, slug, expiry=None, verified="2026-08-21", **overrides):
        data = dict(VALID)
        data["title"] = overrides.pop("title", f"Offer {slug}")
        if isinstance(expiry, dt.date):
            expiry = expiry.isoformat()
        data["expiry_date"] = expiry
        data["verified_date"] = verified
        data.update(overrides)
        return dict(build.validate_offer(data, "a.yaml"), slug=slug)

    def _feed(self, offers):
        import xml.etree.ElementTree as ET

        xml_text = build.build_feed(
            build.build_index(offers, today=self.TODAY), self.BASE
        )
        root = ET.fromstring(xml_text)  # raises on malformed XML
        return xml_text, root

    def _channel(self, root):
        return root.find("channel")

    def test_feed_is_wellformed_rss_with_channel_metadata(self):
        _, root = self._feed([self._offer("a")])
        self.assertEqual(root.tag, "rss")
        self.assertEqual(root.get("version"), "2.0")
        channel = self._channel(root)
        self.assertEqual(channel.findtext("title"), build.FEED_TITLE)
        self.assertEqual(channel.findtext("link"), f"{self.BASE}/")
        self.assertTrue(channel.findtext("description"))
        self.assertEqual(channel.findtext("language"), "en")
        self.assertIsNotNone(channel.findtext("lastBuildDate"))

    def test_items_cover_active_offers_only(self):
        offers = [
            self._offer("live", None),
            self._offer("fresh", "2026-12-25"),
            self._offer("stale", "2026-08-01"),
        ]
        _, root = self._feed(offers)
        titles = [i.findtext("title") for i in self._channel(root).findall("item")]
        self.assertEqual(titles, ["Offer live", "Offer fresh"])
        self.assertNotIn("Offer stale", titles)

    def test_item_links_are_absolute_and_target_detail_page(self):
        _, root = self._feed([self._offer("copilot")])
        item = self._channel(root).find("item")
        expected = f"{self.BASE}/offers/copilot.html"
        self.assertEqual(item.findtext("link"), expected)
        guid = item.find("guid")
        self.assertEqual(guid.get("isPermaLink"), "true")
        self.assertEqual(guid.text, expected)

    def test_pubdate_is_rfc2822_from_verified_date(self):
        _, root = self._feed([self._offer("a", verified="2026-08-05")])
        pub = self._channel(root).find("item").findtext("pubDate")
        self.assertRegex(pub, r"^Wed, 0?5 Aug 2026 00:00:00 \+0000$")

    def test_items_ordered_newest_verified_first(self):
        offers = [
            self._offer("oldy", verified="2026-01-01"),
            self._offer("newie", verified="2026-08-20"),
            self._offer("middy", verified="2026-05-05"),
        ]
        _, root = self._feed(offers)
        titles = [i.findtext("title") for i in self._channel(root).findall("item")]
        self.assertEqual(titles, ["Offer newie", "Offer middy", "Offer oldy"])

    def test_description_summarizes_amount_category_expiry(self):
        _, root = self._feed(
            [
                self._offer(
                    "dated",
                    "2026-12-31",
                    verified="2026-08-20",
                    category="voice",
                    amount="$10 in credits",
                ),
                self._offer("ongoing"),
            ]
        )
        descriptions = {
            i.findtext("title"): i.findtext("description")
            for i in self._channel(root).findall("item")
        }
        self.assertEqual(
            descriptions["Offer dated"],
            "$10 in credits — Voice · expires Dec 31, 2026.",
        )
        self.assertEqual(
            descriptions["Offer ongoing"],
            "$10 in credits — API providers · ongoing.",
        )

    def test_hostile_titles_are_xml_escaped(self):
        text, _ = self._feed([self._offer("evil", title="Bad \"&'<title>")])
        self.assertNotIn(
            "Bad \"&'<title>", text.replace("&quot;", '"').replace("&apos;", "'")
        )
        self.assertIn("&lt;title&gt;", text)

    def test_base_url_override_strips_trailing_slash(self):
        xml_text = build.build_feed(
            build.build_index([self._offer("a")]), "https://example.com/site/"
        )
        self.assertIn("<link>https://example.com/site/</link>", xml_text)

    def test_atom_self_link_present_for_validator_recommendation(self):
        text, root = self._feed([self._offer("a")])
        self.assertIn("http://www.w3.org/2005/Atom", text)
        atom_links = [
            e
            for e in self._channel(root).findall("{http://www.w3.org/2005/Atom}link")
            if e.get("rel") == "self"
        ]
        self.assertEqual(len(atom_links), 1)
        self.assertEqual(atom_links[0].get("href"), f"{self.BASE}/feed.xml")

    def test_autodiscovery_and_footer_rss_on_every_generated_page(self):
        home = build.render_html(build.build_index([self._offer("a")]))
        privacy = build.render_privacy_html("2026-08-21T00:00:00Z")
        archive = build.render_archive_html(build.build_index([self._offer("a")]))
        for name, page in (("home", home), ("privacy", privacy), ("archive", archive)):
            with self.subTest(page=name):
                self.assertRegex(
                    page,
                    r'<link rel="alternate" type="application/rss\+xml"[^>]*href="feed\.xml">',
                )
                self.assertIn('<a href="feed.xml">RSS</a>', page)

    def test_feed_links_match_card_detail_links(self):
        page = build.render_html(build.build_index([self._offer("copilot")]))
        self.assertIn('href="offers/copilot.html"', page)

    def test_main_writes_feed_xml(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            Path(offers_dir, "a.yaml").write_text(offer_text(), encoding="utf-8")
            out = os.path.join(tmp, "out")
            code = build.main(["--offers-dir", offers_dir, "--out", out])
            self.assertEqual(code, 0)
            feed = Path(out, "site", "feed.xml").read_text(encoding="utf-8")
            import xml.etree.ElementTree as ET

            root = ET.fromstring(feed)
            self.assertEqual(root.get("version"), "2.0")
            self.assertEqual(len(self._channel(root).findall("item")), 1)


class ConsentForEveryoneTests(unittest.TestCase):
    """#72: universal banner, persistent change-of-mind, gated GoatCounter."""

    MID = "G-ABCDEF12345"
    SITE = "https://gc.example.com"

    def _index(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer.setdefault("slug", "offer-0")
        return build.build_index([offer])

    def _init(self):
        return build.build_analytics_init(self.MID)

    # --- banner is shown to every first-time visitor -------------------------

    def test_init_asks_every_first_time_visitor(self):
        init = self._init()
        seg = init[init.index("function ftInit") : init.index("function ftSchedule")]
        self.assertIn("ftShowBanner();", seg)
        # No time-zone branch and no silent auto-grant for the undecided.
        self.assertNotIn("ftIsEuTimeZone", init)
        granted_line = 'if (stored === "granted") { ftGrant(); return; }'
        self.assertEqual(seg.count("ftGrant()"), 1, seg)
        self.assertIn(granted_line, seg)

    def test_banner_markup_on_every_page_when_any_tracking_configured(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer["slug"] = "test-offer"
        index = build.build_index([offer])
        pages = {
            "home": build.render_html(index, measurement_id=self.MID),
            "detail": build.render_offer_html(
                index["offers"][0],
                None,
                index["generated_at"],
                measurement_id=self.MID,
            ),
            "stats-only home": build.render_html(index, stats_site=self.SITE),
            "privacy": build.render_privacy_html(
                "2026-08-21T00:00:00Z", measurement_id=self.MID
            ),
        }
        for name, page in pages.items():
            with self.subTest(page=name):
                self.assertIn('id="ft-consent-banner"', page)
                self.assertIn("ftShowBanner", page)

    # --- persistent change-of-mind entry point --------------------------------

    def test_cookie_settings_control_on_every_tracked_page(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer["slug"] = "test-offer"
        index = build.build_index([offer])
        pages = {
            "home": build.render_html(index, measurement_id=self.MID),
            "archive": build.render_archive_html(index, measurement_id=self.MID),
            "privacy": build.render_privacy_html(
                "2026-08-21T00:00:00Z", measurement_id=self.MID
            ),
            "detail": build.render_offer_html(
                index["offers"][0],
                None,
                index["generated_at"],
                measurement_id=self.MID,
            ),
        }
        for name, page in pages.items():
            with self.subTest(page=name):
                self.assertIn('id="ft-consent-settings"', page)
                self.assertIn(">Cookie settings</button>", page)

    def test_settings_button_wired_to_reopen_banner(self):
        init = self._init()
        wire = init.index("function ftWire")
        seg = init[wire : init.index("document.addEventListener", wire)]
        self.assertIn('"ft-consent-settings"', seg)
        self.assertIn("ftShowBanner();", seg)

    def test_settings_handler_never_rewires(self):
        # Regression: ftWire() inside the settings click handler stacked
        # duplicate listeners on every "Cookie settings" click.
        init = self._init()
        handler = init.index('"ft-consent-settings"')
        body = init[handler : init.index("document.addEventListener", handler)]
        self.assertNotIn("ftWire()", body)

    def test_stored_denial_still_wires_the_settings_control(self):
        init = self._init()
        seg = init[init.index("function ftInit") : init.index("function ftSchedule")]
        wire_pos = seg.index("ftWire();")
        denied_pos = seg.index('stored === "denied"')
        self.assertLess(wire_pos, denied_pos)

    def test_no_settings_control_when_tracking_unconfigured(self):
        page = build.render_html(self._index())
        self.assertNotIn("ft-consent-settings", page)
        self.assertNotIn("Cookie settings", page)
        self.assertNotIn("ft-consent-banner", page)

    # --- no non-essential tracking before consent ------------------------------

    def test_grant_event_wakes_consent_gated_beacon(self):
        init = self._init()
        grant = init.index("function ftGrant")
        seg = init[grant : init.index('gtag("consent", "update"', grant)]
        self.assertIn('dispatchEvent(new CustomEvent("ft-consent-granted"))', seg)
        beacon = build.build_stats_beacon(self.SITE)
        self.assertIn('addEventListener("ft-consent-granted", ftGcLoad)', beacon)

    def test_beacon_loader_checks_storage_before_injecting_tracker(self):
        beacon = build.build_stats_beacon(self.SITE)
        check = beacon.index('=== "granted"')
        inject = beacon.index("ftGcLoad();")
        self.assertLess(check, inject)

    def test_stats_only_builds_get_full_consent_runtime(self):
        index = self._index()
        page = build.render_html(index, stats_site=self.SITE)
        self.assertIn('var MEASUREMENT_ID = "";', page)
        self.assertIn("function ftTrackEvent(name, params)", page)
        self.assertIn('id="ft-consent-banner"', page)

    def test_track_event_bus_requires_measurement_id_and_active_flag(self):
        init = self._init()
        gate = init.index("function ftTrackEvent")
        body = init[gate : init.index("window.ftTrackEvent", gate)]
        self.assertIn("!TRACKING_ACTIVE", body)
        self.assertIn("MEASUREMENT_ID &&", body)


class OfferShareBarTests(unittest.TestCase):
    """#71: LinkedIn/X/Facebook/email + copy link on every detail page."""

    SLUG = "test-offer"

    def _offer(self, **overrides):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer["slug"] = self.SLUG
        offer.update(overrides)
        return offer

    def _page(self, offer=None, base_url=""):
        offer = offer or self._offer()
        index = build.build_index([offer])
        return build.render_offer_html(
            index["offers"][0],
            None,
            index["generated_at"],
            base_url=base_url,
        )

    def test_share_section_lists_all_five_channels(self):
        page = self._page()
        start = page.index('class="od-share"')
        seg = page[start : page.index("</section>", start)]
        for channel in ("linkedin", "x", "facebook", "email", "copy"):
            self.assertIn(f'data-ft-share="{channel}"', seg)
        for label in (">LinkedIn<", ">X<", ">Facebook<", ">Email<", "Copy link"):
            self.assertIn(label, seg)
        self.assertIn('aria-label="Share this offer"', seg)

    def test_external_share_links_are_hardened_new_tabs(self):
        import re as _re

        page = self._page()
        for match in _re.finditer(
            r'<a class="share-link" href="([^"]+)" target="_blank" '
            r'rel="noopener noreferrer"',
            page,
        ):
            href = match.group(1)
            self.assertTrue(href.startswith(("https://", "mailto:")), href)

    def test_share_links_prefill_absolute_page_url(self):
        custom = "https://pages.example.org/freetokens"
        page = self._page(base_url=custom)
        expected = quote(f"{custom}/offers/{self.SLUG}.html", safe="")
        # linkedin + x + facebook hrefs, plus the mailto body parameter.
        self.assertEqual(page.count(expected), 4)

    def test_base_url_defaults_to_production_pages_origin(self):
        page = self._page()
        expected = quote(f"{build.DEFAULT_BASE_URL}/offers/{self.SLUG}.html", safe="")
        self.assertIn(expected, page)

    def test_x_intent_carries_encoded_title(self):
        page = self._page()
        expected = quote("Test Offer", safe="")
        self.assertIn(f"text={expected}", page)

    def test_copy_button_has_live_region_confirmation_slot(self):
        page = self._page()
        start = page.index('class="od-share"')
        seg = page[start : page.index("</section>", start)]
        self.assertIn('class="share-copy"', seg)
        self.assertRegex(seg, r'class="share-status"[^>]*\bhidden\b')
        self.assertIn('role="status"', seg)
        self.assertIn('aria-live="polite"', seg)

    def test_share_runtime_shipped_with_offer_id_and_page_url(self):
        page = self._page(base_url="https://x.example.org/site")
        self.assertIn('"offer_share"', page)
        self.assertIn(json.dumps(self.SLUG), page)
        self.assertIn(
            json.dumps(f"https://x.example.org/site/offers/{self.SLUG}.html"),
            page,
        )
        self.assertIn("navigator.clipboard", page)

    def test_share_bar_absent_from_home_and_chrome(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        offer.setdefault("slug", "offer-0")
        page = build.render_html(build.build_index([offer]))
        self.assertNotIn('class="od-share"', page)
        self.assertNotIn("data-ft-share", page)

    def test_main_threads_base_url_into_share_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            Path(offers_dir, "alpha.yaml").write_text(offer_text(), encoding="utf-8")
            out = os.path.join(tmp, "out")
            code = build.main(
                [
                    "--offers-dir",
                    offers_dir,
                    "--out",
                    out,
                    "--base-url",
                    "https://custom.example.org/ft",
                ]
            )
            self.assertEqual(code, 0)
            detail = Path(out, "site", "offers", "alpha.html").read_text(
                encoding="utf-8"
            )
            expected = quote("https://custom.example.org/ft/offers/alpha.html", safe="")
            self.assertIn(expected, detail)

    def test_expired_offer_pages_still_get_the_share_bar(self):
        offer = self._offer(status="expired")
        page = self._page(offer)
        self.assertIn('class="od-share"', page)


if __name__ == "__main__":
    unittest.main()
