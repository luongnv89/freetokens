import { describe, expect, it } from "vitest";
import type { Offer } from "../types/offers-index";
import {
  NEWNESS_WINDOW_DAYS,
  RANK_WEIGHTS,
  baseScore,
  isBigLab,
  newness,
  rankOffers,
} from "./ranking";
import { hotViewCounts } from "./offerStats";

const TODAY = "2026-10-07";

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    slug: "example-offer",
    title: "Example Offer",
    provider: "Example Co",
    category: "image",
    amount: "$10 credits",
    expiry_date: null,
    source_url: "https://example.com/offer",
    verified_date: "2026-10-01",
    added_date: null,
    verification: "social_proof",
    review_status: "under-review",
    signup: "required",
    status: "active",
    ...overrides,
  };
}

const slugs = (offers: Offer[]) => offers.map((o) => o.slug);

describe("isBigLab", () => {
  it.each([
    "Anthropic",
    "OpenAI",
    "xAI",
    "Google",
    "Google Cloud",
    "Google Gemini",
    "Microsoft Azure",
    "GitHub",
    "Amazon Web Services",
    "AWS",
    "Kiro",
    "OpenRouter",
    "Meta (via OpenCode Zen)",
    "Mistral AI",
    "NVIDIA",
    "DeepSeek",
  ])("counts %s", (provider) => {
    expect(isBigLab(provider)).toBe(true);
  });

  it.each([
    "TalentGenius (OpenAI SMB Channel Partner)",
    "OpenCode",
    "Metaculus",
    "Cursor (Anysphere)",
    "AMD",
    "Example Co",
  ])("does not count %s", (provider) => {
    expect(isBigLab(provider)).toBe(false);
  });
});

describe("newness", () => {
  it("is full on the add day and decays linearly to zero", () => {
    expect(newness(TODAY, TODAY)).toBe(1);
    expect(newness("2026-09-22", TODAY)).toBeCloseTo(
      1 - 15 / NEWNESS_WINDOW_DAYS,
    );
    expect(newness("2026-09-07", TODAY)).toBe(0);
    expect(newness("2025-01-01", TODAY)).toBe(0);
  });

  it("is zero when the add date or the build date is unknown", () => {
    expect(newness(null, TODAY)).toBe(0);
    expect(newness(undefined, TODAY)).toBe(0);
    expect(newness("not-a-date", TODAY)).toBe(0);
    expect(newness(TODAY, "")).toBe(0);
  });
});

describe("baseScore", () => {
  const ctx = { today: TODAY };

  it("puts coding ahead of API providers ahead of every other category", () => {
    const coding = baseScore(offer({ category: "coding" }), ctx);
    const api = baseScore(offer({ category: "api_provider" }), ctx);
    for (const other of [
      "image",
      "voice",
      "video",
      "startup_program",
      "student",
    ] as const) {
      const score = baseScore(offer({ category: other }), ctx);
      expect(api).toBeGreaterThan(score);
    }
    expect(coding).toBeGreaterThan(api);
  });

  it("rewards a reviewed listing and docks one that needs follow-up", () => {
    const under = baseScore(offer({ review_status: "under-review" }), ctx);
    expect(baseScore(offer({ review_status: "verified" }), ctx)).toBe(
      under + RANK_WEIGHTS.reviewed,
    );
    expect(baseScore(offer({ review_status: "to-be-verified" }), ctx)).toBe(
      under + RANK_WEIGHTS.needsFollowUp,
    );
    expect(baseScore(offer({ review_status: "unverified" }), ctx)).toBe(under);
  });

  it("never reads the free-text amount (#508)", () => {
    expect(baseScore(offer({ amount: "$100,000 in credits" }), ctx)).toBe(
      baseScore(offer({ amount: "1M tokens" }), ctx),
    );
  });
});

