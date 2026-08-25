import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { render, waitFor } from "@testing-library/react";
import ArchivePage from "./components/ArchivePage";
import HomePage from "./components/HomePage";
import PrivacyPage from "./components/PrivacyPage";
import OfferDetailPage from "./components/OfferDetailPage";
import { FILTER_DIMENSIONS, configureAnalytics, resetAnalyticsForTests } from "./lib/analytics";
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
    expect(markup).toContain('class="glyph"');
    expect(markup).toContain('href="./index.html"');
    expect(markup).not.toContain('id="ft-archive-grid"');
    expect(markup).not.toContain("Skip the offer list");
  });

  it("renders archived cards with the Expired badge and a retained detail link", () => {
    const fixture = {
      ...index,
      offers: [offer({ slug: "gone", expiry_date: "2026-01-15", status: "expired" as const })],
    };
    const markup = renderToStaticMarkup(<ArchivePage index={fixture} />);
    expect(markup).toContain('id="ft-archive-grid"');
    expect(markup).toContain("badge-expired");
    expect(markup).toMatch(/<span>Expired<\/span>/);
    expect(markup).toContain('href="offers/gone.html"');
    expect(markup).toMatch(/expired <time [Dd]ate[Tt]ime="2026-01-15">/);
    expect(markup).toContain("Skip the offer list");
    expect(markup).toContain('class="detail-btn"');
  });

  it("archive tags are links to a pre-filtered home, never inert buttons", () => {
    const fixture = {
      ...index,
      offers: [offer({ slug: "gone", expiry_date: "2026-01-15", status: "expired" as const })],
    };
    const markup = renderToStaticMarkup(<ArchivePage index={fixture} />);
    expect(markup).toContain('href="index.html?category=coding"');
    expect(markup).toContain('href="index.html?verification=hand_verified"');
    expect(markup).toContain('href="index.html?signup=none"');
    expect(markup).toContain('aria-label="See offers tagged Coding"');
    expect(markup).toContain('aria-label="See offers tagged hand-verified"');
    expect(markup).toContain('aria-label="See offers tagged no sign-up"');
    expect(markup).not.toMatch(/<button[^>]*data-ft-tag/);
  });
});

