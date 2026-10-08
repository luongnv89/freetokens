# Offer Schema (`offers/*.yaml`)

One YAML file per free-AI-credit offer. The file name is the offer slug:
lowercase, hyphen-separated, ASCII, no trailing hyphen — e.g.
`google-cloud-300-free-trial.yaml`. The slug must be stable once published;
it becomes the offer's identity in the JSON index and URLs.

## Fields

Exactly ten fields. All are required; unknown fields are rejected by the
build validator.

| Field           | Type                  | Required | Nullability | Description |
|-----------------|-----------------------|----------|-------------|-------------|
| `title`         | string (non-empty)    | yes      | no          | Human-readable offer name shown on cards. |
| `provider`      | string (non-empty)    | yes      | no          | Company or product offering the credit. |
| `category`      | enum (string)         | yes      | no          | One of: `api_provider`, `coding`, `image`, `voice`, `video`, `startup_program`, `student`, `oss_program`. |
| `amount`        | string (non-empty)    | yes      | no          | Free value in human terms, e.g. `$300 in credits` or `10k credits/month`. |
| `expiry_date`   | date or null          | yes      | **yes**     | Date the offer stops being claimable, `YYYY-MM-DD`. `null` = ongoing offer with no fixed end date. |
| `source_url`    | URL string            | yes      | no          | Official provider page where the offer is described. Must start with `http://` or `https://`. |
| `verified_date` | date                  | yes      | no          | Date the curator last confirmed the offer is live and claimable, `YYYY-MM-DD`. This is the **Last checked** date. |
| `verification` | enum (string)         | yes      | no          | Evidence level: `social_proof` or `unverified`. |
| `review_status` | enum (string)        | yes      | no          | Curator testing state: `verified`, `unverified`, `under-review`, or `to-be-verified`. |
| `signup`       | enum (string)         | yes      | no          | Whether claiming needs an account: `none` or `required`. |

### Trust vocabulary (`verification` and `review_status`)

Two **independent** axes qualify every offer, and in ordinary speech both are
"verification", so the exact meaning of each value is fixed here. The site's
hover-free legend, its row badges and hover text, its structured data and its
`llms.txt` / `llms-full.txt` exports all render these definitions;
`app/scripts/trust-vocabulary.mjs` is the machine-readable copy of this table
and the single source the code reads.

`review_status` — how far the **curator** has reviewed the listing:

| Value            | Shown as        | Meaning | Claim attempt |
|------------------|-----------------|---------|---------------|
| `verified`       | reviewed        | The curator has read the listing against the provider's own source and its terms match what is listed. | Not attested: this value does not say the curator completed the claim. |
| `under-review`   | under review    | The curator is testing the listing now. | In progress; the outcome is not recorded yet. |
| `unverified`     | not reviewed    | The curator has not reviewed the listing firsthand yet. | Not attested. |
| `to-be-verified` | to be verified  | The listing's current details need follow-up verification before they can be relied on. | Not attested. |

`verification` — what the offer's **terms** rest on (its evidence level):

| Value          | Shown as          | Meaning | Claim attempt |
|----------------|-------------------|---------|---------------|
| `social_proof` | corroborated      | The offer's terms are corroborated by the provider's own site plus at least one social or community source. | This axis says nothing about claim attempts — `review_status` carries that answer. |
| `unverified`   | community-sourced | Only social or community sources describe the offer; there is no official-site confirmation yet, so treat every term as unconfirmed. | Same: the review status carries that answer. |

Rules:

- **The axes combine freely and never contradict each other.**
  `review_status: verified` with `verification: social_proof` means the curator
  reviewed the listing firsthand *and* its evidence is the provider's own page
  plus social proof. Review status answers "how far has the curator gone?";
  evidence level answers "what do the terms rest on?".
- **No unknown method is promoted to `verified`.** A value that cannot be read
  or confirmed stays out of the directory (or takes the weakest value the
  evidence supports) — never `verified`/`social_proof` by default.
- `verified_date` is the **Last checked** date: when the entry was last
  confirmed against its source. It is the listing's freshness, not the offer's
  expiry.
- An offer's `expiry_date` is its **enrollment deadline** — the last date to
  claim — not how long the credits stay valid. When a provider states how long
  claimed credits last, that term lives in `amount`.

## Conventions

- **Date format:** `YYYY-MM-DD` everywhere (ISO 8601), e.g. `2026-08-21`.
  Never free-form dates like `Aug 21, 2026`.
- **Nullability:** write `expiry_date: null` (or `~`) for ongoing offers.
  An empty value also parses as null. Never use `N/A`, `none`, or `0`.
