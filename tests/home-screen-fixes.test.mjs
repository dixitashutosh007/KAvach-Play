/**
 * Home screen fixes (`tests/home-screen-fixes.test.mjs`):
 *  1. equal-dimension Upcoming Match cards in the mobile carousel;
 *  2. no stray "Shop" quick-action label at the top of Home;
 *  3. per-banner Display Duration (add / edit / rotation, safe default).
 *
 * Pure functions, server-side rendering and source inspection only:
 * no emulator, browser, network or database access.
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

const dur = load("lib/banner-duration.ts");
const { buildBannerSlides, clubDayFromParts } = load("components/home/bannerSlides.ts");
const { AnnouncementComposer, validateAnnouncementDraft } = load("components/home/AnnouncementComposer.tsx");
const { UpcomingMatchesSection } = load("components/home/UpcomingMatchesSection.tsx");
const { MATCH_CARD_FILL_CLASS } = load("components/matches/PlayerMatchCard.tsx");

const today = clubDayFromParts(2026, 10, 21);
const notice = (over = {}) => ({ id: "n1", text: "AGM on Sunday.", isAnnouncement: true, isPinned: true, comments: [], ...over });
const slidesFor = (post, features = false) =>
  buildBannerSlides({ announcements: [post], players: [{ id: "a", name: "Asha", dob: "1995-11-21" }], isFeatureEnabled: () => features, today });

// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 3: banner Display Duration", () => {
  it("validation: whole seconds within 3–60; rejects zero, negative, decimals and junk", () => {
    assert.equal(dur.BANNER_DURATION_DEFAULT_SEC, 6);
    for (const ok of [3, 6, 60, "10", " 15 "]) assert.equal(dur.validateDisplayDuration(ok).ok, true, String(ok));
    for (const bad of [0, -5, 2, 61, 4.5, "", "abc", "1e2", NaN, Infinity, null, undefined, "-3", "5.0"]) {
      assert.equal(dur.validateDisplayDuration(bad).ok, false, String(bad));
    }
    assert.match(dur.validateDisplayDuration(0).error, /between 3 and 60 seconds/);
    assert.match(dur.validateDisplayDuration("x").error, /whole number of seconds/);
  });
  it("stored values map to rotation ms; missing/invalid stored data uses the 6 s default", () => {
    assert.equal(dur.resolveDisplayDurationMs(10), 10000);
    for (const legacy of [undefined, null, 0, -1, "abc", 999]) assert.equal(dur.resolveDisplayDurationMs(legacy), 6000, String(legacy));
  });
  it("announcement slides carry their own duration; legacy announcements default; other slides default", () => {
    const withDur = slidesFor(notice({ displayDurationSec: 12 }), true);
    assert.equal(withDur.find((s) => s.kind === "notice").durationMs, 12000);
    assert.ok(withDur.filter((s) => s.kind !== "notice").every((s) => s.durationMs === 6000));
    assert.equal(slidesFor(notice()).find((s) => s.kind === "notice").durationMs, 6000);
  });
  it("duration does not change dismissal keys or the link destination", () => {
    const a = slidesFor(notice({ linkUrl: "https://kavach.club/agm" })).find((s) => s.kind === "notice");
    const b = slidesFor(notice({ linkUrl: "https://kavach.club/agm", displayDurationSec: 20 })).find((s) => s.kind === "notice");
    assert.equal(a.dismissKey, b.dismissKey);
    assert.equal(a.href, b.href);
  });
  it("banner timer uses the active slide's duration (pause rules unchanged)", () => {
    const s = src("components/home/CampaignHeroBanner.tsx");
    assert.match(s, /setTimeout\(handleNext, activeSlide\?\.durationMs \|\| AUTO_ROTATE_MS\)/);
    assert.match(s, /const AUTO_ROTATE_MS = 6000;/);
  });
  it("draft validation rejects an invalid duration and accepts a valid one", () => {
    const base = { title: "", text: "Hello", isPinned: true };
    assert.equal(validateAnnouncementDraft({ ...base, displayDurationSec: 8 }), null);
    assert.equal(validateAnnouncementDraft(base), null, "omitted (e.g. pin toggle) is fine");
    assert.match(validateAnnouncementDraft({ ...base, displayDurationSec: 0 }), /between 3 and 60/);
    assert.match(validateAnnouncementDraft({ ...base, displayDurationSec: -2 }), /whole number/);
  });
  it("composer: labelled field with unit, default 6 when adding, stored value when editing", () => {
    const add = render(React.createElement(AnnouncementComposer, { onClose: () => {}, onPublish: async () => true }));
    assert.match(add, /Display Duration \(seconds\)/);
    const input = (html) => html.slice(html.indexOf("<input", html.indexOf("Display Duration")), html.indexOf("/>", html.indexOf("<input", html.indexOf("Display Duration"))));
    assert.match(input(add), /value="6"/);
    assert.match(input(add), /min="3"/);
    assert.match(input(add), /max="60"/);
    const edit = render(React.createElement(AnnouncementComposer, {
      onClose: () => {}, onPublish: async () => true, initial: { text: "x", displayDurationSec: 15 },
    }));
    assert.match(input(edit), /value="15"/);
    const legacy = render(React.createElement(AnnouncementComposer, { onClose: () => {}, onPublish: async () => true, initial: { text: "x" } }));
    assert.match(input(legacy), /value="6"/);
  });
  it("persisted on add and edit; pin toggle leaves it unchanged; edit form receives the stored value", () => {
    // D-16: announcement add/edit handlers moved from Player Home to Admin Home.
    const home = src("components/home/AdminAnnouncementsManager.tsx");
    assert.equal((home.match(/draft\.displayDurationSec !== undefined \? \{ displayDurationSec: draft\.displayDurationSec \} : \{\}/g) || []).length, 2);
    assert.match(src("hooks/useStore.ts"), /"linkUrl" \| "displayDurationSec"/);
    const section = src("components/home/ClubAnnouncementsSection.tsx");
    assert.match(section, /displayDurationSec: editing\.displayDurationSec/);
    const toggle = section.slice(section.indexOf("const next = !("), section.indexOf("setBusy(false)", section.indexOf("const next = !(")));
    assert.ok(!toggle.includes("displayDurationSec"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 2: no stray Shop label at the top of Home", () => {
  it("D-20: HomeTab renders the Quick Access grid (Directory, Studio, Shop, Polls & Pulse), not a lone Shop chip", () => {
    const home = src("components/HomeTab.tsx");
    assert.match(home, /import \{ HomeQuickActions \} from "\.\/home\/HomeQuickActions";/);
    assert.match(home, /<HomeQuickActions isFeatureEnabled=\{isFeatureEnabled\}/);
    const qa = src("components/home/HomeQuickActions.tsx");
    for (const t of ["players", "studio", "shop", "opinion"]) assert.match(qa, new RegExp(`target: "${t}"`));
    assert.doesNotMatch(qa, /target: "announcements"/);
  });
  it("Shop module and navigation stay available", () => {
    // D-18: merchandise management is the Admin → Club → Shop section (Club/Super Admin).
    assert.match(src("lib/admin-navigation.ts"), /\{ key: "shop", label: "Shop", feature: "shop", allowed: \(c\) => c\.isClubAdmin \}/);
    assert.match(src("components/ClubTab.tsx"), /show\("shop"\) && isClubAdmin && <ShopTab store=\{store\} persona="admin" isAdmin=\{isClubAdmin\} \/>/);
    assert.ok(fs.existsSync(path.resolve("components/ShopTab.tsx")) || /shop/i.test(src("app/page.tsx")));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Fix 1: equal-dimension cards in the mobile carousel", () => {
  const mk = (id, opponent, extra = {}) => ({ id, opponent, date: "2026-12-01", time: "07:00", format: "T20", jerseyColor: "Whites", matchType: "Practice", result: "Pending", ...extra });
  const renderSection = (matches) =>
    render(React.createElement(UpcomingMatchesSection, {
      matches, grounds: [], payments: [], player: { id: "p1" },
      onRsvp: async () => {}, onNavigateToMatch: () => {}, onNavigateToAllMatches: () => {},
    }));

  it("fill class is mobile-only: full slide height in a column, natural block flow from md", () => {
    assert.equal(MATCH_CARD_FILL_CLASS, "h-full flex flex-col md:block md:h-auto");
  });
  it("carousel cards fill their slides and pin availability to the bottom", () => {
    const html = renderSection([mk("a", "XI"), mk("b", "A Very Long Opponent Cricket Club Name Eleven"), mk("c", "Mid Name")]);
    for (const id of ["a", "b", "c"]) {
      const start = html.indexOf(`data-testid="player-match-card-${id}"`);
      const tag = html.slice(html.lastIndexOf("<div", start), html.indexOf(">", start));
      assert.ok(tag.includes('data-layout="home"'), id);
      assert.ok(tag.includes(MATCH_CARD_FILL_CLASS), id);
      const spacer = html.indexOf(`match-card-spacer-${id}`);
      assert.ok(spacer > start && spacer < html.indexOf(`availability-buttons-${id}`), "spacer sits above availability");
    }
    assert.equal((html.match(/shrink-0 w-\[86%\] sm:w-\[70%\] snap-start md:w-auto min-w-0/g) || []).length, 3, "same width, peek kept");
  });
  it("the track stretches slides (no cross-axis alignment override) and keeps snap/swipe", () => {
    const html = renderSection([mk("a", "XI"), mk("b", "YY")]);
    const track = html.slice(html.indexOf('data-testid="upcoming-matches-track"'), html.indexOf(">", html.indexOf('data-testid="upcoming-matches-track"')));
    assert.ok(!/items-(start|center|end)/.test(track));
    for (const c of ["snap-x", "snap-mandatory", "overflow-x-auto", "md:grid", "md:grid-cols-2"]) assert.ok(track.includes(c), c);
  });
  it("long opponent names wrap within two lines; venue truncates", () => {
    const header = src("components/matches/MatchCardHeader.tsx");
    assert.match(header, /break-words line-clamp-2/);
    assert.match(header, /<span className="truncate">\{venueName\}<\/span>/);
  });
  it("Home card layout applies to single and carousel layouts alike", () => {
    const html = renderSection([mk("a", "XI")]);
    assert.ok(html.includes('data-layout="home"'));
  });
});
