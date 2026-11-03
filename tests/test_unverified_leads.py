"""Unverified leads (#660): schema, validator, and the offer-hunter lifecycle.

python3 -m unittest tests.test_unverified_leads -v
"""

import datetime as dt
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import lead_model  # noqa: E402
import validate_offers  # noqa: E402
from offer_model import OfferError  # noqa: E402

TODAY = dt.date(2026, 11, 3)
WRITE_LEADS = REPO / "skills" / "offer-hunter" / "scripts" / "write_leads.py"


def lead(**overrides):
    data = {
        "slug": "acme-free-tokens",
        "provider": "Acme AI",
        "title": "Free tokens week",
        "claim": "Acme gives 1M free tokens to every new account this week.",
        "amount_claimed": "1M tokens",
        "sources": [{"url": "https://x.com/acme_fan/status/1", "type": "x",
                     "author": "Acme Fan", "handle": "@acme_fan", "date": "2026-11-01"}],
        "first_seen": "2026-11-01",
        "last_seen": "2026-11-02",
        "reason": "official_silent",
        "reason_detail": "Acme's pricing page loaded but says nothing about free tokens.",
        "official_urls_tried": ["https://acme.example/pricing"],
    }
    data.update(overrides)
    return data


def check(data, name=None):
    name = name or f"{data['slug']}.yaml"
    text = lead_model.dump_lead(data, "test lead")
    return lead_model.validate_lead(lead_model.parse_lead_text(text, name), name, TODAY)


class LeadSchemaTests(unittest.TestCase):
    def test_good_lead_round_trips(self):
        self.assertEqual(check(lead()), lead())

    def test_missing_source_fails_naming_field(self):
        with self.assertRaisesRegex(OfferError, r"acme-free-tokens\.yaml: sources must list at least one"):
            check(lead(sources=[]))
        data = lead()
        del data["sources"]
        with self.assertRaisesRegex(OfferError, "missing required field.*sources"):
            lead_model.validate_lead(data, "acme-free-tokens.yaml", TODAY)

    def test_unsafe_claim_urls_fail(self):
        shortener = lead(sources=[dict(lead()["sources"][0], url="https://t.co/abc", type="web")])
        with self.assertRaisesRegex(OfferError, "link shortener or form"):
            check(shortener)
        with self.assertRaisesRegex(OfferError, "claim carries a link"):
            check(lead(claim="Claim it at https://acme-free.example/claim now"))
        with self.assertRaisesRegex(OfferError, "DM, a secret, or payment"):
            check(lead(claim="DM me your wallet address for 1M free tokens"))
        with self.assertRaisesRegex(OfferError, "social site"):
            check(lead(official_urls_tried=["https://x.com/acme"]))
        with self.assertRaisesRegex(OfferError, "does not match host"):
            check(lead(sources=[dict(lead()["sources"][0], type="web")]))

    def test_enum_dates_and_slug(self):
        with self.assertRaisesRegex(OfferError, "reason must be one of"):
            check(lead(reason="vibes"))
        with self.assertRaisesRegex(OfferError, "first_seen .* is after last_seen"):
            check(lead(first_seen="2026-11-02", last_seen="2026-11-01"))
        with self.assertRaisesRegex(OfferError, "must match the file name"):
            check(lead(), "other-name.yaml")

    def test_stale_lead_is_detected(self):
        self.assertFalse(lead_model.is_stale(lead(last_seen="2026-10-04"), TODAY))
        self.assertTrue(lead_model.is_stale(lead(last_seen="2026-10-03"), TODAY))

    def test_schema_matches_model(self):
        with open(REPO / "schemas" / "unverified-lead.schema.json", encoding="utf-8") as fh:
            validate_offers.check_lead_schema_matches_model(json.load(fh))


