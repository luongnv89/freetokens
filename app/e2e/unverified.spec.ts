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

  const sources = page.locator(".lead-sources a");
  const count = await sources.count();
  if ((await page.locator(".lead-card").count()) === 0) {
    await expect(
      page.getByRole("heading", { name: "Nothing unconfirmed right now" }),
    ).toBeVisible();
  }
  for (let i = 0; i < count; i++) {
    await expect(sources.nth(i)).toHaveAttribute(
      "rel",
      "nofollow ugc noopener noreferrer",
    );
  }
});
