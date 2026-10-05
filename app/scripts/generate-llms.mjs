#!/usr/bin/env node
// Generator for llms.txt and llms-full.txt (issue #210, docs/seo-baseline task 3.1).
// Reads src/data/offers.json (and optionally src/data/details.json) and emits
// app/public/llms.txt + app/public/llms-full.txt so Vite copies them into dist/.
// Also writes directly to dist/ when building (so prerender fallback stays valid).
// Format follows https://llmstxt.org and ai-bot-guide.md:
//  - starts with `# Free AI Credits`
//  - blockquote summary line
//  - >=3 `##` sections with `- [Title](https://...) : Description` absolute https links
//  - Sections: ## Trust labels / ## Offers / ## Pages / ## Feed
//  - Offers: top 20 active offers sorted by verified_date desc (newest first) — qualifies as updatedAt ordering;
//    every entry ends with the offer's review status, evidence level, sign-up need and last-checked date (#509),
//    defined once in `## Trust labels` from scripts/trust-vocabulary.mjs
//  - Pages: home / archive / about / privacy / llms-full.txt absolute URLs
//  - Feed: feed.xml (and sitemap) absolute URLs
//  - llms-full.txt concatenates >=50% offer summaries and stays <200KB.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Trust wording has ONE home (issues #507/#509): the same module the site's
// badges, hover text and hover-free legend read, so a short AI summary can
// never drop a qualification the UI states.
import {
  ENROLLMENT_DEADLINE_NOTE,
  LAST_CHECKED,
  TRUST_SUMMARY,
  TRUST_VERB_MAP,
  trustDefinitions,
  trustFieldPairs,
  trustFields,
} from "./trust-vocabulary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE_URL = "https://freetokens.custats.info";

let baseUrl = DEFAULT_BASE_URL;
let dataFile = path.join(here, "..", "src", "data", "offers.json");
let detailsFile = path.join(here, "..", "src", "data", "details.json");
let publicDir = path.join(here, "..", "public");
let distDir = path.join(here, "..", "dist");

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--base-url" && process.argv[i + 1])
    baseUrl = process.argv[++i];
  else if (process.argv[i] === "--data" && process.argv[i + 1])
    dataFile = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--details" && process.argv[i + 1])
    detailsFile = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--public-dir" && process.argv[i + 1])
    publicDir = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--dist" && process.argv[i + 1])
    distDir = path.resolve(process.argv[++i]);
}

baseUrl = baseUrl.replace(/\/+$/, "");
if (!existsSync(dataFile)) {
  console.error(
    `generate-llms: data file not found: ${dataFile} (run npm run load:data first)`,
  );
  process.exit(1);
}
const index = JSON.parse(await readFile(dataFile, "utf8"));
const details = existsSync(detailsFile)
  ? JSON.parse(await readFile(detailsFile, "utf8"))
  : {};

// Active offers only, sorted newest verified_date first with slug tiebreak (mirrors feed.mjs and load-offers ordering)
const activeOffers = index.offers
  .filter((o) => o.status !== "expired")
  .sort((a, b) => {
    if (a.verified_date === b.verified_date) return a.slug < b.slug ? 1 : -1;
    return a.verified_date < b.verified_date ? 1 : -1;
  });
const top20 = activeOffers.slice(0, 20);

function offerDescription(offer) {
  // Keep short but trailing description after colon satisfies audit requiring ": Description".
  // The trust fields are appended, not summarised away (issue #509): a short
  // AI summary that drops "to-be-verified" tells a consumer more than the
  // listing supports, which is exactly the qualification loss T6 found.
  const amount = offer.amount.replace(/\s+/g, " ").trim();
  const provider = offer.provider;
  const category = offer.category;
  return `${provider} — ${amount} (${category}) · ${trustFields(offer)}`;
}

/**
 * The `## Trust labels` section: the same definitions the site's hover-free
 * legend renders, written as `field=value` so a machine can map each emitted
 * value back to the YAML schema and a reader gets the meaning in plain words.
 */
