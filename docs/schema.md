# Offer Schema (`offers/*.yaml`)

One YAML file per free-AI-credit offer. The file name is the offer slug:
lowercase, hyphen-separated, ASCII, no trailing hyphen — e.g.
`google-cloud-300-free-trial.yaml`. The slug must be stable once published;
it becomes the offer's identity in the JSON index and URLs.

## Fields

Exactly seven fields. All are required; unknown fields are rejected by the
build validator.

| Field           | Type                  | Required | Nullability | Description |
|-----------------|-----------------------|----------|-------------|-------------|
| `title`         | string (non-empty)    | yes      | no          | Human-readable offer name shown on cards. |
| `provider`      | string (non-empty)    | yes      | no          | Company or product offering the credit. |
| `category`      | enum (string)         | yes      | no          | One of: `api_provider`, `coding`, `image`, `voice`, `video`. |
| `amount`        | string (non-empty)    | yes      | no          | Free value in human terms, e.g. `$300 in credits` or `10k credits/month`. |
| `expiry_date`   | date or null          | yes      | **yes**     | Date the offer stops being claimable, `YYYY-MM-DD`. `null` = ongoing offer with no fixed end date. |
| `source_url`    | URL string            | yes      | no          | Official provider page where the offer is described. Must start with `http://` or `https://`. |
| `verified_date` | date                  | yes      | no          | Date the curator last confirmed the offer is live and claimable, `YYYY-MM-DD`. |

## Conventions

- **Date format:** `YYYY-MM-DD` everywhere (ISO 8601), e.g. `2026-08-21`.
  Never free-form dates like `Aug 21, 2026`.
- **Nullability:** write `expiry_date: null` (or `~`) for ongoing offers.
  An empty value also parses as null. Never use `N/A`, `none`, or `0`.
- **Category enum:** exactly one of
  `api_provider | coding | image | voice | video`.
- **Quoting:** plain scalars need no quotes; quote values containing leading
  or trailing spaces. Values may contain colons (e.g. URLs).
- **No nesting:** files are flat key/value documents — no lists, no maps,
  no anchors. Comments (`#`) are allowed.
- **Verification:** every committed offer must have been checked against its
  `source_url` on (or within a few days of) `verified_date`. Never guess
  missing fields — mark them unknown and leave the offer out until verified.

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

CI runs the validator on every push or PR touching `offers/**`
(`.github/workflows/validate.yml`).

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
