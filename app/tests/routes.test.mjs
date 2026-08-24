import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Routing + prerender contract (issue #123): the built output must contain
// one HTML file per live route — /, /archive, /privacy, offers/<slug>.html
// for every entry in the frozen data contract, plus feed.xml — at the same
// paths the Python builder serves today. Route generation is data-driven:
// adding an offer to offers.json (regenerated from YAML by load:data)
// produces its page on the next build with no source edit.
const APP_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");

function prerender(distDir, dataFile) {
  const args = ["scripts/prerender.mjs", "--dist", distDir];
  if (dataFile) args.push("--data", dataFile);
  execFileSync(process.execPath, args, { cwd: APP_ROOT, stdio: "pipe" });
}

function viteBuild(outDir) {
  execFileSync(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build", "--outDir", outDir, "--emptyOutDir"],
    { cwd: APP_ROOT, stdio: "pipe" },
  );
}

describe("static route coverage (#123)", () => {
  const outDir = path.join(tmpdir(), `ft-routes-${process.pid}`);
  let index;

  beforeAll(() => {
    viteBuild(outDir);
    prerender(outDir);
    index = JSON.parse(
      readFileSync(path.join(APP_ROOT, "src/data/offers.json"), "utf8"),
    );
  }, 240_000);

  it("emits one HTML file per live route at the previous URLs", () => {
    expect(existsSync(path.join(outDir, "index.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "archive.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "privacy.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "feed.xml"))).toBe(true);

    const emitted = readdirSync(path.join(outDir, "offers")).sort();
    const expected = index.offers.map((o) => `${o.slug}.html`).sort();
    expect(emitted).toEqual(expected);

    // Route-path diff old-vs-new must be empty: every path the Python
    // builder serves today exists in the app output.
    const legacy = readdirSync(path.join(REPO_ROOT, "site", "offers")).sort();
    expect(emitted).toEqual(legacy);
  });

  it("stamps each document so hydration lands on the right page", () => {
    expect(readFileSync(path.join(outDir, "index.html"), "utf8")).toContain('data-page="home"');
    expect(readFileSync(path.join(outDir, "archive.html"), "utf8")).toContain('data-page="archive"');
    expect(readFileSync(path.join(outDir, "privacy.html"), "utf8")).toContain('data-page="privacy"');

    const slug = index.offers[0].slug;
    const detail = readFileSync(path.join(outDir, "offers", `${slug}.html`), "utf8");
    expect(detail).toContain(`data-page="detail"`);
    expect(detail).toContain(`data-slug="${slug}"`);
  });

  it("deep-links render full server-side content with JS disabled", () => {
    const offer = index.offers[0];
    const detail = readFileSync(path.join(outDir, "offers", `${offer.slug}.html`), "utf8");
    expect(detail).toContain(`<h1>${offer.title}</h1>`);
    expect(detail).toContain(offer.amount);
    // The claim CTA is real prerendered markup, not something JS injects.
    expect(detail).toMatch(new RegExp(`href="${offer.source_url}"`));
  });

  it("keeps depth-1 asset references climbing back to site root", () => {
    const slug = index.offers[0].slug;
    const detail = readFileSync(path.join(outDir, "offers", `${slug}.html`), "utf8");
    for (const m of detail.matchAll(/(?:src|href)="(\.[^"]*)"/g)) {
      expect(m[1].startsWith("../")).toBe(true);
    }
    // ...while root pages stay at ./
    const archive = readFileSync(path.join(outDir, "archive.html"), "utf8");
    expect(archive).toContain('href="./favicon.svg"');
  });

  it("ships RSS with absolute links off DEFAULT_BASE_URL", async () => {
    const { DEFAULT_BASE_URL } = await import("../src/lib/site.ts");
    const feed = readFileSync(path.join(outDir, "feed.xml"), "utf8");
    const active = index.offers.filter((o) => o.status === "active");
    expect(feed.match(/<item>/g)?.length).toBe(active.length);
    expect(feed).toContain(`<link>${DEFAULT_BASE_URL}/</link>`);
    for (const m of feed.matchAll(/<link>([^<]+)<\/link>/g)) {
      if (m[1] !== `${DEFAULT_BASE_URL}/`) {
        expect(m[1].startsWith(`${DEFAULT_BASE_URL}/offers/`)).toBe(true);
      }
    }
  });

  it("produces a new offer's page with no code edit (data-driven routes)", () => {
    const dataCopy = path.join(tmpdir(), `ft-data-${process.pid}.json`);
    writeFileSync(
      dataCopy,
      JSON.stringify({
        ...index,
        count: index.count + 1,
        active_count: index.active_count + 1,
        offers: [
          {
            slug: "zz-synthetic-new-offer",
            title: "Synthetic New Offer",
            provider: "Example",
            category: "coding",
            amount: "$0",
            expiry_date: null,
            source_url: "https://example.com",
            verified_date: "2026-08-01",
            verification: "unverified",
            signup: "none",
            status: "active",
          },
          ...index.offers,
        ],
      }),
    );
    prerender(outDir, dataCopy);
    const page = path.join(outDir, "offers", "zz-synthetic-new-offer.html");
    expect(existsSync(page)).toBe(true);
    expect(readFileSync(page, "utf8")).toContain("<h1>Synthetic New Offer</h1>");
  });
});
