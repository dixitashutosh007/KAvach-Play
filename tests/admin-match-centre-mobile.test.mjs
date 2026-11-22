/**
 * Admin Match Centre — mobile-first layout (`tests/admin-match-centre-mobile.test.mjs`).
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

const { MatchCardStackedBody } = load("components/matches/MatchCardHeader.tsx");
const { MatchPaymentPanel } = load("components/matches/MatchPaymentPanel.tsx");
const tab = src("components/MatchesTab.tsx");

const m = (over = {}) => ({ id: "m1", opponent: "Rising Raptors", date: "2026-11-29", time: "07:00", format: "T30", jerseyColor: "Red", matchType: "Tournament", result: "Pending", ...over });
const ground = { id: "g1", name: "Vintage Sports Park Cricket Ground North", mapsUrl: "https://maps.google.com/?q=x" };

describe("Header and sub-tabs", () => {
  it("one row: 'Match Centre' title left; compact view dropdown + Add right", () => {
    const head = tab.slice(tab.indexOf('data-testid="match-centre-header"') - 120, tab.indexOf("<MatchesLoadError"));
    assert.match(head, /flex items-center justify-between gap-2/);
    assert.match(head, /min-w-0 truncate[^"]*">\s*Match Centre/);
    assert.match(head, /<div className="flex items-center gap-2 shrink-0">/);
    assert.match(head, /data-testid="match-view-select"/);
    assert.match(head, /appearance-none h-10 pl-8 pr-7 sm:pl-9 sm:pr-9/);
    assert.match(head, /<span className=\{isAdding \? "" : "hidden sm:inline"\}>/, "Add label hidden on mobile (icon + aria-label)");
    assert.match(head, /aria-label=\{isAdding \? "Cancel" : "Add Match"\}/);
  });
  it("sub-tabs scroll instead of widening the page", () => {
    const bar = tab.slice(tab.indexOf('data-testid="match-subtabs"') - 200, tab.indexOf('data-testid="match-subtabs"'));
    assert.match(bar, /overflow-x-auto no-scrollbar/);
    assert.match(tab, /shrink-0 sm:shrink sm:flex-1 min-h-\[40px\][^`]*whitespace-nowrap/);
  });
});

describe("Admin card: stacked mobile body", () => {
  const html = render(React.createElement(MatchCardStackedBody, { match: m(), ground, tournamentName: "KAvach Premier League Winter Edition 2026" }));

  it("single column: opponent, tournament, then a time | date + venue strip", () => {
    const opp = html.indexOf("Rising Raptors");
    const tour = html.indexOf('data-testid="match-card-tournament-m1"');
    const sched = html.indexOf('data-testid="match-card-schedule-m1"');
    assert.ok(opp > 0 && tour > opp && sched > tour);
    assert.match(tagOf(html, "match-card-schedule-m1"), /grid-cols-\[auto_1px_minmax\(0,1fr\)\]/);
    assert.match(text(html), /7:00 AM/);
    assert.match(text(html), /29 NOV/i);
  });
  it("long names wrap / truncate inside the card", () => {
    assert.match(html, /<h3 class="[^"]*break-words line-clamp-2[^"]*"/);
    assert.match(html, /<span class="truncate">KAvach Premier League Winter Edition 2026<\/span>/);
    assert.match(html, /<span class="truncate">Vintage Sports Park Cricket Ground North<\/span>/);
    assert.ok(html.includes('data-testid="venue-link-stacked-m1"'));
  });
  it("result stamp only from the persisted result; none when pending", () => {
    assert.ok(!html.includes("result-stamp-m1"));
    const won = render(React.createElement(MatchCardStackedBody, { match: m({ result: "KAvach Won" }), ground }));
    assert.ok(won.includes("result-stamp-m1"));
    const tie = render(React.createElement(MatchCardStackedBody, { match: m({ result: "Tie" }), ground }));
    assert.ok(tie.includes("result-stamp-m1"));
  });
  it("missing opponent / venue use placeholders", () => {
    const h = render(React.createElement(MatchCardStackedBody, { match: m({ opponent: "" }), ground: null }));
    assert.match(text(h), /Opponent TBC/);
    assert.match(text(h), /Venue TBC/);
  });
  it("no fixed desktop widths or absolute positioning", () => {
    const s = src("components/matches/MatchCardHeader.tsx");
    const fn = s.slice(s.indexOf("export function MatchCardStackedBody"));
    assert.ok(!/\babsolute\b|max-w-\[9\.5rem\]|w-\[\d/.test(fn));
  });
});

describe("Admin card composition", () => {
  const card = tab.slice(tab.indexOf("const renderMatchCard ="), tab.indexOf("if (isAdmin) {", tab.indexOf("const renderMatchCard =")));
  it("mobile: corner tab for format/jersey; desktop: icon actions in the top bar", () => {
    assert.match(card, /corner=\{<MatchCornerTab match=\{match\} className="md:hidden" \/>\}/);
    assert.match(card, /className="hidden md:flex gap-1 items-center shrink-0" data-testid=\{`admin-card-icon-actions-\$\{match\.id\}`\}/);
  });
  it("mobile: three equal labelled actions after Payment Details", () => {
    const pay = card.indexOf("<MatchPaymentPanel");
    const actions = card.indexOf("data-testid={`admin-card-actions-${match.id}`}");
    assert.ok(pay > 0 && actions > pay);
    const row = card.slice(actions - 200, actions + 2600);
    assert.match(row, /md:hidden grid grid-cols-3 gap-2/);
    assert.equal((row.match(/h-11 rounded-xl/g) || []).length, 3);
    assert.match(row, /onClick=\{\(\) => startEdit\(match\)\}[\s\S]*Edit<\/span>/);
    assert.match(row, /onClick=\{\(\) => startDuplicate\(match\)\}[\s\S]*Duplicate<\/span>/);
    assert.match(row, /onClick=\{\(\) => deleteThisMatch\(\)\}[\s\S]*Delete<\/span>/);
    assert.match(row, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/, "taps don't open the match");
  });
  it("desktop and mobile delete share one confirmed workflow", () => {
    assert.equal((card.match(/deleteThisMatch\(\)/g) || []).length, 2);
    assert.match(card, /const deleteThisMatch = async \(\) => \{[\s\S]*await confirmAction\(\{[\s\S]*await store\.deleteMatch\(match\.id\);/);
  });
  it("tournament chip shown once per width (in the stacked body on mobile)", () => {
    assert.match(card, /className="hidden md:inline-block bg-gold\/15/);
  });
});

describe("Payment Details on mobile", () => {
  const players = [{ id: "p1", name: "Asha" }, { id: "p2", name: "Ravi" }];
  const payments = [
    { id: "a", matchId: "m1", playerId: "p1", status: "Paid", paymentMethod: "razorpay" },
    { id: "b", matchId: "m1", playerId: "p2", status: "Unpaid" },
  ];
  const html = render(React.createElement(MatchPaymentPanel, { match: { ...m(), fee: 500 }, players, payments, status: "ready", defaultOpen: true }));

  it("summary: two columns on mobile (Pending full width), three from sm", () => {
    assert.match(tagOf(html, "payment-summary"), /grid grid-cols-2 sm:grid-cols-3 gap-2/);
    assert.match(tagOf(html, "payment-pending"), /col-span-2 sm:col-span-1/);
    assert.match(html, /whitespace-nowrap truncate">KAvach Sponsored/);
  });
  it("status colour is drawn inside the avatar's own box (no clipped box-shadow ring)", () => {
    const avatars = html.match(/data-testid="payment-avatar"/g) || [];
    assert.equal(avatars.length, 2);
    assert.ok(!/[" ]ring-2[ "]/.test(html), "no outset ring on avatars");
    assert.match(html, /class="inline-flex shrink-0 w-12 h-12 rounded-full p-0\.5 bg-\[#15803D\]"/);
    assert.match(html, /class="inline-flex shrink-0 w-12 h-12 rounded-full p-0\.5 bg-\[#DC2626\]"/);
  });
  it("player rows scroll horizontally with vertical breathing room", () => {
    assert.match(tagOf(html, "paid-players-list"), /-mx-4 px-4 py-1 flex gap-2 overflow-x-auto/);
    assert.ok(!tagOf(html, "paid-players-list").includes("flex-wrap"));
  });
});
