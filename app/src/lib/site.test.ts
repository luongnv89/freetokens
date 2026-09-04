import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BASE_URL, currentBaseUrl, offerAbsoluteUrl } from "./site";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState(null, "", "/");
});

describe("offer share URLs (#108)", () => {
  it("derives the base from the live location on an offer page", () => {
    window.history.pushState(null, "", "/freetokens/offers/example-offer.html");
    expect(currentBaseUrl()).toBe("http://localhost:3000/freetokens");
    expect(offerAbsoluteUrl("example-offer")).toBe(
      "http://localhost:3000/freetokens/offers/example-offer.html",
    );
  });

  it("produces distinct per-offer URLs anchored at the visited origin", () => {
    window.history.pushState(null, "", "/freetokens/offers/a.html");
    const a = offerAbsoluteUrl("a");
    window.history.pushState(null, "", "/freetokens/offers/b.html");
    const b = offerAbsoluteUrl("b");
    expect(a).not.toBe(b);
    expect(a.endsWith("/offers/a.html")).toBe(true);
    expect(b.endsWith("/offers/b.html")).toBe(true);
    expect(new URL(a).origin).toBe(window.location.origin);
  });

  it("handles a bare offers path without a deploy subpath", () => {
    window.history.pushState(null, "", "/offers/example-offer.html");
    expect(offerAbsoluteUrl("example-offer")).toBe(
      "http://localhost:3000/offers/example-offer.html",
    );
  });

  it("falls back to DEFAULT_BASE_URL outside the browser", () => {
    vi.stubGlobal("window", undefined);
    expect(currentBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(offerAbsoluteUrl("example-offer")).toBe(
      `${DEFAULT_BASE_URL}/offers/example-offer.html`,
    );
  });
});
