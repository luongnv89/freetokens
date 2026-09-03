/**
 * Consent-gated GA4 + GoatCounter runtime (issue #131).
 *
 * Behavioral oracle: scripts/build.py (ftGrant / ftLoadGa / ftCounterUrl /
 * offer_click). Grant-only gtag.js — never Advanced Consent Mode.
 * prerender must import only the pure helpers / config readers; loaders
 * run from main.tsx after hydrate.
 */

import { readGaConsent, writeGaConsent } from "./personalState";
import { resolveMeasurementId, resolveStatsSite } from "./analyticsEnv";

export { resolveMeasurementId, resolveStatsSite };

/** Rapid re-click suppression for offer_click (F6 / build.py). */
export const OFFER_CLICK_DEDUPE_MS = 1000;

/** Search-input debounce before a search event (build.py SEARCH_DEBOUNCE_MS). */
export const SEARCH_DEBOUNCE_MS = 120;

export const GA_SCRIPT_ID = "ft-ga4-script";
export const GC_SCRIPT_ID = "ft-gc-script";
export const CONSENT_GRANTED_EVENT = "ft-consent-granted";
export const TRAFFIC_STRIP_ID = "ft-traffic";

export const FILTER_DIMENSIONS = ["category", "verification", "signup"] as const;
export type FilterDimension = (typeof FILTER_DIMENSIONS)[number];

export type FilterUseParams = Record<FilterDimension, string>;
export type OfferClickParams = {
  offer_id: string;
  provider: string;
  category: string;
};
export type PageViewParams = {
  page_path: string;
  page_location: string;
};
export type SearchParams = { query_length: number };
export type SortUseParams = { sort_option: string };

type AnalyticsConfig = {
  measurementId: string;
  statsSite: string;
};

type GtagFn = (...args: unknown[]) => void;
type GoatCounterApi = { count?: (hit: { path: string; event?: boolean }) => void };
type BannerListener = (visible: boolean) => void;

function readGaDefine(): string {
  try {
    return typeof __FT_GA_ID__ === "string" ? __FT_GA_ID__ : "";
  } catch {
    return "";
  }
}

function readGcDefine(): string {
  try {
    return typeof __FT_GC_SITE__ === "string" ? __FT_GC_SITE__ : "";
  } catch {
    return "";
  }
}

let config: AnalyticsConfig = {
  measurementId: resolveMeasurementId(readGaDefine()),
  statsSite: resolveStatsSite(readGcDefine()),
};

let trackingActive = false;
let lastOfferId: string | null = null;
let lastOfferAt = 0;
let listenerAbort: AbortController | null = null;
const bannerListeners = new Set<BannerListener>();
let bannerOpen = false;
let analyticsInitStarted = false;

