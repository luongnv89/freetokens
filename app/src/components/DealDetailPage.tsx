import { humanDate, type OffersIndex } from "../lib/offers";
import {
  DEAL_CATEGORY_LABELS,
  OCCASION_LABELS,
  dealHost,
  dealsOf,
  type Deal,
} from "../lib/deals";
import { DealBadge, DiscountBadge, FeaturedBadge } from "./Badge";
import { Breadcrumbs } from "./Breadcrumbs";
import { DealBanner } from "./DealsPage";
import { IconSprite } from "./OfferRow";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { StructuredData } from "./StructuredData";

/** Other running deals in the loader's order: featured first, then soonest-ending. */
function OtherDeals({ current, deals }: { current: Deal; deals: Deal[] }) {
  const others = deals.filter((d) => d.slug !== current.slug).slice(0, 4);
  if (others.length === 0) return null;
  return (
    <nav className="od-related" aria-labelledby="od-related-head">
      <h2 id="od-related-head">More deals</h2>
      <ul className="od-related-list">
        {others.map((deal) => (
          <li key={deal.slug} className="od-related-card">
            <span className="od-related-prov">{deal.provider}</span>
            <a
              className="od-related-title"
              href={`${deal.slug}.html`}
              aria-label={`View details for ${deal.title}`}
            >
              {deal.title}
            </a>
            <span className="od-related-amount">{deal.discount}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{children}</td>
    </tr>
  );
}

/**
 * One deal's own page (#809), at deals/<slug>.html. The OfferDetailPage
 * skeleton — masthead, status line, facts rail, prose body, related cards —
 * filled with deal fields: the discount badge and end date lead, and the
 * rail repeats that a deal is not free. The vendor button carries no
 * data-ft-offer-* hooks, so deals stay out of offer_click attribution.
 */
export default function DealDetailPage({
  index,
  slug,
  baseUrl,
}: {
  index: OffersIndex;
  slug: string;
  baseUrl?: string;
}) {
  const deals = dealsOf(index);
  const deal = deals.find((d) => d.slug === slug);
  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
          <SiteHeader depth={1} current="deals" pageViews={false} />
          <Breadcrumbs
            page="deal"
            slug={deal?.slug ?? slug}
            title={deal?.title ?? "Deal not found"}
            baseUrl={baseUrl}
          />
          {deal ? (
            <article className="offer-detail deal-detail">
              <p className="od-back">
                <a href="../deals.html">&larr; All deals</a>
              </p>
              <header className="masthead masthead-offer">
                <p className="kicker">
                  <DealBadge />
                  {deal.featured ? <FeaturedBadge /> : null}
                </p>
                <h1>{deal.title}</h1>
                <p className="count">{deal.provider}</p>
              </header>
              <div className="od-hero">
                <div className="od-hero-metrics">
                  <DiscountBadge discount={deal.discount} />
                </div>
                <p className="od-statusline mono">
                  <span className="status deal-ends">
                    ends{" "}
                    <time dateTime={deal.expiry_date}>
                      {humanDate(deal.expiry_date)}
                    </time>
                  </span>
                  <span className="sep" aria-hidden="true">
                    &middot;
                  </span>
                  {OCCASION_LABELS[deal.occasion]}
                  <span className="sep" aria-hidden="true">
                    &middot;
                  </span>
                  checked{" "}
                  <time dateTime={deal.verified_date}>
                    {humanDate(deal.verified_date)}
                  </time>
                </p>
              </div>
              <aside className="od-rail" aria-label="Deal summary">
                <a
                  className="od-cta"
                  href={deal.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get the deal at {dealHost(deal.source_url)}{" "}
                  <span aria-hidden="true">&#8599;</span>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                <DealBanner />
                <section className="od-facts" aria-label="Key deal details">
                  <h2>Details</h2>
                  <table className="od-table">
                    <tbody>
                      <Row label="Vendor">{deal.provider}</Row>
                      <Row label="Discount">
                        <span className="mono od-amount">{deal.discount}</span>
                      </Row>
                      {deal.regular_price ? (
                        <Row label="Regular price">{deal.regular_price}</Row>
                      ) : null}
                      {deal.deal_price ? (
                        <Row label="Deal price">{deal.deal_price}</Row>
                      ) : null}
                      {deal.promo_code ? (
                        <Row label="Promo code">
                          <code>{deal.promo_code}</code>
                        </Row>
                      ) : null}
                      <Row label="Occasion">
                        {OCCASION_LABELS[deal.occasion]}
                      </Row>
                      <Row label="Category">
                        {DEAL_CATEGORY_LABELS[deal.category]}
                      </Row>
                      {deal.start_date ? (
                        <Row label="Starts">
                          <time dateTime={deal.start_date}>
                            {humanDate(deal.start_date)}
                          </time>
                        </Row>
                      ) : null}
                      <Row label="Ends">
                        <time dateTime={deal.expiry_date}>
                          {humanDate(deal.expiry_date)}
                        </time>
                      </Row>
                      <Row label="Last checked">
                        <time dateTime={deal.verified_date}>
                          {humanDate(deal.verified_date)}
                        </time>
                      </Row>
                    </tbody>
                  </table>
                </section>
              </aside>
              <div className="od-body">
                <section className="od-brief">
                  <h2>The deal</h2>
                  <p className="od-summary">
                    {deal.description ??
                      `${deal.discount} on ${deal.provider}, as stated on the vendor's page.`}
                  </p>
                </section>
                {deal.expiry_note ? (
                  <section className="od-brief">
                    <h2>About the end date</h2>
                    <p>{deal.expiry_note}</p>
                  </section>
                ) : null}
              </div>
              <OtherDeals current={deal} deals={deals} />
            </article>
          ) : (
            <section
              className="empty"
              style={{ "--i": 0 } as React.CSSProperties}
            >
              <h2>Deal not found</h2>
              <p>
                No running deal lives at this address. Deals are removed after
                their end date.
              </p>
              <p>
                <a href="../deals.html">See current deals</a> or{" "}
                <a href="../index.html">browse the free offers</a>.
              </p>
            </section>
          )}
        </main>
        <SiteFooter depth={1} current="deals" />
      </div>
      <StructuredData page="deal" deal={deal ?? null} baseUrl={baseUrl} />
    </>
  );
}
