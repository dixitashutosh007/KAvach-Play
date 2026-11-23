/**
 * Add / Edit Match redesign — Phase 1 (`tests/add-edit-match-redesign.test.mjs`).
 * Pure functions, server-side rendering and source inspection only.
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

const fee = load("lib/match-fee.ts");
const { MatchDatePicker, monthGrid, formatPickerDate } = load("components/matches/MatchDatePicker.tsx");
const { MatchFeeCalculator } = load("components/matches/MatchFeeCalculator.tsx");
const tab = src("components/MatchesTab.tsx");
const modal = tab.slice(tab.indexOf("const editMatchModal ="), tab.indexOf("if (isPlayerView) {", tab.indexOf("const editMatchModal =")));

describe("Fee rule: unchanged at the default margin", () => {
  it("equals the previous inline formula round(groundFee / 12 × 1.05) for every fee 0..20000", () => {
    for (let g = 0; g <= 20000; g += 1) {
      assert.equal(fee.computeMatchFee(g).feePerPlayer, Math.round((g / 12) * 1.05), String(g));
    }
  });
  it("margin adjusts the result; breakdown is consistent", () => {
    const b = fee.computeMatchFee(6600, 10);
    assert.equal(b.perPlayerBase, 550);
    assert.equal(b.feePerPlayer, 605);
    assert.equal(b.marginAmount, 55);
    assert.equal(fee.computeMatchFee(6600, 0).feePerPlayer, 550);
  });
  it("margin limits 0–50%, whole numbers, invalid → 5%", () => {
    assert.equal(fee.clampMargin(-3), 0);
    assert.equal(fee.clampMargin(80), 50);
    assert.equal(fee.clampMargin(7.4), 7);
    assert.equal(fee.clampMargin("abc"), 5);
    assert.equal(fee.DEFAULT_MARGIN_PCT, 5);
    assert.equal(fee.MATCH_FEE_PLAYER_BASIS, 12);
  });
  it("fee sources: practice / tournament ground fee, or the linked tournament's per-match fee", () => {
    const ground = { practiceFee: 6000, tournamentFee: 7200 };
    assert.deepEqual(fee.resolveGroundFee(ground, "Practice"), { amount: 6000, source: "practice" });
    assert.deepEqual(fee.resolveGroundFee(ground, "Tournament"), { amount: 7200, source: "tournament-ground" });
    assert.deepEqual(fee.resolveGroundFee(ground, "Tournament", { amountPerMatch: 8400 }), { amount: 8400, source: "tournament" });
    assert.deepEqual(fee.resolveGroundFee(ground, "Practice", { amountPerMatch: 8400 }), { amount: 6000, source: "practice" });
    assert.deepEqual(fee.resolveGroundFee({}, "Practice"), { amount: 0, source: "none" });
  });
});

describe("Fee calculator component", () => {
  const props = (over = {}) => ({ groundFeePerMatch: 6600, source: "practice", marginPct: 5, onMarginChange: () => {}, fee: 578, onFeeChange: () => {}, ...over });
  it("collapsed: only the header with the final fee visible", () => {
    const html = render(React.createElement(MatchFeeCalculator, props()));
    assert.match(text(html), /Match Fee Calculation ₹578/);
    assert.ok(!html.includes("match-fee-body"));
  });
  it("expanded: ground fee, ÷12 share, margin ± controls, margin amount, editable final fee", () => {
    const html = render(React.createElement(MatchFeeCalculator, props({ defaultOpen: true })));
    const t = text(html);
    assert.match(t, /Ground fee \(practice\) ₹6,600/);
    assert.match(t, /Per player \(÷ 12\) ₹550/);
    assert.match(t, /5%/);
    assert.match(t, /Margin amount ₹28/);
    assert.ok(html.includes('data-testid="margin-decrease"') && html.includes('data-testid="margin-increase"'));
    assert.match(html, /data-testid="match-fee-input"[^>]*value="578"|value="578"[^>]*data-testid="match-fee-input"/);
    assert.ok(!html.includes("match-fee-note"), "matches the calculation, no note");
  });
  it("a saved/manual fee that differs is kept and flagged with a one-tap 'Use calculated'", () => {
    const html = render(React.createElement(MatchFeeCalculator, props({ defaultOpen: true, fee: 650 })));
    assert.match(text(html), /differs from the calculated ₹578/);
    assert.ok(html.includes("match-fee-use-calculated"));
  });
  it("tournament's own per-player fee is explained", () => {
    const html = render(React.createElement(MatchFeeCalculator, props({ defaultOpen: true, source: "tournament", fee: 700, tournamentPerPlayerFee: 700 })));
    assert.match(text(html), /Using the tournament's own per-player fee/);
  });
  it("no configured ground fee → manual entry hint, no fake numbers", () => {
    const html = render(React.createElement(MatchFeeCalculator, props({ defaultOpen: true, groundFeePerMatch: 0, source: "none", fee: "" })));
    assert.match(text(html), /Not set/);
    assert.match(text(html), /enter the fee manually/);
  });
});

describe("Date picker", () => {
  it("field shows the selected date; calendar has month heading, prev/next and 44px day cells", () => {
    const html = render(React.createElement(MatchDatePicker, { value: "2026-11-14", onChange: () => {}, todayKey: "2026-11-22", defaultOpen: true }));
    assert.match(text(html), /Sat, 14 Nov 2026/);
    assert.match(text(html), /November 2026/);
    assert.ok(html.includes('aria-label="Previous month"') && html.includes('aria-label="Next month"'));
    assert.match(html, /data-testid="match-date-day-2026-11-14"/);
    assert.match(html, /aria-pressed="true"[^>]*data-testid="match-date-day-2026-11-14"|data-testid="match-date-day-2026-11-14"[^>]*aria-pressed="true"/);
    assert.match(html, /class="h-11 rounded-lg/);
  });
  it("month grid offsets the first weekday and has every day", () => {
    const g = monthGrid(2026, 10); // Nov 2026 starts on a Sunday
    assert.equal(g[0], 1);
    assert.equal(g.filter((d) => d !== null).length, 30);
    const feb = monthGrid(2027, 1); // Feb 2027 starts on a Monday
    assert.equal(feb[0], null);
    assert.equal(feb[1], 1);
    assert.equal(formatPickerDate("2026-11-14"), "Sat, 14 Nov 2026");
  });
  it("form stores the picked calendar date (no timezone conversion)", () => {
    assert.match(modal, /<MatchDatePicker\s+value=\{inputToDbDate\(formData\.date\)\}\s+onChange=\{\(key\) => setFormData\(\{ \.\.\.formData, date: key \}\)\}/);
  });
});

describe("Add / Edit Match form", () => {
  it("sections: Match Details, Match Configuration, fee calculator, optional Links & Result", () => {
    const order = ['title="Match Details"', 'title="Match Configuration"', "<MatchFeeCalculator", 'data-testid="match-form-optional"'].map((k) => modal.indexOf(k));
    assert.ok(order.every((i) => i > 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });
  it("time: 7:00 AM / 12:00 PM presets; the time picker only appears for Other", () => {
    assert.match(modal, /\["07:00", "7:00 AM"\],\s*\["12:00", "12:00 PM"\],/);
    assert.match(modal, /\{!isPresetTime && \(\s*<input\s+required\s+type="time"/);
    assert.match(tab, /const isPresetTime = formData\.time === "07:00" \|\| formData\.time === "12:00";/);
  });
  it("format, type, squad size and jersey colour kept with the same options", () => {
    assert.match(modal, /options=\{\["T20", "T30", "Other"\] as const\}/);
    assert.match(modal, /options=\{MATCH_TYPES\}/);
    assert.match(modal, /options=\{\["Scarlet Red", "Whites"\] as const\}/);
    assert.match(modal, /id="match-squad-size"/);
  });
  it("ground, type and margin changes recalculate with the current margin; tournament keeps its own fee", () => {
    assert.match(modal, /groundId: e\.target\.value \};\s*setFormData\(\{ \.\.\.next, fee: recalcFee\(next, feeMarginPct\) \}\);/);
    assert.match(modal, /tournamentId: matchType === "Tournament" \? formData\.tournamentId : "",[\s\S]*fee: recalcFee\(next, feeMarginPct\)/);
    assert.match(modal, /fee: t\.perPlayerFee,/);
    assert.match(modal, /setFeeMarginPct\(margin\);\s*setFormData\(\{ \.\.\.formData, fee: recalcFee\(formData, margin\) \}\);/);
  });
  it("editing keeps the saved fee until the admin changes something", () => {
    assert.match(tab, /fee: match\.fee === 0 \? "" : match\.fee,/);
    assert.ok(!/useEffect\([^)]*recalcFee/.test(tab), "no automatic recalculation on open");
  });
  it("obsolete result-detail inputs removed; result itself kept", () => {
    const markup = modal.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
    for (const gone of ["Player of the Match", "Top Performers", "Best Batsman", "Best Bowler", "Margin Type", 'name="marginType"', "potmId", "topPerformerIds", "resultMarginAmount"]) {
      assert.ok(!markup.includes(gone), gone);
    }
    assert.match(modal, /\["Pending", "KAvach Won", "KAvach Lost", "Draw", "Tie", "Abandoned"\]/);
  });
  it("historical result details are preserved on save (still carried in the form data)", () => {
    const edit = tab.slice(tab.indexOf("const startEdit ="), tab.indexOf("const startDuplicate ="));
    for (const f of ["resultMarginType: match.resultMarginType", "potmId: match.potmId", "topPerformerIds: match.topPerformerIds", "bestBatsman: match.bestBatsman", "bestBowler: match.bestBowler"]) {
      assert.ok(edit.includes(f), f);
    }
    assert.match(tab, /const processedData = \{\s*\.\.\.formData,/);
  });
  it("mobile sheet: scrollable, no fixed footer, 44–48px controls", () => {
    assert.match(modal, /max-h-\[100dvh\] sm:max-h-\[92vh\] overflow-y-auto/);
    assert.ok(!/fixed bottom-0/.test(modal));
    assert.match(modal, /data-testid="match-form-submit"[\s\S]{0,80}min-h-\[48px\]/);
  });
});
