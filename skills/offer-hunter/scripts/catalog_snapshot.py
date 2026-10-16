#!/usr/bin/env python3
"""Snapshot the catalog (and offers already proposed in open PRs) for dedup.

Read-only: prints JSON to stdout, never fetches URLs or writes files.
"""
import argparse
import json
from pathlib import Path

from common import REPO, die, iso_date, load_json, normalize_url, read_catalog


def pending_slugs(path):
    """Slugs touched by open PRs, from `gh pr list --json number,files`."""
    doc = load_json(path, 'pending PR list')
    if not isinstance(doc, list):
        die(f'{path} must be the JSON array printed by gh pr list --json number,files',
            'regenerate it with: gh pr list --state open --json number,files > <file>')
    result = []
    for pr in doc:
        for item in pr.get('files') or []:
            name = item.get('path', '') if isinstance(item, dict) else ''
            parts = Path(name).parts
            if len(parts) == 2 and parts[0] == 'offers' and name.endswith(('.yaml', '.yml')):
                result.append({'pr': pr.get('number'), 'slug': Path(name).stem})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--today', required=True, help='run date, YYYY-MM-DD')
    parser.add_argument('--offers-dir', default=str(REPO / 'offers'))
    parser.add_argument('--pending', help='JSON from gh pr list --state open --json number,files')
    args = parser.parse_args()
    try:
        today = iso_date(args.today, '--today')
    except ValueError as exc:
        die(str(exc), 'pass --today "$(date +%F)"')
    offers_dir = Path(args.offers_dir)
    if not offers_dir.is_dir():
        die(f'offers directory not found: {offers_dir}', 'run from the freetokens repo root')

    offers = read_catalog(offers_dir)
    for row in offers:
        expiry = row['expiry_date']
        row['expired'] = bool(row['archived'] or (expiry and expiry < today.isoformat()))
        row['source_url_normalized'] = normalize_url(row['source_url'] or '')
    snapshot = {
        'today': today.isoformat(),
        'offer_count': len(offers),
        'active_count': sum(1 for row in offers if not row['expired']),
        'offers': offers,
        'pending': pending_slugs(args.pending) if args.pending else [],
    }
    print(json.dumps(snapshot, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
