# Live traffic stats setup (Counterscale)

Issue #62 adds a live traffic view to the site: a footer strip showing
page views today and unique visitors over the trailing 90 days, refreshed
on every page load — never baked in at build time. Counting is done by
[Counterscale](https://counterscale.dev), MIT-licensed open-source web
analytics that you self-host on **your own Cloudflare account** using
Cloudflare Workers and the Analytics Engine.

Why this provider fits the freetokens constraints:

- **Free tier** — up to ~50k pageviews/day on Cloudflare's free Workers
  plan; scales cheaply beyond that.
- **Static-friendly** — nothing to run alongside GitHub Pages; the site
  only gains one `<script>` beacon and one client-side fetch.
- **Live, not build-time** — counts come from a JSON endpoint per page
  load, so the displayed totals move without any rebuild or redeploy.
- **Cookieless** — no cookies, no fingerprinting, no personal
  identifiers; aggregate data only, retained ~90 days by Cloudflare's
  Analytics Engine.
- **Silent degradation** — if the deployment is unreachable, blocked by
  an ad blocker, or fails CORS, the footer strip simply stays hidden and
  every other page feature works unchanged.

## Step 1 — Deploy Counterscale

1. Create a free [Cloudflare](https://dash.cloudflare.com/sign-up)
   account.
2. Create a Cloudflare API token with `Account.Account Analytics`
   permission (Counterscale's installer walks you through this).
3. From your machine, authorize Wrangler and run the installer:

   ```bash
   npx wrangler login
   npx @counterscale/cli@latest install
   ```

4. When prompted about dashboard protection you may choose **No**
   (public dashboard) — the read-only JSON route used for the live strip
   is served without authentication in that mode. Choosing **Yes**
   password-protects both the dashboard *and* the stats route, which the
   strip cannot authenticate against; prefer public mode unless you add
   auth yourself.
5. Verify the deployment at
   `https://{subdomain-emitted-during-deploy}.workers.dev`.

## Step 2 — Register the site

In the Counterscale dashboard, register a site whose ID identifies this
website (for example `luongnv89.github.io`). The same ID is used by the
beacon (`data-site-id`) and by the stats queries (`?site=`).

## Step 3 — Add repository secrets

Add two secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value | Example |
| --- | --- | --- |
| `STATS_ENDPOINT` | https origin of your deployment (no path) | `https://counterscale.yourname.workers.dev` |
| `STATS_SITE_ID` | the site ID registered above | `luongnv89.github.io` |

The deploy workflow already passes both to the build step. Rules the
build enforces:

- Both variables must be set together; a half-configured pair disables
  traffic counting with a build warning.
- Malformed values (non-https, quotes, paths) are rejected with a
  warning; they never break a deploy.
- Unset/empty keeps every piece of stats markup out of the built pages —
  zero beacon, zero strip, zero script.

For local builds:

```bash
STATS_ENDPOINT=https://counterscale.yourname.workers.dev \
STATS_SITE_ID=luongnv89.github.io \
python3 scripts/build.py
```

## Step 4 — Allow cross-origin reads (CORS)

The strip is filled by the visitor's browser fetching
`GET {STATS_ENDPOINT}/resources/stats?site={STATS_SITE_ID}&interval=…`.
Counterscale does not currently send
`Access-Control-Allow-Origin` headers, so browsers will block that fetch
when the site origin (`luongnv89.github.io`) differs from the worker
origin. The failure is silent (strip stays hidden), but to actually see
live numbers, make the stats route same-origin-accessible. Two options:

1. **Patch your deployed copy (recommended).** In your Counterscale
   checkout, wrap resource responses with CORS headers, e.g. in
   `packages/server/app/routes.ts` add a small middleware that sets
   `Access-Control-Allow-Origin: https://luongnv89.github.io` on
   `/resources/*` responses, then redeploy with
   `npx @counterscale/cli@latest install`. Pin the exact change to the
   version you deploy so upgrades stay deliberate.
2. **Front it with a custom-domain route on the same registrable
   domain** and relax the browser's origin check there — more moving
   parts; only worth it if you already operate such a proxy.

If you skip this step the site remains correct: counting still works
(the beacon posts via the tracker), only the visible strip stays hidden.

## Verification

1. Load the built site with the secrets exported and confirm:
   - `<head>` contains `<script defer src="…/tracker.js" data-site-id="…">`.
   - The home page footer contains the hidden strip
     (`<p class="foot-traffic" id="ft-traffic" … hidden>`).
2. Visit a page, open devtools, and confirm the two
   `resources.stats` requests return `200` with `{ "views": …,
   "visitors": … }`; after applying the CORS option the strip reveals
   itself with those numbers.
3. Block the request (devtools) and reload: everything else must work
   identically and the strip must remain invisible.
4. Run `python3 -m unittest discover -s tests` — the suite covers all
   gating and degradation behavior.
