# Development Tasks — Free AI Credits

Source PRD: ./prd.md
Generated: 2026-08-21

## Overview

### Development Phases
- **POC**: Prove the git-based content model end-to-end — YAML offer files → build script → rendered list page → live on GitHub Pages (Sprint 1).
- **MVP**: Productionize validate → build → deploy pipeline, full discovery UX, analytics, seed content; ship v1.0 (Sprints 2–3).
- **Full Release**: Agent-assisted curation (v1.1), archive/RSS/outreach (v2.0) (Sprints 4–5).

### Key Dependencies
- **F5 offer schema must freeze early (Task 2.1)** — it blocks F1/F2/F3/F6/F9/F11/F12.
- **Deploy pipeline (Task 2.2)** gates every release verification.
- **GA4 instrumentation (Tasks 3.3–3.4)** gates attribution-dependent work (outreach kit, newsletter decision).

### SEO baseline dependency (Task 1.1)

The SEO follow-up tasks tracked by epic #197 use [`docs/seo-baseline-2026-08-29.md`](./docs/seo-baseline-2026-08-29.md) at commit `185e74550d5e76ec79d8f365c51e8f80010a8817` as their shared baseline:

- **Task 2.4 / issue #207:** validate structured data and sitemap against tooling.
- **Task 3.1 / issue #210:** publish `llms.txt` and related AI-readable content.

## Sprint Overview

| Sprint | Phase | Focus | Task Count |
|--------|-------|-------|------------|
| 1 | POC | Content pipeline proof: YAML → HTML → Pages | 6 |
| 2 | MVP Foundation | Schema CI, auto-deploy, list page, expiry | 6 |
| 3 | MVP Completion | Filter/search, GA4, privacy, seed content, v1.0 launch | 7 |
| 4 | Full Features (v1.1) | Agent skill, sort, catalog growth, distribution | 5 |
| 5 | Full Features (v2.0) | Archive, RSS, outreach kit, newsletter gate | 6 |

---

## Sprint 1 — POC: Prove the Content Pipeline

**Sprint goal:** Prove the git-based content model end-to-end — hand-written offer files → build script → rendered HTML list → live on GitHub Pages via manual deploy. No filtering, search, tracking, or automation yet.

### Task 1.1: Scaffold repository and project foundation

**Description**: Initialize the git repo for "Free AI Credits" with baseline scaffold: README describing project vision and content model (PRD §1.1, §6.4), `.gitignore`, MIT LICENSE, initial directory layout (`offers/`, `scripts/` or `build/`, `docs/`). This is the container every later task commits into.

**Acceptance Criteria**:
- [ ] Repo initialized with `main` default branch; first commit contains README.md, .gitignore, LICENSE
- [ ] README states product purpose, target users, and how to add an offer (placeholder referencing `offers/*.yaml`)
- [ ] Directory structure exists (`offers/` with `.gitkeep`); push to GitHub succeeds

**Dependencies**: None

**Effort**: 0.5 day (S)

**PRD Reference**: §1.1 Product Vision, §6.4 Infrastructure, §9.1 Open Question #4

### Task 1.2: Run timeboxed spike — choose static generator

**Description**: Timeboxed 1-day spike resolving PRD Open Question #1. Build throwaway prototypes rendering 2–3 sample YAML offers to HTML both ways: (a) plain Python/bash build script producing one static HTML file from a JSON index, (b) equivalent minimal Astro static-only build. Compare against PRD constraints (build+deploy < 3 min, dependency-minimal supply chain §5.2, zero client framework §6.2). Record choice in `docs/adr-001-static-generator.md`.

**Acceptance Criteria**:
- [ ] Both prototypes render ≥2 sample offers to valid HTML locally within the 1-day timebox
- [ ] Decision documented in `docs/adr-001-static-generator.md` with rationale against PRD constraints
- [ ] Chosen approach has a reproducible local build command recorded in the ADR and README

**Dependencies**: Task 1.1

**Effort**: 1 day (M — decision risk; must not overrun timebox)

**PRD Reference**: §6.2 Frontend, §5.1 Performance, §5.2 Security & Privacy, §9.1 Open Question #1

### Task 1.3: Draft offer front-matter schema and author ~5 seed offers

**Description**: Define canonical YAML schema for `offers/*.yaml` (one file per offer) per F5: required fields `title`, `provider`, `category` (enum: api_provider / coding / image / voice / video), `amount`, `expiry_date` (nullable = ongoing), `source_url`, `verified_date`. Document field types, date format (`YYYY-MM-DD`), category enum, slug conventions in `docs/schema.md`. Hand-write ~5 real, self-verified seed offers conforming to the schema, covering ≥3 categories incl. one nullable-expiry example.

**Acceptance Criteria**:
- [ ] `docs/schema.md` defines all 7 fields with types, formats, nullability rules, and category enum
- [ ] ≥5 seed offer files exist in `offers/`, each parseable YAML with all required fields
- [ ] At least one seed offer has `expiry_date: null`; ≥3 distinct categories represented
- [ ] Every seed offer has a real working `source_url` and `verified_date`

**Dependencies**: Task 1.1

**Effort**: 1–2 days (M/L)

**PRD Reference**: F5 Git-Based Content Model, §10.2 Glossary

### Task 1.4: Implement minimal schema validation for offer files

