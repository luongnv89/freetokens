import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, within } from "@testing-library/react";
import App from "../App";
import UnverifiedPage, { FRESH_DAYS, LEAD_SOURCE_REL } from "./UnverifiedPage";
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
  it("shows the banner, then a card with posted date, claim, reason, sources and hunt dates", () => {
    render(<UnverifiedPage leads={leadsIndex([lead()])} />);
    const banner = screen.getByRole("note", { name: "Before you claim" });
    expect(banner.textContent).toContain(
      "spotted on X or the web but not confirmed on an official page",
    );
    expect(banner.textContent).toContain("never DM anyone");
    expect(banner.textContent).toMatch(/never\s+share API keys/i);

    const card = screen.getByRole("listitem", { name: "Free tokens week" });
    const text = card.textContent ?? "";
    expect(card.querySelector(".lead-posted")?.textContent).toBe("Posted Nov 1, 2026");
    expect(text).toContain("Acme AI");
    expect(text).toContain("1M free tokens to every new account");
    expect(text).toContain("First spotted by our hunt");
    expect(text).toContain("Last checked");
    expect(text).toContain("Nov 2, 2026");
    expect(text).toContain("Official pages say nothing about it");

    const links = within(card).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://x.com/acme_fan/status/1",
      "https://blog.example.com/acme",
    ]);
    for (const a of links) {
      expect(a.getAttribute("rel")).toBe(LEAD_SOURCE_REL);
    }
    expect(LEAD_SOURCE_REL).toBe("nofollow ugc noopener noreferrer");
    expect(links[0].textContent).toContain("@acme_fan on X");
    expect(links[1].textContent).toContain("blog.example.com");
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
    expect(document.querySelector(".lead-grid")).toBeNull();
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
  });
});
