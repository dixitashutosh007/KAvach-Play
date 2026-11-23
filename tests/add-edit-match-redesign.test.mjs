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
const { MatchDatePicker, monthGrid, monthWeekendDays, formatPickerDate } = load("components/matches/MatchDatePicker.tsx");
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
  it("fee sources: a linked tournament's per-match fee wins over the ground's; else the ground fee for the type", () => {
    const ground = { practiceFee: 6000, tournamentFee: 7200 };
    assert.deepEqual(fee.resolveGroundFee(ground, "Practice"), { amount: 6000, source: "practice" });
    assert.deepEqual(fee.resolveGroundFee(ground, "Tournament"), { amount: 7200, source: "tournament-ground" });
    assert.deepEqual(fee.resolveGroundFee(ground, "Tournament", { amountPerMatch: 8400 }), { amount: 8400, source: "tournament" });
    assert.deepEqual(fee.resolveGroundFee(ground, "Practice", { amountPerMatch: 8400 }), { amount: 8400, source: "tournament" });
    assert.deepEqual(fee.resolveGroundFee(ground, "Tournament", { amountPerMatch: 0 }), { amount: 7200, source: "tournament-ground" });
    assert.deepEqual(fee.resolveGroundFee({}, "Practice"), { amount: 0, source: "none" });
  });
  it("per-player fee precedence: tournament fee → ground fee → manual (null)", () => {
    const ground = { practiceFee: 6000, tournamentFee: 7200 };
    const t = { amountPerMatch: 8400, perPlayerFee: 750 };
    // 1. tournament per-player fee configured on the Tournaments page
    assert.equal(fee.resolveFormFee({ ground, matchType: "Tournament", tournament: t }), 750);
    // both ground and tournament have fees → tournament wins
    assert.equal(fee.resolveFormFee({ ground, matchType: "Tournament", tournament: { amountPerMatch: 0, perPlayerFee: 750 } }), 750);
    // tournament with only a per-match amount → calculated from it
    assert.equal(fee.resolveFormFee({ ground, matchType: "Tournament", tournament: { amountPerMatch: 8400, perPlayerFee: 0 } }), 735);
    // tournament with no fee → ground's tournament fee
    assert.equal(fee.resolveFormFee({ ground, matchType: "Tournament", tournament: { amountPerMatch: 0, perPlayerFee: 0 } }), 630);
    // no tournament → ground fee for the type
    assert.equal(fee.resolveFormFee({ ground, matchType: "Practice" }), 525);
    // nothing configured → manual
    assert.equal(fee.resolveFormFee({ ground: {}, matchType: "Practice" }), null);
    assert.equal(fee.resolveFormFee({ ground: null, matchType: "Tournament", tournament: { amountPerMatch: 0, perPlayerFee: 0 } }), null);
  });
  it("adjusting the margin recalculates from the per-match amount, even over a tournament fee", () => {
    const t = { amountPerMatch: 8400, perPlayerFee: 750 };
    assert.equal(fee.resolveFormFee({ ground: {}, matchType: "Tournament", tournament: t, marginPct: 10, fromMarginChange: true }), 770);
    // tournament fee with no per-match amount: margin can't recalculate, fee kept
    assert.equal(fee.resolveFormFee({ ground: {}, matchType: "Tournament", tournament: { amountPerMatch: 0, perPlayerFee: 750 }, marginPct: 10, fromMarginChange: true }), 750);
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
  it("nothing configured → opens by itself with an editable fee and a manual-entry hint", () => {
    const html = render(React.createElement(MatchFeeCalculator, props({ groundFeePerMatch: 0, source: "none", fee: "" })));
    assert.ok(html.includes("match-fee-body"), "opens automatically");
    assert.match(text(html), /Not set/);
    assert.match(text(html), /No tournament or ground fee is configured; enter the per-player fee manually/);
    assert.ok(html.includes('data-testid="match-fee-input"'));
  });
  it("tournament per-player fee shown as its own row; no manual hint", () => {
    const html = render(React.createElement(MatchFeeCalculator, props({ defaultOpen: true, groundFeePerMatch: 0, source: "none", fee: 750, tournamentPerPlayerFee: 750 })));
    assert.match(text(html), /Tournament fee \(per player\) ₹750/);
    assert.ok(!html.includes("match-fee-manual-hint"));
    assert.match(html, /data-testid="match-fee-input"[^>]*value="750"|value="750"[^>]*data-testid="match-fee-input"/);
  });
});

