#!/usr/bin/env python3
"""Restrict a sweep diff to allowlisted offer-content changes."""
import argparse
from pathlib import Path
import subprocess
import sys

from check_coverage import UPDATABLE, normalize_url, strict_loads
from list_active import REPO
from offer_model import parse_offer_text, validate_detail, validate_offer

ARTIFACTS = ('index.json', 'app/public/llms.txt', 'app/public/llms-full.txt')
FIELDS_ALLOWED = set(UPDATABLE) | {'verified_date'}


def git(repo, *args):
    result = subprocess.run(['git', *args], cwd=str(repo), capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'git ' + args[0] + ' failed')
    return result.stdout


def diff(repo, staged, base, head):
    if staged:
        out = git(repo, 'diff', '--cached', '--name-status', '-z', '--no-renames')
        return out, 'HEAD:', ':'
    base_ref = git(repo, 'merge-base', base, head).strip()
    out = git(repo, 'diff', '--name-status', '-z', '--no-renames', base_ref, head)
    return out, base_ref + ':', head + ':'


def identities(doc):
    result = set()
    proofs = doc.get('social_proof') if isinstance(doc, dict) else None
    for entry in proofs or []:
        if not isinstance(entry, dict):
            continue
        if entry.get('type') == 'screenshot':
            result.add(('screenshot', entry.get('image')))
        else:
            url = entry.get('url')
            result.add((entry.get('type'), normalize_url(url) if isinstance(url, str) else url))
    return result


def scope(repo, staged, base, head):
    out, old_ref, new_ref = diff(repo, staged, base, head)
    fields = out.split('\0')
    entries = [(fields[i], fields[i + 1]) for i in range(0, len(fields) - 1, 2)]
    if staged:
        listed = git(repo, 'ls-files', '--', 'offers')
    else:
        listed = git(repo, 'ls-tree', '-r', '--name-only', head, '--', 'offers')
    slugs = {Path(p).stem for p in listed.splitlines() if p.startswith('offers/')
             and not p.startswith('offers/details/') and Path(p).suffix in ('.yaml', '.yml')}
    violations = []
    counts = {'offer': 0, 'detail': 0, 'artifact': 0}
    for status, path in entries:
        if path.startswith('offers/details/'):
            kind = 'detail' if path.endswith('.json') else 'other'
        elif path.startswith('offers/') and path.endswith(('.yaml', '.yml')):
            kind = 'offer'
        elif path in ARTIFACTS:
            kind = 'artifact'
        else:
            kind = 'other'
        if kind == 'other':
            violations.append(path + ': outside the sweep scope')
            continue
        counts[kind] += 1
        blob = lambda ref: git(repo, 'show', ref + path)
        if kind == 'offer':
            if status != 'M':
                violations.append(path + ': the sweep never adds or removes offers')
                continue
            try:
                before = parse_offer_text(blob(old_ref), path)
                after = parse_offer_text(blob(new_ref), path)
            except ValueError as exc:
                violations.append(f'{path}: {exc}')
                continue
            extra = {k for k in set(before) | set(after)
                     if before.get(k) != after.get(k)} - FIELDS_ALLOWED
            if extra:
                violations.append(path + ': changed fields: ' + ', '.join(sorted(extra)))
                continue
            try:
                validate_offer(after, path)
            except ValueError as exc:
                violations.append(f'{path}: {exc}')
        elif kind == 'detail':
            if status not in ('A', 'M'):
                violations.append(path + ': detail files may only be added or modified')
                continue
            try:
                after = strict_loads(blob(new_ref))
                validate_detail(after, path)
            except ValueError as exc:
                violations.append(f'{path}: {exc}')
                continue
            if status == 'A':
                if Path(path).stem not in slugs:
                    violations.append(path + ': detail file has no matching offer slug')
                continue
            try:
                before = strict_loads(blob(old_ref))
            except ValueError as exc:
                violations.append(f'{path}: {exc}')
                continue
            if before.get('summary') != after.get('summary') or before.get('claim_steps') != after.get('claim_steps'):
                violations.append(path + ': summary and claim_steps may not change')
                continue
            if identities(before) - identities(after):
                violations.append(path + ': social_proof entries may not be removed')
        elif status != 'M':
            violations.append(path + ': generated artifacts may only be modified')
    return violations, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staged', action='store_true')
    parser.add_argument('--base')
    parser.add_argument('--head')
    parser.add_argument('--repo', default=str(REPO))
    args = parser.parse_args()
    if args.staged == bool(args.base or args.head):
        parser.error('give exactly one of --staged or --base REF --head REF')
    if bool(args.base) != bool(args.head):
        parser.error('--base and --head must be given together')
    try:
        violations, counts = scope(args.repo, args.staged, args.base, args.head)
    except RuntimeError as exc:
        print(exc.args[0] if exc.args and exc.args[0] else 'git failed', file=sys.stderr)
        return 1
    if violations:
        print('Scope failed:', file=sys.stderr)
        for line in violations:
            print(line, file=sys.stderr)
        return 1
    total = sum(counts.values())
    print(f"OK scope: {total} files ({counts['offer']} offers, "
          f"{counts['detail']} details, {counts['artifact']} artifacts)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
