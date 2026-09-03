import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, waitFor } from "@testing-library/react";
import ArchivePage from "./components/ArchivePage";
import HomePage from "./components/HomePage";
import PrivacyPage from "./components/PrivacyPage";
import AboutPage from "./components/AboutPage";
import OfferDetailPage from "./components/OfferDetailPage";
import { FILTER_DIMENSIONS, configureAnalytics, resetAnalyticsForTests } from "./lib/analytics";
import {
  activeOffers,
  buildDate,
  humanDate,
  SIGNUP_LABELS,
  VERIFICATION_LABELS,
  REVIEW_STATUS_LABELS,
  expiredOffers,
  type OffersIndex,
} from "./lib/offers";
import indexData from "./data/offers.json";
import { DEFAULT_BASE_URL } from "./lib/site";

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
    verification: "social_proof",
    review_status: "unverified",
    signup: "none",
    status: "active",
    ...overrides,
  };
}

type BreadcrumbJson = {
  "@type": string;
  itemListElement: { position: number; name: string; item: string }[];
};

function breadcrumbJson(markup: string): BreadcrumbJson {
  const marker = '<script type="application/ld+json">';
  let cursor = 0;
  while (true) {
    const start = markup.indexOf(marker, cursor);
    if (start < 0) break;
    const end = markup.indexOf("</script>", start);
    if (end < 0) break;
    const parsed = JSON.parse(markup.slice(start + marker.length, end)) as BreadcrumbJson;
    if (parsed["@type"] === "BreadcrumbList") return parsed;
    cursor = end + "</script>".length;
  }
  throw new Error("missing breadcrumb JSON-LD");
}

function allJsonLd(markup: string): Record<string, unknown>[] {
  const marker = '<script type="application/ld+json">';
  const blocks: Record<string, unknown>[] = [];
  let cursor = 0;
  while (true) {
    const start = markup.indexOf(marker, cursor);
    if (start < 0) break;
    const end = markup.indexOf("</script>", start);
    if (end < 0) break;
    const raw = markup.slice(start + marker.length, end);
    // Attacker-influenced strings must never break out of the script element.
    expect(raw).not.toContain("</script>");
    blocks.push(JSON.parse(raw) as Record<string, unknown>);
    cursor = end + "</script>".length;
  }
  return blocks;
}

function graphNodeTypes(markup: string): unknown[] {
  const types: unknown[] = [];
  for (const block of allJsonLd(markup)) {
    if (Array.isArray(block["@graph"])) {
      for (const node of block["@graph"] as Record<string, unknown>[]) types.push(node["@type"]);
    } else {
      types.push(block["@type"]);
    }
  }
  return types;
}

function breadcrumbLabels(markup: string): string[] {
  const document = new DOMParser().parseFromString(markup, "text/html");
  const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
  if (!nav) throw new Error("missing breadcrumb nav");
  return [...nav.querySelectorAll('a, [aria-current="page"]')].map(
    (element) => element.textContent?.trim() ?? "",
  );
}

