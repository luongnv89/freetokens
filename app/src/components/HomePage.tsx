import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import {
  SEARCH_DEBOUNCE_MS,
  isGoatCounterConfigured,
  trackFilterUse,
  trackSearch,
  trackSortUse,
} from "../lib/analytics";
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
} from "../lib/offers";
import {
  clearDismissedSlugs,
  readDismissedSlugs,
  readPrefs,
  readSavedSlugs,
  writeDismissedSlugs,
  writePrefs,
  writeSavedSlugs,
} from "../lib/personalState";
import { TAG_ICONS } from "../lib/tagIcons";
import { PAGE_SIZE, pageCount } from "../lib/pagination";
import {
  hotViewCounts,
  hottestSlugs,
  topViewedSlugs,
  useOfferViews,
} from "../lib/offerStats";
import type { RankContext } from "../lib/ranking";
import {
  DIMENSIONS,
  emptyState,
  hasQueryOrFilters,
  normalizeSort,
  parseState,
  serializeState,
  type FilterDimension,
  type UrlState,
} from "../lib/urlState";
import { IconSprite, OfferRow } from "./OfferRow";
import { Pager } from "./Pager";
import { TrustLegend } from "./TrustLegend";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { SiteStats } from "./SiteStats";
import { HotDeals } from "./HotDeals";
import { Breadcrumbs } from "./Breadcrumbs";
import { StructuredData } from "./StructuredData";
import { Button } from "./ui/button";

const FILTER_LABELS: Record<FilterDimension, Record<string, string>> = {
  category: CATEGORY_LABELS,
  verification: VERIFICATION_LABELS,
  signup: SIGNUP_LABELS,
};

function namedFilters(state: UrlState) {
  const out: { dim: FilterDimension; value: string; label: string }[] = [];
  for (const dim of DIMENSIONS) {
    const value = state[dim];
    if (!value) continue;
    out.push({ dim, value, label: FILTER_LABELS[dim][value] || value });
  }
  return out;
}

function ChipGlyph({ value }: { value: string }) {
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
  );
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
  );
}

function Toolbar({
  total,
  shown,
  pageRange,
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
  total: number;
  shown: number;
  pageRange: { start: number; end: number } | null;
  searchValue: string;
  sortValue: string;
  category: string;
  active: { dim: FilterDimension; value: string; label: string }[];
  clearHidden: boolean;
  savedCount: number;
  savedOnly: boolean;
  dismissedCount: number;
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onCategorySet: (category: string) => void;
  onRemoveFilter: (dim: FilterDimension) => void;
  onClear: () => void;
  onToggleSavedOnly: () => void;
  onRestoreDismissed: () => void;
}) {
  const countText = pageRange
    ? `Showing ${pageRange.start}–${pageRange.end} of ${shown} offers`
    : shown === total
      ? `Showing all ${total} offers`
      : `Showing ${shown} of ${total} offers`;
  function onChipKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    next: string,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onCategorySet(next);
  }
  // The category rail scrolls sideways at narrow widths, and a chip that is
  // only partly visible keeps its right edge clipped when focus lands on it
  // (Blink does not scroll a partially visible target into view), so the
  // chip asks for its own reveal. `nearest` scrolls the minimum, and leaves
  // vertical position alone so the page never jumps.
  function revealOnFocus(event: FocusEvent<HTMLButtonElement>) {
    event.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest" });
  }
  return (
    <section className="toolbar" aria-label="Search and filter offers">
      <div className="field field-search">
        <label className="tool-label sr-only" htmlFor="ft-search">
          Search
        </label>
        <svg
          className="search-i"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.35-4.35" />
        </svg>
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
        <select
          id="ft-sort"
          value={sortValue}
          onChange={(e) => onSortChange(e.target.value)}
        >
          {/* The empty value is the default ranking (lib/ranking.ts); "added"
              is the build's index order, which it emits newest-added first. */}
          <option value="">Recommended</option>
          <option value="added">Latest added</option>
          <option value="newest">Recently checked</option>
          <option value="expiring">Expiring soon</option>
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
          onFocus={revealOnFocus}
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
            onFocus={revealOnFocus}
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
        <p
          className="results-status"
          id="ft-results-status"
          role="status"
          aria-live="polite"
        >
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
  );
}

function sameCounts(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
  );
}

