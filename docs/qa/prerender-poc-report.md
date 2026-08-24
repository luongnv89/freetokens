# Prerender POC report — home listing at parity (issue #119)

**Date:** 2026-08-25 · **Branch:** `auto/issue-119-home-listing-parity` · **Gate:** Sprint 1, Task 1.5 (epic #114)

The React app (`app/`) now renders the full home listing — every active offer
as a ranked mono row with the same element vocabulary `scripts/build.py`
emits (`#ft-grid`, `.card`, `.row-head`, `.row-meta`, honesty-tag buttons,
CSS-counter rank) — and prerenders it to static HTML at build time
(`npm run build` → `vite build` + `node scripts/prerender.mjs`). The client
bundle hydrates onto that markup via `hydrateRoot`; with JavaScript disabled
the complete listing is still in the page source.

## Acceptance criteria

| Criterion | Result |
|---|---|
| Prerendered `/` contains all offer rows in page source, JS-off | **Pass.** All 42 active offers present in `dist/index.html` source (curl-verified; one `<li><article>` per row). JS-off load renders the full listing. |
| Lighthouse mobile: Performance ≥95, Accessibility ≥90 | **Pass.** Perf **100**, A11y **96** (report: [`lighthouse-mobile-prerender-poc.json`](lighthouse-mobile-prerender-poc.json)). |
| FCP + transferred bytes side-by-side vs live site | See table below. No regression; large improvement. |
| Prerender tool chosen, recorded in ADR-002 addendum | Custom render script (`app/scripts/prerender.mjs`) — see [ADR-002 addendum](../adr/0002-react-vite-migration.md). |
| Semantic row markup, no div-soup regression | **Pass.** Rows are `<li><article>` inside `<ol role="list">`, title links carry `aria-label="View details for …"`, badges are labeled `<button>`s — same structure as the Python output. |

## Measurements

Lighthouse 12, default mobile emulation, headless Chrome. Local POC served
with gzip (GitHub Pages applies gzip/brotli in production, so both sides are
measured compressed).

| Metric | Live site (Python build) | Prerendered POC (React SSG) | Delta |
|---|---|---|---|
| Performance (mobile) | 76–81 across runs | **100** | +19…+24 |
| Accessibility | 96 | **96** | 0 |
| FCP | ~3.7–3.9 s | **1.2 s** | −~68% |
| Total transferred bytes | 127 KB | **81 KB** | −36% |

Byte breakdown of the POC (gzipped): document 7.8 KB, JS 67.6 KB,
CSS 4.3 KB. The live site's larger payload and slower FCP are dominated by
its render-blocking Google Fonts stylesheet and a heavier inline document;
the POC ships system-font fallbacks only (webfont loading can be revisited
post-cutover without affecting parity).

## Rendered-HTML diff vs `site/index.html`

Row-by-row comparison of every `<article class="card">` open tag:

- Python reference rows: 42 · React prerendered rows: 42 · slug sets identical.
- Attribute differences on shared rows after normalization: **0**
  (`data-category/-verification/-signup/-verified/-expiry/-amount-sort` all byte-equal).

Note on catalog size: the issue text says "all 43 offers"; the catalog at
measurement time holds 42 active offers (one offer was retired since the
issue was filed — `offers/` is the source of truth). The criterion "all
offer rows present" is evaluated against the current catalog.

Two real parity bugs were found by this diff and fixed in this PR:

1. `amountSortValue` applied k/M multipliers anywhere in the string instead
   of only at the start ("MiniMax M3…" sorted as 3 M = 3,000,000).
2. `data-amount-sort` formatting now matches Python `%g`
   (`5e+07`, not `50000000`), covered by unit tests against values lifted
   from the Python-built page.

Remaining cosmetic differences (React's self-closing `<use/>` style, entity
casing) do not affect structure, semantics, or behavior.

## Verdict

The gate passes: prerendered React output is at parity with the Python
builder's home listing while measurably improving performance. Sprint 2 may
proceed.
