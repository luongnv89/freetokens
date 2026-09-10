#!/usr/bin/env python3
"""Inventory active offers without fetching URLs or changing files."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sys

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'scripts'))
from offer_model import parse_offer_text, validate_offer, is_expired

FIELDS = ('title', 'provider', 'amount', 'expiry_date', 'source_url', 'verified_date')
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')


def date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('date must be YYYY-MM-DD')
    return dt.date.fromisoformat(value)


def safe_root(value):
    path = Path(os.path.abspath(value))
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('symlink offers directory is not allowed')
    if not path.is_dir():
        raise ValueError('offers directory does not exist')
    return path


def safe_path(root, value):
    if not isinstance(value, str):
        raise ValueError('path must be a relative YAML path')
    path = Path(value)
    if path.is_absolute() or '..' in path.parts or '\\' in value or str(path) != value:
        raise ValueError('unsafe offer path')
    if path.suffix not in ('.yaml', '.yml') or not SLUG.fullmatch(path.stem):
        raise ValueError('invalid offer filename')
    full = root / path
    if any(p.is_symlink() for p in (full, *full.parents)):
        raise ValueError('symlink offer path is not allowed')
    if not full.is_file() or not full.resolve().is_relative_to(root):
        raise ValueError('offer path must be a file inside offers directory')
    return full


def record(root, path):
    raw = path.read_bytes()
    data = validate_offer(parse_offer_text(raw.decode('utf-8'), str(path)), str(path))
    result = {key: (data[key].isoformat() if isinstance(data[key], dt.date) else data[key])
              for key in FIELDS}
    result.update(slug=path.stem, path=path.relative_to(root).as_posix(),
                  sha256=hashlib.sha256(raw).hexdigest())
    return result, data


def inventory(offers_dir, today, slugs=None):
    root = safe_root(offers_dir)
    selected = None
    if slugs is not None:
        selected = slugs.split(',')
        if any(not SLUG.fullmatch(s) for s in selected) or len(set(selected)) != len(selected):
            raise ValueError('slugs must be unique comma-separated lowercase names')
    records, expired, seen = [], [], set()
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            if (Path(directory) / name).is_symlink():
                raise ValueError('symlinks are not allowed in offers directory')
        dirs[:] = sorted(d for d in dirs if d != 'details')
        for name in sorted(files):
            if Path(name).suffix not in ('.yaml', '.yml'):
                continue
            path = safe_path(root, (Path(directory) / name).relative_to(root).as_posix())
            row, data = record(root, path)
            if row['slug'] in seen:
                raise ValueError('duplicate offer slug: ' + row['slug'])
            seen.add(row['slug'])
            if selected is not None and row['slug'] not in selected:
                continue
            if is_expired(data, today):
                expired.append(row['slug'])
            else:
                records.append(row)
    if selected is not None and set(selected) - seen:
        raise ValueError('unknown slugs: ' + ', '.join(sorted(set(selected) - seen)))
    records.sort(key=lambda r: (r['verified_date'], r['slug']))
    return dict(today=today.isoformat(), offers_dir=str(root), active_count=len(records),
                skipped_expired=sorted(expired), offers=records)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--today', default=dt.date.today().isoformat())
    parser.add_argument('--offers-dir', default=str(REPO / 'offers'))
    parser.add_argument('--slugs')
    args = parser.parse_args()
    try:
        print(json.dumps(inventory(args.offers_dir, date(args.today), args.slugs), indent=2))
    except (ValueError, OSError) as exc:
        print(f'Inventory failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
