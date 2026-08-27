# Contributing to Free AI Credits

Thanks for wanting to add an offer! Content is managed entirely through git:
every offer is one YAML file under `offers/`, and every change reaches the
site through a pull request. There are two ways to open one — pick whichever
fits you.

> **The React migration did not change this flow.** The site's code moved to
> a Vite + React app under `app/`, but for curators adding an offer is still
> exactly one YAML file — no JavaScript knowledge required.

## Ground rules

- **All changes arrive via pull request.** `main` is protected: direct pushes
  are rejected and the required `validate` status check must pass before
  merge. Settings and rationale live in
  [docs/branch-protection.md](docs/branch-protection.md).
- **Verify before you write.** Never invent an offer or reuse stale data.
  Every entry needs a real `source_url` you have visited and today's
  `verified_date`. Never guess missing fields.
- **Follow the schema.** Required fields, date formats, and the category enum
  are documented in [docs/schema.md](docs/schema.md); CI enforces them with
  `scripts/validate_offers.py`.
- **Use Conventional Commits**, e.g.
  `feat(offers): add provider free credits (#12)`.

## Option A — Open a pull request yourself

1. Fork the repository (or create a branch if you are a collaborator):

   ```bash
   git clone git@github.com:<you>/freetokens.git
   cd freetokens
   git checkout -b feat/12-my-provider-free-credits
   ```

   Name branches `<type>/<issue>-<short-description>` using a `feat/`,
   `fix/`, or `docs/` prefix.

2. Add your offer file at `offers/<provider-slug>.yaml`. Minimal template:

   ```yaml
   title: My Provider Free Credits
   provider: My Provider
   category: api_provider   # api_provider | coding | image | voice | video | startup_program
   amount: $100 in API credits
   expiry_date: 2026-12-31  # null if ongoing
   source_url: https://example.com/offer
   verified_date: 2026-08-22
   verification: social_proof
   review_status: under-review
   signup: required
   ```

   Optionally, enrich the offer's detail card with
   `offers/details/<provider-slug>.json` — a description, how-to-claim
   steps, and evidence-backed social proof (X/Reddit quote cards, links,
   screenshots). Field reference and rules:
   [docs/schema.md](docs/schema.md#detail-files-offersdetailsslugjson--optional).

3. Check everything locally before pushing:

   ```bash
   python3 scripts/validate_offers.py         # validates offers/ against the schema
   (cd app && npm test)                       # app unit + budget tests (Vitest)
   ```

4. Commit and push:

   ```bash
   git add offers/my-provider-free-credits.yaml
   git commit -m "feat(offers): add My Provider free credits (#12)"
   git push -u origin feat/12-my-provider-free-credits
   ```

5. Open a pull request against `main`. Start the description with
   `Closes #<issue>` so the tracking issue closes automatically on merge.
   Once the `validate` check is green, a maintainer squash-merges and the
   deploy pipeline typically publishes the site within 1–2 minutes.

## Option B — Let the agent skill open the pull request

This repository ships agent guidance in [AGENTS.md](AGENTS.md), so any coding
agent that reads it (opencode, Claude Code, and similar tools) can verify an
offer and open the pull request for you. You only supply the initial
information below — the agent handles verification, file creation, validation,
and the PR mechanics, following exactly the same conventions as Option A.

**What you provide:**

1. The offer's `source_url` — the official page describing the free credits.
2. Optionally: a screenshot transcript of that page, and the issue number
   tracking the offer.

**What the agent does** (per the `offer-verifier` agent definition):

1. Fetches the source page and confirms the offer is currently live and
   claimable, producing a verdict (`live | expired | unverifiable`) with the
   quoted evidence sentence and access date.
2. Extracts the normalized YAML fields (`title`, `provider`, `category`,
   `amount`, `expiry_date`, …), marking anything it could not confirm as
   unknown instead of guessing.
3. Creates `offers/<slug>.yaml` on a `<type>/<issue>-<slug>` branch, runs the
   local validation commands, commits, and opens a pull request whose body
   links the tracking issue.
4. Reports the PR URL back to you (and comments on the tracking issue when
   one was given).

If the source page cannot be verified, the agent says so and stops rather
than publishing — unverified entries never enter the directory.

## Pull-request checklist

- [ ] `python3 scripts/validate_offers.py` passes locally
- [ ] You personally visited `source_url`; `verified_date` is today's date
- [ ] No guessed values — uncertain fields are marked unknown, not filled in
- [ ] Commit message follows Conventional Commits and references the issue
- [ ] PR description starts with `Closes #<issue>`

## Reporting problems

Found an expired offer or a broken link? Open an issue describing what you
saw (ideally including the current state of the `source_url` page). Fixes
follow either path above.
