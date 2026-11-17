"""Community offers (#748): promo codes and giveaways a person shared.

Covers the content gate (scripts/offer_model.py + validate_offers.py), the
build-time expiry on entries_close, the daily-offer-check skipping them, and
both scope checks rejecting them in hunter / daily-check PRs.
"""
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'scripts'))

import offer_model  # noqa: E402
import validate_offers  # noqa: E402

GIVEAWAY = (
    'title: Devin Max giveaway\n'
    'provider: Devin (Cognition)\n'
    'category: coding\n'
    'amount: one month of Devin Max per code ($200 value each)\n'
    'expiry_date: 2026-11-20\n'
    'source_url: https://x.com/ben_ai_eng/status/2122616807404052781\n'
    'verified_date: 2026-11-17\n'
    'verification: unverified\n'
    'review_status: unverified\n'
    'signup: required\n'
    'listing_type: community\n'
    'community_subtype: giveaway\n'
    'added_by: luong\n'
    'shared_by_handle: ben_ai_eng\n'
    'shared_by_name: Ben Newell\n'
    'shared_by_post_date: 2026-11-17\n'
    'codes_available: 10\n'
    'entries_close: 2026-11-20\n'
    'timezone_note: no time zone given\n'
)

PROMO = (
    'title: Acme promo code\n'
    'provider: Acme\n'
    'category: api_provider\n'
    'amount: $10 in credits\n'
    'expiry_date: null\n'
    'source_url: https://x.com/someone/status/1\n'
    'verified_date: 2026-11-17\n'
    'verification: unverified\n'
    'review_status: unverified\n'
    'signup: required\n'
    'listing_type: community\n'
    'community_subtype: promo_code\n'
    'added_by: luong\n'
    'shared_by_handle: someone\n'
    'shared_by_post_date: 2026-11-17\n'
    'promo_code: ACME-10\n'
)

REGULAR = (
    'title: "T"\nprovider: T\ncategory: api_provider\namount: $10\n'
    'expiry_date: null\nsource_url: https://example.com/offer\n'
    'verified_date: 2020-01-01\nverification: social_proof\n'
    'review_status: under-review\nsignup: required\n'
)


def parse(text):
    return offer_model.parse_offer_text(text, 'x.yaml')


def validate(text):
    return offer_model.validate_offer(parse(text), 'x.yaml')


def replace(text, key, value):
    """Set (value) or drop (value None) one key of a flat offer document."""
    lines = [l for l in text.splitlines() if not l.startswith(key + ':')]
    if value is not None:
        lines.append(f'{key}: {value}')
    return '\n'.join(lines) + '\n'


class ValidatorTests(unittest.TestCase):
    def test_giveaway_and_promo_code_validate(self):
        offer = validate(GIVEAWAY)
        self.assertEqual(offer['codes_available'], 10)
        self.assertEqual(offer['entries_close'], dt.date(2026, 11, 20))
        self.assertTrue(offer_model.is_community(offer))
        self.assertEqual(validate(PROMO)['promo_code'], 'ACME-10')

    def test_regular_offer_needs_no_change(self):
        self.assertFalse(offer_model.is_community(validate(REGULAR)))

    def test_rejections(self):
        cases = {
            'added_by must be luong': replace(GIVEAWAY, 'added_by', 'hunter'),
            'missing required fields: added_by': replace(GIVEAWAY, 'added_by', None),
            'only valid with listing_type': replace(GIVEAWAY, 'listing_type', None),
            'listing_type must be community': replace(GIVEAWAY, 'listing_type', 'offer'),
            'community_subtype must be one of': replace(GIVEAWAY, 'community_subtype', 'raffle'),
            'verification must be unverified': replace(GIVEAWAY, 'verification', 'social_proof'),
            'review_status must be unverified': replace(GIVEAWAY, 'review_status', 'verified'),
            'bare account handle': replace(GIVEAWAY, 'shared_by_handle', '@ben_ai_eng'),
            'expiry_date must equal entries_close': replace(GIVEAWAY, 'expiry_date', '2026-11-21'),
            'timezone_note is required': replace(GIVEAWAY, 'timezone_note', None),
            'codes_available must be a positive whole number': replace(GIVEAWAY, 'codes_available', 'ten'),
            'promo_code is only valid on a promo_code': replace(GIVEAWAY, 'promo_code', 'X1'),
            'promo_code is required': replace(PROMO, 'promo_code', None),
            'entries_close is only valid on a giveaway': replace(PROMO, 'entries_close', '2026-11-20'),
            'shared_by_post_date is in the future': replace(GIVEAWAY, 'shared_by_post_date', '2999-01-01'),
        }
        for message, text in cases.items():
            with self.subTest(message=message):
                with self.assertRaisesRegex(offer_model.OfferError, message):
                    validate(text)

    def test_committed_schema_matches_model(self):
        schema = validate_offers.load_schema(str(REPO / 'schemas/offer.schema.json'))
        validate_offers.check_schema_matches_build(schema)
        broken = json.loads(json.dumps(schema))
        broken['properties']['added_by']['enum'] = ['luong', 'anyone']
        with self.assertRaisesRegex(validate_offers.SchemaMismatch, 'added_by enum'):
            validate_offers.check_schema_matches_build(broken)

    def test_first_entry_is_committed_and_valid(self):
        path = REPO / 'offers/devin-max-one-month-code-giveaway.yaml'
        offer = offer_model.validate_offer(parse(path.read_text()), str(path))
        self.assertEqual(offer['added_by'], 'luong')
        self.assertEqual(offer['community_subtype'], 'giveaway')
        self.assertEqual(offer['shared_by_handle'], 'ben_ai_eng')
        self.assertEqual(offer['codes_available'], 10)
        self.assertEqual(offer['entries_close'], dt.date(2026, 11, 20))
        self.assertEqual(offer['timezone_note'], 'no time zone given')


