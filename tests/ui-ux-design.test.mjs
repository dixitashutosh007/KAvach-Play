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
