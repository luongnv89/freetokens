#!/usr/bin/env python3
"""Prove the staged diff is a hunt-shaped change before it is committed.

Allowed: new top-level offers/<slug>.yaml; edits to an existing one that touch
only title, amount, expiry_date, signup, verified_date (and comments); new or
append-only offers/details/<slug>.json; the three generated artifacts; and
unverified/<slug>.yaml lead files added, refreshed, or removed (#660).

Never allowed: creating, editing or removing a community listing (#748,
``listing_type: community``) or its details file. Only Luong adds one, in its
own small entry PR.

``--mode deals`` (#809) checks a deal-hunt PR instead: it may only add, edit
or remove ``deals/<slug>.yaml`` files (each added or edited one must pass
``scripts/deal_model.py``) and modify the three generated artifacts. Offers,
details, leads and every other path are out of scope for a deal hunt, and a
deal file is out of scope for an offer hunt.
"""
import argparse
import datetime as dt
import json
from pathlib import PurePosixPath
import subprocess
import sys

from common import ARTIFACTS, REPO, UPDATABLE, OfferError, normalize_url, parse_offer_text

sys.path.insert(0, str(REPO / 'scripts'))
import lead_model  # noqa: E402

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


def is_community_text(text, path):
    return parse_offer_text(text, path).get('listing_type') is not None


def community_problem(status, path, slug):
    """Reject any hunt change that creates or touches a community listing."""
    candidates = []
    for ref in (':', 'HEAD:'):
        for suffix in ('.yaml', '.yml'):
            candidates.append(ref + 'offers/' + slug + suffix)
    for spec in candidates:
        result = subprocess.run(['git', 'cat-file', '-e', spec], cwd=str(REPO),
                                capture_output=True, text=True)
        if result.returncode:
            continue
        if is_community_text(git('show', spec), spec):
            return (f'{path}: community listing (listing_type: community); the offer-hunter '
                    'never creates or edits one; only Luong adds them in an entry PR')
    return None


def check(status, path):
    parts = PurePosixPath(path).parts
    if (len(parts) == 2 and parts[0] == 'offers' and path.endswith(('.yaml', '.yml'))) or (
            len(parts) == 3 and parts[:2] == ('offers', 'details') and path.endswith('.json')):
        problem = community_problem(status, path, PurePosixPath(path).stem)
        if problem:
            return problem
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
    if len(parts) == 2 and parts[0] == 'unverified' and path.endswith('.yaml'):
        if status == 'D':
            return None
        if status not in ('A', 'M'):
            return f'{path}: status {status} is out of scope (only add, refresh, or remove leads)'
        lead_model.validate_lead(lead_model.parse_lead_text(git('show', ':' + path), path), path)
        return None
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
    if len(parts) >= 1 and parts[0] == 'deals':
        return f'{path}: deal files belong to a deal hunt (check_scope.py --mode deals), not an offer hunt'
    return f'{path}: not an offer, detail, lead, or generated artifact path'


def check_deal(status, path, today):
    """Deal-hunt scope (#809): deals/<slug>.yaml plus the generated artifacts."""
    import deal_model  # lazy: offer-hunt runs never need it

    parts = PurePosixPath(path).parts
    if path in ARTIFACTS:
        return None if status == 'M' else f'{path}: generated artifact must be modified, not {status}'
    if len(parts) == 2 and parts[0] == 'deals' and path.endswith('.yaml'):
        if status == 'D':
            return None
        if status not in ('A', 'M'):
            return f'{path}: status {status} is out of scope (only add, edit, or remove deals)'
        deal_model.validate_deal(parse_offer_text(git('show', ':' + path), path), path, today)
        return None
    return f'{path}: a deal hunt may only touch deals/<slug>.yaml and the generated artifacts'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Check the staged diff against a hunt scope.')
    parser.add_argument('--mode', choices=('offers', 'deals'), default='offers',
                        help='offers (default): an offer-hunt PR; deals: a deal-hunt PR (#809)')
    parser.add_argument('--today', help='YYYY-MM-DD clock for deal date checks (default: UTC today)')
    args = parser.parse_args(argv)
    try:
        today = (dt.date.fromisoformat(args.today) if args.today
                 else dt.datetime.now(dt.timezone.utc).date())
    except ValueError:
        parser.error(f'--today must be YYYY-MM-DD, got {args.today!r}')
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
            problem = (check_deal(status, path, today) if args.mode == 'deals'
                       else check(status, path))
        except (OfferError, json.JSONDecodeError) as exc:
            problem = f'{path}: cannot parse ({exc})'
        if problem:
            violations.append(problem)
    if violations:
        hunt = 'deal-hunter' if args.mode == 'deals' else 'offer-hunter'
        print(f'Error: the staged diff is outside the {hunt} scope:', file=sys.stderr)
        for line in violations:
            print('  - ' + line, file=sys.stderr)
        print('Fix: unstage the listed paths (git restore --staged -- <path>); never widen the scope.',
              file=sys.stderr)
        sys.exit(1)
    print(f'OK scope ({len(entries)} staged paths{", deals" if args.mode == "deals" else ""})')


if __name__ == '__main__':
    main()
