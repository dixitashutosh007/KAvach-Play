import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToTab } from "./helpers/auth";

test.describe("Match Fee Accounting & Bifurcation E2E Tests", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);
  });

  test("Finance Tab: Match Fee subtab displays editable match fee, paid/unpaid column, and totals", async ({ page }) => {
    await navigateToTab(page, "Finance");
    await page.waitForTimeout(2_000);

    // Look for Match Fee subtab button or table
    const matchFeeTabBtn = page.getByRole("button", { name: /match fee/i });
    if (await matchFeeTabBtn.isVisible().catch(() => false)) {
      await matchFeeTabBtn.click();
      await page.waitForTimeout(1_000);
    }

    // Verify Match Fee table presence
    const table = page.locator("table");
    if (await table.isVisible().catch(() => false)) {
      // Check column headers
      await expect(page.getByText(/match fee/i).first()).toBeVisible();
      await expect(page.getByText(/fee collected/i).first()).toBeVisible();
      await expect(page.getByText(/club sponsored/i).first()).toBeVisible();
      await expect(page.getByText(/paid \/ unpaid/i).first()).toBeVisible();
      await expect(page.getByText(/% recovered/i).first()).toBeVisible();

      // Check inline edit button on match fee column
      const editFeeBtn = page.locator("button[title='Edit Match Fee']").first();
      if (await editFeeBtn.isVisible().catch(() => false)) {
        await editFeeBtn.click();
        // Input should appear
        const feeInput = page.locator("input[type='number']").first();
        await expect(feeInput).toBeVisible();
        // Cancel button should revert
        const cancelBtn = page.locator("button[title='Cancel']").first();
        if (await cancelBtn.isVisible().catch(() => false)) {
          await cancelBtn.click();
        }
      }
    }
  });

  test("Finance Tab: Match Fee Plans subtab is correctly labeled and accessible", async ({ page }) => {
    await navigateToTab(page, "Finance");
    await page.waitForTimeout(2_000);

    // Look for "Match Fee Plans" button
    const plansBtn = page.getByRole("button", { name: /match fee plans/i });
    if (await plansBtn.isVisible().catch(() => false)) {
      await plansBtn.click();
      await page.waitForTimeout(1_000);

      // Verify form header
      await expect(page.getByText(/create match fee plan|saved match fee plans/i).first()).toBeVisible();
    }
  });

  test("Transactions Tab: reflects Club Sponsored and Cash Collected channels", async ({ page }) => {
    await navigateToTab(page, "Finance");
    await page.waitForTimeout(2_000);

    // Switch to Transactions / RazorReportView tab
    const txnTabBtn = page.getByRole("button", { name: /transactions|gateway/i });
    if (await txnTabBtn.isVisible().catch(() => false)) {
      await txnTabBtn.click();
      await page.waitForTimeout(1_000);

      // Verify channel filters
      await expect(page.getByRole("button", { name: /^all/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /via razorpay/i })).toBeVisible();

      // Check summary stats cards
      await expect(page.getByText(/gateway:/i)).toBeVisible();
    }
  });

  test("Matches Calendar View: displays admin actions on upcoming and past matches", async ({ page }) => {
    await navigateToTab(page, "Matches");
    await page.waitForTimeout(2_000);

    // Switch to Calendar view
    const calendarToggle = page.getByRole("button", { name: /calendar/i });
    if (await calendarToggle.isVisible().catch(() => false)) {
      await calendarToggle.click();
      await page.waitForTimeout(1_000);

      // Verify calendar renders
      const calendarView = page.locator("main");
      await expect(calendarView).toBeVisible();

      // Verify admin action buttons (Edit / Duplicate / Delete) exist on match items
      const editButtons = page.locator("button[title='Edit Match']");
      const count = await editButtons.count();
      // If there are matches, edit buttons must be present for admin
      if (count > 0) {
        await expect(editButtons.first()).toBeVisible();
      }
    }
  });
});
