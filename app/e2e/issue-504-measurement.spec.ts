import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import "./http-preview";

// Deliberate evidence collection, not a catalog-dependent gate on every CI run.
// Run from app/: ISSUE_504_CAPTURE=1 npx playwright test issue-504 --project=chromium --workers=1
const capture = process.env.ISSUE_504_CAPTURE === "1";
const output = path.resolve("../docs/qa/issue-504");
const detail = "/offers/aerolink-starter-free-trial.html";
const row = "#offer-aerolink-starter-free-trial";
const missing = "no-such-provider-issue-504";

async function ready(page: Page) {
  await page.waitForFunction(() =>
    Object.keys(document.getElementById("root") ?? {}).some((key) =>
      key.startsWith("__reactContainer"),
    ),
  );
  await page.evaluate(() => document.fonts.ready);
}

async function settled(page: Page, query: string, count: number) {
  await expect(page.locator("#ft-search")).toHaveValue(query);
  await expect.poll(() => new URL(page.url()).searchParams.get("q") ?? "").toBe(query);
  await expect(page.locator("#ft-grid > li")).toHaveCount(count);
  await expect(page.locator("#ft-results-status")).toContainText(String(count));
  if (query === "aerolink") await expect(page.locator(row)).toBeVisible();
}

// Runtime DOM geometry and computed, alpha-composited colors. This is not a
// pixel sampler or full WCAG audit: unsupported paint is explicitly excluded.
async function measure(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const name = (el: Element) => {
      const ids = el.getAttribute("aria-labelledby")?.split(/\s+/);
      const labelled = ids?.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      const labels = "labels" in el ? (el as HTMLInputElement).labels : null;
      return (labelled || el.getAttribute("aria-label") ||
        (labels && Array.from(labels).map((label) => label.textContent).join(" ")) ||
        el.textContent || "").replace(/\s+/g, " ").trim();
    };
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      return el.getClientRects().length > 0 && s.visibility === "visible" && s.display !== "none";
    };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (color: string): number[] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const composite = (fg: number[], bg: number[]) =>
      fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const luminance = (rgb: number[]) => rgb.reduce((sum, channel, i) => {
      const c = channel / 255;
      return sum + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
    }, 0);
    const contrast = Array.from(document.querySelectorAll("main *, .site-header *"))
      .filter((el) => visible(el) && Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()))
      // One representative offer row on unfiltered home keeps evidence bounded.
      .filter((el) => !el.closest("#ft-grid > li") || el.closest("#ft-grid > li") === document.querySelector("#ft-grid > li"))
      .map((el) => {
        const s = getComputedStyle(el);
        const chain: Element[] = [];
        for (let node: Element | null = el; node; node = node.parentElement) chain.unshift(node);
        let background = [255, 255, 255];
        const unsupported: string[] = [];
        let complexBackground = false;
        for (const node of chain) {
          const style = getComputedStyle(node);
          
          if (Number(style.opacity) !== 1) unsupported.push("group opacity");
          if (style.mixBlendMode !== "normal" || style.filter !== "none") unsupported.push("blend/filter");
          const color = rgba(style.backgroundColor);
          // An opaque descendant covers ancestor gradients/images.
          if (color[3] === 1) complexBackground = false;
          if (style.backgroundImage !== "none") complexBackground = true;
          background = composite(color, background);
        }
        if (complexBackground) unsupported.push("background image/gradient");
        const fg = rgba(s.color);
        const foreground = fg ? composite(fg, background) : null;
        const ratio = foreground && unsupported.length === 0
          ? (Math.max(luminance(foreground), luminance(background)) + 0.05) /
            (Math.min(luminance(foreground), luminance(background)) + 0.05) : null;
        const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.667 && Number(s.fontWeight) >= 700);
        return { text: el.textContent?.replace(/\s+/g, " ").trim().slice(0, 160),
          tag: el.tagName, class: el.className, decorative: Boolean(el.closest('[aria-hidden="true"]')), rect: rect(el), color: s.color,
          background, foreground, fontSize: s.fontSize, fontWeight: s.fontWeight,
          ratio: ratio === null ? null : Number(ratio.toFixed(3)), threshold: large ? 3 : 4.5,
          meetsThreshold: ratio === null ? null : ratio >= (large ? 3 : 4.5),
          unsupported: [...new Set(unsupported)] };
      });
    const targets = Array.from(document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]"))
      .filter(visible)
      .filter((el) => !el.closest("#ft-grid > li") || el.closest("#ft-grid > li") === document.querySelector("#ft-grid > li"))
      .map((el) => { const r = rect(el); return { name: name(el), tag: el.tagName, id: el.id,
        rect: r, below24: r.width < 24 || r.height < 24, below44: r.width < 44 || r.height < 44 }; });
    return { url: location.pathname + location.search,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio, visualScale: visualViewport?.scale },
      scroll: { x: scrollX, y: scrollY },
      overflow: { html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth },
      input: (document.querySelector("#ft-search") as HTMLInputElement | null)?.value ?? null,
      results: document.querySelectorAll("#ft-grid > li").length,
      status: document.querySelector("#ft-results-status")?.textContent ?? null,
      statusSemantics: { role: document.querySelector("#ft-results-status")?.getAttribute("role") ?? null,
        live: document.querySelector("#ft-results-status")?.getAttribute("aria-live") ?? null },
      targets, contrast };
  });
}

