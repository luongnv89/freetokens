// Unverified leads (#660): reads unverified/*.yaml and returns the list the
// Unverified page renders. Mirrors scripts/lead_model.py — that Python
// validator is the content gate (CI `validate`); this loader re-checks the
// shape it relies on so a malformed file fails the build naming file+field.
//
// Leads are NEVER offers: they go to src/data/unverified.json only, never
// into offers.json / index.json / llms*.txt / offer detail pages. A lead last
// seen more than STALE_DAYS days before the build is dropped here, the same
// build-clock rule the catalog uses for expiry (ADR 0001).

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const LEAD_FIELDS = [
  "slug",
  "provider",
  "title",
  "claim",
  "amount_claimed",
  "sources",
  "first_seen",
  "last_seen",
  "reason",
  "reason_detail",
  "official_urls_tried",
];
export const LEAD_REASONS = [
  "bot_walled",
  "official_silent",
  "no_amount",
  "single_source",
  "other",
];
const SOURCE_TYPES = ["x", "reddit", "web"];
export const STALE_DAYS = 30;

export class LeadError extends Error {}

function parseValue(raw, filename, lineno) {
  const value = raw.trim();
  if (["null", "~", ""].includes(value.toLowerCase())) return null;
  if ('["{'.includes(value[0])) {
    try {
      return JSON.parse(value);
    } catch (err) {
      throw new LeadError(`${filename}:${lineno}: invalid JSON value (${err.message})`);
    }
  }
  if (value.length >= 2 && value[0] === "'" && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

export function parseLeadText(text, filename) {
  const data = {};
  text.split(/\r?\n/).forEach((line, i) => {
    const lineno = i + 1;
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) return;
    if (line.startsWith(" ") || line.startsWith("\t")) {
      throw new LeadError(`${filename}:${lineno}: nested/indented lines are not allowed`);
    }
    const sep = line.indexOf(":");
    const key = sep === -1 ? "" : line.slice(0, sep).trim();
    if (!key || key.includes(" ")) {
      throw new LeadError(`${filename}:${lineno}: expected 'key: value'`);
    }
    if (key in data) {
      throw new LeadError(`${filename}:${lineno}: duplicate field ${JSON.stringify(key)}`);
    }
    data[key] = parseValue(line.slice(sep + 1), filename, lineno);
  });
  return data;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v) =>
  typeof v === "string" &&
  DATE_RE.test(v) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isText = (v) => typeof v === "string" && v.trim().length > 0;
const isHttps = (v) => {
  try {
    return typeof v === "string" && new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

export function validateLead(data, filename) {
  const missing = LEAD_FIELDS.filter((f) => !(f in data));
  if (missing.length) {
    throw new LeadError(`${filename}: missing required field(s): ${missing.join(", ")}`);
  }
  const extra = Object.keys(data).filter((k) => !LEAD_FIELDS.includes(k));
  if (extra.length) {
    throw new LeadError(`${filename}: unknown field(s): ${extra.join(", ")}`);
  }
  for (const f of ["slug", "provider", "title", "claim", "reason_detail"]) {
    if (!isText(data[f])) throw new LeadError(`${filename}: ${f} must be a non-empty string`);
  }
  if (data.amount_claimed !== null && !isText(data.amount_claimed)) {
    throw new LeadError(`${filename}: amount_claimed must be a non-empty string or null`);
  }
  if (path.basename(filename).replace(/\.ya?ml$/, "") !== data.slug) {
    throw new LeadError(`${filename}: slug must match the file name`);
  }
  for (const f of ["first_seen", "last_seen"]) {
    if (!isDate(data[f])) throw new LeadError(`${filename}: ${f} must be a YYYY-MM-DD date`);
  }
  if (!LEAD_REASONS.includes(data.reason)) {
    throw new LeadError(`${filename}: reason must be one of ${LEAD_REASONS.join(", ")}`);
  }
  if (!Array.isArray(data.sources) || data.sources.length === 0) {
    throw new LeadError(`${filename}: sources must list at least one public post or page`);
  }
  data.sources.forEach((s, i) => {
    if (!s || !isHttps(s.url) || !SOURCE_TYPES.includes(s.type)) {
      throw new LeadError(`${filename}: sources[${i}] needs an https url and type x|reddit|web`);
    }
    if (s.date !== null && !isDate(s.date)) {
      throw new LeadError(`${filename}: sources[${i}].date must be YYYY-MM-DD or null`);
    }
  });
  if (
    !Array.isArray(data.official_urls_tried) ||
    data.official_urls_tried.length === 0 ||
    !data.official_urls_tried.every(isHttps)
  ) {
    throw new LeadError(`${filename}: official_urls_tried must list https URLs`);
  }
  return {
    slug: data.slug,
    provider: data.provider,
    title: data.title,
    claim: data.claim,
    amount_claimed: data.amount_claimed,
    sources: data.sources.map((s) => ({
      url: s.url,
      type: s.type,
      author: s.author ?? null,
      handle: s.handle ?? null,
      date: s.date ?? null,
    })),
    first_seen: data.first_seen,
    last_seen: data.last_seen,
    reason: data.reason,
    reason_detail: data.reason_detail,
  };
}

/** True once last_seen is more than STALE_DAYS days before `today`. */
export function isStaleLead(lead, today) {
  const days =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lead.last_seen}T00:00:00Z`)) /
    86_400_000;
  return days > STALE_DAYS;
}

/** Newest last_seen first, then newest first_seen, then slug. */
export function sortLeads(leads) {
  return [...leads].sort(
    (a, b) =>
      b.last_seen.localeCompare(a.last_seen) ||
      b.first_seen.localeCompare(a.first_seen) ||
      a.slug.localeCompare(b.slug),
  );
}

/**
 * Load every lead under `leadsDir`. A missing folder is an empty list. A lead
 * whose slug names an offer fails: publishing a lead removes its file.
 */
export async function loadLeads(leadsDir, today, offerSlugs = []) {
  if (!existsSync(leadsDir)) return [];
  const taken = new Set(offerSlugs);
  const files = (await readdir(leadsDir))
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
  const leads = [];
  for (const file of files) {
    const filename = path.join(leadsDir, file);
    const lead = validateLead(
      parseLeadText(await readFile(filename, "utf8"), filename),
      filename,
    );
    if (taken.has(lead.slug)) {
      throw new LeadError(`${filename}: slug ${lead.slug} is also an offer`);
    }
    if (!isStaleLead(lead, today)) leads.push(lead);
  }
  return sortLeads(leads);
}

export function defaultLeadsDir(offersDir) {
  return path.join(offersDir, "..", "unverified");
}
