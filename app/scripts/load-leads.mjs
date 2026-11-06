// Unverified leads (#660): reads unverified/*.yaml and returns the list the
// Unverified page renders. Mirrors scripts/lead_model.py, the CI content gate,
// check for check: both load the same safety and freshness rules from
// schemas/unverified-lead.rules.json, so a lead the gate would reject also
// fails the build (fail closed) instead of reaching the page.
//
// Leads are NEVER offers: they go to src/data/unverified.json only, never
// into offers.json / index.json / llms*.txt / offer detail pages. A lead is
// listed only while its newest dated source post is at most `fresh_days` (3)
// days old against the build clock; older ones are hidden here, the same
// build-time rule the catalog uses for expiry (ADR 0001).

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const RULES = JSON.parse(
  readFileSync(
    path.join(here, "..", "..", "schemas", "unverified-lead.rules.json"),
    "utf8",
  ),
);

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
const SOURCE_KEYS = ["url", "type", "author", "handle", "date"];
export const FRESH_DAYS = RULES.fresh_days;
// Every rendered text field gets the domain and wording checks (F6); only
// the fields quoting the post are barred from carrying a full link.
const TEXT_FIELDS = [
  "provider",
  "title",
  "claim",
  "amount_claimed",
  "reason_detail",
];
const CLAIM_FIELDS = ["title", "claim", "amount_claimed"];
// No u flag: \b and case folding stay ASCII, matching Python's re.ASCII (F4).
const joined = (list) => list.map((p) => `(?:${p})`).join("|");
const UNSAFE_RE = new RegExp(joined(RULES.unsafe_claim_patterns), "i");
const PAYMENT_RE = new RegExp(joined(RULES.payment_patterns), "gi");
const NEGATION_RE = new RegExp(RULES.negation_pattern, "i");
const NEGATION_WORD_RE = new RegExp(RULES.negation_word_pattern, "i");
const LINK_CUE_RE = new RegExp(RULES.link_cue_pattern, "i");
const AUTHORITY_RE = new RegExp(RULES.url_authority_pattern, "i");
const NON_DOMAIN = new Set(RULES.non_domain_suffixes);
const SECOND_LEVEL = new Set(RULES.second_level_suffixes);
const PRODUCT_DOMAINS = new Set(RULES.product_domains);

/** NFKC-normalise before matching, as lead_model.nfkc does. */
export const nfkc = (text) => String(text ?? "").normalize("NFKC");

