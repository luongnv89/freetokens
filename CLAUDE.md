# CLAUDE.md — freetokens

Pre-code repo: planning docs + GitHub issue backlog only. Implementation happens issue-by-issue — do not scaffold anything not covered by an open issue.

See @prd.md and @tasks.md for scope. Epic: #31.

## Critical commands
- No build system yet. Task #2 (generator spike) decides: plain build script vs Astro. Do NOT pick one ad hoc.
- After #8 lands, deploys run automatically on push to main. Never push directly to main after #12 (branch protection).

## Architecture map (planned)
- `offers/*.yaml` — one file per offer; the entire content model
- Build script → static HTML → GitHub Pages (`<user>.github.io/freetokens`)
- GA4 for `page_view` + `offer_click` events; no backend, ever

## Offer content schema (non-negotiable)
- Required fields: `title`, `provider`, `category`, `amount`, `expiry_date`, `source_url`, `verified_date`
- Dates are `YYYY-MM-DD`; `expiry_date: null` means ongoing
- `category` enum: api_provider | coding | image | voice | video
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
