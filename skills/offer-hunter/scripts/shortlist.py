#!/usr/bin/env python3
"""Check verifier coverage, apply the value floor, dedupe, rank, and cap.

Reads the candidates, the verdicts, and the catalog snapshot. Prints the
shortlist JSON to stdout and a one-line summary to stderr. Nothing is
written. Exit 1: some verdict records are malformed (ids named, retryable).
Exit 2: fatal input error (bad flags or unreadable files); stop.
"""
import argparse
import json
import sys

from common import (CATEGORY_SET, SLUG, OfferError, UPDATABLE, die, iso_date, load_json,
                    never_official, normalize_url, is_public_http, site, validate_offer)

VERDICTS = ('live', 'expired', 'unverifiable', 'duplicate')
ACTIONS = ('new', 'update', 'none')
PERIODS = {'one_time': 1, 'year': 1 / 12, 'month': 1, 'week': 4, 'day': 30}
MIN_USD = 5
MIN_TOKENS = 100_000
TOKENS_PER_USD = MIN_TOKENS / MIN_USD
SCORE_CAP = 1000
LEAD_TYPES = ('x', 'reddit', 'link')
OFFER_KEYS = ('title', 'provider', 'category', 'amount', 'expiry_date', 'source_url', 'signup')


class Bad(Exception):
    pass


def text(value, label, limit, required=True):
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise Bad(f'{label} must be a non-empty string')
    if len(value) > limit:
        raise Bad(f'{label} is {len(value)} chars; limit {limit}')
    return value


def check_offer(offer):
    if not isinstance(offer, dict) or set(offer) - set(OFFER_KEYS):
        raise Bad(f'offer must be an object with only {", ".join(OFFER_KEYS)}')
    for key in OFFER_KEYS:
        if key == 'expiry_date':
            if offer.get(key) is not None:
                iso_date(offer[key], 'offer.expiry_date')
        else:
            text(offer.get(key), f'offer.{key}', 300)


def check_references(refs):
    if not isinstance(refs, list) or not 1 <= len(refs) <= 5:
        raise Bad('references must list 1-5 pages you loaded')
    for i, ref in enumerate(refs):
        if not isinstance(ref, dict) or set(ref) != {'url', 'title', 'text'}:
            raise Bad(f'references[{i}] must have exactly url, title, text')
        text(ref['url'], f'references[{i}].url', 200)
        if not is_public_http(ref['url']):
            raise Bad(f'references[{i}].url is not a public http(s) URL')
        text(ref['title'], f'references[{i}].title', 200)
        text(ref['text'], f'references[{i}].text', 500)


def check_lead(lead, today):
    if not isinstance(lead, dict) or lead.get('type') not in LEAD_TYPES:
        raise Bad('lead must be an object with type x, reddit, or link')
    text(lead.get('url'), 'lead.url', 200)
    if not is_public_http(lead['url']):
        raise Bad('lead.url is not a public http(s) URL')
    if not isinstance(lead.get('matches_official'), bool):
        raise Bad('lead.matches_official must be true or false')
    for key in ('author', 'handle', 'community', 'title', 'text'):
        if lead.get(key) is not None and not isinstance(lead[key], str):
            raise Bad(f'lead.{key} must be a string or null')
    if lead.get('date') is not None and iso_date(lead['date'], 'lead.date').isoformat() > today:
        raise Bad('lead.date is in the future')


def check_detail(record):
    summary, steps = record.get('summary'), record.get('claim_steps')
    if summary is not None:
        text(summary, 'summary', 2000)
    if steps is not None:
        if not isinstance(steps, list) or not 1 <= len(steps) <= 12:
            raise Bad('claim_steps must be a list of 1-12 strings or null')
        for i, step in enumerate(steps):
            text(step, f'claim_steps[{i}]', 300)


def value_score(value):
    if not isinstance(value, dict):
        raise Bad('value must be an object {usd, tokens, period, unlimited, basis}')
    if value.get('period') not in PERIODS:
        raise Bad('value.period must be one_time, year, month, week, or day')
    if not isinstance(value.get('unlimited'), bool):
        raise Bad('value.unlimited must be true or false')
    text(value.get('basis'), 'value.basis', 300)
    usd, tokens = value.get('usd'), value.get('tokens')
    for name, number in (('usd', usd), ('tokens', tokens)):
        if number is not None and (isinstance(number, bool) or not isinstance(number, (int, float)) or number < 0):
            raise Bad(f'value.{name} must be a non-negative number or null')
    if value['unlimited']:
        return SCORE_CAP, True
    factor = PERIODS[value['period']]
    usd_eq, tokens_eq = (usd or 0) * factor, (tokens or 0) * factor
    passes = usd_eq >= MIN_USD or tokens_eq >= MIN_TOKENS
    return round(min(SCORE_CAP, max(usd_eq, tokens_eq / TOKENS_PER_USD)), 2), passes


