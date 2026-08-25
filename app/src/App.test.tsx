import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
import indexData from "./data/offers.json";
import {
  CATEGORY_LABELS,
  SIGNUP_LABELS,
  VERIFICATION_LABELS,
  activeOffers,
  type OffersIndex,
} from "./lib/offers";
import { badgeVariants } from "./components/ui/badge";
import { buttonVariants } from "./components/ui/button";
import type { Offer } from "./types/offers-index";

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

  it("emits no tracker markup when analytics env is unset (#131)", () => {
    expect(markup).not.toContain("googletagmanager");
    expect(markup).not.toContain("ft-consent-banner");
    expect(markup).not.toContain("id=\"ft-traffic\"");
    expect(markup).not.toContain("gc.zgo.at");
    expect(markup).not.toContain("ft-consent-settings");
  });
});

// Icon contract after the lucide-react migration (#122): glyphs still ship
// once per page as a <symbol> sprite, and every glyph stays aria-hidden so
// the spelled-out tag word carries the accessible name.
describe("App tag icon sprite (lucide mapping)", () => {
  const markup = html();

  it("ships exactly one sprite per page", () => {
    expect(markup.match(/class="tag-sprite"/g)?.length).toBe(1);
  });

  it("renders one aria-hidden glyph per honesty tag", () => {
    // Three tags per row, each an <svg class="tag-i" aria-hidden="true">.
    expect(markup.match(/<svg class="tag-i" aria-hidden="true"/g)?.length).toBe(
      offers.length * 3,
    );
  });

  it("never renders a lucide glyph with its own accessible name", () => {
    expect(markup).not.toMatch(/<svg[^>]*aria-label=/);
  });
});

