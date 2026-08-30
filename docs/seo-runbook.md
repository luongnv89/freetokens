# SEO Runbook — Free AI Credits

> Maintainer playbook for keeping search, social, and AI-bot discoverability correct without a dedicated SEO team. If you can add an offer YAML and run `npm run build`, you can ship correct SEO.

- **Baseline snapshot:** [`docs/seo-baseline-2026-08-29.md`](seo-baseline-2026-08-29.md) — audited `app/dist/*.html` at `d7bd97bd` / `94b5aec` against `python3 scripts/audit_seo.py app/dist`.
- **Live URLs:**
  - Site: <https://luongnv89.github.io/freetokens/>
  - Sitemap: <https://luongnv89.github.io/freetokens/sitemap.xml>
  - Robots: <https://luongnv89.github.io/freetokens/robots.txt>
  - llms.txt: <https://luongnv89.github.io/freetokens/llms.txt> (and `llms-full.txt` when task #210 is on `main`)
  - RSS: <https://luongnv89.github.io/freetokens/feed.xml>
- **Code owners:** `app/scripts/prerender.mjs`, `app/scripts/sitemap.mjs`, `app/scripts/feed.mjs`, `app/scripts/generate-llms.mjs` (when present), `app/src/components/Breadcrumbs.tsx`, `app/public/robots.txt`.

---

## 1. Add an offer → correct OG / canonical / JSON-LD / sitemap automatically

No manual SEO step. Every field below is derived from the YAML you commit.

### 1.1 One-file contract

```bash
# 1. Create the offer file (slug becomes the URL identity forever)
cat > offers/my-provider-free-credits.yaml <<'YAML'
title: My Provider Free Credits
provider: My Provider
category: api_provider   # api_provider | coding | image | voice | video | startup_program | student
amount: $100 in API credits
expiry_date: 2026-12-31  # null if ongoing
source_url: https://example.com/offer
verified_date: 2026-08-30
verification: social_proof
review_status: verified
signup: required
YAML

# 2. (optional) richer detail page — at least one field required
mkdir -p offers/details
cat > offers/details/my-provider-free-credits.json <<'JSON'
{
  "summary": "One-paragraph summary shown on the detail card (≤2000 chars).",
  "claim_steps": ["Go to the source URL", "Create an account", "Credits appear in billing"],
  "social_proof": [{"type": "link", "url": "https://example.com/proof", "title": "Provider announcement"}]
}
JSON

# 3. Validate + build + inspect (under 90 s on a warm cache)
python3 scripts/validate_offers.py
cd app && npm ci   # first time only; thereafter `npm run build` is enough
npm run build
```

Pushing the YAML to `main` is the deploy — `deploy.yml` runs `validate_offers.py → npm test → npm run build → Pages deploy` and an offer merged to `main` is live in ~1–2 minutes.

### 1.2 What the build injects for you