**Description**: Add lightweight validation to the build checking every `offers/*.yaml` against the Task 1.3 schema before rendering: required fields present, dates `YYYY-MM-DD`, category in enum, unique provider+title slug. Non-zero exit naming offending file and field on failure. Dependency-free or pinned deps only (§5.2). Included here because the crude F1 page silently breaks on malformed input otherwise.

**Acceptance Criteria**:
- [ ] Validator passes on all 5 seed offers (exit code 0)
- [ ] Fixture missing a required field fails with error naming file and field
- [ ] Invalid date format or out-of-enum category fails with expected format hint
- [ ] Duplicate slug across two fixtures produces clear duplicate error

**Dependencies**: Task 1.3

**Effort**: 1 day (M)

**PRD Reference**: F5 acceptance criteria ("malformed offer file… fails naming offending field and file"), §5.2 Supply chain

### Task 1.5: Build single-page offer list renderer (crude F1)

**Description**: Extend the build pipeline (chosen in Task 1.2) to render all validated offers into a single static `index.html`: semantic list where each offer shows title, provider, amount, expiry (or "ongoing"), category label, outbound link to `source_url`. No filtering/search/styling polish; no client JS beyond unavoidable; hand-rolled minimal CSS.

**Acceptance Criteria**:
- [ ] Build produces `index.html` containing all 5 seed offers with provider, amount, expiry/category badge, outbound link visible
- [ ] Offer with `expiry_date: null` renders "ongoing" instead of a date
- [ ] Semantic markup, basic accessibility sanity (descriptive link text)
- [ ] Page renders correctly locally at 320 px width without horizontal overflow

**Dependencies**: Task 1.2, Task 1.4

**Effort**: 1–2 days (M)

**PRD Reference**: F1 Offer List Page, F5, §5.4 Accessibility (basic subset)

### Task 1.6: Deploy POC manually to GitHub Pages and verify live

**Description**: Publish built site manually to GitHub Pages: create remote repo, enable Pages, push built output, verify live URL `<user>.github.io/<repo>`. Validates the core thesis that commit-to-live works. Automated deploy workflow deferred to Sprint 2 (F8).

**Acceptance Criteria**:
- [ ] Site reachable at `https://<user>.github.io/<repo>` showing all 5 seed offers
- [ ] Editing an offer file, rebuilding, re-pushing shows change live within ~5 minutes (verified once)
- [ ] Outbound links navigate correctly to provider source URLs
- [ ] Manual deploy steps documented in README

**Dependencies**: Task 1.5

**Effort**: 0.5–1 day (S/M)

**PRD Reference**: §6.4 Infrastructure, F8 (deferred automated version), §8.1 MVP checklist

---

## Sprint 2 — MVP Foundation: Validate → Build → Deploy

**Sprint goal:** Productionize the pipeline: strict schema CI, SHA-pinned auto-deploy, full offer list page, build-time expiry handling.

### Task 2.1: Finalize JSON Schema for offer front-matter and add CI validation workflow

**Description**: Formalize the Sprint 1 schema draft into a strict JSON Schema covering all required front-matter fields for every file in `offers/`. Add GitHub Actions validation workflow running on every push touching `offers/**`, failing with messages naming offending file and field (F5 acceptance criteria).

**Acceptance Criteria**:
- [ ] Well-formed offer file pushed to a branch passes validation (workflow green)
- [ ] Malformed offer (missing field, invalid date, duplicate slug, bad null handling) fails CI naming both file and field, plus date format hint
- [ ] Workflow triggers only on pushes modifying `offers/**` (verified via test commit)

**Dependencies**: Task 1.3, Task 1.4

**Effort**: 2 days (M)

**PRD Reference**: F5 Git-Based Content Model, §3.2 F5 edge cases

### Task 2.2: Implement GitHub Actions deploy workflow (validate → build → deploy to Pages)

**Description**: Production deploy workflow implementing F8: schema validation → static build → GitHub Pages deploy on push to main. All actions pinned to full commit SHAs (§5.2). Target end-to-end < 3 minutes (§5.1).

**Acceptance Criteria**:
- [ ] Push to main validates, builds, and site is live at `<user>.github.io/<repo>` within 3 minutes
- [ ] Every action reference pinned to a full commit SHA (no floating tags like `@v4`)
- [ ] Deliberately failing validation blocks deploy (site serves last good build)

**Dependencies**: Task 2.1, Task 1.6

**Effort**: 2 days (M)

**PRD Reference**: F8 GitHub Pages deployment, §5.1 Performance targets, §5.2 Supply chain

### Task 2.3: Implement build-time expiry handling in the build script

**Description**: Extend the build so expiry is evaluated at build time: offers with past `expiry_date` excluded from the default index; `null` expiry treated as ongoing and always included. Implements F4 without runtime logic.

**Acceptance Criteria**:
- [ ] Offer with past `expiry_date` absent from generated default list after fresh build
- [ ] Offer with `expiry_date: null` appears labeled "ongoing", never filtered out
- [ ] Unit tests cover boundaries: expiry = today (included), yesterday (excluded), null (included)

**Dependencies**: Task 1.5

**Effort**: 1 day (S/M)

**PRD Reference**: F4 Expiry handling, §3.2 F1 edge case ("ongoing")

### Task 2.4: Build the full offer list page with cards

