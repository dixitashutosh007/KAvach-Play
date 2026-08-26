import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToTab } from "./helpers/auth";

test.describe("Tab Navigation & Lazy Loading", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);
  });

  const tabs = ["Home", "Finance", "Matches", "Studio", "Club", "Settings"];

  for (const tabName of tabs) {
    test(`navigating to ${tabName} tab loads without error`, async ({ page }) => {
      await navigateToTab(page, tabName);

      await expect(
        page.getByText(/something went wrong|unhandled|chunk.*failed/i)
      ).not.toBeVisible();

      const mainContent = page.locator("main");
      await expect(mainContent).toBeVisible({ timeout: 10_000 });
    });
  }

  test("admin tab select has expected options", async ({ page }) => {
    const mobileSelect = page.locator('[data-testid="admin-tab-select"]');
    if (await mobileSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const options = await mobileSelect.locator("option").allTextContents();
      expect(options.some(o => /home/i.test(o))).toBeTruthy();
    }
  });
});
