#!/usr/bin/env node
// Build-time data pipeline (tasks.md Task 1.4, epic #114): reads offers/*.yaml
// and offers/details/*.json and emits the JSON artifacts the React app
// consumes. YAML stays the source of truth; this script never writes there.
//
// Semantics mirror scripts/build.py exactly: same flat-YAML subset, same
// validation error messages, same build-time `status` computation (ADR 0001 —
// expiry is evaluated against the BUILD clock, never a client clock), same
// newest-verified-first order, same index.json wrapper shape.
//
// Usage: node scripts/load-offers.mjs [--offers-dir ../offers] [--out src/data]

import { readdir, readFile, writeFile, mkdir, rm, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ArtifactSchemaError,
  validateIndexData,
  validateJsonlText,
} from "./validate-artifacts.mjs";

const REQUIRED_FIELDS = [
  "title",
  "provider",
  "category",
  "amount",
  "expiry_date",
  "source_url",
  "verified_date",
  "verification",
  "signup",
];
const CATEGORIES = ["api_provider", "coding", "image", "voice", "video", "startup_program"];
const VERIFICATION_LEVELS = ["hand_verified", "social_proof", "unverified"];
const SIGNUP_MODES = ["none", "required"];
const NULL_TOKENS = new Set(["null", "~", ""]);
const DETAILS_DIRNAME = "details";

export class OfferError extends Error {}

function parseScalar(raw) {
  const value = raw.trim();
  if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
    return value.slice(1, -1);
  }
  if (NULL_TOKENS.has(value.toLowerCase())) return null;
  return value;
}

export function parseOfferText(text, filename) {
  const data = {};
  text.split(/\r?\n/).forEach((line, i) => {
    const lineno = i + 1;
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) return;
    if (line.startsWith(" ") || line.startsWith("\t")) {
      throw new OfferError(
        `${filename}:${lineno}: nested/indented lines are not allowed ` +
          "(offer files are flat key/value documents)",
      );
    }
    const sep = line.indexOf(":");
    if (sep === -1) {
      throw new OfferError(`${filename}:${lineno}: expected 'key: value'`);
    }
    const key = line.slice(0, sep).trim();
    if (!key || key.includes(" ")) {
      throw new OfferError(`${filename}:${lineno}: invalid field name ${JSON.stringify(key)}`);
    }
    if (key in data) {
      throw new OfferError(`${filename}:${lineno}: duplicate field ${JSON.stringify(key)}`);
    }
    data[key] = parseScalar(line.slice(sep + 1));
  });
  return data;
}

