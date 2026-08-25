import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import HomePage from "./HomePage"
import {
  SEARCH_DEBOUNCE_MS,
  configureAnalytics,
  grantConsent,
  resetAnalyticsForTests,
} from "../lib/analytics"
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

beforeEach(() => {
  resetAnalyticsForTests()
  setSearch("")
})

afterEach(() => {
  resetAnalyticsForTests()
  setSearch("")
  vi.useRealTimers()
  vi.restoreAllMocks()
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
      `Showing 1 of ${fixtureOffers.length} offers`,
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
