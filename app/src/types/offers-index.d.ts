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
   * All validated offers, newest-added first, then newest-verified, ties by slug ascending. Expired entries are retained and flagged, never dropped.
   */
  offers: Offer[];
  /**
   * Curated 'Always free' shelf (#612): offer slugs from config/always-free.yaml in the curator's order. Every slug names an offer in offers; the home page shows only the ones that are active and not verification: unverified.
   */
  always_free?: string[];
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
  category: "api_provider" | "coding" | "image" | "voice" | "video" | "startup_program" | "student" | "oss_program";
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
   * Date the offer's YAML first entered git history, YYYY-MM-DD; feeds the default ranking's newness signal. Null when the build has no git history (shallow clone). Always emitted by the loader; optional so older payloads stay valid.
   */
  added_date?: string | null;
  /**
   * How the listing was checked.
   */
  verification: "social_proof" | "unverified";
  /**
   * Curator testing state, separate from evidence verification and build-time expiry.
   */
  review_status: "verified" | "unverified" | "under-review" | "to-be-verified";
  /**
   * Whether claiming needs an account.
   */
  signup: "none" | "required";
  /**
   * Build-time expiry verdict (ADR 0001): computed against the BUILD clock, never a client clock.
   */
  status: "active" | "expired";
  /**
   * Present only on community entries (#748): a promo code or giveaway a person shared, NOT verified by freetokens. Absent on regular offers.
   */
  listing_type?: "community";
  community?: Community;
}
/**
 * Community listing details (#748), re-nested from the flat offers/*.yaml keys. Facts are quoted from the post; keys the post did not state are absent.
 */
export interface Community {
  /**
   * promo_code = a code anyone can redeem; giveaway = codes handed out to people who enter.
   */
  subtype: "promo_code" | "giveaway";
  /**
   * Who added the entry.
   */
  added_by: "luong";
  shared_by: SharedBy;
  /**
   * promo_code subtype: the code as the post gives it.
   */
  promo_code?: string;
  /**
   * giveaway subtype: how many codes the post gives away.
   */
  codes_available?: number;
  /**
   * giveaway subtype: the day entries close, YYYY-MM-DD (equals expiry_date).
   */
  entries_close?: string;
  /**
   * The post's time zone quoted, or 'no time zone given'.
   */
  timezone_note?: string;
}
/**
 * Who shared a community entry, and where.
 */
export interface SharedBy {
  /**
   * Bare account handle of the poster (no @).
   */
  handle: string;
  /**
   * Poster's display name, when the post shows one.
   */
  name?: string;
  /**
   * Link to the post (the entry's source_url).
   */
  post_url: string;
  /**
   * Date of the post, YYYY-MM-DD.
   */
  post_date: string;
}
