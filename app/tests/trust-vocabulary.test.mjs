import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseOfferText } from "../scripts/load-offers.mjs";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const OFFERS_DIR = path.join(REPO_ROOT, "offers");
const REVIEW_VALUES = [
  "verified",
  "under-review",
  "unverified",
  "to-be-verified",
];
const EVIDENCE_VALUES = ["social_proof", "unverified"];

function shortEntryLines(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("- [") && line.includes("/offers/"));
}

/** Every committed offers/*.yaml, parsed with the build's own reader. */
function catalog() {
  return readdirSync(OFFERS_DIR)
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => ({
      slug: path.basename(file, ".yaml"),
      ...parseOfferText(readFileSync(path.join(OFFERS_DIR, file), "utf8"), file),
    }));
}

/** Run the real generator over a chosen subset and return both files. */
function generateFor(offers) {
  const root = mkdtempSync(path.join(tmpdir(), "ft-trust-"));
  try {
    const dataFile = path.join(root, "offers.json");
    const publicDir = path.join(root, "public");
    writeFileSync(
      dataFile,
      JSON.stringify({
        generated_at: "2026-10-05T00:00:00Z",
        count: offers.length,
        active_count: offers.length,
        expired_count: 0,
        offers: offers.map((offer) => ({ ...offer, status: "active" })),
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

// #509 acceptance: reconcile sampled export values with the underlying entries
// — using the real catalog, never a hand-written fixture — and keep the
// committed artifacts honest about what they carry.
describe("exported trust values reconcile with offers/*.yaml", () => {
  const offers = catalog();

  it("the catalog exercises every review-status value and a documented evidence value", () => {
    const reviews = new Set(offers.map((o) => o.review_status));
    for (const value of REVIEW_VALUES) expect(reviews, value).toContain(value);
    const evidence = new Set(offers.map((o) => o.verification));
    expect(evidence.size).toBeGreaterThan(0);
    for (const value of evidence) expect(EVIDENCE_VALUES).toContain(value);
  });

  it("emits one sample per review-status value with that entry's exact values", () => {
    const samples = REVIEW_VALUES.map((value) =>
      offers.find((offer) => offer.review_status === value),
    );
    const { short, full } = generateFor(samples);
    for (const sample of samples) {
      const line = shortEntryLines(short).find((l) =>
        l.includes(`/offers/${sample.slug}.html`),
      );
      expect(line, sample.slug).toBeTruthy();
      expect(line).toContain(`review_status=${sample.review_status}`);
      expect(line).toContain(`verification=${sample.verification}`);
      expect(line).toContain(`signup=${sample.signup}`);
      expect(line).toContain(`last_checked=${sample.verified_date}`);
      // The short line never upgrades the entry's own review status.
      if (sample.review_status !== "verified") {
        expect(line, sample.slug).not.toContain("review_status=verified");
      }
      expect(full).toContain(
        `- Last checked: ${sample.verified_date} — review_status=${sample.review_status}`,
      );
    }
  });

  it("keeps the amount/eligibility text and the source link on the short entry", () => {
    const sample = offers.find((o) => o.review_status === "to-be-verified");
    const { short } = generateFor([sample]);
    const line = shortEntryLines(short).find((l) =>
      l.includes(`/offers/${sample.slug}.html`),
    );
    expect(line).toContain(sample.amount.replace(/\s+/g, " ").trim());
    expect(line).toContain(`/offers/${sample.slug}.html`);
  });
});

describe("committed llms artifacts carry the trust vocabulary (#509)", () => {
  const short = readFileSync(path.join(PUBLIC_DIR, "llms.txt"), "utf8");
  const full = readFileSync(path.join(PUBLIC_DIR, "llms-full.txt"), "utf8");

  it("qualifies every short offer entry with the four fields", () => {
    const lines = shortEntryLines(short);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/review_status=[a-z-]+/);
      expect(line).toMatch(/verification=[a-z_]+/);
      expect(line).toMatch(/signup=(none|required)/);
      expect(line).toMatch(/last_checked=\d{4}-\d{2}-\d{2}/);
    }
  });

  it("defines both axes and every value, and links the long-form export", () => {
    expect(short).toContain("## Trust labels");
    for (const value of [...REVIEW_VALUES, ...EVIDENCE_VALUES]) {
      expect(short, value).toContain(`=${value}\``);
    }
    expect(short).toContain("last_checked");
    expect(short).toContain("llms-full.txt");
  });

  it("labels the full export's checked dates Last checked and never Verified", () => {
    expect(full).toContain("- Last checked: ");
    expect(full).not.toContain("- Verified:");
    expect(full).toMatch(/enrollment deadline/i);
  });

  it("keeps the full export's build date and truncation report", () => {
    expect(full).toMatch(
      /generated \d{4}-\d{2}-\d{2}T[\d:.]+Z — \d+( of \d+)? active offers/,
    );
  });

  it("leaves the crawler restrictions untouched", () => {
    const robots = readFileSync(path.join(PUBLIC_DIR, "robots.txt"), "utf8");
    for (const bot of [
      "GPTBot",
      "ClaudeBot",
      "Google-Extended",
      "CCBot",
      "Bytespider",
    ]) {
      expect(robots, bot).toContain(`User-agent: ${bot}\nDisallow: /\n`);
    }
    expect(robots).toContain("User-agent: *\nAllow: /\n");
  });
});

describe("robots.txt declares AI content signals (#523)", () => {
  const robots = readFileSync(path.join(PUBLIC_DIR, "robots.txt"), "utf8");

  it("declares ai-train, search and ai-input inside the User-agent: * group", () => {
    expect(robots).toContain(
      "User-agent: *\nAllow: /\nContent-Signal: ai-train=no, search=yes, ai-input=no",
    );
  });

  it("keeps the signals consistent with Policy A's per-agent rules", () => {
    // Training crawlers are Disallow'd above; the wildcard group declares
    // ai-train=no. Retrieval bots allowed by their own groups keep explicit
    // Allow rules, so the wildcard default never grants ai-input.
    const signal = robots.match(/^Content-Signal: (.+)$/m);
    expect(signal).toBeTruthy();
    const prefs = Object.fromEntries(
      signal[1].split(",").map((kv) => kv.trim().split("=")),
    );
    expect(prefs).toEqual({
      "ai-train": "no",
      search: "yes",
      "ai-input": "no",
    });
  });
});

describe("curator documentation covers the vocabulary (#507)", () => {
  const schema = readFileSync(path.join(REPO_ROOT, "docs", "schema.md"), "utf8");

  it("documents every review-status value, including to-be-verified", () => {
    for (const value of REVIEW_VALUES) {
      expect(schema, value).toContain(`\`${value}\``);
    }
  });

  it("documents every evidence-level value", () => {
    for (const value of EVIDENCE_VALUES) {
      expect(schema, value).toContain(`\`${value}\``);
    }
  });

  it("answers the claim-attempt question and keeps the deadline distinction", () => {
    expect(schema).toMatch(/Claim attempt/);
    expect(schema).toMatch(/not attested/i);
    expect(schema).toMatch(/Last checked/);
    expect(schema).toMatch(/enrollment deadline/i);
    expect(schema).toMatch(/never promoted to `verified`|No unknown method is promoted/i);
  });
});
