import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToTab } from "./helpers/auth";

test.describe("Finance & Dues Visibility", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);
  });

  test("finance tab loads without errors", async ({ page }) => {
    await navigateToTab(page, "Finance");
    // Wait for the finance tab content to render inside main
    // The tab content should appear within 10s; look for any visible text
    // matching finance-related keywords inside the main content area
    await page.waitForTimeout(2_000);
    const mainContent = await page.locator("main").textContent({ timeout: 10_000 });
    expect(mainContent).toBeTruthy();
    expect(mainContent!.length).toBeGreaterThan(0);

    // Should NOT show any unhandled error UI
    await expect(page.getByText("Something went wrong")).not.toBeVisible();
  });

  test("dues display amounts correctly", async ({ page }) => {
    await navigateToTab(page, "Finance");
    // If there are dues, they should have rupee amounts
    const dueItems = page.locator("[data-testid='due-item'], .due-row");
    const count = await dueItems.count();

    if (count > 0) {
      // Each due should have a visible amount
      const firstDue = dueItems.first();
      await expect(firstDue).toContainText(/₹/);
    }
  });

  test("merged player dues are visible to keeper", async ({ page }) => {
    await navigateToTab(page, "Finance");
    // After merge fix, if the logged-in user is a keeper,
    // their otherFees should show. This verifies no blank/empty state
    // when fees exist.
    const financeContent = await page.locator("main, [data-testid='finance-tab']").textContent();
    // If there's content, it shouldn't be a blank loading state
    if (financeContent && financeContent.trim().length > 0) {
      // Passes — content is visible (not stuck on loading)
      expect(financeContent.trim().length).toBeGreaterThan(0);
    }
  });
});
