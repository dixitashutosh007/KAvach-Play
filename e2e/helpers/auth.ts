import { Page, expect } from "@playwright/test";

/**
 * Sign in using email/password (for admin testing).
 * Requires ADMIN_EMAIL and ADMIN_PASSWORD env vars.
 *
 * Login screen flow: Phone form → "Email / Google" → "Log in with Email & Password" → fill → Submit
 *
 * IMPORTANT: The test admin account MUST have pre-existing Firestore documents:
 *   - appUsers/{uid} with role: "admin"
 *   - players/{uid} with at least { name, mobile, inviteStatus: "Accepted" }
 * Without these, the app shows a registration form instead of the main UI.
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
  await expect(page.getByRole("heading", { name: /kavach play/i })).toBeVisible({ timeout: 15_000 });

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

  // Step 5: Wait for the main app to render.
  // If this times out, common causes:
  //   - Wrong credentials (auth error shown on login screen)
  //   - Missing Firestore docs (registration form or Google sync prompt shown)
  //   - App stuck on loading screen
  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
}

/**
 * Wait for the main app to be fully loaded (past loading/splash screens).
 */
export async function waitForAppReady(page: Page) {
  await page.waitForSelector("main", { timeout: 30_000 });
}

/**
 * Navigate to a specific tab in the admin interface.
 * On mobile (< 768px): uses the <select> dropdown.
 * On desktop (>= 768px): clicks the sidebar button.
 */
export async function navigateToTab(page: Page, tabName: string) {
  // Map user-friendly names to <select> option values
  const selectValueMap: Record<string, string> = {
    home: "home",
    "admin home": "home",
    finance: "finance",
    "finance dashboard": "finance",
    dues: "dues_and_reminders",
    squad: "studio",
    "squad & studio": "studio",
    studio: "studio",
    matches: "matches",
    leaderboard: "leaderboard",
    shop: "shop",
    pulse: "opinion",
    opinion: "opinion",
    design: "design",
    settings: "settings",
    players: "studio",
  };

  // Try the mobile dropdown first (visible on < 768px)
  const mobileSelect = page.locator("select").filter({ has: page.locator('option[value="home"]') });
  if (await mobileSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const value = selectValueMap[tabName.toLowerCase()] || tabName.toLowerCase();
    await mobileSelect.selectOption(value);
    await page.waitForTimeout(1_000);
    return;
  }

  // Desktop: click the sidebar button
  const tab = page
    .getByRole("button", { name: new RegExp(tabName, "i") })
    .first();
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await tab.click();
  await page.waitForTimeout(1_000);
}
