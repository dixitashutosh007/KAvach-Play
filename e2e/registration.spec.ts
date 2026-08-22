import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToTab } from "./helpers/auth";

test.describe("Registration & Duplicate Prevention", () => {
  test.describe("Admin - Add Player", () => {
    test.skip(
      !process.env.ADMIN_EMAIL,
      "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
    );

    test.beforeEach(async ({ page }) => {
      await signInAsAdmin(page);
      await waitForAppReady(page);
      await navigateToTab(page, "Players");
    });

    test("add player form is accessible to admin", async ({ page }) => {
      const addBtn = page.getByRole("button", { name: /add player/i });
      await expect(addBtn).toBeVisible({ timeout: 10_000 });
      await addBtn.click();
      await expect(page.getByPlaceholder(/dhoni/i)).toBeVisible();
      await expect(page.getByPlaceholder(/9876/i)).toBeVisible();
    });

    test("shows duplicate warning for existing mobile number", async ({ page }) => {
      const addBtn = page.getByRole("button", { name: /add player/i });
      await addBtn.click();

      // Try adding with a mobile that likely exists (we'll use a known one)
      // This test verifies the UI shows a warning — requires at least one player
      await page.getByPlaceholder(/dhoni/i).fill("Test Duplicate");
      // Use a number that the first player in the list has
      const firstPlayerMobile = await page
        .locator("[data-testid='player-mobile'], .text-white\\/50")
        .first()
        .textContent();

      if (firstPlayerMobile) {
        const digits = firstPlayerMobile.replace(/\D/g, "").slice(-10);
        await page.getByPlaceholder(/9876/i).fill(digits);
        await page.getByRole("button", { name: /^add player$/i }).click();

        // Should show duplicate warning
        await expect(
          page.getByText(/already exists|duplicate/i)
        ).toBeVisible({ timeout: 5_000 });
      }
    });

    test("rejected players do not appear in active list", async ({ page }) => {
      // Check that the main player list doesn't show rejected players by default
      const showDisabled = page.getByText(/show disabled|show rejected/i);
      // If there's a toggle for disabled, the main list shouldn't have them
      const playerNames = await page.locator("[data-testid='player-row'], .glass").allTextContents();
      const hasRejectedLabel = playerNames.some(
        (t) => t.toLowerCase().includes("rejected")
      );
      // By default, rejected shouldn't be visible in the main list
      expect(hasRejectedLabel).toBeFalsy();
    });
  });
});
