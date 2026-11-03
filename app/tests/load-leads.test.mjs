import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadLeads, parseLeadText, LeadError } from "../scripts/load-leads.mjs";
import { runPipeline } from "../scripts/load-offers.mjs";

// Unverified leads (#660): loader contract mirrored from scripts/lead_model.py.
function leadText(slug, overrides = {}) {
  const data = {
    slug,
    provider: '"Acme AI"',
    title: '"Free tokens"',
    claim: '"1M free tokens for new accounts."',
    amount_claimed: "null",
    sources:
      '[{"url": "https://x.com/a/status/1", "type": "x", "author": null, "handle": "@a", "date": "2026-11-01"}]',
    first_seen: "2026-11-01",
    last_seen: "2026-11-02",
    reason: "official_silent",
    reason_detail: '"Pricing page is silent."',
    official_urls_tried: '["https://acme.example/pricing"]',
    ...overrides,
  };
  return (
    "# Unverified lead\n" +
    Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n") +
    "\n"
  );
}

function leadsDir(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "ft-leads-"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, `${name}.yaml`), text);
  }
  return dir;
}

describe("load-leads (#660)", () => {
  it("parses JSON-valued flat lines", () => {
    const data = parseLeadText(leadText("acme-free"), "acme-free.yaml");
    expect(data.sources[0].handle).toBe("@a");
    expect(data.amount_claimed).toBeNull();
  });

  it("sorts newest last_seen first and drops leads stale after 30 days", async () => {
    const dir = leadsDir({
      "old-lead": leadText("old-lead", { first_seen: "2026-09-01", last_seen: "2026-10-03" }),
      "edge-lead": leadText("edge-lead", { first_seen: "2026-10-04", last_seen: "2026-10-04" }),
      "new-lead": leadText("new-lead", { last_seen: "2026-11-03" }),
    });
    const leads = await loadLeads(dir, "2026-11-03");
    expect(leads.map((l) => l.slug)).toEqual(["new-lead", "edge-lead"]);
    rmSync(dir, { recursive: true });
  });

  it("fails naming the file when a lead has no source", async () => {
    const dir = leadsDir({ "no-src": leadText("no-src", { sources: "[]" }) });
    await expect(loadLeads(dir, "2026-11-03")).rejects.toThrow(
      /no-src\.yaml: sources must list at least one/,
    );
    rmSync(dir, { recursive: true });
  });

  it("rejects a lead whose slug is also an offer", async () => {
    const dir = leadsDir({ "acme-free": leadText("acme-free") });
    await expect(loadLeads(dir, "2026-11-03", ["acme-free"])).rejects.toBeInstanceOf(
      LeadError,
    );
    rmSync(dir, { recursive: true });
  });

  it("writes leads to unverified.json only, never offers.json", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ft-leads-pipeline-"));
    const offersDir = path.join(root, "offers");
    mkdirSync(offersDir);
    writeFileSync(
      path.join(offersDir, "real-offer.yaml"),
      "title: Real Offer\nprovider: Real\ncategory: api_provider\namount: $10\n" +
        "expiry_date: null\nsource_url: https://real.example/offer\n" +
        "verified_date: 2026-11-01\nverification: social_proof\n" +
        "review_status: under-review\nsignup: required\n",
    );
    mkdirSync(path.join(root, "unverified"));
    writeFileSync(
      path.join(root, "unverified", "acme-free.yaml"),
      leadText("acme-free", { last_seen: "2026-11-02" }),
    );
    const outDir = path.join(root, "out");
    await runPipeline({ offersDir, outDir, now: new Date("2026-11-03T00:00:00Z") });
    const leads = JSON.parse(readFileSync(path.join(outDir, "unverified.json"), "utf8"));
    expect(leads.leads.map((l) => l.slug)).toEqual(["acme-free"]);
    expect(readFileSync(path.join(outDir, "offers.json"), "utf8")).not.toContain("acme-free");
    rmSync(root, { recursive: true });
  });
});
