import { describe, expect, it } from "vitest";
import {
  buildSitemap,
  MAX_SITEMAP_LOC_LENGTH,
  MAX_SITEMAP_URLS,
  SITEMAP_NAMESPACE,
} from "../scripts/sitemap.mjs";

const BASE = "https://example.com/freetokens";
const FIXED_PATHS = [
  "/",
  "/archive.html",
  "/privacy.html",
  "/about.html",
  "/feed.xml",
];

function offer(slug, overrides = {}) {
  return {
    slug,
    verified_date: "2026-08-20",
    status: "active",
    ...overrides,
  };
}

function indexFor(offers, generated_at = "2026-08-21T12:00:00Z") {
  return { generated_at, offers };
}

function sitemapEntries(xmlText) {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error(parserError.textContent);
  expect(document.documentElement.localName).toBe("urlset");
  expect(document.documentElement.namespaceURI).toBe(SITEMAP_NAMESPACE);
  return [...document.getElementsByTagNameNS(SITEMAP_NAMESPACE, "url")].map(
    (url) => ({
      loc: url.getElementsByTagNameNS(SITEMAP_NAMESPACE, "loc")[0].textContent,
      lastmod: url.getElementsByTagNameNS(SITEMAP_NAMESPACE, "lastmod")[0]
        .textContent,
    }),
  );
}

