import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";

// Deliberate evidence collection, not a catalog-dependent gate on every CI run.
// Run from app/:
//   ISSUE_505_CAPTURE=1 npx playwright test issue-505 --project=chromium --workers=1
//
// Establishes a bounded *lab* performance baseline (issue #505 / review task T2):
// cold-load and search-interaction traces for the home and detail surfaces, with
// transfer size, main-thread work, LCP, CLS and interaction timing. It is a lab
// harness on the local production build, not field Core Web Vitals; the report
// keeps that distinction explicit and never turns a measurement into a score.
const capture = process.env.ISSUE_505_CAPTURE === "1";
const output = path.resolve("../docs/qa/issue-505");
const home = "/index.html";
const detail = "/offers/aerolink-starter-free-trial.html";
const ROWS = 3;

// Third-party analytics/traffic hosts answer from the real network otherwise.
// Only *external* hosts are stubbed, so every same-origin request the baseline
// measures still travels over real loopback HTTP to the preview server.
const EXTERNAL =
  /goatcounter\.com|gc\.zgo\.at|googletagmanager\.com|google-analytics\.com|doubleclick/i;

const MAIN_THREAD_METRICS = [
  "TaskDuration",
  "ScriptDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "JSHeapUsedSize",
];

interface Perf505 {
  lcp: number;
  lcpElement: string;
  cls: number;
  longTasks: { start: number; duration: number }[];
}

declare global {
  interface Window {
    __perf505?: Perf505;
  }
}

// Registered as an init script so the observers are live before any page
// script runs — a post-load observer would miss buffered-less LCP candidates.
function installObservers() {
  const store: Perf505 = { lcp: 0, lcpElement: "", cls: 0, longTasks: [] };
  window.__perf505 = store;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const lcp = entry as PerformanceEntry & { element?: Element; url?: string };
        if (lcp.startTime >= store.lcp) {
          store.lcp = lcp.startTime;
          const tag = lcp.element?.tagName?.toLowerCase() ?? "unknown";
          store.lcpElement = lcp.url ? `${tag} ${lcp.url}` : tag;
        }
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    /* LCP unsupported in this engine */
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) store.cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    /* CLS unsupported in this engine */
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {
    /* long tasks unsupported in this engine */
  }
}

interface ResourceRecord {
  name: string;
  initiatorType: string;
  transferBytes: number;
  decodedBytes: number;
}

interface TimingSnapshot {
  ttfbMs: number;
  domContentLoadedMs: number;
  loadEventMs: number;
  navigationTransferBytes: number;
  navigationDecodedBytes: number;
  requestCount: number;
  transferBytes: number;
  decodedBytes: number;
  byInitiator: Record<string, { count: number; transferBytes: number; decodedBytes: number }>;
  resources: ResourceRecord[];
  lcpMs: number;
  lcpElement: string;
  cls: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
}

function collectInPage(): TimingSnapshot {
  const round = (value: number) => Math.round(value * 10) / 10;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const byInitiator: TimingSnapshot["byInitiator"] = {};
  const resources: ResourceRecord[] = [];
  let transferBytes = 0;
  let decodedBytes = 0;
  for (const entry of entries) {
    const transfer = entry.transferSize || 0;
    const decoded = entry.decodedBodySize || 0;
    transferBytes += transfer;
    decodedBytes += decoded;
    const key = entry.initiatorType || "other";
    byInitiator[key] ??= { count: 0, transferBytes: 0, decodedBytes: 0 };
    byInitiator[key].count += 1;
    byInitiator[key].transferBytes += transfer;
    byInitiator[key].decodedBytes += decoded;
    resources.push({ name: entry.name, initiatorType: key, transferBytes: transfer, decodedBytes: decoded });
  }
  const perf = window.__perf505 ?? { lcp: 0, lcpElement: "", cls: 0, longTasks: [] };
  const longTasks = perf.longTasks ?? [];
  return {
    ttfbMs: round(nav?.responseStart ?? 0),
    domContentLoadedMs: round(nav?.domContentLoadedEventEnd ?? 0),
    loadEventMs: round(nav?.loadEventEnd ?? 0),
    navigationTransferBytes: nav?.transferSize ?? 0,
    navigationDecodedBytes: nav?.decodedBodySize ?? 0,
    requestCount: entries.length,
    transferBytes,
    decodedBytes,
    byInitiator,
    resources,
    lcpMs: round(perf.lcp),
    lcpElement: perf.lcpElement,
    cls: Math.round(perf.cls * 10000) / 10000,
    longTaskCount: longTasks.length,
    longTaskTotalMs: round(longTasks.reduce((sum, task) => sum + task.duration, 0)),
    longTaskMaxMs: round(longTasks.reduce((max, task) => Math.max(max, task.duration), 0)),
  };
}

