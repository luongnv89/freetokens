#!/usr/bin/env python3
"""Validate inventory and verdict schemas and require exact slug coverage."""
import argparse
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit, urlunsplit

from list_active import FIELDS, SLUG, date
from offer_model import PROOF_META_MAX_CHARS, PROOF_TEXT_MAX_CHARS, SIGNUP_MODES

UPDATABLE = ('title', 'amount', 'expiry_date', 'signup')
REFERENCES_MAX = 5
TEXT_MAX = 300
URL_MAX = 200


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def url(value):
    if not nonempty(value):
        return False
    parsed = urlsplit(value)
    return parsed.scheme in ('http', 'https') and bool(parsed.netloc)


def normalize_url(value):
    parsed = urlsplit(value)
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(),
                       parsed.path.rstrip('/'), parsed.query, ''))


def site(value):
    host = (urlsplit(value).hostname or '').rstrip('.')
    if host.startswith('www.'):
        host = host[4:]
    host = '.'.join(host.split('.')[-2:])
    return 'x.com' if host == 'twitter.com' else host


def same_source(evidence_url, source_url):
    if site(evidence_url) != site(source_url):
        return False
    if site(evidence_url) != 'x.com':
        return True
    handle = lambda v: urlsplit(v).path.lstrip('/').split('/')[0].lower()
    return handle(evidence_url) == handle(source_url)


def strict_loads(text):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=unique)


def read_json(path):
    return strict_loads(Path(path).read_text(encoding='utf-8'))


def update(key, value, today):
    if key in ('title', 'amount'):
        if (not isinstance(value, str) or not value or value != value.strip()
                or any(ord(c) < 32 or ord(c) == 127 for c in value)
                or len(value) > TEXT_MAX or value.lower() in ('null', '~')):
            raise ValueError('invalid ' + key + ' update')
    elif key == 'expiry_date':
        if value is not None and date(value) < today:
            raise ValueError('a past expiry means verdict expired')
    elif key == 'signup' and value not in SIGNUP_MODES:
        raise ValueError('invalid signup update')


def references(row, verdict):
    refs = row['references']
    if not isinstance(refs, list) or len(refs) > REFERENCES_MAX:
        raise ValueError('invalid references list')
    seen = set()
    for ref in refs:
        if not isinstance(ref, dict) or set(ref) != {'url', 'title', 'text'}:
            raise ValueError('invalid reference fields')
        if not url(ref['url']) or len(ref['url']) > URL_MAX:
            raise ValueError('invalid reference url')
        if not nonempty(ref['title']) or len(ref['title']) > PROOF_META_MAX_CHARS:
            raise ValueError('invalid reference title')
        if not nonempty(ref['text']) or len(ref['text']) > PROOF_TEXT_MAX_CHARS:
            raise ValueError('invalid reference text')
        key = normalize_url(ref['url'])
        if key in seen:
            raise ValueError('duplicate reference url')
        seen.add(key)
    if verdict in ('live', 'expired'):
        if not refs:
            raise ValueError('live/expired verdicts require references')
        if normalize_url(row['evidence_url']) not in seen:
            raise ValueError('evidence_url must be listed in references')
    elif refs:
        raise ValueError('references are only recorded for live/expired verdicts')


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
    expected, paths, sources = set(), set(), {}
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
        sources[slug] = row['source_url']
    if not isinstance(verdicts, list):
        raise ValueError('verdicts must be a JSON array')
    actual = set()
    for row in verdicts:
        if not isinstance(row, dict) or set(row) != {'slug', 'verdict', 'evidence_url', 'quote', 'reason', 'updates', 'references'}:
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
        updates = row['updates']
        if not isinstance(updates, dict):
            raise ValueError('updates must be an object')
        for key in updates:
            if key not in UPDATABLE:
                raise ValueError('unknown update field: ' + key)
        if updates and verdict != 'live':
            raise ValueError('updates are only allowed on live verdicts')
        for key, value in updates.items():
            update(key, value, today)
        if updates and slug in sources and not same_source(row['evidence_url'], sources[slug]):
            raise ValueError("updates require evidence_url from the offer's official source site")
        references(row, verdict)
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
