import { test, expect } from "@playwright/test";

test.describe("Login & Authentication", () => {
  test("shows login screen on first visit", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/kavach play/i)).toBeVisible({ timeout: 15_000 });
  });

  test("shows phone login form by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder("9876543210")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="other-auth-options"]')).toBeVisible();
  });

  test("shows Google sign-in after switching from phone", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-testid="other-auth-options"]').click();
    const googleBtn = page.getByRole("button", { name: /google/i });
    await expect(googleBtn).toBeVisible({ timeout: 10_000 });
  });

  test("email sign-in fields appear after two-step toggle", async ({ page }) => {
    await page.goto("/");
    // Step 1: Leave phone form
    await page.locator('[data-testid="other-auth-options"]').click();
    // Step 2: Click email login toggle
    await page.locator('[data-testid="email-login-toggle"]').click();
    // Form fields should now be visible
    await expect(page.locator('[data-testid="email-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="submit-login"]')).toBeVisible();
  });

  test("invalid email/password shows error", async ({ page }) => {
    await page.goto("/");
    // Navigate to email form
    await page.locator('[data-testid="other-auth-options"]').click();
    await page.locator('[data-testid="email-login-toggle"]').click();
    // Fill invalid credentials
    await page.locator('[data-testid="email-input"]').fill("wrong@test.com");
    await page.locator('[data-testid="password-input"]').fill("wrongpass123");
    await page.locator('[data-testid="submit-login"]').click();
    // Should show error feedback
    await expect(
      page.getByText(/failed|error|invalid|incorrect/i)
    ).toBeVisible({ timeout: 15_000 });
  });
});
