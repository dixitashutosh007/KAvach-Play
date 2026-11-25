/**
 * Finance Plans Stage 4 — subscription periods and sponsorship reporting
 * (`tests/finance-subscriptions.test.mjs`). Imports the production pure rules;
 * server routes and UI by source inspection. No emulator, browser or network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(abs, mod.exports);
  const dir = path.dirname(abs);
  const r = (id) => {
    if (id.startsWith("@/lib/")) return load(withExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("./") || id.startsWith("../")) return load(withExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  cache.set(abs, mod.exports);
  return mod.exports;
}
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");
const sp = load("lib/subscription-periods.ts");
const mpa = load("lib/match-plan-application.ts");

const plans = [
  { id: "mdist", name: "Monthly Spread", type: "monthly", monthlyAmount: 2000, allocationPolicy: "distribute" },
  { id: "mfix", name: "Monthly Fixed", type: "monthly", monthlyAmount: 1200, allocationPolicy: "fixed_per_match", perMatchContribution: 500 },
  { id: "fx", name: "Fixed 500", type: "fixed", feeAmount: 500 },
];
const asg = (id, playerId, planId, startDate, endDate = null, extra = {}) => ({ id, playerId, planId, planName: planId, startDate, endDate, ...extra });

describe("Periods for a month (D3: full amount, no proration)", () => {
  const assignments = [
    asg("a1", "p1", "mdist", "2026-10-01"),
    asg("a2", "p2", "mfix", "2026-11-15"),
    asg("a3", "p3", "mdist", "2026-09-01", "2026-10-31"),
    asg("a4", "p4", "mdist", "2026-11-01", null, { cancelled: true }),
    asg("a5", "p5", "fx", "2026-11-01"),
    asg("legacy:p6:mdist", "p6", "mdist", null, null, { legacy: true }),
  ];
  const names = { p1: "Asha", p2: "Bala", p3: "Chetan", p4: "Dev", p5: "Esha", p6: "Farid" };
  const out = sp.periodsForMonth({ month: "2026-11", plans, assignments, existingIds: new Set(), playerNames: names });
  it("one period per active monthly assignment overlapping the month", () => {
    assert.deepEqual(out.map((p) => p.playerName), ["Asha", "Bala"]);
    assert.equal(out[0].id, "p1_mdist_2026-11");
  });
  it("mid-month start still owes the full amount; dates stay within the month", () => {
    const b = out.find((p) => p.playerId === "p2");
    assert.equal(b.periodStart, "2026-11-15");
    assert.equal(b.periodEnd, "2026-11-30");
    assert.equal(b.amount, 1200);
    assert.equal(b.allocationPolicy, "fixed_per_match");
    assert.equal(b.perMatchContribution, 500);
    assert.equal(b.status, "due");
  });
  it("re-running for the month creates nothing new (idempotent ids)", () => {
    const again = sp.periodsForMonth({ month: "2026-11", plans, assignments, existingIds: new Set(out.map((p) => p.id)), playerNames: names });
    assert.equal(again.length, 0);
  });
  it("month bounds", () => {
    assert.deepEqual(sp.monthBounds("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
  });
});

describe("Validity edits", () => {
  const p = { id: "x", playerId: "p1", planId: "mdist", periodStart: "2026-11-01", periodEnd: "2026-11-30" };
  it("extends or shortens with checks", () => {
    assert.equal(sp.validateValidityEdit(p, "2026-12-07", []), null);
    assert.equal(sp.validateValidityEdit(p, "2026-11-20", []), null);
    assert.match(sp.validateValidityEdit({ ...p, closed: true }, "2026-12-07", []), /closed/);
    assert.match(sp.validateValidityEdit(p, "2026-10-31", []), /before the period starts/);
    assert.match(sp.validateValidityEdit(p, "nope", []), /valid end date/);
    assert.match(sp.validateValidityEdit(p, "2026-11-30", []), /already/);
  });
  it("can't overlap the next period for the same player and plan", () => {
    const next = { id: "y", playerId: "p1", planId: "mdist", periodStart: "2026-12-01", periodEnd: "2026-12-31" };
    assert.match(sp.validateValidityEdit(p, "2026-12-07", [next]), /overlap/);
    assert.equal(sp.validateValidityEdit(p, "2026-12-07", [{ ...next, planId: "other" }]), null);
  });
});

describe("Closing a period: allocation, no carry-forward, counted once", () => {
  const m = (id, date, fee = 700) => ({ matchId: id, paymentId: `pay-${id}`, date, fee });
  const check = (period, s) => {
    for (const a of s.allocations) assert.equal(a.allocated + a.sponsorship, a.fee);
    assert.equal(s.allocatedTotal + s.unused, period.amount);
    assert.ok(s.unused >= 0);
  };
  const dist = { amount: 2000, allocationPolicy: "distribute", perMatchContribution: null };
  const fix = { amount: 1200, allocationPolicy: "fixed_per_match", perMatchContribution: 500 };
  it("distribute: even split, leftover rupees to the earliest", () => {
    const s = sp.settlePeriod(dist, [m("c", "2026-11-21"), m("a", "2026-11-07"), m("b", "2026-11-14")]);
    assert.deepEqual(s.allocations.map((a) => [a.matchId, a.allocated, a.sponsorship]), [["a", 667, 33], ["b", 667, 33], ["c", 666, 34]]);
    assert.equal(s.unused, 0);
    check(dist, s);
  });
  it("distribute: capped at each fee; excess is club income (not carried forward)", () => {
    const s = sp.settlePeriod(dist, [m("a", "2026-11-07"), m("b", "2026-11-14")]);
    assert.deepEqual(s.allocations.map((a) => a.allocated), [700, 700]);
    assert.equal(s.unused, 600);
    check(dist, s);
    const uneven = sp.settlePeriod({ ...dist, amount: 1000 }, [m("a", "2026-11-01", 300), m("b", "2026-11-02"), m("c", "2026-11-03")]);
    assert.deepEqual(uneven.allocations.map((a) => a.allocated), [300, 350, 350]);
    check({ amount: 1000 }, uneven);
  });
  it("a month with no matches: whole subscription is club income", () => {
    const s = sp.settlePeriod(dist, []);
    assert.equal(s.unused, 2000);
    assert.equal(s.allocations.length, 0);
  });
  it("fixed per match: in date order until the subscription runs out", () => {
    const s = sp.settlePeriod(fix, [m("a", "2026-11-07"), m("b", "2026-11-14"), m("c", "2026-11-21")]);
    assert.deepEqual(s.allocations.map((a) => [a.allocated, a.sponsorship]), [[500, 200], [500, 200], [200, 500]]);
    assert.equal(s.unused, 0);
    check(fix, s);
    const few = sp.settlePeriod(fix, [m("a", "2026-11-07")]);
    assert.equal(few.unused, 700);
  });
  it("settled match payments are final for the plan rules", () => {
    const app = mpa.buildMatchPlanApplication({
      match: { id: "m1", fee: 700, date: "2026-11-07", result: "Pending" },
      payments: [{ id: "pay", matchId: "m1", playerId: "p1", status: "Paid", manualMethod: "part_of_plan", paymentMethod: "manual", feeOverride: 0, feeCollectedAmount: 667, feeOffsetAmount: 33, planTag: "Monthly Spread (Subscription)", financeSnapshot: { source: "auto", planId: "mdist", planName: "Monthly Spread", planType: "monthly", contribution: 667, sponsorship: 33, periodId: "p1_mdist_2026-11", applied: {} } }],
      players: [{ id: "p1", name: "Asha" }],
      plans,
      assignments: [asg("a1", "p1", "mfix", "2026-11-01")],
    });
    assert.equal(app.rows[0].action, "skip");
    assert.match(app.rows[0].reason, /subscription period closed/);
    assert.equal(app.changes.length, 0);
  });
});

describe("Sponsorship report", () => {
  const matches = [
    { id: "m1", date: "2026-11-07", fee: 700, opponent: "A" },
    { id: "m2", date: "2026-11-14", fee: 700, opponent: "B", result: "Abandoned" },
    { id: "m3", date: "2026-12-05", fee: 700, opponent: "C" },
  ];
  const payments = [
    { matchId: "m1", playerId: "p1", playerName: "Asha", status: "Paid", manualMethod: "part_of_plan", feeOverride: 0, feeCollectedAmount: 667, feeOffsetAmount: 33, financeSnapshot: { planId: "mdist", planName: "Monthly Spread", source: "auto" } },
    { matchId: "m1", playerId: "p2", playerName: "Bala", status: "Unpaid", feeOverride: 500, feeOffsetAmount: 200, planTag: "Fixed 500", financeSnapshot: { planId: "fx", planName: "Fixed 500", source: "auto" } },
    { matchId: "m1", playerId: "p3", playerName: "Chetan", status: "Paid", manualMethod: "club_sponsored", feeOverride: 0, feeOffsetAmount: 700, financeSnapshot: { planId: "sp", planName: "Sponsored", source: "auto" } },
    { matchId: "m1", playerId: "p4", playerName: "Dev", status: "Paid", paymentMethod: "razorpay" },
    { matchId: "m1", playerId: "p5", playerName: "Esha", status: "Not Playing" },
    { matchId: "m1", playerId: "p6", playerName: "Farid", status: "Paid", manualMethod: "part_of_plan", feeOverride: 0, feeCollectedAmount: 0, feeOffsetAmount: 0, financeSnapshot: { planId: "mdist", planName: "Monthly Spread", source: "auto", pendingAllocation: true } },
    { matchId: "m2", playerId: "p4", playerName: "Dev", status: "Unpaid" },
    { matchId: "m3", playerId: "p4", playerName: "Dev", status: "Unpaid" },
  ];
  const periods = [
    { periodStart: "2026-11-01", periodEnd: "2026-11-30", amount: 2000, status: "paid", paidAmount: 2000, closed: true, settlement: { unused: 0 } },
    { periodStart: "2026-11-01", periodEnd: "2026-11-30", amount: 2000, status: "due" },
    { periodStart: "2026-10-01", periodEnd: "2026-10-31", amount: 2000, status: "paid", paidAmount: 2000, closed: true, settlement: { unused: 600 } },
  ];
  const r = sp.buildSponsorshipReport({ from: "2026-11-01", to: "2026-11-30", matches, payments, periods });
  it("match totals: abandoned and out-of-range matches and Not Playing rows excluded", () => {
    assert.equal(r.totals.matches, 1);
    assert.equal(r.totals.matchFees, 700 * 5);
    assert.equal(r.totals.players, 5);
  });
  it("subscription money is not counted as player cash; club sponsorship adds up", () => {
    assert.equal(r.totals.playerShare, 500 + 700, "Bala's plan fee + Dev's regular fee");
    assert.equal(r.totals.subscriptionCovered, 667);
    assert.equal(r.totals.clubSponsored, 33 + 200 + 700);
    assert.equal(r.totals.pendingAllocation, 1);
  });
  it("subscriptions counted once, at the period (overlapping periods only)", () => {
    assert.deepEqual(r.subscriptions, { periods: 2, billed: 4000, collected: 2000, outstanding: 2000, unusedIncome: 0, openPeriods: 1 });
  });
  it("grouped by plan, player and match", () => {
    assert.deepEqual(r.byPlan.map((b) => [b.label, b.clubSponsored]), [["Sponsored", 700], ["Fixed 500", 200], ["Monthly Spread", 33], ["Regular", 0]]);
    assert.equal(r.byPlayer.length, 5);
    assert.equal(r.byMatch.length, 1);
  });
});

describe("Server routes", () => {
  const subs = src("app/api/finance/subscriptions/route.ts");
  const rep = src("app/api/finance/reports/sponsorship/route.ts");
  it("subscriptions: Finance/Super only for GET and POST (DEF-R3-001)", () => {
    assert.match(subs, /export async function GET[\s\S]*?requireFinanceAdmin\(req\)/);
    assert.match(subs, /export async function POST[\s\S]*?const guard = await requireFinanceAdmin\(req\);\s*if \(!guard\.ok\) return guard\.response;/);
  });
  it("payment amount is the period's own amount, never from the request", () => {
    assert.ok(!/body\.amount/.test(subs));
    assert.match(subs, /paidAmount: p\.amount,/);
  });
  it("close: only after the period ends, allocations via settlePeriod, marks payments settled", () => {
    assert.match(subs, /if \(p\.periodEnd >= todayKey\) throw new RequestError\(409/);
    assert.match(subs, /const settlement = settlePeriod\(p, items\);/);
    assert.match(subs, /periodId: p\.id,/);
    assert.match(subs, /x\.financeSnapshot\?\.planId === p\.planId &&\s*!x\.financeSnapshot\?\.periodId/);
  });
  it("validity and voids need reasons; closed periods can't be voided; history kept; audited; no deletes", () => {
    assert.match(subs, /Give a reason for changing the validity\./);
    assert.match(subs, /This period is closed\. Refunds are a separate process\./);
    assert.match(subs, /validityEdits: FieldValue\.arrayUnion\(/);
    assert.match(subs, /paymentHistory: FieldValue\.arrayUnion\(/);
    assert.ok((subs.match(/await audit\(tx,/g) || []).length >= 5);
    assert.ok(!/tx\.delete\(|\.ref\.delete\(|\)\.delete\(\)/.test(subs));
  });
  it("report: Finance/Super only, bounded range, shared report rules (DEF-R3-001)", () => {
    assert.match(rep, /requireFinanceAdmin\(req\)/);
    assert.match(rep, /const MAX_DAYS = 366;/);
    assert.match(rep, /buildSponsorshipReport\(\{ from, to, matches, payments, periods \}\)/);
  });
  it("subscriptionPeriods has no client rule (server-only; catch-all denies)", () => {
    const rules = src("firestore.rules");
    assert.ok(!/subscriptionPeriods/.test(rules));
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });
});

describe("UI", () => {
  it("Finance Plans has Plans / Subscriptions / Sponsorship sections; management gated", () => {
    const ui = src("components/FeePlansAdmin.tsx");
    assert.match(ui, /<SubscriptionsPanel canManage=\{canManage\} todayKey=\{todayKey\} \/>/);
    assert.match(ui, /<SponsorshipReport todayKey=\{todayKey\} \/>/);
    const panel = src("components/finance/SubscriptionsPanel.tsx");
    assert.match(panel, /\{canManage && \(\s*<button type="button" onClick=\{createPeriods\}/);
    assert.match(panel, /\{canManage && !p\.closed && \(/);
    assert.match(panel, /disabled=\{busy \|\| p\.periodEnd >= todayKey\}/);
  });
  it("audit log knows subscription periods", () => {
    assert.match(src("lib/auditLog.ts"), /\| "subscription_period"/);
    assert.match(src("components/AuditLogTab.tsx"), /value: "subscription_period", label: "Subscription Periods"/);
  });
});
