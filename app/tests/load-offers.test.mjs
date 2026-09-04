import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OfferError,
  buildIndex,
  readAddedDates,
  isExpired,
  loadOffers,
  runPipeline,
  validateWrittenArtifacts,
} from "../scripts/load-offers.mjs";
import {
  ArtifactSchemaError,
  validateIndexData,
  validateJsonlText,
} from "../scripts/validate-artifacts.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const OFFERS_DIR = path.join(REPO_ROOT, "offers");
const TODAY = new Date().toISOString().slice(0, 10);

function offerText(overrides = {}, extra = "") {
  const fields = {
    title: "Test Offer",
    provider: "Test Provider",
    category: "coding",
    amount: "$100 in credits",
    expiry_date: "null",
    source_url: "https://example.com/offer",
    verified_date: "2026-01-01",
    verification: "social_proof",
    review_status: "unverified",
    signup: "none",
    ...overrides,
  };
  return (
    Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n") +
    "\n" +
    extra
  );
}

describe("expiry boundaries (build-time status, ADR 0001)", () => {
  const base = { slug: "s", title: "t" };
  it("offer expiring today is active", () => {
    expect(isExpired({ ...base, expiry_date: TODAY }, TODAY)).toBe(false);
  });
  it("offer expired yesterday is expired", () => {
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);
    expect(isExpired({ ...base, expiry_date: yesterday }, TODAY)).toBe(true);
  });
  it("null expiry never expires", () => {
    expect(isExpired({ ...base, expiry_date: null }, TODAY)).toBe(false);
  });
  it("buildIndex stamps status for all three cases", () => {
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);
    const index = buildIndex(
      [
        { ...base, slug: "a", verified_date: "2026-01-01", expiry_date: TODAY },
        {
          ...base,
          slug: "b",
          verified_date: "2026-01-02",
          expiry_date: yesterday,
        },
        { ...base, slug: "c", verified_date: "2026-01-03", expiry_date: null },
      ],
      new Date(`${TODAY}T00:00:00Z`),
    );
    const byStatus = Object.fromEntries(
      index.offers.map((o) => [o.slug, o.status]),
    );
    expect(byStatus).toEqual({ a: "active", b: "expired", c: "active" });
    expect(index.count).toBe(3);
    expect(index.active_count).toBe(2);
    expect(index.expired_count).toBe(1);
  });
});

describe("malformed input fails naming file and field", () => {
  it.each([
    [
      "missing required field",
      { signup: undefined },
      /missing required fields: .*signup/,
    ],
    [
      "invalid date format",
      { expiry_date: "01/02/2026" },
      /expiry_date must be a YYYY-MM-DD date/,
    ],
    ["out-of-enum category", { category: "crypto" }, /category must be one of/],
    [
      "out-of-enum review_status",
      { review_status: "pending" },
      /review_status must be one of/,
    ],
    [
      "future verified_date",
      { verified_date: "2099-01-01" },
      /verified_date is in the future/,
    ],
    [
      "bad source_url",
      { source_url: "ftp://example.com" },
      /source_url must be an http\(s\) URL/,
    ],
    [
      "indented line",
      {},
      /nested\/indented lines are not allowed/,
      "  oops: yes\n",
    ],
  ])("%s", async (_label, overrides, pattern, extra = "") => {
    const root = await mkdtemp(path.join(tmpdir(), "ft-bad-"));
    const dir = path.join(root, "offers");
    await mkdir(dir);
    const badPath = path.join(dir, "broken-offer.yaml");
    await writeFile(badPath, offerText(overrides, extra));
    await expect(loadOffers(dir)).rejects.toThrow(badPath);
    await expect(loadOffers(dir)).rejects.toThrow(pattern);
    await rm(root, { recursive: true, force: true });
  });

  it("orphan detail file is a build error", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ft-orphan-"));
    const offersDir = path.join(root, "offers");
    await mkdir(offersDir);
    await writeFile(path.join(offersDir, "test-offer.yaml"), offerText());
    await mkdir(path.join(offersDir, "details"));
    await writeFile(
      path.join(offersDir, "details", "ghost-offer.json"),
      JSON.stringify({ summary: "hi" }),
    );
    await expect(
      runPipeline({ offersDir, outDir: path.join(root, "out") }),
    ).rejects.toThrow(OfferError);
    await rm(root, { recursive: true, force: true });
  });
});

