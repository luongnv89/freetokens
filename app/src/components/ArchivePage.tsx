import { expiredOffers, humanDate, type OffersIndex, type Offer } from "../lib/offers"
import { CategoryBadge, ExpiredBadge, SignupBadge, VerificationBadge } from "./Badge"
import { IconSprite } from "./OfferRow"
import { SiteFooter } from "./SiteFooter"
import { SiteHeader } from "./SiteHeader"

function ArchiveEmptyGlyph() {
  return (
    <p className="glyph" aria-hidden="true">
      <svg
        width="44"
        height="44"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="presentation"
      >
        <rect x="3" y="4" width="18" height="5" rx="1" />
        <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
        <path d="M10 13h4" />
      </svg>
    </p>
  )
}

function ArchivedCard({ offer, index }: { offer: Offer; index: number }) {
  const detailHref = `offers/${offer.slug}.html`
  return (
    <li style={{ "--i": index } as React.CSSProperties}>
      <article className="card" data-category={offer.category}>
        <div className="card-top">
          <CategoryBadge offer={offer} />
          <VerificationBadge offer={offer} />
          <SignupBadge offer={offer} />
          <ExpiredBadge />
        </div>
        <h2 className="card-title">
          <a href={offer.source_url} target="_blank" rel="noopener noreferrer">
            {offer.title} <span className="ext" aria-hidden="true">&#8599;</span>
          </a>
        </h2>
        <p className="amount">{offer.amount}</p>
        <p className="prov">
          {offer.provider} &middot; expired{" "}
          {offer.expiry_date ? (
            <time dateTime={offer.expiry_date}>{humanDate(offer.expiry_date)}</time>
          ) : (
            "unknown"
          )}
        </p>
        <div className="card-actions">
          {/* Expired offers keep their detail page too (#60): the archive
              links to the retained record, not just out. */}
          <a className="detail-btn" href={detailHref}>
            View details
          </a>
        </div>
      </article>
    </li>
  )
}

/**
 * The expired-offer archive (F11 / #26), mirroring build.py
 * render_archive_html: newest expirations first, plain crawlable markup,
 * no client script behavior beyond hydration parity.
 */
export default function ArchivePage({ index }: { index: OffersIndex }) {
  const archived = expiredOffers(index)
  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
        <header className="masthead">
          <SiteHeader current="archive" />
          <p className="kicker">free ai credits &middot; archive</p>
          <h1>Expired offer archive</h1>
          <p className="tagline">
            Every offer that has since lapsed, kept for reference &mdash; newest expirations first.
            Nothing here is claimable anymore.
          </p>
          <p className="count">
            <strong>{archived.length}</strong> expired offers
          </p>
        </header>

        {archived.length > 0 ? (
          <>
            <a className="skip-list" href="#site-footer">
              Skip the offer list
            </a>
            <ul className="grid" id="ft-archive-grid">
              {archived.map((offer, i) => (
                <ArchivedCard key={offer.slug} offer={offer} index={i} />
              ))}
            </ul>
          </>
        ) : (
          <section className="empty" style={{ "--i": 0 } as React.CSSProperties}>
            <ArchiveEmptyGlyph />
            <h2>The archive is empty</h2>
            <p>
              No offer has expired yet. When one does, it moves here on the next rebuild instead of
              vanishing.
            </p>
            <p>
              <a href="./index.html">Browse the live offers</a> in the meantime.
            </p>
          </section>
        )}

        </main>
        <SiteFooter current="archive" />
      </div>
    </>
  )
}
