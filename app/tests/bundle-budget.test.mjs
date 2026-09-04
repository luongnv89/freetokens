import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

// Transferred-byte budgets (#142): the Python builder guaranteed a small
// page by construction; these ceilings keep the React bundle honest.
// Frozen from the Task 4.5 measured baseline (production build behind
// #137/#138, deployed site audited 2026-08-21 in
// docs/qa/lighthouse-mobile-deployed.json):
//   JS  raw 340,132 B -> gzip 106,170 B   (ceiling ~13% headroom)
//   CSS raw  32,204 B -> gzip   6,639 B   (ceiling ~20% headroom)
// Raw-byte CSS is additionally capped against the retired Python builder's
// inline sheet in css-budget.test.mjs; this suite guards what the wire sees.
// 2026-09-03: JS ceiling 120_000 -> 122_000 for the site-wide JSON-LD
// structured-data graph (#263, closes #276) — deliberate feature weight.
// 2026-09-04: JS ceiling 122_000 -> 123_000 for the elegant-redesign pass —
// the build-derived proof line, the ledger row's rail markup and the repeated
// detail-page claim CTA. Measured 122,025 B gzipped; the extra ~1 kB of
// headroom is deliberate, not a measurement. CSS gzip was left at 8_000: the
// redesign measures 7,9xx B and still fits.
const APP_ROOT = path.resolve(import.meta.dirname, "..");

export const JS_GZIP_CEILING_BYTES = 123_000;
// Raised from 8_000 by the dark redesign, which took the sheet from 39381 to
// 44412 raw (accounted line by line in css-budget.test.mjs) and 8813 -> 8919
// gzipped once the self-hosted @font-face blocks landed. 9_000 keeps the same
// slim, deliberate headroom the JS ceiling above carries — enough that a
// one-rule fix does not fail the build, not enough to absorb another feature
// unnoticed. Raised again to 9_400 for the "most viewed today" shelf, which
// measured 9301 gzipped, then to 10_000 for the offer-detail rebuild, which
// measured 9833.
export const CSS_GZIP_CEILING_BYTES = 10_000;

function collectGzipped(dir, ext) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      total += collectGzipped(full, ext);
    } else if (entry.endsWith(ext)) {
      total += gzipSync(readFileSync(full)).length;
    }
  }
  return total;
}

// Pure decision core so the deliberate-regression case below can prove the
// gate bites without bloating the real bundle.
export function checkBudgets(
  measured,
  ceilings,
) {
  const violations = [];
  for (const key of Object.keys(ceilings)) {
    if ((measured[key] ?? 0) > ceilings[key]) {
      violations.push(
        `${key} gzipped ${measured[key]} B exceeds ceiling ${ceilings[key]} B`,
      );
    }
  }
  return violations;
}

describe("transferred-byte bundle budgets (#142)", () => {
  const ceilings = {
    js: JS_GZIP_CEILING_BYTES,
    css: CSS_GZIP_CEILING_BYTES,
  };

  it("vite build output stays under the committed gzip ceilings", () => {
    const outDir = path.join(tmpdir(), `ft-bundle-budget-${process.pid}`);
    rmSync(outDir, { recursive: true, force: true });
    try {
      // Vitest inherits NODE_ENV=test into this child, which switches Vite's
      // minifier off (595 kB raw vs 340 kB) — pin a production environment so
      // the budget measures the real shipped artifact.
      execFileSync(
        process.execPath,
        ["node_modules/vite/bin/vite.js", "build", "--outDir", outDir, "--emptyOutDir"],
        { cwd: APP_ROOT, stdio: "pipe", env: { ...process.env, NODE_ENV: "production" } },
      );
      const measured = {
        js: collectGzipped(outDir, ".js"),
        css: collectGzipped(outDir, ".css"),
      };
      expect(measured.js).toBeGreaterThan(0);
      expect(measured.css).toBeGreaterThan(0);
      expect(checkBudgets(measured, ceilings)).toEqual([]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 240_000);

  it("flags a deliberate regression (unused heavy import pushing JS past the ceiling)", () => {
    const regressed = {
      js: JS_GZIP_CEILING_BYTES + 1,
      css: CSS_GZIP_CEILING_BYTES - 100,
    };
    const violations = checkBudgets(regressed, ceilings);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(`exceeds ceiling ${JS_GZIP_CEILING_BYTES} B`);
  });
});
