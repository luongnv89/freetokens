# Coverage mapping — `tests/test_build.py` → Vitest / RTL / Playwright (#133)

Task 4.1 acceptance criterion 1: every behaviour asserted by the 4,478-line
Python builder suite (`tests/test_build.py`, 378 tests in 41 classes) is
mapped to its post-migration home — a Vitest/RTL unit test, a Playwright
end-to-end spec (#134), a retained Python suite, or an explicit drop with a
reason. This document is what lets #135 retire `tests/test_build.py` without
losing coverage.

Status legend:

- **Vitest/RTL** — covered by the unit suite (`cd app && npm test`).
- **Playwright** — covered by the e2e suite (`app/e2e/*.spec.ts`, #134).
- **Python (retained)** — stays in the Python test suite; the code under test
  is not migrating.
- **Dropped** — no longer applicable after the React + Vite port; reason given.

## Data pipeline and build output

| `test_build.py` class | Behaviour | Destination |
|---|---|---|
| `ParseTests` | Frontmatter parsing, malformed input errors naming file+field | Vitest — `app/tests/load-offers.test.mjs` ("malformed input fails naming file and field"); Python-only parse internals retired with #135 |
| `ValidateTests` | `validate_offers.py` schema checks | Python (retained) — `tests/test_validate_offers.py`; validator runs at build time on both stacks |
| `SeedContentTests` | Committed seed offers satisfy the schema | Vitest — `load-offers.test.mjs` ("data contract: schemas/offers-index.schema.json") validates the committed `index.json` |
| `BuildOutputTests` | Emitted artifacts, route set, depth-correct asset URLs | Vitest — `app/tests/routes.test.mjs` (one HTML per live route, depth-1 asset roots, RSS off `DEFAULT_BASE_URL`) |
| `ExpiryFilterTests` | Past expiry dropped; today/null kept (ADR 0001) | Vitest — `load-offers.test.mjs` ("expiry boundaries"); `app/src/lib/offers.test.ts` (`activeOffers` drops expired) |
| `LargeFixtureBuildTests` | 500-offer directory builds within budget | Vitest — `load-offers.test.mjs` ("performance": 500 offers load+index <1s); `offers.test.ts` match+sort 500-offer fixture <200ms |
| `RetainAndFlagTests` | Expired offers stay indexed with build-time status | Vitest — `load-offers.test.mjs` (`buildIndex` stamps all three statuses); feed exclusion asserted in `feed.test.mjs` |

## Home page rendering

| Class | Behaviour | Destination |
|---|---|---|
| `RenderTests` | Full-page render, list semantics, responsive/a11y CSS | Vitest — `app/src/App.test.tsx`, `pages.test.tsx`; Playwright — `keyboard.spec.ts`, `viewport-320.spec.ts` |
| `HomeListingTests` | Ranked rows (not card grid), row anatomy | Vitest — `app/src/components/HomePage.test.tsx` (row markup, showing-N-of-M line) |
| `EmptyStateTests` | Zero visible offers renders a friendly state with working reset | Vitest — `HomePage.test.tsx` ("empty result set from filters shows a working reset that focuses search") |
| `MastheadStatsTests` | Live / ongoing / hand-verified counters in masthead (#49) | Vitest — `HomePage.test.tsx` ("HomePage masthead counters", gap-filled in #133) |
| `FooterContactTests` | X / LinkedIn / website maintainer links on every page (#50) | Vitest — `pages.test.tsx` ("page chrome landmarks and footer") |
| `RelativeDateTests` | Verification age vs build date: today/Nd/Nw/fallback at 14 days | Vitest — `offers.test.ts` (`relativeDate`) |
| `ToolbarMarkupTests` | Search + chips markup with a11y wiring (F2/#13) | Vitest — `HomePage.test.tsx` ("search a11y", "three-dimension filters"), `App.test.tsx` |

## Sorting and filtering logic

| Class | Behaviour | Destination |
|---|---|---|
| `AmountSortValueTests` | First-number magnitude with k/M suffixes (F10 heuristic) | Vitest — `offers.test.ts` (`amountSortValue`, incl. re.match start-anchoring parity) |
| `SortMarkupTests` | Sort select control + per-card sort keys (F10) | Vitest — `HomePage.test.tsx` ("sort_use" emits one event per real change); `offers.test.ts` (`applySort`: expiry asc w/ null last, newest desc, amount desc, invalid→default) |

## Analytics and consent

| Class | Behaviour | Destination |
|---|---|---|
| `MeasurementIdTests` | GA4 build-time opt-in via `GA_MEASUREMENT_ID` (F7) | Vitest — `app/src/lib/analytics.test.ts` ("env resolution": accepts well-formed id, unset = fully disabled) |
| `GtagSnippetTests` | Consent-gated gtag bootstrap, IP anonymization (F7) | Vitest — `analytics.test.ts` ("grant-only gtag loader": no injection pre-grant, anonymize + page_view sans query string) |
| `ConsentBannerTests` | Lightweight keyboard-accessible banner only when configured (F7) | Vitest — `app/src/components/ConsentBanner.test.tsx`; `analytics.test.ts` banner visibility/replay |
| `StatsConfigTests` | GoatCounter site-URL resolution mirroring GA4 gating (#62) | Vitest — `analytics.test.ts` ("env resolution": normalizes origin, rejects non-https/paths) |
| `StatsBeaconTests` | Tracker snippet + strip builders, `''` when disabled (#62) | Vitest — `analytics.test.ts` ("GoatCounter exclusive-end window": today/90-day windows, never collapsed, no cache-buster) |
| `TrafficStripMarkupTests` | Beacon/strip gating across every generated page (#62) | Vitest — `analytics.test.ts` ("traffic strip silent hide": fetch reject / non-OK stay hidden); Playwright — `js-disabled.spec.ts` |
| `StatsModuleSourceTests` | Static guarantees over the spliced live-traffic module | Dropped — source-string assertions over a retired splice artifact; behaviour now unit-tested directly on `analytics.ts` |
| `LiveTrafficPrivacyTests` | Counter endpoint privacy (no query leakage, policy reflection) | Vitest — `analytics.test.ts` (no cache-buster param); `pages.test.tsx` ("PrivacyPage" shipped-analytics claims) |
| `FilterEventGateTests` | filter/search events ride the consent-gated bus (#13/#14) | Vitest — `analytics.test.ts` ("consent decisions": decline prevents all calls; "bindToolbarListeners leaves search/sort/chips to React") |
| `OfferClickMarkupTests` | Outbound links carry offer_id/provider/category (F6/3.4) | Vitest — `analytics.test.ts` ("offer_click carries offer_id, provider, category only"; dedupe, no preventDefault, tracker throw swallowed) |
| `AnalyticsBuildOutputTests` | Analytics assets emitted exactly when configured | Vitest — `routes.test.mjs` (per-route emission); Playwright — `consent.spec.ts` |
| `StatsBuildOutputTests` | Live-traffic assets emitted exactly when configured | Vitest — `analytics.test.ts` strip gating; `routes.test.mjs` |
| `ConsentForEveryoneTests` | Universal banner, persistent change-of-mind, gated GoatCounter (#72) | Vitest — `analytics.test.ts` ("shows the banner for every first visitor"; grant→decline stops events); Playwright — `consent.spec.ts` |

## Detail pages, archive, privacy, feed

| Class | Behaviour | Destination |
|---|---|---|
| `DetailLoadTests` | `details/<slug>.json` loading + strict validation (#48) | Vitest — `load-offers.test.mjs` (detail passthrough, slug-keyed map, orphan detail = build error); `app/src/lib/offerDetails.test.ts` |
| `DetailPageTests` | Per-offer page at `site/offers/<slug>.html` (#60) | Vitest — `routes.test.mjs` (detail meta/title/canonical), `pages.test.tsx` ("OfferDetailPage" shell + layout CSS) |
| `ArchivePageTests` | Static archive of expired entries with Expired badges (#26/F11) | Vitest — `pages.test.tsx` ("ArchivePage #26 parity", 320px layout) |
| `PrivacyPageTests` | Policy page sharing site chrome (3.5/§5.2) | Vitest — `pages.test.tsx` ("PrivacyPage shipped-analytics claims") |
| `FeedTests` | Valid RSS 2.0 for active offers (#27/F12) | Vitest — `app/tests/feed.test.mjs` (RSS structure, expiry filtering, RFC 2822 dates, xml escaping, byte-parity with Python `build_feed`) |
| `OfferShareBarTests` | Share bar on detail pages (#71) | Vitest — `CopyLinkButton.test.tsx` + `pages.test.tsx` (copy-link kept; external sharer links intentionally dropped in the React port — `pages.test.tsx` asserts `facebook.com/sharer` / `data-ft-share` absent) |

## Design system

| Class | Behaviour | Destination |
|---|---|---|
| `TagContrastTests` | WCAG AA on both painted states (text-on-white, white-on-fill, rest tint) | Vitest — `app/tests/design-tokens.test.mjs` (contrast ≥4.5:1 in all three states) |
| `TagHueDistinctnessTests` | Within-family hue uniqueness; deliberate cross-family claim repeats | Vitest — `design-tokens.test.mjs` ("Tag hue distinctness rules", gap-filled in #133) |
| `LaunchGateTests` | Favicon, meta tags, responsive guards on all pages (3.7/§8.1) | Vitest — `routes.test.mjs` (favicon/logo sizes, title+meta per route type); Playwright — `viewport-320.spec.ts` |

## Retired artifacts (dropped by design)

| Class | Behaviour | Reason |
|---|---|---|
| `AppJsSourceTests` | String-level guarantees over generated `_APP_JS` | The generated monolithic script no longer exists; every guaranteed behaviour is unit-tested against the React components/modules it used to implement. Source-grep tests would assert against nothing. |
| `NodeAppJsTests` | Behavioral tests driving `_APP_JS` in a Node VM with DOM stubs | Same artifact retirement; replaced by real-DOM RTL tests (no stubs). |
| `SemanticPageTests` | Landmarks, list semantics, responsive CSS as HTML-string assertions | Covered behaviourally: `pages.test.tsx` landmarks/footer, Playwright `keyboard.spec.ts` / `viewport-320.spec.ts`. String-diff assertions against Python HTML are not portable. |

## Summary

All **41 classes accounted for**: **37 mapped to Vitest/RTL** (several of them
also exercised by the Playwright specs from #134), **1 retained in Python**
(`ValidateTests` — the validator itself is not migrating), and **3 dropped with
reasons** (`StatsModuleSourceTests`, `AppJsSourceTests`, `NodeAppJsTests` —
string-level assertions over the retired `_APP_JS` artifact whose behaviour is
now unit-tested directly).

Unit-suite gate: `cd app && npm test` must stay green and under 60s
(AC5) — currently 250+ tests in ~4s.
