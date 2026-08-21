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

## Repository Layout

```
offers/    # One YAML file per free-AI-credit offer
scripts/   # Build/validation scripts
docs/      # Schema docs, ADRs, and other project documentation
```

## License

MIT — see [LICENSE](LICENSE).
