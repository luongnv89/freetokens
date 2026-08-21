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
<meta name="description" content="Every currently-claimable free AI credit offer, hand-verified, on one fast page.">
<title>Free AI Credits</title>
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
<header class="masthead">
<p class="kicker">hand-verified &middot; zero runtime &middot; no sign-up walls</p>
<h1>Free AI Credits</h1>
<p class="tagline">Every claimable free-credit offer worth your time, on one fast page. Checked by hand, refreshed on every rebuild.</p>
<p class="count"><strong>{count}</strong> live offers</p>
</header>
<main>
{content}
</main>
<footer class="foot">
<p>Built {built_display} &middot; offers re-verified on every change</p>
</footer>
</div>
{banner}
{ga_init}
</body>
</html>
"""

_CARD_TMPL = """<li style="--i:{index}">
<article class="card" data-category="{category}">
<div class="card-top">
<span class="badge">{category}</span>
{expiry_display}
</div>
<h2 class="card-title"><a href="{source_url}" target="_blank" rel="noopener noreferrer" aria-label="Claim {title} from {provider}">{title} <span class="ext" aria-hidden="true">&#8599;</span></a></h2>
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
    if (typeof window.gtag !== "function") { return; }
    gtag("consent", "update", { analytics_storage: "granted" });
    ftLoadGa();
    gtag("config", MEASUREMENT_ID, { anonymize_ip: true });
    gtag("event", "page_view", { page_path: window.location.pathname });
  }
  function ftDecline() {
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


def render_html(index: dict, measurement_id: str = "") -> str:
    analytics = bool(measurement_id)
    if not index["offers"]:
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
                    source_url=html.escape(o["source_url"], quote=True),
                    title=html.escape(o["title"], quote=True),
                    amount=html.escape(o["amount"]),
                    provider=html.escape(o["provider"], quote=True),
                    verified_date=html.escape(verified, quote=True),
                    verified_display=_human_date(verified),
                    expiry_display=expiry,
                )
            )
        content = '<ul class="grid">\n' + "\n".join(cards) + "\n</ul>"
    built = index["generated_at"]
    return _PAGE_TMPL.format(
        css=_CSS + (_BANNER_CSS if analytics else ""),
        count=index["count"],
        content=content,
        built_display=f'<time datetime="{html.escape(built, quote=True)}">'
        f'{_human_date(built[:10])}</time>',
        ga_head=build_consent_head(measurement_id),
        banner=_BANNER_TMPL if analytics else "",
        ga_init=build_analytics_init(measurement_id),
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

    note = f" (analytics: {measurement_id})" if measurement_id else ""
    print(f"built {index['count']} offers -> index.json, site/index.html{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
