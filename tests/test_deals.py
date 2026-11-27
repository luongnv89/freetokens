"""Deal offer kind and deal-hunt window (#809).

Every date here is injected (``today=`` / ``--today`` / ``--date``): no test
reads the real clock, so the suite passes under CI's +400-day clock shift.
The only deal file used is the test fixture in tests/fixtures/deals/, a
fictional example.com deal that is never published.
"""

import contextlib
import datetime as dt
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import deal_model  # noqa: E402
import deal_window  # noqa: E402
import validate_offers  # noqa: E402
from offer_model import parse_offer_text  # noqa: E402

FIXTURE = REPO / "tests" / "fixtures" / "deals" / "example-ai-pro-black-friday.yaml"
FIXTURE_TEXT = FIXTURE.read_text(encoding="utf-8")
WORDING = json.loads((REPO / "tests" / "fixtures" / "deal-free-wording.json").read_text(encoding="utf-8"))
LOAD_DEALS = REPO / "app" / "scripts" / "load-deals.mjs"
TODAY = dt.date(2026, 11, 28)


def fixture_data(**overrides):
    data = parse_offer_text(FIXTURE_TEXT, str(FIXTURE))
    for key, value in overrides.items():
        if value is ...:
            data.pop(key, None)
        else:
            data[key] = value
    return data


def validate(today=TODAY, name="example-ai-pro-black-friday.yaml", **overrides):
    return deal_model.validate_deal(fixture_data(**overrides), name, today)


def git(repo, *args):
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
               GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
    result = subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-C", str(repo), *args],
                            capture_output=True, text=True, env=env)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout


