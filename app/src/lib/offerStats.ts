import { useEffect, useState } from "react"
import { ftIsoDate, ftStatNumber, getStatsSite } from "./analytics"

export function gcOfferPath(slug: string): string {
  return `/offers/${slug}.html`
}

/**
 * GoatCounter public counter URL for one offer detail path.
 * Omit `days` (or pass null) for the all-time count — the unwindowed route,
 * byte-identical to what per-offer views have always used. When `days` is set
 * it counts calendar DAYS including today (1 = today alone); GoatCounter takes
 * dates, not timestamps, so a rolling 24h window is not expressible and we do
 * not pretend otherwise. `end` is exclusive midnight (#102), so the window
 * ends tomorrow. Never add a cache-buster: GoatCounter keys the CDN on
 * (path, start, end) only, and unknown params are stripped from that key.
 */
export function ftOfferViewsUrl(
  slug: string,
  site: string,
  days?: number | null,
  now: Date = new Date(),
): string {
  const base = `${site}/counter/${encodeURIComponent(gcOfferPath(slug))}.json`
  if (days == null) return base
  const span = Math.max(1, Math.floor(days))
  const end = new Date(now.getTime() + 86_400_000)
  const start = new Date(now.getTime() - (span - 1) * 86_400_000)
  return `${base}?start=${ftIsoDate(start)}&end=${ftIsoDate(end)}`
}

export async function fetchOfferViews(
  slugs: readonly string[],
  site: string,
  fetchImpl: typeof fetch = fetch,
  days?: number | null,
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {}
  if (!site || slugs.length === 0) return out
  await Promise.all(
    slugs.map(async (slug) => {
      out[slug] = null
      try {
        const res = await fetchImpl(ftOfferViewsUrl(slug, site, days))
        if (!res.ok) return
        out[slug] = ftStatNumber(await res.json())
      } catch {
        /* silent null — blocked, offline, malformed payload */
      }
    }),
  )
  return out
}

/**
 * Live per-offer view counts read from GoatCounter's public counter route at
 * page load — never baked in at build time. Every slug starts absent and only
 * appears once its fetch succeeds, so an unreachable GoatCounter simply hides
 * the numbers while the rest of the page works unchanged. Pass `days` for a
 * windowed count (1 = today so far); omit it for the all-time total.
 */
export function useOfferViews(
  slugs: readonly string[],
  days?: number | null,
): Record<string, number | null> {
  const [views, setViews] = useState<Record<string, number | null>>({})
  const site = getStatsSite()
  const key = slugs.join("\n")
  useEffect(() => {
    if (!site || typeof fetch !== "function" || key === "") return
    let cancelled = false
    fetchOfferViews(key.split("\n"), site, fetch, days)
      .then((next) => {
        if (!cancelled) setViews(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [site, key, days])
  return views
}

// "Hot today" ranking (#282). Deliberately conservative, because the input is
// weak: only consenting visitors are counted, the counter route sits behind a
// ~4h CDN cache, and blocked requests read as null. So a count must clear a
// floor of 3 before it can crown anything, and a tie wider than 3 offers is
// dropped entirely — a badge on half the list stops meaning "hot".
const HOT_MIN_VIEWS = 3
const HOT_MAX_TIED = 3

/**
 * The highlight section's ranking: the `limit` most-viewed offers, ordered,
 * highest first.
 *
 * Separate from `hottestSlugs` on purpose, and not a generalisation of it.
 * That function answers "which offers are tied at the top", and deliberately
 * returns NOTHING when the answer would be a wide tie, because it decides
 * whether a row gets a badge and a badge on half the list means nothing. This
 * one fills a fixed three-slot shelf, so it must rank rather than crown, and
 * a partial shelf is a fine outcome.
 *
 * What the two share is the floor: a count below HOT_MIN_VIEWS is not
 * evidence of anything. The input is weak — only consenting visitors are
 * counted, the counter route sits behind a multi-hour CDN cache, and blocked
 * requests read as null — so an offer with one view is noise, and promoting
 * it to the top of the page would be inventing a signal.
 *
 * Ties break on slug so the order is deterministic: without it two offers on
 * the same count could swap places between renders on the same data.
 */
export function topViewedSlugs(
  views: Record<string, number | null>,
  limit = 3,
): { slug: string; views: number }[] {
  return Object.entries(views)
    .filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && entry[1] >= HOT_MIN_VIEWS,
    )
    .sort(([slugA, a], [slugB, b]) => b - a || slugA.localeCompare(slugB))
    .slice(0, Math.max(0, limit))
    .map(([slug, count]) => ({ slug, views: count }))
}

export function hottestSlugs(views: Record<string, number | null>): ReadonlySet<string> {
  const empty: ReadonlySet<string> = new Set<string>()
  const counted = Object.entries(views).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  )
  if (counted.length === 0) return empty
  const max = Math.max(...counted.map(([, n]) => n))
  if (max < HOT_MIN_VIEWS) return empty
  const top = counted.filter(([, n]) => n === max).map(([slug]) => slug)
  if (top.length > HOT_MAX_TIED) return empty
  return new Set(top)
}
