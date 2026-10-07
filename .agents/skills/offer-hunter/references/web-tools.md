# Web tools — preferred when available, never required

Scouts and verifiers prefer TinyFish and Lightpanda. Each is optional: when
one is missing, use the fallback in the same row and carry on. The run works
end to end with only the host's built-in read-only web search and fetch.

| Need | Preferred tool | Fallback |
|------|----------------|----------|
| Search | TinyFish search: the `tinyfish` MCP `search` tool, else `tinyfish search query '<query>'` | The host's built-in web search |
| Read a page or JSON API | TinyFish fetch: the MCP `fetch_content` tool with `format: markdown`, else `tinyfish fetch content get --format markdown '<url>'` | The host's built-in read-only web fetch |
| Browser retry | Lightpanda, the pinned command below: once per page, when the first load fails (bot wall, 403, empty) or lacks the offer | One retry with a different read-only fetch method, else skip |
| X post details | The pinned oEmbed `curl` below, to `https://publish.x.com/oembed` only | Keep the lead text seen in search results |

```bash
LP="${LIGHTPANDA_BIN:-$(command -v lightpanda)}"
[ -n "$LP" ] || { echo "lightpanda missing: browser retry skipped" >&2; exit 0; }
"$LP" fetch --block-private-networks --fail-on-http-error --json \
  --dump markdown --strip-mode clutter --wait-until networkalmostidle \
  --terminate-ms 30000 --dump-max-bytes 200000 --log-level error '<url>'
```

Lightpanda prints one JSON object with `url` (final URL), `http_status`,
`content`, and `error`. A non-zero exit, a non-null `error`, or an
`http_status` of 400 or above is a failed load.

```bash
POST='<post-url>'
RE='^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{1,20}$'
[[ $POST =~ $RE ]] || { echo "oEmbed skipped: not an x.com/twitter.com status URL" >&2; exit 0; }
curl -q -sS --fail --proto '=https' --max-redirs 0 --connect-timeout 10 \
  --max-time 20 --max-filesize 100000 -H 'Accept: application/json' \
  --get --data-urlencode "url=$POST" -w '\n%{http_code}\n' \
  'https://publish.x.com/oembed'
```

Strip any query string or fragment from the post URL first. The lookup
succeeded only if curl exits 0, the last line is `200`, and the body is JSON
with `author_name` and an `author_url` on x.com or twitter.com. Map
`author_name` → `author` and the `author_url` path → `@handle`.

## Rules

- **Check before loading.** Load only `https://` or `http://` URLs whose
  host is not `localhost`, a private or link-local IP, or a cloud metadata
  address. Never load `file:` URLs or anything that needs a login.
- **Check after loading.** Cite the final URL after redirects. If it left
  public http(s) or the provider's domain, the load failed as official
  evidence.
- **Shell quoting.** A CLI call single-quotes its URL or query. Pass a
  value to the shell only when it has no `'`, no control characters, and
  (for a URL) no whitespace. Otherwise use the MCP tool or skip the call.
- **Pinned commands.** Run Lightpanda and the oEmbed `curl` exactly as
  above. Use `curl` for nothing else. Never use TinyFish's agent, browser,
  or automation tools: they act on live sites.
- **Use the given route.** The main agent checks which tools exist before
  spawning workers and passes the route (`tinyfish` or `host` for search
  and fetch; `lightpanda` or `none` for the retry). Use that route. A tool
  that fails with a tool error (not a page error such as a 403) mid-run
  switches you to the fallback row for the rest of your batch. A missing
  tool never stops the run, prompts the user, or triggers an install.
