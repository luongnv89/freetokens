#!/usr/bin/env python3
"""Static build for freetokens: validate offers, emit index.json and HTML.

Stdlib-only by design (ADR 001). Usage:

    python3 scripts/build.py [--offers-dir offers] [--out .]
"""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import glob
import html
import json
import os
import re
import sys
from urllib.parse import quote, urlparse

CATEGORIES = ("api_provider", "coding", "image", "voice", "video")
CATEGORY_LABELS = {
    "api_provider": "API providers",
    "coding": "Coding",
    "image": "Image",
    "voice": "Voice",
    "video": "Video",
}
# Absolute site origin used ONLY where syndication formats require it: RSS
# item/channel links must be absolute per the RSS 2.0 spec (and the W3C feed
# validator enforces it). Page-internal hrefs stay relative so they resolve
# under any deploy base.
DEFAULT_BASE_URL = "https://luongnv89.github.io/freetokens"
FEED_TITLE = "Free AI Credits — free AI credit offers, tagged by verification"
FEED_DESCRIPTION = (
    "Newly published free AI credit offers from the freetokens directory, "
    "each tagged with its verification level and sign-up requirement."
)
# Search input debounce: settling delay before a keystroke batch filters the
# list, updates the URL, and fires analytics. Must stay well under the PRD's
# 200 ms perceived-latency budget (F3).
SEARCH_DEBOUNCE_MS = 120
# Rapid re-click suppression for offer_click (F6): a second click on the same
# offer within this window is treated as an accidental double-click, not a
# second attribution event. Distinct offers are never suppressed.
OFFER_CLICK_DEDUPE_MS = 1000

# --- Dedicated offer detail pages (#60) --------------------------------------
# Every offer gets its own page at site/offers/<slug>.html so cards, archive
# rows, and feed items deep-link to a stable URL instead of a DOM anchor.
# Slugs are validated lowercase-hyphen names (scripts/validate_offers.py),
# making them safe path segments; the subdirectory also keeps them clear of
# the reserved root output filenames (index.html, archive.html, ...).
OFFERS_OUTPUT_DIRNAME = "offers"

# Sort modes (F10): client-side reordering driven by the ?sort= URL param,
# consistent with the category/q state params. "" (absent) keeps the
# build-time default order — newest-verified first since #70. The select's
# option labels live in SORT_LABELS.
SORT_MODES = ("newest", "expiring", "amount")
SORT_LABELS = {
    "newest": "Newest verified",
    "expiring": "Expiring soon",
    "amount": "Largest amount",
}

# --- Offer detail cards (#48) ----------------------------------------------
# Optional per-offer detail data lives in offers/details/<slug>.json: one
# JSON document extending a summary card with a description, how-to-claim
# steps, and social proof. Stdlib json keeps ADR-001 intact; the flat YAML
# parser for offers/*.yaml stays frozen at its seven required fields.
DETAILS_DIRNAME = "details"
DETAIL_KEYS = ("summary", "claim_steps", "social_proof")
DETAIL_TYPES = ("x", "reddit", "screenshot", "link")
# Required keys per social-proof type; every entry needs `url` except
# screenshots, which need a committed image instead.
PROOF_REQUIRED = {
    "x": ("author", "text"),
    "reddit": ("author", "text"),
    "screenshot": ("image", "caption"),
    "link": ("title",),
}
PROOF_OPTIONAL = {
    "x": ("handle",),
    "reddit": ("community",),
    "screenshot": (),
    "link": ("text",),
}
SUMMARY_MAX_CHARS = 2000
STEP_MAX_CHARS = 300
PROOF_TEXT_MAX_CHARS = 500
PROOF_META_MAX_CHARS = 200
REQUIRED_FIELDS = (
    "title",
    "provider",
    "category",
    "amount",
    "expiry_date",
    "source_url",
    "verified_date",
    "verification",
    "signup",
)
# Per-offer honesty tags (#97): the site no longer claims blanket
# "hand-verified / no sign-up walls" status. Every offer states exactly how
# its listing was checked and whether claiming needs an account.
VERIFICATION_LEVELS = ("hand_verified", "social_proof", "unverified")
VERIFICATION_LABELS = {
    "hand_verified": "hand-verified",
    "social_proof": "social proof",
    "unverified": "unverified",
}
# Tooltip copy spells out what each level means — the badge word alone must
# never be the only explanation (same principle as the Expired badge).
VERIFICATION_TITLES = {
    "hand_verified": (
        "Checked by the maintainer against the official provider website"
    ),
    "social_proof": (
        "Not personally verified, but corroborated by the official website "
        "and social proof"
    ),
    "unverified": (
        "Only social-media proofs — no official-website confirmation yet"
    ),
}
SIGNUP_MODES = ("none", "required")
SIGNUP_LABELS = {"none": "no sign-up", "required": "sign-up required"}
SIGNUP_TITLES = {
    "none": "Claimable without creating an account",
    "required": "Claiming requires creating a (free) account",
}
NULL_TOKENS = {"null", "~", ""}


# --- Tag system: one hue + one glyph per tag, every tag a filter -----------
# Three tag families ride every offer row (category / verification / signup)
# and until now all three rendered as the same gray pill, so the row read as
# one undifferentiated smear of uppercase mono. Each tag value now carries:
#
#   * its own hue, applied as text + 1px border + a 7% tint on paper. The hue
#     is NEVER a solid fill at rest -- solid fill is reserved for the active
#     (filtering) state, so "colored" and "applied" can never be confused.
#   * its own glyph, so the tag survives grayscale, color blindness, and the
#     3-character glance a dense listing actually gets. Color is decoration;
#     the word plus the glyph carry the meaning (the #97 rule, kept).
#
# Every hue clears WCAG AA (>=4.5:1) BOTH as text on white and under white
# text when filled, so a tag is legible in either state -- see
# TAG_HUES for the measured ratios.
#
# NOTE ON `coding`: it is teal, not green, even though green is the obvious
# "code" color. Green already means "strongest claim" on the verification and
# sign-up tags sitting immediately beside it; a green category tag would read
# as an endorsement of the offer rather than a description of it.
TAG_HUES = {
    # value: (hex, contrast-vs-white)
    "api_provider": ("#3538cd", 8.08),
    "coding": ("#0e7490", 5.36),
    "image": ("#955906", 5.66),
    "voice": ("#7e22ce", 6.98),
    "video": ("#be123c", 6.29),
    "hand_verified": ("#15803d", 5.02),
    "social_proof": ("#000000", 21.00),
    "unverified": ("#5f6673", 5.78),
    "none": ("#15803d", 5.02),
    "required": ("#5f6673", 5.78),
    "expired": ("#5f6673", 5.78),
}

# Glyphs ship as ONE inline <symbol> sprite per page, referenced by <use>.
# Pasting the paths inline at each of the ~120 tag sites instead cost +70 KB
# of raw HTML on the home listing for zero visual difference — a real bite out
# of the >=95 Lighthouse budget (PRD 5.1). The sprite is same-document, so
# there is still no extra request and no external-reference CORS problem.
#
# Presentation attributes live on the <symbol>, and `currentColor` resolves
# against the <use> element's inherited colour — which is what lets one copy
# of each glyph serve the rest, hover, and active states of every hue.
_ICON = (
    '<svg class="tag-i" aria-hidden="true" focusable="false">'
    '<use href="#ti-{name}"/></svg>'
)
_SYMBOL = (
    '<symbol id="ti-{name}" viewBox="0 0 24 24" fill="none" '
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" '
    'stroke-linejoin="round">{paths}</symbol>'
)
TAG_ICONS = {
    # Categories: what the credits BUY.
    "api_provider": '<rect x="3" y="4" width="18" height="7" rx="1.5"/>'
    '<rect x="3" y="13" width="18" height="7" rx="1.5"/>'
    '<path d="M6.8 7.5h.01M6.8 16.5h.01"/>',
    "coding": '<path d="m9 6-6 6 6 6"/><path d="m15 6 6 6-6 6"/>',
    "image": '<rect x="3" y="4" width="18" height="16" rx="2"/>'
    '<circle cx="8.6" cy="9.4" r="1.4"/><path d="m3.5 17.5 4.6-4.6 4 4 3-3 5.4 5.4"/>',
    "voice": '<path d="M4 10.5v3M8 6.5v11M12 3.5v17M16 6.5v11M20 10.5v3"/>',
    "video": '<rect x="3" y="5" width="18" height="14" rx="2.5"/>'
    '<path d="m10.4 9.4 5 2.6-5 2.6z"/>',
    # Verification: how hard the listing was CHECKED. The glyphs form their
    # own ladder -- sealed check, hearsay bubble, open question.
    "hand_verified": '<circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.7 2.7L16 9.4"/>',
    "social_proof": '<path d="M20.5 13.5a2 2 0 0 1-2 2H8.5l-4.5 4V5.5a2 2 0 0 1 2-2h12.5a2 2 0 0 1 2 2z"/>'
    '<path d="M8.5 9.5h8M8.5 12.5h5"/>',
    "unverified": '<circle cx="12" cy="12" r="9" stroke-dasharray="3.2 3"/>'
    '<path d="M9.7 9.4a2.4 2.4 0 0 1 4.7.6c0 1.6-2.4 1.9-2.4 3.4"/>'
    '<path d="M12 16.8h.01"/>',
    # Sign-up: whether a wall stands between you and the credits.
    "none": '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/>'
    '<path d="M8 10.5V7a4 4 0 0 1 7.7-1.6"/>',
    "required": '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/>'
    '<path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    "expired": '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.1 1.9"/>',
}


def _tag_icon(value: str) -> str:
    """Reference to one tag glyph in the page sprite ('' when it has none)."""
    return _ICON.format(name=value) if value in TAG_ICONS else ""


def _icon_sprite() -> str:
    """The page's single hidden <symbol> set backing every _tag_icon().

    Emitted once per page directly after <body>, so a <use> anywhere in the
    document resolves without a network request. `aria-hidden` plus zero
    dimensions keep it out of both the accessibility tree and the layout.
    """
    symbols = "".join(
        _SYMBOL.format(name=name, paths=paths) for name, paths in TAG_ICONS.items()
    )
    return (
        '<svg class="tag-sprite" width="0" height="0" aria-hidden="true" '
        f"focusable=\"false\"><defs>{symbols}</defs></svg>"
    )


# The three filterable families, in the order they appear on a row. The keys
# double as the URL parameter names (?category=/?verification=/?signup=) and
# as the `data-ft-tag` dimension the client runtime switches on, so there is
# exactly one spelling of each dimension across Python, HTML, and JS.
TAG_DIMENSIONS = ("category", "verification", "signup")


def _tag(
    dimension: str,
    value: str,
    label: str,
    title: str = "",
    *,
    interactive: bool = True,
    href_prefix: str = "",
) -> str:
    """Render one tag.

    ``interactive`` picks the affordance, and both affordances resolve to the
    SAME filtered view -- the home listing narrowed to this tag:

      * True  -> a real <button> that toggles the filter in place. Used on
        the home listing, the only page carrying the filter runtime.
      * False -> an <a> to the home page with the filter pre-applied. Used on
        /archive and the offer detail pages, which ship no runtime; a button
        there would be a dead control, and a link is honest about navigating.

    ``href_prefix`` is the caller's climb back to site root ('' at root,
    '../' from offers/<slug>.html) so the link stays deploy-base safe.
    """
    classes = f"badge badge-{dimension} badge-{dimension}-{html.escape(value)}"
    attrs = f' title="{html.escape(title, quote=True)}"' if title else ""
    body = f"{_tag_icon(value)}<span>{html.escape(label)}</span>"
    if interactive:
        return (
            f'<button type="button" class="{classes}" data-ft-tag="{dimension}" '
            f'data-ft-tag-value="{html.escape(value, quote=True)}" '
            f'aria-pressed="false" '
            f'aria-label="Filter by {html.escape(label, quote=True)}"'
            f"{attrs}>{body}</button>"
        )
    href = f"{href_prefix}index.html?{dimension}={quote(value, safe='')}"
    return (
        f'<a class="{classes}" href="{html.escape(href, quote=True)}" '
        f'aria-label="See offers tagged {html.escape(label, quote=True)}"'
        f"{attrs}>{body}</a>"
    )


def _category_badge(
    category: str, *, interactive: bool = True, href_prefix: str = ""
) -> str:
    """Render the offer's category tag."""
    return _tag(
        "category",
        category,
        CATEGORY_LABELS.get(category, category),
        f"Free AI credits in the {CATEGORY_LABELS.get(category, category)} category",
        interactive=interactive,
        href_prefix=href_prefix,
    )


def _verification_badge(
    level: str, *, interactive: bool = True, href_prefix: str = ""
) -> str:
    """Render the per-offer verification-level badge (#97)."""
    return _tag(
        "verification",
        level,
        VERIFICATION_LABELS[level],
        VERIFICATION_TITLES[level],
        interactive=interactive,
        href_prefix=href_prefix,
    )


def _signup_badge(
    mode: str, *, interactive: bool = True, href_prefix: str = ""
) -> str:
    """Render the per-offer sign-up-requirement badge (#97)."""
    return _tag(
        "signup",
        mode,
        SIGNUP_LABELS[mode],
        SIGNUP_TITLES[mode],
        interactive=interactive,
        href_prefix=href_prefix,
    )

# --- Analytics configuration (F7) -----------------------------------------
# GA4 is opt-in at build time: the measurement ID comes from the
# GA_MEASUREMENT_ID environment variable. When it is unset (or malformed)
# NO tracking code, consent banner, or analytics script is emitted at all.
MEASUREMENT_ID_ENV_VAR = "GA_MEASUREMENT_ID"
MEASUREMENT_ID_RE = re.compile(r"^G-[A-Z0-9]{6,12}$")
CONSENT_STORAGE_KEY = "ft_ga_consent"
EU_TIMEZONE_PREFIXES = ("Europe/",)

# --- Live traffic stats (#62) ------------------------------------------------
# Aggregate visit counts shown on the site itself, refreshed per page load —
# never baked in at build time. Provider: hosted GoatCounter (goatcounter.com;
# cookieless, EUPL, free for non-commercial sites); see
# docs/traffic-stats-setup.md. Like GA4 this is opt-in at build time via ONE
# environment variable; unset or malformed means zero stats markup exists
# anywhere. These identifiers describe visitor TRAFFIC — deliberately distinct
# from #49's build-time offer-catalog counters in the masthead ("deal stats").
STATS_SITE_ENV_VAR = "GOATCOUNTER_SITE_URL"
# https-only so a typo can never downgrade visitors to plaintext; quotes and
# whitespace are rejected outright so the value stays attribute-safe.
STATS_SITE_RE = re.compile(r"^https://[^\s\"'<>]+$")
TRAFFIC_STRIP_ID = "ft-traffic"


class OfferError(ValueError):
    """A offer file is malformed or fails schema validation."""


def _parse_scalar(raw: str):
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    if value.lower() in NULL_TOKENS:
        return None
    return value


def parse_offer_text(text: str, filename: str) -> dict:
    """Parse the constrained flat-YAML subset used by offers/*.yaml."""
    data = {}
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if line[:1] in (" ", "\t"):
            raise OfferError(
                f"{filename}:{lineno}: nested/indented lines are not allowed "
                "(offer files are flat key/value documents)"
            )
        key, sep, raw = line.partition(":")
        if not sep:
            raise OfferError(f"{filename}:{lineno}: expected 'key: value'")
        key = key.strip()
        if not key or " " in key:
            raise OfferError(f"{filename}:{lineno}: invalid field name {key!r}")
        if key in data:
            raise OfferError(f"{filename}:{lineno}: duplicate field {key!r}")
        data[key] = _parse_scalar(raw)
    return data


def _validate_date(value, field: str, filename: str):
    if not isinstance(value, str):
        raise OfferError(
            f"{filename}: {field} must be a YYYY-MM-DD date, got {value!r} "
            "(this field is not nullable)"
        )
    try:
        return dt.datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise OfferError(
            f"{filename}: {field} must be a YYYY-MM-DD date, got {value!r}"
        ) from None


def validate_offer(data: dict, filename: str) -> dict:
    missing = [f for f in REQUIRED_FIELDS if f not in data]
    if missing:
        raise OfferError(f"{filename}: missing required fields: {', '.join(missing)}")
    unknown = [k for k in data if k not in REQUIRED_FIELDS]
    if unknown:
        raise OfferError(f"{filename}: unknown fields: {', '.join(sorted(unknown))}")

    for field in ("title", "provider", "amount"):
        if not isinstance(data[field], str) or not data[field].strip():
            raise OfferError(f"{filename}: {field} must be a non-empty string")

    if data["category"] not in CATEGORIES:
        raise OfferError(
            f"{filename}: category must be one of {'|'.join(CATEGORIES)}, "
            f"got {data['category']!r}"
        )

    if data["verification"] not in VERIFICATION_LEVELS:
        raise OfferError(
            f"{filename}: verification must be one of "
            f"{'|'.join(VERIFICATION_LEVELS)}, got {data['verification']!r}"
        )

    if data["signup"] not in SIGNUP_MODES:
        raise OfferError(
            f"{filename}: signup must be one of {'|'.join(SIGNUP_MODES)}, "
            f"got {data['signup']!r}"
        )

    if data["expiry_date"] is not None:
        data["expiry_date"] = _validate_date(
            data["expiry_date"], "expiry_date", filename
        )
    data["verified_date"] = _validate_date(
        data["verified_date"], "verified_date", filename
    )
    if data["verified_date"] > dt.date.today():
        raise OfferError(
            f"{filename}: verified_date is in the future ({data['verified_date']})"
        )

    url = data["source_url"]
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise OfferError(f"{filename}: source_url must be an http(s) URL, got {url!r}")
    return data


def load_offers(offers_dir: str) -> list:
    paths = sorted(glob.glob(os.path.join(offers_dir, "*.yaml")))
    paths += sorted(glob.glob(os.path.join(offers_dir, "*.yml")))
    offers = []
    for path in paths:
        slug = os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8") as fh:
            data = parse_offer_text(fh.read(), path)
        offer = validate_offer(data, path)
        offer["slug"] = slug
        clash = next((o for o in offers if o["slug"] == slug), None)
        if clash is not None:
            raise OfferError(
                f"duplicate slug {slug!r}: {clash.get('_path', '?')} and "
                f"{path} produce the same slug; rename one file"
            )
        offer["_path"] = path
        offers.append(offer)
    for offer in offers:
        del offer["_path"]
    return offers