class ExpiryAndIndexTests(unittest.TestCase):
    def offer(self, text=GIVEAWAY):
        offer = validate(text)
        offer['slug'] = 'devin'
        return offer

    def test_giveaway_expires_after_entries_close_day(self):
        offer = self.offer()
        self.assertFalse(offer_model.is_expired(offer, dt.date(2026, 11, 20)))
        self.assertTrue(offer_model.is_expired(offer, dt.date(2026, 11, 21)))

    def test_promo_code_without_stated_expiry_never_expires(self):
        self.assertFalse(offer_model.is_expired(self.offer(PROMO), dt.date(2099, 1, 1)))

    def test_index_nests_community(self):
        index = offer_model.build_index([self.offer()], dt.date(2026, 11, 20))
        row = index['offers'][0]
        self.assertEqual(row['status'], 'active')
        self.assertEqual(row['listing_type'], 'community')
        self.assertEqual(row['community'], {
            'subtype': 'giveaway', 'added_by': 'luong',
            'shared_by': {'handle': 'ben_ai_eng', 'name': 'Ben Newell',
                          'post_url': 'https://x.com/ben_ai_eng/status/2122616807404052781',
                          'post_date': '2026-11-17'},
            'codes_available': 10, 'entries_close': '2026-11-20',
            'timezone_note': 'no time zone given'})
        later = offer_model.build_index([self.offer()], dt.date(2026, 11, 21))
        self.assertEqual(later['offers'][0]['status'], 'expired')

    def test_regular_index_row_has_no_community_keys(self):
        offer = validate(REGULAR)
        offer['slug'] = 'r'
        row = offer_model.build_index([offer])['offers'][0]
        self.assertNotIn('listing_type', row)
        self.assertNotIn('community', row)

    def test_committed_index_carries_the_first_entry(self):
        index = json.loads((REPO / 'index.json').read_text())
        row = next(o for o in index['offers'] if o['slug'] == 'devin-max-one-month-code-giveaway')
        self.assertEqual(row['listing_type'], 'community')
        self.assertEqual(row['community']['subtype'], 'giveaway')
        self.assertEqual(row['community']['entries_close'], '2026-11-20')


def git(repo, *args):
    env = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t',
               GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')
    result = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(repo), *args],
                            capture_output=True, text=True, env=env)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout


