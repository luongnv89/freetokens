# Community offers — Luong sends a link (#748)

A **community offer** is a promo code or a giveaway that a person shared in a
public post. freetokens does **not** verify it: the site shows it with the
badge "Community · not verified by freetokens", who shared it, and a link to
the post. This is a separate lane from every other offer path.

## Who adds one

**Only Luong.** The whole process is:

1. Luong sends a link to the post (X, Reddit, a blog), optionally with a
   screenshot or the post text.
2. You open **one small entry PR** that adds the entry: one
   `offers/<slug>.yaml`, one `offers/details/<slug>.json`, and the
   regenerated `index.json` + `app/public/llms.txt` + `app/public/llms-full.txt`.
3. The PR goes through the **normal gates**: `python3 scripts/validate_offers.py`,
   the Python unit suite, `cd app && npm test`, `npm run build`, CI, review.

Never create one from anything else. The offer-hunter must not create, edit
or remove a community listing (its `check_scope.py` rejects it), and the
daily-offer-check never re-checks one (`list_active.py` skips it, its
`check_scope.py` rejects any change to it). Every entry records
`added_by: luong`; the validator rejects any other value.

## Content rule: quote the post, invent nothing

- Every fact comes from the post, quoted. Put the quotes in a comment block
  at the top of the YAML and in the detail file's `summary` / `claim_steps`.
- Anything the post does not state stays **absent**: no `codes_available`
  when no number is given, no `promo_code` expiry when none is given
  (`expiry_date: null`), no `shared_by_name` when only a handle shows.
- No verification step. Do not search the provider's site to "confirm" it
  and do not mark it `social_proof`: `verification` and `review_status` are
  both pinned to `unverified` (the validator enforces it).
- `source_url` is the post itself. `verified_date` is the day it was added;
  nobody bumps it later, and the site labels it "added", not "checked".
- Facts that are not in the post text — the poster's display name, the exact
  post time — may come from the post's author/timestamp metadata (on X,
  `author.name` and `created_at` from
  `https://api.fxtwitter.com/<handle>/status/<id>`). Say so in the YAML
  comment, and never present them as quoted.
- In the detail file, quote the post wherever possible and attribute every
  paraphrase ("the post says …"). No sentence may state anything the post
  does not; keep the post's own characters (curly apostrophes included).
- `provider` uses the same spelling as the provider's existing offers
  (e.g. `Cognition (Devin)`), so the entry groups with them.

## Trust labels on the site

The community badge is a community entry's **only** trust label: its rows and
detail page show no evidence-level tag ("early (unconfirmed)" describes an
offer the provider's own site is silent about, not a person's giveaway) and
no review-status badge. Its `verification: unverified` is a schema
placeholder, so the `?verification=` filter never matches a community entry;
`?community=only` lists them.

## Fields (flat YAML, beside the ten regular ones)

| Field | Rule |
|-------|------|
| `listing_type` | `community`. Omit it on every regular offer. |
| `community_subtype` | `promo_code` or `giveaway`. |
| `added_by` | `luong` (the only allowed value). |
| `shared_by_handle` | The poster's bare handle, no `@` (e.g. `ben_ai_eng`). |
| `shared_by_name` | Optional. Display name as shown on the post. |
| `shared_by_post_date` | `YYYY-MM-DD` (UTC) the post was made. |
| `promo_code` | `promo_code` only, required there. The code exactly as posted. |
| `codes_available` | `giveaway` only, optional. Whole number of codes the post gives away. |
| `entries_close` | `giveaway` only, optional. `YYYY-MM-DD` entries close; `expiry_date` must equal it. |
| `timezone_note` | Required with `entries_close`: the post's time zone quoted, or `no time zone given`. |

The generated index re-nests these as `listing_type: "community"` plus a
`community` object: `subtype`, `added_by`, `shared_by { handle, name?,
post_url, post_date }`, `promo_code?`, `codes_available?`, `entries_close?`,
`timezone_note?` (`schemas/offers-index.schema.json`).

## Expiry

Community entries still leave the site automatically at build time
(ADR 0001), through `expiry_date`:

- **giveaway** — `expiry_date` = `entries_close`. The entry is listed through
  the end of that day and drops on the first build after it ends on the UTC
  build clock; with no time zone in the post, "end of day" is read that way.
- **promo_code** — `expiry_date` = the code's stated expiry, or `null` when
  the post gives none (it then stays until Luong removes it).

## Steps

1. Read the post (the link Luong sent; a screenshot or pasted text is fine
   when the page will not load). Note the handle, display name, date and
   exact wording.
2. Write `offers/<slug>.yaml` with the ten regular fields
   (`verification: unverified`, `review_status: unverified`) plus the fields
   above, and a comment block quoting the post.
3. Write `offers/details/<slug>.json`: `summary` (quotes, and "not verified
   by freetokens"), `claim_steps` (how to enter or redeem, quoted), and one
   `social_proof` entry of type `x`/`reddit`/`link` for the post.
4. `python3 skills/offer-updater/validate_offer.py offers/<slug>.yaml` and
   `python3 scripts/validate_offers.py`.
5. Commit the offer files, then regenerate and commit the artifacts:
   `cd app && node scripts/load-offers.mjs --index-json ../index.json && npm run gen:llms`.
6. Open the entry PR (`feat(offers): community <subtype> — <provider>`), and
   let the normal gates run.

## Example

The first entry, `offers/devin-max-one-month-code-giveaway.yaml`: a giveaway
by `@ben_ai_eng` (Ben Newell) on 2026-11-17 — 10 codes, one month of Devin
Max each ($200 value), entries close 2026-11-20, no time zone given.
