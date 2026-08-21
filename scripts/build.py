#!/usr/bin/env python3
"""Static build for freetokens: validate offers, emit index.json and HTML.

Stdlib-only by design (ADR 001). Usage:

    python3 scripts/build.py [--offers-dir offers] [--out .]
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import html
import json
import os
import re
import sys

CATEGORIES = ("api_provider", "coding", "image", "voice", "video")
CATEGORY_LABELS = {
    "api_provider": "API providers",
    "coding": "Coding",
    "image": "Image",
    "voice": "Voice",
    "video": "Video",
}
# Search input debounce: settling delay before a keystroke batch filters the
# list, updates the URL, and fires analytics. Must stay well under the PRD's
# 200 ms perceived-latency budget (F3).
SEARCH_DEBOUNCE_MS = 120
# Rapid re-click suppression for offer_click (F6): a second click on the same
# offer within this window is treated as an accidental double-click, not a
# second attribution event. Distinct offers are never suppressed.
OFFER_CLICK_DEDUPE_MS = 1000
REQUIRED_FIELDS = (
    "title",
    "provider",
    "category",
    "amount",
    "expiry_date",
    "source_url",
    "verified_date",
)
NULL_TOKENS = {"null", "~", ""}

# --- Analytics configuration (F7) -----------------------------------------
# GA4 is opt-in at build time: the measurement ID comes from the
# GA_MEASUREMENT_ID environment variable. When it is unset (or malformed)
# NO tracking code, consent banner, or analytics script is emitted at all.
MEASUREMENT_ID_ENV_VAR = "GA_MEASUREMENT_ID"
MEASUREMENT_ID_RE = re.compile(r"^G-[A-Z0-9]{6,12}$")
CONSENT_STORAGE_KEY = "ft_ga_consent"
EU_TIMEZONE_PREFIXES = ("Europe/",)


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


def filter_expired(offers: list, today: dt.date | None = None) -> list:
    """Drop offers whose expiry_date is in the past; None means ongoing."""
    if today is None:
        today = dt.date.today()
    return [o for o in offers if o["expiry_date"] is None or o["expiry_date"] >= today]


def build_index(offers: list) -> dict:
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "count": len(offers),
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
            }
            for o in sorted(offers, key=lambda o: o["slug"])
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

.badge {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border: 1px solid var(--ink);
  border-radius: 999px;
  padding: 0.14rem 0.6rem;
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
{ga_head}
<style>
{css}
</style>
</head>
<body>
<div class="wrap">
{header}
<main>
{content}
</main>
<footer class="foot">
<p>Built {built_display} &middot; offers re-verified on every change</p>
{foot_nav}
</footer>
</div>
{banner}
{ga_init}
{app_js}
</body>
</html>
"""

_HOME_HEADER = """<header class="masthead">
<p class="kicker">hand-verified &middot; zero runtime &middot; no sign-up walls</p>
<h1>Free AI Credits</h1>
<p class="tagline">Every claimable free-credit offer worth your time, on one fast page. Checked by hand, refreshed on every rebuild.</p>
<p class="count"><strong>{count}</strong> live offers</p>
</header>"""

# Footer nav shared by every page. Links stay relative so they resolve under
# any deploy base (e.g. the GitHub Pages /<repo>/ project path). The current
# page is marked aria-current for assistive tech.
_FOOT_NAV = """<nav class="foot-nav" aria-label="Site">\
<a href="./"{offers_current}>Offers</a><span aria-hidden="true">&middot;</span>\
<a href="privacy.html"{privacy_current}>Privacy policy</a></nav>"""

_CARD_TMPL = """<li style="--i:{index}">
<article class="card" data-category="{category}">
<div class="card-top">
<span class="badge">{category}</span>
{expiry_display}
</div>
<h2 class="card-title"><a href="{source_url}" target="_blank" rel="noopener noreferrer" data-ft-offer-id="{offer_id}" data-ft-provider="{provider}" data-ft-offer-category="{category}" aria-label="Claim {title} from {provider}">{title} <span class="ext" aria-hidden="true">&#8599;</span></a></h2>
<p class="amount">{amount}</p>
<p class="prov">{provider} &middot; verified <time datetime="{verified_date}">{verified_display}</time></p>
</article>
</li>"""

