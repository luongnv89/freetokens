/**
 * Typed localStorage personal-state layer.
 *
 * One module owns ALL browser-persisted personal state for the app
 * (PRD Assumption 4 / §6.2). Personal state is per-visitor and never
 * leaves the browser — nothing here touches analytics events, URLs,
 * or network requests (asserted by tests).
 *
 * Legacy-key compatibility (issue #125):
 * - `ft_ga_consent` stores a bare word: "granted" or "denied".
 * - `ft-claim-<slug>` stores a JSON array of checked step indices,
 *   e.g. [0, 2].
 * Both formats were written by the pre-migration site; this layer reads
 * them unchanged so returning visitors keep their consent decision and
 * claim progress on cutover day.
 *
 * Schema versioning & migration path:
 * - Every NEW write uses an enveloped record `{ v: <SCHEMA_VERSION>, ... }`.
 *   (`v1` claim record: `{ v: 1, done: number[] }`.)
 * - Readers accept BOTH the legacy bare form (no envelope) and any
 *   enveloped form whose major version they know. Unknown future
 *   versions degrade to defaults rather than throwing.
 * - To migrate a shape in the future: bump SCHEMA_VERSION, add a branch
 *   in the read function that maps older `v` values to the current
 *   shape, and keep reading older envelopes for at least one release.
 *
 * Hostile-environment tolerance:
 * All storage access is wrapped — unavailable storage (SSR/prerender,
 * jsdom without storage), disabled storage (private mode / security
 * settings), quota-exceeded writes, and corrupted JSON all degrade to
 * defaults silently. No thrown error ever escapes this module.
 */

/** Bump on any breaking change to a stored record's shape. */
export const SCHEMA_VERSION = 1 as const;

export type GaConsent = "granted" | "denied";

export const GA_CONSENT_KEY = "ft_ga_consent";

export const CLAIM_KEY_PREFIX = "ft-claim-";

export function claimStorageKey(slug: string): string {
  return `${CLAIM_KEY_PREFIX}${slug}`;
}

/** v1 claim-progress envelope written by this layer. */
export interface ClaimRecordV1 {
  v: typeof SCHEMA_VERSION;
  done: number[];
}

function windowLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = window.localStorage;
    // Accessing a method forces the "disabled storage" SecurityError to
    // surface here instead of at call sites.
    if (!ls || typeof ls.getItem !== "function") return null;
    return ls;
  } catch {
    // Private mode / storage disabled can throw on property access.
    return null;
  }
}

function safeRead(key: string): string | null {
  const ls = windowLocalStorage();
  if (!ls) return null;
  try {
    return ls.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): boolean {
  const ls = windowLocalStorage();
  if (!ls) return false;
  try {
    ls.setItem(key, value);
    return true;
  } catch {
    // Quota exceeded or write blocked — degrade silently.
    return false;
  }
}

function safeRemove(key: string): void {
  const ls = windowLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Read the visitor's GA consent decision.
 * Returns null when unset, unreadable, or corrupted.
 */
export function readGaConsent(): GaConsent | null {
  const raw = safeRead(GA_CONSENT_KEY);
  if (raw === "granted" || raw === "denied") return raw;
  return null;
}

/**
 * Persist the visitor's GA consent decision.
 * Kept in the legacy bare-word format for key compatibility.
 * Returns false when persistence was not possible (state stays in memory).
 */
export function writeGaConsent(value: GaConsent): boolean {
  return safeWrite(GA_CONSENT_KEY, value);
}

function parseClaimRaw(raw: string | null): number[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // Enveloped (current) form: { v: 1, done: [...] }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      const env = parsed as { v?: unknown; done?: unknown };
      if (env.v === SCHEMA_VERSION && Array.isArray(env.done)) {
        return env.done.filter(
          (n): n is number => typeof n === "number" && Number.isInteger(n),
        );
      }
      // Unknown future schema version: documented migration point.
      // Degrade to defaults rather than guessing at the new shape.
      return [];
    }
    // Legacy bare form: [0, 2] — read unchanged from the pre-migration site.
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (n): n is number => typeof n === "number" && Number.isInteger(n),
      );
    }
    return null;
  } catch {
    // Corrupted JSON.
    return null;
  }
}

/**
 * Read the checked claim-step indices for an offer slug.
 * Degrades to [] when unset, unavailable, or corrupted.
 */
export function readClaimProgress(slug: string): number[] {
  return parseClaimRaw(safeRead(claimStorageKey(slug))) ?? [];
}

