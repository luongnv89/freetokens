"""Tests for scripts/validate_offers.py — stdlib unittest.

python3 -m unittest discover -s tests -v
"""

import io
import json
import os
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import validate_offers  # noqa: E402

import datetime as dt  # noqa: E402


def offer_text(**overrides):
    data = {
        "title": "Test Offer",
        "provider": "Test Provider",
        "category": "api_provider",
        "amount": "$10 in credits",
        "expiry_date": None,
        "source_url": "https://example.com/offer",
        "verified_date": dt.date.today().isoformat(),
    }
    data.update(overrides)
    lines = []
    for key, value in data.items():
        lines.append(f"{key}: {'null' if value is None else value}")
    return "\n".join(lines) + "\n"


class SchemaConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.schema = validate_offers.load_schema(
            str(REPO / "schemas" / "offer.schema.json")
        )

    def test_schema_required_matches_build(self):
        self.assertEqual(
            set(self.schema["required"]), set(validate_offers.build.REQUIRED_FIELDS)
        )

    def test_schema_category_enum_matches_build(self):
        self.assertEqual(
            self.schema["properties"]["category"]["enum"],
            list(validate_offers.build.CATEGORIES),
        )

    def test_mismatched_required_fails_consistency_check(self):
        schema = json.loads(json.dumps(self.schema))
        schema["required"].remove("provider")
        with self.assertRaisesRegex(validate_offers.SchemaMismatch, "provider"):
            validate_offers.check_schema_matches_build(schema)

    def test_non_nullable_verified_date_enforced(self):
        schema = json.loads(json.dumps(self.schema))
        schema["properties"]["verified_date"]["type"] = ["string", "null"]
        with self.assertRaisesRegex(
            validate_offers.SchemaMismatch, "verified_date must not be nullable"
        ):
            validate_offers.check_schema_matches_build(schema)

    def test_expiry_date_pattern_requires_iso_format(self):
        pattern = self.schema["properties"]["expiry_date"]["pattern"]
        self.assertIsNotNone(re.match(pattern, "2026-08-21"))
        self.assertIsNone(re.match(pattern, "Aug 21, 2026"))


class ValidateDirTests(unittest.TestCase):
    def _write(self, tmp, name, text):
        offers_dir = os.path.join(tmp, "offers")
        os.makedirs(offers_dir, exist_ok=True)
        Path(offers_dir, name).write_text(text, encoding="utf-8")
        return offers_dir

    def test_valid_offer_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write(tmp, "valid-offer.yaml", offer_text())
            offers = validate_offers.validate_offers_dir(offers_dir)
            self.assertEqual(len(offers), 1)

    def test_missing_field_names_file_and_field(self):
        text = offer_text().replace("provider: Test Provider\n", "")
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write(tmp, "broken.yaml", text)
            with self.assertRaisesRegex(
                validate_offers.build.OfferError, r"broken\.yaml.*provider"
            ):
                validate_offers.validate_offers_dir(offers_dir)

    def test_invalid_date_names_file_field_and_format_hint(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write(
                tmp, "dated.yaml", offer_text(expiry_date="Aug 21, 2026")
            )
            with self.assertRaisesRegex(
                validate_offers.build.OfferError,
                r"dated\.yaml.*expiry_date.*YYYY-MM-DD",
            ):
                validate_offers.validate_offers_dir(offers_dir)

    def test_bad_null_handling_gives_hint_not_type_error(self):
        # verified_date is not nullable; a null value must fail with the
        # date-format hint rather than crash.
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write(
                tmp, "nullverified.yaml", offer_text(verified_date=None)
            )
            with self.assertRaisesRegex(
                validate_offers.build.OfferError,
                r"nullverified\.yaml.*verified_date.*YYYY-MM-DD",
            ):
                validate_offers.validate_offers_dir(offers_dir)

    def test_duplicate_slug_names_both_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write(tmp, "alpha.yaml", offer_text())
            Path(offers_dir, "alpha.yml").write_text(
                offer_text(title="Alpha Again"), encoding="utf-8"
            )
            with self.assertRaisesRegex(
                validate_offers.build.OfferError, "duplicate slug 'alpha'"
            ) as cm:
                validate_offers.validate_offers_dir(offers_dir)
            message = str(cm.exception)
            self.assertIn("alpha.yaml", message)
            self.assertIn("alpha.yml", message)

    def test_bad_slug_convention_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = self._write(tmp, "Bad_Slug.yaml", offer_text())
            with self.assertRaisesRegex(
                validate_offers.build.OfferError, "naming convention"
            ):
                validate_offers.validate_offers_dir(offers_dir)


class MainTests(unittest.TestCase):
    def _run_main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = validate_offers.main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_repo_offers_pass_exit_zero(self):
        code, out, err = self._run_main([])
        self.assertEqual(code, 0)
        self.assertIn("OK", out)

    def test_malformed_dir_exits_one_naming_file_and_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            Path(offers_dir, "bad.yaml").write_text("title: Only\n", encoding="utf-8")
            code, _, err = self._run_main(["--offers-dir", offers_dir])
            self.assertEqual(code, 1)
            self.assertIn("bad.yaml", err)
            self.assertIn("missing required fields", err)

    def test_schema_drift_exits_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            schema_path = os.path.join(tmp, "schema.json")
            with open(schema_path, "w", encoding="utf-8") as fh:
                json.dump({"required": [], "properties": {}}, fh)
            code, _, err = self._run_main(["--schema", schema_path])
            self.assertEqual(code, 1)
            self.assertIn("REQUIRED_FIELDS", err)


if __name__ == "__main__":
    unittest.main()
