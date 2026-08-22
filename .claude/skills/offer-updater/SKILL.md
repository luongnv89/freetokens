---
name: offer-updater
description: Publish or refresh a free-AI-credit offer in the freetokens repo from a screenshot or pasted text. Extracts fields, web-verifies the offer is still live, normalizes into the frozen F5 schema, validates against CI's exact rules, presents the diff, and commits only after explicit curator confirmation. Use when adding, updating, or verifying an offer entry.
license: MIT
metadata:
  issues: "#20,#21"
  epic: "#31"
---

# offer-updater — publish a verified free-AI-credit offer

Turn a screenshot or pasted text describing a free-credit offer into a valid,
web-verified `offers/<slug>.yaml`, without ever inventing a value and never
committing anything the curator did not explicitly approve.
Schema reference: `docs/schema.md`. Ground rules: `CONTRIBUTING.md`.

## What I do

1. **Extract** offer fields from your input (screenshot transcript, pasted
   text, or a source URL you supply).
2. **Verify** on the web that the offer is still live and the terms match.
3. **Normalize** them into the frozen seven-field schema and pick a slug.
4. **Validate** the draft with the deterministic helper in this directory.
5. **Present** the git diff of exactly what would change.
6. **Commit** only after you say yes.

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

## Pipeline

### Step 1 — Extract

Read the screenshot/text and collect all seven fields. Hard rules:

- **Never guess.** A value you cannot read or confirm stays unknown; it is
  never approximated, inferred from similar providers, or copied from stale
  data elsewhere in `offers/`.
- If any required field is unknown after extraction, ask ONE targeted
  clarifying question naming exactly the missing fields, then stop. Do not
  write a partial file to `offers/`.

Illegible input (unreadable screenshot, truncated paste): say which parts are
illegible and ask the targeted question above instead of guessing.

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
```

The comment header is mandatory curation evidence: quote the sentence(s) from
Step 2 that prove title/amount/expiry. Optional enrichment (summary, claim
steps, social proof) lives in `offers/details/<slug>.json` — see
`docs/schema.md` for its rules.

### Step 4 — Validate (deterministic, same rules as CI)

```bash
python3 .claude/skills/offer-updater/validate_offer.py <draft.yaml>
```

Exit `0` + `OK` means the file is byte-for-byte compliant with what CI
enforces — it cannot fail the build. Any failure names the offending file and
field; fix ONLY formatting/validation errors here. If fixing would require
inventing a value, go back to Step 1's clarifying-question rule instead.

### Step 5 — Present the diff

Show the curator exactly what would change, no more and no less:

```bash
git diff --no-index -- <existing-file-if-any> needs_review/<slug>.yaml  # updates
```

plus the full draft content for brand-new offers. State plainly: the target
path (`offers/<slug>.yaml` or `offers/details/<slug>.json`), whether it is a
new file or an edit, and the verification verdict + evidence quote.

### Step 6 — Commit gate (hard rule)

**Nothing is committed, moved into `offers/`, pushed, or opened as a PR
without the curator's explicit yes.**

- Acceptable confirmation: a clear affirmative from the curator in the
  conversation ("yes", "commit it", "ship it") AFTER seeing the Step 5 diff.
  Silence, topic change, or ambiguity is a NO.
- On YES: move the draft into `offers/` (`git mv` for edits), run the
  validator once more on its final path, then follow `CONTRIBUTING.md`
  (branch `<type>/<issue>-<slug>`, Conventional Commits message referencing
  the tracking issue, push, PR whose body starts with `Closes #<issue>`).
- On NO / no answer / unverifiable: leave the draft in `needs_review/`,
  summarize why, and stop. Re-running the skill later resumes from Step 2.

## Why this gate exists

The directory's entire value is trust: every listed offer was verified by a
human against a live official page (§9.3 link-rot/scam mitigation). An agent
that auto-commits unverified entries converts one dead URL into a broken
promise to every visitor. When in doubt, park it in `needs_review/` and ask.
