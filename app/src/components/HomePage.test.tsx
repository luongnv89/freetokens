import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import HomePage from "./HomePage";
import { hottestSlugs } from "../lib/offerStats";
import {
  SEARCH_DEBOUNCE_MS,
  bindAnalyticsListeners,
  configureAnalytics,
  grantConsent,
  resetAnalyticsForTests,
} from "../lib/analytics";
import { DISMISSED_KEY, PREFS_KEY, SAVED_KEY } from "../lib/personalState";
import { PAGE_SIZE } from "../lib/pagination";
import type { Offer, OffersIndex } from "../lib/offers";

const MID = "G-TESTID12345";
const SITE = "https://luongnv89.goatcounter.com";
const SECRET_QUERY = "secret-query-xyz";

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    slug: "example-offer",
    title: "Example Offer",
    provider: "Example Co",
    category: "coding",
    amount: "$10 credits",
    expiry_date: null,
    source_url: "https://example.com/offer",
    verified_date: "2026-08-01",
    verification: "social_proof",
    review_status: "unverified",
    signup: "none",
    status: "active",
    ...overrides,
  };
}

const fixtureOffers: Offer[] = [
  offer({
    slug: "alpha-copilot",
    title: "Alpha Copilot",
    provider: "GitHub",
    category: "coding",
    amount: "$10 credits",
    expiry_date: "2026-09-01",
    verified_date: "2026-01-01",
    verification: "social_proof",
    signup: "required",
  }),
  offer({
    slug: "alpha-image",
    title: "Alpha Image",
    provider: "Acme",
    category: "image",
    amount: "$30 credits",
    expiry_date: "2026-12-01",
    verified_date: "2026-06-01",
    verification: "social_proof",
    signup: "required",
  }),
  offer({
    slug: "alpha-social",
    title: "Alpha Social",
    provider: "GitHub",
    category: "coding",
    amount: "$5 credits",
    expiry_date: "2026-10-01",
    verified_date: "2026-03-01",
    verification: "unverified",
    signup: "required",
  }),
  offer({
    slug: "alpha-free",
    title: "Alpha Free",
    provider: "GitHub",
    category: "coding",
    amount: "$8 credits",
    expiry_date: "2026-11-01",
    verified_date: "2026-04-01",
    verification: "social_proof",
    signup: "none",
  }),
  offer({
    slug: "beta-copilot",
    title: "Beta Copilot",
    provider: "GitHub",
    category: "coding",
    amount: "$50 credits",
    expiry_date: null,
    verified_date: "2026-08-01",
    verification: "social_proof",
    signup: "required",
  }),
];

const index: OffersIndex = {
  generated_at: "2026-08-24T00:00:00Z",
  count: fixtureOffers.length,
  active_count: fixtureOffers.length,
  expired_count: 0,
  offers: fixtureOffers,
};

function installGtag() {
  const gtag = vi.fn();
  Object.defineProperty(window, "gtag", {
    value: gtag,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "dataLayer", {
    value: [],
    configurable: true,
    writable: true,
  });
  return gtag;
}

function eventCalls(gtag: ReturnType<typeof vi.fn>, name: string) {
  return gtag.mock.calls.filter((c) => c[0] === "event" && c[1] === name);
}

function grantedGtag() {
  configureAnalytics({ measurementId: MID });
  const gtag = installGtag();
  grantConsent();
  gtag.mockClear();
  return gtag;
}

function setSearch(search: string) {
  const next = search
    ? `${window.location.pathname}${search.startsWith("?") ? search : `?${search}`}`
    : window.location.pathname;
  window.history.replaceState({}, "", next);
}

function listedSlugs() {
  return [...document.querySelectorAll("#ft-grid article[id^='offer-']")].map(
    (el) => el.id.replace(/^offer-/, ""),
  );
}

function categoryChip(value: string) {
  return document.querySelector(
    `[data-ft-category="${value}"]`,
  ) as HTMLButtonElement;
}

function tagOn(slug: string, dimension: string) {
  return document.querySelector(
    `#offer-${slug} [data-ft-tag="${dimension}"]`,
  ) as HTMLButtonElement;
}

function statusText() {
  return document.getElementById("ft-results-status")?.textContent ?? "";
}

beforeEach(() => {
  resetAnalyticsForTests();
  setSearch("");
  // Personal state (saved/dismissed/prefs) must not leak between tests:
  // HomePage restores stored prefs on mount, so leftover keys would
  // reorder or filter later tests' fixture lists. Optional chaining
  // keeps this a no-op under jsdom builds where storage is absent.
  window.localStorage?.clear();
});

afterEach(() => {
  resetAnalyticsForTests();
  setSearch("");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HomePage masthead counters (#49 port)", () => {
  it("surfaces the primary heading and live counts in the masthead", () => {
    render(<HomePage index={index} />);
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Free AI Credits",
    });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(heading.closest(".site-header")).not.toBeNull();
    expect(heading).toHaveClass("site-wordmark");

    // The slogan and its supporting sentence are gone; the build-derived
    // proof line is what states how the list is maintained.
    expect(screen.queryByText(/One person opens every provider/)).toBeNull();
    expect(document.querySelector(".site-slogan")).toBeNull();
    expect(document.querySelector(".site-sub")).toBeNull();
    expect(screen.getByText(/live offers/)).toBeInTheDocument();
  });
});

describe("HomePage search a11y", () => {
  it("labels the search input and keeps it keyboard-focusable", () => {
    render(<HomePage index={index} />);
    const input = screen.getByLabelText("Search");
    expect(input).toHaveAttribute("id", "ft-search");
    expect(input).toHaveAttribute("maxLength", "200");
    expect(input).not.toHaveAttribute("tabIndex", "-1");
    (input as HTMLInputElement).focus();
    expect(document.activeElement).toBe(input);
  });
});

