# ADR 0001 — Expiry is evaluated only at build/deploy time

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** Project owner (curator)
- **Resolves:** tasks.md Task 2.5 (issue #11); implements PRD §3.1 F4
- **Related:** [ADR 001 — Static site generator choice](../adr-001-static-generator.md), F11 Archive view

## Context

F4 requires that an offer whose `expiry_date` has passed disappears from the
default list. On a fully static site there are only two places that decision
can be made:

- **build/deploy time** — when `scripts/build.py` regenerates
  `index.json` / `site/index.html`, or
- **view time** — while a visitor is looking at the page (client-side
  JavaScript, or a server computing freshness per request).

The constraints that frame the choice:

| Constraint | Source | Target |
|---|---|---|
| No backend | PRD §6.3 | Static hosting only (GitHub Pages); no server, no database |
| Zero client framework/runtime | PRD §6.2, ADR 001 | No client-side JavaScript |
| Freshness | PRD §3.1 F4 | Expired offers hidden from the default list |

At the time of writing the Python builder implemented this directly:
`filter_expired()` in `scripts/build.py` (retired by #139; expiry is now
evaluated against the build clock in `app/scripts/load-offers.mjs`) drops
every offer whose `expiry_date` is earlier than the
build date (`null` means ongoing and is always kept).

## Options considered

1. **Build/deploy-time evaluation (chosen).** Compare `expiry_date` against
   the build date inside `build.py`; expired offers never enter the generated
   index or HTML.
2. **View-time evaluation.** Ship `expiry_date` in the payload and let
   client-side JavaScript hide or badge expired cards using the visitor's
   clock (a server-side per-request variant was also considered and fails the
   no-backend constraint outright).
3. **Build-time evaluation plus scheduled rebuilds.** Same as option 1, with
   a cron-triggered `workflow_dispatch` deploy shrinking how long an expired
   offer can linger.

## Decision

**Option 1: expiry is evaluated only at build/deploy time.**
The Python builder was the single point where an offer was declared
expired; the deployed artifacts contain only offers that were valid at the
moment of the last build.

## Rationale

1. **Zero runtime (decisive).** View-time checking needs JavaScript in the
   page or a server behind it — both violate the static-only constraints the
   project is built on (PRD §6.3, ADR 001).
2. **Correctness does not depend on the visitor.** Client-side checks trust
   the visitor's clock (timezone skew, wrong system time). A build-time check
   uses one authoritative clock: the CI runner's.
3. **Cacheability.** The output is plain static HTML/JSON with freshness
   baked in — safe to cache at the CDN edge indefinitely, with nothing to
   recompute per request.
4. **Simplicity and testability.** One pure function in a stdlib script,
   covered by `tests/test_build.py`; no browser matrix, no hydration path.

## Consequences

- **Stale window between deploys.** An offer that expires *after* the last
  deploy stays visible until the next deploy. Freshness is bounded by deploy
  frequency, not by wall-clock time: a just-expired offer remains listed until
  the next push to `main` triggers a rebuild. This is the accepted trade-off —
  the curator merges content changes regularly, and option 3 can be layered on
  later without revisiting this decision.
- **Deterministic artifacts.** The same offers built on the same day produce
  byte-identical output, which keeps caching and local verification honest.
- **Interaction with the future archive (F11).** Sprint 5 (Task 5.1) flips the
  build from *drop* to *retain-and-flag*: expired offers stay in the index
  with a computed `"status": "active" | "expired"` so the archive view can
  render them. That changes retention, not evaluation — expiry is still
  computed at build time, so the archive inherits the same stale window: an
  offer reads as active until the first build after its expiry passes. This
  ADR remains the governing record for *when* expiry is evaluated.

## Alternatives rejected

- **Client-side view-time filtering** — rejected: adds runtime JavaScript the
  project explicitly avoids, and makes correctness depend on visitor clocks.
- **Server-side per-request freshness** — rejected: requires a backend;
  GitHub Pages serves static files only.
- **Scheduled rebuilds as the primary mechanism** — deferred, not rejected:
  a cron-triggered deploy is a compatible increment on top of this decision if
  the stale window ever proves too wide in practice.
