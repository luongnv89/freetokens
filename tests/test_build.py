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
from contextlib import redirect_stdout
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import build  # noqa: E402

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
            Path(offers_dir, "broken.yaml").write_text("title: Only\n", encoding="utf-8")
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


class RenderTests(unittest.TestCase):
    def _render(self, offers):
        for i, offer in enumerate(offers):
            offer.setdefault("slug", f"offer-{i}")
        return build.render_html(build.build_index(offers))

    def test_null_expiry_renders_ongoing(self):
        page = self._render([build.validate_offer(dict(VALID), "a.yaml")])
        self.assertIn("ongoing", page)
        self.assertNotIn("expires:", page)

    def test_dated_expiry_renders_expires_prefix(self):
        offer = build.validate_offer(dict(VALID, expiry_date="2026-12-31"), "a.yaml")
        page = self._render([offer])
        self.assertIn("expires: 2026-12-31", page)

    def test_category_rendered_as_badge(self):
        offer = build.validate_offer(dict(VALID, category="voice"), "a.yaml")
        page = self._render([offer])
        self.assertIn('<span class="badge">voice</span>', page)

    def test_link_has_descriptive_aria_label(self):
        offer = build.validate_offer(dict(VALID), "a.yaml")
        page = self._render([offer])
        self.assertIn('aria-label="Test Offer from Test Provider"', page)
        self.assertIn('href="https://example.com/offer"', page)

    def test_all_seed_offers_present_in_built_page(self):
        offers = build.load_offers(str(REPO / "offers"))
        page = self._render(offers)
        for offer in offers:
            self.assertIn(offer["title"], page)
            self.assertIn(offer["provider"], page)
            self.assertIn(f'class="badge">{offer["category"]}</span>', page)
        self.assertEqual(page.count("<article"), len(offers))


if __name__ == "__main__":
    unittest.main()
