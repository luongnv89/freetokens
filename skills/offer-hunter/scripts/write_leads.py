#!/usr/bin/env python3
"""Keep unverified/ in step with a hunt: add, refresh, and remove lead files.

Modes:

  --open           print every open (fresh) lead as {lead_slug, provider,
                   program, label, posted} so Step 4 can tag any scout
                   candidate naming the same provider and program.
  --queue N        print up to N open leads (oldest last_seen first) as
                   Step 4 re-check candidates, each carrying its lead_slug.
  --verdicts FILE  apply the lifecycle to unverified/ and print a JSON report
                   (added / refreshed / removed / dropped / kept / applied).
                   An empty array only prunes stale leads.

Lifecycle (#660):

- Freshness: a lead is listed only while its newest dated source post is at
  most 3 days old (schemas/unverified-lead.rules.json). An undated lead is
  never admitted ("undated source"); a stale one is removed. Only a new
  dated post extends freshness; a re-check alone never does.
- A verdict reaches an open lead by its lead_slug, or else by provider +
  program (the unverified_lead block, or the verdict label).
- Matched lead: live + shortlisted -> removed (published as an offer);
  live but not shortlisted -> kept and reported; expired or duplicate ->
  removed; official_contradicts or an explicit unverified_drop -> removed;
  unverifiable with an unverified_lead -> refreshed (last_seen = today, new
  post appended); anything else (a failed re-check) -> kept unchanged and
  reported. Every change is made on a copy, validated, then assigned.
- New unverifiable verdict: added when it carries an unverified_lead, is not
  official_contradicts, has a dated, fresh post, and validates.
"""
import argparse
import copy
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys

from common import REPO, die, load_json

sys.path.insert(0, str(REPO / 'scripts'))
import lead_model  # noqa: E402
from lead_model import OfferError, norm  # noqa: E402

LEADS_DIR = REPO / 'unverified'
OFFERS_DIR = REPO / 'offers'
TYPE_MAP = {'x': 'x', 'reddit': 'reddit', 'link': 'web', 'web': 'web'}
HEADER = ('Unverified lead (offer-hunter): seen on X, Reddit, or the web; not confirmed on an '
          f'official page.\nNever an offer: listed on the Unverified page for {lead_model.FRESH_DAYS} '
          'days after the newest post.')


def slugify(text):
    slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return slug[:60].rstrip('-') or 'lead'


def offer_slugs(offers_dir):
    slugs = set()
    for root, _dirs, files in os.walk(offers_dir):
        if os.path.basename(root) == 'details':
            continue
        slugs.update(os.path.splitext(f)[0] for f in files if f.endswith('.yaml'))
    return slugs


def load_existing(leads_dir, today):
    try:
        return {lead['slug']: lead for lead in lead_model.load_leads(str(leads_dir), (), today)}
    except OfferError as exc:
        die(f'an existing lead file is invalid: {exc}', 'fix or delete that file, then re-run')


def key(provider, title):
    return (norm(provider), norm(title))


def label_of(lead):
    return f'{lead["provider"]} — {lead["title"]}'


def source_from(lead):
    if not isinstance(lead, dict):
        raise OfferError('the verdict has no lead to cite')
    kind = TYPE_MAP.get(lead.get('type'))
    if kind is None:
        raise OfferError(f'lead type {lead.get("type")!r} is not x, reddit, or link')
    return {'url': lead.get('url'), 'type': kind, 'author': lead.get('author') or None,
            'handle': lead.get('handle') or None, 'date': lead.get('date') or None}


def stale_reason(lead):
    newest = lead_model.newest_post(lead)
    if newest is None:
        return 'undated source'
    return f'stale: newest post {newest} is more than {lead_model.FRESH_DAYS} days old'


def open_leads(existing, today):
    return [lead for lead in existing.values() if not lead_model.is_stale(lead, today)]


def queue(existing, limit, today):
    leads = sorted(open_leads(existing, today), key=lambda lead: (lead['last_seen'], lead['slug']))
    out = []
    for n, lead in enumerate(leads[:limit], 1):
        src = max(lead['sources'], key=lambda s: s['date'] or '')
        out.append({'id': f'lead-{n:02d}', 'lead_slug': lead['slug'], 'label': label_of(lead),
                    'provider': lead['provider'], 'program': lead['title'],
                    'claimed_amount': lead['amount_claimed'],
                    'claimed_url': lead['official_urls_tried'][0],
                    'lead': {'type': 'link' if src['type'] == 'web' else src['type'],
                             'url': src['url'], 'author': src['author'], 'handle': src['handle'],
                             'community': None, 'title': None, 'date': src['date'],
                             'text': lead['claim']}})
    return out


