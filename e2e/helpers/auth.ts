import { Page, expect } from "@playwright/test";

/**
 * Sign in using the demo player flow (anonymous or email/password fallback).
 * After this helper returns, the user is past the login screen.
 */
export async function signInAsDemo(page: Page) {
  await page.goto("/");
  // Wait for the login screen to appear
  const demoBtn = page.getByRole("button", { name: /demo|guest|play as guest/i });
  await expect(demoBtn).toBeVisible({ timeout: 15_000 });
  await demoBtn.click();
  // Wait for either the registration form (first-time demo) or the main app
  await expect(
    page.locator('[data-testid="app-loaded"], [data-testid="main-tabs"]').or(
      page.getByText(/first time here|submit request|loading/i)
    )
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Sign in with email/password (for admin testing).
 * Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars.
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
  // Click the email/password sign-in toggle if present
  const emailToggle = page.getByRole("button", { name: /email|sign in with email/i });
  if (await emailToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await emailToggle.click();
  }

  await page.getByPlaceholder(/email/i).fill(email);
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in|submit/i }).click();

  // Wait for the app to load
  await expect(page.getByText(/loading/i).or(page.locator("main"))).toBeVisible({
    timeout: 20_000,
  });
  // Wait for loading to finish
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="loading-screen"]'),
    { timeout: 30_000 }
  ).catch(() => {});
}

/**
 * Wait for the main app to be fully loaded (past loading/splash screens).
 */
export async function waitForAppReady(page: Page) {
  // Wait for the loading screen to disappear and main content to show
  await page.waitForSelector("main, [data-testid='main-tabs']", {
    timeout: 30_000,
  });
}

/**
 * Navigate to a specific tab by clicking the bottom nav.
 */
export async function navigateToTab(page: Page, tabName: string) {
  // Bottom nav buttons typically have aria-labels or text
  const tab = page.locator(`nav button, [role="tab"]`).filter({ hasText: new RegExp(tabName, "i") });
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(500);
  }
}
