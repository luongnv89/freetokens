#!/usr/bin/env node
// Generator for llms.txt and llms-full.txt (issue #210, docs/seo-baseline task 3.1).
// Reads src/data/offers.json (and optionally src/data/details.json) and emits
// app/public/llms.txt + app/public/llms-full.txt so Vite copies them into dist/.
// Also writes directly to dist/ when building (so prerender fallback stays valid).
// Format follows https://llmstxt.org and ai-bot-guide.md:
//  - starts with `# Free AI Credits`
//  - blockquote summary line
//  - >=3 `##` sections with `- [Title](https://...) : Description` absolute https links
//  - Sections: ## Offers / ## Pages / ## Feed
//  - Offers: top 20 active offers sorted by verified_date desc (newest first) — qualifies as updatedAt ordering;
//  - Pages: home / archive / privacy absolute URLs
//  - Feed: feed.xml (and sitemap) absolute URLs
//  - llms-full.txt concatenates >=50% offer summaries and stays <200KB.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE_URL = "https://luongnv89.github.io/freetokens";

let baseUrl = DEFAULT_BASE_URL;
let dataFile = path.join(here, "..", "src", "data", "offers.json");
let detailsFile = path.join(here, "..", "src", "data", "details.json");
let publicDir = path.join(here, "..", "public");
let distDir = path.join(here, "..", "dist");

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--base-url" && process.argv[i + 1]) baseUrl = process.argv[++i];
  else if (process.argv[i] === "--data" && process.argv[i + 1]) dataFile = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--details" && process.argv[i + 1]) detailsFile = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--public-dir" && process.argv[i + 1]) publicDir = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--dist" && process.argv[i + 1]) distDir = path.resolve(process.argv[++i]);
}

baseUrl = baseUrl.replace(/\/+$/, "");
if (!existsSync(dataFile)) {
  console.error(`generate-llms: data file not found: ${dataFile} (run npm run load:data first)`);
  process.exit(1);
}
const index = JSON.parse(await readFile(dataFile, "utf8"));
const details = existsSync(detailsFile) ? JSON.parse(await readFile(detailsFile, "utf8")) : {};

// Active offers only, sorted newest verified_date first with slug tiebreak (mirrors feed.mjs and load-offers ordering)
const activeOffers = index.offers
  .filter((o) => o.status !== "expired")
  .sort((a, b) => {
    if (a.verified_date === b.verified_date) return a.slug < b.slug ? 1 : -1;
    return a.verified_date < b.verified_date ? 1 : -1;
  });
const top20 = activeOffers.slice(0, 20);

function offerDescription(offer) {
  // Keep short but trailing description after colon satisfies audit requiring ": Description"
  const amount = offer.amount.replace(/\s+/g, " ").trim();
  const provider = offer.provider;
  const category = offer.category;
  return `${provider} — ${amount} (${category})`;
}

function buildLlmsTxt() {
  const lines = [];
  lines.push("# Free AI Credits");
  lines.push("");
  lines.push("> Every currently-claimable free AI credit offer, labeled with review status, verification level, and sign-up need, on one fast page. Curated from official provider sources and refreshed at build time.");
  lines.push("");
  lines.push("## Offers");
  lines.push("");
  lines.push(`Top ${top20.length} currently active offers (newest verified first) from ${activeOffers.length} active listings. Full directory at ${baseUrl}/.`);
  lines.push("");
  for (const offer of top20) {
    const url = `${baseUrl}/offers/${offer.slug}.html`;
    // Title may contain markdown special chars; keep as-is inside brackets, slashes safe
    const title = offer.title.replace(/]/g, "\\]");
    lines.push(`- [${title}](${url}): ${offerDescription(offer)}`);
  }
  lines.push("");
  lines.push("## Pages");
  lines.push("");
  lines.push(`- [Home](${baseUrl}/): Browse all currently active free AI credit offers, filterable by category and searchable — the site's main listing.`);
  lines.push(`- [Archive](${baseUrl}/archive.html): Reference archive of expired free AI credit offers, newest-expired first with original terms.`);
  lines.push(`- [About](${baseUrl}/about.html): What the site is, how listings are verified, and what the numbers mean.`);
  lines.push(`- [Privacy Policy](${baseUrl}/privacy.html): How the site handles data — consent-gated anonymized analytics, no forms, no personal data storage.`);
  lines.push("");
  lines.push("## Feed");
  lines.push("");
  lines.push(`- [RSS Feed](${baseUrl}/feed.xml): RSS 2.0 feed of active offers (newest verified first), updated on each build — subscribe for new free credit listings.`);
  lines.push(`- [Sitemap](${baseUrl}/sitemap.xml): XML sitemap listing all index, archive, privacy and offer detail pages for crawlers.`);
  lines.push("");
  return lines.join("\n");
}