def is_expired(offer: dict, today: dt.date | None = None) -> bool:
    """True when the offer's expiry_date has passed at build time.

    Null expiry means ongoing and never expires. An offer expiring *today*
    is still active (matches the F4 semantics this refactor preserves).
    """
    if today is None:
        today = dt.date.today()
    return offer["expiry_date"] is not None and offer["expiry_date"] < today


def filter_expired(offers: list, today: dt.date | None = None) -> list:
    """Return only non-expired offers; None expiry means ongoing."""
    return [o for o in offers if not is_expired(o, today)]


def amount_sort_value(amount: str) -> float:
    """Best-effort numeric magnitude of a free-value string (F10 'amount').

    Used ONLY as a sort key, never displayed. Heuristic: first number in the
    string wins ("$300 in credits" -> 300, "2,000 completions + 50 chats"
    -> 2000), with k/M multipliers honored ("10k credits/month" -> 10000).
    Unparseable strings sort as 0 so they never crash the build.
    """
    match = re.search(r"[0-9][0-9.,]*", amount or "")
    if not match:
        return 0.0
    try:
        value = float(match.group(0).replace(",", "").rstrip("."))
    except ValueError:
        return 0.0
    suffix = re.match(r"[0-9][0-9.,]*\s*([kKmM])", amount)
    if suffix:
        value *= {"k": 1_000, "m": 1_000_000}[suffix.group(1).lower()]
    return value


def _check_str(value, name: str, filename: str, max_chars: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OfferError(f"{filename}: {name} must be a non-empty string")
    if len(value) > max_chars:
        raise OfferError(
            f"{filename}: {name} exceeds {max_chars} characters ({len(value)} given)"
        )
    return value


def _validate_proof(entry, filename: str, pos: int) -> dict:
    where = f"{filename}: social_proof[{pos}]"
    if not isinstance(entry, dict):
        raise OfferError(f"{where} must be an object")
    kind = entry.get("type")
    if kind not in DETAIL_TYPES:
        raise OfferError(
            f"{where}: type must be one of {'|'.join(DETAIL_TYPES)}, got {kind!r}"
        )
    allowed = set(PROOF_REQUIRED[kind]) | set(PROOF_OPTIONAL[kind])
    if kind != "screenshot":
        # Every linked evidence type carries a URL; screenshots point at a
        # committed image instead.
        allowed.add("url")
    unknown = [k for k in entry if k != "type" and k not in allowed]
    if unknown:
        raise OfferError(f"{where}: unknown fields: {', '.join(sorted(unknown))}")
    clean = {"type": kind}
    if kind == "screenshot":
        image = _check_str(entry.get("image"), "image", where, PROOF_META_MAX_CHARS)
        if image.startswith(("http://", "https://", "/")) or ".." in image.split("/"):
            raise OfferError(
                f"{where}: image must be a site-relative path under the "
                "built site (e.g. assets/example.png)"
            )
        clean["image"] = image
    else:
        url = _check_str(entry.get("url"), "url", where, PROOF_META_MAX_CHARS)
        if not url.startswith(("http://", "https://")):
            raise OfferError(f"{where}: url must be an http(s) URL, got {url!r}")
        clean["url"] = url
    for key in PROOF_REQUIRED[kind]:
        limit = (
            PROOF_TEXT_MAX_CHARS if key in ("text", "caption") else PROOF_META_MAX_CHARS
        )
        clean[key] = _check_str(entry.get(key), key, where, limit)
    for key in PROOF_OPTIONAL[kind]:
        if key not in entry:
            continue
        limit = PROOF_TEXT_MAX_CHARS if key == "text" else PROOF_META_MAX_CHARS
        clean[key] = _check_str(entry.get(key), key, where, limit)
    return clean


def validate_detail(data, filename: str) -> dict:
    """Validate one offers/details/<slug>.json document (strict shape)."""
    if not isinstance(data, dict):
        raise OfferError(f"{filename}: detail document must be a JSON object")
    unknown = [k for k in data if k not in DETAIL_KEYS]
    if unknown:
        raise OfferError(f"{filename}: unknown fields: {', '.join(sorted(unknown))}")
    if not any(k in data for k in DETAIL_KEYS):
        raise OfferError(
            f"{filename}: must define at least one of {', '.join(DETAIL_KEYS)}"
        )
    detail = {}
    if "summary" in data:
        detail["summary"] = _check_str(
            data["summary"], "summary", filename, SUMMARY_MAX_CHARS
        )
    if "claim_steps" in data:
        steps = data["claim_steps"]
        if not isinstance(steps, list) or not steps:
            raise OfferError(
                f"{filename}: claim_steps must be a non-empty list of strings"
            )
        if len(steps) > 12:
            raise OfferError(
                f"{filename}: claim_steps allows at most 12 steps ({len(steps)} given)"
            )
        detail["claim_steps"] = [
            _check_str(step, f"claim_steps[{i}]", filename, STEP_MAX_CHARS)
            for i, step in enumerate(steps)
        ]
    if "social_proof" in data:
        proofs = data["social_proof"]
        if not isinstance(proofs, list) or not proofs:
            raise OfferError(
                f"{filename}: social_proof must be a non-empty list of objects"
            )
        if len(proofs) > 10:
            raise OfferError(
                f"{filename}: social_proof allows at most 10 entries "
                f"({len(proofs)} given)"
            )
        detail["social_proof"] = [
            _validate_proof(entry, filename, i) for i, entry in enumerate(proofs)
        ]
    return detail


def load_details(offers_dir: str, valid_slugs) -> dict:
    """Load offers/details/<slug>.json keyed by slug; {} when none exist.

    Orphan files (no matching offers/*.yaml slug) are a build error so a
    renamed or deleted offer can never leave stale detail content behind.
    """
    details_dir = os.path.join(offers_dir, DETAILS_DIRNAME)
    paths = sorted(glob.glob(os.path.join(details_dir, "*.json")))
    slugs = set(valid_slugs)
    details = {}
    for path in paths:
        slug = os.path.splitext(os.path.basename(path))[0]
        if slug not in slugs:
            raise OfferError(
                f"{path}: no offer named {slug!r}; delete this detail file "
                "or fix its file name"
            )
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except json.JSONDecodeError as exc:
            raise OfferError(
                f"{path}: invalid JSON at line {exc.lineno}, column {exc.colno}"
            ) from None
        details[slug] = validate_detail(data, path)
    return details


def build_index(offers: list, today: dt.date | None = None) -> dict:
    """Build the generated index over ALL validated offers (retain-and-flag).

    Since v2.0 (#25) expired offers are no longer dropped: every entry is
    retained and flagged with a build-time-computed ``status`` of
    ``"active" | "expired"``. Downstream consumers decide what to show — the
    home page renders only active entries, the archive page only expired
    ones, the feed only active ones.

    Default order (#70): newest-verified first, so freshly added offers lead
    the home list. ``verified_date`` is the catalog's add/refresh stamp (the
    schema is frozen at seven fields); ties fall back to slug ascending via
    a stable two-pass sort. Explicit client-side sorts (?sort=) still
    override this build-time default.
    """
    stamped = []
    by_slug = sorted(offers, key=lambda o: o["slug"])
    for offer in sorted(by_slug, key=lambda o: o["verified_date"], reverse=True):
        entry = dict(offer)
        entry["status"] = "expired" if is_expired(offer, today) else "active"
        stamped.append(entry)
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "count": len(stamped),
        "active_count": sum(1 for o in stamped if o["status"] == "active"),
        "expired_count": sum(1 for o in stamped if o["status"] == "expired"),
        "offers": [
            {
                "slug": o["slug"],
                "title": o["title"],
                "provider": o["provider"],
                "category": o["category"],
                "amount": o["amount"],
                "expiry_date": o["expiry_date"].isoformat()
                if o["expiry_date"]
                else None,
                "source_url": o["source_url"],
                "verified_date": o["verified_date"].isoformat(),
                "verification": o["verification"],
                "signup": o["signup"],
                "status": o["status"],
            }
            for o in stamped
        ],
    }


# Page CSS lives in its own constant so the stylesheet can use single braces;
# it is substituted into _PAGE_TMPL as a format *value*, never re-scanned.
_CSS = """
:root {
  --ink: #000000;
  --paper: #ffffff;
  --gray: #6b7280;
  --green: #22c55e;
  --hairline: rgba(0, 0, 0, 0.16);

  /* Tag hues. Each clears WCAG AA in BOTH painted states a tag has: as text
     over the 7% tint it sits on at rest, and under white text when filled on
     hover/active. Measured minimums across the two: indigo 7.20, teal 4.86,
     ochre 5.13, violet 6.25, crimson 5.56, green 4.57, muted 5.26.

     Ochre and the muted gray are darker than the obvious #a16207 / #6b7280
     for exactly that reason -- both land at ~4.45:1 once the tint is behind
     them, and contrast is owed against the background actually painted, not
     against the white the tag is not sitting on.

     Green is deliberately absent from the category set: it is spoken for by
     "strongest claim" on the verification and sign-up tags next door, and a
     green category tag would read as an endorsement of the offer rather than
     a description of it. That is why `coding` is teal.

     Eleven values, seven hues -- the repeats are the point, not an oversight.
     Hue encodes the *claim*, not the value: green is "strongest claim"
     (hand-verified; no sign-up wall) and the muted gray is "weakest, treat
     with care" (unverified; sign-up required; expired). The five categories,
     which make no claim at all, are the five hues nothing else uses. Repeats
     only ever occur ACROSS families, and a row renders one tag per family in
     a fixed slot, so two greens on one row never compete to mean the same
     thing. The word and the glyph stay distinct throughout, so nothing here
     is carried by colour alone.

     No hue may equal --ink: that is the `.badge` fallback for an unknown
     value, so a tag colliding with it would make a missing token look
     exactly like a real tag. `social_proof` was that collision until it
     became navy; TagHueDistinctnessTests holds the line. */
  --t-api_provider: #3538cd;
  --t-coding: #0e7490;
  --t-image: #955906;
  --t-voice: #7e22ce;
  --t-video: #be123c;
  --t-hand_verified: #15803d;
  --t-social_proof: #1e3a5f;
  --t-unverified: #5f6673;
  --t-none: #15803d;
  --t-required: #5f6673;
  --t-expired: #5f6673;
}

* { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: "Bricolage Grotesque", system-ui, sans-serif;
  line-height: 1.5;
  overflow-wrap: break-word;
}

.wrap { max-width: 75rem; margin: 0 auto; padding: clamp(1.25rem, 4vw, 3rem); }

.mono {
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* ---- Masthead -------------------------------------------------------- */

.kicker {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gray);
  margin: 0 0 0.75rem;
}

.kicker::before {
  content: "";
  display: inline-block;
  width: 1.5rem;
  height: 3px;
  background: var(--green);
  margin-right: 0.6rem;
  vertical-align: middle;
}

h1 {
  font-size: clamp(2.4rem, 7vw, 4.5rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.02;
  margin: 0 0 0.75rem;
}

.tagline { max-width: 42rem; margin: 0 0 0.5rem; font-size: 1.05rem; }

.count {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.82rem;
  color: var(--gray);
  margin: 0 0 2.5rem;
}

.count strong { color: var(--ink); }

/* ---- Card grid ------------------------------------------------------- */

.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1.1rem;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  height: 100%;
  border: 1px solid var(--hairline);
  border-radius: 12px;
  padding: 1.25rem;
  background: var(--paper);
  transition: transform 0.15s ease, box-shadow 0.15s ease,
    border-color 0.15s ease;
}

/* Decorative green accent line — meaning never depends on it alone. */
.card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  border-radius: 12px 12px 0 0;
  background: var(--green);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.18s ease;
}

.card:hover, .card:focus-within {
  transform: translateY(-2px);
  border-color: var(--ink);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.09);
}

.card:hover::before, .card:focus-within::before { transform: scaleX(1); }

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* ---- Tags ------------------------------------------------------------- */
/* One rule set serves all three families and all three element types a tag
   can be (<span> on static chrome, <a> on archive/detail, <button> on the
   home listing) — the hue arrives through --tag-hue, so nothing below is
   duplicated per colour. Color never carries meaning alone: the word is
   always spelled out, the glyph repeats it, and `title` explains it. */
.badge {
  --tag-hue: var(--ink);
  display: inline-flex;
  align-items: center;
  gap: 0.34em;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border: 1px solid var(--tag-hue);
  border-radius: 999px;
  padding: 0.14rem 0.6rem;
  color: var(--tag-hue);
  background: var(--paper);
  /* 7% of the hue: enough to separate three adjacent tags at a glance, far
     too little to be mistaken for the solid fill that means "active".
     Browsers without color-mix keep the flat paper background above. */
  background: color-mix(in srgb, var(--tag-hue) 7%, var(--paper));
}

/* Bypass block (WCAG 2.4.1). Three tag controls per row turned a listing of
   ~2 stops per row into ~5, so reaching the footer by keyboard now means
   traversing a few hundred controls. The link is off-screen until focused,
   where it becomes the first thing a keyboard user meets. */
.skip-list {
  position: absolute;
  left: -9999px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.skip-list:focus {
  position: static;
  width: auto;
  height: auto;
  display: inline-block;
  margin: 0 0 0.6rem;
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--ink);
  border-radius: 4px;
  background: var(--paper);
  color: var(--ink);
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.74rem;
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

/* The bypass target must not draw a focus ring when it is reached by the
   skip link — it is a landmark, not a control. */
#site-footer:focus { outline: none; }

/* Tags render as <button> on the listing but as <a> on /archive and every
   offer page, which ship no filter runtime. Both forms are real targets, so
   both are owed the touch minimum — and this has to live in the shared
   stylesheet, because the listing's own CSS never reaches those pages. At
   the base size a pill is ~20px, under the 24px WCAG 2.2 AA floor, and the
   spacing exception does not rescue it: once a row wraps, tags sit ~21.6px
   apart centre-to-centre. */
@media (pointer: coarse) {
  a.badge {
    min-height: 32px;
    padding-inline: 0.6rem;
  }
}

/* The glyph tracks its text size, so tags stay proportional wherever the
   base font-size is overridden (the home listing runs them at 0.63rem). */
.tag-i {
  width: 1.05em;
  height: 1.05em;
  flex: 0 0 auto;
}

/* The sprite is markup, not content: it must occupy no space and never
   catch a pointer, on any page that renders a tag. */
.tag-sprite {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

.badge-category-api_provider { --tag-hue: var(--t-api_provider); }
.badge-category-coding { --tag-hue: var(--t-coding); }
.badge-category-image { --tag-hue: var(--t-image); }
.badge-category-voice { --tag-hue: var(--t-voice); }
.badge-category-video { --tag-hue: var(--t-video); }
.badge-verification-hand_verified { --tag-hue: var(--t-hand_verified); }
.badge-verification-social_proof { --tag-hue: var(--t-social_proof); }
.badge-verification-unverified { --tag-hue: var(--t-unverified); }
.badge-signup-none { --tag-hue: var(--t-none); }
.badge-signup-required { --tag-hue: var(--t-required); }

/* Archive "Expired" badge (#26): the word itself carries the meaning —
   the muted styling is decoration only, never the sole signal. */
.badge-expired {
  --tag-hue: var(--t-expired);
}

/* Link-form tags (/archive, offer detail) navigate to the home listing with
   this filter pre-applied. They must not pick up the global underline
   treatment, but must still announce themselves as operable. */
a.badge {
  text-decoration: none;
  transition: background-color 0.14s ease, color 0.14s ease;
}

a.badge:hover,
a.badge:focus-visible {
  background: var(--tag-hue);
  color: var(--paper);
}

a.badge:focus-visible {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

.status {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.76rem;
  color: var(--gray);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.22);
}

.card-title {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.25;
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
}

.card-title a {
  color: inherit;
  text-decoration: none;
}

.card-title a:hover,
.card-title a:focus-visible {
  text-decoration: underline;
  text-decoration-color: var(--green);
  text-decoration-thickness: 3px;
  text-underline-offset: 4px;
}

.ext { font-size: 0.85em; }

.amount {
  font-size: clamp(1.05rem, 2.5vw, 1.3rem);
  font-weight: 700;
  margin: 0;
  overflow-wrap: anywhere;
}

.prov {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--gray);
  margin: auto 0 0;
  padding-top: 0.75rem;
}

/* ---- Empty state ----------------------------------------------------- */

.empty {
  border: 1.5px dashed var(--hairline);
  border-radius: 12px;
  padding: clamp(2rem, 6vw, 3.5rem);
  text-align: center;
  max-width: 34rem;
  margin: 1rem auto;
}

.empty h2 { margin: 0.75rem 0 0.5rem; font-size: 1.4rem; }

.empty p { color: var(--gray); margin: 0.35rem 0; }

.empty .glyph { color: var(--green); }

.empty a {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--green);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

.empty a:hover,
.empty a:focus-visible { text-decoration-thickness: 3px; }

/* ---- Footer ------------------------------------------------------------ */

.foot {
  margin-top: 3rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--hairline);
}

.foot p {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.75rem;
  color: var(--gray);
  margin: 0;
}

.foot-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.75rem;
  align-items: baseline;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.75rem;
  margin: 0.5rem 0 0;
}

.foot-nav a {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--hairline);
  text-underline-offset: 3px;
}

.foot-nav a:hover,
.foot-nav a:focus-visible {
  text-decoration-color: var(--green);
  text-decoration-thickness: 3px;
}

.foot-nav [aria-current="page"] {
  color: var(--gray);
  text-decoration: none;
}

/* ---- Policy prose ------------------------------------------------------ */

.policy {
  max-width: 46rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.policy section h2 {
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0 0 0.5rem;
}

.policy section p, .policy section li {
  margin: 0.35rem 0;
}

.policy section ul, .policy section ol {
  margin: 0.35rem 0;
  padding-left: 1.25rem;
}

.policy code {
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  padding: 0.08rem 0.35rem;
}

.policy a {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--green);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

.policy .summary {
  border: 1px solid var(--hairline);
  border-left: 4px solid var(--green);
  border-radius: 12px;
  padding: 1rem 1.25rem;
}

.policy .summary ul {
  margin: 0;
  padding-left: 1.1rem;
}

/* ---- Focus visibility (keyboard) -------------------------------------- */

a:focus-visible {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
  border-radius: 2px;
}

/* ---- Load reveal (CSS-only, motion-safe) ------------------------------- */

@media (prefers-reduced-motion: no-preference) {
  .card, .empty {
    animation: rise 0.45s ease backwards;
    animation-delay: calc(min(var(--i, 0), 10) * 45ms);
  }
  .card::before { transition-duration: 0.18s; }
}

@keyframes rise {
  from { opacity: 0; transform: translateY(10px); }
}
"""