describe("archive layout at 320 px (#129)", () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, "styles/python-parity.css"),
    "utf8",
  );

  it("lets the archive grid collapse to the wrap width instead of overflowing", () => {
    expect(css).toMatch(
      /\.grid \{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(100%,\s*19rem\),\s*1fr\)\)/s,
    );
    expect(css).toMatch(/#ft-archive-grid \{ min-width: 0; \}/);
    expect(css).toMatch(/#ft-archive-grid \.card \{ min-width: 0; \}/);
    expect(css).toMatch(/\.card-title \{[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.amount \{[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.card-top \{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\.wrap \{[^}]*padding:\s*clamp\(1\.25rem/s);
    expect(css).toMatch(/\[data-page="archive"\] \.empty \{\s*animation:\s*none/s);
  });

  it("styles the archive View-details control as a real tap target", () => {
    expect(css).toMatch(/\.detail-btn \{/);
    expect(css).toMatch(/\.detail-btn \{[^}]*min-height:\s*44px/s);
  });
});

describe("OfferDetailPage (F2 shell, #123 / #128)", () => {
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
        details={{}}
      />,
    );
    expect(markup).toContain("This offer ended");
    expect(markup).not.toContain('class="od-cta"');
  });

  it("detail tags are links to a pre-filtered home, never inert buttons", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{ ...index, offers: [offer()] }}
        slug="example-offer"
        details={{}}
      />,
    );
    expect(markup).toContain('href="../index.html?category=coding"');
    expect(markup).toContain('href="../index.html?verification=hand_verified"');
    expect(markup).toContain('href="../index.html?signup=none"');
    expect(markup).toContain('aria-label="See offers tagged Coding"');
    expect(markup).toContain('aria-label="See offers tagged hand-verified"');
    expect(markup).toContain('aria-label="See offers tagged no sign-up"');
    expect(markup).not.toMatch(/<button[^>]*data-ft-tag/);
  });

  it("renders a graceful not-found state for an unknown slug — never a blank page or throw", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage index={index} slug="no-such-offer" />,
    );
    expect(markup).toContain("Offer not found");
    expect(markup).toContain('href="../index.html"');
  });

  it("renders summary, claim steps, and social proof when details JSON is present", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{ ...index, offers: [offer()] }}
        slug="example-offer"
        details={{
          "example-offer": {
            summary: "A detailed summary of the example offer.",
            claim_steps: ["Open the provider page.", "Sign in and claim."],
            social_proof: [
              {
                type: "x",
                url: "https://x.com/ada/status/1",
                author: "Ada",
                handle: "@ada",
                text: "Live now.",
              },
              {
                type: "reddit",
                url: "https://www.reddit.com/r/LocalLLaMA/comments/abc/offer/",
                author: "u/ada",
                community: "r/LocalLLaMA",
                text: "Confirmed on the official page.",
              },
              {
                type: "screenshot",
                image: "assets/gmi-minimax-m3-curator-run.jpg",
                caption: "Curator run of the free model.",
              },
              {
                type: "link",
                url: "https://example.com/pricing",
                title: "Official pricing",
              },
            ],
          },
        }}
      />,
    );
    expect(markup).toContain('class="od-brief"');
    expect(markup).toContain("A detailed summary of the example offer.");
    expect(markup).toContain("Open the provider page.");
    expect(markup).toContain("Sign in and claim.");
    expect(markup).toContain('class="od-proof"');
    expect(markup).toContain("View post on X");
    expect(markup).toContain("View on Reddit");
    expect(markup).toContain('src="../assets/gmi-minimax-m3-curator-run.jpg"');
    expect(markup).toContain("Official pricing");
    expect(markup).toContain('class="share-copy"');
    expect(markup).not.toContain("offer_share");
    expect(markup).not.toContain("linkedin.com/sharing");
    expect(markup).not.toContain("twitter.com/intent/tweet");
    expect(markup).not.toContain("facebook.com/sharer");
    expect(markup).not.toContain("data-ft-share");
  });

  it("renders the summary card and fallback steps without details JSON — no layout break", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{ ...index, offers: [offer()] }}
        slug="example-offer"
        details={{}}
      />,
    );
    expect(markup).toContain('class="offer-detail"');
    expect(markup).toContain('class="od-hero"');
    expect(markup).toContain("<h1>Example Offer</h1>");
    expect(markup).toContain("$10 credits");
    expect(markup).toContain('class="od-cta"');
    expect(markup).toContain("Open the official offer page.");
    expect(markup).not.toContain('class="od-brief"');
    expect(markup).not.toContain('class="od-proof"');
  });

  it("marks the claim CTA as an outbound offer click for GoatCounter (#101)", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{ ...index, offers: [offer()] }}
        slug="example-offer"
        details={{}}
      />,
    );
    const cta = markup.match(/<a class="od-cta"[^>]*>/)?.[0] ?? "";
    expect(cta).toContain('data-ft-offer-id="example-offer"');
    expect(cta).toContain('data-ft-provider="Example Co"');
    expect(cta).toContain('data-ft-offer-category="coding"');
    expect(cta).toContain('data-ft-outbound="true"');
  });

  it("shows no view count in prerendered markup — it is fetched live (#101)", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{ ...index, offers: [offer()] }}
        slug="example-offer"
        details={{}}
      />,
    );
    expect(markup).not.toContain("views");
  });

  it("fetches the live per-offer view count from GoatCounter at page load (#101)", async () => {
    configureAnalytics({ statsSite: "https://luongnv89.goatcounter.com" });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        calls.push(String(url));
        return {
          ok: true,
          json: async () => ({ count: "42" }),
        } as Response;
      }),
    );
    try {
      render(
        <OfferDetailPage
          index={{ ...index, offers: [offer()] }}
          slug="example-offer"
          details={{}}
        />,
      );
      await waitFor(() => {
        expect(document.querySelector(".od-views")?.textContent).toBe("42 views");
      });
      expect(calls[0]).toBe(
        "https://luongnv89.goatcounter.com/counter/%2Foffers%2Fexample-offer.html.json",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the detail page fully working when GoatCounter never answers (#101)", async () => {
    configureAnalytics({ statsSite: "https://luongnv89.goatcounter.com" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network blocked"))),
    );
    try {
      render(
        <OfferDetailPage
          index={{ ...index, offers: [offer()] }}
          slug="example-offer"
          details={{}}
        />,
      );
      await waitFor(() => {
        expect(vi.mocked(fetch)).toHaveBeenCalled();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.querySelector(".od-views")).toBeNull();
      expect(document.querySelector(".od-cta")?.getAttribute("href")).toBe(
        "https://example.com/offer",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  afterEach(() => {
    resetAnalyticsForTests();
  });
});

describe("offer detail layout CSS (#128)", () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, "styles/python-parity.css"),
    "utf8",
  );

  it("ports the Python detail, checklist, proof, and copy-button rules", () => {
    expect(css).toMatch(/\.offer-detail \{/);
    expect(css).toMatch(/\.od-hero|\.offer-detail \.amount/);
    expect(css).toMatch(/\.claim-list \{/);
    expect(css).toMatch(/\.proof-card \{/);
    expect(css).toMatch(/\.share-copy \{/);
    expect(css).toMatch(/\.od-cta \{[^}]*min-height:\s*44px/s);
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
      "privacy-local-data",
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

  it("names every personal-state key and hosts export/import/erase (#141)", () => {
    for (const key of [
      "<code>ft_ga_consent</code>",
      "<code>ft-saved</code>",
      "<code>ft-dismissed</code>",
      "<code>ft-prefs</code>",
      "<code>ft-claim-&lt;offer&gt;</code>",
    ]) {
      expect(markup).toContain(key);
    }
    // The policy states nothing stored locally is ever transmitted.
    expect(markup).toContain("never leaves your browser");
    expect(markup).toContain("never transmitted");
    // Export, import, and clear-all controls are present.
    expect(markup).toContain('id="ft-export-data"');
    expect(markup).toContain('id="ft-import-data"');
    expect(markup).toContain('id="ft-clear-data"');
    expect(markup).toContain("Export my data (JSON)");
    expect(markup).toContain("Clear all my local data");
    expect(markup).toContain('type="file"');
    expect(markup).toContain('aria-live="polite"');
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

  it("marks the archive footer link active and reachable from home empty-state copy", () => {
    expect(archive).toContain('href="archive.html" aria-current="page"');
    expect(home).toContain('href="archive.html"');
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

describe("shared header chrome (#112)", () => {
  const home = renderToStaticMarkup(<HomePage index={index} />);
  const archive = renderToStaticMarkup(<ArchivePage index={index} />);
  const privacy = renderToStaticMarkup(<PrivacyPage />);
  const detail = renderToStaticMarkup(
    <OfferDetailPage index={index} slug={index.offers[0].slug} />,
  );
  const routes: [string, string][] = [
    ["home", home],
    ["archive", archive],
    ["privacy", privacy],
    ["detail", detail],
  ];

  it("renders the same brand bar on every route, depth-aware", () => {
    for (const [, markup] of routes) {
      expect(markup).toContain('class="site-bar"');
      expect((markup.match(/class="site-brand"/g) ?? []).length).toBe(1);
      expect(markup).toContain('src="');
    }
    expect(home).toContain('<a class="site-brand" href="./index.html">');
    expect(detail).toContain('<a class="site-brand" href="../index.html">');
  });

  it("keeps the wordmark and primary nav identical across routes", () => {
    for (const [, markup] of routes) {
      expect(markup).toContain(">Free AI Credits</");
      expect((markup.match(/class="site-nav"/g) ?? []).length).toBe(1);
      expect(markup).toContain('aria-label="Primary"');
      expect(markup).toContain(">Offers</a>");
      expect(markup).toContain(">Archive</a>");
      expect(markup).toContain(">Privacy</a>");
    }
  });

  it("marks the active route in the primary nav without losing the footer state", () => {
    expect(home).toContain('<a href="./index.html" aria-current="page">Offers</a>');
    expect(archive).toContain('href="archive.html" aria-current="page"');
    expect(privacy).toContain('<a href="privacy.html" aria-current="page">Privacy</a>');
    expect(detail).not.toMatch(/<a href="\.\.\/index\.html" aria-current="page">Offers<\/a>/);
    // Footer active state is untouched by #112.
    expect(privacy).toContain(
      '<a href="privacy.html" aria-current="page">Privacy policy</a>',
    );
  });

  it("renders a clickable all-deals icon in the primary nav (#113)", () => {
    for (const [, markup] of routes) {
      const nav = markup.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
      expect(nav).toContain('class="nav-archive"');
      // The icon lives inside the archive anchor, so clicking it navigates
      // to the all-deals page and inherits the same hover/focus styles.
      expect(nav).toMatch(
        /<a class="nav-archive"[^>]*>\s*<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*<\/svg>\s*Archive\s*<\/a>/,
      );
      expect(nav).toContain('aria-label="All deals"');
    }
  });

  it("still puts exactly one main landmark and one h1 per page", () => {
    for (const [, markup] of routes) {
      expect(markup.match(/<main>/g)?.length).toBe(1);
      expect(markup.match(/<h1>/g)?.length).toBe(1);
    }
    expect(home).toMatch(/<h1>Free AI Credits<\/h1>/);
    expect(archive).toContain("<h1>Expired offer archive</h1>");
    expect(privacy).toContain("<h1>Privacy Policy</h1>");
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