function gtagWindow(): Window & { dataLayer?: unknown[]; gtag?: GtagFn } {
  return window;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function getMeasurementId(): string {
  return config.measurementId;
}

export function getStatsSite(): string {
  return config.statsSite;
}

export function isGaConfigured(): boolean {
  return config.measurementId !== "";
}

export function isGoatCounterConfigured(): boolean {
  return config.statsSite !== "";
}

/** True when GA4 and/or GoatCounter is configured — banner + cookie settings. */
export function isTrackingConfigured(): boolean {
  return isGaConfigured() || isGoatCounterConfigured();
}

export function isTrackingActive(): boolean {
  return trackingActive;
}

export function configureAnalytics(partial: Partial<AnalyticsConfig>): void {
  if (partial.measurementId !== undefined) {
    config.measurementId = resolveMeasurementId(partial.measurementId);
  }
  if (partial.statsSite !== undefined) {
    config.statsSite = resolveStatsSite(partial.statsSite);
  }
}

export function subscribeConsentBanner(fn: BannerListener): () => void {
  bannerListeners.add(fn);
  // Replay so a late mount (hydrate after idle init) still sees the banner.
  if (bannerOpen) fn(true);
  return () => {
    bannerListeners.delete(fn);
  };
}

export function showConsentBanner(): void {
  bannerOpen = true;
  bannerListeners.forEach((fn) => fn(true));
  if (!isBrowser()) return;
  const banner = document.getElementById("ft-consent-banner");
  if (banner) banner.hidden = false;
  document.getElementById("ft-consent-accept")?.focus();
}

export function hideConsentBanner(): void {
  bannerOpen = false;
  bannerListeners.forEach((fn) => fn(false));
  if (!isBrowser()) return;
  const banner = document.getElementById("ft-consent-banner");
  if (banner) banner.hidden = true;
}

/** YYYY-MM-DD in local time (build.py ftIsoDate). */
export function ftIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * GoatCounter public counter URL.
 * Omit `days` (or pass null) for the all-time site total — no start/end,
 * same unwindowed route per-offer views already use. When `days` is set it
 * counts calendar days INCLUDING today: 1 is today alone, 90 is the trailing
 * 90 days. `end` is exclusive midnight (#102), so the window ends on
 * tomorrow. NEVER pass 0 — that collapsed start onto end. Never add a
 * cache-buster; GoatCounter keys the CDN on (path, start, end) only.
 */
export function ftCounterUrl(
  days?: number | null,
  site: string = config.statsSite,
  now: Date = new Date(),
): string {
  if (days == null) {
    return `${site}/counter/TOTAL.json`;
  }
  const span = Math.max(1, Math.floor(days));
  const end = new Date(now.getTime() + 86_400_000);
  const start = new Date(now.getTime() - (span - 1) * 86_400_000);
  return `${site}/counter/TOTAL.json?start=${ftIsoDate(start)}&end=${ftIsoDate(end)}`;
}

export function ftFormatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Defensive parse of GoatCounter `{"count": "1,234"}`. */
export function ftStatNumber(data: unknown): number | null {
  if (!data || typeof data !== "object" || !("count" in data)) return null;
  const count = (data as { count: unknown }).count;
  if (typeof count !== "string") return null;
  const n = parseInt(count.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function buildPageViewParams(
  loc: Pick<Location, "origin" | "pathname"> = window.location,
): PageViewParams {
  return {
    page_path: loc.pathname,
    page_location: loc.origin + loc.pathname,
  };
}

export function buildOfferClickParams(input: OfferClickParams): OfferClickParams {
  return {
    offer_id: input.offer_id,
    provider: input.provider,
    category: input.category,
  };
}

export function buildFilterUseParams(
  state: Partial<FilterUseParams> = {},
): FilterUseParams {
  const params = {} as FilterUseParams;
  for (const dim of FILTER_DIMENSIONS) {
    params[dim] = state[dim] || "all";
  }
  return params;
}

/** Privacy: length only — never a raw query string. */
export function buildSearchParams(queryLength: number): SearchParams {
  const n = Number.isFinite(queryLength) ? Math.max(0, Math.floor(queryLength)) : 0;
  return { query_length: n };
}

export function buildSortUseParams(sortOption: string): SortUseParams {
  return { sort_option: sortOption || "default" };
}

function ensureGtagStub(): void {
  if (!isBrowser()) return;
  const w = gtagWindow();
  w.dataLayer = w.dataLayer || [];
  if (typeof w.gtag === "function") return;
  const gtag: GtagFn = (...args: unknown[]) => {
    w.dataLayer!.push(args);
  };
  w.gtag = gtag;
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    wait_for_update: 500,
  });
}

/** Load googletagmanager.com/gtag/js ONLY after an explicit grant. */
export function loadGa(measurementId: string = config.measurementId): void {
  if (!isBrowser() || !measurementId) return;
  if (document.getElementById(GA_SCRIPT_ID)) return;
  const s = document.createElement("script");
  s.id = GA_SCRIPT_ID;
  s.async = true;
  s.src =
    "https://www.googletagmanager.com/gtag/js?id=" +
    encodeURIComponent(measurementId);
  document.head.appendChild(s);
}

/** Consent-gated GoatCounter count.js (build.py ftGcLoad). */
export function loadGoatCounter(site: string = config.statsSite): void {
  if (!isBrowser() || !site) return;
  if (document.getElementById(GC_SCRIPT_ID)) return;
  const s = document.createElement("script");
  s.id = GC_SCRIPT_ID;
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", `${site}/count`);
  document.head.appendChild(s);
}

export function trackEvent(name: string, params: Record<string, unknown>): void {
  if (!trackingActive) return;
  if (!config.measurementId) return;
  const gtag = gtagWindow().gtag;
  if (typeof gtag !== "function") return;
  gtag("event", name, params);
}

export function trackPageView(): void {
  trackEvent("page_view", buildPageViewParams());
}

/**
 * Consent-gated GoatCounter event (#101). Fires only after a grant, when
 * count.js has loaded window.goatcounter; events never start with "/".
 */
export function trackGoatCounterEvent(path: string): void {
  if (!isBrowser() || !trackingActive || !config.statsSite) return;
  const gc = (gtagWindow() as Window & { goatcounter?: GoatCounterApi })
    .goatcounter;
  if (!gc || typeof gc.count !== "function") return;
  try {
    gc.count({ path, event: true });
  } catch {
    /* never block navigation */
  }
}

export function trackOfferClick(input: OfferClickParams): void {
  trackEvent("offer_click", buildOfferClickParams(input));
}

export function trackFilterUse(state: Partial<FilterUseParams> = {}): void {
  trackEvent("filter_use", buildFilterUseParams(state));
}

export function trackSearch(queryLength: number): void {
  const params = buildSearchParams(queryLength);
  if (params.query_length === 0) return;
  trackEvent("search", params);
}

export function trackSortUse(sortOption: string): void {
  trackEvent("sort_use", buildSortUseParams(sortOption));
}

export function grantConsent(): void {
  trackingActive = true;
  if (!isBrowser()) return;
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_GRANTED_EVENT));
  } catch {
    /* ignore */
  }
  loadGoatCounter();
  if (!config.measurementId) return;
  ensureGtagStub();
  const gtag = gtagWindow().gtag;
  if (typeof gtag !== "function") return;
  gtag("consent", "update", { analytics_storage: "granted" });
  loadGa();
  gtag("config", config.measurementId, {
    anonymize_ip: true,
    send_page_view: false,
  });
  gtag("event", "page_view", buildPageViewParams());
}

