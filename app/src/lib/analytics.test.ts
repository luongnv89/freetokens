import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_GRANTED_EVENT,
  FILTER_DIMENSIONS,
  GA_SCRIPT_ID,
  GC_SCRIPT_ID,
  OFFER_CLICK_DEDUPE_MS,
  TRAFFIC_STRIP_ID,
  bindAnalyticsListeners,
  buildFilterUseParams,
  buildOfferClickParams,
  buildPageViewParams,
  buildSearchParams,
  buildSortUseParams,
  configureAnalytics,
  declineConsent,
  ftCounterUrl,
  ftFormatCount,
  ftIsoDate,
  ftStatNumber,
  getMeasurementId,
  getStatsSite,
  grantConsent,
  initAnalytics,
  initTrafficStrip,
  isGaConfigured,
  isGoatCounterConfigured,
  isTrackingActive,
  isTrackingConfigured,
  loadGa,
  rejectConsent,
  resetAnalyticsForTests,
  resolveMeasurementId,
  resolveStatsSite,
  scheduleAnalyticsInit,
  subscribeConsentBanner,
  trackFilterUse,
  trackOfferClick,
  SEARCH_DEBOUNCE_MS,
  trackSearch,
  trackSortUse,
} from "./analytics";
import { GA_CONSENT_KEY, writeGaConsent } from "./personalState";

const MID = "G-ABCDEF12345";
const SITE = "https://luongnv89.goatcounter.com";

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

function mountTrafficStrip(): HTMLElement {
  document.body.innerHTML = `
    <p class="foot-traffic" id="${TRAFFIC_STRIP_ID}" role="status" hidden>
      <strong id="ft-traffic-today">&mdash;</strong>
      <strong id="ft-traffic-period">&mdash;</strong>
    </p>`;
  return document.getElementById(TRAFFIC_STRIP_ID)!;
}

function mountOfferLink(attrs?: {
  id?: string;
  provider?: string;
  category?: string;
}): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = "#";
  a.setAttribute("data-ft-offer-id", attrs?.id ?? "copilot");
  a.setAttribute("data-ft-provider", attrs?.provider ?? "GitHub");
  a.setAttribute("data-ft-offer-category", attrs?.category ?? "coding");
  a.textContent = "Copilot";
  document.body.appendChild(a);
  return a;
}

function eventCalls(gtag: ReturnType<typeof vi.fn>, name: string) {
  return gtag.mock.calls.filter((c) => c[0] === "event" && c[1] === name);
}

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
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    },
  });
}

beforeEach(() => {
  installLocalStorage();
  resetAnalyticsForTests();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("network blocked"))),
  );
});

