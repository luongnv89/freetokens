// Parity layer with scripts/build.py detail documents (issue #128):
// types, required-key enforcement, fallback claim steps, asset prefixing,
// and the 160-char meta-description truncation the Python builder uses.

export const DETAIL_TYPES = ["x", "reddit", "screenshot", "link"] as const
export type ProofType = (typeof DETAIL_TYPES)[number]

export const PROOF_REQUIRED: Record<ProofType, readonly string[]> = {
  x: ["author", "text"],
  reddit: ["author", "text"],
  screenshot: ["image", "caption"],
  link: ["title"],
}

export const PROOF_LINK_LABELS: Record<Exclude<ProofType, "screenshot">, string> = {
  x: "View post on X",
  reddit: "View on Reddit",
  link: "Open source",
}

/** build.py `_FALLBACK_STEPS` — used when claim_steps is absent or empty. */
export const FALLBACK_STEPS = [
  "Open the official offer page.",
  "Create a free account or sign in.",
  "The free credit applies per the terms shown there.",
] as const

export const META_DESCRIPTION_MAX = 160

export type ProofX = {
  type: "x"
  url: string
  author: string
  text: string
  handle?: string
}

export type ProofReddit = {
  type: "reddit"
  url: string
  author: string
  text: string
  community?: string
}

export type ProofScreenshot = {
  type: "screenshot"
  image: string
  caption: string
}

export type ProofLink = {
  type: "link"
  url: string
  title: string
  text?: string
}

export type SocialProof = ProofX | ProofReddit | ProofScreenshot | ProofLink

export type OfferDetail = {
  summary?: string
  claim_steps?: string[]
  social_proof?: SocialProof[]
}

export type DetailsMap = Record<string, OfferDetail>

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isHttpUrl(value: unknown): value is string {
  return nonEmptyString(value) && (value.startsWith("http://") || value.startsWith("https://"))
}

/**
 * Runtime guard matching build.py `_validate_proof` required keys.
 * Invalid or incomplete entries are dropped at render time so a bad
 * proof cannot break the detail layout.
 */
export function isRenderableProof(entry: unknown): entry is SocialProof {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
  const rec = entry as Record<string, unknown>
  const kind = rec.type
  if (kind === "screenshot") {
    const image = rec.image
    if (!nonEmptyString(image) || !nonEmptyString(rec.caption)) return false
    if (image.startsWith("http://") || image.startsWith("https://") || image.startsWith("/")) {
      return false
    }
    if (image.split("/").includes("..")) return false
    return true
  }
  if (kind === "x" || kind === "reddit") {
    return isHttpUrl(rec.url) && nonEmptyString(rec.author) && nonEmptyString(rec.text)
  }
  if (kind === "link") {
    return isHttpUrl(rec.url) && nonEmptyString(rec.title)
  }
  return false
}

export function renderableProofs(entries: unknown): SocialProof[] {
  if (!Array.isArray(entries)) return []
  return entries.filter(isRenderableProof)
}

/** build.py `_resolve_asset`: prefix a page-relative src for depth-1 pages. */
export function resolveAsset(src: string, relPrefix = "../"): string {
  if (!relPrefix || src.startsWith("../") || src.startsWith("./") || src.startsWith("/") || src.includes("://")) {
    return src
  }
  return `${relPrefix}${src}`
}

export function claimSteps(detail?: OfferDetail | null): readonly string[] {
  const steps = detail?.claim_steps
  return steps && steps.length > 0 ? steps : FALLBACK_STEPS
}

/**
 * build.py `render_offer_html` blurb: summary truncated at 160 chars
 * (`[:157].rstrip() + "..."`), else the generic amount/provider line.
 */
export function offerMetaDescription(
  offer: { amount: string; provider: string },
  detail?: OfferDetail | null,
): string {
  const summary = detail?.summary ?? ""
  if (summary) {
    return summary.length > META_DESCRIPTION_MAX
      ? summary.slice(0, 157).trimEnd() + "..."
      : summary
  }
  return (
    `${offer.amount} from ${offer.provider} — free AI credits, ` +
    "tagged by verification level and sign-up need."
  )
}