**Description**: Complete home page (F1): every non-expired offer rendered as a scannable card showing provider, credit amount, category badge, expiry date (or "ongoing"), outbound claim link. Semantic HTML per §5.4; responsive 320–2560 px; friendly empty state when zero offers render.

**Acceptance Criteria**:
- [ ] Each card displays provider, amount, category badge, expiry (or "ongoing"), working outbound link
- [ ] Expired offers absent from built page; expiring/deleting an offer then rebuilding removes it
- [ ] Renders correctly at 320 px (manual pass); keyboard navigation + contrast spot-check pass
- [ ] Zero-offer scenario shows friendly empty state instead of blank page

**Dependencies**: Task 2.3, Task 2.2 (for live verification)

**Effort**: 2 days (M)

**PRD Reference**: F1 Offer list page, F4, §5.3 Compatibility, §5.4 Accessibility

### Task 2.5: Document deploy-time-only expiry evaluation decision

**Description**: ADR-style record capturing why expiry is evaluated only at build/deploy time (not view time): trade-offs (stale window between deploys vs zero-runtime/cacheability/simplicity), consequences (just-expired offer stays visible until next deploy), interaction with future archive (F11). Linked from README.

**Acceptance Criteria**:
- [ ] Decision record exists (`docs/adr/0001-build-time-expiry.md`) with context, options, decision, consequences
- [ ] README references the decision and documents expired-offers-hidden-on-next-deploy behavior

**Dependencies**: Task 2.3

**Effort**: 1 day (S)

**PRD Reference**: F4 Expiry handling, §6.3 backend-none constraint

### Task 2.6: Enable branch protection on main requiring the validation check

**Description**: Configure branch protection on `main`: direct pushes restricted to PRs; merges require the Task 2.1 validation check green. Makes F5's "malformed entries rejected" invariant enforceable.

**Acceptance Criteria**:
- [ ] Direct pushes to `main` rejected; changes require PR
- [ ] PR merge blocked when validation check failing; allowed when green
- [ ] Protection settings documented in docs

**Dependencies**: Task 2.1

**Effort**: 1 day (S)

**PRD Reference**: F5 CI rejects malformed entries, §4.2 Curator flow CI gate, §5.2 Repo access restriction

---

## Sprint 3 — MVP Completion: Discovery, Analytics, Launch v1.0

**Sprint goal:** Ship discovery features, privacy-first analytics, seed content; cut v1.0.

### Task 3.1: Implement client-side category filtering with shareable URL state

**Description**: Category filtering (api_provider, coding, image, voice, video) per F2: instant narrowing without reload, syncs to URL query param (`?category=image`) shareable/back-button-safe, fires GA4 `filter_use` event with `category`. Accessible "All" reset and friendly empty state (F1 edge case).

**Acceptance Criteria**:
- [ ] Selecting a category renders only matching offers without reload or network fetch
- [ ] Filter reflected in URL param; direct load reproduces view; Back clears correctly
- [ ] GA4 `filter_use` event fires exactly once per application (DebugView verified)
- [ ] Empty category shows empty state with working reset button
- [ ] Filter controls keyboard-navigable; result counts announced to screen readers

**Dependencies**: Task 2.4, Task 3.3

**Effort**: 2 days (M)

**PRD Reference**: F2, §5.1 (<200 ms latency), §6.2 URL query params, §7.2 `filter_use`

### Task 3.2: Implement client-side text search with privacy-safe analytics

**Description**: Search box over title/provider/description per F3: <200 ms over ≤500 offers (simple string matching over JSON index), term persisted in URL param (`?q=`) combinable with category filter, debounced input. GA4 `search` events carry **only** `query_length` — never raw query.

**Acceptance Criteria**:
- [ ] Typing narrows visible list within 200 ms (timed over 500-offer fixture)
- [ ] Query encoded in URL param; deep-link restores combined filter state; Back works
- [ ] GA4 `search` events contain `query_length` and never the raw query (network-tab verified)
- [ ] Combined search + filter uses AND semantics; empty-result state shows reset
- [ ] Search box labeled/placeholder and keyboard-operable

**Dependencies**: Task 2.4, Task 3.3

**Effort**: 2 days (M)

**PRD Reference**: F3, §5.1 (<200 ms ≤500 offers), §6.2 URL query params, §7.2 `search` (query_length only)

### Task 3.3: Deploy GA4 with IP anonymization, EU consent banner, and page_view tracking

**Description**: Integrate GA4 site-wide per F7: `page_view` on every load with page path, IP anonymization enabled, lightweight consent banner shown only to EU visitors. Site fully usable if GA4 blocked or consent declined (silent degradation §4.1). Banner deferred-load, no Lighthouse degradation.

**Acceptance Criteria**:
- [ ] Every page load sends `page_view` with correct path (DebugView confirmed)
- [ ] IP anonymization enabled (config/network inspection verified)
- [ ] Consent banner renders for simulated EU traffic, suppressed non-EU; declining prevents tracking calls
- [ ] With GA4 blocked (adblocker simulation), all functionality incl. outbound nav works normally
- [ ] Banner dismissible, keyboard-accessible, adds <50 ms to page load

**Dependencies**: Task 2.2

**Effort**: 2 days (M)

**PRD Reference**: F7, §5.2 Privacy (IP anonymization, EU consent banner), §7.2 `page_view`, §4.1 Error states

