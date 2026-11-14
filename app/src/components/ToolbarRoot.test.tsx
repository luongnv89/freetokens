import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OffersIndex } from "../lib/offers";
import { emptyState } from "../lib/urlState";
import { ToolbarRoot } from "./ToolbarRoot";

// #726: ToolbarRoot must not even import the ui-sdk toolbar unless
// document.modelContext exists (navigator-only browsers can't use ui-sdk's
// registerTools), and the one post-load swap must keep focus and caret.

const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock("./OfferSearchRoot", async (importOriginal) => {
  loads.count += 1;
  return importOriginal();
});

const index: OffersIndex = {
  generated_at: "2026-10-01T00:00:00Z",
  count: 0,
  active_count: 0,
  expired_count: 0,
  offers: [],
};

function Harness() {
  const [q, setQ] = useState("");
  return (
    <ToolbarRoot index={index} state={emptyState()}>
      <input
        id="ft-search"
        aria-label="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </ToolbarRoot>
  );
}

function stub(on: Document | Navigator) {
  Object.defineProperty(on, "modelContext", {
    value: { registerTool: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
    writable: true,
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const swapped = () =>
  document.querySelector('section.toolbar[data-slot="offer-search"]');

afterEach(() => {
  cleanup();
  delete (document as { modelContext?: unknown }).modelContext;
  delete (navigator as { modelContext?: unknown }).modelContext;
});

describe("ToolbarRoot (#726)", () => {
  it("renders the plain toolbar and never loads ui-sdk without WebMCP", async () => {
    render(<Harness />);
    await settle();
    const section = document.querySelector("section.toolbar");
    expect(section?.getAttribute("aria-label")).toBe("Search and filter offers");
    expect(section?.hasAttribute("data-slot")).toBe(false);
    expect(swapped()).toBeNull();
    expect(loads.count).toBe(0);
  });

  it("never loads ui-sdk when only navigator.modelContext exists", async () => {
    stub(navigator);
    render(<Harness />);
    await settle();
    expect(swapped()).toBeNull();
    expect(loads.count).toBe(0);
  });

  it("swaps in the primitive with document.modelContext, keeping focus and caret", async () => {
    stub(document);
    render(<Harness />);
    const before = document.getElementById("ft-search") as HTMLInputElement;
    before.focus();
    fireEvent.change(before, { target: { value: "claude" } });
    before.setSelectionRange(2, 4);

    await waitFor(() => expect(swapped()).not.toBeNull());
    expect(loads.count).toBe(1);
    const after = document.getElementById("ft-search") as HTMLInputElement;
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe("claude");
    expect([after.selectionStart, after.selectionEnd]).toEqual([2, 4]);
  });
});
