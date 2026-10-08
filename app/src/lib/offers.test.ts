import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewStatusBadge } from "../components/Badge";
import {
  applySort,
  buildDate,
  humanDate,
  offerMatches,
  relativeDate,
  activeOffers,
  CATEGORIES,
  CATEGORY_LABELS,
  type Offer,
  type OffersIndex,
} from "./offers";
import { emptyState } from "./urlState";

// Expected values cross-checked against scripts/build.py (_human_date,
// _relative_date) so the React parity layer can never silently drift from
// the Python builder. There is no amount-sort parity anchor: the cross-unit
// allowance ranking was removed in #508.
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
    verification: "social_proof",
    review_status: "unverified",
    signup: "none",
    status: "active",
    ...overrides,
  };
}

describe("to-be-verified listing", () => {
  it("keeps an active offer visible but not an expired offer", () => {
    const pending = offer({ review_status: "to-be-verified" } as Partial<Offer>);
    const expired = offer({ slug: "expired", status: "expired", review_status: "to-be-verified" } as Partial<Offer>);
    const index = { offers: [pending, expired] } as OffersIndex;
    expect(activeOffers(index)).toEqual([pending]);
  });

  it("renders a distinct, honest badge rather than verified or expired", () => {
    const pending = offer({ review_status: "to-be-verified" } as Partial<Offer>);
    const markup = renderToStaticMarkup(ReviewStatusBadge({ offer: pending }));
    expect(markup).toContain("badge-review-status-to-be-verified");
    expect(markup).toContain(">to be verified</span>");
    expect(markup).not.toContain("#ti-expired");
    expect(markup).not.toContain("#ti-review_verified");
  });
});

// #507: "no unknown method is promoted to verified" — a value outside the enum
// must render as itself, never as the reviewed/verified label.
describe("unknown review status", () => {
  it("renders the raw value verbatim instead of promoting it", () => {
    const odd = offer({
      review_status: "published",
    } as unknown as Partial<Offer>);
    const markup = renderToStaticMarkup(ReviewStatusBadge({ offer: odd }));
    expect(markup).toContain(">published</span>");
    expect(markup).not.toContain(">reviewed</span>");
    expect(markup).not.toContain(">verified</span>");
  });
});

describe("offerMatches", () => {
  const base = emptyState();

  it("matches a lowercase substring on title, provider, or amount", () => {
    const row = offer({
      title: "Copilot Pro",
      provider: "GitHub",
      amount: "$10 credits",
    });
    expect(offerMatches(row, { ...base, q: "copilot" })).toBe(true);
    expect(offerMatches(row, { ...base, q: "GITHUB" })).toBe(true);
    expect(offerMatches(row, { ...base, q: "credits" })).toBe(true);
    expect(offerMatches(row, { ...base, q: "missing" })).toBe(false);
  });

  it("requires every active filter AND the query", () => {
    const row = offer({
      category: "coding",
      verification: "social_proof",
      signup: "required",
      title: "Alpha",
    });
    const state = {
      ...base,
      q: "alpha",
      category: "coding",
      verification: "social_proof",
      signup: "required",
    };
    expect(offerMatches(row, state)).toBe(true);
    expect(offerMatches(row, { ...state, category: "image" })).toBe(false);
    expect(offerMatches(row, { ...state, verification: "unverified" })).toBe(
      false,
    );
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
    expect(applySort(rows, "expiring").map((o) => o.slug)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("orders newest by verified_date descending", () => {
    expect(applySort(rows, "newest").map((o) => o.slug)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("never ranks mixed allowance units as comparable cash amounts (#508)", () => {
    // The catalog's single free-text `amount` field mixes dollars, tokens,
    // credits and durations, so the legacy cross-unit "Largest amount" mode
    // must degrade to index order rather than invent a cash equivalence from
    // the first number. The old algorithm ranked this fixture
    // tokens > credits > cash > year.
    const mixed = [
      offer({ slug: "cash", amount: "$300 in credits" }),
      offer({ slug: "tokens", amount: "300000 tokens/month" }),
      offer({ slug: "credits", amount: "1,000 one-time credits" }),
      offer({ slug: "year", amount: "1-year free access" }),
    ];
    expect(applySort(mixed, "amount").map((o) => o.slug)).toEqual([
      "cash",
      "tokens",
      "credits",
      "year",
    ]);
  });

  it("keeps original index order for empty or invalid sort", () => {
    expect(applySort(rows, "").map((o) => o.slug)).toEqual(["a", "b", "c"]);
    expect(applySort(rows, "bogus").map((o) => o.slug)).toEqual([
      "a",
      "b",
      "c",
    ]);
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
        expiry_date:
          i % 5 === 0
            ? null
            : `2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
        verified_date: `2026-01-01`,
        category: (
          ["coding", "image", "voice", "video", "api_provider"] as const
        )[i % 5],
      }),
    );
    const state = {
      ...emptyState(),
      q: "alpha",
      sort: "expiring",
      category: "coding",
    };
    const t0 = performance.now();
    const matched = applySort(rows, state.sort).filter((row) =>
      offerMatches(row, state),
    );
    const elapsed = performance.now() - t0;
    expect(matched.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });
});

describe("category vocabulary", () => {
  it("registers oss_program alongside student and startup", () => {
    expect(CATEGORIES).toContain("oss_program");
    expect([...CATEGORIES].slice(-3)).toEqual([
      "startup_program",
      "student",
      "oss_program",
    ]);
    expect(CATEGORY_LABELS.oss_program).toBe("OSS program");
  });

  it("labels every category", () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_LABELS[category], category).toBeTruthy();
    }
  });

  it("filters on the oss_program category like any other", () => {
    const state = { ...emptyState(), category: "oss_program" };
    expect(offerMatches(offer({ category: "oss_program" }), state)).toBe(true);
    expect(offerMatches(offer({ category: "coding" }), state)).toBe(false);
  });
});
