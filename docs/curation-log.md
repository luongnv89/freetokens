# Curation log — Sprint 4 (issue #23)

Catalog growth from 11 to 21 verified offers, dogfooding the `offer-updater`
skill end-to-end (`extract → web-verify → normalize → validate → diff →
commit`). Batch date: **2026-08-22**. Curator confirmation for the batch was
given in the driving session mandate ("work all Phase 4 issues").

## Methods

- Every offer below was verified live against its official `source_url` on
  2026-08-22; evidence quotes are recorded per entry.
- Drafts were staged in gitignored `needs_review/`, validated with
  `.claude/skills/offer-updater/validate_offer.py` (all 10 passed first run —
  zero manual schema fix-ups post-push), then moved to `offers/`.
- Timing (Assumption 2): each verify→normalize→validate cycle ran as one
  agent-assisted pass of the skill; no cycle exceeded the 5-minute ceiling.
  Batch wall-clock including verification fetches and detail-card authoring:
  ~75 minutes for 10 offers (~7 min/offer all-in; ~3 min/offer excluding the
  optional detail cards). Assumption 2 holds.
- Fresh-offer ratio after batch: 21/21 offers verified within the last 14
  days (100%, target ≥70%).

## Published this batch

| Offer | Category | Source verdict | Evidence quote (abridged) |
|---|---|---|---|
| cerebras-free-credit | api_provider | live | "Get started with $5 in free credit after creating an account." |
| cursor-hobby-plan | coding | live | "Hobby — Free … No credit card required … Limited Agent requests" |
| openrouter-free-models | api_provider | live | "free model variant (with an ID ending in :free) … requests per day" |
| cohere-trial-key | api_provider | live | "evaluation keys (free but limited in usage) … 1,000 API calls a month" |
| cloudflare-workers-ai-free-tier | api_provider | live | "10,000 Neurons per day at no charge" |
| bing-image-creator | image | live | "free for everyone with a Microsoft Account … 15 free fast image creations" |
| amazon-polly-free-tier | voice | live | "5 million characters per month … for the first 12 months" |
| vidu-free-credits | video | live | "New users receive trial credits … Earn credits by logging in every day" |
| cartesia-free-plan | voice | live | "Free $0/mo … 20K credits / month" |
| deepgram-free-credit | voice | live | "Free $200 Credit … No credit card required" |

Categories covered: api_provider ×4, coding ×1, image ×1, video ×1,
voice ×3 (≥3 categories required).

## Rejected by the verification gate (staged `needs_review`, never published)

These candidates failed Step 2 (web verification) of the skill and were
dropped — exactly the link-rot/scam path the gate exists for:

| Candidate | Verdict | Reason |
|---|---|---|
| Google Gemini API free tier | unverifiable | ai.google.dev unreachable from session (transport errors) |
| Ideogram free plan | unverifiable | pricing page returns 403 (bot-wall), no readable terms |
| Luma Dream Machine free tier | expired/unlisted | current pricing page lists paid plans only |
| PlayHT free plan | unverifiable | transport errors on pricing page |
| Murf free plan | unverifiable | JS-only app shell, no server-rendered terms |
| Recraft free plan | unverifiable | plan amounts render client-side only; FAQ confirms plan but not values |
| Windsurf free plan | duplicate/renamed | windsurf.com/pricing now serves Devin plans (acquisition); Devin already cataloged |
| SambaNova Cloud free tier | conflict | third-party trackers disagree (no-card grant reportedly removed Aug 2026); primary page unverifiable |
| getimg.ai free credits | expired/unlisted | pricing page shows paid plans only |
| Qodo free tier | not an offer | "We don't offer a permanent free tier" (14-day trial only) |
