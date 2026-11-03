"""Unverified leads: parse and validate unverified/<slug>.yaml (#660).

A lead is an offer the offer-hunter found on X, Reddit, or the web but could
not confirm on an official page (verdict ``unverifiable``). Leads are never
offers: they live in their own folder, never reach index.json, the llms
files, or offer pages, and only render on the Unverified page.

File format: one ``key: value`` line per field, like offers/*.yaml, with no
nesting. List fields (``sources``, ``official_urls_tried``) and any string
that needs quoting are written as one-line JSON values, which are valid YAML
flow scalars, so the stdlib parses them in Python and Node alike.

Stdlib-only. The Node mirror lives in app/scripts/load-leads.mjs.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
from urllib.parse import urlsplit

from offer_model import OfferError

FIELDS = (
    "slug",
    "provider",
    "title",
    "claim",
    "amount_claimed",
    "sources",
    "first_seen",
    "last_seen",
    "reason",
    "reason_detail",
    "official_urls_tried",
)
NULLABLE = frozenset({"amount_claimed"})
REASONS = ("bot_walled", "official_silent", "no_amount", "single_source", "other")
SOURCE_TYPES = ("x", "reddit", "web")
SOURCE_KEYS = ("url", "type", "author", "handle", "date")
# A lead disappears this many days after it was last seen.
STALE_DAYS = 30
LIMITS = {"provider": 80, "title": 120, "claim": 300, "amount_claimed": 120, "reason_detail": 400}

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_IN_TEXT_RE = re.compile(r"(https?://|www\.|\bt\.co/)", re.IGNORECASE)
# Claim instructions the early lane forbids (skills/offer-updater/references/
# early-lane.md -> Safe claim path): DMs, handing over secrets or payment.
UNSAFE_CLAIM_RE = re.compile(
    r"\b(dm (me|us)|send (me|us) a dm|direct message|seed phrase|recovery phrase|"
    r"private key|wallet address|connect (your )?wallet|card number|password)\b",
    re.IGNORECASE,
)
SHORTENER_HOSTS = frozenset({
    "t.co", "bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "buff.ly", "is.gd", "rebrand.ly",
    "cutt.ly", "lnkd.in", "shorturl.at", "tiny.cc", "rb.gy", "s.id", "dub.sh", "redd.it",
    "linktr.ee", "forms.gle",
})
FORM_HOSTS = frozenset({"docs.google.com", "forms.gle", "typeform.com", "tally.so", "jotform.com"})
X_HOSTS = frozenset({"x.com", "twitter.com"})
REDDIT_HOSTS = frozenset({"reddit.com", "old.reddit.com"})
SOCIAL_HOSTS = X_HOSTS | REDDIT_HOSTS | frozenset({"news.ycombinator.com", "t.me", "discord.gg",
                                                   "discord.com", "linkedin.com", "youtube.com"})


def _host(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _on(host: str, hosts) -> bool:
    return any(host == h or host.endswith("." + h) for h in hosts)


def parse_value(raw: str, filename: str, lineno: int):
    value = raw.strip()
    if value.lower() in ("null", "~", ""):
        return None
    if value[0] in '["{':
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise OfferError(f"{filename}:{lineno}: invalid JSON value ({exc.msg})") from None
    if value[0] == "'" and value.endswith("'") and len(value) >= 2:
        return value[1:-1].replace("''", "'")
    return value


def parse_lead_text(text: str, filename: str) -> dict:
    data: dict = {}
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if line[0] in " \t":
            raise OfferError(f"{filename}:{lineno}: nested/indented lines are not allowed "
                             "(lead files are flat key/value documents; write lists as JSON)")
        key, sep, rest = line.partition(":")
        key = key.strip()
        if not sep or not key or " " in key:
            raise OfferError(f"{filename}:{lineno}: expected 'key: value'")
        if key in data:
            raise OfferError(f"{filename}:{lineno}: duplicate field {key!r}")
        data[key] = parse_value(rest, filename, lineno)
    return data


def _date(value, field: str, filename: str, nullable: bool = False):
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise OfferError(f"{filename}: {field} must be a YYYY-MM-DD date, got {value!r}")
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise OfferError(f"{filename}: {field} must be a YYYY-MM-DD date, got {value!r}") from None


def _https(url, field: str, filename: str) -> str:
    if not isinstance(url, str) or len(url) > 500 or urlsplit(url).scheme != "https" or not _host(url):
        raise OfferError(f"{filename}: {field} must be an https URL, got {url!r}")
    host = _host(url)
    if _on(host, SHORTENER_HOSTS) or _on(host, FORM_HOSTS):
        raise OfferError(f"{filename}: {field} {url!r} is a link shortener or form "
                         "(unsafe claim path); link the post or page itself")
    return host


def _text(data: dict, field: str, filename: str) -> str:
    value = data[field]
    if not isinstance(value, str) or not value.strip():
        raise OfferError(f"{filename}: {field} must be a non-empty string")
    if len(value) > LIMITS[field]:
        raise OfferError(f"{filename}: {field} is longer than {LIMITS[field]} characters")
    return value


def validate_lead(data: dict, filename: str, today: dt.date | None = None) -> dict:
    """Return the validated lead or raise OfferError naming file and field."""
    today = today or dt.date.today()
    missing = [f for f in FIELDS if f not in data]
    if missing:
        raise OfferError(f"{filename}: missing required field(s): {', '.join(missing)}")
    extra = sorted(set(data) - set(FIELDS))
    if extra:
        raise OfferError(f"{filename}: unknown field(s): {', '.join(extra)}")
    for field in FIELDS:
        if data[field] is None and field not in NULLABLE:
            raise OfferError(f"{filename}: {field} must not be null")

    slug = data["slug"]
    stem = os.path.splitext(os.path.basename(filename))[0]
    if not isinstance(slug, str) or not SLUG_RE.match(slug):
        raise OfferError(f"{filename}: slug {slug!r} must be lowercase words joined by hyphens")
    if slug != stem:
        raise OfferError(f"{filename}: slug {slug!r} must match the file name {stem!r}")
    for field in ("provider", "title", "claim", "reason_detail"):
        _text(data, field, filename)
    if data["amount_claimed"] is not None:
        _text(data, "amount_claimed", filename)
    for field in ("title", "claim", "amount_claimed"):
        if data[field] and URL_IN_TEXT_RE.search(data[field]):
            raise OfferError(f"{filename}: {field} carries a link (unsafe claim path); "
                             "replace it with [link removed] and list the post under sources")
    if UNSAFE_CLAIM_RE.search(data["claim"]):
        raise OfferError(f"{filename}: claim asks for a DM, a secret, or payment details "
                         "(unsafe claim path); such leads are dropped, never listed")

    first = _date(data["first_seen"], "first_seen", filename)
    last = _date(data["last_seen"], "last_seen", filename)
    if first > last:
        raise OfferError(f"{filename}: first_seen {first} is after last_seen {last}")
    if last > today:
        raise OfferError(f"{filename}: last_seen {last} is in the future")

    if data["reason"] not in REASONS:
        raise OfferError(f"{filename}: reason must be one of {', '.join(REASONS)}, got {data['reason']!r}")

    sources = data["sources"]
    if not isinstance(sources, list) or not sources:
        raise OfferError(f"{filename}: sources must list at least one public post or page")
    seen = set()
    for i, src in enumerate(sources):
        label = f"sources[{i}]"
        if not isinstance(src, dict) or set(src) != set(SOURCE_KEYS):
            raise OfferError(f"{filename}: {label} must have exactly the keys {', '.join(SOURCE_KEYS)}")
        host = _https(src["url"], f"{label}.url", filename)
        kind = src["type"]
        if kind not in SOURCE_TYPES:
            raise OfferError(f"{filename}: {label}.type must be one of {', '.join(SOURCE_TYPES)}")
        if (kind == "x") != _on(host, X_HOSTS) or (kind == "reddit") != _on(host, REDDIT_HOSTS):
            raise OfferError(f"{filename}: {label}.type {kind!r} does not match host {host!r}")
        for key in ("author", "handle"):
            if src[key] is not None and (not isinstance(src[key], str) or not src[key].strip()):
                raise OfferError(f"{filename}: {label}.{key} must be a non-empty string or null")
        when = _date(src["date"], f"{label}.date", filename, nullable=True)
        if when and when > today:
            raise OfferError(f"{filename}: {label}.date {when} is in the future")
        if src["url"] in seen:
            raise OfferError(f"{filename}: {label}.url is listed twice")
        seen.add(src["url"])

    tried = data["official_urls_tried"]
    if not isinstance(tried, list) or not tried:
        raise OfferError(f"{filename}: official_urls_tried must list at least one official URL")
    for i, url in enumerate(tried):
        host = _https(url, f"official_urls_tried[{i}]", filename)
        if _on(host, SOCIAL_HOSTS):
            raise OfferError(f"{filename}: official_urls_tried[{i}] {url!r} is a social site, "
                             "not an official page")
    return dict(data)


def is_stale(lead: dict, today: dt.date) -> bool:
    """True once last_seen is more than STALE_DAYS days before *today*."""
    return (today - dt.date.fromisoformat(lead["last_seen"])).days > STALE_DAYS


def lead_paths(leads_dir: str) -> list:
    if not os.path.isdir(leads_dir):
        return []
    return sorted(os.path.join(leads_dir, f) for f in os.listdir(leads_dir)
                  if f.endswith((".yaml", ".yml")))


def load_leads(leads_dir: str, offer_slugs=(), today: dt.date | None = None) -> list:
    """Parse and validate every lead; a lead slug may never name an offer."""
    offer_slugs = set(offer_slugs)
    leads = []
    for path in lead_paths(leads_dir):
        with open(path, encoding="utf-8") as fh:
            lead = validate_lead(parse_lead_text(fh.read(), path), path, today)
        if lead["slug"] in offer_slugs:
            raise OfferError(f"{path}: slug {lead['slug']!r} is also an offer; a published "
                             "lead must be removed in the same change")
        leads.append(lead)
    return leads


def dump_lead(lead: dict, header: str = "") -> str:
    """Serialize a lead in FIELDS order; strings and lists as one-line JSON."""
    lines = [f"# {line}" for line in header.splitlines()]
    for field in FIELDS:
        value = lead[field]
        if value is None:
            lines.append(f"{field}: null")
        elif field in ("first_seen", "last_seen", "slug", "reason"):
            lines.append(f"{field}: {value}")
        else:
            lines.append(f"{field}: {json.dumps(value, ensure_ascii=False)}")
    return "\n".join(lines) + "\n"
