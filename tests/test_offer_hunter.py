"""Offline regression tests for the offer-hunter bundled scripts."""
import copy
import datetime as dt
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SKILL = REPO / '.agents/skills/offer-hunter'
TODAY = dt.date.today().isoformat()

EXISTING = ('# keep me\ntitle: Acme Free Tier\nprovider: Acme\ncategory: api_provider\n'
            'amount: $5 in credits\nexpiry_date: null\nsource_url: https://acme.example/pricing\n'
            'verified_date: 2020-01-01\nverification: social_proof\nreview_status: verified\n'
            'signup: required\n')

LIVE_NEW = {
    'id': 'x-01', 'label': 'Nova — launch credit', 'verdict': 'live', 'reason': 'official page',
    'action': 'new', 'slug': 'nova-launch-credit', 'distinct_from': None,
    'offer': {'title': 'Nova Launch Credit', 'provider': 'Nova', 'category': 'coding',
              'amount': '$20 in credits', 'expiry_date': None,
              'source_url': 'https://nova.example/pricing', 'signup': 'required'},
    'value': {'usd': 20, 'tokens': None, 'period': 'one_time', 'unlimited': False,
              'basis': 'Pricing page: $20 in credits'},
    'evidence_url': 'https://nova.example/pricing', 'quote': 'New accounts get $20 in credits.',
    'references': [{'url': 'https://nova.example/pricing', 'title': 'Pricing',
                    'text': 'New accounts get $20 in credits.'}],
    'lead': {'type': 'x', 'url': 'https://x.com/nova/status/1', 'author': 'Nova', 'handle': '@nova',
             'date': '2026-10-01', 'text': '$20 free credits', 'matches_official': True},
    'summary': 'Nova grants $20 in credits.', 'claim_steps': ['Sign up.'],
}


class OfferHunterTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.offers = self.root / 'offers'
        (self.offers / 'details').mkdir(parents=True)
        (self.offers / 'acme-free-tier.yaml').write_text(EXISTING)

    def run_script(self, script, *args, ok=True):
        result = subprocess.run([sys.executable, str(SKILL / 'scripts' / script), *map(str, args)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if ok else 1, result.stderr)
        return result

    def write(self, name, doc):
        path = self.root / name
        path.write_text(json.dumps(doc))
        return path

    def shortlist(self, verdicts, ok=True, max_n=10):
        snap = self.run_script('catalog_snapshot.py', '--today', TODAY, '--offers-dir', self.offers)
        snapshot = json.loads(snap.stdout)
        snapshot['today'] = TODAY
        cands = [{'id': v['id']} for v in verdicts]
        result = self.run_script('shortlist.py', '--snapshot', self.write('snap.json', snapshot),
                                 '--candidates', self.write('cands.json', cands),
                                 '--verdicts', self.write('verdicts.json', verdicts),
                                 '--max', max_n, ok=ok)
        return json.loads(result.stdout) if ok else result

    def test_bundled_files_exist(self):
        for name in ('SKILL.md', 'agents/scout.md', 'agents/verifier.md', 'references/sources.md',
                     'references/web-tools.md', 'references/trust-and-value.md',
                     'references/publish.md', 'scripts/common.py', 'scripts/catalog_snapshot.py',
                     'scripts/shortlist.py', 'scripts/write_offers.py', 'scripts/check_scope.py',
                     'scripts/render_pr.py', 'scripts/start_run.sh'):
            with self.subTest(name=name):
                self.assertTrue((SKILL / name).is_file(), name)

    def test_new_offer_selected_and_written(self):
        doc = self.shortlist([LIVE_NEW])
        self.assertEqual([e['slug'] for e in doc['selected']], ['nova-launch-credit'])
        entry = doc['selected'][0]
        self.assertEqual(entry['offer']['verification'], 'social_proof')
        self.assertEqual(entry['offer']['review_status'], 'under-review')
        out = self.run_script('write_offers.py', '--shortlist', self.write('short.json', doc),
                              '--offers-dir', self.offers)
        applied = json.loads(out.stdout)
        self.assertEqual(applied['writes'], 2)
        yaml_text = (self.offers / 'nova-launch-credit.yaml').read_text()
        self.assertIn('amount: $20 in credits', yaml_text)
        self.assertIn(f'verified_date: {TODAY}', yaml_text)
        detail = json.loads((self.offers / 'details/nova-launch-credit.json').read_text())
        self.assertEqual([p['type'] for p in detail['social_proof']], ['link', 'x'])
        sys.path.insert(0, str(REPO / 'scripts'))
        from offer_model import load_offers
        self.assertEqual(len(load_offers(str(self.offers))), 2)

    def test_below_floor_rejected(self):
        small = copy.deepcopy(LIVE_NEW)
        small['value'] = {'usd': 1, 'tokens': 50_000, 'period': 'one_time', 'unlimited': False,
                          'basis': '$1 credit'}
        doc = self.shortlist([small])
        self.assertEqual(doc['selected'], [])
        self.assertIn('value floor', doc['rejected'][0]['reason'])

    def test_daily_allowance_counts_as_month(self):
        daily = copy.deepcopy(LIVE_NEW)
        daily['value'] = {'usd': None, 'tokens': 10_000, 'period': 'day', 'unlimited': False,
                          'basis': '10k tokens per day'}
        self.assertEqual(len(self.shortlist([daily])['selected']), 1)

    def test_update_changes_only_safe_fields(self):
        upd = copy.deepcopy(LIVE_NEW)
        upd.update(id='r-01', action='update', slug='acme-free-tier',
                   offer={'title': 'Acme Free Tier', 'provider': 'Acme', 'category': 'api_provider',
                          'amount': '$25 in credits', 'expiry_date': None,
                          'source_url': 'https://acme.example/pricing', 'signup': 'required'},
                   evidence_url='https://acme.example/pricing',
                   references=[{'url': 'https://acme.example/pricing', 'title': 'Acme',
                                'text': 'Now $25 in credits.'}])
        doc = self.shortlist([upd])
        self.assertEqual(doc['selected'][0]['changes'],
                         [{'field': 'amount', 'from': '$5 in credits', 'to': '$25 in credits'}])
        self.assertEqual(doc['selected'][0]['offer']['review_status'], 'verified')
        self.run_script('write_offers.py', '--shortlist', self.write('short.json', doc),
                        '--offers-dir', self.offers)
        text = (self.offers / 'acme-free-tier.yaml').read_text()
        self.assertIn('amount: $25 in credits', text)
        self.assertIn('# keep me', text)
        self.assertIn('review_status: verified', text)

    def test_unchanged_update_and_duplicate_source_rejected(self):
        same = copy.deepcopy(LIVE_NEW)
        same['offer']['source_url'] = 'https://acme.example/pricing/'
        same['offer']['provider'] = 'Other'
        same['evidence_url'] = same['references'][0]['url'] = 'https://acme.example/pricing'
        result = self.shortlist([same], ok=False)
        self.assertIn('already listed as', result.stderr)
        same['distinct_from'] = 'acme-free-tier is a different program on the same models page'
        self.assertEqual(len(self.shortlist([same])['selected']), 1)

    def test_same_provider_needs_distinct_from(self):
        twin = copy.deepcopy(LIVE_NEW)
        twin['offer']['provider'] = 'Acme'
        twin['slug'] = 'acme-startup-credit'
        self.assertIn('distinct_from', self.shortlist([twin], ok=False).stderr)
        twin['distinct_from'] = 'acme-free-tier is the free tier; this is the startup grant'
        self.assertEqual(len(self.shortlist([twin])['selected']), 1)

    def test_offsite_evidence_and_social_source_rejected(self):
        bad = copy.deepcopy(LIVE_NEW)
        bad['offer']['source_url'] = 'https://x.com/nova/status/1'
        self.assertIn('source_url', self.shortlist([bad], ok=False).stderr)

    def test_missing_verdict_fails_coverage(self):
        snap = self.write('snap.json', {'today': TODAY, 'offers': [], 'pending': []})
        result = self.run_script('shortlist.py', '--snapshot', snap,
                                 '--candidates', self.write('c.json', [{'id': 'a'}, {'id': 'b'}]),
                                 '--verdicts', self.write('v.json', [dict(LIVE_NEW, id='a')]), ok=False)
        self.assertIn('no verdict for: b', result.stderr)

    def test_cap_and_rank(self):
        records = []
        for i, usd in enumerate((10, 50, 30)):
            rec = copy.deepcopy(LIVE_NEW)
            rec.update(id=f'w-0{i}', slug=f'nova-offer-{i}')
            rec['offer'] = dict(rec['offer'], provider=f'Nova{i}', source_url=f'https://nova{i}.example/p')
            rec['evidence_url'] = f'https://nova{i}.example/p'
            rec['references'] = [{'url': rec['evidence_url'], 'title': 't', 'text': 'x'}]
            rec['value'] = dict(rec['value'], usd=usd)
            records.append(rec)
        doc = self.shortlist(records, max_n=2)
        self.assertEqual([e['slug'] for e in doc['selected']], ['nova-offer-1', 'nova-offer-2'])
        self.assertIn('top 2', doc['rejected'][0]['reason'])

    def test_lookalike_multilabel_domain_rejected(self):
        bad = copy.deepcopy(LIVE_NEW)
        bad['offer']['source_url'] = 'https://brand.co.uk/offer'
        bad['evidence_url'] = bad['references'][0]['url'] = 'https://attacker.co.uk/offer'
        self.assertIn('differs from source_url site', self.shortlist([bad], ok=False).stderr)
        bad['evidence_url'] = bad['references'][0]['url'] = 'https://docs.brand.co.uk/credits'
        self.assertEqual(len(self.shortlist([bad])['selected']), 1)

    def test_same_provider_twice_in_one_run(self):
        first, second = copy.deepcopy(LIVE_NEW), copy.deepcopy(LIVE_NEW)
        second.update(id='x-02', slug='nova-student-credit')
        second['offer'] = dict(second['offer'], source_url='https://nova.example/students')
        second['evidence_url'] = second['references'][0]['url'] = 'https://nova.example/students'
        doc = self.shortlist([first, second])
        self.assertEqual(len(doc['selected']), 1)
        self.assertIn('same provider', doc['rejected'][0]['reason'])

    def test_bad_types_name_the_id(self):
        bad = copy.deepcopy(LIVE_NEW)
        bad['offer']['provider'] = 42
        bad['claim_steps'] = 'Signup'
        self.assertIn('x-01: offer.provider', self.shortlist([bad], ok=False).stderr)

    def test_start_run_rejects_bad_category(self):
        result = subprocess.run(['bash', str(SKILL / 'scripts/start_run.sh'), '--mode', 'report',
                                 '--categories', 'llm'], capture_output=True, text=True, cwd=REPO)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown category 'llm'", result.stderr)

    def test_render_escapes_untrusted_text(self):
        evil = copy.deepcopy(LIVE_NEW)
        evil['quote'] = 'Free <script>x</script> | @everyone `rm` fixes #12'
        evil['references'][0]['text'] = evil['quote']
        doc = self.shortlist([evil])
        body = self.run_script('render_pr.py', '--shortlist', self.write('s.json', doc),
                               '--mode', 'pr', '--issue', 7).stdout
        self.assertTrue(body.startswith('Closes #7\n'))
        self.assertNotIn('<script>', body)
        self.assertNotIn('@everyone', body)
        self.assertNotIn('#12', body)
        self.assertIn('## Decision', body)


if __name__ == '__main__':
    unittest.main()
