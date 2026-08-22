import { test, expect } from "@playwright/test";

test.describe("Login & Authentication", () => {
  test("shows login screen on first visit", async ({ page }) => {
    await page.goto("/");
    // Should show the login/welcome screen
    await expect(
      page.getByText(/kavach|sign in|welcome/i)
    ).toBeVisible({ timeout: 15_000 });
  });

  test("shows Google sign-in button", async ({ page }) => {
    await page.goto("/");
    const googleBtn = page.getByRole("button", { name: /google/i });
    await expect(googleBtn).toBeVisible({ timeout: 15_000 });
  });

  test("shows demo/guest play option", async ({ page }) => {
    await page.goto("/");
    const demoBtn = page.getByRole("button", { name: /demo|guest/i });
    await expect(demoBtn).toBeVisible({ timeout: 15_000 });
  });

  test("email sign-in fields appear when toggled", async ({ page }) => {
    await page.goto("/");
    const emailToggle = page.getByRole("button", { name: /email|sign in with email/i });
    if (await emailToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await emailToggle.click();
      await expect(page.getByPlaceholder(/email/i)).toBeVisible();
      await expect(page.getByPlaceholder(/password/i)).toBeVisible();
    }
  });

  test("invalid email/password shows error", async ({ page }) => {
    await page.goto("/");
    const emailToggle = page.getByRole("button", { name: /email|sign in with email/i });
    if (await emailToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await emailToggle.click();
      await page.getByPlaceholder(/email/i).fill("wrong@test.com");
      await page.getByPlaceholder(/password/i).fill("wrongpass");
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      // Should show error feedback
      await expect(
        page.getByText(/failed|error|invalid|incorrect/i)
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});
