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
- **Live, not build-time** — counts come from GoatCounter's public JSON
  counter route per page load, so displayed totals move without any
  rebuild or redeploy.
- **Cookieless** — no cookies, no fingerprinting, no personal
  identifiers; GDPR-compliant by design.
- **Silent degradation** — if the deployment is unreachable or blocked by
  an ad blocker, the footer strip simply stays hidden and every other
  page feature works unchanged.

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

The deploy workflow already passes it to the build step. Rules the build
enforces:

- Unset/empty keeps every piece of stats markup out of the built pages —
  zero beacon, zero strip, zero script.
- Malformed values (non-https, quotes, paths) are rejected with a build
  warning; they never break a deploy.

For local builds:

```bash
GOATCOUNTER_SITE_URL=https://luongnv89.goatcounter.com \
python3 scripts/build.py
```

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
4. Run `python3 -m unittest discover -s tests` — the suite covers all
   gating and degradation behavior.

## History

The first implementation (#62/#63) used self-hosted Counterscale on
Cloudflare Workers. It was replaced by GoatCounter because Cloudflare's
Analytics Engine — which Counterscale requires — is only available on
the paid Workers plan (~$5/mo). The old `STATS_ENDPOINT` /
`STATS_SITE_ID` secrets are obsolete and can be deleted.
