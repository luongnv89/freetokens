// RSS 2.0 feed generation (F12 / #27), mirroring scripts/build.py build_feed
// exactly: active offers only, newest-verified-first with slug tiebreak,
// absolute channel/item links off --base-url (DEFAULT_BASE_URL by default)
// while every in-page href elsewhere stays relative.
// Mirrors scripts/build.py DEFAULT_BASE_URL / src/lib/site.ts.
export const DEFAULT_BASE_URL = "https://luongnv89.github.io/freetokens"

export const FEED_TITLE = "Free AI Credits — free AI credit offers, tagged by verification"
export const FEED_DESCRIPTION =
  "Newly published free AI credit offers from the freetokens directory, " +
  "each tagged with its verification level and sign-up requirement."

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const CATEGORY_LABELS = {
  api_provider: "API providers",
  coding: "Coding",
  image: "Image",
  voice: "Voice",
  video: "Video",
  startup_program: "Startup programs",
  student: "Student",
}

// html.escape(s, quote=True): & < > " and apostrophe as &#x27; (not &apos;).
function xml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;")
}

function parseISO(iso) {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso)
}

function rfc2822(dateOrDatetime) {
  const d = typeof dateOrDatetime === "string" ? parseISO(dateOrDatetime) : dateOrDatetime
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  const ss = String(d.getUTCSeconds()).padStart(2, "0")
  return `${DAYS[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, "0")} ` +
    `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm}:${ss} +0000`
}

function humanDate(iso) {
  const day = parseISO(iso)
  if (Number.isNaN(day.getTime())) return iso
  return `${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}, ${day.getUTCFullYear()}`
}

function itemDescription(offer) {
  const label = CATEGORY_LABELS[offer.category] ?? offer.category
  const expiry = offer.expiry_date ? `expires ${humanDate(offer.expiry_date)}` : "ongoing"
  return `${offer.amount} — ${label} · ${expiry}.`
}

export function buildFeed(index, baseUrl = DEFAULT_BASE_URL) {
  const base = baseUrl.trim().replace(/\/+$/, "")
  // Matches scripts/build.py active_offers: missing status defaults to active.
  const items = index.offers
    .filter((o) => o.status !== "expired")
    .sort((a, b) => (a.verified_date === b.verified_date
      ? a.slug < b.slug ? 1 : -1
      : a.verified_date < b.verified_date ? 1 : -1))
    .map((o) => {
      const anchor = `${base}/offers/${xml(o.slug)}.html`
      return (
        "<item>" +
        `<title>${xml(o.title)}</title>` +
        `<link>${anchor}</link>` +
        `<guid isPermaLink="true">${anchor}</guid>` +
        `<description>${xml(itemDescription(o))}</description>` +
        `<pubDate>${rfc2822(o.verified_date)}</pubDate>` +
        "</item>"
      )
    })
    .join("")
  const lastBuild = rfc2822(index.generated_at)
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    "<channel>\n" +
    `<title>${xml(FEED_TITLE)}</title>\n` +
    `<link>${xml(base + "/")}</link>\n` +
    `<description>${xml(FEED_DESCRIPTION)}</description>\n` +
    "<language>en</language>\n" +
    `<lastBuildDate>${lastBuild}</lastBuildDate>\n` +
    "<generator>freetokens static build</generator>\n" +
    `<atom:link href="${xml(base + "/feed.xml")}" rel="self" type="application/rss+xml" />\n` +
    items +
    "\n</channel>\n</rss>\n"
  )
}