describe("generated artifacts vs committed index.json", () => {
  let index;
  beforeAll(async () => {
    const out = await mkdtemp(path.join(tmpdir(), "ft-out-"));
    index = await runPipeline({ offersDir: OFFERS_DIR, outDir: out });
    globalThis.__ftOut = out;
  });

  it("offers.json is deep-equal to committed index.json ignoring generated_at", async () => {
    const committed = JSON.parse(
      await readFile(path.join(REPO_ROOT, "index.json"), "utf8"),
    );
    delete committed.generated_at;
    const generated = structuredClone(index);
    delete generated.generated_at;
    expect(generated).toEqual(committed);
  });

  it("offers.jsonl has one valid object per line and line count equals count", async () => {
    const text = await readFile(
      path.join(globalThis.__ftOut, "offers.jsonl"),
      "utf8",
    );
    const lines = text.trimEnd().split("\n");
    expect(lines.length).toBe(index.count);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed).toEqual(index.offers);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("detail JSON passes through unchanged", async () => {
    const detailsOut = path.join(globalThis.__ftOut, "details");
    const fs = await import("node:fs/promises");
    const files = await fs.readdir(detailsOut);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      // Find source: try root details/ first, then subdirectories
      let srcPath = path.join(OFFERS_DIR, "details", f);
      let srcExists = false;
      try {
        await fs.access(srcPath);
        srcExists = true;
      } catch {}
      if (!srcExists) {
        const subEntries = await fs.readdir(path.join(OFFERS_DIR, "details"));
        for (const subdir of subEntries) {
          if (subdir === "." || subdir === "..") continue;
          const candidate = path.join(OFFERS_DIR, "details", subdir, f);
          try {
            await fs.access(candidate);
            srcPath = candidate;
            srcExists = true;
            break;
          } catch {}
        }
      }
      expect(srcExists).toBe(true);
      const src = await readFile(srcPath, "utf8");
      const dst = await readFile(path.join(detailsOut, f), "utf8");
      expect(JSON.parse(dst)).toEqual(JSON.parse(src));
    }
  });

  it("writes a slug-keyed details.json map matching the per-file documents", async () => {
    const aggregated = JSON.parse(
      await readFile(path.join(globalThis.__ftOut, "details.json"), "utf8"),
    );
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(path.join(globalThis.__ftOut, "details"));
    expect(Object.keys(aggregated).sort()).toEqual(
      files.map((f) => f.replace(/\.json$/, "")).sort(),
    );
    for (const f of files) {
      const slug = f.replace(/\.json$/, "");
      const perFile = JSON.parse(
        await readFile(path.join(globalThis.__ftOut, "details", f), "utf8"),
      );
      expect(aggregated[slug]).toEqual(perFile);
    }
  });
});

describe("data contract: schemas/offers-index.schema.json (#120)", () => {
  // A minimal valid entry, mutated per test case to violate the contract.
  function validOffer() {
    return {
      slug: "test-offer",
      title: "Test Offer",
      provider: "Test Provider",
      category: "coding",
      amount: "$100 in credits",
      expiry_date: null,
      source_url: "https://example.com/offer",
      verified_date: "2026-01-01",
      verification: "social_proof",
      review_status: "unverified",
      signup: "none",
      status: "active",
    };
  }

  function validIndex() {
    const offer = validOffer();
    return {
      generated_at: "2026-08-24T00:00:00Z",
      count: 1,
      active_count: 1,
      expired_count: 0,
      offers: [offer],
    };
  }

  it("the committed index.json validates against the schema", async () => {
    const committed = JSON.parse(
      await readFile(path.join(REPO_ROOT, "index.json"), "utf8"),
    );
    expect(validateIndexData(committed, "index.json")).toBe(true);
  });

  it("runPipeline artifacts pass the schema gate (no throw)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ft-gate-"));
    try {
      const out = path.join(root, "out");
      await runPipeline({ offersDir: OFFERS_DIR, outDir: out });
      await expect(validateWrittenArtifacts(out)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "missing status field",
      (ix) => delete ix.offers[0].status,
      /must have required property 'status'/,
    ],
    [
      "bad date format",
      (ix) => {
        ix.offers[0].expiry_date = "01/02/2026";
      },
      /\/offers\/0\/expiry_date must match/,
    ],
    [
      "unknown category",
      (ix) => {
        ix.offers[0].category = "crypto";
      },
      /\/offers\/0\/category must be equal to one of/,
    ],
    [
      "unknown extra field",
      (ix) => {
        ix.offers[0].promo = "flash sale";
      },
      /additional propert/,
    ],
    [
      "bad status value",
      (ix) => {
        ix.offers[0].status = "zombie";
      },
      /\/offers\/0\/status must be equal to one of/,
    ],
  ])(
    "fixture violation fails naming the field: %s",
    (_label, mutate, pattern) => {
      const index = validIndex();
      mutate(index);
      expect(() => validateIndexData(index)).toThrow(pattern);
    },
  );

  it("a corrupted artifact fails validateWrittenArtifacts with an OfferError", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ft-contract-"));
    try {
      const index = validIndex();
      delete index.offers[0].status;
      await writeFile(
        path.join(root, "offers.json"),
        `${JSON.stringify(index, null, 2)}\n`,
      );
      await writeFile(
        path.join(root, "offers.jsonl"),
        `${JSON.stringify(index.offers[0])}\n`,
      );
      await expect(validateWrittenArtifacts(root)).rejects.toThrow(OfferError);
      await expect(validateWrittenArtifacts(root)).rejects.toThrow(/status/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("every JSONL line validates and line count equals count", () => {
    expect(() =>
      validateJsonlText(`${JSON.stringify(validOffer())}\n`, "offers.jsonl"),
    ).not.toThrow();
    expect(() =>
      validateJsonlText(
        `${JSON.stringify({ ...validOffer(), status: "zombie" })}\n`,
        "offers.jsonl",
      ),
    ).toThrow(ArtifactSchemaError);
  });
});

describe("performance", () => {
  it("500 synthetic offers load and index well under 1s", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ft-perf-"));
    const dir = path.join(root, "offers");
    await mkdir(dir);
    await Promise.all(
      Array.from({ length: 500 }, (_, i) =>
        writeFile(
          path.join(dir, `perf-offer-${String(i).padStart(4, "0")}.yaml`),
          offerText({
            title: `Perf Offer ${i}`,
            provider: `Provider ${i % 50}`,
            verified_date: "2026-01-15",
          }),
        ),
      ),
    );
    const started = performance.now();
    const index = await runPipeline({
      offersDir: dir,
      outDir: path.join(root, "out"),
    });
    const elapsed = performance.now() - started;
    expect(index.count).toBe(500);
    expect(elapsed).toBeLessThan(1000);
    console.log(`500-offer fixture pipeline: ${elapsed.toFixed(0)}ms`);
    await rm(root, { recursive: true, force: true });
  }, 10000);
});

