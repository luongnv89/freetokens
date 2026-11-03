"""Unverified leads: parse and validate unverified/<slug>.yaml (#660).

A lead is an offer the offer-hunter found on X, Reddit, or the web but could
not confirm on an official page (verdict ``unverifiable``). Leads are never
offers: they live in their own folder, never reach index.json, the llms
files, or offer pages, and only render on the Unverified page.

Freshness: a lead is listed only while its newest dated source post is at
most ``FRESH_DAYS`` (3) days old. A lead with no dated source is invalid.
Staleness is a warning here (the build hides the lead and the next hunt
deletes the file), so the calendar never turns an unrelated PR red.

File format: one ``key: value`` line per field, like offers/*.yaml, with no
nesting. List fields (``sources``, ``official_urls_tried``) and any string
that needs quoting are written as one-line JSON values, which are valid YAML
flow scalars, so the stdlib parses them in Python and Node alike.

The safety rules (unsafe claim wording, shortener/form/social hosts, URL
shape, freshness window) live in schemas/unverified-lead.rules.json, shared
with the Node mirror app/scripts/load-leads.mjs.

Stdlib-only. CLI: ``python3 scripts/lead_model.py remove-match --provider P
[--program T] [--slug S]`` deletes the lead an offer just replaced (#660 N6).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from offer_model import OfferError  # noqa: E402

_HERE = os.path.dirname(os.path.abspath(__file__))
RULES_PATH = os.path.join(_HERE, os.pardir, "schemas", "unverified-lead.rules.json")
with open(RULES_PATH, encoding="utf-8") as _fh:
    RULES = json.load(_fh)

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
# A lead is listed only while its newest dated source post is this fresh.
FRESH_DAYS = int(RULES["fresh_days"])
LIMITS = {"provider": 80, "title": 120, "claim": 300, "amount_claimed": 120, "reason_detail": 400}
TEXT_FIELDS = ("provider", "title", "claim", "amount_claimed", "reason_detail")
# Wording shown verbatim to visitors: checked against the unsafe-claim rules.
SHOWN_FIELDS = ("title", "claim", "amount_claimed")

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
UNSAFE_CLAIM_RE = re.compile("|".join(f"(?:{p})" for p in RULES["unsafe_claim_patterns"]), re.IGNORECASE)
DOMAIN_RE = re.compile(RULES["domain_pattern"], re.IGNORECASE)
AUTHORITY_RE = re.compile(RULES["url_authority_pattern"], re.IGNORECASE)
NON_DOMAIN_SUFFIXES = frozenset(RULES["non_domain_suffixes"])
SHORTENER_HOSTS = frozenset(RULES["shortener_hosts"])
FORM_HOSTS = frozenset(RULES["form_hosts"])
X_HOSTS = frozenset(RULES["x_hosts"])
REDDIT_HOSTS = frozenset(RULES["reddit_hosts"])
SOCIAL_HOSTS = frozenset(RULES["social_hosts"])


def _on(host: str, hosts) -> bool:
    return any(host == h or host.endswith("." + h) for h in hosts)


def strip_www(host: str) -> str:
    return host[4:] if host.startswith("www.") else host


def url_host(url) -> str | None:
    """Host of a plain https URL, or None.

    Accepts only ``https://<host>[/?#...]`` with an ASCII host and no
    userinfo, port, backslash, or whitespace, and requires urlsplit to agree
    with that literal authority. On this subset Python's urlsplit and the
    WHATWG parser (Node, browsers) resolve the same host, so a crafted URL
    like ``https://bit.ly\\@x.com/a`` cannot validate as x.com yet open a
    shortener.
    """
    if not isinstance(url, str) or len(url) > 500 or not url.isascii():
        return None
    if any(ch in url for ch in "\\ \t\r\n") or any(ord(ch) < 32 for ch in url):
        return None
    match = AUTHORITY_RE.match(url)
    if not match:
        return None
    host = match.group(1).lower()
    if "." not in host or host.startswith(".") or host.endswith(".") or ".." in host:
        return None
    parts = urlsplit(url)
    try:
        port = parts.port
    except ValueError:
        return None
    if parts.hostname != host or port is not None or parts.username or parts.password:
        return None
    return strip_www(host)


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
    host = url_host(url)
    if host is None:
        raise OfferError(f"{filename}: {field} must be a plain https URL (no userinfo, port, "
                         f"backslash or spaces), got {url!r}")
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


def foreign_domains(text: str, official_hosts) -> list:
    """Domain-like tokens in *text* that are not the provider's own domain."""
    found = []
    for match in DOMAIN_RE.finditer(text or ""):
        token = strip_www(match.group(1).lower())
        if token.rsplit(".", 1)[-1] in NON_DOMAIN_SUFFIXES:
            continue
        if any(token == h or token.endswith("." + h) or h.endswith("." + token) for h in official_hosts):
            continue
        found.append(token)
    return found


def unsafe_wording(text: str):
    match = UNSAFE_CLAIM_RE.search(text or "")
    return match.group(0) if match else None


