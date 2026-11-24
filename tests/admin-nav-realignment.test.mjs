/**
 * D-18 Admin persona navigation realignment (`tests/admin-nav-realignment.test.mjs`).
 *
 * Imports and renders PRODUCTION modules (lib/admin-navigation.ts,
 * components/layout/MobileBottomNav.tsx) — no duplicated logic. Server-side
 * rendering only; no browser, emulator, network or database access.
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
const decode = (t) => t.replace(/&amp;/g, "&");
const labels = (html) => [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => decode(m[1]));

const nav = load("lib/admin-navigation.ts");
const { MobileBottomNav } = load("components/layout/MobileBottomNav.tsx");

// Effective capabilities exactly as app/page.tsx derives them:
// Super Admin claim folds into every flag; canDesign = Club Admin || Designer.
function caps(raw) {
  const sup = !!raw.super;
  const club = sup || !!raw.club;
  return {
    isSuperAdmin: sup,
    isClubAdmin: club,
    isMatchAdmin: sup || !!raw.match,
    isFinanceAdmin: sup || !!raw.finance,
    isStudioAdmin: sup || !!raw.studio,
    canDesign: club || !!raw.designer,
  };
}

// D-19: Match Admin and Studio Admin are retired into Club Admin; until the
// migration runs, the legacy flags still open Match Center / Club → Studio.
const CLUB_ALL = ["players", "studio", "announcements", "pulse", "leaderboard", "badges", "shop"];
const MATRIX = {
  "Super Admin": { raw: { super: true }, nav: ["home", "matches", "club", "finance", "design", "settings"], club: CLUB_ALL, landing: { tab: "home" } },
  "Club Admin": { raw: { club: true }, nav: ["home", "matches", "club", "design"], club: CLUB_ALL, landing: { tab: "home" } },
  "Finance Admin": { raw: { finance: true }, nav: ["home", "finance"], club: [], landing: { tab: "finance" } },
  Designer: { raw: { designer: true }, nav: ["home", "design"], club: [], landing: { tab: "design" } },
  "Legacy Match Admin (pre-migration)": { raw: { match: true }, nav: ["home", "matches"], club: [], landing: { tab: "matches" } },
  "Legacy Studio Admin (pre-migration)": { raw: { studio: true }, nav: ["home", "club"], club: ["studio"], landing: { tab: "club", action: "studio" } },
  "Finance Admin + Designer": { raw: { finance: true, designer: true }, nav: ["home", "finance", "design"], club: [], landing: { tab: "finance" } },
  "Club Admin + Finance Admin": { raw: { club: true, finance: true }, nav: ["home", "matches", "club", "finance", "design"], club: CLUB_ALL, landing: { tab: "finance" } },
  "Club Admin + Designer": { raw: { club: true, designer: true }, nav: ["home", "matches", "club", "design"], club: CLUB_ALL, landing: { tab: "home" } },
};

describe("D-18/D-19 configuration", () => {
  it("defines exactly six destinations in the approved order", () => {
    assert.deepEqual(nav.ADMIN_PRIMARY_NAV.map((i) => i.label), ["Home", "Match Center", "Club", "Finance", "Design Studio", "Settings"]);
  });
  it("Finance: Finance/Super only; Design Studio: Designer/Club/Super only; Settings: Super only", () => {
    for (const [role, m] of Object.entries(MATRIX)) {
      const c = caps(m.raw);
      assert.equal(nav.isAdminDestinationVisible("finance", c), !!(m.raw.finance || m.raw.super), `${role} finance`);
      assert.equal(nav.isAdminDestinationVisible("design", c), !!(m.raw.designer || m.raw.club || m.raw.super), `${role} design`);
      assert.equal(nav.isAdminDestinationVisible("settings", c), !!m.raw.super, `${role} settings`);
    }
  });
  it("Designer access never implies Club Admin capabilities", () => {
    const c = caps({ designer: true });
    assert.equal(c.isClubAdmin, false);
    assert.deepEqual(nav.getVisibleClubSections(c), []);
    assert.equal(nav.isAdminDestinationVisible("club", c), false);
    assert.equal(nav.isAdminDestinationVisible("matches", c), false);
  });
  it("D-19: Home is shown to every admin role; Match Center and Club to Club Admins", () => {
    for (const raw of [{ super: true }, { club: true }, { finance: true }, { designer: true }, { match: true }, { studio: true }]) {
      assert.equal(nav.isAdminDestinationVisible("home", caps(raw)), true, JSON.stringify(raw));
    }
    assert.equal(nav.isAdminDestinationVisible("home", caps({})), false, "non-admins never see Admin Home");
    assert.equal(nav.isAdminDestinationVisible("matches", caps({ club: true })), true);
    assert.equal(nav.isAdminDestinationVisible("club", caps({ finance: true })), false);
  });
  it("D-19: Reminders and Activity Log are not Club sections; Assign is gone", () => {
    const keys = nav.CLUB_SECTIONS.map((x) => x.key);
    for (const k of ["reminders", "activity"]) assert.ok(!keys.includes(k), k);
    assert.ok(!fs.existsSync(path.resolve("components/AssignFeesAdmin.tsx")));
    assert.doesNotMatch(src("components/MatchesTab.tsx"), /"assign"\]|AssignFeesAdmin|assign: "Assign"/);
    assert.doesNotMatch(src("components/AdminDashboard.tsx"), /setActiveTab\("matches", "assign"\)/);
  });
});

describe("D-19 role → destination and role → Club section matrix", () => {
  for (const [role, m] of Object.entries(MATRIX)) {
    it(`${role}`, () => {
      const c = caps(m.raw);
      assert.deepEqual(nav.getAdminPrimaryNav(c).map((i) => i.tab), m.nav);
      assert.deepEqual(nav.getVisibleClubSections(c), m.club);
      assert.deepEqual(nav.getAdminLanding(c), m.landing);
    });
  }
  it("club feature flags hide Pulse and Badges; Shop management stays for admins when the Shop is off", () => {
    const off = (f) => !["opinion", "badges", "shop"].includes(f);
    assert.deepEqual(nav.getVisibleClubSections(caps({ club: true }), off), ["players", "studio", "announcements", "leaderboard", "shop"]);
  });
});

describe("D-18 mobile bar renders the same config as desktop for every role", () => {
  for (const [role, m] of Object.entries(MATRIX)) {
    it(`${role}`, () => {
      const c = caps(m.raw);
      const html = render(React.createElement(MobileBottomNav, {
        activeTab: m.nav[0], onSelectTab: () => {}, isFeatureEnabled: () => true, persona: "admin",
        hasMissingMandatory: false, canDesign: c.canDesign, adminPermissions: c,
      }));
      const expected = m.nav.map((t) => nav.ADMIN_PRIMARY_NAV.find((i) => i.tab === t).label);
      assert.deepEqual(labels(html), expected);
      assert.doesNotMatch(html, /More|player-mobile-bottom-nav/);
      assert.ok(html.split("min-h-[48px]").length - 1 === expected.length, "44px+ touch targets");
    });
  }
  it("desktop sidebar and mobile bar both call getAdminPrimaryNav with the same capabilities", () => {
    assert.match(src("app/page.tsx"), /getAdminPrimaryNav\(adminCaps, \(f\) => isFeatureEnabled\(f\)\)\.map/);
    assert.match(src("components/layout/MobileBottomNav.tsx"), /getAdminPrimaryNav\(caps, \(f\) => isFeatureEnabled\(f as Feature\)\)/);
  });
});

describe("D-18/D-19 routing: legacy tabs, moved sections, deep links", () => {
  const sup = caps({ super: true });
  it("legacy tab ids open inside their destination, carrying the sub-action", () => {
    assert.deepEqual(nav.resolveAdminRoute("studio", "add_player"), { tab: "club", action: "studio:add_player" });
    assert.deepEqual(nav.resolveAdminRoute("studio", null), { tab: "club", action: "studio" });
    assert.deepEqual(nav.resolveAdminRoute("grounds", null), { tab: "matches", action: "grounds" });
    assert.deepEqual(nav.resolveAdminRoute("opinion", null), { tab: "club", action: "pulse" });
    assert.deepEqual(nav.resolveAdminRoute("leaderboard", null), { tab: "club", action: "leaderboard" });
    assert.deepEqual(nav.resolveAdminRoute("shop", null), { tab: "club", action: "shop" });
    assert.deepEqual(nav.resolveAdminRoute("dues_and_reminders", null), { tab: "finance", action: "dues" });
  });
  it("D-19: former Club sections move to Finance", () => {
    assert.deepEqual(nav.resolveAdminRoute("club", "reminders"), { tab: "finance", action: "dues" });
    assert.deepEqual(nav.resolveAdminRoute("club", "activity"), { tab: "finance", action: "activity" });
  });
  it("D-19: destinations and header screens are never redirected (denial is shown on the screen instead)", () => {
    for (const t of ["home", "matches", "club", "finance", "design", "settings", "notifications", "profile"]) {
      assert.equal(nav.resolveAdminRoute(t, null), null, t);
    }
  });
  it("Club actions resolve to an allowed section; a known but unauthorised section is denied politely", () => {
    const all = nav.getVisibleClubSections(sup);
    assert.deepEqual(nav.resolveClubSection("badges_grant", all), { section: "badges", subAction: "grant", denied: null });
    assert.deepEqual(nav.resolveClubSection("invite_player", all), { section: "players", subAction: "invite", denied: null });
    assert.deepEqual(nav.resolveClubSection("studio:add_player", all), { section: "studio", subAction: "add_player", denied: null });
    assert.deepEqual(nav.resolveClubSection("stats", all), { section: "leaderboard", subAction: null, denied: null });
    assert.deepEqual(nav.resolveClubSection("players", ["studio"]), { section: null, subAction: null, denied: "Player Roster" });
    assert.deepEqual(nav.resolveClubSection("nonsense", ["studio"]), { section: "studio", subAction: null, denied: null });
  });
  it("every existing admin dashboard shortcut still resolves to a destination", () => {
    const dash = src("components/AdminDashboard.tsx");
    const calls = [...dash.matchAll(/setActiveTab\("(\w+)"(?:, "([\w-]+)")?\)/g)].map((m) => [m[1], m[2] || null]);
    assert.ok(calls.length >= 10);
    for (const [tab, action] of calls) {
      const routed = nav.resolveAdminRoute(tab, action) || { tab, action };
      assert.ok(["home", "matches", "club", "finance", "design", "settings"].includes(routed.tab), `${tab}/${action}`);
      if (routed.tab === "club") {
        const r = nav.resolveClubSection(routed.action, nav.getVisibleClubSections(sup));
        assert.equal(r.denied, null, `${tab}/${action}`);
        assert.ok(r.section, `${tab}/${action}`);
      }
    }
  });
});

describe("D-18 screens keep their own guards (menu visibility is not authorisation)", () => {
  const page = src("app/page.tsx");
  const club = src("components/ClubTab.tsx");
  it("each Club section render is guarded by its role", () => {
    for (const [sec, guard] of [["players", "isClubAdmin"], ["studio", "\\(isClubAdmin \\|\\| isStudioAdmin\\)"], ["announcements", "isClubAdmin"], ["pulse", "isClubAdmin"], ["leaderboard", "isClubAdmin"], ["badges", "isClubAdmin"], ["shop", "isClubAdmin"]]) {
      assert.match(club, new RegExp(`show\\("${sec}"\\) && ${guard} &&`), sec);
    }
    assert.match(club, /const show = \(key: ClubSection\) => !denied && subTab === key && sections\.includes\(key\);/);
    assert.match(club, /\{denied && <AccessDenied feature=\{denied\} requiredRole="Club Admins" \/>\}/);
  });
  it("destination screens keep their existing role guards in app/page.tsx", () => {
    assert.match(page, /activeTab === "finance" && \(\s*isFinanceAdmin \|\| isSuperAdmin \? \(/);
    assert.match(page, /activeTab === "settings" && \(\s*isSuperAdmin \? \(/);
    assert.match(page, /activeTab === "design" && \(\s*canDesign \? \(/);
    assert.match(page, /activeTab === "home" && \(\s*isAdminDestinationVisible\("home", adminCaps\) \? \(/);
    // D-19: unauthorised screens show the polite AccessDenied card, not "Hub Restricted"
    assert.doesNotMatch(page, /Hub Restricted/);
    for (const f of ["Match Center", "Finance", "Design Studio", "Settings"]) assert.match(page, new RegExp(`<AccessDenied feature="${f}"`));
  });
  it("the admin route guard only runs in Admin persona", () => {
    assert.match(page, /if \(persona !== "admin" \|\| !store\.isLoaded \|\| !isAdminUser\) return;\s*const next = resolveAdminRoute\(activeTab, tabAction\);/);
  });
  it("D-19: writes rejected by Firestore rules surface a polite access-denied toast", () => {
    assert.match(src("lib/errorHandling.ts"), /if \(isPermissionDenied && isWrite && typeof window !== "undefined"\) \{\s*window\.dispatchEvent\(new CustomEvent\("firestore-permission-denied"/);
    assert.match(page, /window\.addEventListener\("firestore-permission-denied", onDenied\)/);
    assert.match(src("components/AuditLogTab.tsx"), /if \(accessDenied\) \{\s*return <AccessDenied/);
  });
  it("no Firestore rules, payment or role logic is referenced by the navigation config", () => {
    const code = src("lib/admin-navigation.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /import|firebase|firestore|razorpay|setDoc|updateDoc|fetch\(/i);
  });
});
