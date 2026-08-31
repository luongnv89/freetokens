import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SITEMAP_NAMESPACE } from "../scripts/sitemap.mjs";

// Routing + prerender contract (issue #123): the built output must contain
// one HTML file per live route — /, /archive, /privacy, offers/<slug>.html
// for every entry in the frozen data contract, plus feed.xml — at the same
// paths the Python builder serves today. Route generation is data-driven:
// adding an offer to offers.json (regenerated from YAML by load:data)
// produces its page on the next build with no source edit.
const APP_ROOT = path.resolve(import.meta.dirname, "..");
const ROBOTS_SITEMAP = "Sitemap: https://freetokens.custats.info/sitemap.xml";

function prerender(distDir, dataFile, baseUrl) {
  const args = ["scripts/prerender.mjs", "--dist", distDir];
  if (dataFile) args.push("--data", dataFile);
  if (baseUrl) args.push("--base-url", baseUrl);
  execFileSync(process.execPath, args, { cwd: APP_ROOT, stdio: "pipe" });
}

function viteBuild(outDir) {
  execFileSync(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build", "--outDir", outDir, "--emptyOutDir"],
    { cwd: APP_ROOT, stdio: "pipe" },
  );
}

function headOf(html) {
  const end = html.indexOf("</head>");
  if (end < 0) throw new Error("document has no </head>");
  return html.slice(0, end);
}

function htmlAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function metaContents(html, attribute, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...headOf(html).matchAll(
      new RegExp(
        `<meta\\s+${attribute}="${escapedName}"\\s+content="([^"]*)"\\s*/?>`,
        "g",
      ),
    ),
  ].map((match) => match[1]);
}

function canonicalValues(html) {
  return [
    ...headOf(html).matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>(?:\s*)/g),
  ].map((match) => match[1]);
}

const OG_PROPERTIES = ["og:title", "og:description", "og:url", "og:type", "og:site_name", "og:image"];
const TWITTER_PROPERTIES = ["twitter:card", "twitter:title", "twitter:description", "twitter:image"];

function headShape(html) {
  const head = headOf(html);
  const count = (pattern) => head.match(pattern)?.length ?? 0;
  return {
    lang: [...html.matchAll(/<html\s+lang="([^"]+)"/g)].map((match) => match[1]),
    charset: count(/<meta\s+charset="[^"]+"\s*\/?\s*>/g),
    viewport: metaContents(html, "name", "viewport").length,
    description: metaContents(html, "name", "description").length,
    canonical: canonicalValues(html).length,
    og: OG_PROPERTIES.map((property) => metaContents(html, "property", property).length),
    twitter: TWITTER_PROPERTIES.map((name) => metaContents(html, "name", name).length),
  };
}

function headings(html) {
  return html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
}

function breadcrumbData(html) {
  const marker = '<script type="application/ld+json">';
  let cursor = 0;
  while (true) {
    const start = html.indexOf(marker, cursor);
    if (start < 0) break;
    const end = html.indexOf("</script>", start);
    if (end < 0) break;
    const parsed = JSON.parse(html.slice(start + marker.length, end));
    if (parsed["@type"] === "BreadcrumbList") return parsed;
    cursor = end + "</script>".length;
  }
  throw new Error("document has no breadcrumb JSON-LD");
}

