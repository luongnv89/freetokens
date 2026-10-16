#!/usr/bin/env python3
"""Write the shortlist into offers/: new YAMLs, safe-field updates, detail traces.

This is the run's only writer. It validates every file it would write before
writing any of them, and prints the applied-files JSON to stdout.
"""
import argparse
import json
from pathlib import Path
import re
import sys

from common import (REPO, UPDATABLE, OfferError, die, load_json, normalize_url,
                    parse_offer_text, validate_detail, validate_offer)

FIELD_ORDER = ('title', 'provider', 'category', 'amount', 'expiry_date', 'source_url',
               'verified_date', 'verification', 'review_status', 'signup')
NULL_WORDS = {'null', '~', ''}
MAX_PROOFS = 10


def one_line(value, limit=None):
    flat = ' '.join(str(value).split())
    return flat if limit is None or len(flat) <= limit else flat[:limit - 1] + '…'


def scalar(field, value):
    if value is None:
        if field != 'expiry_date':
            raise OfferError(f'{field} cannot be null')
        return 'null'
    flat = one_line(value)
    if flat.lower() in NULL_WORDS:
        raise OfferError(f'{field} value {value!r} would parse as null')
    if len(flat) >= 2 and flat[0] == flat[-1] and flat[0] in '"\'':
        raise OfferError(f'{field} value {value!r} is wrapped in quotes')
    return flat


def new_yaml(entry, today):
    offer = entry['offer']
    lines = [
        f'# Hunted {today} by offer-hunter; verified against {entry["evidence_url"]}',
        f'# ("{one_line(entry["quote"], 200)}")',
        f'# Lead: {entry["lead"]["url"]}',
    ]
    lines += [f'{field}: {scalar(field, offer[field])}' for field in FIELD_ORDER]
    return '\n'.join(lines) + '\n'


def updated_yaml(text, entry, today):
    values = {c['field']: c['to'] for c in entry['changes']}
    values['verified_date'] = today
    out, done = [], set()
    for line in text.splitlines():
        if line.startswith('# Refreshed ') and 'by offer-hunter' in line:
            continue
        match = re.match(r'^([a-z_]+):', line)
        if match and match.group(1) in values:
            field = match.group(1)
            line = f'{field}: {scalar(field, values[field])}'
            done.add(field)
        out.append(line)
    if set(values) - done:
        raise OfferError(f'fields not found in the existing file: {sorted(set(values) - done)}')
    note = (f'# Refreshed {today} by offer-hunter against {entry["evidence_url"]}'
            f' ("{one_line(entry["quote"], 160)}")')
    return note + '\n' + '\n'.join(out) + '\n'


def lead_proof(lead):
    if not lead.get('matches_official'):
        return None
    kind = lead['type']
    if kind in ('x', 'reddit'):
        if not (lead.get('author') and lead.get('text')):
            return None
        proof = {'type': kind, 'url': lead['url'], 'author': one_line(lead['author'], 200),
                 'text': one_line(lead['text'], 500)}
        extra = 'handle' if kind == 'x' else 'community'
        if lead.get(extra):
            proof[extra] = one_line(lead[extra], 200)
        return proof
    if not lead.get('title'):
        return None
    proof = {'type': 'link', 'url': lead['url'], 'title': one_line(lead['title'], 200)}
    if lead.get('text'):
        proof['text'] = one_line(lead['text'], 500)
    return proof


