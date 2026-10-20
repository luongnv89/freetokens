# Early lane — publish X-first offers before the official page catches up

Hot offers often appear on X (a provider teaser, a staff post, users spotting
a free model) days before any official page states them. The **early lane**
publishes such an offer fast, labelled as unconfirmed, instead of dropping it.
Visibility comes first; evidence keeps being collected into the proof.

The early lane is **on by default**. The curator turns it off for a run by
saying "official only" or "no early lane"; the run then drops these offers as
before. An **early offer** is a published offer with `verification:
unverified` **and** a YAML header starting `# Early offer`; an offer written
under "skip verification" is not one.

## When the lane applies

Apply the lane to an offer only when **all** of these hold after Step 2's
official search and fetch budget is spent:

1. The offer is **new**, or the file being refreshed is already an early
   offer. A refresh of a `social_proof` offer never takes the lane: if its
   official pages are bot-walled or silent, it is an unverifiable refresh
   and the file stays as it is.
2. Official pages are **silent**: unreachable, or loaded without mentioning
   the promotion. An ordinary paid price or model listing is silence.
3. No official page **contradicts** it: no official statement that the
   promotion ended, never existed, or has other promotion terms. A
   contradiction sends the offer to the normal Step 2 rules (official wins).
4. The **named-source floor** (below) holds.
5. The **claim path is safe** (below).

An offer that fails any condition is dropped with its reason, exactly as in
Step 2.

## The named-source floor

A **loaded post** is a public X (or Reddit) post whose text you read through
the pinned oEmbed lookup in `web-tools.md` or a page fetch. A post whose
oEmbed failed and whose page did not load is not loaded — the curator's
input or screenshot never stands in for it.

A **qualifying post** is a loaded post whose text states both the provider
and what is free (the amount), posted within the **last 14 days**. Take the
date of an X post from its status ID: `(id >> 22) + 1288834974657` is the
post time in Unix milliseconds. An older post is stale and does not qualify.

The floor holds when you have **one** of:

- **Provider post** — a qualifying post from an account a provider-owned page
  names (docs, blog, footer, or the provider's code-hosting org). The
  account's own name, handle, avatar, bio, or checkmark never proves
  ownership: an account no provider-owned page names is third-party, however
  official it looks. (When the provider's primary domain links the account,
  the post is already official and takes the live path, not this lane.)
- **Staff post** — a qualifying post by a person whose role at the provider
  is stated on a provider-owned page or in a post by a provider-named
  account. A self-written bio does not count; without such a page, treat
  the post as third-party.
- **Two independent posts** — two qualifying third-party posts by different
  authors that agree on provider and amount. A repost, quote, or
  near-identical copy of the other post is not independent.

Not enough on its own: the curator's input, search snippets, an aggregator
page, or one third-party post.

**Budget.** On top of Step 2's budget: one extra search for posts about the
offer (for example `site:x.com <provider> <offer name>`), up to four oEmbed
lookups or post fetches, and one fetch of a provider page that names an
account or staff member. Stop searching once the floor holds; keep every
qualifying post you already loaded as proof.

## Safe claim path

Claiming must happen inside the provider's own product, or at a URL on the
provider's primary domain. Drop with reason `unsafe claim path` when a
qualifying post asks users to:

- follow a link shortener, a form, or a URL on any other domain;
- DM, reply, email, or follow an account to receive the offer;
- hand over an API key, password, seed phrase, wallet, or payment details.

Never copy a non-provider URL into `claim_steps`, `summary`, or a
`social_proof` `text`: replace it with `[link removed]`.

## Field values for an early offer

Take every value from the qualifying posts — never invent one:

| Field | Value |
|-------|-------|
| `title`, `provider`, `category`, `amount` | From the strongest qualifying post: provider post, then staff post, then the two agreeing posts. If posts disagree on a value and no stronger post settles it, drop with reason `conflicting posts`. |
| `expiry_date` | The end date a qualifying post states. A relative window ("free for 7 days") counts from the post date. `null` when no post states an end. A date already past → drop with reason `expired per post`. |
| `source_url` | The URL of the strongest qualifying post. |
| `verified_date` | Today — the day you loaded the qualifying post. |
| `verification` | `unverified` (rendered as the "early (unconfirmed)" evidence level). |
| `review_status` | `to-be-verified`. |
| `signup` | `none` only when a qualifying post or provider page states no account is needed; otherwise `required` (the weaker claim). |

YAML comment header (replaces the live header):

```yaml
# Early offer <YYYY-MM-DD>: official pages silent; floor met by <provider post | staff post (<role>, per <page-url>) | 2 independent posts>
# <post-url> ("<short quote stating provider and amount>")
```

**Detail file (mandatory).** Create `offers/details/<slug>.json` with:

- `summary` opening with: `Early offer: seen on X on <post date>, not yet
  confirmed on <provider>'s own site. Treat the terms as unconfirmed.`
- `social_proof`: one `x` (or `reddit`) entry per qualifying post, built as
  in `evidence.md` → *X posts become embedded evidence*, strongest post
  first, plus a `link` entry for the provider page that named the account
  or staff member; cap 10 entries. Take `handle` from the path of the
  oEmbed `author_url`, not from `author_name`. Do not add silent official
  pages.
- `claim_steps` when a post states how to claim (provider URLs only).

## Present and ship

**X-first offer** = an early offer, or a live offer whose `source_url` is an
official X post. A PR that carries an X-first offer ships automatically once
every check passes.

- **Step 5.** Add an **Early offers** heading: offer | floor met by | posts
  (URL, author, date) | official pages tried (all silent). Say plainly that
  each shows as an "early (unconfirmed)" offer, and end the decision line
  with: `"yes" commits, opens the PR, and merges it once all checks pass.`
- **Step 6.** The commit gate is unchanged: nothing ships without the
  curator's explicit yes. Before pushing, regenerate and stage the build
  artifacts (CI compares them with the offers):

  ```bash
  (cd app && npm ci && node scripts/load-offers.mjs --index-json ../index.json && npm run gen:llms)
  git add -- index.json app/public/llms.txt app/public/llms-full.txt
  ```

  After the PR opens, with `pr` set to its number, wait for every check —
  not only the required one — then merge:

  ```bash
  gh pr checks "$pr" --watch --fail-fast
  head="$(gh pr view "$pr" --json headRefOid -q .headRefOid)"
  gh pr merge "$pr" --squash --delete-branch --match-head-commit "$head"
  ```

  If a check fails or a command errors, report the output verbatim and
  leave the PR open. Never pass `--admin` or bypass a check. A run under
  "skip verification" never merges by itself.
- The PR body carries the **Early offers** table and the posts.

## Refreshing an early offer

When this skill refreshes an early offer, run Step 2 as usual, then:

| Finding | Action |
|---------|--------|
| An official page now confirms the offer | **Promote** — normal live path: official values, `source_url` = the official page, `verification: social_proof`, `review_status: under-review`, live header. Rewrite the `summary` without the "Early offer" sentence; keep the posts in `social_proof`. |
| Official pages still silent; the floor still holds with posts from the last 30 days | **Keep** — re-derive the field values from the strongest current posts, bump `verified_date`, append new qualifying posts. |
| Official pages still silent; the floor no longer holds (posts deleted, private, or older than 30 days) | **Retire** — set `expiry_date` to today so the build moves it to the archive; name it in the PR as a retired early offer. |
| An official page says the offer ended or never existed | **Expired** — official wins, as in Step 2. |
| The curator says the offer is fake or asks to take it down | **Retire**, with the curator's reason in the PR. |
