# ADR 0003 — Security & delivery headers on GitHub Pages

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Project owner (curator)
- **Resolves:** tasks.md Task 4.3 (issue #218); part of epic #197, Sprint 4 · Phase P2
- **Related:** [ADR 0002 — React + Vite migration](0002-react-vite-migration.md), deployment pipeline `.github/workflows/deploy.yml`

## Context

Task 4.3 requires hardening delivery headers where GitHub Pages allows it:
`Content-Security-Policy` if not present, `X-Content-Type-Options` audit,
HTTPS-only with no mixed-content (`http://` resources), and a decision note
on what Pages can/cannot set versus a Cloudflare-fronted alternative — with no
new runtime dependency.

## What GitHub Pages can and cannot set

| Header | Can Pages set it? | Evidence / posture |
|---|---|---|
| `Strict-Transport-Security` / HTTPS enforcement | **Yes, platform-provided.** Pages forces HTTPS and serves `Strict-Transport-Security` (HSTS) at the edge for `*.github.io`. It cannot be customized per-site but is always on. No action needed besides keeping all resource URLs `https://` or relative. | GitHub Docs: "GitHub Pages sites with custom domains enforce HTTPS when enabled; `*.github.io` is on the HSTS preload list." Verified via `curl -I https://luongnv89.github.io/freetokens/` (returns `strict-transport-security: max-age=31536000`) while the site was served from `*.github.io`. **Amended 2026-08-31:** the site now serves from the custom domain `freetokens.custats.info`, which is **not** on the `github.io` HSTS preload list. HSTS now depends on the repo's Pages `https_enforced` setting — enabled once the Let's Encrypt certificate was approved — rather than being inherited from the platform apex. |
| Custom response headers (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, etc.) | **No.** GitHub Pages has no `_headers`, `_config`, or header-rule mechanism. The origin serves a fixed set of headers; per-path custom headers are not supported. | GitHub Docs / Community: Pages does not honour `_headers` or `netlify.toml`-style header rules; request for custom headers is a long-standing open issue. `_headers` is a Cloudflare Pages / Netlify feature. |
| `<meta http-equiv>` fallbacks | **Yes, for a subset.** The browser honours `http-equiv="Content-Security-Policy"` and `<meta name="referrer">` inside HTML. Other headers (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Permissions-Policy`, `Cross-Origin-*`) are **header-only** and are ignored when set via `http-equiv`. | MDN / HTML spec: only `content-security-policy`, `content-type`, `default-style`, `x-ua-compatible`, and `refresh` are defined as `http-equiv` values; security headers outside that set have no meta equivalent. |

### Alternative: Cloudflare in front of Pages / Cloudflare Pages

A Cloudflare-fronted setup (either proxying `luongnv89.github.io` behind Cloudflare, or deploying to Cloudflare Pages) **can** set all of the above via either a `_headers` file or `_headers`/`_routes` rules and Transform Rules / Workers. That would allow a true header-based CSP (including `frame-ancestors`, `report-uri`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and a tuned `Strict-Transport-Security`.

**Not adopted.** The site stays on plain GitHub Pages for now: zero infra to operate, the existing deploy pipeline is already pinned and budgeted, and the incremental security benefit does not justify a hosting migration at current scale. The `_headers` file added in this ADR is **portable** — it is honoured if the site is later moved to Cloudflare Pages or Netlify without any code change, but has no effect on GitHub Pages today (served as a static asset at `/_headers`).

## Decision

1. **Add `<meta http-equiv="Content-Security-Policy">` and `<meta name="referrer">` fallbacks in `app/index.html`.** Every prerendered route in `dist/*.html` inherits them via the postbuild prerender (the Vite shell is the template). No new runtime dependency; the policy is static markup.
2. **Add `app/public/_headers` (Netlify / Cloudflare Pages `_headers` format)** with the full header set — CSP (including `frame-ancestors 'none'` which is header-only), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`. On GitHub Pages this file is inert (served as `/_headers`); on a future Cloudflare/Netlify host it applies automatically.
3. **Keep all resource URLs relative or `https://`, enable `upgrade-insecure-requests` in the CSP, and verify mixed-content hygiene at build time** (scan `dist/*.html` for `src="http://` / `href="http://`). No `http://` resource URLs are emitted — see Consequences / Verification.
4. **No new runtime dependency.** The hardening is build-time static markup plus an optional static `_headers` file.

### CSP value (meta + _headers)

```
default-src 'self';
script-src 'self' https://www.googletagmanager.com https://www.google-analytics.com https://*.goatcounter.com https://gc.zgo.at;
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self' data:;
connect-src 'self' https://www.google-analytics.com https://*.goatcounter.com https://www.googletagmanager.com https://gc.zgo.at;
base-uri 'self'; form-action 'self'; object-src 'none';
frame-ancestors 'none'; upgrade-insecure-requests
```

Rationale:

- `script-src` allows self + the two analytics origins that `vite.config.ts` / `prerender.mjs` may inject when `GA_MEASUREMENT_ID` / `GOATCOUNTER_SITE_URL` are set; when unset no external script is loaded, so the allowlist is harmless.
- **GoatCounter `count.js` lives at `https://gc.zgo.at`, not `*.goatcounter.com`.** `https://*.goatcounter.com` matches the site origin used for `/count` hits and `/counter/*.json`; it does not match `gc.zgo.at`. After the #227 head/CSP hardening, that gap blocked `loadGoatCounter` and any script-initiated fetches to the CDN. Issue #250 adds `https://gc.zgo.at` to both `script-src` and `connect-src`. Counter JSON stays on `https://*.goatcounter.com`.
- `style-src 'unsafe-inline'` is required for React inline `style` attributes and Tailwind's runtime; external styles remain `'self'`-only.
- `img-src https: data: 'self'` covers self-hosted SVGs and any `https:` offer image or social-proof screenshot while still blocking `http:` images (upgraded by `upgrade-insecure-requests`).
- `frame-ancestors 'none'` is enforced via the header variant; via `<meta>` it is intentionally left in the value but the browser correctly ignores it — the equivalent meta-only protection is `X-Frame-Options: DENY` via header on hosts that support it, and the site serves no framing use-case.
- `upgrade-insecure-requests` eliminates mixed-content without code changes if an `http://` URL slips into content.

`X-Content-Type-Options: nosniff` is included in `_headers` and as `<meta http-equiv="X-Content-Type-Options" content="nosniff">` in the shell. The meta form has no effect in browsers (header-only), but is kept as a visible audit marker; the real protection comes from the `_headers` file on supporting hosts, and from GitHub Pages' default `X-Content-Type-Options: nosniff` on some asset responses. The audit criterion for 4.3 is therefore "checked and documented", not "enforced via meta".

## Consequences

- **Mixed-content scan green.** With `baseUrl = https://luongnv89.github.io/freetokens`, `dist/*.html` contains zero `src="http://` or `href="http://` resource URLs. `http://` appears only inside human-readable offer detail text (e.g. a social-proof quote containing `http://genspark.ai`) — not as a fetched resource — so the Lighthouse "Is on HTTPS" and `upgrade-insecure-requests` checks pass. Verification: `grep -R 'href="http://\|src="http://' dist/ || echo OK`.
- **Security Headers scan — expected remaining warnings on GitHub Pages.** On `https://luongnv89.github.io/freetokens/` a scan at securityheaders.com / Mozilla Observatory will still flag missing **header-only** headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` as custom value, CSP as header) because Pages does not serve the custom `_headers` file. These are **not regressions** — they are the documented platform limit. They resolve automatically if the site moves to Cloudflare Pages/Netlify where `_headers` is honoured.
- **CSP via meta does not cover `frame-ancestors` / `report-uri` / `sandbox` as header directives.** Logged as backlog: if clickjacking protection must be header-enforced, migrate to Cloudflare-fronted Pages (see above). No user-visible breakage from this limit today.
- **No runtime cost.** The CSP and referrer policies are static `<meta>` tags; `_headers` is a static file. No middleware, no edge function, no client-side enforcement code.
- **Portability.** Moving to Cloudflare Pages requires no code change — the existing `_headers` file becomes active and the meta CSP becomes redundant (but harmless) defense-in-depth.

## Verification (repro)

```bash
cd app && npm run build   # vite build + postbuild prerender.mjs
# 1) Meta CSP present on every route
grep -q 'http-equiv="Content-Security-Policy"' app/dist/index.html
grep -q 'http-equiv="Content-Security-Policy"' app/dist/offers/*.html
grep -q 'name="referrer"' app/dist/index.html
# 2) No http:// resource URLs when baseUrl is https://
! grep -R -E '((href|src)="http://)' app/dist --include="*.html" | grep -v "http://genspark"
# 3) _headers shipped
test -f app/dist/_headers && head -n1 app/dist/_headers | grep -q "Content-Security-Policy"
```

## Alternatives rejected

- **Cloudflare Workers / `_headers` as primary now** — rejected: adds hosting migration for a low-priority P2 hardening task; the portable `_headers` plus meta CSP is the minimal increment that satisfies the acceptance criteria.
- **Runtime CSP via edge middleware** — rejected: violates "no new runtime dependency" and "Pages-only" constraints.
- **Inline `X-Content-Type-Options` enforcement via JS** — not possible; MIME sniffing is a browser/transport concern, not script-enforceable.

## Backlog (Pages-limited warnings)

- Promote `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy/Resource-Policy`, and header-based CSP (`frame-ancestors`, reporting) from "documented limit" to "enforced" by fronting Pages with Cloudflare or migrating to Cloudflare Pages when traffic or risk justifies it. Tracked as follow-up to #218; not blocking.
