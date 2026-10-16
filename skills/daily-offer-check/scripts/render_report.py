#!/usr/bin/env python3
"""Render a deterministic, injection-safe sweep report or PR body."""
import argparse
from collections import Counter
import sys

from check_coverage import UPDATABLE, coverage, read_json

BODY_MAX = 60000


ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '|': '\\|', '[': '\\[', ']': '\\]',
           '`': '&#96;', '@': '&#64;', '#': '&#35;'}


def cell(value, limit=None):
    text = ' '.join(str(value).split())
    if limit and len(text) > limit:
        text = text[:limit] + '…'
    return ''.join(ESCAPES.get(c, c) for c in text) or '—'


def scalar(value):
    return 'null' if value is None else value


def render(inventory, verdicts, applied, pr_issue, checks, evidence_limit=160, drop_bumped=False):
    vmap = {v['slug']: v for v in verdicts}
    lines = []
    if pr_issue is not None:
        lines += [f'Closes #{pr_issue}', '']
    counts = Counter(v['verdict'] for v in verdicts)
    lines += [
        '## Summary',
        f"- Inventory: {inventory['active_count']} active offers "
        f"({len(inventory['skipped_expired'])} skipped as expired)",
        f"- Verdicts: {counts['live']} live, {counts['expired']} expired, "
        f"{counts['conflict']} conflict, {counts['unverifiable']} unverifiable",
    ]
    if applied is None:
        lines.append('- Writes: none (report-only)')
    else:
        actions = Counter(r.get('action') for r in applied['results'])
        traces = sum(1 for a in applied['applied'] if a.get('action') == 'references')
        lines.append(f"- Writes: {applied['writes']} files: {actions['bumped']} bumped, "
                     f"{actions['updated']} updated from the official source, "
                     f"{actions['expired']} expired, {traces} reference traces")
    if checks:
        lines.append('- Checks: ' + cell(checks))
    lines += ['', '## Official-source updates' if applied else '## Proposed official-source updates']
    if applied:
        head = '| slug | field | before | after | evidence |'
        rows = [[r['slug'], c['field'], scalar(c.get('from')), scalar(c.get('to')),
                 vmap[r['slug']]['evidence_url']]
                for r in applied['results'] for c in r.get('changes', [])]
    else:
        head = '| slug | field | proposed | evidence |'
        rows = [[v['slug'], f, scalar(v['updates'][f]), v['evidence_url']]
                for v in verdicts for f in UPDATABLE if f in v['updates']]
    if rows:
        lines += [head, '|' + ' --- |' * (head.count('|') - 1)]
        for row in rows:
            lines.append('| ' + ' | '.join(cell(v, evidence_limit) if i == len(row) - 1
                                           else cell(v) for i, v in enumerate(row)) + ' |')
    else:
        lines.append('None.')
    lines += ['', '## Evidence',
              '| slug | prior verified_date | verdict | write | updates | refs | evidence |',
              '| --- | --- | --- | --- | --- | --- | --- |']
    rmap = {r.get('slug'): r for r in (applied['results'] if applied else [])}
    fmap = {r.get('slug'): r for r in (applied['references'] if applied else [])}
    omitted = 0
    for row in inventory['offers']:
        slug = row['slug']
        v = vmap[slug]
        if applied:
            action = rmap[slug].get('action')
            write = action if action in ('bumped', 'updated', 'expired') else 'none'
            updates = '; '.join(f"{c['field']}: {scalar(c.get('from'))} → {scalar(c.get('to'))}"
                                for c in rmap[slug].get('changes', []))
            rec = fmap.get(slug)
            parts = ['new'] if rec and rec.get('created') else []
            if rec:
                parts += [f'{m}{rec[k]}' for m, k in (('+', 'added'), ('~', 'refreshed'), ('-', 'dropped'))
                          if rec.get(k)]
            refs = ' '.join(parts)
        else:
            write = 'none'
            updates = '; '.join(f'{f} → {scalar(v["updates"][f])}' for f in UPDATABLE if f in v['updates'])
            refs = ''
        if drop_bumped and write == 'bumped':
            omitted += 1
            continue
        evidence = v['quote'] if v['verdict'] in ('live', 'expired') else v['reason']
        lines.append('| ' + ' | '.join([cell(slug), cell(row['verified_date']), cell(v['verdict']),
                                        cell(write), cell(updates), cell(refs),
                                        cell(evidence, evidence_limit)]) + ' |')
    if omitted:
        lines.append(f"_{omitted} rows with write bumped omitted to fit GitHub's body limit; "
                     'each had a live official quote._')
    if pr_issue is not None:
        lines += ['', '## Decision Record',
                  '- Official sources are primary: listing terms that differed from the official '
                  'page were rewritten (title, amount, expiry_date, signup only); third-party posts '
                  'never override official information.',
                  "- Reference traces: each live or expired offer's evidence URLs were merged into "
                  'offers/details/<slug>.json (deduplicated by URL, no deletions, at most 10 entries).',
                  '- Conflict and unverifiable offers were left unchanged.']
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', required=True)
    parser.add_argument('--verdicts', required=True)
    parser.add_argument('--applied')
    parser.add_argument('--pr-issue', type=int)
    parser.add_argument('--checks')
    args = parser.parse_args()
    try:
        inventory = read_json(args.inventory)
        verdicts = read_json(args.verdicts)
        coverage(inventory, verdicts)
        applied = None
        if args.applied:
            applied = read_json(args.applied)
            if (not isinstance(applied, dict)
                    or set(applied) != {'writes', 'applied', 'results', 'references'}
                    or not isinstance(applied['results'], list)
                    or not all(isinstance(r, dict) for r in applied['results'])
                    or not isinstance(applied['applied'], list)
                    or not isinstance(applied['references'], list)
                    or [r.get('slug') for r in applied['results']]
                    != [o['slug'] for o in inventory['offers']]):
                raise ValueError('applied results do not match inventory')
        out = render(inventory, verdicts, applied, args.pr_issue, args.checks)
        if args.pr_issue is not None and len(out) > BODY_MAX:
            out = render(inventory, verdicts, applied, args.pr_issue, args.checks, 60)
        if args.pr_issue is not None and len(out) > BODY_MAX:
            out = render(inventory, verdicts, applied, args.pr_issue, args.checks, 60, drop_bumped=True)
        print(out, end='')
    except (ValueError, OSError) as exc:
        print(f'Render failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