describe("HomePage debounce and URL commit", () => {
  it("does not commit until SEARCH_DEBOUNCE_MS (120), then commits", () => {
    vi.useFakeTimers();
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "alpha" },
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(window.location.search).not.toContain("q=alpha");
    expect(eventCalls(gtag, "search")).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(new URLSearchParams(window.location.search).get("q")).toBe("alpha");
    expect(eventCalls(gtag, "search")).toHaveLength(1);
  });

  it("keeps filter params when q changes and never sends the raw query", () => {
    vi.useFakeTimers();
    setSearch(
      "?category=coding&verification=social_proof&signup=required&sort=expiring",
    );
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    expect(listedSlugs()).toEqual(["alpha-copilot", "beta-copilot"]);
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: SECRET_QUERY },
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("q")).toBe(SECRET_QUERY);
    expect(params.get("category")).toBe("coding");
    expect(params.get("verification")).toBe("social_proof");
    expect(params.get("signup")).toBe("required");
    expect(params.get("sort")).toBe("expiring");
    const searchEvents = eventCalls(gtag, "search");
    expect(searchEvents).toHaveLength(1);
    const payload = searchEvents[0][2] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["query_length"]);
    expect(payload).toEqual({ query_length: SECRET_QUERY.length });
    expect(JSON.stringify(gtag.mock.calls)).not.toContain(SECRET_QUERY);
    expect(JSON.stringify(payload)).not.toMatch(/q=|query[^_]|search_term/i);
  });
});

describe("HomePage sort_use", () => {
  it("fires exactly one sort_use per actual change; empty maps to default", () => {
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    const select = screen.getByLabelText("Sort");
    fireEvent.change(select, { target: { value: "expiring" } });
    expect(eventCalls(gtag, "sort_use")).toHaveLength(1);
    expect(eventCalls(gtag, "sort_use")[0][2]).toEqual({
      sort_option: "expiring",
    });
    expect(listedSlugs()[listedSlugs().length - 1]).toBe("beta-copilot");
    fireEvent.change(select, { target: { value: "expiring" } });
    expect(eventCalls(gtag, "sort_use")).toHaveLength(1);
    fireEvent.change(select, { target: { value: "" } });
    expect(eventCalls(gtag, "sort_use")).toHaveLength(2);
    expect(eventCalls(gtag, "sort_use")[1][2]).toEqual({
      sort_option: "default",
    });
  });
});

describe("HomePage clear and reset filters", () => {
  it("clears q and filters, keeps sort, focuses search, and fires filter_use not search/sort_use", () => {
    vi.useFakeTimers();
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "expiring" },
    });
    expect(eventCalls(gtag, "sort_use")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "nomatch-xyz" },
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(listedSlugs()).toEqual([]);
    expect(eventCalls(gtag, "search")).toHaveLength(1);
    gtag.mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: "Clear search & filters" }),
    );

    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-social",
      "alpha-free",
      "alpha-image",
      "beta-copilot",
    ]);
    expect(screen.getByLabelText("Search")).toHaveValue("");
    expect(screen.getByLabelText("Sort")).toHaveValue("expiring");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("q")).toBeNull();
    expect(params.get("sort")).toBe("expiring");
    expect(document.activeElement).toBe(screen.getByLabelText("Search"));
    expect(eventCalls(gtag, "search")).toHaveLength(0);
    expect(eventCalls(gtag, "sort_use")).toHaveLength(0);
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1);
    expect(eventCalls(gtag, "filter_use")[0][2]).toEqual({
      category: "all",
      verification: "all",
      signup: "all",
    });
  });
});

describe("HomePage deep link and popstate", () => {
  it("applies q+sort AND filters from the URL without search or sort_use on load", () => {
    setSearch(
      "?q=alpha&sort=expiring&category=coding&verification=social_proof&signup=required",
    );
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    expect(listedSlugs()).toEqual(["alpha-copilot"]);
    expect(screen.getByLabelText("Search")).toHaveValue("alpha");
    expect(screen.getByLabelText("Sort")).toHaveValue("expiring");
    expect(document.getElementById("ft-results-status")?.textContent).toBe(
      `Showing 1 of ${fixtureOffers.length} offers · Coding · corroborated · sign-up required`,
    );
    expect(eventCalls(gtag, "search")).toHaveLength(0);
    expect(eventCalls(gtag, "sort_use")).toHaveLength(0);
  });

  it("restores q/sort on popstate without new events", () => {
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "newest" },
    });
    expect(eventCalls(gtag, "sort_use")).toHaveLength(1);
    gtag.mockClear();
    act(() => {
      window.history.replaceState({}, "", "?q=alpha&sort=expiring");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-social",
      "alpha-free",
      "alpha-image",
    ]);
    expect(screen.getByLabelText("Search")).toHaveValue("alpha");
    expect(screen.getByLabelText("Sort")).toHaveValue("expiring");
    expect(eventCalls(gtag, "search")).toHaveLength(0);
    expect(eventCalls(gtag, "sort_use")).toHaveLength(0);
  });

  it("degrades a legacy ?sort=amount deep link to the default order (#508)", () => {
    setSearch("?sort=amount");
    render(<HomePage index={index} />);
    // No cross-unit cash ranking: the retired mode falls back to index order
    // and the control reflects the real, supported sort.
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-image",
      "alpha-social",
      "alpha-free",
      "beta-copilot",
    ]);
    expect(screen.getByLabelText("Sort")).toHaveValue("");
  });
});