class DailyOfferCheckTests(unittest.TestCase):
    SCRIPTS = REPO / 'skills/daily-offer-check/scripts'

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve()

    def run_cli(self, script, *args, ok=True):
        result = subprocess.run([sys.executable, str(self.SCRIPTS / script), *map(str, args)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if ok else 1, result.stderr + result.stdout)
        return result

    def test_inventory_skips_community_listings(self):
        offers = self.root / 'offers'
        offers.mkdir()
        (offers / 'devin.yaml').write_text(GIVEAWAY)
        (offers / 'regular.yaml').write_text(REGULAR)
        inventory = json.loads(self.run_cli('list_active.py', '--today', '2026-11-18',
                                            '--offers-dir', offers).stdout)
        self.assertEqual([o['slug'] for o in inventory['offers']], ['regular'])
        self.assertEqual(inventory['skipped_community'], ['devin'])
        # Named explicitly, a community slug is still skipped, never checked.
        named = json.loads(self.run_cli('list_active.py', '--today', '2026-11-18',
                                        '--offers-dir', offers, '--slugs', 'devin').stdout)
        self.assertEqual(named['offers'], [])
        # A verdict for it is a coverage error: the sweep cannot write to it.
        inv = self.root / 'inv.json'
        inv.write_text(json.dumps(inventory))
        verdicts = self.root / 'v.json'
        row = {'slug': 'regular', 'verdict': 'unverifiable', 'evidence_url': '', 'quote': '',
               'reason': 'r', 'updates': {}, 'references': []}
        verdicts.write_text(json.dumps([row, dict(row, slug='devin')]))
        result = self.run_cli('check_coverage.py', inv, verdicts, ok=False)
        self.assertIn('extra=[\'devin\']', result.stderr)

    def test_apply_refuses_a_hand_edited_inventory_row(self):
        offers = self.root / 'offers'
        offers.mkdir()
        (offers / 'devin.yaml').write_text(GIVEAWAY)
        before = (offers / 'devin.yaml').read_bytes()
        sys.path.insert(0, str(self.SCRIPTS))
        from list_active import record  # noqa: E402
        row, _ = record(offers.resolve(), offers.resolve() / 'devin.yaml')
        inventory = dict(today=dt.date.today().isoformat(), offers_dir=str(offers.resolve()),
                         active_count=1, skipped_expired=[], skipped_community=[], offers=[row])
        verdict = {'slug': 'devin', 'verdict': 'unverifiable', 'evidence_url': '', 'quote': '',
                   'reason': 'r', 'updates': {}, 'references': []}
        inv, ver = self.root / 'inv.json', self.root / 'v.json'
        inv.write_text(json.dumps(inventory))
        ver.write_text(json.dumps([verdict]))
        result = self.run_cli('apply_verdicts.py', '--today', inventory['today'], '--offers-dir',
                              offers, '--inventory', inv, '--verdicts', ver, ok=False)
        self.assertIn('community listing in inventory', result.stderr)
        self.assertEqual((offers / 'devin.yaml').read_bytes(), before)

    def make_repo(self):
        repo = self.root / 'repo'
        (repo / 'offers/details').mkdir(parents=True)
        (repo / 'offers/devin.yaml').write_text(GIVEAWAY)
        (repo / 'offers/regular.yaml').write_text(REGULAR)
        git(repo, 'init', '-q')
        git(repo, 'add', '-A')
        git(repo, 'commit', '-qm', 'base')
        return repo

    def test_scope_rejects_touching_a_community_listing(self):
        cases = {
            'verified_date bump': lambda r: (r / 'offers/devin.yaml').write_text(
                GIVEAWAY.replace('verified_date: 2026-11-17', 'verified_date: 2026-11-18')),
            'reference trace': lambda r: (r / 'offers/details/devin.json').write_text(
                json.dumps({'summary': 'S'}) + '\n'),
        }
        for name, change in cases.items():
            with self.subTest(name=name):
                repo = self.make_repo()
                change(repo)
                git(repo, 'add', '-A')
                result = self.run_cli('check_scope.py', '--repo', repo, '--staged', ok=False)
                self.assertIn('community listing; the sweep never touches one', result.stderr)
                shutil.rmtree(repo)

    def test_scope_still_allows_regular_bumps(self):
        repo = self.make_repo()
        (repo / 'offers/regular.yaml').write_text(
            REGULAR.replace('verified_date: 2020-01-01', 'verified_date: 2020-02-01'))
        git(repo, 'add', '-A')
        self.assertIn('OK scope', self.run_cli('check_scope.py', '--repo', repo, '--staged').stdout)


class OfferHunterScopeTests(unittest.TestCase):
    """The hunter's check_scope.py resolves the repo from its own location, so
    each test runs a copy of the scripts inside a throwaway repository."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.repo = Path(tmp.name).resolve() / 'repo'
        (self.repo / 'scripts').mkdir(parents=True)
        for name in ('offer_model.py', 'lead_model.py'):
            shutil.copy(REPO / 'scripts' / name, self.repo / 'scripts' / name)
        shutil.copytree(REPO / 'schemas', self.repo / 'schemas')
        shutil.copytree(REPO / 'skills/offer-hunter/scripts',
                        self.repo / 'skills/offer-hunter/scripts')
        (self.repo / 'offers/details').mkdir(parents=True)
        (self.repo / 'offers/regular.yaml').write_text(REGULAR)
        git(self.repo, 'init', '-q')
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-qm', 'base')

    def scope(self, ok):
        git(self.repo, 'add', '-A')
        result = subprocess.run(
            [sys.executable, str(self.repo / 'skills/offer-hunter/scripts/check_scope.py')],
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if ok else 1, result.stderr)
        return result

    def test_hunter_cannot_create_a_community_listing(self):
        (self.repo / 'offers/devin.yaml').write_text(GIVEAWAY)
        self.assertIn('the offer-hunter never creates or edits one', self.scope(False).stderr)

    def test_hunter_cannot_edit_a_community_listing_or_its_details(self):
        (self.repo / 'offers/devin.yaml').write_text(GIVEAWAY)
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-qm', 'entry PR')
        (self.repo / 'offers/details/devin.json').write_text(json.dumps({'summary': 'S'}))
        self.assertIn('community listing', self.scope(False).stderr)
        git(self.repo, 'reset', '-q', '--hard')
        (self.repo / 'offers/devin.yaml').write_text(replace(GIVEAWAY, 'amount', '$1'))
        self.assertIn('community listing', self.scope(False).stderr)

    def test_hunter_still_adds_regular_offers(self):
        (self.repo / 'offers/new.yaml').write_text(REGULAR)
        self.assertIn('OK scope', self.scope(True).stdout)


if __name__ == '__main__':
    unittest.main()
