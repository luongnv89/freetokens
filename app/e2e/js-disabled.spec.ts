import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });

test("home prerenders the offer grid without JS", async ({ page }) => {
  await page.goto("/index.html");
  const grid = page.locator("ol#ft-grid");
  await expect(grid).toBeAttached();
  await expect(page.locator("article.card").first()).toBeAttached();
  await expect(page.getByText("GitHub Copilot", { exact: false }).first()).toBeVisible();
  const rootMarkup = await page.locator("#root").innerHTML();
  expect(rootMarkup.trim().length).toBeGreaterThan(200);
});

test("offer detail prerenders full content without JS", async ({ page }) => {
  await page.goto("/offers/cursor-hobby-plan.html");
  await expect(page.locator("h1")).toContainText(/Cursor/i);
  await expect(page.locator("a.od-cta")).toBeVisible();
  await expect(page.locator("[data-ft-checklist]")).toBeVisible();
  const rootMarkup = await page.locator("#root").innerHTML();
  expect(rootMarkup.trim().length).toBeGreaterThan(200);
});
