// Deals (#809): reads deals/*.yaml and returns the running deals for the
// `deals` section of offers.json / index.json. Mirrors scripts/deal_model.py,
// the CI content gate: both read schemas/deal.schema.json (fields, enums) and
// schemas/deal.rules.json (free wording), so a file the gate rejects also
// fails the build.
//
// A deal is a DISCOUNT on a paid product, never a free offer. Deals live in
// their own folder (the offer loader reads every subfolder of offers/), go to
// index.deals only — never index.offers, offers.jsonl, counts, search, the
// feed or offer pages — and each entry is marked kind: "deal". A deal is
// listed from its start_date (when set) through its expiry_date and hidden
// outside that span, judged against the BUILD clock like offer expiry
// (ADR 0001); nothing filters on the client.

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS = path.join(here, "..", "..", "schemas");
const SCHEMA = JSON.parse(
  readFileSync(path.join(SCHEMAS, "deal.schema.json"), "utf8"),
);
export const RULES = JSON.parse(
  readFileSync(path.join(SCHEMAS, "deal.rules.json"), "utf8"),
);

export const REQUIRED_FIELDS = SCHEMA.required;
export const FIELDS = Object.keys(SCHEMA.properties);
export const DEAL_CATEGORIES = SCHEMA.properties.category.enum;
export const OCCASIONS = SCHEMA.properties.occasion.enum;
// Optional flags (#815) from the rules file; every other field is a string.
export const BOOLEAN_FIELDS = RULES.boolean_fields;
const STRING_FIELDS = FIELDS.filter((f) => !BOOLEAN_FIELDS.includes(f));
// The flat YAML subset parses every value as a string: only the bare tokens
// true / false (or an already-parsed boolean) are booleans, as in deal_model.py.
const BOOLEAN_TOKENS = { true: true, false: false };
const asBoolean = (value) =>
  typeof value === "boolean"
    ? value
    : typeof value === "string" && Object.hasOwn(BOOLEAN_TOKENS, value)
      ? BOOLEAN_TOKENS[value]
      : undefined;
// No u flag: \b stays ASCII, matching Python's re.ASCII. Whitespace is the
// explicit {space} class from the rules file, never \s (JavaScript's \s is
// Unicode-wide, Python's re.ASCII \s is not), so both match the same strings.
const FREE_RE = new RegExp(
  RULES.free_wording_pattern.replaceAll("{space}", RULES.free_wording_space),
  "i",
);
const PROMO_FREE_RE = new RegExp(RULES.promo_code_free_pattern, "i");
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PROMO_RE = /^[A-Za-z0-9_-]{1,40}$/;
const NULL_TOKENS = new Set(["null", "~", ""]);

// Length in Unicode code points, as Python's len() and JSON Schema maxLength
// count it; String#length counts UTF-16 units, so an emoji would count twice.
const codePointLength = (value) => [...value].length;

export class DealError extends Error {}

/** Same flat key/value subset as offers/*.yaml (scripts/offer_model.py). */
export function parseDealText(text, filename) {
  const data = {};
  text.split(/\r?\n/).forEach((line, i) => {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) return;
    if (line.startsWith(" ") || line.startsWith("\t")) {
      throw new DealError(`${filename}:${i + 1}: nested/indented lines are not allowed`);
    }
    const sep = line.indexOf(":");
    const key = sep === -1 ? "" : line.slice(0, sep).trim();
    if (!key || key.includes(" ")) {
      throw new DealError(`${filename}:${i + 1}: expected 'key: value'`);
    }
    if (key in data) {
      throw new DealError(`${filename}:${i + 1}: duplicate field ${JSON.stringify(key)}`);
    }
    let value = line.slice(sep + 1).trim();
    if (
      value.length >= 2 &&
      value[0] === value[value.length - 1] &&
      (value[0] === '"' || value[0] === "'")
    ) {
      value = value.slice(1, -1);
    } else if (NULL_TOKENS.has(value.toLowerCase())) {
      value = null;
    }
    data[key] = value;
  });
  return data;
}

const isDate = (v) =>
  typeof v === "string" &&
  DATE_RE.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The first free-style phrase in `text`, or null. */
export function freeWording(text) {
  const match = FREE_RE.exec(String(text ?? ""));
  return match ? match[0] : null;
}