### Task 3.4: Implement per-offer click tracking (`offer_click`) with attribution properties

**Description**: Instrument every outbound offer link to fire GA4 `offer_click` carrying `offer_id`, `provider`, `category` before navigation proceeds (F6). This is the attribution dataset underpinning provider pitches. Handle navigate-away race (callback/timeout fallback), exactly-once per click, silent degradation when GA4 unavailable.

**Acceptance Criteria**:
- [ ] Clicking any outbound link fires exactly one `offer_click` before provider page opens (DebugView confirms)
- [ ] Event properties match clicked offer's data for every seeded offer
- [ ] Navigation always completes even if GA4 call fails/blocks (adblocker + offline throttle tested)
- [ ] Rapid double-click produces no duplicate events

**Dependencies**: Task 3.3, Task 2.4

**Effort**: 1 day (S/M)

**PRD Reference**: F6, §7.2 `offer_click` properties, §7.1 Offer CTR metric (≥25%)

### Task 3.5: Write privacy policy page linked in footer

**Description**: Plain-language privacy policy covering what GA4 collects (page views, anonymized IPs, metadata like query_length — explicitly stating raw queries never collected), cookie/consent usage, no PII storage, no forms in v1.0, Google third-party processing. Linked in footer per §5.2. Static HTML matching site styling.

**Acceptance Criteria**:
- [ ] Policy page at `/privacy` renders consistently with site design at 320–2560 px
- [ ] Footer on every page links to it (verified on home page)
- [ ] Policy accurately describes actual implemented behavior (cross-checked against Tasks 3.3/3.4)
- [ ] Accessibility spot-check passes (semantic headings, contrast, keyboard nav)

**Dependencies**: Task 3.3

**Effort**: 1 day (S)

**PRD Reference**: §5.2 Privacy policy page linked in footer, §8.1 MVP checklist

### Task 3.6: Curate and publish ~10 hand-verified seed offers

**Description**: Research and hand-curate ~10 real, currently-claimable free AI credit offers (mix across all categories to exercise filters). Each becomes a structured content file with full front-matter committed via git workflow; all pass CI schema validation. Seeds fresh-offer-ratio metric and gives filter/search/click-tracking real data.

**Acceptance Criteria**:
- [ ] ≥10 offer files exist spanning all 5 categories, all required fields populated
- [ ] Every source_url manually visited and confirmed live this sprint (`verified_date` set)
- [ ] All seed offers pass CI schema validator (build green)
- [ ] Live site renders all 10 with correct provider/amount/expiry/category; "ongoing" for null-expiry entries
- [ ] At least one offer per category clickable, producing correct `offer_click` event (end-to-end sanity)

**Dependencies**: Task 2.1, Task 2.4, Task 3.4

**Effort**: 2 days (M/L — curation time dominates)

**PRD Reference**: §8.1 MVP (≥10 self-verified seed offers live), F5, §1.4 Success metrics

### Task 3.7: Execute launch checklist and tag v1.0

**Description**: Run complete pre-launch quality gate per PRD §8.1 and cut release v1.0: Lighthouse mobile audit (≥95 perf, ≥90 a11y), WCAG 2.1 AA spot-audit, responsive pass at 320 px, favicon/meta tags, empty-state and expired-offer verification, GA4 DebugView confirmation of all event types. Fix findings, tag `v1.0`, confirm deployment.

**Acceptance Criteria**:
- [ ] Lighthouse (mobile, deployed URL): Performance ≥95, Accessibility ≥90 (reports archived)
- [ ] WCAG 2.1 AA spot-audit completed: keyboard-only path through filter/search/click, contrast passes, descriptive link text
- [ ] Manual 320 px pass on iOS Safari + Android Chrome: no overflow, controls usable, tap targets adequate
- [ ] Favicon present; `<title>` and meta description on all pages
- [ ] Empty state + expired-offer behavior verified against §8.1 checklist
- [ ] GA4 DebugView confirms `page_view`, `offer_click`, `filter_use`, `search` firing on production build
- [ ] Git tag `v1.0` pushed; live site serving tagged build

**Dependencies**: Task 3.1, Task 3.2, Task 3.3, Task 3.4, Task 3.5, Task 3.6

**Effort**: 2 days (M)

**PRD Reference**: §8.1 Launch Checklist & Success Criteria, §5.1 Lighthouse targets, §5.3 Compatibility, §5.4 WCAG 2.1 AA

---

## Sprint 4 — v1.1: Agent Skill & Content Growth

**Sprint goal:** Make publishing an offer a <2-minute agent-assisted flow (F9), add sorting UX (F10), grow catalog to 20 verified offers dogfooding the skill, kick off distribution starting the v2-gate clock. Tag `v1.1`.

### Task 4.1: Build `offer-updater` file-based agent skill

**Description**: File-based agent skill compatible with opencode/Claude Code (`SKILL.md` + helper script). Takes screenshot/text input describing an offer, extracts fields via the LLM agent, normalizes into the frozen F5 schema (`title`, `provider`, `category`, `amount`, `expiry_date` nullable, `source_url`, `verified_date`). Small deterministic helper (bash/Python, no heavy new deps §5.2) validates generated YAML against the exact CI schema rules so skill output cannot fail the build.

