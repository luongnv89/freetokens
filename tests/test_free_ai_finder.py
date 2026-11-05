"""Tests for the free-ai-finder skill's catalog script (skills/free-ai-finder).

The script parses the site's markdown twins, so these fixtures pin the line
format that app/scripts/generate-markdown.mjs writes. No test touches the
network: --index-file and --details-dir stand in for the live site.
"""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SKILL = REPO / "skills" / "free-ai-finder"
SCRIPT = SKILL / "scripts" / "catalog_match.py"
TODAY = "2026-11-05"
SITE = "https://freetokens.custats.info/offers"

INDEX_MD = f"""# Free AI Credits

> Every currently-claimable free AI credit offer.

7 live offers · 0 expired in the archive · rebuilt 2026-11-05T13:40:07Z.

## Offers

- [Acme TTS Free Plan]({SITE}/acme-tts-free.md): Acme Voice — 10,000 TTS characters per month (free plan) (voice) · review_status=verified · verification=social_proof · signup=required · last_checked=2026-11-05
- [Old Voice Promo]({SITE}/old-voice-promo.md): OldCo — $20 voice credit (launch week) (voice) · review_status=unverified · verification=social_proof · signup=required · last_checked=2026-11-04
- [Gateway Credits]({SITE}/gateway-credits.md): GateAI — $5 credit for LLMs and text-to-speech models (api_provider) · review_status=under-review · verification=social_proof · signup=required · last_checked=2026-11-05
- [Voice Startup Grant]({SITE}/voice-startup-grant.md): GrantCo — Up to $10,000 for Voice AI startups (startup_program) · review_status=to-be-verified · verification=social_proof · signup=required · last_checked=2026-11-05
- [Editor Pro for Students]({SITE}/editor-students.md): EditorCo — Pro plan free for 1 year (student) · review_status=verified · verification=social_proof · signup=required · last_checked=2026-11-05
- [Bar [beta\\] TTS]({SITE}/bar-beta-tts.md): Bar Labs — 1M tts characters (beta) — then paid (voice) · review_status=unverified · verification=unverified · signup=none · last_checked=2026-11-03
- [Broken line]({SITE}/broken.md): no category or labels here

## Trust labels

- [Ignored link]({SITE}/ignored.md): Nobody — $1 (voice) · review_status=verified · verification=social_proof · signup=none · last_checked=2026-11-05
"""

DETAILS = {
    "acme-tts-free": """# Acme TTS Free Plan

## Details

- Status: active — enrollment deadline: none (ongoing)
- Source: https://acme.example/pricing

## The offer

Acme gives every account 10,000 TTS characters per month. No credit card required.

## How to claim

1. Sign up at acme.example.
2. Copy an API key from the dashboard.
""",
    "old-voice-promo": """# Old Voice Promo

## Details

- Status: active — enrollment deadline: 2026-10-01
- Source: https://old.example/promo
""",
    "gateway-credits": """# Gateway Credits

## Details

- Status: active — enrollment deadline: 2026-12-31
- Source: https://gate.example/pricing

## The offer

New accounts get $5. A valid credit card is required to activate the credit.
""",
    "bar-beta-tts": """# Bar [beta] TTS

## Details

- Status: active — enrollment deadline: none (ongoing)
- Source: https://bar.example/beta
""",
}


