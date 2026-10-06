# DNS-AID Runbook — DNS-based agent discovery for freetokens.custats.info

> Owner playbook for issue #525 (epic #522). **This is a DNS-provider change, not a
> repository change.** Nothing committed here can publish the records — GitHub Pages
> only serves the site; the `custats.info` zone is configured at the DNS host.
> Merging this file documents the required records; the isitagentready check stays
> `fail` until the owner applies them below and re-scans.

- **Check:** `checks.discoverability.dnsAid` on <https://isitagentready.com>
- **Spec:** IETF `draft-mozleywilliams-dnsop-dnsaid` — ServiceMode `SVCB`/`HTTPS`
  records (RFC 9460) under the `_agents` namespace, with DNSSEC validation.
- **Guide:** <https://isitagentready.com/.well-known/agent-skills/dns-aid/SKILL.md>

---

## 1. Current state (verified 2026-10-06)

| Item | Value | How to re-check |
|------|-------|-----------------|
| Zone | `custats.info` — NS `ns31.domaincontrol.com`, `ns32.domaincontrol.com` (GoDaddy) | `dig +short NS custats.info` |
| Site name | `freetokens.custats.info` → `CNAME luongnv89.github.io` (GitHub Pages) | `dig +short CNAME freetokens.custats.info` |
| `_agents` records | none — `NXDOMAIN` | `dig +short HTTPS _index._agents.freetokens.custats.info` |
| DNSSEC | zone unsigned — no `DS` at the parent | `dig +short DS custats.info` |

## 2. What the scanner queries

From the live scan evidence, the checker resolves — via DNS-over-HTTPS with the
DNSSEC flag set (`do=1`) — exactly these names under `freetokens.custats.info`:

```text
SVCB  / HTTPS  _index._agents.freetokens.custats.info
SVCB  / HTTPS  _a2a._agents.freetokens.custats.info
SVCB  / HTTPS  _mcp._agents.freetokens.custats.info
TXT            _index._agents.freetokens.custats.info
```

and records `dnssecValidated` on the answer. One honest ServiceMode record is
enough to flip the check — do **not** publish `_a2a`/`_mcp` records for endpoints
the site does not run ("don't advertise endpoints you don't actually offer").

## 3. The record to publish

In the `custats.info` zone (owner name `_index._agents.freetokens` relative to
the apex — a descendant of the CNAME is served from this zone normally, the
CNAME does not apply to names below it):

```dns
_index._agents.freetokens.custats.info. 3600 IN HTTPS 1 freetokens.custats.info. alpn="h2,http/1.1" port=443
```

- **Type `HTTPS`** (RR 65) — the site is an HTTPS endpoint; a `SVCB` (RR 64)
  record with identical content is an accepted equivalent.
- **SvcPriority `1`** = ServiceMode (priority 0 is AliasMode and wrong here).
- **Target `freetokens.custats.info.`** — the site's own name; it keeps working
  through the existing CNAME to GitHub Pages.
- **`alpn="h2,http/1.1"`** — what the origin actually serves (verified: the site
  answers HTTP/2); **`port=443`**.

## 4. Why the zone has to move first

GoDaddy hosted DNS does not support `SVCB`/`HTTPS` record types, and the zone is
unsigned — both requirements are impossible while `domaincontrol.com` is the
authoritative NS. Move DNS hosting to a provider with HTTPS/SVCB records and
one-click DNSSEC (Cloudflare's free tier is the canonical choice for a zone
this size).

**Sequence — order matters:**

1. Add `custats.info` to Cloudflare; let it import existing records. Keep
   `freetokens` as `CNAME → luongnv89.github.io`, **DNS-only (grey cloud)** so
   GitHub Pages keeps terminating TLS with its own certificate.
2. Publish the record from §3 (dashboard: type `HTTPS`; or `dns` API with
   `type: "HTTPS"`, `data: {priority: 1, target: "freetokens.custats.info.",
   value: 'alpn="h2,http/1.1" port=443'}`).
3. At the GoDaddy registrar, change NS for `custats.info` to the assigned
   Cloudflare nameservers and wait for the zone to report **Active**.
4. Enable DNSSEC in Cloudflare → copy the DS record it shows → add that DS at
   GoDaddy (registrar console → DNSSEC). Wait for `dig +short DS custats.info`
   to return it.
5. Verify (§5), then re-scan. Only then does `checks.discoverability.dnsAid`
   report `pass`.

Rollback: remove the DS record at GoDaddy first, then disable signing at the
DNS host — never disable signing while the DS is still published.

## 5. Verification

```bash
# Record resolves (any validating resolver)
dig +short HTTPS _index._agents.freetokens.custats.info

# DNSSEC chain is live at the parent
dig +short DS custats.info

# Same DoH probe the scanner runs — expect "Status":0, "AD":true, answers non-empty
curl -sS -H 'Accept: application/dns-json' \
  'https://cloudflare-dns.com/dns-query?name=_index._agents.freetokens.custats.info&type=HTTPS&do=1'

# Final gate — the scanner re-run
curl -sS -X POST https://isitagentready.com/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://freetokens.custats.info"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["checks"]["discoverability"]["dnsAid"]["status"])'
# expect: pass
```

## 6. References

- IETF draft: <https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/>
- SVCB/HTTPS records: RFC 9460
- Epic #522 (agent readiness); sibling P1 tasks land in-repo — this one cannot
- Agent-readiness plan task 1.2 → verification is the re-scan in §5

*Last updated: 2026-10-06 · PR closing #525 (docs only — DNS publication is owner action).*
