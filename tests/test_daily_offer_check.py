"""Offline regression tests for the daily-offer-check bundled CLI."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SKILL = REPO / '.agents/skills/daily-offer-check'

OFFER_YAML = ('title: "T"\nprovider: T\ncategory: api_provider\namount: $10\n'
              'expiry_date: null\nsource_url: https://example.com/offer\n'
              'verified_date: 2020-01-01\nverification: unverified\n'
              'review_status: unverified\nsignup: required\n')


class DailyOfferCheckTests(unittest.TestCase):
    def test_bundled_dependencies_exist(self):
        for name in ('scripts/list_active.py', 'scripts/check_coverage.py',
                     'scripts/check_scope.py', 'scripts/apply_verdicts.py',
                     'scripts/render_report.py', 'scripts/prepare_branch.py',
                     'agents/verifier.md', 'references/trust-policy.md',
                     'references/apply-and-pr.md', 'references/review-and-merge.md'):
            with self.subTest(name=name):
                self.assertTrue((SKILL / name).is_file(), f'missing bundled dependency: {name}')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.offers = self.root / 'offers'
        self.offers.mkdir()

    def offer(self, slug, expiry='null', verified='2020-01-01',
              source='https://example.com/offer', title='"Test"'):
        path = self.offers / (slug + '.yaml')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes((f'# keep me\r\ntitle: {title}\r\nprovider: Test\r\n'
                          f'category: api_provider\r\namount: $10\r\nexpiry_date: {expiry}\r\n'
                          f'source_url: {source}\r\nverified_date: "{verified}"  \r\n'
                          'verification: unverified\r\nreview_status: unverified\r\nsignup: required\r\n').encode())
        return path

    def detail(self, slug, doc, compact=False):
        path = self.offers / 'details' / (slug + '.json')
        path.parent.mkdir(parents=True, exist_ok=True)
        if compact:
            path.write_text(json.dumps(doc, ensure_ascii=False, sort_keys=True))
        else:
            path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n')
        return path

    def cli(self, script, *args, ok=True):
        result = subprocess.run([sys.executable, str(SKILL / 'scripts' / script), *map(str, args)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if ok else 1, result.stderr)
        return result

    def inventory(self, *args, ok=True):
        result = self.cli('list_active.py', '--today', '2020-02-01', '--offers-dir', self.offers, *args, ok=ok)
        return json.loads(result.stdout) if ok else result

    def verdict(self, slug, kind='live', updates=None, references=None, evidence_url='https://example.com/offer'):
        if references is None:
            references = ([] if kind in ('conflict', 'unverifiable')
                          else [dict(url=evidence_url, title='Official page',
                                     text='Specific official evidence')])
        return dict(slug=slug, verdict=kind, evidence_url=evidence_url,
                    quote='Specific official evidence', reason='Evidence conflict or unavailable',
                    updates=updates or {}, references=references)

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
        self.assertEqual(result['writes'], 2)
        self.assertEqual(result['applied'], [dict(slug='one', path='one.yaml', action='bumped'),
                                             dict(slug='one', path='details/one.json', action='references')])
        self.assertEqual(result['references'], [dict(slug='one', path='details/one.json', created=True,
                                                     added=1, refreshed=0, dropped=0)])
        self.assertEqual(result['results'], [dict(slug='one', path='one.yaml', action='bumped', changes=[])])
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
        self.assertEqual(result['results'][0]['action'], 'expired')
        self.assertIn(b'expiry_date: 2020-02-01', path.read_bytes())
        self.assertIn(b'verified_date: "2020-02-01"', path.read_bytes())
        self.assertTrue((self.offers / 'details/one.json').is_file())

    def test_conflict_and_unverifiable_do_not_write(self):
        for kind in ('conflict', 'unverifiable'):
            path = self.offer(kind)
            before = path.read_bytes()
            result = json.loads(self.batch(self.inventory('--slugs', kind), [self.verdict(kind, kind)]).stdout)
            self.assertEqual(result['writes'], 0)
            self.assertFalse((self.offers / 'details' / (kind + '.json')).exists())
            self.assertEqual(path.read_bytes(), before)

    def test_fresh_rerun_is_idempotent(self):
        self.offer('one')
        self.batch(self.inventory(), [self.verdict('one')])
        result = json.loads(self.batch(self.inventory(), [self.verdict('one')]).stdout)
        self.assertEqual(result['writes'], 0)
        self.assertEqual(result['applied'], [])
        self.assertEqual(result['references'], [])
        self.assertEqual(result['results'][0]['action'], 'unchanged')

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
                 [self.verdict('one'), dict(self.verdict('two'), updates=None)],
                 [self.verdict('one'), dict(self.verdict('two'), references='x')],
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

    def test_live_updates_rewrite_terms(self):
        path = self.offer('one')
        before = path.read_bytes()
        updates = dict(title='New Title', amount='$20 in credits',
                       expiry_date='2021-06-30', signup='none')
        result = json.loads(self.batch(self.inventory(), [self.verdict('one', updates=updates)]).stdout)
        entry = result['results'][0]
        self.assertEqual(entry['action'], 'updated')
        self.assertEqual(entry['changes'], [
            {'field': 'title', 'from': 'Test', 'to': 'New Title'},
            {'field': 'amount', 'from': '$10', 'to': '$20 in credits'},
            {'field': 'expiry_date', 'from': None, 'to': '2021-06-30'},
            {'field': 'signup', 'from': 'required', 'to': 'none'},
        ])
        expected = (before
                    .replace(b'title: "Test"', b'title: "New Title"')
                    .replace(b'amount: $10', b'amount: $20 in credits')
                    .replace(b'expiry_date: null', b'expiry_date: 2021-06-30')
                    .replace(b'signup: required', b'signup: none')
                    .replace(b'verified_date: "2020-01-01"', b'verified_date: "2020-02-01"'))
        self.assertEqual(path.read_bytes(), expected)

    def test_rejected_updates_never_write(self):
        path = self.offer('one')
        before = path.read_bytes()
        for kind in ('expired', 'conflict', 'unverifiable'):
            with self.subTest(kind=kind):
                self.batch(self.inventory(), [self.verdict('one', kind, updates={'title': 'X'})], ok=False)
                self.assertEqual(path.read_bytes(), before)
        for field in ('category', 'provider', 'source_url', 'verification', 'review_status'):
            with self.subTest(field=field):
                self.batch(self.inventory(), [self.verdict('one', updates={field: 'x'})], ok=False)
                self.assertEqual(path.read_bytes(), before)
        for value in ('', ' padded', 'two\nlines', 'null', '~', 'x' * 301, 5):
            with self.subTest(value=value):
                self.batch(self.inventory(), [self.verdict('one', updates={'amount': value})], ok=False)
                self.assertEqual(path.read_bytes(), before)
        for value in ('2020-01-31', 'not-a-date', 20200101):
            with self.subTest(expiry=value):
                self.batch(self.inventory(), [self.verdict('one', updates={'expiry_date': value})], ok=False)
                self.assertEqual(path.read_bytes(), before)
        for value in ('maybe', 1):
            with self.subTest(signup=value):
                self.batch(self.inventory(), [self.verdict('one', updates={'signup': value})], ok=False)
                self.assertEqual(path.read_bytes(), before)
        elsewhere = 'https://example.org/offer'
        result = self.batch(self.inventory(), [self.verdict(
            'one', updates={'title': 'X'}, evidence_url=elsewhere)], ok=False)
        self.assertIn('official source', result.stderr)
        self.assertEqual(path.read_bytes(), before)

    def test_x_evidence_must_match_source_account(self):
        path = self.offer('one', source='https://x.com/acme/status/1')
        before = path.read_bytes()
        ok = self.verdict('one', updates={'title': 'New'},
                          evidence_url='https://x.com/acme/status/2')
        self.batch(self.inventory(), [ok])
        path.write_bytes(before)
        bad = self.verdict('one', updates={'title': 'New'},
                           evidence_url='https://x.com/other/status/3')
        self.assertIn('official source', self.batch(self.inventory(), [bad], ok=False).stderr)
        self.assertEqual(path.read_bytes(), before)

    def test_update_quoting_round_trip(self):
        path = self.offer('one', title='Plain')
        self.batch(self.inventory(), [self.verdict('one', updates={'title': '"Pro" plan "Plus"'})])
        self.assertIn(b'title: ""Pro" plan "Plus""\r\n', path.read_bytes())
        self.assertEqual(self.inventory()['offers'][0]['title'], '"Pro" plan "Plus"')
        path2 = self.offer('two', title="'Single'")
        self.batch(self.inventory('--slugs', 'two'), [self.verdict('two', updates={'title': 'Changed'})])
        self.assertIn(b"title: 'Changed'\r\n", path2.read_bytes())
        path3 = self.offer('three', expiry='2030-01-01')
        self.batch(self.inventory('--slugs', 'three'), [self.verdict('three', updates={'expiry_date': None})])
        self.assertIn(b'expiry_date: null\r\n', path3.read_bytes())

    def test_merge_references_into_existing_detail(self):
        self.offer('one')
        doc = {
            'summary': 'Existing summary.',
            'claim_steps': ['Step one.', 'Step two.'],
            'social_proof': [
                {'type': 'x', 'url': 'https://x.com/someone/status/9', 'author': 'A', 'text': 'Proof.'},
                {'type': 'link', 'url': 'https://example.com/offer/', 'title': 'Old title', 'text': 'Old text.'},
            ],
        }
        path = self.detail('one', doc)
        verdict = self.verdict('one', references=[
            dict(url='https://example.com/offer', title='Official page', text='Specific official evidence'),
            dict(url='https://example.com/blog', title='Blog', text='Extra detail.'),
        ])
        result = json.loads(self.batch(self.inventory(), [verdict]).stdout)
        merged = json.loads(path.read_text())
        self.assertEqual(len(merged['social_proof']), 3)
        self.assertEqual(merged['social_proof'][0], doc['social_proof'][0])
        self.assertEqual(merged['social_proof'][1], doc['social_proof'][1])
        self.assertEqual(merged['social_proof'][2], dict(type='link', url='https://example.com/blog',
                                                         title='Blog', text='Extra detail.'))
        self.assertEqual(merged['summary'], 'Existing summary.')
        self.assertEqual(merged['claim_steps'], ['Step one.', 'Step two.'])
        self.assertEqual(result['references'], [dict(slug='one', path='details/one.json', created=False,
                                                     added=1, refreshed=0, dropped=0)])
        self.assertIn('\n  "', path.read_text())
        self.assertTrue(path.read_text().endswith('\n'))

    def test_compact_detail_stays_single_line_sorted(self):
        self.offer('one')
        doc = {'summary': 'S.', 'social_proof': [
            {'type': 'link', 'url': 'https://example.com/a', 'title': 'A', 'text': 'a'}]}
        path = self.detail('one', doc, compact=True)
        self.batch(self.inventory(), [self.verdict('one')])
        text = path.read_text()
        self.assertNotIn('\n', text)
        self.assertEqual(json.loads(text), json.loads(json.dumps(
            {'summary': 'S.', 'social_proof': doc['social_proof'] + [
                {'type': 'link', 'url': 'https://example.com/offer', 'title': 'Official page',
                 'text': 'Specific official evidence'}]}, sort_keys=True)))
        self.assertEqual(list(json.loads(text)), ['social_proof', 'summary'])
        self.assertIn('{"text": "Specific official evidence", "title": "Official page", '
                      '"type": "link", "url": "https://example.com/offer"}', text)

    def test_missing_detail_created(self):
        self.offer('one')
        result = json.loads(self.batch(self.inventory(), [self.verdict('one')]).stdout)
        path = self.offers / 'details/one.json'
        self.assertTrue(path.is_file())
        doc = json.loads(path.read_text())
        self.assertEqual(doc['social_proof'], [dict(type='link', url='https://example.com/offer',
                                                    title='Official page', text='Specific official evidence')])
        self.assertEqual(result['references'][0]['created'], True)

    def test_reference_refresh_only_when_offer_updated(self):
        self.offer('one')
        doc = {'social_proof': [{'type': 'link', 'url': 'https://example.com/offer',
                                 'title': 'Old', 'text': 'Old text.'}]}
        path = self.detail('one', doc)
        newer = [dict(url='https://example.com/offer', title='New', text='New text.')]
        self.batch(self.inventory(), [self.verdict('one', references=newer)])
        self.assertEqual(json.loads(path.read_text())['social_proof'][0]['title'], 'Old')
        result = json.loads(self.batch(self.inventory(), [
            self.verdict('one', updates={'amount': '$99'}, references=newer)]).stdout)
        self.assertEqual(result['results'][0]['action'], 'updated')
        self.assertEqual(json.loads(path.read_text())['social_proof'][0],
                         dict(type='link', url='https://example.com/offer', title='New', text='New text.'))
        self.assertEqual(result['references'][0]['refreshed'], 1)

    def test_reference_cap_drops_newest_appends(self):
        self.offer('one')
        existing = [{'type': 'link', 'url': f'https://example.com/p{i}', 'title': f'T{i}', 'text': 't'}
                    for i in range(9)]
        path = self.detail('one', {'social_proof': existing})
        refs = [dict(url='https://example.com/offer', title='Official page', text='Specific official evidence')]
        refs += [dict(url=f'https://example.com/n{i}', title=f'N{i}', text='t') for i in range(2)]
        result = json.loads(self.batch(self.inventory(), [self.verdict('one', references=refs)]).stdout)
        proofs = json.loads(path.read_text())['social_proof']
        self.assertEqual(proofs[:9], existing)
        self.assertEqual(proofs[9]['url'], 'https://example.com/offer')
        self.assertEqual(result['references'][0], dict(slug='one', path='details/one.json', created=False,
                                                       added=1, refreshed=0, dropped=2))

    def test_invalid_references_rejected(self):
        path = self.offer('one')
        before = path.read_bytes()
        ref = dict(url='https://example.com/offer', title='T', text='x')
        cases = [
            [],
            [dict(url='https://example.com/other', title='T', text='x')],
            [ref] * 6,
            [dict(ref, extra='k')],
            [dict(ref, url='https://example.com/' + 'x' * 200)],
            [dict(ref, text='x' * 501)],
            [dict(ref, title='x' * 201)],
            [dict(ref, title='  ')],
            [ref, dict(ref, url='https://example.com/offer/')],
            'notalist',
        ]
        for refs in cases:
            with self.subTest(refs=str(refs)[:80]):
                self.batch(self.inventory(), [self.verdict('one', references=refs)], ok=False)
                self.assertEqual(path.read_bytes(), before)
        self.batch(self.inventory(), [self.verdict('one', 'conflict', references=[ref])], ok=False)
        self.assertEqual(path.read_bytes(), before)

    def test_invalid_existing_detail_aborts_batch(self):
        path = self.offer('one')
        path2 = self.offer('two')
        before, before2 = path.read_bytes(), path2.read_bytes()
        detail = self.detail('two', {'summary': 'ok'})
        detail.write_text('{"summary": "ok", "bogus": 1}')
        self.batch(self.inventory(), [self.verdict('one'), self.verdict('two')], ok=False)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(path2.read_bytes(), before2)
        self.assertFalse((self.offers / 'details/one.json').exists())

    def test_symlink_detail_rejected(self):
        path = self.offer('one')
        before = path.read_bytes()
        target = self.root / 'target.json'
        target.write_text('{}')
        details = self.offers / 'details'
        details.mkdir()
        (details / 'one.json').symlink_to(target)
        self.batch(self.inventory(), [self.verdict('one')], ok=False)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(target.read_text(), '{}')

    def git(self, repo, *args):
        env = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t',
                   GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')
        result = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(repo), *args],
                                capture_output=True, text=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    DETAIL = {'summary': 'S', 'claim_steps': ['a'],
              'social_proof': [{'type': 'link', 'url': 'https://example.com/offer',
                                'title': 'T', 'text': 'x'},
                               {'type': 'x', 'url': 'https://x.com/a/status/1',
                                'author': 'A', 'text': 'p'}]}

    def make_repo(self):
        self.repo_count = getattr(self, 'repo_count', 0) + 1
        repo = self.root / f'repo{self.repo_count}'
        (repo / 'offers/details').mkdir(parents=True)
        (repo / 'app/public').mkdir(parents=True)
        (repo / 'offers/one.yaml').write_text(OFFER_YAML)
        (repo / 'offers/two.yaml').write_text(OFFER_YAML)
        (repo / 'offers/details/one.json').write_text(json.dumps(self.DETAIL, indent=2) + '\n')
        (repo / 'index.json').write_text('{"offers": []}\n')
        self.git(repo, 'init', '-q')
        self.git(repo, 'add', '-A')
        self.git(repo, 'commit', '-qm', 'base')
        return repo

    def run_scope(self, repo, mode, ok=True):
        self.git(repo, 'add', '-A')
        args = ['--staged'] if mode == 'staged' else []
        if mode == 'range':
            self.git(repo, 'commit', '-qm', 'sweep')
            args = ['--base', 'HEAD~1', '--head', 'HEAD']
        return self.cli('check_scope.py', '--repo', repo, *args, ok=ok)

    def test_scope_ok(self):
        for mode in ('staged', 'range'):
            with self.subTest(mode=mode):
                repo = self.make_repo()
                yaml = repo / 'offers/one.yaml'
                yaml.write_text(OFFER_YAML.replace('verified_date: 2020-01-01', 'verified_date: 2020-02-01')
                                .replace('amount: $10', 'amount: $20'))
                (repo / 'offers/details/two.json').write_text(json.dumps({'summary': 'S'}) + '\n')
                (repo / 'index.json').write_text('{"offers": [], "count": 1}\n')
                result = self.run_scope(repo, mode)
                self.assertIn('OK scope: 3 files (1 offers, 1 details, 1 artifacts)', result.stdout)

    def test_scope_violations(self):
        def mutate_detail(doc):
            def change(repo):
                (repo / 'offers/details/one.json').write_text(json.dumps(doc, indent=2) + '\n')
            return change
        dropped = dict(self.DETAIL, social_proof=self.DETAIL['social_proof'][:1])
        renamed = dict(self.DETAIL, summary='Changed')
        cases = {
            'added offer': lambda r: (r / 'offers/new.yaml').write_text(OFFER_YAML),
            'deleted offer': lambda r: (r / 'offers/two.yaml').unlink(),
            'category change': lambda r: (r / 'offers/one.yaml').write_text(
                OFFER_YAML.replace('api_provider', 'coding')),
            'review_status change': lambda r: (r / 'offers/one.yaml').write_text(
                OFFER_YAML.replace('review_status: unverified', 'review_status: verified')),
            'detail dropped entry': mutate_detail(dropped),
            'detail summary change': mutate_detail(renamed),
            'detail unknown slug': lambda r: (r / 'offers/details/ghost.json').write_text('{"summary": "s"}'),
            'out of scope file': lambda r: ((r / 'app/src').mkdir(),
                                            (r / 'app/src/x.ts').write_text('x')),
        }
        for name, mutate in cases.items():
            for mode in ('staged', 'range'):
                with self.subTest(case=name, mode=mode):
                    repo = self.make_repo()
                    mutate(repo)
                    result = self.run_scope(repo, mode, ok=False)
                    self.assertIn('Scope failed:', result.stderr)
                    self.assertNotIn('OK scope', result.stdout)

    SWEEP = 'chore/daily-offer-check-2020-02-01'

    def make_clone(self):
        seed = self.make_repo()
        self.git(seed, 'branch', '-M', 'main')
        origin = self.root / f'origin{self.repo_count}.git'
        work = self.root / f'work{self.repo_count}'
        self.git(self.root, 'clone', '-q', '--bare', str(seed), str(origin))
        self.git(self.root, 'clone', '-q', str(origin), str(work))
        return origin, work

    def spawn(self, origin):
        self.repo_count += 1
        clone = self.root / f'work{self.repo_count}'
        self.git(self.root, 'clone', '-q', str(origin), str(clone))
        return clone

    def prepare(self, work, ok=True):
        return self.cli('prepare_branch.py', '--repo', work, '--today', '2020-02-01', ok=ok)

    def test_prepare_creates_from_origin_main(self):
        origin, work = self.make_clone()
        result = self.prepare(work)
        self.assertIn(f'OK branch {self.SWEEP}', result.stdout)
        self.assertIn('created from origin/main', result.stdout)
        self.assertEqual(self.git(work, 'rev-parse', '--abbrev-ref', 'HEAD').strip(), self.SWEEP)
        self.assertEqual(self.git(work, 'rev-parse', 'HEAD').strip(),
                         self.git(work, 'rev-parse', 'origin/main').strip())
        no_upstream = subprocess.run(['git', '-C', str(work), 'config', '--get',
                                      f'branch.{self.SWEEP}.merge'], capture_output=True)
        self.assertNotEqual(no_upstream.returncode, 0)

    def test_prepare_fast_forwards_stale_leftover_to_pushed_attempt(self):
        origin, work = self.make_clone()
        self.git(work, 'branch', self.SWEEP, 'origin/main')
        other = self.spawn(origin)
        (other / 'skill-v2.txt').write_text('v2\n')
        self.git(other, 'add', 'skill-v2.txt')
        self.git(other, 'commit', '-qm', 'v2')
        self.git(other, 'push', 'origin', 'main')
        self.git(other, 'checkout', '-q', '-b', self.SWEEP)
        yaml = other / 'offers/one.yaml'
        yaml.write_text(yaml.read_text().replace('2020-01-01', '2020-02-01'))
        self.git(other, 'add', 'offers/one.yaml')
        self.git(other, 'commit', '-qm', 'sweep')
        self.git(other, 'push', 'origin', self.SWEEP)
        pushed = self.git(other, 'rev-parse', 'HEAD').strip()
        result = self.prepare(work)
        self.assertIn(f'fast-forwarded to origin/{self.SWEEP}', result.stdout)
        self.assertEqual(self.git(work, 'rev-parse', 'HEAD').strip(), pushed)
        self.assertTrue((work / 'skill-v2.txt').is_file())

    def test_prepare_fast_forwards_unpushed_leftover_to_origin_main(self):
        origin, work = self.make_clone()
        self.git(work, 'branch', self.SWEEP, 'origin/main')
        other = self.spawn(origin)
        (other / 'next.txt').write_text('next\n')
        self.git(other, 'add', 'next.txt')
        self.git(other, 'commit', '-qm', 'next')
        self.git(other, 'push', 'origin', 'main')
        new_main = self.git(other, 'rev-parse', 'HEAD').strip()
        result = self.prepare(work)
        self.assertIn('fast-forwarded to origin/main', result.stdout)
        self.assertEqual(self.git(work, 'rev-parse', 'HEAD').strip(), new_main)

    def test_prepare_keeps_local_commits_ahead(self):
        origin, work = self.make_clone()
        self.git(work, 'checkout', '-q', '-b', self.SWEEP)
        (work / 'wip.txt').write_text('wip\n')
        self.git(work, 'add', 'wip.txt')
        self.git(work, 'commit', '-qm', 'wip')
        ahead = self.git(work, 'rev-parse', 'HEAD').strip()
        self.git(work, 'checkout', '-q', 'main')
        result = self.prepare(work)
        self.assertIn('ahead of origin/main', result.stdout)
        self.assertEqual(self.git(work, 'rev-parse', 'HEAD').strip(), ahead)

    def test_prepare_refuses_diverged_branch(self):
        origin, work = self.make_clone()
        self.git(work, 'checkout', '-q', '-b', self.SWEEP)
        (work / 'wip.txt').write_text('wip\n')
        self.git(work, 'add', 'wip.txt')
        self.git(work, 'commit', '-qm', 'wip')
        stale = self.git(work, 'rev-parse', 'HEAD').strip()
        self.git(work, 'checkout', '-q', 'main')
        other = self.spawn(origin)
        (other / 'next.txt').write_text('n\n')
        self.git(other, 'add', 'next.txt')
        self.git(other, 'commit', '-qm', 'next')
        self.git(other, 'push', 'origin', 'main')
        result = self.prepare(work, ok=False)
        self.assertIn('diverged', result.stderr)
        self.assertIn('Branch refused:', result.stderr)
        self.assertEqual(self.git(work, 'rev-parse', '--abbrev-ref', 'HEAD').strip(), 'main')
        self.assertEqual(self.git(work, 'rev-parse', self.SWEEP).strip(), stale)

    def test_prepare_refuses_pushed_branch_behind_main(self):
        origin, work = self.make_clone()
        other = self.spawn(origin)
        self.git(other, 'checkout', '-q', '-b', self.SWEEP)
        (other / 'sweep.txt').write_text('s\n')
        self.git(other, 'add', 'sweep.txt')
        self.git(other, 'commit', '-qm', 'sweep')
        self.git(other, 'push', 'origin', self.SWEEP)
        self.git(other, 'checkout', '-q', 'main')
        (other / 'next.txt').write_text('n\n')
        self.git(other, 'add', 'next.txt')
        self.git(other, 'commit', '-qm', 'next')
        self.git(other, 'push', 'origin', 'main')
        result = self.prepare(work, ok=False)
        self.assertIn('does not contain origin/main', result.stderr)
        self.assertEqual(self.git(work, 'rev-parse', '--abbrev-ref', 'HEAD').strip(), 'main')
        missing = subprocess.run(['git', '-C', str(work), 'rev-parse', '--verify',
                                  '--quiet', f'refs/heads/{self.SWEEP}'], capture_output=True)
        self.assertNotEqual(missing.returncode, 0)

    def test_prepare_refuses_dirty_tree(self):
        origin, work = self.make_clone()
        (work / 'stray.txt').write_text('x\n')
        result = self.prepare(work, ok=False)
        self.assertIn('not clean', result.stderr)
        self.assertEqual(self.git(work, 'rev-parse', '--abbrev-ref', 'HEAD').strip(), 'main')
        missing = subprocess.run(['git', '-C', str(work), 'rev-parse', '--verify',
                                  '--quiet', f'refs/heads/{self.SWEEP}'], capture_output=True)
        self.assertNotEqual(missing.returncode, 0)

    def test_prepare_ignores_deleted_remote_branch(self):
        origin, work = self.make_clone()
        other = self.spawn(origin)
        self.git(other, 'checkout', '-q', '-b', self.SWEEP)
        (other / 'sweep.txt').write_text('s\n')
        self.git(other, 'add', 'sweep.txt')
        self.git(other, 'commit', '-qm', 'sweep')
        self.git(other, 'push', 'origin', self.SWEEP)
        self.git(other, 'checkout', '-q', 'main')
        self.git(work, 'fetch', '-q', 'origin')
        self.git(other, 'push', 'origin', '--delete', self.SWEEP)
        result = self.prepare(work)
        self.assertIn('created from origin/main', result.stdout)
        self.assertEqual(self.git(work, 'rev-parse', 'HEAD').strip(),
                         self.git(work, 'rev-parse', 'origin/main').strip())

    def report_inventory(self, slugs=('one',)):
        return dict(today='2020-02-01', offers_dir=str(self.offers.resolve()),
                    active_count=len(slugs), skipped_expired=[],
                    offers=[dict(slug=s, path=f'{s}.yaml', sha256='0' * 64,
                                 title='T', provider='P', amount='$10', expiry_date=None,
                                 source_url='https://example.com/offer', verified_date='2020-01-01')
                            for s in slugs])

    def render(self, inventory, verdicts, applied=None, *args, ok=True):
        inv, ver = self.root / 'rinv.json', self.root / 'rver.json'
        inv.write_text(json.dumps(inventory))
        ver.write_text(json.dumps(verdicts))
        extra = []
        if applied is not None:
            ap = self.root / 'rapp.json'
            ap.write_text(json.dumps(applied))
            extra = ['--applied', ap]
        return self.cli('render_report.py', '--inventory', inv, '--verdicts', ver,
                        *extra, *args, ok=ok)

    def test_render_report_pr_mode(self):
        inventory = self.report_inventory(('one', 'two'))
        verdicts = [self.verdict('one', updates={'amount': '$20'}),
                    self.verdict('two', 'unverifiable')]
        applied = dict(writes=2,
                       applied=[dict(slug='one', path='one.yaml', action='updated'),
                                dict(slug='one', path='details/one.json', action='references')],
                       results=[dict(slug='one', path='one.yaml', action='updated',
                                     changes=[{'field': 'amount', 'from': '$10', 'to': '$20'}]),
                                dict(slug='two', path='two.yaml', action='skipped', changes=[])],
                       references=[dict(slug='one', path='details/one.json', created=True,
                                        added=1, refreshed=0, dropped=0)])
        out = self.render(inventory, verdicts, applied, '--pr-issue', 999,
                          '--checks', 'validate_offers.py exit 0').stdout
        self.assertEqual(out.splitlines()[0], 'Closes #999')
        self.assertIn('- Inventory: 2 active offers (0 skipped as expired)', out)
        self.assertIn('- Verdicts: 1 live, 0 expired, 0 conflict, 1 unverifiable', out)
        self.assertIn('- Writes: 2 files: 0 bumped, 1 updated from the official source, '
                      '0 expired, 1 reference traces', out)
        self.assertIn('- Checks: validate_offers.py exit 0', out)
        self.assertIn('## Official-source updates', out)
        self.assertIn('| slug | field | before | after | evidence |\n| --- | --- | --- | --- | --- |\n'
                      '| one | amount | $10 | $20 | https://example.com/offer |', out)
        self.assertIn('| one | 2020-01-01 | live | updated | amount: $10 → $20 | new +1 | '
                      'Specific official evidence |', out)
        self.assertIn('| two | 2020-01-01 | unverifiable | none | — | — | '
                      'Evidence conflict or unavailable |', out)
        self.assertIn('## Decision Record', out)
        self.assertIn('Official sources are primary', out)

    def test_render_report_escapes_injection(self):
        inventory = self.report_inventory()
        v = self.verdict('one')
        v['quote'] = 'a | b <img src=x> [x](http://e) @user #12 `code`\nnewline'
        out = self.render(inventory, [v]).stdout
        row = next(l for l in out.splitlines() if l.startswith('| one '))
        for raw in ('<img', '[x]', '@user', '#12', '`code`'):
            self.assertNotIn(raw, row)
        self.assertIn('a \\| b &lt;img src=x&gt; \\[x\\](http://e) &#64;user &#35;12 '
                      '&#96;code&#96; newline', row)
        self.assertNotIn('\n', row)

    def test_render_report_evidence_truncated(self):
        inventory = self.report_inventory()
        v = self.verdict('one')
        v['quote'] = 'x' * 200
        out = self.render(inventory, [v]).stdout
        self.assertIn('x' * 160 + '…', out)
        self.assertNotIn('x' * 161, out)

    def test_render_report_report_only(self):
        inventory = self.report_inventory()
        v = self.verdict('one', updates={'title': 'New'})
        out = self.render(inventory, [v]).stdout
        self.assertNotIn('Closes #', out)
        self.assertNotIn('Decision Record', out)
        self.assertIn('- Writes: none (report-only)', out)
        self.assertIn('## Proposed official-source updates', out)
        self.assertIn('| --- | --- | --- | --- |\n| one | title | New | https://example.com/offer |', out)
        self.assertIn('| one | 2020-01-01 | live | none | title → New | — | '
                      'Specific official evidence |', out)

    def test_render_report_size_guard(self):
        slugs = [f's{i:03}' for i in range(700)]
        inventory = self.report_inventory(slugs)
        verdicts = [dict(self.verdict(s), quote='q ' * 200 + s) for s in slugs]
        applied = dict(writes=len(slugs),
                       applied=[dict(slug=s, path=f'{s}.yaml', action='bumped') for s in slugs],
                       results=[dict(slug=s, path=f'{s}.yaml', action='bumped', changes=[])
                                for s in slugs],
                       references=[])
        out = self.render(inventory, verdicts, applied, '--pr-issue', 1).stdout
        self.assertLessEqual(len(out), 60000)
        self.assertIn('700 rows with write bumped omitted', out)

    def test_render_report_applied_mismatch(self):
        inventory = self.report_inventory()
        applied = dict(writes=0, applied=[], results=[], references=[])
        self.assertIn('do not match inventory',
                      self.render(inventory, [self.verdict('one')], applied, ok=False).stderr)


if __name__ == '__main__':
    unittest.main()
