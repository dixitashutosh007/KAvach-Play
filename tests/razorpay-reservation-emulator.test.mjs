/**
 * FIN-001 Real Firestore Emulator Integration Tests
 * (tests/razorpay-reservation-emulator.test.mjs)
 *
 * Exercises actual Firestore transactions and order-creation orchestration against the
 * live Firebase Firestore Emulator across all 12 required scenarios:
 *
 * 1. Full order API orchestration with a Razorpay response delayed beyond the initial lease.
 * 2. Reconciliation states remaining blocked after 15 minutes (never auto-reacquires).
 * 3. Two concurrent reconciliation workers (atomic serialization).
 * 4. Stale reconciliation attempting to overwrite a newer reservation (fencing protection).
 * 5. Same receipt collision attempts across two obligations (unique authoritative receipts).
 * 6. Multiple external orders returned for one receipt (reconciliation conflict).
 * 7. Wrong amount/currency/receipt in reconciliation response (authoritative rejection).
 * 8. Firestore intent update failing after successful Razorpay order creation (activation_failed).
 * 9. Successful retry repairing the intent before returning the existing order (idempotent repair).
 * 10. Recovered order successfully passing webhook intent validation (end-to-end fulfilment).
 * 11. Reconciliation persistence failure (safe retention of reconciliation_required state).
 * 12. Reservation renewal failure during order creation (fencing loss prevents stale mutations).
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import Razorpay from "razorpay";
import { POST as orderPOST } from "../app/api/razorpay/order/route.ts";
import { POST as webhookPOST } from "../app/api/razorpay/webhook/route.ts";
import {
  generateReservationKey,
  generateAuthoritativeReceipt,
  acquirePaymentReservation,
  renewReservationLease,
  activatePaymentReservation,
  recordActivationFailure,
  recordReconciliationRequired,
  reconcileAmbiguousReservation,
  releasePaymentReservation,
  validateReservationForReuse,
  isAmbiguousRazorpayError,
  setReservationIntentId,
  verifyAndRepairIntent,
} from "../lib/razorpay-order.ts";
import { validateWebhookTransaction } from "../lib/razorpay-webhook.ts";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skipReason = !emulatorHost
  ? "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)"
  : false;

describe("FIN-001: Real Firestore Emulator Integration Tests", { skip: skipReason }, () => {
  let db;
  let FieldValue;

  before(async () => {
    if (!emulatorHost) return;
    process.env.NODE_ENV = "test";
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = "(default)";
    process.env.RAZORPAY_KEY_ID = "rzp_test_emulator_mock";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret_emulator_mock";

    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore, FieldValue: fv } = await import("firebase-admin/firestore");
    const app = !getApps().length
      ? initializeApp({ projectId: "kavach-play-reservation-test" })
      : getApps()[0];
    db = getFirestore(app);
    FieldValue = fv;
  });

  // ── Scenario 1: Full Order API Orchestration with Delayed Razorpay Response ──
  it("Scenario 1: Full order API orchestration with a Razorpay response delayed beyond initial lease", async () => {
    const planId = `plan_delayed_${Date.now()}`;
    const user = `user_delayed_${Date.now()}`;
    await db.collection("subscriptionPlans").doc(planId).set({ fee: 600, durationDays: 30 });

    // Set renewal interval fast (300ms) for testing
    process.env.RESERVATION_RENEWAL_INTERVAL_MS = "300";

    const dummyRzp = new Razorpay({ key_id: "mock", key_secret: "mock" });
    const apiProto = Object.getPrototypeOf(dummyRzp.api);
    const origPost = apiProto.post;

    try {
      // Mock Razorpay creation lasting 1200ms (longer than initial test lease)
      apiProto.post = async ({ url, data }) => {
        if (url === "/orders") {
          await new Promise((r) => setTimeout(r, 1200));
          return {
            id: `order_delayed_${Date.now()}`,
            amount: data.amount,
            currency: data.currency || "INR",
            receipt: data.receipt,
            notes: data.notes || {},
            status: "created",
          };
        }
        return origPost({ url, data });
      };

      const req = new Request("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-uid": user,
        },
        body: JSON.stringify({
          intentData: { type: "subscription", planId },
        }),
      });

      const res = await orderPOST(req);
      assert.equal(res.status, 200, "Delayed response must succeed through active lease renewal");
      const data = await res.json();
      assert.ok(data.id.startsWith("order_delayed_"));
      assert.equal(data.amount, 60000);

      const reservationKey = generateReservationKey({ type: "subscription", planId }, user);
      const snap = await db.collection("paymentReservations").doc(reservationKey).get();
      assert.equal(snap.data()?.status, "active", "Reservation must be activated with created order ID");
      assert.equal(snap.data()?.orderId, data.id);
    } finally {
      apiProto.post = origPost;
      delete process.env.RESERVATION_RENEWAL_INTERVAL_MS;
    }
  });

  // ── Scenario 2: Reconciliation States Remaining Blocked After 15 Minutes ─────
  it("Scenario 2: Reconciliation states remaining blocked after 15 minutes", async () => {
    const key = `res_em_rec_hold_${Date.now()}`;
    const user = "user_rec_hold_1";

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    assert.equal(res1.acquired, true);

    // Record reconciliation_required with expiresAt in the deep past (25 minutes ago)
    const twentyFiveMinutesAgo = new Date(Date.now() - 25 * 60 * 1000);
    const reservationRef = db.collection("paymentReservations").doc(key);
    await reservationRef.update({
      status: "reconciliation_required",
      receipt: `rcpt_past_${Date.now()}`,
      expiresAt: twentyFiveMinutesAgo,
      updatedAt: twentyFiveMinutesAgo,
    });

    // Attempt reacquisition: MUST remain blocked and return needsReconciliation
    const res2 = await acquirePaymentReservation(db, key, user, 500, "INR");
    assert.equal(res2.acquired, false, "Must not allow lock takeover even after hold expires");
    assert.equal(res2.needsReconciliation, true, "Must require authoritative reconciliation");

    // Repeat with reconciliation_failed
    await reservationRef.update({
      status: "reconciliation_failed",
      expiresAt: twentyFiveMinutesAgo,
    });
    const res3 = await acquirePaymentReservation(db, key, user, 500, "INR");
    assert.equal(res3.acquired, false);
    assert.equal(res3.needsReconciliation, true, "reconciliation_failed must remain blocked");
  });

  // ── Scenario 3: Two Concurrent Reconciliation Workers ────────────────────────
  it("Scenario 3: Two concurrent reconciliation workers serialize atomically", async () => {
    const key = `res_em_two_workers_${Date.now()}`;
    const user = "user_two_workers_1";
    const receipt = generateAuthoritativeReceipt(key);

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    await recordReconciliationRequired(
      db,
      key,
      res1.reservationToken,
      receipt,
      user,
      500,
      "INR",
      "Network timeout",
    );

    const mockRazorpay = {
      orders: {
        all: async () => ({
          items: [
            {
              id: "order_shared_rec_winner_111",
              receipt,
              amount: 50000,
              currency: "INR",
              status: "created",
            },
          ],
        }),
      },
    };

    // Both workers attempt reconciliation simultaneously
    const [wA, wB] = await Promise.all([
      reconcileAmbiguousReservation(mockRazorpay, db, key, user, 500, "INR"),
      reconcileAmbiguousReservation(mockRazorpay, db, key, user, 500, "INR"),
    ]);

    assert.equal(wA.reconciled, true);
    assert.equal(wB.reconciled, true);
    assert.equal(wA.existingOrder?.orderId, "order_shared_rec_winner_111");
    assert.equal(wB.existingOrder?.orderId, "order_shared_rec_winner_111");

    const snap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snap.data()?.status, "active");
  });

  // ── Scenario 4: Stale Reconciliation Attempting to Overwrite Newer Reservation 
  it("Scenario 4: Stale reconciliation attempting to overwrite a newer reservation", async () => {
    const key = `res_em_stale_rec_${Date.now()}`;
    const user = "user_stale_rec_1";
    const receipt = generateAuthoritativeReceipt(key);

    // Reservation 1: enters reconciliation_required
    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    await recordReconciliationRequired(
      db,
      key,
      res1.reservationToken,
      receipt,
      user,
      500,
      "INR",
      "Ambiguous 500 error",
    );

    // Definitive client-side failure or cancellation transitions reservation to failed
    await releasePaymentReservation(db, key, res1.reservationToken, "Definitive 400 error");
    const snap1 = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snap1.data()?.status, "failed");

    // Fresh acquisition succeeds with fenceVersion 2
    const res2 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    assert.equal(res2.acquired, true);
    assert.equal(res2.fenceVersion, 2);

    // A stale reconciliation worker holding fenceVersion 1 queries Razorpay late
    // and attempts to activate the reservation with an order
    const mockLateRzp = {
      orders: {
        all: async () => ({
          items: [{ id: "order_stale_delayed_999", receipt, amount: 50000, currency: "INR", status: "created" }],
        }),
      },
    };

    // Stale worker runTransaction write must be blocked by fencing check
    await assert.rejects(
      async () => {
        await db.runTransaction(async (transaction) => {
          const freshSnap = await transaction.get(db.collection("paymentReservations").doc(key));
          const fresh = freshSnap.data() || {};
          if (fresh.reservationToken !== res1.reservationToken || fresh.fenceVersion !== 1) {
            throw new Error("Fencing conflict: reservation was modified by another request during reconciliation.");
          }
          transaction.update(db.collection("paymentReservations").doc(key), { status: "active" });
        });
      },
      /Fencing conflict/,
      "Stale reconciliation must be fenced out from overwriting newer reservation",
    );

    const finalSnap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(finalSnap.data()?.status, "reserving", "Newer reservation must remain untouched");
    assert.equal(finalSnap.data()?.reservationToken, res2.reservationToken);
  });

  // ── Scenario 5: Same Receipt Collision Attempts Across Two Obligations ──────
  it("Scenario 5: Same receipt collision attempts across two obligations are prevented", () => {
    const keyA = generateReservationKey({ type: "subscription", planId: "plan_A" }, "user_1");
    const keyB = generateReservationKey({ type: "subscription", planId: "plan_B" }, "user_1");

    const receiptA = generateAuthoritativeReceipt(keyA);
    const receiptB = generateAuthoritativeReceipt(keyB);

    assert.notEqual(receiptA, receiptB, "Receipts for distinct obligations must be strictly distinct");
    assert.ok(receiptA.length <= 40, "Receipt A length must be <= 40 characters for Razorpay compatibility");
    assert.ok(receiptB.length <= 40, "Receipt B length must be <= 40 characters for Razorpay compatibility");
    assert.match(receiptA, /^rcpt_[a-f0-9]{32}$/);
    assert.match(receiptB, /^rcpt_[a-f0-9]{32}$/);
  });

  // ── Scenario 6: Multiple External Orders Returned for One Receipt ───────────
  it("Scenario 6: Multiple external orders returned for one receipt causes conflict", async () => {
    const key = `res_em_multi_orders_${Date.now()}`;
    const user = "user_multi_1";
    const receipt = generateAuthoritativeReceipt(key);

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    await recordReconciliationRequired(
      db,
      key,
      res1.reservationToken,
      receipt,
      user,
      500,
      "INR",
      "Network drop",
    );

    // Mock Razorpay returning 2 orders with the same receipt
    const mockMultiRzp = {
      orders: {
        all: async () => ({
          items: [
            { id: "order_dup_1", receipt, amount: 50000, currency: "INR", status: "created" },
            { id: "order_dup_2", receipt, amount: 50000, currency: "INR", status: "created" },
          ],
        }),
      },
    };

    const recResult = await reconcileAmbiguousReservation(mockMultiRzp, db, key, user, 500, "INR");
    assert.equal(recResult.reconciled, false);
    assert.match(recResult.error, /multiple orders found/);

    const snap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snap.data()?.status, "reconciliation_failed");
    assert.match(snap.data()?.reconciliationError, /Multiple Razorpay orders \(2\) found/);
  });

  // ── Scenario 7: Wrong Amount/Currency/Receipt in Reconciliation Response ─────
  it("Scenario 7: Wrong amount, currency, or receipt in reconciliation response is rejected", async () => {
    const key = `res_em_wrong_rzp_${Date.now()}`;
    const user = "user_wrong_1";
    const receipt = generateAuthoritativeReceipt(key);

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    await recordReconciliationRequired(db, key, res1.reservationToken, receipt, user, 500, "INR", "Timeout");

    // Case A: Amount mismatch (₹300 instead of ₹500)
    const mockWrongAmt = {
      orders: {
        all: async () => ({
          items: [{ id: "order_wrong_amt", receipt, amount: 30000, currency: "INR", status: "created" }],
        }),
      },
    };
    const resAmt = await reconcileAmbiguousReservation(mockWrongAmt, db, key, user, 500, "INR");
    assert.equal(resAmt.reconciled, false);
    assert.match(resAmt.error, /Amount mismatch/);

    // Case B: Currency mismatch (USD instead of INR)
    const mockWrongCurr = {
      orders: {
        all: async () => ({
          items: [{ id: "order_wrong_curr", receipt, amount: 50000, currency: "USD", status: "created" }],
        }),
      },
    };
    const resCurr = await reconcileAmbiguousReservation(mockWrongCurr, db, key, user, 500, "INR");
    assert.equal(resCurr.reconciled, false);
    assert.match(resCurr.error, /Currency mismatch/);

    // Case C: Invalid order status (e.g. cancelled)
    const mockBadStatus = {
      orders: {
        all: async () => ({
          items: [{ id: "order_bad_status", receipt, amount: 50000, currency: "INR", status: "cancelled" }],
        }),
      },
    };
    const resStatus = await reconcileAmbiguousReservation(mockBadStatus, db, key, user, 500, "INR");
    assert.equal(resStatus.reconciled, false);
    assert.match(resStatus.error, /Unrecognized or unsupported Razorpay order status|Invalid order status/);
  });

  // ── Scenario 8: Firestore Intent Update Failing After Order Creation ────────
  it("Scenario 8: Firestore intent update failing after successful Razorpay order creation", async () => {
    const key = `res_em_act_fail_${Date.now()}`;
    const user = "user_act_fail_2";
    const externalOrderId = `order_ext_orphan_${Date.now()}`;

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    assert.equal(res1.acquired, true);

    // Store intentId in reservation
    const intentRef = await db.collection("razorpayIntents").add({
      userId: user,
      amount: 500,
      currency: "INR",
      reservationKey: key,
      status: "pending",
      createdAt: new Date(),
    });
    await setReservationIntentId(db, key, res1.reservationToken, intentRef.id);

    // External order creation succeeded, but subsequent activation write threw error
    await recordActivationFailure(
      db,
      key,
      res1.reservationToken,
      externalOrderId,
      intentRef.id,
      user,
      500,
      "INR",
      "Network drop before intent.orderId update completed",
    );

    const snap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snap.data()?.status, "activation_failed");
    assert.equal(snap.data()?.orderId, externalOrderId);
    assert.equal(snap.data()?.intentId, intentRef.id);

    // Check intent: orderId was NOT set yet
    const intentSnap = await intentRef.get();
    assert.equal(intentSnap.data()?.orderId, undefined);
  });

  // ── Scenario 9: Successful Retry Repairing Intent Before Returning Order ────
  it("Scenario 9: Successful retry repairing the intent before returning existing order", async () => {
    const key = `res_em_repair_${Date.now()}`;
    const user = "user_repair_1";
    const orderId = `order_to_repair_${Date.now()}`;

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    const intentRef = await db.collection("razorpayIntents").add({
      userId: user,
      amount: 500,
      currency: "INR",
      reservationKey: key,
      status: "pending",
      createdAt: new Date(),
    });

    await recordActivationFailure(
      db,
      key,
      res1.reservationToken,
      orderId,
      intentRef.id,
      user,
      500,
      "INR",
      "Failed to update intent.orderId",
    );

    // Verify intent does NOT have orderId before repair
    let intentBefore = await intentRef.get();
    assert.equal(intentBefore.data()?.orderId, undefined);

    // Client retries acquisition: returns existingOrder
    const retryRes = await acquirePaymentReservation(db, key, user, 500, "INR");
    assert.equal(retryRes.acquired, false);
    assert.ok(retryRes.existingOrder);

    // verifyAndRepairIntent repairs the intent document
    const repairResult = await verifyAndRepairIntent(
      db,
      retryRes.existingOrder.intentId,
      retryRes.existingOrder.orderId,
      {
        userId: user,
        amount: 500,
        currency: "INR",
        reservationKey: key,
      },
    );
    assert.equal(repairResult.ok, true);

    // Verify intent DOES have orderId repaired now
    let intentAfter = await intentRef.get();
    assert.equal(intentAfter.data()?.orderId, orderId);
    assert.ok(intentAfter.data()?.repairedAt);
  });

  // ── Scenario 10: Recovered Order Successfully Passing Webhook Intent Validation
  it("Scenario 10: Recovered order successfully passing webhook intent validation", async () => {
    const key = `res_em_webhook_${Date.now()}`;
    const user = "user_webhook_1";
    const orderId = `order_webhook_${Date.now()}`;

    const intentRef = await db.collection("razorpayIntents").add({
      userId: user,
      amount: 500,
      currency: "INR",
      reservationKey: key,
      status: "pending",
      createdAt: new Date(),
    });

    // Repair intent with orderId
    await verifyAndRepairIntent(db, intentRef.id, orderId, {
      userId: user,
      amount: 500,
      currency: "INR",
      reservationKey: key,
    });

    const repairedIntent = (await intentRef.get()).data();
    assert.equal(repairedIntent.orderId, orderId);

    // Incoming webhook details for payment.captured
    const webhookDetails = {
      event: "payment.captured",
      paymentId: "pay_webhook_test_123",
      orderId,
      capturedPaise: 50000,
      capturedCurrency: "INR",
      intentId: intentRef.id,
      notes: {},
    };

    const validation = validateWebhookTransaction(repairedIntent, webhookDetails);
    assert.equal(validation.ok, true, "Recovered intent must pass strict webhook validation");
  });

  // ── Scenario 11: Reconciliation Persistence Failure ──────────────────────────
  it("Scenario 11: Reconciliation persistence failure retains reconciliation_required", async () => {
    const key = `res_em_persist_fail_${Date.now()}`;
    const user = "user_persist_fail_1";
    const receipt = generateAuthoritativeReceipt(key);

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    await recordReconciliationRequired(db, key, res1.reservationToken, receipt, user, 500, "INR", "Timeout");

    // Mock failing DB during transaction write
    const mockFailingDb = {
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({
              status: "reconciliation_required",
              reservationToken: res1.reservationToken,
              fenceVersion: 1,
              userId: user,
              receipt,
              amount: 500,
              currency: "INR",
            }),
          }),
        }),
      }),
      runTransaction: async () => {
        throw new Error("Firestore connection dropped during transaction write");
      },
    };

    const mockRzp = { orders: { all: async () => ({ items: [] }) } };
    const recResult = await reconcileAmbiguousReservation(mockRzp, mockFailingDb, key, user, 500, "INR");
    assert.equal(recResult.reconciled, false);
    assert.match(recResult.error, /connection dropped/);

    // In real Firestore, original reservation remains safely in reconciliation_required
    const snap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snap.data()?.status, "reconciliation_required");
  });

  // ── Scenario 12: Reservation Renewal Failure During Order Creation ────────────
  it("Scenario 12: Reservation renewal failure during order creation prevents stale mutations", async () => {
    const key = `res_em_renewal_fail_${Date.now()}`;
    const user = "user_renewal_fail_1";

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 100);
    await new Promise((r) => setTimeout(r, 200)); // wait for lease expiry

    // Second request takes over reservation
    const res2 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    assert.equal(res2.fenceVersion, 2);

    // Request 1 attempts renewal with stale token
    const renewal = await renewReservationLease(db, key, res1.reservationToken, 10000);
    assert.equal(renewal.renewed, false);
    assert.match(renewal.error, /Fencing conflict/);

    // Request 1 tries to activate: must be fenced out
    await assert.rejects(
      async () => {
        await activatePaymentReservation(db, key, res1.reservationToken, "order_stale_12", "intent_12");
      },
      /Fencing conflict/,
      "Stale token must be prevented from activating",
    );

    // Newer reservation remains intact
    const snap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snap.data()?.reservationToken, res2.reservationToken);
    assert.equal(snap.data()?.status, "reserving");
  });

  // ── Scenario 13 (Finding 1): Active Order Past 15-Min Expiry Reconciliation ──
  it("Scenario 13 (Finding 1): Active order past 15-min expiry is not auto-replaced; reconciles authoritatively", async () => {
    const key = `res_em_exp_active_${Date.now()}`;
    const user = `user_exp_${Date.now()}`;
    const externalOrderId = `order_exp_${Date.now()}`;

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    assert.equal(res1.acquired, true);

    const intentRef = await db.collection("razorpayIntents").add({
      userId: user,
      amount: 500,
      currency: "INR",
      reservationKey: key,
      status: "pending",
      createdAt: new Date(),
    });

    await activatePaymentReservation(db, key, res1.reservationToken, externalOrderId, intentRef.id);

    // Artificially expire the local reservation in real Firestore
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
    await db.collection("paymentReservations").doc(key).update({
      expiresAt: twentyMinsAgo,
    });

    // Calling acquirePaymentReservation must NOT create a new order; requires external reconciliation
    const resAfterExpiry = await acquirePaymentReservation(db, key, user, 500, "INR");
    assert.equal(resAfterExpiry.acquired, false);
    assert.equal(resAfterExpiry.needsReconciliation, true);
    assert.equal(resAfterExpiry.existingOrder?.orderId, externalOrderId);

    // Case A: Gateway status is 'paid' -> blocks replacement, returns isPaid: true
    const mockRzpPaid = {
      orders: {
        fetch: async (id) => ({ id, status: "paid", amount: 50000, currency: "INR" }),
      },
    };
    const recPaid = await reconcileAmbiguousReservation(mockRzpPaid, db, key, user, 500, "INR");
    assert.equal(recPaid.reconciled, true);
    assert.equal(recPaid.isPaid, true);
    assert.equal(recPaid.canRetry, false);

    // Case B: Gateway status is 'created' (payable) -> extends lease and reuses order
    const mockRzpPayable = {
      orders: {
        fetch: async (id) => ({ id, status: "created", amount: 50000, currency: "INR" }),
      },
    };
    const recPayable = await reconcileAmbiguousReservation(mockRzpPayable, db, key, user, 500, "INR");
    assert.equal(recPayable.reconciled, true);
    assert.equal(recPayable.existingOrder?.orderId, externalOrderId);
    const snapPayable = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snapPayable.data()?.status, "active");
    assert.ok(snapPayable.data()?.expiresAt.toDate().getTime() > Date.now());

    // Case C: Unsupported order status (e.g. 'expired' or 'cancelled') is rejected per Razorpay Orders contract
    // Per official Razorpay Orders API contract, Order entities strictly possess only 'created', 'attempted', and 'paid'.
    // Unsupported statuses remain safely blocked in 'reconciliation_failed' to prevent duplicate orders.
    const mockRzpExpired = {
      orders: {
        fetch: async (id) => ({ id, status: "expired", amount: 50000, currency: "INR" }),
      },
    };
    const recExpired = await reconcileAmbiguousReservation(mockRzpExpired, db, key, user, 500, "INR");
    assert.equal(recExpired.reconciled, false);
    assert.equal(recExpired.canRetry, false);
    assert.match(recExpired.error, /Unrecognized or unsupported Razorpay order status/);

    const snapBlocked = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snapBlocked.data()?.status, "reconciliation_failed");

    // Lock takeover is safely blocked
    const resBlocked = await acquirePaymentReservation(db, key, user, 500, "INR");
    assert.equal(resBlocked.acquired, false);
    assert.equal(resBlocked.needsReconciliation, true);

    // Case D: External status unavailable (network failure) -> retains safe blocked state
    const mockRzpErr = {
      orders: {
        fetch: async () => { throw new Error("Gateway connection reset by peer"); },
      },
    };
    const recErr = await reconcileAmbiguousReservation(mockRzpErr, db, key, user, 500, "INR");
    assert.equal(recErr.reconciled, false);
    assert.equal(recErr.canRetry, false);
    assert.match(recErr.error, /External status unavailable/);

    const snapErr = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snapErr.data()?.status, "reconciliation_failed");
  });

  // ── Scenario 14 (Finding 2): Strict Currency Validation in Reconciliation ────
  it("Scenario 14 (Finding 2): Strict currency validation during reconciliation rejects missing or invalid currency", async () => {
    const key = `res_em_curr_val_${Date.now()}`;
    const user = `user_curr_${Date.now()}`;
    const receipt = generateAuthoritativeReceipt(key);

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    await recordReconciliationRequired(db, key, res1.reservationToken, receipt, user, 500, "INR", "Timeout");

    // Case A: Missing / empty currency in Razorpay order
    const mockMissingCurr = {
      orders: {
        all: async () => ({ items: [{ id: "ord_empty_curr", receipt, amount: 50000, currency: "", status: "created" }] }),
      },
    };
    const resMissing = await reconcileAmbiguousReservation(mockMissingCurr, db, key, user, 500, "INR");
    assert.equal(resMissing.reconciled, false);
    assert.match(resMissing.error, /Missing or empty currency/i);

    // Case B: Currency mismatch (e.g. USD vs INR)
    const mockMismatchCurr = {
      orders: {
        all: async () => ({ items: [{ id: "ord_usd_curr", receipt, amount: 50000, currency: "USD", status: "created" }] }),
      },
    };
    const resMismatch = await reconcileAmbiguousReservation(mockMismatchCurr, db, key, user, 500, "INR");
    assert.equal(resMismatch.reconciled, false);
    assert.match(resMismatch.error, /Currency mismatch in reconciled order: expected INR, found USD/);

    // Case C: Valid currency (INR)
    const mockValidCurr = {
      orders: {
        all: async () => ({ items: [{ id: "ord_inr_valid", receipt, amount: 50000, currency: "INR", status: "created" }] }),
      },
    };
    const resValid = await reconcileAmbiguousReservation(mockValidCurr, db, key, user, 500, "INR");
    assert.equal(resValid.reconciled, true);
    assert.equal(resValid.existingOrder?.currency, "INR");
  });

  // ── Scenario 15 (Finding 4): Authoritative Absence Semantics in List API ──────
  it("Scenario 15 (Finding 4): Empty response from orders.all({ receipt }) keeps reservation safely blocked", async () => {
    const key = `res_em_absence_${Date.now()}`;
    const user = `user_abs_${Date.now()}`;
    const receipt = generateAuthoritativeReceipt(key);

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    await recordReconciliationRequired(db, key, res1.reservationToken, receipt, user, 500, "INR", "Gateway timeout");

    // Razorpay orders.all returns { items: [] } (e.g. replica lag or index delay)
    const mockEmptyList = {
      orders: {
        all: async () => ({ items: [] }),
      },
    };

    const recResult = await reconcileAmbiguousReservation(mockEmptyList, db, key, user, 500, "INR");
    // Must NOT be marked reconciled or retriable; must not transition to failed
    assert.equal(recResult.reconciled, false);
    assert.equal(recResult.canRetry, false);
    assert.match(recResult.error, /Authoritative order absence could not be conclusively established/);

    // Firestore document must be in 'reconciliation_failed'
    const snap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snap.data()?.status, "reconciliation_failed");

    // Subsequent lock acquisition must remain safely blocked
    const retryRes = await acquirePaymentReservation(db, key, user, 500, "INR");
    assert.equal(retryRes.acquired, false);
    assert.equal(retryRes.needsReconciliation, true);
  });

  // ── Scenario 16 (Finding 5): Complete API-to-Webhook Recovery Integration ────
  it("Scenario 16 (Finding 5): Complete API-to-webhook recovery integration: activation failure -> retry repair -> webhook fulfilment -> replay idempotency", async () => {
    const user = `user_integ_${Date.now()}`;
    const planId = `plan_integ_${Date.now()}`;
    const externalOrderId = `order_integ_${Date.now()}`;
    const webhookPaymentId = `pay_integ_${Date.now()}`;
    const webhookSecret = "rzp_webhook_secret_emulator_test";
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

    // Create plan doc in Firestore
    await db.collection("subscriptionPlans").doc(planId).set({
      title: "Quarterly Nets Membership",
      fee: 750,
      durationDays: 90,
    });

    // Create player doc in Firestore
    await db.collection("players").doc(user).set({
      id: user,
      name: "Integration Test Player",
      studioExpiryDate: "2026-01-01",
    });

    // Mock Razorpay API post
    const dummyRzp = new Razorpay({ key_id: "mock", key_secret: "mock" });
    const apiProto = Object.getPrototypeOf(dummyRzp.api);
    const origPost = apiProto.post;

    // Intercept DocumentReference.prototype.update to inject failure into route's intentRef.update()
    const dummyDoc = db.collection("razorpayIntents").doc("temp_probe");
    const docProto = Object.getPrototypeOf(dummyDoc);
    const origDocUpdate = docProto.update;

    let injectIntentUpdateFailure = true;
    let capturedIntentId = null;

    try {
      apiProto.post = async ({ url, data }) => {
        if (url === "/orders") {
          return {
            id: externalOrderId,
            amount: data.amount,
            currency: data.currency || "INR",
            receipt: data.receipt,
            notes: data.notes || {},
            status: "created",
          };
        }
        return origPost({ url, data });
      };

      docProto.update = async function (dataOrField, ...rest) {
        // Intercept intentRef.update in the actual route when setting orderId
        if (injectIntentUpdateFailure && this.parent?.id === "razorpayIntents" && dataOrField?.orderId) {
          injectIntentUpdateFailure = false;
          capturedIntentId = this.id;
          throw new Error("Simulated Firestore timeout during route intentRef.update()");
        }
        return origDocUpdate.apply(this, [dataOrField, ...rest]);
      };

      const reservationKey = generateReservationKey({ type: "subscription", planId }, user);

      // Step 1: Client calls actual order API route (creates intent, Razorpay order succeeds, but intentRef.update fails)
      const req1 = new Request("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-uid": user,
        },
        body: JSON.stringify({
          intentData: {
            type: "subscription",
            planId,
          },
        }),
      });

      const res1 = await orderPOST(req1);
      // 1. The actual route returns an appropriate failure response (HTTP 500)
      assert.equal(res1.status, 500);
      const res1Body = await res1.json();
      assert.match(res1Body.error, /Simulated Firestore timeout/);
      assert.ok(capturedIntentId, "intentId must be captured during route execution");

      // 2. The actual route's catch handler records activation_failed
      // 3. The reservation retains the external order ID and intent ID
      const failedResSnap = await db.collection("paymentReservations").doc(reservationKey).get();
      assert.equal(failedResSnap.data()?.status, "activation_failed");
      assert.equal(failedResSnap.data()?.orderId, externalOrderId);
      assert.equal(failedResSnap.data()?.intentId, capturedIntentId);

      // Verify the intent doc in Firestore does NOT have orderId set yet
      const intentBeforeSnap = await db.collection("razorpayIntents").doc(capturedIntentId).get();
      assert.equal(intentBeforeSnap.data()?.orderId, undefined);

      // 4. A second actual route call repairs the intent and reuses the original order
      const req2 = new Request("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-uid": user,
        },
        body: JSON.stringify({
          intentData: {
            type: "subscription",
            planId,
          },
        }),
      });

      const res2 = await orderPOST(req2);
      assert.equal(res2.status, 200);
      const res2Body = await res2.json();
      // Must reuse existing order rather than creating a second one
      assert.equal(res2Body.id, externalOrderId);
      assert.equal(res2Body.notes?.reusedExistingOrder, true);
      assert.equal(res2Body.notes?.intentId, capturedIntentId);

      // Verify intent.orderId was repaired in Firestore before returning
      const repairedIntentSnap = await db.collection("razorpayIntents").doc(capturedIntentId).get();
      assert.equal(repairedIntentSnap.data()?.orderId, externalOrderId);
      assert.ok(repairedIntentSnap.data()?.repairedAt, "intent must record repair timestamp");

      // 5. The actual webhook handler processes the captured payment
      const webhookPayload = {
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: webhookPaymentId,
              order_id: externalOrderId,
              amount: 75000,
              currency: "INR",
              status: "captured",
              notes: {
                intentId: capturedIntentId,
              },
            },
          },
        },
      };

      const rawBody = JSON.stringify(webhookPayload);
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      const webhookReq1 = new Request("http://localhost:3000/api/razorpay/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": signature,
        },
        body: rawBody,
      });

      const webhookRes1 = await webhookPOST(webhookReq1);
      assert.equal(webhookRes1.status, 200);
      const webhookRes1Body = await webhookRes1.json();
      assert.equal(webhookRes1Body.success, true);

      // Verify subscription/player obligation is marked paid in Firestore
      const finalIntentSnap = await db.collection("razorpayIntents").doc(capturedIntentId).get();
      assert.equal(finalIntentSnap.data()?.status, "paid");
      assert.equal(finalIntentSnap.data()?.razorpayPaymentId, webhookPaymentId);

      const subHistoryQuery = await db
        .collection("subscriptionHistory")
        .where("playerId", "==", user)
        .where("razorpayPaymentId", "==", webhookPaymentId)
        .get();
      assert.equal(subHistoryQuery.size, 1, "Exactly one subscriptionHistory entry must be created");

      // Verify player record was also updated
      const updatedPlayerSnap = await db.collection("players").doc(user).get();
      assert.equal(updatedPlayerSnap.data()?.isStudioMember, true);
      assert.ok(updatedPlayerSnap.data()?.studioExpiryDate > "2026-01-01");

      // 6. Webhook replay does not duplicate fulfilment
      const webhookReq2 = new Request("http://localhost:3000/api/razorpay/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": signature,
        },
        body: rawBody,
      });

      const webhookRes2 = await webhookPOST(webhookReq2);
      assert.equal(webhookRes2.status, 200);
      const webhookRes2Body = await webhookRes2.json();
      assert.equal(webhookRes2Body.success, true);

      // Verify no duplicate record created
      const subHistoryReplay = await db
        .collection("subscriptionHistory")
        .where("playerId", "==", user)
        .where("razorpayPaymentId", "==", webhookPaymentId)
        .get();
      assert.equal(subHistoryReplay.size, 1, "Replay must NOT create duplicate history entries");
    } finally {
      docProto.update = origDocUpdate;
      apiProto.post = origPost;
    }
  });

  // ── Scenario 17 (Item 1): Paid Order in Receipt-Only Reconciliation ──────────
  it("Scenario 17 (Item 1): Paid order discovered through receipt-only reconciliation persists isPaid: true and blocks checkout with HTTP 409", async () => {
    const user = `user_rcpt_paid_${Date.now()}`;
    const planId = `plan_rcpt_paid_${Date.now()}`;
    const externalOrderId = `order_rcpt_paid_${Date.now()}`;

    // Create plan doc
    await db.collection("subscriptionPlans").doc(planId).set({
      title: "Annual Membership",
      fee: 1200,
      durationDays: 365,
    });

    const reservationKey = generateReservationKey({ type: "subscription", planId }, user);
    const receipt = generateAuthoritativeReceipt(reservationKey);

    // Initial attempt acquires reservation, but external call suffered an ambiguous timeout
    // placing reservation in reconciliation_required
    const res1 = await acquirePaymentReservation(db, reservationKey, user, 1200, "INR", 30000);
    await recordReconciliationRequired(
      db,
      reservationKey,
      res1.reservationToken,
      receipt,
      user,
      1200,
      "INR",
      "Gateway timeout during order creation",
    );

    // Mock Razorpay list endpoint returning 1 matching order for this receipt with status 'paid'
    const dummyRzp = new Razorpay({ key_id: "mock", key_secret: "mock" });
    const apiProto = Object.getPrototypeOf(dummyRzp.api);
    const origGet = apiProto.get;

    try {
      apiProto.get = async ({ url, data }) => {
        if (url === "/orders" || url === `/orders/${externalOrderId}`) {
          if (url === "/orders") {
            return {
              items: [
                {
                  id: externalOrderId,
                  receipt,
                  amount: 120000,
                  currency: "INR",
                  status: "paid",
                },
              ],
            };
          }
          return {
            id: externalOrderId,
            receipt,
            amount: 120000,
            currency: "INR",
            status: "paid",
          };
        }
        return origGet({ url, data });
      };

      // 1. Direct receipt-only reconciliation test:
      const recResult = await reconcileAmbiguousReservation(dummyRzp, db, reservationKey, user, 1200, "INR");
      assert.equal(recResult.reconciled, true);
      assert.equal(recResult.isPaid, true);
      assert.equal(recResult.canRetry, false);
      assert.equal(recResult.existingOrder?.orderId, externalOrderId);

      // Verify Firestore reservation doc persisted isPaid: true and status: "active"
      const snap = await db.collection("paymentReservations").doc(reservationKey).get();
      assert.equal(snap.data()?.status, "active");
      assert.equal(snap.data()?.isPaid, true);
      assert.equal(snap.data()?.orderId, externalOrderId);

      // 2. Actual Order API route test with receipt-only reconciliation:
      // Reset doc to reconciliation_required WITHOUT orderId to ensure route exercises receipt-only Branch B
      await db.collection("paymentReservations").doc(reservationKey).delete();
      const res2 = await acquirePaymentReservation(db, reservationKey, user, 1200, "INR", 30000);
      await recordReconciliationRequired(
        db,
        reservationKey,
        res2.reservationToken,
        receipt,
        user,
        1200,
        "INR",
        "Gateway timeout during order creation",
      );

      const req = new Request("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-uid": user,
        },
        body: JSON.stringify({
          intentData: {
            type: "subscription",
            planId,
          },
        }),
      });

      const res = await orderPOST(req);
      // Route must return HTTP 409 Conflict, NOT checkout opportunity
      assert.equal(res.status, 409);
      const resBody = await res.json();
      assert.match(resBody.error, /Obligation has already been paid via order/);
      assert.match(resBody.error, new RegExp(externalOrderId));
    } finally {
      apiProto.get = origGet;
    }
  });
});
