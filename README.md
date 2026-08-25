# Free AI Credits

A dead-simple, static website that aggregates currently-claimable free AI token/credit offers — hand-picked and self-verified by a single trusted curator. Visitors find relevant offers in seconds via filtering, search, and task categories. Content is managed entirely through git: updating the site is a commit, not an ops task.

## Purpose

Free AI credit offers are scattered across X threads, Reddit posts, and vendor blogs, and limited-time promos expire before people hear about them. This project collects verified, currently-claimable offers in one place and keeps them fresh.

## Target Users

1. **Indie devs / hobbyist developers** building side projects on free tiers who hunt for free AI API credits weekly.
2. **AI content creators** cycling through image/video/voice free trials.
3. **DevRel/growth teams at smaller AI providers** (future audience) who need developer acquisition channels.

## Content Model

The site is fully static with no server, no database, no runtime:

- Every offer lives as one YAML file: `offers/<slug>.yaml`
- The build pipeline validates offer files, bundles the React app, and
  prerenders every route to static HTML
- Hosting is GitHub Pages; CI/CD runs validate → build → deploy on push to `main`

## How to Add an Offer

1. Create a new file in `offers/` named after the offer slug, e.g. `offers/my-provider-free-credits.yaml`
2. Fill in the required fields (schema documented in `docs/schema.md`):

   ```yaml
   title: My Provider Free Credits
   provider: My Provider
   category: api_provider   # api_provider | coding | image | voice | video | startup_program
   amount: $100 in API credits
   expiry_date: 2026-12-31  # null if ongoing
   source_url: https://example.com/offer
   verified_date: 2026-08-21
   ```

3. Verify the offer is live and claimable before committing — never guess missing fields
4. Commit and push; the pipeline validates and deploys automatically

## Contributing

Offer submissions go through pull requests — see
[CONTRIBUTING.md](CONTRIBUTING.md) for both paths: opening a PR yourself, or
supplying just the offer's source URL and letting the repository's agent
skill verify it and open the PR for you.

## Local Build

The site is a Vite + React 19 app under `app/` (see
[docs/adr/0002-react-vite-migration.md](docs/adr/0002-react-vite-migration.md)
for why the Python builder was replaced). Requires Node 22+:

```bash
cd app && npm ci             # installs dependencies (never bare npm install in CI)
npm run dev                  # dev server with hot reload at http://localhost:5173/
npm run build                # validates offers/, bundles, and prerenders every route
```

Components and pages live in `app/src/components/`, data/analytics helpers
in `app/src/lib/`, and routing in `app/src/routes.ts`.

The build runs in two stages:

1. **Validate** — every `offers/*.yaml` is checked against the schema in
   `docs/schema.md`: required fields present, `YYYY-MM-DD` dates, category
   within the enum, unique slugs. Any violation fails the build with a non-zero
   exit naming the offending file and field.
2. **Render** — validated offers are compiled into static pages: the offer
   list (`index.html`, one semantic card per active offer), the
   expired-offer archive (`archive.html`), the privacy policy, an RSS 2.0
   feed (`feed.xml`), and a detail page per offer. Cards carry title,
   provider, amount, expiry date (or "ongoing"), a category badge, and an
   outbound link to the official source page. Tailwind CSS that works down
   to 320 px viewports.

### Expiry handling

Expiry is evaluated only at build/deploy time, never at view time: an offer
whose `expiry_date` has passed is flagged on the **next deploy** (a push to
`main`), not the moment its expiry passes.

