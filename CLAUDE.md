# CLAUDE.md — freetokens

Since the v3.0 cutover this repo ships a real app: a Vite + React 19 static
site under `app/`, deployed to GitHub Pages. Implementation still happens
issue-by-issue — do not scaffold anything not covered by an open issue.

See @prd.md and @tasks.md for scope. Epic: #31.

## Critical commands
- Install: `cd app && npm ci` (never bare `npm install` in CI)
- Dev server: `cd app && npm run dev`
- Build: `npm run build` in `app/` — see ADR-002 (`docs/adr/0002-react-vite-migration.md`).
- Test: `npm test` in `app/` (Vitest unit + budget gates); `npm run test:e2e` for Playwright.
- Validate offers: `python3 scripts/validate_offers.py` — the content gate.
- Deploys run automatically on push to main. Never push directly to main (branch protection).

## Architecture map
- `offers/*.yaml` — one file per offer; the entire content model
- `app/src/components/` — React components (HomePage, OfferRow, ConsentBanner, …)
- `app/src/lib/` — data loading, analytics, URL state, personal state helpers
- `app/src/routes.ts` + `app/src/prerender/` — routing and build-time prerender to static HTML
- `offers/*.yaml` → Vite build (offer data → JSON/JSONL at build time) → prerendered HTML → GitHub Pages (`<user>.github.io/freetokens`) — React 19 + TypeScript + Tailwind + shadcn/ui per ADR-002 (`docs/adr/0002-react-vite-migration.md`); the Python builder was decommissioned after the v3.0 cutover (#139), its validator core living on in `scripts/offer_model.py`
- GA4 for `page_view` + `offer_click` events; no backend, ever

## Offer content schema (non-negotiable)
- Required fields: `title`, `provider`, `category`, `amount`, `expiry_date`, `source_url`, `verified_date`
- Dates are `YYYY-MM-DD`; `expiry_date: null` means ongoing
- `category` enum: api_provider | coding | image | voice | video | startup_program
- Slug = provider+title, must be unique across `offers/`
- Every offer MUST have a real `source_url` you have visited, plus today's `verified_date`

## Hard rules
- IMPORTANT: never record raw search queries in analytics — `search` events carry `query_length` only
- IMPORTANT: pin all GitHub Actions to full commit SHAs, never floating tags
- Expired offers disappear at build time only (#9); never add client-clock filtering without revisiting ADR #11
- Never invent an offer or reuse stale data — unverified entries get `needs_review`, not published
- Never commit `.env` or credentials

## Workflow preferences
- Issues are the source of truth: work from #N, close with fixes; dependency order matters (see Dependency Table in tasks.md)
- Small fixes = minimal diffs; don't restructure beyond the issue scope
- When blocked on product decisions (generator choice, consent scope), stop and ask — don't guess

## Token Efficiency
- Never re-read files you just wrote or edited. You know the contents.
- Never re-run commands to "verify" unless the outcome was uncertain.
- Don't echo back large blocks of code or file contents unless asked.
- Batch related edits into single operations. Don't make 5 edits when 1 handles it.
- Skip confirmations like "I'll continue..." Just do it.
- If a task needs 1 tool call, don't use 3. Plan before acting.
- Do not summarize what you just did unless the result is ambiguous or you need additional input.