function breadcrumbNames(html) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
  if (!nav) throw new Error("document has no breadcrumb nav");
  return [...nav.querySelectorAll('a, [aria-current="page"]')].map((element) =>
    element.textContent?.trim() ?? "",
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
    expect(existsSync(path.join(outDir, "about.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "feed.xml"))).toBe(true);

    const emitted = readdirSync(path.join(outDir, "offers")).sort();
    const expected = index.offers.map((o) => `${o.slug}.html`).sort();
    expect(emitted).toEqual(expected);
  });

  it("copies the robots policy and keeps it stable across builds", () => {
    const readRobots = () => readFileSync(path.join(outDir, "robots.txt"), "utf8");
    const first = readRobots();
    expect(first).toContain("User-agent: *\nAllow: /\n");
    expect(first.split("\n").filter((line) => line === ROBOTS_SITEMAP)).toHaveLength(1);
    expect(first).not.toContain("\0");

    for (const bot of ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Bytespider"]) {
      expect(first).toContain(`User-agent: ${bot}\nDisallow: /\n`);
    }
    for (const bot of [
      "Googlebot",
      "Bingbot",
      "DuckDuckBot",
      "OAI-SearchBot",
      "PerplexityBot",
      "ChatGPT-User",
      "Claude-User",
    ]) {
      expect(first).toContain(`User-agent: ${bot}\nAllow: /\n`);
    }

    viteBuild(outDir);
    prerender(outDir);
    expect(readRobots()).toBe(first);
  }, 10000);

  it("emits an absolute sitemap for fixed and offer routes", () => {
    const sitemap = readFileSync(path.join(outDir, "sitemap.xml"), "utf8");
    const document = new DOMParser().parseFromString(sitemap, "application/xml");
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.documentElement.localName).toBe("urlset");
    expect(document.documentElement.namespaceURI).toBe(SITEMAP_NAMESPACE);

    const urls = [...document.getElementsByTagNameNS(SITEMAP_NAMESPACE, "url")];
    expect(urls).toHaveLength(index.offers.length + 5);
    expect(urls.map((url) => url.getElementsByTagNameNS(SITEMAP_NAMESPACE, "loc")[0].textContent)).toEqual([
      "https://freetokens.custats.info/",
      "https://freetokens.custats.info/archive.html",
      "https://freetokens.custats.info/privacy.html",
      "https://freetokens.custats.info/about.html",
      "https://freetokens.custats.info/feed.xml",
      ...index.offers.map((offer) => `https://freetokens.custats.info/offers/${offer.slug}.html`),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    for (const url of urls) {
      const lastmod = url.getElementsByTagNameNS(SITEMAP_NAMESPACE, "lastmod")[0].textContent;
      expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(lastmod <= today).toBe(true);
    }
  });

  it("stamps each document so hydration lands on the right page", () => {
    expect(readFileSync(path.join(outDir, "index.html"), "utf8")).toContain('data-page="home"');
    expect(readFileSync(path.join(outDir, "archive.html"), "utf8")).toContain('data-page="archive"');
    expect(readFileSync(path.join(outDir, "privacy.html"), "utf8")).toContain('data-page="privacy"');
    expect(readFileSync(path.join(outDir, "about.html"), "utf8")).toContain('data-page="about"');

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
    expect(detail).toContain('class="claim-list"');
    expect(detail).toContain('type="checkbox"');
    expect(detail).toContain('class="share-copy"');
    expect(detail).not.toContain("offer_share");
    expect(detail).not.toContain("linkedin.com/sharing");
    expect(detail).not.toContain("data-ft-share");
  });

  it("emits crawlable breadcrumbs aligned with JSON-LD on every non-home route", () => {
    const rootPages = [
      {
        file: "archive.html",
        names: ["Offers", "Archive"],
        urls: [
          "https://freetokens.custats.info/",
          "https://freetokens.custats.info/archive.html",
        ],
      },
      {
        file: "privacy.html",
        names: ["Offers", "Privacy"],
        urls: [
          "https://freetokens.custats.info/",
          "https://freetokens.custats.info/privacy.html",
        ],
      },
      {
        file: "about.html",
        names: ["Offers", "About"],
        urls: [
          "https://freetokens.custats.info/",
          "https://freetokens.custats.info/about.html",
        ],
      },
    ];

    for (const page of rootPages) {
      const html = readFileSync(path.join(outDir, page.file), "utf8");
      const document = new DOMParser().parseFromString(html, "text/html");
      const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
      expect(nav).not.toBeNull();
      expect(nav?.querySelector('a[href="./index.html"]')).not.toBeNull();
      expect(nav?.querySelector('a[aria-current="page"]')).toBeNull();
      expect(nav?.querySelector('[aria-current="page"]')).not.toBeNull();
      expect(breadcrumbNames(html)).toEqual(page.names);

      const data = breadcrumbData(html);
      expect(data["@type"]).toBe("BreadcrumbList");
      expect(data.itemListElement.map((item) => item.name)).toEqual(page.names);
      expect(data.itemListElement.map((item) => item.position)).toEqual([1, 2]);
      expect(data.itemListElement.map((item) => item.item)).toEqual(page.urls);
    }

    for (const offer of index.offers) {
      const html = readFileSync(
        path.join(outDir, "offers", `${offer.slug}.html`),
        "utf8",
      );
      const document = new DOMParser().parseFromString(html, "text/html");
      const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
      expect(nav).not.toBeNull();
      expect(nav?.querySelector('a[href="../index.html"]')).not.toBeNull();
      expect(nav?.querySelector('a[aria-current="page"]')).toBeNull();
      expect(breadcrumbNames(html)).toEqual(["Offers", offer.title]);

      const data = breadcrumbData(html);
      expect(data["@type"]).toBe("BreadcrumbList");
      expect(data.itemListElement.map((item) => item.name)).toEqual([
        "Offers",
        offer.title,
      ]);
      expect(data.itemListElement.map((item) => item.position)).toEqual([1, 2]);
      expect(data.itemListElement.map((item) => item.item)).toEqual([
        "https://freetokens.custats.info/",
        `https://freetokens.custats.info/offers/${offer.slug}.html`,
      ]);
    }

    const home = readFileSync(path.join(outDir, "index.html"), "utf8");
    const homeDocument = new DOMParser().parseFromString(home, "text/html");
    // Home renders empty breadcrumbs (JSON-LD present, no self-link items)
    const homeNav = homeDocument.querySelector('nav[aria-label="Breadcrumb"]');
    expect(homeNav).not.toBeNull();
    expect(homeNav?.querySelectorAll('li').length).toBe(0);
    expect(home).toContain("BreadcrumbList");
  });

  it(
    "uses the configured prerender base URL in breadcrumb JSON-LD",
    () => {
      const customDir = path.join(tmpdir(), `ft-routes-base-${process.pid}`);
      viteBuild(customDir);
      prerender(customDir, undefined, "https://example.test/subpath/");

      const archive = readFileSync(path.join(customDir, "archive.html"), "utf8");
      expect(breadcrumbData(archive).itemListElement.map((item) => item.item)).toEqual([
        "https://example.test/subpath/",
        "https://example.test/subpath/archive.html",
      ]);

      const offer = index.offers[0];
      const detail = readFileSync(
        path.join(customDir, "offers", `${offer.slug}.html`),
        "utf8",
      );
      expect(breadcrumbData(detail).itemListElement.map((item) => item.item)).toEqual([
        "https://example.test/subpath/",
        `https://example.test/subpath/offers/${offer.slug}.html`,
      ]);
    },
    240_000,
  );

  it("emits exactly one primary h1 on every prerendered page", () => {
    const home = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(headings(home)).toHaveLength(1);
    expect(home).toContain(
      '<h1 class="site-slogan">Every claimable free AI credit offer — verified, tagged, and on one fast page.</h1>',
    );
    expect(home).toMatch(
      /<div class="site-header">[\s\S]*<h1 class="site-slogan">Every claimable free AI credit/,
    );

    for (const file of ["archive.html", "privacy.html", "about.html"]) {
      expect(headings(readFileSync(path.join(outDir, file), "utf8"))).toHaveLength(1);
    }
    for (const offer of index.offers) {
      const detail = readFileSync(
        path.join(outDir, "offers", `${offer.slug}.html`),
        "utf8",
      );
      expect(headings(detail)).toHaveLength(1);
    }
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

  it("discovers archive CSS before the module graph so FCP is not queued behind JS", () => {
    const archive = readFileSync(path.join(outDir, "archive.html"), "utf8");
    const cssAt = archive.search(/<link[^>]*rel="stylesheet"/i);
    const jsAt = archive.search(/<script[^>]*type="module"/i);
    expect(cssAt).toBeGreaterThan(-1);
    expect(jsAt).toBeGreaterThan(-1);
    expect(cssAt).toBeLessThan(jsAt);
  });

  it("ships RSS with absolute links off DEFAULT_BASE_URL", async () => {
    const { DEFAULT_BASE_URL } = await import("../src/lib/site.ts");
    const feed = readFileSync(path.join(outDir, "feed.xml"), "utf8");
    const active = index.offers.filter((o) => o.status !== "expired");
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
            review_status: "unverified",
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
    expect(readFileSync(page, "utf8")).toContain("Open the official offer page.");
    expect(readFileSync(page, "utf8")).not.toContain('class="od-brief"');
    const feed = readFileSync(path.join(outDir, "feed.xml"), "utf8");
    expect(feed).toContain("<title>Synthetic New Offer</title>");
    expect(feed).toContain("/offers/zz-synthetic-new-offer.html");
  });

  it("stamps /privacy.html with its own title and meta description", () => {
    const privacy = readFileSync(path.join(outDir, "privacy.html"), "utf8");
    expect(privacy).toContain("<title>Privacy Policy · Free AI Credits</title>");
    expect(privacy).toContain(
      'content="How the Free AI Credits site handles data: consent-gated anonymized analytics, no forms, no personal data storage."',
    );
    expect(privacy).toContain("<main>");
  });

  it("puts a title and meta description on every route type", () => {
    const pages = [
      ["index.html", "Free AI Credits"],
      ["archive.html", "Offer Archive · Free AI Credits"],
      ["privacy.html", "Privacy Policy · Free AI Credits"],
      ["about.html", "About · Free AI Credits"],
    ];
    for (const [file, title] of pages) {
      const html = readFileSync(path.join(outDir, file), "utf8");
      expect(html).toContain(`<title>${title}</title>`);
      expect(html).toMatch(/<meta name="description" content="[^"]+"/);
    }
    const slug = index.offers[0].slug;
    const detail = readFileSync(path.join(outDir, "offers", `${slug}.html`), "utf8");
    expect(detail).toContain(`<title>${index.offers[0].title} · Free AI Credits</title>`);
    expect(detail).toMatch(/<meta name="description" content="[^"]+"/);
  });

  it("declares favicon and logo variants at #106 sizes", () => {
    const home = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(home).toContain('href="./favicon.svg"');
    expect(home).toContain('sizes="16x16"');
    expect(home).toContain('href="./logo-mark.svg"');
    expect(home).toContain('sizes="64x64"');
    expect(home).toContain('href="./logo-icon.svg"');
    expect(home).toContain('sizes="512x512"');
    expect(existsSync(path.join(outDir, "favicon.svg"))).toBe(true);
    expect(existsSync(path.join(outDir, "logo-mark.svg"))).toBe(true);
    expect(existsSync(path.join(outDir, "logo-icon.svg"))).toBe(true);
    expect(existsSync(path.join(outDir, "logo-full.svg"))).toBe(true);
    expect(existsSync(path.join(outDir, "logo-wordmark.svg"))).toBe(true);
    expect(existsSync(path.join(outDir, "og.png"))).toBe(true);
  });

  it("ships RSS autodiscovery in <head> and keeps the footer RSS link", async () => {
    const { DEFAULT_BASE_URL } = await import("../src/lib/site.ts");
    const home = readFileSync(path.join(outDir, "index.html"), "utf8");
    const head = home.slice(0, home.indexOf("</head>"));
    expect(head).toMatch(
      /<link[^>]*rel="alternate"[^>]*type="application\/rss\+xml"[^>]*href="(?:\.\/)?feed\.xml"/,
    );
    expect(home).toMatch(/<a href="(?:\.\/)?feed\.xml">RSS<\/a>/);

    const archive = readFileSync(path.join(outDir, "archive.html"), "utf8");
    expect(archive.slice(0, archive.indexOf("</head>"))).toMatch(
      /<link[^>]*rel="alternate"[^>]*type="application\/rss\+xml"[^>]*href="(?:\.\/)?feed\.xml"/,
    );

    const slug = index.offers[0].slug;
    const detail = readFileSync(path.join(outDir, "offers", `${slug}.html`), "utf8");
    expect(detail.slice(0, detail.indexOf("</head>"))).toMatch(
      /<link[^>]*rel="alternate"[^>]*type="application\/rss\+xml"[^>]*href="\.\.\/feed\.xml"/,
    );
    // Internal page hrefs stay relative; only the feed uses the absolute origin.
    // Canonical metadata is absolute; internal anchor hrefs remain relative.
    expect(home).not.toMatch(/<a[^>]+href="https:\/\/luongnv89\.github\.io\/freetokens\//);
  });

  it("stamps every prerendered page with one route-matching canonical", async () => {
    const { DEFAULT_BASE_URL } = await import("../src/lib/site.ts");
    const canonicalLinks = (html) =>
      [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>(?:\s*)/g)].map(
        (match) => match[1],
      );
    const pages = [
      ["index.html", `${DEFAULT_BASE_URL}/`],
      ["archive.html", `${DEFAULT_BASE_URL}/archive.html`],
      ["privacy.html", `${DEFAULT_BASE_URL}/privacy.html`],
      ["about.html", `${DEFAULT_BASE_URL}/about.html`],
    ];

    for (const [file, expected] of pages) {
      expect(canonicalLinks(readFileSync(path.join(outDir, file), "utf8"))).toEqual([
        expected,
      ]);
    }
    for (const offer of index.offers) {
      const detail = readFileSync(
        path.join(outDir, "offers", `${offer.slug}.html`),
        "utf8",
      );
      expect(canonicalLinks(detail)).toEqual([
        `${DEFAULT_BASE_URL}/offers/${offer.slug}.html`,
      ]);
    }
  });

  it("stamps detail pages with summary-based meta, title, and rel=canonical (#128)", async () => {
    const { DEFAULT_BASE_URL } = await import("../src/lib/site.ts");
    const { offerMetaDescription } = await import("../src/lib/offerDetails.ts");
    const details = JSON.parse(
      readFileSync(path.join(APP_ROOT, "src/data/details.json"), "utf8"),
    );
    const offer = index.offers.find((o) => details[o.slug]?.summary) ?? index.offers[0];
    const detail = readFileSync(path.join(outDir, "offers", `${offer.slug}.html`), "utf8");
    const expected = offerMetaDescription(offer, details[offer.slug]);
    expect(detail).toContain(`<title>${offer.title} · Free AI Credits</title>`);
    expect(detail).toContain(`content="${expected}"`);
    expect(detail).toContain(
      `<link rel="canonical" href="${DEFAULT_BASE_URL}/offers/${offer.slug}.html" />`,
    );
    const shot = details[offer.slug]?.social_proof?.find((p) => p.type === "screenshot");
    if (shot) {
      expect(detail).toContain(`src="../${shot.image}"`);
    }
  });

  it("stamps every generated head with one complete social metadata set", async () => {
    const { DEFAULT_BASE_URL } = await import("../src/lib/site.ts");
    const { offerMetaDescription } = await import("../src/lib/offerDetails.ts");
    const details = JSON.parse(
      readFileSync(path.join(APP_ROOT, "src/data/details.json"), "utf8"),
    );
    const pages = [
      {
        file: "index.html",
        title: "Free AI Credits",
        description:
          "Every currently-claimable free AI credit offer, labeled with review status, verification level, and sign-up need, on one fast page.",
        canonical: `${DEFAULT_BASE_URL}/`,
        type: "website",
      },
      {
        file: "archive.html",
        title: "Offer Archive · Free AI Credits",
        description:
          "Reference archive of expired free AI credit offers, kept newest-first with their original terms.",
        canonical: `${DEFAULT_BASE_URL}/archive.html`,
        type: "website",
      },
      {
        file: "privacy.html",
        title: "Privacy Policy · Free AI Credits",
        description:
          "How the Free AI Credits site handles data: consent-gated anonymized analytics, no forms, no personal data storage.",
        canonical: `${DEFAULT_BASE_URL}/privacy.html`,
        type: "website",
      },
      {
        file: "about.html",
        title: "About · Free AI Credits",
        description:
          "What Free AI Credits is, how the listings are verified, and what the numbers mean.",
        canonical: `${DEFAULT_BASE_URL}/about.html`,
        type: "website",
      },
      ...index.offers.map((offer) => ({
        file: path.join("offers", `${offer.slug}.html`),
        title: `${offer.title} · Free AI Credits`,
        description: offerMetaDescription(offer, details[offer.slug]),
        canonical: `${DEFAULT_BASE_URL}/offers/${offer.slug}.html`,
        type: "article",
      })),
    ];
    const image = `${DEFAULT_BASE_URL}/og.png`;
    for (const page of pages) {
      const html = readFileSync(path.join(outDir, page.file), "utf8");
      expect(html).toContain(`<title>${htmlAttr(page.title)}</title>`);
      expect(canonicalValues(html)).toEqual([page.canonical]);
      const expected = {
        "og:title": page.title,
        "og:description": page.description,
        "og:url": page.canonical,
        "og:type": page.type,
        "og:site_name": "Free AI Credits",
        "og:image": image,
      };
      for (const property of OG_PROPERTIES) {
        expect(metaContents(html, "property", property)).toEqual([htmlAttr(expected[property])]);
      }
      expect(metaContents(html, "property", "og:image:width")).toEqual(["1200"]);
      expect(metaContents(html, "property", "og:image:height")).toEqual(["630"]);
      expect(metaContents(html, "property", "og:image:type")).toEqual(["image/png"]);
      const expectedTwitter = {
        "twitter:card": "summary_large_image",
        "twitter:title": page.title,
        "twitter:description": page.description,
        "twitter:image": image,
      };
      for (const name of TWITTER_PROPERTIES) {
        expect(metaContents(html, "name", name)).toEqual([htmlAttr(expectedTwitter[name])]);
      }
    }
  });

  it("keeps the complete production fallback metadata in the Vite shell", () => {
    const shell = readFileSync(path.join(APP_ROOT, "index.html"), "utf8");
    const canonical = "https://freetokens.custats.info/";
    const description =
      "Every currently-claimable free AI credit offer, labeled with review status, verification level, and sign-up need, on one fast page.";
    const image = "https://freetokens.custats.info/og.png";
    const expectedProperties = {
      "og:title": "Free AI Credits",
      "og:description": description,
      "og:url": canonical,
      "og:type": "website",
      "og:site_name": "Free AI Credits",
      "og:image": image,
    };
    for (const [property, value] of Object.entries(expectedProperties)) {
      expect(metaContents(shell, "property", property)).toEqual([htmlAttr(value)]);
    }
    expect(metaContents(shell, "property", "og:image:width")).toEqual(["1200"]);
    expect(metaContents(shell, "property", "og:image:height")).toEqual(["630"]);
    expect(metaContents(shell, "property", "og:image:type")).toEqual(["image/png"]);
    const expectedTwitter = {
      "twitter:card": "summary_large_image",
      "twitter:title": "Free AI Credits",
      "twitter:description": description,
      "twitter:image": image,
    };
    for (const [name, value] of Object.entries(expectedTwitter)) {
      expect(metaContents(shell, "name", name)).toEqual([htmlAttr(value)]);
    }
    expect(canonicalValues(shell)).toEqual([canonical]);
    expect(shell.match(/free-ai-credits:social-meta:start/g)).toHaveLength(1);
    expect(shell.match(/free-ai-credits:social-meta:end/g)).toHaveLength(1);
  });

  it("keeps a single metadata shape in the Vite shell and prerendered home", () => {
    const shell = readFileSync(path.join(APP_ROOT, "index.html"), "utf8");
    const home = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(headShape(shell)).toEqual({
      lang: ["en"],
      charset: 1,
      viewport: 1,
      description: 1,
      canonical: 1,
      og: [1, 1, 1, 1, 1, 1],
      twitter: [1, 1, 1, 1],
    });
    expect(headShape(home)).toEqual(headShape(shell));
  });

  it("removes duplicate description and canonical tags from a prerender template", () => {
    const indexPath = path.join(outDir, "index.html");
    const shell = readFileSync(indexPath, "utf8");
    writeFileSync(
      indexPath,
      shell.replace(
        "</head>",
        '    <meta name="description" content="stale description" />\n' +
          '    <link rel="canonical" href="https://example.test/stale/" />\n' +
          "</head>",
      ),
    );
    prerender(outDir);
    const home = readFileSync(indexPath, "utf8");
    const description =
      "Every currently-claimable free AI credit offer, labeled with review status, verification level, and sign-up need, on one fast page.";
    expect(metaContents(home, "name", "description")).toEqual([htmlAttr(description)]);
    expect(canonicalValues(home)).toEqual(["https://freetokens.custats.info/"]);
  });

  it("does not duplicate metadata when prerender runs again", { timeout: 15_000 }, () => {
    const files = [
      "index.html",
      "archive.html",
      "privacy.html",
      "about.html",
      ...index.offers.map((offer) => path.join("offers", `${offer.slug}.html`)),
    ];
    // The synthetic-data test above intentionally changes this shared output;
    // reset it to the default dataset before comparing two real prerenders.
    prerender(outDir);
    const before = files.map((file) => readFileSync(path.join(outDir, file), "utf8"));
    prerender(outDir);
    const after = files.map((file) => readFileSync(path.join(outDir, file), "utf8"));
    expect(after).toEqual(before);
    for (const html of after) {
      expect(metaContents(html, "property", "og:title")).toHaveLength(1);
      expect(metaContents(html, "property", "og:description")).toHaveLength(1);
      expect(metaContents(html, "property", "og:url")).toHaveLength(1);
      expect(metaContents(html, "name", "twitter:card")).toHaveLength(1);
    }
  });
});
