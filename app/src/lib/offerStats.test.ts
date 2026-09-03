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

  it("treats a zero count as a real number, not a hide-me empty", async () => {
    const fetchImpl = vi.fn(async () => counterResponse("0"))
    const views = await fetchOfferViews(["alpha"], SITE, fetchImpl as typeof fetch)
    expect(views).toEqual({ alpha: 0 })
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

describe("windowed per-offer counters for the hot ranking (#282)", () => {
  // Local-time noon so no timezone or DST edge can shift a calendar day.
  const NOW = new Date(2026, 8, 3, 12, 0, 0)

  function params(url: string) {
    const q = new URL(url).searchParams
    return { start: q.get("start"), end: q.get("end") }
  }

  it("stays byte-identical to the legacy unwindowed URL when days is omitted", () => {
    const legacy = `${SITE}/counter/%2Foffers%2Fgmi-free-tier.html.json`
    expect(ftOfferViewsUrl("gmi-free-tier", SITE)).toBe(legacy)
    expect(ftOfferViewsUrl("gmi-free-tier", SITE, null)).toBe(legacy)
    expect(ftOfferViewsUrl("gmi-free-tier", SITE, undefined, NOW)).toBe(legacy)
  })

  it("windows days=1 on today with an exclusive tomorrow end (#102)", () => {
    const url = ftOfferViewsUrl("gmi-free-tier", SITE, 1, NOW)
    expect(url.startsWith(`${SITE}/counter/%2Foffers%2Fgmi-free-tier.html.json?`)).toBe(true)
    const { start, end } = params(url)
    expect(start).toBe("2026-09-03")
    expect(end).toBe("2026-09-04")
    expect(start).not.toBe(end)
  })

  it("counts calendar days inclusive of today for a wider span", () => {
    expect(params(ftOfferViewsUrl("a", SITE, 2, NOW))).toEqual({
      start: "2026-09-02",
      end: "2026-09-04",
    })
  })

  it("clamps zero and negative spans to a single day rather than collapsing the window", () => {
    for (const days of [0, -1, -30]) {
      const { start, end } = params(ftOfferViewsUrl("a", SITE, days, NOW))
      expect(start).toBe("2026-09-03")
      expect(end).toBe("2026-09-04")
      expect(start).not.toBe(end)
    }
  })

  it("never emits a cache-buster — GoatCounter keys its CDN on start/end only", () => {
    const url = new URL(ftOfferViewsUrl("a", SITE, 1, NOW))
    expect([...url.searchParams.keys()].sort()).toEqual(["end", "start"])
  })

  it("forwards the window into every fetch while keeping null seeding and silent failure", async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url)
      if (url.includes("blocked")) throw new Error("network blocked")
      return counterResponse("4")
    })
    const views = await fetchOfferViews(
      ["alpha", "blocked"],
      SITE,
      fetchImpl as unknown as typeof fetch,
      1,
    )
    expect(views).toEqual({ alpha: 4, blocked: null })
    expect(seen.every((u) => u.includes("start=") && u.includes("end="))).toBe(true)
  })
})
