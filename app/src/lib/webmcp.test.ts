import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWebMcpTools } from "./webmcp";
import type { OffersIndex } from "./offers";

// Issue #535: WebMCP tools must mirror the site's real actions (search /
// filter the live offers, read an offer, navigate to a detail page), ride
// the document.modelContext → navigator.modelContext feature detection the
// implementation guide prescribes, and no-op everywhere else — including
// node/prerender, where `document` does not exist at all.

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

type Carrier = { modelContext?: { registerTool: unknown } };

function stubModelContext(on: "document" | "navigator") {
  const registerTool = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(on === "document" ? document : navigator, "modelContext", {
    value: { registerTool },
    configurable: true,
    writable: true,
  });
  return registerTool;
}

function registeredTools(registerTool: ReturnType<typeof stubModelContext>) {
  return registerTool.mock.calls.map(([tool]) => tool) as {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    annotations?: Record<string, unknown>;
  }[];
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  delete (document as Carrier).modelContext;
  delete (navigator as Carrier).modelContext;
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("registerWebMcpTools", () => {
  it("is a silent no-op when neither document nor navigator exposes modelContext", () => {
    expect(registerWebMcpTools(index)).toBeUndefined();
  });

  it("registers the real site tools on document.modelContext", () => {
    const registerTool = stubModelContext("document");
    const controller = registerWebMcpTools(index);

    expect(controller).toBeInstanceOf(AbortController);
    expect(registerTool).toHaveBeenCalledTimes(3);

    const tools = registeredTools(registerTool);
    expect(tools.map((t) => t.name)).toEqual([
      "search_offers",
      "get_offer",
      "view_offer",
    ]);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema?.type).toBe("object");
      expect(typeof tool.execute).toBe("function");
    }
    // Guide: an AbortController signal goes in the register options so the
    // tools can be unregistered later.
    for (const [, options] of registerTool.mock.calls) {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options.signal.aborted).toBe(false);
    }
  });

  it("unregister signal aborts every registered tool's signal", () => {
    const registerTool = stubModelContext("document");
    const controller = registerWebMcpTools(index);
    controller!.abort();
    for (const [, options] of registerTool.mock.calls) {
      expect(options.signal.aborted).toBe(true);
    }
  });

  it("falls back to navigator.modelContext (older Chrome builds)", () => {
    const registerTool = stubModelContext("navigator");
    expect(registerWebMcpTools(index)).toBeInstanceOf(AbortController);
    expect(registerTool).toHaveBeenCalledTimes(3);
  });

  it("prefers document.modelContext over the navigator fallback", () => {
    const onDocument = stubModelContext("document");
    const onNavigator = stubModelContext("navigator");
    registerWebMcpTools(index);
    expect(onDocument).toHaveBeenCalledTimes(3);
    expect(onNavigator).not.toHaveBeenCalled();
  });

  it("swallows a synchronous draft-shape throw from registerTool", () => {
    const registerTool = stubModelContext("document");
    registerTool.mockImplementation(() => {
      throw new Error("unexpected API shape");
    });
    expect(() => registerWebMcpTools(index)).not.toThrow();
  });

  it("swallows a rejected registration promise", () => {
    const registerTool = stubModelContext("document");
    registerTool.mockRejectedValue(new Error("invalid schema"));
    expect(() => registerWebMcpTools(index)).not.toThrow();
  });

  it("does not touch document at module level — prerender/node safe", () => {
    vi.stubGlobal("document", undefined);
    try {
      expect(() => registerWebMcpTools(index)).not.toThrow();
      expect(registerWebMcpTools(index)).toBeUndefined();
    } finally {
      // Restore inside the test: a leaked `document` stub breaks every
      // later spec's DOM access.
      vi.unstubAllGlobals();
    }
  });
});

