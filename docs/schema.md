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

`scripts/build.py` validates every file during the build:

```bash
python3 scripts/build.py        # validate + generate index.json + site/index.html
```

A file that fails any rule above fails the build with the offending file and
field named in the error.
