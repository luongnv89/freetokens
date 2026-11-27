import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../App";
import DealsPage from "./DealsPage";
import DealDetailPage from "./DealDetailPage";
import { resolveRoute } from "../routes";
import type { Deal } from "../lib/deals";
import type { OffersIndex } from "../lib/offers";

// Deals (#809). Fixed fixture data, no clock: expiry is decided by the build
// (load-deals.mjs), so the UI renders whatever the index carries.
function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    kind: "deal",
    slug: "example-ai-pro-black-friday",
    title: "Example AI Pro — Black Friday",
    provider: "Example AI",
    category: "ai_subscription",
    discount: "50% off the first year",
    regular_price: "$240/year",
    deal_price: "$120/year",
    promo_code: "EXAMPLE50",
    occasion: "black_friday",
    start_date: "2026-11-20",
    expiry_date: "2026-12-02",
    expiry_note: "The page names no end date; the window end is used.",
    source_url: "https://example.com/pricing",
    verified_date: "2026-11-27",
    ...overrides,
  };
}

const XMAS = deal({
  slug: "example-agent-cloud-holidays",
  title: "Example Agent Cloud — Holidays",
  provider: "Example Cloud",
  category: "agent_compute",
  discount: "30% off for 3 months",
  occasion: "christmas_new_year",
  expiry_date: "2027-01-02",
  promo_code: undefined,
  regular_price: undefined,
  deal_price: undefined,
});

function indexWith(deals: Deal[]): OffersIndex {
  return {
    generated_at: "2026-11-28T00:00:00Z",
    count: 0,
    active_count: 0,
    expired_count: 0,
    offers: [],
    deals,
  };
}

describe("Deals page (#809)", () => {
  it("shows a discount badge, the not-free badge and the end date on every card", () => {
    render(<DealsPage index={indexWith([deal(), XMAS])} />);
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(within(card).getByText("Deal · not free")).toBeInTheDocument();
      expect(card.querySelector(".deal-discount")).not.toBeNull();
      expect(card.querySelector("time")?.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(card.querySelector("[data-ft-offer-id]")).toBeNull();
    }
    expect(screen.getByText("50% off the first year")).toBeInTheDocument();
    expect(screen.getByText("Dec 2, 2026")).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Deals are not free" })).toHaveTextContent(
      "Not free.",
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("filters by occasion and mirrors it in ?occasion=", () => {
    render(<DealsPage index={indexWith([deal(), XMAS])} />);
    const group = screen.getByRole("group", { name: "Filter by occasion" });
    const xmas = within(group).getByRole("button", { name: "Christmas & New Year" });
    fireEvent.click(xmas);
    expect(xmas).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Example Agent Cloud — Holidays")).toBeInTheDocument();
    expect(screen.queryByText("Example AI Pro — Black Friday")).toBeNull();
    expect(window.location.search).toBe("?occasion=christmas_new_year");
    fireEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(window.location.search).toBe("");
  });

  it("offers only the occasions that have deals", () => {
    render(<DealsPage index={indexWith([deal()])} />);
    const group = screen.getByRole("group", { name: "Filter by occasion" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All",
      "Black Friday",
    ]);
  });

  it("shows an empty state, and no filter, when no deal is running", () => {
    const html = renderToStaticMarkup(<DealsPage index={indexWith([])} />);
    expect(html).toContain("No running deals right now");
    expect(html).not.toContain("Filter by occasion");
    // An index from before #809 (no deals key) renders the same way.
    const legacy = { ...indexWith([]) };
    delete legacy.deals;
    expect(renderToStaticMarkup(<DealsPage index={legacy} />)).toBe(html);
  });
});

describe("Deal detail page (#809)", () => {
  it("renders the deal's facts with a vendor button and the not-free note", () => {
    render(<DealDetailPage index={indexWith([deal(), XMAS])} slug={deal().slug} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Example AI Pro — Black Friday",
    );
    const cta = screen.getByRole("link", { name: /Get the deal at example\.com/ });
    expect(cta).toHaveAttribute("href", "https://example.com/pricing");
    expect(cta).not.toHaveAttribute("data-ft-offer-id");
    const facts = screen.getByRole("region", { name: "Key deal details" });
    for (const text of ["$240/year", "$120/year", "EXAMPLE50", "Black Friday", "AI subscription"]) {
      expect(within(facts).getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText(/the window end is used/)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Deals");
    expect(screen.getByText("Example Agent Cloud — Holidays")).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown or ended deal", () => {
    render(<DealDetailPage index={indexWith([])} slug="gone" />);
    expect(screen.getByRole("heading", { name: "Deal not found" })).toBeInTheDocument();
  });
});

describe("deal routes (#809)", () => {
  it("resolves the stamped deals and deal pages", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<div id="root" data-page="deal" data-slug="x"></div>';
    expect(resolveRoute(doc)).toEqual({ page: "deal", slug: "x" });
    doc.body.innerHTML = '<div id="root" data-page="deals"></div>';
    expect(resolveRoute(doc)).toEqual({ page: "deals" });
  });

  it("App renders each page and every page links to Deals", () => {
    const index = indexWith([deal()]);
    const list = renderToStaticMarkup(<App index={index} route={{ page: "deals" }} />);
    expect(list).toContain("<h1>AI deals</h1>");
    const one = renderToStaticMarkup(
      <App index={index} route={{ page: "deal", slug: deal().slug }} />,
    );
    expect(one).toContain('href="../deals.html"');
    const home = renderToStaticMarkup(<App index={index} route={{ page: "home" }} />);
    expect(home).toContain('href="deals.html"');
    expect(home).not.toContain("Example AI Pro");
  });
});
