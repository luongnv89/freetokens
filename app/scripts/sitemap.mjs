// Sitemap generation for the static build. The URL set includes every page
// emitted by prerender, including expired offer pages, plus the RSS feed.
// Metadata dates are normalized to UTC calendar dates so the output remains
// valid for search engines even when a fallback file timestamp is used.

import { DEFAULT_BASE_URL } from "./feed.mjs"

export const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"
export const MAX_SITEMAP_URLS = 50_000
export const MAX_SITEMAP_LOC_LENGTH = 2_048
export const MAX_SITEMAP_XML_BYTES = 50 * 1024 * 1024

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function toUtcDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  if (typeof value !== "string") return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return isCalendarDate(value) ? value : null
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const calendarDate = value.slice(0, 10)
    if (!isCalendarDate(calendarDate)) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function todayUtc(now) {
  const date = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(date.getTime())) throw new Error("sitemap clock must be a valid date")
  return date.toISOString().slice(0, 10)
}

function safeLastmod(value, today) {
  const date = toUtcDate(value)
  if (!date) return null
  return date > today ? today : date
}

function fileMtime(fileMtimes, slug) {
  if (fileMtimes instanceof Map) return fileMtimes.get(slug)
  if (fileMtimes && typeof fileMtimes === "object") return fileMtimes[slug]
  return undefined
}

function xml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;")
}

function normalizeBaseUrl(baseUrl) {
  const rawBaseUrl = String(baseUrl || DEFAULT_BASE_URL).trim()
  let base
  try {
    base = new URL(rawBaseUrl)
  } catch {
    throw new Error(
      `sitemap base URL must be an absolute HTTP(S) URL, got ${JSON.stringify(rawBaseUrl)}`,
    )
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    !base.hostname ||
    base.search ||
    base.hash ||
    base.username ||
    base.password ||
    base.href.includes("?") ||
    base.href.includes("#")
  ) {
    throw new Error(
      `sitemap base URL must be an absolute HTTP(S) URL without query, fragment, or userinfo, got ${JSON.stringify(rawBaseUrl)}`,
    )
  }
  return base.href.replace(/\/+$/, "")
}

/**
 * Build a sitemap URL set from the same index that drives prerendering.
 *
 * @param {object} index generated offers.json data
 * @param {string} baseUrl absolute site URL
 * @param {object} options optional { now, fileMtimes, maxXmlBytes } test/build fallbacks
 */
export function buildSitemap(index, baseUrl = DEFAULT_BASE_URL, options = {}) {
  if (!Array.isArray(index?.offers)) {
    throw new Error("offers.json offers must be an array")
  }
  const today = todayUtc(options.now ?? new Date())
  const generatedDate = safeLastmod(index.generated_at, today)
  if (!generatedDate) {
    throw new Error("offers.json generated_at must be a valid date")
  }

  const base = normalizeBaseUrl(baseUrl)
  const fixedEntries = [
    { path: "/", lastmod: generatedDate },
    { path: "/archive.html", lastmod: generatedDate },
    { path: "/privacy.html", lastmod: generatedDate },
    { path: "/feed.xml", lastmod: generatedDate },
  ]
  if (fixedEntries.length + index.offers.length > MAX_SITEMAP_URLS) {
    throw new Error(
      `sitemap contains ${fixedEntries.length + index.offers.length} URLs; ` +
        `maximum is ${MAX_SITEMAP_URLS}`,
    )
  }

  const entries = [
    ...fixedEntries,
    ...index.offers.map((offer) => {
      const slug = String(offer.slug ?? "").trim()
      if (!slug) throw new Error("offers.json offer is missing a slug")
      const lastmod =
        safeLastmod(offer.verified_date, today) ??
        safeLastmod(fileMtime(options.fileMtimes, slug), today) ??
        generatedDate
      return { path: `/offers/${slug}.html`, lastmod }
    }),
  ]
  const body = entries
    .map(({ path, lastmod }) => {
      const loc = `${base}${path}`
      if (loc.length >= MAX_SITEMAP_LOC_LENGTH) {
        throw new Error(
          `sitemap location is ${loc.length} characters; ` +
            `maximum is ${MAX_SITEMAP_LOC_LENGTH - 1}`,
        )
      }
      return `  <url>\n    <loc>${xml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`
    })
    .join("\n")

  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<urlset xmlns="${SITEMAP_NAMESPACE}">\n` +
    `${body}\n` +
    "</urlset>\n"
  const xmlBytes = Buffer.byteLength(sitemap, "utf8")
  const maxXmlBytes = options.maxXmlBytes ?? MAX_SITEMAP_XML_BYTES
  if (xmlBytes > maxXmlBytes) {
    throw new Error(
      `sitemap XML is ${xmlBytes} bytes; maximum is ${maxXmlBytes}`,
    )
  }
  return sitemap
}
