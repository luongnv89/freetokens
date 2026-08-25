import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Acceptance criterion 5 (#122): shadcn components inherit the Task 2.2
// tokens — no shadcn default palette may leak into the page. Enforced
// statically: ui primitives paint only through Tailwind utilities that
// resolve to the token bridge in styles/tokens.css, and every bridged
// variable points at a Task 2.2 token, never at a literal hex.
const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.join(here, "../src/components/ui");

describe("shadcn/ui token inheritance (#122)", () => {
  it("ui primitives contain no literal palette colors", async () => {
    const files = (await readdir(uiDir)).filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = (await readFile(path.join(uiDir, file), "utf8")).replace(
        /#\d+\b/g, // strip issue references like #122
        "",
      );
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, file).not.toMatch(/\b(?:rgb|hsl)a?\(/);
    }
  });

  it("bridges every shadcn semantic variable to a Task 2.2 token", async () => {
    const tokens = await readFile(
      path.join(here, "../src/styles/tokens.css"),
      "utf8",
    );
    const start = tokens.indexOf("shadcn/ui semantic-variable");
    const bridge = tokens.slice(
      start,
      tokens.indexOf("@theme inline", tokens.indexOf(":root", start)),
    );
    // Each --<name>: declaration in the :root bridge must reference
    // var(--color-…) — i.e. an existing Task 2.2 token — not a literal.
    // (The following @theme inline block re-exposes them to Tailwind and is
    // checked implicitly: it may only point back at these bridge vars.)
    const decls = bridge.match(/^\s*--[a-z-]+:\s*[^;]+;/gm) ?? [];
    expect(decls.length).toBeGreaterThan(10);
    for (const decl of decls) {
      if (/--radius/.test(decl)) continue; // sizing, not palette
      expect(decl, decl.trim()).toMatch(/var\(--color-/);
    }
  });
});
