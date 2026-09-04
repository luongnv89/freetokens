import { DEFAULT_BASE_URL, currentBaseUrl } from "../lib/site";
import { activeOffers, expiredOffers, type OffersIndex } from "../lib/offers";
import type { OfferDetail } from "../lib/offerDetails";

type StructuredDataProps =
  | { page: "home"; index: OffersIndex; baseUrl?: string }
  | { page: "archive"; index: OffersIndex; baseUrl?: string }
  | { page: "about"; baseUrl?: string }
  | { page: "privacy"; baseUrl?: string }
  | {
      page: "detail";
      index: OffersIndex;
      slug: string;
      detail?: OfferDetail | null;
      baseUrl?: string;
    };

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || currentBaseUrl() || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

const SITE_DESCRIPTION =
  "Every currently-claimable free AI credit offer, labeled with review status, verification level, and sign-up need, on one fast page.";

function safeJsonLd(value: unknown): string {
  return (JSON.stringify(value) ?? "").replace(/[&<>\u2028\u2029]/g, (ch) => {
    const e: Record<string, string> = {
      "&": "\\u0026",
      "<": "\\u003C",
      ">": "\\u003E",
      "\u2028": "\\u2028",
      "\u2029": "\\u2029",
    };
    return e[ch] ?? ch;
  });
}

function organizationNode(base: string) {
  return {
    "@type": "Organization",
    "@id": `${base}/#organization`,
    name: "Free AI Credits",
    url: base + "/",
    logo: {
      "@type": "ImageObject",
      url: `${base}/og.png`,
      width: 1200,
      height: 630,
    },
    sameAs: ["https://github.com/luongnv89/freetokens"],
  };
}

function websiteNode(base: string) {
  return {
    "@type": "WebSite",
    "@id": `${base}/#website`,
    url: base + "/",
    name: "Free AI Credits",
    description: SITE_DESCRIPTION,
    publisher: { "@id": `${base}/#organization` },
    inLanguage: "en",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${base}/?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function StructuredData(props: StructuredDataProps) {
  const base = normalizeBaseUrl(props.baseUrl);
  const org = organizationNode(base);
  const site = websiteNode(base);

  let pageNode: Record<string, unknown> | null = null;
  let listingNode: Record<string, unknown> | null = null;

  if (props.page === "home") {
    const offers = activeOffers(props.index);
    // Top 10 only: the full directory is one click away, and every extra
    // kilobyte in <head>-adjacent markup costs FCP milliseconds (LH budget #209).
    const top = offers.slice(0, 10);
    pageNode = {
      "@type": "CollectionPage",
      "@id": `${base}/#webpage`,
      url: `${base}/`,
      name: "Free AI Credits — verified free AI credit offers",
      description: SITE_DESCRIPTION,
      isPartOf: { "@id": `${base}/#website` },
      about: { "@id": `${base}/#organization` },
      inLanguage: "en",
    };
    listingNode = {
      "@type": "ItemList",
      name: "Top 10 active free AI credit offers",
      numberOfItems: offers.length,
      itemListElement: top.map((o, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${base}/offers/${o.slug}.html`,
        name: o.title,
      })),
    };
  } else if (props.page === "archive") {
    const offers = expiredOffers(props.index);
    pageNode = {
      "@type": "CollectionPage",
      "@id": `${base}/archive.html#webpage`,
      url: `${base}/archive.html`,
      name: "Offer Archive · Free AI Credits",
      description:
        "Reference archive of expired free AI credit offers, kept newest-first with their original terms.",
      isPartOf: { "@id": `${base}/#website` },
      inLanguage: "en",
    };
    if (offers.length > 0) {
      listingNode = {
        "@type": "ItemList",
        name: "Expired free AI credit offers",
        numberOfItems: offers.length,
        itemListElement: offers.slice(0, 20).map((o, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${base}/offers/${o.slug}.html`,
          name: o.title,
        })),
      };
    }
  } else if (props.page === "about") {
    pageNode = {
      "@type": "AboutPage",
      "@id": `${base}/about.html#webpage`,
      url: `${base}/about.html`,
      name: "About · Free AI Credits",
      description:
        "What Free AI Credits is, how the listings are verified, and what the numbers mean.",
      isPartOf: { "@id": `${base}/#website` },
      inLanguage: "en",
    };
  } else if (props.page === "privacy") {
    pageNode = {
      "@type": "WebPage",
      "@id": `${base}/privacy.html#webpage`,
      url: `${base}/privacy.html`,
      name: "Privacy Policy · Free AI Credits",
      description:
        "How the Free AI Credits site handles data: consent-gated anonymized analytics, no forms, no personal data storage.",
      isPartOf: { "@id": `${base}/#website` },
      inLanguage: "en",
    };
  } else if (props.page === "detail") {
    const offer = props.index.offers.find((o) => o.slug === props.slug) ?? null;
    // Unknown slug: soft-404 state, not an article — skip all page markup
    // (marking it up as TechArticle triggers irrelevant-markup warnings).
    if (!offer) {
      const payload = {
        "@context": "https://schema.org",
        "@graph": [org, site],
      };
      return (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(payload) }}
        />
      );
    }
    const detail = props.detail ?? null;
    const summary = detail?.summary
      ? String(detail.summary).trim().replace(/\s+/g, " ")
      : `${offer.amount} from ${offer.provider} — free AI credits, tagged by verification level and sign-up need.`;
    const canonical = `${base}/offers/${offer.slug}.html`;
    pageNode = {
      "@type": "TechArticle",
      "@id": `${canonical}#article`,
      headline: offer.title,
      description: summary.slice(0, 160),
      url: canonical,
      mainEntityOfPage: { "@id": canonical },
      author: { "@id": `${base}/#organization` },
      publisher: { "@id": `${base}/#organization` },
      datePublished: offer.verified_date ?? undefined,
      dateModified: offer.verified_date ?? undefined,
      isPartOf: { "@id": `${base}/#website` },
      inLanguage: "en",
    };
    // Expose Offer alongside article via @graph — crawler matches both to visible page content (price 0 = free).
    const availability =
      offer.status === "expired"
        ? "https://schema.org/OutOfStock"
        : offer.expiry_date
          ? "https://schema.org/LimitedAvailability"
          : "https://schema.org/InStock";
    const offerNode: Record<string, unknown> = {
      "@type": "Offer",
      "@id": `${canonical}#offer`,
      name: offer.title,
      description: summary.slice(0, 300),
      url: canonical,
      price: "0",
      priceCurrency: "USD",
      availability,
      seller: { "@type": "Organization", name: offer.provider },
      category: offer.category,
    };
    if (offer.expiry_date) offerNode.validThrough = offer.expiry_date;
    listingNode = offerNode;
  }

  const graph: unknown[] = [org, site];
  if (pageNode) graph.push(pageNode);
  if (listingNode) graph.push(listingNode);

  // Use single @graph block per 2026 best practice (one clean graph, stable @ids).
  const payload = { "@context": "https://schema.org", "@graph": graph };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(payload) }}
    />
  );
}
