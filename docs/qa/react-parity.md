# React parity checklist & quality gate (Task 4.5 / PRD §8.1)

Issue #137 · Executed 2026-08-25 · Branch: `refactor/137-run-the-parity-checklist-and`
· Base: `main` @ `2f6ffa2`

Method: production build of the React app (`npm run build` — tsc + vite +
prerender, 46 routes), then per-item artifact inspection of `app/dist/`
side by side against the deployed Python-built site
(`https://luongnv.com/freetokens/`). Automated evidence: Vitest unit suite
(**249/249 pass**) and the Playwright e2e suite (#134, **24/24 pass** across
Chromium/Firefox/WebKit).

## Parity matrix (18 items)

| # | Feature section | Verdict | Evidence |
|---|-----------------|---------|----------|
| 1 | Home listing ranked mono rows | PASS | `dist/index.html`: 42 × `.card` / `.row-head` / `.r-amount` / `.r-prov` / `.r-vfd` / `.row-meta` ranked rows; identical card count and anatomy markers as production (42 × `.card` both sides). Unit: `HomePage.test.tsx` row markup. |
| 2 | Tag system — hue + glyph + filter | PASS | `dist/index.html`: 131 inline tag glyphs (`class="tag-i"`, generated sprite via `scripts/gen-tag-icons.mjs`); hue classes per family; filter wiring in `urlState.ts`. Unit: `tagIcons.test.ts`; parity CSS in `src/styles/python-parity.css`. |
| 3 | Category filter | PASS | Category chips (`chip-category-api_provider/coding/image/voice/video`) present with counts + `aria-pressed`; URL state in `urlState.test.ts`; e2e `keyboard.spec.ts` exercises chip filtering. |
| 4 | Verification filter | PASS | 42 × `badge-verification-social_proof` badges rendered (hand_verified removed — verification now `social_proof` or `unverified` only); verification dimension part of the three-dimension filter (#126) with URL state covered in `urlState.test.ts`. |
| 5 | Sign-up filter | PASS | 42 × `badge-signup-required` badges rendered; sign-up dimension in the same filter bar; unit coverage in `HomePage.test.tsx` ("three-dimension filters"). |
| 6 | Text search | PASS | `<input type="search" id="ft-search" maxLength=200 name="q">` in prerendered toolbar; debounced client filter mirrors Python keys; a11y wiring asserted in `HomePage.test.tsx` ("search a11y"). |
| 7 | Sort modes | PASS | Sort menu with all modes; sort logic in `src/lib/offers.ts` mirrors `amount_sort_value` exactly (same keys, null-expiry last); e2e `keyboard.spec.ts` includes sort step; unit tests in `offers.test.ts`. |
| 8 | Offer detail pages | PASS | 42 prerendered pages under `dist/offers/*.html` (one per live offer); data-driven route set asserted by `tests/routes.test.mjs`; js-disabled e2e confirms full prerendered content. |
| 9 | Offer detail cards | PASS | Detail page anatomy: `od-hero`, `od-brief`/`od-summary`, `od-cta`, `od-share`, `od-back` (port #128). Proof cards render from `details/*.json`. |
| 10 | Claim-step checklist | PASS | `data-ft-checklist` section + `ClaimChecklist.tsx` with namespaced localStorage key (parity with `_claim_step_parts`); unit: `ClaimChecklist.test.tsx`, `personalState.test.ts`. |
| 11 | Archive | PASS | `dist/archive.html` renders "Expired offer archive" grid; newest-first ordering in `expiredOffers()` mirroring `build.py expired_offers`; empty-state copy present. Current catalog has 0 expired offers, so empty-state path is the live one. |
| 12 | RSS feed | PASS | `dist/feed.xml` valid RSS 2.0 with atom:self, absolute links, active-only items; structural checks in `feed.test.mjs`; autodiscovery link on every page. |
| 13 | Privacy policy | PASS | `dist/privacy.html` prerendered with policy sections, footer nav, favicon links. |
| 14 | Consent-gated GA4 + five events | PASS | `src/lib/analytics.ts`: consent default denied, `page_view`, `offer_click`, `filter_use`, `search`, `sort_use` all implemented; e2e `consent.spec.ts` proves zero GA4 network requests when declined (3 browsers). DebugView confirmation deferred — see deviations. |
| 15 | Live traffic strip | PASS | `TrafficStrip.tsx` renders the `#ft-traffic` line (`role="status"`, hidden until analytics grants consent), matching `build.py #ft-traffic`; since #279 it mounts in the home masthead stats rail and in the footer of every other page; production shows the same marker. |
| 16 | Favicon & logo system | PASS | `dist/favicon.svg`, `logo-black.svg`, `logo-full.svg` emitted; every page links `favicon.svg` + `logo-mark.svg` icons; brand mark in masthead/footer (`BrandMark.tsx`). |
| 17 | Empty states | PASS | Zero-result state (`#ft-no-results`) with working reset that focuses search (`HomePage.test.tsx`); zero-offer and empty-archive states mirror `_EMPTY_TMPL` / client template. |
| 18 | Build-time expiry | PASS | Expiry stamped at build: `load-offers.mjs` → index statuses; `activeOffers()` drops expired, feed/archive split enforced; boundary tests in `load-offers.test.mjs` + `offers.test.ts` (ADR 0001 semantics). |

## Quality gate

### Lighthouse mobile (Performance ≥95, A11y ≥90)

**Deferred to the deployed preview — post-merge owner action.** The gate
specifies Lighthouse against *the deployed preview*; no preview URL exists
pre-merge. Local production-build precedent is green: Sprint-1 POC audit of
the prerendered home listing scored Performance 99 / Accessibility 100
([`prerender-poc-report.md`](./prerender-poc-report.md)) and the shipped site
scores 99/100 ([`lighthouse-mobile-deployed.json`](./lighthouse-mobile-deployed.json)).
The React build ships less JS to first paint than the POC did (prerendered
HTML for all 46 routes; hydration-only JS, gzip 103 kB).

### WCAG 2.1 AA spot-audit

- **Keyboard path:** PASS — e2e `keyboard.spec.ts` walks filter → search →
  sort → offer click without a pointer on all three browser engines; native
  elements only, visible focus tokens shared with the audited Python palette.
- **Contrast:** PASS — palette tokens are unchanged from the v1.0 computed
  audit: ink `#000000` on paper `#ffffff` = 21.0:1 body text; gray metadata
  pair measured 4.83:1 (≥4.5) at v1.0 and the token values are identical
  (`src/styles/tokens.css`). Accent colors remain decorative-only.
- **Descriptive link text:** PASS — offer card links carry
  `aria-label="View details for {title}"`, every tag/filter chip is a
  self-descriptive labelled control (`Filter by {label}`, `Remove {label}
  filter`; verified across the prerendered listing), footer links are
  self-descriptive.

### 320 px pass

PASS (automated substitute) — e2e `viewport-320.spec.ts` asserts
`scrollWidth == clientWidth == 320` with no horizontal overflow on `/`,
`/archive.html`, `/privacy.html`, and an offer detail page across Chromium,
Firefox, and WebKit. Real-device spot-check (iOS Safari + Android Chrome)
remains an owner action, as at v1.0.

### GA4 DebugView

**Deferred — owner action post-deploy.** All five event paths
(`page_view`, `offer_click`, `filter_use`, `search`, `sort_use`) are
implemented and unit-tested, and the consent gate is proven at network level
by e2e. DebugView confirmation requires the production measurement ID and a
deployed origin; steps as documented in
[`launch-checklist-v1.0.md`](./launch-checklist-v1.0.md).

## Verdict

**18/18 parity items PASS · quality gate green locally, three deploy-time
confirmations explicitly deferred (Lighthouse-on-preview, GA4 DebugView,
real-device 320 px). No failing item — cutover unblocked pending #138's
deploy-time checks.**
