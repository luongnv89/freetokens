import { describe, it, expect } from "vitest"
import {
  FALLBACK_STEPS,
  META_DESCRIPTION_MAX,
  claimSteps,
  isRenderableProof,
  offerMetaDescription,
  renderableProofs,
  resolveAsset,
} from "./offerDetails"

const offer = { amount: "$10 credits", provider: "Example Co" }

describe("claimSteps", () => {
  it("returns fallback steps when detail is missing or claim_steps is empty", () => {
    expect(claimSteps(undefined)).toEqual([...FALLBACK_STEPS])
    expect(claimSteps(null)).toEqual([...FALLBACK_STEPS])
    expect(claimSteps({})).toEqual([...FALLBACK_STEPS])
    expect(claimSteps({ claim_steps: [] })).toEqual([...FALLBACK_STEPS])
  })

  it("returns the document's claim_steps when present", () => {
    expect(claimSteps({ claim_steps: ["One.", "Two."] })).toEqual(["One.", "Two."])
  })
})

describe("offerMetaDescription", () => {
  it("uses the generic amount/provider blurb without a summary", () => {
    expect(offerMetaDescription(offer, undefined)).toBe(
      "$10 credits from Example Co — free AI credits, tagged by review status, verification level, and sign-up need.",
    )
  })

  it("passes through a short summary unchanged", () => {
    expect(offerMetaDescription(offer, { summary: "Short blurb." })).toBe("Short blurb.")
  })

  it("truncates at 160 chars with a 157-char prefix, rstrip, and ellipsis", () => {
    const summary = "A".repeat(200)
    const blurb = offerMetaDescription(offer, { summary })
    expect(blurb.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX)
    expect(blurb).toBe("A".repeat(157) + "...")
    expect(offerMetaDescription(offer, { summary: "B".repeat(160) })).toBe("B".repeat(160))
  })
})

describe("resolveAsset", () => {
  it("prefixes site-relative paths for depth-1 pages and leaves others alone", () => {
    expect(resolveAsset("assets/shot.png")).toBe("../assets/shot.png")
    expect(resolveAsset("../assets/shot.png")).toBe("../assets/shot.png")
    expect(resolveAsset("./assets/shot.png")).toBe("./assets/shot.png")
    expect(resolveAsset("/assets/shot.png")).toBe("/assets/shot.png")
    expect(resolveAsset("https://cdn.example/shot.png")).toBe("https://cdn.example/shot.png")
  })
})

describe("isRenderableProof / required keys", () => {
  it("accepts all four types when required keys are present", () => {
    expect(
      isRenderableProof({
        type: "x",
        url: "https://x.com/a/status/1",
        author: "Ada",
        text: "works",
      }),
    ).toBe(true)
    expect(
      isRenderableProof({
        type: "reddit",
        url: "https://reddit.com/r/x/comments/1",
        author: "u/ada",
        text: "works",
        community: "r/LocalLLaMA",
      }),
    ).toBe(true)
    expect(
      isRenderableProof({
        type: "screenshot",
        image: "assets/gmi-minimax-m3-curator-run.jpg",
        caption: "A run.",
      }),
    ).toBe(true)
    expect(
      isRenderableProof({
        type: "link",
        url: "https://example.com/source",
        title: "Official page",
      }),
    ).toBe(true)
  })

  it("rejects entries missing required keys or using a bad screenshot path", () => {
    expect(isRenderableProof({ type: "x", url: "https://x.com/a", author: "Ada" })).toBe(false)
    expect(isRenderableProof({ type: "reddit", url: "https://reddit.com/r/x", text: "hi" })).toBe(
      false,
    )
    expect(isRenderableProof({ type: "screenshot", image: "assets/x.png" })).toBe(false)
    expect(
      isRenderableProof({ type: "screenshot", image: "../escape.png", caption: "nope" }),
    ).toBe(false)
    expect(isRenderableProof({ type: "link", url: "https://example.com" })).toBe(false)
    expect(isRenderableProof({ type: "unknown", url: "https://example.com", title: "x" })).toBe(
      false,
    )
  })

  it("drops incomplete proofs from a mixed list", () => {
    const kept = renderableProofs([
      { type: "link", url: "https://example.com", title: "Ok" },
      { type: "x", author: "Ada" },
      { type: "reddit", url: "https://reddit.com/r/x", author: "u/ada", text: "quoted" },
    ])
    expect(kept.map((p) => p.type)).toEqual(["link", "reddit"])
  })
})
