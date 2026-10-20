# Evidence — X-post embeds and the reference trace

Both feed `offers/details/<slug>.json` → `social_proof`. Limits come from
`docs/schema.md` and `schemas/offer-detail.schema.json`: ≤10 entries, `url`
≤200 chars, `title` ≤200 chars, `text` ≤500 chars.

## X posts become embedded evidence

If `source_url` (or any cited evidence in the input) is an x.com/twitter.com
post, ALWAYS create the detail file `offers/details/<slug>.json` alongside
the YAML with a `social_proof` entry of type `x` so the post renders as a
quote card on the offer's detail page — never leave an X-sourced offer
without it.

- Only a post from the provider's own account is official (Step 2) and may
  serve as `source_url` on the live path. The early lane
  (`early-lane.md`) has its own rules for which posts may.
- A third-party post is corroboration, embedded only when its URL came from
  the input or a page you fetched (never construct one) and every figure it
  states matches what you publish — otherwise omit it and note that in
  Step 5.
- Fill `url` from the post. Fetch `author`/`handle`/`text` from X's public
  oEmbed endpoint (`https://publish.x.com/oembed`, queried with the pinned
  `curl` command in `web-tools.md`) rather than asking the curator to
  copy-paste. `author_name` maps to `author`; `handle` is `@` plus the
  account name in the path of `author_url`;
  take `text` from the post content you already fetched in Step 2 (oEmbed
  returns HTML, not plain text). If oEmbed is unreachable, fall back to the
  text captured during verification.

This embeds the post statically at build time (no third-party scripts, per
`docs/schema.md`) and preserves the evidence if the post is later deleted.
Add `summary` and `claim_steps` to the same file when you have them.

## Reference trace — keep every URL you touch (mandatory)

During verification you fetch more than `source_url`: redirects, docs,
pricing pages, announcement posts, changelog entries. Keep a trace of every
relevant URL and persist it as evidence.

- **Collect as you go.** Start the trace with `source_url`. Append every
  URL you fetched whose content informed the verdict (HTTP 200 and contains
  terms you quoted or relied on). Skip dead links, bot-wall pages, and
  search result pages that added nothing.
- **Capture title + excerpt.** For each URL record `title` (page `<title>`
  or first `h1`, ≤200 chars) and `text` (the quoted sentence that proves
  the offer, ≤500 chars). These map to `social_proof` `link` fields.
- **Deduplicate and cap.** Normalize URLs (strip fragments and trailing
  slashes), deduplicate, keep `source_url` first, then discovery order. Cap
  at **10 entries**; over the cap, keep `source_url` plus the 9 most
  authoritative provider-domain pages and drop aggregators and mirrors
  first. X/Reddit posts stay type `x`/`reddit`; only generic pages use
  type `link`.
- **Persist in the detail file.** If a detail file exists, **merge**:
  preserve `summary`/`claim_steps`, append trace entries whose normalized
  `url` is not already present, never duplicate a URL. If none exists,
  create one with the trace as its `social_proof` (one entry satisfies
  `minProperties: 1`).
- **Evidence only.** Every traced URL is one you fetched. Never invent
  titles, excerpts, or URLs; a failed fetch is never added.

The trace is the audit trail that lets a future curator re-verify the offer
without re-discovering sources. Step 3 writes it; Step 5 lists it under
**References verified**.

Example detail file with a trace:

```json
{
  "summary": "Example AI grants $20 in inference credits for new signups.",
  "claim_steps": ["Create an account at console.example.ai.", "Credits apply automatically at signup."],
  "social_proof": [
    {
      "type": "link",
      "url": "https://console.example.ai/policies/credits",
      "title": "Example AI Credits Policy",
      "text": "New users receive $20 in free inference credits upon signup."
    }
  ]
}
```
