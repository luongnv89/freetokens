import { CATEGORIES, activeOffers, buildDate, type OffersIndex } from "../lib/offers"
import { IconSprite, OfferRow } from "./OfferRow"

function Toolbar({ count }: { count: number }) {
  const seeded = `Showing all ${count} offers`
  return (
    <section className="toolbar" aria-label="Search and filter offers">
      <div className="field">
        <label className="tool-label" htmlFor="ft-search">
          Search
        </label>
        <input
          type="search"
          id="ft-search"
          name="q"
          placeholder="Search title, provider, or amount&hellip;"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
        />
      </div>
      <div className="field field-sort">
        <label className="tool-label" htmlFor="ft-sort">
          Sort
        </label>
        <select id="ft-sort" defaultValue="">
          <option value="">Default</option>
          <option value="newest">Newest verified</option>
          <option value="expiring">Expiring soon</option>
          <option value="amount">Largest amount</option>
        </select>
      </div>
      <div className="chips" role="group" aria-label="Filter by category">
        <button type="button" className="chip " data-ft-category="" aria-pressed="true">
          <span>All</span>
        </button>
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className={`chip chip-category-${category}`}
            data-ft-category={category}
            aria-pressed="false"
          >
            <span>
              {category === "api_provider"
                ? "API providers"
                : category[0].toUpperCase() + category.slice(1)}
            </span>
          </button>
        ))}
      </div>
      <div className="results-line">
        <p className="results-status" id="ft-results-status" role="status" aria-live="polite">
          {seeded}
        </p>
        <button type="button" className="chip clear" id="ft-clear-filters" hidden>
          Clear all filters
        </button>
      </div>
    </section>
  )
}

/**
 * The full home page (F1): masthead, toolbar, ranked mono rows. Rendered both
 * by the prerender script (react-dom/server) and hydrated client-side —
 * markup mirrors build.py's render_html exactly.
 */
export default function HomePage({ index }: { index: OffersIndex }) {
  const offers = activeOffers(index)
  const buildDay = buildDate(index.generated_at)
  const ongoing = offers.filter((o) => !o.expiry_date).length
  const verified = offers.filter((o) => o.verification === "hand_verified").length

  return (
    <>
      <IconSprite />
      <div className="wrap">
        <header className="masthead masthead-home">
          <div className="bar">
            <h1>Free AI Credits</h1>
            <p className="kicker">
              zero runtime &middot; every offer labeled with verification level &amp; sign-up need
            </p>
          </div>
          <p className="tagline">
            Every claimable free-credit offer worth your time, on one fast page. Each carries a
            verification level (hand-checked or community-sourced) and a sign-up tag, refreshed on
            every rebuild.
          </p>
          <p className="count">
            <strong>{offers.length}</strong> live offers &middot; <strong>{ongoing}</strong>{" "}
            ongoing &middot; <strong>{verified}</strong> hand-verified by the maintainer
          </p>
        </header>

        {offers.length > 0 ? (
          <>
            <Toolbar count={offers.length} />
            <a className="skip-list" href="#site-footer">
              Skip the offer list
            </a>
            <ol className="grid" id="ft-grid" role="list">
              {offers.map((offer, i) => (
                <OfferRow key={offer.slug} offer={offer} index={i} buildDay={buildDay} />
              ))}
            </ol>
            <section className="empty" id="ft-no-results" hidden>
              <p>No offers match the current search or filters.</p>
            </section>
          </>
        ) : (
          <section className="empty" style={{ "--i": 0 } as React.CSSProperties}>
            <h2>No live offers right now</h2>
            <p>
              Every listing here is screened against the provider, and none have passed the check
              at the moment.
            </p>
            <p>
              New and renewed offers appear automatically after the next rebuild &mdash; check back
              soon.
            </p>
            <p className="empty-archive">
              In the meantime, <a href="archive.html">browse the archive</a> of expired offers.
            </p>
          </section>
        )}

        <footer className="foot" id="site-footer">
          <nav className="foot-nav" aria-label="Site">
            <a href="./index.html" aria-current="page">
              Offers
            </a>
            <span aria-hidden="true">&middot;</span>
            <a href="./archive.html">Archive</a>
            <span aria-hidden="true">&middot;</span>
            <a href="./privacy.html">Privacy policy</a>
            <span aria-hidden="true">&middot;</span>
            <a href="./feed.xml">RSS</a>
          </nav>
        </footer>
      </div>
    </>
  )
}
