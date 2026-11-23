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

const MATRIX = {
  "Super Admin": {
    raw: { super: true },
    nav: ["home", "matches", "club", "finance", "design", "settings"],
    club: ["players", "studio", "announcements", "pulse", "leaderboard", "badges", "shop", "reminders", "activity"],
    landing: { tab: "home" },
  },
  "Club Admin": {
    raw: { club: true },
    nav: ["home", "club", "design"],
    club: ["players", "announcements", "pulse", "leaderboard", "badges", "shop", "reminders"],
    landing: { tab: "club" },
  },
  "Match Admin": { raw: { match: true }, nav: ["matches", "club"], club: ["pulse", "leaderboard"], landing: { tab: "matches" } },
  "Finance Admin": { raw: { finance: true }, nav: ["club", "finance"], club: ["pulse", "leaderboard"], landing: { tab: "finance" } },
  "Studio Admin": { raw: { studio: true }, nav: ["club"], club: ["studio", "pulse", "leaderboard"], landing: { tab: "club", action: "studio" } },
  Designer: { raw: { designer: true }, nav: ["design"], club: [], landing: { tab: "design" } },
  "Match + Finance Admin": { raw: { match: true, finance: true }, nav: ["matches", "club", "finance"], club: ["pulse", "leaderboard"], landing: { tab: "finance" } },
  "Studio Admin + Designer": { raw: { studio: true, designer: true }, nav: ["club", "design"], club: ["studio", "pulse", "leaderboard"], landing: { tab: "club", action: "studio" } },
  "Club Admin + Designer": { raw: { club: true, designer: true }, nav: ["home", "club", "design"], club: ["players", "announcements", "pulse", "leaderboard", "badges", "shop", "reminders"], landing: { tab: "club" } },
};

describe("D-18 configuration", () => {
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
    assert.equal(nav.isAdminDestinationVisible("home", c), false);
  });
});

