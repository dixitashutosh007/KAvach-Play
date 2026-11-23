/**
 * Finance Plans → match payments, Stage 3 (`tests/finance-plans-matches.test.mjs`).
 * Pure rules from lib/match-plan-application (imported, not copied), server
 * route source inspection, and SSR/source checks of the UI. No emulator,
 * browser, network or database access.
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
    if (id === "@/hooks/useMatchFinancePlans") return { useMatchFinancePlans: () => ({ preview: async () => ({ ok: false, error: "x" }), apply: async () => ({ ok: false, error: "x" }), override: async () => ({ ok: false, error: "x" }), clearOverride: async () => ({ ok: false, error: "x" }) }) };
    if (id.startsWith("@/lib/")) return load(withExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("./") || id.startsWith("../")) return load(withExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  cache.set(abs, mod.exports);
  return mod.exports;
}
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const mpa = load("lib/match-plan-application.ts");

const plans = [
  { id: "fx500", name: "Fixed 500", type: "fixed", feeAmount: 500, isActive: true },
  { id: "fx800", name: "Fixed 800", type: "fixed", feeAmount: 800, isActive: true },
  { id: "fx350", name: "Youth350", type: "fixed", feeAmount: 350, isActive: true },
  { id: "sp", name: "Sponsored", type: "sponsored", isActive: true },
  { id: "pc10", name: "Ten Off", type: "percentage", discountPct: 10, isActive: true },
  { id: "mfix", name: "Monthly Fixed", type: "monthly", monthlyAmount: 2000, allocationPolicy: "fixed_per_match", perMatchContribution: 500, isActive: true },
  { id: "mdist", name: "Monthly Spread", type: "monthly", monthlyAmount: 2000, allocationPolicy: "distribute", isActive: true },
];
const asg = (id, playerId, planId, startDate, endDate = null) => ({ id, playerId, planId, planName: planId, startDate, endDate });
const assignments = [
  asg("as-a", "a", "fx500", "2026-11-01"),
  asg("as-c", "c", "sp", "2026-11-01"),
  asg("as-d", "d", "pc10", "2026-11-01"),
  asg("as-e", "e", "mfix", "2026-11-01"),
  asg("as-f", "f", "mdist", "2026-11-01"),
  asg("as-h", "h", "fx800", "2026-11-01"),
  asg("as-i", "i", "fx500", "2026-10-01", "2026-11-27"), // ended the day before the match
];
const players = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({ id, name: id.toUpperCase(), feePlanIds: id === "g" ? ["fx350"] : [] }));
const match = { id: "m1", fee: 700, date: "2026-11-28", result: "Pending" };
const pay = (id, playerId, over = {}) => ({ id, matchId: "m1", playerId, status: "Unpaid", ...over });
const payments = [
  pay("pa", "a"), pay("pb", "b"), pay("pc", "c"), pay("pd", "d"), pay("pe", "e"), pay("pf", "f"), pay("pg", "g"), pay("ph", "h"), pay("pi", "i"),
  pay("pj", "j", { status: "Paid", paymentMethod: "razorpay" }),
  pay("pk", "a", { guestName: "Guest of A" }),
  pay("pn", "b", { status: "Not Playing" }),
];
const build = (over = {}) => mpa.buildMatchPlanApplication({ match, payments, players, plans, assignments, ...over });
const row = (app, id) => app.rows.find((r) => r.paymentId === id);

/** Apply an application's writes to payments, as the server would. */
function applyWrites(app, list) {
  return list.map((p) => {
    const r = app.changes.find((c) => c.paymentId === p.id);
    if (!r) return p;
    const next = { ...p };
    for (const [k, v] of Object.entries(r.fields)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    if (r.fields.manualMethod) next.manualBy = mpa.AUTO_MANUAL_BY;
    next.financeSnapshot = mpa.snapshotForRow(app, r);
    return next;
  });
}

describe("Automatic application: plan on the match date, brief amounts", () => {
  const app = build();
  it("each plan type gives the agreed player / club split for a ₹700 match", () => {
    const expect = {
      pa: ["apply", 500, 200, "Fixed 500"],
      pb: ["regular", 700, 0, "Regular"],
      pc: ["apply", 0, 700, "Sponsored"],
      pd: ["apply", 630, 70, "Ten Off"],
      pe: ["apply", 500, 200, "Monthly Fixed"],
      pg: ["apply", 350, 350, "Youth350"],
      ph: ["apply", 700, 0, "Fixed 800"],
      pi: ["regular", 700, 0, "Regular"],
    };
    for (const [id, [action, c, s, name]] of Object.entries(expect)) {
      const r = row(app, id);
      assert.equal(r.action, action, id);
      assert.equal(r.contribution, c, id);
      assert.equal(r.sponsorship, s, id);
      assert.equal(r.planName, name, id);
      assert.equal(r.contribution + r.sponsorship, 700, id);
    }
    assert.match(row(app, "ph").warning, /above the match fee/);
    assert.equal(row(app, "pg").legacy, true);
    assert.equal(row(app, "pa").assignmentId, "as-a");
  });
  it("writes follow the existing accounting conventions", () => {
    assert.deepEqual(row(app, "pa").fields, { status: "Unpaid", feeOverride: 500, feeOffsetAmount: 200, feeCollectedAmount: null, planTag: "Fixed 500", paymentMethod: null, manualMethod: null });
    assert.deepEqual(row(app, "pc").fields, { status: "Paid", feeOverride: 0, feeOffsetAmount: 700, feeCollectedAmount: 0, planTag: "Sponsored", paymentMethod: "manual", manualMethod: "club_sponsored" });
    assert.deepEqual(row(app, "pe").fields, { status: "Paid", feeOverride: 0, feeOffsetAmount: 200, feeCollectedAmount: 500, planTag: "Monthly Fixed (Subscription)", paymentMethod: "manual", manualMethod: "part_of_plan" });
  });
  it("monthly spread: covered by the subscription now, amounts set when the period closes (Stage 4)", () => {
    const r = row(app, "pf");
    assert.equal(r.action, "apply");
    assert.equal(r.pendingAllocation, true);
    assert.deepEqual(r.fields, { status: "Paid", feeOverride: 0, feeOffsetAmount: 0, feeCollectedAmount: 0, planTag: "Monthly Spread (Subscription)", paymentMethod: "manual", manualMethod: "part_of_plan" });
    assert.equal(mpa.snapshotForRow(app, r).pendingAllocation, true);
    assert.equal(app.totals.pendingAllocation, 1);
  });
  it("skips with reasons: already paid, guests; ignores Not Playing", () => {
    assert.equal(row(app, "pj").action, "skip");
    assert.equal(row(app, "pj").reason, "Already paid");
    assert.equal(row(app, "pk").action, "skip");
    assert.match(row(app, "pk").reason, /Guest/);
    assert.equal(row(app, "pn"), undefined);
  });
  it("totals and change list", () => {
    assert.equal(app.changes.length, 7);
    assert.equal(app.totals.players, 11);
    assert.equal(app.totals.sponsorship, 200 + 700 + 70 + 200 + 350);
  });
  it("abandoned matches are blocked (approved Option A: no match-fee obligation)", () => {
    const blocked = build({ match: { ...match, result: "Abandoned" } });
    assert.match(blocked.blocked, /abandoned/);
    assert.equal(blocked.changes.length, 0);
  });
});

describe("Snapshots: idempotent, refreshed only while untouched, final once settled", () => {
  const first = build();
  const after = applyWrites(first, payments);
  it("re-running changes nothing", () => {
    const again = build({ payments: after });
    assert.equal(again.changes.length, 0);
    assert.equal(row(again, "pa").action, "unchanged");
    assert.equal(row(again, "pc").action, "unchanged");
  });
  it("snapshot records plan, assignment, match date/fee and amounts", () => {
    const s = after.find((p) => p.id === "pa").financeSnapshot;
    assert.equal(s.source, "auto");
    assert.equal(s.planId, "fx500");
    assert.equal(s.assignmentId, "as-a");
    assert.equal(s.matchDate, "2026-11-28");
    assert.equal(s.matchFee, 700);
    assert.equal(s.contribution, 500);
    assert.equal(s.sponsorship, 200);
  });
  it("fee change updates untouched rows but never a paid one", () => {
    const paidA = after.map((p) => (p.id === "pa" ? { ...p, status: "Paid", paymentMethod: "razorpay" } : p));
    const app = build({ match: { ...match, fee: 800 }, payments: paidA });
    assert.equal(row(app, "pa").action, "skip");
    assert.equal(row(app, "pa").reason, "Already paid");
    assert.equal(row(app, "pa").contribution, 500, "keeps its recorded amount");
    assert.equal(row(app, "pd").action, "update");
    assert.equal(row(app, "pd").contribution, 720);
    assert.equal(row(app, "pc").action, "update");
    assert.equal(row(app, "pc").sponsorship, 800);
  });
  it("hand edits after application freeze the payment", () => {
    const edited = after.map((p) => (p.id === "pd" ? { ...p, feeOverride: 600 } : p));
    assert.equal(row(build({ payments: edited }), "pd").reason, "Changed after plans were applied");
  });
  it("a cancelled assignment sends an untouched row back to Regular (status Unpaid)", () => {
    const app = build({ payments: after, assignments: assignments.map((a) => (a.id === "as-c" ? { ...a, cancelled: true } : a)) });
    const r = row(app, "pc");
    assert.equal(r.action, "revert");
    assert.deepEqual(r.fields, mpa.REGULAR_FIELDS);
    const snap = mpa.snapshotForRow(app, r);
    assert.equal(snap.planType, "regular");
    assert.equal(snap.contribution, 700);
    // and once reverted, it is stable
    const reverted = applyWrites(app, after);
    assert.equal(row(build({ payments: reverted, assignments: assignments.map((a) => (a.id === "as-c" ? { ...a, cancelled: true } : a)) }), "pc").action, "regular");
  });
  it("overridden payments are never re-evaluated", () => {
    const ov = after.map((p) =>
      p.id === "pb"
        ? { ...p, feeOverride: 300, feeOffsetAmount: 400, planTag: "Fee override", financeSnapshot: { source: "override", planName: "Fee override", planType: "regular", contribution: 300, sponsorship: 400, applied: mpa.fieldsForOverride(300, 700, "Fee override"), override: { reason: "Hardship" } } }
        : p,
    );
    const r = row(build({ payments: ov }), "pb");
    assert.equal(r.action, "skip");
    assert.equal(r.reason, "Overridden: Hardship");
    assert.equal(r.contribution, 300);
  });
});

describe("Overrides", () => {
  it("₹0 override is club sponsorship; amounts are clamped to the fee", () => {
    assert.equal(mpa.fieldsForOverride(0, 700, "Fee override").manualMethod, "club_sponsored");
    assert.equal(mpa.fieldsForOverride(0, 700, "Fee override").feeOffsetAmount, 700);
    assert.deepEqual(mpa.fieldsForOverride(250, 700, "Fee override"), { status: "Unpaid", feeOverride: 250, feeOffsetAmount: 450, feeCollectedAmount: null, planTag: "Fee override", paymentMethod: null, manualMethod: null });
    assert.equal(mpa.fieldsForOverride(900, 700, "x").feeOverride, 700);
  });
  it("only while no money has been collected from the player", () => {
    assert.equal(mpa.isOverridable(pay("1", "a")), true);
    assert.equal(mpa.isOverridable(pay("1", "a", { status: "Paid", manualMethod: "club_sponsored" })), true);
    assert.equal(mpa.isOverridable(pay("1", "a", { status: "Paid", manualMethod: "part_of_plan" })), true);
    assert.equal(mpa.isOverridable(pay("1", "a", { status: "Paid", paymentMethod: "razorpay" })), false);
    assert.equal(mpa.isOverridable(pay("1", "a", { status: "Paid", manualMethod: "cash" })), false);
    assert.equal(mpa.isOverridable(pay("1", "a", { sponsoredBy: "b" })), false);
    assert.equal(mpa.isOverridable(pay("1", "a", { guestName: "G" })), false);
  });
});

describe("Server route /api/finance/match-plans", () => {
  const route = src("app/api/finance/match-plans/route.ts");
  it("roles: preview incl. Club Admin; apply Match/Finance/Super; overrides Finance/Super only", () => {
    assert.match(route, /action === "preview"\s*\? await requireRole\(req, \["superAdmin", "financeAdmin", "clubAdmin", "matchAdmin"\]\)/);
    assert.match(route, /action === "apply"\s*\? await requireRole\(req, \["superAdmin", "financeAdmin", "matchAdmin"\]\)/);
    assert.match(route, /action === "override" \|\| action === "clearOverride"\s*\? await requireFinanceAdmin\(req\)/);
    assert.match(route, /if \(!guard\) return NextResponse\.json\(\{ error: "Unknown action\." \}, \{ status: 400 \}\);/);
  });
  it("amounts come from Firestore via the shared rules, inside a transaction", () => {
    assert.match(route, /const app = buildMatchPlanApplication\(ctx\);/);
    assert.match(route, /await tx\.get\(matchRef\)/);
    assert.match(route, /collection\("financePlanAssignments"\)\.where\("playerId", "in", chunk\)/);
    assert.ok(!/body\.(fee|amount|sponsorship|feeOverride|feeOffsetAmount)\b/.test(route), "no fee amounts read from the request");
    assert.equal((route.match(/body\.contribution/g) || []).length, 2, "only the override amount / subscription allocation");
  });
  it("refresh only touches rows that already carry an automatic snapshot", () => {
    assert.match(route, /scope === "refresh" \? app\.changes\.filter\(\(r\) => r\.action !== "apply"\) : app\.changes/);
  });
  it("overrides need a reason, keep what the rule would have produced, and are audited", () => {
    assert.match(route, /if \(!reason\) return NextResponse\.json\(\{ error: "Give a reason for the change\." \}, \{ status: 400 \}\);/);
    assert.match(route, /if \(!isOverridable\(payment\)\)/);
    assert.match(route, /computedContribution: computed\.contribution,/);
    assert.equal((route.match(/await writeServerAudit\(/g) || []).length, 2);
  });
  it("never deletes documents", () => {
    assert.ok(!/tx\.delete\(|\.ref\.delete\(|\)\.delete\(\)/.test(route));
  });
});

describe("UI", () => {
  const tab = src("components/MatchesTab.tsx");
  it("Adjust fee only for Finance/Super Admins; apply for Match/Finance/Super; server re-checks", () => {
    assert.match(tab, /const canOverrideFees = isAdmin && Boolean\(hasAdminClaim \|\| appUser\?\.isFinanceAdmin\);/);
    assert.match(tab, /const canApplyPlans = isAdmin && Boolean\(hasAdminClaim \|\| appUser\?\.isFinanceAdmin \|\| appUser\?\.isMatchAdmin\);/);
    assert.match(tab, /\{canOverrideFees && isOverridable\(payment\) && \(/);
  });
  it("old client-side plan writes are gone from Match Details", () => {
    assert.ok(!/applyFeePlanToPayment|bifurcationModal|buildFixedPlanApplication|fee-plan-bulk/.test(tab));
    assert.ok(!fs.existsSync("lib/fee-plan-bulk.ts"));
  });
  it("editing a match's fee or date refreshes automatically applied plans", () => {
    assert.match(tab, /const feeOrDateChanged = !!before && \(Number\(before\.fee\) !== processedData\.fee \|\| before\.date !== processedData\.date\);/);
    assert.match(tab, /callMatchPlans\(\{ action: "apply", matchId, scope: "refresh" \}\)/);
  });
  it("dialog asks the server and is read-only without apply rights", () => {
    const { FeePlanApplyDialog } = load("components/matches/FeePlanApplyDialog.tsx");
    const ro = text(ReactDOMServer.renderToStaticMarkup(React.createElement(FeePlanApplyDialog, { matchId: "m1", canApply: false, onClose() {}, onApplied() {} })));
    assert.match(ro, /Working out each player's plan/);
    assert.ok(!/Apply to/.test(ro));
    const rw = ReactDOMServer.renderToStaticMarkup(React.createElement(FeePlanApplyDialog, { matchId: "m1", canApply: true, onClose() {}, onApplied() {} }));
    assert.match(rw, /data-testid="fee-plan-confirm"[^>]*disabled|disabled[^>]*data-testid="fee-plan-confirm"/);
  });
  it("override sheet requires a reason and offers amount / plan", () => {
    const { FeeOverrideSheet } = load("components/matches/FeeOverrideSheet.tsx");
    const html = text(ReactDOMServer.renderToStaticMarkup(React.createElement(FeeOverrideSheet, { matchId: "m1", payment: pay("pa", "a"), playerName: "Asha", matchFee: 700, plans, onClose() {}, onDone() {} })));
    assert.match(html, /Adjust fee · Asha/);
    assert.match(html, /Set amount Use a plan/);
    assert.ok(!/Plan rule/.test(html), "already follows the rule");
    assert.match(html, /Reason \(required\)/);
    assert.match(html, /Player pays ₹700 Club sponsors ₹0/);
  });
});
