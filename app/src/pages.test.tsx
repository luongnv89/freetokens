import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ArchivePage from "./components/ArchivePage";
import HomePage from "./components/HomePage";
import PrivacyPage from "./components/PrivacyPage";
import OfferDetailPage from "./components/OfferDetailPage";
import { FILTER_DIMENSIONS } from "./lib/analytics";
import { expiredOffers, type OffersIndex } from "./lib/offers";
import indexData from "./data/offers.json";

const PUBLIC_DIR = path.resolve(import.meta.dirname, "../public");

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

describe("PrivacyPage (#132 shipped-analytics claims)", () => {
  const markup = renderToStaticMarkup(<PrivacyPage />);

  it("carries the policy sections with stable anchor ids", () => {
    for (const id of [
      "privacy-summary",
      "privacy-what-this-is",
      "privacy-analytics",
      "privacy-live-traffic",
      "privacy-consent",
      "privacy-third-parties",
      "privacy-never",
      "privacy-choices",
      "privacy-changes",
    ]) {
      expect(markup).toContain(`id="${id}"`);
    }
  });

  it("marks the privacy footer link active", () => {
    expect(markup).toContain('<a href="privacy.html" aria-current="page">Privacy policy</a>');
  });

  it("wraps the policy in a main landmark with one h1", () => {
    expect(markup.match(/<main>/g)?.length).toBe(1);
    expect(markup.match(/<h1>/g)?.length).toBe(1);
    expect(markup).toContain("<h1>Privacy Policy</h1>");
    expect(markup.match(/<h2 /g)?.length).toBe(markup.match(/<section/g)?.length);
  });

  it("states shipped claims and omits unshipped ones", () => {
    for (const claim of [
      "query_length",
      "anonymize_ip",
      "GoatCounter",
      "no cookies",
      "ft_ga_consent",
      "exclusive-end",
      "four hours",
      "home page",
      "not shown in the footer of every page",
      "never</strong> collected",
      "zero tracking requests",
    ]) {
      expect(markup).toContain(claim);
    }
    for (const dim of FILTER_DIMENSIONS) {
      expect(markup).toContain(`<code>${dim}</code>`);
    }
    for (const absent of [
      "Google Fonts",
      "offer_share",
      "share button",
      "Share actions",
      "fonts.googleapis",
      "Built ",
    ]) {
      expect(markup).not.toContain(absent);
    }
  });
});

describe("page chrome landmarks and footer (#132)", () => {
  const home = renderToStaticMarkup(<HomePage index={index} />);
  const archive = renderToStaticMarkup(<ArchivePage index={index} />);
  const privacy = renderToStaticMarkup(<PrivacyPage />);
  const detail = renderToStaticMarkup(
    <OfferDetailPage index={index} slug={index.offers[0].slug} />,
  );

  it("links privacy from the footer on every route type", () => {
    expect(home).toContain('<a href="privacy.html">Privacy policy</a>');
    expect(archive).toContain('<a href="privacy.html">Privacy policy</a>');
    expect(privacy).toContain('<a href="privacy.html" aria-current="page">Privacy policy</a>');
    expect(detail).toContain('<a href="../privacy.html">Privacy policy</a>');
  });

  it("puts a main landmark and one h1 on every route type", () => {
    for (const markup of [home, archive, privacy, detail]) {
      expect(markup.match(/<main>/g)?.length).toBe(1);
      expect(markup.match(/<h1>/g)?.length).toBe(1);
    }
  });

  it("renders the #106 mark in the footer without a Built date", () => {
    expect(home).toContain('src="./logo-mark.svg"');
    expect(detail).toContain('src="../logo-mark.svg"');
    expect(home).not.toContain("Built ");
    expect(privacy).not.toContain("Built ");
  });
});

describe("brand assets (#106 / #132)", () => {
  it("copies declared SVG sizes into public chrome", () => {
    const expected: [string, string, string][] = [
      ["favicon.svg", 'width="16"', 'height="16"'],
      ["logo-mark.svg", 'width="64"', 'height="64"'],
      ["logo-icon.svg", 'width="512"', 'height="512"'],
      ["logo-full.svg", 'width="320"', 'height="72"'],
      ["logo-wordmark.svg", 'width="180"', 'height="40"'],
      ["logo-white.svg", 'width="320"', 'height="72"'],
      ["logo-black.svg", 'width="320"', 'height="72"'],
    ];
    for (const [file, w, h] of expected) {
      const svg = readFileSync(path.join(PUBLIC_DIR, file), "utf8");
      expect(svg).toContain(w);
      expect(svg).toContain(h);
    }
  });
});
