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

// Frozen Python-builder baseline was 36200 (#121/#139). Highlighted visit
// chips (#250) added ~479 B. 320px WebKit overflow containment (#254) adds
// chip/badge min-width, a visually-hidden file input, and table-layout:fixed.
// Badge/chip wrap (overflow:visible + overflow-wrap) adds 89 B.
// Custats sibling banner (#257) adds 1270 B muted mono strip (full-width,
// hairline border, responsive at 320px).
// Masthead stats rail (#279/#280/#281) adds 386 B: one flex row under the
// header, the visibility reservation that keeps the async traffic reveal
// free of layout shift, the mono character reservation on its counters, and
// the data-traffic="off" collapse for windows GoatCounter never answers.
const PYTHON_INLINE_CSS_BYTES = 38675;

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
          { cwd: APP_ROOT, stdio: "pipe" },
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
