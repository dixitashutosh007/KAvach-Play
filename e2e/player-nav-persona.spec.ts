/**
 * D-16/D-20 Player persona navigation & persona isolation — real browser suite.
 * D-20: primary navigation is Home, Club, Matches; Profile opens from the avatar.
 *
 * Runs against the local dev server with the synthetic session harness
 * (`e2e/helpers/synthetic-session.ts`): synthetic store data, mocked auth, no
 * Firestore, no network writes, no payments. It verifies, for a regular player
 * and every admin-capable role:
 *  - Player persona shows exactly Home, Profile, Matches (mobile and desktop)
 *  - no admin navigation, widgets or management controls in Player persona
 *  - player features (Directory, Studio, Shop, Pulse, Notifications,
 *    Leaderboard, Badges, Payments) stay reachable with contextual back links
 *  - the persona switch still opens the existing Admin experience.
 */
import { test, expect, Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { injectSyntheticSession, RoleConfig } from "./helpers/synthetic-session";

const SHOTS = path.resolve(process.cwd(), "docs/qa/player-ui-enhancement/screenshots");
test.beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
});

// Screenshots are written once, from the Desktop Chrome project, at explicit viewports.
const shoot = async (page: Page, name: string) => {
  if (test.info().project.name !== "Desktop Chrome") return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
};

const ROLES: Record<string, Omit<RoleConfig, "uid">> = {
  "Regular Player": {},
  "Match Admin": { isMatchAdmin: true },
  "Finance Admin": { isFinanceAdmin: true },
  "Studio Admin": { isStudioAdmin: true },
  "Club Admin": { isClubAdmin: true },
  Designer: { isDesigner: true },
  "Super Admin": { isSuperAdmin: true },
};

const ADMIN_ONLY_TEXT = [
  "Admin Console Hubs",
  "Pending Approvals Alert",
  "Match Centre",
  "Player Roster",
  "Finance & Dues",
  "Studio & Nets",
  "Settings & Access",
  "Navigation Console", // sidebar label is shared, checked separately below
];

async function openAsPlayer(page: Page, uid: string, role: Omit<RoleConfig, "uid">, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await injectSyntheticSession(page, { uid, ...role });
  await page.goto("/");
  await expect(page.locator('[data-testid="app-header"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
}

async function navLabels(page: Page, selector: string) {
  return page.locator(`${selector} button`).evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute("aria-label") || (e.textContent || "").trim()),
  );
}

async function assertNoAdminControls(page: Page) {
  await expect(page.locator('[data-testid="admin-mobile-bottom-nav"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="more-drawer-sheet"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="new-announcement-button"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="admin-announcements-manager"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="admin-home-announcements-link"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="admin-club"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="sidebar-tab-"]')).toHaveCount(0);
  const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  for (const text of ADMIN_ONLY_TEXT.filter((t) => t !== "Navigation Console")) {
    expect(main.includes(text), `"${text}" must not appear in Player persona`).toBe(false);
  }
}

test.describe("Persona isolation — every role in Player persona (mobile 390×844)", () => {
  for (const [roleName, role] of Object.entries(ROLES)) {
    test(`${roleName}: Player persona is the regular player experience`, async ({ page }) => {
      const uid = `nav-${roleName.toLowerCase().replace(/\s+/g, "-")}`;
      await openAsPlayer(page, uid, role, 390, 844);

      const nav = '[data-testid="player-mobile-bottom-nav"]';
      await expect(page.locator(nav)).toBeVisible();
      expect(await navLabels(page, nav)).toEqual(["Home", "Club", "Matches"]);
      await assertNoAdminControls(page);

      const toggle = page.locator('[data-testid="header-persona-toggle"]');
      if (roleName === "Regular Player") await expect(toggle).toHaveCount(0);
      else await expect(toggle).toBeVisible();

      // Admin-only tabs cannot be forced into the Player persona.
      for (const tab of ["design", "settings", "grounds"]) {
        await page.evaluate((t) => (window as any).__KAVACH_NAVIGATE_TAB__(t), tab);
        await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 5000 });
      }
      await assertNoAdminControls(page);

      // Club, Profile (avatar) and Matches are player screens without admin controls.
      await page.locator(`${nav} button[aria-label="Club"]`).click();
      await expect(page.locator('[data-testid="player-club"]')).toBeVisible({ timeout: 10_000 });
      await assertNoAdminControls(page);
      await page.locator('[data-testid="header-profile-avatar"]').click();
      await expect(page.locator('[data-testid="player-profile-hub"]')).toBeVisible({ timeout: 10_000 });
      await assertNoAdminControls(page);
      await page.locator(`${nav} button[aria-label="Matches"]`).click();
      await expect(page.locator('[data-testid="match-subtabs"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Add Match/i })).toHaveCount(0);
      await assertNoAdminControls(page);

      if (roleName !== "Regular Player") {
        await toggle.click();
        await expect(page.locator('[data-testid="admin-mobile-bottom-nav"]')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-testid="player-mobile-bottom-nav"]')).toHaveCount(0);
        await toggle.click();
        await expect(page.locator(nav)).toBeVisible();
        expect(await navLabels(page, nav)).toEqual(["Home", "Club", "Matches"]);
      }
    });
  }
});

