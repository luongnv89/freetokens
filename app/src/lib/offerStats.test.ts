import { afterEach, describe, expect, it, vi } from "vitest"
import { configureAnalytics, resetAnalyticsForTests } from "./analytics"
import { fetchOfferViews, ftOfferViewsUrl, gcOfferPath } from "./offerStats"

const SITE = "https://luongnv89.goatcounter.com"

function counterResponse(count: unknown, ok = true) {
  return {
    ok,
    json: async () => ({ count }),
  } as unknown as Response
}

afterEach(() => {
  resetAnalyticsForTests()
  vi.restoreAllMocks()
})

describe("per-offer GoatCounter view counters (#101)", () => {
  it("builds the exact encoded counter URL for an offer detail path", () => {
    expect(gcOfferPath("gmi-free-tier")).toBe("/offers/gmi-free-tier.html")
    expect(ftOfferViewsUrl("gmi-free-tier", SITE)).toBe(
      `${SITE}/counter/%2Foffers%2Fgmi-free-tier.html.json`,
    )
    const url = new URL(ftOfferViewsUrl("gmi-free-tier", SITE))
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it("maps successful counter responses to parsed counts keyed by slug", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("alpha") ? counterResponse("1,234") : counterResponse("8"),
    )
    const views = await fetchOfferViews(["alpha", "beta"], SITE, fetchImpl as typeof fetch)
    expect(views).toEqual({ alpha: 1234, beta: 8 })
    expect(fetchImpl).toHaveBeenCalledWith(`${SITE}/counter/%2Foffers%2Falpha.html.json`)
  })

  it("returns null for non-ok responses instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => counterResponse({}, false))
    const views = await fetchOfferViews(["gone"], SITE, fetchImpl as typeof fetch)
    expect(views).toEqual({ gone: null })
  })

  it("returns null when the network is blocked or the payload is malformed", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("blocked")) throw new Error("network blocked")
      return counterResponse("not-a-number")
    })
    const views = await fetchOfferViews(
      ["blocked", "malformed"],
      SITE,
      fetchImpl as unknown as typeof fetch,
    )
    expect(views).toEqual({ blocked: null, malformed: null })
  })

  it("resolves every slug to a value even when one fetch rejects late", async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("slow")) {
        await gate
        return counterResponse("5")
      }
      return counterResponse("7")
    })
    const pending = fetchOfferViews(["slow", "fast"], SITE, fetchImpl as typeof fetch)
    release?.()
    const views = await pending
    expect(views).toEqual({ slow: 5, fast: 7 })
  })

  it("stays prerender-safe: no fetch at import time and empty site short-circuits callers", async () => {
    configureAnalytics({ statsSite: "" })
    const fetchImpl = vi.fn()
    const views = await fetchOfferViews(["alpha"], "", fetchImpl as typeof fetch)
    expect(views).toEqual({})
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