function visibleOffers(
  offers: ReturnType<typeof activeOffers>,
  state: UrlState,
  rank: RankContext,
  personal?: {
    savedOnly: boolean;
    saved: ReadonlySet<string>;
    dismissed: ReadonlySet<string>;
  },
) {
  const base = applySort(offers, state.sort, rank);
  if (!personal) {
    return base.filter((offer) => offerMatches(offer, state));
  }
  if (personal.savedOnly) {
    // Saved-only view lists exactly the saved offers — query and filter
    // dimensions are ignored here so an active filter can never hide part
    // of the shortlist.
    return base.filter((offer) => personal.saved.has(offer.slug));
  }
  // Default view hides dismissed offers.
  return base
    .filter((offer) => offerMatches(offer, state))
    .filter((offer) => !personal.dismissed.has(offer.slug));
}

/**
 * The full home page (F1): masthead, toolbar, ranked mono rows. Rendered both
 * by the prerender script (react-dom/server) and hydrated client-side —
 * markup mirrors build.py's render_html exactly.
 *
 * First render (SSR/prerender) shows page 1 of the default list so static
 * markup tests stay matching. After mount, URL state is applied without
 * events.
 */
export default function HomePage({
  index,
  baseUrl,
}: {
  index: OffersIndex;
  baseUrl?: string;
}) {
  const offers = activeOffers(index);
  const buildDay = buildDate(index.generated_at);
  // Proof-line inputs, both build-time: the live count and the archive count as
  // evidence that expired offers actually leave the list.
  const archivedCount = expiredOffers(index).length;

  const [state, setState] = useState(emptyState);
  const [searchInput, setSearchInput] = useState("");
  // Personal state hydrates after mount (ClaimChecklist pattern): the
  // prerendered first paint always shows the first page of active offers.
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [savedOnly, setSavedOnly] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocusRef = useRef<"search" | "next-pill" | "grid" | null>(
    null,
  );
  // Today's floored view counts, mirrored out of `todayViews` (declared
  // below). The default ranking needs them before the page slice is known,
  // but the windowed hook must stay after the all-time one, so they arrive
  // one render late. Empty on the prerender and on the hydration render, so
  // both lists match.
  const [hotViews, setHotViews] = useState<Record<string, number>>({});
  // Counts that land after the visitor has touched the list or scrolled are
  // held here instead of reordering rows under their pointer or focus, and
  // applied with the next list change they make themselves (#570).
  const interactedRef = useRef(false);
  const heldHotViewsRef = useRef<Record<string, number> | null>(null);
  const rankContext = useMemo<RankContext>(
    () => ({ today: buildDay, hotViews }),
    [buildDay, hotViews],
  );

  const shownList = visibleOffers(offers, state, rankContext, {
    savedOnly,
    saved,
    dismissed,
  });

  // The URL's page is clamped against the live result count, never
  // rewritten: a deep link past the end shows the last page and keeps its
  // own address, and personal actions (dismiss, save) can shrink the list
  // without touching the location bar.
  const totalPages = pageCount(shownList.length);
  const page = Math.min(state.page, totalPages);
  const pageList = shownList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const offerSlugs = useMemo(
    () => activeOffers(index).map((o) => o.slug),
    [index],
  );
  // All-time counters are fetched for the visible page only (#548) — one
  // request per rendered row instead of one per catalog entry.
  const views = useOfferViews(pageList.map((o) => o.slug));
  // Second, windowed read of the same public counters. GoatCounter windows by
  // calendar DATE, so `days: 1` is "today so far" — the honest approximation
  // of "last 24h" this stack can express. Ranked over the FULL slug list, never
  // over what is currently on screen, so filtering or searching can never crown
  // a different offer. Placed after the all-time hook on purpose: effect order
  // keeps the unwindowed request first.
  const todayViews = useOfferViews(offerSlugs, 1);
  const hotSlugs = useMemo(() => hottestSlugs(todayViews), [todayViews]);
  useEffect(() => {
    const next = hotViewCounts(todayViews);
    if (interactedRef.current) {
      heldHotViewsRef.current = next;
      return;
    }
    setHotViews((prev) => (sameCounts(prev, next) ? prev : next));
  }, [todayViews]);
  useEffect(() => {
    const grid = document.getElementById("ft-grid");
    const events = ["pointerdown", "keydown", "focusin"] as const;
    const detach = () => {
      events.forEach((type) => grid?.removeEventListener(type, onInteract));
      window.removeEventListener("scroll", onInteract);
    };
    const onInteract = () => {
      interactedRef.current = true;
      detach();
    };
    events.forEach((type) => grid?.addEventListener(type, onInteract));
    window.addEventListener("scroll", onInteract, { passive: true });
    return detach;
  }, []);
  // The highlight shelf ranks the same windowed counters the badge uses, over
  // the FULL slug list rather than what is on screen, so filtering or
  // searching never changes which offers are "hot" — only the list below.
  const topToday = useMemo(() => topViewedSlugs(todayViews, 3), [todayViews]);
  // The shelf reserves its box until the windowed counters settle, but only
  // where counters can ever arrive: unconfigured or JS-off visitors get no
  // hole above the toolbar.
  const hotPending =
    isGoatCounterConfigured() && Object.keys(todayViews).length === 0;
  const offersBySlug = useMemo(
    () => new Map(offers.map((offer) => [offer.slug, offer])),
    [offers],
  );

  function commit(
    patch: Partial<UrlState>,
    source: "search" | "sort" | "filter" | "page",
  ) {
    // Every source except "page" resets the list to its first page: the
    // window the visitor was on no longer exists under the new results.
    const next: UrlState = { ...stateRef.current, page: 1, ...patch };
    if (source === "sort" && next.sort === stateRef.current.sort) return;
    if (source === "search" && next.q === stateRef.current.q) return;
    if (source === "page" && next.page === stateRef.current.page) return;
    stateRef.current = next;
    setState(next);
    const held = heldHotViewsRef.current;
    if (held) {
      heldHotViewsRef.current = null;
      setHotViews((prev) => (sameCounts(prev, held) ? prev : held));
    }
    const query = serializeState(next);
    const nextSearch = query ? `?${query}` : "";
    if (
      typeof window !== "undefined" &&
      nextSearch !== window.location.search
    ) {
      try {
        window.history.pushState(
          {},
          "",
          nextSearch || window.location.pathname,
        );
      } catch {
        /* ignore */
      }
    }
    if (source === "search" && next.q) {
      trackSearch(next.q.length);
    } else if (source === "sort") {
      trackSortUse(next.sort || "default");
    } else if (source === "filter") {
      trackFilterUse({
        category: next.category,
        verification: next.verification,
        signup: next.signup,
      });
    }
    // Remember the last filter/sort locally (issue #140). Never serialized
    // into the URL by this layer — the URL keeps reflecting only
    // filter/search/sort, which serializeState already whitelists. Paging
    // is view position, not a preference, so it never reaches storage.
    if (source !== "page") {
      writePrefs({
        category: next.category,
        verification: next.verification,
        signup: next.signup,
        sort: next.sort,
      });
    }
  }

  useEffect(() => {
    const applyFromLocation = () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const parsed = parseState(window.location.search);
      stateRef.current = parsed;
      setState(parsed);
      setSearchInput(parsed.q);
    };
    applyFromLocation();
    // Hydrate personal shortlists from localStorage.
    setSaved(new Set(readSavedSlugs()));
    setDismissed(new Set(readDismissedSlugs()));
    // Restore last-used preferences only when the URL carries no explicit
    // view state; a shared link must always win over stored prefs.
    if (!window.location.search) {
      const prefs = readPrefs();
      if (prefs) {
        const current = stateRef.current;
        const validCategory = CATEGORIES.includes(
          prefs.category as (typeof CATEGORIES)[number],
        )
          ? prefs.category
          : "";
        const validVerification =
          prefs.verification in VERIFICATION_LABELS ? prefs.verification : "";
        const validSignup = prefs.signup in SIGNUP_LABELS ? prefs.signup : "";
        const sort = normalizeSort(prefs.sort);
        const patch: Partial<UrlState> = {};
        if (current.category !== validCategory) patch.category = validCategory;
        if (current.verification !== validVerification) {
          patch.verification = validVerification;
        }
        if (current.signup !== validSignup) patch.signup = validSignup;
        if (current.sort !== sort) patch.sort = sort;
        if (Object.keys(patch).length > 0) {
          const next = { ...current, ...patch };
          stateRef.current = next;
          setState(next);
          const query = serializeState(next);
          try {
            window.history.replaceState(
              {},
              "",
              query
                ? `${window.location.pathname}?${query}`
                : window.location.pathname,
            );
          } catch {
            /* ignore */
          }
        }
      }
    }
    window.addEventListener("popstate", applyFromLocation);
    return () => {
      window.removeEventListener("popstate", applyFromLocation);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  function onToggleSave(slug: string) {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      writeSavedSlugs([...next]);
      return next;
    });
    // Dismissing and saving are exclusive: saving unhides, dismissing unsaves.
    setDismissed((prev) => {
      if (!prev.has(slug)) return prev;
      const next = new Set(prev);
      next.delete(slug);
      writeDismissedSlugs([...next]);
      return next;
    });
  }

  function onDismiss(slug: string) {
    setDismissed((prev) => {
      if (prev.has(slug)) return prev;
      const next = new Set(prev);
      next.add(slug);
      writeDismissedSlugs([...next]);
      return next;
    });
    setSaved((prev) => {
      if (!prev.has(slug)) return prev;
      const next = new Set(prev);
      next.delete(slug);
      writeSavedSlugs([...next]);
      return next;
    });
  }

  function onRestoreDismissed() {
    clearDismissedSlugs();
    setDismissed(new Set());
  }

  function onToggleSavedOnly() {
    setSavedOnly((prev) => !prev);
  }

  function onSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const q = value.trim().toLowerCase();
      if (q === stateRef.current.q) return;
      commit({ q }, "search");
    }, SEARCH_DEBOUNCE_MS);
  }

  function onSortChange(value: string) {
    const sort = normalizeSort(value);
    if (sort === stateRef.current.sort) return;
    commit({ sort }, "sort");
  }

  function onPageChange(next: number) {
    if (next === page) return;
    pendingFocusRef.current = "grid";
    commit({ page: next }, "page");
  }

  function onCategorySet(category: string) {
    commit({ category }, "filter");
  }

  function onTagToggle(dim: FilterDimension, value: string) {
    const current = stateRef.current[dim];
    commit({ [dim]: current === value ? "" : value }, "filter");
  }

  function onRemoveFilter(dim: FilterDimension) {
    commit({ [dim]: "" }, "filter");
    pendingFocusRef.current = "next-pill";
  }

  function onClear() {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    commit({ q: "", category: "", verification: "", signup: "" }, "filter");
    setSearchInput("");
    pendingFocusRef.current = "search";
    document.getElementById("ft-search")?.focus();
  }

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    if (pending === "next-pill") {
      const next = document.querySelector(
        "#ft-results-status [data-ft-remove]",
      );
      if (next instanceof HTMLElement) next.focus();
      else document.getElementById("ft-search")?.focus();
      return;
    }
    if (pending === "grid") {
      // Page change: land focus on the replaced list, then reveal the
      // status line that announces the new window — nearest edge only, so
      // the page never jumps.
      document.getElementById("ft-grid")?.focus({ preventScroll: true });
      document
        .getElementById("ft-results-status")
        ?.scrollIntoView({ block: "nearest" });
      return;
    }
    document.getElementById("ft-search")?.focus();
  });

  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
          <SiteHeader current="home" />
          <SiteStats
            activeCount={offers.length}
            archivedCount={archivedCount}
            generatedAt={index.generated_at}
          />
          <Breadcrumbs page="home" />

          {offers.length > 0 ? (
            <>
              <HotDeals ranked={topToday} bySlug={offersBySlug} pending={hotPending} />
              <Toolbar
                total={offers.length}
                shown={shownList.length}
                pageRange={
                  totalPages > 1
                    ? {
                        start: (page - 1) * PAGE_SIZE + 1,
                        end: (page - 1) * PAGE_SIZE + pageList.length,
                      }
                    : null
                }
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
              <ol className="grid" id="ft-grid" role="list" tabIndex={-1}>
                {pageList.map((offer, i) => (
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
              <Pager
                page={page}
                totalPages={totalPages}
                hrefFor={(n) => {
                  const q = serializeState({ ...state, page: n });
                  return q ? `?${q}` : "./";
                }}
                onSelect={onPageChange}
              />
              <section
                className="empty"
                id="ft-no-results"
                hidden={shownList.length !== 0}
              >
                <SearchGlyph />
                <h2>No matching offers</h2>
                <p>
                  Nothing matches every filter you have applied at once. The
                  status line above lists them; clearing one usually brings
                  offers back.
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
            <section
              className="empty"
              style={{ "--i": 0 } as React.CSSProperties}
            >
              <GiftGlyph />
              <h2>No live offers right now</h2>
              <p>
                Every listing here is screened against the provider, and none
                have passed the check at the moment.
              </p>
              <p>
                New and renewed offers appear automatically after the next
                rebuild &mdash; check back soon.
              </p>
              <p className="empty-archive">
                In the meantime, <a href="archive.html">browse the archive</a>{" "}
                of expired offers.
              </p>
            </section>
          )}
          {/* Hover-free trust definitions (#507 / T4), kept at the bottom of
              the page as a reference. The rows carry review-status and
              evidence-level labels whose meanings used to live only in `title`
              attributes; the legend states them as visible text. */}
          <TrustLegend />
        </main>
        <SiteFooter current="home" />
      </div>
      {/* JSON-LD last: crawlers read the whole document, but FCP content parses first. */}
      <StructuredData page="home" index={index} baseUrl={baseUrl} />
    </>
  );
}