def newest_post(lead: dict):
    """Newest dated source post (YYYY-MM-DD string), or None when undated."""
    dates = [s.get("date") for s in lead.get("sources") or [] if isinstance(s, dict) and s.get("date")]
    return max(dates) if dates else None


def fresh_until(lead: dict) -> dt.date:
    return dt.date.fromisoformat(newest_post(lead)) + dt.timedelta(days=FRESH_DAYS)


def is_stale(lead: dict, today: dt.date) -> bool:
    """True once today is past newest post + FRESH_DAYS (undated counts as stale)."""
    return newest_post(lead) is None or today > fresh_until(lead)


def validate_lead(data: dict, filename: str, today: dt.date | None = None) -> dict:
    """Return the validated lead or raise OfferError naming file and field.

    Time-independent except for "no date in the future": staleness is
    reported by is_stale(), never raised here.
    """
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

    first = _date(data["first_seen"], "first_seen", filename)
    last = _date(data["last_seen"], "last_seen", filename)
    if first > last:
        raise OfferError(f"{filename}: first_seen {first} is after last_seen {last}")
    if last > today:
        raise OfferError(f"{filename}: last_seen {last} is in the future")

    if data["reason"] not in REASONS:
        raise OfferError(f"{filename}: reason must be one of {', '.join(REASONS)}, got {data['reason']!r}")

    tried = data["official_urls_tried"]
    if not isinstance(tried, list) or not tried:
        raise OfferError(f"{filename}: official_urls_tried must list at least one official URL")
    official_hosts = set()
    for i, url in enumerate(tried):
        host = _https(url, f"official_urls_tried[{i}]", filename)
        if _on(host, SOCIAL_HOSTS):
            raise OfferError(f"{filename}: official_urls_tried[{i}] {url!r} is a social site, "
                             "not an official page")
        official_hosts.add(host)

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
    if newest_post(data) is None:
        raise OfferError(f"{filename}: undated source: at least one source needs a post date "
                         f"(leads are listed for {FRESH_DAYS} days after the newest post)")

    for field in TEXT_FIELDS:
        value = data[field]
        if not value:
            continue
        domains = foreign_domains(value, official_hosts)
        if domains:
            raise OfferError(f"{filename}: {field} names {domains[0]!r}, which is not the provider's "
                             "own domain (unsafe claim path); remove it or write [link removed]")
        if field in SHOWN_FIELDS and re.search(r"https?://", value, re.IGNORECASE):
            raise OfferError(f"{filename}: {field} carries a link (unsafe claim path); "
                             "replace it with [link removed] and list the post under sources")
        if field in SHOWN_FIELDS:
            bad = unsafe_wording(value)
            if bad:
                raise OfferError(f"{filename}: {field} asks for a DM, a form, a secret, or payment "
                                 f"details ({bad!r}) (unsafe claim path); such leads are dropped")
    return dict(data)


def lead_paths(leads_dir: str) -> list:
    """unverified/*.yaml; any other file in the folder is an error (N2)."""
    if not os.path.isdir(leads_dir):
        return []
    paths = []
    for name in sorted(os.listdir(leads_dir)):
        full = os.path.join(leads_dir, name)
        if name.endswith(".yaml") and os.path.isfile(full):
            paths.append(full)
        else:
            raise OfferError(f"{full}: unexpected file in {leads_dir}; leads are <slug>.yaml files only")
    return paths


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


def norm(text) -> str:
    return " ".join(str(text or "").lower().split())


def remove_match(leads_dir: str, provider: str, program: str | None = None, slug: str | None = None):
    """Delete leads an offer now replaces: same slug, or same provider + program.

    Returns (removed paths, the provider's remaining leads) so a caller with no
    exact match can see what is open and retry with --slug.
    """
    removed, remaining = [], []
    for path in lead_paths(leads_dir):
        with open(path, encoding="utf-8") as fh:
            lead = parse_lead_text(fh.read(), path)
        same_provider = norm(lead.get("provider")) == norm(provider)
        if (slug and lead.get("slug") == slug) or (
                same_provider and program and norm(lead.get("title")) == norm(program)):
            os.remove(path)
            removed.append(path)
        elif same_provider:
            remaining.append(f"{lead.get('slug')}: {lead.get('title')}")
    return removed, remaining


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Unverified lead helpers (#660).")
    sub = parser.add_subparsers(dest="command", required=True)
    rm = sub.add_parser("remove-match", help="delete the lead a newly published offer replaces")
    rm.add_argument("--provider", required=True)
    rm.add_argument("--program", help="the lead's title (the program name)")
    rm.add_argument("--slug", help="the lead slug, when the program name differs")
    rm.add_argument("--leads-dir", default=os.path.join(_HERE, os.pardir, "unverified"))
    args = parser.parse_args(argv)
    removed, remaining = remove_match(args.leads_dir, args.provider, args.program, args.slug)
    for path in removed:
        print(f"removed {os.path.relpath(path)}")
    if not removed:
        print("no matching lead" + (f"; open leads for {args.provider}: " + "; ".join(remaining)
                                    if remaining else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
