import { describe, expect, it } from "vitest";
import { emptyState, normalizeSort, parseState, serializeState } from "./urlState";

const FULL =
  "?q=foo&sort=expiring&category=coding&verification=social_proof&signup=required";

function paramsOf(state: ReturnType<typeof parseState>) {
  return new URLSearchParams(serializeState(state));
}

describe("parseState / serializeState", () => {
  it("round-trips q, sort, and all three filter params", () => {
    const state = parseState(FULL);
    expect(state).toEqual({
      q: "foo",
      sort: "expiring",
      category: "coding",
      verification: "social_proof",
      signup: "required",
      page: 1,
    });
    const params = paramsOf(state);
    expect(params.get("q")).toBe("foo");
    expect(params.get("sort")).toBe("expiring");
    expect(params.get("category")).toBe("coding");
    expect(params.get("verification")).toBe("social_proof");
    expect(params.get("signup")).toBe("required");
    expect(parseState("?" + serializeState(state))).toEqual(state);
  });

  it("keeps filter params when q changes", () => {
    const state = parseState(FULL);
    const params = new URLSearchParams(serializeState({ ...state, q: "bar" }));
    expect(params.get("q")).toBe("bar");
    expect(params.get("sort")).toBe("expiring");
    expect(params.get("category")).toBe("coding");
    expect(params.get("verification")).toBe("social_proof");
    expect(params.get("signup")).toBe("required");
  });

  it("ignores invalid sort and treats empty sort as default", () => {
    expect(parseState("?sort=not-a-mode").sort).toBe("");
    expect(parseState("?sort=").sort).toBe("");
    expect(parseState("").sort).toBe("");
    expect(serializeState({ ...emptyState(), sort: "" })).toBe("");
  });

  it("accepts the 'added' (Latest added) sort and round-trips it", () => {
    const state = parseState("?sort=added");
    expect(state.sort).toBe("added");
    expect(serializeState(state)).toBe("sort=added");
  });

  it("retires the legacy cross-unit amount sort to the default order (#508)", () => {
    // "amount" is no longer a supported mode, so an old bookmark or stored
    // pref must fall back to the default order instead of ranking mixed units.
    expect(parseState("?sort=amount").sort).toBe("");
    expect(normalizeSort("amount")).toBe("");
  });

  it("drops unknown params and omits empty keys", () => {
    const serialized = serializeState(
      parseState("?q=foo&utm_source=x&bogus=1&sort=newest"),
    );
    const params = new URLSearchParams(serialized);
    expect([...params.keys()].sort()).toEqual(["q", "sort"]);
    expect(serialized).not.toContain("utm");
    expect(serialized).not.toContain("bogus");
    expect(serializeState(emptyState())).toBe("");
  });

  it("trims q and rejects values outside each filter enum", () => {
    expect(parseState("?q=%20foo%20").q).toBe("foo");
    expect(parseState("?category=not-real").category).toBe("");
    expect(parseState("?verification=nope").verification).toBe("");
    expect(parseState("?signup=maybe").signup).toBe("");
  });

  it("carries the oss_program category through parse and serialize", () => {
    expect(parseState("?category=oss_program").category).toBe("oss_program");
    const state = { ...emptyState(), category: "oss_program" };
    expect(serializeState(state)).toBe("category=oss_program");
    expect(parseState(`?${serializeState(state)}`)).toEqual(state);
  });
});

describe("page param (#548)", () => {
  it("parses a bare positive page number", () => {
    expect(parseState("?page=3").page).toBe(3);
    expect(parseState("?page=1").page).toBe(1);
  });

  it("falls back to page 1 for missing or malformed values", () => {
    for (const search of [
      "",
      "?page=0",
      "?page=-1",
      "?page=abc",
      "?page=2.5",
      "?page=01",
      "?page=",
    ]) {
      expect(parseState(search).page, search).toBe(1);
    }
  });

  it("omits page 1 and appends a later page after sort", () => {
    expect(serializeState({ ...emptyState(), page: 1 })).toBe("");
    const state = { ...emptyState(), sort: "newest", page: 3 };
    expect(serializeState(state)).toBe("sort=newest&page=3");
  });

  it("round-trips a page alongside the other params", () => {
    const state = parseState("?q=foo&page=4");
    expect(state.page).toBe(4);
    expect(serializeState(state)).toBe("q=foo&page=4");
    expect(parseState("?" + serializeState(state))).toEqual(state);
  });
});