_PAGE_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{meta_description}">
<title>{title}</title>
<link rel="icon" type="image/svg+xml" href="{favicon_href}">
{rss_autodiscovery}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
{ga_head}
{stats_beacon}
<style>
{css}
</style>
</head>
<body>
{icon_sprite}
<div class="wrap">
{header}
<main>
{content}
</main>
<footer class="foot" id="site-footer" tabindex="-1">
<p>Built {built_display} &middot; offers re-verified on every change</p>
{traffic_strip}
{foot_nav}
{consent_settings}
</footer>
</div>
{banner}
{ga_init}
{app_js}
{extra_js}
</body>
</html>
"""

_HOME_HEADER = """<header class="masthead masthead-home">
<div class="bar">
<h1>Free AI Credits</h1>
<p class="kicker">zero runtime &middot; every offer labeled with verification level &amp; sign-up need</p>
</div>
<p class="tagline">Every claimable free-credit offer worth your time, on one fast page. Each carries a verification level (hand-checked or community-sourced) and a sign-up tag, refreshed on every rebuild.</p>
<p class="count"><strong>{count}</strong> live offers &middot; <strong>{ongoing}</strong> ongoing &middot; <strong>{verified}</strong> hand-verified by the maintainer</p>
</header>"""

# Footer nav shared by every page. Links stay relative so they resolve under
# any deploy base (e.g. the GitHub Pages /<repo>/ project path); ``depth``
# prefixes them so pages one level down (offers/<slug>.html) climb back to
# the site root. The current page is marked aria-current for assistive tech.
# The RSS link targets the build-generated feed (F12/#27); it is a document,
# never the current page.
_FOOT_NAV = """<nav class="foot-nav" aria-label="Site">\
<a href="{home_href}"{offers_current}>Offers</a><span aria-hidden="true">&middot;</span>\
<a href="{archive_href}"{archive_current}>Archive</a><span aria-hidden="true">&middot;</span>\
<a href="{privacy_href}"{privacy_current}>Privacy policy</a><span aria-hidden="true">&middot;</span>\
<a href="{feed_href}">RSS</a></nav>"""

# Maintainer contact links (#50), rendered as a second footer nav on every
# generated page. Destinations are the maintainer's own published profiles;
# external anchors follow the site convention: new tab + noopener hardening.
_CONTACT_LINKS = (
    ("X", "https://x.com/luongnv89"),
    ("LinkedIn", "https://linkedin.com/in/luongnv89"),
    ("Website", "https://luongnv.com"),
)

_CONTACT_ANCHOR = (
    '<a href="{url}" target="_blank" rel="noopener noreferrer">{label}</a>'
)


def _contact_nav() -> str:
    """External maintainer-contact nav shared by every generated page."""
    parts = []
    for i, (label, url) in enumerate(_CONTACT_LINKS):
        if i:
            parts.append('<span aria-hidden="true">&middot;</span>')
        parts.append(
            _CONTACT_ANCHOR.format(
                url=html.escape(url, quote=True),
                label=html.escape(label),
            )
        )
    return '<nav class="foot-nav" aria-label="Contact">' + "".join(parts) + "</nav>"


# Home listing row (#ft-grid). The element vocabulary stays deliberately
# close to the archive card — same <li><article> nesting, same data-* hooks
# the site script reads (data-category / -verified / -expiry / -amount-sort),
# same outbound-link attribution attributes — so filter, search and all three
# sort modes keep working untouched. Only the internal layout is new: a
# title+amount head line over one muted meta line, with the rank number drawn
# by a CSS counter (see _HOME_CSS) rather than baked into markup, so it
# renumbers correctly after any filter or re-sort.
_CARD_TMPL = """<li style="--i:{index}">
<article class="card" id="offer-{slug}" data-category="{category}" data-verification="{verification}" data-signup="{signup}" data-verified="{verified_date}" data-expiry="{expiry_iso}" data-amount-sort="{amount_sort}">
<div class="row-head">
<h2 class="card-title"><a href="{detail_href}" data-ft-offer-id="{offer_id}" data-ft-provider="{provider}" data-ft-offer-category="{category}" aria-label="View details for {title}">{title}</a></h2>
<span class="r-amount">{amount}</span>
</div>
<p class="row-meta">
{category_badge}{verification_badge}{signup_badge}<span class="sep" aria-hidden="true">&middot;</span>\
<span class="r-prov">{provider}</span><span class="sep" aria-hidden="true">&middot;</span>\
{expiry_display}<span class="sep" aria-hidden="true">&middot;</span>\
<span class="r-vfd" title="verified {verified_display}">verified <time datetime="{verified_date}">{verified_rel}</time></span><span class="sep" aria-hidden="true">&middot;</span>\
<a class="r-details" href="{detail_href}">details</a>
</p>
</article>
</li>"""


_EMPTY_TMPL = """<section class="empty" style="--i:0">
<p class="glyph" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="presentation"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8"/><path d="M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8"/></svg></p>
<h2>No live offers right now</h2>
<p>Every listing here is screened against the provider, and none have passed the check at the moment.</p>
<p>New and renewed offers appear automatically after the next rebuild &mdash; check back soon.</p>
<p class="empty-archive">In the meantime, <a href="archive.html">browse the archive</a> of expired offers.</p>
</section>"""


# --- Favicon (launch checklist, PRD §8.1) -----------------------------------
# One self-contained SVG emitted next to the HTML so every generated page
# shares a single icon; the relative href stays deploy-base safe (GitHub
# Pages project sites serve under /<repo>/).
_FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\
<rect width="64" height="64" rx="14" fill="#000000"/>\
<g fill="none" stroke="#22c55e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">\
<rect x="13" y="25" width="38" height="10" rx="2"/>\
<path d="M19 35v11a5 5 0 0 0 5 5h16a5 5 0 0 0 5-5V35"/>\
<path d="M32 25v26"/>\
<path d="M32 25c-8 0-11-4-11-7a4 4 0 0 1 7-2c3 3 4 9 4 9z"/>\
<path d="M32 25c8 0 11-4 11-7a4 4 0 0 0-7-2c-3 3-4 9-4 9z"/>\
</g></svg>
"""


def _human_date(iso: str) -> str:
    """Render a YYYY-MM-DD string as e.g. 'Dec 31, 2026'."""
    day = dt.datetime.strptime(iso, "%Y-%m-%d").date()
    return f"{day.strftime('%b')} {day.day}, {day.year}"


# Past this many days an age stops being the more useful reading and starts
# being a liability: the string is frozen at build time, so a page that has
# not been rebuilt for weeks would keep insisting an offer was verified
# "today". Inside the window the relative form is both truthful and faster to
# scan; outside it, the absolute date lets the reader judge staleness itself.
RELATIVE_DATE_MAX_DAYS = 14