function pickMetrics(metrics: { name: string; value: number }[], names: string[]) {
  const out: Record<string, number> = {};
  for (const metric of metrics) {
    if (names.includes(metric.name)) out[metric.name] = metric.value;
  }
  return out;
}

async function waitForApp(page: Page) {
  await page.waitForFunction(() =>
    Object.keys(document.getElementById("root") ?? {}).some((key) =>
      key.startsWith("__reactContainer"),
    ),
  );
  await page.evaluate(() => document.fonts.ready);
}

// A fresh context per repetition gives a genuinely cold cache (empty HTTP and
// memory cache) and the same desktop-Chrome UA/viewport the project config uses.
async function openPage(browser: Browser) {
  const context = await browser.newContext({
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  });
  await context.route(EXTERNAL, (route) => route.fulfill({ status: 204, body: "" }));
  await context.addInitScript(() => localStorage.setItem("ft_ga_consent", "denied"));
  await context.addInitScript(installObservers);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  return { context, page, cdp };
}

function runMetadata(browser: Browser, surface: string, url: string, rows: number) {
  return {
    surface,
    url,
    capturedAt: new Date().toISOString(),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tool: {
      browser: "chromium",
      version: browser.version(),
      driver: "Playwright + CDP Performance domain + PerformanceObserver",
      headless: true,
    },
    device: { viewport: "1440x900 CSS px", deviceScaleFactor: 1, mobile: false },
    network: {
      transport: "loopback HTTP to the local `vite preview` server (gzip, like GitHub Pages)",
      throttling: "none (no CDP Network.emulateNetworkConditions)",
      thirdParty: "analytics/traffic hosts stubbed with 204; same-origin served for real",
    },
    cache: "cold — a fresh browser context per repetition (empty HTTP + memory cache)",
    repetitions: rows,
    limitations: [
      "Lab trace on the local production build, not field Core Web Vitals",
      "No network or CPU throttling: loopback and host CPU are faster than a real mobile client",
      "LCP/CLS from PerformanceObserver; only long tasks >=50ms are counted",
      "transferSize excludes cross-origin resources without Timing-Allow-Origin",
      "Subresources reached by same-origin `fetch()` are counted; the navigation document is reported separately",
    ],
  };
}