describe("SSR breadcrumbs (#208)", () => {
  it("keeps the visible trail and JSON-LD in the same order at every required depth", () => {
    const pages = [
      {
        markup: renderToStaticMarkup(
          <ArchivePage index={index} baseUrl={DEFAULT_BASE_URL} />,
        ),
        names: ["Offers", "Archive"],
        href: "./index.html",
        urls: [`${DEFAULT_BASE_URL}/`, `${DEFAULT_BASE_URL}/archive.html`],
      },
      {
        markup: renderToStaticMarkup(<PrivacyPage baseUrl={DEFAULT_BASE_URL} />),
        names: ["Offers", "Privacy"],
        href: "./index.html",
        urls: [`${DEFAULT_BASE_URL}/`, `${DEFAULT_BASE_URL}/privacy.html`],
      },
      {
        markup: renderToStaticMarkup(<AboutPage index={index} baseUrl={DEFAULT_BASE_URL} />),
        names: ["Offers", "About"],
        href: "./index.html",
        urls: [`${DEFAULT_BASE_URL}/`, `${DEFAULT_BASE_URL}/about.html`],
      },
      {
        markup: renderToStaticMarkup(
          <OfferDetailPage
            index={index}
            slug={index.offers[0].slug}
            baseUrl={DEFAULT_BASE_URL}
          />,
        ),
        names: ["Offers", index.offers[0].title],
        href: "../index.html",
        urls: [
          `${DEFAULT_BASE_URL}/`,
          `${DEFAULT_BASE_URL}/offers/${index.offers[0].slug}.html`,
        ],
      },
    ];

    for (const page of pages) {
      const document = new DOMParser().parseFromString(page.markup, "text/html");
      const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
      expect(nav).not.toBeNull();
      expect(breadcrumbLabels(page.markup)).toEqual(page.names);
      expect(nav?.querySelector(`a[href="${page.href}"]`)).not.toBeNull();
      expect(nav?.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(nav?.querySelector('[aria-current="page"]')?.tagName).toBe("SPAN");

      const data = breadcrumbJson(page.markup);
      expect(data["@type"]).toBe("BreadcrumbList");
      expect(data.itemListElement.map((item) => item.name)).toEqual(page.names);
      expect(data.itemListElement.map((item) => item.position)).toEqual([1, 2]);
      expect(data.itemListElement.map((item) => item.item)).toEqual(page.urls);
    }
  });

  it("renders empty breadcrumbs on home (JSON-LD only, no self-link)", () => {
    const markup = renderToStaticMarkup(<HomePage index={index} />);
    const document = new DOMParser().parseFromString(markup, "text/html");
    // Breadcrumbs component renders for JSON-LD but with zero items (no self-link)
    const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
    expect(nav).not.toBeNull();
    expect(nav!.querySelectorAll('li').length).toBe(0);
    expect(markup).toContain('"@type":"BreadcrumbList"');
  });

  it("serializes offer titles safely while keeping the JSON-LD parseable", () => {
    const title = 'Quote " & </script><script>alert(1)</script>';
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{ ...index, offers: [offer({ slug: "special-offer", title })] }}
        slug="special-offer"
        details={{}}
        baseUrl="https://example.test/freetokens/"
      />,
    );
    const marker = '<script type="application/ld+json">';
    // OfferDetail now emits breadcrumb + site structured data (Organization/WebSite/TechArticle/Offer)
    expect(markup.split(marker)).toHaveLength(3);
    // Every block must parse and stay inside its script element — including the
    // @graph block carrying the attacker-influenced title/summary.
    const blocks = allJsonLd(markup);
    expect(blocks).toHaveLength(2);
    const graph = blocks.map((b) => b["@graph"]).find(Array.isArray) as Record<string, unknown>[];
    const article = graph.find((n) => n["@type"] === "TechArticle");
    expect(article?.headline).toBe(title);
    const offerNode = graph.find((n) => n["@type"] === "Offer");
    expect(offerNode?.name).toBe(title);
    expect(breadcrumbJson(markup).itemListElement[1]).toEqual({
      "@type": "ListItem",
      position: 2,
      name: title,
      item: "https://example.test/freetokens/offers/special-offer.html",
    });
    expect(breadcrumbLabels(markup)).toEqual(["Offers", title]);
  });

  it("renders a deterministic breadcrumb for an unknown detail slug", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={index}
        slug="no-such-offer"
        baseUrl={DEFAULT_BASE_URL}
      />,
    );
    expect(breadcrumbLabels(markup)).toEqual(["Offers", "Offer not found"]);
    expect(breadcrumbJson(markup).itemListElement[1].item).toBe(
      `${DEFAULT_BASE_URL}/offers/no-such-offer.html`,
    );
    // Soft-404 state carries no Article markup — org+site graph only.
    expect(graphNodeTypes(markup)).not.toContain("TechArticle");
  });
});

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
    const emptyIndex: OffersIndex = {
      ...index,
      offers: index.offers.filter((o) => o.status !== "expired"),
      expired_count: 0,
      active_count: index.offers.filter((o) => o.status !== "expired").length,
    };
    const markup = renderToStaticMarkup(<ArchivePage index={emptyIndex} />);
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
    // Archive uses OfferRow: data-expiry attribute + status span with expiry
    expect(markup).toContain('data-expiry="2026-01-15"');
    expect(markup).toContain('href="offers/gone.html"');
    expect(markup).toMatch(/expires <time [Dd]ate[Tt]ime="2026-01-15">/);
    expect(markup).toContain("Skip the offer list");
    // OfferRow uses .r-details link instead of .detail-btn
    expect(markup).toContain('class="r-details"');
  });

  it("archive tags are interactive buttons, not inert links", () => {
    const fixture = {
      ...index,
      offers: [offer({ slug: "gone", expiry_date: "2026-01-15", status: "expired" as const })],
    };
    const markup = renderToStaticMarkup(<ArchivePage index={fixture} />);
    // Archive now uses OfferRow: tags are buttons, not links
    expect(markup).toContain('type="button"');
    expect(markup).toContain('class="badge badge-category badge-category-coding"');
    expect(markup).toContain('class="badge badge-verification badge-verification-social_proof"');
    expect(markup).toContain('class="badge badge-signup badge-signup-none"');
    expect(markup).toContain('data-ft-tag="category"');
    expect(markup).toContain('data-ft-tag="verification"');
    expect(markup).toContain('data-ft-tag="signup"');
    // OfferRow uses "Filter by" aria-labels, not "See offers tagged"
    expect(markup).toContain('aria-label="Filter by Coding"');
    expect(markup).not.toContain('aria-label="Filter by hand-verified"');
    expect(markup).toContain('aria-label="Filter by social proof"');
    expect(markup).toContain('aria-label="Filter by no sign-up"');
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
    expect(css).toMatch(/\.breadcrumbs-list \{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\.breadcrumbs-list li \{[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(
      /@media \(pointer: coarse\) \{\s*\.breadcrumbs a \{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*min-height:\s*44px/s,
    );
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
    expect(markup).toContain('href="../index.html?verification=social_proof"');
    expect(markup).toContain('href="../index.html?signup=none"');
    expect(markup).toContain('aria-label="See offers tagged Coding"');
    expect(markup).not.toContain('aria-label="See offers tagged hand-verified"');
    expect(markup).toContain('aria-label="See offers tagged social proof"');
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

  it("renders a skimmable details table with every key fact (#110)", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{
          ...index,
          offers: [
            offer({
              provider: "Example Co",
              amount: "$10 credits",
              expiry_date: "2026-12-31",
              verification: "social_proof",
            }),
          ],
        }}
        slug="example-offer"
        details={{}}
      />,
    );
    expect(markup).toContain('class="od-table"');
    for (const label of [
      "Provider",
      "Amount",
      "Category",
      "Sign-up",
      "Ends",
      "Verification",
      "Review status",
      "Last checked",
    ]) {
      expect(markup).toContain(`<th scope="row">${label}</th>`);
    }
    // Values are scannable without reading prose.
    expect(markup).toMatch(/<th scope="row">Provider<\/th><td>Example Co<\/td>/);
    expect(markup).toContain('<time dateTime="2026-12-31">');
    // No information is lost: the hero and status line stay intact.
    expect(markup).toContain('class="od-hero"');
    expect(markup).toContain("$10 credits");
  });

  it("details table shows the ongoing state for offers with no end date (#110)", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{ ...index, offers: [offer({ expiry_date: null })] }}
        slug="example-offer"
        details={{}}
      />,
    );
    expect(markup).toContain("ongoing — no fixed end date");
  });

  it("keeps free-form summary prose below the details table (#110)", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{ ...index, offers: [offer()] }}
        slug="example-offer"
        details={{
          "example-offer": { summary: "Prose lives under the table." },
        }}
      />,
    );
    const tableAt = markup.indexOf('class="od-table"');
    // Visible prose lives in .od-summary; JSON-LD description also contains the text
    // so search for the visible element to avoid matching the head <script> block.
    const proseAt = markup.indexOf('<p class="od-summary">Prose lives under the table.');
    expect(tableAt).toBeGreaterThan(-1);
    expect(proseAt).toBeGreaterThan(tableAt);
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

  it("mounts the hidden traffic strip on every page when GoatCounter is configured (#250)", () => {
    configureAnalytics({ statsSite: "https://luongnv89.goatcounter.com" });
    const pages = [
      renderToStaticMarkup(<HomePage index={index} />),
      renderToStaticMarkup(<ArchivePage index={index} />),
      renderToStaticMarkup(<PrivacyPage />),
      renderToStaticMarkup(<AboutPage index={index} />),
      renderToStaticMarkup(
        <OfferDetailPage index={{ ...index, offers: [offer()] }} slug="example-offer" />,
      ),
    ];
    for (const markup of pages) {
      expect(markup).toContain('id="ft-traffic"');
      expect(markup).toContain('id="ft-traffic-total"');
      expect(markup).toContain("visits");
    }
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
        expect(
          document.querySelector(".od-views")?.textContent?.replace(/\s+/g, " ").trim(),
        ).toBe("42 views");
      });
      const views = document.querySelector(".od-views");
      expect(views?.classList.contains("ft-stat")).toBe(true);
      expect(views?.querySelector("strong")?.textContent).toBe("42");
      expect(views?.querySelector(".ft-stat-label")?.textContent).toBe("views");
      expect(views?.closest(".od-hero-metrics")).not.toBeNull();
      expect(document.querySelector(".od-statusline .od-views")).toBeNull();
      expect(calls[0]).toBe(
        "https://luongnv89.goatcounter.com/counter/%2Foffers%2Fexample-offer.html.json",
      );
      expect(document.getElementById("ft-traffic")).not.toBeNull();
      expect(document.getElementById("ft-traffic-total")).not.toBeNull();
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

describe("no-signup and verification honesty badges (#111)", () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, "styles/python-parity.css"),
    "utf8",
  );

  it("retains signup, verification, and review badges on detail surfaces", () => {
    const markup = renderToStaticMarkup(
      <OfferDetailPage
        index={{ ...index, offers: [offer()] }}
        slug="example-offer"
        details={{}}
      />,
    );
    // The verification tag is now shown on both detail surfaces.
    expect((markup.match(/badge-signup-none\b/g) ?? []).length).toBe(2);
    expect((markup.match(/badge-verification-social_proof\b/g) ?? []).length).toBe(2);
    expect((markup.match(/badge-review-status-unverified\b/g) ?? []).length).toBe(2);
    expect(markup).toContain(">no sign-up</span>");
    expect(markup).toContain(">social proof</span>");
    expect(markup).toContain('<th scope="row">Verification</th>');
    expect(markup).toContain(`>${REVIEW_STATUS_LABELS.unverified}</span>`);
  });

  it("gives every verification state a pairwise-distinct label and CSS marker", () => {
    const labels = Object.values(VERIFICATION_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    for (const value of Object.keys(VERIFICATION_LABELS)) {
      expect(css).toMatch(
        new RegExp(`\\.badge-verification-${value} \\{ --tag-hue:`),
      );
    }
  });

  it("marks no-sign-up distinctly from sign-up-required", () => {
    expect(SIGNUP_LABELS.none).not.toBe(SIGNUP_LABELS.required);
    expect(css).toMatch(/\.badge-signup-none \{ --tag-hue:/);
    expect(css).toMatch(/\.badge-signup-required \{ --tag-hue:/);
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
      "footer of every page",
      "all-time",
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
      expect(markup.match(/<h1\b/g)?.length).toBe(1);
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
    expect(home).toContain('class="site-brand"');
    expect(home).toContain('href="./index.html"');
    expect(detail).toContain('class="site-brand"');
    expect(detail).toContain('href="../index.html"');
  });

  it("keeps the wordmark and primary nav identical across routes", () => {
    for (const [, markup] of routes) {
      expect(markup).toContain(">Free AI Credits</");
      expect((markup.match(/class="site-nav"/g) ?? []).length).toBe(1);
      expect(markup).toContain('aria-label="Primary"');
      expect(markup).toContain(">Offers</a>");
      expect(markup).toContain(">Archive</a>");
      expect(markup).toContain(">About</a>");
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
      // Accessible name contains the visible label "Archive" (WCAG 2.5.3).
      expect(nav).toContain('aria-label="Archive: all deals"');
    }
  });

  it("still puts exactly one main landmark and one h1 per page", () => {
    for (const [, markup] of routes) {
      expect(markup.match(/<main>/g)?.length).toBe(1);
      expect(markup.match(/<h1\b/g)?.length).toBe(1);
    }
    expect(home).toContain(
      '<h1 class="site-slogan">Every claimable free AI credit offer — verified, tagged, and on one fast page.</h1>',
    );
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

// Masthead stats rail (#279 move visitor stats to the top, #280 highlight the
// data's last-updated time, #281 surface the total active-deal count). One
// strip under the header carries all three.
describe("masthead stats rail (#279 / #280 / #281)", () => {
  afterEach(() => {
    resetAnalyticsForTests();
    configureAnalytics({ statsSite: "" });
  });

  const home = () => renderToStaticMarkup(<HomePage index={index} />);

  it("renders the rail once, above the offer list (#279)", () => {
    const markup = home();
    expect(markup.match(/class="site-stats"/g)?.length).toBe(1);
    const railAt = markup.indexOf('class="site-stats"');
    const headerAt = markup.indexOf('class="site-bar"');
    const gridAt = markup.indexOf('id="ft-grid"');
    expect(headerAt).toBeGreaterThan(-1);
    expect(railAt).toBeGreaterThan(headerAt);
    expect(gridAt).toBeGreaterThan(railAt);
  });

  it("prerenders the total active-deal count, unfiltered (#281)", () => {
    const markup = home();
    const total = activeOffers(index).length;
    expect(total).toBeGreaterThan(0);
    expect(markup).toContain(
      `<span class="ft-stat stat-deals"><strong>${total}</strong> <span class="ft-stat-label">active deals</span></span>`,
    );
  });

  it("uses a singular label for a single active deal (#281)", () => {
    const one: OffersIndex = { ...index, offers: [offer()] };
    const markup = renderToStaticMarkup(<HomePage index={one} />);
    expect(markup).toContain('<strong>1</strong> <span class="ft-stat-label">active deal</span>');
  });

  it("counts only active offers — expired entries never inflate it (#281)", () => {
    const mixed: OffersIndex = {
      ...index,
      offers: [offer(), offer({ slug: "gone", status: "expired" })],
    };
    const markup = renderToStaticMarkup(<HomePage index={mixed} />);
    expect(markup).toContain('<strong>1</strong> <span class="ft-stat-label">active deal</span>');
  });

  it("shows the build's last-updated date as machine-readable <time> (#280)", () => {
    const markup = home();
    const expected = humanDate(buildDate(index.generated_at));
    // HTML attribute names are ASCII case-insensitive; React 19 emits the
    // JSX spelling verbatim, so match either casing.
    expect(markup).toMatch(
      new RegExp(`<time date[Tt]ime="${index.generated_at}">${expected}</time>`),
    );
    // Labelled in words, never by colour alone (WCAG 1.4.1).
    expect(markup).toContain(
      '<span class="ft-stat stat-updated"><span class="ft-stat-label">updated</span> ',
    );
  });

  it("drops the updated chip rather than printing an unparseable date (#280)", () => {
    for (const generated_at of ["", "not-a-date-at-all"]) {
      const markup = renderToStaticMarkup(<HomePage index={{ ...index, generated_at }} />);
      expect(markup).toContain('class="site-stats"');
      expect(markup).not.toContain("stat-updated");
    }
  });

  it("mounts the traffic strip in the rail on home, not in the home footer (#279)", () => {
    configureAnalytics({ statsSite: "https://luongnv89.goatcounter.com" });
    const markup = home();
    expect(markup.match(/id="ft-traffic"/g)?.length).toBe(1);
    const railAt = markup.indexOf('class="site-stats"');
    const stripAt = markup.indexOf('id="ft-traffic"');
    const footerAt = markup.indexOf('id="site-footer"');
    expect(stripAt).toBeGreaterThan(railAt);
    expect(stripAt).toBeLessThan(footerAt);
    expect(markup).toContain('class="stat-strip"');
    expect(markup).not.toContain('class="foot-traffic"');
  });

  it("keeps the traffic strip in the footer on every other page (#279)", () => {
    configureAnalytics({ statsSite: "https://luongnv89.goatcounter.com" });
    const others = [
      renderToStaticMarkup(<ArchivePage index={index} />),
      renderToStaticMarkup(<PrivacyPage />),
      renderToStaticMarkup(<AboutPage index={index} />),
      renderToStaticMarkup(
        <OfferDetailPage index={{ ...index, offers: [offer()] }} slug="example-offer" />,
      ),
    ];
    for (const markup of others) {
      expect(markup.match(/id="ft-traffic"/g)?.length).toBe(1);
      expect(markup).not.toContain('class="site-stats"');
      expect(markup.indexOf('id="ft-traffic"')).toBeGreaterThan(
        markup.indexOf('id="site-footer"'),
      );
    }
  });

  it("renders no traffic markup in the rail when GoatCounter is unset (#279)", () => {
    const markup = home();
    expect(markup).toContain('class="site-stats"');
    expect(markup).not.toContain("ft-traffic");
  });

  it("keeps the total fixed while the toolbar counter follows the filter (#281)", async () => {
    render(<HomePage index={index} />);
    const total = activeOffers(index).length;
    const deals = () =>
      document.querySelector(".stat-deals strong")?.textContent ?? "";
    expect(deals()).toBe(String(total));
    const search = document.getElementById("ft-search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "zzzznomatchzzzz" } });
    await waitFor(() => {
      expect(document.getElementById("ft-results-status")?.textContent).toContain(
        `of ${total} offers`,
      );
    });
    // The rail is the catalog total; only the toolbar line narrows.
    expect(deals()).toBe(String(total));
  });
});
