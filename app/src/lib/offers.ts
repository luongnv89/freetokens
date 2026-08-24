// Parity layer with scripts/build.py (Task 1.5, epic #114): every helper here
// mirrors the Python builder exactly — same sort keys, same display strings,
// same badge vocabulary — so the React home listing renders byte-for-byte
// equivalent markup from src/data/offers.json.

// The Offer / OffersIndex types are GENERATED from the frozen data contract
// (schemas/offers-index.schema.json, issue #120) — never edit them by hand;
// a schema change that breaks a component is a compile error.
import type { Offer, OffersIndex } from "../types/offers-index"
export type { Offer, OffersIndex }

export const CATEGORIES = ["api_provider", "coding", "image", "voice", "video"] as const

export const CATEGORY_LABELS: Record<string, string> = {
  api_provider: "API providers",
  coding: "Coding",
  image: "Image",
  voice: "Voice",
  video: "Video",
}

export const VERIFICATION_LABELS: Record<string, string> = {
  hand_verified: "hand-verified",
  social_proof: "social proof",
  unverified: "unverified",
}

export const VERIFICATION_TITLES: Record<string, string> = {
  hand_verified: "Checked by the maintainer against the official provider website",
  social_proof:
    "Not personally verified, but corroborated by the official website and social proof",
  unverified: "Only social-media proofs — no official-website confirmation yet",
}

export const SIGNUP_LABELS: Record<string, string> = {
  none: "no sign-up",
  required: "sign-up required",
}

export const SIGNUP_TITLES: Record<string, string> = {
  none: "Claimable without creating an account",
  required: "Claiming requires creating a (free) account",
}

// Past this many days an age falls back to the absolute date (build.py
// RELATIVE_DATE_MAX_DAYS).
export const RELATIVE_DATE_MAX_DAYS = 14

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function parseISODate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const day = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== iso) return null
  return day
}

/** YYYY-MM-DD -> e.g. 'Dec 31, 2026' (build.py _human_date). */
export function humanDate(iso: string): string {
  const day = parseISODate(iso)
  if (!day) return iso
  return `${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}, ${day.getUTCFullYear()}`
}

/** The build's own calendar date, used as the "now" for relative ages. */
export function buildDate(generatedAt: string): string {
  return generatedAt.slice(0, 10)
}

/**
 * Age relative to `today` (build.py _relative_date): today / yesterday / Nd
 * ago / Nw ago, falling back to the absolute date past the freshness window.
 */
export function relativeDate(iso: string, today: string): string {
  const day = parseISODate(iso)
  const now = parseISODate(today)
  if (!day || !now) return iso || ""
  const days = Math.round((now.getTime() - day.getTime()) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  if (days < RELATIVE_DATE_MAX_DAYS) return `${Math.floor(days / 7)}w ago`
  return humanDate(iso)
}

/**
 * Best-effort numeric magnitude of a free-value string (build.py
 * amount_sort_value): first number wins, k/M multipliers honored,
 * unparseable strings sort as 0.
 */
export function amountSortValue(amount: string): number {
  const match = (amount || "").match(/[0-9][0-9.,]*/)
  if (!match) return 0.0
  let value = parseFloat(match[0].replace(/,/g, "").replace(/\.$/, ""))
  if (Number.isNaN(value)) return 0.0
  // Anchored to the string START exactly like build.py's re.match: only a
  // value that *begins* the string ("10k credits") carries a multiplier.
  const suffix = amount.match(/^[0-9][0-9.,]*\s*([kKmM])/)
  if (suffix) value *= suffix[1].toLowerCase() === "k" ? 1_000 : 1_000_000
  return value
}

/** Python %-formatting %g: 6 significant digits, exponent when compact. */
export function formatAmountSort(value: number): string {
  const exp = Math.floor(Math.log10(Math.abs(value)))
  if (!Number.isFinite(exp)) return String(value) // 0 / Infinity fall through
  if (exp >= 6 || exp < -4) {
    const [mantissa, exponent] = value.toExponential(5).split("e")
    const e = Number(exponent)
    return `${mantissa.replace(/\.?0+$/, "")}e${e >= 0 ? "+" : "-"}${String(Math.abs(e)).padStart(2, "0")}`
  }
  return String(parseFloat(value.toPrecision(6)))
}

/** Expired entries never reach the default visitor list (#25). */
export function activeOffers(index: OffersIndex): Offer[] {
  return index.offers.filter((o) => o.status !== "expired")
}
