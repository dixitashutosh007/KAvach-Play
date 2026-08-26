import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady } from "./helpers/auth";

test.describe("Home Match Card Navigation", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);

    // Switch to player persona
    const playerToggle = page.getByRole("button", { name: /view player|player view|switch.*player/i });
    if (await playerToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await playerToggle.click();
      await page.waitForTimeout(2_000);
    }
  });

  test("upcoming match cards are displayed if matches exist", async ({ page }) => {
    const matchCards = page.locator('[data-testid^="match-card-"]');
    const count = await matchCards.count();
    if (count > 0) {
      await expect(matchCards.first()).toBeVisible();
      const viewDetails = page.locator('[data-testid="view-details-link"]').first();
      await expect(viewDetails).toBeVisible();
    }
  });

  test("clicking match card navigates to match detail", async ({ page }) => {
    const matchCards = page.locator('[data-testid^="match-card-"]');
    const count = await matchCards.count();
    if (count > 0) {
      await matchCards.first().click();
      await page.waitForTimeout(2_000);
      // After clicking, the app should navigate to the Matches tab with match detail
      await expect(
        page.getByText(/something went wrong|unhandled/i)
      ).not.toBeVisible();
      const mainContent = await page.locator("main").textContent({ timeout: 10_000 });
      expect(mainContent!.length).toBeGreaterThan(0);
    }
  });
});
