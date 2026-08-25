import {
  CATEGORY_LABELS,
  SIGNUP_LABELS,
  SIGNUP_TITLES,
  VERIFICATION_LABELS,
  VERIFICATION_TITLES,
  amountSortValue,
  formatAmountSort,
  humanDate,
  relativeDate,
  type Offer,
} from "../lib/offers"
import { TAG_ICONS } from "../lib/tagIcons"
import { Badge } from "./ui/badge"

// Tag glyphs ship as ONE inline <symbol> sprite per page, referenced by
// <use> — mirrors build.py _icon_sprite/_SYMBOL so rows keep the same
// same-document, zero-request icon mechanism.
export function IconSprite() {
  return (
    <svg className="tag-sprite" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {Object.entries(TAG_ICONS).map(([name, paths]) => (
          <symbol
            key={name}
            id={`ti-${name}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: paths }}
          />
        ))}
      </defs>
    </svg>
  )
}

function tagIcon(value: string) {
  if (!(value in TAG_ICONS)) return null
  return (
    <svg className="tag-i" aria-hidden="true" focusable="false">
      <use href={`#ti-${value}`} />
    </svg>
  )
}

// Interactive affordance on the home listing (build.py _tag interactive=True):
// a real <button> that toggles the filter in place once the client runtime
// lands (Sprint 2); the prerendered markup already carries the full contract.
function TagButton({
  dimension,
  value,
  label,
  title,
}: {
  dimension: string
  value: string
  label: string
  title: string
}) {
  return (
    <Badge asChild variant="unstyled">
      <button
        type="button"
        className={`badge badge-${dimension} badge-${dimension}-${value}`}
        data-ft-tag={dimension}
        data-ft-tag-value={value}
        aria-pressed="false"
        aria-label={`Filter by ${label}`}
        title={title}
      >
        {tagIcon(value)}
        <span>{label}</span>
      </button>
    </Badge>
  )
}

/**
 * One ranked mono row — mirrors build.py _CARD_TMPL exactly: same <li>
 * <article> nesting, same data-* hooks, CSS-counter rank drawn by #ft-grid.
 */
export function OfferRow({ offer, index, buildDay }: { offer: Offer; index: number; buildDay: string }) {
  const detailHref = `offers/${offer.slug}.html`
  return (
    <li style={{ "--i": index } as React.CSSProperties}>
      <article
        className="card"
        id={`offer-${offer.slug}`}
        data-category={offer.category}
        data-verification={offer.verification}
        data-signup={offer.signup}
        data-verified={offer.verified_date}
        data-expiry={offer.expiry_date ?? ""}
        data-amount-sort={formatAmountSort(amountSortValue(offer.amount))}
      >
        <div className="row-head">
          <h2 className="card-title">
            <a
              href={detailHref}
              data-ft-offer-id={offer.slug}
              data-ft-provider={offer.provider}
              data-ft-offer-category={offer.category}
              aria-label={`View details for ${offer.title}`}
            >
              {offer.title}
            </a>
          </h2>
          <span className="r-amount">{offer.amount}</span>
        </div>
        <p className="row-meta">
          <TagButton
            dimension="category"
            value={offer.category}
            label={CATEGORY_LABELS[offer.category] ?? offer.category}
            title={`Free AI credits in the ${CATEGORY_LABELS[offer.category] ?? offer.category} category`}
          />
          <TagButton
            dimension="verification"
            value={offer.verification}
            label={VERIFICATION_LABELS[offer.verification]}
            title={VERIFICATION_TITLES[offer.verification]}
          />
          <TagButton
            dimension="signup"
            value={offer.signup}
            label={SIGNUP_LABELS[offer.signup]}
            title={SIGNUP_TITLES[offer.signup]}
          />
          <span className="sep" aria-hidden="true">
            &middot;
          </span>
          <span className="r-prov">{offer.provider}</span>
          <span className="sep" aria-hidden="true">
            &middot;
          </span>
          {offer.expiry_date ? (
            <span className="status">
              expires{" "}
              <time dateTime={offer.expiry_date}>{humanDate(offer.expiry_date)}</time>
            </span>
          ) : (
            <span className="status">
              <span className="dot" aria-hidden="true"></span>ongoing
            </span>
          )}
          <span className="sep" aria-hidden="true">
            &middot;
          </span>
          <span className="r-vfd" title={`verified ${humanDate(offer.verified_date)}`}>
            verified{" "}
            <time dateTime={offer.verified_date}>
              {relativeDate(offer.verified_date, buildDay)}
            </time>
          </span>
          <span className="sep" aria-hidden="true">
            &middot;
          </span>
          <a className="r-details" href={detailHref}>
            details
          </a>
        </p>
      </article>
    </li>
  )
}