function articleOf(markup: string, slug: string): string {
  const start = markup.indexOf(`id="offer-${slug}"`);
  expect(start).toBeGreaterThan(-1);
  const end = markup.indexOf("</article>", start);
  return markup.slice(start, end);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function offerEntry(overrides: Partial<Offer> = {}): Offer {
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

describe("App empty state", () => {
  it("renders the no-offers fallback when the catalog is empty", async () => {
    const { default: HomePage } = await import("./components/HomePage");
    const empty = {
      generated_at: "2026-08-24T00:00:00Z",
      count: 1,
      active_count: 0,
      expired_count: 1,
      offers: [offerEntry({ slug: "old", title: "Old", provider: "P", amount: "$5", status: "expired" })],
    } satisfies OffersIndex;
    const markup = renderToStaticMarkup(<HomePage index={empty} />);
    expect(markup).toContain("No live offers right now");
    expect(markup).toContain('class="glyph"');
    expect(markup).toContain('href="archive.html"');
    expect(markup).toContain("browse the archive");
    expect(markup).not.toContain('id="ft-grid"');
  });
});

describe("App listing fields, order, and shadcn slots (#124)", () => {
  const markup = html();

  it("renders provider, amount, tags, expiry, and details href on every active row", () => {
    for (const offer of offers) {
      const row = articleOf(markup, offer.slug);
      expect(row).toContain(`class="r-prov">${escapeHtml(offer.provider)}<`);
      expect(row).toContain(`class="r-amount">${escapeHtml(offer.amount)}<`);
      expect(row).toContain(`badge-category-${offer.category}`);
      expect(row).toContain(`>${CATEGORY_LABELS[offer.category]}<`);
      expect(row).toContain(`badge-verification-${offer.verification}`);
      expect(row).toContain(`>${VERIFICATION_LABELS[offer.verification]}<`);
      expect(row).toContain(`badge-signup-${offer.signup}`);
      expect(row).toContain(`>${SIGNUP_LABELS[offer.signup]}<`);
      if (offer.expiry_date) {
        expect(row).toContain("expires");
        expect(row).toContain(`dateTime="${offer.expiry_date}"`);
      } else {
        expect(row).toMatch(/<span class="dot" aria-hidden="true"><\/span>ongoing/);
      }
      expect(row).toContain(`href="offers/${offer.slug}.html"`);
      expect(row).toContain(`aria-label="View details for ${escapeHtml(offer.title)}"`);
      expect(row).toContain('class="r-details"');
    }
  });

  it("lists articles newest-verified-first, matching activeOffers order", () => {
    const grid = markup.match(/<ol class="grid" id="ft-grid" role="list">([\s\S]*?)<\/ol>/);
    expect(grid).not.toBeNull();
    const ids = [...(grid?.[1].matchAll(/id="offer-([^"]+)"/g) ?? [])].map((m) => m[1]);
    expect(ids).toEqual(offers.map((o) => o.slug));
  });

  it("omits expired slugs from a mixed catalog (not only the live empty-expired case)", async () => {
    const { default: HomePage } = await import("./components/HomePage");
    const mixed = {
      generated_at: "2026-08-24T00:00:00Z",
      count: 4,
      active_count: 2,
      expired_count: 2,
      offers: [
        offerEntry({ slug: "expired-first", title: "Expired First", status: "expired", expiry_date: "2026-01-01" }),
        offerEntry({ slug: "live-a", title: "Live A", verified_date: "2026-08-24" }),
        offerEntry({ slug: "expired-mid", title: "Expired Mid", status: "expired", expiry_date: "2026-02-01" }),
        offerEntry({ slug: "live-b", title: "Live B", verified_date: "2026-08-20" }),
      ],
    } satisfies OffersIndex;
    const mixedMarkup = renderToStaticMarkup(<HomePage index={mixed} />);
    const grid = mixedMarkup.match(/<ol class="grid" id="ft-grid" role="list">([\s\S]*?)<\/ol>/);
    const ids = [...(grid?.[1].matchAll(/id="offer-([^"]+)"/g) ?? [])].map((m) => m[1]);
    expect(ids).toEqual(activeOffers(mixed).map((o) => o.slug));
    expect(ids).toEqual(["live-a", "live-b"]);
    expect(mixedMarkup).not.toContain('id="offer-expired-first"');
    expect(mixedMarkup).not.toContain('id="offer-expired-mid"');
  });

  it("ships the filter-empty reset control in prerendered markup", () => {
    expect(markup).toContain('id="ft-no-results"');
    expect(markup).toContain("No matching offers");
    expect(markup).toContain('id="ft-reset-filters"');
    expect(markup).toContain("Clear search &amp; filters");
  });

  it("composes honesty tags through shadcn Badge (data-slot) as real buttons", () => {
    expect(markup.match(/data-slot="badge"/g)?.length).toBe(offers.length * 3);
    expect(markup).toMatch(
      /<button type="button" class="badge badge-category[^"]*"[\s\S]*?data-slot="badge"/,
    );
  });

  it("composes toolbar chips and reset through shadcn Button (data-slot)", () => {
    expect(markup).toMatch(/data-ft-category=""[\s\S]*?data-slot="button"|data-slot="button"[\s\S]*?data-ft-category=""/);
    expect(markup).toContain('id="ft-clear-filters"');
    expect(markup).toMatch(/id="ft-reset-filters"[^>]*data-slot="button"|data-slot="button"[^>]*id="ft-reset-filters"/);
  });

  it("keeps semantic ol#ft-grid > li > article.card nesting", () => {
    expect(markup).toMatch(
      /<ol class="grid" id="ft-grid" role="list"><li[^>]*><article class="card"/,
    );
  });

  it("does not paint listing controls with shadcn default chrome", () => {
    const tag = markup.match(/<button[^>]*data-ft-tag="category"[^>]*>/);
    expect(tag?.[0]).not.toMatch(/\bh-9\b|\bbg-primary\b|\brounded-md\b/);
    const chip = markup.match(/<button[^>]*data-ft-category=""[^>]*>/);
    expect(chip?.[0]).not.toMatch(/\bh-9\b|\bbg-primary\b|\brounded-md\b/);
  });
});

describe("unstyled shadcn variants (#124)", () => {
  it("emits no visual utilities so python-parity.css can paint listing rows", () => {
    expect(badgeVariants({ variant: "unstyled" }).trim()).toBe("");
    expect(buttonVariants({ variant: "unstyled", size: "unstyled" }).trim()).toBe("");
  });

  it("keeps default variants for future surfaces", () => {
    expect(badgeVariants({ variant: "default" })).toContain("bg-primary");
    expect(buttonVariants({ variant: "default" })).toContain("h-9");
  });
});
