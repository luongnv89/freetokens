import { TAG_ICONS } from "../lib/tagIcons"
import {
  CATEGORY_LABELS,
  SIGNUP_LABELS,
  SIGNUP_TITLES,
  VERIFICATION_LABELS,
  VERIFICATION_TITLES,
  type Offer,
} from "../lib/offers"

function tagIcon(value: string) {
  if (!(value in TAG_ICONS)) return null
  return (
    <svg className="tag-i" aria-hidden="true" focusable="false">
      <use href={`#ti-${value}`} />
    </svg>
  )
}

/**
 * Non-interactive tag affordance (build.py _tag interactive=False): an
 * <a> back to the home listing with the filter pre-applied. Used on every
 * page that ships no filter runtime — a button there would be a dead
 * control, and a link is honest about navigating.
 */
export function TagLinkBadge({
  dimension,
  value,
  label,
  title,
  hrefPrefix = "",
}: {
  dimension: "category" | "verification" | "signup"
  value: string
  label: string
  title?: string
  hrefPrefix?: string
}) {
  return (
    <a
      className={`badge badge-${dimension} badge-${dimension}-${value}`}
      href={`${hrefPrefix}index.html?${dimension}=${encodeURIComponent(value)}`}
      aria-label={`See offers tagged ${label}`}
      title={title}
    >
      {tagIcon(value)}
      <span>{label}</span>
    </a>
  )
}

export function CategoryBadge({ offer, hrefPrefix }: { offer: Offer; hrefPrefix?: string }) {
  const label = CATEGORY_LABELS[offer.category] ?? offer.category
  return (
    <TagLinkBadge
      dimension="category"
      value={offer.category}
      label={label}
      title={`Free AI credits in the ${label} category`}
      hrefPrefix={hrefPrefix}
    />
  )
}

export function VerificationBadge({ offer, hrefPrefix }: { offer: Offer; hrefPrefix?: string }) {
  return (
    <TagLinkBadge
      dimension="verification"
      value={offer.verification}
      label={VERIFICATION_LABELS[offer.verification]}
      title={VERIFICATION_TITLES[offer.verification]}
      hrefPrefix={hrefPrefix}
    />
  )
}

export function SignupBadge({ offer, hrefPrefix }: { offer: Offer; hrefPrefix?: string }) {
  return (
    <TagLinkBadge
      dimension="signup"
      value={offer.signup}
      label={SIGNUP_LABELS[offer.signup]}
      title={SIGNUP_TITLES[offer.signup]}
      hrefPrefix={hrefPrefix}
    />
  )
}

export function ExpiredBadge() {
  return (
    <span className="badge badge-expired">
      {tagIcon("expired")}
      <span>Expired</span>
    </span>
  )
}
