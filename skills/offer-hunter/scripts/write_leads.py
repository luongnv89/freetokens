#!/usr/bin/env python3
"""Keep unverified/ in step with a hunt: add, refresh, and remove lead files.

Two modes:

  --queue N        print up to N open leads (oldest last_seen first) as
                   Step 4 candidates, each carrying its ``lead_slug``.
  --verdicts FILE  apply the lifecycle to unverified/ and print a JSON
                   report (added / refreshed / removed / dropped / applied).

Lifecycle (#660): an ``unverifiable`` verdict with an ``unverified_lead``
block is added, or refreshes the lead with the same provider and title
(``last_seen`` = today, new source appended). A re-checked lead
(``lead_slug``) is removed when it was published as an offer this run,
when the verifier found it expired, duplicate, or contradicted
(``unverified_drop``), and a lead last seen more than 30 days ago is
removed. Every file is validated with scripts/lead_model.py before any
write; a lead that fails is dropped with its reason, never listed.
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
from lead_model import OfferError  # noqa: E402

LEADS_DIR = REPO / 'unverified'
OFFERS_DIR = REPO / 'offers'
TYPE_MAP = {'x': 'x', 'reddit': 'reddit', 'link': 'web', 'web': 'web'}
HEADER = ('Unverified lead (offer-hunter): seen on X, Reddit, or the web; not confirmed on an '
          'official page.\nNever an offer: it is listed only on the Unverified page.')


def slugify(text):
    slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return slug[:60].rstrip('-') or 'lead'


def offer_slugs(offers_dir):
    slugs = set()
    for root, _dirs, files in os.walk(offers_dir):
        if os.path.basename(root) == 'details':
            continue
        slugs.update(os.path.splitext(f)[0] for f in files if f.endswith(('.yaml', '.yml')))
    return slugs


def load_existing(leads_dir, today):
    try:
        return {lead['slug']: lead for lead in lead_model.load_leads(str(leads_dir), (), today)}
    except OfferError as exc:
        die(f'an existing lead file is invalid: {exc}', 'fix or delete that file, then re-run')


def key(provider, title):
    return (' '.join(provider.lower().split()), ' '.join(title.lower().split()))


def source_from(lead):
    if not isinstance(lead, dict):
        raise OfferError('the verdict has no lead to cite')
    kind = TYPE_MAP.get(lead.get('type'))
    if kind is None:
        raise OfferError(f'lead type {lead.get("type")!r} is not x, reddit, or link')
    return {'url': lead.get('url'), 'type': kind, 'author': lead.get('author') or None,
            'handle': lead.get('handle') or None, 'date': lead.get('date') or None}


def queue(existing, limit, today):
    # Stale leads are deleted by this run anyway; never spend a slot on them.
    open_leads = sorted((lead for lead in existing.values() if not lead_model.is_stale(lead, today)),
                        key=lambda lead: (lead['last_seen'], lead['slug']))
    out = []
    for n, lead in enumerate(open_leads[:limit], 1):
        src = lead['sources'][-1]
        out.append({'id': f'lead-{n:02d}', 'lead_slug': lead['slug'],
                    'label': f'{lead["provider"]} — {lead["title"]}', 'provider': lead['provider'],
                    'program': lead['title'], 'claimed_amount': lead['amount_claimed'],
                    'claimed_url': lead['official_urls_tried'][0],
                    'lead': {'type': 'link' if src['type'] == 'web' else src['type'],
                             'url': src['url'], 'author': src['author'], 'handle': src['handle'],
                             'community': None, 'title': None, 'date': src['date'],
                             'text': lead['claim']}})
    return out


def apply(verdicts, existing, selected_ids, today, offers_dir=OFFERS_DIR):
    iso = today.isoformat()
    taken = offer_slugs(offers_dir)
    by_key = {key(lead['provider'], lead['title']): slug for slug, lead in existing.items()}
    leads = copy.deepcopy(existing)
    added, refreshed, removed, dropped = [], [], {}, []

    def merge_fields(lead, entry):
        for field in ('reason', 'reason_detail'):
            if entry.get(field):
                lead[field] = entry[field]
        for url in entry.get('official_urls_tried') or []:
            if url not in lead['official_urls_tried']:
                lead['official_urls_tried'].append(url)

    for v in verdicts:
        rid, verdict = v.get('id'), v.get('verdict')
        label = v.get('label') or rid
        entry = v.get('unverified_lead')
        slug = v.get('lead_slug')
        if slug:
            if slug not in leads:
                dropped.append({'id': rid, 'label': label, 'reason': f'lead_slug {slug!r} is not open'})
                continue
            if verdict == 'live' and rid in selected_ids:
                removed[slug] = 'verified live and published as an offer in this PR'
            elif verdict in ('expired', 'duplicate'):
                removed[slug] = f'official check: {verdict} ({v.get("reason") or "no reason"})'
            elif verdict == 'unverifiable' and not entry:
                removed[slug] = v.get('unverified_drop') or 'failed the inclusion rules on re-check'
            elif verdict == 'unverifiable':
                lead = copy.deepcopy(leads[slug])
                merge_fields(lead, entry)
                try:
                    # A scout re-found it: its newer post replaced the queued lead.
                    source = source_from(v.get('lead'))
                    if source['url'] not in {s['url'] for s in lead['sources']}:
                        lead['sources'].append(source)
                        lead['last_seen'] = max(lead['last_seen'], iso)
                    lead_model.validate_lead(lead, f'{slug}.yaml', today)
                except OfferError as exc:
                    dropped.append({'id': rid, 'label': label, 'reason': f're-check not applied: {exc}'})
                    continue
                leads[slug] = lead
                if lead != existing[slug] and slug not in refreshed:
                    refreshed.append(slug)
            continue
        if verdict != 'unverifiable':
            continue
        if not entry:
            dropped.append({'id': rid, 'label': label,
                            'reason': v.get('unverified_drop') or 'no unverified_lead block'})
            continue
        try:
            source = source_from(v.get('lead'))
            provider, title = entry.get('provider') or '', entry.get('title') or ''
            match = by_key.get(key(provider, title))
            if match and match not in removed:
                lead = leads[match]
                lead['last_seen'] = max(lead['last_seen'], iso)
                if source['url'] not in {s['url'] for s in lead['sources']}:
                    lead['sources'].append(source)
                merge_fields(lead, entry)
                lead_model.validate_lead(lead, f'{match}.yaml', today)
                if match not in added and match not in refreshed and lead != existing.get(match):
                    refreshed.append(match)
                continue
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
            lead_model.validate_lead(lead, f'{new_slug}.yaml', today)
        except OfferError as exc:
            dropped.append({'id': rid, 'label': label, 'reason': str(exc)})
            continue
        leads[new_slug] = lead
        by_key[key(provider, title)] = new_slug
        added.append(new_slug)

    for slug, lead in leads.items():
        if slug in removed:
            continue
        if slug in taken:
            removed[slug] = 'an offer with this slug is now listed'
        elif lead_model.is_stale(lead, today):
            removed[slug] = f'last seen {lead["last_seen"]}, more than {lead_model.STALE_DAYS} days ago'
    for slug in removed:
        if slug in added:
            added.remove(slug)
        if slug in refreshed:
            refreshed.remove(slug)
    return leads, added, refreshed, removed, dropped


def rel(path):
    try:
        return str(path.resolve().relative_to(REPO))
    except ValueError:
        return str(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--queue', type=int, metavar='N', help='print up to N open leads as candidates')
    mode.add_argument('--verdicts', help='verdicts.json from Step 5')
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
    if args.queue is not None:
        json.dump(queue(existing, max(0, args.queue), today), sys.stdout, indent=1, ensure_ascii=False)
        sys.stdout.write('\n')
        return
    verdicts = load_json(args.verdicts, 'verdicts')
    if not isinstance(verdicts, list):
        die('verdicts must be a JSON array', 'concatenate worker arrays into one array')
    selected = set()
    if args.shortlist:
        selected = {e.get('id') for e in load_json(args.shortlist, 'shortlist').get('selected', [])}
    leads, added, refreshed, removed, dropped = apply(verdicts, existing, selected, today, args.offers_dir)

    applied = []
    if not args.dry_run:
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
              'dropped': dropped, 'applied': applied}
    json.dump(report, sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write('\n')
    print(f'OK leads {len(added)} added / {len(refreshed)} refreshed / {len(removed)} removed '
          f'({len(dropped)} dropped)', file=sys.stderr)


if __name__ == '__main__':
    main()
