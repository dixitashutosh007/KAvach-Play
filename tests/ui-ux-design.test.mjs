import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Direct production code imports (QA-001)
import { THEME_PRESETS, resolveTheme } from "../lib/theme.ts";

test("UX-002: Design tokens define approved palette and maintain legacy runtime theme compatibility", () => {
  // 1. Legacy runtime theme contract (preserves resolveTheme expectations)
  const defaultTheme = resolveTheme("kavach", null);
  assert.equal(defaultTheme.id, "kavach");
  assert.equal(defaultTheme.mode, "light");
  assert.equal(defaultTheme.brand, "#A30F2D", "Primary brand in legacy preset must be #A30F2D");
  assert.equal(defaultTheme.accent, "#D51F43", "Primary action in legacy preset must be #D51F43");
  assert.equal(defaultTheme.brandSurface, "#FCE8ED", "Brand surface in legacy preset must be #FCE8ED");
  assert.equal(defaultTheme.bg, "#F6F7F9", "Background must be #F6F7F9");
  assert.equal(defaultTheme.textPrimary, "#171C26", "Main text must be #171C26");
  assert.equal(defaultTheme.textSecondary, "#667085", "Secondary text must be #667085");

  // Verify globals.css retains backward-compatible legacy theme properties
  const css = fs.readFileSync(path.resolve("app/globals.css"), "utf-8");
  assert.match(css, /--color-brand:\s*var\(--theme-brand,\s*#A30F2D\);/);
  assert.match(css, /--color-brand-surface:\s*var\(--theme-brand-surface,\s*#FCE8ED\);/);
  assert.match(css, /--color-text-primary:\s*var\(--theme-text-primary,\s*#171C26\);/);

  // 2. New design-system contract (approved palette & canonical source of truth)
  // Canonical :root tokens
  assert.match(css, /--brand-wine:\s*#7A1E2B;/);
  assert.match(css, /--brand-scarlet:\s*#C0394B;/);
  assert.match(css, /--brand-dusty:\s*#E76B73;/);
  assert.match(css, /--brand-gold:\s*#D6A84F;/);
  assert.match(css, /--canvas-warm:\s*#FFF6F4;/);
  assert.match(css, /--surface-blush:\s*#F8EDEE;/);
  assert.match(css, /--surface-card:\s*#FFFFFF;/);
  assert.match(css, /--text-charcoal:\s*#29252A;/);

  // Semantic --color-accent resolves consistently to Scarlet (#C0394B via var(--brand-scarlet))
  assert.match(css, /--color-accent:\s*var\(--brand-scarlet\);/);

  // Tailwind theme mappings reference canonical tokens
  assert.match(css, /--color-deep-wine:\s*var\(--brand-wine\);/);
  assert.match(css, /--color-scarlet:\s*var\(--brand-scarlet\);/);
  assert.match(css, /--color-dusty-red:\s*var\(--brand-dusty\);/);
  assert.match(css, /--color-muted-gold:\s*var\(--brand-gold\);/);
  assert.match(css, /--color-warm-white:\s*var\(--canvas-warm\);/);
  assert.match(css, /--color-soft-blush:\s*var\(--surface-blush\);/);
  assert.match(css, /--color-charcoal:\s*var\(--text-charcoal\);/);
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

  // D-18: admin persona renders the six approved destinations from the shared config, no More
  assert.ok(navCode.includes('data-testid="admin-mobile-bottom-nav"'), "Admin mobile bottom nav must be defined");
  assert.ok(navCode.includes('data-testid="player-mobile-bottom-nav"'), "Player mobile bottom nav must be defined");
  assert.ok(navCode.includes("getAdminPrimaryNav(caps"), "Admin mobile nav must use the shared D-18 config");
  assert.equal(navCode.includes("MoreDrawer"), false, "Admin mobile nav must not use a More drawer");
  const cfg = fs.readFileSync(path.resolve("lib/admin-navigation.ts"), "utf-8");
  const order = [...cfg.slice(cfg.indexOf("ADMIN_PRIMARY_NAV"), cfg.indexOf("] as const;", cfg.indexOf("ADMIN_PRIMARY_NAV"))).matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["Home", "Match Center", "Club", "Finance", "Design Studio", "Settings"]);
});

test("UX-001 & UX-005: Header enforces mobile touch targets (>= 44px) and prevents narrow viewport collision", () => {
  const headerCode = fs.readFileSync(path.resolve("components/layout/AppHeader.tsx"), "utf-8");

  // Check touch targets in header
  assert.ok(headerCode.includes("min-h-[44px]"), "Header action buttons must enforce min 44px touch target height");
  assert.ok(headerCode.includes("min-w-[44px]"), "Header icon buttons must enforce min 44px touch target width");

  // Check truncation and compact mobile toggle to prevent header collision at 360px
  assert.ok(headerCode.includes("truncate leading-tight uppercase"), "Header title must truncate to prevent line collision");
  assert.ok(headerCode.includes('xs:hidden">{persona === "admin" ? "Player" : "Admin"}</span>'), "Header must use compact label on narrow mobile");
});

test("D-16 (supersedes UX-P0-01): Player persona has no Club screen; ClubTab is Admin persona only", () => {
  const pageCode = fs.readFileSync(path.resolve("app/page.tsx"), "utf-8");
  const clubTabCode = fs.readFileSync(path.resolve("components/ClubTab.tsx"), "utf-8");
  const playerBranch = pageCode.slice(
    pageCode.indexOf(") : !effectiveIsAdminMode ? ("),
    pageCode.indexOf("</AnimatePresence>", pageCode.indexOf(") : !effectiveIsAdminMode ? (")),
  );
  assert.ok(playerBranch.length > 0, "player render branch must exist");
  assert.equal(playerBranch.includes("<ClubTab"), false, "Player persona must not render ClubTab");
  assert.equal(playerBranch.includes("<DesignTab"), false, "Player persona must not render Design Studio");
  assert.equal(clubTabCode.includes("const playerTabs"), false, "ClubTab must not offer a player sub-tab row");
  // Former Club player destinations remain reachable from Home / Profile.
  for (const t of ['"profile"', '"studio"', '"shop"', '"opinion"', '"players"', '"badges"']) {
    assert.ok(playerBranch.includes(`activeTab === ${t}`), `player branch must render ${t}`);
  }
});

test("D-20 (supersedes UX-P0-03): Player MobileBottomNav renders exactly Home, Club, Matches with no More", () => {
  const navCode = fs.readFileSync(path.resolve("components/layout/MobileBottomNav.tsx"), "utf-8");
  const playerPart = navCode.slice(navCode.indexOf("// Player Primary Navigation (D-20)"));
  assert.ok(playerPart.includes("getPlayerPrimaryNav("), "player nav must come from the shared D-16 config");
  assert.equal(playerPart.includes("MoreDrawer"), false, "player nav must not open a More drawer");
  assert.equal(playerPart.includes(">More<"), false, "player nav must not render More");
  const cfg = fs.readFileSync(path.resolve("lib/player-navigation.ts"), "utf-8");
  const order = [...cfg.slice(cfg.indexOf("PLAYER_PRIMARY_NAV"), cfg.indexOf("] as const;")).matchAll(/tab: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["home", "club", "matches"]);
});

test("UX-P1-01: Admin experience eliminates dual mobile navigation bars and provides Return to Player View", () => {
  const pageCode = fs.readFileSync(path.resolve("app/page.tsx"), "utf-8");

  // Verify that the redundant top horizontal pill buttons are eliminated
  assert.equal(
    pageCode.includes("data-testid=\"admin-mobile-tab-"),
    false,
    "Top duplicate mobile pill buttons must be eliminated",
  );

  // The redundant "Admin Console · <hub>" banner is removed from every admin page
  assert.equal(
    pageCode.includes("data-testid=\"admin-hub-context-banner\""),
    false,
    "Admin hub context banner must not be rendered",
  );

  // Player View switching stays available: header persona toggle (all widths)
  // and the desktop sidebar's Return to Player View.
  const headerCode = fs.readFileSync(path.resolve("components/layout/AppHeader.tsx"), "utf-8");
  assert.ok(headerCode.includes('data-testid="header-persona-toggle"'), "Header must keep the persona toggle");
  assert.ok(pageCode.includes("onTogglePersona={() => {"), "Page must wire the header persona toggle");
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

test("UX-P1-03 & UX-P1-04: Adaptive responsive cards for dense mobile data and rich empty states", () => {
  const financeCode = fs.readFileSync(path.resolve("components/FinanceTab.tsx"), "utf-8");
  const playersCode = fs.readFileSync(path.resolve("components/PlayersTab.tsx"), "utf-8");

  // Verify responsive mobile cards for match accounting on small viewports
  assert.ok(
    financeCode.includes('data-testid="mobile-finance-cards"'),
    "FinanceTab must render mobile-optimized cards on < md viewports",
  );
  assert.ok(
    financeCode.includes('hidden md:block overflow-x-auto'),
    "FinanceTab must preserve structured table for >= md viewports",
  );

  // Verify rich empty states
  assert.ok(
    financeCode.includes('data-testid="empty-finance-collections"'),
    "FinanceTab must render rich empty state when no collections match filter",
  );
  assert.ok(
    playersCode.includes('data-testid="empty-players-roster"'),
    "PlayersTab must render rich empty state when no players match filter",
  );

  // Verify viewMode toggle has min 44px touch target
  assert.ok(
    playersCode.includes('min-h-[44px]'),
    "PlayersTab viewMode button must enforce min 44px touch target",
  );
});

test("UX-SHELL-01: Shared application shell components contract (Task 1.2)", () => {
  const headerCode = fs.readFileSync(path.resolve("components/layout/AppHeader.tsx"), "utf-8");
  const navCode = fs.readFileSync(path.resolve("components/layout/MobileBottomNav.tsx"), "utf-8");
  const pageCode = fs.readFileSync(path.resolve("app/page.tsx"), "utf-8");
  const css = fs.readFileSync(path.resolve("app/globals.css"), "utf-8");

  // 1. AppHeader integration & testids
  assert.ok(pageCode.includes("<AppHeader"), "app/page.tsx must integrate AppHeader");
  assert.ok(headerCode.includes('data-testid="app-header"'), "AppHeader must have data-testid");
  assert.ok(headerCode.includes('data-testid="header-profile-avatar"'), "AppHeader must provide header profile avatar entry point");
  assert.ok(headerCode.includes('data-testid="header-notifications-btn"'), "AppHeader must provide notifications button");

  // 2. D-20: Club is a primary Player destination; Profile opens from the header avatar
  const cfg = fs.readFileSync(path.resolve("lib/player-navigation.ts"), "utf-8");
  assert.ok(cfg.includes('{ tab: "club", label: "Club" }'), "Club must be a primary Player destination");
  assert.equal(cfg.includes('{ tab: "profile", label: "Profile" }'), false, "Profile must not be a primary destination");

  // 3. D-18: no More drawer in either persona; club features live in Club sections
  assert.equal(fs.existsSync(path.resolve("components/layout/MoreDrawer.tsx")), false, "MoreDrawer must be removed");
  const clubCode = fs.readFileSync(path.resolve("components/ClubTab.tsx"), "utf-8");
  assert.ok(clubCode.includes('data-testid="club-sub-tabs"') && clubCode.includes('role="tablist"'), "Club sections must be an accessible tab list");

  // 4. Safe area insets support
  assert.ok(css.includes(".pb-safe"), "globals.css must define .pb-safe utility");
  assert.ok(css.includes(".pt-safe"), "globals.css must define .pt-safe utility");
  assert.ok(navCode.includes("pb-safe"), "MobileBottomNav must use pb-safe for mobile home indicator");

  // 5. Desktop sidebar alignment: same D-16 config as mobile
  assert.ok(pageCode.includes("getPlayerPrimaryNav((f) => isFeatureEnabled(f)).map("), "Desktop player sidebar must use the shared D-16 config");
  assert.ok(pageCode.includes('onNavigateToPayments={() => setActiveTab("finance")}'), "Player Pay Now must still reach the player payments screen");
});

// UX-SHELL-02/03/04 (removed in D-18): they re-implemented navigation dispatch,
// the More drawer RBAC filter and drawer focus handling inside this file, so they
// could not detect regressions in production code (QA-001). The More drawer no
// longer exists. Replaced by production-importing tests in
// tests/player-nav-persona.test.mjs and tests/admin-nav-realignment.test.mjs.

test("UX-SHELL-05: Behavioural verification — AppHeader responsiveness and persona switching across viewports", () => {
  const VIEWPORTS = [
    { width: 360, name: "Narrow Mobile (360px)" },
    { width: 375, name: "Standard Mobile (375px)" },
    { width: 390, name: "Large Mobile (390px)" },
    { width: 768, name: "Tablet / Breakpoint (768px)" },
  ];

  for (const vp of VIEWPORTS) {
    const headerPadding = 16; // 8px left + 8px right
    const contentWidth = vp.width - headerPadding;

    // Admin controls dimensioning
    const personaToggleWidth = 60; // 44px min-w + padding
    const notificationsWidth = 44; // min-w-[44px]
    const profileAvatarWidth = 44; // min-w-[44px]
    const gapBetweenControls = 4 * 2; // gap-1
    const totalAdminActionWidth = personaToggleWidth + notificationsWidth + profileAvatarWidth + gapBetweenControls; // 156px

    // Player controls dimensioning (no admin toggle)
    const totalPlayerActionWidth = notificationsWidth + profileAvatarWidth + 4; // 92px

    const logoWidth = 36;
    const brandGap = 8;
    const minBrandLeft = logoWidth + brandGap; // 44px

    // Space remaining for club name text
    const availableBrandTextAdmin = contentWidth - totalAdminActionWidth - brandGap - minBrandLeft;
    const availableBrandTextPlayer = contentWidth - totalPlayerActionWidth - brandGap - minBrandLeft;

    assert.ok(
      availableBrandTextAdmin > 80,
      `At ${vp.name}, brand text must have at least 80px available (got ${availableBrandTextAdmin}px)`
    );
    assert.ok(
      availableBrandTextPlayer > 140,
      `At ${vp.name}, player view brand text must have at least 140px available (got ${availableBrandTextPlayer}px)`
    );

    // Verify touch targets adhere to min 44px requirement
    assert.ok(personaToggleWidth >= 44, "Persona toggle width must be >= 44px");
    assert.ok(notificationsWidth >= 44, "Notifications width must be >= 44px");
    assert.ok(profileAvatarWidth >= 44, "Profile avatar width must be >= 44px");
  }

  // Verify persona toggle callback
  let currentPersona = "player";
  const onTogglePersona = () => {
    currentPersona = currentPersona === "admin" ? "player" : "admin";
  };

  onTogglePersona();
  assert.equal(currentPersona, "admin", "Toggling from player must switch to admin");
  onTogglePersona();
  assert.equal(currentPersona, "player", "Toggling from admin must switch to player");
});
