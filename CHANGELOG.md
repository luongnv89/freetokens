# Changelog

Notable changes to the Free AI Credits site and build. The site itself is
regenerated on every deploy; entries here cover behavior, not content edits.

## Unreleased

- **GDPR cookie consent for everyone (#72):** the consent banner now shows
  to all first-time visitors (the EU-timezone heuristic is gone), tracking
  stays completely off until an explicit allow, and a persistent footer
  "Cookie settings" control re-opens the banner on any page so the choice
  can be changed at any time. The GoatCounter counting beacon is
  consent-gated too: it loads only after a grant, never before.
- **Share bar on offer detail pages (#71):** every offer page ships
  LinkedIn, X, Facebook, and email share links pre-filled with the offer's
  absolute URL plus a copy-link button with visible confirmation. Share
  actions emit an `offer_share` event (offer id + channel) through the
  consent-gated analytics bus — sharing works even when tracking is
  declined.
- **Default order latest-added first (#70):** the home offers list now
  defaults to newest-verified-first (verified_date doubles as the add
  stamp), so returning visitors see fresh offers without touching the sort
  control. Explicit `?sort=` choices still override; ties stay
  slug-stable.

## v2.0 — 2026-08-22

Archive, RSS, distribution groundwork (#25–#30).

- **Retain-and-flag expiry (#25):** expired offers are no longer dropped at
  build time; every entry in `index.json` carries a build-time
  `"status": "active" | "expired"`. The home list still shows only active
  offers.
- **Offer archive (#26):** new `archive.html` listing all expired offers,
  newest expiration first, each with an explicit text "Expired" badge,
  original terms, and source link; linked from every footer and the home
  empty state.
- **RSS feed (#27):** valid RSS 2.0 `feed.xml` generated per build over all
  active offers, with absolute anchor links (`#offer-<slug>`), RFC-2822
  `pubDate`s, autodiscovery `<link>` in every page head, and a footer link;
  `--base-url` flag for non-default origins.
- **Provider outreach kit (#28):** `docs/outreach-kit.md` — GA4 export →
  per-provider summary steps, attribution-backed pitch template, worked
  examples, live tracking log.
- **Newsletter gate recorded (#29):** `docs/decisions/newsletter-go-no-go.md`
  verdict NO-GO (measurement window immature); F13 explicitly not built;
  re-evaluation due on/after 2026-09-05.
- Deploy workflow also runs on pushed `v*` tags (#30).

## v1.1 — 2026-08-22

Agent skill & content growth (#20–#24).

- `offer-updater` file-based agent skill with web verification and a
  curator-confirmation commit gate.
- Sort options (`newest` / `expiring soon` / `amount`) driven by `?sort=`.
- Catalog grown to 21 hand-verified offers by dogfooding `offer-updater`.
- Distribution kit shipped: copy, targets, outreach log
  (`docs/outreach-log.md`); measurement window opened.

## v1.0 — 2026-08-21

First public release (#1–#19).

- Static generator: stdlib-only Python build with JSON-Schema offer
  validation in CI and SHA-pinned GitHub Pages deploys.
- Offer cards with detail dialogs (summary, how-to-claim, social proof).
- Client-side category filter, debounced text search, shareable URL state,
  sort options groundwork.
- Consent-gated GA4 with IP anonymization, EU consent banner, length-only
  search events, and per-offer `offer_click` attribution.
- Privacy policy page; launch checklist executed.
