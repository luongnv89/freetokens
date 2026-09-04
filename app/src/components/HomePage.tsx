import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import {
  SEARCH_DEBOUNCE_MS,
  trackFilterUse,
  trackSearch,
  trackSortUse,
} from "../lib/analytics"
import {
  CATEGORIES,
  CATEGORY_LABELS,
  SIGNUP_LABELS,
  VERIFICATION_LABELS,
  activeOffers,
  applySort,
  expiredOffers,
  offerMatches,
  buildDate,
  type OffersIndex,
} from "../lib/offers"
import {
  clearDismissedSlugs,
  readDismissedSlugs,
  readPrefs,
  readSavedSlugs,
  writeDismissedSlugs,
  writePrefs,
  writeSavedSlugs,
} from "../lib/personalState"
import { TAG_ICONS } from "../lib/tagIcons"
import { hottestSlugs, useOfferViews } from "../lib/offerStats"
import {
  DIMENSIONS,
  emptyState,
  hasQueryOrFilters,
  normalizeSort,
  parseState,
  serializeState,
  type FilterDimension,
  type UrlState,
} from "../lib/urlState"
import { IconSprite, OfferRow } from "./OfferRow"
import { SiteFooter } from "./SiteFooter"
import { SiteHeader } from "./SiteHeader"
import { SiteStats } from "./SiteStats"
import { Breadcrumbs } from "./Breadcrumbs"
import { StructuredData } from "./StructuredData"
import { Button } from "./ui/button"

const FILTER_LABELS: Record<FilterDimension, Record<string, string>> = {
  category: CATEGORY_LABELS,
  verification: VERIFICATION_LABELS,
  signup: SIGNUP_LABELS,
}

function namedFilters(state: UrlState) {
  const out: { dim: FilterDimension; value: string; label: string }[] = []
  for (const dim of DIMENSIONS) {
    const value = state[dim]
    if (!value) continue
    out.push({ dim, value, label: FILTER_LABELS[dim][value] || value })
  }
  return out
}

