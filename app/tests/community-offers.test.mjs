// Community offers (#748): the build loader's validation, the index shape,
// build-time expiry on entries_close, and the llms exports.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  OfferError,
  buildIndex,
  parseOfferText,
  validateOffer,
} from "../scripts/load-offers.mjs";
import {
  validateIndexData,
  validateJsonlText,
} from "../scripts/validate-artifacts.mjs";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const TODAY = "2026-11-17";

const GIVEAWAY = {
  title: "Devin Max giveaway",
  provider: "Cognition (Devin)",
  category: "coding",
  amount: "one month of Devin Max per code ($200 value each)",
  expiry_date: "2026-11-20",
  source_url: "https://x.com/ben_ai_eng/status/2122616807404052781",
  verified_date: "2026-11-17",
  verification: "unverified",
  review_status: "unverified",
  signup: "required",
  listing_type: "community",
  community_subtype: "giveaway",
  added_by: "luong",
  shared_by_handle: "ben_ai_eng",
  shared_by_name: "Ben Newell",
  shared_by_post_date: "2026-11-17",
  codes_available: "10",
  entries_close: "2026-11-20",
  timezone_note: "no time zone given",
};

const PROMO = {
  ...GIVEAWAY,
  title: "Acme promo",
  expiry_date: "null",
  community_subtype: "promo_code",
  promo_code: "ACME-10",
  codes_available: undefined,
  entries_close: undefined,
  timezone_note: undefined,
  shared_by_name: undefined,
};

function text(fields) {
  return (
    Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n") + "\n"
  );
}

function load(fields, slug = "devin") {
  const offer = validateOffer(parseOfferText(text(fields), "x.yaml"), "x.yaml", TODAY);
  offer.slug = slug;
  return offer;
}

describe("community offer validation (load-offers.mjs mirrors offer_model.py)", () => {
  it("accepts a giveaway and a promo code", () => {
    expect(load(GIVEAWAY).codes_available).toBe(10);
    expect(load(PROMO).promo_code).toBe("ACME-10");
  });

  const rejections = {
    "added_by must be luong": { added_by: "offer-hunter" },
    "only valid with listing_type": { listing_type: undefined },
    "verification must be unverified": { verification: "social_proof" },
    "review_status must be unverified": { review_status: "verified" },
    "expiry_date must equal entries_close": { expiry_date: "2026-11-21" },
    "timezone_note is required": { timezone_note: undefined },
    "bare account handle": { shared_by_handle: "@ben_ai_eng" },
    "promo_code is only valid on a promo_code": { promo_code: "X1" },
    "codes_available must be a positive whole number": { codes_available: "0" },
  };
  for (const [message, patch] of Object.entries(rejections)) {
    it(`rejects: ${message}`, () => {
      expect(() => load({ ...GIVEAWAY, ...patch })).toThrow(OfferError);
      expect(() => load({ ...GIVEAWAY, ...patch })).toThrow(message);
    });
  }
  it("rejects a promo_code entry without its code", () => {
    expect(() => load({ ...PROMO, promo_code: undefined })).toThrow(
      "promo_code is required",
    );
  });
});

describe("community entries in the index", () => {
  it("nests the community facts and validates against the index schema", () => {
    const index = buildIndex([load(GIVEAWAY)], new Date("2026-11-17T12:00:00Z"));
    const [row] = index.offers;
    expect(row.listing_type).toBe("community");
    expect(row.community).toEqual({
      subtype: "giveaway",
      added_by: "luong",
      shared_by: {
        handle: "ben_ai_eng",
        name: "Ben Newell",
        post_url: "https://x.com/ben_ai_eng/status/2122616807404052781",
        post_date: "2026-11-17",
      },
      codes_available: 10,
      entries_close: "2026-11-20",
      timezone_note: "no time zone given",
    });
    expect(validateIndexData(index)).toBe(true);
    expect(validateJsonlText(JSON.stringify(row))).toBe(1);
  });

  it("regular offers carry no community keys", () => {
    const regular = load({
      ...GIVEAWAY,
      verification: "social_proof",
      review_status: "under-review",
      listing_type: undefined,
      community_subtype: undefined,
      added_by: undefined,
      shared_by_handle: undefined,
      shared_by_name: undefined,
      shared_by_post_date: undefined,
      codes_available: undefined,
      entries_close: undefined,
      timezone_note: undefined,
    });
    const [row] = buildIndex([regular]).offers;
    expect("listing_type" in row).toBe(false);
    expect("community" in row).toBe(false);
  });

  it("the index schema rejects a community block without listing_type", () => {
    const index = buildIndex([load(GIVEAWAY)], new Date("2026-11-17T12:00:00Z"));
    delete index.offers[0].listing_type;
    expect(() => validateIndexData(index)).toThrow();
  });
});

