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

/**
 * Wipe every personal-state key this layer owns. Never removes keys
 * it does not recognize.
 */
export function clearAllPersonalState(slugs: Iterable<string>): void {
  safeRemove(GA_CONSENT_KEY);
  for (const slug of slugs) {
    safeRemove(claimStorageKey(slug));
  }
}
