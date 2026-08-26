import { describe, it, expect } from "vitest";
import {
  buildFeed,
  DEFAULT_BASE_URL,
  FEED_TITLE,
  FEED_DESCRIPTION,
} from "../scripts/feed.mjs";

const BASE = DEFAULT_BASE_URL;
const ATOM_NS = "http://www.w3.org/2005/Atom";

function offer(slug, overrides = {}) {
  return {
    slug,
    title: `Offer ${slug}`,
    provider: "Test Provider",
    category: "api_provider",
    amount: "$10 in credits",
    expiry_date: null,
    source_url: "https://example.com/offer",
    verified_date: "2026-08-21",
    verification: "social_proof",
    review_status: "unverified",
    signup: "none",
    status: "active",
    ...overrides,
  };
}

function indexFor(offers, generated_at = "2026-08-22T00:00:00Z") {
  return {
    generated_at,
    count: offers.length,
    active_count: offers.filter((o) => o.status !== "expired").length,
    expired_count: offers.filter((o) => o.status === "expired").length,
    offers,
  };
}

function parseRss(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error(err.textContent);
  return doc;
}

function channelOf(doc) {
  return doc.querySelector("channel");
}

describe("RSS 2.0 feed (#130 / #27)", () => {
  it("emits well-formed RSS 2.0 with channel metadata", () => {
    const xmlText = buildFeed(indexFor([offer("a")]));
    const root = parseRss(xmlText).documentElement;
    expect(root.tagName).toBe("rss");
    expect(root.getAttribute("version")).toBe("2.0");
    const channel = root.querySelector("channel");
    expect(channel.querySelector("title").textContent).toBe(FEED_TITLE);
    expect(channel.querySelector("link").textContent).toBe(`${BASE}/`);
    expect(channel.querySelector("description").textContent).toBe(FEED_DESCRIPTION);
    expect(channel.querySelector("language").textContent).toBe("en");
    expect(channel.querySelector("lastBuildDate").textContent).toBeTruthy();
    expect(channel.querySelector("generator").textContent).toBe(
      "freetokens static build",
    );
  });

  it("excludes expired offers and includes null-expiry plus dated-active", () => {
    const xmlText = buildFeed(
      indexFor([
        offer("live", { expiry_date: null }),
        offer("fresh", { expiry_date: "2026-12-25" }),
        offer("stale", { expiry_date: "2026-08-01", status: "expired" }),
      ]),
    );
    const titles = [...parseRss(xmlText).querySelectorAll("item > title")].map(
      (n) => n.textContent,
    );
    expect(titles).toEqual(["Offer live", "Offer fresh"]);
    expect(titles).not.toContain("Offer stale");
  });

  it("treats missing status as active (Python active_offers parity)", () => {
    const xmlText = buildFeed(
      indexFor([
        offer("legacy", { status: undefined }),
        offer("gone", { status: "expired" }),
      ]),
    );
    const titles = [...parseRss(xmlText).querySelectorAll("item > title")].map(
      (n) => n.textContent,
    );
    expect(titles).toEqual(["Offer legacy"]);
  });

  it("uses absolute item links targeting the offer detail page", () => {
    const xmlText = buildFeed(indexFor([offer("copilot")]));
    const item = parseRss(xmlText).querySelector("item");
    const expected = `${BASE}/offers/copilot.html`;
    expect(item.querySelector("link").textContent).toBe(expected);
    const guid = item.querySelector("guid");
    expect(guid.getAttribute("isPermaLink")).toBe("true");
    expect(guid.textContent).toBe(expected);
  });

  it("formats pubDate as RFC 2822 from the verified date", () => {
    const xmlText = buildFeed(
      indexFor([offer("a", { verified_date: "2026-08-05" })]),
    );
    const pub = parseRss(xmlText).querySelector("item > pubDate").textContent;
    expect(pub).toMatch(/^Wed, 0?5 Aug 2026 00:00:00 \+0000$/);
  });

  it("orders items newest-verified-first with slug tiebreak", () => {
    const xmlText = buildFeed(
      indexFor([
        offer("oldy", { verified_date: "2026-01-01" }),
        offer("newie", { verified_date: "2026-08-20" }),
        offer("middy", { verified_date: "2026-05-05" }),
      ]),
    );
    const titles = [...parseRss(xmlText).querySelectorAll("item > title")].map(
      (n) => n.textContent,
    );
    expect(titles).toEqual(["Offer newie", "Offer middy", "Offer oldy"]);
  });

  it("summarizes amount, category, and expiry in the description", () => {
    const xmlText = buildFeed(
      indexFor([
        offer("dated", {
          expiry_date: "2026-12-31",
          verified_date: "2026-08-20",
          category: "voice",
          amount: "$10 in credits",
        }),
        offer("ongoing"),
      ]),
    );
    const descriptions = Object.fromEntries(
      [...parseRss(xmlText).querySelectorAll("item")].map((item) => [
        item.querySelector("title").textContent,
        item.querySelector("description").textContent,
      ]),
    );
    expect(descriptions["Offer dated"]).toBe(
      "$10 in credits — Voice · expires Dec 31, 2026.",
    );
    expect(descriptions["Offer ongoing"]).toBe(
      "$10 in credits — API providers · ongoing.",
    );
  });

  it("xml-escapes hostile titles (quote=True, apostrophe as &#x27;)", () => {
    const xmlText = buildFeed(
      indexFor([offer("evil", { title: "Bad \"&'<title>" })]),
    );
    expect(
      xmlText.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&#x27;", "'"),
    ).not.toContain("Bad \"&'<title>");
    expect(xmlText).toContain("&lt;title&gt;");
    expect(xmlText).toContain("&quot;");
    expect(xmlText).toContain("&#x27;");
    expect(xmlText).toContain("&amp;");
  });

  it("strips a trailing slash from the base URL override", () => {
    const xmlText = buildFeed(indexFor([offer("a")]), "https://example.com/site/");
    expect(xmlText).toContain("<link>https://example.com/site/</link>");
  });

  it("includes an atom:self link for the W3C validator recommendation", () => {
    const xmlText = buildFeed(indexFor([offer("a")]));
    expect(xmlText).toContain(ATOM_NS);
    const doc = parseRss(xmlText);
    const atomLinks = [...doc.getElementsByTagNameNS(ATOM_NS, "link")].filter(
      (el) => el.getAttribute("rel") === "self",
    );
    expect(atomLinks).toHaveLength(1);
    expect(atomLinks[0].getAttribute("href")).toBe(`${BASE}/feed.xml`);
    expect(atomLinks[0].getAttribute("type")).toBe("application/rss+xml");
  });

  it("includes a newly added offer on the next buildFeed call", () => {
    const before = indexFor([offer("existing")]);
    expect(buildFeed(before)).not.toContain("Offer newie");
    const after = indexFor([
      offer("existing"),
      offer("newie", { verified_date: "2026-08-24" }),
    ]);
    const xmlText = buildFeed(after);
    expect(xmlText).toContain("<title>Offer newie</title>");
    expect(xmlText).toContain(`${BASE}/offers/newie.html`);
  });

  it("escapes XML metacharacters in titles and amounts", () => {
    const fixture = indexFor([
      offer("legacy", { status: undefined, title: "O'Reilly \"&\" <AI>" }),
      offer("amp", {
        amount: "10k tokens & extra",
        verified_date: "2026-08-01",
      }),
    ]);
    const xml = buildFeed(fixture);
    expect(xml).toContain(
      "O&#x27;Reilly &quot;&amp;&quot; &lt;AI&gt;",
    );
    expect(xml).toContain("10k tokens &amp; extra");
  });
});
