import { expect, test } from "@playwright/test";
import "./http-preview";

const GA_URL_RE =
  /googletagmanager|google-analytics|analytics\.google\.com|doubleclick/i;

test("declining consent sends zero GA4 network requests", async ({ page }) => {
  const gaUrls: string[] = [];
  page.on("request", (request) => {
    if (GA_URL_RE.test(request.url())) gaUrls.push(request.url());
  });

  await page.goto("/index.html");
  const banner = page.locator("#ft-consent-banner");
  // Mounts with hidden until scheduleAnalyticsInit; wait on open state, not a
  // 5s toBeVisible that races WebKit idle.
  await expect(banner).not.toHaveAttribute("hidden", { timeout: 10000 });

  await page.locator("#ft-consent-decline").click();
  await expect(banner).toHaveAttribute("hidden");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("ft_ga_consent")))
    .toBe("denied");

  await page.waitForTimeout(2000);
  expect(gaUrls, `unexpected GA requests: ${gaUrls.join(", ")}`).toEqual([]);
});
