import { useEffect, useState } from "react"
import { ftStatNumber, getStatsSite } from "./analytics"

export function gcOfferPath(slug: string): string {
  return `/offers/${slug}.html`
}

export function ftOfferViewsUrl(slug: string, site: string): string {
  return `${site}/counter/${encodeURIComponent(gcOfferPath(slug))}.json`
}

export async function fetchOfferViews(
  slugs: readonly string[],
  site: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {}
  if (!site || slugs.length === 0) return out
  await Promise.all(
    slugs.map(async (slug) => {
      out[slug] = null
      try {
        const res = await fetchImpl(ftOfferViewsUrl(slug, site))
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
 * the numbers while the rest of the page works unchanged.
 */
export function useOfferViews(
  slugs: readonly string[],
): Record<string, number | null> {
  const [views, setViews] = useState<Record<string, number | null>>({})
  const site = getStatsSite()
  const key = slugs.join("\n")
  useEffect(() => {
    if (!site || typeof fetch !== "function" || key === "") return
    let cancelled = false
    fetchOfferViews(key.split("\n"), site)
      .then((next) => {
        if (!cancelled) setViews(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [site, key])
  return views
}
