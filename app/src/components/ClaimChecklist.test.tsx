import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ClaimChecklist } from "./ClaimChecklist"
import {
  bindAnalyticsListeners,
  configureAnalytics,
  grantConsent,
  resetAnalyticsForTests,
} from "../lib/analytics"
import { claimStorageKey } from "../lib/personalState"

const STEPS = ["Open the page.", "Sign in.", "Claim the credit."]
const SLUG = "example-offer"
const OTHER = "other-offer"

type LS = Record<string, string>

function makeLocalStorage() {
  const store: LS = {}
  return {
    impl: {
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
  }
}

function installStorage(impl: ReturnType<typeof makeLocalStorage>["impl"]) {
  Object.defineProperty(window, "localStorage", {
    value: impl,
    configurable: true,
    writable: true,
  })
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

beforeEach(() => {
  installStorage(makeLocalStorage().impl)
  resetAnalyticsForTests()
})

afterEach(() => {
  resetAnalyticsForTests()
  vi.restoreAllMocks()
})

describe("ClaimChecklist persistence (#128)", () => {
  it("persists a checked step across remount for that slug only", async () => {
    const { unmount } = render(<ClaimChecklist slug={SLUG} steps={STEPS} />)
    fireEvent.click(screen.getAllByRole("checkbox")[0])
    expect(JSON.parse(window.localStorage.getItem(claimStorageKey(SLUG))!)).toEqual({
      v: 1,
      done: [0],
    })
    unmount()

    render(<ClaimChecklist slug={SLUG} steps={STEPS} />)
    await waitFor(() => {
      const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[]
      expect(boxes.map((el) => el.checked)).toEqual([true, false, false])
    })
    expect(window.localStorage.getItem(claimStorageKey(OTHER))).toBeNull()
  })

  it("honours a legacy ft-claim-<slug> bare array from the live site", async () => {
    window.localStorage.setItem(claimStorageKey(SLUG), JSON.stringify([0, 2]))
    render(<ClaimChecklist slug={SLUG} steps={STEPS} />)
    await waitFor(() => {
      const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[]
      expect(boxes.map((el) => el.checked)).toEqual([true, false, true])
    })
    expect(screen.getByRole("status")).toHaveTextContent("2/3 done")
  })

  it("does not apply one offer's progress to another slug", async () => {
    window.localStorage.setItem(claimStorageKey(SLUG), JSON.stringify({ v: 1, done: [1] }))
    render(<ClaimChecklist slug={OTHER} steps={STEPS} />)
    await waitFor(() => {
      const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[]
      expect(boxes.every((el) => !el.checked)).toBe(true)
    })
  })

  it("renders real checkboxes so JS-off ticking still works", () => {
    render(<ClaimChecklist slug={SLUG} steps={STEPS} />)
    const boxes = screen.getAllByRole("checkbox")
    expect(boxes).toHaveLength(3)
    expect(boxes[0]).toHaveAttribute("id", `ft-step-${SLUG}-1`)
    expect(screen.getByText("Open the page.")).toBeInTheDocument()
  })

  it("does not call trackOfferClick when a claim checkbox is ticked", () => {
    // React binds offer_click on document; Python scoped it to #ft-grid.
    // Checklist chrome must keep data-ft-checklist (runbook) but never
    // data-ft-offer-id, or ticking a step would fire a ghost offer_click.
    configureAnalytics({ measurementId: "G-ABCDEF12345" })
    const gtag = installGtag()
    grantConsent()
    gtag.mockClear()
    bindAnalyticsListeners()
    render(<ClaimChecklist slug={SLUG} steps={STEPS} />)
    const section = document.querySelector("[data-ft-checklist]")
    expect(section).not.toBeNull()
    expect(section).not.toHaveAttribute("data-ft-offer-id")
    fireEvent.click(screen.getAllByRole("checkbox")[0])
    const offerClicks = gtag.mock.calls.filter((c) => c[0] === "event" && c[1] === "offer_click")
    expect(offerClicks).toHaveLength(0)
  })
})