| Signal | Where it comes from | How it is rendered |
|--------|---------------------|-------------------|
| `<link rel="canonical">` | `app/scripts/prerender.mjs` → `DEFAULT_BASE_URL` (`https://luongnv89.github.io/freetokens`) unless `--base-url` overrides | One tag per document, `website` on `index/archive/privacy`, `article` on offer detail. Duplicate tags stripped via `CANONICAL_LINK_RE`. Missing canonical fails the build (`descriptionCount === 0` guard analogy). |
| `og:title`, `og:description`, `og:url`, `og:type`, `og:site_name`, `og:image` + `twitter:card/title/description/image` | Same prerender step — `renderSocialMetadata()` in `prerender.mjs` between `<!-- free-ai-credits:social-meta:start -->` markers | `og:image` → `logo-mark.svg` (absolute). Verified by `app/tests/routes.test.mjs` expecting exactly one social block. |
| `<meta name="description">` | `offerMetaDescription()` — detail `summary` truncated at 160 chars, else `"<amount> from <provider> — free AI credits, tagged by verification level and sign-up need."` | One tag per document; home/archive/privacy have hand-written descriptions. |
| JSON-LD `BreadcrumbList` | `app/src/components/Breadcrumbs.tsx` (`safeJsonLd()` escapes `&<>`) — visible trail and JSON-LD share `buildBreadcrumbItems()` | Home has no breadcrumbs (and no JSON-LD); `archive`/`privacy` render `Offers → Archive/Privacy`; `offers/<slug>.html` renders `Offers → <title>`. `pages.test.tsx` asserts trail and JSON-LD stay in same order and that titles are escaped parseably. |
| `sitemap.xml` | `app/scripts/sitemap.mjs:buildSitemap()` called from `prerender.mjs` | Covers every prerendered route including expired offers + `feed.xml`. `lastmod` = `verified_date` (clamped to today UTC) → file mtime fallback → `generated_at`. Validated against namespace `http://www.sitemaps.org/schemas/sitemap/0.9`, 50k URL / 50 MB / 2048-char loc limits. `robots.txt` advertises it with `Sitemap: https://luongnv89.github.io/freetokens/sitemap.xml`. |
| `feed.xml`, `llms.txt` / `llms-full.txt` | `feed.mjs` / `generate-llms.mjs` invoked in the same `postbuild` | Not SEO-indexed, but they share the same `offers.json` source of truth so sitemap and feed never diverge. |

### 1.3 5-minute smoke test (the acceptance gate)

This is the exact fixture the PR that introduced this runbook used — copy-paste it:

```bash
python3 - <<'PY'
from pathlib import Path
Path("offers/smoke-fixture-test-offer.yaml").write_text(
"title: Smoke Fixture — Test Offer\n"
"provider: Smoke Provider\n"
"category: api_provider\n"
"amount: $1 in test credits\n"
"expiry_date: null\n"
"source_url: https://example.com/smoke-fixture\n"
"verified_date: 2026-08-30\n"
"verification: social_proof\n"
"review_status: verified\n"
"signup: required\n"
)
PY
python3 scripts/validate_offers.py
cd app && npm run build
# Assertions a future contributor can run without asking the author:
grep -q 'rel="canonical" href="https://luongnv89.github.io/freetokens/offers/smoke-fixture-test-offer.html"' app/dist/offers/smoke-fixture-test-offer.html
grep -q 'property="og:title"' app/dist/offers/smoke-fixture-test-offer.html
grep -q 'application/ld+json' app/dist/offers/smoke-fixture-test-offer.html
grep -q 'smoke-fixture-test-offer.html' app/dist/sitemap.xml
grep -q 'property="og:url"' app/dist/index.html
python3 scripts/audit_seo.py app/dist   # expect 0 Critical after #210; 0 canonical/viewport/lang regardless
# clean up
rm offers/smoke-fixture-test-offer.yaml
cd app && npm run build   # remove fixture from dist again
```

If that script exits zero, "add offer → correct SEO on deploy" is intact.

---

## 2. Verify `robots.txt` / `llms.txt` / `sitemap.xml` locally

All three are static copies or generated artifacts — never hand-edited in `dist/`.

```bash
cd app && npm run build

# Files that must exist after build
ls -l app/dist/robots.txt app/dist/sitemap.xml app/dist/feed.xml
# llms.txt lives in app/public/llms.txt and is copied verbatim by Vite;
# after #210 it is also generated at `public/` + `dist/` by generate-llms.mjs
ls -l app/public/llms.txt app/dist/llms.txt 2>&1 | head

# Content checks
grep -q "Sitemap: https://luongnv89.github.io/freetokens/sitemap.xml" app/dist/robots.txt && echo "robots sitemap ok"
grep -q "User-agent: GPTBot" app/dist/robots.txt && echo "training crawler block present"
grep -q "User-agent: Googlebot" app/dist/robots.txt && echo "search allow present"

xmllint --noout app/dist/sitemap.xml 2>&1 | head   # or: python3 -c "import xml.etree.ElementTree as ET; ET.parse('app/dist/sitemap.xml')"
grep -c "<url>" app/dist/sitemap.xml               # one per route
grep -q "Free AI Credits" app/dist/llms.txt && echo "llms.txt header ok"   # after #210

# Unified audit (covers canonical/OG/Twitter/JSON-LD + robots+sitemap existence)
python3 scripts/audit_seo.py app/dist              # human-readable
python3 scripts/audit_seo.py --json app/dist | python3 -m json.tool | head -n 80
python3 scripts/audit_seo.py --fail-on-critical app/dist  # CI gate: exits 1 on critical
```