Since v2.0 (#25) expiry works as **retain-and-flag**: every validated offer
stays in the generated `index.json`, each entry stamped with a build-time
`"status": "active" | "expired"` (null-expiry offers are always `active`).
What changes between rebuilds is only visibility:

- the home list renders **active** offers exactly as before;
- expired entries move to the [offer archive](#offer-archive) and out of the
  RSS feed instead of disappearing.

The trade-offs behind evaluating expiry at build time rather than view time —
a stale window between deploys in exchange for zero runtime, cacheable static
output, and simplicity — are recorded in
[docs/adr/0001-build-time-expiry.md](docs/adr/0001-build-time-expiry.md).

### Offer archive

The archive route (`/archive.html`, #26/F11) renders
every entry flagged `expired`, newest expiration first. Each archived card
keeps its full context — provider, amount, original expiry date, category
badge, and the outbound source link — under an explicit text **Expired**
badge, so the state never relies on color alone. The archive is linked from
the footer of every page and from the home page's empty state ("browse the
archive"), and it has its own friendly empty state while nothing has lapsed.

### RSS feed

The build emits a valid RSS 2.0 document at
`/feed.xml` (`feed.xml`, #27/F12) covering every
**active** offer: title, absolute link to the offer's detail page, an
amount/category/expiry summary, and the verified date as `pubDate`. Expired
offers are excluded; ongoing ones are included normally. Every generated page
ships RSS autodiscovery in `<head>` and a footer link. Item URLs must be
absolute per the RSS spec, so the feed
uses the production origin by default.

Run the test suites:

```bash
cd app && npm test           # unit + budget tests (Vitest)
npm run test:e2e             # Playwright end-to-end tests
```

The content model has its own stdlib test suite at the repo root (no Node
required):

```bash
python3 -m unittest discover -s tests -v
```

### Search & category filtering

The built page ships a small vanilla-JS layer (one inline `<script>`, no
framework) that narrows offers without reloads or network fetches:

- **Text search** over each card's title, provider, and amount, debounced at
  120 ms so results stay well under the 200 ms latency budget even at 500
  offers.
- **Category filters** (`All`, API providers, Coding, Image, Voice, Video)
  combine with search using AND semantics.
- **Shareable URL state** — the active view persists in `?category=` and
  `?q=`, deep-links restore it, and back/forward buttons work via the
  history API. Only these two whitelisted params are ever written back;
  anything else in the query string is dropped.
- **Accessible by construction** — native buttons and inputs (keyboard
  operable, visible focus), `aria-pressed` chip state, a labeled search box,
  a `role="status"` live region announcing "Showing X of Y offers", and a
  friendly empty state with a working reset button.

### Offer detail pages

Every card links to a dedicated detail page at `offers/<slug>.html`,
generated at build time — no extra fetches, no framework, fully
shareable URLs. The page shows the full offer picture: description, an
ordered how-to-claim list, social-proof cards (static X/Reddit quote
cards, links, and screenshots — never third-party embed scripts), and a
direct claim link. Expired offers keep their page with an explicit
"Expired" badge and no claim link. Archive rows and RSS items point at
the same pages. Curated content comes from optional per-offer sidecar
files, `offers/details/<slug>.json`, validated against
`schemas/offer-detail.schema.json`; offers without one still get a detail
page built from the core listing fields. The field reference lives in
[docs/schema.md](docs/schema.md#detail-files-offersdetailsslugjson--optional).

### Analytics & consent (GA4)

Google Analytics 4 is **opt-in at build time** and off by default. While no
measurement ID is configured, the build emits **no tracking code, no consent
banner, and no analytics script** — only the site's own filter/search script
described above ships.

To enable it:

1. Create a GA4 web property and copy its Measurement ID (`G-XXXXXXXXXX`).
2. Add it as a repository secret named `GA_MEASUREMENT_ID`
   (**Settings → Secrets and variables → Actions**). The deploy workflow
   already passes it to the build step; the next deploy turns tracking on.
3. For local builds, export it in your shell: `GA_MEASUREMENT_ID=G-… npm run build`.

A malformed ID never breaks a deploy — the build warns and continues with
analytics disabled.

When enabled, the page ships a small progressive-enhancement layer:

- **Consent Mode v2 first** — consent defaults are installed as *denied*
  in `<head>`, and `gtag.js` is only injected after an explicit grant, so
  declining sends no tracking requests whatsoever.
- **EU consent banner** — visitors whose IANA timezone starts with
  `Europe/` (a client-side heuristic approximation of geo-targeting, not a
  precise location check) see a lightweight banner until they choose
  Accept or Decline; the decision persists in `localStorage` under
  `ft_ga_consent`. The banner loads after `window.load` via
  `requestIdleCallback`, is keyboard-accessible (native buttons,
  <kbd>Esc</kbd> declines), and adds effectively nothing to page load.
- **IP anonymization** — the gtag config sets `anonymize_ip: true`;
  note that GA4 also anonymizes/geolocates at coarser granularity by
  default before any hit leaves the browser.
- **Silent degradation** — if GA4 is blocked by an adblocker or offline,
  everything else on the page (including outbound offer links) works
  exactly as before; tracking loss is accepted silently.
- **Privacy-safe feature events** — `filter_use` carries only the category
  name; `search` events carry **only** `query_length`, never the raw query.
  Both fire through the same consent gate as page views: with analytics
  unconfigured or consent declined they are silent no-ops.
- **Offer attribution** — every outbound offer link carries its identity as
  data attributes and fires a single `offer_click` event with `offer_id`,
  `provider`, and `category` when clicked (same consent gate). The send is
  fire-and-forget and links open in a new tab without JS interception, so a
  blocked or broken tracker can never delay or break navigation; accidental
  rapid double-clicks on the same offer are deduplicated to one event.

### Live traffic stats (#62)

Alongside GA4 the site can display **live visitor traffic** — a footer strip
showing visitors today and over the trailing 90 days, refreshed on every
page load, plus a link to the full public dashboard. This is deliberately
different from the masthead's build-time offer counters: these numbers move
without a rebuild.

The provider is [GoatCounter](https://www.goatcounter.com) — open-source,
cookieless analytics whose hosted service is free for non-commercial sites.
Like everything else it is **opt-in at build time** via one repository
secret:

1. `GOATCOUNTER_SITE_URL` — the https origin of your GoatCounter site
   (e.g. `https://luongnv89.goatcounter.com`, no path).

Unset keeps zero stats markup in the output; malformed values disable
traffic counting with a build warning. When enabled:

- Every page ships the GoatCounter tracker beacon so all traffic counts.
- Pages that run the site script also emit the hidden footer strip; a small
  client-side module fetches today + 90-day totals from GoatCounter's public
  JSON counter route (`/counter/TOTAL.json`) and reveals the numbers.
- **Silent degradation** — offline, ad-blocked, erroring, or malformed
  responses leave the strip hidden forever and nothing else changes.

> Requires enabling **"Allow adding visitor counts on your website"**
> (Settings → Visitor counter) in the GoatCounter dashboard; otherwise the
> counter route is private and the strip stays hidden.

Full operator instructions live in
[docs/traffic-stats-setup.md](docs/traffic-stats-setup.md).

### Privacy policy page

The app also serves [`/privacy.html`](https://luongnv89.github.io/freetokens/privacy.html)
(Task 3.5, PRD §5.2): a plain-language policy rendered from the same
components and design tokens as the home page, so it always matches the site
design. The footer on every page links to it with relative hrefs, so the
links resolve under any deploy base (including the `/freetokens/` Pages
project path). Every factual claim in the policy mirrors implemented
behavior in `app/src/lib/analytics.ts` — consent-gated GA4, anonymized IPs,
length-only search metadata, the single `localStorage` consent key, no
forms, no PII storage — and is pinned by tests (`ConsentBanner.test.tsx`,
`analytics.test.ts`).

## Deployment

Deployment is fully automated via GitHub Actions
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). You never
push built output by hand:

1. **Trigger** — every push to `main` (or a manual `workflow_dispatch` run)
   starts the `Deploy to GitHub Pages` workflow. Release tags are cut on
   main commits that have already deployed; the Pages environment is
   branch-restricted, so tag pushes do not (and cannot) deploy directly.
2. **Build** — the workflow checks out the repo, runs
   `python3 scripts/validate_offers.py` to validate all offers, then
   `npm test` and `npm run build` in `app/` to prerender `index.html`,
   `archive.html`, `privacy.html`, `feed.xml`, and every offer detail page.
   Any validation or test failure aborts the deploy.
3. **Publish** — the built `app/dist` directory is uploaded as a Pages
   artifact and deployed with the official Actions toolchain
   (`actions/checkout`, `actions/setup-node`, `actions/configure-pages`,
   `actions/upload-pages-artifact`, `actions/deploy-pages`), using Pages'
   build type `workflow` (source = GitHub Actions).

The live site is served at `https://luongnv89.github.io/freetokens/` — an
offer edit merged to `main` is typically live within 1–2 minutes.

To re-run a deploy manually: **Actions → Deploy to GitHub Pages → Run
workflow**.

## Repository Layout

```
offers/    # One YAML file per free-AI-credit offer (schema: docs/schema.md)
           # plus optional offers/details/<slug>.json detail documents
app/       # Vite + React source: components, lib, tests, prerender scripts
scripts/   # offer_model.py (frozen schema/validation core) + validate_offers.py
tests/     # Content-model test suite (unittest)
docs/      # Schema docs, ADRs, outreach kit, decision records, QA notes
index.json # Frozen generated index: every offer with build-time active/expired status
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
