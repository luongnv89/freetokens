# Issue #505: performance baseline (lab)

**Verdict: baseline established; no bottleneck proven severe.** Repeatable cold-load
and search-interaction traces were collected for the home and detail surfaces of the
local production build in headless Chromium. Response size and client work are both
**bounded** on the sampled surfaces — the document plus every subresource measured
under ~360 KB transferred, largest-contentful-paint stayed in the low hundreds of
milliseconds and cumulative layout shift stayed under 0.06. The one structural
finding the measurement does support is a **request-count** observation on home:
242 of 250 requests are per-row view-count fetches. Field Core Web Vitals are
**unavailable** to this run, so that gap is retained rather than filled with a
fabricated score. Nothing here claims the site is slow or fast in production.

Evidence for [issue #505](https://github.com/luongnv89/freetokens/issues/505)
(original UX/AX review task T2). Captured 5 October 2026, 21:30–21:31 UTC. No
application code or offer data changed; this is measurement plus its harness.

## Scope and method

Two independent measurements, kept deliberately separate:

1. **Lab trace (primary).** The local production build at source commit
   `b603097714a908ab792aa208971b02d305585c7c`, served by `vite preview` on
   `http://127.0.0.1:4173` with gzip — the same compression GitHub Pages applies.
   Headless Chromium **151.0.7922.34** driven by Playwright, collecting the CDP
   `Performance` domain metrics plus `PerformanceObserver` entries for
   largest-contentful-paint, layout-shift and longtask. Viewport **1440×900 CSS
   px**, device scale factor 1, no network or CPU throttling, **cold cache** (a
   fresh browser context per repetition, so both the HTTP and the memory cache
   start empty). Analytics and traffic-counter hosts were stubbed with `204`;
   every same-origin request still travelled over real loopback HTTP.
   **Three repetitions per surface.**
2. **Deployed size probe.** Unauthenticated `curl` with
   `Accept-Encoding: gzip, br` against `https://freetokens.custats.info/` at
   **2026-10-05T21:31:01Z**, reading `content-length` and `content-encoding` from
   the response headers. GitHub Pages (`server: GitHub.com`, Fastly edge,
   `x-github-edge-region: fra`) served the sampled build (`last-modified:
   Mon, 05 Oct 2026 21:29:47 GMT`) gzip-compressed. This probe measures transfer
   size only — no timing, no rendering.

Sampled URLs:

- home — `/index.html`
- detail — `/offers/aerolink-starter-free-trial.html`

Reproduction:

```sh
cd app
ISSUE_505_CAPTURE=1 npx playwright test issue-505 --project=chromium --workers=1
```

The [measurement spec](../../app/e2e/issue-505-performance.spec.ts) builds and
prerenders the application through the existing Playwright `webServer` before
serving it locally. It writes `docs/qa/issue-505/home.json` and
`docs/qa/issue-505/detail.json` only when `ISSUE_505_CAPTURE=1`; normal CI skips
both cases. Reruns overwrite the artifacts and must be accompanied by an updated
report if the numbers change.

## Cold-load traces

Timings are milliseconds from navigation start. "Document" is the navigation
entry; "subresources" sums every resource-timing entry, which excludes the
document. `transfer` is bytes on the wire; `decoded` is the uncompressed body.

### Home (`/index.html`)

| Metric | Run 1 | Run 2 | Run 3 | Range |
| --- | --- | --- | --- | --- |
| TTFB | 13.6 | 3.4 | 3.6 | 3.4–13.6 |
| DOMContentLoaded | 76.8 | 125.4 | 124.4 | 76.8–125.4 |
| Load event | 200.0 | 126.7 | 125.6 | 125.6–200.0 |
| Requests (incl. document) | 250 | 250 | 250 | 250 |
| Document transfer / decoded (B) | 42,442 / 644,470 | 42,442 / 644,470 | 42,442 / 644,470 | gzip |
| Subresource transfer / decoded (B) | 277,827 / 639,599 | same | same | — |
| LCP | 224 | 132 | 132 | 132–224 |
| LCP element | `p` | `p` | `p` | — |
| CLS | 0.0554 | 0.0406 | 0.0566 | 0.041–0.057 |
| Long tasks (≥50 ms) | 1 (114 ms) | 0 | 0 | 0–1 |
| Main-thread task time (CDP `TaskDuration`, s) | 0.620 | 0.487 | 0.486 | 0.486–0.620 |
| Script time (`ScriptDuration`, s) | 0.110 | 0.080 | 0.080 | 0.080–0.110 |
| Recalc style (`RecalcStyleDuration`, s) | 0.138 | 0.117 | 0.115 | 0.115–0.138 |
| JS heap used (MB) | 8.50 | 7.79 | 7.79 | 7.79–8.50 |

### Detail (`/offers/aerolink-starter-free-trial.html`)

| Metric | Run 1 | Run 2 | Run 3 | Range |
| --- | --- | --- | --- | --- |
| TTFB | 3.1 | 3.0 | 2.9 | 2.9–3.1 |
| DOMContentLoaded | 49.9 | 40.8 | 45.1 | 40.8–49.9 |
| Load event | 50.2 | 62.3 | 45.3 | 45.3–62.3 |
| Requests (incl. document) | 12 | 12 | 12 | 12 |
| Document transfer / decoded (B) | 6,941 / 26,700 | same | same | gzip |
| Subresource transfer / decoded (B) | 359,307 / 954,605 | same | same | — |
| LCP | 56 | 76 | 52 | 52–76 |
| LCP element | `p` | `p` | `p` | — |
| CLS | 0.0395 | 0.0395 | 0.0395 | 0.0395 |
| Long tasks (≥50 ms) | 0 | 0 | 0 | 0 |
| Main-thread task time (CDP `TaskDuration`, s) | 0.084 | 0.094 | 0.076 | 0.076–0.094 |
| Script time (`ScriptDuration`, s) | 0.028 | 0.025 | 0.025 | 0.025–0.028 |
| Recalc style (`RecalcStyleDuration`, s) | 0.011 | 0.008 | 0.010 | 0.008–0.011 |
| JS heap used (MB) | 4.56 | 4.58 | 4.58 | 4.56–4.58 |

Run-to-run variance is small and the transfer totals are byte-identical across the
three cold runs, so the traces are repeatable in the sense the criterion asks:
same build, same tool, same settings, same numbers.

## Search interaction (home)

From the settled home page, the search field was filled with `aerolink` and the
trace waited for the input value, the URL query, the result count and the status
text to agree before stopping the clock. Timing is the in-page
`performance.now()` delta, so it measures the interaction, not the harness.

| Metric | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| Query | `aerolink` | `aerolink` | `aerolink` |
| Result rows | 1 | 1 | 1 |
| Interaction duration (ms) | 173.2 | 152.8 | 151.5 |
| Main-thread task time during interaction (s) | 0.072 | 0.064 | 0.062 |
| Long tasks during interaction | 0 | 0 | 0 |

Filtering 212 rows to one costs ~150–175 ms end-to-end on this machine, with no
long task and under 0.1 s of main-thread task time.

## Response size

### Lab, by initiator (home / detail, per run)

| Initiator | Home requests | Home transfer (B) | Home decoded (B) | Detail requests | Detail transfer (B) | Detail decoded (B) |
| --- | --- | --- | --- | --- | --- | --- |
| script | 1 | 95,854 | 307,701 | 1 | 95,854 | 307,701 |
| link (fonts, CSS preload) | 4 | 140,123 | 183,809 | 4 | 140,123 | 183,809 |
| css | 2 | 20,772 | 20,172 | 2 | 20,772 | 20,172 |
| fetch | 243 | 21,078 | 127,917 | 5 | 102,558 | 442,923 |

Largest assets by wire bytes:

| Asset | Surface | Transfer (B, gzip) | Decoded (B) |
| --- | --- | --- | --- |
| `assets/index-*.js` | both | 95,854 | 307,701 |
| `fonts/archivo-var-latin.woff2` | both | 90,396 | 90,096 |
| `assets/details-*.json` | detail | 81,480 | 315,006 |
| `fonts/lora-var-latin.woff2` | both | 38,092 | 37,792 |
| `assets/offers-*.json` | both | 21,078 | 127,917 |
| `assets/index-*.css` | both | 10,931 | 55,517 |
| `fonts/plex-mono-{400,600}-latin.woff2` | both | ~10,400 each | ~10,100 each |

Total measured per cold load: home ≈ 320 KB transferred (document + subresources),
detail ≈ 366 KB.

### Deployed, as served (2026-10-05T21:31:01Z)

| URL | Status | `content-encoding` | Wire bytes | Uncompressed |
| --- | --- | --- | --- | --- |
| `/` | 200 | gzip | 44,146 | 644,497 |
| `/offers/aerolink-starter-free-trial.html` | 200 | gzip | 6,674 | 26,727 |
| `/assets/index-BTseAQcg.js` | 200 | gzip | 95,977 | — |
| `/assets/index-qfpGt87G.css` | 200 | gzip | 10,845 | — |

The deployed gzip sizes closely track the lab's `vite preview` numbers (home
document 44,146 vs 42,442 lab; detail 6,674 vs 6,941 lab; JS 95,977 vs 95,854
lab), so the local harness is a fair proxy for **transfer size**. It is not a
proxy for network latency or field experience. The deployed build's JS hash
(`index-BTseAQcg.js`) differs from the local build's (`index-Dyi9AbD8.js`); the
sizes agree, so the comparison is size-level, not byte-identical.