export function declineConsent(): void {
  trackingActive = false;
  if (!isBrowser() || !config.measurementId) return;
  const gtag = gtagWindow().gtag;
  if (typeof gtag !== "function") return;
  gtag("consent", "update", { analytics_storage: "denied" });
}

export function acceptConsent(): void {
  writeGaConsent("granted");
  hideConsentBanner();
  grantConsent();
}

export function rejectConsent(): void {
  writeGaConsent("denied");
  hideConsentBanner();
  declineConsent();
}

/**
 * Delegated offer_click. NEVER preventDefault — navigation must complete
 * even when GA4 is blocked, offline, or throws (navigate-away race).
 */
export function onDelegatedOfferClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const node = target.closest("[data-ft-offer-id]");
  if (!node) return;
  const offerId = node.getAttribute("data-ft-offer-id");
  if (!offerId) return;
  const now = Date.now();
  if (offerId === lastOfferId && now - lastOfferAt < OFFER_CLICK_DEDUPE_MS) {
    return;
  }
  lastOfferId = offerId;
  lastOfferAt = now;
  try {
    trackOfferClick({
      offer_id: offerId,
      provider: node.getAttribute("data-ft-provider") || "",
      category: node.getAttribute("data-ft-offer-category") || "",
    });
    if (node.getAttribute("data-ft-outbound") === "true") {
      trackGoatCounterEvent(`offer_click:${offerId}`);
    }
  } catch {
    /* never block navigation */
  }
}

function bindConsentChrome(signal: AbortSignal): void {
  if (!isBrowser()) return;
  // Allow/Decline are React onClick on ConsentBanner so they cannot double-fire.
  // Cookie settings + Escape stay here so every page (including prerendered
  // markup) can re-open or dismiss without a second key.
  document.getElementById("ft-consent-settings")?.addEventListener(
    "click",
    () => {
      showConsentBanner();
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const banner = document.getElementById("ft-consent-banner");
      if (banner && !banner.hidden) rejectConsent();
    },
    { signal },
  );
}