**Acceptance Criteria**:
- [ ] Skill directory contains `SKILL.md` with trigger description and step-by-step pipeline instructions, loadable in opencode and Claude Code (invoked in each)
- [ ] Given a legible offer screenshot, skill produces an offer file with all required fields populated or explicitly flagged `unknown`
- [ ] Helper script validates output against frozen F5 schema; malformed input fails naming offending field/file
- [ ] Illegible/unparseable input causes targeted clarifying question instead of guessing

**Dependencies**: Task 2.1 (frozen schema + validator rules)

**Effort**: 3 days (L)

**PRD Reference**: F9, §6.1 Curator pipeline, §9.2 Assumption 2

### Task 4.2: Add web verification and curator-confirmation commit gate to `offer-updater`

**Description**: Safety half of F9 pipeline: optional web-search verification that offer is still live and terms match; conflict handling; diff presentation; hard rule that nothing commits without explicit curator confirmation. Unverifiable offers staged as `needs_review`, never auto-committed. Encodes the trust policy protecting against link rot/scam risk (§9.3).

**Acceptance Criteria**:
- [ ] Verification enabled + web confirms live → entry gets `verified_date: <today>` plus source note
- [ ] Unverifiable offer marked `needs_review` with NO git commit (dry-run verified on dead/expired URL)
- [ ] Screenshot vs web-search conflicts surfaced side-by-side requiring human decision before writing
- [ ] Git diff presented; commit happens only after explicit curator "yes"

**Dependencies**: Task 4.1

**Effort**: 2 days (M)

**PRD Reference**: F9 acceptance criteria #2 + edge cases, §4.2 Curator Flow, §9.3 Link-rot mitigation

### Task 4.3: Implement sort options (newest / expiring soon / amount) with URL params and `sort_use` event

**Description**: Sort control with three modes: newest (by verified/published date), expiring soon (ascending expiry; null-expiry sorted last), amount (descending). Sort persists as URL query param (`?sort=expiring`) consistent with filter/search params (§6.2). Fires GA4 `sort_use` with `sort_option` on change (§7.2). Client-side re-sort under 200 ms budget (§5.1).

**Acceptance Criteria**:
- [ ] "Expiring soon" reorders ascending by expiry without reload; null-expiry last
- [ ] Sort state encoded in URL param; restored on load and back-navigation
- [ ] Exactly one `sort_use` event with correct `sort_option` per change (DebugView)
- [ ] Re-sorting 20+ offers completes visually in <200 ms (DevTools perf panel)

**Dependencies**: Task 3.1, Task 3.2, Task 3.3

**Effort**: 2 days (M)

**PRD Reference**: F10, §7.2 `sort_use`, §6.2 State management, §5.1 Latency budget

### Task 4.4: Grow catalog from 10 to 20 verified offers dogfooding `offer-updater`

**Description**: Run 2–3 curation sessions using the skill end-to-end (screenshot → extract → verify → normalize → diff → confirm → push) adding 10 new verified offers across categories, reaching the ≥20-offer success metric (§1.4). New files must pass CI untouched — manual fix-ups are skill bugs logged back into 4.1/4.2 backlog. Track time-per-offer to validate Assumption 2.

**Acceptance Criteria**:
- [ ] Repo contains ≥20 valid offer files; ≥70% have `verified_date` within last 14 days (fresh-offer ratio §7.1)
- [ ] ≥8 of the 10 new offers produced exclusively via the skill with zero manual schema fixes post-push
- [ ] New offers span ≥3 categories
- [ ] Time-per-offer averages ≤5 minutes, recorded in session log committed with batch

**Dependencies**: Task 4.1, Task 4.2 (soft: Task 4.3)

**Effort**: 2 days (M — curation sessions)

**PRD Reference**: §1.4 (≥20 offers), §8.2, §7.1 Fresh-offer ratio, §9.2 Assumption 2

### Task 4.5: Kick off distribution in initial communities and tag release v1.1

**Description**: Resolve Open Question #2 (initial 5 distribution targets) if pending; prepare shareable copy (blurb + screenshots highlighting filter/sort/expiry UX); post to initial communities following each community's self-promo rules; create outreach log (channel, date, response). Cut `v1.1` tag with release notes — marks official start of the v2-gate measurement window.

**Acceptance Criteria**:
- [ ] Site shared in ≥5 distinct communities, each logged (channel, link, date) in committed outreach log
- [ ] Referral traffic from ≥2 channels visible in GA4 traffic-source report within first week
- [ ] Tag `v1.1` on main at green-CI commit with release notes listing F9, F10, 20-offer milestone
- [ ] No moderator removals within 48 h of posting (any removals noted with adjusted strategy)

**Dependencies**: Task 4.3, Task 4.4

**Effort**: 1 day (S/M + waiting period)

**PRD Reference**: §8.2 Distribution kickoff, §9.1 OQ#2, §1.4 Traffic metrics

---

## Sprint 5 — v2.0: Archive, RSS, Distribution

**Sprint goal:** Convert build-time expiry drop into retain-and-flag, ship archive view and RSS feed, produce provider outreach kit backed by real attribution data, record newsletter go/no-go. Tag `v2.0`.

### Task 5.1: Refactor expiry handling from drop to retain-and-flag

**Description**: Change F4's build logic so expired offers are no longer dropped from the generated index; each entry retained with computed `"status": "active" | "expired"` (compared at build time). Default list continues rendering only active offers (UX unchanged) while expired entries become available downstream for archive/feed decisions. Null-expiry stays flagged active/"ongoing".

