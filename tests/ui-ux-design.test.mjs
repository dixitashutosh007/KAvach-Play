import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Direct production code imports (QA-001)
import { THEME_PRESETS, resolveTheme } from "../lib/theme.ts";

test("UX-002: Design tokens define primary brand #A30F2D and primary action #D51F43", () => {
  const defaultTheme = resolveTheme("kavach", null);
  assert.equal(defaultTheme.id, "kavach");
  assert.equal(defaultTheme.mode, "light");
  assert.equal(defaultTheme.brand, "#A30F2D", "Primary brand must be #A30F2D");
  assert.equal(defaultTheme.accent, "#D51F43", "Primary action must be #D51F43");
  assert.equal(defaultTheme.brandSurface, "#FCE8ED", "Brand surface must be #FCE8ED");
  assert.equal(defaultTheme.bg, "#F6F7F9", "Background must be #F6F7F9");
  assert.equal(defaultTheme.textPrimary, "#171C26", "Main text must be #171C26");
  assert.equal(defaultTheme.textSecondary, "#667085", "Secondary text must be #667085");

  // Verify globals.css contains matching CSS custom properties
  const css = fs.readFileSync(path.resolve("app/globals.css"), "utf-8");
  assert.match(css, /--color-brand:\s*var\(--theme-brand,\s*#A30F2D\);/);
  assert.match(css, /--color-accent:\s*var\(--theme-accent,\s*#D51F43\);/);
  assert.match(css, /--color-brand-surface:\s*var\(--theme-brand-surface,\s*#FCE8ED\);/);
});

test("UX-003: LoadingScreen uses light-first scarlet sports-tech design and has zero dark-green #022c22", () => {
  const loadingScreenCode = fs.readFileSync(path.resolve("components/LoadingScreen.tsx"), "utf-8");
  
  // Verify dark-green hexes are completely eliminated
  assert.equal(loadingScreenCode.includes("#022c22"), false, "LoadingScreen must not contain #022c22");
  assert.equal(loadingScreenCode.includes("#034032"), false, "LoadingScreen must not contain #034032");
  assert.equal(loadingScreenCode.includes("#01140f"), false, "LoadingScreen must not contain #01140f");
  
  // Verify light background and scarlet brand tokens are used
  assert.ok(loadingScreenCode.includes("#F6F7F9"), "LoadingScreen must use light background #F6F7F9");
  assert.ok(loadingScreenCode.includes("#A30F2D"), "LoadingScreen must use scarlet brand #A30F2D");
  assert.ok(loadingScreenCode.includes("#D51F43"), "LoadingScreen must use action accent #D51F43");
});

test("UX-004: MobileBottomNav provides complete navigation for both admin and player personas", () => {
  const navCode = fs.readFileSync(path.resolve("components/layout/MobileBottomNav.tsx"), "utf-8");

  // Verify that persona !== 'player' does not cause early null return
  assert.equal(navCode.includes('persona !== "player"'), false, "Must not return null for admin persona");
  assert.equal(navCode.includes("persona !== 'player'"), false, "Must not return null for admin persona");

  // Verify that admin persona renders admin-specific hubs
  assert.ok(navCode.includes('data-testid="admin-mobile-bottom-nav"'), "Admin mobile bottom nav must be defined");
  assert.ok(navCode.includes('data-testid="player-mobile-bottom-nav"'), "Player mobile bottom nav must be defined");
  assert.ok(navCode.includes('title="Match Centre"'), "Admin mobile nav must include Match Centre");
  assert.ok(navCode.includes('title="Finance & Dues"'), "Admin mobile nav must include Finance & Dues");
  assert.ok(navCode.includes('title="Club & Roster"'), "Admin mobile nav must include Club & Roster");
});

test("UX-001 & UX-005: Header enforces mobile touch targets (>= 44px) and prevents narrow viewport collision", () => {
  const pageCode = fs.readFileSync(path.resolve("app/page.tsx"), "utf-8");

  // Check touch targets in header
  assert.ok(pageCode.includes("min-h-[44px]"), "Header action buttons must enforce min 44px touch target height");
  assert.ok(pageCode.includes("min-w-[44px]"), "Header icon buttons must enforce min 44px touch target width");

  // Check truncation and compact mobile toggle to prevent header collision at 360px
  assert.ok(pageCode.includes("truncate leading-tight uppercase"), "Header title must truncate to prevent line collision");
  assert.ok(pageCode.includes('xs:hidden">{persona === "admin" ? "Player" : "Admin"}</span>'), "Header must use compact label on narrow mobile");
});

test("UX-P0-01: Player Club Screen is connected and renders player sub-views", () => {
  const pageCode = fs.readFileSync(path.resolve("app/page.tsx"), "utf-8");
  const clubTabCode = fs.readFileSync(path.resolve("components/ClubTab.tsx"), "utf-8");

  // Verify app/page.tsx connects activeTab === "club" under persona === "player"
  assert.ok(
    pageCode.includes('{activeTab === "club" && (\n                    <ClubTab'),
    "app/page.tsx must connect ClubTab under persona === 'player'",
  );

  // Verify ClubTab handles player persona
  assert.ok(
    clubTabCode.includes("const isPlayer = persona === \"player\";"),
    "ClubTab must check for player persona",
  );
  assert.ok(
    clubTabCode.includes('key: "profile", label: "My Card"'),
    "ClubTab player view must offer My Card profile",
  );
  assert.ok(
    clubTabCode.includes('key: "studio", label: "Studio & Nets"'),
    "ClubTab player view must offer Studio & Nets passes",
  );
  assert.ok(
    clubTabCode.includes('key: "shop", label: "Shop"'),
    "ClubTab player view must offer Shop",
  );
  assert.ok(
    clubTabCode.includes('key: "pulse", label: "Pulse"'),
    "ClubTab player view must offer Pulse polls",
  );
  assert.ok(
    clubTabCode.includes('isAdmin={!isPlayer}'),
    "ClubTab must pass isAdmin=false to ShopTab when in player mode",
  );
});

test("UX-P0-03: Player MobileBottomNav renders the 5 approved primary items", () => {
  const navCode = fs.readFileSync(path.resolve("components/layout/MobileBottomNav.tsx"), "utf-8");

  assert.ok(navCode.includes('<span className={labelCls}>Home</span>'), "Nav must include Home");
  assert.ok(navCode.includes('<span className={labelCls}>Matches</span>'), "Nav must include Matches");
  assert.ok(navCode.includes('<span className={labelCls}>Payments</span>'), "Nav must include Payments");
  assert.ok(navCode.includes('<span className={labelCls}>Performance</span>'), "Nav must include Performance");
  assert.ok(navCode.includes('<span className={labelCls}>Club</span>'), "Nav must include Club");
});

test("UX-P1-01: Admin experience eliminates dual mobile navigation bars and provides Return to Player View", () => {
  const pageCode = fs.readFileSync(path.resolve("app/page.tsx"), "utf-8");

  // Verify that the redundant top horizontal pill buttons are eliminated
  assert.equal(
    pageCode.includes("data-testid=\"admin-mobile-tab-"),
    false,
    "Top duplicate mobile pill buttons must be eliminated",
  );

  // Verify admin hub context banner is rendered
  assert.ok(
    pageCode.includes("data-testid=\"admin-hub-context-banner\""),
    "Admin hub context banner must be present",
  );

  // Verify Return to Player View action is available
  assert.ok(
    pageCode.includes("title=\"Return to Player View\""),
    "Context banner must provide Return to Player View button",
  );
  assert.ok(
    pageCode.includes("Return to Player View"),
    "Desktop sidebar must provide Return to Player View button",
  );
});

test("UX-P1-02: Enforce scarlet-led design tokens and eliminate hardcoded emerald shadows and dark themes", () => {
  const financeCode = fs.readFileSync(path.resolve("components/FinanceTab.tsx"), "utf-8");
  const matchesCode = fs.readFileSync(path.resolve("components/MatchesTab.tsx"), "utf-8");
  const studioCode = fs.readFileSync(path.resolve("components/StudioTab.tsx"), "utf-8");
  const policyCode = fs.readFileSync(path.resolve("app/policy/page.tsx"), "utf-8");
  const legalCode = fs.readFileSync(path.resolve("app/legal/page.tsx"), "utf-8");

  // Verify checkout modals use primary action color #D51F43
  assert.ok(financeCode.includes('color: "#D51F43"'), "Finance Razorpay checkout must use #D51F43");
  assert.ok(matchesCode.includes('color: "#D51F43"'), "Matches Razorpay checkout must use #D51F43");
  assert.ok(studioCode.includes('color: "#D51F43"'), "Studio Razorpay checkout must use #D51F43");

  // Verify hardcoded emerald glow shadows are eliminated
  assert.equal(financeCode.includes("16,185,129"), false, "FinanceTab must not contain hardcoded emerald rgba shadows");

  // Verify Policy and Legal pages use light background #F6F7F9 and scarlet brand #A30F2D
  assert.equal(policyCode.includes("#022c22"), false, "Policy page must not contain dark green #022c22");
  assert.ok(policyCode.includes("#F6F7F9"), "Policy page must use light background #F6F7F9");
  assert.ok(policyCode.includes("#A30F2D"), "Policy page must use primary brand #A30F2D");

  assert.equal(legalCode.includes("bg-black"), false, "Legal page must not use bg-black");
  assert.ok(legalCode.includes("#F6F7F9"), "Legal page must use light background #F6F7F9");
  assert.ok(legalCode.includes("#A30F2D"), "Legal page must use primary brand #A30F2D");
});
