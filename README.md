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
- The build pipeline (`scripts/`) validates offer files, generates a JSON index, and renders static HTML
- Hosting is GitHub Pages; CI/CD runs validate → build → deploy on push to `main`

## How to Add an Offer

1. Create a new file in `offers/` named after the offer slug, e.g. `offers/my-provider-free-credits.yaml`
2. Fill in the required fields (schema documented in `docs/schema.md`):

   ```yaml
   title: My Provider Free Credits
   provider: My Provider
   category: api_provider   # api_provider | coding | image | voice | video
   amount: $100 in API credits
   expiry_date: 2026-12-31  # null if ongoing
   source_url: https://example.com/offer
   verified_date: 2026-08-21
   ```

3. Verify the offer is live and claimable before committing — never guess missing fields
4. Commit and push; the pipeline validates and deploys automatically

## Local Build

The site is built by a dependency-free Python script (see
[docs/adr-001-static-generator.md](docs/adr-001-static-generator.md) for why a
plain script was chosen over Astro). Requires Python 3.9+, nothing else:

```bash
python3 scripts/build.py    # validates offers/, writes index.json + site/index.html
```

The build runs in two stages:

1. **Validate** — every `offers/*.yaml` is checked against the schema in
   `docs/schema.md`: required fields present, `YYYY-MM-DD` dates, category
   within the enum, unique slugs. Any violation fails the build with a non-zero
   exit naming the offending file and field.
2. **Render** — all validated offers are rendered into a single static
   `site/index.html`: one semantic card per offer with title, provider, amount,
   expiry date (or "ongoing"), a category badge, and an outbound link to the
   official source page. No client-side JavaScript; minimal hand-rolled CSS
   that works down to 320 px viewports.

### Expiry handling

Expiry is evaluated only at build/deploy time, never at view time: the build
drops any offer whose `expiry_date` has passed before rendering, so expired
offers disappear from the site on the **next deploy** (a push to `main`), not
the moment their expiry passes. An offer that expires after the last deploy
stays visible until the next rebuild. The trade-offs behind this decision —
a stale window between deploys in exchange for zero runtime, cacheable static
output, and simplicity — are recorded in
[docs/adr/0001-build-time-expiry.md](docs/adr/0001-build-time-expiry.md),
which also covers how the future archive view (F11) will retain expired
offers while keeping evaluation at build time.

Run the test suite (stdlib `unittest`, no dependencies):

```bash
python3 -m unittest discover -s tests -v
```

## Deployment

Deployment is fully automated via GitHub Actions
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). You never
push built output by hand:

1. **Trigger** — every push to `main` (or a manual `workflow_dispatch` run)
   starts the `Deploy to GitHub Pages` workflow.
2. **Build** — the workflow checks out the repo, runs
   `python3 scripts/build.py` to validate all offers and render
   `site/index.html`, then runs the test suite. Any validation or test failure
   aborts the deploy.
3. **Publish** — the built `site/` directory is uploaded as a Pages artifact
   and deployed with the official Actions toolchain (`actions/checkout`,
   `actions/setup-python`, `actions/configure-pages`,
   `actions/upload-pages-artifact`, `actions/deploy-pages`), using Pages'
   build type `workflow` (source = GitHub Actions).

The live site is served at `https://luongnv89.github.io/freetokens/` — an
offer edit merged to `main` is typically live within 1–2 minutes.

To re-run a deploy manually: **Actions → Deploy to GitHub Pages → Run
workflow**.

## Repository Layout

```
offers/    # One YAML file per free-AI-credit offer (schema: docs/schema.md)
scripts/   # Build/validation scripts (stdlib-only)
tests/     # Build test suite (unittest)
docs/      # Schema docs, ADRs, and other project documentation
```

## License

MIT — see [LICENSE](LICENSE).
