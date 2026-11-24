/**
 * D-18 Admin persona navigation realignment — real browser suite.
 *
 * Local dev server + synthetic session harness (mocked auth claim, synthetic
 * store): no Firestore, no network writes, no payments. Complements the role
 * matrix in e2e/production-app.spec.ts §6 with workflow, desktop/mobile
 * consistency, quick-action, refresh and screenshot checks.
 */
import { test, expect, Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { injectSyntheticSession, RoleConfig } from "./helpers/synthetic-session";

const SHOTS = path.resolve(process.cwd(), "docs/qa/admin-nav-realignment/screenshots");
test.beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
});
const shoot = async (page: Page, name: string) => {
  if (test.info().project.name !== "Desktop Chrome") return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function openAdmin(page: Page, uid: string, role: Omit<RoleConfig, "uid">, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await injectSyntheticSession(page, { uid, role: "admin", ...role });
  await page.goto("/");
  await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-testid="header-persona-toggle"]').click();
}

async function navIds(page: Page, prefix: "sidebar-tab-" | "admin-nav-") {
  return page.locator(`[data-testid^="${prefix}"]`).evaluateAll(
    (els, p) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.getAttribute("data-testid") || "").replace(p as string, "")),
    prefix,
  );
}

test.describe("D-18 desktop sidebar and mobile bar use the same destinations", () => {
  const roles: [string, Omit<RoleConfig, "uid">, string[]][] = [
    ["Super Admin", { isSuperAdmin: true }, ["home", "matches", "club", "finance", "design", "settings"]],
    ["Club Admin", { isClubAdmin: true }, ["home", "matches", "club", "design"]],
    ["Finance Admin + Designer", { isFinanceAdmin: true, isDesigner: true }, ["home", "finance", "design"]],
    ["Finance Admin", { isFinanceAdmin: true }, ["home", "finance"]],
  ];
  for (const [name, role, expected] of roles) {
    test(`${name}: desktop (1280) and mobile (390) show ${expected.join(", ")}`, async ({ page }) => {
      await openAdmin(page, `cons-${name.length}`, role, 1280, 800);
      expect(await navIds(page, "sidebar-tab-")).toEqual(expected);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('[data-testid="admin-mobile-bottom-nav"]')).toBeVisible();
      expect(await navIds(page, "admin-nav-")).toEqual(expected);
      await expect(page.locator('[data-testid="more-drawer-sheet"]')).toHaveCount(0);
    });
  }
});

test.describe("D-18 Home quick actions open the right destination and section", () => {
  test("Super Admin: Add Player to Studio, Grant Badge, Invite Player, Announcements, View Calendar, Total Dues", async ({ page }) => {
    await openAdmin(page, "qa-super", { isSuperAdmin: true }, 1280, 900);
    const active = page.locator('[data-testid^="sidebar-tab-"][aria-current="page"]');
    await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible({ timeout: 10_000 });

    const back = async () => {
      await page.locator('[data-testid="sidebar-tab-home"]').click();
      await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible({ timeout: 10_000 });
    };

    await page.getByRole("button", { name: /Add to Studio/i }).first().click();
    await expect(active).toHaveAttribute("data-testid", "sidebar-tab-club");
    await expect(page.locator('[data-testid="club-sub-tab-studio"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-testid="studio-tabs"]')).toBeVisible({ timeout: 10_000 });
    await back();

    await page.getByRole("button", { name: /Grant Badge/i }).first().click();
    await expect(page.locator('[data-testid="club-sub-tab-badges"]')).toHaveAttribute("aria-selected", "true");
    await back();

    await page.getByRole("button", { name: /Invite Player/i }).first().click();
    await expect(page.locator('[data-testid="club-sub-tab-players"]')).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await back();

    await page.locator('[data-testid="admin-home-announcements-link"]').click();
    await expect(page.locator('[data-testid="club-sub-tab-announcements"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-testid="new-announcement-button"]')).toBeVisible();
    await back();

    await page.getByRole("button", { name: /View Calendar/i }).first().click();
    await expect(active).toHaveAttribute("data-testid", "sidebar-tab-matches");
    await back();

    await page.getByText(/Total Dues/i).first().click();
    await expect(active).toHaveAttribute("data-testid", "sidebar-tab-finance");
  });
});

