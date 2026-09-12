import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// CSS payload budget (issue #121): the rendered Tailwind build stays under a
// deliberate ceiling. The name is historical: the original ceiling was the
// byte size of the inline stylesheet the Python builder shipped, and that
// ceiling is RETIRED — the builder is decommissioned (#139) and the sheet it
// was compared against no longer resembles this one.
const APP_ROOT = path.resolve(import.meta.dirname, "..");

// What the current number covers instead is the warm-linen redesign: a
// two-scheme palette (light linen by default, warm charcoal under
// prefers-color-scheme: dark), the serif display face's @font-face blocks,
// the derived two-state tag colours that keep the thirteen locked hues
// legible on both grounds (theme-contrast.test.mjs), the card-plane listing
// rows with their category spines and hover lift, the rounded toolbar
// controls, the hot-today shelf, the offer-detail rail, and the motion
// system — staggered rise reveals, hover lifts, press scales — all of it
// duplicated for the reduced-motion gate.
//
// The number is a BUDGET, not a checksum: measured raw CSS rounded up to the
// next 500 plus ~1.5 kB of headroom, so a one-rule fix does not fail the
// build and another feature cannot land unnoticed. The warm-linen redesign
// measured 54,284 raw going in, which sets the ceiling at 56,000. Raise it
// deliberately, in this style, when a change is worth the bytes — giving
// bytes back does not spend them.
const PYTHON_INLINE_CSS_BYTES = 56_000;

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
  it("vite build output stays within the Python builder's inline CSS", () => {
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
  }, 240_000);
});
