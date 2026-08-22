---
name: offer-updater
description: Publish or refresh a free-AI-credit offer in the freetokens repo from a screenshot or pasted text. Extracts offer fields, normalizes them into the frozen F5 schema, validates the draft against CI's exact rules with a deterministic helper, and hands a commit-ready offers/<slug>.yaml to the curator. Use when adding, updating, or verifying an offer entry.
license: MIT
metadata:
  issue: "#20"
  epic: "#31"
---

# offer-updater — publish a verified free-AI-credit offer

Turn a screenshot or pasted text describing a free-credit offer into a valid
`offers/<slug>.yaml` that is guaranteed to pass CI, without ever inventing a
value. Schema reference: `docs/schema.md`. Ground rules: `CONTRIBUTING.md`.

## What I do

1. **Extract** offer fields from your input (screenshot transcript, pasted
   text, or a source URL you supply).
2. **Normalize** them into the frozen seven-field schema and pick a slug.
3. **Validate** the draft with the deterministic helper in this directory.
4. **Present** the draft plus its validation proof for curator review.

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
- `verified_date` is today's date only when you have actually confirmed the
  offer is currently live (via the input itself or by fetching `source_url`).
- If any required field is unknown after extraction, ask ONE targeted
  clarifying question naming exactly the missing fields, then stop. Do not
  write a partial file to `offers/`.

Illegible input (unreadable screenshot, truncated paste): say which parts are
illegible and ask the targeted question above instead of guessing.

### Step 2 — Normalize

Slug = lowercase ASCII words separated by single hyphens
(`^[a-z0-9]+(-[a-z0-9]+)*$`), matching the target filename
`offers/<slug>.yaml`. Draft template:

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

The comment header is mandatory curation evidence: quote the sentence(s) that
prove title/amount/expiry. Optional enrichment (summary, claim steps, social
proof) lives in `offers/details/<slug>.json` — see
`docs/schema.md` for its rules.

While drafting, keep incomplete work OUT of `offers/` (CI validates that
directory wholesale). Use any scratch location, e.g. `needs_review/<slug>.yaml`
or a temp dir.

### Step 3 — Validate (deterministic, same rules as CI)

```bash
python3 .claude/skills/offer-updater/validate_offer.py <draft.yaml>
```

Exit `0` + `OK` means the file is byte-for-byte compliant with what CI
enforces — it cannot fail the build. Any failure names the offending file and
field; fix ONLY formatting/validation errors here. If fixing would require
inventing a value, go back to Step 1's clarifying-question rule instead.

### Step 4 — Present for curator review

Show the curator:

- the final YAML,
- the helper's `OK` line (validation proof),
- the source URL you extracted from, and anything you could not verify.

Do NOT commit on your own initiative. Moving the file into `offers/`,
committing, pushing, and opening the PR follow `CONTRIBUTING.md` and happen
only with the curator's explicit confirmation.
