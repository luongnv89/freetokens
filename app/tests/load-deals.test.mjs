// Deals (#809): loader, build pipeline and llms output. Every date is
// injected (`today` / `now`): nothing here reads the real clock, so the suite
// passes under CI's +400-day clock shift. The only deal used is the
// fictional test fixture in tests/fixtures/deals/.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DealError,
  isExpiredDeal,
  loadDeals,
  parseDealText,
  validateDeal,
} from "../scripts/load-deals.mjs";
import { runPipeline } from "../scripts/load-offers.mjs";
import DealsPage from "../src/components/DealsPage.tsx";
import HomePage from "../src/components/HomePage.tsx";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE_DIR = path.resolve(APP_ROOT, "..", "tests", "fixtures", "deals");
const FIXTURE = path.join(FIXTURE_DIR, "example-ai-pro-black-friday.yaml");
const FIXTURE_TEXT = readFileSync(FIXTURE, "utf8");
const TODAY = "2026-11-28";

const OFFER_YAML = [
  "title: Fixture Free Credits",
  "provider: Fixture Co",
  "category: coding",
  "amount: $10 in credits",
  "expiry_date: null",
  "source_url: https://fixture.example/credits",
  "verified_date: 2026-11-01",
  "verification: social_proof",
  "review_status: verified",
  "signup: required",
  "",
].join("\n");

function data(overrides = {}) {
  const parsed = parseDealText(FIXTURE_TEXT, FIXTURE);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete parsed[key];
    else parsed[key] = value;
  }
  return parsed;
}

const check = (overrides, today = TODAY) =>
  validateDeal(data(overrides), FIXTURE, today);

/** A throwaway repo layout: offers/ with one free offer, deals/ with the fixture. */
function scratchRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "ft-deals-"));
  mkdirSync(path.join(root, "offers"));
  mkdirSync(path.join(root, "deals"));
  writeFileSync(path.join(root, "offers", "fixture-free-credits.yaml"), OFFER_YAML);
  copyFileSync(FIXTURE, path.join(root, "deals", path.basename(FIXTURE)));
  return root;
}

