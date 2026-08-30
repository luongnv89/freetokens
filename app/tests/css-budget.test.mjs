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

const PYTHON_INLINE_CSS_BYTES = 36200;

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
