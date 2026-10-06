import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import "./http-preview";

// Home offer-list pagination (#548): the listing renders PAGE_SIZE rows per
// page behind real ?page=N links, the prerender ships page 1, and every
// refinement resets to the first page.

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const index = JSON.parse(
  readFileSync(path.join(APP_ROOT, "src/data/offers.json"), "utf8"),
);
const active = index.offers
  .filter((offer: { status: string }) => offer.status !== "expired")
  .map((offer: { slug: string }) => offer.slug);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ft_ga_consent", "denied");
  });
});

// The prerendered grid is visible before hydration; gate interactions on
// the __reactContainer marker so clicks reach the live handlers.
async function waitForHydration(page: Page) {
  await page.waitForFunction(() =>
    Object.keys(document.getElementById("root") ?? {}).some((k) =>
      k.startsWith("__reactContainer"),
    ),
  );
}

test("home shows the first page of rows plus the pager", async ({ page }) => {
  await page.goto("/index.html");
  await waitForHydration(page);
  await expect(page.locator("#ft-grid article.card")).toHaveCount(20);
  await expect(page.locator("#ft-pager")).toBeVisible();
  await expect(page.locator(`#offer-${active[0]}`)).toBeVisible();
});

test("page 2 swaps the window, focuses the grid, and updates the status", async ({
  page,
}) => {
  await page.goto("/index.html");
  await waitForHydration(page);
  await page.locator('#ft-pager a[aria-label="Page 2"]').click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator("#ft-grid article.card").first()).toHaveAttribute(
    "id",
    `offer-${active[20]}`,
  );
  await expect(page.locator("#ft-grid")).toBeFocused();
  await expect(page.locator("#ft-results-status")).toContainText("21–40");
  // A page change scrolls the status line back into view.
  await expect(page.locator("#ft-results-status")).toBeInViewport();
});

test("pager stays on one line at 320 px on the first and middle pages", async ({
  page,
}) => {
  const pageTotal = Math.ceil(active.length / 20);
  test.skip(pageTotal < 2, "catalog fits on one page");
  const mid = Math.ceil(pageTotal / 2);
  await page.setViewportSize({ width: 320, height: 690 });
  const navHeight = async () =>
    page.evaluate(() => {
      const nav = document.getElementById("ft-pager");
      if (!nav) return { nav: 0, item: 0 };
      const item = nav.querySelector(".pager-step, .pager-page");
      return {
        nav: nav.getBoundingClientRect().height,
        item: item?.getBoundingClientRect().height ?? 0,
      };
    });
  for (const n of [1, mid]) {
    await page.goto(`/index.html${n > 1 ? `?page=${n}` : ""}`);
    await waitForHydration(page);
    // Deep links swap aria-current after hydration; wait for the applied page.
    await expect(
      page.locator('#ft-pager a[aria-current="page"]'),
    ).toHaveText(String(n));
    const { nav, item } = await navHeight();
    expect(nav, `pager wraps at 320px on page ${n}`).toBeGreaterThan(0);
    // One line: the nav is exactly as tall as a single link.
    expect(Math.abs(nav - item)).toBeLessThanOrEqual(1);
  }
});

test("back restores the first page with no page param", async ({ page }) => {
  await page.goto("/index.html");
  await waitForHydration(page);
  await page.locator('#ft-pager a[aria-label="Page 2"]').click();
  await expect(page.locator("#ft-grid article.card").first()).toHaveAttribute(
    "id",
    `offer-${active[20]}`,
  );
  await page.goBack();
  await expect(page.locator("#ft-grid article.card").first()).toHaveAttribute(
    "id",
    `offer-${active[0]}`,
  );
  expect(new URL(page.url()).searchParams.get("page")).toBeNull();
});

test("deep link ?page=2 renders the second window after hydration", async ({
  page,
}) => {
  await page.goto("/index.html?page=2");
  await waitForHydration(page);
  await expect(page.locator("#ft-grid article.card").first()).toHaveAttribute(
    "id",
    `offer-${active[20]}`,
  );
});

test("typing a search from ?page=2 drops the page param", async ({ page }) => {
  await page.goto("/index.html?page=2");
  await waitForHydration(page);
  await expect(page.locator("#ft-grid article.card").first()).toHaveAttribute(
    "id",
    `offer-${active[20]}`,
  );
  await page.locator("#ft-search").fill("cursor");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"), { timeout: 3000 })
    .toBe("cursor");
  expect(new URL(page.url()).searchParams.get("page")).toBeNull();
  // The filtered result fits one page and the pager is gone.
  await expect(page.locator("#ft-pager")).toHaveCount(0);
});