_EMPTY_TMPL = """<section class="empty" style="--i:0">
<p class="glyph" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="presentation"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8"/><path d="M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8"/></svg></p>
<h2>No live offers right now</h2>
<p>Every listing here is checked by hand against the provider, and none have passed the check at the moment.</p>
<p>New and renewed offers appear automatically after the next rebuild &mdash; check back soon.</p>
</section>"""


def _human_date(iso: str) -> str:
    """Render a YYYY-MM-DD string as e.g. 'Dec 31, 2026'."""
    day = dt.datetime.strptime(iso, "%Y-%m-%d").date()
    return f"{day.strftime('%b')} {day.day}, {day.year}"


# --- Client-side discovery (F2/F3): category filter + text search ----------
#
# The toolbar is emitted whenever the page has offers. All narrowing happens
# client-side over cards already in the DOM: no reload, no network fetch.
# State lives in the URL (?category=, ?q=) so any view is shareable and the
# back/forward buttons work (PRD §6.2).

_CHIP = (
    '<button type="button" class="chip" data-ft-category="{value}" '
    'aria-pressed="{pressed}">{label}</button>'
)


def build_toolbar(count: int | None = None) -> str:
    """Search box + All/five-category chips, keyboard-navigable by default.

    ``count`` seeds the live-region status line so the pre-JS paint already
    shows a truthful result count.
    """
    chips = [_CHIP.format(value="", pressed="true", label="All")]
    for category in CATEGORIES:
        chips.append(
            _CHIP.format(
                value=html.escape(category, quote=True),
                pressed="false",
                label=CATEGORY_LABELS.get(category, category),
            )
        )
    seeded = (
        f"Showing all {count} offers" if count is not None else ""
    )
    return (
        '<section class="toolbar" aria-label="Search and filter offers">'
        '<div class="field">'
        '<label class="tool-label" for="ft-search">Search</label>'
        '<input type="search" id="ft-search" name="q" '
        'placeholder="Search title, provider, or amount&hellip;" '
        'autocomplete="off" spellcheck="false" maxlength="200">'
        "</div>"
        '<div class="chips" role="group" aria-label="Filter by category">'
        + "".join(chips)
        + "</div>"
        '<p class="results-status" id="ft-results-status" role="status" '
        f'aria-live="polite">{seeded}</p>'
        "</section>"
    )


_CLIENT_EMPTY_TMPL = """<section class="empty" id="ft-no-results" hidden>
<p class="glyph" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="presentation"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/><path d="M8.5 11h5"/></svg></p>
<h2>No matching offers</h2>
<p>Nothing matches your current search and category combination.</p>
<button type="button" class="chip reset" id="ft-reset-filters">Clear search &amp; filters</button>
</section>"""


