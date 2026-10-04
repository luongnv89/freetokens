# Issue #504: three-surface measurement

Measured **5 October 2026, Europe/Paris** (UTC timestamps in the JSON). This is
partial evidence for [issue #504](https://github.com/luongnv89/freetokens/issues/504).
**Do not close the issue:** real 200% desktop zoom, screen-reader speech and
representative-user comprehension remain unmeasured. No layout or offer data
was changed.

## Scope and reproduction

The local production build at source commit
`700519140e133324ba910506a627b9c40b6c3ebf` was measured in headless Chromium
151.0.7922.34 at **320×900, 375×900, 768×900 and 1440×900 CSS pixels**.
The default automation context uses DPR 1 and visual viewport scale 1. These
values do **not** establish desktop browser zoom. No device scaling, pinch
zoom or CSS zoom was used as a substitute for 200% desktop zoom.

Run from the repository root with existing npm/Playwright dependencies:

```sh
cd app
ISSUE_504_CAPTURE=1 npx playwright test issue-504 --project=chromium --workers=1
```

The [measurement spec](../../app/e2e/issue-504-measurement.spec.ts) reuses the
existing `http-preview.ts` harness and builds/prerenders the application before
serving it locally. It writes the linked JSON and JPEG files only when
`ISSUE_504_CAPTURE=1`; normal CI skips these four catalog-specific measurement
cases. The run uses fresh browser storage per width and pre-dismisses analytics
consent. Consent-overlay behavior is outside this sample. Finite entry animations
and web fonts settle before measurement; search assertions wait for matching
input, result count, status text and URL. Reruns overwrite the evidence and must
be accompanied by an updated report if measurements change.

## Findings

- **Search and recovery passed at all four widths.** Home had 201 rows;
  `q=aerolink` had exactly one, `#offer-aerolink-starter-free-trial`;
  `q=no-such-provider-issue-504` had zero. “Clear search & filters” returned
  all 201 rows, an empty input, no URL query and focus in the search field.
  Back restored empty then provider state; Forward restored empty then cleared
  state. Each transition asserted input, results, status and URL together.
- **No document or body horizontal overflow** was measured in any of the nine
  captured states at any width. This does not mean all controls fit: an
  internally clipped/scrollable strip can coexist with zero document overflow.
- **Small-width chip-strip focus clipping is systemic, not one-off.** At
  320px the focused Coding stop scored 2/5 unobscured hit-test samples, Voice
  3/5 and Startup programs 2/5; at 375px API providers scored 3/5 (with
  `fullyInViewport: false`), Image 2/5 and Video 2/5 — see the
  [320px](issue-504/320-home-focus-13.jpg) and
  [375px](issue-504/375-home-focus-13.jpg) Coding focus captures. Chromium's
  focus scroll-into-view only minimally reveals trailing chips, and the
  mask-removal rule in
  [`python-parity.css`](../../app/src/styles/python-parity.css) covers only
  `.toolbar > .chips:has(> :last-child:focus-visible)` under
  `@media (max-width: 48rem)`, so a mid-strip focused chip keeps the edge fade
  painted over its focus ring. These are observed layout/access findings, not
  changes made by this PR.
- **The 375px "sort select overlapping the category strip" is an abutting clip
  edge, not a true z-index overlap.** The scroll lane's left clip edge sits
  flush against the sort select — `margin-inline: -0.15rem` tucks the lane
  ~2.4px under it — and the mask fades only the right edge, so scrolled leading
  chips clip flat mid-glyph (`…ograms`/`…mage`/`…ers` fragments) directly
  against the select. The right edge has the deliberate fade; the left does not.
- **Real Tab traversal reached search, sort, category filters and the detail
  claim links.** Nineteen home stops were collected through Saved and 41 detail
  stops through the document. All collected stops matched `:focus-visible`.
  This alone does not establish usable focus: the JSON records viewport
  containment, five hit-test samples, computed outline/shadow and browser ARIA
  names. Selected screenshots show the actual search, Coding and claim focus.
  Partial hit-test misses can also arise from multiline links, rounded corners
  or clipping; they are screening evidence, not automatic occlusion failures.
  The four `*-home-focus-9.jpg` captures show no visible search-input ring
  because each screenshot fired <150ms after Tab, mid-CSS-transition: the JSON
  records a transparent `box-shadow` (`oklab(0 0 0 / 0)`) at that instant while
  `#ft-search` transitions `border-color`/`box-shadow` over 0.15s. Settled
  captures show the green border and glow clearly, so focus-9 must not be cited
  as evidence of a missing focus indicator.
- **Several standalone controls measure below the WCAG 2.5.8 (AA) 24 CSS px
  target-size minimum and are candidates for evaluation.** The in-row Save
  (46.0×21.0) and Hide (43.8×21.0) buttons, the in-row tag-filter buttons
  (14–17.2px height) and the footer Cookie settings button (85.7×14.0) are
  standalone controls where the inline exception does not clearly apply and
  adjacent targets may also fail the spacing exception. These are candidates
  for 2.5.8 evaluation, not an audit verdict: spacing, inline and other
  exceptions were not assessed.
- **The exact Aerolink route and destination were checked.**
  `/offers/aerolink-starter-free-trial.html` rendered the Aerolink heading and
  its claim link resolved to `https://aerolink.lat/pricing`. The browser did not
  submit an account form or claim credits. This session measured the site's
  displayed terms; it did not re-verify the external offer.

## Measurement interpretation

Interactive dimensions come from live `getBoundingClientRect()` results, in
CSS pixels. Targets below 24 or 44 pixels on either axis are flagged for
review, not declared WCAG failures: spacing, inline-link and other exceptions
were not evaluated. Home target/contrast sampling includes the toolbar/header,
footer and first offer row; it does not exhaust all 201 rows. Detail includes
all rendered interactive elements, even those below the initial fold.

Contrast uses runtime computed foreground/background colors after rendering.
Chromium converts each CSS color to sRGB RGBA through a one-pixel canvas; the
collector composites alpha colors through the ancestor backgrounds, then
calculates WCAG relative luminance and ratio. Opaque descendants cover ancestor
images/gradients. Uncovered gradients/images, group opacity and blend/filter
paint are explicitly excluded (`ratio: null`); the body's radial wash therefore
leaves many header/toolbar text samples unmeasured. This is a rendered color
measurement, **not source-CSS inspection, screenshot pixel sampling or a full
contrast conformance audit**. Pseudo-elements, sibling overlap, clipping,
antialiasing and glyph-edge colors are not modeled. Canvas channel quantization
also limits precision near a threshold. Decorative `aria-hidden` separators are
identified separately. Thresholds are 4.5:1 for normal text and 3:1 for large text.

The captured status DOM has `role="status"` and `aria-live="polite"`, and its
text updates with results. **No screen reader ran.** Browser ARIA snapshots are
control-name evidence only; they cannot establish what was spoken or whether
announcements were timely, duplicated, missing or interrupted.

## Remaining acceptance work

| Acceptance criterion | Current result | Required completion evidence |
| --- | --- | --- |
| Four widths and 200% zoom | Partial: all widths captured | Actual desktop browser zoom at 200%, recorded UI zoom value and resulting CSS viewport, screenshots and overflow |
| Settled search, clear, history | Passed in this Chromium sample | No additional evidence required for this bounded browser check |
| Keyboard, screen reader, contrast, targets | Partial: runtime keyboard/geometry and bounded contrast collected | Spoken screen-reader transcript; inspect all clipped focus and excluded contrast samples |
| Representative-user comprehension | Not run | Participant observations and success/mistake counts |

### Manual zoom and assistive-technology session

Use a desktop browser window; record OS, browser/version, screen reader/version,
window dimensions and starting zoom. Use its **actual Zoom menu** to select
200%; capture that menu value separately from the page screenshot. Record
`innerWidth`, `innerHeight`, `devicePixelRatio` and visual viewport scale as
context, not as proof of desktop zoom. At 200%, repeat home, provider search,
unmatched search, clear and exact detail route; capture overflow, clipped or
missing controls and any two-dimensional scrolling. Repeat actual Tab and
Shift+Tab navigation, Enter/Space activation on category filters, the clear
button and detail navigation. Check the full visible focus ring, especially the
small-width category strip and bottom-of-page controls.

With NVDA/Firefox or VoiceOver/Safari actually running, record verbatim spoken
control names, roles, states and result announcements while entering `aerolink`,
entering the unmatched query, clearing, navigating Back/Forward and opening the
exact detail. Note announcement delay, duplication, interruptions and unexpected
focus moves. Record the settings and speech transcript/audio with session time;
an accessibility-tree export is not the transcript. Inspect excluded gradient
and overlap contrast cases with a suitable rendered-pixel/manual contrast check.
Do not mark this criterion complete from DOM semantics alone.

### Representative-user protocol

Recruit at least two representative developers and two content creators; record
role, relevant experience and assistive technology, with anonymous IDs. This is
a small formative session, not statistical validation. Give each person the
same three-surface task without explaining the badges first. Do not submit any
account form or supply personal credentials.

1. Find Aerolink from home, recover from an unmatched query, then open its exact
   detail. Record wrong turns, help requested, completion and elapsed time.
2. Ask what “social proof” and “To be verified” each mean. Success: distinguish
   evidence provenance from the curator's review state; neither guarantees the
   participant will receive credit or means the curator personally claimed it.
3. Ask whether signup is needed and what expires. Success: account required;
   $5 is a one-time testing credit for eligible new accounts, valid 30 days
   after verification/abuse checks. “Ongoing” describes the listed offer's lack
   of a fixed end date, not perpetual credit or a recurring free plan.
4. Ask the participant to identify the official claim destination without
   creating an account. Success: identify the Aerolink pricing destination and
   distinguish it from evidence links. Record whether help was required.

Record each task as independent success / success with help / incorrect /
uncompleted, alongside the participant's exact explanation and mistake. Use one
row per participant/task with timestamp and surface/viewport. Report observed
counts and individual misconceptions; do not generalize four sessions into a
population claim. **No participants were recruited and no results are claimed
in this report.**

## Validation

- Focused capture: four Chromium cases passed, including all state assertions.
- The local production build completed through the existing preview harness.
- Resolver QA reported 451 Vitest tests, 119 Python tests and all 231 offer
  files passing validation.
- Broader browser QA passed 13 Chromium checks and skipped the four opt-in
  cases, then was interrupted when Firefox launch stalled: two Firefox checks
  interrupted and 32 cases not run. The full cross-browser suite is **not** green.

## Captured measurements and artifact index

The following tables are generated from the linked JSON and link every retained
image. Home screenshots show the initial viewport; provider/empty/recovery and
history screenshots show the scrolled search/results region. Detail screenshots
capture the full page. Focus captures show the viewport after the recorded Tab.
The chip strip appears end-scrolled in the provider/empty/recovery captures
because the home `tabWalk` ran first and the lane's `scrollLeft` persisted into
later screenshots — a test-order artifact, not an app defect.
### Run summary

| Viewport (CSS px) | JSON | Captured (UTC) | Home rows | Home stops | Detail stops | Document/body overflow |
| --- | --- | --- | --- | --- | --- | --- |
| 320×900 | [320.json](issue-504/320.json) | 2026-10-04T23:05:57.530Z | 201 | 19 | 41 | none in any state |
| 375×900 | [375.json](issue-504/375.json) | 2026-10-04T23:06:03.821Z | 201 | 19 | 41 | none in any state |
| 768×900 | [768.json](issue-504/768.json) | 2026-10-04T23:06:10.160Z | 201 | 19 | 41 | none in any state |
| 1440×900 | [1440.json](issue-504/1440.json) | 2026-10-04T23:06:16.520Z | 201 | 19 | 41 | none in any state |

### 320px state captures

| State | URL | Input | Rows | Status | Overflow html/body | Targets <24px | <44px | Contrast measured | Below threshold | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| home | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 24 | 38 | 21 | 0 | [320-home.jpg](issue-504/320-home.jpg) |
| provider | `/index.html?q=aerolink` | `aerolink` | 1 | Showing 1 of 201 offers | 0/0 | 25 | 39 | 22 | 0 | [320-provider.jpg](issue-504/320-provider.jpg) |
| empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 19 | 34 | 11 | 0 | [320-empty.jpg](issue-504/320-empty.jpg) |
| recovery | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 24 | 38 | 21 | 0 | [320-recovery.jpg](issue-504/320-recovery.jpg) |
| back-empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 19 | 34 | 11 | 0 | [320-back-empty.jpg](issue-504/320-back-empty.jpg) |
| back-provider | `/index.html?q=aerolink` | `aerolink` | 1 | Showing 1 of 201 offers | 0/0 | 25 | 39 | 22 | 0 | [320-back-provider.jpg](issue-504/320-back-provider.jpg) |
| forward-empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 19 | 34 | 11 | 0 | [320-forward-empty.jpg](issue-504/320-forward-empty.jpg) |
| forward-recovery | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 24 | 38 | 21 | 0 | [320-forward-recovery.jpg](issue-504/320-forward-recovery.jpg) |
| detail | `/offers/aerolink-starter-free-trial.html` | — | 0 | — | 0/0 | 27 | 41 | 36 | 0 | [320-detail.jpg](issue-504/320-detail.jpg) |

### 375px state captures

| State | URL | Input | Rows | Status | Overflow html/body | Targets <24px | <44px | Contrast measured | Below threshold | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| home | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 24 | 38 | 21 | 0 | [375-home.jpg](issue-504/375-home.jpg) |
| provider | `/index.html?q=aerolink` | `aerolink` | 1 | Showing 1 of 201 offers | 0/0 | 25 | 39 | 22 | 0 | [375-provider.jpg](issue-504/375-provider.jpg) |
| empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 19 | 34 | 11 | 0 | [375-empty.jpg](issue-504/375-empty.jpg) |
| recovery | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 24 | 38 | 21 | 0 | [375-recovery.jpg](issue-504/375-recovery.jpg) |
| back-empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 19 | 34 | 11 | 0 | [375-back-empty.jpg](issue-504/375-back-empty.jpg) |
| back-provider | `/index.html?q=aerolink` | `aerolink` | 1 | Showing 1 of 201 offers | 0/0 | 25 | 39 | 22 | 0 | [375-back-provider.jpg](issue-504/375-back-provider.jpg) |
| forward-empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 19 | 34 | 11 | 0 | [375-forward-empty.jpg](issue-504/375-forward-empty.jpg) |
| forward-recovery | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 24 | 38 | 21 | 0 | [375-forward-recovery.jpg](issue-504/375-forward-recovery.jpg) |
| detail | `/offers/aerolink-starter-free-trial.html` | — | 0 | — | 0/0 | 29 | 41 | 36 | 0 | [375-detail.jpg](issue-504/375-detail.jpg) |

### 768px state captures

| State | URL | Input | Rows | Status | Overflow html/body | Targets <24px | <44px | Contrast measured | Below threshold | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| home | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 20 | 38 | 21 | 0 | [768-home.jpg](issue-504/768-home.jpg) |
| provider | `/index.html?q=aerolink` | `aerolink` | 1 | Showing 1 of 201 offers | 0/0 | 21 | 39 | 22 | 0 | [768-provider.jpg](issue-504/768-provider.jpg) |
| empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 15 | 34 | 11 | 0 | [768-empty.jpg](issue-504/768-empty.jpg) |
| recovery | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 20 | 38 | 21 | 0 | [768-recovery.jpg](issue-504/768-recovery.jpg) |
| back-empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 15 | 34 | 11 | 0 | [768-back-empty.jpg](issue-504/768-back-empty.jpg) |
| back-provider | `/index.html?q=aerolink` | `aerolink` | 1 | Showing 1 of 201 offers | 0/0 | 21 | 39 | 22 | 0 | [768-back-provider.jpg](issue-504/768-back-provider.jpg) |
| forward-empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 15 | 34 | 11 | 0 | [768-forward-empty.jpg](issue-504/768-forward-empty.jpg) |
| forward-recovery | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 20 | 38 | 21 | 0 | [768-forward-recovery.jpg](issue-504/768-forward-recovery.jpg) |
| detail | `/offers/aerolink-starter-free-trial.html` | — | 0 | — | 0/0 | 25 | 41 | 36 | 0 | [768-detail.jpg](issue-504/768-detail.jpg) |

### 1440px state captures

| State | URL | Input | Rows | Status | Overflow html/body | Targets <24px | <44px | Contrast measured | Below threshold | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| home | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 21 | 39 | 22 | 0 | [1440-home.jpg](issue-504/1440-home.jpg) |
| provider | `/index.html?q=aerolink` | `aerolink` | 1 | Showing 1 of 201 offers | 0/0 | 22 | 40 | 23 | 0 | [1440-provider.jpg](issue-504/1440-provider.jpg) |
| empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 16 | 34 | 11 | 0 | [1440-empty.jpg](issue-504/1440-empty.jpg) |
| recovery | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 21 | 39 | 22 | 0 | [1440-recovery.jpg](issue-504/1440-recovery.jpg) |
| back-empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 16 | 34 | 11 | 0 | [1440-back-empty.jpg](issue-504/1440-back-empty.jpg) |
| back-provider | `/index.html?q=aerolink` | `aerolink` | 1 | Showing 1 of 201 offers | 0/0 | 22 | 40 | 23 | 0 | [1440-back-provider.jpg](issue-504/1440-back-provider.jpg) |
| forward-empty | `/index.html?q=no-such-provider-issue-504` | `no-such-provider-issue-504` | 0 | Showing 0 of 201 offers | 0/0 | 16 | 34 | 11 | 0 | [1440-forward-empty.jpg](issue-504/1440-forward-empty.jpg) |
| forward-recovery | `/index.html` | — | 201 | Showing all 201 offers | 0/0 | 21 | 39 | 22 | 0 | [1440-forward-recovery.jpg](issue-504/1440-forward-recovery.jpg) |
| detail | `/offers/aerolink-starter-free-trial.html` | — | 0 | — | 0/0 | 25 | 41 | 36 | 0 | [1440-detail.jpg](issue-504/1440-detail.jpg) |

"Below threshold" counts non-decorative failures only. The linked JSON keeps every sampled element, including `aria-hidden` decorative text (e.g. the `·` separators in offer metadata, ~1.2:1) whose `meetsThreshold` is `false`; decorative samples are exempt from WCAG 1.4.3 and excluded from the count above.

### Retained focus captures

| Viewport | Stop | Element | Screenshot |
| --- | --- | --- | --- |
| 320px | home #9 | `ft-search` | [320-home-focus-9.jpg](issue-504/320-home-focus-9.jpg) |
| 320px | home #13 | `coding` | [320-home-focus-13.jpg](issue-504/320-home-focus-13.jpg) |
| 320px | detail #13 | `https://aerolink.lat/pricing` | [320-detail-focus-13.jpg](issue-504/320-detail-focus-13.jpg) |
| 320px | detail #21 | `https://aerolink.lat/pricing` | [320-detail-focus-21.jpg](issue-504/320-detail-focus-21.jpg) |
| 320px | detail #22 | `https://aerolink.lat/pricing` | [320-detail-focus-22.jpg](issue-504/320-detail-focus-22.jpg) |
| 375px | home #9 | `ft-search` | [375-home-focus-9.jpg](issue-504/375-home-focus-9.jpg) |
| 375px | home #13 | `coding` | [375-home-focus-13.jpg](issue-504/375-home-focus-13.jpg) |
| 375px | detail #13 | `https://aerolink.lat/pricing` | [375-detail-focus-13.jpg](issue-504/375-detail-focus-13.jpg) |
| 375px | detail #21 | `https://aerolink.lat/pricing` | [375-detail-focus-21.jpg](issue-504/375-detail-focus-21.jpg) |
| 375px | detail #22 | `https://aerolink.lat/pricing` | [375-detail-focus-22.jpg](issue-504/375-detail-focus-22.jpg) |
| 768px | home #9 | `ft-search` | [768-home-focus-9.jpg](issue-504/768-home-focus-9.jpg) |
| 768px | home #13 | `coding` | [768-home-focus-13.jpg](issue-504/768-home-focus-13.jpg) |
| 768px | detail #13 | `https://aerolink.lat/pricing` | [768-detail-focus-13.jpg](issue-504/768-detail-focus-13.jpg) |
| 768px | detail #21 | `https://aerolink.lat/pricing` | [768-detail-focus-21.jpg](issue-504/768-detail-focus-21.jpg) |
| 768px | detail #22 | `https://aerolink.lat/pricing` | [768-detail-focus-22.jpg](issue-504/768-detail-focus-22.jpg) |
| 1440px | home #9 | `ft-search` | [1440-home-focus-9.jpg](issue-504/1440-home-focus-9.jpg) |
| 1440px | home #13 | `coding` | [1440-home-focus-13.jpg](issue-504/1440-home-focus-13.jpg) |
| 1440px | detail #13 | `https://aerolink.lat/pricing` | [1440-detail-focus-13.jpg](issue-504/1440-detail-focus-13.jpg) |
| 1440px | detail #21 | `https://aerolink.lat/pricing` | [1440-detail-focus-21.jpg](issue-504/1440-detail-focus-21.jpg) |
| 1440px | detail #22 | `https://aerolink.lat/pricing` | [1440-detail-focus-22.jpg](issue-504/1440-detail-focus-22.jpg) |