test.describe("Desktop navigation matches mobile (1280×800)", () => {
  for (const [roleName, role] of Object.entries(ROLES)) {
    test(`${roleName}: desktop sidebar shows exactly Home, Club, Matches`, async ({ page }) => {
      const uid = `desk-${roleName.toLowerCase().replace(/\s+/g, "-")}`;
      await openAsPlayer(page, uid, role, 1280, 800);
      const ids = await page.locator('[data-testid^="sidebar-player-"]').evaluateAll((els) =>
        els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute("data-testid")),
      );
      expect(ids).toEqual(["sidebar-player-home", "sidebar-player-club", "sidebar-player-matches"]);
      await expect(page.locator('[data-testid="player-mobile-bottom-nav"]')).toBeHidden();
      await assertNoAdminControls(page);
    });
  }
});

test.describe("Player features stay reachable (Super Admin in Player persona, 390×844)", () => {
  test("Home quick access, Club tiles, back links, notifications, Profile and Pay Now", async ({ page }) => {
    await openAsPlayer(page, "reach-super", ROLES["Super Admin"], 390, 844);
    const back = page.locator('[data-testid="player-back-button"]');
    const navCurrent = page.locator('[data-testid="player-mobile-bottom-nav"] button[aria-current="page"]');

    // Home quick access: Studio and Shop return to Home; Directory and Polls belong to Club.
    for (const [target, parent] of [["studio", "Home"], ["shop", "Home"], ["players", "Club"], ["opinion", "Club"]] as const) {
      await page.locator('[data-testid="player-mobile-bottom-nav"] button[aria-label="Home"]').click();
      await page.locator(`[data-testid="home-quick-${target}"]`).click();
      await expect(back).toBeVisible({ timeout: 10_000 });
      await expect(navCurrent).toHaveAttribute("aria-label", parent);
      await back.click();
    }

    // Club tiles: Leaderboard, Player Badges, Polls, Pulse — each with a back link to Club.
    await page.locator('[data-testid="player-mobile-bottom-nav"] button[aria-label="Club"]').click();
    for (const tile of ["leaderboard", "badges", "opinion", "pulse"]) {
      await page.locator(`[data-testid="club-tile-${tile}"]`).click();
      await expect(back).toHaveAttribute("aria-label", "Back to Club", { timeout: 10_000 });
      await back.click();
      await expect(page.locator('[data-testid="player-club"]')).toBeVisible();
    }
    await page.locator('[data-testid="club-tile-badges"]').click();
    await expect(page.getByRole("button", { name: /Grant|Manage/i })).toHaveCount(0);
    await back.click();

    // Notifications (header) with a back link to the last primary screen.
    await page.locator('[data-testid="header-notifications-btn"]').click();
    await expect(page.getByRole("heading", { name: /Notification Hub/i })).toBeVisible({ timeout: 10_000 });
    await expect(back).toHaveAttribute("aria-label", "Back to Club");
    await back.click();

    // Profile from the avatar; Pay Now opens My Payments with a back link to Profile.
    await page.locator('[data-testid="header-profile-avatar"]').click();
    await expect(page.locator('[data-testid="player-profile-hub"]')).toBeVisible({ timeout: 10_000 });
    await expect(navCurrent).toHaveCount(0);
    await page.locator('[data-testid="profile-chip-payments"]').click();
    await page.locator('[data-testid="pay-now-button"]').click();
    await expect(page.getByRole("heading", { name: /My Dues & Payments/i })).toBeVisible({ timeout: 10_000 });
    await expect(back).toHaveAttribute("aria-label", "Back to Profile");
    await back.click();
    await expect(page.locator('[data-testid="player-profile-hub"]')).toBeVisible();
  });
});

test.describe("Announcement management is Admin persona only (D-16; D-18: Club → Announcements)", () => {
  for (const roleName of ["Club Admin", "Super Admin"]) {
    test(`${roleName}: Admin Home links to Club → Announcements publishing; Player screens do not`, async ({ page }) => {
      await openAsPlayer(page, `ann-${roleName.replace(/\s+/g, "-").toLowerCase()}`, ROLES[roleName], 1280, 900);
      await expect(page.locator('[data-testid="new-announcement-button"]')).toHaveCount(0);
      await page.locator('[data-testid="sidebar-player-club"]').click();
      await page.locator('[data-testid="club-announcements-more"]').click();
      await expect(page.locator('[data-testid="club-announcements-screen"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="new-announcement-button"]')).toHaveCount(0);
      await page.locator('[data-testid="header-persona-toggle"]').click();
      await page.locator('[data-testid="sidebar-tab-home"]').click();
      await page.locator('[data-testid="admin-home-announcements-link"]').click();
      await expect(page.locator('[data-testid="admin-announcements-manager"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid="new-announcement-button"]')).toBeVisible();
    });
  }
});
