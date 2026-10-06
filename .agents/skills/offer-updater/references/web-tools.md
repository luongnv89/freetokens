# Web tools — TinyFish searches and reads, Lightpanda is the browser

Every search and page load in offer-updater uses these tools. They are
pinned for this skill and override any general preference for TinyFish's
agent or automation tools.

| Need | Tool |
|------|------|
| Search | TinyFish search: the `tinyfish` MCP server's `search` tool, else `tinyfish search query '<query>'` |
| Read a page | TinyFish fetch: the MCP `fetch_content` tool with `format: markdown`, else `tinyfish fetch content get --format markdown '<url>'` |
| oEmbed (Step 1) | The pinned `curl` command below, to `https://publish.x.com/oembed` only; outside the Step 2 fetch budget. TinyFish fetch fails on this endpoint (`invalid_redirect_url`). |
| Browser (retry) | Lightpanda, the command below: only for the offer page, once, when TinyFish fetch fails or returns a page without the offer. It is the budget's retry fetch. |

```bash
LP="${LIGHTPANDA_BIN:-$(command -v lightpanda)}"
[ -n "$LP" ] || { echo "lightpanda missing: browser retry skipped" >&2; exit 0; }
"$LP" fetch --block-private-networks --fail-on-http-error --json \
  --dump markdown --strip-mode clutter --wait-until networkalmostidle \
  --terminate-ms 30000 --dump-max-bytes 200000 --log-level error '<url>'
```

Lightpanda prints one JSON object with `url` (final URL after redirects),
`http_status`, `content`, and `error`. It exits 1 or 22 on a failed load
but still prints the JSON. A non-zero exit, a non-null `error`, or an
`http_status` of 400 or above is a failed fetch. `--block-private-networks`
blocks private addresses after DNS resolution, redirects included.

The oEmbed lookup runs this command once per X post, with the post URL
in place of `<post-url>`:

```bash
POST='<post-url>'
RE='^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{1,20}$'
[[ $POST =~ $RE ]] || { echo "oEmbed skipped: not an x.com/twitter.com status URL" >&2; exit 0; }
curl -sS --fail --proto '=https' --max-redirs 0 --connect-timeout 10 \
  --max-time 20 --max-filesize 100000 -H 'Accept: application/json' \
  --get --data-urlencode "url=$POST" -w '\n%{http_code}\n' \
  'https://publish.x.com/oembed'
```

The check accepts only `https://x.com/<handle>/status/<id>` or the same on
`twitter.com` (optional `www.`), with no query string or fragment; strip
those from the post URL before the check. The command reads one fixed
host and follows no redirects, so the final URL is the request URL. It
prints the JSON body, then the HTTP status on the last line. The lookup
succeeded only if curl exits 0, the status is `200`, and the body is JSON
with an `author_name` and an `author_url` on `x.com` or `twitter.com`.
Anything else, including a skipped check, means oEmbed is unreachable:
use the Step 1 fallback.

## Rules

- **Check before loading.** Load only URLs that start with `https://` or
  `http://` and whose host is not `localhost`, a private or link-local IP
  literal, or a cloud metadata address.
- **Check after loading.** Cite the final URL (Lightpanda `url`, TinyFish
  `final_url`). If it leaves public `http(s)` or the provider's domain, the
  fetch failed for official evidence.
- **Shell quoting.** A CLI call single-quotes its URL or query. Pass a value
  to the shell only when it contains no `'` or control characters, and a URL
  also no whitespace. Otherwise use the MCP tool or skip that call.
- **Pinned commands.** Run Lightpanda and the oEmbed `curl` exactly as
  above: add no flags, use no Lightpanda subcommand other than `fetch`, and
  use `curl` for nothing but the oEmbed lookup. Never use TinyFish's agent,
  browser, or automation tools.

## Fallback

- No TinyFish (no MCP tool, no CLI, or not authenticated): use the host's
  built-in read-only web search and fetch, under the same rules. If it
  cannot keep loads to public `http(s)` pages, the offer is unverifiable.
- No Lightpanda: skip the browser retry; a bot-walled offer page is then
  unverifiable.
- No `curl`, or the oEmbed lookup fails: treat oEmbed as unreachable and
  use the Step 1 fallback.
- Name every fallback and skipped retry in a one-line **Web tools** note in
  the Step 5 presentation.