/**
 * Persist checked claim-step indices for an offer slug using the
 * current versioned envelope. Returns false when persistence was not
 * possible (progress stays session-only, mirroring the legacy script).
 */
export function writeClaimProgress(
  slug: string,
  done: number[],
): boolean {
  const unique = [...new Set(done)].filter(
    (n) => typeof n === "number" && Number.isInteger(n) && n >= 0,
  );
  unique.sort((a, b) => a - b);
  const record: ClaimRecordV1 = { v: SCHEMA_VERSION, done: unique };
  return safeWrite(claimStorageKey(slug), JSON.stringify(record));
}

/** Remove one offer's claim progress (e.g. after reset). */
export function clearClaimProgress(slug: string): void {
  safeRemove(claimStorageKey(slug));
}

// ---------------------------------------------------------------------------
// Saved & dismissed shortlists + last-used view preferences (issue #140).
// Same envelope rules as claim progress; purely local, never in URLs or
// analytics events.
// ---------------------------------------------------------------------------

export const SAVED_KEY = "ft-saved";
export const DISMISSED_KEY = "ft-dismissed";
export const PREFS_KEY = "ft-prefs";

/** v1 slug-list envelope written by this layer. */
export interface SlugListRecordV1 {
  v: typeof SCHEMA_VERSION;
  slugs: string[];
}

/** v1 last-used filter/sort preferences envelope. */
export interface PrefsRecordV1 {
  v: typeof SCHEMA_VERSION;
  category: string;
  verification: string;
  signup: string;
  sort: string;
}

export type PrefsInput = Partial<
  Pick<PrefsRecordV1, "category" | "verification" | "signup" | "sort">
>;

const MAX_SLUGS = 500;
const MAX_SLUG_LENGTH = 128;
const MAX_PREF_LENGTH = 64;

function normalizeSlugList(slugs: Iterable<string>): string[] {
  const out: string[] = [];
  for (const slug of slugs) {
    if (typeof slug !== "string") continue;
    const trimmed = slug.trim().slice(0, MAX_SLUG_LENGTH);
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= MAX_SLUGS) break;
  }
  return out;
}

function parseSlugListRaw(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      const env = parsed as { v?: unknown; slugs?: unknown };
      // Unknown future schema version: documented migration point — degrade
      // to defaults rather than guessing at the new shape.
      if (env.v !== SCHEMA_VERSION || !Array.isArray(env.slugs)) return [];
      return normalizeSlugList(
        env.slugs.filter((s): s is string => typeof s === "string"),
      );
    }
    return [];
  } catch {
    return [];
  }
}

function readSlugList(key: string): string[] {
  return parseSlugListRaw(safeRead(key));
}

function writeSlugList(key: string, slugs: Iterable<string>): boolean {
  const record: SlugListRecordV1 = {
    v: SCHEMA_VERSION,
    slugs: normalizeSlugList(slugs),
  };
  return safeWrite(key, JSON.stringify(record));
}

function parsePrefsRaw(raw: string | null): PrefsRecordV1 | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const env = parsed as Record<string, unknown>;
    if (env.v !== SCHEMA_VERSION) return null;
    const pref = (value: unknown): string =>
      typeof value === "string" ? value.trim().slice(0, MAX_PREF_LENGTH) : "";
    return {
      v: SCHEMA_VERSION,
      category: pref(env.category),
      verification: pref(env.verification),
      signup: pref(env.signup),
      sort: pref(env.sort),
    };
  } catch {
    return null;
  }
}

/**
 * Read the visitor's saved-offer shortlist (offer slugs).
 * Degrades to [] when unset, unavailable, corrupted, or an unknown schema.
 */
export function readSavedSlugs(): string[] {
  return readSlugList(SAVED_KEY);
}

/**
 * Persist the saved-offer shortlist using the current versioned envelope.
 * Returns false when persistence was not possible (shortlist stays
 * session-only).
 */
export function writeSavedSlugs(slugs: Iterable<string>): boolean {
  return writeSlugList(SAVED_KEY, slugs);
}

/**
 * Read the visitor's dismissed-offer list (offer slugs hidden from the
 * default list). Degrades to [] like every other reader here.
 */
export function readDismissedSlugs(): string[] {
  return readSlugList(DISMISSED_KEY);
}

/**
 * Persist the dismissed-offer list. Returns false when persistence was
 * not possible.
 */
export function writeDismissedSlugs(slugs: Iterable<string>): boolean {
  return writeSlugList(DISMISSED_KEY, slugs);
}

