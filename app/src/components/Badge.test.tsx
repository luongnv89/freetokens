import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HotBadge } from "./Badge";
import { resetAnalyticsForTests } from "../lib/analytics";

afterEach(() => {
  resetAnalyticsForTests();
  vi.restoreAllMocks();
});

describe("HotBadge (#282)", () => {
  it("spells the meaning out in words rather than leaning on colour", () => {
    render(<HotBadge />);
    const badge = screen.getByText("Hot today").closest("span.badge");
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains("badge-hot")).toBe(true);
  });

  it("explains the window in a title, saying today rather than 24 hours", () => {
    render(<HotBadge />);
    const title =
      screen
        .getByText("Hot today")
        .closest("span.badge")
        ?.getAttribute("title") ?? "";
    expect(title.length).toBeGreaterThan(0);
    expect(title).toMatch(/today/i);
    expect(title).not.toMatch(/24\s*h/i);
  });

  it("hides its decorative glyph from assistive tech and sizes it with the text", () => {
    const { container } = render(<HotBadge />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    expect(svg?.classList.contains("tag-i")).toBe(true);
  });
});
