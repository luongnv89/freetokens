// Parity layer with scripts/build.py (Task 1.5, epic #114): every helper here
// mirrors the Python builder exactly — same sort keys, same display strings,
// same badge vocabulary — so the React home listing renders byte-for-byte
// equivalent markup from src/data/offers.json.

// The Offer / OffersIndex types are GENERATED from the frozen data contract
// (schemas/offers-index.schema.json, issue #120) — never edit them by hand;
// a schema change that breaks a component is a compile error.
import type { Offer, OffersIndex } from "../types/offers-index";
import type { UrlState } from "./urlState";
import { rankOffers, type RankContext } from "./ranking";
// Trust wording has ONE home: scripts/trust-vocabulary.mjs (issues #507/#509).
// The maps below are projections of it, so the badges, the hover-free legend,
// the JSON-LD and the llms exports can never drift apart. Plain ESM + a
// sibling .d.mts, the same arrangement as scripts/env-file.mjs.
import {
  EVIDENCE_LEVEL,
  REVIEW_STATUS,
  SIGNUP,
  TRUST_COMBINED_EXAMPLE,
  TRUST_SUMMARY,
  TRUST_VERB_MAP,
  ENROLLMENT_DEADLINE_NOTE,
  LAST_CHECKED,
  trustDefinitions,
  trustFields,
  type TrustValueDefinition,
} from "../../scripts/trust-vocabulary.mjs";
export type { Offer, OffersIndex };

export {
  ENROLLMENT_DEADLINE_NOTE,
  LAST_CHECKED,
  TRUST_COMBINED_EXAMPLE,
  TRUST_SUMMARY,
  TRUST_VERB_MAP,
  trustDefinitions,
  trustFields,
};

/** `value -> label` for one vocabulary axis (unknown values keep their name). */
function labelsOf<T extends TrustValueDefinition>(
  defs: Record<string, T>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(defs).map(([value, entry]) => [value, entry.label]),
  );
}

/**
 * Hover text = the full definition plus what the value does NOT attest, so a
 * tooltip can never state less than the legend does.
 */
function titlesOf<T extends TrustValueDefinition>(
  defs: Record<string, T>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(defs).map(([value, entry]) => [
      value,
      entry.claim ? `${entry.definition} ${entry.claim}` : entry.definition,
    ]),
  );
}

export const CATEGORIES = [
  "api_provider",
  "coding",
  "image",
  "voice",
  "video",
  "startup_program",
  "student",
  "oss_program",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  api_provider: "API providers",
  coding: "Coding",
  image: "Image",
  voice: "Voice",
  video: "Video",
  startup_program: "Startup programs",
  student: "Student",
  oss_program: "OSS program",
};

// Evidence level (`verification`). The labels deliberately avoid the word
// "verified" on this axis: it belongs to review_status, and reusing it here
// was what made "verified" and "unverified" appear side by side on one row.
export const VERIFICATION_LABELS: Record<string, string> =
  labelsOf(EVIDENCE_LEVEL);

export const VERIFICATION_TITLES: Record<string, string> =
  titlesOf(EVIDENCE_LEVEL);

// Review status (`review_status`).
export const REVIEW_STATUS_LABELS: Record<string, string> =
  labelsOf(REVIEW_STATUS);

export const REVIEW_STATUS_TITLES: Record<string, string> =
  titlesOf(REVIEW_STATUS);

export const SIGNUP_LABELS: Record<string, string> = labelsOf(SIGNUP);

export const SIGNUP_TITLES: Record<string, string> = titlesOf(SIGNUP);

// Past this many days an age falls back to the absolute date (build.py
// RELATIVE_DATE_MAX_DAYS).
export const RELATIVE_DATE_MAX_DAYS = 14;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parseISODate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const day = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== iso)
    return null;
  return day;
}