/** Restore every dismissed offer at once (one-click undo of hiding). */
export function clearDismissedSlugs(): void {
  safeRemove(DISMISSED_KEY);
}

/**
 * Read the last-used filter/sort preferences, or null when unset,
 * unreadable, or corrupted. Values are NOT validated against the app's
 * known dimensions here — callers own that (keeps this module free of
 * urlState/offers imports); invalid values degrade at the call site.
 */
export function readPrefs(): PrefsRecordV1 | null {
  return parsePrefsRaw(safeRead(PREFS_KEY));
}

/**
 * Persist the last-used filter/sort preferences. Undefined fields are
 * stored as empty strings ("back to default"). Returns false when
 * persistence was not possible.
 */
export function writePrefs(prefs: PrefsInput): boolean {
  const record: PrefsRecordV1 = {
    v: SCHEMA_VERSION,
    category: prefs.category ?? "",
    verification: prefs.verification ?? "",
    signup: prefs.signup ?? "",
    sort: prefs.sort ?? "",
  };
  return safeWrite(PREFS_KEY, JSON.stringify(record));
}

/**
 * Wipe every personal-state key this layer owns. Never removes keys
 * it does not recognize.
 */
export function clearAllPersonalState(slugs: Iterable<string>): void {
  safeRemove(GA_CONSENT_KEY);
  safeRemove(SAVED_KEY);
  safeRemove(DISMISSED_KEY);
  safeRemove(PREFS_KEY);
  for (const slug of slugs) {
    safeRemove(claimStorageKey(slug));
  }
}

// ---------------------------------------------------------------------------
// Portable export / import of every personal-state key (issue #141).
//
// Export serializes the full local snapshot as a versioned JSON document;
// import validates it strictly (schema, types, size) and writes it back
// all-or-nothing: an invalid file is rejected BEFORE any key is touched.
// Everything stays in the browser — no network call of any kind.
// ---------------------------------------------------------------------------

/** Marker string identifying a freetokens personal-state export. */
export const EXPORT_FORMAT = "freetokens-personal-state" as const;

/** Bump on any breaking change to the exported document's shape. */
export const EXPORT_VERSION = 1 as const;

/**
 * Hard cap on accepted import payloads, measured on the raw JSON text
 * before parsing — a multi-megabyte "export" is rejected outright.
 */
export const IMPORT_MAX_LENGTH = 1_000_000;

const MAX_CLAIM_SLUGS = MAX_SLUGS;

/** Versioned personal-state export document. */
export interface PersonalStateExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exported_at: string;
  consent: GaConsent | null;
  saved: string[];
  dismissed: string[];
  prefs: PrefsRecordV1 | null;
  claims: Record<string, number[]>;
}

export type ImportResult =
  | { ok: true; saved: number; dismissed: number; claims: number }
  | { ok: false; reason: string };

/**
 * List the offer slugs that currently have a `ft-claim-<slug>` key in
 * storage. Degrades to [] when storage is unavailable or disabled.
 */
export function claimSlugsInStorage(): string[] {
  const ls = windowLocalStorage();
  if (!ls) return [];
  const slugs: string[] = [];
  try {
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (typeof key === "string" && key.startsWith(CLAIM_KEY_PREFIX)) {
        slugs.push(key.slice(CLAIM_KEY_PREFIX.length));
      }
    }
  } catch {
    return [];
  }
  return normalizeSlugList(slugs);
}

/**
 * Build the portable JSON snapshot of every personal-state key.
 * When `claimSlugs` is omitted the stored `ft-claim-*` keys are enumerated
 * automatically. Never throws and never touches the network.
 */
export function exportPersonalState(
  claimSlugs?: Iterable<string>,
): PersonalStateExport {
  const slugs = claimSlugs ? [...claimSlugs] : claimSlugsInStorage();
  const claims: Record<string, number[]> = {};
  for (const slug of normalizeSlugList(slugs)) {
    const done = parseClaimRaw(safeRead(claimStorageKey(slug)));
    if (done && done.length > 0) claims[slug] = done;
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    consent: readGaConsent(),
    saved: readSavedSlugs(),
    dismissed: readDismissedSlugs(),
    prefs: readPrefs(),
    claims,
  };
}

function reject(reason: string): ImportResult {
  return { ok: false, reason };
}

/**
 * Validate an untrusted import payload against the exact export schema.
 * Returns the normalized records or null — never writes anything.
 */