describe("HomePage three-dimension filters (#126)", () => {
  it("offers an OSS program chip alongside Startup programs and Student", () => {
    render(<HomePage index={index} />);
    const chips = [...document.querySelectorAll("[data-ft-category]")].map(
      (el) => el.getAttribute("data-ft-category"),
    );
    expect(chips.slice(-3)).toEqual([
      "startup_program",
      "student",
      "oss_program",
    ]);
    const oss = categoryChip("oss_program");
    expect(oss).not.toBeNull();
    expect(oss.textContent).toContain("OSS program");
    expect(oss).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(oss);
    expect(new URLSearchParams(window.location.search).get("category")).toBe(
      "oss_program",
    );
    expect(categoryChip("oss_program")).toHaveAttribute("aria-pressed", "true");
    expect(listedSlugs()).toEqual([]);
  });

  it("chip click SETs category, does not toggle, and fires filter_use once per click", () => {
    const gtag = grantedGtag();
    const pushSpy = vi.spyOn(window.history, "pushState");
    render(<HomePage index={index} />);

    fireEvent.click(categoryChip("coding"));
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-social",
      "alpha-free",
      "beta-copilot",
    ]);
    expect(new URLSearchParams(window.location.search).get("category")).toBe(
      "coding",
    );
    expect(categoryChip("coding")).toHaveAttribute("aria-pressed", "true");
    expect(categoryChip("")).toHaveAttribute("aria-pressed", "false");
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1);
    expect(eventCalls(gtag, "filter_use")[0][2]).toEqual({
      category: "coding",
      verification: "all",
      signup: "all",
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(categoryChip("coding"));
    expect(new URLSearchParams(window.location.search).get("category")).toBe(
      "coding",
    );
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-social",
      "alpha-free",
      "beta-copilot",
    ]);
    expect(eventCalls(gtag, "filter_use")).toHaveLength(2);
    expect(pushSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(categoryChip("image"));
    expect(listedSlugs()).toEqual(["alpha-image"]);
    expect(new URLSearchParams(window.location.search).get("category")).toBe(
      "image",
    );
    expect(categoryChip("image")).toHaveAttribute("aria-pressed", "true");
    expect(categoryChip("coding")).toHaveAttribute("aria-pressed", "false");
    expect(eventCalls(gtag, "filter_use")).toHaveLength(3);
    expect(eventCalls(gtag, "filter_use")[2][2]).toEqual({
      category: "image",
      verification: "all",
      signup: "all",
    });

    fireEvent.click(categoryChip(""));
    expect(listedSlugs()).toHaveLength(fixtureOffers.length);
    expect(
      new URLSearchParams(window.location.search).get("category"),
    ).toBeNull();
    expect(categoryChip("")).toHaveAttribute("aria-pressed", "true");
    expect(eventCalls(gtag, "filter_use")[3][2]).toEqual({
      category: "all",
      verification: "all",
      signup: "all",
    });
  });

  it("chip Enter SETs category and sets aria-pressed true (#254)", () => {
    render(<HomePage index={index} />);
    const chip = categoryChip("coding");
    chip.focus();
    fireEvent.keyDown(chip, { key: "Enter" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(new URLSearchParams(window.location.search).get("category")).toBe(
      "coding",
    );
    expect(categoryChip("")).toHaveAttribute("aria-pressed", "false");
  });

  it("row tag click applies that dimension and clicking again clears it", () => {
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    fireEvent.click(tagOn("alpha-social", "verification"));
    expect(listedSlugs()).toEqual(["alpha-social"]);
    expect(window.location.search).toBe("?verification=unverified");
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1);

    fireEvent.click(tagOn("alpha-social", "verification"));
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-image",
      "alpha-social",
      "alpha-free",
      "beta-copilot",
    ]);
    expect(window.location.search).toBe("");
    expect(eventCalls(gtag, "filter_use")).toHaveLength(2);
  });

  it("aria-pressed syncs across every row showing the applied value", () => {
    render(<HomePage index={index} />);
    fireEvent.click(tagOn("alpha-social", "verification"));
    expect(tagOn("alpha-social", "verification")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(tagOn("alpha-copilot", "verification")).toBeNull();
    expect(tagOn("alpha-image", "verification")).toBeNull();
    expect(tagOn("alpha-free", "verification")).toBeNull();
    expect(tagOn("alpha-social", "signup")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("chips, tags, and search AND-combine and stay shareable", () => {
    vi.useFakeTimers();
    render(<HomePage index={index} />);
    fireEvent.click(tagOn("alpha-social", "verification"));
    fireEvent.click(tagOn("alpha-social", "signup"));
    fireEvent.click(categoryChip("coding"));
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "social" },
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(listedSlugs()).toEqual(["alpha-social"]);
    const params = new URLSearchParams(window.location.search);
    expect(params.get("verification")).toBe("unverified");
    expect(params.get("signup")).toBe("required");
    expect(params.get("category")).toBe("coding");
    expect(params.get("q")).toBe("social");
    expect(statusText()).toBe(
      `Showing 1 of ${fixtureOffers.length} offers · Coding · community-sourced · sign-up required`,
    );
  });

  it("status pills name active filters and dropping one leaves the others", () => {
    render(<HomePage index={index} />);
    fireEvent.click(tagOn("alpha-social", "verification"));
    fireEvent.click(tagOn("alpha-social", "signup"));
    expect(listedSlugs()).toEqual(["alpha-social"]);
    expect(statusText()).toBe(
      `Showing 1 of ${fixtureOffers.length} offers · community-sourced · sign-up required`,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove sign-up required filter" }),
    );
    expect(listedSlugs()).toEqual(["alpha-social"]);
    expect(window.location.search).toBe("?verification=unverified");
    expect(statusText()).toBe(
      `Showing 1 of ${fixtureOffers.length} offers · community-sourced`,
    );
  });

  it("removing a pill focuses the next pill, then search when none remain", () => {
    render(<HomePage index={index} />);
    fireEvent.click(tagOn("alpha-social", "verification"));
    fireEvent.click(tagOn("alpha-social", "signup"));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove community-sourced filter" }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove sign-up required filter" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove sign-up required filter" }),
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Search"));
  });

  it("filtering does not reorder remaining rows", () => {
    render(<HomePage index={index} />);
    const before = listedSlugs();
    expect(before).toEqual([
      "alpha-copilot",
      "alpha-image",
      "alpha-social",
      "alpha-free",
      "beta-copilot",
    ]);
    fireEvent.click(categoryChip("coding"));
    expect(listedSlugs()).toEqual(
      before.filter((slug) => slug !== "alpha-image"),
    );
  });

  it("keeps keyboard focus on the row tag that applied the filter", () => {
    render(<HomePage index={index} />);
    const tag = tagOn("alpha-social", "verification");
    tag.focus();
    expect(document.activeElement).toBe(tag);
    fireEvent.click(tag);
    expect(document.activeElement).toBe(tagOn("alpha-social", "verification"));
    expect(tagOn("alpha-social", "verification")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("empty result set from filters shows a working reset that focuses search", () => {
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    fireEvent.click(categoryChip("video"));
    expect(listedSlugs()).toEqual([]);
    expect(document.getElementById("ft-no-results")?.hidden).toBe(false);
    expect(statusText()).toBe(
      `Showing 0 of ${fixtureOffers.length} offers · Video`,
    );
    gtag.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear search & filters" }),
    );
    expect(listedSlugs()).toHaveLength(fixtureOffers.length);
    expect(document.getElementById("ft-no-results")?.hidden).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("Search"));
    expect(window.location.search).toBe("");
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1);
  });

  it("All chip SETs category empty without clearing other dimensions", () => {
    render(<HomePage index={index} />);
    fireEvent.click(tagOn("alpha-social", "verification"));
    fireEvent.click(categoryChip("coding"));
    expect(new URLSearchParams(window.location.search).get("category")).toBe(
      "coding",
    );
    fireEvent.click(categoryChip(""));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("category")).toBeNull();
    expect(params.get("verification")).toBe("unverified");
    expect(listedSlugs()).toEqual(["alpha-social"]);
  });

  it("Clear all filters removes every filter and names them in the status line first", () => {
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    fireEvent.click(categoryChip("coding"));
    fireEvent.click(tagOn("alpha-free", "signup"));
    expect(statusText()).toContain("Coding");
    expect(statusText()).toContain("no sign-up");
    expect(
      screen.getByRole("button", { name: "Clear all filters" }),
    ).not.toHaveAttribute("hidden");
    gtag.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(listedSlugs()).toHaveLength(fixtureOffers.length);
    expect(statusText()).toBe(`Showing all ${fixtureOffers.length} offers`);
    expect(window.location.search).toBe("");
    expect(document.activeElement).toBe(screen.getByLabelText("Search"));
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1);
    expect(eventCalls(gtag, "filter_use")[0][2]).toEqual({
      category: "all",
      verification: "all",
      signup: "all",
    });
  });

  it("bindAnalyticsListeners does not double-fire filter_use on chip click", () => {
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    bindAnalyticsListeners();
    fireEvent.click(categoryChip("image"));
    expect(eventCalls(gtag, "filter_use")).toHaveLength(1);
    expect(eventCalls(gtag, "filter_use")[0][2]).toEqual({
      category: "image",
      verification: "all",
      signup: "all",
    });
  });
});

