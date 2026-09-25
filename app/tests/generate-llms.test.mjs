import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const MAX_FULL_BYTES = 200 * 1024;

function offer(i, pad = 0) {
  return {
    slug: `test-offer-${i}`,
    title: `Test Offer ${i}`,
    provider: "TestCo",
    category: "api_provider",
    amount: `$${10 + i} free credits` + (pad ? " ".repeat(pad) + "x" : ""),
    expiry_date: null,
    source_url: "https://example.com/free",
    verified_date: "2026-09-25",
    verification: "social_proof",
    review_status: "published",
    signup: "required",
    status: "active",
  };
}

function runGenerator({ count, pad = 0 }) {
  const root = mkdtempSync(path.join(tmpdir(), "ft-llms-"));
  try {
    const dataFile = path.join(root, "offers.json");
    const publicDir = path.join(root, "public");
    const offers = Array.from({ length: count }, (_, i) => offer(i, pad));
    writeFileSync(
      dataFile,
      JSON.stringify({
        generated_at: "2026-09-25T00:00:00Z",
        count,
        active_count: count,
        expired_count: 0,
        offers,
      }),
    );
    execFileSync(
      process.execPath,
      [
        "scripts/generate-llms.mjs",
        "--data",
        dataFile,
        "--details",
        path.join(root, "missing-details.json"),
        "--public-dir",
        publicDir,
        "--dist",
        path.join(root, "missing-dist"),
      ],
      { cwd: APP_ROOT, stdio: "pipe" },
    );
    return readFileSync(path.join(publicDir, "llms-full.txt"), "utf8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("generate-llms llms-full.txt budget truncation", () => {
  it("emits every offer and the full footer when under budget", () => {
    const text = runGenerator({ count: 5 });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(MAX_FULL_BYTES);
    expect(text).toContain("— 5 active offers.");
    expect(text).not.toContain(" of 5 active offers");
    expect((text.match(/^### /gm) ?? []).length).toBe(5);
    expect(text).toContain("## Pages");
    expect(text.trimEnd().endsWith("XML sitemap.")).toBe(true);
  });

  it("over budget: drops whole entries, keeps footer, honest header", () => {
    // ~300 offers at ~1.1KB each overflows the 200KB budget.
    const text = runGenerator({ count: 300, pad: 700 });
    const bytes = Buffer.byteLength(text, "utf8");
    expect(bytes).toBeLessThan(MAX_FULL_BYTES);

    // Footer survives the cut.
    expect(text).toContain("## Pages");
    expect(text.trimEnd().endsWith("XML sitemap.")).toBe(true);

    // Header honestly reports emitted-of-total.
    const m = text.match(/— (\d+) of (\d+) active offers \(truncated/);
    expect(m).not.toBeNull();
    const emitted = Number(m[1]);
    expect(Number(m[2])).toBe(300);
    expect(emitted).toBeGreaterThan(0);
    expect(emitted).toBeLessThan(300);

    // Every emitted `### ` section is complete — the cut lands on an
    // entry boundary, never mid-entry (the old 10%-slice bug).
    expect((text.match(/^### /gm) ?? []).length).toBe(emitted);
    const lastEntry = text.split("### ").pop();
    expect(lastEntry).toContain("- Page:");
    expect(lastEntry).toMatch(/- Summary: .+\n## Pages/);
  });
});