describe("build-time expiry on entries_close (end of day, UTC build clock)", () => {
  const status = (iso) =>
    buildIndex([load(GIVEAWAY)], new Date(iso)).offers[0].status;
  it("stays listed through the last minute of the closing day", () => {
    expect(status("2026-11-20T00:00:00Z")).toBe("active");
    expect(status("2026-11-20T23:59:59Z")).toBe("active");
  });
  it("leaves the listing once that day has ended", () => {
    expect(status("2026-11-21T00:00:00Z")).toBe("expired");
  });
  it("a promo code with no stated expiry never expires", () => {
    const index = buildIndex([load(PROMO, "acme")], new Date("2099-01-01T00:00:00Z"));
    expect(index.offers[0].status).toBe("active");
  });
});

describe("the first entry ships in the committed index.json", () => {
  it("is the Devin Max giveaway by @ben_ai_eng", () => {
    const index = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "index.json"), "utf8"),
    );
    const row = index.offers.find(
      (o) => o.slug === "devin-max-one-month-code-giveaway",
    );
    expect(row.community.subtype).toBe("giveaway");
    expect(row.community.added_by).toBe("luong");
    expect(row.community.shared_by.handle).toBe("ben_ai_eng");
    expect(row.community.codes_available).toBe(10);
    expect(row.expiry_date).toBe("2026-11-20");
  });
});

describe("llms exports label community entries", () => {
  function run(offers) {
    const root = mkdtempSync(path.join(tmpdir(), "ft-llms-community-"));
    try {
      const dataFile = path.join(root, "offers.json");
      const publicDir = path.join(root, "public");
      writeFileSync(
        dataFile,
        JSON.stringify({
          generated_at: "2026-11-17T00:00:00Z",
          count: offers.length,
          active_count: offers.length,
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
          path.join(root, "missing.json"),
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

  it("keeps community entries out of the offers list, in their own section", () => {
    const index = buildIndex([load(GIVEAWAY)], new Date("2026-11-17T12:00:00Z"));
    const { short, full } = run(index.offers);
    const [offersPart, communityPart] = short.split(
      "## Community offers (not verified by freetokens)",
    );
    expect(communityPart).toBeDefined();
    expect(offersPart).not.toContain("Devin Max giveaway");
    expect(communityPart).toContain("Devin Max giveaway");
    expect(communityPart).toContain(
      "community giveaway — not verified by freetokens",
    );
    expect(communityPart).toContain("shared by @ben_ai_eng (Ben Newell)");
    expect(communityPart).toContain("10 codes · entries close 2026-11-20");
    expect(full).toContain(
      "- Listing: community giveaway — not verified by freetokens",
    );
  });

  it("the llms-full byte budget never truncates a community entry away", () => {
    const [community] = buildIndex(
      [load(GIVEAWAY)],
      new Date("2026-11-17T12:00:00Z"),
    ).offers;
    const filler = Array.from({ length: 600 }, (_, i) => ({
      ...community,
      slug: `filler-${String(i).padStart(3, "0")}`,
      title: `Filler ${i}`,
      amount: `$${i} credits ${"x".repeat(300)}`,
      verification: "social_proof",
      review_status: "under-review",
      listing_type: undefined,
      community: undefined,
      verified_date: "2026-11-17",
    })).map((o) => JSON.parse(JSON.stringify(o)));
    const { full } = run([...filler, community]);
    expect(full).toContain("truncated to stay under the 200KB");
    expect(full).toContain("### Devin Max giveaway");
  });
});
