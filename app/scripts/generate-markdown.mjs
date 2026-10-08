#!/usr/bin/env node
// Per-route markdown twins (issues #524 + #526, agent-ready plan tasks 1.1/1.3).
//
// The isitagentready `markdownNegotiation` check wants `Accept: text/markdown`
// to return a markdown body, and `linkHeaders` wants RFC 8288 `Link:` response
// headers. GitHub Pages can do neither — it serves one fixed HTML document to
// every client and has no header mechanism at all (ADR-0003 hit the same wall
// for CSP). The in-repo approximation this script ships:
//
//   * one `<page>.md` twin next to every prerendered route
//     (index.md, archive.md, about.md, privacy.md, offers/<slug>.md)
//   * prerender.mjs stamps <link rel="alternate" type="text/markdown"> pointing
//     at that twin, so agents discover it without negotiation
//   * app/public/_headers carries the equivalent Link: header + a
//     Content-Type: text/markdown rule for the day an edge front serves dist/
//
// Twin sources, so the markdown can never drift from what the page renders:
//   * index.md / archive.md / offers/<slug>.md — generated from offers.json +
//     details.json, the same data the routes render.
//   * about.md / privacy.md — converted from the route's own prerendered
//     <main> markup in dist/, so the twin tracks the JSX copy instead of
//     duplicating it.
//
// Usage: node scripts/generate-markdown.mjs [--data src/data/offers.json]
//        [--details src/data/details.json] [--dist dist]
//        [--base-url https://...]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Same vocabulary module as generate-llms.mjs and the UI legend: trust fields
// must read identically on every surface (#507/#509).
import {
  ENROLLMENT_DEADLINE_NOTE,
  LAST_CHECKED,
  TRUST_SUMMARY,
  TRUST_VERB_MAP,
  trustDefinitions,
  trustFieldPairs,
  trustFields,
} from "./trust-vocabulary.mjs";
// Category display labels, mirrored from src/lib/offers.ts exactly like
// feed.mjs does — Node scripts cannot import the TS module.
const CATEGORY_LABELS = {
  api_provider: "API providers",
  coding: "Coding",
  image: "Image",
  voice: "Voice",
  video: "Video",
  startup_program: "Startup programs",
  student: "Student",
  oss_program: "OSS program",
};

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE_URL = "https://freetokens.custats.info";

let baseUrl = DEFAULT_BASE_URL;
let dataFile = path.join(here, "..", "src", "data", "offers.json");
let detailsFile = path.join(here, "..", "src", "data", "details.json");
let distDir = path.join(here, "..", "dist");

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--base-url" && process.argv[i + 1])
    baseUrl = process.argv[++i];
  else if (process.argv[i] === "--data" && process.argv[i + 1])
    dataFile = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--details" && process.argv[i + 1])
    detailsFile = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--dist" && process.argv[i + 1])
    distDir = path.resolve(process.argv[++i]);
}

baseUrl = baseUrl.replace(/\/+$/, "");

if (!existsSync(dataFile)) {
  console.error(
    `generate-markdown: data file not found: ${dataFile} (run npm run load:data first)`,
  );
  process.exit(1);
}
const index = JSON.parse(await readFile(dataFile, "utf8"));
const details = existsSync(detailsFile)
  ? JSON.parse(await readFile(detailsFile, "utf8"))
  : {};

const activeOffers = index.offers
  .filter((o) => o.status !== "expired")
  .sort((a, b) => {
    if (a.verified_date === b.verified_date) return a.slug < b.slug ? 1 : -1;
    return a.verified_date < b.verified_date ? 1 : -1;
  });
const expiredOffers = index.offers
  .filter((o) => o.status === "expired")
  .sort((a, b) => {
    if (a.verified_date === b.verified_date) return a.slug < b.slug ? 1 : -1;
    return a.verified_date < b.verified_date ? 1 : -1;
  });

function mdLink(title, url) {
  // `]` inside link text ends the bracket pair early — escape like llms does.
  return `[${String(title).replace(/]/g, "\\]")}](${url})`;
}

