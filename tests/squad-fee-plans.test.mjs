/**
 * Squad selection + Finance Plan preview + margin persistence
 * (`tests/squad-fee-plans.test.mjs`). Pure logic, SSR and source checks only.
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
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");

const { SquadPicker } = load("components/matches/SquadPicker.tsx");
const tab = src("components/MatchesTab.tsx");

const plans = [
  { id: "y350", name: "Youth350", type: "fixed", feeAmount: 350, isActive: true },
  { id: "y250", name: "Youth250", type: "fixed", feeAmount: 250, isActive: true },
  { id: "mon", name: "Monthly Pass", type: "monthly", monthlyAmount: 2000, isActive: true },
  { id: "old", name: "Old Plan", type: "fixed", feeAmount: 100, isActive: false },
];
const players = [
  { id: "a", name: "Asha", feePlanIds: ["y350"] },
  { id: "b", name: "Bala", feePlanIds: [] },
  { id: "c", name: "Chetan", feePlanIds: ["y250"] },
  { id: "d", name: "Dev", feePlanIds: ["mon"] },
  { id: "e", name: "Esha", feePlanIds: ["y350", "y250"] },
  { id: "f", name: "Farid", feePlanIds: ["old"] },
  { id: "g", name: "Gita", feePlanIds: ["y350"] },
  { id: "h", name: "Hari", feePlanIds: ["y250"] },
];
const match = { id: "m1", fee: 693 };
const pay = (id, playerId, status = "Unpaid", over = {}) => ({ id, matchId: "m1", playerId, status, ...over });

// The plan application itself (server rules, dialog, overrides) is covered in
// tests/finance-plans-matches.test.mjs.

describe("Squad picker", () => {
  const base = {
    players: players.slice(0, 4), selectedIds: ["a", "b"], onToggle: () => {}, onSetSelected: () => {}, search: "", onSearch: () => {},
    squadCount: 9, maxSquadSize: 12, standardFee: 693, matchDate: "2026-11-28", feePlans: plans, assignments: [], submitting: false, confirmDuplicates: false, onSubmit: () => {}, onCancel: () => {},
  };
  it("live count, spots left, per-player plan label and fee", () => {
    const html = render(React.createElement(SquadPicker, base));
    assert.match(text(html), /11 \/ 12/);
    assert.match(text(html), /9 in squad · 2 selected · 1 spots left/);
    assert.match(text(html), /Asha Youth350 ₹350/);
    assert.match(text(html), /Bala Regular ₹693/);
    assert.match(text(html), /Dev Monthly Pass Sub/);
    assert.match(text(html), /1 selected player is on a Finance Plan · club sponsors ₹343/);
    assert.match(text(html), /Add 2 to Squad/);
  });
  it("uses the plan in effect on the match date (dated assignments win over legacy)", () => {
    const assignments = [{ id: "x", playerId: "b", planId: "y250", planName: "Youth250", startDate: "2026-11-01", endDate: "2026-11-30" }];
    const on = text(render(React.createElement(SquadPicker, { ...base, assignments })));
    assert.match(on, /Bala Youth250 ₹250/);
    const after = text(render(React.createElement(SquadPicker, { ...base, assignments, matchDate: "2026-12-05" })));
    assert.match(after, /Bala Regular ₹693/);
  });
  it("over the limit is clearly flagged", () => {
    const html = render(React.createElement(SquadPicker, { ...base, selectedIds: ["a", "b", "c", "d"] }));
    assert.match(text(html), /13 \/ 12/);
    assert.match(text(html), /1 over the squad limit/);
  });
  it("existing players only: no New tab, no name/mobile creation in the match squad flow", () => {
    assert.ok(!/addingNew|setNewPlayerName|newPlayerMobile/.test(tab));
    const picker = src("components/matches/SquadPicker.tsx");
    assert.ok(!/type="tel"|addPlayer\(/.test(picker));
    assert.match(tab, /<SquadPicker\s+players=\{filteredPlayers\}/);
  });
});

describe("Margin persistence", () => {
  it("saved with the match and restored when editing / duplicating", () => {
    assert.match(src("lib/types.ts"), /feeMarginPct\?: number;/);
    assert.match(tab, /feeMarginPct: clampMargin\(feeMarginPct\),/);
    const edit = tab.slice(tab.indexOf("const startEdit ="), tab.indexOf("const userHasAdminPrivileges"));
    assert.equal((edit.match(/setFeeMarginPct\(match\.feeMarginPct !== undefined \? clampMargin\(match\.feeMarginPct\) : DEFAULT_MARGIN_PCT\)/g) || []).length, 2);
  });
});
