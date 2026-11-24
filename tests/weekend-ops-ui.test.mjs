/**
 * Weekend match operations — UI wiring (`tests/weekend-ops-ui.test.mjs`).
 *
 * Imports the PRODUCTION modules (banner slide builder, match-card "vs" label,
 * badge definitions) and server-renders them; plus source checks for the
 * Admin-persona-only wiring. No emulator, browser, network or database access.
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
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");


const { buildBannerSlides, buildPotwSlide, clubDayFromParts } = load("components/home/bannerSlides.ts");
const { MatchVsLabel } = load("components/matches/MatchCardHeader.tsx");
const { DEFAULT_BADGE_DEFS, SYSTEM_AWARDED_BADGES, PlayerOfWeekendBadgeSvg } = load("components/BadgeIcon.tsx");

const NOW = Date.UTC(2026, 10, 23, 6, 0); // Mon 23 Nov 2026 11:30 IST
const potw = (id, hoursAgo, extra = {}) => ({
  id,
  kind: "potw",
  isAnnouncement: true,
  isPinned: false,
  comments: [],
  text: "x",
  createdAt: { seconds: Math.floor((NOW - hoursAgo * 3600000) / 1000) },
  potw: { playerId: "p1", playerName: "Rohan Mehta", photoURL: "https://img.example/p.jpg", message: "82* off 51", weekendId: "2026-11-21", weekendLabel: "21 Nov – 22 Nov 2026" },
  ...extra,
});
const today = clubDayFromParts(2026, 10, 23);

describe("Player of the Weekend banner slide", () => {
  it("builds one gold slide from the newest award, first in the carousel", () => {
    const slides = buildBannerSlides({ announcements: [potw("potw_2026-11-14", 170), potw("potw_2026-11-21", 2)], isFeatureEnabled: () => false, today, nowMs: NOW });
    const p = slides.filter((s) => s.kind === "potw");
    assert.equal(p.length, 1);
    assert.equal(slides[0].kind, "potw");
    assert.equal(p[0].id, "potw-potw_2026-11-21");
    assert.equal(p[0].badge, "Player of the Weekend");
    assert.deepEqual(p[0].potw, { playerName: "Rohan Mehta", photoURL: "https://img.example/p.jpg", message: "82* off 51", weekendLabel: "21 Nov – 22 Nov 2026" });
  });
  it("expires after 7 days; non-https photos are dropped; a pinned POTW post still yields exactly one slide", () => {
    assert.equal(buildPotwSlide([potw("a", 7 * 24)], NOW), null);
    assert.ok(buildPotwSlide([potw("a", 7 * 24 - 1)], NOW));
    assert.equal(buildPotwSlide([potw("a", 1, { potw: { ...potw("a", 1).potw, photoURL: "http://img/p.jpg" } })], NOW).potw.photoURL, undefined);
    const slides = buildBannerSlides({ announcements: [potw("a", 1, { isPinned: true })], isFeatureEnabled: () => false, today, nowMs: NOW });
    assert.equal(slides.filter((s) => s.kind === "notice").length, 0);
    assert.equal(slides.filter((s) => s.kind === "potw").length, 1);
  });
  it("ignores ordinary announcements", () => {
    assert.equal(buildPotwSlide([{ id: "n", isAnnouncement: true, text: "x", createdAt: { seconds: NOW / 1000 } }], NOW), null);
  });
});

describe("CricHeroes link in the vs row", () => {
  const html = (matchUrl) => ReactDOMServer.renderToStaticMarkup(React.createElement(MatchVsLabel, { match: { id: "m1", opponent: "Delhi", matchUrl } }));
  it("renders a new-tab, noopener link for a valid https CricHeroes URL on the same row as vs", () => {
    const h = html("https://cricheroes.com/scorecard/1/x");
    assert.match(h, /href="https:\/\/cricheroes\.com\/scorecard\/1\/x"/);
    assert.match(h, /target="_blank"/);
    assert.match(h, /rel="noopener noreferrer"/);
    assert.match(h, /View on CricHeroes/);
    assert.match(h, /^<span class="flex w-full items-center justify-between/);
  });
  it("renders no link for missing, http, javascript or look-alike hosts", () => {
    for (const u of [undefined, "", "http://cricheroes.com/x", "javascript:alert(1)", "https://cricheroes.com.evil.io/x"]) {
      assert.doesNotMatch(html(u), /<a /, String(u));
    }
  });
  it("all three card bodies (Player Home compact, Player/Admin header, Admin stacked) use the shared label", () => {
    const s = fs.readFileSync("components/matches/MatchCardHeader.tsx", "utf-8");
    assert.equal((s.match(/<MatchVsLabel match=\{match\} \/>/g) || []).length, 3);
    assert.doesNotMatch(s, />vs<\/span>\{" "\}/);
  });
});

describe("Player of the Weekend badge", () => {
  it("is a gold, stackable default badge issued only by its workflow", () => {
    assert.deepEqual(DEFAULT_BADGE_DEFS.player_of_weekend, { label: "Player of the Weekend", short: "POTW", tier: "gold", emoji: "🏆", stackable: true });
    assert.ok(SYSTEM_AWARDED_BADGES.has("player_of_weekend"));
    assert.match(fs.readFileSync("components/BadgesTab.tsx", "utf-8"), /if \(SYSTEM_AWARDED_BADGES\.has\(bt\)\) return false;/);
  });
  it("renders the dedicated SVG", () => {
    const h = ReactDOMServer.renderToStaticMarkup(React.createElement(PlayerOfWeekendBadgeSvg, { size: 48 }));
    assert.match(h, /aria-label="Player of the Weekend badge"/);
    assert.match(h, /#D6A52B/);
  });
});

describe("Admin-persona-only prompts", () => {
  const page = fs.readFileSync("app/page.tsx", "utf-8");
  const comp = fs.readFileSync("components/weekend-ops/WeekendPrompts.tsx", "utf-8");
  it("prompts render only when the Admin persona is active; the indicator is fed regardless", () => {
    assert.match(page, /<WeekendPrompts[\s\S]*?active=\{effectiveIsAdminMode\}/);
    assert.match(comp, /if \(!active \|\| !data\) return null;/);
    assert.match(fs.readFileSync("components/layout/AppHeader.tsx", "utf-8"), /persona !== "admin" && adminPendingCount > 0/);
  });
  it("auto-opens one prompt at a time, each at most once per session; skip is session-only", () => {
    assert.match(comp, /if \(!active \|\| open \|\| !data\) return;/);
    assert.match(comp, /window\.sessionStorage/);
    assert.doesNotMatch(comp, /localStorage/);
  });
  it("actual fee uses the existing Finance ledger route; no new fee field", () => {
    assert.match(comp, /postJson\("\/api\/finance\/match-ledger", \{ action: "setGroundFee", matchId, amount: Number\(v\), reason: "" \}\)/);
  });
});