Common fixes:

- **Missing `robots.txt` in `dist/`:** ensure `app/public/robots.txt` exists — Vite copies `public/` verbatim. Check `scripts/audit_seo.py` lists it under the critical artifact section.
- **`llms.txt` not in `dist/`:** on branches before #210 this is expected (the audit warns `No llms.txt`). After #210, `app/scripts/generate-llms.mjs` runs in `prebuild`/`postbuild` and writes both `app/public/` and `app/dist/`.

---

## 3. Submit to Google Search Console (GSC)

One-time setup, then every deploy is automatic via the sitemap.

1. **Verify ownership** of `https://luongnv89.github.io/freetokens/` in [Search Console](https://search.google.com/search-console) (URL-prefix property). The HTML-file or DNS methods both work; this site uses the GitHub Pages URL-prefix path.
2. **Submit the sitemap:** left nav → **Sitemaps** → paste `https://luongnv89.github.io/freetokens/sitemap.xml` → **Submit**. GSC will show discovered URLs count matching `grep -c "<url>" app/dist/sitemap.xml`.
3. **Request indexing for a new offer:** **URL Inspection** → paste `https://luongnv89.github.io/freetokens/offers/<slug>.html` → **Test live URL** → **Request indexing**. No extra step for home/archive — they are already in the sitemap.
4. **Verify after deploy:** in GSC, **Pages** → indexed vs not indexed should converge within hours. `robots.txt` at `https://luongnv89.github.io/freetokens/robots.txt` must show the `Sitemap:` line and the per-agent blocks from §2; fetch it as Googlebot in GSC's robots tester if the policy was just changed.
5. **Bing / others:** paste the same sitemap URL in Bing Webmaster Tools; `robots.txt` already advertises it via the `Sitemap:` directive so crawlers that respect it need no manual step.

No sitemap resubmit is needed per offer — the file is regenerated on every build and Pages serves the fresh copy.

---

## 4. Audit noise vs real signal — how to read results

### 4.1 The one source of truth

`python3 scripts/audit_seo.py app/dist` is canonical. It audits **only `app/dist/*.html`** (the three top-level documents); nested `offers/*.html` are excluded by design — use `app/tests/routes.test.mjs` for per-detail assertions. The script exits zero even with findings; add `--fail-on-critical` for a CI gate.

- **Critical** — blocks indexing or sharing: missing canonical, missing all OG tags, invalid or missing JSON-LD, missing `robots.txt`/`sitemap.xml`, missing `<h1>`. Fix before merge.
- **Warning** — reduces richness: missing Twitter Cards, multiple canonicals/JSON-LD blocks, multiple `<h1>`, missing viewport/lang. Fix when convenient.
- **Info** — not emitted by the current script; reserved for future checks.

### 4.2 What is noise (safe to ignore)

- **Lighthouse "SEO 90" swings** between runs on the same commit (e.g., 90 ↔ 100 from tap-target or font-display timing) — not a regression. Re-run Lighthouse mobile-emulated and compare `docs/qa/lighthouse-mobile-*.json` before opening a bug.
- **GSC "Discovered — currently not indexed" in the first 24 h** after an offer is added — sitemap discovery lags indexing. Use **URL Inspection → Test live URL** for the ground truth; the audit above is stronger signal.
- **"No llms.txt" warning before #210 is merged** — expected on `main` until that branch lands. After #210 the same audit passes that check.
- **OG image warnings about `logo-mark.svg` not being a raster** — the site deliberately uses an SVG share image to avoid a third-party raster service; social debuggers may suggest a PNG but this is policy, tracked by `feat/213-og-raster`.

### 4.3 What is real signal (act immediately)

- Any `Missing canonical tag` or `Missing OG tags` on `app/dist/*.html` after a build — the prerender injection in `prerender.mjs` is broken.
- `Invalid JSON-LD structured data` — the breadcrumb JSON in `Breadcrumbs.tsx` is malformed (check `safeJsonLd` escaping).
- `Missing robots.txt` / `Missing sitemap.xml` — `app/public/robots.txt` was deleted or `buildSitemap()` threw (check `lastmod` clamping or MAX_URLS).
- GSC "**Submitted URL blocked by robots.txt**" — cross-check `app/public/robots.txt` policy A blocks: only `GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`, `Bytespider` should be `Disallow`. Search bots must stay `Allow`.

### 4.4 After every SEO-related change

```bash
python3 scripts/audit_seo.py --fail-on-critical app/dist
python3 scripts/audit_seo.py --json app/dist | python3 -m json.tool | head
cd app && npm test   # includes routes.test.mjs canonical/OG/sitemap/JSON-LD guards
```

Keep `docs/seo-baseline-*.md` as the frozen point-in-time snapshot; do not edit it. Add a new dated baseline file if you need one.

---

## 5. Supply-chain choices — why the sitemap (and feeds) are Vite-custom

**Why not `next-sitemap`, `sitemap` (npm), or `astro-sitemap`?**

- The site is **not Next.js, not Astro** — it is Vite + React 19 + TypeScript (`app/vite.config.ts`, ADR-002). A Next/Astro plugin would pull in a framework peer the app does not use and would still need a post-build hook to include expired-offer pages.
- **Minimal dependencies** is a carried constraint from ADR-001 → ADR-002. `app/scripts/sitemap.mjs` (~165 lines), `feed.mjs`, and `generate-llms.mjs` are **zero-dependency** ES modules that read the same `src/data/offers.json` the prerender reads. Adding `next-sitemap` would add a transitive tree for a job that is ~30 lines of XML string-building.
- **Behavior must match the app's contract:** expired offers stay in the sitemap (they have detail pages), `lastmod` prefers `verified_date` then file mtime then `generated_at`, all clamped to UTC today, 50k/50 MB/2048 guards per the sitemap protocol. A generic plugin would need the same overrides anyway — less code to own the few lines than to fork the plugin.
- The same argument retired `scripts/build.py` (4.5 k lines of string templates) in ADR-002: own the prerender, use `esbuild` already in Vite's tree, avoid adding a bespoke static-site framework.

When a future standard changes (e.g., sitemap index sharding past 50k URLs), extend `app/scripts/sitemap.mjs` in place — the thresholds `MAX_SITEMAP_URLS` / `MAX_SITEMAP_XML_BYTES` / `MAX_SITEMAP_LOC_LENGTH` already mirror the spec and are exercised by `app/tests/routes.test.mjs` and `app/tests/sitemap.test.mjs` where present.

---

## 6. Quick reference — files to touch (and not touch)

| Task | Edit | Do not edit | Verify |
|------|------|-------------|--------|
| Change offer content | `offers/*.yaml` (+ `offers/details/*.json`) | `app/dist/**`, `index.json` (generated) | `validate_offers.py` + `npm run build` |
| Change OG/canonical/description | `app/scripts/prerender.mjs` | generated HTML | `routes.test.mjs` + `audit_seo.py` |
| Change sitemap shape | `app/scripts/sitemap.mjs` | `app/dist/sitemap.xml` | `sitemap.test.mjs` + `audit_seo.py` |
| Change crawl policy | `app/public/robots.txt` | `app/dist/robots.txt` | `grep` + GSC robots tester |
| Change AI-bot text | `app/scripts/generate-llms.mjs` + `app/public/llms.txt` | `app/dist/llms.txt` (copy) | `audit_seo.py` no-llms warning gone |

---

*Last updated: 2026-08-30 · PR closing #220 · Baseline: `docs/seo-baseline-2026-08-29.md`.*
