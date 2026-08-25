"""Tests for the offer-updater skill helper (.claude/skills/offer-updater).

Covers issue #20's acceptance criteria: the deterministic validator must
accept schema-compliant drafts, reject malformed ones naming the offending
file/field, and stay in lockstep with the CI validator (same build.py code
path). Also guards SKILL.md loadability (frontmatter name matches dir).
"""

import datetime as dt
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HELPER = REPO / ".claude" / "skills" / "offer-updater" / "validate_offer.py"
SKILL_MD = REPO / ".claude" / "skills" / "offer-updater" / "SKILL.md"

sys.path.insert(0, str(REPO / "scripts"))


def offer_text(**overrides):
    data = {
        "title": "Test Offer",
        "provider": "Test Provider",
        "category": "api_provider",
        "amount": "$10 in credits",
        "expiry_date": None,
        "source_url": "https://example.com/offer",
        "verified_date": dt.date.today().isoformat(),
        "verification": "social_proof",
        "signup": "required",
    }
    data.update(overrides)
    lines = []
    for key, value in data.items():
        lines.append(f"{key}: {'null' if value is None else value}")
    return "\n".join(lines) + "\n"


def run_helper(*args):
    proc = subprocess.run(
        [sys.executable, str(HELPER), *args],
        capture_output=True,
        text=True,
        cwd=str(REPO),
    )
    return proc.returncode, proc.stdout, proc.stderr


