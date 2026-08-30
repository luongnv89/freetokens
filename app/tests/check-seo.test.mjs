import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { collectIssues, checkDist, OG_PROPERTIES, DEFAULT_BASE_URL } from "../scripts/check-seo.mjs";

const APP_ROOT = path.resolve(import.meta.dirname, "..");

function viteBuild(outDir) {
  execFileSync(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build", "--outDir", outDir, "--emptyOutDir"],
    { cwd: APP_ROOT, stdio: "pipe" },
  );
}

function prerender(distDir, dataFile, baseUrl) {
  const args = ["scripts/prerender.mjs", "--dist", distDir];
  if (dataFile) args.push("--data", dataFile);
  if (baseUrl) args.push("--base-url", baseUrl);
  execFileSync(process.execPath, args, { cwd: APP_ROOT, stdio: "pipe" });
}

function buildHead({ title, description, canonical, type = "website", withJsonLd = false, breadcrumbName = "Archive" }) {
  const image = `${DEFAULT_BASE_URL}/logo-mark.svg`;
  const jsonLd = withJsonLd
    ? `<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Offers","item":"${DEFAULT_BASE_URL}/"},{"@type":"ListItem","position":2,"name":"${breadcrumbName}","item":"${canonical}"}]}</script>`
    : "";
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="description" content="${description}" />
<title>${title}</title>
<link rel="canonical" href="${canonical}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:type" content="${type}" />
<meta property="og:site_name" content="Free AI Credits" />
<meta property="og:image" content="${image}" />
${jsonLd}
</head><body><div id="root"></div></body></html>`;
}

describe("check-seo guard (#209)", () => {
  beforeAll(() => {
    const dist = path.join(APP_ROOT, "dist");
    // node-tests job runs `npm test` without a prior `npm run build`, so
    // `app/dist` may not exist yet. Build it once for the dist-dependent
    // assertion below, mirroring the viteBuild+prerender pattern in
    // routes.test.mjs. Reuse an existing dist when present to keep local
    // runs fast.
    if (!existsSync(path.join(dist, "index.html")) || !existsSync(path.join(dist, "offers"))) {
      viteBuild(dist);
      prerender(dist);
    }
  }, 240_000);

  it("passes on a well-formed document with all SEO heads", () => {
    const html = buildHead({
      title: "Archive · Free AI Credits",
      description: "Reference archive of expired offers",
      canonical: `${DEFAULT_BASE_URL}/archive.html`,
      withJsonLd: true,
    });
    expect(collectIssues(html, "archive.html")).toEqual([]);
  });

  it("requires canonical present, single, and self-referencing", () => {
    const valid = buildHead({
      title: "X",
      description: "d",
      canonical: `${DEFAULT_BASE_URL}/archive.html`,
      withJsonLd: true,
    });
    // Missing canonical — strip the tag
    const missing = valid.replace(/<link rel="canonical"[^>]*>\n?/, "");
    expect(collectIssues(missing, "archive.html")).toEqual(
      expect.arrayContaining([expect.stringContaining("archive.html: missing canonical")]),
    );
    expect(collectIssues(missing, "archive.html").some((m) => m.includes("canonical"))).toBe(true);

    // Canonical mismatch — points to wrong path
    const mismatch = valid.replace(`${DEFAULT_BASE_URL}/archive.html`, `${DEFAULT_BASE_URL}/privacy.html`);
    expect(collectIssues(mismatch, "archive.html")).toEqual(
      expect.arrayContaining([expect.stringContaining("canonical mismatch")]),
    );

    // Removing canonical temporarily in a test branch must fail the check (acceptance)
    const stripped = valid.replace(/<link rel="canonical"[^>]*>/, "");
    const issues = collectIssues(stripped, "offers/demo.html");
    expect(issues.join("\n")).toMatch(/offers\/demo\.html:.*canonical/);
  });

  it("fails naming file+field when each OG property is missing", () => {
    for (const prop of OG_PROPERTIES) {
      const html = buildHead({
        title: "T · Free AI Credits",
        description: "d",
        canonical: `${DEFAULT_BASE_URL}/privacy.html`,
        withJsonLd: true,
      });
      const stripped = html.replace(new RegExp(`<meta property="${prop}"[^>]*>\\n?`), "");
      const issues = collectIssues(stripped, "privacy.html");
      expect(issues).toEqual(expect.arrayContaining([expect.stringContaining(`privacy.html: missing ${prop}`)]));
    }
  });

  it("requires JSON-LD on non-home pages and exempts home", () => {
    const archiveHtml = buildHead({
      title: "Archive · Free AI Credits",
      description: "d",
      canonical: `${DEFAULT_BASE_URL}/archive.html`,
      withJsonLd: false,
    });
    expect(collectIssues(archiveHtml, "archive.html")).toEqual(
      expect.arrayContaining([expect.stringContaining("archive.html: missing JSON-LD")]),
    );

    const offerHtml = buildHead({
      title: "Demo · Free AI Credits",
      description: "d",
      canonical: `${DEFAULT_BASE_URL}/offers/demo.html`,
      type: "article",
      withJsonLd: false,
    });
    expect(collectIssues(offerHtml, "offers/demo.html")).toEqual(
      expect.arrayContaining([expect.stringContaining("offers/demo.html: missing JSON-LD")]),
    );

    const homeHtml = buildHead({
      title: "Free AI Credits",
      description: "Every currently-claimable free AI credit offer",
      canonical: `${DEFAULT_BASE_URL}/`,
      withJsonLd: false,
    });
    // Home is exempt from JSON-LD (no breadcrumbs by design #208)
    expect(collectIssues(homeHtml, "index.html")).toEqual([]);
  });

  it("passes on the real built dist and fails when canonical is removed", () => {
    const dist = path.join(APP_ROOT, "dist");
    // Ensure a fresh build exists (prebuild already ran)
    const ok = checkDist(dist);
    expect(ok.issues).toEqual([]);
    expect(ok.ok).toBe(true);
    expect(ok.filesChecked).toBeGreaterThan(3);

    // Simulate regression: remove canonical from archive.html in a temp copy
    const tmp = mkdtempSync(path.join(tmpdir(), "ft-check-seo-"));
    try {
      // Copy minimal dist structure: reuse real files but patch one
      const htmlFiles = ["index.html", "archive.html", "privacy.html"];
      mkdirSync(path.join(tmp, "offers"), { recursive: true });
      for (const file of htmlFiles) {
        let html = readFileSync(path.join(dist, file), "utf8");
        if (file === "archive.html") {
          html = html.replace(/<link rel="canonical"[^>]*>\n?/, "");
        }
        writeFileSync(path.join(tmp, file), html);
      }
      // Copy one offer file intact so the temp dist has at least one offer
      const offers = readFileSync(path.join(APP_ROOT, "src/data/offers.json"), "utf8");
      const slug = JSON.parse(offers).offers[0].slug;
      const offerHtml = readFileSync(path.join(dist, "offers", `${slug}.html`), "utf8");
      writeFileSync(path.join(tmp, "offers", `${slug}.html`), offerHtml);

      const broken = checkDist(tmp);
      expect(broken.ok).toBe(false);
      expect(broken.issues.join("\n")).toMatch(/archive\.html:.*canonical/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CLI exits non-zero naming file+field when canonical missing (<30s, no new pinned action)", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ft-check-seo-cli-"));
    try {
      const html = buildHead({
        title: "X",
        description: "d",
        canonical: `${DEFAULT_BASE_URL}/archive.html`,
        withJsonLd: true,
      });
      const broken = html.replace(/<link rel="canonical"[^>]*>\n?/, "");
      writeFileSync(path.join(tmp, "archive.html"), broken);
      writeFileSync(
        path.join(tmp, "index.html"),
        buildHead({
          title: "Free AI Credits",
          description: "d",
          canonical: `${DEFAULT_BASE_URL}/`,
          withJsonLd: false,
        }),
      );
      expect(() =>
        execFileSync(process.execPath, [path.join(APP_ROOT, "scripts/check-seo.mjs"), "--dist", tmp], {
          stdio: "pipe",
        }),
      ).toThrow();
      try {
        execFileSync(process.execPath, [path.join(APP_ROOT, "scripts/check-seo.mjs"), "--dist", tmp], {
          stdio: "pipe",
        });
      } catch (e) {
        const output = (e.stderr?.toString() ?? "") + (e.stdout?.toString() ?? "");
        expect(output).toMatch(/archive\.html:.*canonical/);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
