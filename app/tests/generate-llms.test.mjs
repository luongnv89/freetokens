import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const MAX_FULL_BYTES = 200 * 1024;

function offer(i, pad = 0, overrides = {}) {
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
    review_status: "under-review",
    signup: "required",
    status: "active",
    ...overrides,
  };
}

function runGenerator({ count, pad = 0, offers } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ft-llms-"));
  try {
    const dataFile = path.join(root, "offers.json");
    const publicDir = path.join(root, "public");
    const list =
      offers ?? Array.from({ length: count }, (_, i) => offer(i, pad));
    writeFileSync(
      dataFile,
      JSON.stringify({
        generated_at: "2026-09-25T00:00:00Z",
        count: list.length,
        active_count: list.length,
        expired_count: 0,
        offers: list,
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
    return {
      short: readFileSync(path.join(publicDir, "llms.txt"), "utf8"),
      full: readFileSync(path.join(publicDir, "llms-full.txt"), "utf8"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("generate-llms llms-full.txt budget truncation", () => {
  it("emits every offer and the full footer when under budget", () => {
    const { full: text } = runGenerator({ count: 5 });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThan(MAX_FULL_BYTES);
    expect(text).toContain("— 5 active offers.");
    expect(text).not.toContain(" of 5 active offers");
    expect((text.match(/^### /gm) ?? []).length).toBe(5);
    expect(text).toContain("## Pages");
    expect(text.trimEnd().endsWith("XML sitemap.")).toBe(true);
  });

  it("over budget: drops whole entries, keeps footer, honest header", () => {
    // ~300 offers at ~1.1KB each overflows the 200KB budget.
    const { full: text } = runGenerator({ count: 300, pad: 700 });
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

// T6 / #509: the short AI summaries used to drop every trust qualification,
// so a consumer reading only llms.txt saw an unconditional offer.
describe("generate-llms trust qualifications (#509)", () => {
  const sample = [
    offer(1, 0, {
      slug: "z-ai-startups-program",
      title: "Z.ai Startups Program",
      provider: "Z AI (Zhipu AI)",
      category: "startup_program",
      amount: "Free API credits up to 1B tokens plus GLM volume pricing",
      review_status: "to-be-verified",
      verification: "social_proof",
      signup: "required",
      verified_date: "2026-09-30",
    }),
    offer(2, 0, {
      slug: "community-only",
      review_status: "unverified",
      verification: "unverified",
      signup: "none",
      verified_date: "2026-09-29",
    }),
  ];

  it("ends every short offer entry with review status, evidence, signup and last checked", () => {
    const { short } = runGenerator({ offers: sample });
    const lines = short
      .split("\n")
      .filter((line) => line.startsWith("- [") && line.includes("/offers/"));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatch(/review_status=(verified|unverified|under-review|to-be-verified)/);
      expect(line).toMatch(/verification=(social_proof|unverified)/);
      expect(line).toMatch(/signup=(none|required)/);
      expect(line).toMatch(/last_checked=\d{4}-\d{2}-\d{2}/);
    }
    const zai = lines.find((line) => line.includes("z-ai-startups-program"));
    expect(zai).toContain("review_status=to-be-verified");
    expect(zai).toContain("verification=social_proof");
    expect(zai).toContain("signup=required");
    expect(zai).toContain("last_checked=2026-09-30");
    // The caution survives; the entry is never stated as unconditional.
    expect(zai).not.toContain("review_status=verified");
    expect(zai).toContain("Free API credits up to 1B tokens");

    const community = lines.find((line) => line.includes("community-only"));
    expect(community).toContain("review_status=unverified");
    expect(community).toContain("verification=unverified");
    expect(community).toContain("signup=none");
  });

  it("defines the four fields once, in a Trust labels section", () => {
    const { short } = runGenerator({ offers: sample });
    expect(short).toContain("## Trust labels");
    for (const field of [
      "review_status",
      "verification",
      "signup",
      "last_checked",
    ]) {
      expect(short).toContain(`\`${field}`);
    }
    for (const value of [
      "review_status=verified",
      "review_status=under-review",
      "review_status=unverified",
      "review_status=to-be-verified",
      "verification=social_proof",
      "verification=unverified",
      "signup=none",
      "signup=required",
    ]) {
      expect(short).toContain(`\`${value}\``);
    }
    // Two independent axes, and no claim attempt implied by either.
    expect(short).toMatch(/independent/i);
    expect(short).toMatch(/enrollment deadline/i);
  });

  it("links the long-form export descriptively", () => {
    const { short } = runGenerator({ offers: sample });
    expect(short).toContain(
      "- [Full export](https://freetokens.custats.info/llms-full.txt):",
    );
    expect(short).toMatch(/llms-full\.txt\):.*summary/i);
  });

  it("labels exported checked dates Last checked, never Verified", () => {
    const { full } = runGenerator({ offers: sample });
    expect(full).toContain("- Last checked: 2026-09-30 — review_status=to-be-verified");
    expect(full).not.toContain("- Verified:");
    expect(full).toContain("- Last checked: 2026-09-29 — review_status=unverified");
    // Enrollment deadline is stated separately from credit validity.
    expect(full).toMatch(/enrollment deadline/i);
    expect(full).toMatch(/not how long the credits stay valid/i);
  });

  it("passes an unknown review_status through raw instead of promoting it", () => {
    const { short, full } = runGenerator({
      offers: [offer(3, 0, { review_status: "published" })],
    });
    const entry = short
      .split("\n")
      .find((line) => line.includes("/offers/test-offer-3.html"));
    expect(entry).toContain("review_status=published");
    expect(entry).not.toContain("review_status=verified");
    expect(full).toContain("review_status=published");
    expect(full).not.toMatch(
      /- Last checked: \d{4}-\d{2}-\d{2} — review_status=verified/,
    );
  });
});
