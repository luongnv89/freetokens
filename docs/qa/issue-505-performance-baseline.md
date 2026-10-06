# Issue #505: performance baseline (lab)

**Verdict: baseline established; no bottleneck proven severe.** Repeatable cold-load
and search-interaction traces were collected for the home and detail surfaces of the
local production build in headless Chromium. Response size and client work are both
**bounded** on the sampled surfaces — the document plus every subresource measured
under ~360 KB transferred, largest-contentful-paint stayed in the low hundreds of
milliseconds and cumulative layout shift stayed under 0.06. The one structural
finding the measurement does support is a **request-count** observation on home:
401 of its 409 subresource requests are per-row (and aggregate) view-count
fetches. Field Core Web Vitals are
**unavailable** to this run, so that gap is retained rather than filled with a
fabricated score. Nothing here claims the site is slow or fast in production.

Evidence for [issue #505](https://github.com/luongnv89/freetokens/issues/505)
(original UX/AX review task T2). Captured 6 October 2026, 05:32 UTC. No
application code or offer data changed; this is measurement plus its harness.

## Scope and method

Two independent measurements, kept deliberately separate:

1. **Lab trace (primary).** The local production build at source commit
   `48498bc481d1aa9e03bd232144c4b9632d946c78`, served by `vite preview` on
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
| TTFB | 7.3 | 3.3 | 2.7 | 2.7–7.3 |
| DOMContentLoaded | 43.9 | 118.8 | 119.2 | 43.9–119.2 |
| Load event | 143.2 | 120.0 | 120.4 | 120.0–143.2 |
| Subresource requests | 409 | 409 | 409 | 409 |
| Document transfer / decoded (B) | 42,452 / 644,482 | same | same | gzip |
| Subresource transfer / decoded (B) | 277,824 / 639,599 | same | same | — |
| LCP | 160 | 124 | 124 | 124–160 |
| LCP element | `p` | `p` | `p` | — |
| CLS | 0.0517 | 0.0406 | 0.0406 | 0.041–0.052 |
| Long tasks (≥50 ms) | 1 (88 ms) | 0 | 0 | 0–1 |
| Main-thread task time (CDP `TaskDuration`, s) | 0.526 | 0.479 | 0.480 | 0.479–0.526 |
| Script time (`ScriptDuration`, s) | 0.084 | 0.080 | 0.080 | 0.080–0.084 |
| Recalc style (`RecalcStyleDuration`, s) | 0.121 | 0.115 | 0.116 | 0.115–0.121 |
| JS heap used (MB) | 9.06 | 7.91 | 7.94 | 7.91–9.06 |

### Detail (`/offers/aerolink-starter-free-trial.html`)

| Metric | Run 1 | Run 2 | Run 3 | Range |
| --- | --- | --- | --- | --- |
| TTFB | 2.9 | 2.8 | 3.3 | 2.8–3.3 |
| DOMContentLoaded | 46.3 | 45.3 | 48.3 | 45.3–48.3 |
| Load event | 46.6 | 45.6 | 48.5 | 45.6–48.5 |
| Subresource requests | 12 | 12 | 12 | 12 |
| Document transfer / decoded (B) | 6,941 / 26,700 | same | same | gzip |
| Subresource transfer / decoded (B) | 359,304 / 954,605 | same | same | — |
| LCP | 60 | 52 | 60 | 52–60 |
| LCP element | `p` | `p` | `p` | — |
| CLS | 0.0395 | 0.0395 | 0.0395 | 0.0395 |
| Long tasks (≥50 ms) | 0 | 0 | 0 | 0 |
| Main-thread task time (CDP `TaskDuration`, s) | 0.079 | 0.076 | 0.079 | 0.076–0.079 |
| Script time (`ScriptDuration`, s) | 0.026 | 0.025 | 0.026 | 0.025–0.026 |
| Recalc style (`RecalcStyleDuration`, s) | 0.010 | 0.010 | 0.011 | 0.010–0.011 |
| JS heap used (MB) | 4.56 | 4.57 | 4.57 | 4.56–4.57 |

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
| Interaction duration (ms) | 182.7 | 153.0 | 150.4 |
| Main-thread task time during interaction (s) | 0.071 | 0.063 | 0.062 |
| Long tasks during interaction | 0 | 0 | 0 |

Filtering 199 rows to one costs ~150–185 ms end-to-end on this machine, with no
long task and under 0.1 s of main-thread task time.

## Response size

### Lab, by initiator (home / detail, per run)

| Initiator | Home requests | Home transfer (B) | Home decoded (B) | Detail requests | Detail transfer (B) | Detail decoded (B) |
| --- | --- | --- | --- | --- | --- | --- |
| script | 1 | 95,850 | 307,701 | 1 | 95,850 | 307,701 |
| link (fonts, CSS preload) | 4 | 140,123 | 183,809 | 4 | 140,123 | 183,809 |
| css | 2 | 20,772 | 20,172 | 2 | 20,772 | 20,172 |
| fetch | 402 | 21,079 | 127,917 | 5 | 102,559 | 442,923 |

Largest assets by wire bytes:

| Asset | Surface | Transfer (B, gzip) | Decoded (B) |
| --- | --- | --- | --- |
| `assets/index-*.js` | both | 95,850 | 307,701 |
| `fonts/archivo-var-latin.woff2` | both | 90,396 | 90,096 |
| `assets/details-*.json` | detail | 81,480 | 315,006 |
| `fonts/lora-var-latin.woff2` | both | 38,092 | 37,792 |
| `assets/offers-*.json` | both | 21,079 | 127,917 |
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
document 44,146 vs 42,452 lab; detail 6,674 vs 6,941 lab; JS 95,977 vs 95,850
lab), so the local harness is a fair proxy for **transfer size**. It is not a
proxy for network latency or field experience. The deployed build's JS hash
(`index-BTseAQcg.js`) differs from the local build's (`index-Km2Hvscp.js`); the
sizes agree, so the comparison is size-level, not byte-identical.

## Main-thread work

- Home does an order of magnitude more main-thread work than detail:
  `TaskDuration` 0.479–0.526 s vs 0.076–0.079 s, and `RecalcStyleDuration`
  0.115–0.121 s vs 0.010–0.011 s. This is consistent with rendering 199 offer
  rows and processing 409 responses versus a single detail document.
- Script time itself is small on both surfaces (home 0.080–0.084 s, detail
  0.025–0.026 s), so the home cost is dominated by style recalculation and task
  handling rather than JavaScript execution.
- Exactly one long task (88 ms) appeared across six cold runs, on the first home
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

- **Home issues two view-count requests per offer row.** 401 of the 402
  fetch-initiated subresource requests on a cold home load are GoatCounter
  fetches: 2 aggregate counters (`TOTAL`, all-time plus a today-windowed
  variant), 1 home-page counter, and 398 per-row counters — two per rendered
  offer row across all 199 rows (an all-time counter and a date-windowed one).
  Detail issues 3. The lab stubs those hosts with
  `204`, so their **real network cost is unmeasured** — what is measured is the
  request *count*, not its latency. On loopback the total is immaterial; on a
  high-latency mobile link 401 cross-origin requests per load is the kind of
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
