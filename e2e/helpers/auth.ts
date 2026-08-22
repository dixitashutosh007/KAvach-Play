import { Page, expect } from "@playwright/test";

/**
 * Sign in using email/password (for admin testing).
 * Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars.
 *
 * Login screen flow: Phone form → "Email / Google" → "Log in with Email & Password" → fill → Submit
 */
export async function signInAsAdmin(page: Page) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD env vars required for admin tests"
    );
  }

  await page.goto("/");

  // Wait for the login screen to render
  await expect(page.getByText(/kavach play/i)).toBeVisible({ timeout: 15_000 });

  // Step 1: Click "Email / Google" to leave the phone OTP form
  const otherAuthBtn = page.locator('[data-testid="other-auth-options"]');
  await expect(otherAuthBtn).toBeVisible({ timeout: 10_000 });
  await otherAuthBtn.click();

  // Step 2: Click "Log in with Email & Password" to reveal the email form
  const emailToggle = page.locator('[data-testid="email-login-toggle"]');
  await expect(emailToggle).toBeVisible({ timeout: 5_000 });
  await emailToggle.click();

  // Step 3: Fill in credentials
  const emailInput = page.locator('[data-testid="email-input"]');
  const passwordInput = page.locator('[data-testid="password-input"]');
  await expect(emailInput).toBeVisible({ timeout: 5_000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);

  // Step 4: Submit
  await page.locator('[data-testid="submit-login"]').click();

  // Step 5: Wait for the app to load past the login screen
  await expect(
    page.locator("main, [data-testid='main-tabs'], [data-testid='app-loaded']")
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Wait for the main app to be fully loaded (past loading/splash screens).
 */
export async function waitForAppReady(page: Page) {
  await page.waitForSelector("main, [data-testid='main-tabs']", {
    timeout: 30_000,
  });
  // Wait for any loading overlay to disappear
  await page
    .waitForFunction(
      () => !document.querySelector('[data-testid="loading-screen"]'),
      { timeout: 15_000 }
    )
    .catch(() => {});
}

/**
 * Navigate to a specific tab by clicking the bottom nav.
 */
export async function navigateToTab(page: Page, tabName: string) {
  const tab = page
    .locator("nav button, [role='tab'], [data-tab]")
    .filter({ hasText: new RegExp(tabName, "i") });
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(500);
  }
}