**Acceptance Criteria**:
- [ ] Expired offer remains in generated index JSON flagged `expired` after build
- [ ] Home page after rebuild does NOT show expired offers in default list (visitor behavior unchanged)
- [ ] Null-expiry offer flagged `active` regardless of build date
- [ ] CI schema validation still green on all existing content after refactor

**Dependencies**: Task 2.3, Task 2.1

**Effort**: 1 day (S/M)

**PRD Reference**: §3.1 F4, §8.3 v2.0 features (prerequisite for F11)

### Task 5.2: Build archive view page with "expired" badge

**Description**: `/archive` page rendering all offers flagged `expired`, newest-expired-first, each with explicit text "Expired" badge plus provider, amount, original expiry, category, outbound link. Linked from home-page empty state ("browse archive") and footer. Static, reuses main-list components where feasible; accessible (badge via text + ARIA, not color alone).

**Acceptance Criteria**:
- [ ] With ≥1 expired offer, `/archive` renders each with visible text badge reading "Expired"
- [ ] Zero expired offers → friendly empty state
- [ ] Archive link reachable from home page (empty state and/or footer); works at 320 px width
- [ ] Lighthouse performance ≥95 on `/archive` (mobile profile)

**Dependencies**: Task 5.1, Task 3.1

**Effort**: 2 days (M)

**PRD Reference**: §3.1 F11 Archive view, §4.1 Alternative paths (empty state → archive)

### Task 5.3: Generate RSS feed at build time (/feed.xml)

**Description**: Extend build to emit valid RSS 2.0 feed at `/feed.xml` with all active offers as items (title, link back to offer anchor, description = amount/category/expiry summary, `pubDate` = verified/published date). Regenerated every build; RSS autodiscovery `<link>` in head plus footer icon/link; validated with W3C RSS validator.

**Acceptance Criteria**:
- [ ] New offer committed to main appears in `/feed.xml` in same deploy
- [ ] `/feed.xml` passes W3C RSS validator with zero errors
- [ ] Home page includes RSS autodiscovery `<link>` and footer link
- [ ] Expired offers excluded from feed; null-expiry included normally

**Dependencies**: Task 5.1

**Effort**: 1 day (S/M)

**PRD Reference**: §3.1 F12 RSS feed, §6.2 Static build tooling

### Task 5.4: Create provider outreach kit with attribution-backed pitch template

**Description**: Non-build document (`docs/outreach-kit.md`): pitch email template addressed to DevRel/growth teams at smaller AI providers leading with per-offer `offer_click` attribution from GA4 exports (clicks per provider, category breakdown, CTR vs ≥25% target); step-by-step instructions for exporting/summarizing GA4 per provider; outreach tracking log template (provider, date, response, outcome) supporting the "≥1 provider responds by week 6" metric. Include 2–3 filled example pitches once ≥2 weeks of GA4 data exists.

**Acceptance Criteria**:
- [ ] Kit contains pitch email template referencing concrete GA4 metrics (per-provider offer_click counts, CTR), not generic claims
- [ ] Step-by-step GA4 export → per-provider summary instructions included
- [ ] Outreach log template exists and records ≥1 real outreach attempt
- [ ] ≥2 example pitches populated with actual numbers from ≥2 weeks of GA4 data

**Dependencies**: Task 3.4 (live ≥2 weeks of production data)

**Effort**: 2 days (M)

**PRD Reference**: §1.4 Provider interest signals, §7.1 Attribution metric, §8.3 v2.0, Persona 3 (Alex, DevRel)

### Task 5.5: Newsletter go/no-go decision gate (recorded, no code unless approved)

**Description**: Evaluate F13 feasibility using v2-gate data: pull ≥2 weeks GA4 reports (weekly visitors, return rate vs ≥15% target, CTR vs ≥25% target). Write decision record (`docs/decisions/newsletter-go-no-go.md`) with data snapshot, criteria, GO/NO-GO verdict + rationale. If GO: specify GDPR-compliant processor, double opt-in flow, digest cadence — implementation deferred to a future sprint. If NO-GO: mark F13 explicitly not built.

**Acceptance Criteria**:
- [ ] Decision record cites concrete GA4 numbers from ≥2 weeks of data (visitors, return rate, CTR) with dates
- [ ] Clear GO or NO-GO verdict mapped to PRD success-metric targets
- [ ] If GO: processor + double opt-in + GDPR plan documented; if NO-GO: F13 marked "not built"
- [ ] No newsletter signup code shipped this sprint either way

**Dependencies**: Task 3.3, Task 3.4 (≥2 weeks accumulated production data)

**Effort**: 1 day (S)

**PRD Reference**: §3.1 F13, §5.2 Privacy (double opt-in, GDPR processor), §8.3 v2.0 newsletter decision point

### Task 5.6: Verify v2.0 feature set and tag release

**Description**: Full regression pass over v2.0 scope: expired-retention doesn't leak into default list, archive renders correctly, feed validates, GA4 events still fire, Lighthouse holds (≥95 perf / ≥90 a11y), mobile pass at 320 px. Update README/changelog with v2.0 notes; annotated tag `v2.0` on main after deploy goes green.

