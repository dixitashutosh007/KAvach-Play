import { test, expect, Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { injectSyntheticSession } from "./helpers/synthetic-session";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/qa/screenshots/shell");

test.beforeAll(async () => {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
});

test.describe("Shared Mobile Application Shell — Real Browser Behavioural Suite", () => {
  // ── 1. Player Navigation Workflow ──────────────────────────────────────────
  test("1. (D-16) Player navigation renders exactly Home, Profile, Matches, changes screens, uses Home entry points, and routes avatar to profile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-alpha",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Header brand and avatar visibility
    await expect(page.locator('[data-testid="app-header"]')).toBeVisible();
    const avatarBtn = page.locator('[data-testid="header-profile-avatar"]');
    await expect(avatarBtn).toBeVisible();

    // Exactly 3 primary items, in order, and no More
    const playerNav = page.locator('[data-testid="player-mobile-bottom-nav"]');
    await expect(playerNav).toBeVisible();
    expect(await playerNav.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["Home", "Profile", "Matches"]);
    await expect(playerNav.getByRole("button", { name: "More" })).toHaveCount(0);

    // Navigate to Matches
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Match Schedule/i }).first()).toBeVisible({ timeout: 5000 });

    // Navigate to Profile (payments live here)
    await playerNav.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Personal Profile/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: /My Dues & Payments/i })).toBeVisible({ timeout: 5000 });

    // Directory is a Home entry point with a contextual back link
    await playerNav.getByRole("button", { name: "Home", exact: true }).click();
    await page.locator('[data-testid="home-quick-players"]').click();
    await expect(page.getByPlaceholder(/Search players/i)).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="player-back-button"]').click();
    await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible();

    // Verify Header Profile Avatar navigation
    await avatarBtn.click();
    await expect(page.getByRole("heading", { name: /Personal Profile/i })).toBeVisible({ timeout: 5000 });
  });

  // ── 2. Admin Navigation Workflow & RBAC Gating (D-18) ───────────────────────
  test("2. (D-19) Club Admin sees Home, Match Center, Club, Design Studio; Match Center holds Matches, Tournaments, Grounds; denied areas are polite", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "admin-beta",
      role: "admin",
      isClubAdmin: true,
      isSuperAdmin: false,
      features: {
        shop: false,
      },
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const toggleBtn = page.locator('[data-testid="header-persona-toggle"]');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    const adminNav = page.locator('[data-testid="admin-mobile-bottom-nav"]');
    await expect(adminNav).toBeVisible();
    expect(await adminNav.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual([
      "Home",
      "Match Center",
      "Club",
      "Design Studio",
    ]);
    await expect(adminNav.getByRole("button", { name: "More" })).toHaveCount(0);

    // Match Center: Matches, Tournaments, Grounds; Assign retired (D-19)
    const matchBtn = adminNav.getByRole("button", { name: "Match Center" });
    await matchBtn.click();
    await expect(matchBtn).toHaveAttribute("aria-current", "page");
    const sub = page.locator('[data-testid="match-subtabs"]');
    for (const t of ["Matches", "Tournaments", "Grounds"]) await expect(sub.getByRole("button", { name: t, exact: true })).toBeVisible();
    await expect(sub.getByRole("button", { name: "Assign", exact: true })).toHaveCount(0);

    // Club: all Club Admin sections; Shop hidden by the feature flag
    await adminNav.getByRole("button", { name: "Club" }).click();
    await expect(page.locator('[data-testid="club-sub-tab-players"]')).toBeVisible({ timeout: 10000 });
    const ids = await page.locator('[data-testid^="club-sub-tab-"]').evaluateAll((els) =>
      els.map((e) => (e.getAttribute("data-testid") || "").replace("club-sub-tab-", "")),
    );
    expect(ids).toEqual(["players", "studio", "announcements", "pulse", "leaderboard", "badges"]);

    // Finance and Settings are not Club Admin areas: polite access denied
    await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("settings"));
    await expect(page.locator('[data-testid="access-denied"]')).toContainText("Access denied");
    await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("finance"));
    await expect(page.locator('[data-testid="access-denied"]')).toBeVisible();

    // Legacy Grounds deep link opens inside Match Center
    await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("grounds"));
    await expect(adminNav.getByRole("button", { name: "Match Center" })).toHaveAttribute("aria-current", "page", { timeout: 5000 });
  });

  // ── 3. Club sections are an accessible tab list; no drawer anywhere (D-18) ───
  test("3. (D-18) Club sections are keyboard-reachable tabs; Super Admin mobile bar has all six destinations", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "admin-gamma",
      role: "admin",
      isSuperAdmin: true,
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.locator('[data-testid="header-persona-toggle"]').click();
    const adminNav = page.locator('[data-testid="admin-mobile-bottom-nav"]');
    await expect(adminNav).toBeVisible({ timeout: 10000 });
    expect(await adminNav.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual([
      "Home", "Match Center", "Club", "Finance", "Design Studio", "Settings",
    ]);
    for (const box of await adminNav.locator("button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('[data-testid="more-drawer-sheet"]')).toHaveCount(0);

    await adminNav.getByRole("button", { name: "Club" }).click();
    const tablist = page.getByRole("tablist", { name: "Club sections" });
    await expect(tablist).toBeVisible();
    const studioTab = tablist.getByRole("tab", { name: /Studio/ });
    await studioTab.focus();
    await page.keyboard.press("Enter");
    await expect(studioTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-testid="studio-tabs"]')).toBeVisible({ timeout: 5000 });
  });

  // ── 4. Responsive Viewport Verification (360px, 375px, 390px, 768px) ─────────
  const VIEWPORTS = [
    { name: "360x800", width: 360, height: 800 },
    { name: "375x812", width: 375, height: 812 },
    { name: "390x844", width: 390, height: 844 },
    { name: "768x1024", width: 768, height: 1024 },
  ];

  for (const vp of VIEWPORTS) {
    test(`4. Responsive check at ${vp.name} (${vp.width}x${vp.height}) has zero overflow and usable controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await injectSyntheticSession(page, {
        uid: "player-responsive",
        role: "admin",
        isSuperAdmin: true,
      });

      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      // Verify no horizontal overflow in Player mode
      const playerOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      );
      expect(playerOverflow).toBe(true);

      // Verify header action controls are visible and touch targets >= 44px
      const avatar = page.locator('[data-testid="header-profile-avatar"]');
      await expect(avatar).toBeVisible();
      const avatarBox = await avatar.boundingBox();
      expect(avatarBox?.width).toBeGreaterThanOrEqual(44);
      expect(avatarBox?.height).toBeGreaterThanOrEqual(44);

      // Capture representative Player screenshot at 360x800
      if (vp.name === "360x800") {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "shell-player-360x800.png") });
      }

      // Switch to Admin Console
      const toggle = page.locator('[data-testid="header-persona-toggle"]');
      await toggle.click();

      // Verify no horizontal overflow in Admin mode
      const adminOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      );
      expect(adminOverflow).toBe(true);

      // Verify bottom nav labels do not collide and are legible
      if (vp.width < 768) {
        const adminNav = page.locator('[data-testid="admin-mobile-bottom-nav"]');
        await expect(adminNav).toBeVisible();
        await expect(adminNav.getByRole("button", { name: "Club" })).toBeVisible();
        expect(await adminNav.locator("button").count()).toBe(6);
      }

      // Capture representative Admin screenshots
      if (vp.name === "360x800") {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "shell-admin-360x800.png") });

        // D-18: no More drawer; Club sections replace it
        const adminNav = page.locator('[data-testid="admin-mobile-bottom-nav"]');
        await adminNav.getByRole("button", { name: "Club" }).click();
        await expect(page.locator('[data-testid="club-sub-tabs"]')).toBeVisible();
      } else if (vp.name === "768x1024") {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "shell-admin-768x1024.png") });
      }
    });
  }
});
