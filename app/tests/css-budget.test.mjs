import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// CSS payload budget (issue #121): the rendered Tailwind build must not
// outweigh the inline stylesheet the Python builder ships on the page this
// app replaces. Baseline is measured live from scripts/build.py — the home
// listing inlines `_CSS + _APP_CSS + _HOME_CSS` on every view.
const APP_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");

function pythonInlineCssBytes() {
  const src = readFileSync(path.join(REPO_ROOT, "scripts/build.py"), "utf8");
  let total = 0;
  for (const name of ["_CSS", "_APP_CSS", "_HOME_CSS"]) {
    const m = src.match(new RegExp(`${name} = """\\n([\\s\\S]*?)\\n"""`));
    if (!m) throw new Error(`could not extract ${name} from scripts/build.py`);
    total += Buffer.byteLength(m[1], "utf8");
  }
  return total;
}

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
        const baseline = pythonInlineCssBytes();
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
