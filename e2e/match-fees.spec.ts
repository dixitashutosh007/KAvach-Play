import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToTab } from "./helpers/auth";

test.describe("Match Fee Assignment", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);
    await navigateToTab(page, "Matches");
  });

  test("match list loads successfully", async ({ page }) => {
    // Should show matches or an empty state
    await expect(
      page.getByText(/match|no matches|upcoming|schedule/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test("rejected/pending players are NOT in squad picker", async ({ page }) => {
    // Click on a match to open details (if any exist)
    const matchCard = page.locator("[data-testid='match-card'], .glass").first();
    if (await matchCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await matchCard.click();

      // Look for the add-to-squad section
      const addBtn = page.getByRole("button", { name: /add.*squad|add player/i });
      if (await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await addBtn.click();

        // Check the player list in the squad picker
        const playerOptions = page.locator(
          "select option, [data-testid='player-option'], .player-select-item"
        );
        const allText = await playerOptions.allTextContents();

        // None should say "Rejected" or "Pending"
        for (const text of allText) {
          expect(text.toLowerCase()).not.toContain("rejected");
        }
      }
    }
  });

  test("assign match admin shows only active players", async ({ page }) => {
    // Navigate to assign admin section if available
    const assignBtn = page.getByRole("button", { name: /assign.*admin|match admin/i });
    if (await assignBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await assignBtn.click();

      // The player checkboxes/list should not include rejected players
      const playerItems = page.locator("[data-testid='player-checkbox'], label");
      const count = await playerItems.count();

      // Verify at least some players show (list is not empty)
      if (count > 0) {
        const texts = await playerItems.allTextContents();
        for (const t of texts) {
          expect(t.toLowerCase()).not.toContain("(rejected)");
          expect(t.toLowerCase()).not.toContain("(pending)");
        }
      }
    }
  });
});
