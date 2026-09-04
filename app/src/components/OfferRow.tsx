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
} from "../lib/offers";
import { TAG_ICONS } from "../lib/tagIcons";
import { ftFormatCount } from "../lib/analytics";
import type { FilterDimension } from "../lib/urlState";
import { Badge } from "./ui/badge";
import { HotBadge, ReviewStatusBadge } from "./Badge";

// Tag glyphs ship as ONE inline <symbol> sprite per page, referenced by
// <use> — mirrors build.py _icon_sprite/_SYMBOL so rows keep the same
// same-document, zero-request icon mechanism.
export function IconSprite() {
  return (
    <svg
      className="tag-sprite"
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
    >
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
  );
}

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

// Interactive affordance on the home listing (build.py _tag interactive=True):
// a real <button> that toggles the filter in place. Markup is identical for
// every tag family; how loudly a family is painted is decided in CSS, per row
// zone — see `.row-quiet .badge` in python-parity.css.
function TagButton({
  dimension,
  value,
  label,
  title,
  pressed,
  onToggle,
}: {
  dimension: FilterDimension;
  value: string;
  label: string;
  title: string;
  pressed: boolean;
  onToggle: (dim: FilterDimension, value: string) => void;
}) {
  return (
    <Badge asChild variant="unstyled">
      <button
        type="button"
        className={`badge badge-${dimension} badge-${dimension}-${value}`}
        data-ft-tag={dimension}
        data-ft-tag-value={value}
        aria-pressed={pressed ? "true" : "false"}
        aria-label={`Filter by ${label}`}
        title={title}
        onClick={() => onToggle(dimension, value)}
      >
        {tagIcon(value)}
        <span>{label}</span>
      </button>
    </Badge>
  );
}

/**
 * One ledger row. The article is a four-area grid — eyebrow, title, amount,
 * quiet filters — with a fixed right rail carrying status, freshness and the
 * row's controls. The fixed rail is what gives 47 rows a shared baseline:
 * before it, Save/Hide flowed inside the meta paragraph and wrapped at a
 * different point on every row, so no two rows were the same height.
 *
 * Which signals are painted is a deliberate ration. `verification` is
 * social_proof on 47 of 47 live offers and `signup` is required on 47 of 47 —
 * as coloured badges they were pure texture, so they render as quiet filter
 * text. They stay real buttons with their aria-pressed state and data-ft-tag
 * hooks, so filtering by them is unchanged. Category and review status are
 * the two that actually vary, and they keep their hue.
 */
export function OfferRow({
  offer,
  index,
  buildDay,
  pressed,
  onToggleTag,
  saved = false,
  onToggleSave,
  onDismiss,
  views = null,
  hot = false,
}: {
  offer: Offer;
  index: number;
  buildDay: string;
  pressed: { category: string; verification: string; signup: string };
  onToggleTag: (dim: FilterDimension, value: string) => void;
  saved?: boolean;
  onToggleSave?: (slug: string) => void;
  onDismiss?: (slug: string) => void;
  views?: number | null;
  hot?: boolean;
}) {
  const detailHref = `offers/${offer.slug}.html`;
  return (
    // `data-category` is mirrored onto the <li> as well as the <article>: the
    // row's left hue spine is drawn as an ::after on the list item, which is
    // the article's PARENT, and a custom property set on the article could
    // never reach it. The article keeps its own copy — tests and the archive
    // read the category from there.
    // `style` stays the FIRST attribute: App.test.tsx counts rows by matching
    // the literal `<li style`, and React emits attributes in prop order.
    <li
      style={{ "--i": index } as React.CSSProperties}
      data-category={offer.category}
    >
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
        <p className="row-eyebrow">
          <span className="r-prov">{offer.provider}</span>
          <TagButton
            dimension="category"
            value={offer.category}
            label={CATEGORY_LABELS[offer.category] ?? offer.category}
            title={`Free AI credits in the ${CATEGORY_LABELS[offer.category] ?? offer.category} category`}
            pressed={pressed.category === offer.category}
            onToggle={onToggleTag}
          />
          <ReviewStatusBadge offer={offer} />
          {hot ? <HotBadge /> : null}
        </p>
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
        <p className="r-amount">{offer.amount}</p>
        <p className="row-meta row-quiet">
          <TagButton
            dimension="verification"
            value={offer.verification}
            label={VERIFICATION_LABELS[offer.verification]}
            title={VERIFICATION_TITLES[offer.verification]}
            pressed={pressed.verification === offer.verification}
            onToggle={onToggleTag}
          />
          <span className="sep" aria-hidden="true">
            &middot;
          </span>
          <TagButton
            dimension="signup"
            value={offer.signup}
            label={SIGNUP_LABELS[offer.signup]}
            title={SIGNUP_TITLES[offer.signup]}
            pressed={pressed.signup === offer.signup}
            onToggle={onToggleTag}
          />
        </p>
        <div className="row-rail">
          {offer.expiry_date ? (
            <span className="status">
              ends{" "}
              <time dateTime={offer.expiry_date}>
                {humanDate(offer.expiry_date)}
              </time>
            </span>
          ) : (
            <span className="status">
              <span className="dot" aria-hidden="true"></span>ongoing
            </span>
          )}
          <span
            className="r-vfd"
            title={`checked ${humanDate(offer.verified_date)}`}
          >
            checked{" "}
            <time dateTime={offer.verified_date}>
              {relativeDate(offer.verified_date, buildDay)}
            </time>
          </span>
          {typeof views === "number" && (
            <span className="ft-stat r-views">
              <strong>{ftFormatCount(views)}</strong>{" "}
              <span className="ft-stat-label">views</span>
            </span>
          )}
          <span className="r-actions">
            {onToggleSave && (
              <button
                type="button"
                className="chip r-save"
                data-ft-save={offer.slug}
                aria-pressed={saved ? "true" : "false"}
                aria-label={
                  saved
                    ? `Remove ${offer.title} from saved`
                    : `Save ${offer.title}`
                }
                onClick={() => onToggleSave(offer.slug)}
              >
                {saved ? "Saved" : "Save"}
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                className="chip r-dismiss"
                data-ft-dismiss={offer.slug}
                aria-label={`Hide ${offer.title} from the list`}
                onClick={() => onDismiss(offer.slug)}
              >
                Hide
              </button>
            )}
            <a
              className="r-details"
              href={detailHref}
              aria-label={`View details for ${offer.title}`}
            >
              Details
            </a>
          </span>
        </div>
      </article>
    </li>
  );
}