- **Category enum:** exactly one of
  `api_provider | coding | image | voice | video | startup_program | student | oss_program`.
- **Quoting:** plain scalars need no quotes; quote values containing leading
  or trailing spaces. Values may contain colons (e.g. URLs).
- **No nesting:** files are flat key/value documents — no lists, no maps,
  no anchors. Comments (`#`) are allowed.
- **Verification:** every committed offer must have been checked against its
  `source_url` on (or within a few days of) its `verified_date` (the
  **Last checked** date). Never guess missing fields — mark them unknown and
  leave the offer out until verified; see *Trust vocabulary* above for what
  each `verification` / `review_status` value does and does not claim.

## Example

```yaml
# offers/google-cloud-300-free-trial.yaml
title: Google Cloud Free Trial — $300 Credit
provider: Google Cloud
category: api_provider
amount: $300 in credits (90 days)
expiry_date: null            # ongoing program; per-account window is 90 days
source_url: https://cloud.google.com/free/docs/free-cloud-features
verified_date: 2026-08-21
verification: social_proof
review_status: verified
signup: required
```

## Validation

The canonical machine-readable schema is `schemas/offer.schema.json`
(strict JSON Schema, Draft 2020-12). Two validators enforce it:

```bash
python3 scripts/validate_offers.py   # schema-only check (CI gate)
```

The validator reuses the frozen stdlib content model (`scripts/offer_model.py`,
formerly the Python builder's validator), so local checks and CI cannot
drift; `validate_offers.py` additionally cross-checks the JSON Schema
against the content model's constants.

CI runs the validator on every push touching `offers/**` and on every
pull request (the required check is intentionally unfiltered)
(`.github/workflows/validate.yml`). The Vite app enforces the same rules at
build time: `cd app && npm run build` loads every offer through
`app/scripts/load-offers.mjs` before bundling, so an invalid YAML fails the
app build too — locally and in the deploy workflow.

A file that fails any rule above fails with the offending file and field
named in the error (date errors include a `YYYY-MM-DD` format hint).

## Detail files (`offers/details/<slug>.json`) — optional

Summary cards stay lean; richer per-offer content lives in an **optional**
JSON sidecar next to the offer: `offers/details/<slug>.json`, where
`<slug>` matches an existing offer file name exactly (an orphan detail file
is a build error). Documents are strict JSON, parsed with the standard
library and validated against `schemas/offer-detail.schema.json`
(Draft 2020-12, `additionalProperties: false`). Every field is optional,
but at least one must be present:

| Field          | Type            | Limits                     | Description |
|----------------|-----------------|----------------------------|-------------|
| `summary`      | string          | 1–2000 chars               | Detailed description shown inside the offer's detail card. |
| `claim_steps`  | list of strings | 1–12 steps, ≤300 chars each| Ordered how-to-claim instructions rendered as an `<ol>`. |
| `social_proof` | list of objects | 1–10 entries                | Evidence entries rendered as embed-style cards (see below). |

Social-proof entries carry a required `type` plus type-specific fields:

| Type          | Required fields              | Optional fields |
|---------------|------------------------------|-----------------|
| `x`           | `url`, `author`, `text`      | `handle` |
| `reddit`      | `url`, `author`, `text`      | `community` |
| `link`        | `url`, `title`               | `text` |
| `screenshot`  | `image` (site-relative path), `caption` | — |

Rules:

- **Evidence only.** Every entry must point at a real post or source you
  have visited. Never guess URLs or invent quotes — unverified claims stay
  out of the directory.
- **No third-party embed scripts.** X/Reddit posts are rendered as static,
  build-time quote cards linking out to the platform, keeping the page
  free of third-party trackers (privacy policy §"Who else receives data").
- **Screenshots** reference assets committed under `app/public/` (served at
  the site root) via a relative `image` path such as
  `assets/shots/pricing.png`; absolute paths and `..` segments are rejected.
- Text limits: `text`/`caption` ≤500 chars; other strings ≤200 chars.

Example:

```json
{
  "summary": "GitHub Copilot Free grants every developer 2,000 completions and 50 chats per month.",
  "claim_steps": [
    "Sign in to GitHub.",
    "Select the Free plan on the Copilot plans page."
  ],
  "social_proof": [
    {
      "type": "link",
      "url": "https://github.blog/news-insights/product-news/github-copilot-in-vscode-free/",
      "title": "Announcing GitHub Copilot Free",
      "text": "Today we are launching GitHub Copilot Free."
    }
  ]
}
```
