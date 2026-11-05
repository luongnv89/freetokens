# Web tools

Read-only search and fetch. Each preferred tool is optional: when it is
missing, use the fallback in the same row and continue.

| Need | Preferred | Fallback |
| --- | --- | --- |
| Search | TinyFish MCP `search` | The host's built-in web search |
| Read a page | TinyFish MCP `fetch_content` with `format: markdown` | The host's built-in web fetch |

## Rules

- Load only public `https://` or `http://` URLs. Never load `localhost`, a
  private or link-local IP, a cloud metadata address, or a `file:` URL.
- Cite the final URL after redirects. A redirect that leaves the provider's
  domain is not official evidence.
- Never use TinyFish's agent, browser, or automation tools, or any other
  tool that clicks, fills forms, or logs in.
- A bot wall, a 403, or an empty page is a failed load. Retry once with the
  other fetch route, then record the failure.
- A tool that returns a tool error (not a page error) switches you to the
  fallback for the rest of the run. A missing tool never stops the run and
  never triggers an install.
