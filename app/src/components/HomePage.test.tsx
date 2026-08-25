import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import HomePage from "./HomePage"
import {
  SEARCH_DEBOUNCE_MS,
  bindAnalyticsListeners,
  configureAnalytics,
  grantConsent,
  resetAnalyticsForTests,
} from "../lib/analytics"
import { DISMISSED_KEY, PREFS_KEY, SAVED_KEY } from "../lib/personalState"
import type { Offer, OffersIndex } from "../lib/offers"

const MID = "G-TESTID12345"
const SECRET_QUERY = "secret-query-xyz"

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    slug: "example-offer",
    title: "Example Offer",
    provider: "Example Co",
    category: "coding",
    amount: "$10 credits",
    expiry_date: null,
    source_url: "https://example.com/offer",
    verified_date: "2026-08-01",
    verification: "hand_verified",
    signup: "none",
    status: "active",
    ...overrides,
  }
}

const fixtureOffers: Offer[] = [
  offer({
    slug: "alpha-copilot",
    title: "Alpha Copilot",
    provider: "GitHub",
    category: "coding",
    amount: "$10 credits",
    expiry_date: "2026-09-01",
    verified_date: "2026-01-01",
    verification: "hand_verified",
    signup: "required",
  }),
  offer({
    slug: "alpha-image",
    title: "Alpha Image",
    provider: "Acme",
    category: "image",
    amount: "$30 credits",
    expiry_date: "2026-12-01",
    verified_date: "2026-06-01",
    verification: "hand_verified",
    signup: "required",
  }),
  offer({
    slug: "alpha-social",
    title: "Alpha Social",
    provider: "GitHub",
    category: "coding",
    amount: "$5 credits",
    expiry_date: "2026-10-01",
    verified_date: "2026-03-01",
    verification: "social_proof",
    signup: "required",
  }),
  offer({
    slug: "alpha-free",
    title: "Alpha Free",
    provider: "GitHub",
    category: "coding",
    amount: "$8 credits",
    expiry_date: "2026-11-01",
    verified_date: "2026-04-01",
    verification: "hand_verified",
    signup: "none",
  }),
  offer({
    slug: "beta-copilot",
    title: "Beta Copilot",
    provider: "GitHub",
    category: "coding",
    amount: "$50 credits",
    expiry_date: null,
    verified_date: "2026-08-01",
    verification: "hand_verified",
    signup: "required",
  }),
]

const index: OffersIndex = {
  generated_at: "2026-08-24T00:00:00Z",
  count: fixtureOffers.length,
  active_count: fixtureOffers.length,
  expired_count: 0,
  offers: fixtureOffers,
}

