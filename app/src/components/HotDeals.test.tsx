import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HotDeals } from "./HotDeals";
import { topViewedSlugs } from "../lib/offerStats";
import type { Offer } from "../lib/offers";

function offer(slug: string, over: Partial<Offer> = {}): Offer {
  return {
    slug,
    title: `Title ${slug}`,
    provider: `Provider ${slug}`,
    category: "coding",
    amount: "free",
    expiry_date: null,
    source_url: "https://example.com",
    verified_date: "2026-09-03",
    verification: "social_proof",
    review_status: "unverified",
    signup: "required",
    status: "active",
    ...over,
  } as Offer;
}

const bySlug = (...slugs: string[]) =>
  new Map(slugs.map((s) => [s, offer(s)] as const));

describe("topViewedSlugs", () => {
  it("ranks by views, highest first, and stops at the limit", () => {
    const ranked = topViewedSlugs({ a: 9, b: 40, c: 3, d: 12 }, 3);
    expect(ranked.map((r) => r.slug)).toEqual(["b", "d", "a"]);
    expect(ranked[0].views).toBe(40);
  });

  it("drops counts under the evidence floor rather than filling the shelf", () => {
    // A shelf of three is not worth inventing: two views is noise on a counter
    // only consenting visitors reach, so a short shelf beats a padded one.
    expect(topViewedSlugs({ a: 5, b: 2, c: 1 }, 3).map((r) => r.slug)).toEqual([
      "a",
    ]);
  });

  it("ignores blocked counters, which read as null rather than zero", () => {
    expect(topViewedSlugs({ a: null, b: 6 }, 3).map((r) => r.slug)).toEqual([
      "b",
    ]);
  });

  it("breaks ties on slug so the same data never renders two different orders", () => {
    expect(topViewedSlugs({ zeta: 7, alpha: 7 }, 3).map((r) => r.slug)).toEqual(
      ["alpha", "zeta"],
    );
  });

  it("returns nothing when no counter cleared the floor", () => {
    expect(topViewedSlugs({ a: 1, b: null }, 3)).toEqual([]);
  });
});

describe("HotDeals section", () => {
  it("renders one card per ranked offer, with its view count", () => {
    render(
      <HotDeals
        ranked={[
          { slug: "a", views: 40 },
          { slug: "b", views: 9 },
        ]}
        bySlug={bySlug("a", "b")}
      />,
    );
    expect(document.querySelectorAll(".hot-deal")).toHaveLength(2);
    expect(screen.getByText("40")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Title a" });
    expect(link).toHaveAttribute("href", "offers/a.html");
    expect(link).toHaveAttribute("data-ft-offer-id", "a");
  });

  it("says today, never 24 hours — the counter windows by calendar date", () => {
    render(
      <HotDeals ranked={[{ slug: "a", views: 5 }]} bySlug={bySlug("a")} />,
    );
    expect(screen.getByText(/most viewed today/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/24\s*h/i);
  });

  it("does not reuse the row badge's label for the section heading", () => {
    // "Hot today" is the badge. A section answering to the same name made
    // HomePage's badge assertion match two nodes, which is the symptom; the
    // reason to keep them distinct is that they mean different things.
    render(
      <HotDeals ranked={[{ slug: "a", views: 5 }]} bySlug={bySlug("a")} />,
    );
    expect(screen.queryByText("Hot today")).toBeNull();
  });

  it("renders nothing at all when there is no ranking, not an empty shelf", () => {
    const { container } = render(<HotDeals ranked={[]} bySlug={bySlug("a")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("skips a ranked slug that is not a live offer instead of rendering a blank card", () => {
    // The ranking is computed over the full slug list; an offer can expire out
    // of the listing between the counter fetch and the render.
    const { container } = render(
      <HotDeals
        ranked={[
          { slug: "gone", views: 99 },
          { slug: "a", views: 5 },
        ]}
        bySlug={bySlug("a")}
      />,
    );
    expect(container.querySelectorAll(".hot-deal")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Title a" })).toBeInTheDocument();
  });
});
