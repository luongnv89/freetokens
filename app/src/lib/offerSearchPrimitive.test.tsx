import { cleanup, render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createAgent } from "@ui-sdk/react/agent";
import { usePart, usePrimitive } from "@ui-sdk/react/primitive";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "../components/HomePage";
import { OfferSearchRoot } from "../components/OfferSearchRoot";
import type { OffersIndex } from "./offers";
import { offerSearch } from "./offerSearchPrimitive";
import { emptyState } from "./urlState";
import { registerWebMcpTools, runOfferSearch } from "./webmcp";

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

type SearchResult = ReturnType<typeof runOfferSearch>;
type Tool = { name: string; execute: (input: object) => Promise<unknown> };

function stubModelContext() {
  const tools: Record<string, Tool> = {};
  const registerTool = vi.fn(async (tool: Tool) => {
    tools[tool.name] = tool;
  });
  Object.defineProperty(document, "modelContext", {
    value: { registerTool },
    configurable: true,
    writable: true,
  });
  return tools;
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  delete (document as { modelContext?: unknown }).modelContext;
});

function renderToolbar() {
  return render(
    <OfferSearchRoot index={index} state={emptyState()} aria-label={LABEL} />,
  );
}

function UnindexedProbe() {
  const handle = usePrimitive(offerSearch, {});
  return usePart(handle, "root", {}, { "aria-label": "Unindexed probe" }, "section");
}

const rows = () =>
  document.querySelectorAll("#ft-grid article[id^='offer-']").length;

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

  it("search returns exactly what the registered search_offers tool returns", async () => {
    const tools = stubModelContext();
    registerWebMcpTools(index)?.abort();
    renderToolbar();
    const input = { query: "beta", category: "coding" };
    const result = await agent.act({
      steps: [{ ref: LABEL, action: "search", args: [input] }],
    });
    expect(result.ok, result.error?.message).toBe(true);
    const out = result.steps[0].result as SearchResult;
    expect(out).toEqual(await tools.search_offers.execute(input));
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

  it("returns the full result shape even without an index", async () => {
    render(<UnindexedProbe />);
    const result = await agent.act({
      steps: [
        { ref: "Unindexed probe", action: "search", args: [{ category: "coding" }] },
      ],
    });
    expect(result.ok, result.error?.message).toBe(true);
    const out = result.steps[0].result as SearchResult;
    expect(Object.keys(out).sort()).toEqual(
      Object.keys(runOfferSearch(index, {})).sort(),
    );
    expect(out).toMatchObject({
      total: 0,
      offers: [],
      applied_state: { category: "coding" },
      page_updated: false,
    });
    expect(out.results_url).toMatch(/\/\?category=coding$/);
  });

  it("keeps ui-sdk out of the home page when WebMCP is absent", async () => {
    render(<HomePage index={index} />);
    const toolbar = document.querySelector("section.toolbar");
    expect(toolbar?.getAttribute("aria-label")).toBe(LABEL);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector('[data-slot="offer-search"]')).toBeNull();
  });

  it("prerenders the plain toolbar so hydration matches before the swap", () => {
    stubModelContext();
    const html = renderToString(<HomePage index={index} />);
    expect(html).toContain('class="toolbar" aria-label="Search and filter offers"');
    expect(html).not.toContain("offer-search");
  });

  it("swaps in the primitive after hydration and applies agent filters to the list", async () => {
    stubModelContext();
    render(<HomePage index={index} />);
    await waitFor(() =>
      expect(
        document.querySelector('section.toolbar[data-slot="offer-search"]'),
      ).not.toBeNull(),
    );
    expect(rows()).toBe(2);
    const result = await agent.act({
      steps: [{ ref: LABEL, action: "search", args: [{ category: "coding" }] }],
    });
    expect(result.ok, result.error?.message).toBe(true);
    expect((result.steps[0].result as SearchResult).page_updated).toBe(true);
    await waitFor(() => expect(rows()).toBe(1));
    expect(window.location.search).toBe("?category=coding");
    const entry = agent
      .snapshot()
      .find((e) => e.component === "offer-search" && !e.offPage);
    expect(entry?.value).toMatchObject({ category: "coding" });
  });

  it("server-renders the primitive root without touching browser APIs", () => {
    const html = renderToString(
      <OfferSearchRoot
        index={index}
        state={emptyState()}
        aria-label={LABEL}
        className="toolbar"
      />,
    );
    expect(html).toContain('aria-label="Search and filter offers"');
    expect(html).toContain('class="toolbar"');
  });
});
