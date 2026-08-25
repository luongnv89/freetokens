# Offer detail page epic — closure QA record

Issue #107 (epic) · Verified 2026-08-26 on `main` after all six child issues
(#108–#113) merged via PRs #177–#184. Code inspection + `npm test` /
`npm run build` on the React app (ADR-0002).

## Acceptance criteria → evidence

| # | Criterion | Child | Evidence (file:line) | Verdict |
|---|---|---|---|---|
| 1 | Sharing any offer shares that offer's page URL, never the bare site root | #108 / PR #178 | `app/src/components/OfferDetailPage.tsx:169` passes `offerAbsoluteUrl(offer.slug)`; `app/src/lib/site.ts:24-25` builds `<base>/offers/<slug>.html` from live `window.location` (`site.ts:14-21`) | PASS |
| 2 | Every URL in how-to-claim section is clickable | #109 / PR #177 | `app/src/components/ClaimChecklist.tsx:16-34` splits step text into plain segments and bare URLs; `ClaimChecklist.tsx:87-95` renders URLs as `<a target="_blank" rel="noopener noreferrer">` | PASS |
| 3 | Key offer facts skimmable in a table layout | #110 / PR #183 | `app/src/components/OfferDetailPage.tsx:94-144` — "Details" `<table class="od-table">` with rows for provider, amount, category, sign-up, ends, verification, last checked | PASS |
| 4 | No-signup and hand-verified offers visually distinguished | #111 / PR #184 | `app/src/components/OfferDetailPage.tsx:80-82` statusline shows `SignupBadge` + `VerificationBadge`; table rows at `OfferDetailPage.tsx:112-117` and `:130-135`; dimension/value-specific badge classes in `app/src/components/Badge.tsx:40-49` | PASS |

Child issues #112 (unified header/footer) and #113 (all-deals nav icon) shipped
alongside but are outside the epic's four acceptance criteria.

## Verification runs

- `cd app && npm test` — all unit tests pass (incl. `CopyLinkButton.test.tsx`,
  `ClaimChecklist.test.tsx`, `offerDetails.test.ts`, budget gates).
- `cd app && npm run build` — build succeeds; offers validated and prerendered.
