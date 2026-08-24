# ADR 0002 — Migrate the generator to React 19 + TypeScript + Vite

- **Status:** Accepted
- **Date:** 2026-08-24
- **Deciders:** Project owner (curator)
- **Resolves:** React + Vite migration plan `tasks.md` Task 1.1 (issue #115); part of epic #114
- **Related:** [ADR 001 — Static site generator choice](../adr-001-static-generator.md) (superseded by this document), [ADR 0001 — Expiry is evaluated only at build/deploy time](0001-build-time-expiry.md) (unaffected)

## Context

[ADR 001](../adr-001-static-generator.md) (2026-08-21) chose a stdlib-only
Python build script over a Node toolchain for v1, explicitly rejecting Astro
and npm on supply-chain and CI-time grounds. That decision was correct at v1
scale: one list page, five seed offers, zero third-party packages.

The site outgrew that scale within days. Since 2026-08-21:

- The catalog grew to **~46 generated routes** (`index.html`,
  `archive.html`, `privacy.html`, `feed.xml`, plus one page per offer under
  `site/offers/`).
- `scripts/build.py` grew to **4,502 lines** of string-built HTML — far past
  the "revisit this ADR before growing ad-hoc string templates beyond ~a few
  hundred lines" tripwire ADR 001 itself set.
- `tests/test_build.py` is **4,478 lines** of assertions coupled to those
  ad-hoc HTML strings; every template tweak breaks dozens of tests.

Maintaining per-offer pages, filtering/sorting UX, and accessibility in
hand-rolled f-string templates is now the largest maintenance cost in the
repo. A component model with typed props and a real templating layer
removes it.

## Constraints carried over from ADR 001

ADR 001 measured its decision against three constraints. Each is re-examined
below — met, or knowingly traded.

| Constraint | Source | Verdict under React + Vite |
|---|---|---|
| Build + deploy time < 3 min | PRD §4 NFR table | **Met.** Vite production builds run in seconds; CI gains an `npm ci` step (~15–30 s warm-cache) but stays well inside the budget with cached dependencies and pinned Actions. |
| Supply chain: minimal dependencies | PRD §5.2 | **Knowingly traded — mitigated.** The npm dependency tree ADR 001 refused is accepted deliberately; see *Supply-chain mitigation*. |
| Zero client framework | PRD §6.2 | **Knowingly traded.** React becomes the client framework and render layer. The static-output guarantee behind the constraint is preserved: everything still prerenders to plain HTML/CSS/JS served from GitHub Pages. |

**PRD §6.3 is unchanged:** this migration introduces no server, no database,
and no runtime backend. Hosting remains GitHub Pages serving fully static
artifacts; all dynamic behavior stays either build-time or client-side.

## Options considered

1. **Stay on the Python builder.** No new dependencies, but keeps 4.5k lines
   of string templates as permanent tax, makes the planned filter/sort UX
   progressively harder, and leaves test coupling unaddressed.
2. **Astro (static-only).** Real templating with less framework weight than
   React, but adds a second content-model abstraction over `offers/*.yaml`
   and a smaller ecosystem for the interactive components planned next.
3. **React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui +
   lucide-react (chosen).** Component model with typed data flow from
   `offers/*.yaml` → JSON/JSONL at build time → prerendered routes on GitHub
   Pages; shadcn/ui supplies accessible primitives without a runtime
   component-library dependency; Vite gives fast builds and a first-class
   static-output story.

## Decision

Migrate the generator to **React 19 + TypeScript + Vite**, styled with
**Tailwind CSS v4** and **shadcn/ui** with **lucide-react** icons. Pages are
statically prerendered and deployed to **GitHub Pages** exactly as today;
offer data is loaded **from `offers/*.yaml` at build time** into JSON/JSONL
consumed by the prerender. This supersedes ADR 001; the Python builder is
retired once migration tasks reach parity.

## Supply-chain mitigation

The cost ADR 001 refused is now paid consciously, with controls:

- `package-lock.json` is committed and installs go through `npm ci` only —
  never bare `npm install` in CI.
- Dependencies are minimized (React, Vite, Tailwind, lucide-react, shadcn/ui
  source-copied components); no runtime UI kit.
- Dependabot watches `npm` dependencies and GitHub Actions.
- Workflow Actions stay version-pinned to full commit SHAs (existing PRD §5.2
  rule, unchanged).

## Consequences

- The repo gains `package.json`, a lockfile, and a Node toolchain requirement
  in CI; Python 3 remains for validation scripts until retired by later
  migration tasks.
- ADR 0001 (build-time expiry) is unaffected: expired offers are still
  filtered when the JSON/JSONL data is generated at build time.
- Template drift and string-coupled tests are replaced by typed components
  and rendering tests; existing behavioral guarantees (schema validation,
  expiry filtering, feed generation) must be preserved through parity before
  `scripts/build.py` removal.
- Reversing a two-day-old ADR is cheap now; reversing it after the UX roadmap
  lands on top of string templates would not be.

## Addendum (2026-08-25): prerender approach chosen (Task 1.5, issue #119)

Task 1.5 required proving the home listing renders at parity with the
Python builder and choosing between `vite-react-ssg`, Vite's built-in
prerender, and a custom render script. Measured evidence (full report:
[`docs/qa/prerender-poc-report.md`](../qa/prerender-poc-report.md)):

| Metric (Lighthouse 12, mobile) | Python build | React prerender |
|---|---|---|
| Performance | 76–81 | **100** |
| Accessibility | 96 | **96** |
| FCP | ~3.7–3.9 s | **1.2 s** |
| Transferred bytes | 127 KB | **81 KB** |

Rendered-HTML diff against `site/index.html`: identical row count, slug
sets, and per-row data attributes; the two parity bugs the diff exposed
(amount-sort multiplier anchoring, `%g` formatting) are fixed with unit
tests.

**Decision: custom render script** (`app/scripts/prerender.mjs`,
wired as the npm `postbuild` step). After `vite build`, esbuild bundles a
node-side entry that renders `<App/>` with `react-dom/server`
(`renderToStaticMarkup`) and injects the markup into `dist/index.html`;
the client bundle hydrates onto it via `hydrateRoot`.

Rationale:

- **Zero new dependencies.** `vite-react-ssg` would add a plugin tree for a
  single-route site; ADR 001's supply-chain concern was traded knowingly in
  this ADR but not gratuitously — one route needs no SSG framework.
- **Vite has no built-in prerender**; the gap is exactly what the script
  fills, in ~40 lines we own.
- **Same static-output guarantee:** what ships is plain HTML/CSS/JS on
  GitHub Pages; the full listing is present with JavaScript disabled.
- Escape hatch preserved: if multi-route prerendering (offer detail pages,
  Sprint 2/3) outgrows the script, swapping to `vite-react-ssg` touches only
  the build step — components and data flow stay unchanged.