/** YYYY-MM-DD -> e.g. 'Dec 31, 2026' (build.py _human_date). */
export function humanDate(iso: string): string {
  const day = parseISODate(iso);
  if (!day) return iso;
  return `${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}, ${day.getUTCFullYear()}`;
}

/** The build's own calendar date, used as the "now" for relative ages. */
export function buildDate(generatedAt: string): string {
  return generatedAt.slice(0, 10);
}

/**
 * Age relative to `today` (build.py _relative_date): today / yesterday / Nd
 * ago / Nw ago, falling back to the absolute date past the freshness window.
 */
export function relativeDate(iso: string, today: string): string {
  const day = parseISODate(iso);
  const now = parseISODate(today);
  if (!day || !now) return iso || "";
  const days = Math.round((now.getTime() - day.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < RELATIVE_DATE_MAX_DAYS) return `${Math.floor(days / 7)}w ago`;
  return humanDate(iso);
}

/** Expired entries never reach the default visitor list (#25). */
export function activeOffers(index: OffersIndex): Offer[] {
  return index.offers.filter((o) => o.status !== "expired");
}

/**
 * AND semantics (build.py ftMatches): an offer is shown only when it
 * satisfies EVERY active tag filter and the search query. Search is a
 * lowercase substring over the card-visible fields (title, provider,
 * amount) — offers have no description field.
 */
export function offerMatches(offer: Offer, state: UrlState): boolean {
  if (state.category && offer.category !== state.category) return false;
  if (state.verification && offer.verification !== state.verification)
    return false;
  if (state.signup && offer.signup !== state.signup) return false;
  if (!state.q) return true;
  const needle = state.q.toLowerCase();
  const haystack =
    `${offer.title} ${offer.provider} ${offer.amount}`.toLowerCase();
  return haystack.includes(needle);
}

/**
 * Client listing order (build.py ftApplySort). Stable: ties fall back to
 * the offer's index in `offers` (the activeOffers order). Empty / invalid
 * mode is the "Recommended" ranking (src/lib/ranking.ts). "added" restores
 * the original index order — the build's newest-ADDED ordering (see
 * readAddedDates in scripts/load-offers.mjs), shown as "Latest added".
 * Null expiry sorts last under expiring. There is deliberately no amount /
 * allowance sort: the free-text `amount` field mixes units (dollars, tokens,
 * credits, characters, minutes, requests) and periods, so ranking it would
 * fabricate a cross-unit value equivalence (#508). Any unrecognised mode —
 * including the legacy "amount" — falls through to the default ranking,
 * which never reads `amount` either.
 */
export function applySort(
  offers: Offer[],
  mode: string,
  rank: RankContext,
): Offer[] {
  if (mode !== "newest" && mode !== "expiring" && mode !== "added") {
    return rankOffers(offers, rank);
  }
  const indexed = offers.map((offer, index) => ({ offer, index }));
  if (mode === "newest") {
    indexed.sort(
      (a, b) =>
        b.offer.verified_date.localeCompare(a.offer.verified_date) ||
        a.index - b.index,
    );
  } else if (mode === "expiring") {
    indexed.sort((a, b) => {
      const ea = a.offer.expiry_date ?? "";
      const eb = b.offer.expiry_date ?? "";
      if (!ea && !eb) return a.index - b.index;
      if (!ea) return 1;
      if (!eb) return -1;
      return ea.localeCompare(eb) || a.index - b.index;
    });
  } else {
    indexed.sort((a, b) => a.index - b.index);
  }
  return indexed.map((row) => row.offer);
}

/** Newest expiration first, slug as stable tiebreak (build.py expired_offers). */
export function expiredOffers(index: OffersIndex): Offer[] {
  return index.offers
    .filter((o) => o.status === "expired")
    .sort((a, b) => {
      const ka = a.expiry_date ?? "";
      const kb = b.expiry_date ?? "";
      if (ka !== kb) return ka < kb ? 1 : -1;
      return a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0;
    });
}
