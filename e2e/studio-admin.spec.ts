import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToTab } from "./helpers/auth";

test.describe("Studio Admin Tab", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);
    await navigateToTab(page, "Studio");
  });

  test("studio tab loads without errors", async ({ page }) => {
    const mainContent = await page.locator("main").textContent({ timeout: 10_000 });
    expect(mainContent).toBeTruthy();
    await expect(
      page.getByText(/something went wrong|unhandled/i)
    ).not.toBeVisible();
  });

  test("No Show button is present", async ({ page }) => {
    await expect(
      page.locator('[data-testid="studio-no-show-button"]')
    ).toBeVisible({ timeout: 10_000 });
  });

  test("No Show modal opens and closes", async ({ page }) => {
    await page.locator('[data-testid="studio-no-show-button"]').click();
    const modal = page.locator('[data-testid="studio-no-show-modal"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/no show/i).first()).toBeVisible();

    // Close via X button
    const closeBtn = modal.locator("button").filter({ has: page.locator("svg") }).first();
    await closeBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 3_000 });
  });

  test("PNA tab visible when feature enabled", async ({ page }) => {
    const studioTabs = page.locator('[data-testid="studio-tabs"]');
    if (await studioTabs.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const pnaTab = page.locator('[data-testid="studio-pna-tab"]');
      await expect(pnaTab).toBeVisible();
      await pnaTab.click();
      await page.waitForTimeout(1_500);
      await expect(
        page.getByText(/something went wrong|unhandled/i)
      ).not.toBeVisible();
    }
  });

  test("Studio members content is visible", async ({ page }) => {
    const membersBtn = page.getByRole("button", { name: /studio members/i });
    const content = page.getByText(/studio member|no studio/i);
    const hasMembers = await membersBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    const hasContent = await content.isVisible({ timeout: 5_000 }).catch(() => false);
    expect(hasMembers || hasContent).toBeTruthy();
  });
});
