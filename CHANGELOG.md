# Changelog

Notable changes to the Free AI Credits site and build. The site itself is
regenerated on every deploy; entries here cover behavior, not content edits.

## Unreleased

- **Visit counts highlighted, dual tracking unblocked (#250):** GoatCounter
  `count.js` is allowed via `gc.zgo.at` in CSP (alongside GA4). The footer
  on every page shows an all-time visit total as a number-first chip, with
  today / 90-day chips when those windows parse. Each offer list row and
  detail page shows that path's GoatCounter view count the same way.

- **Personal-state export/import (#141):** `/privacy` now names every
  localStorage key the app owns (`ft_ga_consent`, `ft-saved`, `ft-dismissed`,
  `ft-prefs`, `ft-claim-<slug>`) and hosts client-side controls to download
  all of it as a versioned JSON backup, restore that backup on any browser
  (strictly validated, size-capped, all-or-nothing), and clear every key in
  one click. Nothing stored locally is ever transmitted.

- **Python builder decommissioned (#139):** one stable week after the v3.0
  cutover (#138), `scripts/build.py`, its committed HTML output
  (`site/*.html`, `site/offers/`, `site/feed.xml`), and the legacy assets
  are removed from the tree. The frozen parser/validator core lives on as
  `scripts/offer_model.py`; `scripts/validate_offers.py` and the content-model
  tests remain the CI gate unchanged. The old builder stays recoverable from
  git history — to restore it plus the legacy output:

  ```bash
  git checkout 6aec62a -- scripts/build.py site/
  ```

## seo/v1.0 — 2026-08-30

SEO uplift ships to production (epic #197, Pre + P0–P2). Full regression:
re-run audit on `dist/`, Lighthouse on 4 routes, crawl-depth check, feed
validation, GA4 DebugView — see `docs/seo-runbook.md` and
`docs/seo-baseline-2026-08-29.md`. Deploy artifact is the artifact; annotated
tag `seo/v1.0` is pushed on green `main` after merge and published as the
GitHub Release for this section (tag creation is post-merge, documented here).

- **Baseline frozen & AI-bot policy A (#197):** `docs/seo-baseline-2026-08-29.md`
  captures the 2026-08-29 `app/dist/*.html` audit (11 criticals) and Policy A
  — search + user-requested retrieval allowed, training crawlers blocked —
  which drives the `robots.txt` directives
  ([#222](https://github.com/luongnv89/freetokens/pull/222)).
- **Self-referencing canonical on every prerendered page:** `app/scripts/prerender.mjs`
  emits exactly one `<link rel="canonical">` per document via `DEFAULT_BASE_URL`
  ([#223](https://github.com/luongnv89/freetokens/pull/223)).
- **Open Graph & Twitter Cards via prerender:** `renderSocialMetadata()`
  injects `og:title/description/url/type/image/site_name` + `twitter:card/title/description/image`
  with `og:image` → `logo-mark.svg` absolute
  ([#224](https://github.com/luongnv89/freetokens/pull/224)).
- **Exactly one H1 on home:** home heading hardened, verified by `routes.test.mjs`
  ([#225](https://github.com/luongnv89/freetokens/pull/225)).
- **Shell head hardening:** `app/index.html` fallback + no duplicate meta guard
  ([#226](https://github.com/luongnv89/freetokens/pull/226)).
- **POC exit-gate audit (#203):** `dist/*.html`-filtered re-audit at `94b5aec`
  records 0 missing canonical/viewport/lang, 1 canonical + 1 `og:title` per page,
  `feed.xml` valid with 38 items
  ([#227](https://github.com/luongnv89/freetokens/pull/227)).
- **Sitemap at build time (#205):** `app/scripts/sitemap.mjs` + `prerender.mjs`
  postbuild emits `sitemap.xml` covering `/`, `/archive.html`, `/privacy.html`,
  `feed.xml` and all `offers/*.html` with `lastmod` clamped to today; audit
  "No sitemap.xml" cleared
  ([#229](https://github.com/luongnv89/freetokens/pull/229)).
- **Robots crawl policy (#206):** `app/public/robots.txt` — `Allow: /` + `Sitemap:` + Policy A
  allow/block lists (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`, `Bytespider`
  blocked; `Googlebot`, `Bingbot`, `DuckDuckBot`, `OAI-SearchBot`, `PerplexityBot` allowed;
  `ChatGPT-User`/`Claude-User` allowed)
  ([#231](https://github.com/luongnv89/freetokens/pull/231)).
- **BreadcrumbList JSON-LD + visible trail (#208):** `Breadcrumbs.tsx` shares
  `buildBreadcrumbItems()` between DOM trail and `BreadcrumbList` JSON-LD (escaped via
  `safeJsonLd()`); home has no breadcrumbs, `/archive`/`/privacy` → `Offers → …`,
  `/offers/<slug>` → `Offers → <title>`
  ([#233](https://github.com/luongnv89/freetokens/pull/233)).
- **CI SEO head guard (#209):** `app/tests/routes.test.mjs` + `app/tests/check-seo.mjs`
  enforce exactly one canonical/OG/description per route and build `dist` before `checkDist`
  ([#235](https://github.com/luongnv89/freetokens/pull/235) staged).
- **Internal-link & crawl-depth hardening (#211):** every offer reachable within ≤3
  hops from `/`; link graph validated
  ([#237](https://github.com/luongnv89/freetokens/pull/237)).
- **llms.txt + llms-full.txt (#210):** `app/scripts/generate-llms.mjs` emits AI-readable
  feeds (staged)
  ([#236](https://github.com/luongnv89/freetokens/pull/236) staged;
  live at `/llms.txt` / `/llms-full.txt` once merged).
- **Security headers, verification, and quality follow-ups** staged for the same
  tag train: `llms.txt` follow-on, OG raster (#213
  [#239](https://github.com/luongnv89/freetokens/pull/239)), Search Console token
  [#242](https://github.com/luongnv89/freetokens/pull/242), GA4 instrumentation
  [#243](https://github.com/luongnv89/freetokens/pull/243), CSP/headers
  [#244](https://github.com/luongnv89/freetokens/pull/244), alerting
  [#245](https://github.com/luongnv89/freetokens/pull/245), CLS/alt
  [#238](https://github.com/luongnv89/freetokens/pull/238), CWV
  [#240](https://github.com/luongnv89/freetokens/pull/240), audit-noise
  [#241](https://github.com/luongnv89/freetokens/pull/241), and runbook
  [#246](https://github.com/luongnv89/freetokens/pull/246) — all land before or
  with the `seo/v1.0` tag.

## v3.0 — 2026-08-25

The React + Vite rebuild ships to production (#114).

- **Deploy cutover (#138):** `deploy.yml` now publishes the Vite build
  (`app/dist`, prerendered for every route) instead of the Python-built
  `site/`. The Python content-model gate (schema validation +
  `test_validate_offers.py` / `test_skill_validator.py`) stays as the first
  CI gate. Live-site continuity preserved at the same URLs: GoatCounter keeps
  counting on the same paths and GA4 page paths are unchanged; returning
  visitors keep their `ft_ga_consent` decision and `ft-claim-<slug>`
  checklist progress via the legacy-compatible personal-state layer.
  Rollback is one revert: restore this workflow commit and the previous
  deploy republishes the Python-built site (`scripts/build.py` remains in
  tree until #139).
- **CI reworked for the Node build (#136):** `validate.yml` runs the offer
  validation and Node gates on pushes touching `offers/**`, while its
  unfiltered pull-request trigger keeps the required `validate` check
  reportable for every PR. The workflow runs `npm ci`, Vitest unit suites,
  the Vite production build, and the Playwright e2e suite (all three
  browsers). `deploy.yml` additionally builds with Vite (same optional
  `GA_MEASUREMENT_ID` / `GOATCOUNTER_SITE_URL` plumbing; unset keeps
  analytics disabled) while still publishing the Python-built artifact until
  the #138 cutover.

- **Python HTML test suite retired (#135):** `tests/test_build.py` and its
  `tests/app_js_harness.js` Node VM harness are deleted — every behaviour was
  mapped by `docs/qa/coverage-mapping.md` (#133) to Vitest/RTL, Playwright
  (#134), retained Python, or an explicit drop. CI keeps Python solely for the
  content-model gate (`test_validate_offers.py` + `test_skill_validator.py`,
  invoked explicitly instead of `unittest discover`) and now also runs the
  Node unit suites via SHA-pinned `actions/setup-node`.

- **Coverage mapping of the Python builder suite (#133):** `docs/qa/coverage-mapping.md`
  accounts for all 41 `tests/test_build.py` classes — Vitest/RTL, Playwright
  (#134), retained Python, or dropped with a reason. Gap-fills: tag-hue
  distinctness rules (family uniqueness + deliberate claim-strength repeats)
  and masthead live/ongoing/hand-verified counters.

- **Playwright e2e suite against prerendered dist (#134):** keyboard path,
  320px overflow, JS-disabled prerender, consent-decline GA4 intercept,
  Chromium/Firefox/WebKit headless.

- **Offer detail pages, claim checklist, and social proof land in React (#128):**
  every offer has `/offers/<slug>.html`. When `offers/details/<slug>.json`
  exists the page renders summary, claim steps, and social-proof cards of
  type `x` / `reddit` / `screenshot` / `link`; without a sidecar the hero
  card still renders with fallback steps. Claim checkboxes persist under
  `ft-claim-<slug>` (including live-site legacy arrays). Copy-to-clipboard
  uses the modern API with an `execCommand` fallback and a live-region
  confirm. Detail HTML carries per-offer title, 160-char meta description,
  and `rel=canonical`. Copy-only share — no `offer_share` tracking.

- **Expired-offer archive lands in React (#129):** `/archive` lists every
  `expired` offer newest-expiry-first with a text+ARIA "Expired" badge,
  provider, amount, original expiry, category, and outbound link. Tags on
  archive rows are links to the pre-filtered home listing (`?category=` /
  `?verification=` / `?signup=`). Zero expired offers render a friendly
  empty state; the page is reachable from the footer and the home empty
  state, and the card grid collapses at 320 px without overflow.

- **Privacy policy, footer, favicon, and brand assets land in React (#132):**
  `/privacy` describes the shipped React behaviour — `query_length`-only
  search, cookieless consent-gated GoatCounter with exclusive-end windows and
  ~4h CDN lag, and GA4 after grant with `anonymize_ip`. The footer links the
  policy on every route; `#106` logo variants ship from `assets/logo` into
  `app/public` (favicon 16, mark 64, apple-touch 512); every route has a
  `<main>` landmark plus title and meta description.
- **Text search and sort land in React with privacy-safe analytics (#127):**
  `?q=` and `?sort=` round-trip AND-combined with category / verification /
  signup, debounce is 120 ms, and `search` events carry `query_length` only
  (never the raw query). HomePage is the sole owner of `search` / `sort_use`;
  `bindToolbarListeners` no longer attaches `#ft-search` / `#ft-sort`.
  Null-expiry offers sort last under expiring.
- **Consent-gated GA4 and the live traffic strip land in React (#131):** the
  Python analytics runtime is ported as typed modules — grant-only `gtag.js`
  (never Advanced Consent Mode), `ft_ga_consent` via the existing
  personal-state layer, a non-modal `#ft-consent-banner` with shadcn Button,
  GoatCounter windows that end tomorrow (#102), and delegated `offer_click`
  with 1000 ms dedupe. Search events still carry `query_length` only.
- **Home listing composes on shadcn Badge and Button:** honesty tags, toolbar
  chips, and the filter-empty reset go through the primitives' `unstyled`
  variant (`data-slot` only, no default chrome). Ranked mono rows stay
  visually pinned to python-parity.css.
- **Tag glyphs now come from lucide-react:** the eleven hand-authored SVG
  paths behind the honesty-tag glyphs are generated from lucide icon node
  data (`app/scripts/gen-tag-icons.mjs`, rerun via `npm run gen:tag-icons`),
  with a committed mapping table recording each tag's lucide icon and any
  shape difference (the `unverified` ring loses its dash pattern). The
  single per-page sprite stays: glyphs still ship once per page and each of
  the ~120 tag sites keeps its one short `<use>` reference, so the home
  listing's icon payload drops from ~1,630 to 1,230 bytes instead of
  regrowing the +70 KB that motivated the sprite. No lucide runtime reaches
  the JS bundle. Every glyph remains `aria-hidden`, with the tag's word
  carrying the accessible name.
- **shadcn/ui is initialised on the Task 2.2 tokens:** `components.json`,
  `cn()`, `@` alias, and the first primitives (`button`, `badge`) land in
  `app/src/components/ui/`. A semantic-variable bridge in
  `app/src/styles/tokens.css` points every shadcn color variable at an
  existing design token — ink, paper, muted, accent, and the tag hues — so
  no shadcn default palette can leak into the page (enforced by tests).
  The listing's parity-pinned markup is untouched; primitives serve new
  surfaces as they arrive in later sprint tasks.
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
  already had. Each name in the status line is now the control that
  removes just that filter, so one dimension can be dropped without wiping
  the other two and the search box. Toolbar chips wear their hue at rest
  rather than only when hovered, matching the row tags they mirror, and both
  list pages ship a bypass link past the tag-heavy list. The `social_proof`
  hue was black — identical to body ink and to the fallback an unknown tag
  value gets — and is now navy, so a missing hue token can no longer pass for
  a real tag.
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
