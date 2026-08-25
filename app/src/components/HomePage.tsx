import { useEffect, useRef, useState } from "react"
import {
  SEARCH_DEBOUNCE_MS,
  trackFilterUse,
  trackSearch,
  trackSortUse,
} from "../lib/analytics"
import { CATEGORIES, activeOffers, applySort, offerMatches, buildDate, type OffersIndex } from "../lib/offers"
import {
  emptyState,
  hasQueryOrFilters,
  normalizeSort,
  parseState,
  serializeState,
  type UrlState,
} from "../lib/urlState"
import { BrandMark } from "./BrandMark"
import { IconSprite, OfferRow } from "./OfferRow"
import { SiteFooter } from "./SiteFooter"
import { Button } from "./ui/button"

function GiftGlyph() {
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
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M12 8v13" />
        <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
        <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8" />
        <path d="M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8" />
      </svg>
    </p>
  )
}

function SearchGlyph() {
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
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.35-4.35" />
        <path d="M8.5 11h5" />
      </svg>
    </p>
  )
}

function Toolbar({
  total,
  shown,
  searchValue,
  sortValue,
  category,
  clearHidden,
  onSearchChange,
  onSortChange,
  onClear,
}: {
  total: number
  shown: number
  searchValue: string
  sortValue: string
  category: string
  clearHidden: boolean
  onSearchChange: (value: string) => void
  onSortChange: (value: string) => void
  onClear: () => void
}) {
  const status =
    shown === total ? `Showing all ${total} offers` : `Showing ${shown} of ${total} offers`
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
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="field field-sort">
        <label className="tool-label" htmlFor="ft-sort">
          Sort
        </label>
        <select id="ft-sort" value={sortValue} onChange={(e) => onSortChange(e.target.value)}>
          <option value="">Default</option>
          <option value="newest">Newest verified</option>
          <option value="expiring">Expiring soon</option>
          <option value="amount">Largest amount</option>
        </select>
      </div>
      <div className="chips" role="group" aria-label="Filter by category">
        <Button
          type="button"
          variant="unstyled"
          className="chip "
          data-ft-category=""
          aria-pressed={category === "" ? "true" : "false"}
        >
          <span>All</span>
        </Button>
        {CATEGORIES.map((cat) => (
          <Button
            key={cat}
            type="button"
            variant="unstyled"
            className={`chip chip-category-${cat}`}
            data-ft-category={cat}
            aria-pressed={category === cat ? "true" : "false"}
          >
            <span>
              {cat === "api_provider"
                ? "API providers"
                : cat[0].toUpperCase() + cat.slice(1)}
            </span>
          </Button>
        ))}
      </div>
      <div className="results-line">
        <p className="results-status" id="ft-results-status" role="status" aria-live="polite">
          {status}
        </p>
        <Button
          type="button"
          variant="unstyled"
          className="chip clear"
          id="ft-clear-filters"
          hidden={clearHidden}
          onClick={onClear}
        >
          Clear all filters
        </Button>
      </div>
    </section>
  )
}

function visibleOffers(offers: ReturnType<typeof activeOffers>, state: UrlState) {
  return applySort(offers, state.sort).filter((offer) => offerMatches(offer, state))
}

/**
 * The full home page (F1): masthead, toolbar, ranked mono rows. Rendered both
 * by the prerender script (react-dom/server) and hydrated client-side —
 * markup mirrors build.py's render_html exactly.
 *
 * First render (SSR/prerender) shows every active offer so static markup
 * tests stay matching. After mount, URL state is applied without events.
 */
export default function HomePage({ index }: { index: OffersIndex }) {
  const offers = activeOffers(index)
  const buildDay = buildDate(index.generated_at)
  const ongoing = offers.filter((o) => !o.expiry_date).length
  const verified = offers.filter((o) => o.verification === "hand_verified").length

  const [state, setState] = useState(emptyState)
  const [searchInput, setSearchInput] = useState("")
  const stateRef = useRef(state)
  stateRef.current = state
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const shownList = visibleOffers(offers, state)

  function commit(patch: Partial<UrlState>, source: "search" | "sort" | "filter") {
    const next: UrlState = { ...stateRef.current, ...patch }
    if (source === "sort" && next.sort === stateRef.current.sort) return
    if (source === "search" && next.q === stateRef.current.q) return
    stateRef.current = next
    setState(next)
    const query = serializeState(next)
    const nextSearch = query ? `?${query}` : ""
    if (typeof window !== "undefined" && nextSearch !== window.location.search) {
      try {
        window.history.pushState({}, "", nextSearch || window.location.pathname)
      } catch {
        /* ignore */
      }
    }
    if (source === "search" && next.q) {
      trackSearch(next.q.length)
    } else if (source === "sort") {
      trackSortUse(next.sort || "default")
    } else if (source === "filter") {
      trackFilterUse({
        category: next.category,
        verification: next.verification,
        signup: next.signup,
      })
    }
  }

  useEffect(() => {
    const applyFromLocation = () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const parsed = parseState(window.location.search)
      stateRef.current = parsed
      setState(parsed)
      setSearchInput(parsed.q)
    }
    applyFromLocation()
    window.addEventListener("popstate", applyFromLocation)
    return () => {
      window.removeEventListener("popstate", applyFromLocation)
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    }
  }, [])

  function onSearchChange(value: string) {
    setSearchInput(value)
    if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      const q = value.trim().toLowerCase()
      if (q === stateRef.current.q) return
      commit({ q }, "search")
    }, SEARCH_DEBOUNCE_MS)
  }

  function onSortChange(value: string) {
    const sort = normalizeSort(value)
    if (sort === stateRef.current.sort) return
    commit({ sort }, "sort")
  }

  function onClear() {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    commit({ q: "", category: "", verification: "", signup: "" }, "filter")
    setSearchInput("")
    document.getElementById("ft-search")?.focus()
  }

  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
        <header className="masthead masthead-home">
          <div className="bar">
            <BrandMark size={32} alt="" />
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
            <Toolbar
              total={offers.length}
              shown={shownList.length}
              searchValue={searchInput}
              sortValue={state.sort}
              category={state.category}
              clearHidden={!hasQueryOrFilters(state)}
              onSearchChange={onSearchChange}
              onSortChange={onSortChange}
              onClear={onClear}
            />
            <a className="skip-list" href="#site-footer">
              Skip the offer list
            </a>
            <ol className="grid" id="ft-grid" role="list">
              {shownList.map((offer, i) => (
                <OfferRow key={offer.slug} offer={offer} index={i} buildDay={buildDay} />
              ))}
            </ol>
            <section className="empty" id="ft-no-results" hidden={shownList.length !== 0}>
              <SearchGlyph />
              <h2>No matching offers</h2>
              <p>
                Nothing matches every filter you have applied at once. The status line above lists
                them; clearing one usually brings offers back.
              </p>
              <Button
                type="button"
                variant="unstyled"
                className="chip reset"
                id="ft-reset-filters"
                onClick={onClear}
              >
                Clear search & filters
              </Button>
            </section>
          </>
        ) : (
          <section className="empty" style={{ "--i": 0 } as React.CSSProperties}>
            <GiftGlyph />
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

        </main>
        <SiteFooter current="home" showTrafficStrip />
      </div>
    </>
  )
}
