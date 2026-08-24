import { humanDate, type OffersIndex } from "../lib/offers"
import { CategoryBadge, SignupBadge, VerificationBadge } from "./Badge"
import { IconSprite } from "./OfferRow"
import { SiteFooter } from "./SiteFooter"

/**
 * Offer detail page (F2 / #60) — placeholder shell (full content port is
 * task #128). Everything the shell shows is real data from the frozen
 * contract, server-rendered so a JS-off deep link to /offers/<slug>.html
 * renders the full document. An unknown slug renders the graceful
 * not-found state instead of throwing during hydration.
 */
export default function OfferDetailPage({ index, slug }: { index: OffersIndex; slug: string }) {
  const offer = index.offers.find((o) => o.slug === slug)
  return (
    <>
      <IconSprite />
      <div className="wrap">
        {offer ? (
          <article className="offer-detail">
            <p className="od-back">
              <a href="../index.html">&larr; All offers</a>
            </p>
            <header className="masthead masthead-offer">
              <p className="kicker">
                <CategoryBadge offer={offer} hrefPrefix="../" />
              </p>
              <h1>{offer.title}</h1>
              <p className="count">
                <strong>{offer.amount}</strong> &middot; {offer.provider}
              </p>
              <p className="od-statusline mono">
                {offer.status === "expired" ? (
                  <span className="status">ended</span>
                ) : offer.expiry_date ? (
                  <span className="status">
                    expires{" "}
                    <time dateTime={offer.expiry_date}>{humanDate(offer.expiry_date)}</time>
                  </span>
                ) : (
                  <span className="status">
                    <span className="dot" aria-hidden="true"></span>ongoing
                  </span>
                )}
                <span className="sep" aria-hidden="true">&middot;</span>
                <SignupBadge offer={offer} hrefPrefix="../" />
                <span className="sep" aria-hidden="true">&middot;</span>
                <VerificationBadge offer={offer} hrefPrefix="../" />
                <span className="sep" aria-hidden="true">&middot;</span>
                checked{" "}
                <time dateTime={offer.verified_date}>{humanDate(offer.verified_date)}</time>
              </p>
            </header>
            {offer.status === "expired" ? (
              <p className="od-ended">This offer ended &mdash; nothing here is claimable anymore.</p>
            ) : (
              <a
                className="od-cta"
                href={offer.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Claim at {offer.provider} <span aria-hidden="true">&#8599;</span>
              </a>
            )}
          </article>
        ) : (
          <section className="empty" style={{ "--i": 0 } as React.CSSProperties}>
            <h2>Offer not found</h2>
            <p>
              No offer lives at this address. It may have been renamed or removed from the
              directory.
            </p>
            <p>
              <a href="../index.html">Browse all live offers</a> instead.
            </p>
          </section>
        )}
        <SiteFooter depth={1} />
      </div>
    </>
  )
}
