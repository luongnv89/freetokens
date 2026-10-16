#!/usr/bin/env python3
"""Prove the staged diff is a hunt-shaped change before it is committed.

Allowed: new top-level offers/<slug>.yaml; edits to an existing one that touch
only title, amount, expiry_date, signup, verified_date (and comments); new or
append-only offers/details/<slug>.json; the three generated artifacts.
"""
import json
from pathlib import PurePosixPath
import subprocess
import sys

from common import ARTIFACTS, REPO, UPDATABLE, OfferError, normalize_url, parse_offer_text

EDITABLE = set(UPDATABLE) | {'verified_date'}


def git(*args):
    result = subprocess.run(['git', *args], cwd=str(REPO), capture_output=True, text=True)
    if result.returncode:
        print(f'Error: git {" ".join(args)} failed: {result.stderr.strip()}', file=sys.stderr)
        print('Fix: run from the freetokens repo with the hunt changes staged.', file=sys.stderr)
        sys.exit(1)
    return result.stdout


def proof_keys(doc):
    return {(p.get('type'), normalize_url(p.get('url', '')) if p.get('url') else p.get('image'))
            for p in doc.get('social_proof') or []}


def check(status, path):
    parts = PurePosixPath(path).parts
    if path in ARTIFACTS:
        return None if status == 'M' else f'{path}: generated artifact must be modified, not {status}'
    if len(parts) == 2 and parts[0] == 'offers' and path.endswith('.yaml'):
        new = parse_offer_text(git('show', ':' + path), path)
        if status == 'A':
            if (new.get('verification'), new.get('review_status')) != ('social_proof', 'under-review'):
                return f'{path}: a new offer must carry verification social_proof and review_status under-review'
            return None
        if status != 'M':
            return f'{path}: status {status} is out of scope (only add or modify offers)'
        old = parse_offer_text(git('show', 'HEAD:' + path), path)
        changed = {k for k in set(old) | set(new) if old.get(k) != new.get(k)}
        bad = sorted(changed - EDITABLE)
        return f'{path}: changes {bad}, outside {sorted(EDITABLE)}' if bad else None
    if len(parts) == 3 and parts[:2] == ('offers', 'details') and path.endswith('.json'):
        if status == 'A':
            return None
        if status != 'M':
            return f'{path}: status {status} is out of scope'
        old = json.loads(git('show', 'HEAD:' + path))
        new = json.loads(git('show', ':' + path))
        if not proof_keys(old) <= proof_keys(new):
            return f'{path}: removes existing social_proof entries'
        for key in ('summary', 'claim_steps'):
            if key in old and old[key] != new.get(key):
                return f'{path}: rewrites curated {key}'
        return None
    return f'{path}: not an offer, detail, or generated artifact path'


def main():
    out = git('diff', '--cached', '--name-status', '-z', '--no-renames')
    fields = out.split('\0')
    entries = [(fields[i], fields[i + 1]) for i in range(0, len(fields) - 1, 2)]
    if not entries:
        print('Error: nothing is staged.', file=sys.stderr)
        print('Fix: git add -- <the applied paths> index.json app/public/llms.txt app/public/llms-full.txt',
              file=sys.stderr)
        sys.exit(1)
    violations = []
    for status, path in entries:
        try:
            problem = check(status, path)
        except (OfferError, json.JSONDecodeError) as exc:
            problem = f'{path}: cannot parse ({exc})'
        if problem:
            violations.append(problem)
    if violations:
        print('Error: the staged diff is outside the offer-hunter scope:', file=sys.stderr)
        for line in violations:
            print('  - ' + line, file=sys.stderr)
        print('Fix: unstage the listed paths (git restore --staged -- <path>); never widen the scope.',
              file=sys.stderr)
        sys.exit(1)
    print(f'OK scope ({len(entries)} staged paths)')


if __name__ == '__main__':
    main()