class HelperCliTests(unittest.TestCase):
    def _write_draft(self, tmp, name="draft.yaml", text=None):
        path = Path(tmp, name)
        path.write_text(text if text is not None else offer_text(), encoding="utf-8")
        return str(path)

    def test_valid_draft_exits_zero_with_slug(self):
        with tempfile.TemporaryDirectory() as tmp:
            draft = self._write_draft(tmp)
            code, out, err = run_helper(draft)
            self.assertEqual(code, 0, err)
            self.assertIn(f"OK {draft} (draft)", out)

    def test_multiple_valid_files_all_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            alpha = self._write_draft(tmp, "alpha.yaml")
            Path(alpha).unlink()
            Path(alpha).write_text(offer_text(title="Alpha"), encoding="utf-8")
            beta = self._write_draft(tmp, "beta.yaml", offer_text(title="Beta"))
            code, out, err = run_helper(alpha, beta)
            self.assertEqual(code, 0, err)
            self.assertIn("(alpha)", out)
            self.assertIn("(beta)", out)

    def test_missing_required_field_names_file_and_field(self):
        text = offer_text().replace("provider: Test Provider\n", "")
        with tempfile.TemporaryDirectory() as tmp:
            draft = self._write_draft(tmp, "broken.yaml", text)
            code, _, err = run_helper(draft)
            self.assertEqual(code, 1)
            self.assertIn("broken.yaml", err)
            self.assertIn("provider", err)

    def test_bad_date_format_includes_hint(self):
        with tempfile.TemporaryDirectory() as tmp:
            draft = self._write_draft(
                tmp, "dated.yaml", offer_text(expiry_date="Aug 21, 2026")
            )
            code, _, err = run_helper(draft)
            self.assertEqual(code, 1)
            self.assertIn("dated.yaml", err)
            self.assertIn("expiry_date", err)
            self.assertIn("YYYY-MM-DD", err)

    def test_future_verified_date_rejected(self):
        future = (dt.date.today() + dt.timedelta(days=3)).isoformat()
        with tempfile.TemporaryDirectory() as tmp:
            draft = self._write_draft(
                tmp, "future.yaml", offer_text(verified_date=future)
            )
            code, _, err = run_helper(draft)
            self.assertEqual(code, 1)
            self.assertIn("verified_date", err)
            self.assertIn("future", err)

    def test_unknown_field_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            draft = self._write_draft(
                tmp, "extra.yaml", offer_text() + "bonus: yes\n"
            )
            code, _, err = run_helper(draft)
            self.assertEqual(code, 1)
            self.assertIn("unknown fields", err)
            self.assertIn("bonus", err)

    def test_bad_category_names_allowed_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            draft = self._write_draft(
                tmp, "cat.yaml", offer_text(category="llm")
            )
            code, _, err = run_helper(draft)
            self.assertEqual(code, 1)
            self.assertIn("category", err)
            self.assertIn("api_provider|coding|image|voice|video", err)

    def test_bad_slug_convention_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            draft = self._write_draft(tmp, "Bad_Slug.yaml")
            code, _, err = run_helper(draft)
            self.assertEqual(code, 1)
            self.assertIn("naming convention", err)

    def test_duplicate_slugs_across_args_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            one = self._write_draft(tmp, "dup.yaml", offer_text(title="One"))
            two = self._write_draft(tmp, "dup.yml", offer_text(title="Two"))
            code, _, err = run_helper(one, two)
            self.assertEqual(code, 1)
            self.assertIn("duplicate slug 'dup'", err)
            self.assertIn("dup.yaml", err)
            self.assertIn("dup.yml", err)

    def test_good_and_bad_mixed_still_exit_one_but_report_ok(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = self._write_draft(tmp, "good.yaml")
            bad = self._write_draft(tmp, "bad.yaml", "title: Only\n")
            code, out, err = run_helper(good, bad)
            self.assertEqual(code, 1)
            self.assertIn(f"OK {good} (good)", out)
            self.assertIn("bad.yaml", err)

    def test_missing_file_is_usage_error_exit_two(self):
        code, _, err = run_helper("/nonexistent/draft.yaml")
        self.assertEqual(code, 2)
        self.assertIn("no such file", err)

    def test_wrong_extension_is_usage_error_exit_two(self):
        with tempfile.TemporaryDirectory() as tmp:
            draft = Path(tmp, "draft.txt")
            draft.write_text(offer_text(), encoding="utf-8")
            code, _, err = run_helper(str(draft))
            self.assertEqual(code, 2)
            self.assertIn(".yaml or .yml", err)

    def test_no_arguments_prints_usage_exit_two(self):
        code, _, _ = run_helper()
        self.assertEqual(code, 2)


class ParityWithCiTests(unittest.TestCase):
    """The helper must exercise the exact CI validation code path."""

    def test_helper_imports_repo_build_module(self):
        sys.path.insert(0, str(HELPER.parent))
        try:
            import validate_offer as helper
        finally:
            sys.path.remove(str(HELPER.parent))
        import offer_model as build

        self.assertIs(helper._load_build_module(), build)

    def test_valid_draft_matches_validate_offers_dir(self):
        sys.path.insert(0, str(REPO / "scripts"))
        import validate_offers

        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            Path(offers_dir, "parity.yaml").write_text(
                offer_text(), encoding="utf-8"
            )
            offers = validate_offers.validate_offers_dir(offers_dir)
            self.assertEqual([o["slug"] for o in offers], ["parity"])

            code, out, _ = run_helper(os.path.join(offers_dir, "parity.yaml"))
            self.assertEqual(code, 0)
            self.assertIn("(parity)", out)


class SkillManifestTests(unittest.TestCase):
    def test_skill_md_exists_with_frontmatter(self):
        text = SKILL_MD.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---"), "SKILL.md must open with frontmatter")
        match = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
        self.assertIsNotNone(match, "frontmatter block must be closed")

    def test_name_matches_directory_rule(self):
        text = SKILL_MD.read_text(encoding="utf-8")
        name = re.search(r"^name:\s*(\S+)\s*$", text, re.MULTILINE)
        self.assertIsNotNone(name)
        self.assertEqual(name.group(1), "offer-updater")
        self.assertRegex(name.group(1), r"^[a-z0-9]+(-[a-z0-9]+)*$")

    def test_description_present_and_bounded(self):
        text = SKILL_MD.read_text(encoding="utf-8")
        desc = re.search(r"^description:\s*(.+)$", text, re.MULTILINE)
        self.assertIsNotNone(desc)
        self.assertTrue(0 < len(desc.group(1)) <= 1024)


class NeedsReviewStagingTests(unittest.TestCase):
    """Issue #21: unverifiable drafts must be un-committable by construction."""

    def test_gitignore_covers_needs_review(self):
        gitignore = (REPO / ".gitignore").read_text(encoding="utf-8")
        self.assertRegex(gitignore, r"(?m)^needs_review/$")

    def test_draft_in_needs_review_is_ignored(self):
        if not shutil.which("git"):
            self.skipTest("git not available")
        with tempfile.TemporaryDirectory() as tmp:
            draft = Path(tmp, "unverified-offer.yaml")
            draft.write_text(offer_text(), encoding="utf-8")
            staging = REPO / "needs_review" / "unverified-offer.yaml"
            staging.parent.mkdir(exist_ok=True)
            shutil.copy(draft, staging)
            try:
                proc = subprocess.run(
                    ["git", "check-ignore", "-v", str(staging.relative_to(REPO))],
                    capture_output=True,
                    text=True,
                    cwd=str(REPO),
                )
                self.assertEqual(
                    proc.returncode, 0, "needs_review/ draft must be git-ignored"
                )
                self.assertIn("needs_review/", proc.stdout)
            finally:
                staging.unlink(missing_ok=True)

    def test_staged_draft_never_reaches_offers_validation(self):
        # Even though the content is schema-valid, validate_offers_dir must
        # only ever see offers/*.yaml — a full offers/ run cannot pick up
        # staged drafts.
        sys.path.insert(0, str(REPO / "scripts"))
        import validate_offers

        with tempfile.TemporaryDirectory() as tmp:
            offers_dir = os.path.join(tmp, "offers")
            os.makedirs(offers_dir)
            os.makedirs(os.path.join(tmp, "needs_review"))
            Path(tmp, "needs_review", "sneaky.yaml").write_text(
                offer_text(title="Sneaky"), encoding="utf-8"
            )
            offers = validate_offers.validate_offers_dir(offers_dir)
            self.assertEqual(offers, [])


class CommitGatePolicyTests(unittest.TestCase):
    """The SKILL.md must keep the safety wording of the trust policy."""

    REQUIRED_PHRASES = (
        "needs_review",
        "explicit",
        "side-by-side",
        "live",
        "expired",
        "unverifiable",
    )

    def test_skill_md_keeps_gate_policy(self):
        text = SKILL_MD.read_text(encoding="utf-8").lower()
        missing = [p for p in self.REQUIRED_PHRASES if p not in text]
        self.assertEqual(missing, [])

    def test_hard_commit_rule_present(self):
        text = SKILL_MD.read_text(encoding="utf-8")
        self.assertIn("Nothing is committed", text)
        self.assertIn("without the curator's explicit yes", text)


if __name__ == "__main__":
    unittest.main()