describe("HomePage saved and dismissed personal state (#140)", () => {
  let store: Record<string, string>;

  function installPersonalStorage() {
    store = {};
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => {
          store[key] = String(value);
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          for (const k of Object.keys(store)) delete store[k];
        },
      },
      configurable: true,
      writable: true,
    });
  }

  function stored(key: string) {
    return key in store ? JSON.parse(store[key]) : null;
  }

  beforeEach(() => {
    installPersonalStorage();
  });

  function saveButton(slug: string) {
    return document.querySelector(
      `[data-ft-save="${slug}"]`,
    ) as HTMLButtonElement;
  }

  function dismissButton(slug: string) {
    return document.querySelector(
      `[data-ft-dismiss="${slug}"]`,
    ) as HTMLButtonElement;
  }

  function savedToggle() {
    return document.querySelector(
      "[data-ft-saved-toggle]",
    ) as HTMLButtonElement;
  }

  it("saving persists to localStorage and survives a remount (reload/routes)", () => {
    const { unmount } = render(<HomePage index={index} />);
    fireEvent.click(saveButton("alpha-copilot"));
    expect(saveButton("alpha-copilot").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(stored(SAVED_KEY)).toEqual({ v: 1, slugs: ["alpha-copilot"] });
    unmount();

    render(<HomePage index={index} />);
    expect(saveButton("alpha-copilot").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(saveButton("alpha-image").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("saved-only view lists exactly the saved offers, even with filters active", () => {
    store[SAVED_KEY] = JSON.stringify({
      v: 1,
      slugs: ["alpha-social", "beta-copilot"],
    });
    setSearch("?category=image");
    render(<HomePage index={index} />);
    fireEvent.click(savedToggle());
    expect(listedSlugs()).toEqual(["alpha-social", "beta-copilot"]);
    expect(savedToggle().getAttribute("aria-pressed")).toBe("true");
    // Toggling back restores the default (filtered) list.
    fireEvent.click(savedToggle());
    expect(listedSlugs()).toEqual(["alpha-image"]);
  });

  it("dismissed offers vanish from the default list; count shows and one click restores all", () => {
    const { unmount } = render(<HomePage index={index} />);
    act(() => {
      dismissButton("alpha-copilot").click();
      dismissButton("alpha-free").click();
    });
    expect(stored(DISMISSED_KEY).slugs).toContain("alpha-copilot");
    expect(listedSlugs()).not.toContain("alpha-copilot");
    expect(listedSlugs()).not.toContain("alpha-free");
    expect(statusText()).toContain("2 hidden — restore");

    const restore = document.querySelector(
      "[data-ft-restore-dismissed]",
    ) as HTMLButtonElement;
    expect(restore.getAttribute("aria-label")).toBe("Restore 2 hidden offers");
    fireEvent.click(restore);
    expect(listedSlugs()).toHaveLength(fixtureOffers.length);
    expect(store[DISMISSED_KEY]).toBeUndefined();

    // Remount keeps the restored state.
    unmount();
    render(<HomePage index={index} />);
    expect(listedSlugs()).toHaveLength(fixtureOffers.length);
  });

  it("dismissing an offer removes it from the saved shortlist until restored", () => {
    store[SAVED_KEY] = JSON.stringify({ v: 1, slugs: ["alpha-copilot"] });
    render(<HomePage index={index} />);
    fireEvent.click(dismissButton("alpha-copilot"));
    expect(stored(SAVED_KEY).slugs).toEqual([]);
    expect(listedSlugs()).not.toContain("alpha-copilot");

    fireEvent.click(
      document.querySelector(
        "[data-ft-restore-dismissed]",
      ) as HTMLButtonElement,
    );
    expect(listedSlugs()).toContain("alpha-copilot");
    expect(saveButton("alpha-copilot").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(saveButton("alpha-copilot").textContent).toBe("Save");
  });

  it("personal actions never leak into the URL or analytics events", () => {
    const gtag = grantedGtag();
    render(<HomePage index={index} />);
    fireEvent.click(saveButton("alpha-copilot"));
    fireEvent.click(dismissButton("alpha-image"));
    fireEvent.click(savedToggle());
    expect(window.location.search).toBe("");
    const eventNames = gtag.mock.calls
      .filter((c) => c[0] === "event")
      .map((c) => c[1]);
    expect(eventNames).not.toContain("save_offer");
    expect(eventNames).not.toContain("dismiss_offer");
    expect(eventNames.filter((n) => n !== "page_view")).toEqual([]);
  });

  it("restores last-used filter/sort prefs on reload with an empty URL", () => {
    store[PREFS_KEY] = JSON.stringify({
      v: 1,
      category: "image",
      verification: "",
      signup: "",
      sort: "expiring",
    });
    render(<HomePage index={index} />);
    expect(categoryChip("image").getAttribute("aria-pressed")).toBe("true");
    expect(listedSlugs()[0]).toBe("alpha-image");
    // URL may reflect only filter/search/sort — never saved/dismissed flags.
    expect(window.location.search).toContain("category=image");
    expect(window.location.search).not.toContain("saved");
    expect(window.location.search).not.toContain("dismissed");
  });

  it("a URL with explicit state always wins over stored prefs", () => {
    store[PREFS_KEY] = JSON.stringify({
      v: 1,
      category: "image",
      verification: "",
      signup: "",
      sort: "",
    });
    setSearch("?category=coding");
    render(<HomePage index={index} />);
    expect(categoryChip("coding").getAttribute("aria-pressed")).toBe("true");
    expect(categoryChip("image").getAttribute("aria-pressed")).toBe("false");
  });

  it("invalid stored pref values degrade to defaults instead of applying", () => {
    store[PREFS_KEY] = JSON.stringify({
      v: 1,
      category: "not-a-category",
      sort: "bogus",
    });
    render(<HomePage index={index} />);
    expect(categoryChip("not-a-category")).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("a stored legacy amount sort degrades to the default order (#508)", () => {
    store[PREFS_KEY] = JSON.stringify({
      v: 1,
      category: "",
      verification: "",
      signup: "",
      sort: "amount",
    });
    render(<HomePage index={index} />);
    expect(screen.getByLabelText("Sort")).toHaveValue("");
    expect(listedSlugs()).toEqual([
      "alpha-copilot",
      "alpha-image",
      "alpha-social",
      "alpha-free",
      "beta-copilot",
    ]);
    expect(window.location.search).not.toContain("sort=");
  });

  it("clearing browser storage returns the site to its default state with no error", () => {
    store[SAVED_KEY] = JSON.stringify({ v: 1, slugs: ["alpha-copilot"] });
    store[DISMISSED_KEY] = JSON.stringify({ v: 1, slugs: ["alpha-image"] });
    const { unmount } = render(<HomePage index={index} />);
    expect(listedSlugs()).toHaveLength(fixtureOffers.length - 1);

    window.localStorage.clear();
    unmount();
    render(<HomePage index={index} />);
    expect(() => listedSlugs()).not.toThrow();
    expect(listedSlugs()).toHaveLength(fixtureOffers.length);
    expect(savedToggle().textContent).toContain("Saved (0)");
  });

  it("save/dismiss controls are real keyboard-operable buttons with announced state", () => {
    render(<HomePage index={index} />);
    const save = saveButton("beta-copilot");
    save.focus();
    expect(document.activeElement).toBe(save);
    fireEvent.click(save); // keyboard activation of a button fires click
    expect(save.getAttribute("aria-pressed")).toBe("true");
    expect(save.getAttribute("aria-label")).toBe(
      "Remove Beta Copilot from saved",
    );
    const dismiss = dismissButton("beta-copilot");
    expect(dismiss.tagName).toBe("BUTTON");
    expect(dismiss.getAttribute("aria-label")).toBe(
      "Hide Beta Copilot from the list",
    );
    expect(
      document.getElementById("ft-results-status")?.getAttribute("role"),
    ).toBe("status");
  });
});

describe("HomePage per-offer live view counts (#101)", () => {
  function counterResponse(count: unknown, ok = true) {
    return {
      ok,
      json: async () => ({ count }),
    } as unknown as Response;
  }

  function statText(el: Element | null) {
    return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches counts live from GoatCounter and shows them per row", async () => {
    configureAnalytics({ statsSite: SITE });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        calls.push(String(url));
        if (String(url).includes("alpha-copilot"))
          return counterResponse("1,234");
        return counterResponse("8");
      }),
    );
    render(<HomePage index={index} />);
    await waitFor(() => {
      expect(
        statText(document.querySelector("#offer-alpha-copilot .r-views")),
      ).toBe("1,234 views");
    });
    expect(
      statText(document.querySelector("#offer-alpha-image .r-views")),
    ).toBe("8 views");
    expect(calls[0]).toBe(
      `${SITE}/counter/%2Foffers%2Falpha-copilot.html.json`,
    );
    expect(
      calls.every((u) => u.startsWith(`${SITE}/counter/%2Foffers%2F`)),
    ).toBe(true);
  });

  it("hides the count for an offer whose counter request fails", async () => {
    configureAnalytics({ statsSite: SITE });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes("beta-copilot")
          ? Promise.reject(new Error("network blocked"))
          : counterResponse("12"),
      ),
    );
    render(<HomePage index={index} />);
    await waitFor(() => {
      expect(
        statText(document.querySelector("#offer-alpha-free .r-views")),
      ).toBe("12 views");
    });
    expect(document.querySelector("#offer-beta-copilot .r-views")).toBeNull();
  });

  it("shows no counts at all when GoatCounter is unconfigured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<HomePage index={index} />);
    await act(async () => {});
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".r-views")).toBeNull();
  });

  it("keeps the count textually announced with its unit", async () => {
    configureAnalytics({ statsSite: SITE });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => counterResponse("42")),
    );
    render(<HomePage index={index} />);
    await waitFor(() => {
      expect(screen.getAllByText(/^views$/).length).toBeGreaterThan(0);
    });
    const el = document.querySelector("#offer-alpha-copilot .r-views");
    expect(statText(el)).toMatch(/^\d[\d,]* views$/);
  });

  it("renders list visit counts as a highlighted number-first chip (#250)", async () => {
    configureAnalytics({ statsSite: SITE });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes("alpha-copilot")
          ? counterResponse("1,234")
          : counterResponse("8"),
      ),
    );
    render(<HomePage index={index} />);
    await waitFor(() => {
      expect(
        document.querySelector("#offer-alpha-copilot .r-views"),
      ).not.toBeNull();
    });
    const el = document.querySelector("#offer-alpha-copilot .r-views");
    expect(el?.classList.contains("ft-stat")).toBe(true);
    expect(el?.querySelector("strong")?.textContent).toBe("1,234");
    expect(el?.querySelector(".ft-stat-label")?.textContent).toBe("views");
    expect(el?.closest(".row-rail")).not.toBeNull();
    expect(el?.closest(".row-meta")).toBeNull();
  });
});