function installGtag() {
  const gtag = vi.fn()
  Object.defineProperty(window, "gtag", {
    value: gtag,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, "dataLayer", {
    value: [],
    configurable: true,
    writable: true,
  })
  return gtag
}

function eventCalls(gtag: ReturnType<typeof vi.fn>, name: string) {
  return gtag.mock.calls.filter((c) => c[0] === "event" && c[1] === name)
}

function grantedGtag() {
  configureAnalytics({ measurementId: MID })
  const gtag = installGtag()
  grantConsent()
  gtag.mockClear()
  return gtag
}

function setSearch(search: string) {
  const next = search
    ? `${window.location.pathname}${search.startsWith("?") ? search : `?${search}`}`
    : window.location.pathname
  window.history.replaceState({}, "", next)
}

function listedSlugs() {
  return [...document.querySelectorAll("#ft-grid article[id^='offer-']")].map((el) =>
    el.id.replace(/^offer-/, ""),
  )
}

function categoryChip(value: string) {
  return document.querySelector(`[data-ft-category="${value}"]`) as HTMLButtonElement
}

function tagOn(slug: string, dimension: string) {
  return document.querySelector(`#offer-${slug} [data-ft-tag="${dimension}"]`) as HTMLButtonElement
}

function statusText() {
  return document.getElementById("ft-results-status")?.textContent ?? ""
}

beforeEach(() => {
  resetAnalyticsForTests()
  setSearch("")
  // Personal state (saved/dismissed/prefs) must not leak between tests:
  // HomePage restores stored prefs on mount, so leftover keys would
  // reorder or filter later tests' fixture lists. Optional chaining
  // keeps this a no-op under jsdom builds where storage is absent.
  window.localStorage?.clear()
})

afterEach(() => {
  resetAnalyticsForTests()
  setSearch("")
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("HomePage masthead counters (#49 port)", () => {
  it("surfaces live, ongoing, and hand-verified counts in the masthead", () => {
    render(<HomePage index={index} />)
    const count = screen.getByText(/live offers/)
    expect(count).toHaveTextContent(
      "5 live offers · 1 ongoing · 4 hand-verified by the maintainer",
    )
  })
})

describe("HomePage search a11y", () => {
  it("labels the search input and keeps it keyboard-focusable", () => {
    render(<HomePage index={index} />)
    const input = screen.getByLabelText("Search")
    expect(input).toHaveAttribute("id", "ft-search")
    expect(input).toHaveAttribute("maxLength", "200")
    expect(input).not.toHaveAttribute("tabIndex", "-1")
    ;(input as HTMLInputElement).focus()
    expect(document.activeElement).toBe(input)
  })
})

describe("HomePage debounce and URL commit", () => {
  it("does not commit until SEARCH_DEBOUNCE_MS (120), then commits", () => {
    vi.useFakeTimers()
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "alpha" } })
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1)
    })
    expect(window.location.search).not.toContain("q=alpha")
    expect(eventCalls(gtag, "search")).toHaveLength(0)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(new URLSearchParams(window.location.search).get("q")).toBe("alpha")
    expect(eventCalls(gtag, "search")).toHaveLength(1)
  })

  it("keeps filter params when q changes and never sends the raw query", () => {
    vi.useFakeTimers()
    setSearch("?category=coding&verification=hand_verified&signup=required&sort=expiring")
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    expect(listedSlugs()).toEqual(["alpha-copilot", "beta-copilot"])
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: SECRET_QUERY } })
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    })
    const params = new URLSearchParams(window.location.search)
    expect(params.get("q")).toBe(SECRET_QUERY)
    expect(params.get("category")).toBe("coding")
    expect(params.get("verification")).toBe("hand_verified")
    expect(params.get("signup")).toBe("required")
    expect(params.get("sort")).toBe("expiring")
    const searchEvents = eventCalls(gtag, "search")
    expect(searchEvents).toHaveLength(1)
    const payload = searchEvents[0][2] as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(["query_length"])
    expect(payload).toEqual({ query_length: SECRET_QUERY.length })
    expect(JSON.stringify(gtag.mock.calls)).not.toContain(SECRET_QUERY)
    expect(JSON.stringify(payload)).not.toMatch(/q=|query[^_]|search_term/i)
  })
})

describe("HomePage sort_use", () => {
  it("fires exactly one sort_use per actual change; empty maps to default", () => {
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    const select = screen.getByLabelText("Sort")
    fireEvent.change(select, { target: { value: "expiring" } })
    expect(eventCalls(gtag, "sort_use")).toHaveLength(1)
    expect(eventCalls(gtag, "sort_use")[0][2]).toEqual({ sort_option: "expiring" })
    expect(listedSlugs()[listedSlugs().length - 1]).toBe("beta-copilot")
    fireEvent.change(select, { target: { value: "expiring" } })
    expect(eventCalls(gtag, "sort_use")).toHaveLength(1)
    fireEvent.change(select, { target: { value: "" } })
    expect(eventCalls(gtag, "sort_use")).toHaveLength(2)
    expect(eventCalls(gtag, "sort_use")[1][2]).toEqual({ sort_option: "default" })
  })
})

