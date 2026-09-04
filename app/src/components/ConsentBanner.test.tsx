import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { ConsentBanner } from "./ConsentBanner";
import {
  configureAnalytics,
  resetAnalyticsForTests,
  showConsentBanner,
} from "../lib/analytics";
import { GA_CONSENT_KEY } from "../lib/personalState";

const MID = "G-ABCDEF12345";

function installLocalStorage() {
  const store: Record<string, string> = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
    },
  });
}

beforeEach(() => {
  installLocalStorage();
  resetAnalyticsForTests();
  configureAnalytics({ measurementId: MID });
});

afterEach(() => {
  resetAnalyticsForTests();
  vi.restoreAllMocks();
});

describe("ConsentBanner", () => {
  it("renders a hidden non-modal region, not a dialog", () => {
    const { container } = render(<ConsentBanner />);
    const banner = container.querySelector("#ft-consent-banner");
    expect(banner).not.toBeNull();
    expect(banner).toHaveAttribute("role", "region");
    expect(banner).toHaveAttribute("aria-label", "Analytics consent");
    expect(banner).toHaveAttribute("hidden");
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Allow", hidden: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Decline", hidden: true }),
    ).toBeInTheDocument();
  });

  it("becomes visible on showConsentBanner and Allow persists granted", () => {
    render(<ConsentBanner />);
    act(() => {
      showConsentBanner();
    });
    const banner = document.getElementById("ft-consent-banner");
    expect(banner?.hidden).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(window.localStorage.getItem(GA_CONSENT_KEY)).toBe("granted");
    expect(document.getElementById("ft-consent-banner")?.hidden).toBe(true);
  });

  it("Decline persists denied and Escape declines a visible banner", () => {
    render(<ConsentBanner />);
    act(() => {
      showConsentBanner();
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(window.localStorage.getItem(GA_CONSENT_KEY)).toBe("denied");
    expect(document.getElementById("ft-consent-banner")?.hidden).toBe(true);
  });

  it("renders nothing when no tracker is configured", () => {
    resetAnalyticsForTests();
    const { container } = render(<ConsentBanner />);
    expect(container.querySelector("#ft-consent-banner")).toBeNull();
  });
});
