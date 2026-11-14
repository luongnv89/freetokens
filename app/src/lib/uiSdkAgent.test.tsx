import { cleanup, render } from "@testing-library/react";
import { Input } from "@ui-sdk/react/input";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfferSearchRoot } from "../components/OfferSearchRoot";
import type { OffersIndex } from "./offers";
import { registerUiSdkAgent } from "./uiSdkAgent";
import { emptyState } from "./urlState";

// #726: the bridge main.tsx registers must let a page agent run the
// toolbar's `search` and nothing else, even on other ui-sdk controls.

const index: OffersIndex = {
  generated_at: "2026-10-01T00:00:00Z",
  count: 1,
  active_count: 1,
  expired_count: 0,
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
  ],
};

type ActResult = {
  ok: boolean;
  error?: { message: string };
  steps: { result?: unknown }[];
};
type Tool = { name: string; execute: (input: object) => Promise<unknown> };

function stubModelContext() {
  const tools: Record<string, Tool> = {};
  Object.defineProperty(document, "modelContext", {
    value: {
      registerTool: vi.fn(async (tool: Tool) => {
        tools[tool.name] = tool;
      }),
    },
    configurable: true,
    writable: true,
  });
  return tools;
}

async function act(tool: Tool, steps: object[]): Promise<ActResult> {
  const out = await tool.execute({ steps });
  return (typeof out === "string" ? JSON.parse(out) : out) as ActResult;
}

afterEach(() => {
  cleanup();
  delete (document as { modelContext?: unknown }).modelContext;
});

describe("registerUiSdkAgent (#726)", () => {
  it("is a no-op without document.modelContext", () => {
    expect(() => registerUiSdkAgent()()).not.toThrow();
  });

  it("registers act/query/snapshot and refuses every action but `search`", async () => {
    const tools = stubModelContext();
    const unregister = registerUiSdkAgent();
    expect(Object.keys(tools).sort()).toEqual(["act", "query", "snapshot"]);
    render(
      <>
        <OfferSearchRoot
          index={index}
          state={emptyState()}
          aria-label="Search and filter offers"
        />
        <Input aria-label="Probe field" defaultValue="before" />
      </>,
    );

    const refused = await act(tools.act, [
      { ref: "Probe field", action: "setValue", args: ["after"] },
    ]);
    expect(refused.ok).toBe(false);
    expect(refused.error?.message).toMatch(/refused setValue/);
    expect(
      (document.querySelector('input[aria-label="Probe field"]') as HTMLInputElement)
        .value,
    ).toBe("before");

    const searched = await act(tools.act, [
      {
        ref: "Search and filter offers",
        action: "search",
        args: [{ query: "alpha" }],
      },
    ]);
    expect(searched.ok, searched.error?.message).toBe(true);
    expect(searched.steps[0].result).toMatchObject({
      total: 1,
      offers: [{ slug: "alpha-api" }],
    });
    unregister();
  });
});
