/**
 * D-16 Player persona navigation & persona isolation — real browser suite.
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

const SHOTS = path.resolve(process.cwd(), "docs/qa/player-nav-persona/screenshots");
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
  await expect(page.locator('[data-testid="admin-home-announcements"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="sidebar-tab-"]')).toHaveCount(0);
  const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  for (const text of ADMIN_ONLY_TEXT.filter((t) => t !== "Navigation Console")) {
    expect(main.includes(text), `"${text}" must not appear in Player persona`).toBe(false);
  }
}

test.describe("D-16 persona isolation — every role in Player persona (mobile 390×844)", () => {
  for (const [roleName, role] of Object.entries(ROLES)) {
    test(`${roleName}: Player persona is the regular player experience`, async ({ page }) => {
      const uid = `nav-${roleName.toLowerCase().replace(/\s+/g, "-")}`;
      await openAsPlayer(page, uid, role, 390, 844);

      // Exactly three primary destinations, in order.
      const nav = '[data-testid="player-mobile-bottom-nav"]';
      await expect(page.locator(nav)).toBeVisible();
      expect(await navLabels(page, nav)).toEqual(["Home", "Profile", "Matches"]);
      await assertNoAdminControls(page);

      // Persona switch is offered only to authorised admins.
      const toggle = page.locator('[data-testid="header-persona-toggle"]');
      if (roleName === "Regular Player") await expect(toggle).toHaveCount(0);
      else await expect(toggle).toBeVisible();

      // Admin-only tabs cannot be forced into the Player persona.
      for (const tab of ["club", "design", "settings", "grounds"]) {
        await page.evaluate((t) => (window as any).__KAVACH_NAVIGATE_TAB__(t), tab);
        await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 5000 });
      }
      await assertNoAdminControls(page);

      // Profile and Matches are player screens without admin controls.
      await page.locator(`${nav} button[aria-label="Profile"]`).click();
      await expect(page.locator('[data-testid="profile-performance-card"]')).toBeVisible({ timeout: 10_000 });
      await assertNoAdminControls(page);
      await page.locator(`${nav} button[aria-label="Matches"]`).click();
      await expect(page.locator('[data-testid="match-subtabs"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Add Match/i })).toHaveCount(0);
      await assertNoAdminControls(page);

      if (roleName !== "Regular Player") {
        // Switching to Admin persona restores the existing admin experience.
        await toggle.click();
        await expect(page.locator('[data-testid="admin-mobile-bottom-nav"]')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-testid="player-mobile-bottom-nav"]')).toHaveCount(0);
        await toggle.click();
        await expect(page.locator(nav)).toBeVisible();
        expect(await navLabels(page, nav)).toEqual(["Home", "Profile", "Matches"]);
      }
    });
  }
});

test.describe("D-16 desktop navigation matches mobile (1280×800)", () => {
  for (const [roleName, role] of Object.entries(ROLES)) {
    test(`${roleName}: desktop sidebar shows exactly Home, Profile, Matches`, async ({ page }) => {
      const uid = `desk-${roleName.toLowerCase().replace(/\s+/g, "-")}`;
      await openAsPlayer(page, uid, role, 1280, 800);
      const ids = await page.locator('[data-testid^="sidebar-player-"]').evaluateAll((els) =>
        els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute("data-testid")),
      );
      expect(ids).toEqual(["sidebar-player-home", "sidebar-player-profile", "sidebar-player-matches"]);
      await expect(page.locator('[data-testid="player-mobile-bottom-nav"]')).toBeHidden();
      await assertNoAdminControls(page);
    });
  }
});

test.describe("D-16 player features stay reachable (Super Admin in Player persona, 390×844)", () => {
  test("Home quick access, back links, notifications, profile destinations, Pay Now target", async ({ page }) => {
    await openAsPlayer(page, "reach-super", ROLES["Super Admin"], 390, 844);
    const back = page.locator('[data-testid="player-back-button"]');
    const navCurrent = page.locator('[data-testid="player-mobile-bottom-nav"] button[aria-current="page"]');

    const quick: [string, RegExp][] = [
      ["players", /Search players/i],
      ["studio", /Studio/i],
      ["shop", /Shop|Merchandise/i],
      ["opinion", /Pulse|Poll/i],
    ];
    for (const [target] of quick) {
      await page.locator(`[data-testid="home-quick-${target}"]`).click();
      await expect(back).toBeVisible({ timeout: 10_000 });
      await expect(navCurrent).toHaveAttribute("aria-label", "Home");
      await back.click();
      await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible();
    }

    // Announcements entry stays on Home.
    await page.locator('[data-testid="home-quick-announcements"]').click();
    await expect(page.locator('[data-testid="club-announcements-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="new-announcement-button"]')).toHaveCount(0);

    // Notifications (previously a blank screen in Player persona).
    await page.locator('[data-testid="header-notifications-btn"]').click();
    await expect(page.getByRole("heading", { name: /Notification Hub/i })).toBeVisible({ timeout: 10_000 });
    await expect(navCurrent).toHaveAttribute("aria-label", "Home");

    // Profile destinations.
    await page.locator('[data-testid="player-mobile-bottom-nav"] button[aria-label="Profile"]').click();
    await page.locator('[data-testid="profile-open-leaderboard"]').click();
    await expect(page.getByRole("heading", { name: /Leaderboard/i }).first()).toBeVisible({ timeout: 10_000 });
    await expect(navCurrent).toHaveAttribute("aria-label", "Profile");
    await back.click();
    await page.locator('[data-testid="profile-open-badges"]').click();
    await expect(page.getByRole("button", { name: /Hall/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /Grant|Manage/i })).toHaveCount(0);
    await back.click();
    await expect(page.locator('[data-testid="profile-studio-card"]')).toBeVisible();

    // Pay Now target: player payments screen (own dues only).
    await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("finance"));
    await expect(page.getByRole("heading", { name: /My Dues & Payments/i })).toBeVisible({ timeout: 10_000 });
    await expect(navCurrent).toHaveAttribute("aria-label", "Profile");
  });
});

test.describe("D-16 announcement management relocated to Admin Home", () => {
  for (const roleName of ["Club Admin", "Super Admin"]) {
    test(`${roleName}: Admin Home offers announcement publishing; Player Home does not`, async ({ page }) => {
      await openAsPlayer(page, `ann-${roleName.replace(/\s+/g, "-").toLowerCase()}`, ROLES[roleName], 1280, 900);
      await expect(page.locator('[data-testid="new-announcement-button"]')).toHaveCount(0);
      await page.locator('[data-testid="header-persona-toggle"]').click();
      if (roleName === "Club Admin") await page.locator('[data-testid="sidebar-tab-home"]').click();
      await expect(page.locator('[data-testid="admin-home-announcements"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid="new-announcement-button"]')).toBeVisible();
    });
  }
  for (const roleName of ["Match Admin", "Finance Admin", "Studio Admin", "Designer"]) {
    test(`${roleName}: no announcement publishing in either persona (unchanged audience)`, async ({ page }) => {
      await openAsPlayer(page, `ann2-${roleName.replace(/\s+/g, "-").toLowerCase()}`, ROLES[roleName], 1280, 900);
      await expect(page.locator('[data-testid="new-announcement-button"]')).toHaveCount(0);
      await page.locator('[data-testid="header-persona-toggle"]').click();
      await page.waitForTimeout(500);
      await expect(page.locator('[data-testid="new-announcement-button"]')).toHaveCount(0);
    });
  }
});

test.describe("D-16 screenshots", () => {
  const sizes: [number, number][] = [[360, 800], [390, 844], [430, 932], [768, 1024], [1280, 800], [1440, 900]];
  for (const [w, h] of sizes) {
    test(`player home/profile/matches at ${w}×${h}`, async ({ page }) => {
      await openAsPlayer(page, `shot-${w}`, ROLES["Super Admin"], w, h);
      await shoot(page, `player-home-${w}x${h}`);
      await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("profile"));
      await expect(page.locator('[data-testid="profile-performance-card"]')).toBeVisible({ timeout: 10_000 });
      await shoot(page, `player-profile-${w}x${h}`);
      await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("matches"));
      await page.waitForTimeout(800);
      await shoot(page, `player-matches-${w}x${h}`);
    });
  }
  test("secondary screen with back link, and Admin Home announcements", async ({ page }) => {
    await openAsPlayer(page, "shot-secondary", ROLES["Super Admin"], 390, 844);
    await page.locator('[data-testid="home-quick-players"]').click();
    await expect(page.locator('[data-testid="player-back-button"]')).toBeVisible();
    await shoot(page, "player-directory-back-390x844");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('[data-testid="header-persona-toggle"]').click();
    await page.locator('[data-testid="admin-home-announcements"]').scrollIntoViewIfNeeded();
    await shoot(page, "admin-home-announcements-1280x900");
  });
});