test("issue 505 lab baseline — home cold load and search interaction", async ({ browser, browserName }) => {
  test.skip(!capture || browserName !== "chromium", "Opt-in Chromium lab trace; no tracked artifacts during normal CI");
  test.setTimeout(180_000);
  await mkdir(output, { recursive: true });

  const runs: Record<string, unknown>[] = [];
  for (let i = 0; i < ROWS; i++) {
    const { context, page, cdp } = await openPage(browser);
    const wallStart = Date.now();
    await page.goto(home, { waitUntil: "load" });
    await waitForApp(page);
    await page.waitForTimeout(1000);
    const snapshot = await page.evaluate(collectInPage);
    const metrics = await cdp.send("Performance.getMetrics");

    // AC1 asserts cold load; AC2 reads it back. A zero request count or zero
    // transfer total means the measurement silently degraded (e.g. synthesis
    // instead of real HTTP), so it is a hard failure, not a note.
    expect(snapshot.requestCount).toBeGreaterThan(0);
    expect(snapshot.transferBytes).toBeGreaterThan(0);
    expect(snapshot.lcpMs).toBeGreaterThan(0);
    expect(snapshot.cls).toBeGreaterThanOrEqual(0);

    // Search interaction: fill, then wait for the URL, result count and status
    // to settle together. Timing is the in-page performance.now() delta, so it
    // measures the interaction itself, not the harness round trips.
    await page.evaluate(() => {
      if (window.__perf505) window.__perf505.longTasks.length = 0;
    });
    const before = await cdp.send("Performance.getMetrics");
    const start = await page.evaluate(() => performance.now());
    await page.locator("#ft-search").fill("aerolink");
    await expect(page.locator("#ft-search")).toHaveValue("aerolink");
    await expect.poll(() => new URL(page.url()).searchParams.get("q") ?? "").toBe("aerolink");
    await expect(page.locator("#ft-grid > li")).toHaveCount(1);
    await expect(page.locator("#ft-results-status")).toContainText("1");
    const end = await page.evaluate(() => performance.now());
    const after = await cdp.send("Performance.getMetrics");
    const interactionLongTasks = await page.evaluate(() => {
      const tasks = window.__perf505?.longTasks ?? [];
      return {
        longTaskCount: tasks.length,
        longTaskTotalMs: Math.round(tasks.reduce((sum, task) => sum + task.duration, 0) * 10) / 10,
      };
    });
    const taskBefore = pickMetrics(before.metrics, ["TaskDuration"]).TaskDuration ?? 0;
    const taskAfter = pickMetrics(after.metrics, ["TaskDuration"]).TaskDuration ?? 0;
    const interactionMs = Math.round((end - start) * 10) / 10;

    expect(interactionMs).toBeGreaterThan(0);
    expect(interactionMs).toBeLessThan(10_000);

    runs.push({
      run: i + 1,
      wallMs: Date.now() - wallStart,
      coldLoad: { ...snapshot, ...pickMetrics(metrics.metrics, MAIN_THREAD_METRICS) },
      searchInteraction: {
        query: "aerolink",
        resultRows: 1,
        interactionMs,
        mainThreadTaskMs: Math.round((taskAfter - taskBefore) * 1000) / 1000,
        ...interactionLongTasks,
      },
    });
    await context.close();
  }

  await writeFile(
    path.join(output, "home.json"),
    JSON.stringify({ ...runMetadata(browser, "home", home, runs.length), runs }, null, 2) + "\n",
  );
});

test("issue 505 lab baseline — detail cold load", async ({ browser, browserName }) => {
  test.skip(!capture || browserName !== "chromium", "Opt-in Chromium lab trace; no tracked artifacts during normal CI");
  test.setTimeout(180_000);
  await mkdir(output, { recursive: true });

  const runs: Record<string, unknown>[] = [];
  for (let i = 0; i < ROWS; i++) {
    const { context, page, cdp } = await openPage(browser);
    const wallStart = Date.now();
    await page.goto(detail, { waitUntil: "load" });
    await waitForApp(page);
    await expect(page.locator("h1")).toContainText("Aerolink");
    await page.waitForTimeout(1000);
    const snapshot = await page.evaluate(collectInPage);
    const metrics = await cdp.send("Performance.getMetrics");

    expect(snapshot.requestCount).toBeGreaterThan(0);
    expect(snapshot.transferBytes).toBeGreaterThan(0);
    expect(snapshot.lcpMs).toBeGreaterThan(0);

    runs.push({
      run: i + 1,
      wallMs: Date.now() - wallStart,
      coldLoad: { ...snapshot, ...pickMetrics(metrics.metrics, MAIN_THREAD_METRICS) },
    });
    await context.close();
  }

  await writeFile(
    path.join(output, "detail.json"),
    JSON.stringify({ ...runMetadata(browser, "detail", detail, runs.length), runs }, null, 2) + "\n",
  );
});
