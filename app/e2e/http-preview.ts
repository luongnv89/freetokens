import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Route } from "@playwright/test";

const DIST = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../dist",
);

// The webServer script strips `upgrade-insecure-requests` from dist HTML, so
// nothing upgrades to https on WebKit anymore. These routes still serve
// requests straight from dist/ — hermetic, and immune to the WebKit bug
// where interception silently stops working for a context (#254): if a route
// slips through, the real preview server answers the same http request with
// the same (already stripped) bytes.
async function serveFromDist(route: Route) {
  const { pathname } = new URL(route.request().url());
  let file = path.join(DIST, decodeURIComponent(pathname));
  if (!existsSync(file) || !statSync(file).isFile()) {
    file = path.join(file, "index.html");
  }
  if (existsSync(file) && statSync(file).isFile()) {
    await route.fulfill({ path: file });
  } else {
    await route.fulfill({ status: 404, body: "not found" });
  }
}

// Analytics + traffic counters hit real third-party hosts from e2e pages.
// Answering them locally keeps the suite hermetic; consent.spec still sees
// the `request` events it asserts on.
const EXTERNAL =
  /goatcounter\.com|gc\.zgo\.at|googletagmanager\.com|google-analytics\.com|doubleclick/i;

test.beforeEach(async ({ page }) => {
  await page.route(EXTERNAL, (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route("**://127.0.0.1:4173/**", serveFromDist);
});
