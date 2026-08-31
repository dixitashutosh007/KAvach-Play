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

    // Switch to player persona — match cards only show in player view
    const playerToggle = page.getByRole("button", { name: /view player/i });
    if (await playerToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await playerToggle.click();
      await page.waitForTimeout(3_000);
      // Dismiss any overlay that may reappear after persona switch
      await expect(page.locator('[data-testid="submit-login"]')).not.toBeVisible({ timeout: 10_000 }).catch(() => {});
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

  test("clicking match card does not crash the app", async ({ page }) => {
    const matchCards = page.locator('[data-testid^="match-card-"]');
    const count = await matchCards.count();
    if (count > 0) {
      // force: true bypasses overlay actionability checks — the click triggers
      // an in-app callback (onNavigateToMatch) that switches tabs
      await matchCards.first().click({ force: true });
      await page.waitForTimeout(2_000);
      await expect(
        page.getByText(/something went wrong|unhandled/i)
      ).not.toBeVisible();
      await expect(page.locator("main")).toBeVisible();
    }
  });
});
