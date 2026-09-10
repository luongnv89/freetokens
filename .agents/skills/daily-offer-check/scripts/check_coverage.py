#!/usr/bin/env python3
"""Validate inventory and verdict schemas and require exact slug coverage."""
import argparse
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

from list_active import FIELDS, SLUG, date


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def url(value):
    if not nonempty(value):
        return False
    parsed = urlsplit(value)
    return parsed.scheme in ('http', 'https') and bool(parsed.netloc)


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding='utf-8'), object_pairs_hook=unique)


def coverage(inventory, verdicts):
    if not isinstance(inventory, dict) or set(inventory) != {
            'today', 'offers_dir', 'active_count', 'skipped_expired', 'offers'}:
        raise ValueError('invalid inventory object')
    today = date(inventory['today'])
    if not nonempty(inventory['offers_dir']) or not Path(inventory['offers_dir']).is_absolute():
        raise ValueError('offers_dir must be absolute')
    offers = inventory['offers']
    if not isinstance(offers, list) or type(inventory['active_count']) is not int or inventory['active_count'] != len(offers):
        raise ValueError('active_count must equal offers length')
    skipped = inventory['skipped_expired']
    if not isinstance(skipped, list) or any(not isinstance(s, str) or not SLUG.fullmatch(s) for s in skipped) or len(set(skipped)) != len(skipped):
        raise ValueError('invalid skipped_expired slugs')
    expected, paths = set(), set()
    for row in offers:
        if not isinstance(row, dict) or set(row) != set(FIELDS) | {'slug', 'path', 'sha256'}:
            raise ValueError('invalid inventory offer fields')
        slug, path = row['slug'], row['path']
        if not isinstance(slug, str) or not SLUG.fullmatch(slug) or slug in expected or slug in skipped:
            raise ValueError('invalid or duplicate inventory slug')
        if not isinstance(path, str) or Path(path).is_absolute() or '..' in Path(path).parts or '\\' in path or str(Path(path)) != path or Path(path).stem != slug or Path(path).suffix not in ('.yaml', '.yml') or path in paths:
            raise ValueError('unsafe or duplicate inventory path')
        if not isinstance(row['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', row['sha256']):
            raise ValueError('invalid inventory sha256')
        if any(not nonempty(row[k]) for k in ('title', 'provider', 'amount')) or not url(row['source_url']):
            raise ValueError('invalid inventory offer text or source_url')
        date(row['verified_date'])
        if row['expiry_date'] is not None and date(row['expiry_date']) < today:
            raise ValueError('inventory contains expired offer')
        expected.add(slug)
        paths.add(path)
    if not isinstance(verdicts, list):
        raise ValueError('verdicts must be a JSON array')
    actual = set()
    for row in verdicts:
        if not isinstance(row, dict) or set(row) != {'slug', 'verdict', 'evidence_url', 'quote', 'reason'}:
            raise ValueError('invalid verdict fields')
        slug, verdict = row['slug'], row['verdict']
        if not isinstance(slug, str) or not SLUG.fullmatch(slug) or slug in actual:
            raise ValueError('invalid or duplicate verdict slug')
        if not isinstance(verdict, str) or verdict not in ('live', 'expired', 'conflict', 'unverifiable'):
            raise ValueError('unknown verdict')
        if not all(isinstance(row[k], str) for k in ('evidence_url', 'quote', 'reason')):
            raise ValueError('verdict evidence and reason must be strings')
        if verdict in ('live', 'expired') and (not url(row['evidence_url']) or not nonempty(row['quote'])):
            raise ValueError('live/expired requires evidence_url and quote')
        if verdict in ('conflict', 'unverifiable') and not nonempty(row['reason']):
            raise ValueError('conflict/unverifiable requires reason')
        if row['evidence_url'] and not url(row['evidence_url']):
            raise ValueError('invalid evidence_url')
        actual.add(slug)
    if expected != actual:
        raise ValueError(f'coverage mismatch: missing={sorted(expected - actual)}, extra={sorted(actual - expected)}')
    return len(expected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inventory')
    parser.add_argument('verdicts')
    args = parser.parse_args()
    try:
        count = coverage(read_json(args.inventory), read_json(args.verdicts))
        print(f'OK {count}/{count} slugs covered')
    except (ValueError, OSError) as exc:
        print(f'Coverage failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
