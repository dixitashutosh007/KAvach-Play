/**
 * Club Shop placement and wiring (`tests/club-shop.test.mjs`). Imports the
 * PRODUCTION modules lib/shop-config.ts and lib/admin-navigation.ts; source
 * checks for the UI/loader wiring. No emulator, browser or network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isShopEnabled, ShopClosedError } from "../lib/shop-config.ts";
import { getVisibleClubSections } from "../lib/admin-navigation.ts";

const src = (f) => fs.readFileSync(f, "utf-8");

describe("Shop availability flag (existing appConfig.features.shop)", () => {
  it("absent or true = enabled; only explicit false disables", () => {
    assert.equal(isShopEnabled(null), true);
    assert.equal(isShopEnabled({}), true);
    assert.equal(isShopEnabled({ features: {} }), true);
    assert.equal(isShopEnabled({ features: { shop: true } }), true);
    assert.equal(isShopEnabled({ features: { shop: false } }), false);
    assert.equal(new ShopClosedError().code, "SHOP_CLOSED");
  });
});

describe("Admin: Shop management is available regardless of the player-facing switch", () => {
  const club = { isSuperAdmin: false, isClubAdmin: true, isFinanceAdmin: false };
  it("Club Admin sees the Shop section even when the shop feature is off", () => {
    assert.ok(getVisibleClubSections(club, (f) => f !== "shop").includes("shop"));
  });
  it("Finance-only admins do not get Club → Shop", () => {
    assert.ok(!getVisibleClubSections({ isSuperAdmin: false, isClubAdmin: false, isFinanceAdmin: true }).includes("shop"));
  });
  it("Club tab renders the management panel + Club Menu; toggle goes through the server route", () => {
    const tab = src("components/ClubTab.tsx");
    assert.match(tab, /<ClubShopPanel/);
    assert.match(tab, /data-testid="club-menu-button"/);
    assert.match(src("components/club/ClubShopPanel.tsx"), /apiFetch\("\/api\/admin\/shop"/);
    assert.match(src("app/api/admin/shop/route.ts"), /const guard = await requireClubAdmin\(req\);/);
  });
});

describe("Player: Shop is an on-demand Club facility", () => {
  it("Club shows the Shop card only while enabled; not in the bottom navigation", () => {
    assert.match(src("components/club/PlayerClubTab.tsx"), /section === "all" && isFeatureEnabled\("shop"\) && \(/);
    assert.doesNotMatch(src("lib/player-navigation.ts"), /PLAYER_PRIMARY[\s\S]{0,200}shop/);
    assert.match(src("lib/player-navigation.ts"), /shop: \{ parent: "club", label: "Club Shop", feature: "shop" \}/);
  });
  it("the Shop screen loads the catalogue and the player's own orders (also for Payments and Profile history)", () => {
    const page = src("app/page.tsx");
    assert.match(page, /const MERCH_TABS = new Set\(\["club", "shop", "finance", "profile"\]\);/);
    assert.match(page, /const MERCH_CATALOG_TABS = new Set\(\["club", "shop"\]\);/);
    assert.match(page, /store\.ensureMerchOrders\?\.\(playerScope\)/);
    assert.match(src("hooks/useStore.ts"), /playerIdFilter \? query\(base, where\("playerId", "==", playerIdFilter\)\) : base/);
  });
  it("server blocks new purchases when disabled (order route) and rules block direct order writes", () => {
    assert.match(src("lib/razorpay-order.ts"), /await assertShopOpen\(db\);/);
    assert.match(src("app/api/razorpay/order/route.ts"), /if \(err instanceof ShopClosedError\)/);
    assert.match(src("firestore.rules"), /allow create: if isSignedIn\(\)\s*&& isShopEnabled\(\)/);
  });
  it("Shop purchases appear in the existing payment history as 'Shop: <item>'", () => {
    assert.match(src("components/FinanceTab.tsx"), /title: `Shop: \$\{o\.merchName\}`/);
  });
});
