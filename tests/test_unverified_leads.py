"""Unverified leads (#660): schema, validator, and the offer-hunter lifecycle.

python3 -m unittest tests.test_unverified_leads -v
"""

import datetime as dt
import io
import json
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
CHECK_SCOPE = REPO / "skills" / "offer-hunter" / "scripts" / "check_scope.py"
PROBES = json.loads((REPO / "tests" / "fixtures" / "unsafe-lead-probes.json").read_text(encoding="utf-8"))


def src(url="https://x.com/acme_fan/status/1", date="2026-11-01", kind="x"):
    return {"url": url, "type": kind, "author": "Acme Fan", "handle": "@acme_fan", "date": date}


def lead(**overrides):
    data = {
        "slug": "acme-free-tokens",
        "provider": "Acme AI",
        "title": "Free tokens week",
        "claim": "Acme gives 1M free tokens to every new account this week.",
        "amount_claimed": "1M tokens",
        "sources": [src()],
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

    def test_undated_source_is_never_admitted(self):
        with self.assertRaisesRegex(OfferError, "undated source"):
            check(lead(sources=[src(date=None)]))
        # One dated source is enough.
        check(lead(sources=[src(date=None), src("https://x.com/b/status/2")]))

    def test_every_unsafe_claim_probe_is_rejected(self):
        for claim in PROBES["claims"]:
            with self.subTest(claim=claim), self.assertRaises(OfferError):
                check(lead(claim=claim))
        for claim in PROBES["safe_claims"]:
            with self.subTest(safe=claim):
                check(lead(claim=claim))

    def test_unsafe_wording_in_title_and_amount(self):
        with self.assertRaisesRegex(OfferError, "title asks for a DM"):
            check(lead(title="DM for free credits"))
        with self.assertRaisesRegex(OfferError, "amount_claimed names 'acme-free.xyz'"):
            check(lead(amount_claimed="$5 at acme-free.xyz"))

    def test_bare_domains_need_the_provider_domain_in_every_text_field(self):
        with self.assertRaisesRegex(OfferError, "provider names 'acme-free-credits.xyz'"):
            check(lead(provider=PROBES["provider_with_url"]))
        with self.assertRaisesRegex(OfferError, "reason_detail names 'acme-free-credits.xyz'"):
            check(lead(reason_detail=PROBES["reason_detail_with_url"]))
        with self.assertRaisesRegex(OfferError, "claim names 't.me'"):
            check(lead(claim="Join t.me/acmefree"))
        # The provider's own domain (from official_urls_tried) is allowed, as are file names.
        check(lead(reason_detail="docs.acme.example and acme.example/pricing returned HTTP 403."))
        check(lead(claim="Free Node.js sandbox credits on acme.example."))

    def test_crafted_source_urls_are_rejected(self):
        for url in PROBES["bad_source_urls"]:
            with self.subTest(url=url), self.assertRaises(OfferError):
                check(lead(sources=[src(url=url)]))
        self.assertIsNone(lead_model.url_host("https://bit.ly\\@x.com/a"))
        self.assertIsNone(lead_model.url_host("https://user@x.com/a"))
        self.assertIsNone(lead_model.url_host("https://x.com:8443/a"))
        self.assertEqual(lead_model.url_host("https://www.x.com/a/status/1"), "x.com")
        with self.assertRaisesRegex(OfferError, "social site"):
            check(lead(official_urls_tried=["https://x.com/acme"]))
        with self.assertRaisesRegex(OfferError, "does not match host"):
            check(lead(sources=[src(kind="web")]))

    def test_enum_dates_and_slug(self):
        with self.assertRaisesRegex(OfferError, "reason must be one of"):
            check(lead(reason="vibes"))
        with self.assertRaisesRegex(OfferError, "first_seen .* is after last_seen"):
            check(lead(first_seen="2026-11-02", last_seen="2026-11-01"))
        with self.assertRaisesRegex(OfferError, "must match the file name"):
            check(lead(), "other-name.yaml")

    def test_freshness_is_three_days_after_the_newest_post(self):
        self.assertEqual(lead_model.FRESH_DAYS, 3)
        fresh = lead(sources=[src(date="2026-10-20"), src("https://x.com/b/status/2", "2026-10-31")])
        self.assertEqual(lead_model.newest_post(fresh), "2026-10-31")
        self.assertFalse(lead_model.is_stale(fresh, TODAY))
        self.assertTrue(lead_model.is_stale(fresh, TODAY + dt.timedelta(days=1)))
        # last_seen (a hunt check) never extends freshness.
        self.assertTrue(lead_model.is_stale(lead(sources=[src(date="2026-10-30")], last_seen="2026-11-03"), TODAY))

    def test_schema_matches_model(self):
        with open(REPO / "schemas" / "unverified-lead.schema.json", encoding="utf-8") as fh:
            validate_offers.check_lead_schema_matches_model(json.load(fh))


class LeadRulesRound2Tests(unittest.TestCase):
    """PR #661 round-2 review: F3 narrowing, F4 Unicode parity, F5 slack, F6 fields."""

    def test_backfill_claims_and_real_offer_wording_pass(self):  # F3
        for claim in ("$5 free API credits for new users, no credit card or subscription needed.",
                      "Every new account receives 5 million free tokens on signup without a credit card, "
                      "valid for 30 days.",
                      "Link quota, no credit card needed.", "No need to add a credit card."):
            with self.subTest(claim=claim):
                check(lead(claim=claim))
        with self.assertRaisesRegex(OfferError, "Add a credit card"):
            check(lead(claim="Add a credit card to unlock"))

    def test_registrable_domains_and_suffixes(self):  # F3
        self.assertEqual(lead_model.registrable("docs.acme.co.uk"), "acme.co.uk")
        self.assertEqual(lead_model.registrable("api.acme.example"), "acme.example")
        uk = ["https://www.acme.co.uk/pricing"]
        check(lead(official_urls_tried=uk, claim="Claim inside shop.acme.co.uk after sign-up."))
        with self.assertRaisesRegex(OfferError, "names 'other.co.uk'"):
            check(lead(official_urls_tried=uk, claim="Claim inside other.co.uk after sign-up."))
        # The provider's other official domains (any official_urls_tried host) are allowed.
        check(lead(official_urls_tried=["https://acme.example/pricing", "https://acme.dev/docs"],
                   reason_detail="acme.dev/docs and acme.example returned HTTP 403."))
        # A product-TLD name passes as text, but not as a link target.
        check(lead(claim="Free credits for IBM watsonx.ai users."))
        with self.assertRaisesRegex(OfferError, "names 'free-grok.ai'"):
            check(lead(claim="Claim at free-grok.ai"))

    def test_unicode_is_normalised_and_ascii_bounded(self):  # F4
        self.assertEqual(lead_model.foreign_domains("Claim at caf\u00e9free.xyz", {"acme.example"}),
                         ["free.xyz"])
        self.assertEqual(lead_model.foreign_domains("Claim at \uff41\uff43\uff4d\uff45.xyz", {"acme.example"}),
                         ["acme.xyz"])
        self.assertEqual(lead_model.unsafe_wording("\uff24\uff2d me"), "DM")
        check(lead(claim="Caf\u00e9 owners get 1M free tokens."))

    def test_dates_allow_one_day_of_timezone_slack(self):  # F5
        tomorrow = (TODAY + dt.timedelta(days=1)).isoformat()
        check(lead(last_seen=tomorrow, sources=[src(date=tomorrow)]))
        later = (TODAY + dt.timedelta(days=2)).isoformat()
        with self.assertRaisesRegex(OfferError, "in the future"):
            check(lead(last_seen=later))
        with self.assertRaisesRegex(OfferError, "in the future"):
            check(lead(sources=[src(date=later)]))
        self.assertEqual(lead_model.utc_today(), dt.datetime.now(dt.timezone.utc).date())

    def test_wording_is_checked_on_every_rendered_field(self):  # F6
        with self.assertRaisesRegex(OfferError, "reason_detail asks for a DM"):
            check(lead(reason_detail="The post says to DM the bot for a code."))
        with self.assertRaisesRegex(OfferError, "provider asks for a DM"):
            check(lead(provider="Acme DM bot"))
        # reason_detail may cite official pages with a scheme; claim fields may not.
        check(lead(reason_detail="https://acme.example/pricing returned HTTP 403."))


class DocCommandTests(unittest.TestCase):
    """F1/F2: the documented git commands work while main has no unverified/ folder."""

    def git(self, *args, check=True):
        return subprocess.run(["git", *args], cwd=self.repo, capture_output=True, text=True, check=check)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = self.tmp.name
        for rel, text in (("offers/a.yaml", "a: 1\n"), ("index.json", "{}\n"),
                          ("app/public/llms.txt", "x\n"), ("scripts/lead_model.py", "")):
            Path(self.repo, rel).parent.mkdir(parents=True, exist_ok=True)
            Path(self.repo, rel).write_text(text, encoding="utf-8")
        self.git("init", "-q")
        self.git("add", "-A")
        self.git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")

    def tearDown(self):
        self.tmp.cleanup()

    @staticmethod
    def block(path, marker):
        text = (REPO / path).read_text(encoding="utf-8")
        for chunk in text.split("```bash")[1:]:
            body = chunk.split("```")[0]
            if marker in body:
                return body
        raise AssertionError(f"no bash block with {marker!r} in {path}")

    def test_hunter_rollback_restores_without_unverified(self):
        body = self.block("skills/offer-hunter/SKILL.md", "git restore -- offers")
        lines = [ln for ln in body.splitlines() if ln.startswith(("git restore", "git ls-files"))]
        self.assertTrue(any("--error-unmatch unverified" in ln for ln in lines))
        Path(self.repo, "offers/a.yaml").write_text("a: 2\n", encoding="utf-8")
        Path(self.repo, "index.json").write_text("{\"x\": 1}\n", encoding="utf-8")
        Path(self.repo, "offers/new.yaml").write_text("n: 1\n", encoding="utf-8")
        for line in lines:
            subprocess.run(["bash", "-c", line], cwd=self.repo, check=False)
        self.assertEqual(self.git("status", "--porcelain").stdout, "")

    def test_updater_lead_staging_is_a_noop_without_leads(self):
        body = self.block("skills/offer-updater/references/early-lane.md", "remove-match")
        cmd = body[body.index("python3 scripts/lead_model.py"):body.index("(cd app")].replace("\\\n", "\n")
        Path(self.repo, "scripts/lead_model.py").write_text(
            (REPO / "scripts/lead_model.py").read_text(encoding="utf-8"), encoding="utf-8")
        for name in ("offer_model.py",):
            Path(self.repo, "scripts", name).write_text((REPO / "scripts" / name).read_text(encoding="utf-8"),
                                                        encoding="utf-8")
        Path(self.repo, "schemas").mkdir()
        Path(self.repo, "schemas/unverified-lead.rules.json").write_text(
            (REPO / "schemas/unverified-lead.rules.json").read_text(encoding="utf-8"), encoding="utf-8")
        filled = cmd.replace("<provider>", "Acme AI").replace("<program>", "Free tokens week")
        proc = subprocess.run(["bash", "-c", "set -o pipefail; " + filled], cwd=self.repo,
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git("diff", "--cached", "--name-only").stdout, "")
        # With a matching lead it deletes and stages exactly that file.
        Path(self.repo, "unverified").mkdir()
        Path(self.repo, "unverified/acme-free-tokens.yaml").write_text(lead_model.dump_lead(lead()),
                                                                      encoding="utf-8")
        self.git("add", "-A")
        self.git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "lead")
        proc = subprocess.run(["bash", "-c", "set -o pipefail; " + filled], cwd=self.repo,
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.git("diff", "--cached", "--name-status").stdout.split(),
                         ["D", "unverified/acme-free-tokens.yaml"])