function ChipGlyph({ value }: { value: string }) {
  if (!(value in TAG_ICONS)) return null
  return (
    <svg className="tag-i" width="12" height="12" aria-hidden="true" focusable="false">
      <use href={`#ti-${value}`} />
    </svg>
  )
}

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
  active,
  clearHidden,
  savedCount,
  savedOnly,
  dismissedCount,
  onSearchChange,
  onSortChange,
  onCategorySet,
  onRemoveFilter,
  onClear,
  onToggleSavedOnly,
  onRestoreDismissed,
}: {
  total: number
  shown: number
  searchValue: string
  sortValue: string
  category: string
  active: { dim: FilterDimension; value: string; label: string }[]
  clearHidden: boolean
  savedCount: number
  savedOnly: boolean
  dismissedCount: number
  onSearchChange: (value: string) => void
  onSortChange: (value: string) => void
  onCategorySet: (category: string) => void
  onRemoveFilter: (dim: FilterDimension) => void
  onClear: () => void
  onToggleSavedOnly: () => void
  onRestoreDismissed: () => void
}) {
  const countText =
    shown === total ? `Showing all ${total} offers` : `Showing ${shown} of ${total} offers`
  function onChipKeyDown(event: KeyboardEvent<HTMLButtonElement>, next: string) {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onCategorySet(next)
  }
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
          placeholder="Search offers, providers, or amounts&hellip;"
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
          <option value="">Alphabetical</option>
          <option value="newest">Recently checked</option>
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
          onClick={() => onCategorySet("")}
          onKeyDown={(e) => onChipKeyDown(e, "")}
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
            onClick={() => onCategorySet(cat)}
            onKeyDown={(e) => onChipKeyDown(e, cat)}
          >
            <ChipGlyph value={cat} />
            <span>{CATEGORY_LABELS[cat] ?? cat}</span>
          </Button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Personal lists">
        <Button
          type="button"
          variant="unstyled"
          className={`chip chip-saved-view${savedOnly ? " chip-active" : ""}`}
          id="ft-saved-toggle"
          data-ft-saved-toggle
          aria-pressed={savedOnly ? "true" : "false"}
          onClick={onToggleSavedOnly}
        >
          <span>Saved ({savedCount})</span>
        </Button>
      </div>
      <div className="results-line">
        <p className="results-status" id="ft-results-status" role="status" aria-live="polite">
          {countText}
          {dismissedCount > 0 && !savedOnly && (
            <span>
              {" · "}
              <Button
                type="button"
                variant="unstyled"
                className="chip restore-dismissed"
                id="ft-restore-dismissed"
                data-ft-restore-dismissed
                aria-label={`Restore ${dismissedCount} hidden offer${dismissedCount === 1 ? "" : "s"}`}
                onClick={onRestoreDismissed}
              >
                {dismissedCount} hidden — restore
              </Button>
            </span>
          )}
          {active.map((tag) => (
            <span key={tag.dim}>
              {" · "}
              <Button
                type="button"
                variant="unstyled"
                className={`filter-pill badge-${tag.dim}-${tag.value}`}
                data-ft-remove={tag.dim}
                aria-label={`Remove ${tag.label} filter`}
                onClick={() => onRemoveFilter(tag.dim)}
              >
                {tag.label}
              </Button>
            </span>
          ))}
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

function visibleOffers(
  offers: ReturnType<typeof activeOffers>,
  state: UrlState,
  personal?: { savedOnly: boolean; saved: ReadonlySet<string>; dismissed: ReadonlySet<string> },
) {
  const base = applySort(offers, state.sort)
  if (!personal) {
    return base.filter((offer) => offerMatches(offer, state))
  }
  if (personal.savedOnly) {
    // Saved-only view lists exactly the saved offers — query and filter
    // dimensions are ignored here so an active filter can never hide part
    // of the shortlist.
    return base.filter((offer) => personal.saved.has(offer.slug))
  }
  // Default view hides dismissed offers.
  return base
    .filter((offer) => offerMatches(offer, state))
    .filter((offer) => !personal.dismissed.has(offer.slug))
}

/**
 * The full home page (F1): masthead, toolbar, ranked mono rows. Rendered both
 * by the prerender script (react-dom/server) and hydrated client-side —
 * markup mirrors build.py's render_html exactly.
 *
 * First render (SSR/prerender) shows every active offer so static markup
 * tests stay matching. After mount, URL state is applied without events.
 */
export default function HomePage({ index, baseUrl }: { index: OffersIndex; baseUrl?: string }) {
  const offers = activeOffers(index)
  const buildDay = buildDate(index.generated_at)
  // Proof-line inputs, both build-time: the oldest live verification date
  // becomes the "re-checked within N" window, and the archive count is the
  // evidence that expired offers actually leave the list.
  const archivedCount = expiredOffers(index).length
  const oldestVerified = offers.reduce(
    (oldest, offer) =>
      !oldest || offer.verified_date < oldest ? offer.verified_date : oldest,
    "",
  )

  const [state, setState] = useState(emptyState)
  const [searchInput, setSearchInput] = useState("")
  // Personal state hydrates after mount (ClaimChecklist pattern): the
  // prerendered first paint always shows every active offer.
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set())
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [savedOnly, setSavedOnly] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingFocusRef = useRef<"search" | "next-pill" | null>(null)

  const shownList = visibleOffers(offers, state, { savedOnly, saved, dismissed })

  const offerSlugs = useMemo(() => activeOffers(index).map((o) => o.slug), [index])
  const views = useOfferViews(offerSlugs)
  // Second, windowed read of the same public counters. GoatCounter windows by
  // calendar DATE, so `days: 1` is "today so far" — the honest approximation
  // of "last 24h" this stack can express. Ranked over the FULL slug list, never
  // over what is currently on screen, so filtering or searching can never crown
  // a different offer. Placed after the all-time hook on purpose: effect order
  // keeps the unwindowed request first.
  const todayViews = useOfferViews(offerSlugs, 1)
  const hotSlugs = useMemo(() => hottestSlugs(todayViews), [todayViews])

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
    // Remember the last filter/sort locally (issue #140). Never serialized
    // into the URL by this layer — the URL keeps reflecting only
    // filter/search/sort, which serializeState already whitelists.
    writePrefs({
      category: next.category,
      verification: next.verification,
      signup: next.signup,
      sort: next.sort,
    })
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
    // Hydrate personal shortlists from localStorage.
    setSaved(new Set(readSavedSlugs()))
    setDismissed(new Set(readDismissedSlugs()))
    // Restore last-used preferences only when the URL carries no explicit
    // view state; a shared link must always win over stored prefs.
    if (!window.location.search) {
      const prefs = readPrefs()
      if (prefs) {
        const current = stateRef.current
        const validCategory = CATEGORIES.includes(
          prefs.category as (typeof CATEGORIES)[number],
        )
          ? prefs.category
          : ""
        const validVerification = prefs.verification in VERIFICATION_LABELS
          ? prefs.verification
          : ""
        const validSignup = prefs.signup in SIGNUP_LABELS ? prefs.signup : ""
        const sort = normalizeSort(prefs.sort)
        const patch: Partial<UrlState> = {}
        if (current.category !== validCategory) patch.category = validCategory
        if (current.verification !== validVerification) {
          patch.verification = validVerification
        }
        if (current.signup !== validSignup) patch.signup = validSignup
        if (current.sort !== sort) patch.sort = sort
        if (Object.keys(patch).length > 0) {
          const next = { ...current, ...patch }
          stateRef.current = next
          setState(next)
          const query = serializeState(next)
          try {
            window.history.replaceState(
              {},
              "",
              query
                ? `${window.location.pathname}?${query}`
                : window.location.pathname,
            )
          } catch {
            /* ignore */
          }
        }
      }
    }
    window.addEventListener("popstate", applyFromLocation)
    return () => {
      window.removeEventListener("popstate", applyFromLocation)
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    }
  }, [])

  function onToggleSave(slug: string) {
    setSaved((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      writeSavedSlugs([...next])
      return next
    })
    // Dismissing and saving are exclusive: saving unhides, dismissing unsaves.
    setDismissed((prev) => {
      if (!prev.has(slug)) return prev
      const next = new Set(prev)
      next.delete(slug)
      writeDismissedSlugs([...next])
      return next
    })
  }

  function onDismiss(slug: string) {
    setDismissed((prev) => {
      if (prev.has(slug)) return prev
      const next = new Set(prev)
      next.add(slug)
      writeDismissedSlugs([...next])
      return next
    })
    setSaved((prev) => {
      if (!prev.has(slug)) return prev
      const next = new Set(prev)
      next.delete(slug)
      writeSavedSlugs([...next])
      return next
    })
  }

  function onRestoreDismissed() {
    clearDismissedSlugs()
    setDismissed(new Set())
  }

  function onToggleSavedOnly() {
    setSavedOnly((prev) => !prev)
  }

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

  function onCategorySet(category: string) {
    commit({ category }, "filter")
  }

  function onTagToggle(dim: FilterDimension, value: string) {
    const current = stateRef.current[dim]
    commit({ [dim]: current === value ? "" : value }, "filter")
  }

  function onRemoveFilter(dim: FilterDimension) {
    commit({ [dim]: "" }, "filter")
    pendingFocusRef.current = "next-pill"
  }

  function onClear() {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    commit({ q: "", category: "", verification: "", signup: "" }, "filter")
    setSearchInput("")
    pendingFocusRef.current = "search"
    document.getElementById("ft-search")?.focus()
  }

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    if (pending === "next-pill") {
      const next = document.querySelector("#ft-results-status [data-ft-remove]")
      if (next instanceof HTMLElement) next.focus()
      else document.getElementById("ft-search")?.focus()
      return
    }
    document.getElementById("ft-search")?.focus()
  })

  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
        <SiteHeader current="home" />
        <SiteStats
          activeCount={offers.length}
          archivedCount={archivedCount}
          oldestVerified={oldestVerified}
          generatedAt={index.generated_at}
        />
        <Breadcrumbs page="home" />

        {offers.length > 0 ? (
          <>
            <Toolbar
              total={offers.length}
              shown={shownList.length}
              searchValue={searchInput}
              sortValue={state.sort}
              category={state.category}
              active={namedFilters(state)}
              clearHidden={!hasQueryOrFilters(state)}
              savedCount={saved.size}
              savedOnly={savedOnly}
              dismissedCount={dismissed.size}
              onSearchChange={onSearchChange}
              onSortChange={onSortChange}
              onCategorySet={onCategorySet}
              onRemoveFilter={onRemoveFilter}
              onClear={onClear}
              onToggleSavedOnly={onToggleSavedOnly}
              onRestoreDismissed={onRestoreDismissed}
            />
            <a className="skip-list" href="#site-footer">
              Skip the offer list
            </a>
            <ol className="grid" id="ft-grid" role="list">
              {shownList.map((offer, i) => (
                <OfferRow
                  key={offer.slug}
                  offer={offer}
                  index={i}
                  buildDay={buildDay}
                  pressed={{
                    category: state.category,
                    verification: state.verification,
                    signup: state.signup,
                  }}
                  onToggleTag={onTagToggle}
                  saved={saved.has(offer.slug)}
                  onToggleSave={onToggleSave}
                  onDismiss={onDismiss}
                  views={views[offer.slug] ?? null}
                  hot={hotSlugs.has(offer.slug)}
                />
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
        <SiteFooter current="home" />
      </div>
      {/* JSON-LD last: crawlers read the whole document, but FCP content parses first. */}
      <StructuredData page="home" index={index} baseUrl={baseUrl} />
    </>
  )
}