async function pipeline(now) {
  const root = scratchRepo();
  const out = path.join(root, "out");
  try {
    const index = await runPipeline({
      offersDir: path.join(root, "offers"),
      outDir: out,
      now: new Date(now),
    });
    const jsonl = readFileSync(path.join(out, "offers.jsonl"), "utf8");
    const written = JSON.parse(readFileSync(path.join(out, "offers.json"), "utf8"));
    return { index, jsonl, written };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("deal validator (#809)", () => {
  it("accepts the fixture and marks it kind: deal", () => {
    const deal = check({});
    expect(deal.kind).toBe("deal");
    expect(deal.slug).toBe("example-ai-pro-black-friday");
    expect(deal.discount).toBe("50% off the first year");
    expect(deal).not.toHaveProperty("amount");
  });

  it("requires every schema field, and expiry_date may never be null", () => {
    for (const field of [
      "title",
      "provider",
      "category",
      "discount",
      "occasion",
      "expiry_date",
      "source_url",
      "verified_date",
    ]) {
      expect(() => check({ [field]: undefined }), field).toThrow(
        new RegExp(`missing required field.*${field}`),
      );
    }
    expect(() => check({ expiry_date: null })).toThrow(
      "expiry_date is required and cannot be null",
    );
  });

  it("rejects categories outside the deal scope", () => {
    for (const category of ["ai_subscription", "coding_agent", "ai_tool_api", "agent_compute"]) {
      expect(check({ category }).category).toBe(category);
    }
    for (const category of ["api_provider", "coding", "image", "hardware"]) {
      expect(() => check({ category }), category).toThrow("outside the deal scope");
    }
  });

  it("never lets a deal be labelled free", () => {
    expect(() => check({ amount: "$100" })).toThrow("a deal is never free");
    expect(() => check({ is_free: "true" })).toThrow("a deal is never free");
    for (const discount of ["Free for 3 months", "100% off", "first month FREE"]) {
      expect(() => check({ discount }), discount).toThrow("never labelled free");
    }
    expect(() => check({ title: "Example AI free trial" })).toThrow("never labelled free");
    expect(() => check({ deal_price: "$0" })).toThrow("no non-zero amount");
    expect(check({ title: "Freedom Plan — 30% off" }).title).toBe("Freedom Plan — 30% off");
  });

  it("rejects unknown fields and bad dates against the injected clock", () => {
    expect(() => check({ verification: "social_proof" })).toThrow("unknown field");
    expect(() => check({ start_date: "2026-12-09" })).toThrow("is after expiry_date");
    expect(() => check({}, "2026-11-26")).toThrow("verified_date 2026-11-27 is in the future");
    expect(() => check({ expiry_date: "2026-02-30" })).toThrow("YYYY-MM-DD");
    expect(() => check({ source_url: "http://example.com/" })).toThrow("https://");
  });

  it("hides a deal from the day after its expiry_date", () => {
    const deal = check({});
    expect(isExpiredDeal(deal, "2026-12-02")).toBe(false);
    expect(isExpiredDeal(deal, "2026-12-03")).toBe(true);
  });
});

describe("loadDeals (#809)", () => {
  it("returns running deals only, judged on the build clock", async () => {
    expect((await loadDeals(FIXTURE_DIR, "2026-12-02")).map((d) => d.slug)).toEqual([
      "example-ai-pro-black-friday",
    ]);
    expect(await loadDeals(FIXTURE_DIR, "2026-12-03")).toEqual([]);
  });

  it("treats a missing folder as no deals and rejects stray files and offer slugs", async () => {
    expect(await loadDeals(path.join(FIXTURE_DIR, "nope"), TODAY)).toEqual([]);
    await expect(
      loadDeals(FIXTURE_DIR, TODAY, ["example-ai-pro-black-friday"]),
    ).rejects.toThrow(DealError);
    const root = mkdtempSync(path.join(tmpdir(), "ft-deals-stray-"));
    try {
      writeFileSync(path.join(root, "notes.txt"), "x");
      await expect(loadDeals(root, TODAY)).rejects.toThrow("unexpected entry");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("build pipeline keeps deals apart from free offers (#809)", () => {
  it("puts running deals in index.deals only, never in the free counts", async () => {
    const { index, jsonl, written } = await pipeline("2026-11-28T12:00:00Z");
    expect(index.count).toBe(1);
    expect(index.active_count).toBe(1);
    expect(index.offers.map((o) => o.slug)).toEqual(["fixture-free-credits"]);
    expect(index.deals).toHaveLength(1);
    expect(index.deals[0]).toMatchObject({ kind: "deal", slug: "example-ai-pro-black-friday" });
    expect(jsonl).not.toContain("example-ai-pro");
    // The written artifact passed the index schema (runPipeline validates it).
    expect(written.deals).toEqual(index.deals);
  });

  it("drops an expired deal at build time", async () => {
    const { index } = await pipeline("2026-12-03T00:00:00Z");
    expect(index.deals).toEqual([]);
    expect(index.count).toBe(1);
  });
});

describe("Deals UI from the built index (#809)", () => {
  it("shows the discount badge and end date while the deal runs, and nothing once it ended", async () => {
    const running = (await pipeline("2026-11-28T12:00:00Z")).index;
    const live = renderToStaticMarkup(createElement(DealsPage, { index: running }));
    expect(live).toContain("Deal · not free");
    expect(live).toContain('<span class="deal-discount"><span class="sr-only">Discount: </span>50% off the first year</span>');
    expect(live).toContain('<time dateTime="2026-12-02">Dec 2, 2026</time>');

    const ended = (await pipeline("2026-12-03T00:00:00Z")).index;
    const gone = renderToStaticMarkup(createElement(DealsPage, { index: ended }));
    expect(gone).toContain("No running deals right now");
    expect(gone).not.toContain("Example AI Pro");
  });

  it("keeps deals out of the home page's free-offer count and listing", async () => {
    const { index } = await pipeline("2026-11-28T12:00:00Z");
    const home = renderToStaticMarkup(createElement(HomePage, { index }));
    expect(home).not.toContain("Example AI Pro");
    expect(home).not.toContain("50% off the first year");
    const without = renderToStaticMarkup(
      createElement(HomePage, { index: { ...index, deals: [] } }),
    );
    expect(home).toBe(without);
  });
});

describe("llms files mark deals as deals (#809)", () => {
  function generate(deals) {
    const root = mkdtempSync(path.join(tmpdir(), "ft-llms-deals-"));
    try {
      const dataFile = path.join(root, "offers.json");
      writeFileSync(
        dataFile,
        JSON.stringify({
          generated_at: "2026-11-28T00:00:00Z",
          count: 1,
          active_count: 1,
          expired_count: 0,
          offers: [
            {
              slug: "fixture-free-credits",
              title: "Fixture Free Credits",
              provider: "Fixture Co",
              category: "coding",
              amount: "$10 in credits",
              expiry_date: null,
              source_url: "https://fixture.example/credits",
              verified_date: "2026-11-01",
              verification: "social_proof",
              review_status: "verified",
              signup: "required",
              status: "active",
            },
          ],
          deals,
        }),
      );
      execFileSync(
        process.execPath,
        [
          "scripts/generate-llms.mjs",
          "--data",
          dataFile,
          "--details",
          path.join(root, "missing.json"),
          "--public-dir",
          path.join(root, "public"),
          "--dist",
          path.join(root, "missing-dist"),
        ],
        { cwd: APP_ROOT, stdio: "pipe" },
      );
      return {
        short: readFileSync(path.join(root, "public", "llms.txt"), "utf8"),
        full: readFileSync(path.join(root, "public", "llms-full.txt"), "utf8"),
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("lists running deals in their own section, marked kind=deal", () => {
    const { short, full } = generate([check({})]);
    for (const text of [short, full]) {
      expect(text).toContain("## Deals (discounts on paid plans, not free)");
      expect(text).toContain(
        "- [Example AI Pro — Black Friday](https://freetokens.custats.info/deals/example-ai-pro-black-friday.html): Example AI — kind=deal · discount: 50% off the first year",
      );
      expect(text).toContain("ends 2026-12-02");
      expect(text).toContain("[Deals](https://freetokens.custats.info/deals.html)");
    }
    // The free-offer lines and counts never include the deal.
    expect(short).toContain("from 1 active listings");
    const offersPart = short.slice(short.indexOf("## Offers"), short.indexOf("## Deals"));
    expect(offersPart).not.toContain("Example AI");
    expect(full).toContain("— 1 active offers.");
  });

  it("omits the section when no deal is running but still links the page", () => {
    const { short } = generate([]);
    expect(short).not.toContain("## Deals");
    expect(short).toContain("[Deals](https://freetokens.custats.info/deals.html)");
  });
});