def apply(verdicts, existing, shortlist, today, offers_dir=OFFERS_DIR):
    iso = today.isoformat()
    taken = offer_slugs(offers_dir)
    selected_ids = {e.get('id') for e in shortlist.get('selected', [])}
    rejected = {r.get('id'): r.get('reason') for r in shortlist.get('rejected', [])}
    leads = copy.deepcopy(existing)
    by_key = {key(lead['provider'], lead['title']): slug for slug, lead in leads.items()}
    by_label = {norm(label_of(lead)): slug for slug, lead in leads.items()}
    added, refreshed, removed, dropped, kept = [], [], {}, [], []

    def merged(lead, entry, source):
        out = copy.deepcopy(lead)
        for field in ('reason', 'reason_detail'):
            if entry.get(field):
                out[field] = ' '.join(str(entry[field]).split())
        for url in entry.get('official_urls_tried') or []:
            if url not in out['official_urls_tried']:
                out['official_urls_tried'].append(url)
        if source['url'] not in {s['url'] for s in out['sources']}:
            out['sources'].append(source)
        out['last_seen'] = max(out['last_seen'], iso)
        return out

    for v in verdicts:
        rid, verdict = v.get('id'), v.get('verdict')
        label = v.get('label') or rid
        entry = v.get('unverified_lead') if isinstance(v.get('unverified_lead'), dict) else None
        drop = v.get('unverified_drop')
        contradicts = v.get('official_contradicts') is True
        explicit = v.get('lead_slug')
        slug = explicit
        if not slug and entry:
            slug = by_key.get(key(entry.get('provider'), entry.get('title')))
        if not slug:
            slug = by_label.get(norm(label))
        if slug in removed:
            continue
        if slug and slug not in leads:
            dropped.append({'id': rid, 'label': label, 'reason': f'lead_slug {slug!r} is not open'})
            continue

        if slug:  # an open lead: re-check, re-sighting, promotion, or ending
            failed = 're-check failed' if explicit else 'not merged'
            if verdict == 'live':
                if rid in selected_ids:
                    removed[slug] = 'verified live and published as an offer in this PR'
                else:
                    kept.append({'slug': slug, 'id': rid, 'reason': 'came back live but was not '
                                 f'published: {rejected.get(rid) or "not shortlisted"}'})
            elif verdict in ('expired', 'duplicate'):
                removed[slug] = f'official check: {verdict} ({v.get("reason") or "no reason"})'
            elif contradicts:
                removed[slug] = drop or 'an official page contradicts it'
            elif verdict == 'unverifiable' and drop and not entry:
                removed[slug] = drop
            elif verdict == 'unverifiable' and entry:
                try:
                    lead = merged(leads[slug], entry, source_from(v.get('lead')))
                    lead_model.validate_lead(lead, f'{slug}.yaml', today)
                except OfferError as exc:
                    dropped.append({'id': rid, 'label': label, 'reason': f'{failed}: {exc}'})
                    continue
                leads[slug] = lead
                if lead != existing.get(slug) and slug not in added and slug not in refreshed:
                    refreshed.append(slug)
            else:
                dropped.append({'id': rid, 'label': label, 'reason': f'{failed}: no unverified_lead '
                                'and no unverified_drop; the lead is kept unchanged'})
            continue

        if verdict != 'unverifiable':
            continue
        if contradicts or not entry:
            reason = drop or ('an official page contradicts it' if contradicts else 'no unverified_lead block')
            dropped.append({'id': rid, 'label': label, 'reason': reason})
            continue
        try:
            source = source_from(v.get('lead'))
            provider, title = entry.get('provider') or '', entry.get('title') or ''
            base = slugify(f'{provider} {title}')
            new_slug, n = base, 2
            while new_slug in leads or new_slug in taken:
                new_slug, n = f'{base}-{n}', n + 1
            lead = {'slug': new_slug, 'provider': provider, 'title': title,
                    'claim': ' '.join(str(entry.get('claim') or '').split()),
                    'amount_claimed': entry.get('amount_claimed'), 'sources': [source],
                    'first_seen': iso, 'last_seen': iso, 'reason': entry.get('reason'),
                    'reason_detail': ' '.join(str(entry.get('reason_detail') or '').split()),
                    'official_urls_tried': list(entry.get('official_urls_tried') or [])}
            if lead_model.is_stale(lead, today):
                raise OfferError(stale_reason(lead))
            lead_model.validate_lead(lead, f'{new_slug}.yaml', today)
        except OfferError as exc:
            dropped.append({'id': rid, 'label': label, 'reason': str(exc)})
            continue
        leads[new_slug] = lead
        by_key[key(provider, title)] = new_slug
        by_label[norm(label_of(lead))] = new_slug
        added.append(new_slug)

    for slug, lead in leads.items():
        if slug in removed:
            continue
        if slug in taken:
            removed[slug] = 'an offer with this slug is now listed'
        elif lead_model.is_stale(lead, today):
            removed[slug] = stale_reason(lead)
    added = [s for s in added if s not in removed]
    refreshed = [s for s in refreshed if s not in removed]
    return leads, added, refreshed, removed, dropped, kept