function parseDate(value, field, filename) {
  if (typeof value !== "string") {
    throw new OfferError(
      `${filename}: ${field} must be a YYYY-MM-DD date, got ${JSON.stringify(value)} ` +
        "(this field is not nullable)",
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OfferError(
      `${filename}: ${field} must be a YYYY-MM-DD date, got ${JSON.stringify(value)}`,
    );
  }
  const day = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) {
    throw new OfferError(
      `${filename}: ${field} must be a YYYY-MM-DD date, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export function validateOffer(data, filename, today) {
  const missing = REQUIRED_FIELDS.filter((f) => !(f in data));
  if (missing.length) {
    throw new OfferError(`${filename}: missing required fields: ${missing.join(", ")}`);
  }
  const unknown = Object.keys(data).filter((k) => !REQUIRED_FIELDS.includes(k));
  if (unknown.length) {
    throw new OfferError(`${filename}: unknown fields: ${unknown.sort().join(", ")}`);
  }

  for (const field of ["title", "provider", "amount"]) {
    if (typeof data[field] !== "string" || !data[field].trim()) {
      throw new OfferError(`${filename}: ${field} must be a non-empty string`);
    }
  }

  if (!CATEGORIES.includes(data.category)) {
    throw new OfferError(
      `${filename}: category must be one of ${CATEGORIES.join("|")}, got ${JSON.stringify(data.category)}`,
    );
  }
  if (!VERIFICATION_LEVELS.includes(data.verification)) {
    throw new OfferError(
      `${filename}: verification must be one of ${VERIFICATION_LEVELS.join("|")}, got ${JSON.stringify(data.verification)}`,
    );
  }
  if (!SIGNUP_MODES.includes(data.signup)) {
    throw new OfferError(
      `${filename}: signup must be one of ${SIGNUP_MODES.join("|")}, got ${JSON.stringify(data.signup)}`,
    );
  }

  if (data.expiry_date !== null) {
    data.expiry_date = parseDate(data.expiry_date, "expiry_date", filename);
  }
  data.verified_date = parseDate(data.verified_date, "verified_date", filename);
  if (data.verified_date > today) {
    throw new OfferError(
      `${filename}: verified_date is in the future (${data.verified_date})`,
    );
  }

  const url = data.source_url;
  if (typeof url !== "string" || !(url.startsWith("http://") || url.startsWith("https://"))) {
    throw new OfferError(
      `${filename}: source_url must be an http(s) URL, got ${JSON.stringify(url)}`,
    );
  }
  return data;
}

export function isExpired(offer, today) {
  // Null expiry means ongoing and never expires; expiring *today* is active.
  return offer.expiry_date !== null && offer.expiry_date < today;
}

export function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export async function loadOffers(offersDir, today = todayISO()) {
  // Recurse into subdirectories (e.g. offers/archive/) so archived offers
  // are loaded alongside live ones.
  const entries = await readdir(offersDir);
  // Identify subdirectories (skip ., .., and details/)
  const subdirs = [];
  for (const f of entries) {
    if (f === "." || f === ".." || f === DETAILS_DIRNAME) continue;
    const st = await lstat(path.join(offersDir, f));
    if (st.isDirectory()) subdirs.push(f);
  }
  const candidates = [
    ...entries
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map((f) => ({ dir: offersDir, name: f })),
    ...(await Promise.all(
      subdirs.map(async (subdir) => {
        const subEntries = await readdir(path.join(offersDir, subdir));
        return subEntries
          .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
          .map((f) => ({ dir: path.join(offersDir, subdir), name: f }));
      }),
    )).flat(),
  ];
  const offers = [];
  for (const { dir, name } of candidates) {
    const full = path.join(dir, name);
    const slug = name.replace(/\.(yaml|yml)$/, "");
    const data = parseOfferText(await readFile(full, "utf8"), full);
    const offer = validateOffer(data, full, today);
    offer.slug = slug;
    offers.push(offer);
  }
  const seen = new Set();
  for (const offer of offers) {
    if (seen.has(offer.slug)) {
      throw new OfferError(
        `duplicate slug ${JSON.stringify(offer.slug)}: rename one file so every offers/*.yaml slug is unique`,
      );
    }
    seen.add(offer.slug);
  }
  return offers;
}

export async function loadDetails(offersDir, validSlugs) {
  const detailsDir = path.join(offersDir, DETAILS_DIRNAME);
  const details = {};
  if (!existsSync(detailsDir)) return details;
  // Collect detail files from the root details/ and any subdirectories
  const entries = await readdir(detailsDir);
  const subdirs = [];
  for (const f of entries) {
    if (f === "." || f === "..") continue;
    const st = await lstat(path.join(detailsDir, f));
    if (st.isDirectory()) subdirs.push(f);
  }
  const paths = [
    ...entries
      .filter((f) => f.endsWith(".json") && !subdirs.includes(f))
      .map((f) => ({ dir: detailsDir, name: f })),
    ...(await Promise.all(
      subdirs.map(async (subdir) => {
        const subEntries = await readdir(path.join(detailsDir, subdir));
        return subEntries
          .filter((f) => f.endsWith(".json"))
          .map((f) => ({ dir: path.join(detailsDir, subdir), name: f }));
      }),
    )).flat(),
  ];
  for (const { dir, name } of paths) {
    const full = path.join(dir, name);
    const slug = name.replace(/\.json$/, "");
    if (!validSlugs.includes(slug)) {
      throw new OfferError(
        `${full}: no offer named ${JSON.stringify(slug)}; delete this detail file or fix its file name`,
      );
    }
    try {
      details[slug] = JSON.parse(await readFile(full, "utf8"));
    } catch (exc) {
      throw new OfferError(`${full}: invalid JSON (${exc.message})`);
    }
  }
  return details;
}

export function buildIndex(offers, now = new Date()) {
  // Default order (#70): newest-verified first, ties by slug ascending.
  const stamped = [...offers]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .sort((a, b) => (a.verified_date < b.verified_date ? 1 : a.verified_date > b.verified_date ? -1 : 0))
    .map((offer) => ({
      ...offer,
      status: isExpired(offer, todayISO(now)) ? "expired" : "active",
    }));
  return {
    generated_at: now.toISOString().replace(/\.\d+Z$/, "Z"),
    count: stamped.length,
    active_count: stamped.filter((o) => o.status === "active").length,
    expired_count: stamped.filter((o) => o.status === "expired").length,
    offers: stamped.map((o) => ({
      slug: o.slug,
      title: o.title,
      provider: o.provider,
      category: o.category,
      amount: o.amount,
      expiry_date: o.expiry_date,
      source_url: o.source_url,
      verified_date: o.verified_date,
      verification: o.verification,
      signup: o.signup,
      status: o.status,
    })),
  };
}

export async function runPipeline({ offersDir, outDir, now = new Date() }) {
  const today = todayISO(now);
  const offers = await loadOffers(offersDir, today);
  const index = buildIndex(offers, now);
  const details = await loadDetails(
    offersDir,
    offers.map((o) => o.slug),
  );

  await rm(outDir, { recursive: true, force: true });
  const detailsOut = path.join(outDir, DETAILS_DIRNAME);
  await mkdir(detailsOut, { recursive: true });
  await writeFile(path.join(outDir, "offers.json"), `${JSON.stringify(index, null, 2)}\n`);
  await writeFile(
    path.join(outDir, "offers.jsonl"),
    index.offers.map((o) => JSON.stringify(o)).join("\n") + "\n",
  );
  for (const [slug, detail] of Object.entries(details)) {
    // Detail JSON passes through unchanged — it is already validated content.
    await writeFile(path.join(detailsOut, `${slug}.json`), `${JSON.stringify(detail, null, 2)}\n`);
  }
  // Single slug-keyed map so Vite and prerender's esbuild can both import
  // one JSON module (issue #128). import.meta.glob is Vite-only and would
  // fail the prerender bundle.
  await writeFile(path.join(outDir, "details.json"), `${JSON.stringify(details, null, 2)}\n`);

  await validateWrittenArtifacts(outDir);
  return index;
}

// Data-contract gate (#120): the pipeline validates its OWN OUTPUT against
// schemas/offers-index.schema.json by reading the artifacts back off disk —
// a loader regression fails the build naming artifact and field instead of
// silently shipping a malformed index.
export async function validateWrittenArtifacts(outDir) {
  try {
    const written = JSON.parse(await readFile(path.join(outDir, "offers.json"), "utf8"));
    validateIndexData(written, path.join(outDir, "offers.json"));
    const jsonl = await readFile(path.join(outDir, "offers.jsonl"), "utf8");
    const lines = validateJsonlText(jsonl, path.join(outDir, "offers.jsonl"));
    if (lines !== written.count || written.offers.length !== written.count) {
      throw new ArtifactSchemaError(
        `${path.join(outDir, "offers.json")}: count is ${written.count} but there are ` +
          `${written.offers.length} offers / ${lines} JSONL lines`,
      );
    }
  } catch (exc) {
    if (exc instanceof ArtifactSchemaError) throw new OfferError(exc.message);
    throw exc;
  }
}

async function main(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let offersDir = path.join(here, "..", "..", "offers");
  let outDir = path.join(here, "..", "src", "data");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--offers-dir") offersDir = argv[++i];
    else if (argv[i] === "--out") outDir = argv[++i];
  }
  const started = Date.now();
  const index = await runPipeline({ offersDir, outDir });
  console.log(
    `loaded ${index.count} offers (${index.active_count} active, ${index.expired_count} expired)` +
      ` -> ${path.join(outDir, "offers.json")}, offers.jsonl, details.json, details/*.json in ${Date.now() - started}ms`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}
