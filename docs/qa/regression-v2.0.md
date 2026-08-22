# v2.0 regression pass — QA record

Issue #30 · Executed 2026-08-22, commit range `v1.1..v2.0` · Environment:
local build (`python3 scripts/build.py` + stdlib unittest; Node VM harness
via node@22).

Scope: the v2.0 surface (#25 retain-and-flag expiry, #26 archive, #27 feed)
plus regression over everything v1.0/v1.1 shipped. Automated checks ran in
this checkout; browser-only checks are listed as manual steps with expected
results for the deploy-time pass.

## Automated results (all green)

| Check | Method | Result |
|---|---|---|
| Offer schema validation | `scripts/validate_offers.py` | 21/21 offers valid |
| Full test suite | `python3 -m unittest discover -s tests` | 278 tests OK (incl. Node behavioral harness) |
| Expired retention doesn't leak into default list | `RetainAndFlagTests`, plus grep of built `site/index.html` | expired entries present only in `index.json`/archive, never on home |
| Null-expiry always active | `test_null_expiry_is_active_regardless_of_build_date` | pass |
| Archive renders correctly | `ArchivePageTests` + built page: text "Expired" badge per card, newest-first order, provider/amount/expiry/category/link present | pass |
| Archive empty state | current catalog has 0 expired → "The archive is empty" renders | pass |
| Feed validity (structural) | XML parse, RSS 2.0 channel elements, RFC-2822 dates, absolute `#offer-` links, atom:self link, escaping tests | pass |
| Feed covers active offers only | `FeedTests.test_items_cover_active_offers_only` | pass |
| Autodiscovery `<link>` + footer RSS on every page | grep across `index.html`, `archive.html`, `privacy.html` | pass (3/3 pages) |
| Home anchors match feed targets | `id="offer-<slug>"` on cards vs item GUIDs | pass |
| GA4 code paths unchanged | analytics/banner test classes; consent-gated events untouched by v2.0 diff | pass |

## W3C RSS validator

Checked 2026-08-22 against the live feed
(`https://luongnv.com/freetokens/feed.xml` — the github.io origin 301s to
the custom domain): **"This is a valid RSS feed."**, zero errors.

## Manual browser pass (deploy-time)

1. **GA4 DebugView** — with consent granted: `page_view` fires on `/`,
   `archive.html`; `offer_click` still carries `offer_id`/`provider`/
   `category`. With consent declined or absent measurement ID: no tracking
   requests at all.
2. **Lighthouse mobile** on `/` and `/archive.html`: expect ≥95 performance,
   ≥90 accessibility (archive ships no JS beyond the shared inline CSS;
   badge is text-based).
3. **320 px viewport**: home grid single-column, footer nav wraps
   (Offers · Archive · Privacy policy · RSS), archive cards readable.
4. **Feed reader smoke test**: subscribe a reader to `/feed.xml`, confirm 21
   items render and item links land on the right offer cards.

## Release

- README updated (retain-and-flag, archive, RSS sections); CHANGELOG added
  with v2.0 notes.
- Annotated tag `v2.0` pushed on the release commit `a76b217`; that commit's
  main-branch deploy went green (run 32559769075). A follow-up `v*` tag
  trigger was removed again: the `github-pages` environment restricts
  deployments by branch pattern, so tag runs are rejected at the deploy job
  ("Tag v2.0 is not allowed to deploy..."). Enabling tag deploys would need a
  settings change under Settings → Environments → github-pages; until then,
  releases deploy via their tagged commit on main.
