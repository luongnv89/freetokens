# ADR 0004 — Markdown twins and RFC 8288 relations on GitHub Pages

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** Project owner (curator)
- **Resolves:** issues #524 and #526 (agent-ready plan tasks 1.1 / 1.3, epic #522)
- **Related:** [ADR 0003 — Security & delivery headers on GitHub Pages](0003-seo-headers.md)

## Context

The agent-readiness scan asks for two capabilities that are both edge-layer
features:

- `Accept: text/markdown` content negotiation (#524) — return a markdown body
  when the request asks for it.
- `Link:` response headers for agent discovery (#526, RFC 8288) — e.g.
  `Link: </llms.txt>; rel="describedby"`.

GitHub Pages can do **neither**: it serves one fixed HTML document per URL
with no access to the `Accept` header and no response-header mechanism — the
same platform limit ADR-0003 documents for security headers. A true
implementation needs an edge layer (Cloudflare Markdown for Agents, a Worker,
or a Netlify/Cloudflare `_headers`-honoring host), which is the same hosting
decision ADR-0003 deferred.

## Decision

Ship the in-repo approximation; record the header forms for a future edge.

1. **Per-route markdown twins.** `app/scripts/generate-markdown.mjs` (postbuild,
   after prerender) emits `<page>.md` next to every route: `index.md`,
   `archive.md`, `about.md`, `privacy.md`, `offers/<slug>.md`. Listing and
   detail twins are generated from `offers.json`/`details.json`; the prose
   twins are converted from each page's own prerendered `<main>` markup, so
   nothing drifts from a second copy of the copy.
2. **In-band discovery.** `prerender.mjs` stamps
   `<link rel="alternate" type="text/markdown">` on every prerendered page
   pointing at its absolute twin URL, and `app/index.html` carries the RFC 8288
   relations as HTML link elements — `rel="describedby"` → `llms.txt`,
   `rel="service-desc"` → `llms-full.txt`, `rel="service-doc"` → `about.html` —
   inherited by every route through the shared shell.
3. **`_headers` records the header forms.** `app/public/_headers` gains a `/`
   `Link:` block (the same relations, comma-separated per RFC 8288 §3) and a
   `/*.md` → `Content-Type: text/markdown` rule. Per ADR-0003 the file is inert
   on GitHub Pages and activates unchanged on Cloudflare Pages / Netlify.

## Consequences

- Agents that parse `<link>` elements (or fetch a `.md` sibling directly) get
  full markdown content today; no runtime machinery added.
- The scanner's `markdownNegotiation` and `linkHeaders` checks read **response
  headers / negotiated bodies**, which still require an edge layer — those two
  re-scan criteria stay unverifiable until the hosting decision in ADR-0003 is
  revisited. `_headers` already contains what the edge would need.
- `x-markdown-tokens` (the Cloudflare-style token-count header) is likewise
  edge-only; not approximated.

### Verification

```bash
cd app && npm run build          # emits dist/*.md twins + link elements
grep 'rel="alternate" type="text/markdown"' dist/index.html
ls dist/index.md dist/offers/*.md
```
