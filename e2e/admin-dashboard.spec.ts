import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToTab } from "./helpers/auth";

test.describe("Admin Dashboard", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);
    await navigateToTab(page, "Home");
  });

  test("dashboard loads without errors", async ({ page }) => {
    await expect(
      page.getByText(/something went wrong|unhandled/i)
    ).not.toBeVisible();
    const mainContent = await page.locator("main").textContent({ timeout: 10_000 });
    expect(mainContent).toBeTruthy();
  });

  test("Top Dues section is visible when data exists", async ({ page }) => {
    const topDues = page.locator('[data-testid="top-dues-section"]');
    if (await topDues.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(topDues.getByText("Top Dues")).toBeVisible();
      await expect(topDues.getByText("View All")).toBeVisible();
      await expect(topDues.locator("text=₹").first()).toBeVisible();
    }
  });

  test("Recent Transactions section is visible when data exists", async ({ page }) => {
    const recentTxns = page.locator('[data-testid="recent-transactions-section"]');
    if (await recentTxns.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(recentTxns.getByText("Recent Transactions")).toBeVisible();
      await expect(recentTxns.getByText("View All")).toBeVisible();
      await expect(recentTxns.locator("text=₹").first()).toBeVisible();
    }
  });

  test("Upcoming Matches section is visible", async ({ page }) => {
    const matches = page.getByText(/upcoming matches/i);
    const noMatches = page.getByText(/no upcoming/i);
    const hasMatches = await matches.isVisible({ timeout: 5_000 }).catch(() => false);
    const hasNoMatches = await noMatches.isVisible({ timeout: 3_000 }).catch(() => false);
    expect(hasMatches || hasNoMatches).toBeTruthy();
  });
});