/** Validate one parsed deal against `today` (YYYY-MM-DD); returns the index entry. */
export function validateDeal(data, filename, today) {
  const fail = (msg) => {
    throw new DealError(`${filename}: ${msg}`);
  };
  const slug = path.basename(filename).replace(/\.ya?ml$/, "");
  if (!SLUG_RE.test(slug)) fail("file name must be a lowercase hyphenated slug");
  const freeKeys = Object.keys(data).filter((k) => RULES.free_keys.includes(k));
  if (freeKeys.length) {
    fail(
      `${freeKeys.sort().join(", ")}: a deal is never free; describe it with ` +
        "discount (and regular_price / deal_price when the page shows them)",
    );
  }
  if ("expiry_date" in data && data.expiry_date === null) {
    fail("expiry_date is required and cannot be null; a deal must end");
  }
  const missing = REQUIRED_FIELDS.filter((f) => data[f] == null);
  if (missing.length) fail(`missing required field(s): ${missing.join(", ")}`);
  const unknown = Object.keys(data).filter((k) => !FIELDS.includes(k));
  if (unknown.length) fail(`unknown field(s): ${unknown.sort().join(", ")}`);
  for (const field of BOOLEAN_FIELDS) {
    const value = data[field];
    if (value != null && asBoolean(value) === undefined) {
      fail(`${field} must be true or false, got ${JSON.stringify(value)}`);
    }
  }
  for (const field of STRING_FIELDS) {
    const value = data[field];
    if (value == null) continue;
    if (typeof value !== "string" || !value.trim()) {
      fail(`${field} must be a non-empty string`);
    }
    const limit = RULES.limits[field];
    if (limit && codePointLength(value) > limit) {
      fail(`${field} is longer than ${limit} characters`);
    }
  }
  if (!DEAL_CATEGORIES.includes(data.category)) {
    fail(
      `category ${JSON.stringify(data.category)} is outside the deal scope; ` +
        `expected one of ${DEAL_CATEGORIES.join(", ")}`,
    );
  }
  if (!OCCASIONS.includes(data.occasion)) {
    fail(`occasion ${JSON.stringify(data.occasion)} is not one of ${OCCASIONS.join(", ")}`);
  }
  if (!data.source_url.startsWith("https://") || /\s/.test(data.source_url)) {
    fail("source_url must be a plain https:// URL");
  }
  if (data.promo_code != null && !PROMO_RE.test(data.promo_code)) {
    fail("promo_code must be 1-40 letters, digits, '-' or '_'");
  }
  if (data.promo_code != null && PROMO_FREE_RE.test(data.promo_code)) {
    fail(
      `promo_code ${JSON.stringify(data.promo_code)} labels the deal free; ` +
        "a deal is never free (free offers belong in offers/)",
    );
  }
  for (const field of ["expiry_date", "verified_date", "start_date"]) {
    if (data[field] != null && !isDate(data[field])) {
      fail(`${field} must be a YYYY-MM-DD date, got ${JSON.stringify(data[field])}`);
    }
  }
  if (data.start_date != null && data.start_date > data.expiry_date) {
    fail(`start_date ${data.start_date} is after expiry_date ${data.expiry_date}`);
  }
  if (data.verified_date > today) {
    fail(`verified_date ${data.verified_date} is in the future (today is ${today})`);
  }
  for (const field of RULES.free_wording_fields) {
    const phrase = freeWording(data[field]);
    if (phrase) {
      fail(
        `${field} says ${JSON.stringify(phrase)}; a deal is a discount and is ` +
          "never labelled free (free offers belong in offers/)",
      );
    }
  }
  for (const field of RULES.nonzero_price_fields) {
    if (data[field] != null && !/[1-9]/.test(data[field])) {
      fail(`${field} ${JSON.stringify(data[field])} has no non-zero amount; a deal is never free`);
    }
  }
  const entry = { kind: "deal", slug };
  for (const field of STRING_FIELDS) {
    if (data[field] != null) entry[field] = data[field].trim();
  }
  // Default false: the index carries a flag only when it is true.
  for (const field of BOOLEAN_FIELDS) {
    if (asBoolean(data[field]) === true) entry[field] = true;
  }
  return entry;
}

/** Shown through its expiry day, hidden from the next (build clock). */
export function isExpiredDeal(deal, today) {
  return deal.expiry_date < today;
}

/** A deal whose start_date is still ahead is hidden until that day (build clock). */
export function isUpcomingDeal(deal, today) {
  return deal.start_date != null && today < deal.start_date;
}

/** Listed from start_date (when set) through expiry_date. */
export function isListedDeal(deal, today) {
  return !isExpiredDeal(deal, today) && !isUpcomingDeal(deal, today);
}

/** Featured first (#815), then soonest-ending, then provider, then slug. */
export function sortDeals(deals) {
  return [...deals].sort(
    (a, b) =>
      Number(b.featured === true) - Number(a.featured === true) ||
      a.expiry_date.localeCompare(b.expiry_date) ||
      a.provider.localeCompare(b.provider) ||
      a.slug.localeCompare(b.slug),
  );
}

/**
 * Load every deal under `dealsDir` and return the ones running on `today`
 * (started and not yet expired). A missing folder is an empty list; a stray
 * file, an invalid deal, or a deal slug that names an offer fails the build.
 */
export async function loadDeals(dealsDir, today, offerSlugs = []) {
  if (!dealsDir || !existsSync(dealsDir)) return [];
  const taken = new Set(offerSlugs);
  const deals = [];
  for (const file of (await readdir(dealsDir)).sort()) {
    if (file === ".gitkeep") continue;
    const filename = path.join(dealsDir, file);
    if (!file.endsWith(".yaml") || !(await stat(filename)).isFile()) {
      throw new DealError(`${filename}: unexpected entry; deals are <slug>.yaml files only`);
    }
    const deal = validateDeal(
      parseDealText(await readFile(filename, "utf8"), filename),
      filename,
      today,
    );
    if (taken.has(deal.slug)) {
      throw new DealError(`${filename}: slug ${deal.slug} is also an offer; deal slugs must be unique`);
    }
    if (isListedDeal(deal, today)) deals.push(deal);
  }
  return sortDeals(deals);
}

export function defaultDealsDir(offersDir) {
  return path.join(offersDir, "..", "deals");
}