def evaluate(record, catalog, pending, today, categories):
    """Return (eligible entry or None, rejection reason)."""
    if record['verdict'] != 'live':
        return None, record['reason']
    if record['action'] == 'none':
        return None, 'live but unchanged versus the catalog'
    action, offer = record['action'], record.get('offer')
    check_offer(offer)
    check_references(record.get('references'))
    evidence_url = text(record.get('evidence_url'), 'evidence_url', 200)
    text(record.get('quote'), 'quote', 500)
    if evidence_url not in [ref['url'] for ref in record['references']]:
        raise Bad('evidence_url must be one of the references')
    check_lead(record.get('lead'), today)
    check_detail(record)
    score, passes = value_score(record.get('value'))
    slug = record.get('slug')
    if not isinstance(slug, str) or not SLUG.fullmatch(slug):
        raise Bad('slug must match ^[a-z0-9]+(-[a-z0-9]+)*$')
    if record.get('distinct_from') is not None:
        text(record['distinct_from'], 'distinct_from', 300)
    if slug in pending:
        return None, f'already proposed in open PR #{pending[slug]}'

    current = catalog['by_slug'].get(slug)
    changes = []
    if action == 'update':
        if not current or current['archived']:
            raise Bad(f'update targets {slug!r}, which is not a top-level file in offers/')
        merged = {k: current[k] for k in OFFER_KEYS}
        for field in UPDATABLE:
            if offer[field] != current[field]:
                changes.append({'field': field, 'from': current[field], 'to': offer[field]})
                merged[field] = offer[field]
        if not changes:
            return None, 'live but unchanged versus the catalog'
        tags = {'verification': current['verification'], 'review_status': current['review_status']}
    else:
        merged = {k: offer[k] for k in OFFER_KEYS}
        if current:
            raise Bad(f'new slug {slug!r} already exists in offers/ (use update, or pick another slug)')
        listed = catalog['by_source'].get(normalize_url(merged['source_url']))
        if listed and listed not in (record.get('distinct_from') or ''):
            raise Bad(f'source_url is already listed as {listed!r}; use action update on that slug, '
                      'or name it in distinct_from if the page lists a different program')
        same = catalog['by_provider'].get(merged['provider'].strip().lower())
        if same and not record.get('distinct_from'):
            raise Bad(f'provider already has offers {sorted(same)}; set distinct_from '
                      'to say why this is a different program, or use action update')
        tags = {'verification': 'social_proof', 'review_status': 'under-review'}

    if not is_public_http(merged['source_url']) or never_official(merged['source_url']):
        raise Bad("source_url must be the provider's own public web page, not a social or forum post")
    if site(evidence_url) != site(merged['source_url']):
        raise Bad(f'evidence_url site {site(evidence_url)} differs from source_url site '
                  f'{site(merged["source_url"])}; use the page holding the quote as source_url')
    if merged['category'] not in CATEGORY_SET:
        raise Bad(f'category {merged["category"]!r} is not in the schema enum')
    if merged['expiry_date'] is not None and merged['expiry_date'] < today:
        return None, f'official end date {merged["expiry_date"]} has passed'
    full = dict(merged, verified_date=today, **tags)
    try:
        validate_offer(dict(full), f'{slug}.yaml')
    except OfferError as exc:
        raise Bad(str(exc)) from None
    if categories and merged['category'] not in categories:
        return None, f'category {merged["category"]} is outside the requested focus'
    if not passes:
        return None, f'below the value floor (${MIN_USD} or {MIN_TOKENS:,} tokens per month-equivalent)'
    return {
        'id': record['id'], 'label': record['label'], 'action': action, 'slug': slug,
        'offer': full, 'changes': changes, 'score': score,
        'evidence_url': evidence_url, 'quote': record['quote'],
        'references': record['references'], 'lead': record['lead'],
        'summary': record.get('summary'), 'claim_steps': record.get('claim_steps'),
        'value_basis': record['value']['basis'], 'distinct_from': record.get('distinct_from'),
    }, None


def index_catalog(snapshot):
    by_slug, by_source, by_provider = {}, {}, {}
    for row in snapshot['offers']:
        by_slug[row['slug']] = row
        if not row['archived']:
            by_source.setdefault(row['source_url_normalized'], row['slug'])
            by_provider.setdefault((row['provider'] or '').strip().lower(), set()).add(row['slug'])
    return {'by_slug': by_slug, 'by_source': by_source, 'by_provider': by_provider}


