#!/usr/bin/env python3
"""Frozen offer content model for freetokens (schema + validation).

This is the parser/validator core of the retired Python static builder
(``scripts/build.py``, decommissioned by #139 after the v3.0 React cutover),
extracted verbatim so the CI content gate keeps enforcing the exact same
rules. It owns the offer schema constants, YAML parsing, and validation —
it renders no HTML. Stdlib-only by design (ADR 001).
"""

from __future__ import annotations

import datetime as dt
import glob
import json
import os
import re

CATEGORIES = ("api_provider", "coding", "image", "voice", "video", "startup_program")
CATEGORY_LABELS = {
    "api_provider": "API providers",
    "coding": "Coding",
    "image": "Image",
    "voice": "Voice",
    "video": "Video",
    "startup_program": "Startup programs",
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
    "review_status",
    "signup",
)
# Per-offer honesty tags (#97): the site no longer claims blanket
# verification / no-sign-up status. Every offer states exactly how its
# listing was checked and whether claiming needs an account.
VERIFICATION_LEVELS = ("social_proof", "unverified")
REVIEW_STATUSES = ("verified", "unverified", "under-review")
REVIEW_STATUS_LABELS = {
    "verified": "verified",
    "unverified": "unverified",
    "under-review": "under review",
}
VERIFICATION_LABELS = {
    "social_proof": "social proof",
    "unverified": "unverified",
}
# Tooltip copy spells out what each level means — the badge word alone must
# never be the only explanation (same principle as the Expired badge).
VERIFICATION_TITLES = {
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
    "startup_program": ("#a21caf", 6.33),
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
    "startup_program": '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>'
    '<path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>'
    '<path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>'
    '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    # Verification: how hard the listing was CHECKED. The glyphs form their
    # own ladder -- hearsay bubble, open question.
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

    if data["review_status"] not in REVIEW_STATUSES:
        raise OfferError(
            f"{filename}: review_status must be one of "
            f"{'|'.join(REVIEW_STATUSES)}, got {data['review_status']!r}"
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


def _yaml_paths(offers_dir: str) -> list:
    """Yield .yaml/.yml paths from offers_dir and any subdirectories."""
    entries = os.listdir(offers_dir)
    paths = sorted(
        os.path.join(offers_dir, f)
        for f in entries
        if f.endswith(".yaml") or f.endswith(".yml")
    )
    for entry in sorted(entries):
        full = os.path.join(offers_dir, entry)
        if os.path.isdir(full) and entry not in (".", "..", DETAILS_DIRNAME):
            for sub in _yaml_paths(full):
                paths.append(sub)
    return paths


def load_offers(offers_dir: str) -> list:
    paths = _yaml_paths(offers_dir)
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


def _json_paths(details_dir: str) -> list:
    """Yield .json paths from details_dir and any subdirectories."""
    if not os.path.isdir(details_dir):
        return []
    entries = os.listdir(details_dir)
    paths = sorted(
        os.path.join(details_dir, f)
        for f in entries
        if f.endswith(".json") and os.path.isfile(os.path.join(details_dir, f))
    )
    for entry in sorted(entries):
        full = os.path.join(details_dir, entry)
        if os.path.isdir(full) and entry not in (".", ".."):
            for sub in _json_paths(full):
                paths.append(sub)
    return paths


def load_details(offers_dir: str, valid_slugs) -> dict:
    """Load offers/details/<slug>.json keyed by slug; {} when none exist.

    Orphan files (no matching offers/*.yaml slug) are a build error so a
    renamed or deleted offer can never leave stale detail content behind.
    """
    details_dir = os.path.join(offers_dir, DETAILS_DIRNAME)
    paths = _json_paths(details_dir)
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
                "review_status": o["review_status"],
                "signup": o["signup"],
                "status": o["status"],
            }
            for o in stamped
        ],
    }


# Page CSS lives in its own constant so the stylesheet can use single braces;
# it is substituted into _PAGE_TMPL as a format *value*, never re-scanned.
