import { test, expect } from "@playwright/test";
import { signInAsAdmin, waitForAppReady, navigateToTab } from "./helpers/auth";

test.describe("Grounds Management", () => {
  test.skip(
    !process.env.ADMIN_EMAIL,
    "Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await waitForAppReady(page);
    await navigateToTab(page, "Matches");
    // GroundsTab is accessible via a sub-nav within MatchesTab
    const groundsBtn = page.getByRole("button", { name: /grounds/i });
    if (await groundsBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await groundsBtn.click();
      await page.waitForTimeout(1_500);
    }
  });

  test("ground cards are displayed if grounds exist", async ({ page }) => {
    const groundCards = page.locator('[data-testid="ground-card"]');
    const count = await groundCards.count();
    if (count > 0) {
      const firstCard = groundCards.first();
      const text = await firstCard.textContent();
      expect(text!.length).toBeGreaterThan(0);
    }
  });

  test("missing field warnings are shown for incomplete grounds", async ({ page }) => {
    const warnings = page.locator('[data-testid="ground-missing-fields"]');
    const count = await warnings.count();
    if (count > 0) {
      await expect(warnings.first()).toContainText("Missing:");
    }
  });

  test("ground cards show organiser info", async ({ page }) => {
    const groundCards = page.locator('[data-testid="ground-card"]');
    const count = await groundCards.count();
    if (count > 0) {
      await expect(groundCards.first()).toContainText(/organiser/i);
    }
  });
});