def select(eligible, max_n, rejected):
    # Stable multi-pass sort: score desc, then newest lead, then id.
    eligible.sort(key=lambda e: e['id'])
    eligible.sort(key=lambda e: e['lead'].get('date') or '', reverse=True)
    eligible.sort(key=lambda e: e['score'], reverse=True)
    selected, slugs, sources, providers = [], set(), {}, {}
    for entry in eligible:
        key_src = normalize_url(entry['offer']['source_url'])
        provider = entry['offer']['provider'].strip().lower()
        first = providers.get(provider)
        note = entry.get('distinct_from') or ''
        if entry['slug'] in slugs:
            reason = 'same slug as a higher-ranked candidate'
        elif key_src in sources and sources[key_src] not in note:
            reason = f'same source_url as higher-ranked {sources[key_src]}; distinct_from must name it'
        elif first and entry['action'] == 'new' and first not in note:
            reason = f'same provider as higher-ranked {first}; distinct_from must name it'
        elif len(selected) >= max_n:
            rejected.append({'id': entry['id'], 'label': entry['label'], 'verdict': 'live',
                             'reason': f'ranked below the top {max_n} (score {entry["score"]})'})
            continue
        else:
            slugs.add(entry['slug'])
            sources.setdefault(key_src, entry['slug'])
            providers.setdefault(provider, entry['slug'])
            selected.append(entry)
            continue
        rejected.append({'id': entry['id'], 'label': entry['label'], 'verdict': 'duplicate', 'reason': reason})
    for rank, entry in enumerate(selected, 1):
        entry['rank'] = rank
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--candidates', required=True)
    parser.add_argument('--verdicts', required=True)
    parser.add_argument('--max', type=int, default=10)
    parser.add_argument('--categories', default='', help='comma list; empty means all')
    parser.add_argument('--exclude', action='append', default=[], metavar='ID=REASON',
                        help='drop a candidate that failed write_offers.py, with the reason')
    args = parser.parse_args()
    if not 1 <= args.max <= 10:
        die(f'--max must be 1-10, got {args.max}', 'pass --max 10 or a smaller cap the user named')
    categories = {c for c in args.categories.split(',') if c}
    if categories - CATEGORY_SET:
        die(f'unknown categories {sorted(categories - CATEGORY_SET)}', 'use the schema category enum')
    excluded = dict(item.partition('=')[::2] for item in args.exclude)

    snapshot = load_json(args.snapshot, 'snapshot')
    candidates = load_json(args.candidates, 'candidates')
    verdicts = load_json(args.verdicts, 'verdicts')
    if not isinstance(candidates, list) or not isinstance(verdicts, list):
        die('candidates and verdicts must both be JSON arrays', 'concatenate worker arrays into one array per file')
    today = snapshot['today']
    wanted = [c.get('id') for c in candidates if isinstance(c, dict)]
    if len(wanted) != len(candidates) or len(set(wanted)) != len(wanted):
        die('candidates must be objects with unique id values', 'fix the Step 4 merge')

    errors, seen = [], {}
    for i, record in enumerate(verdicts):
        rid = record.get('id') if isinstance(record, dict) else None
        if rid not in wanted:
            errors.append(f'verdicts[{i}]: id {rid!r} is not a candidate id')
        elif rid in seen:
            errors.append(f'verdicts[{i}]: duplicate verdict for {rid!r}')
        else:
            seen[rid] = record
    missing = [cid for cid in wanted if cid not in seen]
    if missing:
        errors.append('no verdict for: ' + ', '.join(missing))

    catalog = index_catalog(snapshot)
    pending = {p['slug']: p['pr'] for p in snapshot.get('pending', [])}
    eligible, rejected = [], []
    for cid in wanted:
        record = seen.get(cid)
        if record is None:
            continue
        try:
            if record.get('verdict') not in VERDICTS or record.get('action') not in ACTIONS:
                raise Bad('verdict must be live|expired|unverifiable|duplicate and action new|update|none')
            text(record.get('label'), 'label', 200)
            text(record.get('reason'), 'reason', 500)
            if cid in excluded:
                entry, reason = None, 'write check failed: ' + (excluded[cid] or 'see run log')
            else:
                entry, reason = evaluate(record, catalog, pending, today, categories)
        except (Bad, ValueError, TypeError, AttributeError, KeyError) as exc:
            errors.append(f'{cid}: {exc}')
            continue
        if entry:
            eligible.append(entry)
        else:
            rejected.append({'id': cid, 'label': record['label'], 'verdict': record['verdict'], 'reason': reason})

    if errors:
        print('Error: verdicts failed the shortlist checks:', file=sys.stderr)
        for line in errors:
            print('  - ' + line, file=sys.stderr)
        print('Fix: ask the verifier for corrected records for these ids (once); an id that stays '
              'broken becomes unverifiable with the error as its reason.', file=sys.stderr)
        sys.exit(1)

    selected = select(eligible, args.max, rejected)
    new_count = sum(e['action'] == 'new' for e in selected)
    print(json.dumps({'today': today, 'max': args.max, 'candidates': len(wanted),
                      'new_count': new_count, 'update_count': len(selected) - new_count,
                      'selected': selected, 'rejected': rejected}, indent=1, ensure_ascii=False))
    print(f'OK selected {len(selected)} of {len(wanted)} candidates ({new_count} new, '
          f'{len(selected) - new_count} update, {len(rejected)} not included)', file=sys.stderr)


if __name__ == '__main__':
    main()
