import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToTab, expandSettingsSection } from "./helpers/auth";

test.describe("Settings Feature Toggles", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);
    await navigateToTab(page, "Settings");
  });

  test("settings page loads", async ({ page }) => {
    const mainContent = await page.locator("main").textContent({ timeout: 10_000 });
    expect(mainContent).toBeTruthy();
    await expect(
      page.getByText(/something went wrong|unhandled/i)
    ).not.toBeVisible();
  });

  test("App Features section can be expanded", async ({ page }) => {
    await expandSettingsSection(page, "app-features-section");
    await expect(
      page.locator('[data-testid="feature-toggle-payments"]')
    ).toBeVisible({ timeout: 5_000 });
  });

  test("PNA feature toggle is present", async ({ page }) => {
    await expandSettingsSection(page, "app-features-section");
    await expect(
      page.locator('[data-testid="feature-toggle-pna"]')
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(/player not available.*pna.*report/i)
    ).toBeVisible();
  });

  test("all expected feature toggles exist", async ({ page }) => {
    await expandSettingsSection(page, "app-features-section");
    const expectedKeys = ["payments", "studio", "leaderboard", "feed", "matches", "shop", "pna"];
    for (const key of expectedKeys) {
      await expect(
        page.locator(`[data-testid="feature-toggle-${key}"]`)
      ).toBeVisible({ timeout: 5_000 });
    }
  });
});
