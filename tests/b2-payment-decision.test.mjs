/**
 * B2 — pure decision function and obligation classification (tests/b2-payment-decision.test.mjs)
 * Imports production code only (lib/payment-decision.ts). Rules P1–P7, §15 table, §16, §18.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decidePaymentApplication,
  bundleOutcome,
  classifyMatchFee,
  classifyOtherFee,
  classifyMerchDuesOrder,
  classifyMerchShop,
  classifyLateFeeInterim,
  assessRenewal,
  isRecordedLateFee,
  isLateFeeExemption,
  isUsablePaymentId,
  expiryToDayNumber,
  intentHasFirstPayment,
} from "../lib/payment-decision.ts";

const ev = { paymentId: "pay_A1", orderId: "order_1", amountPaise: 50000, currency: "INR", intentId: "intent_1" };
const payable = { key: "k", kind: "match_fee", amountPaise: 50000, cls: "PAYABLE", reason: "OK" };
const settled = { ...payable, key: "s", cls: "SETTLED", reason: "OBLIGATION_SETTLED" };
const missing = { ...payable, key: "m", cls: "MISSING", reason: "OBLIGATION_MISSING" };
const base = {
  event: ev, paymentIdUsable: true, existingPayment: null,
  intent: { status: "pending" }, hasIntentId: true, validation: { ok: true }, assessments: [payable],
};

describe("B2: decidePaymentApplication (P1–P7)", () => {
  it("no usable payment id → dead-letter only", () => {
    assert.equal(decidePaymentApplication({ ...base, paymentIdUsable: false }).kind, "NO_PAYMENT_ID");
  });
  it("P1 replay on identical registry record; P2 conflict on any identity difference", () => {
    assert.deepEqual(decidePaymentApplication({ ...base, existingPayment: { ...ev } }), { kind: "REPLAY", backfill: false });
    for (const diff of [{ orderId: "order_X" }, { amountPaise: 1 }, { currency: "USD" }, { intentId: "other" }]) {
      assert.equal(decidePaymentApplication({ ...base, existingPayment: { ...ev, ...diff } }).kind, "IDENTITY_CONFLICT");
    }
  });
  it("P1 cutover: paid intent with the same payment id and no record → replay with backfill", () => {
    const d = decidePaymentApplication({ ...base, intent: { status: "paid", razorpayPaymentId: "pay_A1" } });
    assert.deepEqual(d, { kind: "REPLAY", backfill: true });
    const c = decidePaymentApplication({ ...base, intent: { status: "paid", razorpayPaymentId: "pay_A1" }, validation: { ok: false, reason: "AMOUNT_MISMATCH" } });
    assert.equal(c.kind, "IDENTITY_CONFLICT");
  });
  it("P3 unmatched: missing intent / failed validation", () => {
    assert.deepEqual(decidePaymentApplication({ ...base, intent: null }), { kind: "UNMATCHED", reason: "INTENT_NOT_FOUND" });
    assert.deepEqual(decidePaymentApplication({ ...base, intent: null, hasIntentId: false }), { kind: "UNMATCHED", reason: "NO_INTENT_ID" });
    assert.deepEqual(decidePaymentApplication({ ...base, validation: { ok: false, reason: "CURRENCY_MISMATCH" } }), { kind: "UNMATCHED", reason: "CURRENCY_MISMATCH" });
  });
  it("P5 duplicate when the intent already has a first payment (paid / paid_unapplied / exception)", () => {
    for (const status of ["paid", "paid_unapplied", "exception"]) {
      assert.deepEqual(decidePaymentApplication({ ...base, intent: { status, razorpayPaymentId: "pay_OTHER" } }), { kind: "DUPLICATE", reason: "CONFLICTING_PAYMENT" });
    }
    for (const status of ["pending", "created", undefined]) assert.equal(intentHasFirstPayment({ status }), false);
  });
  it("data-integrity hold precedes obligations; P6/P7 bundle rule", () => {
    assert.deepEqual(decidePaymentApplication({ ...base, holdReason: "MERGE_CHAIN_INVALID" }), { kind: "HOLD", reason: "MERGE_CHAIN_INVALID" });
    assert.deepEqual(decidePaymentApplication(base), { kind: "APPLY" });
    assert.equal(decidePaymentApplication({ ...base, assessments: [payable, settled] }).kind, "DUPLICATE");
    assert.equal(decidePaymentApplication({ ...base, assessments: [payable, missing] }).kind, "HOLD");
    assert.equal(decidePaymentApplication({ ...base, assessments: [settled, missing] }).kind, "HOLD");
    assert.equal(decidePaymentApplication({ ...base, assessments: [] }).kind, "HOLD", "an empty bundle never applies");
  });
  it("bundleOutcome reports the first blocking reason", () => {
    assert.deepEqual(bundleOutcome([payable, settled]), { kind: "DUPLICATE", reason: "OBLIGATION_SETTLED" });
    assert.deepEqual(bundleOutcome([settled, missing]), { kind: "HOLD", reason: "OBLIGATION_MISSING" });
  });
  it("payment ids must be Razorpay-shaped to key a record", () => {
    assert.equal(isUsablePaymentId("pay_ABC123"), true);
    for (const bad of ["", "pay_", "PAY_1", "pay_a/b", "order_1", null]) assert.equal(isUsablePaymentId(bad), false);
  });
});

describe("B2: §15 classification", () => {
  const mf = (payment, match = { fee: 500 }, extra = {}) =>
    classifyMatchFee({ key: "k", path: "p", snapshotPaise: 50000, intentPlayerId: "p1", paymentPlayerId: payment?.playerId ?? null, payment, match, ...extra }).cls;
  it("match fee", () => {
    assert.equal(mf(null), "MISSING");
    assert.equal(mf({ status: "Unpaid", playerId: "p1" }, null), "MISSING");
    assert.equal(mf({ status: "Unpaid", playerId: "p2" }), "CONFLICT");
    assert.equal(mf({ status: "Unpaid", playerId: "p1" }, { fee: 500, result: "Abandoned" }), "NOT_DUE");
    assert.equal(mf({ status: "Paid", paymentMethod: "razorpay", playerId: "p1" }), "SETTLED");
    assert.equal(mf({ status: "Paid", manualMethod: "cash_collected", playerId: "p1" }), "SETTLED");
    assert.equal(mf({ status: "Unpaid", sponsoredBy: "p9", playerId: "p1" }), "SETTLED");
    assert.equal(mf({ status: "Waived", playerId: "p1" }), "NOT_DUE");
    assert.equal(mf({ status: "Not Playing", playerId: "p1" }), "NOT_DUE");
    assert.equal(mf({ status: "Unpaid", feeOverride: 600, playerId: "p1" }), "CHANGED");
    assert.equal(mf({ status: "Unpaid", razorpayPaymentId: "pay_x", playerId: "p1" }), "UNCLASSIFIABLE");
    assert.equal(mf({ status: "Mystery", playerId: "p1" }), "UNCLASSIFIABLE");
    assert.equal(mf({ status: "Unpaid", playerId: "p1" }), "PAYABLE");
  });
  it("other fee", () => {
    const of = (fee) => classifyOtherFee({ key: "k", path: "p", snapshotPaise: 10000, fee }).cls;
    assert.equal(of(null), "MISSING");
    assert.equal(of({ status: "Paid", amount: 100 }), "SETTLED");
    assert.equal(of({ status: "Cancelled", amount: 100 }), "NOT_DUE");
    assert.equal(of({ status: "Unpaid", amount: 120 }), "CHANGED");
    assert.equal(of({ status: "Unpaid", amount: 100 }), "PAYABLE");
  });
  it("merchandise (dues and shop)", () => {
    const mo = (order, orderPlayerId = "p1") => classifyMerchDuesOrder({ key: "k", path: "p", snapshotPaise: 65000, order, orderPlayerId, intentPlayerId: "p1" }).cls;
    assert.equal(mo(null), "MISSING");
    assert.equal(mo({ paymentStatus: "Unpaid", price: 650 }, "p2"), "CONFLICT");
    assert.equal(mo({ paymentStatus: "Paid", price: 650 }), "SETTLED");
    assert.equal(mo({ paymentStatus: "Unpaid", price: 700 }), "CHANGED");
    assert.equal(mo({ paymentStatus: "Unpaid", price: 650 }), "PAYABLE");
    assert.equal(classifyMerchShop({ key: "k", path: "p", snapshotPaise: 1, exists: true }).reason, "MERCH_ORDER_EXISTS");
  });
  it("late fee interim guard (§18), same predicate as the dues screens", () => {
    const lf = (fees, match = { fee: 1 }) => classifyLateFeeInterim({ key: "k", matchId: "m1", snapshotPaise: 15000, match, playerFees: fees });
    assert.equal(lf([]).cls, "PAYABLE");
    assert.equal(lf([{ templateId: "latefee_m1_0", status: "Paid" }]).reason, "LATE_FEE_ALREADY_RECORDED");
    assert.equal(lf([{ title: "Late Fee: vs X", comment: "m1", status: "Unpaid" }]).reason, "LATE_FEE_ALREADY_RECORDED");
    assert.equal(lf([{ title: "Late Fee Exemption: m1", status: "Paid" }]).cls, "NOT_DUE");
    assert.equal(lf([{ templateId: "latefee_m1", status: "Cancelled" }]).cls, "PAYABLE");
    assert.equal(lf([], null).cls, "MISSING");
    assert.equal(isRecordedLateFee({ templateId: "latefee_m10" }, "m1"), true, "substring rule kept identical to the UI");
    assert.equal(isLateFeeExemption({ title: "Late Fee Exemption: m1", status: "Cancelled" }, "m1"), false);
  });
});

describe("B2: §16 renewal computation", () => {
  const r = (over) => assessRenewal({
    key: "k", path: "p", snapshotPaise: 100000, subjectExists: true, anchorExists: false,
    basisExpiry: "2026-12-31", currentExpiry: "2026-12-31", durationDays: 30, clubTodayYmd: "2026-11-24", ...over,
  });
  it("active basis extends from the basis; lapsed / NONE extends from club today", () => {
    assert.equal(r({}).newExpiry, "2027-01-30");
    assert.equal(r({ basisExpiry: "2026-10-01", currentExpiry: "2026-10-01" }).newExpiry, "2026-12-24");
    assert.equal(r({ basisExpiry: "NONE", currentExpiry: "NONE" }).newExpiry, "2026-12-24");
    assert.equal(r({ basisExpiry: "31/12/2026", currentExpiry: "31/12/2026" }).newExpiry, "2027-01-30");
  });
  it("anchor → SETTLED; changed basis → CHANGED; missing subject → MISSING; legacy superseded → CHANGED", () => {
    assert.equal(r({ anchorExists: true }).assessment.reason, "RENEWAL_ALREADY_SETTLED");
    assert.equal(r({ currentExpiry: "2027-01-30" }).assessment.reason, "RENEWAL_BASIS_CHANGED");
    assert.equal(r({ subjectExists: false }).assessment.cls, "MISSING");
    assert.equal(r({ legacySuperseded: true }).assessment.reason, "RENEWAL_LEGACY_SUPERSEDED");
  });
  it("unparseable basis or invalid duration is never applied", () => {
    assert.equal(r({ basisExpiry: "soon", currentExpiry: "soon" }).assessment.cls, "UNCLASSIFIABLE");
    assert.equal(r({ durationDays: 0 }).assessment.cls, "UNCLASSIFIABLE");
    assert.equal(expiryToDayNumber("2026-02-30"), null);
  });
});
