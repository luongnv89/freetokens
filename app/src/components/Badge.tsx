import { TAG_ICONS } from "../lib/tagIcons";
import {
  CATEGORY_LABELS,
  SIGNUP_LABELS,
  SIGNUP_TITLES,
  VERIFICATION_LABELS,
  VERIFICATION_TITLES,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_TITLES,
  type Offer,
} from "../lib/offers";

function tagIcon(value: string) {
  if (!(value in TAG_ICONS)) return null;
  return (
    <svg
      className="tag-i"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <use href={`#ti-${value}`} />
    </svg>
  );
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
  dimension: "category" | "verification" | "signup";
  value: string;
  label: string;
  title?: string;
  hrefPrefix?: string;
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
  );
}

export function CategoryBadge({
  offer,
  hrefPrefix,
}: {
  offer: Offer;
  hrefPrefix?: string;
}) {
  const label = CATEGORY_LABELS[offer.category] ?? offer.category;
  return (
    <TagLinkBadge
      dimension="category"
      value={offer.category}
      label={label}
      title={`Free AI credits in the ${label} category`}
      hrefPrefix={hrefPrefix}
    />
  );
}

export function VerificationBadge({
  offer,
  hrefPrefix,
}: {
  offer: Offer;
  hrefPrefix?: string;
}) {
  return (
    <TagLinkBadge
      dimension="verification"
      value={offer.verification}
      label={VERIFICATION_LABELS[offer.verification]}
      title={VERIFICATION_TITLES[offer.verification]}
      hrefPrefix={hrefPrefix}
    />
  );
}

const REVIEW_STATUS_ICONS: Record<string, string> = {
  verified: "review_verified",
  unverified: "unverified",
  "under-review": "expired",
};

export function ReviewStatusBadge({ offer }: { offer: Offer }) {
  const status = offer.review_status;
  return (
    <span
      className={`badge badge-review-status badge-review-status-${status}`}
      title={REVIEW_STATUS_TITLES[status] ?? status}
    >
      {tagIcon(REVIEW_STATUS_ICONS[status] ?? "unverified")}
      <span>{REVIEW_STATUS_LABELS[status] ?? status}</span>
    </span>
  );
}

export function SignupBadge({
  offer,
  hrefPrefix,
}: {
  offer: Offer;
  hrefPrefix?: string;
}) {
  return (
    <TagLinkBadge
      dimension="signup"
      value={offer.signup}
      label={SIGNUP_LABELS[offer.signup]}
      title={SIGNUP_TITLES[offer.signup]}
      hrefPrefix={hrefPrefix}
    />
  );
}

export function ExpiredBadge() {
  return (
    <span className="badge badge-expired">
      {tagIcon("expired")}
      <span>Expired</span>
    </span>
  );
}

/**
 * "Hot today" (#282): the most-viewed offer of the current day, ranked from
 * the same public GoatCounter counters the rows already read. GoatCounter
 * windows by calendar DATE, so a rolling last-24h figure is not expressible —
 * the badge says "today" because that is what it can honestly mean. The flame
 * is drawn inline rather than through the tag sprite: it is not a filterable
 * tag, and the sprite is a fixed, budgeted set. As everywhere else the word
 * carries the meaning, the glyph repeats it, and `title` explains it.
 */
export function HotBadge() {
  return (
    <span
      className="badge badge-hot"
      title="Among today's most-viewed offers; updates a few times a day"
    >
      <svg
        className="tag-i"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M13.2 2c.4 3.1-1 4.9-2.6 6.6C9 10.3 7.5 12 7.5 14.6a6.5 6.5 0 0 0 13 0c0-2.5-1.2-4.2-2.4-5.8-.6 1-1.4 1.7-2.2 2 .5-3.6-1-6.5-2.7-8.8Zm-.5 12c1 .9 1.6 1.9 1.6 3a2.3 2.3 0 0 1-4.6 0c0-1.3.9-2.1 1.7-3 .3.5.7.9 1.3 1.2.2-.4.2-.8 0-1.2Z" />
      </svg>
      <span>Hot today</span>
    </span>
  );
}