function offerLine(offer) {
  const amount = offer.amount.replace(/\s+/g, " ").trim();
  // Link to the twin, not the HTML page, so an agent that followed rel=
  // alternate keeps reading markdown for free.
  return (
    `- ${mdLink(offer.title, `${baseUrl}/offers/${offer.slug}.md`)}: ` +
    `${offer.provider} — ${amount} (${offer.category}) · ${trustFields(offer)}`
  );
}

function buildTrustLabelLines() {
  const lines = ["## Trust labels", "", TRUST_SUMMARY, ""];
  lines.push(`In one line: ${TRUST_VERB_MAP}.`);
  lines.push("");
  for (const group of trustDefinitions()) {
    lines.push(`**${group.name}** (\`${group.field}\`) — ${group.question}`);
    lines.push("");
    for (const entry of group.entries) {
      lines.push(
        `- \`${group.field}=${entry.value}\` — ${entry.label}: ${entry.definition} ${entry.claim}`.trim(),
      );
    }
    lines.push("");
  }
  lines.push(
    `**${LAST_CHECKED.label}** (\`last_checked\`) — ${LAST_CHECKED.definition} ${ENROLLMENT_DEADLINE_NOTE}`,
  );
  lines.push("");
  return lines;
}

function twinFooter(pagePath) {
  return (
    `---\n\n` +
    `Markdown twin of ${baseUrl}${pagePath} (served for offline/agent reading; ` +
    `the HTML page is the canonical representation).\n\n` +
    `- Catalog index: ${mdLink("llms.txt", `${baseUrl}/llms.txt`)}\n` +
    `- Full export: ${mdLink("llms-full.txt", `${baseUrl}/llms-full.txt`)}\n` +
    `- RSS: ${mdLink("feed.xml", `${baseUrl}/feed.xml`)} · ` +
    `Sitemap: ${mdLink("sitemap.xml", `${baseUrl}/sitemap.xml`)}\n` +
    `- Pages: ${mdLink("Home", `${baseUrl}/index.md`)} · ` +
    `${mdLink("Archive", `${baseUrl}/archive.md`)} · ` +
    `${mdLink("About", `${baseUrl}/about.md`)} · ` +
    `${mdLink("Privacy", `${baseUrl}/privacy.md`)}\n`
  );
}

function buildHomeMarkdown() {
  const lines = [];
  lines.push("# Free AI Credits");
  lines.push("");
  lines.push(
    "> Every currently-claimable free AI credit offer, labeled with review status, evidence level, and sign-up need, on one fast page.",
  );
  lines.push("");
  lines.push(
    `${activeOffers.length} live offers · ${expiredOffers.length} expired in the archive · rebuilt ${index.generated_at ?? "at build time"}.`,
  );
  lines.push("");
  lines.push("## Offers");
  lines.push("");
  for (const offer of activeOffers) lines.push(offerLine(offer));
  lines.push("");
  lines.push(...buildTrustLabelLines());
  lines.push(twinFooter("/"));
  return lines.join("\n");
}

function buildArchiveMarkdown() {
  const lines = [];
  lines.push("# Offer Archive · Free AI Credits");
  lines.push("");
  lines.push(
    "> Reference archive of expired free AI credit offers, kept newest-first with their original terms. Nothing here is claimable.",
  );
  lines.push("");
  lines.push(`${expiredOffers.length} expired listings.`);
  lines.push("");
  for (const offer of expiredOffers) lines.push(offerLine(offer));
  lines.push("");
  lines.push(twinFooter("/archive.html"));
  return lines.join("\n");
}