describe("HomePage clear and reset filters", () => {
  it("clears q and filters, keeps sort, focuses search, and fires filter_use not search/sort_use", () => {
    vi.useFakeTimers()
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "amount" } })
    expect(eventCalls(gtag, "sort_use")).toHaveLength(1)
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "nomatch-xyz" } })
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    })
    expect(listedSlugs()).toEqual([])
    expect(eventCalls(gtag, "search")).toHaveLength(1)
    gtag.mockClear()

    fireEvent.click(screen.getByRole("button", { name: "Clear search & filters" }))

    expect(listedSlugs()).toEqual([
      "beta-copilot",
      "alpha-image",
      "alpha-copilot",
      "alpha-free",
      "alpha-social",
    ])
    expect(screen.getByLabelText("Search")).toHaveValue("")
    expect(screen.getByLabelText("Sort")).toHaveValue("amount")
    const params = new URLSearchParams(window.location.search)
    expect(params.get("q")).toBeNull()
    expect(params.get("sort")).toBe("amount")
    expect(document.activeElement).toBe(screen.getByLabelText("Search"))
    expect(eventCalls(gtag, "search")).toHaveLength(0)
    expect(eventCalls(gtag, "sort_use")).toHaveLength(0)
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1)
    expect(eventCalls(gtag, "filter_use")[0][2]).toEqual({
      category: "all",
      verification: "all",
      signup: "all",
    })
  })
})

describe("HomePage deep link and popstate", () => {
  it("applies q+sort AND filters from the URL without search or sort_use on load", () => {
    setSearch(
      "?q=alpha&sort=expiring&category=coding&verification=hand_verified&signup=required",
    )
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    expect(listedSlugs()).toEqual(["alpha-copilot"])
    expect(screen.getByLabelText("Search")).toHaveValue("alpha")
    expect(screen.getByLabelText("Sort")).toHaveValue("expiring")
    expect(document.getElementById("ft-results-status")?.textContent).toBe(
      `Showing 1 of ${fixtureOffers.length} offers · Coding · hand-verified · sign-up required`,
    )
    expect(eventCalls(gtag, "search")).toHaveLength(0)
    expect(eventCalls(gtag, "sort_use")).toHaveLength(0)
  })

  it("restores q/sort on popstate without new events", () => {
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "newest" } })
    expect(eventCalls(gtag, "sort_use")).toHaveLength(1)
    gtag.mockClear()
    act(() => {
      window.history.replaceState({}, "", "?q=alpha&sort=amount")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    expect(listedSlugs()).toEqual([
      "alpha-image",
      "alpha-copilot",
      "alpha-free",
      "alpha-social",
    ])
    expect(screen.getByLabelText("Search")).toHaveValue("alpha")
    expect(screen.getByLabelText("Sort")).toHaveValue("amount")
    expect(eventCalls(gtag, "search")).toHaveLength(0)
    expect(eventCalls(gtag, "sort_use")).toHaveLength(0)
  })
})

