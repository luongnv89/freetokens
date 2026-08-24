import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ArchivePage from "./components/ArchivePage";
import PrivacyPage from "./components/PrivacyPage";
import OfferDetailPage from "./components/OfferDetailPage";
import { expiredOffers, type OffersIndex } from "./lib/offers";
import indexData from "./data/offers.json";

const index = indexData as OffersIndex;

type OfferEntry = OffersIndex["offers"][number];

function offer(overrides: Partial<OfferEntry> = {}): OfferEntry {
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

describe("ArchivePage (#26 parity)", () => {
  it("orders expired offers newest-expiration-first with slug tiebreak", () => {
    const fixture = {
      ...index,
      offers: [
        offer({ slug: "b-old", expiry_date: "2026-01-01", status: "expired" as const }),
        offer({ slug: "a-tie", expiry_date: "2026-06-01", status: "expired" as const }),
        offer({ slug: "z-tie", expiry_date: "2026-06-01", status: "expired" as const }),
        offer({ slug: "live", status: "active" as const }),
      ],
    };
    // reverse=True in build.py sorts slugs DESCENDING within one expiry date.
    expect(expiredOffers(fixture).map((o) => o.slug)).toEqual(["z-tie", "a-tie", "b-old"]);
  });

  it("renders the empty state when nothing has expired", () => {
    const markup = renderToStaticMarkup(<ArchivePage index={index} />);
    expect(markup).toContain("The archive is empty");
    expect(markup).not.toContain('id="ft-archive-grid"');
  });

  it("renders archived cards with the Expired badge and a retained detail link", () => {
    const fixture = {
      ...index,
      offers: [offer({ slug: "gone", expiry_date: "2026-01-15", status: "expired" as const })],
    };
    const markup = renderToStaticMarkup(<ArchivePage index={fixture} />);
    expect(markup).toContain('id="ft-archive-grid"');
    expect(markup).toContain("badge-expired");
    expect(markup).toContain('href="offers/gone.html"');
    expect(markup).toMatch(/expired <time [Dd]ate[Tt]ime="2026-01-15">/);
  });
});

describe("OfferDetailPage (F2 shell, #123)", () => {
  it("server-renders real offer content for JS-off deep links", () => {
    const live = index.offers[0];
    const markup = renderToStaticMarkup(
      <OfferDetailPage index={index} slug={live.slug} />,
    );
    expect(markup).toContain(`<h1>${live.title}</h1>`);
    expect(markup).toContain(live.amount);
    expect(markup).toContain(`href="${live.source_url}"`);
    // Depth-1 chrome climbs back to site root.
    expect(markup).toContain('href="../index.html"');
  });

  it("shows the ended state instead of a claim CTA for expired offers", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{ ...index, offers: [offer({ status: "expired" as const })] }}
        slug="example-offer"
      />,
    );
    expect(markup).toContain("This offer ended");
    expect(markup).not.toContain('class="od-cta"');
  });

  it("renders a graceful not-found state for an unknown slug — never a blank page or throw", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage index={index} slug="no-such-offer" />,
    );
    expect(markup).toContain("Offer not found");
    expect(markup).toContain('href="../index.html"');
  });
});

describe("PrivacyPage (Task 3.5 parity)", () => {
  it("carries the policy sections with stable anchor ids", () => {
    const markup = renderToStaticMarkup(<PrivacyPage />);
    for (const id of [
      "privacy-summary",
      "privacy-analytics",
      "privacy-consent",
      "privacy-third-parties",
      "privacy-changes",
    ]) {
      expect(markup).toContain(`id="${id}"`);
    }
  });

  it("marks the privacy footer link active", () => {
    const markup = renderToStaticMarkup(<PrivacyPage />);
    expect(markup).toContain('<a href="privacy.html" aria-current="page">Privacy policy</a>');
  });
});