class ValidatorCliTests(unittest.TestCase):
    """validate_offers.py gates unverified/ beside offers/."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.offers = root / "offers"
        self.leads = root / "unverified"
        self.offers.mkdir()
        self.leads.mkdir()
        (self.offers / "real-offer.yaml").write_text(
            "title: Real Offer\nprovider: Real\ncategory: api_provider\namount: $10\n"
            "expiry_date: null\nsource_url: https://real.example/offer\n"
            f"verified_date: {dt.date.today().isoformat()}\nverification: social_proof\n"
            "review_status: under-review\nsignup: required\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, data):
        (self.leads / f"{data['slug']}.yaml").write_text(lead_model.dump_lead(data), encoding="utf-8")
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = validate_offers.main(["--offers-dir", str(self.offers),
                                         "--schema", str(REPO / "schemas" / "offer.schema.json")])
        return code, out.getvalue(), err.getvalue()

    def test_good_lead_passes(self):
        today = dt.date.today().isoformat()
        code, out, _ = self.run_cli(lead(first_seen=today, last_seen=today))
        self.assertEqual(code, 0)
        self.assertIn("validated 1 unverified leads: OK", out)

    def test_missing_source_fails(self):
        code, _, err = self.run_cli(lead(sources=[]))
        self.assertEqual(code, 1)
        self.assertIn("acme-free-tokens.yaml: sources", err)

    def test_unsafe_claim_url_fails(self):
        code, _, err = self.run_cli(lead(claim="Get it via https://bit.ly/x"))
        self.assertEqual(code, 1)
        self.assertIn("unsafe claim path", err)

    def test_stale_lead_warns_without_failing(self):
        code, _, err = self.run_cli(lead(first_seen="2026-01-01", last_seen="2026-01-02"))
        self.assertEqual(code, 0)
        self.assertIn("warning: unverified lead 'acme-free-tokens'", err)

    def test_lead_slug_may_not_name_an_offer(self):
        code, _, err = self.run_cli(lead(slug="real-offer", last_seen="2026-11-02"))
        self.assertEqual(code, 1)
        self.assertIn("is also an offer", err)


class WriteLeadsLifecycleTests(unittest.TestCase):
    """skills/offer-hunter/scripts/write_leads.py applies the lead lifecycle."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.leads, self.offers = root / "unverified", root / "offers"
        self.offers.mkdir()
        self.root = root

    def tearDown(self):
        self.tmp.cleanup()

    def apply_verdicts(self, verdicts, today="2026-11-03", shortlist=None, ok=True):
        vpath = self.root / "verdicts.json"
        vpath.write_text(json.dumps(verdicts), encoding="utf-8")
        args = [sys.executable, str(WRITE_LEADS), "--verdicts", str(vpath), "--today", today,
                "--leads-dir", str(self.leads), "--offers-dir", str(self.offers)]
        if shortlist is not None:
            spath = self.root / "shortlist.json"
            spath.write_text(json.dumps({"selected": [{"id": i} for i in shortlist]}), encoding="utf-8")
            args += ["--shortlist", str(spath)]
        proc = subprocess.run(args, capture_output=True, text=True, cwd=str(REPO))
        self.assertEqual(proc.returncode == 0, ok, proc.stderr)
        return json.loads(proc.stdout) if ok else proc

    @staticmethod
    def verdict(rid="x-01", url="https://x.com/acme_fan/status/1", **lead_overrides):
        entry = {"provider": "Acme AI", "title": "Free tokens week",
                 "claim": "Acme gives 1M free tokens to every new account.",
                 "amount_claimed": "1M tokens", "reason": "bot_walled",
                 "reason_detail": "acme.example/pricing returned HTTP 403.",
                 "official_urls_tried": ["https://acme.example/pricing"]}
        entry.update(lead_overrides)
        return {"id": rid, "label": "Acme AI — Free tokens week", "verdict": "unverifiable",
                "action": "none", "reason": "bot-walled",
                "lead": {"type": "x", "url": url, "author": "Fan", "handle": "@fan",
                         "community": None, "title": None, "date": "2026-11-01", "text": "..."},
                "unverified_lead": entry}

    def test_add_refresh_and_drop(self):
        dropped = {"id": "x-02", "label": "Shady", "verdict": "unverifiable", "action": "none",
                   "reason": "r", "unverified_lead": None, "unverified_drop": "unsafe claim path: DM"}
        report = self.apply_verdicts([self.verdict(), dropped,
                           {"id": "x-03", "label": "Gone", "verdict": "expired", "action": "none",
                            "reason": "ended"}])
        self.assertEqual(report["added"], ["acme-ai-free-tokens-week"])
        self.assertEqual(report["dropped"][0]["reason"], "unsafe claim path: DM")
        self.assertEqual(len(list(self.leads.iterdir())), 1)

        report = self.apply_verdicts([self.verdict(url="https://x.com/other/status/2")], today="2026-11-05")
        self.assertEqual(report["refreshed"], ["acme-ai-free-tokens-week"])
        stored = lead_model.load_leads(str(self.leads), today=dt.date(2026, 11, 5))[0]
        self.assertEqual((stored["first_seen"], stored["last_seen"]), ("2026-11-03", "2026-11-05"))
        self.assertEqual(len(stored["sources"]), 2)

    def test_unsafe_lead_is_dropped_never_written(self):
        report = self.apply_verdicts([self.verdict(claim="DM me for the code")])
        self.assertEqual(report["added"], [])
        self.assertIn("DM, a secret, or payment", report["dropped"][0]["reason"])
        self.assertFalse(self.leads.exists() and any(self.leads.iterdir()))

    def test_stale_lead_removed_and_published_lead_removed(self):
        self.apply_verdicts([self.verdict(), self.verdict(rid="x-02", title="Other", url="https://x.com/b/status/3")])
        recheck = {"id": "lead-01", "lead_slug": "acme-ai-other", "label": "Acme AI — Other",
                   "verdict": "live", "action": "new", "reason": "official page confirms it"}
        report = self.apply_verdicts([recheck], today="2026-11-04", shortlist=["lead-01"])
        self.assertEqual([r["slug"] for r in report["removed"]], ["acme-ai-other"])
        report = self.apply_verdicts([], today="2026-12-04")
        self.assertEqual([r["slug"] for r in report["removed"]], ["acme-ai-free-tokens-week"])
        self.assertEqual(list(self.leads.iterdir()), [])

    def test_queue_lists_oldest_first(self):
        self.apply_verdicts([self.verdict()], today="2026-11-01")
        self.apply_verdicts([self.verdict(rid="x-02", title="Other", url="https://x.com/b/status/3")])
        proc = subprocess.run([sys.executable, str(WRITE_LEADS), "--queue", "5", "--today", "2026-11-03",
                               "--leads-dir", str(self.leads), "--offers-dir", str(self.offers)],
                              capture_output=True, text=True, cwd=str(REPO), check=True)
        queue = json.loads(proc.stdout)
        self.assertEqual([c["lead_slug"] for c in queue], ["acme-ai-free-tokens-week", "acme-ai-other"])
        self.assertEqual(queue[0]["id"], "lead-01")

    def test_recheck_with_new_post_refreshes_and_bad_merge_is_dropped(self):
        """Re-checks (lead_slug) stay valid and count a newer post as a sighting."""
        self.apply_verdicts([self.verdict()], today="2026-11-01")
        recheck = dict(self.verdict(rid="lead-01", url="https://x.com/new/status/9"),
                       lead_slug="acme-ai-free-tokens-week")
        report = self.apply_verdicts([recheck], today="2026-11-04")
        self.assertEqual(report["refreshed"], ["acme-ai-free-tokens-week"])
        self.assertEqual(report["removed"], [])
        stored = lead_model.load_leads(str(self.leads), today=dt.date(2026, 11, 4))[0]
        self.assertEqual(stored["last_seen"], "2026-11-04")

        bad = dict(self.verdict(rid="lead-01", reason="made_up"), lead_slug="acme-ai-free-tokens-week")
        report = self.apply_verdicts([bad], today="2026-11-05")
        self.assertIn("re-check not applied", report["dropped"][0]["reason"])
        lead_model.load_leads(str(self.leads), today=dt.date(2026, 11, 5))  # still valid


class BackfillTests(unittest.TestCase):
    def test_committed_leads_are_valid_and_never_offers(self):
        offers = {os.path.splitext(f)[0] for f in os.listdir(REPO / "offers") if f.endswith(".yaml")}
        leads = lead_model.load_leads(str(REPO / "unverified"), offers)
        self.assertGreater(len(leads), 0)


if __name__ == "__main__":
    unittest.main()
