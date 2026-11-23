/**
 * Manage Match redesign (`tests/match-management.test.mjs`): the shared
 * financial statement (imported production code), squad row actions, the
 * match-ledger route (source), and UI wiring (SSR / source). No emulator,
 * browser or network.
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
    if (id === "@/lib/authed-fetch") return { authedFetch: async () => ({ ok: false, json: async () => ({}) }) };
    if (id.startsWith("@/lib/")) return load(withExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("./") || id.startsWith("../")) return load(withExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  cache.set(abs, mod.exports);
  return mod.exports;
}
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const mf = load("lib/match-finance.ts");
const ms = load("lib/match-squad.ts");

// The approved example: fee in system ₹8,500, club ₹1,000, players ₹7,500,
// collected ₹6,500, outstanding ₹1,000, actual fee paid ₹8,000 → net −₹500.
const match = { id: "m1", fee: 850, date: "2026-11-30", result: "Pending", groundFeePaidAmount: 8000, isGroundFeePaid: true };
const pay = (id, extra) => ({ id, matchId: "m1", playerId: id, status: "Unpaid", ...extra });
const payments = [
  ...["a", "b", "c", "d", "e", "f"].map((id) => pay(id, { status: "Paid", paymentMethod: "manual" })),
  pay("g", { status: "Paid", paymentMethod: "razorpay", feeOverride: 700, feeOffsetAmount: 150, feeCollectedAmount: 700 }),
  pay("h", { status: "Paid", paymentMethod: "manual", feeOverride: 700, feeOffsetAmount: 150 }),
  pay("i", { feeOverride: 500, feeOffsetAmount: 350 }),
  pay("j", { feeOverride: 500, feeOffsetAmount: 350 }),
  pay("out", { status: "Not Playing" }),
  pay("w", { status: "Waived", waivedReason: "Match Abandoned" }),
];

describe("Financial statement — approved example", () => {
  const s = mf.buildMatchFinancialStatement(match, payments);
  it("matches the approved figures and a ₹500 net loss", () => {
    assert.equal(s.systemFee, 8500);
    assert.equal(s.clubSponsored, 1000);
    assert.equal(s.maxPlayerCollection, 7500);
    assert.equal(s.collected, 6500);
    assert.equal(s.outstanding, 1000);
    assert.equal(s.collectionPct, 86.67);
    assert.equal(s.paidCount, 8);
    assert.equal(s.unpaidCount, 2);
    assert.equal(s.actualFeePaid, 8000);
    assert.equal(s.netResult, -500);
    assert.equal(s.cashPosition, -1500);
    assert.deepEqual(mf.netResultLabel(s.netResult), { label: "Net Loss", tone: "loss" });
  });
  it("invariants: system = players + club; collected + outstanding = players", () => {
    assert.equal(s.systemFee, s.maxPlayerCollection + s.clubSponsored);
    assert.equal(s.collected + s.outstanding, s.maxPlayerCollection);
  });
  it("payment status never changes the projected net result", () => {
    const allPaid = payments.map((p) => (p.status === "Unpaid" ? { ...p, status: "Paid", paymentMethod: "manual" } : p));
    const t = mf.buildMatchFinancialStatement(match, allPaid);
    assert.equal(t.netResult, -500);
    assert.equal(t.collected, 7500);
    assert.equal(t.cashPosition, -500);
  });
  it("actual fee not recorded → no result invented; surplus and break-even", () => {
    const { groundFeePaidAmount, isGroundFeePaid, ...noFee } = match;
    const n = mf.buildMatchFinancialStatement(noFee, payments);
    assert.equal(n.actualFeePaid, null);
    assert.equal(n.netResult, null);
    assert.equal(mf.netResultLabel(null).tone, "unknown");
    assert.equal(mf.buildMatchFinancialStatement({ ...match, groundFeePaidAmount: 7000 }, payments).netResult, 500);
    assert.equal(mf.netResultLabel(500).label, "Net Surplus");
    assert.equal(mf.netResultLabel(0).label, "Break-even");
    assert.notEqual(mf.buildMatchFinancialStatement({ ...match, groundFeePaidAmount: 8500 }, payments).actualFeePaid, null, "actual fee is never assumed from the system fee");
  });
});

describe("Payment shares — every settlement type", () => {
  const fee = 700;
  it("club sponsored, subscription, pending, paid by another player, sponsor", () => {
    assert.deepEqual(
      (({ contribution, sponsorship, realMoney, kind }) => ({ contribution, sponsorship, realMoney, kind }))(mf.paymentShare(pay("x", { status: "Paid", manualMethod: "club_sponsored", feeOverride: 0, feeOffsetAmount: 700, feeCollectedAmount: 0 }), fee)),
      { contribution: 0, sponsorship: 700, realMoney: false, kind: "sponsored" },
    );
    const sub = mf.paymentShare(pay("x", { status: "Paid", manualMethod: "part_of_plan", feeOverride: 0, feeCollectedAmount: 500, feeOffsetAmount: 200 }), fee);
    assert.deepEqual([sub.contribution, sub.sponsorship, sub.realMoney, sub.kind], [500, 200, false, "subscription"]);
    const pending = mf.paymentShare(pay("x", { status: "Paid", manualMethod: "part_of_plan", feeOverride: 0, feeCollectedAmount: 0, feeOffsetAmount: 0, financeSnapshot: { pendingAllocation: true } }), fee);
    assert.equal(pending.kind, "pending");
    assert.equal(mf.paymentShare(pay("x", { status: "Paid", feeOverride: 0, sponsoredBy: "y" }), fee).kind, "paid_by_other");
    const sponsor = mf.paymentShare(pay("y", { feeOverride: 1400, sponsoring: "Paying for X" }), fee);
    assert.deepEqual([sponsor.contribution, sponsor.sponsorship], [1400, 0]);
    assert.equal(mf.paymentShare(pay("x", { status: "Not Playing" }), fee), null);
    assert.equal(mf.paymentShare(pay("x", { status: "Waived" }), fee), null);
  });
  it("real money: Razorpay / cash Paid with a non-zero amount only", () => {
    assert.equal(mf.isRealMoneyPayment(pay("x", { status: "Paid", paymentMethod: "razorpay", feeCollectedAmount: 700 }), fee), true);
    assert.equal(mf.isRealMoneyPayment(pay("x", { status: "Paid", paymentMethod: "manual" }), fee), true);
    assert.equal(mf.isRealMoneyPayment(pay("x", { status: "Paid", manualMethod: "club_sponsored" }), fee), false);
    assert.equal(mf.isRealMoneyPayment(pay("x", { status: "Paid", manualMethod: "part_of_plan", feeCollectedAmount: 500 }), fee), false);
    assert.equal(mf.isRealMoneyPayment(pay("x", { status: "Paid", sponsoredBy: "y", feeOverride: 0 }), fee), false);
    assert.equal(mf.isRealMoneyPayment(pay("x", { status: "Paid", feeOverride: 0 }), fee), false);
    assert.equal(mf.isRealMoneyPayment(pay("x"), fee), false);
  });
});

describe("Squad row actions", () => {
  const matchAdmin = { canManageFees: false, canManageSquad: true, financeClosed: false, matchFee: 700 };
  const finance = { ...matchAdmin, canManageFees: true };
  const ids = (r) => r.actions.map((a) => a.id);
  it("unpaid regular: Match Admin collects / removes / reminds; Finance also manages plans and fee payer", () => {
    assert.deepEqual(ids(ms.squadRowActions(pay("x"), matchAdmin)), ["markPaid", "remove", "remind"]);
    assert.deepEqual(ids(ms.squadRowActions(pay("x"), finance)), ["plan", "markPaid", "remove", "feePayer", "remind"]);
  });
  it("money collected: no plain Unpaid / removal — refund first", () => {
    const paid = pay("x", { status: "Paid", paymentMethod: "razorpay", feeCollectedAmount: 700 });
    const ma = ms.squadRowActions(paid, matchAdmin);
    assert.match(ma.actions.find((a) => a.id === "refund").disabledReason, /refund/);
    assert.match(ma.actions.find((a) => a.id === "remove").disabledReason, /refunded first/);
    const fa = ms.squadRowActions(paid, finance);
    assert.deepEqual(ids(fa), ["plan", "refund", "refundRemove"]);
    assert.match(fa.actions.find((a) => a.id === "plan").disabledReason, /refund it first/);
  });
  it("closed finances: plan / fee payer explain the lock; unpaid can still be collected and removed", () => {
    const r = ms.squadRowActions(pay("x", { feeOverride: 500, feeOffsetAmount: 200, planTag: "Fixed 500" }), { ...finance, financeClosed: true });
    assert.match(r.actions.find((a) => a.id === "plan").disabledReason, /closed/);
    assert.match(r.actions.find((a) => a.id === "regular").disabledReason, /closed/);
    assert.match(r.actions.find((a) => a.id === "feePayer").disabledReason, /closed/);
    assert.equal(r.actions.find((a) => a.id === "markPaid").disabledReason, undefined);
    assert.equal(r.actions.find((a) => a.id === "remove").disabledReason, undefined);
  });
  it("non-cash settlements can be removed; settled subscription periods can't", () => {
    const spons = pay("x", { status: "Paid", manualMethod: "club_sponsored", feeOverride: 0, feeOffsetAmount: 700 });
    assert.equal(ms.squadRowActions(spons, matchAdmin).actions.find((a) => a.id === "remove").disabledReason, undefined);
    const settled = pay("x", { status: "Paid", manualMethod: "part_of_plan", feeOverride: 0, feeCollectedAmount: 500, financeSnapshot: { periodId: "p" } });
    assert.match(ms.squadRowActions(settled, matchAdmin).actions.find((a) => a.id === "remove").disabledReason, /subscription period/);
  });
  it("view-only admins get no actions", () => {
    assert.equal(ms.squadRowActions(pay("x"), { ...matchAdmin, canManageSquad: false }).actions.length, 0);
  });
});

describe("Badges and status", () => {
  const plans = [{ id: "s10", type: "percentage", discountPct: 10 }];
  it("plan badge from the finance record; match-only overrides marked", () => {
    assert.deepEqual(ms.planBadge(pay("x"), plans), { label: "Regular", tone: "regular", matchOnly: false });
    assert.deepEqual(ms.planBadge(pay("x", { financeSnapshot: { source: "auto", planId: "s10", planName: "Senior10", planType: "percentage" } }), plans), { label: "Senior10 (10%)", tone: "percentage", matchOnly: false });
    assert.equal(ms.planBadge(pay("x", { financeSnapshot: { source: "override", planId: null, planName: "Regular (this match)", planType: "regular" } }), plans).matchOnly, true);
    assert.equal(ms.planBadge(pay("x", { status: "Paid", manualMethod: "club_sponsored" }), plans).tone, "sponsored");
  });
  it("match status", () => {
    assert.equal(ms.matchStatus({ date: "2026-11-30", result: "Pending" }, "2026-11-23"), "Upcoming");
    assert.equal(ms.matchStatus({ date: "2026-11-23" }, "2026-11-23"), "Today");
    assert.equal(ms.matchStatus({ date: "2026-11-01", result: "Pending" }, "2026-11-23"), "Completed");
    assert.equal(ms.matchStatus({ date: "2026-11-30", result: "Abandoned" }, "2026-11-23"), "Abandoned");
  });
});

describe("Ledger route /api/finance/match-ledger", () => {
  const route = src("app/api/finance/match-ledger/route.ts");
  it("Finance / Super Admin only", () => {
    assert.match(route, /const guard = await requireFinanceAdmin\(req\);\s*if \(!guard\.ok\) return guard\.response;/);
  });
  it("actual fee: corrections need a reason; closed → adjustment only; history append-only", () => {
    assert.match(route, /if \(action === "setGroundFee" && closed\) throw new RequestError\(409/);
    assert.match(route, /if \(kind !== "set" && !reason\) throw new RequestError\(400/);
    assert.match(route, /groundFeeHistory: FieldValue\.arrayUnion\(/);
  });
  it("close needs the actual fee and snapshots the statement; reopen needs a reason", () => {
    assert.match(route, /Record the actual match fee paid before closing/);
    assert.match(route, /const st = await loadStatement\(tx, ref, match\);/);
    assert.match(route, /financeHistory: FieldValue\.arrayUnion\(entry\)/);
    assert.match(route, /Give a reason for reopening/);
  });
  it("refund: real money only, full amount, reason + method + reference, original kept", () => {
    assert.match(route, /const collected = collectedMoney\(p, Number\(match\.fee\) \|\| 0\);/);
    assert.match(route, /it is not real money and can't be refunded/);
    assert.match(route, /if \(amount !== collected\)/);
    assert.match(route, /Give a reason for the refund\./);
    assert.match(route, /Add the cash refund confirmation/);
    assert.match(route, /reversals: FieldValue\.arrayUnion\(\{ amount, method, reference, reason, removedFromSquad: removeFromSquad, original, resultStatus/);
    assert.match(route, /const resultStatus = removeFromSquad \? "Not Playing" : "Unpaid";/);
    const update = route.slice(route.indexOf("tx.update(payRef, {"), route.indexOf("});", route.indexOf("tx.update(payRef, {")));
    assert.ok(!/razorpayPaymentId|feeCollectedAmount|paymentMethod/.test(update), "original transaction fields untouched");
  });
  it("every action audited in its transaction; nothing deleted", () => {
    assert.ok((route.match(/await audit\(tx,/g) || []).length >= 3);
    assert.ok(!/\.delete\(\)|FieldValue\.delete/.test(route));
  });
  it("Finance Plans locked while closed (plans route + shared rules)", () => {
    assert.match(src("lib/match-plan-application.ts"), /if \(match\.financeStatus === "closed"\) \{\s*out\.blocked =/);
    assert.match(src("app/api/finance/match-plans/route.ts"), /Match finances are closed\. Reopen them in the Finance tab/);
    assert.match(src("app/api/finance/match-plans/route.ts"), /if \(body\.regular === true\) \{/);
  });
});

describe("UI", () => {
  const { MatchFinancialsCard } = load("components/matches/MatchFinancials.tsx");
  it("summary card shows the example and a red Net Loss", () => {
    const s = mf.buildMatchFinancialStatement(match, payments);
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(MatchFinancialsCard, { s }));
    const t = text(html);
    assert.match(t, /Net Loss: ₹500/);
    assert.match(t, /Match Fee \(System\) ₹8,500 Club Sponsored ₹1,000 Player Collection \(Max\) ₹7,500/);
    assert.match(t, /₹6,500 \/ ₹7,500 \(87%\)/);
    assert.match(t, /8 Paid 2 Unpaid \(₹1,000\)/);
    assert.match(t, /Actual Match Fee Paid ₹8,000 Net Match Result −₹500 Net Loss/);
    assert.match(html, /bg-rose-50/);
  });
  it("squad list: compact rows with plan badge, amounts, status and a menu", () => {
    const { SquadList } = load("components/matches/SquadList.tsx");
    const rows = [{ payment: pay("i", { feeOverride: 630, feeOffsetAmount: 70, financeSnapshot: { source: "auto", planId: "s10", planName: "Senior10", planType: "percentage" } }), name: "Rohan" }];
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SquadList, { rows, plans: [{ id: "s10", type: "percentage", discountPct: 10 }], ctx: { canManageFees: true, canManageSquad: true, financeClosed: false, matchFee: 700 }, onAction() {} }),
    );
    assert.match(text(html), /Rohan Senior10 \(10%\) ₹630 ₹70 Unpaid/);
    assert.match(html, /aria-label="Actions for Rohan"/);
    assert.ok(!/overflow-x-auto/.test(html));
  });
  it("finance closed: fee step locked in Edit Match; add players disabled; Players tab can't uncheck collected money", () => {
    const tab = src("components/MatchesTab.tsx");
    assert.match(tab, /data-testid="match-form-fee-locked"/);
    assert.match(tab, /if \(before && before\.financeStatus === "closed"\) processedData\.fee = Number\(before\.fee\) \|\| 0;/);
    assert.match(tab, /disabled=\{statement\.financeClosed && !addingSquad\}/);
    assert.match(src("components/PlayersTab.tsx"), /isRealMoneyPayment\(p, m\.fee\) \? \(/);
  });
  it("Match Details uses the live match from the store", () => {
    assert.match(src("components/MatchesTab.tsx"), /match=\{store\.matches\.find\(\(m\) => m\.id === selectedMatch\.id\) \|\| selectedMatch\}/);
  });
});
