---
name: offer-updater
description: "Publish or refresh a verified free-AI-credit offer from screenshot or text — extracts, web-verifies live status, normalizes to F5 schema, validates, diffs, commits on approval. Don't use for general scraping, unrelated YAML, or bulk imports."
license: MIT
metadata:
  version: "1.1.0"
  issues: "#20,#21"
  epic: "#31"
---

# offer-updater — publish a verified free-AI-credit offer

Turn a screenshot or pasted text describing a free-credit offer into a valid,
web-verified `offers/<slug>.yaml`, without ever inventing a value and never
committing anything the curator did not explicitly approve.
Schema reference: `docs/schema.md`. Ground rules: `CONTRIBUTING.md`.

## Repo Sync Before Edits (mandatory)

Before touching `offers/`, `offers/details/`, or any git-tracked file:

```bash
branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin && git pull --rebase origin "$branch"
```

- If the working tree is dirty (`git status --porcelain` non-empty): `git stash push -m "offer-updater pre-sync"`, sync, then `git stash pop`. If pop conflicts, stop and ask the curator how to resolve before continuing.
- If `origin` is missing or the rebase conflicts: stop, report the error verbatim, and ask the curator before continuing. Never force-push or skip the sync.

## What I do

1. **Extract** offer fields from your input (screenshot transcript, pasted
   text, or a source URL you supply), plus any claim instructions the input
   contains.
2. **Verify** on the web that the offer is still live and the terms match —
   keeping a full **reference trace** of every URL visited for evidence.
3. **Normalize** them into the frozen ten-field schema and pick a slug,
   writing the reference trace into `offers/details/<slug>.json`.
4. **Validate** the draft with the deterministic helper in this directory.
5. **Present** the git diff of exactly what would change (including the reference trace).
6. **Commit** only after you say yes — then open a tracking issue and PR.

## The frozen schema (F5)

| Field           | Rule                                                                  |
|-----------------|-----------------------------------------------------------------------|
| `title`         | Human-readable offer name (non-empty).                                |
| `provider`      | Company/product granting the credit (non-empty).                      |
| `category`      | Exactly one of: `api_provider`, `coding`, `image`, `voice`, `video`.  |
| `amount`        | Free value in human terms, e.g. `$300 in credits` (non-empty).        |
| `expiry_date`   | `YYYY-MM-DD` the offer stops being claimable, or explicit `null` if ongoing. |
| `source_url`    | Official provider page describing the offer (`http(s)://`).           |
| `verified_date` | Date YOU verified the offer is live, `YYYY-MM-DD`, never null, never future. |
| `verification` | Evidence level: `hand_verified`, `social_proof`, or `unverified`. |
| `review_status` | Curator testing state: `verified`, `unverified`, or `under-review`. |
| `signup` | Whether claiming needs an account: `none` or `required`. |

## Pipeline

### Step 1 — Extract

Read the screenshot/text and collect all ten fields. Hard rules:

- **Never guess.** A value you cannot read or confirm stays unknown; it is
  never approximated, inferred from similar providers, or copied from stale
  data elsewhere in `offers/`.
- If any required field is unknown after extraction, ask ONE targeted
  clarifying question naming exactly the missing fields, then stop. Do not
  write a partial file to `offers/`.

Illegible input (unreadable screenshot, truncated paste): say which parts are
illegible and ask the targeted question above instead of guessing.

**Claim instructions.** While extracting, also capture HOW to get the offer if
the input says so — signup URL, promo code, CLI command, plan tier, eligibility
restrictions (region/student/new-user), or usage limits. Record them verbatim
in the Step 5 presentation as a "How to claim" list; they feed the optional
`offers/details/<slug>.json` `claim_steps` enrichment and the tracking issue
body. Claim instructions never enter the ten YAML fields — they are
supporting evidence only, and like everything else they are never invented:
if the input is silent on how to claim, omit the section entirely.

**X source posts become embedded evidence.** If `source_url` (or any cited
evidence in the input) is an x.com/twitter.com post, ALWAYS create the detail
file `offers/details/<slug>.json` alongside the YAML with a `social_proof`
entry of type `x` so the post renders as a quote card on the offer's detail
page — never leave an X-sourced offer without it. Fill `url` from the post;
fetch `author`/`handle`/`text` automatically from Twitter's public oEmbed
endpoint (`https://publish.twitter.com/oembed?url=<post-url>`) rather than
asking the curator to copy-paste. The oEmbed response's `author_name` maps to
`author` (`@author_name` → `handle`); take `text` from the post content you
already fetched in Step 2 (oEmbed returns HTML, not plain text). If oEmbed is
unreachable, fall back to the text captured during verification. This embeds
the post statically at build time (no third-party scripts, per
docs/schema.md) and preserves the evidence if the post is later deleted.
Add `summary` and `claim_steps` to the same file when you have them.

