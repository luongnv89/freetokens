# SEO Baseline Audit — 2026-08-29

**Audited source revision:** `d7bd97bd40002ab923affa6e43b1623ead7daa55` (`origin/main` before this baseline)

**Audit captured:** 2026-08-29T19:40:31Z

**Build:** `cd app && npm run build`, run from the application tree at `d7bd97bd40002ab923affa6e43b1623ead7daa55`. The baseline files were added afterward and do not alter that build output.

**Scope:** `app/dist/*.html` — the three top-level documents `index.html`, `archive.html`, and `privacy.html`. Nested `app/dist/offers/*.html` documents are outside this baseline's `dist/*.html` scope and should be covered by the later per-route SEO tasks.

**Audit command:** `python3 scripts/audit_seo.py app/dist`

## Audit Summary

| Severity | Count |
|----------|------:|
| Critical | 11 |
| Warning | 3 |
| Info | 0 |

### Critical findings

- `archive.html`, `index.html`, and `privacy.html`: missing canonical tag (3 findings).
- `archive.html`, `index.html`, and `privacy.html`: missing all six Open Graph properties — `og:title`, `og:description`, `og:url`, `og:type`, `og:image`, and `og:site_name` (3 findings).
- `archive.html`, `index.html`, and `privacy.html`: missing JSON-LD structured data (3 findings).
- `app/dist/robots.txt` is absent (1 finding).
- `app/dist/sitemap.xml` is absent (1 finding).

### Warning findings

- `archive.html`, `index.html`, and `privacy.html`: missing the four Twitter Card properties — `twitter:card`, `twitter:title`, `twitter:description`, and `twitter:image` (3 findings).

### Info findings

None.

The three top-level pages each had one `<h1>`, an English `lang` attribute, and a viewport meta tag. Those checks produced no findings. The `robots.txt` and `sitemap.xml` checks above verify file existence only; they do not validate directive or XML contents.

## Reproducible grep evidence

The following checks were run from the repository root against the built `app/dist` at the audited revision. `grep -L` prints files that do not contain the requested signal.

### Canonical links

```console
$ grep -L -i 'rel="canonical"' app/dist/*.html
app/dist/archive.html
app/dist/index.html
app/dist/privacy.html
```

### Open Graph properties

```console
$ for property in og:title og:description og:url og:type og:image og:site_name; do printf '%s: ' "$property"; grep -L -i "property=\"$property\"" app/dist/*.html | tr '\n' ' '; printf '\n'; done
og:title: app/dist/archive.html app/dist/index.html app/dist/privacy.html
og:description: app/dist/archive.html app/dist/index.html app/dist/privacy.html
og:url: app/dist/archive.html app/dist/index.html app/dist/privacy.html
og:type: app/dist/archive.html app/dist/index.html app/dist/privacy.html
og:image: app/dist/archive.html app/dist/index.html app/dist/privacy.html
og:site_name: app/dist/archive.html app/dist/index.html app/dist/privacy.html
```

### JSON-LD

```console
$ grep -L -i 'application/ld+json' app/dist/*.html
app/dist/archive.html
app/dist/index.html
app/dist/privacy.html
```

### Robots and sitemap artifacts

```console
$ printf '%s\n' app/dist/robots.txt app/dist/sitemap.xml | while IFS= read -r file; do [ -f "$file" ] || printf '%s\n' "$file"; done | grep 'app/dist/'
app/dist/robots.txt
app/dist/sitemap.xml
```

### Twitter Card properties

```console
$ for property in twitter:card twitter:title twitter:description twitter:image; do printf '%s: ' "$property"; grep -L -i "name=\"$property\"" app/dist/*.html | tr '\n' ' '; printf '\n'; done
twitter:card: app/dist/archive.html app/dist/index.html app/dist/privacy.html
twitter:title: app/dist/archive.html app/dist/index.html app/dist/privacy.html
twitter:description: app/dist/archive.html app/dist/index.html app/dist/privacy.html
twitter:image: app/dist/archive.html app/dist/index.html app/dist/privacy.html
```

## Manual top-level document spot-check