class ValidatorCliTests(unittest.TestCase):
    """validate_offers.py gates unverified/ beside offers/."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.offers = root / "offers"
        self.leads = root / "unverified"
        self.offers.mkdir()
        (self.offers / "real-offer.yaml").write_text(
            "title: Real Offer\nprovider: Real\ncategory: api_provider\namount: $10\n"
            "expiry_date: null\nsource_url: https://real.example/offer\n"
            f"verified_date: {dt.date.today().isoformat()}\nverification: social_proof\n"
            "review_status: under-review\nsignup: required\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, data=None, name=None):
        if data is not None:
            self.leads.mkdir(exist_ok=True)
            (self.leads / (name or f"{data['slug']}.yaml")).write_text(lead_model.dump_lead(data), encoding="utf-8")
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = validate_offers.main(["--offers-dir", str(self.offers),
                                         "--schema", str(REPO / "schemas" / "offer.schema.json")])
        return code, out.getvalue(), err.getvalue()

    def today_lead(self, **overrides):
        today = dt.date.today().isoformat()
        return lead(first_seen=today, last_seen=today, sources=[src(date=today)], **overrides)

    def test_missing_and_empty_folder_pass(self):
        code, out, _ = self.run_cli()
        self.assertEqual(code, 0)
        self.assertNotIn("unverified leads", out)
        self.leads.mkdir()
        self.assertEqual(self.run_cli()[0], 0)

    def test_good_lead_passes(self):
        code, out, _ = self.run_cli(self.today_lead())
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
        code, _, err = self.run_cli(lead(sources=[src(date="2026-01-01")], first_seen="2026-01-02",
                                         last_seen="2026-01-02"))
        self.assertEqual(code, 0)
        self.assertIn("warning: unverified lead 'acme-free-tokens': newest source post 2026-01-01", err)

    def test_yml_file_is_rejected(self):
        code, _, err = self.run_cli(self.today_lead(), name="acme-free-tokens.yml")
        self.assertEqual(code, 1)
        self.assertIn("leads are <slug>.yaml files only", err)

    def test_lead_slug_may_not_name_an_offer(self):
        code, _, err = self.run_cli(self.today_lead(slug="real-offer"))
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

    def cli(self, *args):
        proc = subprocess.run([sys.executable, str(WRITE_LEADS), *args, "--leads-dir", str(self.leads),
                               "--offers-dir", str(self.offers)],
                              capture_output=True, text=True, cwd=str(REPO))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    def apply_verdicts(self, verdicts, today="2026-11-03", shortlist=None):
        vpath = self.root / "verdicts.json"
        vpath.write_text(json.dumps(verdicts), encoding="utf-8")
        args = ["--verdicts", str(vpath), "--today", today]
        if shortlist is not None:
            spath = self.root / "shortlist.json"
            spath.write_text(json.dumps(shortlist), encoding="utf-8")
            args += ["--shortlist", str(spath)]
        return self.cli(*args)

    def stored(self, today="2026-11-03"):
        return {lead["slug"]: lead for lead in
                lead_model.load_leads(str(self.leads), today=dt.date.fromisoformat(today))}

    @staticmethod
    def verdict(rid="x-01", url="https://x.com/acme_fan/status/1", date="2026-11-02", **lead_overrides):
        entry = {"provider": "Acme AI", "title": "Free tokens week",
                 "claim": "Acme gives 1M free tokens to every new account.",
                 "amount_claimed": "1M tokens", "reason": "bot_walled",
                 "reason_detail": "acme.example/pricing returned HTTP 403.",
                 "official_urls_tried": ["https://acme.example/pricing"]}
        entry.update(lead_overrides)
        return {"id": rid, "label": f"Acme AI — {entry['title']}", "verdict": "unverifiable",
                "action": "none", "reason": "bot-walled", "official_contradicts": False,
                "lead": {"type": "x", "url": url, "author": "Fan", "handle": "@fan",
                         "community": None, "title": None, "date": date, "text": "..."},
                "unverified_lead": entry}

    def test_add_refresh_and_drop(self):
        dropped = {"id": "x-02", "label": "Shady", "verdict": "unverifiable", "action": "none",
                   "reason": "r", "unverified_lead": None, "unverified_drop": "unsafe claim path: DM"}
        report = self.apply_verdicts([self.verdict(), dropped,
                                      {"id": "x-03", "label": "Gone", "verdict": "expired",
                                       "action": "none", "reason": "ended"}])
        self.assertEqual(report["added"], ["acme-ai-free-tokens-week"])
        self.assertEqual(report["dropped"][0]["reason"], "unsafe claim path: DM")

        report = self.apply_verdicts([self.verdict(url="https://x.com/other/status/2", date="2026-11-04")],
                                     today="2026-11-05")
        self.assertEqual(report["refreshed"], ["acme-ai-free-tokens-week"])
        stored = self.stored("2026-11-05")["acme-ai-free-tokens-week"]
        self.assertEqual((stored["first_seen"], stored["last_seen"]), ("2026-11-03", "2026-11-05"))
        self.assertEqual(lead_model.newest_post(stored), "2026-11-04")

    def test_old_post_undated_unsafe_and_contradicted_are_dropped(self):
        report = self.apply_verdicts([
            self.verdict(rid="old", date="2026-10-29", title="Old"),
            self.verdict(rid="undated", date=None, title="Undated"),
            self.verdict(rid="unsafe", title="Unsafe", claim="DM me for the code"),
            dict(self.verdict(rid="contra", title="Contra"), official_contradicts=True,
                 unverified_drop="official page says the program ended"),
        ])
        reasons = {d["id"]: d["reason"] for d in report["dropped"]}
        self.assertEqual(report["added"], [])
        self.assertIn("stale: newest post 2026-10-29 is more than 3 days old", reasons["old"])
        self.assertEqual(reasons["undated"], "undated source")
        self.assertIn("asks for a DM", reasons["unsafe"])
        self.assertEqual(reasons["contra"], "official page says the program ended")
        self.assertFalse(self.leads.exists())

    def test_same_run_invalid_merge_leaves_the_stored_lead_untouched(self):  # S1
        bad = self.verdict(rid="x-02", url="https://x.com/b/status/3", reason="made_up",
                           official_urls_tried=["https://acme.example/pricing", "https://x.com/acme"])
        report = self.apply_verdicts([self.verdict(), bad])
        self.assertEqual(report["added"], ["acme-ai-free-tokens-week"])
        self.assertIn("not merged", report["dropped"][0]["reason"])
        stored = self.stored()["acme-ai-free-tokens-week"]
        self.assertEqual(stored["reason"], "bot_walled")
        self.assertEqual(len(stored["sources"]), 1)

    def test_scout_match_promotion_and_expiry_remove_leads_without_lead_slug(self):  # S2
        self.apply_verdicts([self.verdict(), self.verdict(rid="x-02", title="Other",
                                                          url="https://x.com/b/status/3")])
        live = {"id": "x-07", "label": "Acme AI — Free tokens week", "verdict": "live", "action": "new",
                "reason": "official page confirms it", "slug": "acme-5-api-credits"}
        expired = {"id": "x-08", "label": "Acme AI — Other", "verdict": "expired", "action": "none",
                   "reason": "official page says it ended"}
        report = self.apply_verdicts([live, expired], today="2026-11-04",
                                     shortlist={"selected": [{"id": "x-07"}], "rejected": []})
        removed = {r["slug"]: r["reason"] for r in report["removed"]}
        self.assertEqual(removed["acme-ai-free-tokens-week"], "verified live and published as an offer in this PR")
        self.assertIn("official check: expired", removed["acme-ai-other"])
        self.assertEqual(list(self.leads.iterdir()), [])

    def test_failed_recheck_keeps_the_lead(self):  # S3
        self.apply_verdicts([self.verdict()])
        timeout = {"id": "lead-01", "lead_slug": "acme-ai-free-tokens-week", "label": "x",
                   "verdict": "unverifiable", "action": "none", "reason": "worker dropped candidate"}
        report = self.apply_verdicts([timeout], today="2026-11-04")
        self.assertEqual(report["removed"], [])
        self.assertIn("re-check failed", report["dropped"][0]["reason"])
        self.assertIn("acme-ai-free-tokens-week", self.stored("2026-11-04"))
        # An explicit unverified_drop does remove it.
        explicit = dict(timeout, unverified_drop="official page now says it never existed")
        report = self.apply_verdicts([explicit], today="2026-11-04")
        self.assertEqual(report["removed"][0]["reason"], "official page now says it never existed")

    def test_recheck_without_new_post_does_not_extend_freshness(self):
        self.apply_verdicts([self.verdict(date="2026-11-01")], today="2026-11-01")
        recheck = dict(self.verdict(rid="lead-01", date="2026-11-01"), lead_slug="acme-ai-free-tokens-week")
        report = self.apply_verdicts([recheck], today="2026-11-04")
        self.assertEqual(report["refreshed"], ["acme-ai-free-tokens-week"])
        self.assertEqual(self.stored("2026-11-04")["acme-ai-free-tokens-week"]["last_seen"], "2026-11-04")
        report = self.apply_verdicts([recheck], today="2026-11-05")
        self.assertEqual(report["removed"][0]["reason"],
                         "stale: newest post 2026-11-01 is more than 3 days old")

    def test_live_but_not_shortlisted_is_kept_and_reported(self):  # N3
        self.apply_verdicts([self.verdict()])
        live = {"id": "lead-01", "lead_slug": "acme-ai-free-tokens-week", "label": "x", "verdict": "live",
                "action": "new", "reason": "official page confirms it"}
        report = self.apply_verdicts([live], shortlist={"selected": [], "rejected": [
            {"id": "lead-01", "reason": "below the value floor"}]})
        self.assertEqual(report["removed"], [])
        self.assertEqual(report["kept"][0]["slug"], "acme-ai-free-tokens-week")
        self.assertIn("below the value floor", report["kept"][0]["reason"])

    def test_empty_verdicts_prune_stale_leads(self):  # S7
        self.apply_verdicts([self.verdict(date="2026-11-02")])
        report = self.apply_verdicts([], today="2026-11-06")
        self.assertEqual([r["slug"] for r in report["removed"]], ["acme-ai-free-tokens-week"])
        self.assertEqual(list(self.leads.iterdir()), [])

    def test_open_and_queue_skip_stale_leads(self):
        self.apply_verdicts([self.verdict(date="2026-11-01")], today="2026-11-01")
        self.apply_verdicts([self.verdict(rid="x-02", title="Other", url="https://x.com/b/status/3",
                                          date="2026-11-03")])
        queue = self.cli("--queue", "5", "--today", "2026-11-03")
        self.assertEqual([c["lead_slug"] for c in queue], ["acme-ai-free-tokens-week", "acme-ai-other"])
        self.assertEqual(queue[0]["id"], "lead-01")
        opened = self.cli("--open", "--today", "2026-11-05")
        self.assertEqual([o["lead_slug"] for o in opened], ["acme-ai-other"])
        self.assertEqual(opened[0]["label"], "Acme AI — Other")


class CheckScopeTests(unittest.TestCase):
    def test_lead_paths_are_in_scope_and_validated(self):
        sys.path.insert(0, str(CHECK_SCOPE.parent))
        import check_scope  # noqa: E402
        self.assertIn("unverified/", check_scope.__doc__)
        self.assertIsNone(check_scope.check("D", "unverified/acme.yaml"))
        self.assertIn("out of scope", check_scope.check("R", "unverified/acme.yaml"))
        self.assertIn("not an offer, detail, lead", check_scope.check("A", "unverified/.gitkeep"))
        self.assertIn("not an offer, detail, lead", check_scope.check("A", "unverified/acme.yml"))


class RemoveMatchTests(unittest.TestCase):  # N6: offer-updater publishes the offer a lead named
    def test_remove_by_provider_and_program_or_slug(self):
        with tempfile.TemporaryDirectory() as tmp:
            for data in (lead(), lead(slug="acme-other", title="Other program")):
                Path(tmp, f"{data['slug']}.yaml").write_text(lead_model.dump_lead(data), encoding="utf-8")
            removed, remaining = lead_model.remove_match(tmp, "acme ai", "FREE TOKENS WEEK")
            self.assertEqual([Path(p).name for p in removed], ["acme-free-tokens.yaml"])
            self.assertEqual(remaining, ["acme-other: Other program"])
            out = io.StringIO()
            with redirect_stdout(out):
                lead_model.main(["remove-match", "--provider", "Acme AI", "--program", "nope",
                                 "--leads-dir", tmp])
            self.assertIn("open leads for Acme AI: acme-other: Other program", out.getvalue())
            removed, _ = lead_model.remove_match(tmp, "Acme AI", slug="acme-other")
            self.assertEqual(len(removed), 1)
            self.assertEqual(list(Path(tmp).iterdir()), [])


class BackfillTests(unittest.TestCase):
    def test_committed_leads_are_valid_and_never_offers(self):
        offers = {p.stem for p in (REPO / "offers").glob("*.yaml")}
        lead_model.load_leads(str(REPO / "unverified"), offers)


if __name__ == "__main__":
    unittest.main()
