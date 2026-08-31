import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToTab, navigateToClubSubTab } from "./helpers/auth";

test.describe("Club Tab Navigation", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);
    await navigateToTab(page, "Club");
  });

  test("club sub-tabs bar is visible", async ({ page }) => {
    await expect(page.locator('[data-testid="club-sub-tabs"]')).toBeVisible({ timeout: 10_000 });
  });

  test("Players sub-tab loads by default", async ({ page }) => {
    const playersTab = page.locator('[data-testid="club-sub-tab-players"]');
    await expect(playersTab).toBeVisible();
    const mainContent = await page.locator("main").textContent({ timeout: 10_000 });
    expect(mainContent!.length).toBeGreaterThan(0);
  });

  test("Board (Leaderboard) sub-tab loads", async ({ page }) => {
    const boardTab = page.locator('[data-testid="club-sub-tab-leaderboard"]');
    await expect(boardTab).toBeVisible({ timeout: 5_000 });
    await boardTab.click();
    await page.waitForTimeout(1_500);
    await expect(
      page.getByText(/something went wrong|unhandled|chunk.*failed/i)
    ).not.toBeVisible();
  });

  test("Reminders sub-tab loads", async ({ page }) => {
    const remindersTab = page.locator('[data-testid="club-sub-tab-reminders"]');
    await expect(remindersTab).toBeVisible({ timeout: 5_000 });
    await remindersTab.click();
    await page.waitForTimeout(1_500);
    await expect(
      page.getByText(/something went wrong|unhandled|chunk.*failed/i)
    ).not.toBeVisible();
  });

  test("Shop sub-tab loads when enabled", async ({ page }) => {
    const shopTab = page.locator('[data-testid="club-sub-tab-shop"]');
    if (await shopTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await shopTab.click();
      await page.waitForTimeout(1_500);
      await expect(page.locator('[data-testid="shop-sub-tabs"]')).toBeVisible({ timeout: 10_000 });
    }
  });

  test("Pulse sub-tab loads when enabled", async ({ page }) => {
    const pulseTab = page.locator('[data-testid="club-sub-tab-pulse"]');
    if (await pulseTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await pulseTab.click();
      await page.waitForTimeout(1_500);
      await expect(
        page.getByText(/something went wrong|unhandled|chunk.*failed/i)
      ).not.toBeVisible();
    }
  });

  test("no error boundary on any visible sub-tab", async ({ page }) => {
    const subTabs = page.locator('[data-testid^="club-sub-tab-"]');
    const count = await subTabs.count();
    for (let i = 0; i < count; i++) {
      await subTabs.nth(i).click();
      await page.waitForTimeout(1_500);
      await expect(
        page.getByText(/something went wrong|unhandled|chunk.*failed/i)
      ).not.toBeVisible();
    }
  });
});
