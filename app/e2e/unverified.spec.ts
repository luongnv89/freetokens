import { expect, test } from "@playwright/test";
import "./http-preview";

// Unverified tab (#660): reachable from the primary nav beside Archive, warns
// before anything else, and never passes link equity to lead sources.
test("Unverified page is linked from home and warns before the leads", async ({
  page,
}) => {
  await page.goto("/index.html");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("link", { name: "Unverified" }).click();
  await expect(page).toHaveURL(/\/unverified\.html$/);
  await expect(page.locator("h1")).toHaveText("Unverified offers");
  await expect(
    nav.getByRole("link", { name: "Unverified" }),
  ).toHaveAttribute("aria-current", "page");

  const banner = page.getByRole("note", { name: "Before you claim" });
  await expect(banner).toContainText("not confirmed on an official page");
  await expect(banner).toContainText("never DM anyone");

  // Leads render as the same ledger rows as offers, each linking to its
  // own unverified/<slug>.html page — never to an offers/ page.
  const rows = page.locator("#ft-unverified-grid > li > article.card");
  const rowCount = await rows.count();
  if (rowCount === 0) {
    await expect(
      page.getByRole("heading", { name: "Nothing unconfirmed right now" }),
    ).toBeVisible();
    return;
  }
  const title = rows.first().locator(".card-title a");
  const name = (await title.textContent())?.trim() ?? "";
  await expect(title).toHaveAttribute("href", /^unverified\/[a-z0-9-]+\.html$/);
  await title.click();
  await expect(page).toHaveURL(/\/unverified\/[a-z0-9-]+\.html$/);
  await expect(page.locator("h1")).toHaveText(name);
  await expect(
    page.getByRole("note", { name: "Before you claim" }),
  ).toBeVisible();
  await expect(page.locator(".od-cta")).toHaveCount(0);

  const sources = page.locator(".lead-sources:not(.lead-official) a");
  const count = await sources.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(sources.nth(i)).toHaveAttribute(
      "rel",
      "nofollow ugc noopener noreferrer",
    );
  }
});
