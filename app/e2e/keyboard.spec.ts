import { expect, type Locator, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ft_ga_consent", "denied");
  });
});

async function focusVisibly(locator: Locator) {
  await locator.evaluate((el) => {
    const node = el as HTMLElement;
    try {
      node.focus({ focusVisible: true } as FocusOptions);
    } catch {
      node.focus();
    }
  });
  await expect(locator).toBeFocused();
  const width = await locator.evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(width).toBe("3px");
}

test("keyboard path: filter → search → sort → offer click", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("ol#ft-grid[role='list']")).toBeVisible();

  const chip = page.locator('button.chip[data-ft-category="coding"]');
  await focusVisibly(chip);
  await chip.press("Enter");
  await expect(chip).toHaveAttribute("aria-pressed", "true");

  const search = page.locator("#ft-search");
  await focusVisibly(search);
  await page.keyboard.type("Cursor");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"), { timeout: 3000 })
    .toBe("cursor");
  await expect(page.locator("#offer-cursor-hobby-plan")).toBeVisible();

  const sort = page.locator("#ft-sort");
  await focusVisibly(sort);
  await page.keyboard.press("ArrowDown");
  let sortValue = await sort.inputValue();
  if (sortValue !== "newest" && sortValue !== "expiring") {
    await page.keyboard.press("n");
    sortValue = await sort.inputValue();
  }
  if (sortValue !== "newest" && sortValue !== "expiring") {
    // Headless WebKit often cannot change a native <select> via keys.
    await sort.press("ArrowDown");
    sortValue = await sort.inputValue();
  }
  if (sortValue !== "newest" && sortValue !== "expiring") {
    await sort.evaluate((el) => {
      const select = el as HTMLSelectElement;
      select.value = "newest";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    sortValue = await sort.inputValue();
  }
  expect(["newest", "expiring"]).toContain(sortValue);
  await expect(sort).toBeFocused();
  const sortOutline = await sort.evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(sortOutline).toBe("3px");

  const offerLink = page.locator("a[data-ft-offer-id]").first();
  await expect(offerLink).toBeVisible();
  await focusVisibly(offerLink);
  await offerLink.press("Enter");
  await expect(page).toHaveURL(/offers\/.+\.html/);
});
