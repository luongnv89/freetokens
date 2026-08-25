import { describe, it, expect } from "vitest";
import {
  amountSortValue,
  applySort,
  buildDate,
  formatAmountSort,
  humanDate,
  offerMatches,
  relativeDate,
  activeOffers,
  type Offer,
  type OffersIndex,
} from "./offers";
import { emptyState } from "./urlState";

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
  };
}

describe("offerMatches", () => {
  const base = emptyState();

  it("matches a lowercase substring on title, provider, or amount", () => {
    const row = offer({ title: "Copilot Pro", provider: "GitHub", amount: "$10 credits" });
    expect(offerMatches(row, { ...base, q: "copilot" })).toBe(true);
    expect(offerMatches(row, { ...base, q: "GITHUB" })).toBe(true);
    expect(offerMatches(row, { ...base, q: "credits" })).toBe(true);
    expect(offerMatches(row, { ...base, q: "missing" })).toBe(false);
  });

  it("requires every active filter AND the query", () => {
    const row = offer({
      category: "coding",
      verification: "hand_verified",
      signup: "required",
      title: "Alpha",
    });
    const state = {
      ...base,
      q: "alpha",
      category: "coding",
      verification: "hand_verified",
      signup: "required",
    };
    expect(offerMatches(row, state)).toBe(true);
    expect(offerMatches(row, { ...state, category: "image" })).toBe(false);
    expect(offerMatches(row, { ...state, verification: "unverified" })).toBe(false);
    expect(offerMatches(row, { ...state, signup: "none" })).toBe(false);
    expect(offerMatches(row, { ...state, q: "beta" })).toBe(false);
  });
});

describe("applySort", () => {
  const rows = [
    offer({
      slug: "a",
      title: "A",
      expiry_date: "2026-12-01",
      verified_date: "2026-01-01",
      amount: "$10",
    }),
    offer({
      slug: "b",
      title: "B",
      expiry_date: null,
      verified_date: "2026-08-01",
      amount: "$50",
    }),
    offer({
      slug: "c",
      title: "C",
      expiry_date: "2026-09-01",
      verified_date: "2026-06-01",
      amount: "$20",
    }),
  ];

  it("puts dated expiries first (ascending) and null expiry last", () => {
    expect(applySort(rows, "expiring").map((o) => o.slug)).toEqual(["c", "a", "b"]);
  });

  it("orders newest by verified_date descending", () => {
    expect(applySort(rows, "newest").map((o) => o.slug)).toEqual(["b", "c", "a"]);
  });

  it("orders amount descending by amountSortValue", () => {
    expect(applySort(rows, "amount").map((o) => o.slug)).toEqual(["b", "c", "a"]);
  });

  it("keeps original index order for empty or invalid sort", () => {
    expect(applySort(rows, "").map((o) => o.slug)).toEqual(["a", "b", "c"]);
    expect(applySort(rows, "bogus").map((o) => o.slug)).toEqual(["a", "b", "c"]);
  });
});

describe("match+sort performance", () => {
  it("filters and sorts a 500-offer fixture well under 200ms", () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      offer({
        slug: `offer-${i}`,
        title: i % 2 === 0 ? `Alpha ${i}` : `Beta ${i}`,
        provider: `Provider ${i}`,
        amount: `$${i} credits`,
        expiry_date: i % 5 === 0 ? null : `2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
        verified_date: `2026-01-01`,
        category: (["coding", "image", "voice", "video", "api_provider"] as const)[i % 5],
      }),
    );
    const state = { ...emptyState(), q: "alpha", sort: "expiring", category: "coding" };
    const t0 = performance.now();
    const matched = applySort(rows, state.sort).filter((row) => offerMatches(row, state));
    const elapsed = performance.now() - t0;
    expect(matched.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });
});
