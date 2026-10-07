# Trust policy and value floor

Read by verifier workers. The main agent does not need this file: the
`shortlist.py` script enforces the mechanical parts.

## Official vs corroboration

**Official** means pages the provider owns: the offer page, then the
provider's docs, pricing, terms, blog, or changelog. Ownership is checked:
the page sits on the provider's primary domain (the one that hosts its docs
or console, found by your own search, never only through a lead's link) or
a subdomain of it. A look-alike domain is not official.

**Corroboration** is everything else: X posts (even from the provider's
account), Reddit, Hacker News, aggregators, curated lists, search
snippets. Corroboration finds offers; it never confirms one. A reachable
homepage or a search snippet is not proof: quote the sentence from a page
you read.

## Budget per candidate

One search plus at most four page loads: the offer page, one retry of it
with a different fetch method (Lightpanda when available), and two other
official pages (pricing, docs, changelog). The oEmbed lookup for an X lead
is outside the budget.

## Verdicts

- **live**: an official page says the offer is claimable now and states
  its amount or allowance. Every `offer` value comes from official pages.
- **expired**: an official page says the offer ended, or its official end
  date is before the run date.
- **unverifiable**: no official page confirms it after the budget (bot
  wall, silent pages, only corroboration, official pages describe a
  different program). Give the concrete reason and the URLs tried.
- **duplicate**: the same program as another candidate in the batch, or
  the catalog already lists it with the same terms (`action: none`).

## Conflicts — official wins

- Lead vs official (amount, expiry, model): use the official value. Set
  `lead.matches_official: false`.
- Lead claims an end date no official page states: `expiry_date: null`.
- Official vs official: a clearly newer dated statement wins; otherwise
  the offer page beats docs/pricing, which beat blog/changelog. If neither
  settles it, the candidate is unverifiable.

## Value

The site lists offers good enough for real coding or work. `shortlist.py`
drops anything under the **value floor**: less than **$5** in credit and
less than **100,000 tokens** per month-equivalent.

Fill `value` from the official quote only:

| Field | Rule |
|-------|------|
| `usd` | Dollar value of the credit as stated (convert other currencies at the official page's own figure, else `null`). |
| `tokens` | Token allowance as stated. Convert stated requests or credits only when the official page gives the conversion; else `null`. |
| `period` | `one_time`, `year`, `month`, `week`, or `day` — how often the allowance renews. `shortlist.py` converts to a month-equivalent (`year` ÷ 12, `week` × 4, `day` × 30). |
| `unlimited` | `true` only when the official page says use is free without a token or dollar cap (rate limits allowed), e.g. a model free for a launch week. |
| `basis` | One sentence quoting where the numbers come from. |

When both `usd` and `tokens` are `null` and `unlimited` is `false`, the
offer is below the floor: it cannot be measured.

Ranking (in `shortlist.py`): score = the larger of month-equivalent dollars
and month-equivalent tokens ÷ 20,000 (so $5 ≈ 100k tokens), capped at
1000; unlimited scores 1000. Ties go to the newest lead, so a $100k
startup program does not crowd out a fresh $1,000 one.

## Honesty tags

New offers are written with `verification: social_proof` (official page
plus the lead as social proof) and `review_status: under-review`. Updates
keep the file's existing tags. Never upgrade a tag.