## Main-thread work

- Home does an order of magnitude more main-thread work than detail:
  `TaskDuration` 0.49–0.62 s vs 0.08–0.09 s, and `RecalcStyleDuration`
  0.115–0.138 s vs 0.008–0.011 s. This is consistent with rendering 212 offer
  rows and processing 250 responses versus a single detail document.
- Script time itself is small on both surfaces (home 0.08–0.11 s, detail
  0.025–0.028 s), so the home cost is dominated by style recalculation and task
  handling rather than JavaScript execution.
- Exactly one long task (114 ms) appeared across six cold runs, on the first home
  run only.

## Lab versus field

**Field Core Web Vitals were not available to this run and remain an explicit
gap.** No CrUX or RUM data was collected: the site ships GA4 for `page_view` and
`offer_click` only (no web-vitals reporting), the repository has no field-CWV
source, and this run has no CrUX API credential. Everything above is **lab** data
on one machine over loopback with no throttling — it establishes relative
structure and repeatable local numbers, not real-user experience. A lab LCP of
~130 ms on loopback does not predict a mobile LCP, and this report does not claim
it does.

## Candidate optimization — only where the measurement supports it

The measurements support **one** candidate, and only as a hypothesis that needs a
throttled follow-up before anyone acts on it:

- **Home issues one view-count request per offer row.** 242 of the 250
  subresource requests on a cold home load are GoatCounter fetches: 2 aggregate
  counters (`TOTAL`, plus a today-window variant), 1 home-page counter, and 239
  per-row counters covering 199 distinct rendered rows — 40 rows fetch a second,
  date-windowed counter as well. Detail issues 3. The lab stubs those hosts with
  `204`, so their **real network cost is unmeasured** — what is measured is the
  request *count*, not its latency. On loopback the total is immaterial; on a
  high-latency mobile link 242 cross-origin requests per load is the kind of
  pattern worth measuring under throttling. Batching or deferring the per-row
  counters is the natural candidate, but it is **not proposed as a fix** until a
  network-throttled run shows the cost is material.

