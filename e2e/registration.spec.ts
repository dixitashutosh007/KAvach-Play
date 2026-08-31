import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToClubSubTab } from "./helpers/auth";

test.describe("Registration & Duplicate Prevention", () => {
  test.describe("Admin - Add Player", () => {
    test.skip(
      !process.env.ADMIN_EMAIL,
      "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
    );

    test.beforeEach(async ({ page }) => {
      await signInAsAdmin(page);
      await waitForAppReady(page);
      await navigateToClubSubTab(page, "players");
      await page.waitForTimeout(1_000);
    });

    test("add player form is accessible to admin", async ({ page }) => {
      const addBtn = page.getByRole("button", { name: /add player/i });
      await expect(addBtn).toBeVisible({ timeout: 10_000 });
      await addBtn.click();
      await expect(page.getByPlaceholder(/dhoni/i)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByPlaceholder(/9876/i)).toBeVisible({ timeout: 5_000 });
    });

    test("shows duplicate warning for existing mobile number", async ({ page }) => {
      const addBtn = page.getByRole("button", { name: /add player/i });
      await expect(addBtn).toBeVisible({ timeout: 10_000 });
      await addBtn.click();

      await page.getByPlaceholder(/dhoni/i).fill("Test Duplicate");
      const firstPlayerMobile = await page
        .locator("[data-testid='player-mobile'], .text-white\\/50")
        .first()
        .textContent({ timeout: 5_000 })
        .catch(() => null);

      if (firstPlayerMobile) {
        const digits = firstPlayerMobile.replace(/\D/g, "").slice(-10);
        if (digits.length === 10) {
          await page.getByPlaceholder(/9876/i).fill(digits);
          await page.getByRole("button", { name: /^add player$/i }).click();

          await expect(
            page.getByText(/already exists|duplicate/i).first()
          ).toBeVisible({ timeout: 5_000 });
        }
      }
    });

    test("rejected players do not appear in active list", async ({ page }) => {
      const playerCards = page.locator("[data-testid='player-row'], .glass");
      const count = await playerCards.count();
      if (count > 0) {
        const playerNames = await playerCards.allTextContents();
        const hasRejectedLabel = playerNames.some(
          (t) => t.toLowerCase().includes("(rejected)")
        );
        expect(hasRejectedLabel).toBeFalsy();
      }
    });
  });
});
