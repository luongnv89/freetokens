# Shareable copy — Free AI Credits v1.1

Ready-to-paste copy for the five initial channels. Screenshots follow the
shot-list at the bottom; keep images under ~1 MB and crop to the feature
being shown.

## One-liner (X, LinkedIn, chat)

> I built Free AI Credits — every currently-claimable free AI credit offer
> (API credits, coding agents, image/video/voice tiers), with curator review
> status and expiry dates front and center.
> https://freetokens.custats.info/

## Short blurb (Reddit r/SideProject, Indie Hackers)

> Free AI Credits is a zero-runtime directory of free-credit offers from AI
> providers — the kind of deals permanent "free tools" lists skip because
> they expire. Every entry is verified by hand against the provider's own
> page (verification date shown on each card), so nothing dead or expired
> wastes your time. Filter by category, search instantly, sort by newest /
> expiring-soon / biggest amount, and click through straight to the offer.
> Built as a static site: no accounts, no tracking of what you search.
> Feedback very welcome: https://freetokens.custats.info/

## Show HN text

> Show HN: Free AI Credits – curator-reviewed directory of free AI credit offers
>
> Hi HN! I kept missing time-limited free-credit deals (the "$300 cloud
> credit" class of offers) because permanent-tier lists exclude anything
> that expires. This directory treats expiry as a first-class field: every
> offer carries its source URL, its curator review status, the date it was
> last checked live, and its expiry if it has one. Expired offers drop out on
> rebuild; everything remaining is claimable right now.
>
> It's a fully static page — a Python build script validates 21 YAML offer
> files against a JSON Schema in CI, generates the index, and GitHub Pages
> serves it. No client framework; filtering, search, and sorting are ~200
> lines of vanilla JS with URL-param state. Analytics are consent-gated GA4
> that never sees your search text (only its length).
>
> Catalog highlights right now: $300 Google Cloud trial, $5 Cerebras credit,
> $200 Deepgram credit, Cursor/Copilot/Devin free coding tiers, plus
> image/video/voice free plans across 21 offers and 5 categories.

## Feature callouts (drop into any post)

- **Curator review:** every card shows the offer's review status and when it
  was last checked against the available source — refreshed on every rebuild.
- **Expiring soon sort:** one click reorders the catalog by expiry date;
  ongoing offers sink to the end.
- **Instant filter + search:** category chips and debounced text search,
  shareable via URL params (`?category=voice&sort=expiring`).
- **No dark patterns:** no sign-up walls, no affiliate links, consent-gated
  analytics, privacy policy in plain language.

## Screenshot shot-list

Capture at desktop 1440×900 and mobile 390×844, light theme:

1. **Hero + grid** — masthead with live counts ("21 live offers · X ongoing
   · Y verified") above the card grid.
2. **Expiring-soon sort** — after selecting Sort → "Expiring soon": dated
   offers first, ongoing offers visibly last (URL shows `?sort=expiring`).
3. **Category filter + search combined** — Voice chip active with a query
   typed, showing AND semantics and the results status line
   (`?category=voice&q=…`).
4. **Detail dialog** — an offer's "How to claim & details" panel open with
   steps and social-proof/evidence section.
5. **Verification provenance** — close-up of two cards' "verified <date>"
   lines next to their outbound source links.

## Posting mechanics

- Post from the maintainer accounts listed in docs/outreach-log.md.
- Best windows: X/LinkedIn weekday morning EU+US overlap; Show HN Tue–Thu
  08:00–10:00 ET; Reddit r/SideProject weekends.
- After posting, log channel/link/date in docs/outreach-log.md and set a
  48-hour moderator check reminder.
