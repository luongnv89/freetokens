# GA4 discovery instrumentation — filter/search/sort → organic readouts

Track: Task 4.2 (#217) — Sprint 4 · Phase P2 · Free AI Credits SEO.

## Objective

Instrument every discovery interaction so GA4 can answer whether SEO lifts
translate to claim intent. Five consent-gated events already fire from the
Vite/React app; this doc records their contracts, privacy guarantee,
DebugView verification, and the GA4 Exploration that slices CTR
(`offer_click / page_view`) by category and by landing page.

No net-new event was needed — the handlers from Sprint 3 already satisfy
the acceptance criteria. If a gap is found in the future, patch
`app/src/lib/analytics.ts` + `app/src/components/HomePage.tsx` and update
the *Events* table below.

## Pre-requisites

- Site deployed via `.github/workflows/deploy.yml` (validate → build → deploy).
- GA4 property provisioned and `GA_MEASUREMENT_ID` (`G-XXXXXXXXXX`) stored as
  **Repo → Settings → Secrets and variables → Actions → New repository secret**.
  The build wires it as:

  ```yaml
  # .github/workflows/deploy.yml — build job
  GA_MEASUREMENT_ID: ${{ secrets.GA_MEASUREMENT_ID }}
  ```

  `app/vite.config.ts` validates the id (`^G-[A-Z0-9]{6,12}$`) and compiles it
  into `__FT_GA_ID__`. Unset or malformed values compile to `""` so no tracker
  id reaches the bundle and no `gtag.js` is ever injected. Local verification:

  ```bash
  GA_MEASUREMENT_ID=G-ABCDEF12345 npm run build
  grep -c 'googletagmanager' app/dist/index.html  # → 0 (loaded dynamically on grant only)
  # unset → rebuild → no GA script ever injected
  ```

- Consent is grant-only (`analytics_storage: denied` by default, `granted`
  only after an explicit Allow). No Advanced Consent Mode, no `gtag` stub
  before grant beyond the 500 ms `wait_for_update` default deny.

## Events

All events are consent-gated (`trackingActive` must be true) and use a
`gtag` placeholder when `GA_MEASUREMENT_ID` is unset — `trackEvent` silently
no-ops, so navigation never blocks.

| Event | Trigger | Params | Source |
|---|---|---|---|
| `page_view` | `grantConsent()` + SPA `pushState` is not auto-sent; `trackPageView()` called explicitly on grant and route change | `page_path` (pathname only), `page_location` (origin+pathname, no query) | `app/src/lib/analytics.ts:buildPageViewParams` |
| `offer_click` | Delegated `click` on any `[data-ft-offer-id]` (home rows + detail CTA), deduped 1000 ms per offer | `offer_id`, `provider`, `category` | `app/src/lib/analytics.ts:onDelegatedOfferClick` |
| `filter_use` | Category chip, verification/signup tag toggle, remove-pill, clear-all | `category`, `verification`, `signup` (closed enums, `"all"` when empty) | `app/src/components/HomePage.tsx:commit(…, "filter")` |
| `search` | Debounced search input (120 ms), only when trimmed query is non-empty | `query_length` only — never raw query | `app/src/components/HomePage.tsx:commit(…, "search")` via `trackSearch` |
| `sort_use` | Sort `<select>` change | `sort_option` (`"default"` when empty) | `app/src/components/HomePage.tsx:commit(…, "sort")` |

Implementation references:

- Builders: `buildFilterUseParams`, `buildSearchParams`, `buildSortUseParams`,
  `buildOfferClickParams`, `buildPageViewParams` in `app/src/lib/analytics.ts`.
- Call sites: `app/src/components/HomePage.tsx:341-350` (`commit`), `app/src/lib/analytics.ts:358-382` (`onDelegatedOfferClick`).
- Guard: `bindAnalyticsListeners` deliberately does **not** re-bind search/sort/chips — HomePage owns them so `filter_use` cannot double-fire (see `analytics.test.ts: bindToolbarListeners`).

### Privacy — raw `q` never leaves the browser

`buildSearchParams` accepts only a number and `trackSearch` early-returns on
`query_length === 0`. The raw query stays in `HomePage.searchInput` /
`UrlState.q` for local filtering and URL serialization; the GA4 payload is
`{ query_length: n }` only. Verified by:

```ts
// app/src/lib/analytics.test.ts — "search carries query_length ONLY"
expect(Object.keys(payload)).toEqual(["query_length"])
expect(JSON.stringify(payload)).not.toMatch(/q=|query[^_]|search_term/i)
```

And at runtime: `trackSearch(next.q.length)` in `HomePage.tsx:341` — the
string `next.q` is reduced to `.length` before the call.

## DebugView verification

Use GA4 **Admin → DebugView** (or `gtag` network tab on the deployed URL).

1. Build and deploy with a real `GA_MEASUREMENT_ID` (or test locally with
   `GA_MEASUREMENT_ID=G-TEST… npm run dev` and allow consent).
2. Open the site, click **Allow** on the consent banner. Confirm in DevTools
   Network that `https://www.googletagmanager.com/gtag/js?id=G-…` loads and a
   `page_view` with `page_path` + `page_location` fires (no `?q=` in
   `page_location`).
3. In DebugView (or Network → `collect?v=2` payloads), trigger each event:

   | Action | Expected event | Payload check |
   |---|---|---|
   | Click a category chip (e.g. `coding`) | `filter_use` | `category=coding, verification=all, signup=all` |
   | Toggle a verification tag on a row | `filter_use` | `verification=social_proof` (or `unverified`) |
   | Type ≥1 char in Search, wait 150 ms | `search` | `query_length=<n>`, no `q` key |
   | Change Sort to `Newest verified` | `sort_use` | `sort_option=newest` |
   | Click an offer title or `Claim at …` | `offer_click` | `offer_id`, `provider`, `category` |
   | Rapid double-click same offer (<1 s) | single `offer_click` | dedupe — 1 hit only |

4. Decline consent and repeat — **zero** events must fire (verified by
   `analytics.test.ts: declining prevents all tracking calls`).

Evidence to attach to the PR: screenshot or HAR of DebugView showing the
five events, or a `curl` of the `collect` hits with `query_length` present
and no raw query.

## GA4 Exploration — CTR by category and landing page

CTR is `offer_click / page_view` per segment. Build it once, save it, and
share the link.

### Create the exploration

1. GA4 → **Explore → Blank** (or **Free form**).
2. **Variables** panel:
   - Date range: Last 28 days (or Sprint window).
   - Segments: none (or add `Organic traffic` = `Session default channel group = Organic Search` to isolate SEO).
   - Dimensions: `Event name`, `Category` (custom param from `offer_click` / `filter_use`), `Page path + query string` (or `Page path`), `Session default channel group` (for referrer slice), `Landing page`.
   - Metrics: `Event count`, `Total users`, `Conversions` (if `offer_click` marked as conversion).
3. **Tab settings**:
   - Technique: Free form, Visualization: Table or Donut.
   - Rows: `Category` (or `Landing page` for the second tab).
   - Columns: `Event name`.
   - Values: `Event count` filtered to `offer_click` and `page_view`; add a **Calculated metric** `CTR = offer_click / page_view` if available, otherwise compute in Sheets/Looker.
   - Filters: `Event name` matches regex `offer_click|page_view`.
4. Duplicate the tab and switch Rows to `Landing page` (or `Page path`) to
   get **CTR by landing page** (home `/` vs `/offers/<slug>.html`).
5. Optional: add `Session default channel group` as a breakdown to see
   organic vs direct vs referral CTR.

### Register custom dimensions (one-time)

GA4 → **Admin → Custom definitions → Create custom dimension**:

- `category` — Event scope, parameter `category`
- `offer_id` — Event scope, parameter `offer_id`
- `provider` — Event scope, parameter `provider`
- `query_length` — Event scope, parameter `query_length`
- `sort_option` — Event scope, parameter `sort_option`

Without this, `category` appears as `(not set)` in Explorations.

### Mark `offer_click` as conversion (optional)

GA4 → **Admin → Conversions → New conversion event** → `offer_click`.
CTR then appears as `Conversions / Views` in standard reports.

### Shareable artifact

After saving, copy the Exploration URL (contains `/exploration/…`) and paste
it in the PR description, or commit a screenshot of the config under
`docs/qa/ga4-discovery-exploration.png`. The URL is shareable to anyone
with GA4 property access.

## Acceptance mapping

- DebugView shows `filter_use`/`search` (`query_length` only)/`sort_use` +
  `offer_click` firing post-build — covered by *DebugView verification* above
  and by `app/src/lib/analytics.test.ts` (five-events + delegation + privacy).
- GA4 exploration reports CTR by category and by landing page — follow
  *GA4 Exploration* steps, save, and link.
- Privacy: raw `q` never leaves browser — `buildSearchParams` + `HomePage:341`
  + unit test `search carries query_length ONLY`.

## References

- GA4 events: https://support.google.com/analytics/answer/12229021
- Explorations: https://support.google.com/analytics/answer/7579450
- Consent mode (grant-only): https://developers.google.com/tag-platform/gtagjs/reference#consent
- App source: `app/src/lib/analytics.ts`, `app/src/components/HomePage.tsx`, `app/src/lib/analyticsEnv.ts`
- Prior instrumentation: #131 (consent-gated GA4/GoatCounter), #101 (GoatCounter outbound events)