describe("sitemap generation", () => {
  it("emits fixed routes and every offer, including expired entries", () => {
    const xml = buildSitemap(
      indexFor([
        offer("active", { verified_date: "2026-08-20" }),
        offer("expired", { verified_date: "2026-08-01", status: "expired" }),
      ]),
      `${BASE}/`,
      { now: new Date("2026-08-22T00:00:00Z") },
    );
    const entries = sitemapEntries(xml);

    expect(entries.map(({ loc }) => loc)).toEqual([
      ...FIXED_PATHS.map((path) => `${BASE}${path}`),
      `${BASE}/offers/active.html`,
      `${BASE}/offers/expired.html`,
    ]);
    expect(entries.map(({ lastmod }) => lastmod)).toEqual([
      "2026-08-21",
      "2026-08-21",
      "2026-08-21",
      "2026-08-21",
      "2026-08-21",
      "2026-08-20",
      "2026-08-01",
    ]);
    expect(xml).not.toMatch(/priority|changefreq/);
  });

  it("normalizes timezone offsets to the UTC calendar date", () => {
    const xml = buildSitemap(
      indexFor([
        offer("offset", { verified_date: "2026-08-20T23:30:00-05:00" }),
      ]),
      BASE,
      { now: new Date("2026-08-22T00:00:00Z") },
    );

    expect(sitemapEntries(xml).at(-1).lastmod).toBe("2026-08-21");
  });

  it("falls back when a timestamp has a malformed time", () => {
    const xml = buildSitemap(
      indexFor([offer("malformed", { verified_date: "2026-08-20T25:00:00Z" })]),
      BASE,
      { now: new Date("2026-08-22T00:00:00Z") },
    );

    expect(sitemapEntries(xml).at(-1).lastmod).toBe("2026-08-21");
  });

  it("clamps future dates and falls back to a page mtime", () => {
    const xml = buildSitemap(
      indexFor(
        [
          offer("future", { verified_date: "2026-09-01" }),
          offer("mtime", { verified_date: "not-a-date" }),
          offer("missing", { verified_date: undefined }),
        ],
        "2026-08-30T00:00:00Z",
      ),
      BASE,
      {
        now: new Date("2026-08-29T23:59:59Z"),
        fileMtimes: new Map([
          ["mtime", new Date("2026-08-27T12:00:00Z")],
          ["missing", new Date("2026-09-02T12:00:00Z")],
        ]),
      },
    );
    const entries = sitemapEntries(xml);

    expect(entries.map(({ lastmod }) => lastmod)).toEqual([
      "2026-08-29",
      "2026-08-29",
      "2026-08-29",
      "2026-08-29",
      "2026-08-29",
      "2026-08-29",
      "2026-08-27",
      "2026-08-29",
    ]);
    expect(
      entries.every(({ lastmod }) => /^\d{4}-\d{2}-\d{2}$/.test(lastmod)),
    ).toBe(true);
  });

  it("escapes XML-sensitive characters in absolute locations", () => {
    const xml = buildSitemap(
      indexFor([offer("offer")]),
      "https://example.com/free&open/",
      { now: new Date("2026-08-22T00:00:00Z") },
    );

    expect(xml).toContain("https://example.com/free&amp;open/");
    expect(sitemapEntries(xml)[0].loc).toBe("https://example.com/free&open/");
  });

  it("rejects base URLs with query strings", () => {
    expect(() =>
      buildSitemap(indexFor([]), `${BASE}?utm_source=build`, {
        now: new Date("2026-08-22T00:00:00Z"),
      }),
    ).toThrow("without query, fragment, or userinfo");
  });

  it("rejects base URLs with fragments", () => {
    expect(() =>
      buildSitemap(indexFor([]), `${BASE}#archive`, {
        now: new Date("2026-08-22T00:00:00Z"),
      }),
    ).toThrow("without query, fragment, or userinfo");
  });

  it("rejects locations at the sitemap URL length limit", () => {
    const pathPrefix = `${BASE}/offers/`;
    const pathSuffix = ".html";
    const boundarySlug = "a".repeat(
      MAX_SITEMAP_LOC_LENGTH - pathPrefix.length - pathSuffix.length,
    );
    const acceptedSlug = boundarySlug.slice(0, -1);

    expect(() =>
      buildSitemap(indexFor([offer(acceptedSlug)]), BASE, {
        now: new Date("2026-08-22T00:00:00Z"),
      }),
    ).not.toThrow();
    expect(() =>
      buildSitemap(indexFor([offer(boundarySlug)]), BASE, {
        now: new Date("2026-08-22T00:00:00Z"),
      }),
    ).toThrow(`${MAX_SITEMAP_LOC_LENGTH} characters`);
  });

  it("rejects serialized XML over the byte limit", () => {
    const index = indexFor([offer("café")]);
    const buildOptions = { now: new Date("2026-08-22T00:00:00Z") };
    const sitemap = buildSitemap(index, BASE, buildOptions);
    const characterLength = sitemap.length;
    const byteLength = Buffer.byteLength(sitemap, "utf8");

    expect(byteLength).toBeGreaterThan(characterLength);
    expect(() =>
      buildSitemap(index, BASE, {
        ...buildOptions,
        maxXmlBytes: characterLength,
      }),
    ).toThrow(`${byteLength} bytes`);
    expect(
      buildSitemap(index, BASE, { ...buildOptions, maxXmlBytes: byteLength }),
    ).toBe(sitemap);
  });

  it("rejects a URL set above the sitemap protocol limit", () => {
    const offers = Array.from({ length: MAX_SITEMAP_URLS - 5 }, (_, index) =>
      offer(`offer-${index}`),
    );
    expect(() =>
      buildSitemap(indexFor(offers), BASE, {
        now: new Date("2026-08-22T00:00:00Z"),
      }),
    ).not.toThrow();
    expect(() =>
      buildSitemap(indexFor([...offers, offer("too-many")]), BASE, {
        now: new Date("2026-08-22T00:00:00Z"),
      }),
    ).toThrow(`maximum is ${MAX_SITEMAP_URLS}`);
  });

  it("rejects an invalid generated timestamp instead of inventing a date", () => {
    expect(() =>
      buildSitemap(indexFor([offer("offer")], "2026-02-30T00:00:00Z"), BASE, {
        now: new Date("2026-08-22T00:00:00Z"),
      }),
    ).toThrow("generated_at must be a valid date");
  });
});