def rel(path):
    try:
        return str(path.resolve().relative_to(REPO))
    except ValueError:
        return str(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--open', action='store_true', help='print every open lead for Step 4 matching')
    mode.add_argument('--queue', type=int, metavar='N', help='print up to N open leads as candidates')
    mode.add_argument('--verdicts', help='verdicts.json from Step 5 ([] only prunes stale leads)')
    parser.add_argument('--shortlist', help='shortlist.json from Step 6 (ids published this run)')
    parser.add_argument('--today', default=dt.date.today().isoformat())
    parser.add_argument('--dry-run', action='store_true', help='report without writing files')
    parser.add_argument('--leads-dir', default=str(LEADS_DIR), help=argparse.SUPPRESS)
    parser.add_argument('--offers-dir', default=str(OFFERS_DIR), help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        today = dt.date.fromisoformat(args.today)
    except ValueError:
        die(f'--today must be YYYY-MM-DD, got {args.today!r}')
    leads_dir = Path(args.leads_dir)
    existing = load_existing(leads_dir, today)
    if args.open:
        rows = [{'lead_slug': lead['slug'], 'provider': lead['provider'], 'program': lead['title'],
                 'label': label_of(lead), 'posted': lead_model.newest_post(lead)}
                for lead in sorted(open_leads(existing, today), key=lambda lead: lead['slug'])]
        json.dump(rows, sys.stdout, indent=1, ensure_ascii=False)
        sys.stdout.write('\n')
        return
    if args.queue is not None:
        json.dump(queue(existing, max(0, args.queue), today), sys.stdout, indent=1, ensure_ascii=False)
        sys.stdout.write('\n')
        return
    verdicts = load_json(args.verdicts, 'verdicts')
    if not isinstance(verdicts, list):
        die('verdicts must be a JSON array', 'concatenate worker arrays into one array')
    shortlist = load_json(args.shortlist, 'shortlist') if args.shortlist else {}
    leads, added, refreshed, removed, dropped, kept = apply(verdicts, existing, shortlist, today,
                                                            args.offers_dir)

    applied = []
    if not args.dry_run:
        if added or refreshed:
            leads_dir.mkdir(exist_ok=True)
        for slug in added + refreshed:
            path = leads_dir / f'{slug}.yaml'
            path.write_text(lead_model.dump_lead(leads[slug], HEADER), encoding='utf-8')
            applied.append(rel(path))
        for slug in removed:
            path = leads_dir / f'{slug}.yaml'
            if path.exists():
                path.unlink()
                applied.append(rel(path))
    report = {'today': today.isoformat(), 'added': added, 'refreshed': refreshed,
              'removed': [{'slug': s, 'reason': r} for s, r in removed.items()],
              'dropped': dropped, 'kept': kept, 'applied': applied}
    json.dump(report, sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write('\n')
    print(f'OK leads {len(added)} added / {len(refreshed)} refreshed / {len(removed)} removed '
          f'({len(dropped)} dropped, {len(kept)} kept for review)', file=sys.stderr)


if __name__ == '__main__':
    main()
