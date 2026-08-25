# Live traffic stats setup (GoatCounter)

Issue #62 adds a live traffic view to the site: a footer strip showing
visitors today and over the trailing 90 days, refreshed on every page
load — never baked in at build time. Counting is done by
[GoatCounter](https://www.goatcounter.com), open-source (EUPL), cookieless
web analytics whose hosted service is **free for non-commercial sites**
(unlimited pageviews; donation-supported).

Why this provider fits the freetokens constraints:

- **Free** — hosted plan costs nothing for non-commercial projects; no
  credit card, no self-hosting infrastructure.
- **Static-friendly** — nothing to run alongside GitHub Pages; the site
  only gains one `<script>` beacon and one client-side fetch.
- **Not build-time** — counts come from GoatCounter's public JSON
  counter route per page load, so displayed totals move without any
  rebuild or redeploy. They are not live to the minute, though; see
  *Freshness* below.
- **Cookieless** — no cookies, no fingerprinting, no personal
  identifiers; GDPR-compliant by design.
- **Silent degradation** — if the deployment is unreachable or blocked by
  an ad blocker, the footer strip simply stays hidden and every other
  page feature works unchanged.

## Freshness (measured, #102)

The figures are a rough popularity signal, not a live readout. GoatCounter
serves the counter route through a CDN that caches each response for about
four hours, keyed on `(path, start, end)`. Measured against the live site:

- unknown query params are stripped from the cache key — `_cb=111111`,
  `_cb=222222` and a random value all returned the same cached object
- `Cache-Control: no-cache`, `Pragma: no-cache` and `max-age=0` request
  headers changed nothing
- the CORS preflight returns no `access-control-allow-headers`, so sending
  `Cache-Control` from `fetch` would fail CORS regardless

So the cache cannot be bypassed from the page, and a cache-buster param is
inert — do not add one. This staleness is accepted deliberately: the footer
copy reads "site traffic" and the privacy policy states the lag, rather than
promising a live number the provider will not serve. Anyone who needs the
real-time figure follows the "full stats" link to the dashboard.

Two consequences worth remembering:

- **The window boundary matters.** `end` is an *exclusive* midnight
  boundary, so every window must end on tomorrow to include today. A window
  with `start == end` returns 0 forever — that was the #102 bug.
- **Only consenting visitors are counted at all.** The beacon loads solely
  after an explicit "Allow", so every figure here undercounts real traffic.

## Step 1 — Create the account

1. Sign up at <https://my.goatcounter.com/signup> and pick a site code
   (for example `luongnv89`, giving `https://luongnv89.goatcounter.com`).
2. In **Settings → Data collection**, make sure tracking is enabled
   (default) and note the site URL.
3. In **Settings → Visitor counter**, enable **"Allow adding visitor
   counts on your website"** — this is what makes the public JSON route
   (`/counter/TOTAL.json`) readable by visitors' browsers.
4. Optional but recommended for the strip's "full stats" link: in
   **Settings → Site**, enable a public dashboard so anyone can view the
   aggregate stats. If you keep it private, counting still works; only
   the link leads to a login page.

## Step 2 — Add one repository secret

Add a secret (**Settings → Secrets and variables → Actions**):

| Secret | Value | Example |
| --- | --- | --- |
| `GOATCOUNTER_SITE_URL` | https origin of your GoatCounter site (no path) | `https://luongnv89.goatcounter.com` |

The deploy workflow already passes it to the build step (Python builder until
the React cutover). The Vite app reads the **same** secret names
(`GA_MEASUREMENT_ID`, `GOATCOUNTER_SITE_URL`) at `vite build` / prerender
time via `app/vite.config.ts` — do not invent `VITE_` aliases. Unset or
malformed values compile to empty strings so no tracker id reaches the
bundle. Rules both builders enforce:

- Unset/empty keeps every piece of stats markup out of the built pages —
  zero beacon, zero strip, zero script.
- Malformed values (non-https, quotes, paths) are rejected with a build
  warning; they never break a deploy.

For local Vite builds (`app/`):

```bash
GA_MEASUREMENT_ID=G-XXXXXXXXXX \
GOATCOUNTER_SITE_URL=https://luongnv89.goatcounter.com \
npm run build
```

The React counter helper (`ftCounterUrl` in `app/src/lib/analytics.ts`)
sends only `start` and `end`. Do not add a cache-buster query param —
it is inert (see *Freshness* above). Every window still ends on tomorrow
so today is included (`end` is exclusive; that was the #102 bug).

## Verification

1. Load the built site with the secret exported and confirm:
   - `<head>` contains `<script async src="https://gc.zgo.at/count.js"
     data-goatcounter="…">`.
   - The home page footer contains the hidden strip
     (`<p class="foot-traffic" id="ft-traffic" … hidden>`).
2. Visit the live site, open devtools, and confirm two requests to
   `…/counter/TOTAL.json` return `200` with `{"count": "…"}`; the strip
   reveals itself with those numbers. (If they return `403`, re-check
   Step 1.3 — the visitor counter must be allowed.)
3. Block the request (devtools) and reload: everything else must work
   identically and the strip must remain invisible.
4. Run `python3 -m unittest discover -s tests` — the Python suite covers
   gating and degradation on the live builder.
5. In `app/`, run `npm test` — Vitest covers the React port: grant-only
   `gtag.js`, exclusive-end windows (#102), and no cache-buster param.

## History

The first implementation (#62/#63) used self-hosted Counterscale on
Cloudflare Workers. It was replaced by GoatCounter because Cloudflare's
Analytics Engine — which Counterscale requires — is only available on
the paid Workers plan (~$5/mo). The old `STATS_ENDPOINT` /
`STATS_SITE_ID` secrets are obsolete and can be deleted.
