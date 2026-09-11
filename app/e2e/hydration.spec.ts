import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import "./http-preview";

// Hydration parity regression (#369): main.tsx must render the exact tree the
// prerenderer emitted — same base URL (stamped on #root as data-base-url) and
// same details map (route-guarded dynamic import). Any drift surfaces as a
// React hydration error (#418) in the console plus a full tree regeneration
// that wrecks total blocking time.

// React 19 ships minified hydration errors in production builds; match both
// the minified codes and the verbose dev spelling in case the build flag
// changes.
const HYDRATION_ERROR =
  /Minified React error #(418|423|425)|hydrat(e|ion)/i;

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const index = JSON.parse(
  readFileSync(path.join(APP_ROOT, "src/data/offers.json"), "utf8"),
);

function collectHydrationErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && HYDRATION_ERROR.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (HYDRATION_ERROR.test(error.message)) errors.push(error.message);
  });
  return errors;
}

test("home hydrates with no React hydration errors at a localhost origin", async ({
  page,
}) => {
  const errors = collectHydrationErrors(page);
  await page.goto("/index.html");
  // Allow the async boot (offers.json fetch + hydrateRoot) to settle.
  await page.waitForLoadState("networkidle");
  expect(errors, `hydration errors: ${errors.join(" | ")}`).toEqual([]);
});

test("detail page hydrates with no React hydration errors at a localhost origin", async ({
  page,
}) => {
  const withDetails =
    index.offers.find(
      (offer) => offer.status !== "expired" && offer.expiry_date,
    ) ?? index.offers[0];
  const errors = collectHydrationErrors(page);
  const detailsRequests = [];
  page.on("request", (request) => {
    if (/details-[A-Za-z0-9_-]+\.js/.test(request.url())) {
      detailsRequests.push(request.url());
    }
  });
  await page.goto(`/offers/${withDetails.slug}.html`);
  await page.waitForLoadState("networkidle");
  expect(errors, `hydration errors: ${errors.join(" | ")}`).toEqual([]);
  // The route-guarded dynamic import must run on a detail route.
  expect(detailsRequests.length).toBeGreaterThan(0);
  expect(await page.locator("h1").textContent()).toContain(withDetails.title);
});

test("home and archive never request the details data chunk", async ({
  page,
}) => {
  const jsRequests = [];
  page.on("request", (request) => {
    if (request.url().endsWith(".js")) jsRequests.push(request.url());
  });
  for (const route of ["/index.html", "/archive.html"]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
  }
  expect(
    jsRequests.filter((url) => /details/i.test(path.basename(url))),
    `details chunk requested on listing routes: ${jsRequests.join(", ")}`,
  ).toEqual([]);
});

test("detail page JSON-LD keeps the production base URL after hydration", async ({
  page,
}) => {
  await page.goto(`/offers/${index.offers[0].slug}.html`);
  await page.waitForLoadState("networkidle");
  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent();
  expect(jsonLd).toContain("https://freetokens.custats.info");
  expect(jsonLd).not.toContain("http://127.0.0.1:4173");
});

// Review fix (#369): a failed details.json import must skip hydration but
// still schedule analytics — the consent banner must not depend on the
// optional details map.
test("consent banner initializes even when the details chunk fails to load", async ({
  page,
}) => {
  const withDetails =
    index.offers.find(
      (offer) => offer.status !== "expired" && offer.expiry_date,
    ) ?? index.offers[0];
  await page.route(/details-[A-Za-z0-9_-]+\.js/, (route) => route.abort());
  const errors = collectHydrationErrors(page);
  await page.goto(`/offers/${withDetails.slug}.html`);
  await page.waitForLoadState("networkidle");
  // Prerendered content stays visible (no hydration = no mismatch errors).
  expect(errors, `hydration errors: ${errors.join(" | ")}`).toEqual([]);
  expect(await page.locator("h1").textContent()).toContain(withDetails.title);
  // scheduleAnalyticsInit still ran despite the failed import.
  await expect(page.locator("#ft-consent-banner")).toBeVisible({
    timeout: 5_000,
  });
});