describe("HomePage three-dimension filters (#126)", () => {
  it("chip click SETs category, does not toggle, and fires filter_use once per click", () => {
    const gtag = grantedGtag()
    const pushSpy = vi.spyOn(window.history, "pushState")
    render(<HomePage index={index} />)

    fireEvent.click(categoryChip("coding"))
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-social",
      "alpha-free",
      "beta-copilot",
    ])
    expect(new URLSearchParams(window.location.search).get("category")).toBe("coding")
    expect(categoryChip("coding")).toHaveAttribute("aria-pressed", "true")
    expect(categoryChip("")).toHaveAttribute("aria-pressed", "false")
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1)
    expect(eventCalls(gtag, "filter_use")[0][2]).toEqual({
      category: "coding",
      verification: "all",
      signup: "all",
    })
    expect(pushSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(categoryChip("coding"))
    expect(new URLSearchParams(window.location.search).get("category")).toBe("coding")
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-social",
      "alpha-free",
      "beta-copilot",
    ])
    expect(eventCalls(gtag, "filter_use")).toHaveLength(2)
    expect(pushSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(categoryChip("image"))
    expect(listedSlugs()).toEqual(["alpha-image"])
    expect(new URLSearchParams(window.location.search).get("category")).toBe("image")
    expect(categoryChip("image")).toHaveAttribute("aria-pressed", "true")
    expect(categoryChip("coding")).toHaveAttribute("aria-pressed", "false")
    expect(eventCalls(gtag, "filter_use")).toHaveLength(3)
    expect(eventCalls(gtag, "filter_use")[2][2]).toEqual({
      category: "image",
      verification: "all",
      signup: "all",
    })

    fireEvent.click(categoryChip(""))
    expect(listedSlugs()).toHaveLength(fixtureOffers.length)
    expect(new URLSearchParams(window.location.search).get("category")).toBeNull()
    expect(categoryChip("")).toHaveAttribute("aria-pressed", "true")
    expect(eventCalls(gtag, "filter_use")[3][2]).toEqual({
      category: "all",
      verification: "all",
      signup: "all",
    })
  })

  it("row tag click applies that dimension and clicking again clears it", () => {
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    fireEvent.click(tagOn("alpha-free", "verification"))
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-image",
      "alpha-free",
      "beta-copilot",
    ])
    expect(window.location.search).toBe("?verification=hand_verified")
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1)

    fireEvent.click(tagOn("alpha-free", "verification"))
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-image",
      "alpha-social",
      "alpha-free",
      "beta-copilot",
    ])
    expect(window.location.search).toBe("")
    expect(eventCalls(gtag, "filter_use")).toHaveLength(2)
  })

  it("aria-pressed syncs across every row showing the applied value", () => {
    render(<HomePage index={index} />)
    fireEvent.click(tagOn("alpha-free", "verification"))
    expect(tagOn("alpha-free", "verification")).toHaveAttribute("aria-pressed", "true")
    expect(tagOn("alpha-copilot", "verification")).toHaveAttribute("aria-pressed", "true")
    expect(tagOn("alpha-image", "verification")).toHaveAttribute("aria-pressed", "true")
    expect(tagOn("alpha-social", "verification")).toBeNull()
    expect(tagOn("alpha-free", "signup")).toHaveAttribute("aria-pressed", "false")
  })

  it("chips, tags, and search AND-combine and stay shareable", () => {
    vi.useFakeTimers()
    render(<HomePage index={index} />)
    fireEvent.click(tagOn("alpha-free", "verification"))
    fireEvent.click(tagOn("alpha-free", "signup"))
    fireEvent.click(categoryChip("coding"))
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "free" } })
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    })
    expect(listedSlugs()).toEqual(["alpha-free"])
    const params = new URLSearchParams(window.location.search)
    expect(params.get("verification")).toBe("hand_verified")
    expect(params.get("signup")).toBe("none")
    expect(params.get("category")).toBe("coding")
    expect(params.get("q")).toBe("free")
    expect(statusText()).toBe(
      `Showing 1 of ${fixtureOffers.length} offers · Coding · hand-verified · no sign-up`,
    )
  })

  it("status pills name active filters and dropping one leaves the others", () => {
    render(<HomePage index={index} />)
    fireEvent.click(tagOn("alpha-free", "verification"))
    fireEvent.click(tagOn("alpha-free", "signup"))
    expect(listedSlugs()).toEqual(["alpha-free"])
    expect(statusText()).toBe(
      `Showing 1 of ${fixtureOffers.length} offers · hand-verified · no sign-up`,
    )
    fireEvent.click(screen.getByRole("button", { name: "Remove no sign-up filter" }))
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-image",
      "alpha-free",
      "beta-copilot",
    ])
    expect(window.location.search).toBe("?verification=hand_verified")
    expect(statusText()).toBe(
      `Showing 4 of ${fixtureOffers.length} offers · hand-verified`,
    )
  })

  it("removing a pill focuses the next pill, then search when none remain", () => {
    render(<HomePage index={index} />)
    fireEvent.click(tagOn("alpha-free", "verification"))
    fireEvent.click(tagOn("alpha-free", "signup"))
    fireEvent.click(screen.getByRole("button", { name: "Remove hand-verified filter" }))
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove no sign-up filter" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Remove no sign-up filter" }))
    expect(document.activeElement).toBe(screen.getByLabelText("Search"))
  })

  it("filtering does not reorder remaining rows", () => {
    render(<HomePage index={index} />)
    const before = listedSlugs()
    expect(before).toEqual([
      "alpha-copilot",
      "alpha-image",
      "alpha-social",
      "alpha-free",
      "beta-copilot",
    ])
    fireEvent.click(categoryChip("coding"))
    expect(listedSlugs()).toEqual(before.filter((slug) => slug !== "alpha-image"))
  })

  it("keeps keyboard focus on the row tag that applied the filter", () => {
    render(<HomePage index={index} />)
    const tag = tagOn("alpha-free", "verification")
    tag.focus()
    expect(document.activeElement).toBe(tag)
    fireEvent.click(tag)
    expect(document.activeElement).toBe(tagOn("alpha-free", "verification"))
    expect(tagOn("alpha-free", "verification")).toHaveAttribute("aria-pressed", "true")
  })

  it("empty result set from filters shows a working reset that focuses search", () => {
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    fireEvent.click(categoryChip("video"))
    expect(listedSlugs()).toEqual([])
    expect(document.getElementById("ft-no-results")?.hidden).toBe(false)
    expect(statusText()).toBe(`Showing 0 of ${fixtureOffers.length} offers · Video`)
    gtag.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Clear search & filters" }))
    expect(listedSlugs()).toHaveLength(fixtureOffers.length)
    expect(document.getElementById("ft-no-results")?.hidden).toBe(true)
    expect(document.activeElement).toBe(screen.getByLabelText("Search"))
    expect(window.location.search).toBe("")
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1)
  })

  it("All chip SETs category empty without clearing other dimensions", () => {
    render(<HomePage index={index} />)
    fireEvent.click(tagOn("alpha-free", "verification"))
    fireEvent.click(categoryChip("coding"))
    expect(new URLSearchParams(window.location.search).get("category")).toBe("coding")
    fireEvent.click(categoryChip(""))
    const params = new URLSearchParams(window.location.search)
    expect(params.get("category")).toBeNull()
    expect(params.get("verification")).toBe("hand_verified")
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-image",
      "alpha-free",
      "beta-copilot",
    ])
  })

  it("Clear all filters removes every filter and names them in the status line first", () => {
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    fireEvent.click(categoryChip("coding"))
    fireEvent.click(tagOn("alpha-free", "signup"))
    expect(statusText()).toContain("Coding")
    expect(statusText()).toContain("no sign-up")
    expect(screen.getByRole("button", { name: "Clear all filters" })).not.toHaveAttribute(
      "hidden",
    )
    gtag.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }))
    expect(listedSlugs()).toHaveLength(fixtureOffers.length)
    expect(statusText()).toBe(`Showing all ${fixtureOffers.length} offers`)
    expect(window.location.search).toBe("")
    expect(document.activeElement).toBe(screen.getByLabelText("Search"))
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1)
    expect(eventCalls(gtag, "filter_use")[0][2]).toEqual({
      category: "all",
      verification: "all",
      signup: "all",
    })
  })

  it("bindAnalyticsListeners does not double-fire filter_use on chip click", () => {
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    bindAnalyticsListeners()
    fireEvent.click(categoryChip("image"))
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1)
    expect(eventCalls(gtag, "filter_use")[0][2]).toEqual({
      category: "image",
      verification: "all",
      signup: "all",
    })
  })
})