function buildOfferMarkdown(offer) {
  const detail = details[offer.slug];
  const pageUrl = `${baseUrl}/offers/${offer.slug}.html`;
  const lines = [];
  lines.push(`# ${offer.title}`);
  lines.push("");
  lines.push(`**${offer.provider}** — ${offer.amount}`);
  lines.push("");
  lines.push("## Details");
  lines.push("");
  lines.push(`- Provider: ${offer.provider}`);
  lines.push(`- Amount: ${offer.amount}`);
  lines.push(
    `- Category: ${CATEGORY_LABELS[offer.category] ?? offer.category} (\`${offer.category}\`)`,
  );
  lines.push(
    `- Status: ${offer.status} — enrollment deadline: ${offer.expiry_date ?? "none (ongoing)"}`,
  );
  // Same one-line convention as llms-full.txt (#507/#509): the checked date
  // is labelled, never promoted to "verified", and the three axes ride with it.
  lines.push(
    `- ${LAST_CHECKED.label}: ${offer.verified_date} — ${trustFieldPairs(offer).join(" · ")}`,
  );
  lines.push(`- Source: ${offer.source_url}`);
  lines.push(`- Page: ${pageUrl}`);
  lines.push("");
  const summary = detail?.summary ? String(detail.summary).trim() : "";
  if (summary) {
    lines.push("## The offer");
    lines.push("");
    lines.push(summary.replace(/\s+/g, " "));
    lines.push("");
  }
  if (offer.status !== "expired" && detail?.claim_steps?.length) {
    lines.push("## How to claim");
    lines.push("");
    detail.claim_steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
    lines.push("");
  }
  if (detail?.social_proof?.length) {
    lines.push("## Social proof");
    lines.push("");
    for (const proof of detail.social_proof) {
      const label = proof.title || proof.url;
      const text = proof.text ? ` — ${proof.text}` : "";
      lines.push(`- ${mdLink(label, proof.url)}${text}`);
    }
    lines.push("");
  }
  const related = index.offers
    .filter((o) => o.category === offer.category && o.slug !== offer.slug)
    .sort((a, b) => b.verified_date.localeCompare(a.verified_date))
    .slice(0, 4);
  if (related.length) {
    const label = CATEGORY_LABELS[offer.category] ?? offer.category;
    lines.push(`## More in ${label}`);
    lines.push("");
    for (const o of related) lines.push(offerLine(o));
    lines.push("");
  }
  lines.push(`Trust fields are defined at ${baseUrl}/llms.txt.`);
  lines.push("");
  lines.push(twinFooter(`/offers/${offer.slug}.html`));
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* HTML → markdown for the prose pages (about.html, privacy.html).       */
/*                                                                      */
/* Scoped converter, not a general one: it only has to survive the       */
/* markup our own components emit inside <main>. Site chrome (header,    */
/* nav, breadcrumbs, stats strips, controls) is dropped by tag, class    */
/* or attribute; the rest maps onto headings, paragraphs, lists, links   */
/* and inline emphasis. Unknown elements degrade to their text — never  */
/* to raw tags in the output.                                           */
/* ------------------------------------------------------------------ */

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Interactive/embedded chrome that carries no prose worth twinning.
const DROP_TAGS = new Set([
  "script",
  "style",
  "svg",
  "nav",
  "button",
  "input",
  "select",
  "textarea",
  "form",
  "noscript",
  "template",
  "iframe",
  "video",
  "audio",
  "canvas",
]);

// Site chrome identified by class (the whole subtree goes).
const DROP_CLASSES = new Set([
  "site-header",
  "site-stats",
  "stat-strip",
  "breadcrumbs",
  "toolbar",
  "hot-deals",
  "custats-banner",
  "tag-sprite",
  "kicker",
]);

const HEADING_DEPTH = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  mdash: "—",
  ndash: "–",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  times: "×",
  copy: "©",
  reg: "®",
  trade: "™",
  sect: "§",
  deg: "°",
  laquo: "«",
  raquo: "»",
  bull: "•",
  dagger: "†",
};

export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

const TOKEN_RE =
  /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