afterEach(() => {
  resetAnalyticsForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("env resolution (Python-parity)", () => {
  it("accepts a well-formed measurement id and rejects empty or malformed", () => {
    expect(resolveMeasurementId(MID)).toBe(MID);
    expect(resolveMeasurementId("")).toBe("");
    expect(resolveMeasurementId("   ")).toBe("");
    expect(resolveMeasurementId("UA-123")).toBe("");
    expect(resolveMeasurementId("g-abcdef12345")).toBe("");
  });

  it("normalizes a GoatCounter origin and rejects non-https or paths", () => {
    expect(resolveStatsSite(`${SITE}/`)).toBe(SITE);
    expect(resolveStatsSite("http://luongnv89.goatcounter.com")).toBe("");
    expect(resolveStatsSite(`${SITE}/count`)).toBe("");
    expect(resolveStatsSite("not-a-url")).toBe("");
  });

  it("treats unset build defines as fully disabled", () => {
    expect(getMeasurementId()).toBe("");
    expect(getStatsSite()).toBe("");
    expect(isGaConfigured()).toBe(false);
    expect(isGoatCounterConfigured()).toBe(false);
    expect(isTrackingConfigured()).toBe(false);
  });
});

describe("grant-only gtag loader", () => {
  it("does not inject gtag.js until an explicit load/grant", () => {
    configureAnalytics({ measurementId: MID });
    installGtag();
    expect(document.getElementById(GA_SCRIPT_ID)).toBeNull();
    expect(isTrackingActive()).toBe(false);
    loadGa();
    const script = document.getElementById(GA_SCRIPT_ID) as HTMLScriptElement;
    expect(script).not.toBeNull();
    expect(script.src).toContain("www.googletagmanager.com/gtag/js?id=");
    expect(script.src).toContain(encodeURIComponent(MID));
    expect(script.async).toBe(true);
  });

  it("grantConsent loads gtag.js, anonymizes IP, and sends page_view without the query string", () => {
    configureAnalytics({ measurementId: MID });
    const gtag = installGtag();
    grantConsent();
    expect(document.getElementById(GA_SCRIPT_ID)).not.toBeNull();
    expect(gtag).toHaveBeenCalledWith("consent", "update", {
      analytics_storage: "granted",
    });
    expect(gtag).toHaveBeenCalledWith("config", MID, {
      anonymize_ip: true,
      send_page_view: false,
    });
    const pageView = eventCalls(gtag, "page_view")[0];
    expect(pageView[2]).toEqual(buildPageViewParams());
    const loc = (pageView[2] as { page_location: string }).page_location;
    expect(loc).not.toContain("?");
    expect(Object.keys(pageView[2] as object).sort()).toEqual([
      "page_location",
      "page_path",
    ]);
  });

  it("does not load gtag.js when the measurement id is unset", () => {
    configureAnalytics({ measurementId: "" });
    grantConsent();
    expect(document.getElementById(GA_SCRIPT_ID)).toBeNull();
    expect(isTrackingActive()).toBe(true);
  });

  it("loads GoatCounter count.js only on grant", () => {
    configureAnalytics({ statsSite: SITE });
    expect(document.getElementById(GC_SCRIPT_ID)).toBeNull();
    grantConsent();
    const script = document.getElementById(GC_SCRIPT_ID) as HTMLScriptElement;
    expect(script.src).toContain("gc.zgo.at/count.js");
    expect(script.getAttribute("data-goatcounter")).toBe(`${SITE}/count`);
  });

  it("dispatches ft-consent-granted on grant for companions", () => {
    configureAnalytics({ measurementId: MID });
    installGtag();
    const heard = vi.fn();
    window.addEventListener(CONSENT_GRANTED_EVENT, heard);
    grantConsent();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("consent decisions", () => {
  it("declining prevents all tracking calls and never loads gtag.js", () => {
    configureAnalytics({ measurementId: MID });
    const gtag = installGtag();
    rejectConsent();
    expect(window.localStorage.getItem(GA_CONSENT_KEY)).toBe("denied");
    expect(document.getElementById(GA_SCRIPT_ID)).toBeNull();
    expect(isTrackingActive()).toBe(false);
    trackOfferClick({ offer_id: "x", provider: "P", category: "coding" });
    trackFilterUse({ category: "coding" });
    trackSearch(4);
    trackSortUse("newest");
    expect(eventCalls(gtag, "offer_click")).toHaveLength(0);
    expect(eventCalls(gtag, "page_view")).toHaveLength(0);
    expect(eventCalls(gtag, "search")).toHaveLength(0);
    expect(eventCalls(gtag, "filter_use")).toHaveLength(0);
    expect(eventCalls(gtag, "sort_use")).toHaveLength(0);
  });

  it("after a grant, decline stops further events", () => {
    configureAnalytics({ measurementId: MID });
    const gtag = installGtag();
    grantConsent();
    gtag.mockClear();
    declineConsent();
    trackSearch(3);
    expect(eventCalls(gtag, "search")).toHaveLength(0);
    expect(eventCalls(gtag, "page_view")).toHaveLength(0);
  });

  it("honours a live-site ft_ga_consent=granted on first visit after cutover", () => {
    configureAnalytics({ measurementId: MID, statsSite: SITE });
    const gtag = installGtag();
    writeGaConsent("granted");
    const shown = vi.fn();
    const unsub = subscribeConsentBanner(shown);
    initAnalytics();
    expect(isTrackingActive()).toBe(true);
    expect(document.getElementById(GA_SCRIPT_ID)).not.toBeNull();
    expect(document.getElementById(GC_SCRIPT_ID)).not.toBeNull();
    expect(eventCalls(gtag, "page_view")).toHaveLength(1);
    expect(shown).not.toHaveBeenCalled();
    unsub();
  });

  it("honours ft_ga_consent=denied without loading trackers or showing the banner", () => {
    configureAnalytics({ measurementId: MID, statsSite: SITE });
    installGtag();
    writeGaConsent("denied");
    const shown = vi.fn();
    subscribeConsentBanner(shown);
    initAnalytics();
    expect(isTrackingActive()).toBe(false);
    expect(document.getElementById(GA_SCRIPT_ID)).toBeNull();
    expect(document.getElementById(GC_SCRIPT_ID)).toBeNull();
    expect(shown).not.toHaveBeenCalled();
  });

  it("shows the banner for every first visitor when tracking is configured", () => {
    configureAnalytics({ measurementId: MID });
    const shown = vi.fn();
    subscribeConsentBanner(shown);
    initAnalytics();
    expect(shown).toHaveBeenCalledWith(true);
    expect(document.getElementById(GA_SCRIPT_ID)).toBeNull();
  });

  it("replays a visible banner to subscribers that mount after init", () => {
    configureAnalytics({ measurementId: MID });
    initAnalytics();
    const shown = vi.fn();
    subscribeConsentBanner(shown);
    expect(shown).toHaveBeenCalledWith(true);
  });

  it("schedules init via requestIdleCallback with a 2000ms timeout", () => {
    configureAnalytics({ measurementId: MID });
    const ric = vi.fn();
    vi.stubGlobal("requestIdleCallback", ric);
    scheduleAnalyticsInit();
    expect(ric).toHaveBeenCalledTimes(1);
    expect(ric.mock.calls[0][1]).toEqual({ timeout: 2000 });
    expect(document.getElementById(GA_SCRIPT_ID)).toBeNull();
  });
});

describe("five events with correct properties", () => {
  function grantedGtag() {
    configureAnalytics({ measurementId: MID });
    const gtag = installGtag();
    grantConsent();
    gtag.mockClear();
    return gtag;
  }

  it("page_view carries page_path and page_location = origin+pathname", () => {
    const params = buildPageViewParams({
      origin: "https://example.test",
      pathname: "/freetokens/index.html",
    });
    expect(params).toEqual({
      page_path: "/freetokens/index.html",
      page_location: "https://example.test/freetokens/index.html",
    });
  });

  it("offer_click carries offer_id, provider, category only", () => {
    const params = buildOfferClickParams({
      offer_id: "copilot",
      provider: "GitHub",
      category: "coding",
    });
    expect(params).toEqual({
      offer_id: "copilot",
      provider: "GitHub",
      category: "coding",
    });
    expect(Object.keys(params).sort()).toEqual([
      "category",
      "offer_id",
      "provider",
    ]);
    const gtag = grantedGtag();
    trackOfferClick(params);
    expect(eventCalls(gtag, "offer_click")[0][2]).toEqual(params);
  });

  it("filter_use reports closed enums, defaulting empty dimensions to all", () => {
    const params = buildFilterUseParams({ category: "image" });
    expect(FILTER_DIMENSIONS).toEqual(["category", "verification", "signup"]);
    expect(params).toEqual({
      category: "image",
      verification: "all",
      signup: "all",
    });
    const gtag = grantedGtag();
    trackFilterUse({ category: "image" });
    expect(eventCalls(gtag, "filter_use")[0][2]).toEqual(params);
  });

  it("search carries query_length ONLY — never a raw query", () => {
    const params = buildSearchParams(11);
    expect(params).toEqual({ query_length: 11 });
    expect(Object.keys(params)).toEqual(["query_length"]);
    expect(JSON.stringify(params)).not.toMatch(/q=|query[^_]|search_term/i);
    const gtag = grantedGtag();
    trackSearch(11);
    const payload = eventCalls(gtag, "search")[0][2] as Record<string, unknown>;
    expect(payload).toEqual({ query_length: 11 });
    expect(Object.keys(payload)).toEqual(["query_length"]);
    expect(JSON.stringify(payload)).not.toMatch(/q=|query[^_]|search_term/i);
  });

  it("search of length 0 is not sent", () => {
    const gtag = grantedGtag();
    trackSearch(0);
    expect(eventCalls(gtag, "search")).toHaveLength(0);
  });

  it("sort_use reports sort_option, mapping empty to default", () => {
    expect(buildSortUseParams("")).toEqual({ sort_option: "default" });
    expect(buildSortUseParams("expiring")).toEqual({ sort_option: "expiring" });
    const gtag = grantedGtag();
    trackSortUse("newest");
    expect(eventCalls(gtag, "sort_use")[0][2]).toEqual({
      sort_option: "newest",
    });
  });
});

describe("offer_click delegation", () => {
  it("fires exactly once on a rapid double-click of the same offer", () => {
    configureAnalytics({ measurementId: MID });
    const gtag = installGtag();
    grantConsent();
    gtag.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
    const link = mountOfferLink();
    bindAnalyticsListeners();
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(eventCalls(gtag, "offer_click")).toHaveLength(1);
    expect(eventCalls(gtag, "offer_click")[0][2]).toEqual({
      offer_id: "copilot",
      provider: "GitHub",
      category: "coding",
    });
  });

  it("fires again after OFFER_CLICK_DEDUPE_MS", () => {
    configureAnalytics({ measurementId: MID });
    const gtag = installGtag();
    grantConsent();
    gtag.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
    const link = mountOfferLink();
    bindAnalyticsListeners();
    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z").getTime() + OFFER_CLICK_DEDUPE_MS + 1);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(eventCalls(gtag, "offer_click")).toHaveLength(2);
  });

  it("never calls preventDefault so navigation always completes", () => {
    configureAnalytics({ measurementId: MID });
    const gtag = installGtag();
    grantConsent();
    gtag.mockClear();
    const link = mountOfferLink();
    bindAnalyticsListeners();
    const prevent = vi.spyOn(Event.prototype, "preventDefault");
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(prevent).not.toHaveBeenCalled();
    expect(eventCalls(gtag, "offer_click")).toHaveLength(1);
  });

  it("swallows a throwing tracker so navigation still completes when GA4 is blocked", () => {
    configureAnalytics({ measurementId: MID });
    const gtag = installGtag();
    grantConsent();
    gtag.mockImplementation(() => {
      throw new Error("gtag blocked");
    });
    const link = mountOfferLink();
    bindAnalyticsListeners();
    const prevent = vi.spyOn(Event.prototype, "preventDefault");
    expect(() =>
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    ).not.toThrow();
    expect(prevent).not.toHaveBeenCalled();
  });
});

describe("GoatCounter exclusive-end window (#102)", () => {
  const now = new Date(2026, 7, 25, 15, 0, 0);

  it("today = ftCounterUrl(1) ends tomorrow and is not a zero-length range", () => {
    const url = ftCounterUrl(1, SITE, now);
    const start = new URL(url).searchParams.get("start");
    const end = new URL(url).searchParams.get("end");
    expect(start).toBe("2026-08-25");
    expect(end).toBe("2026-08-26");
    expect(start).not.toBe(end);
    expect(
      (Date.parse(`${end}T00:00:00`) - Date.parse(`${start}T00:00:00`)) /
        86_400_000,
    ).toBe(1);
  });

  it("90-day window shares that exclusive end and spans 90 days including today", () => {
    const url = ftCounterUrl(90, SITE, now);
    const start = new URL(url).searchParams.get("start");
    const end = new URL(url).searchParams.get("end");
    expect(end).toBe(ftIsoDate(new Date(now.getTime() + 86_400_000)));
    expect(start).toBe(ftIsoDate(new Date(now.getTime() - 89 * 86_400_000)));
    expect(start).not.toBe(end);
    expect(
      (Date.parse(`${end}T00:00:00`) - Date.parse(`${start}T00:00:00`)) /
        86_400_000,
    ).toBe(90);
  });

  it("never emits ftCounterUrl(0) as a collapsed start===end window", () => {
    const url = ftCounterUrl(0, SITE, now);
    const start = new URL(url).searchParams.get("start");
    const end = new URL(url).searchParams.get("end");
    expect(start).not.toBe(end);
    expect(url).toBe(ftCounterUrl(1, SITE, now));
  });

  it("sends no cache-buster query param to the counter route", () => {
    const today = ftCounterUrl(1, SITE, now);
    const period = ftCounterUrl(90, SITE, now);
    for (const url of [today, period]) {
      expect(url).toContain("/counter/TOTAL.json?start=");
      expect(url).toContain("&end=");
      const params = [...new URL(url).searchParams.keys()].sort();
      expect(params).toEqual(["end", "start"]);
      expect(url).not.toMatch(/[?&](_cb|_=|cb|nocache|cacheBust|t)=/i);
    }
  });

  it("only trusts digits-derived non-negative counts", () => {
    expect(ftStatNumber({ count: "1,234" })).toBe(1234);
    expect(ftStatNumber({ count: "8" })).toBe(8);
    expect(ftStatNumber({ count: 8 })).toBeNull();
    expect(ftStatNumber({ count: "abc" })).toBeNull();
    expect(ftStatNumber({})).toBeNull();
    expect(ftFormatCount(12345)).toBe("12,345");
  });
});

describe("traffic strip silent hide", () => {
  it("stays hidden when fetch rejects (ad blocker / offline)", async () => {
    configureAnalytics({ statsSite: SITE });
    const box = mountTrafficStrip();
    vi.mocked(fetch).mockRejectedValue(new Error("blocked"));
    await initTrafficStrip(SITE);
    expect(box.hidden).toBe(true);
    expect(box.querySelector("#ft-traffic-today")?.textContent).toBe("—");
  });

  it("stays hidden when the counter route returns a non-OK status", async () => {
    configureAnalytics({ statsSite: SITE });
    const box = mountTrafficStrip();
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ count: "8" }),
    } as Response);
    await initTrafficStrip(SITE);
    expect(box.hidden).toBe(true);
  });

  it("reveals a non-zero today count for a non-empty window", async () => {
    configureAnalytics({ statsSite: SITE });
    const box = mountTrafficStrip();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: "8" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: "321" }),
      } as Response);
    await initTrafficStrip(SITE);
    expect(box.hidden).toBe(false);
    expect(box.querySelector("#ft-traffic-today")?.textContent).toBe("8");
    expect(box.querySelector("#ft-traffic-period")?.textContent).toBe("321");
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(2);
    expect(urls.some((u) => u.includes("ftCounterUrl(0)"))).toBe(false);
    for (const url of urls) {
      const start = new URL(url).searchParams.get("start");
      const end = new URL(url).searchParams.get("end");
      expect(start).not.toBe(end);
      expect([...new URL(url).searchParams.keys()].sort()).toEqual([
        "end",
        "start",
      ]);
    }
  });
});

describe("bindToolbarListeners leaves search/sort/chips to React", () => {
  it("does not emit search, sort_use, or filter_use from toolbar controls", () => {
    configureAnalytics({ measurementId: MID });
    const gtag = installGtag();
    grantConsent();
    gtag.mockClear();
    vi.useFakeTimers();
    document.body.innerHTML = `
      <input id="ft-search" />
      <select id="ft-sort">
        <option value=""></option>
        <option value="newest">newest</option>
      </select>
      <button type="button" data-ft-category="coding">coding</button>
    `;
    bindAnalyticsListeners();
    const input = document.getElementById("ft-search") as HTMLInputElement;
    input.value = "secret-query-xyz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 50);
    expect(eventCalls(gtag, "search")).toHaveLength(0);

    const sort = document.getElementById("ft-sort") as HTMLSelectElement;
    sort.value = "newest";
    sort.dispatchEvent(new Event("change", { bubbles: true }));
    expect(eventCalls(gtag, "sort_use")).toHaveLength(0);

    const chip = document.querySelector("[data-ft-category]") as HTMLButtonElement;
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(eventCalls(gtag, "filter_use")).toHaveLength(0);
  });
});
