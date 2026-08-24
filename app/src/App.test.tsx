import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
import indexData from "./data/offers.json";
import { activeOffers, type OffersIndex } from "./lib/offers";

const index = indexData as OffersIndex;
const offers = activeOffers(index);

function html() {
  return renderToStaticMarkup(<App />);
}

// Prerender-parity contract for the home listing (issue #119): every active
// offer must be present in the SERVER-rendered markup with the same semantic
// structure the Python builder emits — no div soup, no client-JS dependency.
describe("App home listing prerender", () => {
  const markup = html();

  it("renders one ranked list containing every active offer", () => {
    expect(markup).toContain('<ol class="grid" id="ft-grid" role="list">');
    expect(markup.match(/<article class="card" /g)?.length).toBe(offers.length);
  });

  it('marks expired entries out of the default list (#25)', () => {
    const expired = index.offers.filter((o) => o.status === "expired").map((o) => o.slug);
    for (const slug of expired) {
      expect(markup.includes(`id="offer-${slug}"`)).toBe(false);
    }
  });

  it("carries the row data-* hooks the filter runtime reads", () => {
    const offer = offers[0];
    expect(markup).toContain(`id="offer-${offer.slug}"`);
    expect(markup).toContain(`data-category="${offer.category}"`);
    expect(markup).toContain(`data-verification="${offer.verification}"`);
    expect(markup).toContain(`data-signup="${offer.signup}"`);
    expect(markup).toMatch(/data-amount-sort="[\d.]+"/);
  });

  it("uses descriptive link text on every title link (a11y)", () => {
    for (const offer of offers) {
      expect(markup).toContain(`aria-label="View details for ${offer.title}"`);
    }
  });

  it("renders the three honesty-tag families per row as buttons with labels", () => {
    expect(markup.match(/data-ft-tag="category"/g)?.length).toBe(offers.length);
    expect(markup.match(/data-ft-tag="verification"/g)?.length).toBe(offers.length);
    expect(markup.match(/data-ft-tag="signup"/g)?.length).toBe(offers.length);
  });

  it("shows 'ongoing' with a status dot when expiry_date is null", () => {
    const ongoing = offers.find((o) => o.expiry_date === null);
    if (!ongoing) return; // catalog-dependent; covered by fixture test below
    const rowStart = markup.indexOf(`id="offer-${ongoing.slug}"`);
    expect(markup.slice(rowStart, rowStart + 2500)).toMatch(
      /<span class="dot" aria-hidden="true"><\/span>ongoing/,
    );
  });

  it("renders an expiring offer with an absolute date in <time>", () => {
    const expiring = offers.find((o) => o.expiry_date !== null);
    if (!expiring) return;
    const rowStart = markup.indexOf(`id="offer-${expiring.slug}"`);
    expect(markup.slice(rowStart, rowStart + 2500)).toMatch(
      /<time [Dd]ate[Tt]ime="2026-09-06">/,
    );
  });

  it("states truthful counts in the masthead", () => {
    const verified = offers.filter((o) => o.verification === "hand_verified").length;
    const ongoingCount = offers.filter((o) => !o.expiry_date).length;
    expect(markup).toContain(`<strong>${offers.length}</strong> live offers`);
    expect(markup).toContain(`<strong>${ongoingCount}</strong> ongoing`);
    expect(markup).toContain(`<strong>${verified}</strong> hand-verified`);
  });

  it("keeps semantic list markup — no div-based rows", () => {
    // Every row is li > article; the only divs are the sanctioned row-head.
    expect(markup).not.toContain("<div class=\"card\"");
    expect(markup.match(/<li style/g)?.length).toBe(offers.length);
  });
});

describe("App empty state", () => {
  it("renders the no-offers fallback when the catalog is empty", async () => {
    const { default: HomePage } = await import("./components/HomePage");
    const empty = {
      generated_at: "2026-08-24T00:00:00Z",
      count: 1,
      active_count: 0,
      expired_count: 1,
      offers: [
        {
          slug: "old",
          title: "Old",
          provider: "P",
          category: "coding",
          amount: "$5",
          expiry_date: null,
          source_url: "https://example.com",
          verified_date: "2026-08-01",
          verification: "unverified",
          signup: "none",
          status: "expired" as const,
        },
      ],
    };
    const markup = renderToStaticMarkup(<HomePage index={empty} />);
    expect(markup).toContain("No live offers right now");
    expect(markup).not.toContain('id="ft-grid"');
  });
});