**Acceptance Criteria**:
- [ ] Manual QA checklist completed: no expired offers in default list, `/archive` shows all with badges, `/feed.xml` valid, GA4 DebugView confirms `page_view` + `offer_click` firing
- [ ] Lighthouse mobile ≥95 perf / ≥90 accessibility on home and archive pages
- [ ] Changelog updated; annotated tag `v2.0` pushed to origin
- [ ] Deploy workflow green on tagged commit; live site reflects v2.0 within 2 minutes of push

**Dependencies**: Task 5.1, Task 5.2, Task 5.3

**Effort**: 1 day (S/M)

**PRD Reference**: §5.1 Performance NFRs, §8.3 Version 2.0 checklist, §8.1 launch-checklist pattern

---

## Dependencies Map

### Visual Dependency Graph

```
[1.1] ──┬──> [1.2] ─────────────┐
        └──> [1.3] ──> [1.4] ──┴──> [1.5] ──> [1.6]
                       │             │
                       v             v
                      [2.1] ──> [2.2] ├──> [2.3] ──> [2.4] ──┐
                        │              └──> [2.5]           │
                        └──> [2.6]                          v
                        │                                 [3.1]/[3.2]
                        └──> [4.1] ──> [4.2] ──┐            │
[2.2] ──> [3.3] ──┬──> [3.4] ──> [3.6] ──> [3.7] <──────────┘
                  ├──> [3.5]              [4.4] <── [4.1]+[4.2]
                  └──> (URL-param pattern) [4.3] <── [3.1]+[3.2]+[3.3]
                                            │
[2.3] ──> [5.1] ──> [5.2]                   v
                 └─> [5.3]               [4.5] (tag v1.1)
[3.4](+2wk) ──> [5.4]; [3.3/3.4](+2wk) ──> [5.5]
[5.1..5.3] ──> [5.6] (tag v2.0)
```

### Dependency Table

| Task ID | Task Title | Depends On | Blocks |
|---------|------------|------------|--------|
| 1.1 | Scaffold repository | None | 1.2, 1.3 |
| 1.2 | Generator spike (ADR) | 1.1 | 1.5 |
| 1.3 | Schema draft + 5 seed offers | 1.1 | 1.4, 2.1 |
| 1.4 | Minimal schema validator | 1.3 | 1.5, 2.1 |
| 1.5 | Crude offer list renderer | 1.2, 1.4 | 1.6, 2.3 |
| 1.6 | Manual GH Pages deploy POC | 1.5 | 2.2 |
| 2.1 | JSON Schema + CI validation | 1.3, 1.4 | 2.2, 2.6, 3.6, 4.1 |
| 2.2 | Deploy workflow (SHA-pinned) | 2.1, 1.6 | 3.3, 2.4 |
| 2.3 | Build-time expiry handling | 1.5 | 2.4, 2.5, 5.1 |
| 2.4 | Full offer list page | 2.3, 2.2 | 3.1, 3.2, 3.4, 3.6 |
| 2.5 | Expiry-evaluation ADR | 2.3 | None |
| 2.6 | Branch protection on main | 2.1 | None |
| 3.1 | Category filter | 2.4, 3.3 | 3.7, 4.3, 5.2 |
| 3.2 | Text search | 2.4, 3.3 | 3.7, 4.3 |
| 3.3 | GA4 + consent banner | 2.2 | 3.1, 3.2, 3.4, 3.5, 5.5 |
| 3.4 | offer_click tracking | 3.3, 2.4 | 3.6, 3.7, 5.4, 5.5 |
| 3.5 | Privacy policy | 3.3 | 3.7 |
| 3.6 | Curate ~10 seed offers | 2.1, 2.4, 3.4 | 3.7 |
| 3.7 | Launch checklist, tag v1.0 | 3.1–3.6 | 4.x start |
| 4.1 | offer-updater skill base | 2.1 | 4.2, 4.4 |
| 4.2 | Verification + commit gate | 4.1 | 4.4 |
| 4.3 | Sort options | 3.1, 3.2, 3.3 | 4.5 |
| 4.4 | Grow catalog to 20 offers | 4.1, 4.2 | 4.5 |
| 4.5 | Distribution kickoff, tag v1.1 | 4.3, 4.4 | 5.4, 5.5 (measurement window) |
| 5.1 | Retain-and-flag expiry refactor | 2.3, 2.1 | 5.2, 5.3, 5.6 |
| 5.2 | Archive view | 5.1, 3.1 | 5.6 |
| 5.3 | RSS feed | 5.1 | 5.6 |
| 5.4 | Provider outreach kit | 3.4 (+2 wk data) | None |
| 5.5 | Newsletter go/no-go gate | 3.3, 3.4 (+2 wk data) | None |
| 5.6 | QA + tag v2.0 | 5.1, 5.2, 5.3 | None |

### Parallel Execution Groups

**Wave 1** (no dependencies):
- [ ] Task 1.1: Scaffold repository

**Wave 2** (after Wave 1):
- [ ] Task 1.2: Generator spike *(requires 1.1)*
- [ ] Task 1.3: Schema draft + seed offers *(requires 1.1)*

**Wave 3**:
- [ ] Task 1.4: Minimal validator *(requires 1.3)*

**Wave 4**:
- [ ] Task 1.5: Crude renderer *(requires 1.2, 1.4)*
- [ ] Task 2.1: JSON Schema + CI workflow *(requires 1.3, 1.4)*