### Step 2 — Verify on the web (trust policy)

Verification is on by default; the curator may explicitly say
"skip verification", in which case `verified_date` keeps today's date ONLY if
the input itself is first-hand evidence (a fresh screenshot), and every field
the page would have confirmed must be reported as unverified in Step 6.

When verification runs:

1. Fetch `source_url`. If the curator supplied none, ask for it — an offer
   without an official source is unpublishable.
2. Render one of three verdicts, quoting the sentence(s) that prove it:
   - **live** — offer currently claimable and terms match the extracted
     values → `verified_date: <today>`, and record the quoted evidence as the
     comment header's source note.
   - **expired / dead URL** — page gone, offer withdrawn, or dates passed →
     do NOT create or update any `offers/` file.
   - **unverifiable** — page unreachable, bot-walled, or silent about the
     claimed terms → treat as expired/dead above until proven otherwise.
3. Any offer that is not **live** is staged as `needs_review/<slug>.yaml`
   with a header note explaining what failed. **Nothing unverifiable is ever
   committed** — `needs_review/` is gitignored precisely so a stray
   `git add .` cannot leak an unverified entry into the site.
4. **Conflicts** between the screenshot/input and the web page (different
   amounts, expiry dates, eligibility) are surfaced side-by-side in a small
   table — input claim vs page quote vs proposed resolution — and REQUIRE an
   explicit human decision before any file is written. Never silently pick a
   winner.

#### Reference trace — keep every URL you touch (mandatory)

During verification you will inevitably fetch more than just `source_url`:
redirects, docs pages, pricing pages, announcement blog posts, changelog
entries, or a secondary search result that confirms eligibility. **Keep a
trace of every relevant URL you visit** and persist it as evidence — never
discard the chain of sources that justified the verdict.

Rules:

- **Collect as you go.** Start the trace with `source_url`. Append every
  additional URL you actually fetched whose content informed the verdict
  (HTTP 200 and contains terms you quoted or relied on). Skip dead links,
  bot-wall pages, and incidental search-engine result pages that added
  nothing.
- **Capture title + excerpt.** For each URL, record `title` (page
  `<title>` or first `h1`, ≤200 chars) and a short `text` excerpt (the
  quoted sentence that proves the offer, ≤500 chars). These map directly to
  `social_proof` `link` fields in `offers/details/<slug>.json` — see
  `docs/schema.md` and `schemas/offer-detail.schema.json` for limits.
- **Deduplicate and cap.** Normalize URLs (strip fragments, trailing
  slashes), deduplicate, keep `source_url` first, then discovery order.
  Hard cap at **10 entries total** for `social_proof` (schema limit); if
  the trace would exceed 10, keep `source_url` + the 9 most authoritative
  provider-domain pages and drop aggregators/third-party mirrors first.
  X/Reddit posts remain type `x`/`reddit` — only generic pages use type
  `link`.
- **Persist in the detail file.** The trace lives in
  `offers/details/<slug>.json` under `social_proof` as entries of type
  `link` (or `x`/`reddit` where applicable). If a detail file already
  exists, **merge**: preserve existing `summary`/`claim_steps`, append new
  trace entries that are not already present (compare normalized `url`),
  and never duplicate the same URL. If no detail file exists, create one
  with the trace as its `social_proof` (at least one entry is enough to
  satisfy `minProperties: 1`).
- **Evidence only.** Every traced URL must be one you fetched and verified.
  Never invent titles, excerpts, or URLs. If a fetch failed, do not add it.
- **Why this exists.** The reference trace is the audit trail that lets any
  future curator re-verify the offer without re-discovering sources, and it
  satisfies `docs/schema.md` "Evidence only" for `social_proof`.

The Step 3 normalizer and Step 5 presentation both consume this trace.

### Step 3 — Normalize

Slug = lowercase ASCII words separated by single hyphens
(`^[a-z0-9]+(-[a-z0-9]+)*$`), matching the target filename
`offers/<slug>.yaml`. Draft template (written to `needs_review/<slug>.yaml`
until Step 6):

```yaml
# Verified <YYYY-MM-DD> against <source_url>
# ("<short quote proving the offer text>")
title: ...
provider: ...
category: ...            # api_provider | coding | image | voice | video
amount: ...
expiry_date: null        # or YYYY-MM-DD
source_url: https://...
verified_date: YYYY-MM-DD
verification: hand_verified
review_status: under-review
signup: required
```

