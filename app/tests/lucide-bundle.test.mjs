import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Acceptance criterion 3 (#122): only the 11 mapped lucide glyphs may be
// consumed, and they enter the page as a <symbol> sprite serialized at
// generate-time — never as a lucide-react runtime import. A barrel (or even
// a single <Icon />) import would reintroduce the JS cost the sprite path
// exists to avoid. Sprite path data in prerendered HTML is the intended
// payload and is not scanned here.
const APP_ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(APP_ROOT, "src");
const GEN_SCRIPT = path.join(APP_ROOT, "scripts/gen-tag-icons.mjs");
const PER_ICON_IMPORT = "import(`lucide-react/dist/esm/icons/${icon}.mjs`)";

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function jsChunksIn(dir) {
  return walkFiles(dir).filter((f) => /\.(?:m|c)?js$/.test(f));
}

describe("lucide-react stays out of the runtime bundle (#122)", () => {
  it("src does not statically import lucide-react", () => {
    const files = walkFiles(SRC_DIR).filter((f) =>
      /\.(?:[cm]?[jt]sx?)$/.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const rel = path.relative(SRC_DIR, file);
      expect(src, rel).not.toMatch(/from\s+["']lucide-react["']/);
      expect(src, rel).not.toMatch(/from\s+["']lucide-react\//);
    }
  });

  it("gen-tag-icons.mjs only dynamically imports the 11 mapped icon modules", () => {
    const src = readFileSync(GEN_SCRIPT, "utf8");
    expect(src).not.toMatch(/from\s+["']lucide-react["']/);
    expect(src).not.toMatch(/from\s+["']lucide-react\//);

    const mapped = [...src.matchAll(/\bicon:\s*"([a-z0-9-]+)"/g)].map(
      (m) => m[1],
    );
    expect(mapped).toHaveLength(11);
    expect(new Set(mapped).size).toBe(11);

    const lucideImports = [...src.matchAll(/import\(([^)]*lucide-react[^)]*)\)/g)];
    expect(lucideImports).toHaveLength(1);
    expect(lucideImports[0][0]).toBe(PER_ICON_IMPORT);
  });

  it(
    "vite JS chunks contain no lucide-react package code",
    () => {
      const outDir = path.join(tmpdir(), `ft-lucide-${process.pid}`);
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
        const chunks = jsChunksIn(outDir);
        expect(chunks.length).toBeGreaterThan(0);
        for (const file of chunks) {
          const src = readFileSync(file, "utf8");
          const rel = path.relative(outDir, file);
          // Module id / license banner of the package itself.
          expect(src, rel).not.toMatch(/lucide-react/);
          // Per-icon factory used by every lucide-react component module.
          expect(src, rel).not.toMatch(/createLucideIcon/);
          // Barrel re-export: `export { index as icons }` plus alias names
          // like FingerprintPattern only exist on the full package entry.
          expect(src, rel).not.toMatch(/FingerprintPattern/);
        }
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
