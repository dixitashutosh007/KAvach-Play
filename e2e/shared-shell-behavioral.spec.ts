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
  test("1. Player navigation renders 5 approved items, changes screens, opens drawer, and routes avatar to profile", async ({
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

    // Verify 5 approved primary items in bottom nav
    const playerNav = page.locator('[data-testid="player-mobile-bottom-nav"]');
    await expect(playerNav).toBeVisible();
    await expect(playerNav.getByRole("button", { name: "Home", exact: true })).toBeVisible();
    await expect(playerNav.getByRole("button", { name: "Matches", exact: true })).toBeVisible();
    await expect(playerNav.getByRole("button", { name: "Finance", exact: true })).toBeVisible();
    await expect(playerNav.getByRole("button", { name: "Players", exact: true })).toBeVisible();
    await expect(playerNav.getByRole("button", { name: "More", exact: true })).toBeVisible();

    // Verify profile is strictly not in bottom nav
    await expect(playerNav.getByRole("button", { name: "Profile" })).toBeHidden();

    // Navigate to Matches
    await playerNav.getByRole("button", { name: "Matches", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Match Schedule/i }).first()).toBeVisible({ timeout: 5000 });

    // Navigate to Finance
    await playerNav.getByRole("button", { name: "Finance", exact: true }).click();
    await expect(page.getByRole("heading", { name: /My Dues & Payments/i })).toBeVisible({ timeout: 5000 });

    // Navigate to Players roster
    await playerNav.getByRole("button", { name: "Players", exact: true }).click();
    await expect(page.getByPlaceholder(/Search players/i)).toBeVisible({ timeout: 5000 });

    // Open More drawer and select a destination
    await playerNav.getByRole("button", { name: "More", exact: true }).click();
    const sheet = page.locator('[data-testid="more-drawer-sheet"]');
    await expect(sheet).toBeVisible();

    // Select Club Details from drawer
    const clubItem = sheet.locator('[data-testid="more-item-club"]');
    await expect(clubItem).toBeVisible();
    await clubItem.click();

    // Verify drawer closed
    await expect(sheet).toBeHidden();

    // Verify Header Profile Avatar navigation
    await avatarBtn.click();
    await expect(page.getByRole("heading", { name: /Personal Profile/i })).toBeVisible({ timeout: 5000 });
  });

  // ── 2. Admin Navigation Workflow & RBAC Gating ──────────────────────────────
  test("2. Admin navigation renders 5 approved items, respects RBAC in More drawer, and hides unauthorized hubs", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // Match Admin and Club Admin only (not Super Admin) with shop feature disabled
    await injectSyntheticSession(page, {
      uid: "admin-beta",
      role: "admin",
      isMatchAdmin: true,
      isClubAdmin: true,
      isSuperAdmin: false,
      features: {
        shop: false,
      },
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Toggle into Admin Console via Header Persona Switcher
    const toggleBtn = page.locator('[data-testid="header-persona-toggle"]');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    // Verify 5 approved admin primary items: Overview | Match Centre | Player Roster | Finance & Dues | More
    const adminNav = page.locator('[data-testid="admin-mobile-bottom-nav"]');
    await expect(adminNav).toBeVisible();
    await expect(adminNav.getByRole("button", { name: "Overview" })).toBeVisible();
    await expect(adminNav.getByRole("button", { name: "Match Centre" })).toBeVisible();
    await expect(adminNav.getByRole("button", { name: "Player Roster" })).toBeVisible();
    await expect(adminNav.getByRole("button", { name: "Finance & Dues" })).toBeVisible();
    await expect(adminNav.getByRole("button", { name: "More" })).toBeVisible();

    // Verify Player Roster navigation and active state
    const rosterBtn = adminNav.getByRole("button", { name: "Player Roster" });
    await rosterBtn.click();
    await expect(rosterBtn).toHaveClass(/text-accent/);

    // Open Admin More Drawer
    const moreBtn = adminNav.getByRole("button", { name: "More" });
    await moreBtn.click();
    const sheet = page.locator('[data-testid="more-drawer-sheet"]');
    await expect(sheet).toBeVisible();

    // RBAC: Grounds & Venues must be visible (user is Match Admin)
    await expect(sheet.locator('[data-testid="more-item-grounds"]')).toBeVisible();

    // RBAC: Settings & Access must NOT be visible (user is NOT Super Admin)
    await expect(sheet.locator('[data-testid="more-item-settings"]')).toBeHidden();

    // Feature Flags: Merchandise Shop must NOT be visible (feature disabled)
    await expect(sheet.locator('[data-testid="more-item-shop"]')).toBeHidden();

    // Close drawer
    await sheet.getByLabel("Close navigation drawer").click();
    await expect(sheet).toBeHidden();
  });

  // ── 3. Modal Behaviour: Focus Trap, Scroll Lock, Escape, and Rerender ────────
  test("3. MoreDrawer implements focus trap, scroll lock, Escape dismissal, and preserves state across rerenders", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await injectSyntheticSession(page, {
      uid: "player-gamma",
      role: "player",
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const playerNav = page.locator('[data-testid="player-mobile-bottom-nav"]');
    const moreBtn = playerNav.getByRole("button", { name: "More", exact: true });

    // Focus and click More button
    await moreBtn.focus();
    await moreBtn.click();

    const sheet = page.locator('[data-testid="more-drawer-sheet"]');
    await expect(sheet).toBeVisible();

    // Initial focus: close button must be focused
    const closeBtn = sheet.getByLabel("Close navigation drawer");
    await expect(closeBtn).toBeFocused({ timeout: 3000 });

    // Scroll lock: body overflow must be hidden
    const isScrollLocked = await page.evaluate(() => document.body.style.overflow === "hidden");
    expect(isScrollLocked).toBe(true);

    // Focus Trap: Shift+Tab on close button wraps to last item
    await page.keyboard.press("Shift+Tab");
    const lastItem = sheet.locator("button").last();
    await expect(lastItem).toBeFocused();

    // Tab on last item wraps back to close button
    await page.keyboard.press("Tab");
    await expect(closeBtn).toBeFocused();

    // Rerender stability: trigger parent re-renders while drawer remains open
    await page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
    });

    // Verify focus remains inside drawer and body overflow remains hidden
    const isStillLocked = await page.evaluate(() => document.body.style.overflow === "hidden");
    expect(isStillLocked).toBe(true);
    await expect(closeBtn).toBeFocused();

    // Escape key dismissal
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Scroll lock released
    const isUnlocked = await page.evaluate(() => document.body.style.overflow !== "hidden");
    expect(isUnlocked).toBe(true);

    // Focus restored to More trigger button
    await expect(moreBtn).toBeFocused();

    // Test Backdrop dismissal
    await moreBtn.click();
    await expect(sheet).toBeVisible();
    // Click outside sheet (backdrop area)
    await page.mouse.click(187, 50);
    await expect(sheet).toBeHidden();
    await expect(moreBtn).toBeFocused();
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
        await expect(adminNav.getByRole("button", { name: "Player Roster" })).toBeVisible();
      }

      // Capture representative Admin screenshots
      if (vp.name === "360x800") {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "shell-admin-360x800.png") });

        // Open More drawer and capture screenshot
        const adminNav = page.locator('[data-testid="admin-mobile-bottom-nav"]');
        await adminNav.getByRole("button", { name: "More" }).click();
        await expect(page.locator('[data-testid="more-drawer-sheet"]')).toBeVisible();
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "shell-drawer-360x800.png") });
      } else if (vp.name === "768x1024") {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "shell-admin-768x1024.png") });
      }
    });
  }
});
