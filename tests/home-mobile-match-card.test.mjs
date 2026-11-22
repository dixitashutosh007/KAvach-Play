/**
 * Mobile Player Home match card layout (`tests/home-mobile-match-card.test.mjs`).
 *
 * Fixed-geometry body (equal grid tracks, fixed divider), format/jersey chips in
 * the header row, no payment badge on Home, Match Center / Admin unchanged.
 * Server-side rendering and source inspection only: no browser, emulator,
 * network or database access.
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
const tagOf = (html, testid) => {
  const i = html.indexOf(`data-testid="${testid}"`);
  assert.ok(i >= 0, `missing ${testid}`);
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i));
};

const { PlayerMatchCard } = load("components/matches/PlayerMatchCard.tsx");
const { MatchCardCompactBody } = load("components/matches/MatchCardHeader.tsx");

const unpaid = { status: "UNPAID", netPayable: 698, isWaived: false };
const mk = (over = {}) => ({
  id: "m1", opponent: "Rising Raptors", date: "2026-11-29", time: "07:00", format: "T30",
  jerseyColor: "Red", matchType: "Tournament", result: "Pending", groundId: "g1", ...over,
});
const ground = (name) => ({ id: "g1", name, mapsUrl: "https://maps.google.com/?q=x" });
const card = (props = {}) =>
  render(React.createElement(PlayerMatchCard, {
    match: mk(), ground: ground("Mario Turf"), personalPaymentStatus: unpaid, availability: "Pending",
    onSelectMatch: () => {}, onRsvp: async () => {}, ...props,
  }));

describe("Fixed two-column body with a fixed divider", () => {
  const body = (match, g) => render(React.createElement(MatchCardCompactBody, { match, ground: g }));

  it("equal grid tracks with a 1px divider track; columns clip their own overflow", () => {
    const html = body(mk(), ground("Mario Turf"));
    assert.match(tagOf(html, "match-card-compact-m1"), /grid-cols-\[minmax\(0,1fr\)_1px_minmax\(0,1fr\)\]/);
    for (const col of ["match-card-compact-left-m1", "match-card-compact-right-m1"]) {
      const t = tagOf(html, col);
      assert.ok(t.includes("min-w-0") && t.includes("overflow-hidden"), col);
    }
    assert.match(tagOf(html, "match-card-compact-divider-m1"), /w-px/);
  });

  it("grid definition is identical for short/long opponents and venues (divider cannot move)", () => {
    const grids = [
      body(mk({ opponent: "XI" }), ground("Turf")),
      body(mk({ opponent: "Spirit Cricket Club Of Greater Bengaluru Super Kings" }), ground("Vintage Sports Park Cricket Ground, North Campus")),
      body(mk({ opponent: "" }), null),
    ].map((h) => tagOf(h, "match-card-compact-m1"));
    assert.ok(grids.every((g) => g === grids[0]));
  });

  it("long opponent clamps to two lines; long venue truncates with the link icon kept", () => {
    const html = body(mk({ opponent: "Spirit Cricket Club Of Greater Bengaluru" }), ground("Vintage Sports Park Cricket Ground"));
    assert.match(html, /<h3 class="[^"]*break-words line-clamp-2[^"]*"/);
    const link = html.slice(html.indexOf('data-testid="venue-link-compact-m1"'));
    assert.match(link, /<span class="truncate">Vintage Sports Park Cricket Ground<\/span>/);
    assert.ok(link.indexOf("lucide-external-link") > 0 || link.includes("<svg"), "external-link icon present");
  });

  it("missing opponent / venue keep the same rows via placeholders", () => {
    const html = body(mk({ opponent: "  " }), null);
    assert.match(text(html), /Opponent TBC/);
    assert.match(text(html), /Venue TBC/);
    assert.ok(html.includes('data-testid="match-time-compact-m1"'));
  });

  it("time and date stay prominent", () => {
    const html = body(mk(), ground("Mario Turf"));
    assert.match(tagOf(html, "match-time-compact-m1"), /text-2xl font-black/);
    assert.match(text(html), /7:00 AM/);
  });

  it("no absolute positioning in the compact body", () => {
    const s = src("components/matches/MatchCardHeader.tsx");
    const fn = s.slice(s.indexOf("export function MatchCardCompactBody"));
    assert.ok(!/\babsolute\b/.test(fn));
  });
});

describe("Player Home card (layout=home)", () => {
  const html = card({ layout: "home" });

  it("no unpaid balance / payment badge on Home", () => {
    assert.ok(!html.includes("payment-status-m1"));
    assert.ok(!/UNPAID|₹698/.test(text(html)));
  });

  it("format + jersey chips sit in the header row (mobile only), before the chevron", () => {
    const chips = html.indexOf('data-testid="match-card-chips-m1"');
    assert.ok(chips > html.indexOf("category-ribbon-m1") && chips < html.indexOf("view-details-m1"));
    assert.match(tagOf(html, "match-card-chips-m1"), /md:hidden/);
    assert.ok(html.includes('data-testid="format-badge-compact-m1"'));
  });

  it("mobile body vs desktop header are switched at md", () => {
    const mobile = html.lastIndexOf("<div", html.indexOf('data-testid="match-card-compact-m1"'));
    assert.ok(html.slice(mobile - 40, mobile + 5).includes('class="md:hidden"'));
    const desktop = html.lastIndexOf("<div", html.indexOf('data-testid="match-card-header-m1"'));
    assert.ok(html.slice(desktop - 40, desktop + 5).includes('class="hidden md:block"'));
  });

  it("availability row anchored at the bottom with a subtle divider; buttons unchanged", () => {
    const spacer = html.indexOf("match-card-spacer-m1");
    const avail = html.indexOf("availability-buttons-m1");
    assert.ok(spacer > 0 && avail > spacer);
    assert.ok(html.includes("border-t border-border/80"));
    assert.match(text(html), /Playing.*Maybe.*Out/);
  });

  it("result stamp still shows when a result exists", () => {
    const won = card({ layout: "home", match: mk({ result: "KAvach Won" }) });
    assert.ok(won.includes("result-stamp-m1"));
  });
});

describe("Scope protection", () => {
  it("Player Match Center card (default layout) still shows the payment badge and standard header", () => {
    const html = card();
    assert.ok(html.includes("payment-status-m1"));
    assert.ok(!html.includes("match-card-compact-m1"));
    assert.ok(!html.includes("match-card-chips-m1"));
    assert.ok(!html.includes('data-layout="home"'));
  });

  it("Admin Match Center keeps its own payment/balance rendering (file not using the Home layout)", () => {
    const admin = fs.readdirSync(path.resolve("components/matches")).filter((f) => /^Admin.*\.tsx$/.test(f));
    for (const f of admin) assert.ok(!src(`components/matches/${f}`).includes('layout="home"'), f);
    assert.ok(!src("components/matches/PlayerMatchCenter.tsx").includes('layout="home"'));
  });

  it("only the Home upcoming section uses the Home layout", () => {
    assert.match(src("components/home/UpcomingMatchesSection.tsx"), /layout="home"/);
  });
});
