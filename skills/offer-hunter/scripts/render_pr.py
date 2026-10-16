#!/usr/bin/env python3
"""Render the shortlist as a PR body, an issue body, or a report-only table.

Page quotes, titles, and lead text are untrusted: every value is flattened
to one line and escaped so it cannot inject markdown, HTML, or @-mentions.
"""
import argparse
import sys

from common import die, load_json

# '#' and '@' get a zero-width space so page text cannot close issues
# ("fixes #12") or ping users when the PR merges.
ESCAPES = {'|': '\\|', '<': '&lt;', '>': '&gt;', '`': "'", '@': '@\u200b', '#': '#\u200b',
           '[': '\\[', ']': '\\]'}


def esc(value, limit=300):
    flat = ' '.join(str(value if value is not None else '').split())
    if len(flat) > limit:
        flat = flat[:limit - 1] + '…'
    return ''.join(ESCAPES.get(ch, ch) for ch in flat)


def url(value):
    return '<' + esc(value, 200).replace('&lt;', '').replace('&gt;', '') + '>'


def offers_table(selected):
    rows = ['| # | Offer | Action | Amount | Expiry | Score | Official source |',
            '|---|-------|--------|--------|--------|-------|-----------------|']
    for e in selected:
        o = e['offer']
        rows.append(f'| {e["rank"]} | {esc(o["title"], 120)} (`{e["slug"]}`) | {e["action"]} | '
                    f'{esc(o["amount"], 120)} | {o["expiry_date"] or "ongoing"} | {e["score"]} | '
                    f'{url(o["source_url"])} |')
    return rows


def evidence(selected):
    out = []
    for e in selected:
        o = e['offer']
        out += ['', f'### {e["rank"]}. {esc(o["title"], 120)} (`{e["slug"]}`, {e["action"]})', '',
                f'- Provider: {esc(o["provider"], 120)} · category `{o["category"]}` · signup `{o["signup"]}`',
                f'- Official evidence: {url(e["evidence_url"])}', f'  > {esc(e["quote"], 500)}',
                f'- Value basis: {esc(e["value_basis"])}',
                f'- Lead ({e["lead"]["type"]}, {e["lead"].get("date") or "date unknown"}): {url(e["lead"]["url"])}'
                + ('' if e['lead'].get('matches_official') else ' (figures differ from official; not embedded)')]
        if e.get('distinct_from'):
            out.append(f'- Distinct from existing listings: {esc(e["distinct_from"])}')
        for c in e['changes']:
            out.append(f'- Change `{c["field"]}`: {esc(c["from"], 150)} → {esc(c["to"], 150)}')
        out.append('- References verified:')
        out += [f'  - {esc(r["title"], 120)}: {url(r["url"])}' for r in e['references']]
    return out


def not_included(rejected):
    if not rejected:
        return ['', '## Not included', '', 'None.']
    rows = ['', '## Not included', '', '| Candidate | Verdict | Reason |', '|-----------|---------|--------|']
    rows += [f'| {esc(r["label"], 120)} | {r["verdict"]} | {esc(r["reason"], 200)} |' for r in rejected]
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shortlist', required=True)
    parser.add_argument('--mode', choices=('pr', 'issue', 'report'), required=True)
    parser.add_argument('--issue', type=int, help='tracking issue number (pr mode)')
    parser.add_argument('--checks', default='', help='semicolon-separated local check results (pr mode)')
    parser.add_argument('--web-tools', default='', help='one-line note on web-tool fallbacks used')
    args = parser.parse_args()
    if args.mode == 'pr' and not args.issue:
        die('--mode pr needs --issue <number>', 'create the tracking issue first, then pass its number')
    doc = load_json(args.shortlist, 'shortlist')
    selected, rejected, today = doc['selected'], doc['rejected'], doc['today']
    new = sum(e['action'] == 'new' for e in selected)
    upd = len(selected) - new
    headline = (f'Offer hunt {today}: {new} new and {upd} updated offers from '
                f'{doc["candidates"]} candidates verified against official sources.')
    lines = []
    if args.mode == 'pr':
        lines += [f'Closes #{args.issue}', '']
    lines += ['## Summary', '', headline]
    if args.mode == 'report':
        lines += ['', 'Report only: nothing was written, committed, or opened.']
    lines += ['', '## Offers', ''] + (offers_table(selected) if selected else ['None qualified.'])
    if args.mode == 'issue':
        lines += ['', '## Done when', '',
                  '- [ ] every listed offer quotes its official page and links its lead',
                  '- [ ] new offers carry verification social_proof and review_status under-review',
                  '- [ ] updates change only title, amount, expiry_date, signup, verified_date',
                  '- [ ] validate_offers.py passes; index.json and the llms files are regenerated',
                  '- [ ] a human reviewer approves the PR']
    else:
        lines += ['', '## Evidence'] + evidence(selected) + not_included(rejected)
    if args.web_tools:
        lines += ['', f'Web tools: {esc(args.web_tools)}']
    if args.mode == 'pr':
        checks = [c.strip() for c in args.checks.split(';') if c.strip()]
        lines += ['', '## Checks', ''] + [f'- {esc(c)}' for c in checks]
        lines += ['', '## Not checked', '',
                  '- Claim flows were not completed: no account was created and no credit was redeemed.',
                  '- Leads from X and Reddit are corroboration only; every value comes from the official page.']
        lines += ['', '## Decision', '',
                  'Review each offer against its official source, then approve and merge to publish. '
                  'Nothing goes live until this PR is merged; close it or drop files to reject offers.']
    sys.stdout.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