function validateImport(parsed: unknown):
  | {
      consent: GaConsent | null;
      saved: string[];
      dismissed: string[];
      prefs: PrefsRecordV1 | null;
      claims: [string, number[]][];
    }
  | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const doc = parsed as Record<string, unknown>;
  if (doc.format !== EXPORT_FORMAT) return null;
  if (doc.version !== EXPORT_VERSION) return null;

  // Consent: absent/null or exactly one of the two legal words.
  const consent =
    doc.consent === undefined || doc.consent === null
      ? null
      : doc.consent === "granted" || doc.consent === "denied"
        ? doc.consent
        : null;
  if (
    doc.consent !== undefined &&
    doc.consent !== null &&
    consent === null
  ) {
    return null;
  }

  // Saved/dismissed: absent → empty; present but malformed → rejected.
  // Arrays of strings, normalized like live writes are.
  const list = (value: unknown): string[] | null => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return null;
    if (!value.every((s) => typeof s === "string")) return null;
    return normalizeSlugList(value);
  };
  const saved = list(doc.saved);
  if (saved === null) return null;
  const dismissed = list(doc.dismissed);
  if (dismissed === null) return null;

  // Prefs: absent/null or only known string fields.
  let prefs: PrefsRecordV1 | null = null;
  if (doc.prefs !== undefined && doc.prefs !== null) {
    if (typeof doc.prefs !== "object" || Array.isArray(doc.prefs)) return null;
    const p = doc.prefs as Record<string, unknown>;
    const field = (value: unknown): string | null =>
      value === undefined
        ? ""
        : typeof value === "string"
          ? value.trim().slice(0, MAX_PREF_LENGTH)
          : null;
    const category = field(p.category);
    const verification = field(p.verification);
    const signup = field(p.signup);
    const sort = field(p.sort);
    if (
      category === null ||
      verification === null ||
      signup === null ||
      sort === null
    ) {
      return null;
    }
    prefs = { v: SCHEMA_VERSION, category, verification, signup, sort };
  }

  // Claims: object mapping slug -> array of non-negative integers.
  if (
    doc.claims !== undefined &&
    doc.claims !== null &&
    (typeof doc.claims !== "object" || Array.isArray(doc.claims))
  ) {
    return null;
  }
  const claims: [string, number[]][] = [];
  if (doc.claims !== undefined && doc.claims !== null) {
    const raw = doc.claims as Record<string, unknown>;
    for (const [slug, done] of Object.entries(raw)) {
      if (typeof slug !== "string" || !slug.trim()) return null;
      if (slug.length > MAX_SLUG_LENGTH) return null;
      if (!Array.isArray(done)) return null;
      if (!done.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)) {
        return null;
      }
      claims.push([slug.trim().slice(0, MAX_SLUG_LENGTH), done]);
      if (claims.length > MAX_CLAIM_SLUGS) return null;
    }
  }

  return { consent, saved, dismissed, prefs, claims };
}

/**
 * Import a previously exported personal-state document (raw JSON text or
 * an already-parsed value). Strictly validated first — malformed,
 * foreign, oversized, or future-version payloads are rejected with no
 * partial write. Returns why the file was rejected on failure.
 */
export function importPersonalState(raw: string | unknown): ImportResult {
  if (!windowLocalStorage()) {
    return reject("Local storage is unavailable in this browser.");
  }
  if (typeof raw === "string") {
    if (raw.length > IMPORT_MAX_LENGTH) {
      return reject("That file is too large to be a personal-state export.");
    }
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return reject("That file is not valid JSON.");
    }
  } else if (raw !== null && typeof raw === "object") {
    // Parsed values skip the text-size gate but must still be small
    // enough to serialize under the same cap.
    try {
      if (JSON.stringify(raw).length > IMPORT_MAX_LENGTH) {
        return reject("That data is too large to be a personal-state export.");
      }
    } catch {
      return reject("That file is not valid JSON.");
    }
  }
  const validated = validateImport(raw);
  if (!validated) {
    return reject(
      "That file does not match the freetokens personal-state format.",
    );
  }

  const { consent, saved, dismissed, prefs, claims } = validated;
  let refused = false;
  if (consent !== null && !writeGaConsent(consent)) refused = true;
  if (prefs !== null && !writePrefs(prefs)) refused = true;
  if (!writeSavedSlugs(saved)) refused = true;
  if (!writeDismissedSlugs(dismissed)) refused = true;
  for (const [slug, done] of claims) {
    if (!writeClaimProgress(slug, done)) refused = true;
  }
  if (refused) {
    return reject("Local storage refused the write. Nothing was imported.");
  }
  return {
    ok: true,
    saved: saved.length,
    dismissed: dismissed.length,
    claims: claims.length,
  };
}
