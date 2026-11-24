/**
 * Club Shop placement — Player Club card, Admin Club Shop panel and Club Menu.
 *
 * Local dev server + synthetic session harness (no Firestore, no payments).
 * POST /api/admin/shop is mocked here (synthetic sessions carry no ID token);
 * its authorisation and effect are covered in tests/club-shop.emulator.test.mjs.
 */
import { test, expect, Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { injectSyntheticSession, RoleConfig } from "./helpers/synthetic-session";

const SHOTS = path.resolve(process.cwd(), "docs/qa/club-shop/screenshots");
test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));
const shoot = async (page: Page, name: string) => {
  if (test.info().project.name !== "Desktop Chrome") return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const PRODUCTS = [
  { id: "m-jersey", name: "KAvach Match Jersey", description: "Official scarlet match jersey", category: "Jersey", basePrice: 1299, sizes: ["M", "L"], specs: [], minOrderQuantity: 1, status: "Accepting Orders" },
  { id: "m-cap", name: "Club Cap", description: "Black club cap", category: "Cap", basePrice: 499, sizes: [], specs: [], minOrderQuantity: 1, status: "Accepting Orders" },
];

async function open(page: Page, uid: string, role: Omit<RoleConfig, "uid">, shop: boolean, width = 1280, height = 900) {
  await page.setViewportSize({ width, height });
  await injectSyntheticSession(page, { uid, ...role, features: { shop } });
  // Seed catalogue and the player's own Shop order into the synthetic store.
  await page.addInitScript(
    ({ products, playerId }) => {
      const s = (window as any).__KAVACH_TEST_STORE__;
      s.merchandises = products;
      s.merchOrders = [
        { id: "mo-1", playerId, playerName: "Me", merchId: "m-cap", merchName: "Club Cap", price: 499, paymentStatus: "Paid", orderStatus: "Order Placed", createdAt: { seconds: 1764000000 }, updatedAt: { seconds: 1764000000 } },
      ];
    },
    { products: PRODUCTS, playerId: `player-${uid}` },
  );
  await page.goto("/");
  await expect(page.locator('[data-testid="player-home-container"]')).toBeVisible({ timeout: 30_000 });
}
const toAdmin = (page: Page) => page.locator('[data-testid="header-persona-toggle"]').click();
const nav = (page: Page, tab: string, action?: string) => page.evaluate(([t, a]) => (window as any).__KAVACH_NAVIGATE_TAB__(t, a), [tab, action]);

test.describe("Player Club: Shop is an on-demand facility", () => {
  test("enabled: Club shows the Shop card and it opens the Shop with products and My Orders", async ({ page }) => {
    await open(page, "shop-player", { role: "player" }, true);
    await page.locator('[data-testid="sidebar-player-club"]').click();
    const card = page.locator('[data-testid="club-shop-card"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await shoot(page, "01-player-club-shop-enabled");
    await card.click();
    await expect(page.getByText("KAvach Match Jersey").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Club Cap").first()).toBeVisible();
    await shoot(page, "02-player-shop");
    await expect(page.getByRole("button", { name: /My Orders \(1\)/ })).toBeVisible();
    // Back goes to Club, not a separate navigation layer; bottom/side nav stays Home · Club · Matches.
    expect(await page.locator('[data-testid^="sidebar-player-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")))).toEqual([
      "sidebar-player-home",
      "sidebar-player-club",
      "sidebar-player-matches",
    ]);
  });

  test("disabled: no Shop card, no placeholder; opening the Shop directly redirects away", async ({ page }) => {
    await open(page, "shop-player-off", { role: "player" }, false);
    await page.locator('[data-testid="sidebar-player-club"]').click();
    await expect(page.locator('[data-testid="club-tiles"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="club-shop-card"]')).toHaveCount(0);
    await expect(page.getByText(/Club Shop/)).toHaveCount(0);
    await shoot(page, "03-player-club-shop-disabled");
    await nav(page, "shop");
    await expect(page.getByText("KAvach Match Jersey")).toHaveCount(0);
  });

  test("Shop purchase appears in My Payments history as 'Shop: <item>'", async ({ page }) => {
    await open(page, "shop-history", { role: "player" }, true);
    await nav(page, "finance");
    const history = page.getByRole("button", { name: /history/i }).first();
    await history.click();
    await expect(page.getByText("Shop: Club Cap").first()).toBeVisible({ timeout: 10_000 });
    await shoot(page, "04-player-payment-history-shop");
  });

  test("mobile 390: Shop card fits the Club screen without horizontal scroll", async ({ page }) => {
    await open(page, "shop-mobile", { role: "player" }, true, 390, 844);
    await page.locator('[data-testid="player-nav-club"]').click();
    await expect(page.locator('[data-testid="club-shop-card"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="club-shop-card"]').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (test.info().project.name === "Desktop Chrome") await page.screenshot({ path: path.join(SHOTS, "05-player-club-shop-390.png") });
  });
});

test.describe("Admin Club: Club Menu and Shop controls", () => {
  test("Club Menu lists Club Shop; the panel toggles the Shop through the server route and opens Products/Orders", async ({ page }) => {
    const calls: any[] = [];
    await page.route("**/api/admin/shop", async (route) => {
      const body = route.request().postDataJSON();
      calls.push(body);
      await route.fulfill({ json: { ok: true, changed: true, enabled: body.enabled } });
    });
    await open(page, "shop-admin", { role: "admin", isClubAdmin: true }, true);
    await toAdmin(page);
    await nav(page, "club");
    await page.locator('[data-testid="club-menu-button"]').click();
    const menu = page.locator('[data-testid="club-menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="club-menu-shop"]')).toContainText("Club Shop");
    await shoot(page, "06-admin-club-menu");
    await menu.locator('[data-testid="club-menu-shop"]').click();
    const panel = page.locator('[data-testid="club-shop-panel"]');
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-testid="club-shop-status"]')).toHaveText("Enabled");
    await expect(page.locator('[data-testid="club-shop-action-products"]')).toContainText("2");
    await expect(page.locator('[data-testid="club-shop-action-orders"]')).toContainText("1 new");
    await shoot(page, "07-admin-club-shop-panel");
    await page.locator('[data-testid="club-shop-toggle"]').click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual({ enabled: false });
    // Confirmed by the server → the switch settles (no lingering Saving state).
    await expect(page.locator('[data-testid="club-shop-status"]')).toHaveText("Disabled");
    await expect(page.locator('[data-testid="club-shop-toggle"]')).toBeEnabled();
    await expect(page.locator('[data-testid="club-shop-toggle"]')).toHaveAttribute("aria-checked", "false");
    await page.locator('[data-testid="club-shop-action-orders"]').click();
    await expect(page.getByRole("button", { name: /All Customer Orders/ })).toBeVisible();
    await shoot(page, "08-admin-shop-orders");
    await page.locator('[data-testid="club-shop-action-products"]').click();
    await expect(page.getByRole("button", { name: /New Item/ })).toBeVisible();
  });

  test("Shop disabled for players: admins still reach the Shop panel, products and existing orders", async ({ page }) => {
    await open(page, "shop-admin-off", { role: "admin", isClubAdmin: true }, false);
    await toAdmin(page);
    await nav(page, "club", "shop");
    await expect(page.locator('[data-testid="club-shop-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="club-shop-status"]')).toHaveText("Disabled");
    await expect(page.locator('[data-testid="club-shop-toggle"]')).toHaveAttribute("aria-checked", "false");
    await page.locator('[data-testid="club-shop-action-orders"]').click();
    await expect(page.getByText("Club Cap").first()).toBeVisible();
    await shoot(page, "09-admin-shop-disabled");
  });

  test("Finance-only admin has no Club → Shop", async ({ page }) => {
    await open(page, "shop-fin", { role: "admin", isFinanceAdmin: true }, true);
    await toAdmin(page);
    await nav(page, "club", "shop");
    await expect(page.locator('[data-testid="club-shop-panel"]')).toHaveCount(0);
  });

  test("mobile 390: Club Menu is a bottom sheet; Shop panel has no horizontal scroll", async ({ page }) => {
    await open(page, "shop-admin-m", { role: "admin", isClubAdmin: true }, true, 390, 844);
    await toAdmin(page);
    await nav(page, "club", "shop");
    await expect(page.locator('[data-testid="club-shop-panel"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (test.info().project.name === "Desktop Chrome") await page.screenshot({ path: path.join(SHOTS, "10-admin-shop-panel-390.png") });
    await page.locator('[data-testid="club-menu-button"]').click();
    await expect(page.locator('[data-testid="club-menu"]')).toBeVisible();
    if (test.info().project.name === "Desktop Chrome") await page.screenshot({ path: path.join(SHOTS, "11-admin-club-menu-390.png") });
  });
});
