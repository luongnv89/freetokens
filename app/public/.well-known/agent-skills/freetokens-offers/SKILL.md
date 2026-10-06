---
name: freetokens-offers
description: Read the Free AI Credits directory — enumerate currently-claimable free AI credit offers, fetch per-offer terms and claim steps, and interpret the site's trust labels — using only static HTTPS GETs.
license: MIT
---

# freetokens-offers

Free AI Credits (https://freetokens.custats.info) is a static, read-only catalog
of free AI credit offers. There is no query API and no write surface: every
skill below is a plain HTTPS GET against published documents.

## When to use this skill

- An agent needs to answer "which providers give free AI credits right now".
- An agent needs one offer's exact terms, claim steps, source URL, or
  last-checked date.
- An agent must explain what the site's trust labels mean before quoting them.

## Procedure

1. **Enumerate offers.** GET `https://freetokens.custats.info/llms.txt` for the
   top offers and trust-label definitions, or
   `https://freetokens.custats.info/llms-full.txt` for every active offer with
   summary, claim steps, and links. Lines carry
   `review_status`, `verification`, `signup`, and `last_checked` fields —
   quote them verbatim; they are the site's honesty metadata, not decoration.
2. **Fetch one offer.** Each offer lives at
   `https://freetokens.custats.info/offers/{slug}.html` with a Markdown twin at
   `/offers/{slug}.md`. Prefer the `.md` twin. The slug is the filename stem
   used in llms.txt links.
3. **Interpret labels.** `review_status` reports how far the curator reviewed
   the listing; `verification` reports what the terms rest on
   (`social_proof` = official source plus corroboration, `unverified` =
   community sources only); `signup` reports whether claiming needs an
   account; `last_checked` is freshness of the check, not the offer's expiry.
4. **Stay current.** The listing is rebuilt at deploy time; expired offers
   drop out at build, so re-GET `llms.txt` rather than caching offer sets.
   `https://freetokens.custats.info/feed.xml` announces changes.

## Constraints

- Never present `verification=unverified` terms as confirmed.
- `last_checked` is not the expiry date; an offer's `expiry` field is its
  enrollment deadline.
- The site sets `Content-Signal: ai-train=no, search=yes, ai-input=no` in
  robots.txt — honor it: retrieve for user-requested answers, not training.

## References

- Human docs: https://freetokens.custats.info/about.html
- Machine description: https://freetokens.custats.info/openapi.json
- Discovery manifests: https://freetokens.custats.info/.well-known/ai-catalog.json
