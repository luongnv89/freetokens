import { expect, test } from "@playwright/test";
import "./http-preview";

test.use({ viewport: { width: 320, height: 690 } });

const ROUTES = [
  "/index.html",
  "/archive.html",
  "/privacy.html",
  "/offers/cursor-hobby-plan.html",
] as const;

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    return {
      html: html.scrollWidth - html.clientWidth,
      body: body.scrollWidth - body.clientWidth,
    };
  });
  expect(overflow.html, "documentElement horizontal overflow").toBeLessThanOrEqual(0);
  expect(overflow.body, "body horizontal overflow").toBeLessThanOrEqual(0);
}

for (const route of ROUTES) {
  test(`${route} has no horizontal overflow at 320px`, async ({ page }) => {
    await page.goto(route);
    if (route === "/index.html") {
      await expect(page.locator("ol#ft-grid")).toBeVisible();
    } else if (route === "/archive.html") {
      await expect(page.locator("h1")).toHaveText(/Expired offer archive|The archive is empty/);
    } else if (route === "/privacy.html") {
      await expect(page.locator("h1")).toHaveText("Privacy Policy");
    } else {
      await expect(page.locator("h1")).toContainText(/Cursor/i);
    }
    await assertNoHorizontalOverflow(page);
  });
}
