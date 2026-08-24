import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const APP_ROOT = path.resolve(import.meta.dirname, "..");

describe("generated types (#120)", () => {
  it("src/types/offers-index.d.ts is in sync with schemas/offers-index.schema.json", () => {
    expect(() =>
      execFileSync("node", ["scripts/generate-types.mjs", "--check"], {
        cwd: APP_ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
