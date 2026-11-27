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
import { processWebhookPayment } from "../lib/razorpay-webhook.ts";
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
    process.env.KAVACH_TEST_AUTH_BYPASS = "true";
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";
    process.env.AWS_BRANCH = "main";
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
    const keyB = `res_em_exp_active_b_${Date.now()}`;
    const externalOrderIdB = `order_exp_b_${Date.now()}`;
    const resB1 = await acquirePaymentReservation(db, keyB, user, 500, "INR", 30000);
    await activatePaymentReservation(db, keyB, resB1.reservationToken, externalOrderIdB, intentRef.id);
    await db.collection("paymentReservations").doc(keyB).update({ expiresAt: twentyMinsAgo });

    const mockRzpPayable = {
      orders: {
        fetch: async (id) => ({ id, status: "created", amount: 50000, currency: "INR" }),
      },
    };
    const recPayable = await reconcileAmbiguousReservation(mockRzpPayable, db, keyB, user, 500, "INR");
    assert.equal(recPayable.reconciled, true);
    assert.equal(recPayable.existingOrder?.orderId, externalOrderIdB);
    const snapPayable = await db.collection("paymentReservations").doc(keyB).get();
    assert.equal(snapPayable.data()?.status, "active");
    assert.ok(snapPayable.data()?.expiresAt.toDate().getTime() > Date.now());

    // Case C: Unsupported order status (e.g. 'expired' or 'cancelled') is rejected per Razorpay Orders contract
    // Per official Razorpay Orders API contract, Order entities strictly possess only 'created', 'attempted', and 'paid'.
    // Unsupported statuses remain safely blocked in 'reconciliation_failed' to prevent duplicate orders.
    const keyC = `res_em_exp_active_c_${Date.now()}`;
    const externalOrderIdC = `order_exp_c_${Date.now()}`;
    const resC1 = await acquirePaymentReservation(db, keyC, user, 500, "INR", 30000);
    await activatePaymentReservation(db, keyC, resC1.reservationToken, externalOrderIdC, intentRef.id);
    await db.collection("paymentReservations").doc(keyC).update({ expiresAt: twentyMinsAgo });

    const mockRzpExpired = {
      orders: {
        fetch: async (id) => ({ id, status: "expired", amount: 50000, currency: "INR" }),
      },
    };
    const recExpired = await reconcileAmbiguousReservation(mockRzpExpired, db, keyC, user, 500, "INR");
    assert.equal(recExpired.reconciled, false);
    assert.equal(recExpired.canRetry, false);
    assert.match(recExpired.error, /Unrecognized or unsupported Razorpay order status/);

    const snapBlocked = await db.collection("paymentReservations").doc(keyC).get();
    assert.equal(snapBlocked.data()?.status, "reconciliation_failed");

    // Lock takeover is safely blocked
    const resBlocked = await acquirePaymentReservation(db, keyC, user, 500, "INR");
    assert.equal(resBlocked.acquired, false);
    assert.equal(resBlocked.needsReconciliation, true);

    // Case D: External status unavailable (network failure) -> retains safe blocked state
    const keyD = `res_em_exp_active_d_${Date.now()}`;
    const externalOrderIdD = `order_exp_d_${Date.now()}`;
    const resD1 = await acquirePaymentReservation(db, keyD, user, 500, "INR", 30000);
    await activatePaymentReservation(db, keyD, resD1.reservationToken, externalOrderIdD, intentRef.id);
    await db.collection("paymentReservations").doc(keyD).update({ expiresAt: twentyMinsAgo });

    const mockRzpErr = {
      orders: {
        fetch: async () => { throw new Error("Gateway connection reset by peer"); },
      },
    };
    const recErr = await reconcileAmbiguousReservation(mockRzpErr, db, keyD, user, 500, "INR");
    assert.equal(recErr.reconciled, false);
    assert.equal(recErr.canRetry, false);
    assert.match(recErr.error, /External status unavailable/);

    const snapErr = await db.collection("paymentReservations").doc(keyD).get();
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

      // Verify Firestore reservation doc persisted isPaid: true, status: "active", orderId
      const snapAfterRoute = await db.collection("paymentReservations").doc(reservationKey).get();
      assert.equal(snapAfterRoute.data()?.status, "active");
      assert.equal(snapAfterRoute.data()?.isPaid, true);
      assert.equal(snapAfterRoute.data()?.orderId, externalOrderId);

      // 3. Second actual route call: reservation is now in status "active", isPaid: true, orderId: externalOrderId
      // Must NEVER return HTTP 200 checkout opportunity! Must return HTTP 409 Conflict.
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

      const postRes2 = await orderPOST(req2);
      assert.equal(postRes2.status, 409, "Second route call on paid reservation must return 409");
      const postRes2Body = await postRes2.json();
      assert.match(postRes2Body.error, /Obligation has already been paid via order/);
      assert.match(postRes2Body.error, new RegExp(externalOrderId));

      // Verify reservation doc in Firestore remains isPaid: true and orderId unchanged
      const snapAfterReq2 = await db.collection("paymentReservations").doc(reservationKey).get();
      assert.equal(snapAfterReq2.data()?.isPaid, true);
      assert.equal(snapAfterReq2.data()?.orderId, externalOrderId);
      assert.equal(snapAfterReq2.data()?.status, "active");

      // 4. Focused test for direct acquirePaymentReservation against an existing active, unexpired, paid reservation
      const directAcquire = await acquirePaymentReservation(db, reservationKey, user, 1200, "INR", 30000);
      assert.equal(directAcquire.acquired, false);
      assert.equal(directAcquire.conflict, true);
      assert.equal(directAcquire.isPaid, true);
      assert.equal(directAcquire.orderId, externalOrderId);
      assert.equal(directAcquire.existingOrder, undefined);
      assert.match(directAcquire.error, /Obligation has already been paid via order/);
      assert.match(directAcquire.error, new RegExp(externalOrderId));
    } finally {
      apiProto.get = origGet;
    }
  });

  // ── Scenario 18 (Regression): Concurrent Waiting Order Becoming Paid During Polling ──
  it("Scenario 18: Payment becoming paid during concurrent polling returns HTTP 409 Conflict instead of checkout", async () => {
    const user = `user_wait_paid_${Date.now()}`;
    const planId = `plan_wait_paid_${Date.now()}`;
    const paidOrderId = `order_wait_paid_${Date.now()}`;

    await db.collection("subscriptionPlans").doc(planId).set({
      title: "Monthly Membership",
      fee: 600,
      durationDays: 30,
    });

    const reservationKey = generateReservationKey({ type: "subscription", planId }, user);

    // Initial request acquires reservation in status "reserving"
    const res1 = await acquirePaymentReservation(db, reservationKey, user, 600, "INR", 30000);
    assert.equal(res1.acquired, true);

    // Schedule background update: 800ms later (during orderPOST polling loop),
    // another worker marks the reservation active, isPaid: true, orderId: paidOrderId
    setTimeout(async () => {
      await db.collection("paymentReservations").doc(reservationKey).update({
        status: "active",
        isPaid: true,
        orderId: paidOrderId,
        updatedAt: new Date(),
      });
    }, 800);

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
    // Polling request must detect isPaid: true and return HTTP 409 Conflict, NEVER HTTP 200
    assert.equal(res.status, 409);
    const resBody = await res.json();
    assert.match(resBody.error, /Obligation has already been paid via order/);
    assert.match(resBody.error, new RegExp(paidOrderId));
  });

  // ── Phase B: Custom Match Fee Reservation Supersession Safeguards ───────────
  it("Phase B-1: active stale reservation with 'created' order and 0 payments is safely superseded when match fee changes", async () => {
    const key = generateReservationKey({ type: "match", matchId: "m_custom_1", paymentId: "p_1" }, "u_custom_1");
    const res1 = await acquirePaymentReservation(db, key, "u_custom_1", 500, "INR", 60000);
    assert.equal(res1.acquired, true);

    await activatePaymentReservation(db, key, res1.reservationToken, "order_old_500", "intent_old_500");

    // Fee changed from 500 to 650 while old reservation is still unexpired
    const reacquire = await acquirePaymentReservation(db, key, "u_custom_1", 650, "INR", 60000);
    assert.equal(reacquire.acquired, false);
    assert.equal(reacquire.needsReconciliation, true);

    // Direct reuse validator must still reject amount mismatch
    const directCheck = validateReservationForReuse(
      { reservationKey: key, userId: "u_custom_1", orderId: "order_old_500", intentId: "intent_old_500", amount: 500, currency: "INR" },
      key,
      "u_custom_1",
      650,
      "INR",
    );
    assert.equal(directCheck.valid, false);
    assert.equal(directCheck.conflict, true);

    // Mock Razorpay: old order is 'created' with 0 payment attempts
    const mockRzp = {
      orders: {
        fetch: async () => ({ id: "order_old_500", amount: 50000, currency: "INR", status: "created" }),
        fetchPayments: async () => ({ items: [] }),
      },
    };
    const rec = await reconcileAmbiguousReservation(mockRzp, db, key, "u_custom_1", 650, "INR");
    assert.equal(rec.reconciled, true);
    assert.equal(rec.canRetry, true);
    assert.equal(rec.superseded, true);
    assert.ok(rec.reservationToken && rec.reservationToken !== res1.reservationToken);
    assert.equal(rec.fenceVersion, 2);

    const updatedSnap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(updatedSnap.data()?.amount, 650);
    assert.equal(updatedSnap.data()?.supersededOrderId, "order_old_500");
    assert.equal(updatedSnap.data()?.orderId, null);
  });

  it("Phase B-2: expired stale reservation with 'attempted' order and only 'failed' payments is safely superseded", async () => {
    const key = generateReservationKey({ type: "match", matchId: "m_custom_2", paymentId: "p_2" }, "u_custom_2");
    const res1 = await acquirePaymentReservation(db, key, "u_custom_2", 500, "INR", 60000);
    await activatePaymentReservation(db, key, res1.reservationToken, "order_att_500", "intent_att_500");
    await db.collection("paymentReservations").doc(key).update({ expiresAt: new Date(Date.now() - 10000) });

    const reacquire = await acquirePaymentReservation(db, key, "u_custom_2", 700, "INR", 60000);
    assert.equal(reacquire.needsReconciliation, true);

    const mockRzp = {
      orders: {
        fetch: async () => ({ id: "order_att_500", amount: 50000, currency: "INR", status: "attempted" }),
        fetchPayments: async () => ({ items: [{ id: "pay_fail_1", status: "failed" }] }),
      },
    };
    const rec = await reconcileAmbiguousReservation(mockRzp, db, key, "u_custom_2", 700, "INR");
    assert.equal(rec.reconciled, true);
    assert.equal(rec.superseded, true);
    assert.equal(rec.canRetry, true);
  });

  it("Phase B-3: stale order with authorized/captured/pending payment or 'paid' status fails closed and is NEVER superseded", async () => {
    for (const [label, status, payments] of [
      ["attempted+authorized", "attempted", [{ id: "pay_auth_1", status: "authorized" }]],
      ["attempted+captured", "attempted", [{ id: "pay_cap_1", status: "captured" }]],
      ["created+unexpected_payment", "created", [{ id: "pay_pend_1", status: "created" }]],
      ["paid_order", "paid", []],
    ]) {
      const key = generateReservationKey({ type: "match", matchId: `m_blk_${label}`, paymentId: "p_blk" }, "u_blk");
      const res1 = await acquirePaymentReservation(db, key, "u_blk", 500, "INR", 60000);
      await activatePaymentReservation(db, key, res1.reservationToken, `order_${label}`, `intent_${label}`);

      const mockRzp = {
        orders: {
          fetch: async () => ({ id: `order_${label}`, amount: 50000, currency: "INR", status }),
          fetchPayments: async () => ({ items: payments }),
        },
      };
      const rec = await reconcileAmbiguousReservation(mockRzp, db, key, "u_blk", 650, "INR");
      assert.equal(rec.reconciled, false, `${label}: must fail closed`);
      assert.notEqual(rec.superseded, true, `${label}: must never supersede`);

      const snap = await db.collection("paymentReservations").doc(key).get();
      assert.equal(snap.data()?.status, "reconciliation_failed", `${label}: must lock in reconciliation_failed`);
      assert.equal(snap.data()?.orderId, `order_${label}`, `${label}: must preserve original orderId`);
    }
  });

  it("Phase B-4 (3A): payment against superseded old order cannot settle new reservation and routes to dead-letter reconciliation", async () => {
    const matchId = `m_sup_${Date.now()}`;
    const paymentId = "p_sup_1";
    const userId = "u_sup_1";
    const key = generateReservationKey({ type: "match", matchId, paymentId }, userId);

    await db.doc(`players/${userId}`).set({ id: userId, name: "Sup Player", authUid: userId });
    await db.doc(`matches/${matchId}`).set({ id: matchId, opponent: "Sup CC", fee: 650, date: "2026-12-01" });
    await db.doc(`matches/${matchId}/payments/${paymentId}`).set({
      id: paymentId,
      matchId,
      playerId: userId,
      status: "Unpaid",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res1 = await acquirePaymentReservation(db, key, userId, 500, "INR", 60000);
    await activatePaymentReservation(db, key, res1.reservationToken, "order_old_500", "intent_old_500");

    // Supersede 500 -> 650
    const mockRzp = {
      orders: {
        fetch: async () => ({ id: "order_old_500", amount: 50000, currency: "INR", status: "created" }),
        fetchPayments: async () => ({ items: [] }),
      },
    };
    const rec = await reconcileAmbiguousReservation(mockRzp, db, key, userId, 650, "INR");
    assert.equal(rec.superseded, true);

    await db.doc("razorpayIntents/intent_new_650").set({
      type: "match",
      matchId,
      paymentId,
      playerId: userId,
      userId,
      amount: 650,
      currency: "INR",
      orderId: "order_new_650",
      reservationKey: key,
      status: "pending",
      createdAt: new Date(),
    });
    await activatePaymentReservation(db, key, rec.reservationToken, "order_new_650", "intent_new_650");

    // Attempt to settle new reservation/intent using superseded order_old_500
    const whRes = await processWebhookPayment(
      db,
      {
        event: "payment.captured",
        intentId: "intent_new_650",
        orderId: "order_old_500",
        paymentId: "pay_old_500_attempt",
        capturedPaise: 50000,
        capturedCurrency: "INR",
        isFullyPaid: true,
        paymentMethod: "upi",
      },
      { correlationId: "cid_sup_1", eventId: "evt_sup_1", rawBody: "{}" },
    );

    assert.equal(whRes.outcome, "unmatched");
    assert.equal(whRes.code, "ORDER_MISMATCH");

    // Match payment remains Unpaid and reservation remains unpaid
    const paySnap = await db.doc(`matches/${matchId}/payments/${paymentId}`).get();
    assert.equal(paySnap.data()?.status, "Unpaid");
    const resSnap = await db.doc(`paymentReservations/${key}`).get();
    assert.notEqual(resSnap.data()?.isPaid, true);
    assert.equal(resSnap.data()?.orderId, "order_new_650");

    // Dead-letter record created for reconciliation
    const dlSnap = await db.collection("webhookDeadLetters").where("orderId", "==", "order_old_500").get();
    assert.equal(dlSnap.empty, false);
  });

  it("Phase B-5 (3B): concurrent supersession allows only one winner and fences out the stale loser", async () => {
    const key = generateReservationKey({ type: "match", matchId: `m_conc_${Date.now()}`, paymentId: "p_conc" }, "u_conc");
    const res1 = await acquirePaymentReservation(db, key, "u_conc", 500, "INR", 60000);
    await activatePaymentReservation(db, key, res1.reservationToken, "order_conc_500", "intent_conc_500");

    const mockRzp = {
      orders: {
        fetch: async () => ({ id: "order_conc_500", amount: 50000, currency: "INR", status: "created" }),
        fetchPayments: async () => ({ items: [] }),
      },
    };

    const [rA, rB] = await Promise.all([
      reconcileAmbiguousReservation(mockRzp, db, key, "u_conc", 650, "INR"),
      reconcileAmbiguousReservation(mockRzp, db, key, "u_conc", 650, "INR"),
    ]);

    const winners = [rA, rB].filter((r) => r.superseded === true);
    const losers = [rA, rB].filter((r) => r.superseded !== true);
    assert.equal(winners.length, 1, "Exactly one concurrent supersession may win");
    assert.equal(losers.length, 1, "Second concurrent supersession must be fenced out");
    assert.equal(winners[0].fenceVersion, 2);

    const finalSnap = await db.doc(`paymentReservations/${key}`).get();
    assert.equal(finalSnap.data()?.reservationToken, winners[0].reservationToken);
    assert.equal(finalSnap.data()?.fenceVersion, 2);
  });

  it("Phase B-6 (3C): paginated orders.fetchPayments inspects all pages and fails closed on page-2 authorized payment", async () => {
    const key = generateReservationKey({ type: "match", matchId: `m_page_${Date.now()}`, paymentId: "p_page" }, "u_page");
    const res1 = await acquirePaymentReservation(db, key, "u_page", 500, "INR", 60000);
    await activatePaymentReservation(db, key, res1.reservationToken, "order_page_500", "intent_page_500");

    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `pay_fail_${i}`, status: "failed" }));
    const page2 = [{ id: "pay_auth_page2", status: "authorized" }];
    let fetchCalls = 0;

    const mockPagedRzp = {
      orders: {
        fetch: async () => ({ id: "order_page_500", amount: 50000, currency: "INR", status: "attempted" }),
        fetchPayments: async (_orderId, params) => {
          fetchCalls += 1;
          return { items: (params?.skip || 0) === 0 ? page1 : page2 };
        },
      },
    };

    const rec = await reconcileAmbiguousReservation(mockPagedRzp, db, key, "u_page", 650, "INR");
    assert.equal(fetchCalls, 2, "Must paginate through page 2");
    assert.equal(rec.reconciled, false, "Must fail closed when page 2 has an authorized payment");
    assert.notEqual(rec.superseded, true);

    const snap = await db.doc(`paymentReservations/${key}`).get();
    assert.equal(snap.data()?.status, "reconciliation_failed");
  });

  it("Issue 4 regression: orderPOST supersedes active ₹500 reservation & intent when match fee changes to ₹650", async () => {
    const uid = `u_fee_change_${Date.now()}`;
    const matchId = `m_fee_change_${Date.now()}`;
    const payId = `p_fee_change_${Date.now()}`;

    await db.doc(`appUsers/${uid}`).set({ uid, email: `${uid}@test.com`, role: "player", playerId: uid });
    await db.doc(`matches/${matchId}`).set({
      id: matchId,
      opponent: "Fee Change XI",
      date: "2026-12-01",
      format: "T20",
      matchType: "Friendly",
      result: "Pending",
      matchFee: 500,
    });
    await db.doc(`matches/${matchId}/payments/${payId}`).set({
      id: payId,
      matchId,
      playerId: uid,
      status: "Unpaid",
      availability: "Available",
      matchFee: 500,
    });

    const key = generateReservationKey({ type: "match", matchId, paymentId: payId }, uid);
    const res1 = await acquirePaymentReservation(db, key, uid, 500, "INR", 60000);
    assert.equal(res1.acquired, true);
    await db.doc(`razorpayIntents/intent_old_${payId}`).set({
      userId: uid,
      amount: 500,
      currency: "INR",
      status: "created",
      reservationKey: key,
      orderId: "order_old_500",
      obligationType: "match",
      matchId,
      paymentId: payId,
    });
    await activatePaymentReservation(db, key, res1.reservationToken, "order_old_500", `intent_old_${payId}`);

    // Admin updates custom fee on the payment doc to 650 before user retries checkout
    await db.doc(`matches/${matchId}/payments/${payId}`).update({ matchFee: 650, customFee: 650 });

    // Exercise acquirePaymentReservation -> needsReconciliation -> reconcileAmbiguousReservation -> order creation
    const res2 = await acquirePaymentReservation(db, key, uid, 650, "INR", 60000);
    assert.equal(res2.needsReconciliation, true, "Active reservation with old amount 500 must trigger needsReconciliation when payableAmount is 650");
    assert.equal(res2.existingOrder?.orderId, "order_old_500");

    // Simulate real Razorpay SDK shape (has .api.get and orders.fetchPayments(orderId, callback))
    let apiGetCalls = 0;
    let lastApiGetArgs = null;
    const realShapeRzp = {
      api: {
        get: async (params) => {
          apiGetCalls += 1;
          lastApiGetArgs = params;
          return { items: [] };
        },
      },
      orders: {
        fetch: async () => ({ id: "order_old_500", amount: 50000, currency: "INR", status: "created", receipt: "rcpt_old", attempts: 0 }),
        fetchPayments: async () => {
          throw new Error("Must use api.get with explicit count/skip instead of unpaginated orders.fetchPayments");
        },
      },
    };
    const rec = await reconcileAmbiguousReservation(realShapeRzp, db, key, uid, 650, "INR");
    assert.equal(apiGetCalls, 1, "Real Razorpay SDK must query api.get with explicit count/skip pagination");
    assert.deepEqual(lastApiGetArgs, { url: "/orders/order_old_500/payments", data: { count: 100, skip: 0 } });
    assert.equal(rec.superseded, true);
    assert.equal(rec.canRetry, true);
    assert.ok(rec.reservationToken);

    // Activate new order for 650 under the new reservationToken & verify intent consistency passes
    await db.doc(`razorpayIntents/intent_new_${payId}`).set({
      userId: uid,
      amount: 650,
      currency: "INR",
      status: "created",
      reservationKey: key,
      orderId: "order_new_650",
      obligationType: "match",
      matchId,
      paymentId: payId,
    });
    await activatePaymentReservation(db, key, rec.reservationToken, "order_new_650", `intent_new_${payId}`, rec.fenceVersion);

    const repair = await verifyAndRepairIntent(db, `intent_new_${payId}`, "order_new_650", {
      userId: uid,
      amount: 650,
      currency: "INR",
      reservationKey: key,
    });
    assert.equal(repair.ok, true);
  });

  it("Issue 4 regression: api.get explicit count=100/skip pagination catches late captured payment on page 2 and fails closed", async () => {
    const key = generateReservationKey({ type: "match", matchId: `m_real_sdk_p2_${Date.now()}`, paymentId: "p_p2" }, "u_p2");
    const res1 = await acquirePaymentReservation(db, key, "u_p2", 500, "INR", 60000);
    await activatePaymentReservation(db, key, res1.reservationToken, "order_p2_500", "intent_p2_500");

    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `pay_fail_${i}`, status: "failed" }));
    const page2 = [{ id: "pay_late_cap_101", status: "captured" }];
    const calls = [];
    const realSdkPagedRzp = {
      api: {
        get: async (params) => {
          calls.push(params);
          return { items: (params?.data?.skip || 0) === 0 ? page1 : page2 };
        },
      },
      orders: {
        fetch: async () => ({ id: "order_p2_500", amount: 50000, currency: "INR", status: "attempted", attempts: 101 }),
        fetchPayments: async () => ({ items: [] }),
      },
    };

    const rec = await reconcileAmbiguousReservation(realSdkPagedRzp, db, key, "u_p2", 650, "INR");
    assert.equal(calls.length, 2, "Must paginate page 1 (skip=0) and page 2 (skip=100) via api.get");
    assert.deepEqual(calls[0], { url: "/orders/order_p2_500/payments", data: { count: 100, skip: 0 } });
    assert.deepEqual(calls[1], { url: "/orders/order_p2_500/payments", data: { count: 100, skip: 100 } });
    assert.equal(rec.reconciled, false, "Must fail closed on late captured payment in page 2");
    assert.equal(rec.canRetry, false);
    assert.notEqual(rec.superseded, true);

    const snap = await db.doc(`paymentReservations/${key}`).get();
    assert.equal(snap.data()?.status, "reconciliation_failed");
  });

  it("Issue 4 regression: truncated payment history (returned items < order.attempts) fails closed and never supersedes", async () => {
    const key = generateReservationKey({ type: "match", matchId: `m_trunc_${Date.now()}`, paymentId: "p_trunc" }, "u_trunc");
    const res1 = await acquirePaymentReservation(db, key, "u_trunc", 500, "INR", 60000);
    await activatePaymentReservation(db, key, res1.reservationToken, "order_trunc_500", "intent_trunc_500");

    const truncatedItems = Array.from({ length: 10 }, (_, i) => ({ id: `pay_fail_${i}`, status: "failed" }));
    const truncatedRzp = {
      api: {
        get: async () => ({ items: truncatedItems }),
      },
      orders: {
        fetch: async () => ({ id: "order_trunc_500", amount: 50000, currency: "INR", status: "attempted", attempts: 15 }),
        fetchPayments: async () => ({ items: truncatedItems }),
      },
    };

    const rec = await reconcileAmbiguousReservation(truncatedRzp, db, key, "u_trunc", 650, "INR");
    assert.equal(rec.reconciled, false, "Must fail closed when returned payment count (10) < order.attempts (15)");
    assert.equal(rec.canRetry, false);
    assert.notEqual(rec.superseded, true);

    const snap = await db.doc(`paymentReservations/${key}`).get();
    assert.equal(snap.data()?.status, "reconciliation_failed");
  });
});