| Document | Title / heading | Basic head signals | Missing at baseline |
|----------|-----------------|--------------------|---------------------|
| `app/dist/index.html` | `Free AI Credits`; one `<h1>` | `lang="en"`; viewport present | canonical, OG, Twitter Cards, JSON-LD |
| `app/dist/archive.html` | `Offer Archive · Free AI Credits`; one `<h1>` | `lang="en"`; viewport present | canonical, OG, Twitter Cards, JSON-LD |
| `app/dist/privacy.html` | `Privacy Policy · Free AI Credits`; one `<h1>` | `lang="en"`; viewport present | canonical, OG, Twitter Cards, JSON-LD |

## AI-Bot Policy Decision

**Chosen policy: A — allow search and user-requested retrieval; block AI training crawlers.**

This policy supports the exact PRD §1.4 success metric: **“Monthly unique visitors | ≥ 500 by day 30 post-launch | GA4 users report.”** Search indexing and user-requested retrieval remain available for organic and referred discovery, while training crawlers do not receive permission to copy the site's content into model-training datasets.

The lists below are the decision record for the future `robots.txt` directives. The current baseline intentionally records the policy separately from its implementation: `robots.txt` is one of the critical artifacts missing above.

- **Search / indexing bots — allow:** `Googlebot`, `Bingbot`, `DuckDuckBot`, `OAI-SearchBot`, `PerplexityBot`.
- **AI training / dataset crawlers — block:** `GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`, `Bytespider`.
- **On-demand / user-triggered retrieval bots — allow:** `ChatGPT-User`, `Claude-User`.

This split keeps the site discoverable in ordinary search and supports explicit user-requested answer retrieval without treating either as permission for general-purpose training collection. Task 2.3 should encode these categories explicitly and preserve the global search crawl allowance.

## Downstream use

Tasks 2.4 and 3.1 depend on this decision and baseline. Their entries in `tasks.md` pin this document to the commit that introduced it.

## Task 1.6 Exit-Gate Re-audit

**Audit captured:** 2026-08-29T22:27:01Z

**Audited source revision:** `94b5aec8bf08c275e0bc35f465efa70f8aed4b48` (main after Tasks 1.2–1.5)

**Build:** `cd app && npm run build` passed with Node `v26.7.0` / npm `11.19.0`. The Vite build and prerender emitted 57 routes: the three top-level documents, 53 offer pages, and `feed.xml`.

**Scope:** `app/dist/*.html` only. The audit script's `audit_directory` implementation intentionally enumerates sorted top-level HTML files, so the 53 nested `app/dist/offers/*.html` documents and non-HTML files are excluded from this baseline gate.

**Audit command:** `python3 scripts/audit_seo.py --json app/dist` passed. The issue's illustrative `--max-files 200` spelling is not supported by the current CLI; it is unnecessary for this three-page run because the script itself limits the audit to `dist/*.html`. CLI/path ergonomics remain tracked by #215. The result covered 3 files with 0 warnings and 0 info findings.

**Required SEO signals:** 0 `Missing canonical` findings, 0 `Missing viewport` findings, and 0 `Missing lang` findings. Manual top-level counts were exactly one canonical link and one `og:title` per page:

| Document | Canonical count | `og:title` count |
|----------|----------------:|-----------------:|
| `app/dist/index.html` | 1 | 1 |
| `app/dist/archive.html` | 1 | 1 |
| `app/dist/privacy.html` | 1 | 1 |

The existing route suite also exercises one complete, duplicate-free metadata set for every prerendered route and verifies repeated prerenders do not duplicate metadata (`app/tests/routes.test.mjs`).

**Remaining critical findings:** 5 intentional/deferred findings remain in the baseline audit: missing JSON-LD on the three top-level pages, plus missing `robots.txt` and `sitemap.xml`. They are outside Task 1.6's required canonical/viewport/lang exit gate and remain assigned to the downstream structured-data, sitemap, and robots.txt validation in #207; the related AI-readable-content work is tracked separately in #210. No unplanned implementation was added here.

**RSS verification:** `app/dist/feed.xml` parsed successfully as XML with root `rss` and 38 active-offer items. This preserves the feed generated by the build and satisfies the feed validity check for this gate.
