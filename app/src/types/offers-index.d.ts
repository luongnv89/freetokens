// GENERATED FILE — do not edit by hand.
// Source of truth: schemas/offers-index.schema.json (issue #120 data contract).
// Regenerate with `npm run gen:types` in app/.

/**
 * Frozen data contract (issue #120, tasks.md Task 2.1) for the GENERATED offers.json / offers.jsonl artifacts produced by app/scripts/load-offers.mjs. This governs the build OUTPUT only — schemas/offer.schema.json still governs the YAML source and does not change. The pipeline validates its own output against this schema and fails the build on mismatch.
 */
export interface OffersIndex {
  /**
   * Build timestamp, UTC, second precision with a trailing Z.
   */
  generated_at: string;
  /**
   * Total number of entries in offers (active + expired).
   */
  count: number;
  /**
   * Entries whose status is active at build time.
   */
  active_count: number;
  /**
   * Entries whose status is expired at build time.
   */
  expired_count: number;
  /**
   * All validated offers, newest-verified first (ties by slug ascending). Expired entries are retained and flagged, never dropped.
   */
  offers: Offer[];
}
/**
 * One offer entry in the generated index. Mirrors the YAML source fields plus the slug and the build-time-computed status.
 */
export interface Offer {
  /**
   * File name of the source offers/<slug>.yaml without extension.
   */
  slug: string;
  /**
   * Human-readable offer name shown on cards.
   */
  title: string;
  /**
   * Company or product offering the credit.
   */
  provider: string;
  /**
   * Offer category badge.
   */
  category: "api_provider" | "coding" | "image" | "voice" | "video" | "startup_program";
  /**
   * Free value in human terms, e.g. '$300 in credits'.
   */
  amount: string;
  /**
   * Date the offer stops being claimable, YYYY-MM-DD. Null means ongoing.
   */
  expiry_date: string | null;
  /**
   * Official provider page describing the offer.
   */
  source_url: string;
  /**
   * Date the curator last verified the offer is live, YYYY-MM-DD.
   */
  verified_date: string;
  /**
   * How the listing was checked.
   */
  verification: "hand_verified" | "social_proof" | "unverified";
  /**
   * Whether claiming needs an account.
   */
  signup: "none" | "required";
  /**
   * Build-time expiry verdict (ADR 0001): computed against the BUILD clock, never a client clock.
   */
  status: "active" | "expired";
}