def _relative_date(iso: str, today: dt.date) -> str:
    """Render a YYYY-MM-DD string as an age relative to ``today``.

    The listing shows "3d ago" where the card showed "Aug 20, 2026": age is
    what a visitor actually judges freshness by. ``today`` is always the
    build's own date (index["generated_at"]), never the viewer's clock — the
    string is baked into the HTML at build time, so this stays inside the
    deploy-time-only evaluation rule of ADR #11. Future dates (a verified_date
    ahead of the build clock) collapse to "today" rather than a negative age,
    and anything older than RELATIVE_DATE_MAX_DAYS falls back to the absolute
    date so a stale build can never overstate how fresh an offer is.
    """
    try:
        day = dt.datetime.strptime(iso, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return iso or ""
    days = (today - day).days
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 7:
        return f"{days}d ago"
    if days < RELATIVE_DATE_MAX_DAYS:
        return f"{days // 7}w ago"
    return _human_date(iso)


def _build_date(generated_at: str) -> dt.date:
    """The build's own calendar date, used as the "now" for relative ages."""
    try:
        return dt.datetime.strptime(generated_at[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError, IndexError):
        return dt.date.today()


# --- Client-side discovery (F2/F3): category filter + text search ----------
#
# The toolbar is emitted whenever the page has offers. All narrowing happens
# client-side over cards already in the DOM: no reload, no network fetch.
# State lives in the URL (?category=, ?q=) so any view is shareable and the
# back/forward buttons work (PRD §6.2).

# Toolbar chips mirror the row tags exactly — same glyph, same hue, same
# filled-when-active convention — so the two controls read as one mechanism
# seen from two distances rather than as two parallel filter systems.
_CHIP = (
    '<button type="button" class="chip {hue}" data-ft-category="{value}" '
    'aria-pressed="{pressed}">{icon}<span>{label}</span></button>'
)


def build_toolbar(count: int | None = None) -> str:
    """Search box + sort select + All/five-category chips, keyboard-navigable.

    ``count`` seeds the live-region status line so the pre-JS paint already
    shows a truthful result count.
    """
    chips = [
        _CHIP.format(value="", pressed="true", label="All", hue="", icon="")
    ]
    for category in CATEGORIES:
        chips.append(
            _CHIP.format(
                value=html.escape(category, quote=True),
                pressed="false",
                label=CATEGORY_LABELS.get(category, category),
                hue=f"chip-category-{html.escape(category, quote=True)}",
                icon=_tag_icon(category),
            )
        )
    sort_options = ['<option value="">Default</option>']
    for mode in SORT_MODES:
        sort_options.append(
            f'<option value="{html.escape(mode, quote=True)}">'
            f"{html.escape(SORT_LABELS[mode])}</option>"
        )
    seeded = f"Showing all {count} offers" if count is not None else ""
    return (
        '<section class="toolbar" aria-label="Search and filter offers">'
        '<div class="field">'
        '<label class="tool-label" for="ft-search">Search</label>'
        '<input type="search" id="ft-search" name="q" '
        'placeholder="Search title, provider, or amount&hellip;" '
        'autocomplete="off" spellcheck="false" maxlength="200">'
        "</div>"
        '<div class="field field-sort">'
        '<label class="tool-label" for="ft-sort">Sort</label>'
        '<select id="ft-sort">' + "".join(sort_options) + "</select>"
        "</div>"
        '<div class="chips" role="group" aria-label="Filter by category">'
        + "".join(chips)
        + "</div>"
        '<div class="results-line">'
        '<p class="results-status" id="ft-results-status" role="status" '
        f'aria-live="polite">{seeded}</p>'
        '<button type="button" class="chip clear" id="ft-clear-filters" '
        'hidden>Clear all filters</button>'
        "</div>"
        "</section>"
    )


# --- Home listing: ranked mono rows (#89) ------------------------------------
# Scoped hard to `.masthead-home` and `#ft-grid`, the two selectors that only
# ever appear on the home page. /archive renders under `#ft-archive-grid` and
# the offer detail pages under `.offer-detail`, so both keep the original card
# vocabulary untouched — one design system, two densities, no fork.
_HOME_CSS = """
/* ---- Home masthead: thin bar ------------------------------------------ */

.masthead-home .bar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 1.1rem;
  border-bottom: 2px solid var(--ink);
  padding-bottom: 0.55rem;
}

.masthead-home h1 {
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.015em;
  margin: 0;
}

.masthead-home .kicker { margin: 0; }

.masthead-home .tagline {
  font-size: 0.92rem;
  color: var(--gray);
  margin: 0.7rem 0 0.3rem;
  max-width: 46rem;
}

.masthead-home .count { margin: 0 0 1.1rem; }

/* ---- Ranked listing rows ---------------------------------------------- */

#ft-grid {
  display: block;
  counter-reset: ftrank;
  border-top: 1px solid var(--ink);
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* The shared card stagger (_CSS `rise`) is right for a handful of cards and
   wrong for 32 dense rows, where it reads as the list twitching into place.
   The listing fades in once, as one object; the archive keeps the stagger. */
@media (prefers-reduced-motion: no-preference) {
  #ft-grid .card { animation: none; }
  #ft-grid { animation: rise 0.3s ease backwards; }
}

#ft-grid > li {
  display: grid;
  grid-template-columns: 2.6rem minmax(0, 1fr);
  align-items: baseline;
  padding: 0.62rem 0.4rem;
  border-bottom: 1px solid var(--hairline);
}

/* Must out-specify `.grid li[hidden]` from _APP_CSS: the row above is an
   id-scoped `display: grid`, so the plain-class hide rule alone would lose. */
#ft-grid > li[hidden] { display: none; }

/* Rank is drawn, not stored. A CSS counter skips `display: none` rows, so a
   filtered list renumbers 1..n on its own, and re-sorting (which moves the
   nodes) renumbers with it — no JS involvement, nothing to keep in sync. */
#ft-grid > li::before {
  counter-increment: ftrank;
  content: counter(ftrank) ".";
  font-size: 0.8rem;
  color: var(--gray);
  text-align: right;
  padding-right: 0.7rem;
  font-variant-numeric: tabular-nums;
}

#ft-grid > li:hover,
#ft-grid > li:focus-within { background: rgba(0, 0, 0, 0.035); }

#ft-grid > li:hover::before,
#ft-grid > li:focus-within::before { color: var(--gray); }

/* Strip the card chrome: on the home listing the row IS the container. */
#ft-grid .card {
  display: block;
  height: auto;
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
}

#ft-grid .card::before { content: none; }

#ft-grid .card:hover,
#ft-grid .card:focus-within {
  transform: none;
  box-shadow: none;
  border-color: transparent;
}

.row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 0.7rem;
}

.row-head > * { min-width: 0; }

#ft-grid .card-title {
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 0;
}

#ft-grid .card-title a { color: var(--ink); text-decoration: none; }

#ft-grid .card-title a:hover,
#ft-grid .card-title a:focus-visible {
  text-decoration: underline;
  text-decoration-color: var(--green);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

/* The credit amount is the one thing a visitor is scanning for, so it keeps
   ink-black weight while everything else on the row recedes to gray. It must
   still wrap: the field ranges from "$5" to a full eligibility sentence, and
   any nowrap here pushes the whole page into horizontal scroll. */
.r-amount {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink);
  min-width: 0;
  overflow-wrap: anywhere;
}

.row-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.1rem 0.42rem;
  margin: 0.18rem 0 0;
  font-size: 0.74rem;
  color: var(--gray);
}

.row-meta .sep { color: var(--hairline); }

.r-prov {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* Listing density: tags shrink, but keep their own hue (set in _CSS) —
   this rule must never re-assert a colour or it would flatten them again. */
#ft-grid .badge {
  font-size: 0.63rem;
  padding: 0.08rem 0.45rem;
}

/* The three tag families sit side by side on one meta line, so they need a
   little more air between them than the 0.42rem the rest of the line uses,
   or the pills collide into a single bar of colour. */
.row-meta .badge + .badge { margin-left: 0.1rem; }

#ft-grid .status { font-size: inherit; }

#ft-grid .dot { width: 0.42rem; height: 0.42rem; box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.22); }

.r-details {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--hairline);
  text-underline-offset: 3px;
}

.r-details:hover,
.r-details:focus-visible {
  text-decoration-color: var(--green);
  text-decoration-thickness: 2px;
}

/* Touch: the title link already spans the row, but the secondary "details"
   link needs its own comfortable target on coarse pointers. */
@media (pointer: coarse) {
  #ft-grid > li { padding-block: 0.75rem; }
  .r-details {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
}

/* Narrow viewports: reclaim the rank gutter rather than squeezing the row. */
@media (max-width: 24rem) {
  #ft-grid > li { grid-template-columns: 1.9rem minmax(0, 1fr); }
  #ft-grid > li::before { padding-right: 0.45rem; }
}
"""

# Bypass block (WCAG 2.4.1) for the two pages that render a tag-bearing list.
# Every row carries three tag controls, so without this the footer sits a few
# hundred tab stops down. Placed after the toolbar so the filters — the reason
# to be on the page — still come first in DOM order.
_SKIP_LIST_LINK = '<a class="skip-list" href="#site-footer">Skip the offer list</a>\n'

_CLIENT_EMPTY_TMPL = """<section class="empty" id="ft-no-results" hidden>
<p class="glyph" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="presentation"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/><path d="M8.5 11h5"/></svg></p>
<h2>No matching offers</h2>
<p>Nothing matches every filter you have applied at once. The status line above lists them; clearing one usually brings offers back.</p>
<button type="button" class="chip reset" id="ft-reset-filters">Clear search &amp; filters</button>
</section>"""


# --- Dedicated offer detail pages (#60) --------------------------------------
# Every offer gets one static page under offers/ promoting the former dialog
# content: core card fields always present; curated summary/claim_steps/
# social_proof sections appear only when the offer has an
# offers/details/<slug>.json document. Sections use h2 headings beneath the
# page's h1, and the proof layout keeps the screenshot/x/reddit/link slots
# open for future evidence types (#60 acceptance criterion 4).

_PROOF_LINK_LABELS = {
    "x": "View post on X",
    "reddit": "View on Reddit",
    "link": "Open source",
}

_FALLBACK_STEPS = (
    "Open the official offer page.",
    "Create a free account or sign in.",
    "The free credit applies per the terms shown there.",
)


def _resolve_asset(src: str, rel_prefix: str) -> str:
    """Prefix a page-relative asset src with ``rel_prefix`` when needed.

    Absolute paths, already-climbing paths and external URLs are left
    untouched so depth-1 pages (offers/<slug>.html) resolve local
    screenshots against the site root instead of offers/.
    """
    if not rel_prefix or src.startswith(("../", "./", "/")) or "://" in src:
        return src
    return f"{rel_prefix}{src}"


def _proof_card(entry: dict, rel_prefix: str = "") -> str:
    kind = entry["type"]
    if kind == "screenshot":
        caption = html.escape(entry["caption"])
        image = _resolve_asset(entry["image"], rel_prefix)
        return (
            '<figure class="proof-card proof-screenshot">'
            f'<img src="{html.escape(image, quote=True)}" '
            f'alt="{caption}" loading="lazy">'
            f"<figcaption>{caption}</figcaption>"
            "</figure>"
        )
    head = ""
    if kind == "link":
        # A linked source has no post author; its required title acts as
        # the card headline instead.
        head = (
            f'<p class="proof-text"><strong>{html.escape(entry["title"])}</strong></p>'
        )
    meta = html.escape(entry.get("author", ""))
    if kind == "x" and entry.get("handle"):
        meta += f' <span class="proof-meta">{html.escape(entry["handle"])}</span>'
    if kind == "reddit" and entry.get("community"):
        meta += f' <span class="proof-meta">{html.escape(entry["community"])}</span>'
    text = ""
    if entry.get("text"):
        text = f'<p class="proof-text">&ldquo;{html.escape(entry["text"])}&rdquo;</p>'
    label = _PROOF_LINK_LABELS[kind]
    return (
        f'<blockquote class="proof-card proof-{kind}">{head}{text}'
        f'<footer>{meta} <a href="{html.escape(entry["url"], quote=True)}" '
        'target="_blank" rel="noopener noreferrer">'
        f'{label} <span aria-hidden="true">&#8599;</span></a></footer>'
        "</blockquote>"
    )


def _claim_step_parts(steps, slug: str) -> tuple[str, str]:
    """Render claim steps as a checkable runbook checklist.

    Each step is a real checkbox + label pair so the guide works with
    zero JS; the inline checklist runtime (see _CHECKLIST_JS) only adds
    the progress readout and per-offer persistence. ``slug`` namespaces
    ids and the localStorage key so sibling pages never collide.
    Returns ``(progress_readout_html, claim_list_html)``.
    """
    key = html.escape(slug or "offer", quote=True)
    items = []
    for i, step in enumerate(steps, 1):
        items.append(
            f'<li class="claim-step">'
            f'<input type="checkbox" id="ft-step-{key}-{i}">'
            f'<label for="ft-step-{key}-{i}">'
            f'<span class="step-num" aria-hidden="true">'
            f'<span class="num">{i}</span>'
            f'<span class="tick">&#10003;</span></span>'
            f'<span class="step-text">{html.escape(step)}</span>'
            f"</label></li>"
        )
    progress = (
        f'<p class="steps-progress">'
        f'<span class="progress-readout" id="ft-progress-readout" '
        f'role="status" aria-live="polite">{len(steps)}-step guide</span>'
        f'<span class="progress-track" aria-hidden="true">'
        f'<span class="progress-fill"></span></span></p>'
    )
    return progress, f'<ol class="claim-list" role="list">{"".join(items)}</ol>'


def _proof_section(detail: dict | None, rel_prefix: str = "") -> str:
    """Social-proof section; empty when the offer ships no proof entries."""
    detail = detail or {}
    if not detail.get("social_proof"):
        return ""
    cards = "".join(_proof_card(e, rel_prefix) for e in detail["social_proof"])
    return f'<section class="od-proof"><h2>Social proof</h2>{cards}</section>'


def _detail_sections(detail: dict | None, rel_prefix: str = "", slug: str = "") -> str:
    """Shared summary/claim-steps partial for offer pages.

    Consumed by render_offer_html; heading levels assume a page context
    (h2 sections under the page's h1). Without a detail document the
    fallback claim steps apply and the summary section stays absent,
    matching what dialogs rendered for such offers. ``rel_prefix`` keeps
    local screenshot srcs depth-aware (see _resolve_asset). ``slug``
    namespaces the checklist ids/localStorage key. Social proof renders
    separately (see _proof_section) so the page can slot the claim CTA
    directly after the checklist.
    """
    detail = detail or {}
    summary_html = ""
    if detail.get("summary"):
        summary_html = (
            '<section class="od-brief"><h2>The offer</h2>'
            f'<p class="od-summary">{html.escape(detail["summary"])}</p></section>'
        )
    progress_html, steps_list = _claim_step_parts(
        detail.get("claim_steps") or _FALLBACK_STEPS, slug
    )
    return (
        f"{summary_html}\n"
        f'<section class="od-steps" data-ft-checklist '
        f'data-ft-offer-id="{html.escape(slug or "offer", quote=True)}">\n'
        f'<header class="od-steps-head"><h2>How to claim</h2>{progress_html}</header>\n'
        f"{steps_list}\n"
        f"</section>"
    )


_OFFER_HEADER = """<header class="masthead">
<p class="kicker">free ai credits</p>
<p class="od-tags">{category_badge}</p>
<h1>{title}</h1>
<p class="tagline">From <strong>{provider}</strong> &middot; {verification_badge} {signup_badge} &middot; checked on <time datetime="{verified_date}">{verified_display}</time>.</p>
<p class="count">{status}</p>
</header>"""


def _share_section(page_url: str, title: str, slug: str) -> str:
    """Offer share bar (#71): LinkedIn/X/Facebook/email + copy-link.

    Every target link pre-fills the destination network with the offer
    page's absolute URL (and title where supported). Each action carries a
    ``data-ft-share`` channel attribute that both the tracking wiring and
    tests key on; the copy button is a real <button> so clipboard access
    never depends on navigation.
    """
    q_url = quote(page_url, safe="")
    q_title = quote(title, safe="")
    links = (
        (
            "linkedin",
            "https://www.linkedin.com/sharing/share-offsite/?url=" + q_url,
            "LinkedIn",
        ),
        (
            "x",
            "https://twitter.com/intent/tweet?url=" + q_url + "&text=" + q_title,
            "X",
        ),
        (
            "facebook",
            "https://www.facebook.com/sharer/sharer.php?u=" + q_url,
            "Facebook",
        ),
        (
            "email",
            "mailto:?subject=" + q_title + "&body=" + q_url,
            "Email",
        ),
    )
    anchors = "".join(
        f'<a class="share-link" href="{href}" target="_blank" '
        f'rel="noopener noreferrer" data-ft-share="{channel}">{label}</a>'
        for channel, href, label in links
    )
    return (
        '<section class="od-share" aria-label="Share this offer" '
        f'data-ft-offer-id="{html.escape(slug, quote=True)}">\n'
        "<h2>Share this offer</h2>\n"
        f'<div class="share-actions">{anchors}'
        '<button type="button" class="share-copy" data-ft-share="copy">'
        "Copy link</button></div>\n"
        '<p class="share-status" id="ft-share-status" role="status" '
        'aria-live="polite" hidden></p>\n'
        "</section>"
    )


# Share-bar runtime (#71). Inline on every detail page (they ship no
# app_js). Tracking rides window.ftTrackEvent — the consent-gated bus — so
# an offer_share event exists only after an explicit grant; sharing itself
# never depends on analytics being allowed. Copy uses the async Clipboard
# API when present and falls back to a hidden textarea + execCommand, and
# confirms success via a polite live region.
_SHARE_JS = """<script>
(function () {
  "use strict";
  var OFFER_ID = __FT_OFFER_ID__;
  var PAGE_URL = __FT_PAGE_URL__;
  function ftTrack(channel) {
    try {
      if (typeof window.ftTrackEvent === "function") {
        window.ftTrackEvent("offer_share", {
          offer_id: OFFER_ID,
          channel: channel
        });
      }
    } catch (err) {}
  }
  function ftStatus(text) {
    var box = document.getElementById("ft-share-status");
    if (!box) { return; }
    box.textContent = text;
    box.hidden = false;
  }
  function ftCopyLegacy(text) {
    var ok = false;
    var box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.left = "-9999px";
    document.body.appendChild(box);
    box.select();
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    document.body.removeChild(box);
    return ok;
  }
  function ftCopy() {
    var done = function (ok) {
      if (ok) { ftTrack("copy"); }
      ftStatus(ok ? "Link copied!" : "Copy failed \u2014 long-press the address bar instead.");
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(PAGE_URL).then(
        function () { done(true); },
        function () { done(ftCopyLegacy(PAGE_URL)); }
      );
    } else {
      done(ftCopyLegacy(PAGE_URL));
    }
  }
  var nodes = document.querySelectorAll("[data-ft-share]");
  for (var i = 0; i < nodes.length; i++) {
    (function (node) {
      node.addEventListener("click", function () {
        var channel = node.getAttribute("data-ft-share") || "";
        if (channel === "copy") {
          ftCopy();
        } else {
          // Fire-and-forget: navigation is native, never intercepted.
          ftTrack(channel);
        }
      });
    })(nodes[i]);
  }
})();
</script>"""


# Checklist runtime for the claim runbook. The steps are real checkboxes,
# so ticking/striking works with JS disabled; this script only adds the
# live "n/total done" readout, the progress fill, and per-offer
# persistence in localStorage. Nothing leaves the device — no analytics
# event, no network — so it needs no consent gate. Storage failures
# (private mode, quota) degrade to session-only state silently.
_CHECKLIST_JS = """<script>
(function () {
  "use strict";
  var OFFER_ID = __FT_OFFER_ID__;
  var KEY = "ft-claim-" + OFFER_ID;
  function ftInit() {
    var root = document.querySelector(
      '[data-ft-checklist][data-ft-offer-id="' + OFFER_ID + '"]'
    );
    if (!root) { return; }
    var boxes = root.querySelectorAll(".claim-step input[type=checkbox]");
    var total = boxes.length;
    var readout = document.getElementById("ft-progress-readout");
    var fill = root.querySelector(".progress-fill");
    if (!total) { return; }
    function savedDone() {
      try {
        var raw = window.localStorage.getItem(KEY);
        var arr = raw ? JSON.parse(raw) : null;
        return Object.prototype.toString.call(arr) === "[object Array]" ? arr : [];
      } catch (err) {
        return [];
      }
    }
    function persist() {
      var done = [];
      for (var i = 0; i < total; i++) {
        if (boxes[i].checked) { done.push(i); }
      }
      try {
        window.localStorage.setItem(KEY, JSON.stringify(done));
      } catch (err) {}
    }
    function render() {
      var done = 0;
      for (var i = 0; i < total; i++) {
        if (boxes[i].checked) { done += 1; }
      }
      if (readout) {
        readout.textContent =
          done === 0 ? total + "-step guide" : done + "/" + total + " done";
      }
      if (fill) { fill.style.transform = "scaleX(" + done / total + ")"; }
    }
    var prior = savedDone();
    for (var j = 0; j < total; j++) {
      if (prior.indexOf(j) !== -1) { boxes[j].checked = true; }
      boxes[j].addEventListener("change", function () {
        render();
        persist();
      });
    }
    render();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ftInit);
  } else {
    ftInit();
  }
})();
</script>"""


def render_offer_html(
    offer: dict,
    detail: dict | None,
    built: str,
    measurement_id: str = "",
    stats_site: str = "",
    base_url: str = "",
) -> str:
    """Render one dedicated offer page at site/offers/<slug>.html (#60).

    Shares the site chrome at depth 1, so every chrome href climbs one
    level (../favicon.svg, ../archive.html, ...). The outbound claim link
    stays hardened like every external anchor on the site. ``base_url``
    feeds the share bar's absolute page URL (#71); it falls back to the
    production deploy base so shared links always resolve.
    """
    page_url = (base_url or DEFAULT_BASE_URL).rstrip(
        "/"
    ) + f"/offers/{offer['slug']}.html"
    expired = offer.get("status") == "expired"
    if expired:
        status = (
            '<span class="badge badge-expired">'
            f'{_tag_icon("expired")}<span>Expired</span></span>'
        )
        if offer["expiry_date"]:
            status += (
                f' <span class="status">ended '
                f'<time datetime="{html.escape(offer["expiry_date"], quote=True)}">'
                f"{_human_date(offer['expiry_date'])}</time></span>"
            )
    elif offer["expiry_date"]:
        status = (
            f'<span class="status">expires '
            f'<time datetime="{html.escape(offer["expiry_date"], quote=True)}">'
            f"{_human_date(offer['expiry_date'])}</time></span>"
        )
    else:
        status = (
            '<span class="status"><span class="dot" aria-hidden="true">'
            "</span>ongoing</span>"
        )
    provider = html.escape(offer["provider"])
    summary_text = (detail or {}).get("summary", "")
    if summary_text:
        blurb = (
            summary_text[:157].rstrip() + "..."
            if len(summary_text) > 160
            else summary_text
        )
    else:
        blurb = (
            f"{offer['amount']} from {offer['provider']} — free AI credits, "
            "tagged by verification level and sign-up need."
        )
    if expired:
        cta = (
            '<p class="od-ended">This offer ended &mdash; nothing here '
            "is claimable anymore.</p>"
        )
    else:
        cta = (
            f'<a class="od-cta" href="{html.escape(offer["source_url"], quote=True)}" '
            f'target="_blank" rel="noopener noreferrer">Claim at {provider} '
            '<span aria-hidden="true">&#8599;</span></a>'
        )
    content = (
        '<article class="offer-detail">\n'
        '<p class="od-back"><a href="../">&larr; All offers</a></p>\n'
        '<div class="od-hero">\n'
        f'<p class="amount">{html.escape(offer["amount"])}</p>\n'
        f'<p class="od-statusline mono">{status}'
        f' <span class="sep" aria-hidden="true">&middot;</span>'
        f" {_signup_badge(offer['signup'], interactive=False, href_prefix='../')}"
        f' <span class="sep" aria-hidden="true">&middot;</span>'
        f' checked <time datetime="'
        f'{html.escape(offer["verified_date"], quote=True)}">'
        f"{_human_date(offer['verified_date'])}</time></p>\n"
        "</div>\n"
        f"{_detail_sections(detail, rel_prefix='../', slug=offer['slug'])}\n"
        f"{cta}\n"
        f"{_proof_section(detail, rel_prefix='../')}\n"
        f"{_share_section(page_url, offer['title'], offer['slug'])}\n"
        "</article>"
    )
    share_js = _SHARE_JS.replace("__FT_OFFER_ID__", json.dumps(offer["slug"])).replace(
        "__FT_PAGE_URL__", json.dumps(page_url)
    )
    checklist_js = _CHECKLIST_JS.replace(
        "__FT_OFFER_ID__", json.dumps(offer["slug"])
    )
    return _page_shell(
        title=html.escape(f"{offer['title']} · Free AI Credits"),
        meta_description=html.escape(blurb, quote=True),
        header=_OFFER_HEADER.format(
            category_badge=_category_badge(
                offer["category"], interactive=False, href_prefix="../"
            ),
            title=html.escape(offer["title"], quote=True),
            amount=html.escape(offer["amount"]),
            provider=provider,
            verification_badge=_verification_badge(
                offer["verification"], interactive=False, href_prefix="../"
            ),
            signup_badge=_signup_badge(
                offer["signup"], interactive=False, href_prefix="../"
            ),
            verified_date=html.escape(offer["verified_date"], quote=True),
            verified_display=_human_date(offer["verified_date"]),
            status=status,
        ),
        content=content,
        built=built,
        foot_current="",
        css_extra=_DETAIL_CSS,
        measurement_id=measurement_id,
        depth=1,
        stats_site=stats_site,
        extra_js=share_js + checklist_js,
    )


# --- Analytics (F7): consent-gated GA4 with banner --------------------------
#
# Design (silent degradation, PRD §4.1):
#   * No measurement ID configured -> nothing analytics-related is emitted.
#   * Consent Mode v2: defaults are denied in <head>; gtag.js is only
#     injected after an explicit grant, so declining sends no tracking
#     calls at all.
#   * The banner targets visitors whose IANA timezone starts with the EU
#     prefixes below — a client-side heuristic approximation of geo
#     targeting, never a precise location.
#   * Everything runs after window load via requestIdleCallback so page
#     load/Lighthouse timing is unaffected.

_CONSENT_HEAD_JS = """<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  wait_for_update: 500
});
</script>"""

_ANALYTICS_INIT_JS = """<script>
(function () {
  "use strict";
  var MEASUREMENT_ID = __FT_GA_ID__;
  var STORAGE_KEY = "__FT_STORAGE_KEY__";
  // Consent-gated event bus for feature events (filter_use, search,
  // offer_share). Stays false until an explicit grant; window.ftTrackEvent
  // is the only door page features knock on, so declined/absent analytics
  // no-ops.
  var TRACKING_ACTIVE = false;
  function ftTrackEvent(name, params) {
    if (!TRACKING_ACTIVE) { return; }
    if (MEASUREMENT_ID && typeof gtag === "function") {
      gtag("event", name, params);
    }
  }
  window.ftTrackEvent = ftTrackEvent;
  function ftStoredDecision() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }
  function ftStoreDecision(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (err) {}
  }
  function ftLoadGa() {
    if (document.getElementById("ft-ga4-script")) { return; }
    var s = document.createElement("script");
    s.id = "ft-ga4-script";
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" +
      encodeURIComponent(MEASUREMENT_ID);
    document.head.appendChild(s);
  }
  function ftGrant() {
    TRACKING_ACTIVE = true;
    // Tell consent-gated companions (the GoatCounter loader) that tracking
    // may start; they listen for this event instead of loading on their own.
    try {
      window.dispatchEvent(new CustomEvent("ft-consent-granted"));
    } catch (err) {}
    if (!MEASUREMENT_ID || typeof window.gtag !== "function") { return; }
    gtag("consent", "update", { analytics_storage: "granted" });
    ftLoadGa();
    // send_page_view:false keeps config() from firing a duplicate page_view;
    // page_location strips the query string so raw URLs never leave the page.
    gtag("config", MEASUREMENT_ID,
      { anonymize_ip: true, send_page_view: false });
    gtag("event", "page_view", {
      page_path: window.location.pathname,
      page_location: window.location.origin + window.location.pathname
    });
  }
  function ftDecline() {
    TRACKING_ACTIVE = false;
    if (!MEASUREMENT_ID || typeof window.gtag !== "function") { return; }
    gtag("consent", "update", { analytics_storage: "denied" });
  }
  function ftHideBanner() {
    var b = document.getElementById("ft-consent-banner");
    if (b && b.parentNode) { b.parentNode.removeChild(b); }
  }
  function ftAccept() {
    ftStoreDecision("granted");
    ftHideBanner();
    ftGrant();
  }
  function ftReject() {
    ftStoreDecision("denied");
    ftHideBanner();
    ftDecline();
  }
  function ftShowBanner() {
    var b = document.getElementById("ft-consent-banner");
    if (!b) { return; }
    b.hidden = false;
    var accept = document.getElementById("ft-consent-accept");
    if (accept) { accept.focus(); }
  }
  function ftWire() {
    var accept = document.getElementById("ft-consent-accept");
    var reject = document.getElementById("ft-consent-decline");
    var settings = document.getElementById("ft-consent-settings");
    if (accept) { accept.addEventListener("click", ftAccept); }
    if (reject) { reject.addEventListener("click", ftReject); }
    // Persistent change-of-mind entry point (#72): the footer "Cookie
    // settings" control re-opens the banner on every page, even after a
    // stored decision, so consent is never a one-way door.
    if (settings) {
      // Wiring happened once in ftInit before any early return, so this
      // handler must never re-run the wiring step — that would stack
      // duplicate accept/reject/settings/keydown listeners on every click.
      settings.addEventListener("click", function () {
        ftShowBanner();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var b = document.getElementById("ft-consent-banner");
        if (b && !b.hidden) { ftReject(); }
      }
    });
  }
  function ftInit() {
    // The settings control must work even after a stored decision, so the
    // wiring happens before any early return.
    ftWire();
    var stored = ftStoredDecision();
    if (stored === "granted") { ftGrant(); return; }
    if (stored === "denied") { return; }
    // GDPR (#72): every first-time visitor is asked, not only ones whose
    // time zone looks European. No tracking starts until they answer.
    ftShowBanner();
  }
  function ftSchedule() {
    try {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(ftInit, { timeout: 2000 });
      } else {
        window.setTimeout(ftInit, 1);
      }
    } catch (err) {
      window.setTimeout(ftInit, 1);
    }
  }
  if (document.readyState === "complete") {
    ftSchedule();
  } else {
    window.addEventListener("load", ftSchedule);
  }
})();
</script>"""

_BANNER_TMPL = """<div id="ft-consent-banner" class="consent" role="region" aria-label="Analytics consent" hidden>
<p class="consent-text">This site counts visits and offer clicks to see which offers help people. Counting uses Google Analytics 4 with IP anonymization (which may set cookies) and, when enabled, a cookie-free GoatCounter page counter. Nothing runs until you allow it. You can change your mind anytime via &ldquo;Cookie settings&rdquo; in the footer.</p>
<div class="consent-actions">
<button type="button" id="ft-consent-accept">Allow</button>
<button type="button" id="ft-consent-decline">Decline</button>
</div>
</div>"""

# Persistent change-of-mind entry point (#72): rendered in every page's
# footer whenever any tracking is configured. The analytics runtime wires
# its click to re-open the banner.
_CONSENT_SETTINGS_TMPL = (
    '<p class="foot-consent">'
    '<button type="button" id="ft-consent-settings"'
    ' class="consent-settings">Cookie settings</button></p>'
)

_BANNER_CSS = """
/* ---- Consent banner (only emitted when GA4 is configured) -------------- */

.consent {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  left: 1rem;
  z-index: 50;
  max-width: 34rem;
  margin: 0 auto;
  border: 1px solid var(--ink);
  border-radius: 12px;
  background: var(--paper);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  padding: 1rem 1.25rem;
}

.consent[hidden] { display: none; }

.consent-text {
  margin: 0 0 0.75rem;
  font-size: 0.9rem;
}

.consent-actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.consent-actions button {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.8rem;
  padding: 0.45rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--ink);
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}

.consent-actions button:hover {
  background: var(--ink);
  color: var(--paper);
}

button:focus-visible {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

/* Touch targets: same 44 px coarse-pointer floor as the toolbar. */
@media (pointer: coarse) {
  .consent-actions button { min-height: 44px; }
}

/* Footer "Cookie settings" control (#72): quiet text-style button that
   re-opens the consent banner on any page, at any time. */
.foot-consent {
  margin: 0.5rem 0 0;
}

.consent-settings {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.74rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--gray);
  text-decoration: underline;
  cursor: pointer;
}

.consent-settings:hover {
  color: var(--ink);
}
"""

# --- Live traffic strip (#62) -------------------------------------------------
# Footer line filled client-side from the GoatCounter deployment. Starts
# hidden and is revealed only after a successful fetch, so a blocked,
# offline, or erroring stats backend degrades to nothing visible at all —
# same silent-degradation contract as consent-gated analytics (PRD §4.1).
# Wording ("live traffic", "visitors") deliberately avoids the masthead
# deal-counter vocabulary (#49) so the two can never be confused. The
# {stats_href} link opens the provider's public dashboard.
_TRAFFIC_STRIP_TMPL = (
    f'<p class="foot-traffic" id="{TRAFFIC_STRIP_ID}" role="status" '
    'aria-live="polite" hidden>'
    '<span class="dot" aria-hidden="true"></span>site traffic &middot; '
    '<strong id="ft-traffic-today">&mdash;</strong> visitors today &middot; '
    '<strong id="ft-traffic-period">&mdash;</strong> in 90 days &middot; '
    '<a href="{stats_href}" rel="noopener noreferrer">full stats</a>'
    "</p>"
)

_TRAFFIC_CSS = """
/* ---- Live traffic strip (only emitted when stats are configured) ------- */

.foot-traffic {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem 0.4rem;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.75rem;
  color: var(--gray);
  margin: 0.75rem 0 0;
}

.foot-traffic[hidden] { display: none; }

.foot-traffic strong { color: var(--ink); }

.foot-traffic .dot { flex: 0 0 auto; }
"""

_APP_CSS = """
/* ---- Toolbar: search + category filter (F2/F3) ------------------------- */

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.7rem 1.1rem;
  margin: 0 0 0.9rem;
}

.field { display: flex; flex-direction: column; gap: 0.28rem; flex: 1 1 15rem; }

.tool-label {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--gray);
}

/* Squared-off controls read as terminal furniture next to the mono listing,
   but the borders stay full ink so both still look unmistakably operable. */
#ft-search {
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.84rem;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--ink);
  border-radius: 4px;
  padding: 0.42rem 0.7rem;
  max-width: 24rem;
  width: 100%;
}

.field-sort { flex: 0 1 auto; }

#ft-sort {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.84rem;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--ink);
  border-radius: 4px;
  padding: 0.42rem 1.9rem 0.42rem 0.7rem;
  cursor: pointer;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chip {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.74rem;
  padding: 0.32rem 0.7rem;
  border-radius: 4px;
  border: 1px solid var(--ink);
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}

.chip:hover {
  background: var(--tag-hue);
  border-color: var(--tag-hue);
  color: var(--paper);
}

/* Visible keyboard focus must not depend on the analytics stylesheet
   (_BANNER_CSS ships only when GA4 is configured). */
.chip:focus-visible,
#ft-search:focus-visible,
#ft-sort:focus-visible {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

.chip[aria-pressed="true"] {
  background: var(--tag-hue);
  border-color: var(--tag-hue);
  color: var(--paper);
}

.results-status {
  flex-basis: 100%;
  min-width: 0;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.74rem;
  color: var(--gray);
  margin: 0;
}

/* ---- Clickable tags: every tag is a filter ----------------------------- */
/* A tag is a real <button>, so it is keyboard-reachable and announces its
   own pressed state for free. The three states are deliberately far apart:
     rest   -> hue text on a 7% hue tint  (readable, clearly not applied)
     hover  -> solid hue under white text (clearly operable)
     active -> solid hue, and a trailing × (clearly applied, clearly undoable)
   `aria-pressed` is the single source of truth for the active state; the
   runtime never adds a class, so style and semantics cannot drift apart. */
button.badge {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}

button.badge:hover,
button.badge:focus-visible,
button.badge[aria-pressed="true"] {
  background: var(--tag-hue);
  color: var(--paper);
}

/* Drawn with ::after rather than a real element: the search runtime matches
   against the row's textContent, and a literal × node would silently join
   every offer's searchable text. */
button.badge[aria-pressed="true"]::after {
  /* Literal glyph, not the CSS escape "\\00d7": _APP_CSS is a plain
     triple-quoted string, so Python would read that backslash-zero as an
     octal escape and emit a NUL byte into the stylesheet. */
  content: "×";
  margin-left: 0.1em;
  font-size: 1.1em;
  line-height: 1;
}

button.badge:focus-visible {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  a.badge, button.badge { transition: none; }
}

/* Chips carry the same hue as the row tag they mirror, in every state — the
   two controls are the same mechanism seen at two distances, so a chip at
   rest has to look like a tag at rest (hue text over a 7% wash of that hue)
   and not like plain ink. Only the pressed and hover states use the fill,
   matching the tags exactly. */
.chip {
  --tag-hue: var(--ink);
  display: inline-flex;
  align-items: center;
  gap: 0.34em;
  border-color: var(--tag-hue);
  color: var(--tag-hue);
  background: color-mix(in srgb, var(--tag-hue) 7%, var(--paper));
}

.chip .tag-i { width: 1.05em; height: 1.05em; flex: 0 0 auto; }

.chip-category-api_provider { --tag-hue: var(--t-api_provider); }
.chip-category-coding { --tag-hue: var(--t-coding); }
.chip-category-image { --tag-hue: var(--t-image); }
.chip-category-voice { --tag-hue: var(--t-voice); }
.chip-category-video { --tag-hue: var(--t-video); }

/* Applied-filter pills in the status line. They are filled, like the row tag
   and toolbar chip for the same value in their applied state, so all three
   places a filter is visible agree on what "applied" looks like. */
.filter-pill {
  --tag-hue: var(--ink);
  display: inline-flex;
  align-items: center;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.72rem;
  line-height: 1.5;
  padding: 0 0.45rem;
  border: 1px solid var(--tag-hue);
  border-radius: 999px;
  background: var(--tag-hue);
  color: var(--paper);
  cursor: pointer;
}

/* ::after, not a text node: the empty-state copy and the search both read
   textContent, and a literal × would quietly become part of it. */
.filter-pill::after {
  content: "×";
  margin-left: 0.25em;
  font-size: 1.1em;
  line-height: 1;
}

.filter-pill:focus-visible {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

@media (pointer: coarse) {
  .filter-pill { min-height: 32px; padding-inline: 0.6rem; }
}

/* Result count and the escape hatch share one baseline; the button only
   exists in the DOM-visible sense while something is actually filtered. */
.results-line {
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.8rem;
}

/* .results-status still carries flex-basis: 100% from when it was itself the
   toolbar's flex child; left alone it would push the clear button onto its
   own line every time. */
.results-line .results-status { flex: 0 1 auto; }

.chip.clear[hidden] { display: none; }

.chip.clear {
  font-size: 0.7rem;
  padding: 0.24rem 0.6rem;
  border-color: var(--gray);
  color: var(--gray);
}

.chip.clear:hover,
.chip.clear:focus-visible {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper);
}

/* Hidden list items must leave the grid layout entirely. */
.grid li[hidden] { display: none; }

.empty .chip.reset { margin-top: 0.75rem; }

/* Touch targets: WCAG 2.1 AA sets no size minimum, but iOS/Android HIG
   guidance is 44 px; raised only on coarse-pointer (touch) devices so
   mouse/keyboard layouts are unchanged. */
@media (pointer: coarse) {
  .chip,
  #ft-search,
  #ft-sort { min-height: 44px; }

  /* Row tags are the dense control, so they get the touch minimum too —
     without it a 0.63rem pill is roughly a 22px target. */
  button.badge {
    min-height: 32px;
    padding-inline: 0.6rem;
  }

  /* `#ft-grid .badge` sets padding at id specificity (1,1,0), which outranks
     the (0,1,1) rule above, so on the listing the widening is dead unless it
     is matched. Only the inline padding needs restating — min-height is
     uncontested. */
  #ft-grid button.badge { padding-inline: 0.6rem; }
}
"""

# Offer detail affordances (#60): the card trigger is now a plain
# navigational link to the offer's page, and the page itself reuses the
# former dialog content styles scoped under .offer-detail.
_DETAIL_CSS = """
/* ---- Card detail link -------------------------------------------------- */

.card-actions { margin-top: 0.75rem; }

.detail-btn {
  display: block;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  padding: 0.42rem 0.95rem;
  border-radius: 999px;
  border: 1px solid var(--ink);
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  text-align: center;
  text-decoration: none;
}

.detail-btn:hover { background: var(--ink); color: var(--paper); }

.detail-btn:focus-visible {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

/* ---- Offer detail page: the claim runbook --------------------------------
   Hero amount up top, mono status line, then a checkable step-by-step
   guide on a hairline rail. Green stays highlight-only (lines, dots,
   borders, fills of the progress track); solid fills are ink-on-paper,
   matching every other operable control on the site. */

.offer-detail {
  max-width: 46rem;
  margin: 0 auto;
}

.od-back {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  margin: 0 0 1.75rem;
}

.od-back a {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--hairline);
  text-underline-offset: 3px;
}

.od-back a:hover,
.od-back a:focus-visible {
  text-decoration-color: var(--green);
  text-decoration-thickness: 3px;
}

/* The amount is the one thing a visitor came for — give it hero weight. */

.offer-detail .amount {
  font-size: clamp(1.7rem, 5vw, 2.6rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.12;
  margin: 0;
  overflow-wrap: anywhere;
}

.od-statusline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.1rem 0.45rem;
  font-size: 0.78rem;
  color: var(--gray);
  margin: 0.9rem 0 0;
  padding-bottom: 1.4rem;
  border-bottom: 1px solid var(--hairline);
}

.od-statusline .sep { color: var(--hairline); }

/* Section labels: small mono furniture with the home-page green dash. */

.offer-detail section h2 {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--gray);
  margin: 2rem 0 0.6rem;
}

.offer-detail section h2::before {
  content: "";
  display: inline-block;
  width: 1.5rem;
  height: 3px;
  background: var(--green);
  margin-right: 0.6rem;
  vertical-align: middle;
}

.od-brief p {
  margin: 0.35rem 0 0;
  max-width: 42rem;
}

/* Steps head: label left, live progress readout right. */

.od-steps-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 1rem;
}

.od-steps-head h2 { margin: 2rem 0 0.6rem; }

.steps-progress {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  margin: 2rem 0 0.6rem;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  color: var(--gray);
  font-variant-numeric: tabular-nums;
}

.progress-track {
  width: clamp(3.5rem, 12vw, 6rem);
  height: 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.progress-fill {
  display: block;
  height: 100%;
  width: 100%;
  /* Darker than --green on purpose: keeps >=3:1 against the track
     (#ebebeb) and page white; the global token stays for dashes/ticks. */
  background: #15803d;
  transform: scaleX(0);
  transform-origin: left;
}

/* The checklist itself: real checkboxes (JS-free ticking), a rail that
   threads the number squares, and strike-through on completed steps.
   The input is visually hidden but focusable; focus and checked states
   are drawn on the sibling label's box so keyboard users get the same
   picture as pointer users. */

.claim-list {
  --step-box: 2.1rem;
  list-style: none;
  margin: 0;
  padding: 0;
  position: relative;
}

.claim-list::before {
  content: "";
  position: absolute;
  left: calc(var(--step-box) / 2);
  top: calc(var(--step-box) / 2 + 0.55rem);
  bottom: calc(var(--step-box) / 2 + 0.55rem);
  width: 1px;
  background: var(--hairline);
  transform: translateX(-50%);
}

.claim-step {
  position: relative;
  padding-block: 0.55rem;
}

.claim-step input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  margin: 0;
}

/* The label is the grid: number box left, text right. The checkbox input
   itself is visually hidden; the label carries the whole interaction. */
.claim-step label {
  display: grid;
  grid-template-columns: var(--step-box) minmax(0, 1fr);
  column-gap: 0.95rem;
  align-items: start;
  cursor: pointer;
}

.step-num {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: var(--step-box);
  height: var(--step-box);
  border: 1.5px solid var(--ink);
  border-radius: 8px;
  background: var(--paper);
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.85rem;
  font-weight: 600;
  user-select: none;
}

.step-num > span {
  grid-area: 1 / 1;
  display: grid;
  place-items: center;
}

.step-num .tick {
  opacity: 0;
  transform: scale(0.4);
}

.claim-step label:hover .step-num { background: rgba(0, 0, 0, 0.05); }

.claim-step input:focus-visible + label .step-num {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

.claim-step input:checked + label .step-num {
  background: var(--ink);
  border-color: var(--ink);
}

.claim-step input:checked + label .num { opacity: 0; }

.claim-step input:checked + label .tick {
  opacity: 1;
  transform: scale(1);
  color: var(--paper);
}

.step-text {
  font-size: 0.95rem;
  line-height: 1.5;
  padding-top: 0.32rem;
  overflow-wrap: anywhere;
}

.claim-step input:checked + label .step-text {
  color: var(--gray);
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  text-decoration-color: rgba(0, 0, 0, 0.35);
}

@media (prefers-reduced-motion: no-preference) {
  .progress-fill { transition: transform 0.25s ease; }

  .step-num,
  .step-num > span {
    transition: background-color 0.15s ease, opacity 0.15s ease,
      transform 0.18s ease;
  }
}

@media (pointer: coarse) {
  .claim-step { padding-block: 0.7rem; }

  /* li padding is not part of the hit area; pad the label itself so the
     clickable row reaches the 44px touch minimum on single-line steps. */
  .claim-step label { padding-block: 0.35rem; }
}

.proof-card {
  border: 1px solid var(--hairline);
  border-left: 4px solid var(--green);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin: 0.6rem 0;
}

.proof-card p { margin: 0.15rem 0; }

.proof-text { overflow-wrap: anywhere; }

.proof-card footer,
.proof-meta {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.74rem;
  color: var(--gray);
}

.proof-card footer { margin-top: 0.35rem; }

.proof-card footer a {
  color: var(--ink);
  text-decoration: underline;
  text-decoration-color: var(--green);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

figure.proof-screenshot { margin: 0.6rem 0; }

.proof-screenshot img {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  border: 1px solid var(--hairline);
}

.proof-screenshot figcaption {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.74rem;
  color: var(--gray);
  margin-top: 0.4rem;
}

.od-cta {
  display: inline-block;
  margin-top: 2rem;
  padding: 0.7rem 1.4rem;
  border-radius: 999px;
  background: var(--ink);
  color: var(--paper);
  text-decoration: none;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.86rem;
  font-weight: 600;
}

.od-cta:hover { text-decoration: underline; text-underline-offset: 4px; }

.od-cta span[aria-hidden] { display: inline-block; }

@media (prefers-reduced-motion: no-preference) {
  .od-cta span[aria-hidden] { transition: transform 0.15s ease; }

  .od-cta:hover span[aria-hidden] { transform: translate(2px, -2px); }
}

.od-cta:focus-visible {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

/* Ended offers (#25): muted, non-interactive notice in place of the CTA —
   the wording itself carries the meaning, styling is decoration only. */
.od-ended {
  display: inline-block;
  margin-top: 1.5rem;
  padding: 0.55rem 1.15rem;
  border-radius: 999px;
  border: 1px solid var(--gray);
  color: var(--gray);
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.82rem;
}

/* Touch targets: same 44 px coarse-pointer floor as the toolbar. */
@media (pointer: coarse) {
  .detail-btn,
  .od-cta { min-height: 44px; }
}

/* ---- Offer share bar (#71) ---------------------------------------------- */

.share-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.share-link,
.share-copy {
  display: inline-block;
  padding: 0.35rem 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--ink);
  background: var(--paper);
  color: var(--ink);
  text-decoration: none;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.74rem;
  cursor: pointer;
}

.share-link:hover,
.share-copy:hover {
  background: var(--ink);
  color: var(--paper);
}

.share-link:focus-visible,
.share-copy:focus-visible {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

.share-status {
  margin: 0.5rem 0 0;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.74rem;
  color: var(--gray);
}

@media (pointer: coarse) {
  .share-link,
  .share-copy { min-height: 44px; }
}
"""

# Client-side discovery runtime. Vanilla ES5-style IIFE, emitted inline so
# the page stays a single self-contained file with zero framework/runtime.
# Analytics calls go through window.ftTrackEvent, which only exists when GA4
# is build-time configured AND consent was granted — absent or declined, the
# calls are silent no-ops and every feature keeps working (PRD §4.1).
_APP_JS = """<script id="ft-app">
(function () {
  "use strict";
  // Every tag family is a filter dimension. The dimension name is the URL
  // parameter, the `data-ft-tag` value, AND the card's `data-*` attribute, so
  // adding a fourth family later means adding one entry here and nothing else.
  var DIMENSIONS = __FT_DIMENSIONS__;
  var VALID = __FT_TAG_VALUES__;
  var TAG_LABELS = __FT_TAG_LABELS__;
  var VALID_CATEGORIES = VALID.category;
  var VALID_SORTS = __FT_SORTS__;
  var DEBOUNCE_MS = __FT_DEBOUNCE_MS__;
  var OFFER_DEDUPE_MS = __FT_OFFER_DEDUPE_MS__;

  function ftNormalize(value) {
    return (value || "").toLowerCase();
  }

  function ftParseState(search) {
    var params = new URLSearchParams(search || "");
    var sort = params.get("sort") || "";
    if (VALID_SORTS.indexOf(sort) === -1) { sort = ""; }
    var state = { q: (params.get("q") || "").trim(), sort: sort };
    // Each dimension is whitelisted against its own enum, so a hand-edited
    // or stale URL degrades to "unfiltered" rather than an empty listing.
    for (var i = 0; i < DIMENSIONS.length; i++) {
      var dim = DIMENSIONS[i];
      var value = params.get(dim) || "";
      state[dim] = VALID[dim].indexOf(value) === -1 ? "" : value;
    }
    return state;
  }

  function ftSerializeState(state) {
    // Whitelist-only: unknown params are dropped, matching the analytics
    // privacy stance of never persisting arbitrary query strings.
    var params = new URLSearchParams();
    for (var i = 0; i < DIMENSIONS.length; i++) {
      if (state[DIMENSIONS[i]]) {
        params.set(DIMENSIONS[i], state[DIMENSIONS[i]]);
      }
    }
    if (state.q) { params.set("q", state.q); }
    if (state.sort) { params.set("sort", state.sort); }
    return params.toString();
  }

  function ftActiveTags(state) {
    // The applied tag filters. Each carries the label a reader sees plus the
    // dimension its pill has to clear, so the status line can name what is
    // filtering AND hand back a control that removes just that one.
    var out = [];
    for (var i = 0; i < DIMENSIONS.length; i++) {
      var dim = DIMENSIONS[i];
      if (!state[dim]) { continue; }
      out.push({
        dim: dim,
        value: state[dim],
        label: (TAG_LABELS[dim] || {})[state[dim]] || state[dim]
      });
    }
    return out;
  }

  // "Clear all filters" is a blunt instrument once three dimensions can be
  // applied at once and only one of them is in the way. Every name in the
  // status line is therefore the control that drops that dimension: same
  // hue as the tag it came from, trailing × to say it is removable. The ×
  // is drawn with ::after so it never joins the row text the search matches.
  function ftRenderStatus(status, shown, total, active) {
    while (status.firstChild) { status.removeChild(status.firstChild); }
    status.appendChild(
      document.createTextNode(
        shown === total
          ? "Showing all " + total + " offers"
          : "Showing " + shown + " of " + total + " offers"
      )
    );
    for (var i = 0; i < active.length; i++) {
      status.appendChild(document.createTextNode(" · "));
      var pill = document.createElement("button");
      pill.setAttribute("type", "button");
      pill.setAttribute(
        "class",
        "filter-pill badge-" + active[i].dim + "-" + active[i].value
      );
      pill.setAttribute("data-ft-remove", active[i].dim);
      pill.setAttribute("aria-label", "Remove " + active[i].label + " filter");
      pill.appendChild(document.createTextNode(active[i].label));
      status.appendChild(pill);
    }
  }

  function ftHasFilters(state) {
    return !!(state.q || ftActiveTags(state).length);
  }

  // The enum values every filter_use event reports. All three are drawn from
  // closed build-time enums, never from anything a visitor typed, so this
  // stays inside the "no free text in analytics" rule that keeps `search`
  // limited to query_length.
  function ftFilterParams(state) {
    var params = {};
    for (var i = 0; i < DIMENSIONS.length; i++) {
      params[DIMENSIONS[i]] = state[DIMENSIONS[i]] || "all";
    }
    return params;
  }

  function ftCardAttr(li, name) {
    var card = li.querySelector("[data-category]");
    return card ? (card.getAttribute(name) || "") : "";
  }

  // F10 ordering. Every mode is stable: ties fall back to the build-time
  // index captured once at init, so re-sorting never shuffles equal keys.
  function ftApplySort(grid, items, mode) {
    var ordered = items.slice();
    var idx = function (li) {
      return parseInt(li.getAttribute("data-ft-index") || "0", 10) || 0;
    };
    if (mode === "newest") {
      ordered.sort(function (a, b) {
        return (
          ftCardAttr(b, "data-verified").localeCompare(
            ftCardAttr(a, "data-verified")
          ) || idx(a) - idx(b)
        );
      });
    } else if (mode === "expiring") {
      ordered.sort(function (a, b) {
        var ea = ftCardAttr(a, "data-expiry");
        var eb = ftCardAttr(b, "data-expiry");
        if (!ea && !eb) { return idx(a) - idx(b); }
        if (!ea) { return 1; }  // ongoing offers sink to the end
        if (!eb) { return -1; }
        return ea.localeCompare(eb) || idx(a) - idx(b);
      });
    } else if (mode === "amount") {
      ordered.sort(function (a, b) {
        return (
          (parseFloat(ftCardAttr(b, "data-amount-sort")) || 0) -
          (parseFloat(ftCardAttr(a, "data-amount-sort")) || 0) ||
          idx(a) - idx(b)
        );
      });
    } else {
      ordered.sort(function (a, b) { return idx(a) - idx(b); });
    }
    // Appending moves a node (remove + insert), and removing the element
    // that holds focus resets focus to <body>. Every filter application runs
    // through here, so re-appending unconditionally would blur the row tag a
    // keyboard user just activated and drop them to the top of the listing.
    // Filtering never changes the order, so check first and touch nothing in
    // the common case; a real re-sort still needs the full pass, because
    // appending moves to the end and a partial pass cannot place a node.
    for (var i = 0; i < ordered.length; i++) {
      if (grid.children[i] !== ordered[i]) {
        for (var j = 0; j < ordered.length; j++) {
          grid.appendChild(ordered[j]); // append moves the node, like the DOM
        }
        return;
      }
    }
  }

  // AND semantics: an offer is shown only when it satisfies EVERY active tag
  // filter (category, verification, sign-up) and the search query.
  function ftMatches(li, state) {
    var card = li.querySelector("[data-category]");
    if (!card) { return false; }
    for (var i = 0; i < DIMENSIONS.length; i++) {
      var dim = DIMENSIONS[i];
      if (state[dim] && card.getAttribute("data-" + dim) !== state[dim]) {
        return false;
      }
    }
    if (!state.q) { return true; }
    return (
      ftNormalize(card.textContent).indexOf(ftNormalize(state.q)) !== -1
    );
  }

  function ftDebounce(fn, ms) {
    var timer = null;
    return function () {
      var self = this;
      var args = arguments;
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(function () {
        timer = null;
        fn.apply(self, args);
      }, ms);
    };
  }

  function ftTrack(name, params) {
    if (typeof window.ftTrackEvent === "function") {
      window.ftTrackEvent(name, params);
    }
  }

  function ftInitApp() {
    var grid = document.getElementById("ft-grid");
    var input = document.getElementById("ft-search");
    var status = document.getElementById("ft-results-status");
    var emptyBox = document.getElementById("ft-no-results");
    var resetButton = document.getElementById("ft-reset-filters");
    var clearButton = document.getElementById("ft-clear-filters");
    var sortSelect = document.getElementById("ft-sort");
    if (!grid || !input || !status) { return; }
    var items = Array.prototype.slice.call(grid.querySelectorAll("li"));
    // Freeze the build-time order so "" (default sort) can always restore it.
    for (var n = 0; n < items.length; n++) {
      if (items[n].getAttribute("data-ft-index") === null) {
        items[n].setAttribute("data-ft-index", String(n));
      }
    }
    var total = items.length;
    var state = ftParseState(window.location.search);

    // Outbound offer-link attribution (F6). One delegated listener covers
    // every card link. The send is fire-and-forget inside try/catch and the
    // link's navigation is native (target=_blank, never intercepted), so a
    // missing, blocked, or throwing tracker can never break or delay it —
    // the navigate-away race is structurally impossible. A short dedupe
    // window swallows accidental rapid double-clicks on the same offer only;
    // different offers are never suppressed.
    var lastOfferId = null;
    var lastOfferAt = 0;
    grid.addEventListener("click", function (event) {
      var node = event.target;
      var offerId = null;
      while (node && node !== grid) {
        if (node.getAttribute) {
          offerId = node.getAttribute("data-ft-offer-id");
          if (offerId) { break; }
        }
        node = node.parentNode || null;
      }
      if (!offerId) { return; }
      var now = Date.now();
      if (offerId === lastOfferId && now - lastOfferAt < OFFER_DEDUPE_MS) {
        return;
      }
      lastOfferId = offerId;
      lastOfferAt = now;
      try {
        ftTrack("offer_click", {
          offer_id: offerId,
          provider: node.getAttribute("data-ft-provider") || "",
          category: node.getAttribute("data-ft-offer-category") || ""
        });
      } catch (err) {}
    });

    // Row-tag clicks. One delegated listener covers every tag on every row,
    // including rows re-ordered by a sort, and it toggles: clicking the tag
    // that is already filtering clears it, so the control that applied a
    // filter is always the control that removes it. The listener sits beside
    // the offer_click one above and never collides with it -- a tag carries
    // no data-ft-offer-id, so that handler's walk finds nothing and returns.
    grid.addEventListener("click", function (event) {
      var node = event.target;
      var dim = null;
      while (node && node !== grid) {
        if (node.getAttribute) {
          dim = node.getAttribute("data-ft-tag");
          if (dim) { break; }
        }
        node = node.parentNode || null;
      }
      if (!dim || DIMENSIONS.indexOf(dim) === -1) { return; }
      var value = node.getAttribute("data-ft-tag-value") || "";
      if (VALID[dim].indexOf(value) === -1) { return; }
      state[dim] = state[dim] === value ? "" : value;
      commit("filter");
    });

    function syncControls() {
      var tags = grid.querySelectorAll("[data-ft-tag]");
      for (var t = 0; t < tags.length; t++) {
        var tag = tags[t];
        var tagDim = tag.getAttribute("data-ft-tag") || "";
        var tagValue = tag.getAttribute("data-ft-tag-value") || "";
        tag.setAttribute(
          "aria-pressed",
          state[tagDim] === tagValue && tagValue ? "true" : "false"
        );
      }
      if (clearButton) {
        // This control hides itself the moment it does its job, and hiding
        // the element that holds focus drops the user to <body> -- at the top
        // of a long listing, with nothing announced. Hand focus to the search
        // box, which is always present, before it goes.
        var hideClear = !ftHasFilters(state);
        if (hideClear && document.activeElement === clearButton) {
          input.focus();
        }
        clearButton.hidden = hideClear;
      }
      var chips = document.querySelectorAll("[data-ft-category]");
      for (var i = 0; i < chips.length; i++) {
        var chip = chips[i];
        var value = chip.getAttribute("data-ft-category") || "";
        chip.setAttribute(
          "aria-pressed",
          value === state.category ? "true" : "false"
        );
      }
      if (document.activeElement !== input) { input.value = state.q; }
      if (sortSelect && document.activeElement !== sortSelect) {
        sortSelect.value = state.sort;
      }
    }

    function apply(options) {
      options = options || {};
      ftApplySort(grid, items, state.sort);
      var shown = 0;
      for (var i = 0; i < items.length; i++) {
        var li = items[i];
        var show = ftMatches(li, state);
        li.hidden = !show;
        if (show) { shown++; }
      }
      // Naming the applied tags matters more here than the raw count: a
      // filter can be applied from a row tag far down the page, where the
      // toolbar is scrolled out of sight and nothing else would say why the
      // list shrank.
      var active = ftActiveTags(state);
      ftRenderStatus(status, shown, total, active);
      if (emptyBox) {
        // Same trap as the clear button: the empty state's reset control
        // disappears with the box that holds it the instant it brings offers
        // back, so focus has to be moved off it deliberately.
        var hideEmpty = shown !== 0;
        if (
          hideEmpty &&
          resetButton &&
          document.activeElement === resetButton
        ) {
          input.focus();
        }
        emptyBox.hidden = hideEmpty;
      }
      syncControls();
      if (options.commit) {
        var query = ftSerializeState(state);
        var nextSearch = query ? "?" + query : "";
        // Skip redundant entries so Back always undoes a real change.
        if (nextSearch !== window.location.search) {
          try {
            window.history.pushState(
              {},
              "",
              nextSearch || window.location.pathname
            );
          } catch (err) {}
        }
      }
    }

    function commit(source) {
      apply({ commit: true });
      if (source === "filter") {
        ftTrack("filter_use", ftFilterParams(state));
      } else if (source === "search" && state.q) {
        // Privacy: length only — the raw term never reaches analytics.
        ftTrack("search", { query_length: state.q.length });
      } else if (source === "sort") {
        // F10: one event per change; "" is reported as "default".
        ftTrack("sort_use", { sort_option: state.sort || "default" });
      }
    }

    input.addEventListener(
      "input",
      ftDebounce(function () {
        var q = input.value.trim().toLowerCase();
        if (q === state.q) { return; }
        state.q = q;
        commit("search");
      }, DEBOUNCE_MS)
    );

    var chips = document.querySelectorAll("[data-ft-category]");
    for (var c = 0; c < chips.length; c++) {
      chips[c].addEventListener("click", function (event) {
        var value = event.currentTarget.getAttribute("data-ft-category") || "";
        if (value && VALID_CATEGORIES.indexOf(value) === -1) { return; }
        state.category = value;
        commit("filter");
      });
    }

    // F10: sort changes reorder client-side, persist to the URL, and fire
    // exactly one sort_use event per actual change.
    if (sortSelect) {
      sortSelect.addEventListener("change", function () {
        var value = sortSelect.value || "";
        if (VALID_SORTS.indexOf(value) === -1) { value = ""; }
        if (value === state.sort) { return; }
        state.sort = value;
        commit("sort");
      });
    }

    function clearAll() {
      for (var i = 0; i < DIMENSIONS.length; i++) { state[DIMENSIONS[i]] = ""; }
      state.q = "";
      input.value = "";
      commit("filter");
    }

    // Two entry points, one behaviour: the empty-state reset (only reachable
    // when nothing matches) and the toolbar clear (present whenever anything
    // is filtered, so a filter applied from a row tag is always undoable
    // without hunting for that row again).
    if (resetButton) { resetButton.addEventListener("click", clearAll); }
    if (clearButton) { clearButton.addEventListener("click", clearAll); }

    // Removing one dimension from the status line. Delegated, because the
    // pills are rebuilt on every apply().
    status.addEventListener("click", function (event) {
      var node = event.target;
      var dim = null;
      while (node && node !== status) {
        if (node.getAttribute) {
          dim = node.getAttribute("data-ft-remove");
          if (dim) { break; }
        }
        node = node.parentNode || null;
      }
      if (!dim || DIMENSIONS.indexOf(dim) === -1) { return; }
      state[dim] = "";
      commit("filter");
      // The pill just activated no longer exists -- the same trap the clear
      // button had. Prefer the next remaining pill so removing several in a
      // row keeps the keyboard in one place; fall back to the search box.
      var next = status.querySelector("[data-ft-remove]");
      if (next && next.focus) { next.focus(); } else { input.focus(); }
    });

    window.addEventListener("popstate", function () {
      state = ftParseState(window.location.search);
      apply(); // restore view; history navigation is not a new application
    });

    apply(); // deep-link restore without events or history churn
  }

  function ftBoot() {
    try {
      ftInitApp();
    } catch (err) {}
__FT_STATS_BOOT__
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ftBoot);
  } else {
    ftBoot();
  }
__FT_STATS_MODULE__
})();
</script>"""

# Live traffic module (#62), spliced into _APP_JS only when GoatCounter is
# configured. Shares the page IIFE's scope and boot lifecycle; every failure
# path (missing slot, no fetch API, HTTP error status, network rejection,
# malformed payload) is a silent no-op that leaves the strip hidden — the
# same contract as ftTrackEvent's consent gate. Counts come from GoatCounter's
# public visitor-counter route,
# GET <site>/counter/TOTAL.json?start=<YYYY-MM-DD>&end=<YYYY-MM-DD>, which
# returns {"count": "<formatted visitors>"} and requires "Allow adding
# visitor counts on your website" to be enabled in the dashboard. `end` is
# an EXCLUSIVE midnight boundary, so every window ends on tomorrow (#102).
# The 90-day window is fixed copy, not a provider retention claim.
#
# Freshness is capped by the provider, not by us (#102): responses are CDN
# cached for ~4h keyed on (path, start, end). Unknown query params are
# stripped from that key and a Cache-Control request header fails CORS, so
# the cache cannot be bypassed from the page -- displayed figures can lag
# the source by hours. Do not add a cache-buster param; it is inert.
# That staleness is accepted rather than engineered around (#102), so the
# copy reads "site traffic" and never claims the figures are live.
_STATS_JS_MODULE = r"""
  // --- Live traffic strip (#62) -------------------------------------------
  var STATS_SITE = __FT_STATS_SITE__;

  function ftIsoDate(d) {
    return (
      d.getFullYear() +
      "-" + ("0" + (d.getMonth() + 1)).slice(-2) +
      "-" + ("0" + d.getDate()).slice(-2)
    );
  }

  function ftCounterUrl(days) {
    // `days` counts calendar days INCLUDING today: 1 is today alone, 90 is
    // the trailing 90 days. GoatCounter reads `end` as an exclusive
    // midnight boundary, so the window has to end on tomorrow to contain
    // anything recorded today -- start and end on one date describes a
    // zero-length range and always returned 0 (#102).
    var now = new Date();
    var end = new Date(now.getTime() + 86400000);
    var start = new Date(now.getTime() - (days - 1) * 86400000);
    return (
      STATS_SITE +
      "/counter/TOTAL.json?start=" + ftIsoDate(start) +
      "&end=" + ftIsoDate(end)
    );
  }

  function ftFormatCount(n) {
    // Thousands separators keep large counts scannable (12345 -> 12,345).
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // Defensive extraction: GoatCounter returns formatted strings like
  // "1,234"; only digits-derived finite non-negative numbers count as data,
  // anything else leaves the strip hidden instead of showing junk.
  function ftStatNumber(data) {
    if (!data || typeof data.count !== "string") { return null; }
    var n = parseInt(data.count.replace(/[^0-9]/g, ""), 10);
    if (!isFinite(n) || n < 0) { return null; }
    return n;
  }

  function ftFillTraffic(box, todayVisitors, periodVisitors) {
    if (todayVisitors === null || periodVisitors === null) { return; }
    box.querySelector("#ft-traffic-today").textContent =
      ftFormatCount(todayVisitors);
    box.querySelector("#ft-traffic-period").textContent =
      ftFormatCount(periodVisitors);
    box.hidden = false;
  }

  function ftInitStats() {
    var box = document.getElementById("__FT_STRIP_ID__");
    if (!box || typeof window.fetch !== "function") { return; }
    Promise.all([
      window.fetch(ftCounterUrl(1)),
      window.fetch(ftCounterUrl(90))
    ]).then(function (responses) {
      if (!responses[0].ok || !responses[1].ok) { return null; }
      return Promise.all([
        responses[0].json(),
        responses[1].json()
      ]);
    }).then(function (payloads) {
      if (!payloads) { return; }
      ftFillTraffic(
        box,
        ftStatNumber(payloads[0]),
        ftStatNumber(payloads[1])
      );
    }).catch(function () {});
  }
"""


def resolve_measurement_id(raw) -> str:
    """Return a valid GA4 measurement ID, or '' when analytics is disabled.

    An unset/empty value disables analytics silently; a malformed value
    disables it with a warning so a typo can never break the build.
    """
    value = (raw or "").strip()
    if not value:
        return ""
    if not MEASUREMENT_ID_RE.match(value):
        print(
            f"warning: ignoring malformed {MEASUREMENT_ID_ENV_VAR}={value!r} "
            "(expected G-XXXXXXXXXX); analytics disabled",
            file=sys.stderr,
        )
        return ""
    return value


def get_measurement_id(env=None) -> str:
    """Read the GA4 measurement ID from the environment ('' when disabled)."""
    environ = os.environ if env is None else env
    return resolve_measurement_id(environ.get(MEASUREMENT_ID_ENV_VAR, ""))


def resolve_stats_site(raw) -> str:
    """Return a normalized https GoatCounter origin, or '' when disabled.

    Origin-only by design: the beacon and counter URLs append their own
    fixed paths (/count, /counter/TOTAL.json), so anything beyond the
    origin would signal a misconfiguration — and rejecting it keeps hostile
    characters out of emitted attributes entirely.
    """
    value = (raw or "").strip().rstrip("/")
    if not value:
        return ""
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or "@" in parsed.netloc
        or parsed.params
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("",)
        or not STATS_SITE_RE.match(f"{parsed.scheme}://{parsed.netloc}")
    ):
        print(
            f"warning: ignoring malformed {STATS_SITE_ENV_VAR}={value!r} "
            "(expected an https:// origin); traffic stats disabled",
            file=sys.stderr,
        )
        return ""
    return f"{parsed.scheme}://{parsed.netloc}"


def get_traffic_stats_site(env=None) -> str:
    """Read the GoatCounter site URL from the environment ('' when disabled).

    An unset/empty value disables traffic stats silently; a malformed value
    disables them with a warning so a typo can never break the build.
    """
    environ = os.environ if env is None else env
    return resolve_stats_site(environ.get(STATS_SITE_ENV_VAR, ""))


def build_stats_beacon(site: str = "") -> str:
    """Consent-gated GoatCounter loader ('' when stats are disabled).

    GDPR (#72): the counting beacon is non-essential tracking, so it is
    never emitted as a plain async <head> script any more. Instead a tiny
    inline loader injects the real tracker only after consent exists —
    either already granted in local storage or granted live via the
    ``ft-consent-granted`` event the analytics runtime dispatches. With no
    decision (or a refusal) zero bytes reach gc.zgo.at. The site value is
    embedded as a JSON string and applied via setAttribute, so hostile
    characters can never break out even though the resolver rejects them.
    """
    if not site:
        return ""
    count_url = f"{site}/count"
    return (
        "<script>\n"
        "(function () {\n"
        '  "use strict";\n'
        f"  var COUNT_URL = {json.dumps(count_url)};\n"
        f"  var STORAGE_KEY = {json.dumps(CONSENT_STORAGE_KEY)};\n"
        "  function ftGcLoad() {\n"
        '    if (document.getElementById("ft-gc-script")) { return; }\n'
        '    var s = document.createElement("script");\n'
        '    s.id = "ft-gc-script";\n'
        "    s.async = true;\n"
        '    s.src = "https://gc.zgo.at/count.js";\n'
        '    s.setAttribute("data-goatcounter", COUNT_URL);\n'
        "    document.head.appendChild(s);\n"
        "  }\n"
        "  try {\n"
        '    if (window.localStorage.getItem(STORAGE_KEY) === "granted") {\n'
        "      ftGcLoad();\n"
        "    }\n"
        "  } catch (err) {}\n"
        '  window.addEventListener("ft-consent-granted", ftGcLoad);\n'
        "})();\n"
        "</script>"
    )


def build_traffic_strip(site: str = "") -> str:
    """Hidden footer strip markup ('' until the site URL is set).

    Starts ``hidden`` so a blocked or erroring backend degrades to nothing
    visible; ftInitStats reveals it only after a successful fetch. The
    dashboard link is attribute-escaped for defense in depth.
    """
    if not site:
        return ""
    return _TRAFFIC_STRIP_TMPL.format(stats_href=html.escape(site, quote=True))


def is_eu_timezone(tz) -> bool:
    """Approximate EU-visitor detection from an IANA timezone name.

    Mirrors the client-side heuristic embedded by build_analytics_init():
    any 'Europe/*' zone counts as EU. This is deliberately coarse — it is
    a privacy-friendly approximation, never a precise location check.
    """
    if not tz:
        return False
    return str(tz).startswith(EU_TIMEZONE_PREFIXES)


def build_consent_head(measurement_id: str) -> str:
    """Head snippet installing the gtag stub + Consent Mode v2 denied defaults."""
    if not measurement_id:
        return ""
    return _CONSENT_HEAD_JS


def build_analytics_init(
    measurement_id: str = "",
    enabled: bool | None = None,
) -> str:
    """Deferred end-of-body script: consent decision, banner, gtag loader.

    Emitted whenever any tracking is configured (#72): ``enabled`` is true
    when GA4 and/or the GoatCounter traffic counter are on, even if only
    one of them carries a measurement ID. When omitted it defaults to
    "GA4 configured", so a plain measurement ID keeps implying analytics.
    The consent runtime drives both trackers — GA4 loads only when
    MEASUREMENT_ID is set, and its grant event wakes the GoatCounter
    loader.
    """
    if enabled is None:
        enabled = bool(measurement_id)
    if not enabled:
        return ""
    return _ANALYTICS_INIT_JS.replace(
        "__FT_GA_ID__", json.dumps(measurement_id)
    ).replace("__FT_STORAGE_KEY__", CONSENT_STORAGE_KEY)


def build_banner_markup() -> str:
    """Consent banner markup ('' when analytics is disabled)."""
    return _BANNER_TMPL


def build_app_js(stats_site: str = "") -> str:
    """Client-side filter/search/sort runtime (F2/F3/F10), placeholders resolved.

    When a GoatCounter site URL is configured the live traffic module (#62)
    is spliced in ahead of the closing IIFE and hooked into ftBoot; otherwise
    that slot resolves to an empty string so unconfigured builds ship no
    stats code at all.
    """
    # The runtime's filter enums and display labels are generated from the
    # same Python constants the markup is generated from, so a new category
    # or verification level can never be renderable but unfilterable.
    tag_values = {
        "category": list(CATEGORIES),
        "verification": list(VERIFICATION_LEVELS),
        "signup": list(SIGNUP_MODES),
    }
    tag_labels = {
        "category": dict(CATEGORY_LABELS),
        "verification": dict(VERIFICATION_LABELS),
        "signup": dict(SIGNUP_LABELS),
    }
    js = (
        _APP_JS.replace("__FT_DIMENSIONS__", json.dumps(list(TAG_DIMENSIONS)))
        .replace("__FT_TAG_VALUES__", json.dumps(tag_values))
        .replace("__FT_TAG_LABELS__", json.dumps(tag_labels))
        .replace("__FT_CATEGORIES__", json.dumps(list(CATEGORIES)))
        .replace("__FT_SORTS__", json.dumps(list(SORT_MODES)))
        .replace("__FT_DEBOUNCE_MS__", str(SEARCH_DEBOUNCE_MS))
        .replace("__FT_OFFER_DEDUPE_MS__", str(OFFER_CLICK_DEDUPE_MS))
    )
    if stats_site:
        stats_boot = "    try {\n      ftInitStats();\n    } catch (err) {}"
        stats_module = (
            _STATS_JS_MODULE.replace("__FT_STATS_SITE__", json.dumps(stats_site))
        ).replace("__FT_STRIP_ID__", TRAFFIC_STRIP_ID)
    else:
        stats_boot = ""
        stats_module = ""
    return js.replace("__FT_STATS_BOOT__", stats_boot).replace(
        "__FT_STATS_MODULE__", stats_module
    )


def _foot_nav(current: str, depth: int = 0) -> str:
    """Footer nav for every page; ``current`` marks the active link.

    ``depth`` is the page's directory distance from site root (0 for
    index/archive/privacy, 1 for offers/<slug>.html) and prefixes every
    href so links stay relative and deploy-base safe.
    """
    up = "../" * depth
    return (
        _FOOT_NAV.format(
            home_href=up or "./",
            archive_href=f"{up}archive.html",
            privacy_href=f"{up}privacy.html",
            feed_href=f"{up}feed.xml",
            offers_current=' aria-current="page"' if current == "home" else "",
            archive_current=' aria-current="page"' if current == "archive" else "",
            privacy_current=' aria-current="page"' if current == "privacy" else "",
        )
        + _contact_nav()
    )


def _page_shell(
    *,
    title: str,
    meta_description: str,
    header: str,
    content: str,
    built: str,
    foot_current: str,
    css_extra: str = "",
    measurement_id: str = "",
    app_js: bool = False,
    depth: int = 0,
    stats_site: str = "",
    extra_js: str = "",
) -> str:
    """Fill the shared page chrome (head, masthead slot, footer, analytics).

    ``depth`` parameterizes relative-path resolution: root pages reference
    ./favicon.svg and feed.xml; pages under offers/ must climb one level.
    The GoatCounter beacon ships consent-gated on every page when
    configured (#72), while the traffic strip markup only appears where the
    site script (which fills it) runs — i.e. alongside ``app_js``. The
    consent banner and its runtime appear whenever *any* tracking is on;
    ``extra_js`` carries per-page scripts (offer share buttons).
    """
    built_display = (
        f'<time datetime="{html.escape(built, quote=True)}">'
        f"{_human_date(built[:10])}</time>"
    )
    rel_prefix = "../" if depth else "./"
    up = "../" * depth
    stats_on = bool(stats_site)
    tracking_on = bool(measurement_id or stats_site)
    traffic_strip = build_traffic_strip(stats_site) if stats_on and app_js else ""
    if traffic_strip:
        css_extra += _TRAFFIC_CSS
    if tracking_on:
        css_extra += _BANNER_CSS
    return _PAGE_TMPL.format(
        title=title,
        meta_description=meta_description,
        header=header,
        content=content,
        css=_CSS + css_extra,
        built_display=built_display,
        foot_nav=_foot_nav(foot_current, depth),
        ga_head=build_consent_head(measurement_id),
        banner=_BANNER_TMPL if tracking_on else "",
        ga_init=build_analytics_init(measurement_id, enabled=tracking_on),
        app_js=build_app_js(stats_site) if app_js else "",
        stats_beacon=build_stats_beacon(stats_site),
        traffic_strip=traffic_strip,
        consent_settings=_CONSENT_SETTINGS_TMPL if tracking_on else "",
        extra_js=extra_js,
        icon_sprite=_icon_sprite(),
        rss_autodiscovery=(
            '<link rel="alternate" type="application/rss+xml" '
            f'title="{html.escape(FEED_TITLE, quote=True)}" '
            f'href="{up}feed.xml">'
        ),
        favicon_href=f"{rel_prefix}favicon.svg",
    )


def active_offers(index: dict) -> list:
    """Entries a visitor may claim: everything not flagged expired (#25).

    Indexes built before v2.0 (or hand-assembled in tests) carry no status
    field; those entries default to active so the home page never hides an
    offer just because it lacks the newer flag.
    """
    return [o for o in index["offers"] if o.get("status") != "expired"]


def expired_offers(index: dict) -> list:
    """Expired entries, newest expiration first (archive order, #26)."""
    flagged = [o for o in index["offers"] if o.get("status") == "expired"]
    return sorted(
        flagged, key=lambda o: (o["expiry_date"] or "", o["slug"]), reverse=True
    )


def render_html(
    index: dict,
    measurement_id: str = "",
    stats_site: str = "",
) -> str:
    analytics = bool(measurement_id)
    # Retain-and-flag (#25): expired entries stay in the index for the
    # archive/feed but never reach the default visitor list.
    offers_active = active_offers(index)
    has_offers = bool(offers_active)
    if not has_offers:
        content = _EMPTY_TMPL
    else:
        cards = []
        # "verified 3d ago" is measured against the build's own date, so the
        # string is fixed at deploy time like every other expiry decision.
        build_day = _build_date(index["generated_at"])
        for i, o in enumerate(offers_active):
            if o["expiry_date"]:
                expiry = (
                    f'<span class="status">expires '
                    f'<time datetime="{html.escape(o["expiry_date"], quote=True)}">'
                    f"{_human_date(o['expiry_date'])}</time></span>"
                )
            else:
                expiry = (
                    '<span class="status"><span class="dot" aria-hidden="true">'
                    "</span>ongoing</span>"
                )
            verified = o["verified_date"]
            cards.append(
                _CARD_TMPL.format(
                    index=i,
                    slug=html.escape(o["slug"], quote=True),
                    category=html.escape(o["category"]),
                    verification=html.escape(o["verification"], quote=True),
                    signup=html.escape(o["signup"], quote=True),
                    category_badge=_category_badge(o["category"]),
                    verification_badge=_verification_badge(o["verification"]),
                    signup_badge=_signup_badge(o["signup"]),
                    offer_id=html.escape(o["slug"], quote=True),
                    source_url=html.escape(o["source_url"], quote=True),
                    title=html.escape(o["title"], quote=True),
                    amount=html.escape(o["amount"]),
                    provider=html.escape(o["provider"], quote=True),
                    verified_date=html.escape(verified, quote=True),
                    verified_display=_human_date(verified),
                    verified_rel=_relative_date(verified, build_day),
                    expiry_display=expiry,
                    expiry_iso=html.escape(o["expiry_date"] or "", quote=True),
                    amount_sort=f"{amount_sort_value(o['amount']):g}",
                    # Relative from site root; stays deploy-base safe under
                    # the GitHub Pages /<repo>/ project path (#60).
                    detail_href=(
                        f"{OFFERS_OUTPUT_DIRNAME}/"
                        f"{html.escape(o['slug'], quote=True)}.html"
                    ),
                )
            )
        content = (
            build_toolbar(len(offers_active))
            + _SKIP_LIST_LINK
            + '<ol class="grid" id="ft-grid" role="list">\n'
            + "\n".join(cards)
            + "\n</ol>"
            + _CLIENT_EMPTY_TMPL
        )
    built = index["generated_at"]
    return _page_shell(
        title="Free AI Credits",
        meta_description=(
            "Every currently-claimable free AI credit offer, labeled per offer "
            "with its verification level and sign-up need, on one fast page."
        ),
        header=_HOME_HEADER.format(
            count=len(offers_active),
            ongoing=sum(1 for o in offers_active if not o["expiry_date"]),
            verified=sum(
                1 for o in offers_active if o.get("verification") == "hand_verified"
            ),
        ),
        content=content,
        built=built,
        foot_current="home",
        # _HOME_CSS ships even on the empty page: it carries the masthead
        # bar, which renders with or without offers.
        css_extra=(_APP_CSS if has_offers else "")
        + _HOME_CSS
        + (_BANNER_CSS if analytics else ""),
        measurement_id=measurement_id,
        app_js=has_offers,
        stats_site=stats_site,
    )


# --- Offer archive (#26 / F11) ----------------------------------------------
#
# A static page over the expired entries retained by #25: newest expiration
# first, each with a text "Expired" badge, provider, amount, original expiry,
# category, and the outbound source link. No client-side script ships here —
# every card is plain, crawlable markup reusing the home-page card styles.

_ARCHIVE_HEADER = """<header class="masthead">
<p class="kicker">free ai credits &middot; archive</p>
<h1>Expired offer archive</h1>
<p class="tagline">Every offer that has since lapsed, kept for reference &mdash; newest expirations first. Nothing here is claimable anymore.</p>
<p class="count"><strong>{count}</strong> expired offers</p>
</header>"""

_ARCHIVED_CARD_TMPL = """<li style="--i:{index}">
<article class="card" data-category="{category}">
<div class="card-top">
{category_badge}
{verification_badge}{signup_badge}
<span class="badge badge-expired">{expired_icon}<span>Expired</span></span>
</div>
<h2 class="card-title"><a href="{source_url}" target="_blank" rel="noopener noreferrer">{title} <span class="ext" aria-hidden="true">&#8599;</span></a></h2>
<p class="amount">{amount}</p>
<p class="prov">{provider} &middot; expired <time datetime="{expiry_date}">{expiry_display}</time></p>
<div class="card-actions">
<a class="detail-btn" href="{detail_href}">View details</a>
</div>
</article>
</li>"""

_ARCHIVE_EMPTY_TMPL = """<section class="empty" style="--i:0">
<p class="glyph" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="presentation"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/></svg></p>
<h2>The archive is empty</h2>
<p>No offer has expired yet. When one does, it moves here on the next rebuild instead of vanishing.</p>
<p><a href="./">Browse the live offers</a> in the meantime.</p>
</section>"""


def render_archive_html(
    index: dict,
    measurement_id: str = "",
    stats_site: str = "",
) -> str:
    """Render site/archive.html over all entries flagged ``expired``."""
    archived = expired_offers(index)
    measurement_id = measurement_id or ""
    if archived:
        cards = []
        for i, o in enumerate(archived):
            cards.append(
                _ARCHIVED_CARD_TMPL.format(
                    index=i,
                    category=html.escape(o["category"]),
                    category_badge=_category_badge(
                        o["category"], interactive=False
                    ),
                    verification_badge=_verification_badge(
                        o["verification"], interactive=False
                    ),
                    signup_badge=_signup_badge(o["signup"], interactive=False),
                    expired_icon=_tag_icon("expired"),
                    source_url=html.escape(o["source_url"], quote=True),
                    title=html.escape(o["title"], quote=True),
                    amount=html.escape(o["amount"]),
                    provider=html.escape(o["provider"], quote=True),
                    expiry_date=html.escape(o["expiry_date"] or "", quote=True),
                    expiry_display=_human_date(o["expiry_date"])
                    if o["expiry_date"]
                    else "unknown",
                    # Expired offers keep their detail page too (#60): the
                    # archive links to the retained record, not just out.
                    detail_href=(
                        f"{OFFERS_OUTPUT_DIRNAME}/"
                        f"{html.escape(o['slug'], quote=True)}.html"
                    ),
                )
            )
        content = (
            _SKIP_LIST_LINK
            + '<ul class="grid" id="ft-archive-grid">\n'
            + "\n".join(cards)
            + "\n</ul>"
        )
    else:
        content = _ARCHIVE_EMPTY_TMPL
    return _page_shell(
        title="Offer Archive · Free AI Credits",
        meta_description=(
            "Reference archive of expired free AI credit offers, kept "
            "newest-first with their original terms."
        ),
        header=_ARCHIVE_HEADER.format(count=len(archived)),
        content=content,
        built=index["generated_at"],
        foot_current="archive",
        css_extra=(_DETAIL_CSS if archived else "")
        + (_BANNER_CSS if measurement_id else ""),
        measurement_id=measurement_id,
        stats_site=stats_site,
    )


# --- RSS feed (#27 / F12) ----------------------------------------------------
#
# A valid RSS 2.0 document emitted at build time covering every ACTIVE offer.
# Item links point at the offer's dedicated detail page (#60,
# /offers/<slug>.html); pubDate comes from the verified date. Syndication
# formats require absolute URLs, so channel/item links use --base-url while
# every in-page href elsewhere stays relative.

_RSS_CHANNEL_LINK_PATH = "/"


def _xml(text) -> str:
    """Escape a dynamic value for XML text or double-quoted attributes."""
    return html.escape(str(text), quote=True)


def _rfc2822(date_or_datetime) -> str:
    """RFC 2822 date string as required for RSS pubDate/lastBuildDate."""
    if isinstance(date_or_datetime, dt.date) and not isinstance(
        date_or_datetime, dt.datetime
    ):
        date_or_datetime = dt.datetime.combine(
            date_or_datetime, dt.time.min, tzinfo=dt.timezone.utc
        )
    elif date_or_datetime.tzinfo is None:
        date_or_datetime = date_or_datetime.replace(tzinfo=dt.timezone.utc)
    return email.utils.format_datetime(date_or_datetime)


def _parse_generated_at(generated_at: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    return parsed


def _feed_item_description(offer: dict) -> str:
    """Amount/category/expiry summary line used as the item description."""
    label = CATEGORY_LABELS.get(offer["category"], offer["category"])
    if offer["expiry_date"]:
        expiry = f"expires {_human_date(offer['expiry_date'])}"
    else:
        expiry = "ongoing"
    return f"{offer['amount']} — {label} · {expiry}."


def build_feed(index: dict, base_url: str) -> str:
    """Render the RSS 2.0 document for every active offer in ``index``.

    Expired entries are excluded; null-expiry offers are included normally.
    Items are ordered newest-verified-first with slug as the stable tiebreak.
    """
    base = base_url.strip().rstrip("/")
    items = []
    for o in sorted(
        active_offers(index),
        key=lambda o: (o["verified_date"], o["slug"]),
        reverse=True,
    ):
        anchor = f"{base}/{OFFERS_OUTPUT_DIRNAME}/{_xml(o['slug'])}.html"
        items.append(
            "<item>"
            f"<title>{_xml(o['title'])}</title>"
            f"<link>{anchor}</link>"
            f'<guid isPermaLink="true">{anchor}</guid>'
            f"<description>{_xml(_feed_item_description(o))}</description>"
            f"<pubDate>{_rfc2822(_parse_generated_at(o['verified_date']))}</pubDate>"
            "</item>"
        )
    last_build = _rfc2822(_parse_generated_at(index["generated_at"]))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
        "<channel>\n"
        f"<title>{_xml(FEED_TITLE)}</title>\n"
        f"<link>{_xml(base + '/')}</link>\n"
        f"<description>{_xml(FEED_DESCRIPTION)}</description>\n"
        "<language>en</language>\n"
        f"<lastBuildDate>{last_build}</lastBuildDate>\n"
        "<generator>freetokens static build</generator>\n"
        '<atom:link href="' + _xml(base + "/feed.xml") + '" '
        'rel="self" type="application/rss+xml" />\n'
        + "".join(items)
        + "\n</channel>\n</rss>\n"
    )


# --- Privacy policy (Task 3.5 / PRD §5.2) -----------------------------------
#
# Plain-language policy generated alongside the home page so it always shares
# the site chrome and stays honest about what scripts/build.py actually does:
# consent-gated GA4, anonymized IPs, length-only search metadata, no forms,
# no PII storage. Every factual claim here mirrors the implemented behavior.

_PRIVACY_HEADER = """<header class="masthead">
<p class="kicker">free ai credits</p>
<h1>Privacy Policy</h1>
<p class="tagline">The short version: this is a static page that stores almost nothing about you &mdash; and asks before it counts your visit.</p>
</header>"""

_PRIVACY_CONTENT = """<div class="policy">
<section class="summary" aria-labelledby="privacy-summary">
<h2 id="privacy-summary">In short</h2>
<ul>
<li>No accounts, no forms, no logins &mdash; we have nowhere to store personal details.</li>
<li>If visit-counting is switched on, it runs through Google Analytics 4 with IP anonymization &mdash; and only after you allow it in the consent banner shown on your first visit.</li>
<li>If the live traffic counter is switched on, page views are recorded cookie-free by <a href="https://www.goatcounter.com" rel="noopener noreferrer">GoatCounter</a> and shown as anonymous totals on this site.</li>
<li>Your raw search text is <strong>never</strong> collected &mdash; only how many characters you typed.</li>
<li>The only thing this site saves on your device is a single-word remember of your cookie choice.</li>
<li>You can block all of it with an ad blocker and every feature still works.</li>
</ul>
</section>

<section aria-labelledby="privacy-what-this-is">
<h2 id="privacy-what-this-is">What this site is</h2>
<p>This site is a hand-built static page: a fixed HTML file served from GitHub Pages. There are no user accounts, no comment forms, no newsletter sign-ups, and no server-side database. Nothing about you is written down on our side &mdash; we couldn't store your name or email address even by accident, because v1.0 has no form that could submit them.</p>
</section>

<section aria-labelledby="privacy-analytics">
<h2 id="privacy-analytics">What the analytics measure</h2>
<p>To learn which offers people find useful, the site can count visits with Google Analytics 4 (GA4). This is off entirely unless the site owner has configured a measurement ID at build time &mdash; if it is not configured, no analytics code exists on the page at all.</p>
<p>When counting <em>is</em> active and you have allowed it, GA4 records:</p>
<ul>
<li><strong>Page views</strong> &mdash; which page you viewed (the path only; anything after <code>?</code> in the address is removed before sending).</li>
<li><strong>Anonymized IP addresses</strong> &mdash; the last octet of your IP is zeroed out by IP anonymization, so we never see your full address.</li>
<li><strong>Coarse technical metadata</strong> &mdash; things like browser family, screen size buckets, and approximate region derived from the anonymized IP.</li>
<li><strong>Which filter category you picked</strong> (for example &ldquo;Image&rdquo;) &mdash; nothing else about your filtering.</li>
<li><strong>Which sort option you picked</strong> (for example &ldquo;Expiring soon&rdquo;) &mdash; nothing else about your sorting.</li>
<li><strong>Search activity as a length only</strong> &mdash; when you search, the event records just <code>query_length</code>, the number of characters typed. The words themselves stay in your browser and are never sent anywhere.</li>
<li><strong>Offer clicks</strong> &mdash; which listing you clicked (its ID, provider name, and category).</li>
<li><strong>Share actions</strong> &mdash; when you use a share button on an offer page, the offer's ID and which channel you picked (for example &ldquo;linkedin&rdquo; or &ldquo;copy&rdquo;). The share itself happens between you and that platform.</li>
</ul>
</section>

<section aria-labelledby="privacy-live-traffic">
<h2 id="privacy-live-traffic">What the site traffic counter measures</h2>
<p>Separately from GA4, the site can show visit totals in its footer &mdash; the numbers you may see next to &ldquo;site traffic&rdquo;. They are a rough popularity signal rather than a live readout: GoatCounter caches the totals, so they can lag the real figure by a few hours. Counting is done by <strong>GoatCounter</strong>, open-source software provided as a hosted service (goatcounter.com) under the EU's strict GDPR rules. Like GA4 above, it is off entirely unless configured at build time &mdash; and its counting script is not loaded until you allow tracking.</p>
<p>When it <em>is</em> active, each page view records only technical, non-identifying details: the page path, the site's hostname, your browser's reported language and user-agent string, a coarse country derived from the IP at request time and then discarded, and the referring site. GoatCounter sets <strong>no cookies</strong>, uses no browser fingerprinting, and stores no personal identifiers or full IP addresses. Only anonymous aggregate totals are shown publicly on this site; nobody can browse individual visits.</p>
<p>Blocking the counter with an ad blocker changes nothing else: pages, filters, and links all keep working exactly the same, and the footer totals simply stay hidden.</p>
</section>

<section aria-labelledby="privacy-consent">
<h2 id="privacy-consent">Consent, cookies, and local storage</h2>
<p>Analytics starts from a denied state inside your browser: no counting code is loaded until permission exists. Every first-time visitor sees a small banner asking &ldquo;Allow?&rdquo; &mdash; declining means zero tracking requests leave your browser, and allowing is what switches GA4 (and the GoatCounter counter, when enabled) on.</p>
<p>Your answer is remembered in your browser's local storage under the key <code>ft_ga_consent</code> as one word: <code>granted</code> or <code>denied</code>. That single word is the only data this site itself ever writes on your device &mdash; the site sets no cookies of its own. Once you allow counting, Google Analytics may set its own cookies (such as <code>_ga</code>) to tell repeat visits apart; those cookies belong to Google and follow Google's rules.</p>
<p>Changed your mind? Use the <strong>Cookie settings</strong> link in the footer of any page to re-open the banner and switch your choice at any time.</p>
</section>

<section aria-labelledby="privacy-third-parties">
<h2 id="privacy-third-parties">Who else receives data</h2>
<ul>
<li><strong>Google LLC</strong> processes the analytics data under the <a href="https://policies.google.com/privacy" rel="noopener noreferrer">Google Privacy Policy</a> and Google Analytics' own terms (<a href="https://support.google.com/analytics/answer/6004245" rel="noopener noreferrer">how Google uses data from sites like this one</a>).</li>
<li><strong>GoatCounter (goatcounter.com)</strong> counts the live-traffic page views described above on our behalf when the traffic counter is switched on; its own terms apply (<a href="https://www.goatcounter.com/privacy" rel="noopener noreferrer">GoatCounter privacy policy</a>).</li>
<li><strong>Google Fonts</strong> serves the typefaces this page displays; loading them is a plain request from your browser to Google's servers.</li>
<li><strong>Offer providers</strong> &mdash; clicking an offer takes you to a third-party website. Once you are there, that company's privacy policy applies, not this one.</li>
</ul>
</section>

<section aria-labelledby="privacy-never">
<h2 id="privacy-never">What we never do</h2>
<ul>
<li>We never sell, rent, or trade data &mdash; there is no ad business on this site.</li>
<li>We never collect your name, email, or any identifier tied to you personally.</li>
<li>We never collect the text you type into search.</li>
</ul>
</section>

<section aria-labelledby="privacy-choices">
<h2 id="privacy-choices">Your choices</h2>
<ul>
<li><strong>Decline or accept</strong> the banner shown on your first visit; press <kbd>Escape</kbd> to decline it.</li>
<li><strong>Change your mind anytime</strong> via the footer's <strong>Cookie settings</strong> link &mdash; it re-opens the banner on every page, even after you already answered.</li>
<li><strong>Block everything</strong> with an ad blocker or your browser's tracking protection. The site degrades silently: every offer, filter, and link keeps working exactly the same.</li>
</ul>
</section>

<section aria-labelledby="privacy-changes">
<h2 id="privacy-changes">Changes and contact</h2>
<p>If the site's data practices change, this page will change with them &mdash; it is rebuilt together with the site on every update.</p>
<p>Questions or concerns? <a href="https://github.com/luongnv89/freetokens/issues" rel="noopener noreferrer">Open an issue on GitHub</a>.</p>
</section>
</div>"""


def render_privacy_html(
    built: str,
    measurement_id: str = "",
    stats_site: str = "",
) -> str:
    """Render the standalone privacy policy page sharing the site chrome."""
    return _page_shell(
        title="Privacy Policy · Free AI Credits",
        meta_description=(
            "How the Free AI Credits site handles data: consent-gated "
            "anonymized analytics, no forms, no personal data storage."
        ),
        header=_PRIVACY_HEADER,
        content=_PRIVACY_CONTENT,
        built=built,
        foot_current="privacy",
        css_extra=(_BANNER_CSS if measurement_id else ""),
        measurement_id=measurement_id,
        stats_site=stats_site,
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offers-dir", default="offers")
    parser.add_argument("--out", default=".")
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help="absolute site origin used for RSS channel/item links "
        "(defaults to the production Pages URL)",
    )
    args = parser.parse_args(argv)

    try:
        offers = load_offers(args.offers_dir)
    except OfferError as exc:
        print(f"build failed: {exc}", file=sys.stderr)
        return 1
    if not offers:
        print(
            f"build failed: no offer files found in {args.offers_dir}", file=sys.stderr
        )
        return 1

    try:
        details = load_details(args.offers_dir, {o["slug"] for o in offers})
    except OfferError as exc:
        print(f"build failed: {exc}", file=sys.stderr)
        return 1

    # Retain-and-flag (#25): index.json keeps every offer with a build-time
    # status; the home page renders only active entries, the archive only
    # expired ones, and the feed only active ones.
    index = build_index(offers)

    measurement_id = get_measurement_id()
    stats_site = get_traffic_stats_site()

    out_dir = os.path.join(args.out, "site")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(render_html(index, measurement_id, stats_site))
    with open(os.path.join(out_dir, "archive.html"), "w", encoding="utf-8") as fh:
        fh.write(render_archive_html(index, measurement_id, stats_site))
    with open(os.path.join(out_dir, "privacy.html"), "w", encoding="utf-8") as fh:
        fh.write(render_privacy_html(index["generated_at"], measurement_id, stats_site))
    with open(os.path.join(out_dir, "favicon.svg"), "w", encoding="utf-8") as fh:
        fh.write(_FAVICON_SVG)
    with open(os.path.join(out_dir, "feed.xml"), "w", encoding="utf-8") as fh:
        fh.write(build_feed(index, args.base_url))

    # Dedicated detail pages (#60): one per offer — active AND expired, so
    # archive rows resolve too. Detail documents are optional; offers
    # without one render the fallback claim steps.
    offers_out = os.path.join(out_dir, OFFERS_OUTPUT_DIRNAME)
    os.makedirs(offers_out, exist_ok=True)
    for entry in index["offers"]:
        page_path = os.path.join(offers_out, f"{entry['slug']}.html")
        with open(page_path, "w", encoding="utf-8") as fh:
            fh.write(
                render_offer_html(
                    entry,
                    details.get(entry["slug"]),
                    index["generated_at"],
                    measurement_id,
                    stats_site,
                    base_url=args.base_url,
                )
            )

    # Orphan-detail validation extended (#60): the build fails loudly unless
    # every offer yielded its page file.
    missing_pages = [
        o["slug"]
        for o in index["offers"]
        if not os.path.isfile(
            os.path.join(out_dir, OFFERS_OUTPUT_DIRNAME, f"{o['slug']}.html")
        )
    ]
    if missing_pages:
        print(
            "build failed: no detail page emitted for: " + ", ".join(missing_pages),
            file=sys.stderr,
        )
        return 1

    note = f" (analytics: {measurement_id})" if measurement_id else ""
    if stats_site:
        note += f" (live traffic stats: {stats_site})"
    print(
        f"built {index['count']} offers ({index['active_count']} active, "
        f"{index['expired_count']} expired) -> index.json, site/index.html, "
        "site/archive.html, site/privacy.html, site/favicon.svg, "
        f"site/feed.xml, site/{OFFERS_OUTPUT_DIRNAME}/*.html{note}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