async function tabWalk(page: Page, width: number, surface: string) {
  const steps = [];
  const seen = new Set<string>();
  for (let index = 0; index < 80; index++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement === document.body)) break;
    const snapshot = await page.locator(":focus").ariaSnapshot({ timeout: 1000 }).catch(() => "");
    const step = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const points = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];
      const hits = points.map(([x, y]) => {
        const top = document.elementFromPoint(r.x + r.width * x, r.y + r.height * y);
        return top === el || (top !== null && el.contains(top));
      });
      return { tabStopIndex: Array.from(document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]")).indexOf(el),
        tag: el.tagName, id: el.id, text: el.textContent?.replace(/\s+/g, " ").trim(),
        category: el.getAttribute("data-ft-category"), href: el.getAttribute("href"),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        fullyInViewport: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        unobscuredSamples: hits.filter(Boolean).length, hitTestSamples: hits.length,
        focusVisible: el.matches(":focus-visible"), outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`,
        boxShadow: s.boxShadow };
    });
    const key = String(step.tabStopIndex);
    if (seen.has(key)) break;
    seen.add(key);
    steps.push({ index: index + 1, accessibleSnapshot: snapshot, ...step });
    // Retain selected visible focus states; all other stops stay in JSON.
    if (step.id === "ft-search" || step.category === "coding" || step.href === "https://aerolink.lat/pricing") {
      await page.screenshot({ path: path.join(output, `${width}-${surface}-focus-${index + 1}.jpg`), quality: 85 });
    }
    if (surface === "home" && step.id === "ft-saved-toggle") break;
  }
  return steps;
}

for (const width of [320, 375, 768, 1440]) {
  test(`issue 504 runtime evidence at ${width} CSS px`, async ({ page, browser, browserName }) => {
    test.skip(!capture || browserName !== "chromium", "Opt-in Chromium measurement; no tracked artifacts during normal CI");
    test.setTimeout(90000);
    await mkdir(output, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem("ft_ga_consent", "denied"));
    await page.goto("/index.html");
    await ready(page);
    const count = await page.locator("#ft-grid > li").count();
    expect(count).toBeGreaterThan(0);
    await settled(page, "", count);
    const states = [];
    const record = async (state: string) => {
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)));
      });
      const evidence = await measure(page);
      const screenshot = `${width}-${state}.jpg`;
      await page.screenshot({ path: path.join(output, screenshot), quality: 85, fullPage: state === "detail" });
      states.push({ state, screenshot, ...evidence });
    };
    await record("home");
    const homeFocus = await tabWalk(page, width, "home");
    expect(homeFocus.some((step) => step.id === "ft-search")).toBe(true);
    expect(homeFocus.some((step) => step.category === "coding")).toBe(true);
    await page.locator("#ft-search").fill("aerolink");
    await settled(page, "aerolink", 1);
    await page.locator(".toolbar").scrollIntoViewIfNeeded();
    await record("provider");
    await page.locator("#ft-search").fill(missing);
    await settled(page, missing, 0);
    await record("empty");
    await page.locator("#ft-reset-filters").click();
    await settled(page, "", count);
    await expect(page.locator("#ft-search")).toBeFocused();
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await record("recovery");
    await page.goBack();
    await settled(page, missing, 0);
    await record("back-empty");
    await page.goBack();
    await settled(page, "aerolink", 1);
    await record("back-provider");
    await page.goForward();
    await settled(page, missing, 0);
    await record("forward-empty");
    await page.goForward();
    await settled(page, "", count);
    await record("forward-recovery");
    await page.goto(detail);
    await ready(page);
    await expect(page.locator("h1")).toContainText("Aerolink");
    await expect(page.locator("a.od-cta").first()).toHaveAttribute("href", "https://aerolink.lat/pricing");
    await record("detail");
    const detailFocus = await tabWalk(page, width, "detail");
    expect(detailFocus.some((step) => step.href === "https://aerolink.lat/pricing")).toBe(true);
    const evidence = { capturedAt: new Date().toISOString(),
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      browser: { name: browserName, version: browser.version(), headless: true },
      zoom: { desktop: "not measured; default automation context", emulation: "none", requested200Percent: "pending manual browser zoom" },
      limitations: ["Consent pre-dismissed; no consent-overlay coverage", "First home row only for target/contrast sampling",
        "Computed rendered color compositing, not screenshot pixel sampling; pseudo-elements, overlapping siblings and antialiasing not modeled",
        "ARIA snapshots are control-name evidence, not screen-reader speech", "Five focus hit-test samples do not prove entire outline unobscured",
        "24/44px flags are dimensions, not WCAG target-spacing exception verdicts"],
      states, keyboard: { home: homeFocus, detail: detailFocus } };
    await writeFile(path.join(output, `${width}.json`), JSON.stringify(evidence, null, 2) + "\n");
  });
}