describe("HomePage hot-today badge (#282)", () => {
  function counterResponse(count: unknown, ok = true) {
    return {
      ok,
      json: async () => ({ count }),
    } as unknown as Response;
  }

  // GoatCounter is asked twice per slug: once unwindowed (the "N views" chip)
  // and once with ?start=/&end= (today, the hot ranking). The stub answers each
  // from its own table so a test can prove which map decides the badge.
  function stubCounters(
    today: Record<string, number | null>,
    // Defaults to the same table so a test that only cares about the ranking
    // still renders the "N views" chip it waits on.
    allTime: Record<string, number | null> = today,
  ) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const href = String(url);
        const slug =
          decodeURIComponent(href).match(/\/offers\/([^.]+)\.html/)?.[1] ?? "";
        const table = href.includes("start=") ? today : allTime;
        const value = table[slug];
        if (typeof value !== "number") throw new Error("no count");
        return counterResponse(String(value));
      }),
    );
  }

  function hotSlugs() {
    return [...document.querySelectorAll("#ft-grid .badge-hot")].map(
      (el) => el.closest("article")?.id.replace(/^offer-/, "") ?? "",
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("badges the offer with the most views today, not the all-time leader", async () => {
    configureAnalytics({ statsSite: SITE });
    stubCounters(
      { "alpha-copilot": 4, "alpha-image": 40, "alpha-social": 1 },
      { "alpha-copilot": 9000, "alpha-image": 3, "alpha-social": 12 },
    );
    render(<HomePage index={index} />);
    await waitFor(() => {
      expect(document.querySelector(".badge-hot")).not.toBeNull();
    });
    expect(hotSlugs()).toEqual(["alpha-image"]);
    expect(screen.getAllByText("Hot today")).toHaveLength(1);
  });

  it("badges nothing when every windowed counter is blocked or unconfigured", async () => {
    configureAnalytics({ statsSite: SITE });
    stubCounters({}, { "alpha-copilot": 500 });
    render(<HomePage index={index} />);
    await waitFor(() => {
      expect(
        document.querySelector("#offer-alpha-copilot .r-views"),
      ).not.toBeNull();
    });
    await act(async () => {});
    expect(hotSlugs()).toEqual([]);
  });

  it("holds a floor: two views today is not hot", async () => {
    configureAnalytics({ statsSite: SITE });
    stubCounters({ "alpha-copilot": 2, "alpha-image": 1 });
    render(<HomePage index={index} />);
    await waitFor(() => {
      expect(
        document.querySelector("#offer-alpha-copilot .r-views"),
      ).not.toBeNull();
    });
    await act(async () => {});
    expect(hotSlugs()).toEqual([]);
  });

  it("badges every offer in a narrow tie at the top", async () => {
    configureAnalytics({ statsSite: SITE });
    stubCounters({ "alpha-copilot": 7, "alpha-image": 7, "alpha-social": 2 });
    render(<HomePage index={index} />);
    await waitFor(() => {
      expect(document.querySelectorAll(".badge-hot").length).toBe(2);
    });
    expect(hotSlugs().sort()).toEqual(["alpha-copilot", "alpha-image"]);
  });

  it("suppresses the badge when the tie is wide enough to stop meaning anything", async () => {
    configureAnalytics({ statsSite: SITE });
    stubCounters({
      "alpha-copilot": 7,
      "alpha-image": 7,
      "alpha-social": 7,
      "alpha-free": 7,
    });
    render(<HomePage index={index} />);
    await waitFor(() => {
      expect(
        document.querySelector("#offer-alpha-copilot .r-views"),
      ).not.toBeNull();
    });
    await act(async () => {});
    expect(hotSlugs()).toEqual([]);
  });

  it("ranks over the whole catalogue, so filtering never crowns a different offer", async () => {
    configureAnalytics({ statsSite: SITE });
    stubCounters({ "alpha-copilot": 4, "alpha-image": 40 });
    render(<HomePage index={index} />);
    await waitFor(() => {
      expect(hotSlugs()).toEqual(["alpha-image"]);
    });
    // "coding" excludes alpha-image, the hot offer — no survivor is promoted.
    fireEvent.click(categoryChip("coding"));
    await waitFor(() => {
      expect(listedSlugs()).not.toContain("alpha-image");
    });
    expect(hotSlugs()).toEqual([]);
  });
});

