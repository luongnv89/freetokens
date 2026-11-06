import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadLeads,
  parseLeadText,
  validateLead,
  urlHost,
  foreignDomains,
  unsafeWording,
  registrable,
  LeadError,
} from "../scripts/load-leads.mjs";
import { runPipeline } from "../scripts/load-offers.mjs";

// Unverified leads (#660): loader contract mirrored from scripts/lead_model.py.
// The probes are shared with tests/test_unverified_leads.py so both gates
// reject exactly the same inputs (review B2).
const PROBES = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, "../../tests/fixtures/unsafe-lead-probes.json"),
    "utf8",
  ),
);
const TODAY = "2026-11-03";

function leadData(slug, overrides = {}) {
  return {
    slug,
    provider: "Acme AI",
    title: "Free tokens",
    claim: "1M free tokens for new accounts.",
    amount_claimed: null,
    sources: [
      { url: "https://x.com/a/status/1", type: "x", author: null, handle: "@a", date: "2026-11-01" },
    ],
    first_seen: "2026-11-01",
    last_seen: "2026-11-02",
    reason: "official_silent",
    reason_detail: "Pricing page is silent.",
    official_urls_tried: ["https://acme.example/pricing"],
    ...overrides,
  };
}

function leadText(slug, overrides = {}) {
  const data = leadData(slug, overrides);
  return (
    "# Unverified lead\n" +
    Object.entries(data)
      .map(([k, v]) =>
        v === null
          ? `${k}: null`
          : ["slug", "first_seen", "last_seen", "reason"].includes(k)
            ? `${k}: ${v}`
            : `${k}: ${JSON.stringify(v)}`,
      )
      .join("\n") +
    "\n"
  );
}

function leadsDir(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "ft-leads-"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name.includes(".") ? name : `${name}.yaml`), text);
  }
  return dir;
}

const check = (overrides) =>
  validateLead(leadData("acme-free", overrides), "acme-free.yaml", TODAY);

