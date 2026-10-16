#!/usr/bin/env python3
"""Apply validated verdicts; preserve every byte except allowed scalars."""
import argparse
import datetime as dt
import itertools
import json
import os
from pathlib import Path
import re
import sys

from check_coverage import UPDATABLE, coverage, normalize_url, read_json
from list_active import REPO, date, record, safe_path, safe_root
from offer_model import NULL_TOKENS, parse_offer_text, validate_detail, validate_offer

PROOF_MAX = 10
DETAIL_STYLE = (2, False, False, '\n')


def replace_scalar(text, key, value):
    pattern = re.compile(r'^(?P<prefix>' + key + r'[ \t]*:[ \t]*)(?P<old>[^\r\n]*?)(?P<space>[ \t]*)(?P<end>\r?\n|$)', re.MULTILINE)
    def replacement(match):
        if value is None:
            new = 'null'
        else:
            old = match['old']
            quote = old[0] if len(old) >= 2 and old[0] == old[-1] and old[0] in "\"'" else ''
            if not quote and (value.lower() in NULL_TOKENS
                              or (len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'")):
                quote = '"'
            new = quote + value + quote
        return match['prefix'] + new + match['space'] + match['end']
    updated, count = pattern.subn(replacement, text)
    if count != 1:
        raise ValueError('expected exactly one ' + key)
    return updated


def check_write(path, root):
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('symlink write path is not allowed')
    if not path.resolve().is_relative_to(root):
        raise ValueError('write path escapes offers directory')


def detail_path(root, slug):
    base = root / 'details'
    if base.is_symlink() or (base.exists() and not base.is_dir()):
        raise ValueError('details path is not a real directory')
    matches = []
    if base.is_dir():
        for directory, dirs, files in os.walk(base, followlinks=False):
            for name in dirs + files:
                if (Path(directory) / name).is_symlink():
                    raise ValueError('symlinks are not allowed in details directory')
            matches += [Path(directory) / name for name in files
                        if Path(name).stem == slug and Path(name).suffix == '.json']
    if len(matches) > 1:
        raise ValueError('multiple detail files for ' + slug)
    path = matches[0] if matches else base / (slug + '.json')
    check_write(path, root)
    return path


def dump_style(doc, text):
    if text is not None:
        for style in itertools.product((2, None), (False, True), (True, False), ('\n', '')):
            if json.dumps(doc, indent=style[0], ensure_ascii=style[1], sort_keys=style[2]) + style[3] == text:
                return style
    return DETAIL_STYLE


def dump(doc, style):
    return (json.dumps(doc, indent=style[0], ensure_ascii=style[1], sort_keys=style[2]) + style[3]).encode('utf-8')


def merge_references(root, slug, refs, action, pending):
    path = detail_path(root, slug)
    created = not path.exists()
    old = None if created else path.read_bytes()
    doc = {} if created else read_json(path)
    if not created:
        validate_detail(doc, str(path))
    style = dump_style(doc, None if created else old.decode('utf-8'))
    proofs = doc.setdefault('social_proof', [])
    index = {normalize_url(e['url']): e for e in proofs if 'url' in e}
    added = refreshed = dropped = 0
    for ref in refs:
        key = normalize_url(ref['url'])
        entry = index.get(key)
        if entry is not None:
            if (action == 'updated' and entry.get('type') == 'link'
                    and (entry.get('title') != ref['title'] or entry.get('text') != ref['text'])):
                entry['title'], entry['text'] = ref['title'], ref['text']
                refreshed += 1
            continue
        entry = dict(type='link', url=ref['url'], title=ref['title'], text=ref['text'])
        proofs.append(entry)
        index[key] = entry
        added += 1
    while len(proofs) > PROOF_MAX:
        proofs.pop()
        added -= 1
        dropped += 1
    validate_detail(doc, str(path))
    new = dump(doc, style)
    if created or new != old:
        pending.append(dict(path=path, old=old, new=new, slug=slug, action='references',
                            rel=path.relative_to(root).as_posix()))
    if created or added or refreshed or dropped:
        return dict(slug=slug, path=path.relative_to(root).as_posix(), created=created,
                    added=added, refreshed=refreshed, dropped=dropped)
    return None


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
    pending, results, references = [], [], []
    # Preflight the entire batch, including skipped verdicts, before any write.
    for row in inventory['offers']:
        path = safe_path(root, row['path'])
        current, _ = record(root, path)
        if current != row:
            raise ValueError('stale inventory: ' + row['slug'] + '; regenerate inventory and re-verify')
        raw = path.read_bytes()
        text = raw.decode('utf-8')
        vrow = by_slug[row['slug']]
        verdict = vrow['verdict']
        updated, action, changes = text, 'skipped', []
        if verdict in ('live', 'expired'):
            parsed = parse_offer_text(text, str(path))
            updated = replace_scalar(updated, 'verified_date', today.isoformat())
            if verdict == 'expired':
                updated = replace_scalar(updated, 'expiry_date', today.isoformat())
            else:
                for field in UPDATABLE:
                    if field in vrow['updates'] and vrow['updates'][field] != parsed[field]:
                        changes.append({'field': field, 'from': parsed[field], 'to': vrow['updates'][field]})
                        updated = replace_scalar(updated, field, vrow['updates'][field])
            reparsed = parse_offer_text(updated, str(path))
            if (reparsed['verified_date'] != today.isoformat()
                    or (verdict == 'expired' and reparsed['expiry_date'] != today.isoformat())
                    or any(reparsed[c['field']] != c['to'] for c in changes)):
                raise ValueError('rewritten offer does not parse back: ' + row['slug'])
            validate_offer(reparsed, str(path))
            if updated != text:
                action = 'expired' if verdict == 'expired' else 'updated' if changes else 'bumped'
                pending.append(dict(path=path, old=raw, new=updated.encode('utf-8'),
                                    slug=row['slug'], action=action, rel=row['path']))
            else:
                action = 'unchanged'
        results.append(dict(slug=row['slug'], path=row['path'], action=action, changes=changes))
        if verdict in ('live', 'expired'):
            report = merge_references(root, row['slug'], vrow['references'], action, pending)
            if report:
                references.append(report)
    # Detect changes during preflight; this is not a multi-file transaction.
    for item in pending:
        check_write(item['path'], root)
        if item['old'] is None:
            if item['path'].exists():
                raise ValueError('file appeared during preflight: ' + item['rel'])
        elif not item['path'].is_file() or item['path'].read_bytes() != item['old']:
            raise ValueError('offer changed during preflight')
    for item in pending:
        item['path'].parent.mkdir(parents=True, exist_ok=True)
        item['path'].write_bytes(item['new'])
    applied = [dict(slug=i['slug'], path=i['rel'], action=i['action']) for i in pending]
    return dict(writes=len(applied), applied=applied, results=results, references=references)


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