function buildTrustLabelLines() {
  const lines = [];
  lines.push("## Trust labels");
  lines.push("");
  lines.push(TRUST_SUMMARY);
  lines.push("");
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

function buildLlmsTxt() {
  const lines = [];
  lines.push("# Free AI Credits");
  lines.push("");
  lines.push(
    "> Every currently-claimable free AI credit offer, labeled with review status, evidence level, and sign-up need, on one fast page. Curated from official provider sources and refreshed at build time.",
  );
  lines.push("");
  lines.push(...buildTrustLabelLines());
  lines.push("## Offers");
  lines.push("");
  lines.push(
    `Top ${top20.length} currently active offers (newest checked first) from ${activeOffers.length} active listings. Every line ends with the offer's own review status, evidence level, sign-up need and last-checked date. Full directory at ${baseUrl}/.`,
  );
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
  lines.push(
    `- [Home](${baseUrl}/): Browse all currently active free AI credit offers, filterable by category and searchable — the site's main listing.`,
  );
  lines.push(
    `- [Archive](${baseUrl}/archive.html): Reference archive of expired free AI credit offers, newest-expired first with original terms.`,
  );
  lines.push(
    `- [About](${baseUrl}/about.html): What the site is, how listings are reviewed and checked, and what the numbers mean.`,
  );
  lines.push(
    `- [Privacy Policy](${baseUrl}/privacy.html): How the site handles data — consent-gated anonymized analytics, no forms, no personal data storage.`,
  );
  lines.push(
    `- [Full export](${baseUrl}/llms-full.txt): the long-form companion to this file — every active offer with its summary, claim steps, source and detail links and the same trust fields, plus the build date and any truncation.`,
  );
  lines.push("");
  lines.push("## Feed");
  lines.push("");
  lines.push(
    `- [RSS Feed](${baseUrl}/feed.xml): RSS 2.0 feed of active offers (newest checked first), updated on each build — subscribe for new free credit listings.`,
  );
  lines.push(
    `- [Sitemap](${baseUrl}/sitemap.xml): XML sitemap listing all index, archive, privacy and offer detail pages for crawlers.`,
  );
  lines.push("");
  return lines.join("\n");
}

function buildFullHeader(emittedCount) {
  const lines = [];
  const generatedAt = index.generated_at ?? new Date().toISOString();
  const total = activeOffers.length;
  lines.push("# Free AI Credits — Full Content");
  lines.push("");
  lines.push(
    "> Complete set of active free AI credit offers with summaries, claim context and source links — concatenated for LLM ingestion (Claude Code / Cursor). Generated at build time from src/data/offers.json and src/data/details.json.",
  );
  lines.push("");
  lines.push(
    emittedCount === total
      ? `Source: ${baseUrl}/ — generated ${generatedAt} — ${total} active offers.`
      : `Source: ${baseUrl}/ — generated ${generatedAt} — ${emittedCount} of ${total} active offers (truncated to stay under the 200KB llms-full budget; full directory at ${baseUrl}/).`,
  );
  lines.push("");
  lines.push(
    `Trust fields: review_status, verification, signup, last_checked — the same schema values the short index defines at ${baseUrl}/llms.txt. ${ENROLLMENT_DEADLINE_NOTE}`,
  );
  lines.push("");
  lines.push("## Offers (full)");
  lines.push("");
  return lines.join("\n");
}

function buildOfferBlock(offer) {
  const url = `${baseUrl}/offers/${offer.slug}.html`;
  const detail = details[offer.slug];
  const summary = detail?.summary
    ? String(detail.summary).trim().replace(/\s+/g, " ")
    : "";
  const description = summary || `${offer.amount} from ${offer.provider}.`;
  const lines = [];
  lines.push(`### ${offer.title}`);
  lines.push(`- Provider: ${offer.provider}`);
  lines.push(`- Category: ${offer.category}`);
  lines.push(`- Amount: ${offer.amount}`);
  lines.push(
    `- Status: ${offer.status} — enrollment deadline: ${offer.expiry_date ?? "none (ongoing)"}`,
  );
  // The checked date is labelled "Last checked", never "Verified" (issue #507):
  // the old label claimed a review verdict for an entry whose review_status
  // may be to-be-verified or under-review, which is precisely what the export
  // must not do.
  lines.push(
    `- ${LAST_CHECKED.label}: ${offer.verified_date} — ${trustFieldPairs(offer).join(" · ")}`,
  );
  lines.push(`- Source: ${offer.source_url}`);
  lines.push(`- Page: ${url}`);
  if (summary) lines.push(`- Summary: ${summary}`);
  else lines.push(`- Summary: ${description}`);
  if (detail?.claim_steps?.length) {
    lines.push(`- Claim steps: ${detail.claim_steps.join(" | ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildFullFooter() {
  const lines = [];
  lines.push("## Pages");
  lines.push("");
  lines.push(`- [Home](${baseUrl}/): Main listing of active offers.`);
  lines.push(`- [Archive](${baseUrl}/archive.html): Expired offers archive.`);
  lines.push(
    `- [About](${baseUrl}/about.html): About the site — methodology and trust labels.`,
  );
  lines.push(`- [Privacy Policy](${baseUrl}/privacy.html): Privacy policy.`);
  lines.push(`- [RSS Feed](${baseUrl}/feed.xml): RSS feed of active offers.`);
  lines.push(`- [Sitemap](${baseUrl}/sitemap.xml): XML sitemap.`);
  lines.push("");
  return lines.join("\n");
}

const llmsTxt = buildLlmsTxt();

// Enforce <200KB budget for llms-full.txt by dropping whole trailing offer
// entries — never slice mid-entry or lose the Pages/Feed footer (issue: PR
// #475 review). The header reports the emitted count honestly when truncated.
const MAX_FULL_BYTES = 200 * 1024;
const offerBlocks = activeOffers.map(buildOfferBlock);
const fullFooter = buildFullFooter();
const assembleFull = (emitted) =>
  buildFullHeader(emitted) + offerBlocks.slice(0, emitted).join("") + fullFooter;
let emittedFull = activeOffers.length;
while (
  emittedFull > 0 &&
  Buffer.byteLength(assembleFull(emittedFull), "utf8") >= MAX_FULL_BYTES
) {
  emittedFull--;
}
const llmsFullTxt = assembleFull(emittedFull);
const fullBytes = Buffer.byteLength(llmsFullTxt, "utf8");

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
    `and llms-full.txt (${(fullBytes / 1024).toFixed(1)} KB, ${emittedFull}${emittedFull < activeOffers.length ? ` of ${activeOffers.length}` : ""} offers) -> ${publicDir}` +
    (existsSync(distDir) ? ` + ${distDir}` : ""),
);
