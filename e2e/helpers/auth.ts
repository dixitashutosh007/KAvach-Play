import { Page, expect } from "@playwright/test";

export async function signInAsAdmin(page: Page) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD env vars required for admin tests"
    );
  }

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /kavach play/i })).toBeVisible({ timeout: 15_000 });

  const otherAuthBtn = page.locator('[data-testid="other-auth-options"]');
  await expect(otherAuthBtn).toBeVisible({ timeout: 10_000 });
  await otherAuthBtn.click();

  const emailToggle = page.locator('[data-testid="email-login-toggle"]');
  await expect(emailToggle).toBeVisible({ timeout: 5_000 });
  await emailToggle.click();

  const emailInput = page.locator('[data-testid="email-input"]');
  const passwordInput = page.locator('[data-testid="password-input"]');
  await expect(emailInput).toBeVisible({ timeout: 5_000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);

  await page.locator('[data-testid="submit-login"]').click();

  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
}

export async function waitForAppReady(page: Page) {
  await page.waitForSelector("main", { timeout: 30_000 });
}

export async function navigateToTab(page: Page, tabName: string) {
  const valueMap: Record<string, string> = {
    home: "home",
    "admin home": "home",
    finance: "finance",
    "finance dashboard": "finance",
    matches: "matches",
    studio: "studio",
    club: "club",
    settings: "settings",
  };

  const value = valueMap[tabName.toLowerCase()] || tabName.toLowerCase();

  const mobileSelect = page.locator('[data-testid="admin-tab-select"]');
  if (await mobileSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await mobileSelect.selectOption(value);
    await page.waitForTimeout(1_500);
    return;
  }

  const sidebarBtn = page.locator(`[data-testid="sidebar-tab-${value}"]`);
  if (await sidebarBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await sidebarBtn.click();
    await page.waitForTimeout(1_500);
    return;
  }

  const tab = page
    .getByRole("button", { name: new RegExp(tabName, "i") })
    .first();
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await tab.click();
  await page.waitForTimeout(1_500);
}

export async function navigateToClubSubTab(page: Page, subTabKey: string) {
  await navigateToTab(page, "club");
  const subTab = page.locator(`[data-testid="club-sub-tab-${subTabKey}"]`);
  await expect(subTab).toBeVisible({ timeout: 10_000 });
  await subTab.click();
  await page.waitForTimeout(1_500);
}

export async function expandSettingsSection(page: Page, sectionTestId: string) {
  const section = page.locator(`[data-testid="${sectionTestId}"]`);
  await expect(section).toBeVisible({ timeout: 10_000 });
  await section.click();
  await page.waitForTimeout(500);
}
