# auth.md

You are an agent. Free AI Credits (`https://freetokens.custats.info`) is a
static, read-only directory of free AI credit offers. **This service requires
no authentication and supports no registration.** The only access mode is
anonymous: plain HTTPS GET with no credentials. There is no `/agent/identity`
endpoint, no claim ceremony, and no token endpoint — do not look for them.

## Step 1 — Discover

- Protected Resource Metadata (RFC 9728):
  `GET /.well-known/oauth-protected-resource`
- Authorization Server metadata (RFC 8414):
  `GET /.well-known/oauth-authorization-server` — its `agent_auth` block points
  back to this document and declares `identity_types_supported: ["anonymous"]`
  with `credential_types_supported: ["none"]`: anonymous access carries no
  credential, so there is nothing to claim.
- OpenAPI description of the read-only surface: `GET /openapi.json`

## Step 2 — Register

Nothing to do. Anonymous access is the only mode this service supports: no
registration endpoint exists, no credentials are issued, and there is no claim
step. Skip straight to Step 3.

## Step 3 — Read the catalog

- `GET /llms.txt` — top offers plus trust-label definitions
  (`review_status` / `verification` / `signup` / `last_checked`)
- `GET /llms-full.txt` — full export of every active offer
- `GET /offers/{slug}.md` — Markdown twin of any offer detail page
- `GET /feed.xml` — RSS of listing changes
- `GET /` — the HTML directory itself
- `GET /.well-known/agent-skills/freetokens-offers/SKILL.md` — the skill
  manifest for reading this catalog

## Scopes and revocation

No scopes exist and no access tokens are issued, so there is nothing to
request, nothing to carry in an `Authorization` header, and nothing to revoke.

## Human documentation

- About the site and how listings are reviewed:
  `https://freetokens.custats.info/about.html`
- Source repository and issue tracker:
  `https://github.com/luongnv89/freetokens`