describe("D-18 role → destination and role → Club section matrix", () => {
  for (const [role, m] of Object.entries(MATRIX)) {
    it(`${role}`, () => {
      const c = caps(m.raw);
      assert.deepEqual(nav.getAdminPrimaryNav(c).map((i) => i.tab), m.nav);
      assert.deepEqual(nav.getVisibleClubSections(c), m.club);
      assert.deepEqual(nav.getAdminLanding(c), m.landing);
    });
  }
  it("club feature flags hide Pulse, Badges and Shop sections", () => {
    const off = (f) => !["opinion", "badges", "shop"].includes(f);
    assert.deepEqual(nav.getVisibleClubSections(caps({ club: true }), off), ["players", "announcements", "leaderboard", "reminders"]);
    // Match Admin's only management section is Pulse; with polls off, Club disappears.
    assert.deepEqual(nav.getVisibleClubSections(caps({ match: true }), off), []);
    assert.deepEqual(nav.getAdminPrimaryNav(caps({ match: true }), off).map((i) => i.tab), ["matches"]);
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

describe("D-18 routing: legacy tabs, deep links and unauthorised destinations", () => {
  const sup = caps({ super: true });
  it("legacy tab ids open inside their destination, carrying the sub-action", () => {
    assert.deepEqual(nav.resolveAdminRoute("studio", "add_player", sup), { tab: "club", action: "studio:add_player" });
    assert.deepEqual(nav.resolveAdminRoute("studio", null, sup), { tab: "club", action: "studio" });
    assert.deepEqual(nav.resolveAdminRoute("grounds", null, sup), { tab: "matches", action: "grounds" });
    assert.deepEqual(nav.resolveAdminRoute("opinion", null, sup), { tab: "club", action: "pulse" });
    assert.deepEqual(nav.resolveAdminRoute("leaderboard", null, sup), { tab: "club", action: "leaderboard" });
    assert.deepEqual(nav.resolveAdminRoute("shop", null, sup), { tab: "club", action: "shop" });
    assert.deepEqual(nav.resolveAdminRoute("dues_and_reminders", null, sup), { tab: "finance", action: "dues" });
  });
  it("visible destinations and header screens are left alone", () => {
    for (const t of ["home", "matches", "club", "finance", "design", "settings", "notifications", "profile"]) {
      assert.equal(nav.resolveAdminRoute(t, null, sup), null, t);
    }
  });
  it("unauthorised destinations redirect to the role's landing", () => {
    assert.deepEqual(nav.resolveAdminRoute("settings", null, caps({ club: true })), { tab: "club" });
    assert.deepEqual(nav.resolveAdminRoute("finance", null, caps({ match: true })), { tab: "matches" });
    assert.deepEqual(nav.resolveAdminRoute("home", null, caps({ finance: true })), { tab: "finance" });
    assert.deepEqual(nav.resolveAdminRoute("club", null, caps({ designer: true })), { tab: "design" });
    assert.deepEqual(nav.resolveAdminRoute("studio", null, caps({ match: true })), { tab: "matches" });
    assert.deepEqual(nav.resolveAdminRoute("matches", null, caps({ club: true })), { tab: "club" });
  });
  it("Club actions resolve to an allowed section; disallowed sections fall back", () => {
    const all = nav.getVisibleClubSections(sup);
    assert.deepEqual(nav.resolveClubSection("badges_grant", all), { section: "badges", subAction: "grant" });
    assert.deepEqual(nav.resolveClubSection("invite_player", all), { section: "players", subAction: "invite" });
    assert.deepEqual(nav.resolveClubSection("studio:add_player", all), { section: "studio", subAction: "add_player" });
    assert.deepEqual(nav.resolveClubSection("stats", all), { section: "leaderboard", subAction: null });
    assert.deepEqual(nav.resolveClubSection("players", ["studio", "pulse", "leaderboard"]), { section: "studio", subAction: null });
  });
  it("every existing admin dashboard shortcut still resolves", () => {
    const dash = src("components/AdminDashboard.tsx");
    const calls = [...dash.matchAll(/setActiveTab\("(\w+)"(?:, "([\w-]+)")?\)/g)].map((m) => [m[1], m[2] || null]);
    assert.ok(calls.length >= 10);
    for (const [tab, action] of calls) {
      const routed = nav.resolveAdminRoute(tab, action, sup) || { tab, action };
      assert.ok(["home", "matches", "club", "finance", "design", "settings"].includes(routed.tab), `${tab}/${action}`);
      if (routed.tab === "club") {
        const { section } = nav.resolveClubSection(routed.action, nav.getVisibleClubSections(sup));
        const expected = (routed.action || "").split(":")[0].replace("badges_grant", "badges").replace("invite_player", "players");
        assert.equal(section, expected || section, `${tab}/${action} → club section`);
      }
    }
  });
});

describe("D-18 screens keep their own guards (menu visibility is not authorisation)", () => {
  const page = src("app/page.tsx");
  const club = src("components/ClubTab.tsx");
  it("each Club section render is guarded by its role", () => {
    for (const [sec, guard] of [["players", "isClubAdmin"], ["studio", "isStudioAdmin"], ["announcements", "isClubAdmin"], ["badges", "isClubAdmin"], ["shop", "isClubAdmin"], ["reminders", "isClubAdmin"], ["activity", "isSuperAdmin"]]) {
      assert.match(club, new RegExp(`show\\("${sec}"\\) && ${guard} &&`), sec);
    }
    assert.match(club, /const show = \(key: ClubSection\) => subTab === key && sections\.includes\(key\);/);
  });
  it("destination screens keep their existing role guards in app/page.tsx", () => {
    assert.match(page, /activeTab === "finance" && \(\s*isFinanceAdmin \|\| isSuperAdmin \? \(/);
    assert.match(page, /activeTab === "settings" && \(\s*isSuperAdmin \? \(/);
    assert.match(page, /activeTab === "design" && \(\s*canDesign \? \(/);
    assert.match(page, /activeTab === "home" && \(\s*isSuperAdmin \|\| isClubAdmin \? \(/);
  });
  it("the admin route guard only runs in Admin persona", () => {
    assert.match(page, /if \(persona !== "admin" \|\| !store\.isLoaded \|\| !isAdminUser\) return;\s*const next = resolveAdminRoute\(/);
  });
  it("no Firestore rules, payment or role logic is referenced by the navigation config", () => {
    const code = src("lib/admin-navigation.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /import|firebase|firestore|razorpay|setDoc|updateDoc|fetch\(/i);
  });
});
