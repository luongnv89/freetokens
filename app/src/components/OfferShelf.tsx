import type { ReactNode } from "react";
import { CATEGORY_LABELS, type Offer } from "../lib/offers";

/**
 * A build-time home shelf (#611 "New this week", #612 "Always free"): a short
 * strip of offer pills above the toolbar, next to the "Most viewed today"
 * HotDeals strip and wearing the same pill styles (`.hot-deal*` in
 * python-parity.css).
 *
 * Unlike HotDeals, every input here is build data — the index and the build
 * date — so the shelf is part of the prerendered HTML and the hydrated view
 * renders exactly the same rows (ADR 0001: never the visitor's clock).
 *
 * It renders nothing at all when there are no rows: an empty shelf is noise.
 * Each pill links to the offer's detail page with the same data-ft-* hooks
 * as HotDeals and the list rows, so clicks reuse the existing offer_click
 * event and its properties — no new analytics fields.
 */
export function OfferShelf({
  id,
  title,
  sub,
  offers,
  meta,
  more,
}: {
  /** Stable id stem; the heading gets `${id}-heading` for aria-labelledby. */
  id: string;
  title: string;
  sub?: ReactNode;
  offers: readonly Offer[];
  /** Short per-pill note after the category, e.g. an age. */
  meta?: (offer: Offer) => ReactNode;
  /** Optional trailing "see all" link. */
  more?: { href: string; label: string };
}) {
  if (offers.length === 0) return null;
  const headingId = `${id}-heading`;
  return (
    <section
      className="hot-deals offer-shelf"
      id={id}
      aria-labelledby={headingId}
    >
      <h2 className="hot-deals-head" id={headingId}>
        <span className="hot-deals-title">{title}</span>
        {sub ? <span className="hot-deals-sub">{sub}</span> : null}
      </h2>
      <ul className="hot-deals-list">
        {offers.map((offer) => {
          const note = meta?.(offer);
          return (
            <li
              key={offer.slug}
              className="hot-deal"
              data-category={offer.category}
            >
              <span className="hot-prov">{offer.provider}</span>
              <a
                className="hot-title"
                href={`offers/${offer.slug}.html`}
                data-ft-offer-id={offer.slug}
                data-ft-provider={offer.provider}
                data-ft-offer-category={offer.category}
              >
                {offer.title}
              </a>
              <span className="hot-meta">
                <span className="hot-cat">
                  {CATEGORY_LABELS[offer.category] ?? offer.category}
                </span>
                {note ? (
                  <>
                    <span className="hot-sep" aria-hidden="true">
                      &middot;
                    </span>
                    {note}
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {/* The see-all link borrows the strip's small gray sub-heading style
          (and the browser underline) instead of adding CSS: the stylesheet
          sits at its byte budget (tests/css-budget.test.mjs, #121). */}
      {more ? (
        <a className="hot-deals-sub shelf-more" href={more.href}>
          {more.label}
        </a>
      ) : null}
    </section>
  );
}
