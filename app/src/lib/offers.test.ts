import { describe, it, expect } from "vitest";
import {
  amountSortValue,
  buildDate,
  formatAmountSort,
  humanDate,
  relativeDate,
  activeOffers,
  type OffersIndex,
} from "./offers";

// Expected values cross-checked against scripts/build.py (_human_date,
// _relative_date, amount_sort_value) so the React parity layer can never
// silently drift from the Python builder.
describe("humanDate", () => {
  it("renders YYYY-MM-DD as e.g. 'Sep 6, 2026'", () => {
    expect(humanDate("2026-09-06")).toBe("Sep 6, 2026");
    expect(humanDate("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("passes through non-dates unchanged", () => {
    expect(humanDate("")).toBe("");
    expect(humanDate("garbage")).toBe("garbage");
  });
});

describe("buildDate", () => {
  it("slices the calendar day off generated_at", () => {
    expect(buildDate("2026-08-24T22:33:21Z")).toBe("2026-08-24");
  });
});

describe("relativeDate", () => {
  const today = "2026-08-24";

  it("collapses future dates and today to 'today'", () => {
    expect(relativeDate("2026-08-24", today)).toBe("today");
    expect(relativeDate("2026-08-25", today)).toBe("today");
  });

  it("renders yesterday", () => {
    expect(relativeDate("2026-08-23", today)).toBe("yesterday");
  });

  it("renders days under a week as 'Nd ago'", () => {
    expect(relativeDate("2026-08-18", today)).toBe("6d ago");
  });

  it("renders weeks under the freshness window as 'Nw ago'", () => {
    expect(relativeDate("2026-08-11", today)).toBe("1w ago");
  });

  it("falls back to the absolute date past RELATIVE_DATE_MAX_DAYS (14)", () => {
    expect(relativeDate("2026-08-01", today)).toBe("Aug 1, 2026");
  });
});

describe("amountSortValue", () => {
  it("takes the first number and strips commas", () => {
    expect(amountSortValue("$300 in credits")).toBe(300);
    expect(amountSortValue("2,000 completions + 50 chats")).toBe(2000);
  });

  it("honors k/M multipliers", () => {
    expect(amountSortValue("10k credits/month")).toBe(10_000);
    expect(amountSortValue("5M tokens")).toBe(5_000_000);
  });

  it("sorts unparseable strings as 0", () => {
    expect(amountSortValue("free while stocks last")).toBe(0);
    expect(amountSortValue("")).toBe(0);
  });

  it("only applies k/M when the value STARTS the string (build.py re.match)", () => {
    // Regression: "MiniMax M3" must sort as 3, never "M for million".
    expect(amountSortValue("MiniMax M3, M2.7 free for 14 days")).toBe(3);
  });
});

describe("formatAmountSort", () => {
  // Expected strings lifted straight from the Python-built site/index.html
  // data-amount-sort attributes — byte parity with build.py's %g formatting.
  it("keeps small values plain", () => {
    expect(formatAmountSort(3)).toBe("3");
    expect(formatAmountSort(15)).toBe("15");
    expect(formatAmountSort(5.2)).toBe("5.2");
    expect(formatAmountSort(20000)).toBe("20000");
  });

  it("switches to exponent notation past 6 digits, %g-style", () => {
    expect(formatAmountSort(3_000_000)).toBe("3e+06");
    expect(formatAmountSort(50_000_000)).toBe("5e+07");
  });
});

describe("activeOffers", () => {
  const index = {
    generated_at: "2026-08-24T00:00:00Z",
    count: 3,
    active_count: 1,
    expired_count: 2,
    offers: [
      { slug: "a", status: "expired" },
      { slug: "b", status: "active" },
      { slug: "c", status: "expired" },
    ],
  } as unknown as OffersIndex;

  it("drops expired entries from the visitor list (#25)", () => {
    expect(activeOffers(index).map((o) => o.slug)).toEqual(["b"]);
  });
});