# --- Analytics (F7): consent-gated GA4 with EU banner ----------------------
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
  var EU_PREFIXES = __FT_EU_PREFIXES__;
  var STORAGE_KEY = "__FT_STORAGE_KEY__";
  // Consent-gated event bus for feature events (filter_use, search).
  // Stays false until an explicit grant; window.ftTrackEvent is the only
  // door page features knock on, so declined/absent analytics no-ops.
  var TRACKING_ACTIVE = false;
  function ftTrackEvent(name, params) {
    if (!TRACKING_ACTIVE || typeof gtag !== "function") { return; }
    gtag("event", name, params);
  }
  window.ftTrackEvent = ftTrackEvent;
  function ftIsEuTimeZone(tz) {
    if (!tz) { return false; }
    for (var i = 0; i < EU_PREFIXES.length; i++) {
      if (tz.indexOf(EU_PREFIXES[i]) === 0) { return true; }
    }
    return false;
  }
  function ftTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (err) {
      return null;
    }
  }
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
    if (typeof window.gtag !== "function") { return; }
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
    if (typeof window.gtag !== "function") { return; }
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
    if (accept) { accept.addEventListener("click", ftAccept); }
    if (reject) { reject.addEventListener("click", ftReject); }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var b = document.getElementById("ft-consent-banner");
        if (b && !b.hidden) { ftReject(); }
      }
    });
  }
  function ftInit() {
    var stored = ftStoredDecision();
    if (stored === "granted") { ftGrant(); return; }
    if (stored === "denied") { ftDecline(); return; }
    ftWire();
    if (ftIsEuTimeZone(ftTimezone())) {
      ftShowBanner();
    } else {
      ftGrant();
    }
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
<p class="consent-text">This site uses Google Analytics 4 with IP anonymization to count visits and see which offers help people. Allow?</p>
<div class="consent-actions">
<button type="button" id="ft-consent-accept">Accept</button>
<button type="button" id="ft-consent-decline">Decline</button>
</div>
</div>"""

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
"""

_APP_CSS = """
/* ---- Toolbar: search + category filter (F2/F3) ------------------------- */

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem 1.5rem;
  margin: 0 0 1.25rem;
}

.field { display: flex; flex-direction: column; gap: 0.35rem; flex: 1 1 16rem; }

.tool-label {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--gray);
}

#ft-search {
  font: inherit;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--ink);
  border-radius: 999px;
  padding: 0.55rem 1rem;
  max-width: 24rem;
  width: 100%;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.chip {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  padding: 0.42rem 0.95rem;
  border-radius: 999px;
  border: 1px solid var(--ink);
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}

.chip:hover { background: var(--ink); color: var(--paper); }

/* Visible keyboard focus must not depend on the analytics stylesheet
   (_BANNER_CSS ships only when GA4 is configured). */
.chip:focus-visible,
#ft-search:focus-visible {
  outline: 3px solid var(--ink);
  outline-offset: 3px;
}

.chip[aria-pressed="true"] { background: var(--ink); color: var(--paper); }

.results-status {
  flex-basis: 100%;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  color: var(--gray);
  margin: 0;
}

/* Hidden list items must leave the grid layout entirely. */
.grid li[hidden] { display: none; }

.empty .chip.reset { margin-top: 0.75rem; }
"""

# Client-side discovery runtime. Vanilla ES5-style IIFE, emitted inline so
# the page stays a single self-contained file with zero framework/runtime.
# Analytics calls go through window.ftTrackEvent, which only exists when GA4
# is build-time configured AND consent was granted — absent or declined, the
# calls are silent no-ops and every feature keeps working (PRD §4.1).
_APP_JS = """<script id="ft-app">
(function () {
  "use strict";
  var VALID_CATEGORIES = __FT_CATEGORIES__;
  var DEBOUNCE_MS = __FT_DEBOUNCE_MS__;
  var OFFER_DEDUPE_MS = __FT_OFFER_DEDUPE_MS__;

  function ftNormalize(value) {
    return (value || "").toLowerCase();
  }

  function ftParseState(search) {
    var params = new URLSearchParams(search || "");
    var category = params.get("category") || "";
    if (VALID_CATEGORIES.indexOf(category) === -1) { category = ""; }
    return { category: category, q: (params.get("q") || "").trim() };
  }

  function ftSerializeState(state) {
    // Whitelist-only: unknown params are dropped, matching the analytics
    // privacy stance of never persisting arbitrary query strings.
    var params = new URLSearchParams();
    if (state.category) { params.set("category", state.category); }
    if (state.q) { params.set("q", state.q); }
    return params.toString();
  }

  // AND semantics: an offer is shown only when it satisfies BOTH the active
  // category filter and the search query.
  function ftMatches(li, state) {
    var card = li.querySelector("[data-category]");
    if (!card) { return false; }
    if (state.category && card.getAttribute("data-category") !== state.category) {
      return false;
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
    if (!grid || !input || !status) { return; }
    var items = Array.prototype.slice.call(grid.querySelectorAll("li"));
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

    function syncControls() {
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
    }

    function apply(options) {
      options = options || {};
      var shown = 0;
      for (var i = 0; i < items.length; i++) {
        var li = items[i];
        var show = ftMatches(li, state);
        li.hidden = !show;
        if (show) { shown++; }
      }
      status.textContent = shown === total
        ? "Showing all " + total + " offers"
        : "Showing " + shown + " of " + total + " offers";
      if (emptyBox) { emptyBox.hidden = shown !== 0; }
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
        ftTrack("filter_use", { category: state.category || "all" });
      } else if (source === "search" && state.q) {
        // Privacy: length only — the raw term never reaches analytics.
        ftTrack("search", { query_length: state.q.length });
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

    if (resetButton) {
      resetButton.addEventListener("click", function () {
        state.category = "";
        state.q = "";
        input.value = "";
        commit("filter");
      });
    }

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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ftBoot);
  } else {
    ftBoot();
  }
})();
</script>"""


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


def build_analytics_init(measurement_id: str) -> str:
    """Deferred end-of-body script: consent decision, EU banner, gtag loader."""
    if not measurement_id:
        return ""
    return (
        _ANALYTICS_INIT_JS.replace("__FT_GA_ID__", json.dumps(measurement_id))
        .replace("__FT_EU_PREFIXES__", json.dumps(list(EU_TIMEZONE_PREFIXES)))
        .replace("__FT_STORAGE_KEY__", CONSENT_STORAGE_KEY)
    )


def build_banner_markup() -> str:
    """Consent banner markup ('' when analytics is disabled)."""
    return _BANNER_TMPL


def build_app_js() -> str:
    """Client-side filter/search runtime (F2/F3), placeholders resolved."""
    return _APP_JS.replace(
        "__FT_CATEGORIES__", json.dumps(list(CATEGORIES))
    ).replace("__FT_DEBOUNCE_MS__", str(SEARCH_DEBOUNCE_MS)).replace(
        "__FT_OFFER_DEDUPE_MS__", str(OFFER_CLICK_DEDUPE_MS)
    )


def _foot_nav(current: str) -> str:
    """Footer nav for every page; ``current`` marks the active link."""
    return _FOOT_NAV.format(
        offers_current=' aria-current="page"' if current == "home" else "",
        privacy_current=' aria-current="page"' if current == "privacy" else "",
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
) -> str:
    """Fill the shared page chrome (head, masthead slot, footer, analytics)."""
    built_display = (
        f'<time datetime="{html.escape(built, quote=True)}">'
        f'{_human_date(built[:10])}</time>'
    )
    return _PAGE_TMPL.format(
        title=title,
        meta_description=meta_description,
        header=header,
        content=content,
        css=_CSS + css_extra,
        built_display=built_display,
        foot_nav=_foot_nav(foot_current),
        ga_head=build_consent_head(measurement_id),
        banner=_BANNER_TMPL if measurement_id else "",
        ga_init=build_analytics_init(measurement_id),
        app_js=build_app_js() if app_js else "",
    )


def render_html(index: dict, measurement_id: str = "") -> str:
    analytics = bool(measurement_id)
    has_offers = bool(index["offers"])
    if not has_offers:
        content = _EMPTY_TMPL
    else:
        cards = []
        for i, o in enumerate(index["offers"]):
            if o["expiry_date"]:
                expiry = (
                    f'<span class="status">expires '
                    f'<time datetime="{html.escape(o["expiry_date"], quote=True)}">'
                    f'{_human_date(o["expiry_date"])}</time></span>'
                )
            else:
                expiry = (
                    '<span class="status"><span class="dot" aria-hidden="true">'
                    '</span>ongoing</span>'
                )
            verified = o["verified_date"]
            cards.append(
                _CARD_TMPL.format(
                    index=i,
                    category=html.escape(o["category"]),
                    offer_id=html.escape(o["slug"], quote=True),
                    source_url=html.escape(o["source_url"], quote=True),
                    title=html.escape(o["title"], quote=True),
                    amount=html.escape(o["amount"]),
                    provider=html.escape(o["provider"], quote=True),
                    verified_date=html.escape(verified, quote=True),
                    verified_display=_human_date(verified),
                    expiry_display=expiry,
                )
            )
        content = (
            build_toolbar(index["count"])
            + '<ul class="grid" id="ft-grid">\n'
            + "\n".join(cards)
            + "\n</ul>"
            + _CLIENT_EMPTY_TMPL
        )
    built = index["generated_at"]
    return _page_shell(
        title="Free AI Credits",
        meta_description=(
            "Every currently-claimable free AI credit offer, hand-verified, "
            "on one fast page."
        ),
        header=_HOME_HEADER.format(count=index["count"]),
        content=content,
        built=built,
        foot_current="home",
        css_extra=(_APP_CSS if has_offers else "")
        + (_BANNER_CSS if analytics else ""),
        measurement_id=measurement_id,
        app_js=has_offers,
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
<li>If visit-counting is switched on, it runs through Google Analytics 4 with IP anonymization.</li>
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
<li><strong>Search activity as a length only</strong> &mdash; when you search, the event records just <code>query_length</code>, the number of characters typed. The words themselves stay in your browser and are never sent anywhere.</li>
<li><strong>Offer clicks</strong> &mdash; which listing you clicked (its ID, provider name, and category).</li>
</ul>
</section>

<section aria-labelledby="privacy-consent">
<h2 id="privacy-consent">Consent, cookies, and local storage</h2>
<p>Analytics starts from a denied state inside your browser: the measurement code is not even loaded until permission exists. Visitors whose browser time zone indicates they are likely in the EU see a small banner asking &ldquo;Allow?&rdquo; first &mdash; declining means zero tracking requests leave your browser. Elsewhere, visits are counted without showing the banner, matching the site's regional default; a previously recorded refusal is always honored.</p>
<p>Your answer is remembered in your browser's local storage under the key <code>ft_ga_consent</code> as one word: <code>granted</code> or <code>denied</code>. That single word is the only data this site itself ever writes on your device &mdash; the site sets no cookies of its own. Once you allow counting, Google Analytics may set its own cookies (such as <code>_ga</code>) to tell repeat visits apart; those cookies belong to Google and follow Google's rules.</p>
</section>

<section aria-labelledby="privacy-third-parties">
<h2 id="privacy-third-parties">Who else receives data</h2>
<ul>
<li><strong>Google LLC</strong> processes the analytics data under the <a href="https://policies.google.com/privacy" rel="noopener noreferrer">Google Privacy Policy</a> and Google Analytics' own terms (<a href="https://support.google.com/analytics/answer/6004245" rel="noopener noreferrer">how Google uses data from sites like this one</a>).</li>
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
<li><strong>Decline or accept</strong> the banner when it appears; press <kbd>Escape</kbd> to decline it.</li>
<li><strong>Change your mind later</strong> by clearing your browser's site data for this site &mdash; the next visit starts fresh.</li>
<li><strong>Block everything</strong> with an ad blocker or your browser's tracking protection. The site degrades silently: every offer, filter, and link keeps working exactly the same.</li>
</ul>
</section>

<section aria-labelledby="privacy-changes">
<h2 id="privacy-changes">Changes and contact</h2>
<p>If the site's data practices change, this page will change with them &mdash; it is rebuilt together with the site on every update.</p>
<p>Questions or concerns? <a href="https://github.com/luongnv89/freetokens/issues" rel="noopener noreferrer">Open an issue on GitHub</a>.</p>
</section>
</div>"""


def render_privacy_html(built: str, measurement_id: str = "") -> str:
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
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offers-dir", default="offers")
    parser.add_argument("--out", default=".")
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

    index = build_index(filter_expired(offers))

    measurement_id = get_measurement_id()

    out_dir = os.path.join(args.out, "site")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(render_html(index, measurement_id))
    with open(os.path.join(out_dir, "privacy.html"), "w", encoding="utf-8") as fh:
        fh.write(render_privacy_html(index["generated_at"], measurement_id))

    note = f" (analytics: {measurement_id})" if measurement_id else ""
    print(
        f"built {index['count']} offers -> index.json, site/index.html, "
        f"site/privacy.html{note}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
