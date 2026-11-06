import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, within } from "@testing-library/react";
import App from "../App";
import UnverifiedPage, { FRESH_DAYS, LEAD_SOURCE_REL } from "./UnverifiedPage";
import LeadDetailPage from "./LeadDetailPage";
import type { Lead, LeadsIndex } from "../lib/leads";
import type { OffersIndex } from "../lib/offers";
import indexData from "../data/offers.json";

const index = indexData as OffersIndex;

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    slug: "acme-free-tokens",
    provider: "Acme AI",
    title: "Free tokens week",
    claim: "Acme gives 1M free tokens to every new account this week.",
    amount_claimed: "1M tokens",
    sources: [
      {
        url: "https://x.com/acme_fan/status/1",
        type: "x",
        author: "Acme Fan",
        handle: "@acme_fan",
        date: "2026-11-01",
      },
      {
        url: "https://blog.example.com/acme",
        type: "web",
        author: null,
        handle: null,
        date: null,
      },
    ],
    posted: "2026-11-01",
    first_seen: "2026-11-01",
    last_seen: "2026-11-02",
    reason: "official_silent",
    reason_detail: "Acme's pricing page loaded but says nothing about free tokens.",
    ...overrides,
  };
}

function leadsIndex(leads: Lead[]): LeadsIndex {
  return { generated_at: "2026-11-03T00:00:00Z", count: leads.length, leads };
}

describe("UnverifiedPage (#660)", () => {
  it("shows the banner, then each lead as an offer-style row linking to its own page", () => {
    render(<UnverifiedPage leads={leadsIndex([lead()])} />);
    const banner = screen.getByRole("note", { name: "Before you claim" });
    expect(banner.textContent).toContain(
      "spotted on X or the web but not confirmed on an official page",
    );
    expect(banner.textContent).toContain("never DM anyone");
    expect(banner.textContent).toMatch(/never\s+share API keys/i);

    // Same ledger-row skeleton as OfferRow.
    const row = document.querySelector("ol.grid > li > article.card")!;
    expect(row).toBeTruthy();
    expect(row.querySelector(".row-eyebrow .r-prov")?.textContent).toBe("Acme AI");
    expect(
      row.querySelector(".row-eyebrow .badge-review-status-unverified")?.textContent,
    ).toBe("unconfirmed");
    expect(row.querySelector(".card-title")?.textContent).toBe("Free tokens week");
    expect(row.querySelector(".r-amount")?.textContent).toBe("1M tokens");
    expect(row.querySelector(".row-quiet")?.textContent).toContain(
      "Official pages say nothing about it",
    );
    expect(row.querySelector(".row-rail .status")?.textContent).toBe(
      "posted Nov 1, 2026",
    );
    expect(row.querySelector(".row-rail .r-vfd")?.textContent).toBe(
      "checked yesterday",
    );

    // Links go only to the lead's own page; no source links, no offer hooks.
    const links = within(row as HTMLElement).getAllByRole("link");
    expect(new Set(links.map((a) => a.getAttribute("href")))).toEqual(
      new Set(["unverified/acme-free-tokens.html"]),
    );
    expect(row.querySelector("[data-ft-offer-id]")).toBeNull();
    expect(row.querySelector("button")).toBeNull();
  });

  it("renders a lead's own page in the offer-detail layout, with nofollow ugc sources", () => {
    const leads = leadsIndex([
      lead({ official_urls_tried: ["https://acme.example/pricing"] }),
      lead({ slug: "other-lead", title: "Other lead", posted: "2026-10-31" }),
    ]);
    render(<LeadDetailPage leads={leads} slug="acme-free-tokens" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Free tokens week",
    );
    expect(document.querySelector("article.offer-detail .od-rail .od-facts")).toBeTruthy();
    expect(screen.getByRole("note", { name: "Before you claim" })).toBeTruthy();
    const facts = document.querySelector(".od-table")!.textContent ?? "";
    expect(facts).toContain("Amount claimed1M tokens");
    expect(facts).toContain("First spottedNov 1, 2026");
    expect(facts).toContain("Last checkedNov 2, 2026");
    expect(document.body.textContent).toContain("1M free tokens to every new account");
    expect(document.body.textContent).toContain("says nothing about free tokens");

    const sources = [...document.querySelectorAll(".lead-sources:not(.lead-official) a")];
    expect(sources.map((a) => a.getAttribute("href"))).toEqual([
      "https://x.com/acme_fan/status/1",
      "https://blog.example.com/acme",
    ]);
    for (const a of sources) expect(a.getAttribute("rel")).toBe(LEAD_SOURCE_REL);
    expect(sources[0].textContent).toContain("@acme_fan on X");
    expect(
      document.querySelector(".lead-official a")?.getAttribute("href"),
    ).toBe("https://acme.example/pricing");

    // No claim CTA / apply prompt / offer_click hooks on a lead.
    expect(document.querySelector(".od-cta, [data-ft-offer-id]")).toBeNull();
    expect(
      screen.getByRole("link", { name: "View details for Other lead" }).getAttribute("href"),
    ).toBe("other-lead.html");
  });

  it("shows a not-found state for an unknown lead slug", () => {
    render(<LeadDetailPage leads={leadsIndex([lead()])} slug="gone" />);
    expect(screen.getByRole("heading", { level: 2, name: "Lead not found" })).toBeTruthy();
  });

  it("keeps the loader's order (newest post first) and says so in the tagline", () => {
    const markup = renderToStaticMarkup(
      <UnverifiedPage
        leads={leadsIndex([
          lead({ slug: "b-lead", title: "Newer post", posted: "2026-11-02" }),
          lead({ slug: "a-lead", title: "Older post", posted: "2026-10-31" }),
        ])}
      />,
    );
    expect(markup.indexOf("Newer post")).toBeLessThan(markup.indexOf("Older post"));
    expect(markup).toContain(`posted about in the last ${FRESH_DAYS} days`);
    expect(markup).toContain("newest posts first");
    expect(markup).toMatch(
      /<a href="unverified.html"[^>]*aria-current="page"[^>]*>Unverified<\/a>/,
    );
  });

  it("renders the empty state with the banner still visible", () => {
    render(<UnverifiedPage leads={leadsIndex([])} />);
    expect(screen.getByRole("note", { name: "Before you claim" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Nothing unconfirmed right now",
    );
    expect(document.body.textContent).toContain(
      `Leads appear here for ${FRESH_DAYS} days after someone posts them, and are checked every night.`,
    );
    expect(document.querySelector("#ft-unverified-grid")).toBeNull();
  });

  it("uses the same freshness window as the shared rules", () => {
    const rules = JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, "../../../schemas/unverified-lead.rules.json"),
        "utf8",
      ),
    );
    expect(FRESH_DAYS).toBe(rules.fresh_days);
  });

  it("routes data-page=unverified through App and keeps leads off the home page", () => {
    const leads = leadsIndex([lead()]);
    const page = renderToStaticMarkup(
      <App index={index} leads={leads} route={{ page: "unverified" }} />,
    );
    expect(page).toContain("Free tokens week");
    const home = renderToStaticMarkup(
      <App index={index} leads={leads} route={{ page: "home" }} />,
    );
    expect(home).not.toContain("Free tokens week");
    expect(home).toContain('href="unverified.html"');
    const detail = renderToStaticMarkup(
      <App
        index={index}
        leads={leads}
        route={{ page: "lead", slug: "acme-free-tokens" }}
      />,
    );
    expect(detail).toContain("<h1>Free tokens week</h1>");
    expect(detail).toContain('href="../unverified.html"');
  });
});
