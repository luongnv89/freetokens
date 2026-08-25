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

export function claimStorageKey(slug: string): string {
  return `ft-claim-${slug}`;
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