describe("hottestSlugs ranking boundaries (#282)", () => {
  it("crowns a count sitting exactly on the minimum floor", () => {
    // The floor is >=, not >: 3 views is hot, 2 is not. Pins the boundary an
    // off-by-one would otherwise slide past.
    expect([...hottestSlugs({ a: 3, b: 1 })]).toEqual(["a"]);
    expect([...hottestSlugs({ a: 2, b: 1 })]).toEqual([]);
  });

  it("badges a tie sitting exactly on the width limit, and drops the one past it", () => {
    // Three tied offers still mean something; four stop meaning anything.
    expect([...hottestSlugs({ a: 5, b: 5, c: 5 })].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect([...hottestSlugs({ a: 5, b: 5, c: 5, d: 5 })]).toEqual([]);
  });

  it("ignores nulls and never treats a zero count as absent", () => {
    expect([...hottestSlugs({ a: 4, b: null })]).toEqual(["a"]);
    expect([...hottestSlugs({ a: 0, b: null })]).toEqual([]);
    expect([...hottestSlugs({})]).toEqual([]);
  });
});

describe("HomePage pagination (#548)", () => {
  // 45 offers so the default list spans three pages (20 + 20 + 5). Slugs
  // are zero-padded so index order reads as the row order; the last three
  // carry a second category so one filter yields fewer than a page.
  const pagedOffers: Offer[] = Array.from({ length: 45 }, (_, i) => {
    const n = i + 1;
    return offer({
      slug: `offer-${String(n).padStart(2, "0")}`,
      title: `Offer ${String(n).padStart(2, "0")}`,
      provider: "Paged Co",
      category: n > 42 ? "image" : "coding",
    });
  });
  const pagedIndex: OffersIndex = {
    generated_at: "2026-08-24T00:00:00Z",
    count: pagedOffers.length,
    active_count: pagedOffers.length,
    expired_count: 0,
    offers: pagedOffers,
  };
  const slugs = pagedOffers.map((o) => o.slug);

  function pager() {
    return document.getElementById("ft-pager");
  }

  function savedToggle() {
    return document.querySelector(
      "[data-ft-saved-toggle]",
    ) as HTMLButtonElement;
  }

  function dismissButton(slug: string) {
    return document.querySelector(
      `[data-ft-dismiss="${slug}"]`,
    ) as HTMLButtonElement;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the first page of rows plus a working pager", () => {
    render(<HomePage index={pagedIndex} />);
    expect(listedSlugs()).toEqual(slugs.slice(0, PAGE_SIZE));
    const nav = pager();
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Offer list pages");
    const current = nav?.querySelector('a[aria-current="page"]');
    expect(current?.textContent).toBe("1");
    // No previous page: the step keeps its box but is not a link.
    const prev = nav?.querySelector(".pager-prev");
    expect(prev?.tagName).toBe("SPAN");
    expect(nav?.querySelector("a.pager-prev")).toBeNull();
    const next = nav?.querySelector(".pager-next") as HTMLAnchorElement;
    expect(next.tagName).toBe("A");
    expect(next.getAttribute("href")).toBe("?page=2");
    expect(statusText()).toBe("Showing 1–20 of 45 offers");
  });

  it("navigates to page 2: rows, URL, status, focus — no events, no prefs write", () => {
    const gtag = grantedGtag();
    render(<HomePage index={pagedIndex} />);
    fireEvent.click(screen.getByRole("link", { name: "Page 2" }));
    expect(listedSlugs()).toEqual(slugs.slice(PAGE_SIZE, 2 * PAGE_SIZE));
    expect(window.location.search).toBe("?page=2");
    expect(statusText()).toBe("Showing 21–40 of 45 offers");
    expect(document.activeElement).toBe(document.getElementById("ft-grid"));
    expect(eventCalls(gtag, "search")).toHaveLength(0);
    expect(eventCalls(gtag, "sort_use")).toHaveLength(0);
    expect(eventCalls(gtag, "filter_use")).toHaveLength(0);
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull();
  });

  it("walks with Next and Previous steps", () => {
    render(<HomePage index={pagedIndex} />);
    fireEvent.click(screen.getByRole("link", { name: "Next" }));
    expect(window.location.search).toBe("?page=2");
    expect(listedSlugs()).toEqual(slugs.slice(PAGE_SIZE, 2 * PAGE_SIZE));
    fireEvent.click(screen.getByRole("link", { name: "Next" }));
    expect(window.location.search).toBe("?page=3");
    expect(listedSlugs()).toEqual(slugs.slice(2 * PAGE_SIZE));
    fireEvent.click(screen.getByRole("link", { name: "Previous" }));
    expect(window.location.search).toBe("?page=2");
    expect(listedSlugs()).toEqual(slugs.slice(PAGE_SIZE, 2 * PAGE_SIZE));
  });

  it("deep-links a page, keeping the last step inert there", () => {
    setSearch("?page=3");
    render(<HomePage index={pagedIndex} />);
    expect(listedSlugs()).toEqual(slugs.slice(2 * PAGE_SIZE));
    expect(statusText()).toBe("Showing 41–45 of 45 offers");
    const next = pager()?.querySelector(".pager-next");
    expect(next?.tagName).toBe("SPAN");
    expect(pager()?.querySelector("a.pager-next")).toBeNull();
  });

  it("clamps ?page=99 to the last page without rewriting the URL", () => {
    setSearch("?page=99");
    render(<HomePage index={pagedIndex} />);
    expect(listedSlugs()).toEqual(slugs.slice(2 * PAGE_SIZE));
    expect(window.location.search).toBe("?page=99");
  });

  it("treats ?page=abc as page 1", () => {
    setSearch("?page=abc");
    render(<HomePage index={pagedIndex} />);
    expect(listedSlugs()).toEqual(slugs.slice(0, PAGE_SIZE));
    expect(pager()?.querySelector('a[aria-current="page"]')?.textContent).toBe(
      "1",
    );
  });

  it("resets to page 1 on a category chip", () => {
    setSearch("?page=2");
    render(<HomePage index={pagedIndex} />);
    expect(listedSlugs()).toEqual(slugs.slice(PAGE_SIZE, 2 * PAGE_SIZE));
    fireEvent.click(categoryChip("image"));
    expect(listedSlugs()).toEqual(["offer-43", "offer-44", "offer-45"]);
    const params = new URLSearchParams(window.location.search);
    expect(params.get("page")).toBeNull();
    expect(params.get("category")).toBe("image");
  });

  it("resets to page 1 on a sort change", () => {
    setSearch("?page=2");
    render(<HomePage index={pagedIndex} />);
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "newest" },
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("page")).toBeNull();
    expect(params.get("sort")).toBe("newest");
    expect(listedSlugs()).toEqual(slugs.slice(0, PAGE_SIZE));
  });

  it("resets to page 1 on a committed search", () => {
    vi.useFakeTimers();
    setSearch("?page=2");
    render(<HomePage index={pagedIndex} />);
    expect(listedSlugs()).toEqual(slugs.slice(PAGE_SIZE, 2 * PAGE_SIZE));
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "offer" },
    });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("page")).toBeNull();
    expect(params.get("q")).toBe("offer");
    expect(listedSlugs()).toEqual(slugs.slice(0, PAGE_SIZE));
  });

  it("resets to page 1 on Clear all filters", () => {
    setSearch("?category=coding&page=2");
    render(<HomePage index={pagedIndex} />);
    expect(listedSlugs()).toEqual(slugs.slice(PAGE_SIZE, 2 * PAGE_SIZE));
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(window.location.search).toBe("");
    expect(listedSlugs()).toEqual(slugs.slice(0, PAGE_SIZE));
  });

  it("restores the page on popstate", () => {
    render(<HomePage index={pagedIndex} />);
    fireEvent.click(screen.getByRole("link", { name: "Page 2" }));
    expect(listedSlugs()).toEqual(slugs.slice(PAGE_SIZE, 2 * PAGE_SIZE));
    act(() => {
      window.history.replaceState({}, "", "?page=3");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(listedSlugs()).toEqual(slugs.slice(2 * PAGE_SIZE));
  });

  it("leaves modified clicks to the browser and intercepts plain ones", () => {
    render(<HomePage index={pagedIndex} />);
    const link = screen.getByRole("link", { name: "Page 2" });
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(listedSlugs()).toEqual(slugs.slice(0, PAGE_SIZE));
    expect(window.location.search).toBe("");
    expect(fireEvent.click(link)).toBe(false);
    expect(listedSlugs()).toEqual(slugs.slice(PAGE_SIZE, 2 * PAGE_SIZE));
    expect(window.location.search).toBe("?page=2");
  });

  it("clamps the saved-only view without touching the URL page", () => {
    window.localStorage.setItem(
      SAVED_KEY,
      JSON.stringify({ v: 1, slugs: ["offer-01", "offer-02"] }),
    );
    setSearch("?page=3");
    render(<HomePage index={pagedIndex} />);
    fireEvent.click(savedToggle());
    expect(listedSlugs()).toEqual(["offer-01", "offer-02"]);
    expect(pager()).toBeNull();
    expect(window.location.search).toBe("?page=3");
    fireEvent.click(savedToggle());
    expect(listedSlugs()).toEqual(slugs.slice(2 * PAGE_SIZE));
  });

  it("clamps to the new last page when its rows are all dismissed", () => {
    setSearch("?page=3");
    render(<HomePage index={pagedIndex} />);
    act(() => {
      for (const slug of slugs.slice(2 * PAGE_SIZE)) {
        dismissButton(slug).click();
      }
    });
    expect(listedSlugs()).toEqual(slugs.slice(PAGE_SIZE, 2 * PAGE_SIZE));
    expect(statusText()).toContain("Showing 21–40 of 40 offers");
    expect(statusText()).toContain("5 hidden — restore");
    expect(window.location.search).toBe("?page=3");
  });

  it("fetches all-time counts for the visible page only, today counts for the whole list", async () => {
    configureAnalytics({ statsSite: SITE });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        calls.push(String(url));
        return {
          ok: true,
          json: async () => ({ count: "5" }),
        } as unknown as Response;
      }),
    );
    const slugOf = (url: string) =>
      decodeURIComponent(url).match(/\/offers\/([^.]+)\.html/)?.[1] ?? "";
    const slugSet = (windowed: boolean) =>
      new Set(
        calls
          .filter((u) => u.includes("start=") === windowed)
          .map((u) => slugOf(u)),
      );
    render(<HomePage index={pagedIndex} />);
    await waitFor(() => {
      expect(slugSet(false)).toEqual(new Set(slugs.slice(0, PAGE_SIZE)));
    });
    expect(slugSet(true)).toEqual(new Set(slugs));
    fireEvent.click(screen.getByRole("link", { name: "Page 2" }));
    await waitFor(() => {
      expect(slugSet(false)).toEqual(new Set(slugs.slice(0, 2 * PAGE_SIZE)));
    });
    expect(slugSet(true)).toEqual(new Set(slugs));
  });

  it("renders no pager when the whole result fits one page", () => {
    render(<HomePage index={index} />);
    expect(pager()).toBeNull();
  });
});
