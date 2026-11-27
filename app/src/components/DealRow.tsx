import { humanDate, relativeDate } from "../lib/offers";
import { OCCASION_LABELS, dealHref, type Deal } from "../lib/deals";
import { DealBadge, DiscountBadge, FeaturedBadge } from "./Badge";

/**
 * One deal as a ledger row (#809): the OfferRow skeleton — eyebrow, title,
 * headline, quiet line, right rail — with the discount as the headline and
 * the end date in the rail. Deliberately absent: the offer filter tags,
 * Save / Hide, the apply prompt and every data-ft-offer-* hook, so a deal
 * never enters the free offers' offer_click attribution.
 */
export function DealRow({
  deal,
  index,
  buildDay,
}: {
  deal: Deal;
  index: number;
  /** Build date (YYYY-MM-DD): the "now" for the relative checked age. */
  buildDay: string;
}) {
  const detailHref = dealHref(deal.slug);
  return (
    // `style` first, like OfferRow (React emits attributes in prop order).
    <li
      style={{ "--i": index } as React.CSSProperties}
      data-deal={deal.slug}
      data-occasion={deal.occasion}
    >
      <article className="card deal-card" id={`deal-${deal.slug}`}>
        <p className="row-eyebrow">
          <span className="r-prov">{deal.provider}</span>
          <DealBadge />
          {deal.featured ? <FeaturedBadge /> : null}
        </p>
        <h2 className="card-title">
          <a href={detailHref} aria-label={`View details for ${deal.title}`}>
            {deal.title}
          </a>
        </h2>
        <p className="r-amount">
          <DiscountBadge discount={deal.discount} />
          {deal.deal_price ? (
            <span className="deal-price">
              {" "}
              {deal.deal_price}
              {deal.regular_price ? (
                <>
                  {" "}
                  <s aria-label={`regular price ${deal.regular_price}`}>
                    {deal.regular_price}
                  </s>
                </>
              ) : null}
            </span>
          ) : null}
        </p>
        <p className="row-meta row-quiet">
          <span>{OCCASION_LABELS[deal.occasion]}</span>
          {deal.promo_code ? (
            <>
              <span className="sep" aria-hidden="true">
                &middot;
              </span>
              <span>
                code <code>{deal.promo_code}</code>
              </span>
            </>
          ) : null}
        </p>
        <div className="row-rail">
          <span className="status deal-ends">
            ends{" "}
            <time dateTime={deal.expiry_date}>
              {humanDate(deal.expiry_date)}
            </time>
          </span>
          <span
            className="r-vfd"
            title={`checked ${humanDate(deal.verified_date)}`}
          >
            checked{" "}
            <time dateTime={deal.verified_date}>
              {relativeDate(deal.verified_date, buildDay)}
            </time>
          </span>
          <span className="r-actions">
            <a
              className="r-details"
              href={detailHref}
              aria-label={`View details for ${deal.title}`}
            >
              Details
            </a>
          </span>
        </div>
      </article>
    </li>
  );
}
