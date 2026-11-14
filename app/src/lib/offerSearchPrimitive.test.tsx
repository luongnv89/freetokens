import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createAgent, registerTools } from "@ui-sdk/react/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfferSearchRoot } from "../components/OfferSearchRoot";
import type { OffersIndex } from "./offers";
import { filtersFromState } from "./offerSearchPrimitive";
import { emptyState } from "./urlState";
import { runOfferSearch } from "./webmcp";

// #726 ui-sdk trial: the toolbar's offer-search primitive must expose one
// `search` action to ui-sdk's agent bridge that returns exactly what the
// #535 search_offers tool returns, and stay inert under SSR.

const index: OffersIndex = {
  generated_at: "2026-10-01T00:00:00Z",
  count: 3,
  active_count: 2,
  expired_count: 1,
  offers: [
    {
      slug: "alpha-api",
      title: "Alpha API Credits",
      provider: "Alpha",
      category: "api_provider",
      amount: "$100 in credits",
      expiry_date: null,
      source_url: "https://alpha.example.com/offer",
      verified_date: "2026-09-30",
      verification: "social_proof",
      review_status: "verified",
      signup: "none",
      status: "active",
    },
    {
      slug: "beta-coding",
      title: "Beta Coding Plan",
      provider: "Beta",
      category: "coding",
      amount: "1M tokens",
      expiry_date: "2026-12-31",
      source_url: "https://beta.example.com/offer",
      verified_date: "2026-09-29",
      verification: "unverified",
      review_status: "unverified",
      signup: "required",
      status: "active",
    },
    {
      slug: "gamma-old",
      title: "Gamma Old",
      provider: "Gamma",
      category: "image",
      amount: "$5",
      expiry_date: "2020-01-01",
      source_url: "https://gamma.example.com/offer",
      verified_date: "2020-01-01",
      verification: "unverified",
      review_status: "to-be-verified",
      signup: "none",
      status: "expired",
    },
  ],
};

const LABEL = "Search and filter offers";
const agent = createAgent();

afterEach(() => {
  cleanup();
  delete (document as { modelContext?: unknown }).modelContext;
});

function renderToolbar() {
  return render(
    <OfferSearchRoot
      index={index}
      value={filtersFromState(emptyState())}
      aria-label={LABEL}
    />,
  );
}

describe("offer-search primitive (ui-sdk trial, #726)", () => {
  it("shows up in the agent snapshot by its accessible name with only `search`", () => {
    renderToolbar();
    const entry = agent
      .snapshot()
      .find((e) => e.component === "offer-search" && !e.offPage);
    expect(entry, JSON.stringify(agent.snapshot())).toBeDefined();
    expect(entry?.label).toBe(LABEL);
    expect(entry?.actions).toEqual(["search"]);
    expect(entry?.value).toEqual({
      query: "",
      category: "",
      verification: "",
      signup: "",
      sort: "",
    });
  });

  it("search returns the same compact offers as search_offers", async () => {
    renderToolbar();
    const input = { query: "beta", category: "coding" };
    const result = await agent.act({
      steps: [{ ref: LABEL, action: "search", args: [input] }],
    });
    expect(result.ok, result.error?.message).toBe(true);
    const out = result.steps[0].result as ReturnType<typeof runOfferSearch>;
    expect(out).toEqual(runOfferSearch(index, input));
    expect(out.total).toBe(1);
    expect(out.offers[0]).toMatchObject({
      slug: "beta-coding",
      title: "Beta Coding Plan",
      provider: "Beta",
      amount: "1M tokens",
      expiry_date: "2026-12-31",
    });
    expect(out.offers[0].url).toMatch(/beta-coding/);
  });

  it("drops expired offers and values the UI cannot represent", () => {
    const out = runOfferSearch(index, { category: "nope" });
    expect(out.offers.map((o) => o.slug)).toEqual(["alpha-api", "beta-coding"]);
    expect(out.applied_state).toEqual({});
  });

  it("registers ui-sdk's tools only when document.modelContext exists", () => {
    expect(() => registerTools(agent, { allow: () => true })()).not.toThrow();
    const registerTool = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "modelContext", {
      value: { registerTool },
      configurable: true,
      writable: true,
    });
    const unregister = registerTools(agent, { allow: () => true });
    const names = registerTool.mock.calls.map(([tool]) => tool.name).sort();
    expect(names).toEqual(["act", "query", "snapshot"]);
    unregister();
  });

  it("server-renders the toolbar root without touching browser APIs", () => {
    const html = renderToString(
      <OfferSearchRoot
        index={index}
        value={filtersFromState(emptyState())}
        aria-label={LABEL}
        className="toolbar"
      />,
    );
    expect(html).toContain('aria-label="Search and filter offers"');
    expect(html).toContain('class="toolbar"');
  });
});
