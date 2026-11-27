#!/usr/bin/env python3
"""Deal content model (#809): discounted AI products, never free offers.

A deal is one flat ``deals/<slug>.yaml`` file (schema:
``schemas/deal.schema.json``; shared wording rules:
``schemas/deal.rules.json``). Deals live apart from ``offers/`` on purpose:
the offer loader reads every subfolder of ``offers/``, so a deal kept there
would be counted as a free offer.

The rules here mirror ``app/scripts/load-deals.mjs`` so the CI gate and the
build reject the same files:

- required: title, provider, category, discount, occasion, expiry_date,
  source_url, verified_date; optional: regular_price, deal_price,
  promo_code, start_date, expiry_note, description; nothing else
- ``category`` is in the deal scope (AI subscriptions, coding agents / IDEs,
  AI tools & APIs, compute for agents); anything else is rejected
- ``expiry_date`` is required and never null: a deal must end
- a deal is never labelled free: free wording and free-style keys
  (``amount``, ``is_free``, ...) are rejected, and ``deal_price`` must carry
  a non-zero digit

Expired deals stay valid files; the build hides them (``is_expired``).
Every date check takes an injected ``today`` so tests never read the clock.

Stdlib only. CLI::

    python3 scripts/deal_model.py validate [--today YYYY-MM-DD] [PATH ...]

validates the given files (default: every ``deals/*.yaml``), exits 0 when
all are valid and 1 naming the file and field otherwise.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from offer_model import OfferError, parse_offer_text  # noqa: E402

_HERE = os.path.dirname(os.path.abspath(__file__))
RULES_PATH = os.path.join(_HERE, os.pardir, "schemas", "deal.rules.json")
with open(RULES_PATH, encoding="utf-8") as _fh:
    RULES = json.load(_fh)

REQUIRED_FIELDS = (
    "title",
    "provider",
    "category",
    "discount",
    "occasion",
    "expiry_date",
    "source_url",
    "verified_date",
)
OPTIONAL_FIELDS = (
    "regular_price",
    "deal_price",
    "promo_code",
    "start_date",
    "expiry_note",
    "description",
)
FIELDS = REQUIRED_FIELDS + OPTIONAL_FIELDS
# Deal scope (#809). Free-offer categories (api_provider, image, ...) are
# deliberately absent: a deal outside this list is rejected.
CATEGORIES = ("ai_subscription", "coding_agent", "ai_tool_api", "agent_compute")
CATEGORY_LABELS = {
    "ai_subscription": "AI subscription",
    "coding_agent": "Coding agent / IDE",
    "ai_tool_api": "AI tool / API",
    "agent_compute": "Compute for agents",
}
OCCASIONS = ("black_friday", "cyber_monday", "christmas_new_year", "other")
LIMITS = RULES["limits"]
FREE_KEYS = tuple(RULES["free_keys"])
FREE_WORDING_FIELDS = tuple(RULES["free_wording_fields"])
NONZERO_PRICE_FIELDS = tuple(RULES["nonzero_price_fields"])
FREE_WORDING_RE = re.compile(RULES["free_wording_pattern"], re.IGNORECASE | re.ASCII)
SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PROMO_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
NONZERO_DIGIT_RE = re.compile(r"[1-9]")
DEALS_DIRNAME = "deals"


class DealError(OfferError):
    """A deal file breaks the deal schema (subclass so offer gates catch it)."""


def utc_today() -> dt.date:
    return dt.datetime.now(dt.timezone.utc).date()


def _date(value, field: str, filename: str) -> dt.date:
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise DealError(f"{filename}: {field} must be a YYYY-MM-DD date, got {value!r}")
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise DealError(f"{filename}: {field} must be a YYYY-MM-DD date, got {value!r}") from None


def free_wording(text) -> str | None:
    """The first free-style phrase in *text*, or None."""
    match = FREE_WORDING_RE.search(str(text or ""))
    return match.group(0) if match else None


def validate_deal(data: dict, filename: str, today: dt.date | None = None) -> dict:
    """Validate one parsed deal; return it normalised, with its slug."""
    slug = os.path.basename(filename)
    for suffix in (".yaml", ".yml"):
        if slug.endswith(suffix):
            slug = slug[: -len(suffix)]
    if not SLUG_RE.match(slug):
        raise DealError(f"{filename}: file name must be a lowercase hyphenated slug")

    free_keys = sorted(k for k in data if k in FREE_KEYS)
    if free_keys:
        raise DealError(
            f"{filename}: {', '.join(free_keys)}: a deal is never free; describe it with "
            "discount (and regular_price / deal_price when the page shows them)"
        )
    if "expiry_date" in data and data["expiry_date"] is None:
        raise DealError(f"{filename}: expiry_date is required and cannot be null; a deal must end")
    missing = [f for f in REQUIRED_FIELDS if data.get(f) is None]
    if missing:
        raise DealError(f"{filename}: missing required field(s): {', '.join(missing)}")
    unknown = sorted(k for k in data if k not in FIELDS)
    if unknown:
        raise DealError(f"{filename}: unknown field(s): {', '.join(unknown)}")

    for field in FIELDS:
        value = data.get(field)
        if value is None:
            continue
        if not isinstance(value, str) or not value.strip():
            raise DealError(f"{filename}: {field} must be a non-empty string")
        limit = LIMITS.get(field)
        if limit and len(value) > limit:
            raise DealError(f"{filename}: {field} is longer than {limit} characters")

    if data["category"] not in CATEGORIES:
        raise DealError(
            f"{filename}: category {data['category']!r} is outside the deal scope; "
            f"expected one of {', '.join(CATEGORIES)}"
        )
    if data["occasion"] not in OCCASIONS:
        raise DealError(
            f"{filename}: occasion {data['occasion']!r} is not one of {', '.join(OCCASIONS)}"
        )
    if not data["source_url"].startswith("https://") or any(c.isspace() for c in data["source_url"]):
        raise DealError(f"{filename}: source_url must be a plain https:// URL")
    promo = data.get("promo_code")
    if promo is not None and not PROMO_RE.match(promo):
        raise DealError(f"{filename}: promo_code must be 1-40 letters, digits, '-' or '_'")

    expiry = _date(data["expiry_date"], "expiry_date", filename)
    verified = _date(data["verified_date"], "verified_date", filename)
    if data.get("start_date") is not None:
        start = _date(data["start_date"], "start_date", filename)
        if start > expiry:
            raise DealError(f"{filename}: start_date {start} is after expiry_date {expiry}")
    day = today or utc_today()
    if verified > day:
        raise DealError(f"{filename}: verified_date {verified} is in the future (today is {day})")

    for field in FREE_WORDING_FIELDS:
        phrase = free_wording(data.get(field))
        if phrase:
            raise DealError(
                f"{filename}: {field} says {phrase!r}; a deal is a discount and is never "
                "labelled free (free offers belong in offers/)"
            )
    for field in NONZERO_PRICE_FIELDS:
        value = data.get(field)
        if value is not None and not NONZERO_DIGIT_RE.search(value):
            raise DealError(f"{filename}: {field} {value!r} has no non-zero amount; a deal is never free")

    deal = {"slug": slug}
    for field in FIELDS:
        if data.get(field) is not None:
            deal[field] = data[field].strip()
    return deal


def is_expired(deal: dict, today: dt.date) -> bool:
    """A deal is shown through its expiry day and hidden from the next day."""
    return dt.date.fromisoformat(deal["expiry_date"]) < today


def deal_paths(deals_dir: str) -> list:
    """deals/*.yaml; any other entry in the folder is an error."""
    if not os.path.isdir(deals_dir):
        return []
    paths = []
    for name in sorted(os.listdir(deals_dir)):
        full = os.path.join(deals_dir, name)
        if name.endswith(".yaml") and os.path.isfile(full):
            paths.append(full)
        elif name != ".gitkeep":
            raise DealError(f"{full}: unexpected entry in {deals_dir}; deals are <slug>.yaml files only")
    return paths


def load_deal(path: str, today: dt.date | None = None) -> dict:
    with open(path, encoding="utf-8") as fh:
        return validate_deal(parse_offer_text(fh.read(), path), path, today)


def load_deals(deals_dir: str, offer_slugs=(), today: dt.date | None = None) -> list:
    """Validate every deal (expired ones too); a deal slug may never name an offer."""
    offer_slugs = set(offer_slugs)
    deals = []
    for path in deal_paths(deals_dir):
        deal = load_deal(path, today)
        if deal["slug"] in offer_slugs:
            raise DealError(f"{path}: slug {deal['slug']!r} is also an offer; deal slugs must be unique")
        deals.append(deal)
    return deals


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Deal content model (#809).")
    sub = parser.add_subparsers(dest="command", required=True)
    val = sub.add_parser("validate", help="validate deal files")
    val.add_argument("paths", nargs="*", help="deal files (default: every deals/*.yaml)")
    val.add_argument("--today", help="YYYY-MM-DD clock for the future-date check (default: UTC today)")
    val.add_argument("--deals-dir", default=os.path.join(_HERE, os.pardir, DEALS_DIRNAME))
    args = parser.parse_args(argv)
    try:
        today = _date(args.today, "--today", "deal_model") if args.today else utc_today()
        paths = args.paths or deal_paths(args.deals_dir)
        deals = [load_deal(path, today) for path in paths]
    except (OfferError, OSError) as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 1
    for deal in deals:
        state = "expired (hidden at build)" if is_expired(deal, today) else "active"
        print(f"OK {deal['slug']}: {state}")
    print(f"validated {len(deals)} deals: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
