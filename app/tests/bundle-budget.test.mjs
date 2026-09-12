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
// 2026-09-04 (#304): JS ceiling 123_000 -> 128_500 — catalog growth, not
// feature weight: 10 new offers joined src/data/offers.json (epic #287 batch),
// which App.tsx embeds wholesale. Measured 127,571 B gzipped (main baseline
// 122,258 B, ~530 B/offer); ~1 kB headroom kept for one-off copy tweaks.
// 2026-09-05 (#317): JS ceiling 128_500 -> 130_500 — temporary catalog-growth
// bump so Pages can ship. CI measured 129,308 B gzipped. Real work is #317
// (stop embedding the whole catalog in the JS bundle).
// 2026-09-07 (#317): JS ceiling 130_500 -> 134_500 — another catalog batch
// (Novita, GCP AI Startup, Claude Startups, Scaleway x2, Cerebras, AI21,
// Cohere, Deepgram Flux, HF). Local gzip 132,718 B. Still does not close #317.
const APP_ROOT = path.resolve(import.meta.dirname, "..");

export const JS_GZIP_CEILING_BYTES = 134_500;
// CSS gzip history: 8_000 through the dark redesign (9,301 gzipped after the
// hot-today shelf), then 10_000 for the offer-detail rebuild (9,833). The
// warm-linen redesign — two-scheme tokens, serif @font-face blocks, the
// card-plane rows and the motion system — measured 10,392 gzipped, so the
// ceiling moves to 12_000: measured rounded up to the next 500 plus ~1.5 kB
// of headroom, the same budget-not-checksum rule css-budget.test.mjs
// carries.
export const CSS_GZIP_CEILING_BYTES = 12_000;

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
export function checkBudgets(measured, ceilings) {
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
          env: { ...process.env, NODE_ENV: "production" },
        },
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
    expect(violations[0]).toContain(
      `exceeds ceiling ${JS_GZIP_CEILING_BYTES} B`,
    );
  });
});
