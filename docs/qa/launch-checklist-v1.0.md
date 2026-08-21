# v1.0 Launch Quality Gate (Task 3.7 / PRD §8.1)

Executed: 2026-08-21 · Branch: `refactor/19-execute-launch-checklist-and-tag-v1-0` · Issue: #19

## Environment deviations (honest record)

| Checklist item | Deviation |
|----------------|-----------|
| Lighthouse on deployed URL | **Run as specified** — Chrome-class headless Chromium 151 against `https://luongnv.com/freetokens/`. Reports archived here. |
| Manual 320 px pass on iOS Safari + Android Chrome | Real devices unavailable in the build environment. **Substituted:** automated headless-Chromium probe at a 320×690 CSS px mobile viewport (`responsive-320-mobile-emulated.json`). A real-device spot-check remains an owner action before wide announcement. |
| GA4 DebugView confirmation | No GA4 property/measurement ID is configured yet (`deploy.yml` reads the optional `GA_MEASUREMENT_ID` repo secret). **Substituted:** build-time and runtime event-path verification via the unit/behavioral test suite. DebugView confirmation remains an owner action (steps below). |

## Results

### Lighthouse (mobile emulation, deployed URL)

Report: [`lighthouse-mobile-deployed.json`](./lighthouse-mobile-deployed.json)
(fetched `2026-08-21T21:35:28Z`, `finalDisplayedUrl: https://luongnv.com/freetokens/`)

| Category | Score | Target | Verdict |
|----------|-------|--------|---------|
| Performance | **99** | ≥ 95 | PASS |
| Accessibility | **100** | ≥ 90 | PASS |

Branch preview (same audit against the local build including this PR's changes):
Performance 99, Accessibility 100. Sub-metric deltas vs the deployed run are
local-server artifacts (no gzip/minification on `python -m http.server`) and do
not appear on the Pages CDN deployment.

### WCAG 2.1 AA spot-audit

**Keyboard-only path (filter → search → click):**
- Every interactive element is native (`a[href]`, `button`, `input[type=search]`);
  DOM order matches visual order: masthead → search → category chips → offer
  links → footer nav. Consent banner sits last in the DOM and moves focus to its
  Accept button when shown; <kbd>Esc</kbd> declines it.
- Visible focus everywhere: 3 px solid ink `:focus-visible` outlines with offset
  on links (incl. card titles), chips, search input, banner buttons.
- Filter/search/click fully operable without a pointer: typing fires the debounced
  filter, chips are real buttons (Enter/Space), offer links navigate natively
  (`target=_blank`, never intercepted). No keyboard traps, no positive tabindex.
- Status changes announced: results line is `role="status"` + `aria-live="polite"`.
- Descriptive link text: every outbound offer link carries
  `aria-label="Claim {title} from {provider}"`; footer links are self-descriptive;
  the external-link glyph is `aria-hidden`.
- Observation (accepted): no skip link — the page is a single content section and
  the toolbar is already the first interactive element.

**Contrast (computed WCAG ratios):**

| Pair | Ratio | Requirement | Verdict |
|------|-------|-------------|---------|
| Ink `#000000` on paper `#ffffff` (body text) | 21.0 : 1 | ≥ 4.5 | PASS |
| Gray `#6b7280` on paper (small mono metadata) | 4.83 : 1 | ≥ 4.5 | PASS |
| White on ink (pressed/hover chips) | 21.0 : 1 | ≥ 4.5 | PASS |
| Green `#22c55e` accent on paper | 2.28 : 1 | n/a — decorative only | PASS |

The green accent lines/dot are decorative and never the sole carrier of meaning
(the "ongoing" dot always accompanies the word).

### Responsive 320 px pass (automated substitute)

Report: [`responsive-320-mobile-emulated.json`](./responsive-320-mobile-emulated.json)

- **No horizontal overflow:** `scrollWidth == clientWidth == 320` on the offers page.
- **Tap targets adequate:** with `pointer: coarse` emulated, category chips and
  the search input measure exactly **44 px** tall (this PR adds the coarse-pointer
  floor; consent buttons get the same floor when analytics is enabled).
  Card/footer links are inline text links (18–22 px) — exempt per WCAG target-size
  guidance for inline text.
- In-page checks: `<title>` present, meta description present (80 chars),
  favicon link resolves (`./favicon.svg`).
- Fluid-layout guards asserted by regression tests: fluid grid columns
  (`minmax(min(100%, 19rem), 1fr))`, clamp()-based gutters/type, `overflow-wrap`,
  `-webkit-text-size-adjust`.

### Favicon & meta tags

- `site/favicon.svg` emitted by the build and linked from **every generated
  page** (home with offers, empty-state home, privacy) via relative
  `<link rel="icon" type="image/svg+xml">` (deploy-base safe).
- Distinct non-empty `<title>` + meta description on all pages.
- Regression coverage: `LaunchGateTests` in `tests/test_build.py`.

### Empty state & expired-offer behavior (§8.1)

Verified by the existing suite (all passing):

- Build-time expiry drop, today/null kept: `ExpiryFilterTests` (5 tests),
  end-to-end `test_main_drops_expired_offer_from_built_index`.
- All-expired catalog renders the friendly empty state with exit 0:
  `EmptyStateTests` (6 tests incl. `test_main_all_expired_renders_empty_state_exit_zero`).
- Client-side no-results panel (hidden until filtering yields zero, with working
  reset): `ToolbarMarkupTests.test_client_empty_panel_hidden_with_working_reset`
  and behavioral Node harness tests.

### Analytics event paths (GA4 DebugView pending owner action)

All four production event types are verified at the code level:

| Event | Evidence |
|-------|----------|
| `page_view` | `GtagSnippetTests` (consent-gated load, path-only location, no query leak) |
| `offer_click` | `OfferClickMarkupTests` + Node harness click/dedupe/attribution tests |
| `filter_use` | `FilterEventGateTests`, `AppJsSourceTests`, Node chip-click harness tests |
| `search` | `AppJsSourceTests` (length-only payload, never raw query), Node debounce tests |

**Owner action to complete DebugView confirmation:**

1. Create a GA4 property; note the Measurement ID (`G-XXXXXXX`).
2. Add repository secret `GA_MEASUREMENT_ID`; push to main to redeploy.
3. Open the live site with `?debug=1` (GA DebugView), accept the consent banner,
   then perform one of each: page load, chip filter, search, offer click.
4. Confirm all four events arrive in DebugView.

## Release procedure (post-merge)

Deployment is automatic: push to `main` triggers validate → build → deploy
(`.github/workflows/deploy.yml`), publishing `site/` (now including
`favicon.svg`) to GitHub Pages. Branch protection requires the `validate` check
green.

Tag after merge (orchestrator/repo owner):

```bash
git fetch origin && git checkout main && git pull --ff-only
git log -1 --format=%H   # the merge SHA
git tag -a v1.0 <merge-sha> -m "v1.0: MVP launch"
git push origin v1.0
```

Then confirm the Actions run went green and the live site serves the tagged
build (check the `Built …` date in the footer and `/freetokens/favicon.svg`).
