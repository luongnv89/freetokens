# Scouting sources and queries

Read by scout workers only. Each scout covers one channel. Substitute
`<since>` with the run date minus the lead window (`YYYY-MM-DD`),
`<since-epoch>` with that date as Unix seconds, and `<month>` with the
run's month and year (`October 2026`). Add the user's
focus categories as extra terms when given.

Budget per scout: at most **8 searches** and **12 page loads**. Stop early
once you hold 15 leads.

## Channel `x` — posts on X

X search pages need a login, so reach posts through web search and confirm
each post with the oEmbed lookup in `references/web-tools.md`.

Queries (run in order, stop at budget):

1. `site:x.com "free credits" API <month>`
2. `site:x.com "free tokens" model developers`
3. `site:x.com "free for a week" OR "free for 7 days" coding agent model`
4. `site:x.com "$100 in credits" OR "$50 in credits" OR "$25 in credits" AI`
5. `site:x.com "free tier" new model API launch`
6. `site:x.com startup program AI credits apply`

Keep posts from the provider's own account first, then posts by
developers that link to the provider. A post from the provider's own
account is still a lead; the verifier needs the provider's web page.

## Channel `reddit` — Reddit threads

Load the public JSON search for each subreddit (newest first, past month):

```
https://www.reddit.com/r/<sub>/search.json?q=<query>&restrict_sr=1&sort=new&t=<t>&limit=25
```

`<t>` is `week` when the lead window is 7 days or less, else `month`.
Drop posts whose `created_utc` is before `<since-epoch>`.

Subreddits: `LocalLLaMA`, `ChatGPTCoding`, `ClaudeAI`, `cursor`,
`OpenAI`, `singularity`, `SideProject`, `vibecoding`.
Queries (URL-encoded): `free credits`, `free tokens`, `free tier API`.

Read `data.children[].data`: `title`, `selftext`, `permalink`, `author`,
`subreddit`, `created_utc`, `url`. The lead URL is
`https://www.reddit.com` + `permalink`. If the JSON endpoint is blocked,
fall back to web search: `site:reddit.com "free credits" AI <month>`.

## Channel `web` — everything else

1. Hacker News (Algolia API, stories newest first):
   `https://hn.algolia.com/api/v1/search_by_date?query=free%20credits&tags=story&numericFilters=created_at_i><since-epoch>`
   and the same with `free%20tier%20API`. The lead URL is the story `url`
   (or `https://news.ycombinator.com/item?id=<objectID>` for Ask HN).
2. Web search, past month:
   - `"free credits" LLM API new users <month>`
   - `AI startup program credits <month>`
   - `"free tier" coding agent new model`
   - `student free AI credits <month>`
3. Curated lists (lead discovery only, never evidence):
   `https://github.com/cheahjs/free-llm-api-resources` (README).
4. Provider changelogs and blogs that a search result points to.

## What counts as a lead

A post or page that names a provider, the free amount or allowance, and
(ideally) a link. It is a lead even when it might be wrong; the verifier
decides. Skip affiliate or referral links, coupons for paid plans, and
offers whose only value is a discount.