**Wave 5**:
- [ ] Task 1.6: Manual deploy POC *(requires 1.5)*
- [ ] Task 2.2: Deploy workflow *(requires 2.1, 1.6)*
- [ ] Task 2.3: Expiry handling *(requires 1.5)*
- [ ] Task 2.6: Branch protection *(requires 2.1)*

**Wave 6**:
- [ ] Task 2.4: Full offer list page *(requires 2.3, 2.2)*
- [ ] Task 2.5: Expiry ADR *(requires 2.3)*
- [ ] Task 4.1: Skill base *(requires 2.1)*

**Wave 7**:
- [ ] Task 3.3: GA4 + consent banner *(requires 2.2)*
- [ ] Task 4.2: Verification + commit gate *(requires 4.1)*

**Wave 8**:
- [ ] Task 3.1: Category filter *(requires 2.4, 3.3)*
- [ ] Task 3.2: Text search *(requires 2.4, 3.3)*
- [ ] Task 3.4: offer_click tracking *(requires 3.3, 2.4)*
- [ ] Task 3.5: Privacy policy *(requires 3.3)*
- [ ] Task 4.4: Grow to 20 offers *(requires 4.1, 4.2)*

**Wave 9**:
- [ ] Task 3.6: Seed ~10 offers *(requires 2.1, 2.4, 3.4)*
- [ ] Task 4.3: Sort options *(requires 3.1, 3.2, 3.3)*

**Wave 10**:
- [ ] Task 3.7: Launch checklist, tag v1.0 *(requires 3.1–3.6)*
- [ ] Task 4.5: Distribution + tag v1.1 *(requires 4.3, 4.4)*

**Wave 11+** (post-MVP, partly time-gated):
- [ ] Task 5.1: Retain-and-flag refactor *(requires 2.3, 2.1)*
- [ ] Task 5.2: Archive view *(requires 5.1, 3.1)*
- [ ] Task 5.3: RSS feed *(requires 5.1)*
- [ ] Task 5.4: Outreach kit *(requires 3.4 + 2 weeks data)*
- [ ] Task 5.5: Newsletter decision *(requires 3.3/3.4 + 2 weeks data)*
- [ ] Task 5.6: QA + tag v2.0 *(requires 5.1–5.3)*

### Critical Path

```
1.1 → 1.3 → 1.4 → 2.1 → 2.2 → 3.3 → 3.4 → 3.6 → 3.7
```

**Critical Path Tasks**: 9 tasks (1.1, 1.3, 1.4, 2.1, 2.2, 3.3, 3.4, 3.6, 3.7)
**Estimated Length**: ~14 developer-days to v1.0 (of 30-task total ~44 dev-days)

> ⚠️ Delays on critical path tasks directly impact project completion. Note the bottleneck: Task 2.1 (schema freeze) sits early on nearly every downstream chain — prioritize it over parallelizable polish work. Tasks 5.4/5.5 are calendar-gated (2 weeks of GA4 data), not effort-gated.

## Backlog: Future Iterations

### Newsletter implementation (F13)
- Only if Task 5.5 verdict is GO; double opt-in + GDPR-compliant processor + digest cadence already specified in the decision record.

### Monthly re-verification sweep
- Recurring ops task from v1.1 onward: re-verify oldest offers, remove-on-suspicion (from sprint-planner risk note).

### Community features (voting/submissions)
- Explicitly Won't-MVP (F15); revisit ONLY if v2 gate metrics pass (validate.md Scope Reduction v2).

## Ambiguous Requirements

> The following items from the PRD may need clarification:

| Requirement | What Needs Clarification |
|-------------|--------------------------|
| Static site generator choice (§9.1 OQ#1) | Resolved by Task 1.2 spike (timeboxed 1 day); plan assumes plain build script viable, Astro fallback |
| Repo visibility public vs private (§9.1 OQ#4) | Assumed public (transparency + stars signal); confirm before Task 1.1 |
| Consent banner scope (GA4, EU) | Assumed EU-visitors-only for v1.0 (Task 3.3); revisit after 2 weeks of traffic data |
| Expiry evaluation timing | Assumed deploy-time-only for MVP; documented as ADR in Task 2.5; stale window between deploys accepted |
| Seed sourcing: hand-curated vs CC0 import | Assumed hand-curated for provenance control (source_url + verified_date); CC0 import rejected for v1.0 |
| F9 agent runtime | Assumed file-based skill (opencode/Claude Code compatible SKILL.md + helper script); confirm before Task 4.1 |
| Initial distribution channels (§9.1 OQ#2) | Owner decision due Week 1; gates Task 4.5 |
| Newsletter processor selection | Deferred to Task 5.5 decision gate; no MVP impact |

## Technical Notes

- Solo-dev bandwidth: Sprints 3–4 are heaviest (12 + 10 dev-days). F10 (Task 4.3) is the designated cut-line if Sprint 3 overruns.
- All GitHub Actions must be pinned to commit SHAs (enforced in Task 2.2 acceptance criteria).
- GA4 privacy stance: `search` events carry `query_length` only, never raw queries — enforced in Task 3.2 acceptance criteria.
- The offer schema (Task 2.1) is the single most load-bearing artifact: freeze it before any consumer (list page, skill, archive, RSS) is built against it.