class DealValidatorTests(unittest.TestCase):
    def test_fixture_is_a_valid_deal(self):
        deal = validate()
        self.assertEqual(deal["slug"], "example-ai-pro-black-friday")
        self.assertEqual(deal["discount"], "50% off the first year")
        self.assertEqual(deal["occasion"], "black_friday")
        self.assertNotIn("amount", deal)

    def test_every_required_field_is_enforced(self):
        for field in deal_model.REQUIRED_FIELDS:
            with self.subTest(field=field):
                with self.assertRaisesRegex(deal_model.DealError, f"missing required field.*{field}"):
                    validate(**{field: ...})

    def test_expiry_date_is_required_and_never_null(self):
        with self.assertRaisesRegex(deal_model.DealError, "expiry_date is required and cannot be null"):
            validate(expiry_date=None)
        with self.assertRaisesRegex(deal_model.DealError, "expiry_date must be a YYYY-MM-DD"):
            validate(expiry_date="2 Dec 2026")

    def test_category_must_be_in_deal_scope(self):
        for category in deal_model.CATEGORIES:
            with self.subTest(ok=category):
                self.assertEqual(validate(category=category)["category"], category)
        for category in ("api_provider", "coding", "image", "student", "hardware", "vpn"):
            with self.subTest(bad=category):
                with self.assertRaisesRegex(deal_model.DealError, "outside the deal scope"):
                    validate(category=category)

    def test_occasion_enum(self):
        for occasion in deal_model.OCCASIONS:
            self.assertEqual(validate(occasion=occasion)["occasion"], occasion)
        with self.assertRaisesRegex(deal_model.DealError, "occasion 'prime_day'"):
            validate(occasion="prime_day")

    def test_free_keys_are_rejected(self):
        for key in ("amount", "is_free", "free"):
            with self.subTest(key=key):
                with self.assertRaisesRegex(deal_model.DealError, "a deal is never free"):
                    validate(**{key: "free"})

    def test_free_wording_is_rejected(self):
        cases = {
            "discount": ["Free for 3 months", "100% off", "first month FREE", "no-cost upgrade"],
            "title": ["Example AI Pro free trial"],
            "deal_price": ["Free"],
            "description": ["Get it at no charge."],
        }
        for field, values in cases.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    with self.assertRaisesRegex(deal_model.DealError, "never .*free"):
                        validate(**{field: value})
        # "freedom" is not free wording.
        self.assertEqual(validate(title="Freedom Plan — 30% off")["title"], "Freedom Plan — 30% off")

    def test_expiry_note_free_wording_is_rejected(self):
        with self.assertRaisesRegex(deal_model.DealError, "expiry_note says 'Free'"):
            validate(expiry_note="Free until the window ends.")

    def test_promo_code_naming_the_deal_free_is_rejected(self):
        for code in ("FREE", "free", "FREE50", "BFFREE", "GRATIS-2026", "NOCOST",
                     # strict on purpose: a free word inside a longer code is rejected too
                     "FREEDOM50", "CAREFREE",
                     # 100% off
                     "100OFF", "100-OFF", "100_OFF", "100off", "100POFF", "100PCTOFF",
                     "100-PCT-OFF", "100PERCENTOFF", "BF100OFF", "BF-100-OFF"):
            with self.subTest(code=code):
                with self.assertRaisesRegex(deal_model.DealError, "promo_code .* labels the deal free"):
                    validate(promo_code=code)
        for code in ("BF-50_OFF", "50OFF", "1000OFF", "2100OFF", "OFF100", "BF100", "100-PLAN"):
            with self.subTest(code=code):
                self.assertEqual(validate(promo_code=code)["promo_code"], code)

    def test_length_limits_count_code_points(self):
        # An emoji is one code point (Python len, JSON Schema maxLength) but two
        # UTF-16 units; app/scripts/load-deals.mjs must count it the same way.
        limit = deal_model.LIMITS["title"]
        at_limit = "\N{PARTY POPPER}" + "a" * (limit - 1)
        self.assertEqual(validate(title=at_limit)["title"], at_limit)
        with self.assertRaisesRegex(deal_model.DealError, "title is longer than"):
            validate(title=at_limit + "a")

    def test_deal_price_must_be_non_zero(self):
        for value in ("$0", "0.00 EUR", "$0/month"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(deal_model.DealError, "no non-zero amount"):
                    validate(deal_price=value)
        self.assertEqual(validate(deal_price="$10/month")["deal_price"], "$10/month")

    def test_optional_fields_may_be_absent(self):
        deal = validate(regular_price=..., deal_price=..., promo_code=..., start_date=...,
                        expiry_note=..., description=...)
        self.assertEqual(set(deal), {"slug", *deal_model.REQUIRED_FIELDS})

    def test_unknown_fields_and_bad_values(self):
        with self.assertRaisesRegex(deal_model.DealError, "unknown field.*verification"):
            validate(verification="social_proof")
        with self.assertRaisesRegex(deal_model.DealError, "start_date .* is after expiry_date"):
            validate(start_date="2026-12-05")
        with self.assertRaisesRegex(deal_model.DealError, "https"):
            validate(source_url="http://example.com/pricing")
        with self.assertRaisesRegex(deal_model.DealError, "promo_code"):
            validate(promo_code="TWO WORDS")
        with self.assertRaisesRegex(deal_model.DealError, "file name"):
            validate(name="Bad_Name.yaml")

    def test_verified_date_uses_the_injected_clock(self):
        validate(today=dt.date(2026, 11, 27))
        with self.assertRaisesRegex(deal_model.DealError, "verified_date 2026-11-27 is in the future"):
            validate(today=dt.date(2026, 11, 26))

    def test_expiry_boundaries(self):
        deal = validate()
        self.assertFalse(deal_model.is_expired(deal, dt.date(2026, 12, 2)))  # last day: shown
        self.assertTrue(deal_model.is_expired(deal, dt.date(2026, 12, 3)))  # next day: hidden

    def test_future_start_date_is_valid_but_hidden_until_it_starts(self):
        # The validator accepts a deal that has not started yet ...
        deal = validate(today=dt.date(2026, 11, 27), start_date="2026-11-30")
        self.assertEqual(deal["start_date"], "2026-11-30")
        # ... and the build lists it only from its start_date (fixture: 2026-11-20).
        deal = validate()
        for day, upcoming, listed in (
            (dt.date(2026, 11, 19), True, False),  # day before start: hidden
            (dt.date(2026, 11, 20), False, True),  # start day: shown
            (dt.date(2026, 12, 2), False, True),  # expiry day: shown
            (dt.date(2026, 12, 3), False, False),  # day after expiry: hidden
        ):
            with self.subTest(day=day):
                self.assertEqual(deal_model.is_upcoming(deal, day), upcoming)
                self.assertEqual(deal_model.is_listed(deal, day), listed)
        no_start = validate(start_date=...)
        self.assertFalse(deal_model.is_upcoming(no_start, dt.date(2000, 1, 1)))
        self.assertTrue(deal_model.is_listed(no_start, dt.date(2000, 1, 1)))


class FreeWordingParityTests(unittest.TestCase):
    """deal_model.py and load-deals.mjs judge free wording identically (#809)."""

    def test_shared_corpus(self):
        for text in WORDING["free"]:
            with self.subTest(text=text):
                self.assertIsNotNone(deal_model.free_wording(text))
        for text in WORDING["not_free"]:
            with self.subTest(text=text):
                self.assertIsNone(deal_model.free_wording(text))

    def test_space_class_is_exactly_the_corpus_set(self):
        space = re.compile("[" + deal_model.RULES["free_wording_space"] + "]")
        matched = {cp for cp in range(0x110000) if space.fullmatch(chr(cp))}
        self.assertEqual(matched, set(WORDING["space_codepoints"]))
        # Every character Python calls whitespace is covered (fail closed).
        native = {cp for cp in range(0x110000) if chr(cp).isspace()}
        self.assertLessEqual(native, matched)
        for cp in WORDING["space_codepoints"]:
            with self.subTest(cp=hex(cp)):
                self.assertIsNotNone(deal_model.free_wording(f"100{chr(cp)}% off"))
        self.assertIsNotNone(deal_model.free_wording("100\u00a0% off"))

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_python_and_node_agree_on_every_bmp_character(self):
        texts = list(WORDING["free"]) + list(WORDING["not_free"])
        for cp in range(0x10000):
            c = chr(cp)
            texts += [f"100{c}% off", f"no{c}cost", f"{c}free{c}"]
        script = (
            "import { freeWording } from " + json.dumps(LOAD_DEALS.as_uri()) + ";"
            "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>"
            "process.stdout.write(JSON.stringify(JSON.parse(s).map(t=>freeWording(t)!==null))));"
        )
        result = subprocess.run(["node", "--input-type=module", "-e", script],
                                input=json.dumps(texts), capture_output=True, text=True,
                                encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        node = json.loads(result.stdout)
        python = [deal_model.free_wording(t) is not None for t in texts]
        mismatches = [(ascii(t), p, n) for t, p, n in zip(texts, python, node) if p != n]
        self.assertEqual(mismatches[:10], [])


# featured (#815): raw values as the flat YAML parser hands them over.
# Empty and the YAML null tokens are an absent field: not featured.
FEATURED_NOT_FEATURED = ["false", "", "null", "~"]
FEATURED_ACCEPTED = {"true": True, '"true"': True, "'true'": True,
                     **dict.fromkeys(FEATURED_NOT_FEATURED, None)}
FEATURED_REJECTED = ["yes", "no", "1", "0", "True", "FALSE", "on", "featured", "true!"]


class FeaturedFlagTests(unittest.TestCase):
    """Optional boolean ``featured`` (#815): default false, booleans only."""

    def test_absent_means_not_featured(self):
        self.assertNotIn("featured", validate())

    def test_true_is_carried_and_false_is_dropped(self):
        self.assertIs(validate(featured="true")["featured"], True)
        self.assertNotIn("featured", validate(featured="false"))
        self.assertIs(validate(featured=True)["featured"], True)
        self.assertNotIn("featured", validate(featured=False))
        # A null value is an absent optional field, as for every other field.
        self.assertNotIn("featured", validate(featured=None))

    def test_non_boolean_values_are_rejected(self):
        for value in FEATURED_REJECTED + [1, 0, "", ["true"]]:
            with self.subTest(value=value):
                with self.assertRaisesRegex(deal_model.DealError, "featured must be true or false"):
                    validate(featured=value)

    def test_flat_yaml_file_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / FIXTURE.name
            path.write_text(FIXTURE_TEXT + "featured: true\n", encoding="utf-8")
            self.assertIs(deal_model.load_deal(str(path), TODAY)["featured"], True)
            path.write_text(FIXTURE_TEXT + "featured: yes\n", encoding="utf-8")
            with self.assertRaisesRegex(deal_model.DealError, "featured"):
                deal_model.load_deal(str(path), TODAY)

    def test_schema_declares_a_boolean_defaulting_to_false(self):
        schema = validate_offers.load_schema(str(REPO / "schemas" / "deal.schema.json"))
        self.assertEqual(schema["properties"]["featured"]["type"], "boolean")
        self.assertIs(schema["properties"]["featured"]["default"], False)
        self.assertNotIn("featured", schema["required"])
        broken = json.loads(json.dumps(schema))
        broken["properties"]["featured"]["type"] = "string"
        with self.assertRaises(validate_offers.SchemaMismatch):
            validate_offers.check_deal_schema_matches_model(broken)
        index = json.loads((REPO / "schemas" / "offers-index.schema.json").read_text())
        self.assertIs(index["$defs"]["Deal"]["properties"]["featured"]["const"], True)

    def test_featured_label_is_not_free_wording(self):
        self.assertIsNone(deal_model.free_wording("Featured"))

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_python_and_node_agree(self):
        values = list(FEATURED_ACCEPTED) + FEATURED_REJECTED
        script = (
            "import { parseDealText, validateDeal } from " + json.dumps(LOAD_DEALS.as_uri()) + ";"
            "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
            "const {text, file, today, values}=JSON.parse(s);"
            "process.stdout.write(JSON.stringify(values.map(v=>{"
            "try{return validateDeal(parseDealText(text+'featured: '+v+'\\n',file),file,today).featured??null}"
            "catch(e){return 'rejected'}})))});"
        )
        payload = {"text": FIXTURE_TEXT, "file": str(FIXTURE), "today": TODAY.isoformat(), "values": values}
        result = subprocess.run(["node", "--input-type=module", "-e", script],
                                input=json.dumps(payload), capture_output=True, text=True,
                                encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        node = json.loads(result.stdout)
        python = []
        for value in values:
            data = parse_offer_text(FIXTURE_TEXT + f"featured: {value}\n", str(FIXTURE))
            try:
                python.append(deal_model.validate_deal(data, str(FIXTURE), TODAY).get("featured"))
            except deal_model.DealError:
                python.append("rejected")
        self.assertEqual(python, node)
        self.assertEqual(python[: len(FEATURED_ACCEPTED)], list(FEATURED_ACCEPTED.values()))
        self.assertEqual(set(python[len(FEATURED_ACCEPTED):]), {"rejected"})
        not_featured = dict(zip(values, python))
        self.assertEqual([not_featured[v] for v in FEATURED_NOT_FEATURED],
                         [None] * len(FEATURED_NOT_FEATURED))

    def test_featuring_unfeaturing_or_removing_a_deal_file_stays_valid(self):
        # Fixture-only: a published deal ending or losing its flag never fails CI.
        with tempfile.TemporaryDirectory() as tmp:
            deals_dir = Path(tmp) / "deals"
            deals_dir.mkdir()
            path = deals_dir / FIXTURE.name
            argv = ["validate", "--deals-dir", str(deals_dir), "--today", TODAY.isoformat()]
            path.write_text(FIXTURE_TEXT + "featured: true\n", encoding="utf-8")
            self.assertEqual([d.get("featured") for d in deal_model.load_deals(str(deals_dir), (), TODAY)],
                             [True])
            path.write_text(FIXTURE_TEXT, encoding="utf-8")
            self.assertEqual([d.get("featured") for d in deal_model.load_deals(str(deals_dir), (), TODAY)],
                             [None])
            path.unlink()
            self.assertEqual(deal_model.load_deals(str(deals_dir), (), TODAY), [])
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(deal_model.main(argv), 0)


class DealLoaderTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name) / "deals"
        self.dir.mkdir()
        shutil.copy(FIXTURE, self.dir / FIXTURE.name)
        (self.dir / ".gitkeep").write_text("")

    def test_loads_expired_deals_as_valid_files(self):
        deals = deal_model.load_deals(str(self.dir), (), dt.date(2027, 6, 1))
        self.assertEqual([d["slug"] for d in deals], ["example-ai-pro-black-friday"])

    def test_missing_folder_is_empty(self):
        self.assertEqual(deal_model.load_deals(str(self.dir / "nope"), (), TODAY), [])

    def test_validate_offers_counts_upcoming_deals(self):
        result = subprocess.run(
            [sys.executable, "scripts/validate_offers.py", "--deals-dir", str(self.dir),
             "--today", "2026-11-27"],
            capture_output=True, text=True, cwd=str(REPO))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("validated 1 deals: OK\n", result.stdout)
        (self.dir / FIXTURE.name).write_text(FIXTURE_TEXT.replace("start_date: 2026-11-20",
                                                                  "start_date: 2026-11-30"))
        result = subprocess.run(
            [sys.executable, "scripts/validate_offers.py", "--deals-dir", str(self.dir),
             "--today", "2026-11-27"],
            capture_output=True, text=True, cwd=str(REPO))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("validated 1 deals: OK (1 upcoming, hidden at build)", result.stdout)

    def test_slug_may_not_name_an_offer(self):
        with self.assertRaisesRegex(deal_model.DealError, "is also an offer"):
            deal_model.load_deals(str(self.dir), {"example-ai-pro-black-friday"}, TODAY)

    def test_stray_file_fails(self):
        (self.dir / "notes.txt").write_text("x")
        with self.assertRaisesRegex(deal_model.DealError, "unexpected entry"):
            deal_model.load_deals(str(self.dir), (), TODAY)

    def test_validate_offers_cli_gates_deals(self):
        def run(*extra):
            return subprocess.run(
                [sys.executable, "scripts/validate_offers.py", "--deals-dir", str(self.dir),
                 "--today", TODAY.isoformat(), *extra],
                capture_output=True, text=True, cwd=str(REPO))
        ok = run()
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertIn("validated 1 deals: OK", ok.stdout)
        (self.dir / "bad-deal.yaml").write_text(FIXTURE_TEXT.replace("category: ai_subscription",
                                                                     "category: image"))
        bad = run()
        self.assertEqual(bad.returncode, 1)
        self.assertIn("bad-deal.yaml: category 'image' is outside the deal scope", bad.stderr)

    def test_deal_model_cli(self):
        result = subprocess.run(
            [sys.executable, "scripts/deal_model.py", "validate", "--today", "2027-01-10", str(FIXTURE)],
            capture_output=True, text=True, cwd=str(REPO))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("expired (hidden at build)", result.stdout)
        result = subprocess.run(
            [sys.executable, "scripts/deal_model.py", "validate", "--today", "2026-11-27",
             "--deals-dir", str(FIXTURE.parent)],
            capture_output=True, text=True, cwd=str(REPO))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("active", result.stdout)


class DealSchemaTests(unittest.TestCase):
    def test_schema_matches_model(self):
        schema = validate_offers.load_schema(str(REPO / "schemas" / "deal.schema.json"))
        validate_offers.check_deal_schema_matches_model(schema)
        broken = json.loads(json.dumps(schema))
        broken["properties"]["category"]["enum"].append("image")
        with self.assertRaises(validate_offers.SchemaMismatch):
            validate_offers.check_deal_schema_matches_model(broken)

    def test_index_schema_marks_deals(self):
        schema = json.loads((REPO / "schemas" / "offers-index.schema.json").read_text())
        deal = schema["$defs"]["Deal"]
        self.assertEqual(deal["properties"]["kind"], {"const": "deal", "description": deal["properties"]["kind"]["description"]})
        self.assertEqual(deal["properties"]["category"]["enum"], list(deal_model.CATEGORIES))
        self.assertNotIn("amount", deal["properties"])


class DealWindowTests(unittest.TestCase):
    def run_cli(self, *args):
        result = subprocess.run([sys.executable, "scripts/deal_window.py", *args],
                                capture_output=True, text=True, cwd=str(REPO))
        payload = json.loads(result.stdout) if result.stdout.strip() else None
        return result.returncode, payload, result.stderr

    def test_black_friday_window_is_open(self):
        code, payload, _ = self.run_cli("--date", "2026-11-27")
        self.assertEqual(code, 0)
        self.assertEqual(payload["occasion"], "black_friday")
        self.assertEqual(payload["window_end"], "2026-12-03")
        self.assertEqual(payload["covers"], ["black_friday", "cyber_monday"])

    def test_window_edges_and_year_crossing(self):
        cases = {
            "2026-11-19": None, "2026-11-20": ("black_friday", "2026-12-03"),
            "2026-12-03": ("black_friday", "2026-12-03"), "2026-12-04": None,
            "2026-12-15": ("christmas_new_year", "2027-01-02"),
            "2027-01-01": ("christmas_new_year", "2027-01-02"),
            "2027-01-02": ("christmas_new_year", "2027-01-02"), "2027-01-03": None,
            "2028-02-29": None, "2031-11-25": ("black_friday", "2031-12-03"),
        }
        for day, expected in cases.items():
            with self.subTest(day=day):
                code, payload, _ = self.run_cli("--date", day)
                if expected is None:
                    self.assertEqual(code, 3)
                    self.assertEqual(payload, {"date": day, "occasion": "none", "window_end": None})
                else:
                    self.assertEqual(code, 0)
                    self.assertEqual((payload["occasion"], payload["window_end"]), expected)

    def test_bad_date_exits_2(self):
        code, payload, err = self.run_cli("--date", "2026-02-30")
        self.assertEqual(code, 2)
        self.assertIsNone(payload)
        self.assertIn("YYYY-MM-DD", err)

    def test_config_is_validated(self):
        bad = {
            "overlap": '- id: black_friday\n  label: a\n  start: "11-20"\n  end: "12-03"\n  covers: black_friday\n'
                       '- id: christmas_new_year\n  label: b\n  start: "12-01"\n  end: "12-31"\n  covers: christmas_new_year\n',
            "unknown id": '- id: prime_day\n  label: a\n  start: "07-10"\n  end: "07-12"\n  covers: other\n',
            "bad day": '- id: black_friday\n  label: a\n  start: "02-29"\n  end: "03-02"\n  covers: black_friday\n',
            "missing key": '- id: black_friday\n  label: a\n  start: "11-20"\n  covers: black_friday\n',
        }
        for name, text in bad.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp, "occasions.yaml")
                path.write_text(text)
                code, payload, err = self.run_cli("--date", "2026-11-27", "--config", str(path))
                self.assertEqual(code, 2, err)
                self.assertIn("Error:", err)

    def test_repo_config_covers_only_deal_occasions(self):
        windows = deal_window.load_occasions()
        self.assertEqual({w["id"] for w in windows}, {"black_friday", "christmas_new_year"})
        for window in windows:
            self.assertTrue(set(window["covers"]) <= set(deal_model.OCCASIONS))


class DealScopeTests(unittest.TestCase):
    """check_scope.py --mode deals, run from a copy inside a throwaway repo."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.repo = Path(tmp.name).resolve() / "repo"
        (self.repo / "scripts").mkdir(parents=True)
        for name in ("offer_model.py", "lead_model.py", "deal_model.py"):
            shutil.copy(REPO / "scripts" / name, self.repo / "scripts" / name)
        shutil.copytree(REPO / "schemas", self.repo / "schemas")
        shutil.copytree(REPO / "skills/offer-hunter/scripts", self.repo / "skills/offer-hunter/scripts")
        (self.repo / "offers").mkdir()
        (self.repo / "deals").mkdir()
        (self.repo / "offers/regular.yaml").write_text(
            "title: R\nprovider: R\ncategory: coding\namount: $5 in credits\nexpiry_date: null\n"
            "source_url: https://r.example/\nverified_date: 2026-01-01\nverification: social_proof\n"
            "review_status: verified\nsignup: none\n")
        (self.repo / "index.json").write_text("{}\n")
        git(self.repo, "init", "-q")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "base")

    def scope(self, *args):
        git(self.repo, "add", "-A")
        return subprocess.run(
            [sys.executable, str(self.repo / "skills/offer-hunter/scripts/check_scope.py"), *args],
            capture_output=True, text=True)

    def test_deal_hunt_may_add_deals_and_regenerate_index(self):
        shutil.copy(FIXTURE, self.repo / "deals" / FIXTURE.name)
        (self.repo / "index.json").write_text('{"deals": []}\n')
        result = self.scope("--mode", "deals", "--today", TODAY.isoformat())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("OK scope (2 staged paths, deals)", result.stdout)

    def test_deal_hunt_may_remove_a_deal(self):
        shutil.copy(FIXTURE, self.repo / "deals" / FIXTURE.name)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "deal")
        (self.repo / "deals" / FIXTURE.name).unlink()
        self.assertEqual(self.scope("--mode", "deals", "--today", TODAY.isoformat()).returncode, 0)

    def test_deal_hunt_may_not_touch_offers(self):
        (self.repo / "offers/regular.yaml").write_text(
            (self.repo / "offers/regular.yaml").read_text().replace("$5", "$6"))
        result = self.scope("--mode", "deals", "--today", TODAY.isoformat())
        self.assertEqual(result.returncode, 1)
        self.assertIn("outside the deal-hunter scope", result.stderr)
        self.assertIn("offers/regular.yaml: a deal hunt may only touch deals/", result.stderr)

    def test_deal_hunt_rejects_an_invalid_deal(self):
        (self.repo / "deals/free-thing.yaml").write_text(FIXTURE_TEXT.replace(
            "discount: 50% off the first year", "discount: Free for a year"))
        result = self.scope("--mode", "deals", "--today", TODAY.isoformat())
        self.assertEqual(result.returncode, 1)
        self.assertIn("never labelled free", result.stderr)

    def test_offer_hunt_may_not_touch_deals(self):
        shutil.copy(FIXTURE, self.repo / "deals" / FIXTURE.name)
        result = self.scope()
        self.assertEqual(result.returncode, 1)
        self.assertIn("deal files belong to a deal hunt", result.stderr)


class DealHunterSkillTests(unittest.TestCase):
    SKILL = REPO / "skills" / "deal-hunter"

    def test_skill_files_exist_and_name_matches(self):
        text = (self.SKILL / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: deal-hunter\n"))
        self.assertTrue((self.SKILL / "references" / "brief.md").is_file())
        for needle in ("deal_window.py", "check_scope.py --mode deals", "expiry_note",
                       "scripts/deal_model.py validate", "Never set `featured`"):
            self.assertIn(needle, text)

    def test_fixture_is_never_published(self):
        self.assertFalse((REPO / "deals" / FIXTURE.name).exists())
        self.assertFalse((REPO / "offers" / FIXTURE.name).exists())


if __name__ == "__main__":
    unittest.main()