const ATTR_RE =
  /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(raw) {
  const attrs = {};
  for (const m of raw.matchAll(ATTR_RE)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** Tiny DOM-lite tree for one HTML fragment. */
function parseFragment(html) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  for (const m of html.matchAll(TOKEN_RE)) {
    if (m[1] === undefined && m[3] === undefined) continue; // comment/doctype
    if (m[3] !== undefined) {
      stack[stack.length - 1].children.push({ text: m[3] });
      continue;
    }
    const token = m[0];
    const tag = m[1].toLowerCase();
    const parent = stack[stack.length - 1];
    if (token.startsWith("</")) {
      // Close the nearest matching open element; ignore stray closers.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const node = { tag, attrs: parseAttrs(m[2] ?? ""), children: [] };
    parent.children.push(node);
    const selfClosing =
      token.endsWith("/>") || VOID_TAGS.has(tag) || tag.startsWith("!");
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function classList(node) {
  return (node.attrs.class ?? "").split(/\s+/).filter(Boolean);
}

function isDropped(node) {
  if (DROP_TAGS.has(node.tag)) return true;
  if ("hidden" in node.attrs) return true;
  if (node.attrs["aria-hidden"] === "true") return true;
  return classList(node).some((c) => DROP_CLASSES.has(c));
}

function resolveHref(href, pageUrl) {
  const value = decodeEntities(href).trim();
  if (!value || value.startsWith("#") || /^(javascript|data):/i.test(value))
    return null;
  try {
    return new URL(value, pageUrl).href;
  } catch {
    return null;
  }
}

function inline(children, pageUrl) {
  let out = "";
  for (const node of children) {
    if (node.text !== undefined) {
      out += decodeEntities(node.text);
      continue;
    }
    if (isDropped(node)) continue;
    const inner = inline(node.children, pageUrl);
    switch (node.tag) {
      case "a": {
        const href = resolveHref(node.attrs.href ?? "", pageUrl);
        const text = inner.trim();
        out += href && text ? `[${text}](${href})` : inner;
        break;
      }
      case "strong":
      case "b":
        out += inner.trim() ? `**${inner.trim()}**` : "";
        break;
      case "em":
      case "i":
        out += inner.trim() ? `*${inner.trim()}*` : "";
        break;
      case "code":
      case "kbd":
      case "samp":
      case "tt": {
        const text = inner.trim().replace(/`/g, "\\`");
        out += text ? `\`${text}\`` : "";
        break;
      }
      case "img": {
        const alt = decodeEntities(node.attrs.alt ?? "").trim();
        const src = resolveHref(node.attrs.src ?? "", pageUrl);
        if (alt && src) out += `![${alt}](${src})`;
        break;
      }
      case "br":
        out += "  \n";
        break;
      default:
        out += inner;
    }
  }
  // Collapse horizontal whitespace; newlines inside blocks are meaningful.
  return out.replace(/[^\S\n]+/g, " ");
}

/**
 * Render a parsed fragment to markdown. `indent`/`ordered` carry list state;
 * every block ends with the blank line that separates it from the next.
 */
function renderBlocks(children, pageUrl, listDepth = 0) {
  const blocks = [];
  const push = (text) => {
    const clean = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    if (clean.trim()) blocks.push(clean.trim());
  };
  for (const node of children) {
    if (node.text !== undefined) {
      const text = decodeEntities(node.text).replace(/\s+/g, " ").trim();
      if (text) push(text);
      continue;
    }
    if (isDropped(node)) continue;
    const tag = node.tag;
    if (HEADING_DEPTH[tag]) {
      push(`${"#".repeat(HEADING_DEPTH[tag])} ${inline(node.children, pageUrl).trim()}`);
      continue;
    }
    switch (tag) {
      case "p":
      case "figure":
      case "figcaption":
      case "caption":
      case "summary":
      case "dt":
      case "dd":
        push(inline(node.children, pageUrl));
        break;
      case "ul":
      case "ol": {
        let counter = 0;
        const items = [];
        for (const child of node.children) {
          if (child.text !== undefined || child.tag !== "li") continue;
          counter += 1;
          const marker = tag === "ol" ? `${counter}.` : "-";
          // Inline-only items render as one line; block children (nested
          // lists, paragraphs) go through the block renderer and indent.
          const hasBlockChild = child.children.some(
            (c) =>
              c.text === undefined &&
              /^(ul|ol|p|div|section|article|blockquote|table|pre|details|figure|dl|h[1-6])$/.test(
                c.tag,
              ),
          );
          const body = hasBlockChild
            ? renderBlocks(child.children, pageUrl, listDepth + 1).replace(
                /\n\n+/g,
                "\n",
              )
            : inline(child.children, pageUrl).trim();
          const prefix = "  ".repeat(listDepth) + marker + " ";
          items.push(
            body.replace(/^/gm, (m, off) =>
              off === 0 ? prefix : "  ".repeat(listDepth) + "  ",
            ),
          );
        }
        if (items.length) push(items.join("\n"));
        break;
      }
      case "li":
        // Stray <li> outside a list: treat as a bullet rather than dropping it.
        push("- " + inline(node.children, pageUrl).trim());
        break;
      case "blockquote":
        push(
          renderBlocks(node.children, pageUrl, listDepth)
            .split("\n")
            .map((l) => (l ? `> ${l}` : ">"))
            .join("\n"),
        );
        break;
      case "pre": {
        // <pre><code> nests the code element — collect text at any depth.
        const collectText = (nodes) =>
          nodes
            .map((c) =>
              c.text !== undefined ? decodeEntities(c.text) : collectText(c.children),
            )
            .join("");
        push("```\n" + collectText(node.children).replace(/\n$/, "") + "\n```");
        break;
      }
      case "table": {
        // No pipe-table layout needed for the prose pages — render each row
        // as `cell — cell — cell` so the data survives as text. Rows may sit
        // under thead/tbody/tfoot wrappers; collect tr at any depth.
        const rows = [];
        const collectRows = (nodes) => {
          for (const n of nodes) {
            if (n.text !== undefined || isDropped(n)) continue;
            if (n.tag === "tr") rows.push(n);
            else collectRows(n.children);
          }
        };
        collectRows(node.children);
        const lines = [];
        for (const tr of rows) {
          const cells = [];
          for (const cell of tr.children) {
            if (cell.text !== undefined) continue;
            if (!/^t[dh]$/.test(cell.tag)) continue;
            cells.push(inline(cell.children, pageUrl).trim());
          }
          if (cells.length) lines.push(cells.join(" — "));
        }
        if (lines.length) push(lines.join("\n"));
        break;
      }
      case "hr":
        push("---");
        break;
      case "details": {
        const parts = renderBlocks(node.children, pageUrl, listDepth);
        push(parts);
        break;
      }
      default:
        // div/section/article/main/header/footer/aside/dl/… — transparent
        // block containers: recurse and keep their children as blocks.
        push(renderBlocks(node.children, pageUrl, listDepth));
    }
  }
  return blocks.filter(Boolean).join("\n\n");
}

/**
 * Markdown twin for a prerendered prose page: take the route's <main>,
 * convert, and frame it as a document. Returns null when dist has no page.
 */
async function buildPageMarkdown(htmlFile, title, pagePath) {
  const file = path.join(distDir, htmlFile);
  if (!existsSync(file)) {
    console.warn(
      `generate-markdown: ${htmlFile} not found in ${distDir}; skipping its twin`,
    );
    return null;
  }
  const html = await readFile(file, "utf8");
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/);
  const fragment = mainMatch ? mainMatch[1] : html;
  const body = renderBlocks(
    parseFragment(fragment).children,
    `${baseUrl}/${pagePath}`,
  );
  const lines = [];
  // The page's own <h1> is the document title — only synthesize one when the
  // conversion produced nothing (a missing or empty main), never duplicating.
  if (body.trim()) lines.push(body, "");
  else lines.push(`# ${title}`, "");
  lines.push(twinFooter(`/${pagePath}`));
  return lines.join("\n");
}

/* ------------------------------ emit ------------------------------- */

const written = [];

async function emit(relativePath, markdown) {
  if (markdown == null) return;
  const target = path.join(distDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, markdown, "utf8");
  written.push(relativePath);
}

if (!existsSync(distDir)) {
  console.error(
    `generate-markdown: dist directory not found: ${distDir} (run vite build + prerender first)`,
  );
  process.exit(1);
}

await emit("index.md", buildHomeMarkdown());
await emit("archive.md", buildArchiveMarkdown());
await emit(
  "about.md",
  await buildPageMarkdown("about.html", "About Free AI Credits", "about.html"),
);
await emit(
  "privacy.md",
  await buildPageMarkdown(
    "privacy.html",
    "Privacy Policy · Free AI Credits",
    "privacy.html",
  ),
);
for (const offer of index.offers) {
  await emit(`offers/${offer.slug}.md`, buildOfferMarkdown(offer));
}

console.log(
  `generate-markdown: wrote ${written.length} markdown twins -> ${distDir} ` +
    `(index, archive, about, privacy + ${index.offers.length} offer pages)`,
);
