/**
 * Player/Admin experience refinements (`tests/player-admin-refinements.test.mjs`):
 * player calendar, player-safe date selector, inline WON/LOST on admin cards,
 * WhatsApp removed from admin cards, Admin Console banner removed.
 * Server-side rendering and source inspection only.
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
    if (id.startsWith("@/hooks/")) return load(withExt(path.resolve("hooks", id.slice(8))));
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

const { MatchDateSelector, AdminMatchDateList } = load("components/matches/AdminMatchDateList.tsx");
const { MatchCardStackedBody, MatchCardHeader } = load("components/matches/MatchCardHeader.tsx");

const m = (id, date, over = {}) => ({ id, date, time: "07:00", opponent: `Opp ${id}`, result: "Pending", ...over });
const matches = [m("a", "2026-11-22"), m("b", "2026-11-25")];

describe("Player Match Centre: monthly date selector", () => {
  const center = src("components/matches/PlayerMatchCenter.tsx");
  it("reuses the shared selector in player mode, fed only with matches the player may see", () => {
    assert.equal(MatchDateSelector, AdminMatchDateList);
    assert.match(center, /<MatchDateSelector\s+variant="player"\s+storageKeyPrefix="playerMatches"\s+matches=\{grouped\.allEligible\}/);
  });
  it("selector sits above the regular lists, which always render", () => {
    const sel = center.indexOf("<MatchDateSelector");
    const upcoming = center.indexOf('data-testid="upcoming-matches-section"');
    assert.ok(sel > 0 && upcoming > sel);
    assert.ok(!/selectedKey|picked/.test(center.slice(upcoming)), "lists don't depend on the selected date");
  });
  it("date panel uses the normal player card; availability only for upcoming matches; no admin pieces", () => {
    assert.match(center, /renderMatchCard=\{\(match, idx\) => renderPlayerCard\(match, idx, \{ canRsvp: upcomingIds\.has\(match\.id\) \}\)\}/);
    assert.ok(!/onAddMatch|MatchPaymentPanel|startEdit|deleteMatch|Duplicate/.test(center));
  });

  it("player variant: no Tentatively Blocked legend, no booking wording, separate session keys", () => {
    const html = render(React.createElement(MatchDateSelector, {
      variant: "player", storageKeyPrefix: "playerMatches", matches, todayKey: "2026-11-21",
      defaultSelectedKey: "2026-11-21", renderMatchCard: () => null,
    }));
    const legend = text(html.split('data-testid="date-legend"')[1].split("</ul>")[0]);
    assert.match(legend, /Booked.*Available/);
    assert.ok(!/Tentatively Blocked/.test(legend));
    assert.match(text(html), /No matches scheduled for this date\./);
    assert.ok(!/available for booking/.test(text(html)));
    assert.ok(!html.includes("date-add-match"));
    const s = src("components/matches/AdminMatchDateList.tsx");
    assert.match(s, /useSessionState<\{ year: number; month: number \}>\(`\$\{storageKeyPrefix\}:month`/);
    assert.match(s, /useSessionState<string \| null>\(`\$\{storageKeyPrefix\}:selected`/);
  });
  it("admin variant unchanged: Tentatively Blocked legend and booking hint", () => {
    const html = render(React.createElement(AdminMatchDateList, {
      matches, todayKey: "2026-11-21", defaultSelectedKey: "2026-11-21", renderMatchCard: () => null, onAddMatch: () => {},
    }));
    assert.match(text(html), /Tentatively Blocked/);
    assert.match(text(html), /available for booking/);
  });
  it("player data never includes tentative fixtures (eligibility rule)", () => {
    assert.match(src("lib/match-eligibility.ts"), /if \(match\.isArchived \|\| match\.isTentative\) \{/);
  });
});

describe("WON / LOST on the opponent line (admin cards)", () => {
  const ground = { id: "g", name: "Turf" };
  it("mobile stacked body: compact result to the right of the opponent, no separate row", () => {
    const html = render(React.createElement(MatchCardStackedBody, { match: m("w", "2026-11-22", { opponent: "Rising Raptors", result: "KAvach Won", resultMarginAmount: 20 }), ground }));
    const line = html.slice(html.indexOf('data-testid="match-opponent-line-w"'));
    assert.ok(line.indexOf("Rising Raptors") < line.indexOf('data-testid="result-stamp-w"'));
    assert.match(html, /data-testid="result-stamp-w" data-result-tone="won" data-compact="true" title="WON by 20 runs"/);
    assert.match(html, /<h3 class="min-w-0 flex-1[^"]*line-clamp-2/);
    assert.ok(html.indexOf("result-stamp-w") > html.indexOf(">vs<"), "result is not above the VS label");
  });
  it("lost and tie map from the stored result only; pending shows nothing", () => {
    const lost = render(React.createElement(MatchCardStackedBody, { match: m("l", "2026-11-22", { result: "KAvach Lost" }), ground }));
    assert.match(lost, /data-result-tone="lost"/);
    assert.match(lost, /bg-rose-50 text-rose-700/);
    const tie = render(React.createElement(MatchCardStackedBody, { match: m("t", "2026-11-22", { result: "Tie" }), ground }));
    assert.match(text(tie), /TIE/);
    const pending = render(React.createElement(MatchCardStackedBody, { match: m("p", "2026-11-22"), ground }));
    assert.ok(!pending.includes("result-stamp-p"));
  });
  it("desktop header inline mode: result on the opponent line and no meta row for it", () => {
    const html = render(React.createElement(MatchCardHeader, { match: m("d", "2026-11-22", { result: "KAvach Lost" }), ground, resultPlacement: "inline" }));
    const line = html.slice(html.indexOf('data-testid="match-opponent-line-d"'), html.indexOf("</div>", html.indexOf('data-testid="match-opponent-line-d"')));
    assert.ok(line.includes('data-testid="result-stamp-d"'));
    assert.equal((html.match(/result-stamp-d/g) || []).length, 1);
  });
  it("default (player) header keeps the result in its meta row", () => {
    const html = render(React.createElement(MatchCardHeader, { match: m("r", "2026-11-22", { result: "KAvach Won" }), ground }));
    const line = html.slice(html.indexOf('data-testid="match-opponent-line-r"'), html.indexOf("</div>", html.indexOf('data-testid="match-opponent-line-r"')));
    assert.ok(!line.includes("result-stamp-r"));
    assert.ok(html.includes("result-stamp-r"));
  });
  it("admin desktop card uses the inline placement", () => {
    assert.match(src("components/MatchesTab.tsx"), /<MatchCardHeader match=\{match\} ground=\{ground\} resultPlacement="inline" \/>/);
  });
});

describe("Admin Match Centre cards: no WhatsApp share", () => {
  const tab = src("components/MatchesTab.tsx");
  const card = tab.slice(tab.indexOf("const renderMatchCard ="), tab.indexOf("if (isAdmin) {", tab.indexOf("const renderMatchCard =")));
  it("card has no Share on WhatsApp button and no empty result block", () => {
    assert.ok(!/WhatsApp/.test(card.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")), "no WhatsApp action in the card markup");
    assert.match(card, /match\.result === "KAvach Won" &&\s*\(match\.potmId \|\| match\.playerOfTheMatch/);
  });
  it("per-player WhatsApp payment reminders are untouched (group reminder removed by owner request)", () => {
    // Per-player reminder now lives in the squad row ⋯ menu (Manage Match redesign).
    assert.match(fs.readFileSync("lib/match-squad.ts", "utf-8"), /\{ id: "remind", label: "Send reminder" \}/);
    assert.match(tab, /await store\.notifyPlayerPayment\(p\.playerId, match\.id\);/);
    assert.ok(!/Continue to WhatsApp/.test(tab));
  });
});

describe("Admin Console banner", () => {
  it("removed from the shared admin shell; header toggle remains", () => {
    const page = src("app/page.tsx");
    assert.ok(!page.includes('data-testid="admin-hub-context-banner"'));
    assert.ok(!/Admin Console · \{/.test(page));
    assert.match(src("components/layout/AppHeader.tsx"), /\{isAdmin && onTogglePersona && \(/);
  });
});
