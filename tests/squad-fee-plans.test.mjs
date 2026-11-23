/**
 * Squad selection + Match Fee Plans + margin persistence (Phase 2)
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

const bulk = load("lib/fee-plan-bulk.ts");
const { SquadPicker } = load("components/matches/SquadPicker.tsx");
const { FeePlanApplyDialog } = load("components/matches/FeePlanApplyDialog.tsx");
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

describe("Assigned plan → fee preview", () => {
  it("no active plan = Regular; one fixed plan = that plan; inactive plans ignored", () => {
    assert.deepEqual(bulk.previewPlayerFee(players[1], plans, 693), { label: "Regular", fee: 693, sponsored: 0, kind: "regular" });
    assert.deepEqual(bulk.previewPlayerFee(players[0], plans, 693), { label: "Youth350", fee: 350, sponsored: 343, kind: "fixed" });
    assert.equal(bulk.previewPlayerFee(players[5], plans, 693).kind, "regular");
    assert.equal(bulk.previewPlayerFee(players[3], plans, 693).kind, "other");
    assert.equal(bulk.previewPlayerFee(players[4], plans, 693).kind, "multiple");
  });
  it("fixed amounts mirror the existing per-player action (fee = plan amount, club pays the rest, never negative)", () => {
    assert.deepEqual(bulk.fixedPlanAmounts(plans[0], 693), { planFee: 350, sponsored: 343 });
    assert.deepEqual(bulk.fixedPlanAmounts({ ...plans[0], feeAmount: 800 }, 693), { planFee: 800, sponsored: 0 });
    assert.deepEqual(bulk.fixedPlanAmounts({ ...plans[0], feeAmount: undefined }, 693), { planFee: 693, sponsored: 0 });
  });
});

describe("Apply Fee Plans: who, how much, and who is skipped", () => {
  const app = bulk.buildFixedPlanApplication({
    match,
    players,
    feePlans: plans,
    payments: [
      pay("pa", "a"),
      pay("pb", "b"),
      pay("pc", "c"),
      pay("pd", "d"),
      pay("pe", "e"),
      pay("pf", "f"),
      pay("pg", "g", "Paid"),
      pay("ph", "h", "Unpaid", { feeOverride: 250, planTag: "Youth250" }),
      pay("px", "a", "Unpaid", { guestName: "Guest of Asha" }),
      pay("pn", "c", "Not Playing"),
      { id: "other", matchId: "m2", playerId: "a", status: "Unpaid" },
    ],
  });
  it("applies only unambiguous fixed plans to unpaid, not-yet-adjusted squad payments", () => {
    assert.deepEqual(app.items.map((i) => [i.playerName, i.plan.name, i.planFee, i.sponsored]), [
      ["Asha", "Youth350", 350, 343],
      ["Chetan", "Youth250", 250, 443],
    ]);
    assert.equal(app.totalSponsored, 786);
  });
  it("regular players counted (incl. inactive plan); others skipped with a reason", () => {
    assert.equal(app.regularCount, 2); // Bala, Farid
    const reasons = Object.fromEntries(app.skipped.map((s) => [s.playerName, s.reason]));
    assert.match(reasons.Dev, /Monthly Pass is a monthly plan — apply per player/);
    assert.match(reasons.Esha, /Several plans assigned/);
    assert.match(reasons.Gita, /Already paid/);
    assert.match(reasons.Hari, /Already on Youth250/);
    assert.ok(!("Guest of Asha" in reasons), "guest rows never auto-planned");
  });
  it("re-running after applying finds nothing new (idempotent)", () => {
    const again = bulk.buildFixedPlanApplication({
      match, players, feePlans: plans,
      payments: [pay("pa", "a", "Unpaid", { feeOverride: 350, planTag: "Youth350" })],
    });
    assert.equal(again.items.length, 0);
  });
  it("MatchesTab writes each item with the existing fixed-plan call", () => {
    assert.match(tab, /await store\.applyFeePlanToPayment\(\s*match\.id,\s*item\.paymentId,\s*item\.planFee,\s*item\.plan\.name,\s*item\.sponsored,\s*undefined,\s*"Unpaid",\s*\);/);
    // existing per-player fixed branch still uses the same shape
    assert.match(tab, /const offset = Math\.max\(0, standardFee - feeAmount\);\s*await store\.applyFeePlanToPayment\(\s*match\.id,\s*paymentId,\s*feeAmount,\s*plan\.name,\s*offset,\s*undefined,\s*"Unpaid",/);
  });
});

describe("Confirmation dialog", () => {
  const application = {
    items: [{ paymentId: "pa", playerId: "a", playerName: "Asha", plan: plans[0], standardFee: 693, planFee: 350, sponsored: 343 }],
    skipped: [{ playerName: "Dev", reason: "Monthly Pass is a monthly plan — apply per player" }],
    regularCount: 3,
    totalSponsored: 343,
  };
  const html = render(React.createElement(FeePlanApplyDialog, { application, applying: false, onConfirm: () => {}, onClose: () => {} }));
  it("shows who gets which plan, plan vs regular fee, club sponsorship and total", () => {
    assert.match(text(html), /Players on plans 1/);
    assert.match(text(html), /Club sponsors ₹343/);
    assert.match(text(html), /Asha Youth350 ₹350 ₹693 ₹343/);
    assert.match(text(html), /3 players stay on the regular fee/);
    assert.match(text(html), /Not applied automatically \(1\)/);
    assert.match(text(html), /Apply to 1 player/);
  });
  it("nothing to apply → explains, confirm disabled", () => {
    const empty = render(React.createElement(FeePlanApplyDialog, { application: { items: [], skipped: [], regularCount: 5, totalSponsored: 0 }, applying: false, onConfirm: () => {}, onClose: () => {} }));
    assert.match(text(empty), /No squad player needs a fixed Match Fee Plan applied/);
    assert.match(empty, /data-testid="fee-plan-confirm"[^>]*disabled|disabled[^>]*data-testid="fee-plan-confirm"/);
  });
});

describe("Squad picker", () => {
  const base = {
    players: players.slice(0, 4), selectedIds: ["a", "b"], onToggle: () => {}, onSetSelected: () => {}, search: "", onSearch: () => {},
    squadCount: 9, maxSquadSize: 12, standardFee: 693, feePlans: plans, submitting: false, confirmDuplicates: false, onSubmit: () => {}, onCancel: () => {},
  };
  it("live count, spots left, per-player plan label and fee", () => {
    const html = render(React.createElement(SquadPicker, base));
    assert.match(text(html), /11 \/ 12/);
    assert.match(text(html), /9 in squad · 2 selected · 1 spots left/);
    assert.match(text(html), /Asha Youth350 ₹350/);
    assert.match(text(html), /Bala Regular ₹693/);
    assert.match(text(html), /Dev Monthly Pass ₹693/);
    assert.match(text(html), /1 selected player is on a Match Fee Plan · club sponsors ₹343/);
    assert.match(text(html), /Add 2 to Squad/);
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