describe("HomePage saved and dismissed personal state (#140)", () => {
  let store: Record<string, string>

  function installPersonalStorage() {
    store = {}
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => {
          store[key] = String(value)
        },
        removeItem: (key: string) => {
          delete store[key]
        },
        clear: () => {
          for (const k of Object.keys(store)) delete store[k]
        },
      },
      configurable: true,
      writable: true,
    })
  }

  function stored(key: string) {
    return key in store ? JSON.parse(store[key]) : null
  }

  beforeEach(() => {
    installPersonalStorage()
  })

  function saveButton(slug: string) {
    return document.querySelector(`[data-ft-save="${slug}"]`) as HTMLButtonElement
  }

  function dismissButton(slug: string) {
    return document.querySelector(`[data-ft-dismiss="${slug}"]`) as HTMLButtonElement
  }

  function savedToggle() {
    return document.querySelector("[data-ft-saved-toggle]") as HTMLButtonElement
  }

  it("saving persists to localStorage and survives a remount (reload/routes)", () => {
    const { unmount } = render(<HomePage index={index} />)
    fireEvent.click(saveButton("alpha-copilot"))
    expect(saveButton("alpha-copilot").getAttribute("aria-pressed")).toBe("true")
    expect(stored(SAVED_KEY)).toEqual({ v: 1, slugs: ["alpha-copilot"] })
    unmount()

    render(<HomePage index={index} />)
    expect(saveButton("alpha-copilot").getAttribute("aria-pressed")).toBe("true")
    expect(saveButton("alpha-image").getAttribute("aria-pressed")).toBe("false")
  })

  it("saved-only view lists exactly the saved offers, even with filters active", () => {
    store[SAVED_KEY] = JSON.stringify({ v: 1, slugs: ["alpha-social", "beta-copilot"] })
    setSearch("?category=image")
    render(<HomePage index={index} />)
    fireEvent.click(savedToggle())
    expect(listedSlugs()).toEqual(["alpha-social", "beta-copilot"])
    expect(savedToggle().getAttribute("aria-pressed")).toBe("true")
    // Toggling back restores the default (filtered) list.
    fireEvent.click(savedToggle())
    expect(listedSlugs()).toEqual(["alpha-image"])
  })

  it("dismissed offers vanish from the default list; count shows and one click restores all", () => {
    const { unmount } = render(<HomePage index={index} />)
    act(() => {
      dismissButton("alpha-copilot").click()
      dismissButton("alpha-free").click()
    })
    expect(stored(DISMISSED_KEY).slugs).toContain("alpha-copilot")
    expect(listedSlugs()).not.toContain("alpha-copilot")
    expect(listedSlugs()).not.toContain("alpha-free")
    expect(statusText()).toContain("2 hidden — restore")

    const restore = document.querySelector("[data-ft-restore-dismissed]") as HTMLButtonElement
    expect(restore.getAttribute("aria-label")).toBe("Restore 2 hidden offers")
    fireEvent.click(restore)
    expect(listedSlugs()).toHaveLength(fixtureOffers.length)
    expect(store[DISMISSED_KEY]).toBeUndefined()

    // Remount keeps the restored state.
    unmount()
    render(<HomePage index={index} />)
    expect(listedSlugs()).toHaveLength(fixtureOffers.length)
  })

  it("dismissing an offer removes it from the saved shortlist until restored", () => {
    store[SAVED_KEY] = JSON.stringify({ v: 1, slugs: ["alpha-copilot"] })
    render(<HomePage index={index} />)
    fireEvent.click(dismissButton("alpha-copilot"))
    expect(stored(SAVED_KEY).slugs).toEqual([])
    expect(listedSlugs()).not.toContain("alpha-copilot")

    fireEvent.click(document.querySelector("[data-ft-restore-dismissed]") as HTMLButtonElement)
    expect(listedSlugs()).toContain("alpha-copilot")
    expect(saveButton("alpha-copilot").getAttribute("aria-pressed")).toBe("false")
    expect(saveButton("alpha-copilot").textContent).toBe("Save")
  })

  it("personal actions never leak into the URL or analytics events", () => {
    const gtag = grantedGtag()
    render(<HomePage index={index} />)
    fireEvent.click(saveButton("alpha-copilot"))
    fireEvent.click(dismissButton("alpha-image"))
    fireEvent.click(savedToggle())
    expect(window.location.search).toBe("")
    const eventNames = gtag.mock.calls.filter((c) => c[0] === "event").map((c) => c[1])
    expect(eventNames).not.toContain("save_offer")
    expect(eventNames).not.toContain("dismiss_offer")
    expect(eventNames.filter((n) => n !== "page_view")).toEqual([])
  })

  it("restores last-used filter/sort prefs on reload with an empty URL", () => {
    store[PREFS_KEY] = JSON.stringify({
      v: 1,
      category: "image",
      verification: "",
      signup: "",
      sort: "amount",
    })
    render(<HomePage index={index} />)
    expect(categoryChip("image").getAttribute("aria-pressed")).toBe("true")
    expect(listedSlugs()[0]).toBe("alpha-image")
    // URL may reflect only filter/search/sort — never saved/dismissed flags.
    expect(window.location.search).toContain("category=image")
    expect(window.location.search).not.toContain("saved")
    expect(window.location.search).not.toContain("dismissed")
  })

  it("a URL with explicit state always wins over stored prefs", () => {
    store[PREFS_KEY] = JSON.stringify({
      v: 1,
      category: "image",
      verification: "",
      signup: "",
      sort: "",
    })
    setSearch("?category=coding")
    render(<HomePage index={index} />)
    expect(categoryChip("coding").getAttribute("aria-pressed")).toBe("true")
    expect(categoryChip("image").getAttribute("aria-pressed")).toBe("false")
  })

  it("invalid stored pref values degrade to defaults instead of applying", () => {
    store[PREFS_KEY] = JSON.stringify({ v: 1, category: "not-a-category", sort: "bogus" })
    render(<HomePage index={index} />)
    expect(categoryChip("not-a-category")).toBeNull()
    expect(window.location.search).toBe("")
  })

  it("clearing browser storage returns the site to its default state with no error", () => {
    store[SAVED_KEY] = JSON.stringify({ v: 1, slugs: ["alpha-copilot"] })
    store[DISMISSED_KEY] = JSON.stringify({ v: 1, slugs: ["alpha-image"] })
    const { unmount } = render(<HomePage index={index} />)
    expect(listedSlugs()).toHaveLength(fixtureOffers.length - 1)

    window.localStorage.clear()
    unmount()
    render(<HomePage index={index} />)
    expect(() => listedSlugs()).not.toThrow()
    expect(listedSlugs()).toHaveLength(fixtureOffers.length)
    expect(savedToggle().textContent).toContain("Saved (0)")
  })

  it("save/dismiss controls are real keyboard-operable buttons with announced state", () => {
    render(<HomePage index={index} />)
    const save = saveButton("beta-copilot")
    save.focus()
    expect(document.activeElement).toBe(save)
    fireEvent.click(save) // keyboard activation of a button fires click
    expect(save.getAttribute("aria-pressed")).toBe("true")
    expect(save.getAttribute("aria-label")).toBe("Remove Beta Copilot from saved")
    const dismiss = dismissButton("beta-copilot")
    expect(dismiss.tagName).toBe("BUTTON")
    expect(dismiss.getAttribute("aria-label")).toBe("Hide Beta Copilot from the list")
    expect(document.getElementById("ft-results-status")?.getAttribute("role")).toBe("status")
  })
})
