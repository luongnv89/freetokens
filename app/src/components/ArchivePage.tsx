import { expiredOffers, type OffersIndex } from "../lib/offers"
import { IconSprite, OfferRow } from "./OfferRow"
import { SiteFooter } from "./SiteFooter"
import { SiteHeader } from "./SiteHeader"
import { Breadcrumbs } from "./Breadcrumbs"
import { StructuredData } from "./StructuredData"

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

/**
 * The expired-offer archive (F11 / #26): same listing style as home page
 * but with a muted background tint to signal expired status. Newest
 * expirations first, plain crawlable markup.
 */
export default function ArchivePage({
  index,
  baseUrl,
}: {
  index: OffersIndex
  baseUrl?: string
}) {
  const archived = expiredOffers(index)
  const buildDay = index.generated_at.slice(0, 10)
  return (
    <>
      <IconSprite />
      <StructuredData page="archive" index={index} baseUrl={baseUrl} />
      <div className="wrap">
        <main>
        <header className="masthead masthead-home">
          <SiteHeader current="archive" />
          <Breadcrumbs page="archive" baseUrl={baseUrl} />
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
            <ol className="grid" id="ft-archive-grid" role="list">
              {archived.map((offer, i) => (
                <OfferRow
                  key={offer.slug}
                  offer={offer}
                  index={i}
                  buildDay={buildDay}
                  pressed={{ category: "", verification: "", signup: "" }}
                  onToggleTag={() => {}}
                />
              ))}
            </ol>
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
