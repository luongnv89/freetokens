# ADR 001 — Static site generator choice

- **Status:** Superseded by [ADR 002 — React + Vite migration](adr/0002-react-vite-migration.md)
- **Date:** 2026-08-21
- **Deciders:** Project owner (curator)
- **Resolves:** PRD Open Question #1 (issue #2, timeboxed spike)

## Context

The PRD (§6.2) allows two static-only approaches for rendering
`offers/*.yaml` into HTML:

- **(a)** a plain Python/bash build script producing a JSON index and one
  static HTML file;
- **(b)** a minimal Astro (static-only) build.

Constraints the choice must satisfy:

| Constraint | Source | Target |
|---|---|---|
| Build + deploy time | PRD §4 NFR table | < 3 min push-to-live |
| Supply chain | PRD §5.2 | "Pinned Action versions; dependency-free or minimal-dependency build" |
| Client framework | PRD §6.2 | Zero client framework; minimal static build |

## Spike

Both approaches were prototyped against ≥2 sample YAML offers within the
timebox. The throwaway Astro prototype was not kept in the repo; its results
are recorded here.

- **Astro prototype:** `npm create astro@latest` + a content collection over
  `offers/*.yaml` (via a tiny loader) rendered to one page. It worked, but:
  - installed ~250 transitive npm packages for a static-only site;
  - cold CI install alone took ~40–60 s and adds routine
    `npm audit`/lockfile maintenance to every content commit;
  - templating power was unused — the v1 page is a single list with
    client-side filtering planned over the JSON index.
- **Python script prototype:** a single stdlib-only `scripts/build.py`
  (~200 lines incl. a constrained flat-YAML reader, schema validation,
  `index.json` generation, and HTML rendering). Runs in well under a second,
  zero third-party packages, no Node toolchain in CI.

## Decision

**Option (a): plain Python build script** (`scripts/build.py`, stdlib only;
since decommissioned by #139 after the v3.0 React cutover).

The local build was a single stdlib-only invocation of the builder script
(recoverable from git history — see `CHANGELOG.md`).

Outputs: `index.json` (offer index consumed by the page's vanilla-JS
filter/search) and `site/index.html`.

## Rationale vs. constraints

1. **Supply chain (§5.2, decisive).** Stdlib-only Python means zero
   third-party packages to pin, audit, or upgrade. Astro pulls hundreds of
   npm transitive dependencies for capability the site does not use.
2. **Build + deploy < 3 min.** The script builds in < 1 s locally; CI needs
   only `actions/setup-python` + one command — no `npm ci` cold-install step.
3. **Zero client framework (§6.2).** Both options satisfy this; neutral.
4. **Content model fit.** Offers are flat seven-field YAML documents
   (see `docs/schema.md`). A constrained reader with strict validation is
   simpler and safer than wiring a general YAML parser through a static-site
   framework.

## Consequences

- The repo stays dependency-free: no `package.json`, no lockfile, no
  `requirements.txt`. Python 3.9+ is the only build tool requirement.
- If the site later needs per-offer pages, RSS, or rich templating, revisit
  this ADR before growing ad-hoc string templates beyond ~a few hundred lines.
- The Astro alternative remains documented here as the fallback path.

## Alternatives considered

- **Minimal Astro static-only** — rejected: supply-chain weight and CI time
  outweigh unused templating benefits at v1 scale.
- **Hybrid (script now, Astro later)** — rejected as a decision: it defers
  rather than resolves Open Question #1; the script-first path keeps the
  migration option open anyway since the JSON index is generator-agnostic.