The comment header is mandatory curation evidence: quote the sentence(s) from
Step 2 that prove title/amount/expiry. Optional enrichment (summary, claim
steps, social proof / reference trace) lives in `offers/details/<slug>.json` — see
`docs/schema.md` for its rules. When a reference trace was collected in Step 2,
the detail file MUST contain it as `social_proof` entries of type `link`
(or `x`/`reddit` for social posts), merged as described above. Example detail
with a reference trace:

```json
{
  "summary": "Cerebras grants $20 in inference credits for new signups.",
  "claim_steps": ["Create an account at inference.cerebras.ai.", "Credits apply automatically at signup."],
  "social_proof": [
    {
      "type": "link",
      "url": "https://inference.cerebras.ai/policies/credits",
      "title": "Cerebras Inference Credits Policy",
      "text": "New users receive $20 in free inference credits upon signup."
    },
    {
      "type": "link",
      "url": "https://cerebras.ai/blog/announcing-free-credits",
      "title": "Announcing Free Inference Credits",
      "text": "We are offering $20 in free credits to try Cerebras Inference."
    }
  ]
}
```

### Step 4 — Validate (deterministic, same rules as CI)

```bash
python3 .claude/skills/offer-updater/validate_offer.py <draft.yaml>
# also validate the detail file if one was created/updated:
python3 scripts/validate_offers.py  # validates offers/ and offers/details/*.json (CI gate)
```

Exit `0` + `OK` means the file is byte-for-byte compliant with what CI
enforces — it cannot fail the build. Any failure names the offending file and
field; fix ONLY formatting/validation errors here. If fixing would require
inventing a value, go back to Step 1's clarifying-question rule instead.
For detail files, watch the `social_proof` limits: ≤10 entries, `url`
≤200 chars, `title` ≤200 chars, `text` ≤500 chars — the validator reports the
exact offending index.

### Step 5 — Present the diff

Show the curator exactly what would change, no more and no less:

```bash
git diff --no-index -- <existing-file-if-any> needs_review/<slug>.yaml  # updates
# and for the detail file:
git diff --no-index -- offers/details/<slug>.json needs_review/details/<slug>.json  # if new or updated
```

plus the full draft content for brand-new offers (and the detail JSON if one
was created). State plainly: the target
path (`offers/<slug>.yaml` or `offers/details/<slug>.json`), whether it is a
new file or an edit, and the verification verdict + evidence quote. If claim
instructions were extracted, include them under a "How to claim" heading.
**Always list the reference trace** under a "References verified" heading —
each URL with its title and the quoted excerpt — so the curator can see the
audit trail before approving.

### Step 6 — Commit gate (hard rule)

**Nothing is committed, moved into `offers/`, pushed, or opened as a PR
without the curator's explicit yes.**

- Acceptable confirmation: a clear affirmative from the curator in the
  conversation ("yes", "commit it", "ship it") AFTER seeing the Step 5 diff.
  Silence, topic change, or ambiguity is a NO.
- On YES: move the draft into `offers/` (`git mv` for edits), stage the
  matching `offers/details/<slug>.json` if one was created or updated (it
  now carries the reference trace), run the
  validator once more on its final path (`validate_offer.py` for the YAML
  and `python3 scripts/validate_offers.py`
  for the detail JSON), then follow `CONTRIBUTING.md`:
  1. **Create the tracking issue** with `gh issue create` (unless the curator
     supplied one). Title: `Add <provider> <short offer name>`. Body: provider,
     what is free, amount, expiry, source URL, the full **References
     verified** list (one bullet per traced URL with title), and any extracted "How to
     claim" steps, plus the verification date.
  2. Branch `<type>/<issue>-<slug>` from current `main`.
  3. Commit with a Conventional Commits message referencing the issue, e.g.
     `feat(offers): add <Provider> offer (#<issue>)`, and push.
  4. Open the PR whose body starts with `Closes #<issue>`, include the
     verification verdict + evidence quote, the **References verified** list,
     and the local-check results
     (validator, `scripts/offer_model.py`, test suite).
- On NO / no answer / unverifiable: leave the draft in `needs_review/`,
  summarize why (including which reference URLs were checked and why they
  failed), and stop. Re-running the skill later resumes from Step 2.

## Why this gate exists

The directory's entire value is trust: every listed offer was verified by a
human against a live official page (§9.3 link-rot/scam mitigation). An agent
that auto-commits unverified entries converts one dead URL into a broken
promise to every visitor. When in doubt, park it in `needs_review/` and ask.