def merged_detail(existing, entry):
    doc = dict(existing or {})
    proofs = list(doc.get('social_proof') or [])
    seen = {(p.get('type'), normalize_url(p['url'])) for p in proofs if p.get('url')}
    wanted = [{'type': 'link', 'url': r['url'], 'title': one_line(r['title'], 200),
               'text': one_line(r['text'], 500)} for r in entry['references']]
    lead = lead_proof(entry['lead'])
    if lead:
        wanted.append(lead)
    added = 0
    for proof in wanted:
        key = (proof['type'], normalize_url(proof['url']))
        if key in seen or len(proofs) >= MAX_PROOFS:
            continue
        seen.add(key)
        proofs.append(proof)
        added += 1
    if proofs:
        doc['social_proof'] = proofs
    if entry.get('summary') and 'summary' not in doc:
        doc['summary'] = entry['summary'].strip()
    if entry.get('claim_steps') and 'claim_steps' not in doc:
        doc['claim_steps'] = [one_line(step) for step in entry['claim_steps']]
    ordered = {k: doc[k] for k in ('summary', 'claim_steps', 'social_proof') if k in doc}
    ordered.update({k: v for k, v in doc.items() if k not in ordered})
    return ordered, added


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shortlist', required=True)
    parser.add_argument('--offers-dir', default=str(REPO / 'offers'),
                        help='trusted write root; tests only, never taken from JSON')
    args = parser.parse_args()
    shortlist = load_json(args.shortlist, 'shortlist')
    today = shortlist.get('today')
    selected = shortlist.get('selected')
    if not isinstance(selected, list) or not isinstance(today, str):
        die(f'{args.shortlist} is not shortlist.py output', 'regenerate it with scripts/shortlist.py')
    root = Path(args.offers_dir).resolve()
    if not root.is_dir():
        die(f'offers directory not found: {root}', 'run from the freetokens repo root')

    plan, errors = [], []
    for entry in selected:
        slug = entry.get('slug', '?')
        yaml_path = root / f'{slug}.yaml'
        detail_path = root / 'details' / f'{slug}.json'
        try:
            if entry['action'] == 'new':
                if yaml_path.exists() or detail_path.exists():
                    raise OfferError(f'{yaml_path.name} or its detail file already exists')
                body = new_yaml(entry, today)
                existing = None
            elif entry['action'] == 'update':
                if not yaml_path.is_file():
                    raise OfferError(f'{yaml_path.name} does not exist')
                if any(c['field'] not in UPDATABLE for c in entry['changes']):
                    raise OfferError('update changes a field outside title, amount, expiry_date, signup')
                body = updated_yaml(yaml_path.read_text(encoding='utf-8'), entry, today)
                existing = (json.loads(detail_path.read_text(encoding='utf-8'))
                            if detail_path.exists() else None)
            else:
                raise OfferError(f'unknown action {entry["action"]!r}')
            validate_offer(parse_offer_text(body, yaml_path.name), yaml_path.name)
            detail, added = merged_detail(existing, entry)
            validate_detail(json.loads(json.dumps(detail)), detail_path.name)
        except (OfferError, KeyError, ValueError, TypeError, AttributeError) as exc:
            errors.append(f'{slug}: {exc}')
            continue
        plan.append((entry, yaml_path, body, detail_path, detail, existing is None, added))

    if errors:
        print('Error: nothing was written; these shortlist entries cannot be written:', file=sys.stderr)
        for line in errors:
            print('  - ' + line, file=sys.stderr)
        print('Fix: re-run shortlist.py with --exclude <id>=<reason> for each listed entry, '
              'then re-run this script once.', file=sys.stderr)
        sys.exit(1)

    applied, results = [], []
    for entry, yaml_path, body, detail_path, detail, created, added in plan:
        yaml_path.write_text(body, encoding='utf-8')
        detail_path.parent.mkdir(exist_ok=True)
        detail_path.write_text(json.dumps(detail, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        rel_yaml = 'offers/' + yaml_path.relative_to(root).as_posix()
        rel_detail = 'offers/' + detail_path.relative_to(root).as_posix()
        applied += [rel_yaml, rel_detail]
        results.append({'slug': entry['slug'], 'action': entry['action'], 'yaml': rel_yaml,
                        'detail': rel_detail, 'detail_created': created, 'proofs_added': added,
                        'changes': entry['changes']})
    print(json.dumps({'today': today, 'writes': len(applied), 'applied': applied,
                      'results': results}, indent=1, ensure_ascii=False))
    print(f'OK wrote {len(applied)} files for {len(results)} offers', file=sys.stderr)


if __name__ == '__main__':
    main()