test.describe("D-19 Finance holds Reminders and the Activity Log", () => {
  test("Super Admin: Finance → Dues (reminders) and Finance → Activity Log; Club has neither", async ({ page }) => {
    await openAdmin(page, "fin-super", { isSuperAdmin: true }, 1280, 900);
    await page.locator('[data-testid="sidebar-tab-club"]').click();
    await expect(page.locator('[data-testid="club-sub-tab-players"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="club-sub-tab-reminders"], [data-testid="club-sub-tab-activity"]')).toHaveCount(0);
    // Old Club → Reminders link lands on Finance → Dues
    await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("club", "reminders"));
    await expect(page.locator('[data-testid="sidebar-tab-finance"]')).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
    await page.getByRole("button", { name: "Activity Log", exact: true }).click();
    await expect(page.getByText(/Activity Log|Audit/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="access-denied"]')).toHaveCount(0);
  });
  test("Finance Admin: Home shows the dashboard; Club and Settings show access denied", async ({ page }) => {
    await openAdmin(page, "fin-only", { isFinanceAdmin: true }, 1280, 900);
    await page.locator('[data-testid="sidebar-tab-home"]').click();
    await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("club"));
    await expect(page.locator('[data-testid="access-denied"]')).toContainText("Club Admins");
    await page.evaluate(() => (window as any).__KAVACH_NAVIGATE_TAB__("settings"));
    await expect(page.locator('[data-testid="access-denied"]')).toContainText("Super Admins");
  });
});

test.describe("D-18 refresh and persona switching", () => {
  test("refresh returns to the Player persona (persona is not persisted); switching back restores Admin", async ({ page }) => {
    await openAdmin(page, "refresh-super", { isSuperAdmin: true }, 390, 844);
    await page.locator('[data-testid="admin-mobile-bottom-nav"] button[aria-label="Club"]').click();
    await expect(page.locator('[data-testid="admin-club"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
    expect(await page.locator('[data-testid="player-mobile-bottom-nav"] button').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["Home", "Club", "Matches"]);
    await expect(page.locator('[data-testid="admin-club"], [data-testid="admin-mobile-bottom-nav"]')).toHaveCount(0);
    await page.locator('[data-testid="header-persona-toggle"]').click();
    await expect(page.locator('[data-testid="admin-mobile-bottom-nav"]')).toBeVisible();
  });
});

test.describe("D-18 screenshots", () => {
  const views: [string, string, string | null][] = [
    ["home", "home", null],
    ["matches", "matches", null],
    ["club", "club", null],
    ["finance", "finance", null],
    ["design", "design", null],
    ["settings", "settings", null],
  ];
  for (const [w, h] of [[1280, 800], [1440, 900], [390, 844], [360, 800]] as const) {
    test(`Super Admin destinations at ${w}×${h}`, async ({ page }) => {
      await openAdmin(page, `shot-${w}`, { isSuperAdmin: true }, w, h);
      for (const [name, tab] of views) {
        await page.evaluate((t) => (window as any).__KAVACH_NAVIGATE_TAB__(t), tab);
        await page.waitForTimeout(600);
        await shoot(page, `admin-${name}-${w}x${h}`);
      }
    });
  }
  test("role-specific navigation (desktop 1280 and mobile 390)", async ({ page }) => {
    const roles: [string, Omit<RoleConfig, "uid">][] = [
      ["club-admin", { isClubAdmin: true }],
      ["finance-admin", { isFinanceAdmin: true }],
      ["designer", { isDesigner: true }],
      ["legacy-match-admin", { isMatchAdmin: true }],
      ["legacy-studio-admin", { isStudioAdmin: true }],
    ];
    for (const [slug, role] of roles) {
      await openAdmin(page, `shot-${slug}`, role, 1280, 800);
      await shoot(page, `role-${slug}-1280x800`);
      await page.setViewportSize({ width: 390, height: 844 });
      await shoot(page, `role-${slug}-390x844`);
      await page.context().clearCookies();
    }
  });
});