describe("load-leads (#660)", () => {
  it("parses JSON-valued flat lines and adds the newest post date", () => {
    const data = parseLeadText(leadText("acme-free"), "acme-free.yaml");
    expect(data.sources[0].handle).toBe("@a");
    expect(check({}).posted).toBe("2026-11-01");
  });

  it("lists a lead only while its newest post is at most 3 days old, newest post first", async () => {
    const post = (date) => [
      { url: `https://x.com/a/status/${date}`, type: "x", author: null, handle: null, date },
    ];
    const dir = leadsDir({
      "old-post": leadText("old-post", { sources: post("2026-10-30"), first_seen: "2026-10-30", last_seen: "2026-11-03" }),
      "edge-post": leadText("edge-post", { sources: post("2026-10-31"), first_seen: "2026-10-31", last_seen: "2026-10-31" }),
      "new-post": leadText("new-post", { sources: post("2026-11-03"), first_seen: "2026-11-03", last_seen: "2026-11-03" }),
    });
    const leads = await loadLeads(dir, TODAY);
    expect(leads.map((l) => l.slug)).toEqual(["new-post", "edge-post"]);
    rmSync(dir, { recursive: true });
  });

  it("passes official_urls_tried through to the emitted lead (#683)", async () => {
    const dir = leadsDir({ "acme-free": leadText("acme-free") });
    const [lead] = await loadLeads(dir, TODAY);
    expect(lead.official_urls_tried).toEqual(["https://acme.example/pricing"]);
    rmSync(dir, { recursive: true });
  });

    it("rejects an undated lead and a lead with no source", () => {
    expect(() =>
      check({ sources: [{ url: "https://x.com/a/status/1", type: "x", author: null, handle: null, date: null }] }),
    ).toThrow(/undated source/);
    expect(() => check({ sources: [] })).toThrow(/sources must list at least one/);
  });

  it("rejects every unsafe claim probe and accepts the safe ones", () => {
    for (const claim of PROBES.claims) {
      expect(() => check({ claim }), claim).toThrow(LeadError);
    }
    for (const claim of PROBES.safe_claims) {
      expect(() => check({ claim }), claim).not.toThrow();
    }
    expect(() => check({ provider: PROBES.provider_with_url })).toThrow(/provider names/);
    expect(() => check({ reason_detail: PROBES.reason_detail_with_url })).toThrow(/reason_detail names/);
  });

  it("rejects crafted source URLs the browser would resolve elsewhere", () => {
    for (const url of PROBES.bad_source_urls) {
      expect(() => check({ sources: [{ url, type: "x", author: null, handle: null, date: "2026-11-01" }] }), url).toThrow(
        LeadError,
      );
    }
    expect(urlHost("https://bit.ly\\@x.com/a")).toBeNull();
    expect(urlHost("https://www.x.com/a/status/1")).toBe("x.com");
  });

  it("agrees with Python on Unicode input: NFKC first, ASCII word boundaries (F4)", () => {
    expect(foreignDomains("Claim at caf\u00e9free.xyz", ["acme.example"])).toEqual(["free.xyz"]);
    expect(foreignDomains("Claim at \uff41\uff43\uff4d\uff45.xyz", ["acme.example"])).toEqual(["acme.xyz"]);
    expect(unsafeWording("\uff24\uff2d me")).toBe("DM");
    expect(() => check({ claim: "Caf\u00e9 owners get 1M free tokens." })).not.toThrow();
  });

  it("compares registrable domains and keeps payment wording action-shaped (F3)", () => {
    expect(registrable("docs.acme.co.uk")).toBe("acme.co.uk");
    expect(registrable("api.acme.example")).toBe("acme.example");
    expect(foreignDomains("shop.acme.co.uk", ["www.acme.co.uk"])).toEqual([]);
    expect(foreignDomains("other.co.uk", ["www.acme.co.uk"])).toEqual(["other.co.uk"]);
    expect(foreignDomains("Free for IBM watsonx.ai users", ["acme.example"])).toEqual([]);
    expect(foreignDomains("Claim at free-grok.ai", ["acme.example"])).toEqual(["free-grok.ai"]);
    expect(unsafeWording("Link quota, no credit card needed.")).toBeNull();
    expect(unsafeWording("Add a credit card to unlock")).toBe("Add a credit card");
  });

  it("allows one day of timezone slack on lead dates (F5)", () => {
    const post = (date) => [{ url: "https://x.com/a/status/9", type: "x", author: null, handle: null, date }];
    expect(() => check({ last_seen: "2026-11-04", sources: post("2026-11-04") })).not.toThrow();
    expect(() => check({ last_seen: "2026-11-05" })).toThrow(/in the future/);
    expect(() => check({ sources: post("2026-11-05") })).toThrow(/in the future/);
  });

  it("checks wording on every rendered field, links only on claim fields (F6)", () => {
    expect(() => check({ reason_detail: "The post says to DM the bot for a code." })).toThrow(
      /reason_detail asks for a DM/,
    );
    expect(() => check({ provider: "Acme DM bot" })).toThrow(/provider asks for a DM/);
    expect(() => check({ reason_detail: "https://acme.example/pricing returned HTTP 403." })).not.toThrow();
  });

  it("handles a missing or empty folder and rejects stray files", async () => {
    expect(await loadLeads(path.join(tmpdir(), "ft-no-such-leads-dir"), TODAY)).toEqual([]);
    const empty = leadsDir({});
    expect(await loadLeads(empty, TODAY)).toEqual([]);
    rmSync(empty, { recursive: true });
    const stray = leadsDir({ "acme.yml": leadText("acme") });
    await expect(loadLeads(stray, TODAY)).rejects.toThrow(/unexpected file/);
    rmSync(stray, { recursive: true });
  });

  it("rejects a lead whose slug is also an offer", async () => {
    const dir = leadsDir({ "acme-free": leadText("acme-free") });
    await expect(loadLeads(dir, TODAY, ["acme-free"])).rejects.toBeInstanceOf(LeadError);
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
    writeFileSync(path.join(root, "unverified", "acme-free.yaml"), leadText("acme-free"));
    const outDir = path.join(root, "out");
    await runPipeline({ offersDir, outDir, now: new Date("2026-11-03T00:00:00Z") });
    const leads = JSON.parse(readFileSync(path.join(outDir, "unverified.json"), "utf8"));
    expect(leads.leads.map((l) => l.slug)).toEqual(["acme-free"]);
    expect(readFileSync(path.join(outDir, "offers.json"), "utf8")).not.toContain("acme-free");
    rmSync(root, { recursive: true });
  });
});