describe("rankOffers", () => {
  it("weighs the criteria in priority order: big lab, then category, then newness, then review", () => {
    const ranked = rankOffers(
      [
        offer({ slug: "reviewed", provider: "R", review_status: "verified" }),
        offer({ slug: "new", provider: "N", added_date: TODAY }),
        offer({ slug: "api", provider: "A", category: "api_provider" }),
        offer({ slug: "coding", provider: "C", category: "coding" }),
        offer({ slug: "lab", provider: "Anthropic" }),
      ],
      { today: TODAY },
    );
    expect(slugs(ranked)).toEqual(["lab", "coding", "new", "api", "reviewed"]);
  });

  it("lets a newly added offer beat an older one with the same profile", () => {
    const ranked = rankOffers(
      [
        offer({ slug: "old", provider: "A", added_date: "2026-08-01" }),
        offer({ slug: "fresh", provider: "B", added_date: "2026-10-05" }),
      ],
      { today: TODAY },
    );
    expect(slugs(ranked)).toEqual(["fresh", "old"]);
  });

  it("lifts today's most-viewed offer above a big-lab offer", () => {
    const rows = [
      offer({ slug: "lab", provider: "OpenAI" }),
      offer({ slug: "indie", provider: "Acme" }),
    ];
    expect(slugs(rankOffers(rows, { today: TODAY }))).toEqual([
      "lab",
      "indie",
    ]);
    expect(
      slugs(rankOffers(rows, { today: TODAY, hotViews: { indie: 12 } })),
    ).toEqual(["indie", "lab"]);
  });

  it("puts a hot big-lab coding offer at the very top", () => {
    const ranked = rankOffers(
      [
        offer({ slug: "lab-coding", provider: "OpenAI", category: "coding" }),
        offer({
          slug: "hot-lab-coding",
          provider: "Anthropic",
          category: "coding",
        }),
      ],
      { today: TODAY, hotViews: { "hot-lab-coding": 9 } },
    );
    expect(ranked[0].slug).toBe("hot-lab-coding");
  });

  it("scales the hot boost by views, so a distant runner-up barely moves", () => {
    const rows = [
      offer({ slug: "coding", provider: "C", category: "coding" }),
      offer({ slug: "leader", provider: "L" }),
      offer({ slug: "trailer", provider: "T" }),
    ];
    const ranked = rankOffers(rows, {
      today: TODAY,
      hotViews: { leader: 40, trailer: 4 },
    });
    expect(slugs(ranked)).toEqual(["leader", "coding", "trailer"]);
  });

  it("ignores counts below the hot floor once they pass through hotViewCounts", () => {
    const rows = [
      offer({ slug: "lab", provider: "OpenAI" }),
      offer({ slug: "noise", provider: "Acme" }),
    ];
    const hotViews = hotViewCounts({ noise: 2, lab: null });
    expect(hotViews).toEqual({});
    expect(slugs(rankOffers(rows, { today: TODAY, hotViews }))).toEqual([
      "lab",
      "noise",
    ]);
  });

  it("spreads a provider's many listings instead of letting them fill the top", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      offer({
        slug: `router-${i}`,
        provider: "OpenRouter",
        category: "api_provider",
      }),
    );
    const ranked = rankOffers(
      [
        ...many,
        offer({ slug: "indie-coding", provider: "Acme", category: "coding" }),
      ],
      { today: TODAY },
    );
    // One OpenRouter listing still leads on the big-lab bonus, but the indie
    // coding offer is no longer buried under all six.
    expect(slugs(ranked).indexOf("indie-coding")).toBeLessThan(6);
    expect(ranked[0].slug).toBe("router-0");
  });

  it("keeps index order on equal scores and is deterministic", () => {
    const rows = [
      offer({ slug: "b", provider: "B" }),
      offer({ slug: "a", provider: "A" }),
      offer({ slug: "c", provider: "C" }),
    ];
    expect(slugs(rankOffers(rows, { today: TODAY }))).toEqual(["b", "a", "c"]);
    expect(slugs(rankOffers(rows, { today: TODAY }))).toEqual(
      slugs(rankOffers([...rows], { today: TODAY })),
    );
  });

  it("does not mutate its input", () => {
    const rows = [
      offer({ slug: "indie", provider: "Acme" }),
      offer({ slug: "lab", provider: "OpenAI" }),
    ];
    rankOffers(rows, { today: TODAY });
    expect(slugs(rows)).toEqual(["indie", "lab"]);
  });
});
