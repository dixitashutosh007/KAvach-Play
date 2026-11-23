/**
 * D-16 Player persona navigation & persona isolation (`tests/player-nav-persona.test.mjs`).
 *
 * Imports and renders PRODUCTION modules (no duplicated logic): the shared
 * navigation config, MobileBottomNav, HomeQuickActions, the Profile hub cards
 * and the extracted leaderboard / Studio-membership helpers. Server-side
 * rendering only — no browser, emulator, network or database access.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import ReactDOMServer from "react-dom/server";

const req = createRequire(import.meta.url);
const cache = new Map();
const withExt = (b) => {
  for (const e of [".tsx", ".ts", ".js"]) if (fs.existsSync(b + e)) return b + e;
  return b;
};
function load(f) {
  const abs = path.resolve(f);
  if (cache.has(abs)) return cache.get(abs);
  const js = ts.transpileModule(fs.readFileSync(abs, "utf-8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(abs, mod.exports);
  const dir = path.dirname(abs);
  const r = (id) => {
    if (id === "react") return React;
    if (id.startsWith("@/lib/")) return load(withExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("@/components/")) return load(withExt(path.resolve("components", id.slice(13))));
    if (id.startsWith("./") || id.startsWith("../")) return load(withExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  cache.set(abs, mod.exports);
  return mod.exports;
}
const render = (el) => ReactDOMServer.renderToStaticMarkup(el);
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");
const decode = (t) => t.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const buttonLabels = (html) => [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => decode(m[1]));

const nav = load("lib/player-navigation.ts");
const { MobileBottomNav } = load("components/layout/MobileBottomNav.tsx");
const { HomeQuickActions } = load("components/home/HomeQuickActions.tsx");
const { ProfilePerformanceCard, ProfileStudioCard } = load("components/profile/ProfileHubCards.tsx");
const lb = load("lib/leaderboard.ts");
const studio = load("lib/studio-membership.ts");

// Every admin-capable role from AGENTS.md §4 plus a regular player.
const ROLES = {
  "Regular Player": {},
  "Match Admin": { isMatchAdmin: true },
  "Finance Admin": { isFinanceAdmin: true },
  "Studio Admin": { isStudioAdmin: true },
  "Club Admin": { isClubAdmin: true },
  Designer: { canDesign: true },
  "Super Admin": { isSuperAdmin: true, isClubAdmin: true, isMatchAdmin: true, isFinanceAdmin: true, isStudioAdmin: true, canDesign: true },
};
const ADMIN_LABELS = ["Overview", "Match Centre", "Player Roster", "Finance & Dues", "Studio & Nets", "Design Studio", "Settings & Access", "More", "Finance", "Players"];

function renderBottomNav(persona, perms, activeTab = "home", enabled = () => true) {
  return render(
    React.createElement(MobileBottomNav, {
      activeTab,
      onSelectTab: () => {},
      isFeatureEnabled: enabled,
      persona,
      hasMissingMandatory: false,
      canDesign: !!perms.canDesign,
      adminPermissions: perms,
    }),
  );
}

describe("D-16 navigation config (lib/player-navigation.ts)", () => {
  it("has exactly Home, Profile, Matches in that order", () => {
    assert.deepEqual(nav.getPlayerPrimaryNav().map((i) => [i.tab, i.label]), [["home", "Home"], ["profile", "Profile"], ["matches", "Matches"]]);
  });
  it("takes no role input: the config function signature only accepts a feature check", () => {
    assert.equal(nav.getPlayerPrimaryNav.length <= 1, true);
    assert.doesNotMatch(src("lib/player-navigation.ts"), /isSuperAdmin|isClubAdmin|isMatchAdmin|isFinanceAdmin|isStudioAdmin|isDesigner|canDesign|hasAdminClaim|\.role\b|appUser/);
  });
  it("honours club feature flags for primary items (feed → Home, matches → Matches)", () => {
    assert.deepEqual(nav.getPlayerPrimaryNav((f) => f !== "feed").map((i) => i.tab), ["profile", "matches"]);
    assert.deepEqual(nav.getPlayerPrimaryNav((f) => f !== "matches").map((i) => i.tab), ["home", "profile"]);
  });
  it("maps every secondary destination to its parent", () => {
    const expected = { players: "home", studio: "home", shop: "home", opinion: "home", notifications: "home", leaderboard: "profile", badges: "profile", finance: "profile" };
    for (const [tab, parent] of Object.entries(expected)) assert.equal(nav.getPlayerNavParent(tab), parent, tab);
    for (const p of ["home", "profile", "matches"]) assert.equal(nav.getPlayerNavParent(p), p);
  });
  it("redirects admin-only and unknown tabs out of the Player persona", () => {
    for (const t of ["club", "design", "settings", "grounds", "dues_and_reminders", "nonsense"]) {
      assert.equal(nav.resolvePlayerTab(t), "home", t);
      assert.equal(nav.getPlayerNavParent(t), null, t);
    }
  });
  it("redirects disabled secondary features and falls back to Profile when Home is disabled", () => {
    assert.equal(nav.resolvePlayerTab("shop", (f) => f !== "shop"), "home");
    assert.equal(nav.resolvePlayerTab("leaderboard", (f) => f !== "leaderboard"), "home");
    assert.equal(nav.resolvePlayerTab("studio", (f) => f !== "studio" && f !== "feed"), "profile");
    assert.equal(nav.resolvePlayerTab("notifications", () => true), "notifications");
  });
  it("provides a contextual back link only on secondary screens", () => {
    assert.deepEqual(nav.getPlayerBackLink("shop"), { parent: "home", parentLabel: "Home", label: "Club Shop" });
    assert.deepEqual(nav.getPlayerBackLink("leaderboard"), { parent: "profile", parentLabel: "Profile", label: "Leaderboard" });
    assert.equal(nav.getPlayerBackLink("home"), null);
    assert.equal(nav.getPlayerBackLink("club"), null);
  });
});

describe("Persona isolation — mobile bottom navigation rendered for every role", () => {
  for (const [role, perms] of Object.entries(ROLES)) {
    it(`${role} in Player persona sees exactly Home, Profile, Matches and no admin entries`, () => {
      const html = renderBottomNav("player", perms);
      assert.match(html, /data-testid="player-mobile-bottom-nav"/);
      assert.doesNotMatch(html, /admin-mobile-bottom-nav|more-drawer/);
      assert.deepEqual(buttonLabels(html), ["Home", "Profile", "Matches"]);
      for (const label of ADMIN_LABELS) assert.ok(!buttonLabels(html).includes(label), label);
    });
  }
  it("Player persona output is byte-identical for every role (admin flags have no effect)", () => {
    const base = renderBottomNav("player", ROLES["Regular Player"]);
    for (const [role, perms] of Object.entries(ROLES)) assert.equal(renderBottomNav("player", perms), base, role);
  });
  it("secondary screens highlight their parent; admin-only tabs highlight nothing", () => {
    const current = (html) => [...html.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
    assert.deepEqual(current(renderBottomNav("player", {}, "shop")), ["Home"]);
    assert.deepEqual(current(renderBottomNav("player", {}, "badges")), ["Profile"]);
    assert.deepEqual(current(renderBottomNav("player", {}, "matches")), ["Matches"]);
    assert.deepEqual(current(renderBottomNav("player", {}, "settings")), []);
  });
  it("Admin persona keeps its existing hubs and More (regression)", () => {
    const html = renderBottomNav("admin", ROLES["Super Admin"]);
    assert.match(html, /data-testid="admin-mobile-bottom-nav"/);
    assert.deepEqual(buttonLabels(html), ["Overview", "Match Centre", "Player Roster", "Finance & Dues", "More"]);
  });
});

describe("Persona isolation — app shell wiring (app/page.tsx)", () => {
  const page = src("app/page.tsx");
  const start = page.indexOf(") : !effectiveIsAdminMode ? (");
  const playerBranch = page.slice(start, page.indexOf("</AnimatePresence>", start));
  const sidebarStart = page.indexOf("{!effectiveIsAdminMode ? (\n                <>");
  const playerSidebar = page.slice(sidebarStart, page.indexOf(") : (", sidebarStart));

  it("the player render branch passes no admin authority into any screen", () => {
    assert.ok(playerBranch.length > 500);
    for (const id of ["isSuperAdmin={isSuperAdmin", "isMatchAdmin={isMatchAdmin", "isFinanceAdmin={isFinanceAdmin", "isClubAdmin={isClubAdmin", "isStudioAdmin={isStudioAdmin", "canDesign", "hasAdminClaim", "isAdmin={isAdmin}", "persona={persona}"]) {
      assert.ok(!playerBranch.includes(id), id);
    }
    assert.match(playerBranch, /<HomeTab[\s\S]*?isAdmin=\{false\}/);
    assert.match(playerBranch, /<MatchesTab[\s\S]*?persona="player"[\s\S]*?isMatchAdmin=\{false\}[\s\S]*?isSuperAdmin=\{false\}/);
    assert.match(playerBranch, /<FinanceTab[\s\S]*?isFinanceAdmin=\{false\}/);
    assert.match(playerBranch, /<ShopTab store=\{store\} persona="player" isAdmin=\{false\} \/>/);
    assert.match(playerBranch, /<BadgesTab[\s\S]*?isClubAdmin=\{false\}/);
  });
  it("the player render branch never renders admin hubs", () => {
    for (const c of ["<ClubTab", "<DesignTab", "<SettingsTab", "<GroundsTab", "<AdminDashboard", "<StudioAdminTab", "<DuesAndRemindersTab", "<AdminHomeAnnouncements"]) {
      assert.ok(!playerBranch.includes(c), c);
    }
  });
  it("Player notifications render (previously a blank screen)", () => {
    assert.match(playerBranch, /activeTab === "notifications" && \(\s*<NotificationsTab store=\{store\} persona="player" \/>/);
  });
  it("desktop sidebar uses the same config and order as mobile, with no admin checks", () => {
    assert.match(playerSidebar, /getPlayerPrimaryNav\(\(f\) => isFeatureEnabled\(f\)\)\.map/);
    assert.doesNotMatch(playerSidebar, /isSuperAdmin|isMatchAdmin|isFinanceAdmin|isClubAdmin|isStudioAdmin|canDesign/);
  });
  it("the persona switch is retained and the Player persona guard redirects admin-only tabs", () => {
    assert.match(page, /onTogglePersona=\{\(\) => \{/);
    assert.match(page, /const resolved = resolvePlayerTab\(activeTab, \(f\) => isFeatureEnabled\(f\)\);/);
  });
  it("financial data is scoped to the player in Player persona and re-subscribed on persona change", () => {
    assert.match(page, /const playerScope = isAdminUser && persona === "admin" \? undefined : scopedPlayerId \|\| user\?\.uid;/);
    assert.match(page, /store\.detachDomain\?\.\("allPayments"\);\s*store\.detachDomain\?\.\("allOtherFees"\);\s*scopedPersonaRef\.current = persona;/);
  });
  it("announcement management is mounted on Admin Home only", () => {
    const adminHome = page.slice(page.indexOf("isSuperAdmin || isClubAdmin ? ("), page.indexOf("isSuperAdmin || isClubAdmin ? (") + 1200);
    assert.match(adminHome, /<AdminDashboard[\s\S]*<AdminHomeAnnouncements/);
  });
});

describe("Player screens read no admin authority", () => {
  it("HomeTab has no publishing path or admin checks", () => {
    const home = src("components/HomeTab.tsx");
    for (const re of [/addPost/, /canPublish/, /hasAdminClaim/, /canManage=\{/, /isClubAdmin/]) assert.doesNotMatch(home, re);
  });
  it("PlayerMatchCenter eligibility ignores the signed-in user's admin flags", () => {
    const pmc = src("components/matches/PlayerMatchCenter.tsx");
    assert.match(pmc, /const effectiveIsAdmin = Boolean\(isAdmin\);/);
    for (const t of ["hasAdminClaim", "isMatchAdmin", "isClubAdmin"]) assert.ok(!pmc.includes(t), t);
  });
  it("Player More drawer is gone; MoreDrawer only lists admin hubs", () => {
    const drawer = src("components/layout/MoreDrawer.tsx");
    assert.ok(!drawer.includes("PLAYER_MORE_ITEMS"));
    assert.ok(!src("components/layout/MobileBottomNav.tsx").includes("playerMoreBtnRef"));
  });
});

describe("Home quick access (rendered)", () => {
  it("renders Directory, Studio, Shop, Polls & Pulse, Announcements and dispatches each target", () => {
    const html = render(React.createElement(HomeQuickActions, { isFeatureEnabled: () => true, onNavigate: () => {} }));
    const ids = [...html.matchAll(/data-testid="home-quick-(?!actions")(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ["players", "studio", "shop", "opinion", "announcements"]);
    assert.ok([...html.matchAll(/min-h-\[44px\]/g)].length >= 5, "44px touch targets");
  });
});

describe("Shared helpers import production logic", () => {
  const players = [
    { id: "a", name: "A", totalRuns: 300, stunningCatches: 2, inviteStatus: "Accepted" },
    { id: "b", name: "B", totalRuns: 500, stunningCatches: 2, inviteStatus: "Accepted" },
    { id: "c", name: "C", totalRuns: 500, inviteStatus: "Accepted" },
    { id: "d", name: "D", totalRuns: 900, inviteStatus: "Pending" },
    { id: "e", name: "E", totalRuns: 800, disabled: true },
  ];
  const badges = [{ playerId: "a" }, { playerId: "a" }, { playerId: "b" }];
  it("rankLeaderboard excludes Pending/disabled and zero values, sorted descending", () => {
    const ranked = lb.rankLeaderboard(players, "runs", new Map());
    assert.deepEqual(ranked.map((e) => e.player.id), ["b", "c", "a"]);
    assert.deepEqual(lb.rankLeaderboard(players, "badges", lb.countBadgesByPlayer(badges)).map((e) => [e.player.id, e.value]), [["a", 2], ["b", 1]]);
  });
  it("player standing uses competition ranking (ties share a rank)", () => {
    const counts = new Map();
    assert.deepEqual(lb.getPlayerLeaderboardStanding(players, "c", "runs", counts), { value: 500, rank: 1, total: 3 });
    assert.deepEqual(lb.getPlayerLeaderboardStanding(players, "a", "runs", counts), { value: 300, rank: 3, total: 3 });
    assert.deepEqual(lb.getPlayerLeaderboardStanding(players, "a", "stunning", counts), { value: 2, rank: 1, total: 2 });
    assert.equal(lb.getPlayerLeaderboardStanding(players, "c", "wickets", counts).rank, null);
    assert.equal(lb.getPlayerLeaderboardStanding(players, "d", "runs", counts).rank, null, "Pending players are not ranked");
  });
  it("LeaderboardTab and the Profile card share the same ranking module", () => {
    assert.match(src("components/LeaderboardTab.tsx"), /import \{ rankLeaderboard, countBadgesByPlayer \} from "@\/lib\/leaderboard";/);
    assert.match(src("components/profile/ProfileHubCards.tsx"), /from "@\/lib\/leaderboard";/);
  });
  it("Studio membership status matches the StudioTab rules", () => {
    const day = 86400000, now = Date.UTC(2026, 10, 23);
    const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
    assert.equal(studio.getStudioMembership(null, null, now).status, "Inactive");
    assert.equal(studio.getStudioMembership({ isStudioMember: true }, null, now).status, "Active");
    assert.equal(studio.getStudioMembership({ isStudioMember: true, studioExpiryDate: fmt(now + 10 * day) }, null, now).status, "Active");
    assert.equal(studio.getStudioMembership({ studioExpiryDate: fmt(now + 10 * day) }, null, now).status, "Paused");
    assert.equal(studio.getStudioMembership({ isStudioMember: true, studioExpiryDate: fmt(now - 3 * day) }, null, now).status, "Expired");
    assert.equal(studio.getStudioMembership({ lastPaidDate: "2025-01-01" }, null, now).status, "Expired");
    // appUser fallback is honoured (days counted to the parsed expiry, as in StudioTab).
    const viaAppUser = studio.getStudioMembership(null, { isStudioMember: true, studioEndDate: fmt(now + 2 * day) }, now);
    assert.equal(viaAppUser.status, "Active");
    assert.ok(viaAppUser.daysRemaining >= 2 && viaAppUser.daysRemaining <= 3, String(viaAppUser.daysRemaining));
    assert.match(src("components/StudioTab.tsx"), /const membership = getStudioMembership\(player, appUser\);/);
  });
});

describe("Profile hub cards (rendered, existing data only)", () => {
  const players = [
    { id: "me", name: "Me", totalRuns: 120, totalWickets: 0, stunningCatches: 3, inviteStatus: "Accepted" },
    { id: "x", name: "X", totalRuns: 200, stunningCatches: 1, inviteStatus: "Accepted" },
  ];
  it("shows real values and club rank, 'Not ranked yet' for zero, and links only when handlers exist", () => {
    const html = render(React.createElement(ProfilePerformanceCard, {
      players, badges: [], playerId: "me", showCricketStats: true, leaderboardEnabled: true, badgesEnabled: true,
      onOpenLeaderboard: () => {}, onOpenBadges: () => {},
    }));
    assert.match(html, /data-testid="profile-standing-runs"[\s\S]*?120[\s\S]*?Club rank #2/);
    assert.match(html, /data-testid="profile-standing-stunning"[\s\S]*?3[\s\S]*?Club rank #1/);
    assert.match(html, /data-testid="profile-standing-wickets"[\s\S]*?Not ranked yet/);
    assert.match(html, /profile-open-leaderboard/);
    assert.match(html, /profile-open-badges/);
    const noLinks = render(React.createElement(ProfilePerformanceCard, {
      players, badges: [], playerId: "me", showCricketStats: false, leaderboardEnabled: false, badgesEnabled: false,
    }));
    assert.doesNotMatch(noLinks, /profile-standing-runs|profile-open-leaderboard|profile-open-badges/);
  });
  it("Studio card reflects membership state without inventing data", () => {
    const none = render(React.createElement(ProfileStudioCard, { player: null, appUser: null }));
    assert.match(none, /Inactive/);
    assert.match(none, /You don&#x27;t have a Studio membership yet\./);
    const active = render(React.createElement(ProfileStudioCard, { player: { isStudioMember: true, studioExpiryDate: "2099-01-31" }, appUser: null, onOpenStudio: () => {} }));
    assert.match(active, /Active/);
    assert.match(active, /Valid until 31\/01\/2099/);
    assert.match(active, /Manage membership/);
  });
});