export function bindAnalyticsListeners(): void {
  if (!isBrowser()) return;
  listenerAbort?.abort();
  listenerAbort = new AbortController();
  const { signal } = listenerAbort;
  document.addEventListener("click", onDelegatedOfferClick, { signal });
  // Search, sort, and category chips are owned by HomePage (trackSearch /
  // trackSortUse / trackFilterUse) so this layer must not attach them —
  // a second listener would double-fire filter_use on every chip click.
  bindConsentChrome(signal);
}

async function fetchCounterCount(url: string): Promise<number | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return ftStatNumber(await res.json());
  } catch {
    return null;
  }
}

/**
 * A window that never answers is marked `data-traffic="off"` so the masthead
 * rail (#279) collapses its reserved box instead of leaving an invisible gap
 * above the fold. In the footer the `hidden` attribute already collapses it,
 * so the marker is inert there.
 */
function revealTrafficWindow(
  box: Element,
  count: number | null,
  numberId: string,
  wrapSelector: string,
): void {
  const wrap = box.querySelector(wrapSelector);
  if (count === null) {
    if (wrap instanceof HTMLElement) wrap.dataset.traffic = "off";
    return;
  }
  const numberEl = box.querySelector(numberId);
  if (numberEl) numberEl.textContent = ftFormatCount(count);
  if (wrap instanceof HTMLElement) wrap.hidden = false;
}

export async function initTrafficStrip(
  site: string = config.statsSite,
): Promise<void> {
  if (!isBrowser() || !site) return;
  const box = document.getElementById(TRAFFIC_STRIP_ID);
  if (!box || typeof fetch !== "function") return;
  try {
    const [total, today, period] = await Promise.all([
      fetchCounterCount(ftCounterUrl(null, site)),
      fetchCounterCount(ftCounterUrl(1, site)),
      fetchCounterCount(ftCounterUrl(90, site)),
    ]);
    if (total === null) {
      box.dataset.traffic = "off";
      return;
    }
    const totalEl = box.querySelector("#ft-traffic-total");
    if (totalEl) totalEl.textContent = ftFormatCount(total);
    revealTrafficWindow(box, today, "#ft-traffic-today", ".ft-traffic-today");
    revealTrafficWindow(box, period, "#ft-traffic-period", ".ft-traffic-period");
    box.hidden = false;
  } catch {
    /* silent collapse — ad block, offline, malformed payload */
    box.dataset.traffic = "off";
  }
}

/**
 * Apply a stored consent decision or show the banner. Does not schedule
 * itself — call from scheduleAnalyticsInit after hydrate.
 */
export function initAnalytics(): void {
  if (!isBrowser() || !isTrackingConfigured()) return;
  if (analyticsInitStarted) return;
  analyticsInitStarted = true;
  bindAnalyticsListeners();
  const stored = readGaConsent();
  if (stored === "granted") {
    grantConsent();
    void initTrafficStrip();
    return;
  }
  if (stored === "denied") {
    void initTrafficStrip();
    return;
  }
  showConsentBanner();
  void initTrafficStrip();
}

/**
 * Off the critical load path. Always pair requestIdleCallback with setTimeout:
 * Playwright WebKit exposes ric but does not fire it (or its timeout), so the
 * consent banner never mounts if we wait on idle alone.
 */
export function scheduleAnalyticsInit(): void {
  if (!isBrowser() || !isTrackingConfigured()) return;
  const run = () => {
    initAnalytics();
  };
  window.setTimeout(run, 1);
  try {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 2000 });
    }
  } catch {
    /* setTimeout already queued */
  }
}

/** Test helper: restore module state without touching real GA/GC. */
export function resetAnalyticsForTests(): void {
  trackingActive = false;
  lastOfferId = null;
  lastOfferAt = 0;
  listenerAbort?.abort();
  listenerAbort = null;
  bannerListeners.clear();
  bannerOpen = false;
  analyticsInitStarted = false;
  config = {
    measurementId: resolveMeasurementId(readGaDefine()),
    statsSite: resolveStatsSite(readGcDefine()),
  };
  if (isBrowser()) {
    document.getElementById(GA_SCRIPT_ID)?.remove();
    document.getElementById(GC_SCRIPT_ID)?.remove();
  }
}