describe("newest-added default ordering", () => {
  const mk = (slug, verified) => ({
    slug,
    title: slug,
    provider: "p",
    category: "coding",
    amount: "free",
    expiry_date: null,
    source_url: "https://example.com",
    verified_date: verified,
    verification: "social_proof",
    review_status: "unverified",
    signup: "required",
  });

  it("puts the most recently added offer first, ahead of an older one checked the same day", () => {
    // The case the whole change exists for: a re-verification sweep gives
    // every offer the same verified_date, so only the add date can separate
    // them. Without it these two would fall back to the slug tiebreak and
    // "aaa" would lead purely because of its name.
    const index = buildIndex(
      [mk("aaa-old", "2026-09-03"), mk("zzz-new", "2026-09-03")],
      new Date("2026-09-04T00:00:00Z"),
      { "aaa-old": "2026-08-30", "zzz-new": "2026-09-02" },
    );
    expect(index.offers.map((o) => o.slug)).toEqual(["zzz-new", "aaa-old"]);
  });

  it("sorts an offer with no known add date after every offer that has one", () => {
    const index = buildIndex(
      [mk("unknown", "2026-09-03"), mk("known", "2026-09-03")],
      new Date("2026-09-04T00:00:00Z"),
      { known: "2026-08-01" },
    );
    expect(index.offers.map((o) => o.slug)).toEqual(["known", "unknown"]);
  });

  it("degrades to the previous newest-verified-then-slug order when no dates are known", () => {
    // This is the shallow-clone / no-git path. It must not reorder anything,
    // which is also what keeps the feed's ordering test honest.
    const offers = [
      mk("b-newer", "2026-09-03"),
      mk("a-older", "2026-09-01"),
      mk("a-newer", "2026-09-03"),
    ];
    const withNone = buildIndex(offers, new Date("2026-09-04T00:00:00Z"), {});
    const legacy = buildIndex(offers, new Date("2026-09-04T00:00:00Z"));
    expect(withNone.offers.map((o) => o.slug)).toEqual([
      "a-newer",
      "b-newer",
      "a-older",
    ]);
    expect(legacy.offers.map((o) => o.slug)).toEqual(
      withNone.offers.map((o) => o.slug),
    );
  });

  it("reads real first-commit dates out of this repository's git history", () => {
    // Guards the parser and the CI checkout depth together: if the shipped
    // site ever loses its history, this is the test that says so rather than
    // the listing quietly going alphabetical.
    const added = readAddedDates(OFFERS_DIR);
    const dates = Object.values(added);
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // More than one distinct day, or the ordering it feeds is meaningless.
    expect(new Set(dates).size).toBeGreaterThan(1);
  });

  it("returns an empty map outside a git repository instead of throwing", () => {
    expect(readAddedDates(tmpdir())).toEqual({});
  });
});