No other optimization is proposed. Nothing in the traces justifies a change to
the JS bundle, the JSON payloads, the fonts or the stylesheet, and no performance
score is assigned: the acceptance criteria forbid inventing one, and the lab
numbers alone cannot rank the site against any threshold.

## What this establishes and what it does not

Establishes: repeatable, cold-cache lab traces for home and detail with transfer
size, main-thread work, LCP, CLS and interaction timing; the document and
subresource transfer sizes as served by the local production build and by GitHub
Pages; and the request-count composition of a home load.

Does not establish: any field Core Web Vitals; behaviour under network or CPU
throttling; behaviour on real mobile hardware; the real cost of the per-row
view-count requests; or that any particular number is good or bad.

## Remaining acceptance work

| Acceptance criterion | Current result | Required completion evidence |
| --- | --- | --- |
| Repeatable cold-load + search-interaction lab traces (URL, date, tool/version, device/network, cache) | Passed | Recorded in this document and `docs/qa/issue-505/{home,detail}.json`; rerun with `ISSUE_505_CAPTURE=1` |
| Inspect transfer size, main-thread work, LCP, CLS, interaction timing; separate lab from field, retain the field gap | Passed for lab; field gap retained | A field-CWV source (CrUX or RUM) would close the gap; none is configured |
| Propose an optimization only when measured bottlenecks support it | Passed — no optimization proposed | The per-row view-count requests are recorded as an observation that needs a throttled run, not as a proposed fix; no score is assigned |
