import { describe, expect, it } from "vitest"
import { emptyState, parseState, serializeState } from "./urlState"

const FULL =
  "?q=foo&sort=expiring&category=coding&verification=social_proof&signup=required"

function paramsOf(state: ReturnType<typeof parseState>) {
  return new URLSearchParams(serializeState(state))
}

describe("parseState / serializeState", () => {
  it("round-trips q, sort, and all three filter params", () => {
    const state = parseState(FULL)
    expect(state).toEqual({
      q: "foo",
      sort: "expiring",
      category: "coding",
      verification: "social_proof",
      signup: "required",
    })
    const params = paramsOf(state)
    expect(params.get("q")).toBe("foo")
    expect(params.get("sort")).toBe("expiring")
    expect(params.get("category")).toBe("coding")
    expect(params.get("verification")).toBe("social_proof")
    expect(params.get("signup")).toBe("required")
    expect(parseState("?" + serializeState(state))).toEqual(state)
  })

  it("keeps filter params when q changes", () => {
    const state = parseState(FULL)
    const params = new URLSearchParams(serializeState({ ...state, q: "bar" }))
    expect(params.get("q")).toBe("bar")
    expect(params.get("sort")).toBe("expiring")
    expect(params.get("category")).toBe("coding")
    expect(params.get("verification")).toBe("social_proof")
    expect(params.get("signup")).toBe("required")
  })

  it("ignores invalid sort and treats empty sort as default", () => {
    expect(parseState("?sort=not-a-mode").sort).toBe("")
    expect(parseState("?sort=").sort).toBe("")
    expect(parseState("").sort).toBe("")
    expect(serializeState({ ...emptyState(), sort: "" })).toBe("")
  })

  it("drops unknown params and omits empty keys", () => {
    const serialized = serializeState(parseState("?q=foo&utm_source=x&bogus=1&sort=newest"))
    const params = new URLSearchParams(serialized)
    expect([...params.keys()].sort()).toEqual(["q", "sort"])
    expect(serialized).not.toContain("utm")
    expect(serialized).not.toContain("bogus")
    expect(serializeState(emptyState())).toBe("")
  })

  it("trims q and rejects values outside each filter enum", () => {
    expect(parseState("?q=%20foo%20").q).toBe("foo")
    expect(parseState("?category=not-real").category).toBe("")
    expect(parseState("?verification=nope").verification).toBe("")
    expect(parseState("?signup=maybe").signup).toBe("")
  })
})
