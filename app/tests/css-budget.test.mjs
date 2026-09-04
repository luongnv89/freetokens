import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// CSS payload budget (issue #121): the rendered Tailwind build must not
// outweigh the inline stylesheet the Python builder shipped on the pages
// this app replaces. Baseline was measured live from scripts/build.py —
// home inlined `_CSS + _APP_CSS + _HOME_CSS`; `_DETAIL_CSS` is css_extra on
// Python offer-detail pages only (never the home listing) — and frozen when
// the builder was decommissioned (#139). The React app now also replaces
// those detail pages (#128), so the budget includes it.
const APP_ROOT = path.resolve(import.meta.dirname, "..");

// Frozen Python-builder baseline was 36200 (#121/#139), then raised once per
// shipped feature up to 38387 (highlighted visit chips, 320px WebKit overflow
// containment, badge/chip wrap, the custats sibling banner, the masthead stats
// rail, the "Hot today" badge).
//
// The elegant-redesign pass supersedes that run of per-feature freezes rather
// than adding to it, because it rewrote the listing rather than extending it.
// What the extra bytes bought, net of what came back:
//
//   reclaimed  the dead .card-top / .card-actions / .detail-btn / .ext /
//              .amount / .prov rules the row layout had already orphaned, and
//              the card chrome the archive no longer needs now that home and
//              archive share one ledger row  (-911 B)
//   spent      the row's four-area grid and its fixed rail, the quiet-filter
//              treatment, the masthead headline and supporting sentence, the
//              scrollable mobile chip row, the phone-width masthead and
//              toolbar tightening that puts the first offer back above the
//              fold, the detail-page hero CTA and link treatment, and the
//              press/hover interaction polish  (+2123 B)
//
// 38387 - 911 + 2123 = 39599, which is what production `vite build` measured
// at the close of that pass. The ledger rank counter's WCAG contrast fix has
// since reclaimed 218 B of it — a color-mix() collapsed to var(--gray), which
// in turn made two hover/focus colour rules exact duplicates of the resting
// value — so the build now measures 39381. The ceiling stays where it is: it
// is a budget, not a checksum, and giving bytes back does not spend them.
// Raise this deliberately, in the same style, when a change is worth the
// bytes.
const PYTHON_INLINE_CSS_BYTES = 39599;

function cssBytesIn(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) total += cssBytesIn(full);
    else if (entry.endsWith(".css")) total += statSync(full).size;
  }
  return total;
}

describe("rendered CSS payload budget (#121)", () => {
  it(
    "vite build output stays within the Python builder's inline CSS",
    () => {
      const outDir = path.join(tmpdir(), `ft-budget-${process.pid}`);
      rmSync(outDir, { recursive: true, force: true });
      try {
        execFileSync(
          process.execPath,
          [
            "node_modules/vite/bin/vite.js",
            "build",
            "--outDir",
            outDir,
            "--emptyOutDir",
          ],
          {
            cwd: APP_ROOT,
            stdio: "pipe",
            // Vitest inherits NODE_ENV=test, which can skip minify and
            // wobble the byte count; pin production like bundle-budget.
            env: { ...process.env, NODE_ENV: "production" },
          },
        );
        const rendered = cssBytesIn(outDir);
        const baseline = PYTHON_INLINE_CSS_BYTES;
        expect(rendered).toBeGreaterThan(0);
        // Purge must be on: an unpurged utility sheet would blow the budget.
        expect(rendered).toBeLessThanOrEqual(baseline);
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