describe("search_offers tool", () => {
  async function run(input: Record<string, unknown>) {
    const registerTool = stubModelContext("document");
    registerWebMcpTools(index);
    const tool = registeredTools(registerTool).find(
      (t) => t.name === "search_offers",
    )!;
    return tool.execute(input);
  }

  it("lists all active offers with no filters (expired stay out)", async () => {
    const result = await run({});
    expect(result.total).toBe(2);
    expect(result.applied_state).toEqual({});
    const slugs = (result.offers as { slug: string }[]).map((o) => o.slug);
    expect(slugs).toContain("alpha-api");
    expect(slugs).toContain("beta-coding");
    expect(slugs).not.toContain("gamma-old");
  });

  it("filters by free-text query like the site search box", async () => {
    const result = await run({ query: "alpha" });
    expect(result.total).toBe(1);
    expect((result.offers as { slug: string }[])[0].slug).toBe("alpha-api");
    expect(result.applied_state).toEqual({ q: "alpha" });
  });

  it("filters by category/verification/signup and honors sort", async () => {
    const result = await run({
      category: "coding",
      signup: "required",
      sort: "newest",
    });
    expect(result.total).toBe(1);
    expect((result.offers as { slug: string }[])[0].slug).toBe("beta-coding");
    expect(result.applied_state).toMatchObject({
      category: "coding",
      signup: "required",
      sort: "newest",
    });
  });

  it("advertises the oss_program category alongside student and startup", async () => {
    const registerTool = stubModelContext("document");
    registerWebMcpTools(index);
    const tool = registeredTools(registerTool).find(
      (t) => t.name === "search_offers",
    )!;
    const schema = tool.inputSchema as {
      properties: { category: { enum: string[] } };
    };
    expect(schema.properties.category.enum.slice(-3)).toEqual([
      "startup_program",
      "student",
      "oss_program",
    ]);
  });

  it("keeps an oss_program filter in the applied state", async () => {
    const result = await run({ category: "oss_program" });
    expect(result.applied_state).toEqual({ category: "oss_program" });
    expect(result.results_url).toContain("category=oss_program");
    expect(result.total).toBe(0);
  });

  it("drops values the URL-state whitelist would reject", async () => {
    const result = await run({ category: "student", sort: "bogus" });
    expect(result.applied_state).toEqual({});
    expect(result.total).toBe(2);
  });

  it("returns a shareable results_url encoding the applied filters", async () => {
    const result = await run({ query: "alpha", category: "api_provider" });
    expect(result.results_url).toContain("q=alpha");
    expect(result.results_url).toContain("category=api_provider");
    expect(result.results_url).toContain("?");
  });

  it("drives the on-page listing when the home search UI is mounted", async () => {
    document.body.innerHTML = '<input id="ft-search" type="search">';
    const onPop = vi.fn();
    window.addEventListener("popstate", onPop);
    const result = await run({ query: "alpha" });
    expect(window.location.search).toBe("?q=alpha");
    expect(onPop).toHaveBeenCalled();
    expect(result.page_updated).toBe(true);
    window.removeEventListener("popstate", onPop);
  });

  it("leaves the location alone on pages without the listing UI", async () => {
    const result = await run({ query: "alpha" });
    expect(window.location.search).toBe("");
    expect(result.page_updated).toBe(false);
  });
});

describe("get_offer tool", () => {
  async function run(input: Record<string, unknown>) {
    const registerTool = stubModelContext("document");
    registerWebMcpTools(index);
    const tool = registeredTools(registerTool).find(
      (t) => t.name === "get_offer",
    )!;
    return tool.execute(input);
  }

  it("returns the full record for a known slug", async () => {
    const result = await run({ slug: "alpha-api" });
    expect(result.found).toBe(true);
    const offer = result.offer as Record<string, unknown>;
    expect(offer.provider).toBe("Alpha");
    expect(offer.source_url).toBe("https://alpha.example.com/offer");
    expect(offer.url).toMatch(/\/offers\/alpha-api\.html$/);
    expect(offer.markdown_url).toMatch(/\/offers\/alpha-api\.md$/);
  });

  it("finds expired offers too (their detail pages still exist)", async () => {
    const result = await run({ slug: "gamma-old" });
    expect(result.found).toBe(true);
    expect((result.offer as Record<string, unknown>).status).toBe("expired");
  });

  it("reports a miss without throwing", async () => {
    const result = await run({ slug: "nope" });
    expect(result.found).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("view_offer tool", () => {
  async function run(
    input: Record<string, unknown>,
    navigate: (url: string) => void = vi.fn(),
  ) {
    const registerTool = stubModelContext("document");
    registerWebMcpTools(index, navigate);
    const tool = registeredTools(registerTool).find(
      (t) => t.name === "view_offer",
    )!;
    return { result: await tool.execute(input), navigate };
  }

  it("navigates to the absolute offer detail URL", async () => {
    const { result, navigate } = await run({ slug: "beta-coding" });
    expect(result.found).toBe(true);
    expect(result.navigated).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      expect.stringMatching(/\/offers\/beta-coding\.html$/),
    );
  });

  it("does not navigate for an unknown slug", async () => {
    const { result, navigate } = await run({ slug: "nope" });
    expect(result.found).toBe(false);
    expect(result.navigated).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reports the URL even when navigation itself fails", async () => {
    const { result } = await run({ slug: "beta-coding" }, () => {
      throw new Error("navigation blocked");
    });
    expect(result.found).toBe(true);
    expect(result.navigated).toBe(false);
    expect(result.url).toMatch(/\/offers\/beta-coding\.html$/);
  });
});
