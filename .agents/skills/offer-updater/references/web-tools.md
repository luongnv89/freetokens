# Web tools — TinyFish searches and reads, Lightpanda is the browser

Every search and page load in offer-updater uses these tools. They are
pinned for this skill and override any general preference for TinyFish's
agent or automation tools.

| Need | Tool |
|------|------|
| Search | TinyFish search: the `tinyfish` MCP server's `search` tool, else `tinyfish search query '<query>'` |
| Read a page | TinyFish fetch: the MCP `fetch_content` tool with `format: markdown`, else `tinyfish fetch content get --format markdown '<url>'` |
| oEmbed (Step 1) | TinyFish fetch with `format: json` (CLI `--format json`); outside the Step 2 fetch budget |
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
- **Pinned commands.** Run Lightpanda exactly as above: add no flags, and
  use no subcommand other than `fetch`. Never use TinyFish's agent, browser,
  or automation tools.

## Fallback

- No TinyFish (no MCP tool, no CLI, or not authenticated): use the host's
  built-in read-only web search and fetch, under the same rules. If it
  cannot keep loads to public `http(s)` pages, the offer is unverifiable.
- No Lightpanda: skip the browser retry; a bot-walled offer page is then
  unverifiable.
- Name every fallback and skipped retry in a one-line **Web tools** note in
  the Step 5 presentation.
