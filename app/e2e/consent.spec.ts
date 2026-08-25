import { expect, test } from "@playwright/test";

const GA_URL_RE =
  /googletagmanager|google-analytics|analytics\.google\.com|doubleclick/i;

test("declining consent sends zero GA4 network requests", async ({ page }) => {
  const gaUrls: string[] = [];
  page.on("request", (request) => {
    if (GA_URL_RE.test(request.url())) gaUrls.push(request.url());
  });

  await page.goto("/index.html");
  const banner = page.locator("#ft-consent-banner");
  await expect(banner).toBeVisible({ timeout: 5000 });

  await page.locator("#ft-consent-decline").click();
  await expect(banner).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("ft_ga_consent")))
    .toBe("denied");

  await page.waitForTimeout(2000);
  expect(gaUrls, `unexpected GA requests: ${gaUrls.join(", ")}`).toEqual([]);
});
