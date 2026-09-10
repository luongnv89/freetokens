"""Offline regression tests for the daily-offer-check bundled CLI."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SKILL = REPO / '.agents/skills/daily-offer-check'


class DailyOfferCheckTests(unittest.TestCase):
    def test_bundled_dependencies_exist(self):
        for name in ('scripts/list_active.py', 'scripts/check_coverage.py',
                     'scripts/apply_verdicts.py', 'agents/verifier.md',
                     'references/trust-policy.md', 'references/apply-and-pr.md'):
            with self.subTest(name=name):
                self.assertTrue((SKILL / name).is_file(), f'missing bundled dependency: {name}')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.offers = self.root / 'offers'
        self.offers.mkdir()

    def offer(self, slug, expiry='null', verified='2020-01-01'):
        path = self.offers / (slug + '.yaml')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes((f'# keep me\r\ntitle: "Test"\r\nprovider: Test\r\n'
                          f'category: api_provider\r\namount: $10\r\nexpiry_date: {expiry}\r\n'
                          f'source_url: https://example.com/offer\r\nverified_date: "{verified}"  \r\n'
                          'verification: unverified\r\nreview_status: unverified\r\nsignup: required\r\n').encode())
        return path

    def cli(self, script, *args, ok=True):
        result = subprocess.run([sys.executable, str(SKILL / 'scripts' / script), *map(str, args)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if ok else 1, result.stderr)
        return result

    def inventory(self, *args, ok=True):
        result = self.cli('list_active.py', '--today', '2020-02-01', '--offers-dir', self.offers, *args, ok=ok)
        return json.loads(result.stdout) if ok else result

    def verdict(self, slug, kind='live'):
        return dict(slug=slug, verdict=kind, evidence_url='https://example.com/offer',
                    quote='Specific official evidence', reason='Evidence conflict or unavailable')

    def batch(self, inventory, verdicts, ok=True, trusted=True):
        inv, ver = self.root / 'inventory.json', self.root / 'verdicts.json'
        inv.write_text(json.dumps(inventory))
        ver.write_text(json.dumps(verdicts))
        args = ['--today', '2020-02-01', '--inventory', inv, '--verdicts', ver]
        if trusted:
            args += ['--offers-dir', self.offers]
        return self.cli('apply_verdicts.py', *args, ok=ok)

    def test_fixture_pipeline_and_yaml_preservation(self):
        path = self.offer('one')
        before = path.read_bytes()
        inventory = self.inventory()
        verdicts = [self.verdict('one')]
        inv, ver = self.root / 'i.json', self.root / 'v.json'
        inv.write_text(json.dumps(inventory))
        ver.write_text(json.dumps(verdicts))
        self.assertEqual(self.cli('check_coverage.py', inv, ver).stdout.strip(), 'OK 1/1 slugs covered')
        result = json.loads(self.batch(inventory, verdicts).stdout)
        self.assertEqual(result['writes'], 1)
        self.assertEqual(result['applied'], [dict(slug='one', path='one.yaml', action='bumped')])
        self.assertEqual(path.read_bytes(), before.replace(b'2020-01-01', b'2020-02-01'))

    def test_expiry_boundary_and_order(self):
        self.offer('old', '2020-01-31')
        self.offer('today', '2020-02-01', '2020-01-02')
        self.offer('future', '2020-02-02')
        self.offer('ongoing')
        inventory = self.inventory()
        self.assertEqual([r['slug'] for r in inventory['offers']], ['future', 'ongoing', 'today'])
        self.assertEqual(inventory['skipped_expired'], ['old'])

    def test_filters(self):
        self.offer('one')
        self.offer('old', '2020-01-01')
        self.assertEqual(self.inventory('--slugs', 'old')['active_count'], 0)
        self.assertEqual(self.inventory('--slugs', 'one')['active_count'], 1)
        for slugs in ('missing', '../one', 'one,one', ''):
            with self.subTest(slugs=slugs):
                self.inventory('--slugs', slugs, ok=False)

    def test_empty_inventory(self):
        self.assertEqual(json.loads(self.batch(self.inventory(), []).stdout)['writes'], 0)

    def test_expired_updates_both_dates(self):
        path = self.offer('one')
        result = json.loads(self.batch(self.inventory(), [self.verdict('one', 'expired')]).stdout)
        self.assertEqual(result['applied'][0]['action'], 'expired')
        self.assertIn(b'expiry_date: 2020-02-01', path.read_bytes())
        self.assertIn(b'verified_date: "2020-02-01"', path.read_bytes())

    def test_conflict_and_unverifiable_do_not_write(self):
        for kind in ('conflict', 'unverifiable'):
            path = self.offer(kind)
            before = path.read_bytes()
            result = json.loads(self.batch(self.inventory('--slugs', kind), [self.verdict(kind, kind)]).stdout)
            self.assertEqual(result['writes'], 0)
            self.assertEqual(path.read_bytes(), before)

    def test_fresh_rerun_is_idempotent(self):
        self.offer('one')
        self.batch(self.inventory(), [self.verdict('one')])
        self.assertEqual(json.loads(self.batch(self.inventory(), [self.verdict('one')]).stdout)['writes'], 0)

    def test_stale_inventory_rejected(self):
        path = self.offer('one')
        inventory = self.inventory()
        path.write_bytes(path.read_bytes() + b'# changed\n')
        self.assertIn('stale inventory', self.batch(inventory, [self.verdict('one')], ok=False).stderr)

    def test_stale_later_record_prevents_all_writes(self):
        first = self.offer('one')
        second = self.offer('two')
        inventory = self.inventory()
        before = first.read_bytes()
        second.write_bytes(second.read_bytes() + b'# stale\n')
        self.batch(inventory, [self.verdict('one'), self.verdict('two')], ok=False)
        self.assertEqual(first.read_bytes(), before)

    def test_inventory_cannot_choose_write_root(self):
        self.offer('one')
        self.assertIn('trusted --offers-dir', self.batch(self.inventory(), [self.verdict('one')], trusted=False, ok=False).stderr)

    def test_invalid_batches_never_partially_write(self):
        path = self.offer('one')
        self.offer('two')
        before = path.read_bytes()
        cases = [[], [self.verdict('one')], [self.verdict('one'), self.verdict('one')],
                 [self.verdict('one'), self.verdict('two'), self.verdict('extra')],
                 [self.verdict('one'), dict(self.verdict('two'), verdict='bad')],
                 [self.verdict('one'), dict(self.verdict('two'), quote='')],
                 [self.verdict('one'), dict(self.verdict('two'), verdict=[])],
                 [self.verdict('one'), None], {},
                 [self.verdict('one'), dict(self.verdict('two'), path='../bad')]]
        for verdicts in cases:
            with self.subTest(verdicts=verdicts):
                self.batch(self.inventory(), verdicts, ok=False)
                self.assertEqual(path.read_bytes(), before)

    def test_malicious_inventory_paths(self):
        path = self.offer('one')
        before = path.read_bytes()
        for malicious in ('../one.yaml', '/tmp/one.yaml', 'sub/../../one.yaml', 'sub\\one.yaml'):
            with self.subTest(path=malicious):
                inventory = self.inventory()
                inventory['offers'][0]['path'] = malicious
                self.batch(inventory, [self.verdict('one')], ok=False)
                self.assertEqual(path.read_bytes(), before)

    def test_symlink_file_and_directory_rejected(self):
        path = self.offer('one')
        (self.offers / 'link.yaml').symlink_to(path)
        self.inventory(ok=False)
        (self.offers / 'link.yaml').unlink()
        inventory = self.inventory()
        path.unlink()
        target = self.root / 'target.yaml'
        target.write_text('do not touch')
        path.symlink_to(target)
        self.batch(inventory, [self.verdict('one')], ok=False)
        self.assertEqual(target.read_text(), 'do not touch')
        path.unlink()
        (self.offers / 'sub').symlink_to(self.root, target_is_directory=True)
        self.inventory(ok=False)

    def test_nested_paths_and_duplicate_slugs(self):
        self.offer('nested/one')
        self.assertEqual(self.inventory()['offers'][0]['path'], 'nested/one.yaml')
        self.offer('one')
        self.inventory(ok=False)

    def test_malformed_offer(self):
        path = self.offer('one')
        for text in ('title: only\n', 'title: a\ntitle: b\n', 'nested:\n  child: no\n'):
            path.write_text(text)
            self.inventory(ok=False)

    def test_invalid_inventory_records(self):
        self.offer('one')
        for key, value in [('active_count', True), ('offers', [None]), ('skipped_expired', [None]), ('today', 'bad')]:
            inventory = self.inventory()
            inventory[key] = value
            self.batch(inventory, [self.verdict('one')], ok=False)

    def test_duplicate_json_keys(self):
        inv, ver = self.root / 'i.json', self.root / 'v.json'
        inv.write_text('{"today":"2020-02-01","today":"2020-02-02"}')
        ver.write_text('[]')
        self.assertIn('duplicate JSON key', self.cli('check_coverage.py', inv, ver, ok=False).stderr)
