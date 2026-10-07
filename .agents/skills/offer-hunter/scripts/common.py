"""Shared helpers for the offer-hunter bundled scripts (stdlib only)."""
import datetime as dt
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit, urlunsplit

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'scripts'))
from offer_model import (CATEGORIES, OfferError, parse_offer_text,  # noqa: E402
                         validate_detail, validate_offer)

CATEGORY_SET = frozenset(CATEGORIES)
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')
OFFER_FIELDS = ('title', 'provider', 'category', 'amount', 'expiry_date', 'source_url', 'signup')
UPDATABLE = ('title', 'amount', 'expiry_date', 'signup')
NEVER_OFFICIAL_HOSTS = ('reddit.com', 'redd.it', 'news.ycombinator.com', 'x.com', 'twitter.com',
                        'linkedin.com', 'youtube.com', 'producthunt.com', 'discord.com', 'discord.gg',
                        't.me', 'medium.com', 'substack.com')
# Suffixes under which every label is a different owner: a registrable site
# is one label more than the suffix, and some hosting platforms are only
# trustworthy at the full host.
MULTI_LABEL_SUFFIXES = ('co.uk', 'org.uk', 'ac.uk', 'com.au', 'co.jp', 'co.kr', 'com.br', 'co.in',
                        'com.cn', 'com.sg', 'co.nz', 'com.tw', 'com.hk')
PLATFORM_SUFFIXES = ('github.io', 'vercel.app', 'pages.dev', 'netlify.app', 'herokuapp.com',
                     'web.app', 'firebaseapp.com', 'notion.site', 'gitbook.io', 'readthedocs.io',
                     'hf.space', 'replit.app')
ARTIFACTS = ('index.json', 'app/public/llms.txt', 'app/public/llms-full.txt')
FATAL = 2


def die(message, hint=None, code=FATAL):
    print('Error: ' + message, file=sys.stderr)
    if hint:
        print('Fix: ' + hint, file=sys.stderr)
    sys.exit(code)


def iso_date(value, label):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError(f'{label} must be a YYYY-MM-DD string, got {value!r}')
    return dt.date.fromisoformat(value)


def load_json(path, label):
    try:
        with open(path, encoding='utf-8') as handle:
            return json.load(handle, object_pairs_hook=_no_duplicates)
    except FileNotFoundError:
        die(f'{label} file not found: {path}', f'pass the path written by the earlier step')
    except (json.JSONDecodeError, ValueError) as exc:
        die(f'{label} file {path} is not valid JSON: {exc}',
            'strip markdown fences or prose so the file holds one JSON document')


def _no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'duplicate key {key!r}')
        result[key] = value
    return result


def normalize_url(url):
    parts = urlsplit(url.strip())
    path = parts.path.rstrip('/') or '/'
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, parts.query, ''))


def host(url):
    return (urlsplit(url).hostname or '').lower()


def site(url):
    """The owner-level domain of a URL (www stripped)."""
    name = host(url).removeprefix('www.')
    for suffix in PLATFORM_SUFFIXES:
        if name == suffix or name.endswith('.' + suffix):
            return name
    labels = name.split('.')
    keep = 3 if '.'.join(labels[-2:]) in MULTI_LABEL_SUFFIXES else 2
    return '.'.join(labels[-keep:]) if len(labels) >= keep else name


def is_public_http(url):
    if not isinstance(url, str) or not url.startswith(('https://', 'http://')):
        return False
    name = host(url)
    if not name or name == 'localhost' or name.endswith('.local') or name.endswith('.internal'):
        return False
    if re.fullmatch(r'[\d.]+', name) or ':' in name:
        return False
    return True


def never_official(url):
    name = host(url)
    return any(name == h or name.endswith('.' + h) for h in NEVER_OFFICIAL_HOSTS)


def read_catalog(offers_dir):
    """Every offer YAML under offers_dir (top level and archive/)."""
    offers_dir = Path(offers_dir)
    rows = []
    for path in sorted(offers_dir.rglob('*.y*ml')):
        rel = path.relative_to(offers_dir)
        if rel.parts[0] == 'details' or path.suffix not in ('.yaml', '.yml'):
            continue
        try:
            data = parse_offer_text(path.read_text(encoding='utf-8'), str(path))
        except OfferError as exc:
            die(f'cannot parse {path}: {exc}', 'run python3 scripts/validate_offers.py and fix the catalog first')
        rows.append({
            'slug': path.stem,
            'path': str(rel),
            'archived': len(rel.parts) > 1,
            **{k: data.get(k) for k in OFFER_FIELDS},
            'verified_date': data.get('verified_date'),
            'verification': data.get('verification'),
            'review_status': data.get('review_status'),
        })
    return rows
