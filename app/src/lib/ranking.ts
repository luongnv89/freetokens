// Default ("Recommended") listing order. One weighted score per offer, with
// the criteria weighted in priority order — hot today, big lab, category
// (coding, then API providers, then everything else), newly added, reviewed —
// so an earlier signal outweighs a later one without making it a strict tier.
//
// Deliberately NOT a signal: the free-text `amount`. It mixes dollars, tokens,
// credits, characters and minutes, so any magnitude read out of it would
// fabricate a cross-unit value equivalence (#508).
//
// Self-contained on purpose (types only), so Playwright specs can import it to
// compute the expected first page without pulling in the trust vocabulary.
import type { Offer } from "../types/offers-index";

/**
 * Provider names that count as a big lab. Matched against the provider with
 * any parenthetical removed, as the whole name or its leading word(s):
 * "Google Cloud" and "Meta (via OpenCode Zen)" match, "OpenRouter" does not
 * match "openai", and "TalentGenius (OpenAI SMB Channel Partner)" — a reseller
 * — matches nothing.
 */
export const BIG_LAB_PROVIDERS = [
  "anthropic",
  "openai",
  "xai",
  "x.ai",
  "google",
  "microsoft",
  "github",
  "amazon",
  "aws",
  "kiro",
  "openrouter",
  "meta",
  "mistral",
  "nvidia",
  "deepseek",
] as const;

export const RANK_WEIGHTS = {
  /** Scaled by views / the top offer's views today, so only the leader gets all of it. */
  hot: 50,
  bigLab: 40,
  coding: 30,
  apiProvider: 15,
  /** Full on the day an offer is added, decaying linearly to 0 over NEWNESS_WINDOW_DAYS. */
  newness: 20,
  reviewed: 10,
  needsFollowUp: -10,
  /**
   * Applied once per better-ranked offer from the same provider. Without it a
   * provider that lists many near-identical free models (OpenRouter has
   * dozens) fills the whole first page on the big-lab bonus alone.
   */
  repeatProvider: -10,
} as const;

export const NEWNESS_WINDOW_DAYS = 30;

export type RankContext = {
  /**
   * The build date (YYYY-MM-DD) newness is measured from. Never the visitor's
   * clock: the prerendered and hydrated lists must agree (ADR 0001).
   */
  today: string;
  /**
   * Today's views for offers that cleared the hot floor (see hotViewCounts in
   * offerStats.ts). Absent or empty until the counters load, and whenever
   * GoatCounter is unconfigured or blocked.
   */
  hotViews?: Readonly<Record<string, number>>;
};

const DAY_MS = 86_400_000;

function dayNumber(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms / DAY_MS;
}

export function isBigLab(provider: string): boolean {
  const name = provider
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return BIG_LAB_PROVIDERS.some(
    (lab) => name === lab || name.startsWith(`${lab} `),
  );
}

/** 1 on the add day, 0 from NEWNESS_WINDOW_DAYS on, and 0 when either date is unknown. */
export function newness(
  addedDate: string | null | undefined,
  today: string,
): number {
  const added = dayNumber(addedDate);
  const now = dayNumber(today);
  if (added === null || now === null) return 0;
  const age = Math.max(0, now - added);
  return Math.max(0, 1 - age / NEWNESS_WINDOW_DAYS);
}

function hotShare(
  slug: string,
  hotViews: Readonly<Record<string, number>>,
  maxViews: number,
): number {
  const views = hotViews[slug];
  if (typeof views !== "number" || views <= 0 || maxViews <= 0) return 0;
  return views / maxViews;
}

/** The weighted score before the repeat-provider step. */
export function baseScore(
  offer: Offer,
  ctx: RankContext,
  maxHotViews = 0,
): number {
  let score =
    RANK_WEIGHTS.hot * hotShare(offer.slug, ctx.hotViews ?? {}, maxHotViews);
  if (isBigLab(offer.provider)) score += RANK_WEIGHTS.bigLab;
  if (offer.category === "coding") score += RANK_WEIGHTS.coding;
  else if (offer.category === "api_provider") score += RANK_WEIGHTS.apiProvider;
  score += RANK_WEIGHTS.newness * newness(offer.added_date, ctx.today);
  if (offer.review_status === "verified") score += RANK_WEIGHTS.reviewed;
  else if (offer.review_status === "to-be-verified") {
    score += RANK_WEIGHTS.needsFollowUp;
  }
  return score;
}

/**
 * Highest score first; equal scores keep their order in `offers`, which is
 * the build's newest-added order, so the result is deterministic.
 */
export function rankOffers(
  offers: readonly Offer[],
  ctx: RankContext,
): Offer[] {
  const hotViews = ctx.hotViews ?? {};
  const maxHotViews = Math.max(0, ...Object.values(hotViews));
  const rows = offers.map((offer, index) => ({
    offer,
    index,
    score: baseScore(offer, ctx, maxHotViews),
  }));
  const byScore = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    b.score - a.score || a.index - b.index;
  const placed = new Map<string, number>();
  for (const row of [...rows].sort(byScore)) {
    const provider = row.offer.provider.trim().toLowerCase();
    const ahead = placed.get(provider) ?? 0;
    row.score += ahead * RANK_WEIGHTS.repeatProvider;
    placed.set(provider, ahead + 1);
  }
  return rows.sort(byScore).map((row) => row.offer);
}
