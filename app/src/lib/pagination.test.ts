import { describe, expect, it } from "vitest";
import { pageCount, pageItems } from "./pagination";

describe("pageCount", () => {
  it("ceil-divides and never drops below one page", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
    expect(pageCount(195)).toBe(10);
  });
});

describe("pageItems", () => {
  it("lists every page when there are at most seven", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("pins the head window while current is 4 or lower", () => {
    expect(pageItems(1, 10)).toEqual([1, 2, 3, 4, 5, "gap", 10]);
    expect(pageItems(4, 10)).toEqual([1, 2, 3, 4, 5, "gap", 10]);
  });

  it("pins the tail window within four of the last page", () => {
    expect(pageItems(7, 10)).toEqual([1, "gap", 6, 7, 8, 9, 10]);
    expect(pageItems(10, 10)).toEqual([1, "gap", 6, 7, 8, 9, 10]);
  });

  it("centres the window around mid-range pages", () => {
    expect(pageItems(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageItems(6, 10)).toEqual([1, "gap", 5, 6, 7, "gap", 10]);
  });

  it("hands off between head and tail windows at eight pages", () => {
    // total 8 is the smallest catalog where both branches apply: 4 still
    // belongs to the head window, 5 is already inside the tail.
    expect(pageItems(4, 8)).toEqual([1, 2, 3, 4, 5, "gap", 8]);
    expect(pageItems(5, 8)).toEqual([1, "gap", 4, 5, 6, 7, 8]);
  });
});
