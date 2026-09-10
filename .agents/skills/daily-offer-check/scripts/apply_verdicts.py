#!/usr/bin/env python3
"""Apply validated verdicts; preserve every byte except allowed date scalars."""
import argparse
import datetime as dt
import json
import re
import sys

from check_coverage import coverage, read_json
from list_active import REPO, date, record, safe_path, safe_root
from offer_model import parse_offer_text, validate_offer


def replace_date(text, key, today):
    pattern = re.compile(r'^(?P<prefix>' + key + r'\s*:\s*)(?P<value>[^\r\n]*?)(?P<space>[ \t]*)(?P<end>\r?\n|$)', re.MULTILINE)
    def replacement(match):
        value = match['value']
        quote = value[0] if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'" else ''
        return match['prefix'] + quote + today + quote + match['space'] + match['end']
    updated, count = pattern.subn(replacement, text)
    if count != 1:
        raise ValueError('expected exactly one ' + key)
    return updated


def apply(inventory, verdicts, today, offers_dir):
    coverage(inventory, verdicts)
    if inventory['today'] != today.isoformat():
        raise ValueError('today does not match inventory')
    if today > dt.date.today():
        raise ValueError('today cannot be in the future for writes')
    root = safe_root(offers_dir)
    if inventory['offers_dir'] != str(root):
        raise ValueError('inventory offers_dir does not match trusted --offers-dir')
    by_slug = {row['slug']: row for row in verdicts}
    pending, results = [], []
    # Preflight the entire batch, including skipped verdicts, before any write.
    for row in inventory['offers']:
        path = safe_path(root, row['path'])
        current, _ = record(root, path)
        if current != row:
            raise ValueError('stale inventory: ' + row['slug'] + '; regenerate inventory and re-verify')
        raw = path.read_bytes()
        text = raw.decode('utf-8')
        verdict = by_slug[row['slug']]['verdict']
        updated = text
        action = 'skipped'
        if verdict in ('live', 'expired'):
            updated = replace_date(updated, 'verified_date', today.isoformat())
            if verdict == 'expired':
                updated = replace_date(updated, 'expiry_date', today.isoformat())
            validate_offer(parse_offer_text(updated, str(path)), str(path))
            action = ('expired' if verdict == 'expired' else 'bumped') if updated != text else 'unchanged'
        if updated != text:
            pending.append((path, raw, updated.encode('utf-8')))
        results.append(dict(slug=row['slug'], path=row['path'], action=action))
    # Detect changes during preflight; this is not a multi-file transaction.
    for path, raw, _ in pending:
        safe_path(root, path.relative_to(root).as_posix())
        if path.read_bytes() != raw:
            raise ValueError('offer changed during preflight')
    for path, _, updated in pending:
        path.write_bytes(updated)
    return dict(writes=len(pending), applied=[r for r in results if r['action'] in ('bumped', 'expired')], results=results)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--today', default=dt.date.today().isoformat())
    parser.add_argument('--inventory', required=True)
    parser.add_argument('--verdicts', required=True)
    parser.add_argument('--offers-dir', default=str(REPO / 'offers'),
                        help='trusted write root; fixture testing must explicitly opt in')
    args = parser.parse_args()
    try:
        print(json.dumps(apply(read_json(args.inventory), read_json(args.verdicts),
                               date(args.today), args.offers_dir), indent=2))
    except (ValueError, OSError) as exc:
        print(f'Apply failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
