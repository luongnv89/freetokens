# Search Console & indexing verification

Track: Task 4.1 (#216) — Sprint 4 · Phase P2 · Free AI Credits SEO.

## Objective

Verify the live GitHub Pages site in Google Search Console (GSC), submit `sitemap.xml`, confirm indexation and canonical selection, and audit Index coverage after 48 h.

## Pre-requisites

- Site deployed to `https://luongnv89.github.io/freetokens/` via `.github/workflows/deploy.yml` (validate → build → deploy).
- `app/public/robots.txt` references the sitemap:

  ```
  Sitemap: https://luongnv89.github.io/freetokens/sitemap.xml
  ```

  copied verbatim to `app/dist/robots.txt` by `vite build`.
- `app/dist/sitemap.xml` generated at prerender time from `offers.json` (fixed routes + every `offers/<slug>.html`). No manual step.
- DNS is managed by GitHub Pages (no custom domain); verification uses the **HTML tag** method. DNS TXT is the fallback if a custom domain is added later.

## 1. Create the GSC property

1. Open https://search.google.com/search-console/welcome
2. Choose **URL prefix** and enter `https://luongnv89.github.io/freetokens/` (trailing slash required for project Pages).
3. Select **HTML tag** as the verification method and copy the token value from:

   ```html
   <meta name="google-site-verification" content="TOKEN" />
   ```

   The `content` value alone is the token.

## 2. Store the token (no token committed)

Add the repository secret:

- **Repo → Settings → Secrets and variables → Actions → New repository secret**
- Name: `SEARCH_CONSOLE_TOKEN`
- Value: the `content` string copied above (no quotes, no HTML).

The build wires it as:

```yaml
# .github/workflows/deploy.yml — build job
SEARCH_CONSOLE_TOKEN: ${{ secrets.SEARCH_CONSOLE_TOKEN }}
```

`app/scripts/prerender.mjs:resolveSearchConsoleToken` validates the token (`^[A-Za-z0-9_-]+$`, no quotes/angles/spaces) and `fillPage()` injects exactly one tag into every prerendered head:

```html
<meta name="google-site-verification" content="TOKEN" />
```

When the secret is absent or malformed the built `dist/index.html` contains **no** verification meta (and no placeholder token ships). Local builds behave the same: export the env var to test, unset it to ship clean.

Local verification:

```bash
SEARCH_CONSOLE_TOKEN=abc123DEF_- npm run build
grep -c 'google-site-verification' app/dist/index.html  # → 1
grep 'google-site-verification' app/dist/index.html
# unset → rebuild → grep count → 0
```

## 3. Verify in GSC

1. Push to `main` (or re-run the deploy workflow) so the live `https://luongnv89.github.io/freetokens/` serves the meta.
2. Return to GSC and click **Verify**. Google fetches `/` and checks the meta.
3. On success GSC shows **Ownership verified**. If it fails, re-check that `view-source:https://luongnv89.github.io/freetokens/` contains the meta and that `robots.txt` does not block `Googlebot` (it does not — see `app/public/robots.txt`).

Alternative if HTML-tag verification is blocked: add a DNS TXT record at the apex (`google-site-verification=TOKEN`) and choose **Domain** verification in GSC. The HTML tag can then be removed.

## 4. Submit the sitemap

1. In GSC, open the verified property → **Sitemaps** (left nav).
2. Enter `sitemap.xml` (resolved against the property prefix to `https://luongnv89.github.io/freetokens/sitemap.xml`) and submit.
3. GSC should report **Success** with `Discovered URLs = (# fixed routes + # offers)` matching the last prerender log line.
4. The sitemap is also discoverable without submission via `robots.txt` `Sitemap:` directive — submission only accelerates crawling.

## 5. URL Inspection spot-check

Run **URL Inspection** on the canonical samples (must report **URL is on Google** with *User-declared canonical* = *Google-selected canonical*):

- `https://luongnv89.github.io/freetokens/` (home)
- `https://luongnv89.github.io/freetokens/archive.html`
- `https://luongnv89.github.io/freetokens/privacy.html`
- 3 offer details, e.g. the newest and two random slugs from `sitemap.xml`.

For each inspected URL confirm:

- **Coverage:** Indexed (not *Crawled — currently not indexed*).
- **Canonical:** *User-declared* and *Google-selected* are identical and equal to the `<link rel="canonical">` in `view-source`.
- **Sitemap:** Listed as the discovery source.

Record the results in a PR comment or screenshot added to this doc's git history. **Acceptance:** ≥90% of submitted URLs discovered; **canonical mismatches = 0** on the inspected samples.

## 6. 48-hour follow-up

After 48 h, re-open **Pages → Indexing** (formerly *Coverage*) and check:

- No growth in **Error** or **Valid with warnings** (e.g. *Duplicate without user-selected canonical*, *Blocked by robots.txt*).
- If errors appear, file backlog tickets per affected `slug` with **error type** (as labelled in GSC) + **affected slug/URL** + **sitemap entry**. Link each ticket to #216 in the follow-up comment.

## Appendix: build implementation

- Source: `app/index.html` carries a comment placeholder (no token).
- Injection: `app/scripts/prerender.mjs` `resolveSearchConsoleToken()` + `fillPage()` after the social-meta block.
- Validation: strict `^[A-Za-z0-9_-]+$` and `["'<>\s]` rejection; malformed values compile to empty and are silently omitted (mirrors `GA_MEASUREMENT_ID` / `GOATCOUNTER_SITE_URL` handling in `app/vite.config.ts`).
- Artifact: `app/dist/robots.txt` already contains the `Sitemap:` line; `app/dist/sitemap.xml` already covers every prerendered route including expired offers (#205).

## References

- GSC verification: https://support.google.com/webmasters/answer/9008080
- Sitemaps spec: https://www.sitemaps.org/protocol.html
- Baseline audit: `docs/seo-baseline-2026-08-29.md`
