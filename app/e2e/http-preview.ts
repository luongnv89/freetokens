import { test } from "@playwright/test";

/**
 * WebKit honours CSP `upgrade-insecure-requests` on http://127.0.0.1 and then
 * TLS-fails CSS/JS (Chromium leaves localhost on http). Replay those fetches
 * over http so webkit e2e actually hydrates (#254).
 */
test.beforeEach(async ({ page }) => {
  await page.route("https://127.0.0.1:4173/**", async (route) => {
    const response = await route.fetch({
      url: route.request().url().replace("https://127.0.0.1:4173", "http://127.0.0.1:4173"),
    });
    await route.fulfill({ response });
  });
});