/** Last two labels, or three under a known second-level suffix (co.uk). */
export function registrable(host) {
  const labels = host.toLowerCase().replace(/^\.+|\.+$/g, "").split(".");
  if (labels.length >= 3 && SECOND_LEVEL.has(labels.slice(-2).join("."))) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

/** One day ahead of `today` (YYYY-MM-DD): the same timezone slack offers get (F5). */
function tomorrowOf(today) {
  return new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export class LeadError extends Error {}

const on = (host, hosts) =>
  hosts.some((h) => host === h || host.endsWith(`.${h}`));
const stripWww = (host) => (host.startsWith("www.") ? host.slice(4) : host);

/**
 * Host of a plain https URL, or null. Same subset as lead_model.url_host:
 * no userinfo, port, backslash or whitespace, and the WHATWG parser must
 * agree with the literal authority, so a link can never render to a host
 * the gate did not check.
 */
export function urlHost(url) {
  if (typeof url !== "string" || url.length > 500) return null;
  if (/[^\x21-\x7e]/.test(url) || url.includes("\\")) return null;
  const match = AUTHORITY_RE.exec(url);
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (
    !host.includes(".") ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    host.includes("..")
  ) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== host ||
    parsed.port !== "" ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }
  return stripWww(host);
}

/** Mirrors lead_model.foreign_domains: registrable-domain comparison. */
export function foreignDomains(text, officialHosts) {
  const value = nfkc(text);
  const allowed = new Set(officialHosts.map(registrable));
  const found = [];
  const re = new RegExp(RULES.domain_pattern, "gi");
  for (const match of value.matchAll(re)) {
    const start = match.index + match[0].indexOf(match[1]);
    const end = start + match[1].length;
    if (start > 0 && value[start - 1] === ".") continue;
    const raw = match[1].toLowerCase();
    const token = stripWww(raw);
    const tld = token.split(".").pop();
    if (NON_DOMAIN.has(tld) || allowed.has(registrable(token))) continue;
    const linked =
      raw !== token ||
      value[end] === "/" ||
      value.slice(Math.max(0, start - 3), start) === "://" ||
      LINK_CUE_RE.test(value.slice(Math.max(0, start - 20), start));
    if (PRODUCT_DOMAINS.has(token) && !linked) continue;
    found.push(token);
  }
  return found;
}

/** Mirrors lead_model.unsafe_wording: payment wording only when not negated. */
export function unsafeWording(text) {
  const value = nfkc(text);
  const match = UNSAFE_RE.exec(value);
  if (match) return match[0];
  for (const pay of value.matchAll(PAYMENT_RE)) {
    if (
      !NEGATION_RE.test(value.slice(0, pay.index)) &&
      !NEGATION_WORD_RE.test(pay[0])
    ) {
      return pay[0];
    }
  }
  return null;
}

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

/** Newest dated source post (YYYY-MM-DD), or null when every source is undated. */
export function newestPost(lead) {
  const dates = (lead.sources ?? []).map((s) => s?.date).filter(Boolean);
  return dates.length ? dates.sort().at(-1) : null;
}

export function validateLead(data, filename, today) {
  const fail = (msg) => {
    throw new LeadError(`${filename}: ${msg}`);
  };
  const missing = LEAD_FIELDS.filter((f) => !(f in data));
  if (missing.length) fail(`missing required field(s): ${missing.join(", ")}`);
  const extra = Object.keys(data).filter((k) => !LEAD_FIELDS.includes(k));
  if (extra.length) fail(`unknown field(s): ${extra.join(", ")}`);
  for (const f of ["slug", "provider", "title", "claim", "reason_detail"]) {
    if (!isText(data[f])) fail(`${f} must be a non-empty string`);
  }
  if (data.amount_claimed !== null && !isText(data.amount_claimed)) {
    fail("amount_claimed must be a non-empty string or null");
  }
  if (path.basename(filename).replace(/\.yaml$/, "") !== data.slug) {
    fail("slug must match the file name");
  }
  for (const f of ["first_seen", "last_seen"]) {
    if (!isDate(data[f])) fail(`${f} must be a YYYY-MM-DD date`);
  }
  if (data.first_seen > data.last_seen) fail("first_seen is after last_seen");
  const latest = today ? tomorrowOf(today) : null;
  if (latest && data.last_seen > latest) fail("last_seen is in the future");
  if (!LEAD_REASONS.includes(data.reason)) {
    fail(`reason must be one of ${LEAD_REASONS.join(", ")}`);
  }

  const officialHosts = [];
  if (!Array.isArray(data.official_urls_tried) || !data.official_urls_tried.length) {
    fail("official_urls_tried must list at least one official URL");
  }
  data.official_urls_tried.forEach((url, i) => {
    const host = urlHost(url);
    if (!host) fail(`official_urls_tried[${i}] must be a plain https URL`);
    if (on(host, RULES.shortener_hosts) || on(host, RULES.form_hosts)) {
      fail(`official_urls_tried[${i}] is a link shortener or form`);
    }
    if (on(host, RULES.social_hosts)) {
      fail(`official_urls_tried[${i}] is a social site, not an official page`);
    }
    officialHosts.push(host);
  });

  if (!Array.isArray(data.sources) || data.sources.length === 0) {
    fail("sources must list at least one public post or page");
  }
  const seen = new Set();
  data.sources.forEach((s, i) => {
    const label = `sources[${i}]`;
    if (
      !s ||
      typeof s !== "object" ||
      Object.keys(s).sort().join() !== [...SOURCE_KEYS].sort().join()
    ) {
      fail(`${label} must have exactly the keys ${SOURCE_KEYS.join(", ")}`);
    }
    const host = urlHost(s.url);
    if (!host) fail(`${label}.url must be a plain https URL`);
    if (on(host, RULES.shortener_hosts) || on(host, RULES.form_hosts)) {
      fail(`${label}.url is a link shortener or form (unsafe claim path)`);
    }
    if (!SOURCE_TYPES.includes(s.type)) fail(`${label}.type must be x|reddit|web`);
    if (
      (s.type === "x") !== on(host, RULES.x_hosts) ||
      (s.type === "reddit") !== on(host, RULES.reddit_hosts)
    ) {
      fail(`${label}.type ${s.type} does not match host ${host}`);
    }
    if (s.date !== null && !isDate(s.date)) fail(`${label}.date must be YYYY-MM-DD or null`);
    if (latest && s.date && s.date > latest) fail(`${label}.date is in the future`);
    if (seen.has(s.url)) fail(`${label}.url is listed twice`);
    seen.add(s.url);
  });
  if (!newestPost(data)) fail("undated source: at least one source needs a post date");

  for (const f of TEXT_FIELDS) {
    const value = data[f];
    if (!value) continue;
    const domains = foreignDomains(value, officialHosts);
    if (domains.length) fail(`${f} names ${domains[0]}, not the provider's own domain`);
    if (CLAIM_FIELDS.includes(f) && /https?:\/\//i.test(nfkc(value))) {
      fail(`${f} carries a link (unsafe claim path)`);
    }
    const bad = unsafeWording(value);
    if (bad) fail(`${f} asks for a DM, a form, a secret, or payment details (${bad})`);
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
    posted: newestPost(data),
    first_seen: data.first_seen,
    last_seen: data.last_seen,
    reason: data.reason,
    reason_detail: data.reason_detail,
    official_urls_tried: [...data.official_urls_tried],
  };
}

/** True once `today` is past the newest post + FRESH_DAYS (undated = stale). */
export function isStaleLead(lead, today) {
  const posted = newestPost(lead);
  if (!posted) return true;
  const days =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${posted}T00:00:00Z`)) /
    86_400_000;
  return days > FRESH_DAYS;
}

/** Newest post first, then most recently checked, then slug. */
export function sortLeads(leads) {
  return [...leads].sort(
    (a, b) =>
      b.posted.localeCompare(a.posted) ||
      b.last_seen.localeCompare(a.last_seen) ||
      a.slug.localeCompare(b.slug),
  );
}

/**
 * Load every lead under `leadsDir`. A missing or empty folder is an empty
 * list. Any non-.yaml file, an invalid lead, or a lead whose slug names an
 * offer fails the build.
 */
export async function loadLeads(leadsDir, today, offerSlugs = []) {
  if (!existsSync(leadsDir)) return [];
  const taken = new Set(offerSlugs);
  const leads = [];
  for (const file of (await readdir(leadsDir)).sort()) {
    const filename = path.join(leadsDir, file);
    if (!file.endsWith(".yaml") || !(await stat(filename)).isFile()) {
      throw new LeadError(`${filename}: unexpected file; leads are <slug>.yaml files only`);
    }
    const lead = validateLead(
      parseLeadText(await readFile(filename, "utf8"), filename),
      filename,
      today,
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