def load_module():
    spec = importlib.util.spec_from_file_location("catalog_match", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CatalogMatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.index = root / "index.md"
        self.index.write_text(INDEX_MD, encoding="utf-8")
        self.details = root / "details"
        self.details.mkdir()
        for slug, text in DETAILS.items():
            (self.details / f"{slug}.md").write_text(text, encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args, cwd=None):
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            capture_output=True, text=True, cwd=str(cwd or REPO),
        )
        return proc.returncode, proc.stdout, proc.stderr

    def run_fixture(self, *args):
        code, out, err = self.run_script(
            "--index-file", str(self.index), "--details-dir", str(self.details),
            "--today", TODAY, *args,
        )
        self.assertEqual(code, 0, err)
        return json.loads(out)

    def test_bundled_files_exist(self):
        for rel in ("SKILL.md", "agents/web-scout.md", "references/claim-coach.md",
                    "references/output-format.md", "references/trust-rules.md",
                    "references/web-tools.md", "evals/evals.json", "LICENSE"):
            self.assertTrue((SKILL / rel).is_file(), rel)
        head = (SKILL / "SKILL.md").read_text(encoding="utf-8").split("---")[1]
        self.assertIn("name: free-ai-finder", head)

    def test_ranks_need_matches_and_attaches_details(self):
        data = self.run_fixture("--categories", "voice", "--keywords", "tts,text-to-speech")
        self.assertEqual(data["source"], "file")
        self.assertEqual(data["catalog_built"], "2026-11-05T13:40:07Z")
        self.assertEqual(data["catalog_active"], 6)
        slugs = [m["slug"] for m in data["matches"]]
        self.assertEqual(slugs, ["acme-tts-free", "bar-beta-tts", "gateway-credits"])
        acme = data["matches"][0]
        self.assertEqual(acme["score"], 5)
        self.assertIsNone(acme["deadline"])
        self.assertEqual(acme["source_url"], "https://acme.example/pricing")
        self.assertEqual(acme["claim_steps"], ["Sign up at acme.example.",
                                               "Copy an API key from the dashboard."])
        self.assertEqual(acme["card"], "no-card")
        self.assertIn("No credit card required", acme["card_basis"])
        self.assertEqual(acme["page_url"], "https://freetokens.custats.info/offers/acme-tts-free.html")
        gateway = data["matches"][2]
        self.assertEqual(gateway["card"], "card")
        self.assertEqual(gateway["deadline"], "2026-12-31")

    def test_passed_deadline_is_excluded(self):
        data = self.run_fixture("--categories", "voice", "--keywords", "tts")
        self.assertNotIn("old-voice-promo", [m["slug"] for m in data["matches"]])
        self.assertEqual(data["excluded"], [
            {"slug": "old-voice-promo", "reason": "claim deadline 2026-10-01 has passed"}])

    def test_gated_programs_need_eligibility_and_a_keyword(self):
        data = self.run_fixture("--categories", "voice", "--keywords", "voice")
        self.assertEqual([g["slug"] for g in data["gated"]], ["voice-startup-grant"])
        self.assertNotIn("voice-startup-grant", [m["slug"] for m in data["matches"]])
        self.assertNotIn("editor-students", json.dumps(data))
        eligible = self.run_fixture("--categories", "voice", "--keywords", "voice",
                                    "--eligible", "startup")
        self.assertIn("voice-startup-grant", [m["slug"] for m in eligible["matches"]])
        self.assertEqual(eligible["gated"], [])

    def test_escaped_title_and_section_bounds(self):
        data = self.run_fixture("--categories", "voice", "--keywords", "tts")
        titles = {m["slug"]: m["title"] for m in data["matches"]}
        self.assertEqual(titles["bar-beta-tts"], "Bar [beta] TTS")
        self.assertNotIn("ignored", json.dumps(data))
        self.assertIn("1 catalog lines did not parse and were skipped", data["warnings"])

    def test_generic_keywords_are_ignored(self):
        data = self.run_fixture("--categories", "voice", "--keywords", "ai,free,tts")
        self.assertEqual(data["profile"]["keywords"], ["tts"])
        self.assertIn("ignored generic keywords: ai, free", data["warnings"])

    def test_max_caps_matches(self):
        data = self.run_fixture("--categories", "voice", "--keywords", "tts", "--max", "1")
        self.assertEqual([m["slug"] for m in data["matches"]], ["acme-tts-free"])

    def test_card_state_rules(self):
        cm = load_module()
        self.assertEqual(cm.card_state("Sign up, no card required.")[0], "no-card")
        self.assertEqual(cm.card_state("A credit card is required at signup.")[0], "card")
        self.assertEqual(cm.card_state("Add a card after the credits run out.")[0], "unknown")
        self.assertEqual(
            cm.card_state("Whether a credit card is required is unconfirmed.")[0], "unknown")
        self.assertEqual(cm.card_state("Some premium models require a card.")[0], "unknown")

    def test_fetch_refuses_other_hosts(self):
        cm = load_module()
        with self.assertRaises(cm.SourceError) as ctx:
            cm.fetch("https://example.com/index.md", 100)
        self.assertIn("only https://freetokens.custats.info/", str(ctx.exception))
        with self.assertRaises(cm.SourceError):
            cm.fetch("http://freetokens.custats.info/index.md", 100)

    def test_bad_category_names_it_and_the_fix(self):
        code, _, err = self.run_script("--index-file", str(self.index),
                                       "--categories", "student", "--keywords", "tts")
        self.assertEqual(code, 1)
        self.assertIn("unknown category 'student'", err)
        self.assertIn("--eligible", err)

    def test_nothing_to_match(self):
        code, _, err = self.run_script("--index-file", str(self.index), "--keywords", "ai,free")
        self.assertEqual(code, 1)
        self.assertIn("nothing to match", err)
        self.assertIn("Fix:", err)

    def test_missing_index_file(self):
        code, _, err = self.run_script("--index-file", str(self.index) + ".missing",
                                       "--categories", "voice")
        self.assertEqual(code, 1)
        self.assertIn("does not exist", err)

    def test_unparseable_catalog_fails_with_format_hint(self):
        self.index.write_text("# Free AI Credits\n\n## Offers\n\n- nothing here\n", encoding="utf-8")
        code, _, err = self.run_script("--index-file", str(self.index), "--categories", "voice")
        self.assertEqual(code, 1)
        self.assertIn("format may have changed", err)

    def test_local_source_reads_active_offers_and_details(self):
        root = Path(self.tmp.name) / "checkout"
        (root / "offers" / "details").mkdir(parents=True)
        (root / "index.json").write_text(json.dumps({
            "generated_at": "2026-11-05T09:00:00Z",
            "offers": [
                {"slug": "live-tts", "title": "Live TTS", "provider": "LiveCo",
                 "category": "voice", "amount": "$10 TTS credit", "expiry_date": None,
                 "source_url": "https://live.example", "verified_date": "2026-11-05",
                 "verification": "social_proof", "review_status": "verified",
                 "signup": "required", "status": "active"},
                {"slug": "gone-tts", "title": "Gone TTS", "provider": "GoneCo",
                 "category": "voice", "amount": "$10 TTS credit", "expiry_date": "2026-01-01",
                 "source_url": "https://gone.example", "verified_date": "2026-01-01",
                 "verification": "social_proof", "review_status": "verified",
                 "signup": "required", "status": "expired"},
            ],
        }), encoding="utf-8")
        (root / "offers" / "details" / "live-tts.json").write_text(json.dumps({
            "summary": "Ten dollars, no credit card needed.",
            "claim_steps": ["Sign up.", "Create a key."],
        }), encoding="utf-8")
        code, out, err = self.run_script("--source", "local", "--categories", "voice",
                                         "--today", TODAY, cwd=root)
        self.assertEqual(code, 0, err)
        data = json.loads(out)
        self.assertEqual(data["source"], "local")
        self.assertEqual([m["slug"] for m in data["matches"]], ["live-tts"])
        self.assertEqual(data["matches"][0]["claim_steps"], ["Sign up.", "Create a key."])
        self.assertEqual(data["matches"][0]["card"], "no-card")


if __name__ == "__main__":
    unittest.main()
