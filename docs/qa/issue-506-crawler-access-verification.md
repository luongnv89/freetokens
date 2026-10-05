# Issue #506: real search/retrieval crawler access

**Verdict: crawler delivery NOT-TESTED.** Ordinary HTTP `200` and a `robots.txt`
`Allow` were observed, but no authorized engine inspection and no request logs
were available to this run, so neither proves that a search or retrieval crawler
actually fetched the sampled pages. The observations below record **declared
policy as served**, which the acceptance criteria explicitly call insufficient.

Evidence for [issue #506](https://github.com/luongnv89/freetokens/issues/506)
(original UX/AX review task T3). Sampled 5 October 2026, 21:11–21:12 UTC. No
offer data changed; no crawler policy, authentication or consent rule was
modified.

## Scope and method

- **Sampled URLs** on `https://freetokens.custats.info/`:
  - home — `https://freetokens.custats.info/`
  - detail — `https://freetokens.custats.info/offers/aerolink-starter-free-trial.html`
  - policy/support artifacts — `robots.txt`, `sitemap.xml`, `llms.txt`
- **Method:** unauthenticated HTTP/2 `GET` from a single host, one request per
  URL. **Agent:** `curl` with the self-identifying UA
  `freetokens-verification/1.0 (site-owner access check)`. No search-engine or
  AI-crawler user agent was used (no bot spoofing), and no access control was
  bypassed.
- **Serving stack reported by the response headers:** `server: GitHub.com`,
  Fastly edge cache, `x-github-edge-region: fra`.

## Declared policy as served

| URL | Method / agent | Date (UTC) | Response | Rendering evidence |
|-----|----------------|------------|----------|--------------------|
| `/robots.txt` | HTTP GET, `freetokens-verification/1.0` | 2026-10-05 21:11:21Z | `200`, `text/plain; charset=utf-8`, 1276 bytes, `last-modified: Mon, 05 Oct 2026 12:54:35 GMT` | byte-identical to `app/public/robots.txt` (both `sha256:9e158bb3105b5da4e23a2f542acb592fa7cd03eaa0d7a27a7351c04c04bc62f0`); advertises `Sitemap:` and the per-agent blocks |
| `/sitemap.xml` | HTTP GET, `freetokens-verification/1.0` | 2026-10-05 21:12:00Z | `200`, `application/xml`, `last-modified: Mon, 05 Oct 2026 12:54:35 GMT` | 236 `<url>` entries |
| `/` (home) | HTTP GET, `freetokens-verification/1.0` | 2026-10-05 21:11:21Z | `200`, `text/html; charset=utf-8`, 644497 bytes, `last-modified: Mon, 05 Oct 2026 12:54:35 GMT` | prerendered document contains a self-referential `<link rel="canonical" href="https://freetokens.custats.info/">`, `<title>Free AI Credits</title>` and the offer content inline (no JavaScript execution) |
| `/offers/aerolink-starter-free-trial.html` | HTTP GET, `freetokens-verification/1.0` | 2026-10-05 21:12:00Z | `200`, `text/html; charset=utf-8`, `last-modified: Mon, 05 Oct 2026 12:54:35 GMT` | self-referential canonical, `<title>Aerolink $5 Testing Credit · Free AI Credits</title>`, `application/ld+json` breadcrumb block present |
| `/llms.txt` | HTTP GET, `freetokens-verification/1.0` | 2026-10-05 21:12:00Z | `200`, `text/plain; charset=utf-8`, 6018 bytes, `last-modified: Mon, 05 Oct 2026 12:54:35 GMT` | — |

The `last-modified` value on every sampled artifact is
`2026-10-05T12:54:35Z`, i.e. the sampled build was deployed about 8 hours before
observation.

What this establishes: the live host serves the intended crawl policy and
prerendered, indexable HTML for both sampled URLs to an ordinary HTTP client.

What this does **not** establish: that any search or retrieval crawler received
that policy or those documents. A `200` to a non-crawler client and a
`robots.txt` `Allow` line are declarations, not delivery.

## Why delivery is not-tested

- **No authorized engine inspection.** This run has no authenticated Search
  Console or Bing Webmaster session. The deployed home page serves **no**
  `google-site-verification` meta tag, so the HTML-tag ownership verification
  documented in [docs/search-console-setup.md](../search-console-setup.md) §1 is
  not active on the live build; URL Inspection / live-test is therefore not
  reachable from here.
- **No request logs.** GitHub Pages (`server: GitHub.com`, Fastly edge) exposes
  no per-request access log to the site owner, and the repository has no log
  ingestion. There is no owner-side record to inspect for a crawler hit on the
  sampled URLs.
- The acceptance criteria state that ordinary `200` and a `robots.txt` `Allow`
  are insufficient; under that rule the missing evidence is recorded here as
  **not-tested** rather than reported as a pass.

## Crawl policy unchanged (AC 3)

- `robots.txt` on the live host is byte-identical to
  `app/public/robots.txt` (matching `sha256`, above): 11 `Disallow: /` blocks,
  all on AI-training crawlers (`GPTBot`, `ClaudeBot`, `Google-Extended`,
  `CCBot`, `Bytespider`, `Meta-ExternalAgent`, `Applebot-Extended`,
  `cohere-training-data-crawler`, `DeepSeekBot`, `AI2Bot`, `FacebookBot`), and
  13 `Allow: /` blocks for search and user-triggered retrieval crawlers.
- These blocks are already guarded against drift by
  [`app/tests/routes.test.mjs`](../../app/tests/routes.test.mjs) ("copies the
  robots policy and keeps it stable across builds"), which asserts each
  training crawler stays `Disallow: /` and each search crawler stays
  `Allow: /`.
- No authentication or consent rule was touched, and the probe used a
  self-identifying UA — no bot spoofing and no access bypass.

## Remaining acceptance work (owner-only)

The delivery half of AC 1 needs one of the following, neither available to an
unauthenticated automated run:

1. **Authorized engine inspection** — set `SEARCH_CONSOLE_TOKEN` at build
   ([docs/search-console-setup.md](../search-console-setup.md) §1), verify the
   property, then run Search Console **URL Inspection → Test live URL** for
   both sampled URLs. Record agent (`Googlebot Smartphone`), method
   (`URL Inspection live test`), date, response and rendered content.
2. **Relevant request logs** — if a log source is ever added in front of Pages
   (or a CDN log drain enabled), extract the crawler hits for the two sampled
   URLs with the same fields.

Until then this document is the honest state: declared policy verified as
served, real crawler delivery not-tested.