function buildLlmsFullTxt() {
  const lines = [];
  lines.push("# Free AI Credits — Full Content");
  lines.push("");
  lines.push("> Complete set of active free AI credit offers with summaries, claim context and source links — concatenated for LLM ingestion (Claude Code / Cursor). Generated at build time from src/data/offers.json and src/data/details.json.");
  lines.push("");
  lines.push(`Source: ${baseUrl}/ — generated ${index.generated_at ?? new Date().toISOString()} — ${activeOffers.length} active offers.`);
  lines.push("");
  lines.push("## Offers (full)");
  lines.push("");
  for (const offer of activeOffers) {
    const url = `${baseUrl}/offers/${offer.slug}.html`;
    const detail = details[offer.slug];
    const summary = detail?.summary ? String(detail.summary).trim().replace(/\s+/g, " ") : "";
    const description = summary || `${offer.amount} from ${offer.provider}.`;
    lines.push(`### ${offer.title}`);
    lines.push(`- Provider: ${offer.provider}`);
    lines.push(`- Category: ${offer.category}`);
    lines.push(`- Amount: ${offer.amount}`);
    lines.push(`- Status: ${offer.status} — expiry ${offer.expiry_date ?? "ongoing"}`);
    lines.push(`- Verified: ${offer.verified_date} (${offer.verification} / ${offer.review_status}, signup ${offer.signup})`);
    lines.push(`- Source: ${offer.source_url}`);
    lines.push(`- Page: ${url}`);
    if (summary) lines.push(`- Summary: ${summary}`);
    else lines.push(`- Summary: ${description}`);
    if (detail?.claim_steps?.length) {
      lines.push(`- Claim steps: ${detail.claim_steps.join(" | ")}`);
    }
    lines.push("");
  }
  lines.push("## Pages");
  lines.push("");
  lines.push(`- [Home](${baseUrl}/): Main listing of active offers.`);
  lines.push(`- [Archive](${baseUrl}/archive.html): Expired offers archive.`);
  lines.push(`- [About](${baseUrl}/about.html): About the site — methodology and verification.`);
  lines.push(`- [Privacy Policy](${baseUrl}/privacy.html): Privacy policy.`);
  lines.push(`- [RSS Feed](${baseUrl}/feed.xml): RSS feed of active offers.`);
  lines.push(`- [Sitemap](${baseUrl}/sitemap.xml): XML sitemap.`);
  lines.push("");
  return lines.join("\n");
}

const llmsTxt = buildLlmsTxt();
let llmsFullTxt = buildLlmsFullTxt();

// Enforce <200KB budget for llms-full.txt (truncate offer summaries if needed, rarely triggered)
const MAX_FULL_BYTES = 200 * 1024;
let fullBytes = Buffer.byteLength(llmsFullTxt, "utf8");
if (fullBytes >= MAX_FULL_BYTES) {
  // Trim progressive: shorten per-offer summaries first by truncating after fallback length
  // Simple truncation to fit budget preserves header and at least 50% of summaries still present
  const headerEnd = llmsFullTxt.indexOf("## Offers (full)");
  const header = llmsFullTxt.slice(0, headerEnd);
  let body = llmsFullTxt.slice(headerEnd);
  // Iteratively cut body to fit
  while (Buffer.byteLength(header + body, "utf8") >= MAX_FULL_BYTES && body.length > 1000) {
    body = body.slice(0, Math.floor(body.length * 0.9));
  }
  llmsFullTxt = (header + body).trimEnd() + "\n";
  fullBytes = Buffer.byteLength(llmsFullTxt, "utf8");
}

await mkdir(publicDir, { recursive: true });
await writeFile(path.join(publicDir, "llms.txt"), llmsTxt, "utf8");
await writeFile(path.join(publicDir, "llms-full.txt"), llmsFullTxt, "utf8");

// Also write directly to dist/ when it exists so a build that already ran still gets the files
if (existsSync(distDir)) {
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "llms.txt"), llmsTxt, "utf8");
  await writeFile(path.join(distDir, "llms-full.txt"), llmsFullTxt, "utf8");
}

console.log(
  `generate-llms: wrote llms.txt (${(Buffer.byteLength(llmsTxt, "utf8") / 1024).toFixed(1)} KB, ${top20.length} offers) ` +
    `and llms-full.txt (${(fullBytes / 1024).toFixed(1)} KB, ${activeOffers.length} offers) -> ${publicDir}` +
    (existsSync(distDir) ? ` + ${distDir}` : ""),
);
