# Changelog

Notable changes to the Free AI Credits site and build. The site itself is
regenerated on every deploy; entries here cover behavior, not content edits.

## Unreleased

- **Every tag is a colour, a glyph, and a filter:** the three tag families
  on each row (category, verification level, sign-up need) used to render as
  one undifferentiated gray pill. Each tag value now carries its own hue and
  its own glyph, and each is a real control: clicking one narrows the listing
  to it, clicking it again clears it. Verification and sign-up join category
  as filter dimensions (`?verification=`, `?signup=`), AND-combined with the
  category chips and the search box, all shareable and back-button-safe.
  The status line names what is filtering and a "Clear all filters" control
  appears alongside it, so a filter applied from a row far down the page is
  always undoable without scrolling back. Toolbar chips pick up the same
  glyphs and hues, so the two controls read as one mechanism. On /archive and
  the offer detail pages — which ship no filter runtime — tags are links to
  the pre-filtered home listing rather than dead buttons. Colour never
  carries meaning alone: every tag keeps its spelled-out word, its glyph, and
  its explanatory tooltip, and all eleven hues clear WCAG AA both as text at
  rest and under white text when filled (enforced by tests). Glyphs ship as a
  single per-page SVG sprite; inlining them at each of ~120 tag sites cost
  +70 KB of HTML for no visual difference. Keyboard focus survives a filter:
  applying one no longer re-appends every row (which detached — and so
  blurred — the tag the user had just activated), and the two controls that
  hide themselves the moment they do their job, "Clear all filters" and the
  empty-state reset, hand focus to the search box before they go instead of
  dropping it to the top of the page. Tags rendered as links on /archive and
  the detail pages get the same touch-target minimum the listing's buttons
  already had.
- **Claim runbook on offer detail pages:** the detail page is redesigned
  around the task — hero amount with a mono status line, cheatsheet-style
  section labels, and "How to claim" rendered as a checkable step-by-step
  guide (numbered boxes on a hairline rail, strike-through on completed
  steps) with a live progress readout. Steps are real checkboxes, so
  ticking works with JS off; a small inline script adds the progress bar
  and persists check state per offer in localStorage (device-only, no
  tracking). The claim CTA now sits directly after the checklist.
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
