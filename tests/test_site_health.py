"""Tests for scripts/check_site_health.py — stale-content signal (Task 4.4).

python3 -m unittest tests/test_site_health.py -v
python3 -m unittest discover -s tests -v
"""

import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import offer_model as build  # noqa: E402
import check_site_health as health  # noqa: E402

SCRIPT = REPO / "scripts" / "check_site_health.py"


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
        "review_status": "unverified",
        "signup": "required",
    }
    data.update(overrides)
    lines = []
    for k, v in data.items():
        lines.append(f"{k}: {'null' if v is None else v}")
    return "\n".join(lines) + "\n"


def run_script(*args):
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        cwd=str(REPO),
    )
    return proc.returncode, proc.stdout, proc.stderr


class FreshnessLogicTests(unittest.TestCase):
    def _write_offers(self, tmp, dates):
        od = os.path.join(tmp, "offers")
        os.makedirs(od, exist_ok=True)
        for i, d in enumerate(dates):
            Path(od, f"offer-{i}.yaml").write_text(offer_text(verified_date=d), encoding="utf-8")
        return od

    def test_fresh_catalog_not_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            today = dt.date.today()
            od = self._write_offers(tmp, [today.isoformat()] * 5)
            result = health.check_freshness(od, today, 14, 0.70)
            self.assertFalse(result["stale"])
            self.assertEqual(result["ratio"], 1.0)

    def test_ratio_below_threshold_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            today = dt.date.today()
            old = (today - dt.timedelta(days=30)).isoformat()
            fresh = today.isoformat()
            # 10 offers, 3 fresh -> 30% < 70%
            od = self._write_offers(tmp, [old] * 7 + [fresh] * 3)
            result = health.check_freshness(od, today, 14, 0.70)
            self.assertTrue(result["stale"])
            self.assertIn("ratio", result["stale_reason"])
            self.assertEqual(result["fresh"], 3)

    def test_last_verified_over_14_days_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            today = dt.date.today()
            mid = (today - dt.timedelta(days=15)).isoformat()
            od = self._write_offers(tmp, [mid] * 5)
            result = health.check_freshness(od, today, 14, 0.70)
            self.assertTrue(result["stale"])
            self.assertIn("last verified_date", result["stale_reason"])

    def test_boundary_14_days_is_fresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            today = dt.date.today()
            boundary = (today - dt.timedelta(days=14)).isoformat()
            od = self._write_offers(tmp, [boundary] * 3)
            result = health.check_freshness(od, today, 14, 0.70)
            self.assertFalse(result["stale"])

    def test_boundary_15_days_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            today = dt.date.today()
            old = (today - dt.timedelta(days=15)).isoformat()
            od = self._write_offers(tmp, [old] * 3)
            result = health.check_freshness(od, today, 14, 0.70)
            self.assertTrue(result["stale"])

    def test_oldest_sorted_for_remediation(self):
        with tempfile.TemporaryDirectory() as tmp:
            today = dt.date.today()
            d1 = (today - dt.timedelta(days=20)).isoformat()
            d2 = (today - dt.timedelta(days=5)).isoformat()
            d3 = today.isoformat()
            od = self._write_offers(tmp, [d2, d1, d3])
            result = health.check_freshness(od, today, 14, 0.70)
            dates = [e["verified_date"] for e in result["oldest"]]
            self.assertEqual(dates, sorted(dates))

    def test_oldest_entries_link_back_to_offers_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            today = dt.date.today()
            od = self._write_offers(tmp, [today.isoformat()])
            result = health.check_freshness(od, today, 14, 0.70)
            self.assertTrue(result["oldest"][0]["path"].startswith("offers/"))
            self.assertTrue(result["oldest"][0]["path"].endswith(".yaml"))

    def test_empty_catalog_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            od = os.path.join(tmp, "offers")
            os.makedirs(od)
            today = dt.date.today()
            result = health.check_freshness(od, today, 14, 0.70)
            self.assertTrue(result["stale"])
            self.assertEqual(result["total"], 0)


class CliDryRunTests(unittest.TestCase):
    def test_dry_run_proven_on_stale_fixture_exits_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            od = os.path.join(tmp, "offers")
            os.makedirs(od)
            old = (dt.date.today() - dt.timedelta(days=30)).isoformat()
            for i in range(5):
                Path(od, f"old-{i}.yaml").write_text(offer_text(verified_date=old), encoding="utf-8")
            code, out, _ = run_script("--offers-dir", od, "--dry-run")
            self.assertEqual(code, 0)
            self.assertIn("STALE", out)

    def test_fail_on_stale_exits_two(self):
        with tempfile.TemporaryDirectory() as tmp:
            od = os.path.join(tmp, "offers")
            os.makedirs(od)
            old = (dt.date.today() - dt.timedelta(days=30)).isoformat()
            for i in range(5):
                Path(od, f"old-{i}.yaml").write_text(offer_text(verified_date=old), encoding="utf-8")
            code, _, _ = run_script("--offers-dir", od, "--fail-on-stale")
            self.assertEqual(code, 2)

    def test_fresh_exits_zero_even_with_fail_on_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            od = os.path.join(tmp, "offers")
            os.makedirs(od)
            fresh = dt.date.today().isoformat()
            for i in range(3):
                Path(od, f"fresh-{i}.yaml").write_text(offer_text(verified_date=fresh), encoding="utf-8")
            code, _, _ = run_script("--offers-dir", od, "--fail-on-stale")
            self.assertEqual(code, 0)

    def test_json_output_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            od = os.path.join(tmp, "offers")
            os.makedirs(od)
            fresh = dt.date.today().isoformat()
            Path(od, "one.yaml").write_text(offer_text(verified_date=fresh), encoding="utf-8")
            code, out, _ = run_script("--offers-dir", od, "--json")
            self.assertEqual(code, 0)
            data = json.loads(out)
            for key in ("total", "fresh", "ratio", "last_verified", "days_since_last", "stale", "oldest"):
                self.assertIn(key, data)


class WorkflowFileTests(unittest.TestCase):
    WF = REPO / ".github" / "workflows" / "site-health.yml"

    def test_workflow_exists(self):
        self.assertTrue(self.WF.exists(), "site-health.yml must exist")

    def test_workflow_has_schedule_and_workflow_run(self):
        text = self.WF.read_text(encoding="utf-8")
        self.assertIn("schedule:", text)
        self.assertIn("workflow_run:", text)
        self.assertIn("Deploy to GitHub Pages", text)

    def test_freshness_job_deduplicates_stale_issue(self):
        text = self.WF.read_text(encoding="utf-8")
        self.assertIn("site-health", text)
        self.assertIn("gh issue list", text)
        self.assertIn("gh issue create", text)

    def test_deploy_failure_checks_second_consecutive(self):
        text = self.WF.read_text(encoding="utf-8")
        self.assertIn("consecutive", text)
        self.assertIn("conclusion", text)
        # Must look at last two runs
        self.assertIn("workflow_runs", text)

    def test_actions_pinned_to_sha(self):
        text = self.WF.read_text(encoding="utf-8")
        # Every uses: must be @<40-hex>
        import re

        for line in text.splitlines():
            if "uses:" in line and "actions/" in line:
                self.assertRegex(line, r"actions/.+@[0-9a-f]{40}", msg=line)
