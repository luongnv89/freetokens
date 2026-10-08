import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Markdown-twin coverage (issues #524 + #526): every prerendered route ships a
// <page>.md sibling — the in-repo approximation of Accept: text/markdown
// negotiation, which GitHub Pages cannot perform. Twins for the data routes
// come from offers.json/details.json; the prose pages (about, privacy) are
// converted from their own prerendered <main> markup so the twin cannot drift.
const APP_ROOT = path.resolve(import.meta.dirname, "..");
const BASE = "https://freetokens.custats.info";

function offer(i, overrides = {}) {
  return {
    slug: `test-offer-${i}`,
    title: `Test Offer ${i}`,
    provider: "TestCo",
    category: "api_provider",
    amount: `$${10 + i} free credits`,
    expiry_date: null,
    source_url: "https://example.com/free",
    verified_date: "2026-09-25",
    verification: "social_proof",
    review_status: "under-review",
    signup: "required",
    status: "active",
    ...overrides,
  };
}

// Minimal prerendered stand-ins for the prose routes: one <main> carrying the
// markup shapes the converter must handle (chrome drops, headings, lists,
// links, entities, interactive controls).
const ABOUT_HTML = `<!doctype html><html><body><main>
<header class="masthead"><div class="site-header"><nav class="site-nav"><a href="./index.html">Offers</a></nav></div>
<p class="kicker">free ai credits · about</p><h1>About Free AI Credits</h1>
<p class="tagline">A tagline with <strong>bold</strong> &amp; an <a href="./archive.html">archive link</a>.</p></header>
<div class="policy"><section><h2 id="what">What this is</h2>
<p>Body copy with <code>inline code</code> &amp; entities &middot; like this.</p>
<ul><li>First <em>point</em></li><li>Second point with <a href="https://example.com/x">a link</a></li></ul>
<button type="button" id="ft-export-data">Export</button>
<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
<svg aria-hidden="true"><path d="m0 0"/></svg></section></div></main></body></html>`;

const PRIVACY_HTML = `<!doctype html><html><body><main>
<h1>Privacy Policy</h1><div class="policy"><section><h2>In short</h2>
<ol><li>Ordered one</li><li>Ordered two</li></ol>
<p>Stored under <kbd>ft_ga_consent</kbd>.</p>
<p hidden>Hidden draft never ships.</p></section></div></main></body></html>`;

function runGenerator({ offers, details = {}, withPages = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ft-md-"));
  try {
    const dataFile = path.join(root, "offers.json");
    const detailsFile = path.join(root, "details.json");
    const distDir = path.join(root, "dist");
    const list = offers ?? [offer(1), offer(2, { status: "expired" })];
    writeFileSync(
      dataFile,
      JSON.stringify({
        generated_at: "2026-10-06T00:00:00Z",
        count: list.length,
        active_count: list.filter((o) => o.status !== "expired").length,
        expired_count: list.filter((o) => o.status === "expired").length,
        offers: list,
      }),
    );
    writeFileSync(detailsFile, JSON.stringify(details));
    mkdirSync(distDir, { recursive: true });
    if (withPages) {
      writeFileSync(path.join(distDir, "about.html"), ABOUT_HTML);
      writeFileSync(path.join(distDir, "privacy.html"), PRIVACY_HTML);
    }
    execFileSync(
      process.execPath,
      [
        "scripts/generate-markdown.mjs",
        "--data",
        dataFile,
        "--details",
        detailsFile,
        "--dist",
        distDir,
      ],
      { cwd: APP_ROOT, stdio: "pipe" },
    );
    const read = (name) =>
      existsSync(path.join(distDir, name))
        ? readFileSync(path.join(distDir, name), "utf8")
        : null;
    return {
      distDir,
      read,
    };
  } catch (err) {
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
}

describe("generate-markdown route twins (#524)", () => {
  it("emits one .md twin per route and per offer", () => {
    const { distDir, read } = runGenerator({
      offers: [offer(1), offer(2, { status: "expired" })],
    });
    try {
      for (const name of ["index.md", "archive.md", "about.md", "privacy.md"]) {
        expect(read(name), `${name} emitted`).not.toBeNull();
      }
      expect(read("offers/test-offer-1.md")).not.toBeNull();
      // Expired offers keep their page, so they keep their twin (#60 parity).
      expect(read("offers/test-offer-2.md")).not.toBeNull();
      expect(existsSync(distDir)).toBe(true);
    } finally {
      rmSync(path.dirname(distDir), { recursive: true, force: true });
    }
  });

  it("index.md lists every active offer with trust fields; archive.md the expired ones", () => {
    const offers = [
      offer(1, { verified_date: "2026-09-30" }),
      offer(2, { verified_date: "2026-09-29" }),
      offer(3, { status: "expired", verified_date: "2026-09-28" }),
    ];
    const { distDir, read } = runGenerator({ offers });
    try {
      const index = read("index.md");
      expect(index).toContain("# Free AI Credits");
      expect(index).toContain("## Trust labels");
      const lines = index.split("\n").filter((l) => l.startsWith("- ["));
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        // Twins link to the .md sibling, keeping agents in markdown-land.
        expect(line).toMatch(/\]\(https:\/\/freetokens\.custats\.info\/offers\/test-offer-\d\.md\)/);
        expect(line).toMatch(/review_status=\S+/);
        expect(line).toMatch(/verification=\S+/);
        expect(line).toMatch(/signup=\S+/);
        expect(line).toMatch(/last_checked=\d{4}-\d{2}-\d{2}/);
      }
      expect(index).toContain("test-offer-1.md");
      expect(index).not.toContain("test-offer-3");

      const archive = read("archive.md");
      expect(archive).toContain("test-offer-3.md");
      expect(archive).not.toContain("test-offer-1");
    } finally {
      rmSync(path.dirname(distDir), { recursive: true, force: true });
    }
  });

  it("offer twins carry the facts rail fields plus details.json content", () => {
    const details = {
      "test-offer-1": {
        summary: "A detailed summary of the offer.",
        claim_steps: ["Register an account", "Claim the credit"],
        social_proof: [
          {
            type: "link",
            url: "https://example.com/pricing",
            title: "Pricing page",
            text: "Official pricing mention.",
          },
        ],
      },
    };
    const { distDir, read } = runGenerator({ offers: [offer(1)], details });
    try {
      const twin = read("offers/test-offer-1.md");
      expect(twin).toContain("# Test Offer 1");
      expect(twin).toContain("- Provider: TestCo");
      expect(twin).toContain("- Amount: $11 free credits");
      expect(twin).toContain("- Category: API providers (`api_provider`)");
      expect(twin).toContain(
        "- Last checked: 2026-09-25 — review_status=under-review · verification=social_proof · signup=required",
      );
      expect(twin).toContain("- Source: https://example.com/free");
      expect(twin).toContain(
        `- Page: ${BASE}/offers/test-offer-1.html`,
      );
      expect(twin).toContain("## The offer\n\nA detailed summary");
      expect(twin).toContain("## How to claim\n\n1. Register an account\n2. Claim the credit");
      expect(twin).toContain(
        "[Pricing page](https://example.com/pricing) — Official pricing mention.",
      );
      // The twin points back at its canonical page and the catalog index.
      expect(twin).toContain(`Markdown twin of ${BASE}/offers/test-offer-1.html`);
      expect(twin).toContain(`${BASE}/llms.txt`);
    } finally {
      rmSync(path.dirname(distDir), { recursive: true, force: true });
    }
  });

  it("suppresses claim steps on expired offers, like the page does", () => {
    const details = {
      "test-offer-1": { claim_steps: ["Do not claim — expired"] },
    };
    const { distDir, read } = runGenerator({
      offers: [offer(1, { status: "expired" })],
      details,
    });
    try {
      const twin = read("offers/test-offer-1.md");
      expect(twin).toContain("- Status: expired");
      expect(twin).not.toContain("## How to claim");
      expect(twin).not.toContain("Do not claim");
    } finally {
      rmSync(path.dirname(distDir), { recursive: true, force: true });
    }
  });
});

describe("generate-markdown prose conversion (#524)", () => {
  it("converts prerendered <main> to markdown: headings, lists, links, emphasis", () => {
    const { distDir, read } = runGenerator({ offers: [offer(1)] });
    try {
      const about = read("about.md");
      // The page's own h1 is the document title — exactly once.
      expect(about.match(/^# About Free AI Credits$/gm)).toHaveLength(1);
      expect(about).toContain("## What this is");
      expect(about).toContain("- First *point*");
      expect(about).toContain(
        "- Second point with [a link](https://example.com/x)",
      );
      // Relative hrefs resolve against the page's absolute URL.
      expect(about).toContain(`[archive link](${BASE}/archive.html)`);
      expect(about).toContain("`inline code`");
      // Entities decode; the entity never leaks through raw.
      expect(about).toContain("entities · like this");
      expect(about).not.toContain("&middot;");
      expect(about).not.toContain("&amp;");
      // Site chrome and interactive/noise elements are dropped.
      expect(about).not.toContain("site-nav");
      expect(about).not.toContain("free ai credits · about"); // kicker
      expect(about).not.toContain("Export");
      expect(about).not.toContain("BreadcrumbList");
      expect(about).not.toMatch(/<[a-z]+[ >]/);

      const privacy = read("privacy.md");
      expect(privacy).toContain("# Privacy Policy");
      expect(privacy).toContain("1. Ordered one\n2. Ordered two");
      expect(privacy).toContain("`ft_ga_consent`");
      // `hidden` elements never reach the twin.
      expect(privacy).not.toContain("Hidden draft");
    } finally {
      rmSync(path.dirname(distDir), { recursive: true, force: true });
    }
  });

  it("skips prose twins gracefully when their dist HTML is absent", () => {
    const { distDir, read } = runGenerator({
      offers: [offer(1)],
      withPages: false,
    });
    try {
      expect(read("about.md")).toBeNull();
      expect(read("privacy.md")).toBeNull();
      // Data twins still emit — prose extraction is best-effort only.
      expect(read("index.md")).not.toBeNull();
      expect(read("offers/test-offer-1.md")).not.toBeNull();
    } finally {
      rmSync(path.dirname(distDir), { recursive: true, force: true });
    }
  });
});

// #526: the RFC 8288 relations GitHub Pages cannot send as Link: headers ship
// in-band (<link rel> in every head) and in the portable _headers file for a
// future edge host (ADR-0003's contract). These pin both forms.
describe("RFC 8288 discovery relations (#526)", () => {
  it("index.html carries describedby / service-desc / service-doc link elements", () => {
    const html = readFileSync(path.join(APP_ROOT, "index.html"), "utf8");
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toMatch(/<link[^>]*rel="describedby"[^>]*href="\.\/llms\.txt"/);
    expect(head).toMatch(
      /<link[^>]*rel="service-desc"[^>]*href="\.\/llms-full\.txt"/,
    );
    expect(head).toMatch(/<link[^>]*rel="service-doc"[^>]*href="\.\/about\.html"/);
  });

  it("_headers declares the Link header equivalents and .md content type", () => {
    const headers = readFileSync(
      path.join(APP_ROOT, "public", "_headers"),
      "utf8",
    );
    const linkLine = headers
      .split("\n")
      .find((l) => l.trim().startsWith("Link:"));
    expect(linkLine).toBeTruthy();
    expect(linkLine).toContain('rel="describedby"');
    expect(linkLine).toContain('rel="service-desc"');
    expect(linkLine).toContain('rel="service-doc"');
    expect(linkLine).toContain('rel="alternate"');
    expect(linkLine).toContain("</index.md>");
    expect(linkLine).toContain("</llms.txt>");
    // Markdown twins get an explicit content type on _headers-aware hosts.
    expect(headers).toMatch(
      /\/\*\.md\n\s+Content-Type: text\/markdown; charset=utf-8/,
    );
  });
});

describe("markdown twin category labels", () => {
  it("names the oss_program category OSS program", () => {
    const { distDir, read } = runGenerator({
      offers: [offer(1, { category: "oss_program" })],
    });
    try {
      const twin = read("offers/test-offer-1.md");
      expect(twin).toContain("- Category: OSS program (`oss_program`)");
    } finally {
      rmSync(path.dirname(distDir), { recursive: true, force: true });
    }
  });
});
