import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady } from "./helpers/auth";

test.describe("Tab Navigation & Lazy Loading", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);
  });

  const tabs = [
    "Home",
    "Matches",
    "Players",
    "Finance",
    "Leaderboard",
    "Shop",
    "Studio",
    "Settings",
  ];

  for (const tabName of tabs) {
    test(`navigating to ${tabName} tab loads without error`, async ({ page }) => {
      const tabBtn = page
        .locator("nav button, [role='tab'], [data-tab]")
        .filter({ hasText: new RegExp(tabName, "i") });

      if (await tabBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await tabBtn.click();
        await page.waitForTimeout(1_000);

        // Should not show a crash/error boundary
        await expect(
          page.getByText(/something went wrong|unhandled|chunk.*failed/i)
        ).not.toBeVisible();

        // Tab content should appear (dynamic import resolved)
        const mainContent = page.locator("main, [data-testid='tab-content']");
        await expect(mainContent).toBeVisible({ timeout: 10_000 });
      }
    });
  }

  test("bottom nav highlights active tab", async ({ page }) => {
    const nav = page.locator("nav");
    if (await nav.isVisible().catch(() => false)) {
      const activeIndicator = nav.locator("[aria-current='page'], .text-accent, .active");
      await expect(activeIndicator).toBeVisible();
    }
  });
});