describe("Date picker", () => {
  it("inline: only that month's Saturdays and Sundays as tiles, month navigation, View Full Calendar", () => {
    const html = render(React.createElement(MatchDatePicker, { value: "2026-11-29", onChange: () => {}, todayKey: "2026-11-23" }));
    assert.match(text(html), /Sun, 29 Nov 2026/);
    assert.match(text(html), /November 2026/);
    assert.ok(html.includes('aria-label="Previous month"') && html.includes('aria-label="Next month"'));
    assert.ok(html.includes('data-testid="match-date-weekends"'));
    assert.equal((html.match(/data-testid="match-date-day-[^"]+"/g) || []).length, 9, "Nov 2026: Sun 1, Sat/Sun 7-8, 14-15, 21-22, 28-29");
    assert.ok(!html.includes("match-date-day-2026-11-25"), "weekdays not shown inline");
    assert.ok(!html.includes('data-testid="match-date-calendar"'), "full calendar is not inline");
    assert.match(html, /aria-pressed="true"[^>]*data-testid="match-date-day-2026-11-29"|data-testid="match-date-day-2026-11-29"[^>]*aria-pressed="true"/);
    assert.match(text(html), /View Full Calendar/);
    assert.match(html, /grid grid-cols-5 gap-1\.5/);
  });
  it("View Full Calendar opens a pop-up month calendar with every day; picking closes it", () => {
    const html = render(React.createElement(MatchDatePicker, { value: "2026-11-25", onChange: () => {}, todayKey: "2026-11-23", defaultFullOpen: true }));
    assert.ok(html.includes('data-testid="match-date-full-dialog"'));
    assert.match(html, /role="dialog" aria-modal="true"/);
    assert.equal((html.match(/data-testid="match-date-full-day-/g) || []).length, 30);
    assert.match(text(html), /Sun, 29 Nov 2026|Wed, 25 Nov 2026/);
    assert.match(text(html), /\(weekday\)/);
    const s2 = fs.readFileSync(path.resolve("components/matches/MatchDatePicker.tsx"), "utf-8");
    assert.match(s2, /onChange\(key\);\s*setView\(\{ year: fullView\.year, month: fullView\.month \}\);\s*setFullOpen\(false\);/);
  });
  it("weekend list helper", () => {
    assert.deepEqual(monthWeekendDays(2026, 10).map((d) => d.day), [1, 7, 8, 14, 15, 21, 22, 28, 29]);
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
  it("4-step wizard: Details → Schedule → Fee → Review, one step at a time; only Review saves", () => {
    assert.match(tab, /const MATCH_FORM_STEPS = \["Details", "Schedule", "Fee", "Review"\] as const;/);
    const at = (n) => modal.indexOf(`{formStep === ${n} && (`);
    const [s1, s2, s3, s4] = [1, 2, 3, 4].map(at);
    assert.ok(s1 > 0 && s2 > s1 && s3 > s2 && s4 > s3);
    const step1 = modal.slice(s1, s2);
    assert.ok(step1.indexOf('id="match-tournament"') < step1.indexOf('id="match-ground"'));
    assert.ok(step1.indexOf('id="match-ground"') < step1.indexOf('id="match-opponent"'));
    const step2 = modal.slice(s2, s3);
    for (const k of ["<MatchDatePicker", 'data-testid="match-time-presets"', 'testId="match-type-choice"', 'testId="match-format-choice"', 'testId="match-jersey-choice"']) {
      assert.ok(step2.includes(k), k);
    }
    const step3 = modal.slice(s3, s4);
    assert.ok(step3.includes("<MatchFeeCalculator"));
    assert.ok(step3.includes('data-testid="match-form-fee-intro"'));
    assert.ok(!step3.includes("match-form-summary"));
    const step4 = modal.slice(s4);
    for (const k of ['data-testid="match-form-summary"', 'data-testid="match-form-review-fee"', "Tentatively block this slot"]) {
      assert.ok(step4.includes(k), k);
    }
    // the submit button exists only for the last step
    assert.match(modal, /\{formStep < 4 \? \(\s*<button\s+key="wizard-next"/);
    assert.match(tab, /if \(formStep < 4\) \{\s*goToFormStep\(\(formStep \+ 1\) as MatchFormStep\);\s*return;\s*\}/);
  });
  it("Links & Result only when editing", () => {
    const step4 = modal.slice(modal.indexOf("{formStep === 4 && ("));
    assert.match(step4, /\{editingId && \(\s*<details[^>]*data-testid="match-form-optional"/);
  });
  it("review lists every choice with Edit links back to its step, and the fee", () => {
    const step4 = modal.slice(modal.indexOf("{formStep === 4 && ("));
    for (const k of ['label: "Opponent"', 'label: "Tournament"', 'label: "Ground"', 'label: "Date & time"', 'label: "Type & format"', 'label: "Jersey"']) {
      assert.ok(step4.includes(k), k);
    }
    assert.match(step4, /onClick=\{\(\) => goToFormStep\(row\.step\)\}/);
    assert.match(step4, /onClick=\{\(\) => goToFormStep\(3\)\}/);
    assert.match(step4, /Nothing is saved until you tap Save/);
  });
  it("navigation: Next validates, Back / header back go to the previous step, progress labels jump", () => {
    assert.match(modal, /key="wizard-next"\s*type="button"\s*onClick=\{\(e\) => \{[\s\S]*?e\.preventDefault\(\);\s*goToFormStep\(\(formStep \+ 1\) as MatchFormStep\);\s*\}\}\s*data-testid="match-form-next"/);
    // Next and Save are distinct elements, so the Next click can never become a submit
    assert.match(modal, /key="wizard-save"\s*type="submit"\s*data-testid="match-form-submit"/);
    assert.match(modal, /formStep > 1 \? goToFormStep\(\(formStep - 1\) as MatchFormStep\) : closeMatchForm\(\)/);
    assert.match(modal, /onClick=\{\(\) => goToFormStep\(st\)\}/);
    assert.match(tab, /const problem = matchFormStepProblem\(st as MatchFormStep, formData\);/);
    // Enter before the Review step advances instead of saving
    assert.match(tab, /if \(formStep < 4\) \{\s*goToFormStep\(\(formStep \+ 1\) as MatchFormStep\);\s*return;\s*\}/);
  });
  it("add, duplicate and edit all use the wizard from step 1", () => {
    const edit = tab.slice(tab.indexOf("const startEdit ="), tab.indexOf("const startDuplicate ="));
    const dup = tab.slice(tab.indexOf("const startDuplicate ="), tab.indexOf("const userHasAdminPrivileges"));
    assert.match(edit, /setFormStep\(1\);/);
    assert.match(dup, /setFormStep\(1\);/);
    assert.match(tab.slice(tab.indexOf("const resetForm ="), tab.indexOf("const startEdit =")), /setFormStep\(1\);/);
  });
  it("opponent is optional and saved as TBD when empty", () => {
    const step1 = modal.slice(modal.indexOf("{formStep === 1 && ("), modal.indexOf("{formStep === 2 && ("));
    const opp = step1.slice(step1.indexOf('id="match-opponent"') - 40, step1.indexOf('id="match-opponent"') + 300);
    assert.ok(!/\brequired\b/.test(opp));
    assert.match(tab, /opponent: formData\.opponent\.trim\(\) \|\| "TBD",/);
  });
  it("squad size is no longer in the form (existing/default value still saved)", () => {
    assert.ok(!modal.includes("match-squad-size"));
    assert.ok(!/Max Squad Size/.test(modal));
    assert.match(tab, /maxSquadSize: match\.maxSquadSize \|\| 12,/);
    assert.match(tab, /maxSquadSize: 12,/);
  });
  it("time: 7:00 AM / 12:00 PM presets; the time picker only appears for Other", () => {
    assert.match(modal, /\["07:00", "7:00 AM"\],\s*\["12:00", "12:00 PM"\],/);
    assert.match(modal, /\{!isPresetTime && \(\s*<input\s+type="time"/);
    assert.match(tab, /const isPresetTime = formData\.time === "07:00" \|\| formData\.time === "12:00";/);
  });
  it("format, type and jersey keep the same options", () => {
    assert.match(modal, /options=\{\["T20", "T30", "Other"\] as const\}/);
    assert.match(modal, /options=\{MATCH_TYPES\}/);
    assert.match(modal, /options=\{\["Scarlet Red", "Whites"\] as const\}/);
  });
  it("tournament first: fills ground, format, jersey and type; fee via the precedence rule", () => {
    assert.match(tab, /const fee = resolveFormFee\(\{ ground, matchType: next\.matchType, tournament, marginPct, fromMarginChange \}\);\s*return fee === null \? next\.fee : fee;/);
    assert.match(modal, /groundId: t\.groundId,\s*jerseyColor: t\.jerseyColor,\s*format: t\.format \|\| "T30",\s*matchType: "Tournament" as const,\s*\};\s*setFormData\(\{ \.\.\.next, fee: recalcFee\(next, feeMarginPct\) \}\);/);
    assert.match(modal, /groundId: e\.target\.value \};\s*setFormData\(\{ \.\.\.next, fee: recalcFee\(next, feeMarginPct\) \}\);/);
    assert.match(modal, /tournamentId: matchType === "Tournament" \? formData\.tournamentId : "",[\s\S]*fee: recalcFee\(next, feeMarginPct\)/);
    assert.match(modal, /const next = \{ \.\.\.formData, tournamentId: "" \};\s*setFormData\(\{ \.\.\.next, fee: recalcFee\(next, feeMarginPct\) \}\);/);
    assert.match(modal, /setFeeMarginPct\(margin\);\s*setFormData\(\{ \.\.\.formData, fee: recalcFee\(formData, margin, true\) \}\);/);
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
  it("mobile sheet: scrollable; footer sticks inside the sheet (never fixed over the page); 44–48px controls", () => {
    assert.match(modal, /max-h-\[100dvh\] sm:max-h-\[92vh\] overflow-y-auto/);
    assert.ok(!/fixed bottom-0/.test(modal));
    assert.match(modal, /sticky bottom-0 z-10 bg-surface border-t/);
    assert.match(modal, /data-testid="match-form-submit"[\s\S]{0,80}min-h-\[48px\]/);
  });
});

describe("Wizard step validation", () => {
  // matchFormStepProblem lives in MatchesTab; check its rules by source and behaviour mirror
  const src2 = fs.readFileSync(path.resolve("components/MatchesTab.tsx"), "utf-8");
  it("step 1 needs a ground; step 2 needs a date and a time; step 3 none", () => {
    assert.match(src2, /if \(step === 1 && !data\.groundId\) return "Select a ground to continue\.";/);
    assert.match(src2, /if \(step === 2 && !data\.date\) return "Pick a match date to continue\.";/);
    assert.match(src2, /if \(step === 2 && !\/\^\\d\{1,2\}:\\d\{2\}\/\.test\(data\.time \|\| ""\)\) return/);
    assert.match(src2, /if \(step === 3 && \(data\.fee === "" \|\| data\.fee === undefined \|\| Number\(data\.fee\) < 0\)\) \{\s*return "Enter the match fee per player \(0 if there is no fee\)\.";/);
  });
});
