/**
 * FIN-001 Concurrent Order Creation & Atomic Reservation Tests
 * (tests/razorpay-concurrent-orders.test.mjs)
 *
 * Verifies:
 * 1. Deterministic reservation key generation:
 *    - Uses SHA-256 hash of canonical obligation data.
 *    - Eliminates invalid document paths and excessive lengths.
 *    - Guarantees identical keys when dues items are reordered.
 *    - Rejects invalid / non-idempotent obligation requests without timestamp fallback.
 * 2. Token-based fencing & lease strategy:
 *    - Two truly concurrent reservation attempts: only one acquires lock, the other waits.
 *    - Safe lease renewal allows owner to extend lease when processing takes longer.
 *    - Stale reservation owner is fenced out from activating or releasing a newer reservation.
 * 3. Ambiguous failure & reconciliation:
 *    - Ambiguous errors transition to 'reconciliation_required', never released blindly.
 *    - External reconciliation reuses order if found, or transitions to failed if confirmed nonexistent.
 * 4. Recovery after activation failure:
 *    - Activation failures propagate errors.
 *    - Reuses existing order on retry without creating a second Razorpay order.
 * 5. Strict validation:
 *    - Rejects reuse on amount changed, currency mismatch, or different user.
 * 6. Definitive failure & instant retry:
 *    - Releases reservation only on definitive 4xx failure where no external order could exist.
 *
 * Imports directly from production: @/lib/razorpay-order.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateReservationKey,
  acquirePaymentReservation,
  activatePaymentReservation,
  renewReservationLease,
  recordActivationFailure,
  recordReconciliationRequired,
  reconcileAmbiguousReservation,
  releasePaymentReservation,
  validateReservationForReuse,
  isAmbiguousRazorpayError,
  verifyAndRepairIntent,
} from "../lib/razorpay-order.ts";

// In-memory mock database with Firestore atomic transaction queue simulation
function createMockDb() {
  const store = new Map();
  let inTransaction = false;
  const queue = [];

  const processQueue = () => {
    if (inTransaction || queue.length === 0) return;
    inTransaction = true;
    const { fn, resolve, reject } = queue.shift();
    (async () => {
      try {
        const transaction = {
          get: async (ref) => ref.get(),
          set: (ref, val, options) => ref.set(val, options),
          update: (ref, val) => ref.update(val),
        };
        const result = await fn(transaction);
        resolve(result);
      } catch (e) {
        reject(e);
      } finally {
        inTransaction = false;
        processQueue();
      }
    })();
  };

  return {
    collection: (colName) => ({
      doc: (docId) => {
        const fullKey = `${colName}/${docId}`;
        return {
          id: docId,
          get: async () => {
            const data = store.get(fullKey);
            return {
              exists: !!data,
              data: () => (data ? { ...data } : undefined),
            };
          },
          set: async (val, options) => {
            if (options?.merge) {
              const existing = store.get(fullKey) || {};
              store.set(fullKey, { ...existing, ...val });
            } else {
              store.set(fullKey, { ...val });
            }
          },
          update: async (val) => {
            const existing = store.get(fullKey);
            if (!existing) throw new Error(`Document not found for update: ${fullKey}`);
            store.set(fullKey, { ...existing, ...val });
          },
        };
      },
    }),
    runTransaction: (fn) => {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        processQueue();
      });
    },
    _rawStore: store,
  };
}

describe("FIN-001: Concurrent Payment Initiation & Atomic Reservation", () => {
  // ── 1. Deterministic Reservation Keys ──────────────────────────────────────
  it("generates deterministic fixed-length hash reservation keys for match payments", () => {
    const intentData = { type: "match", matchId: "match_101", paymentId: "pay_202" };
    const key1 = generateReservationKey(intentData, "player_303");
    const key2 = generateReservationKey(intentData, "player_303");
    assert.match(key1, /^res_match_[a-f0-9]{32}$/);
    assert.equal(key1, key2);
  });

  it("generates deterministic reservation keys for finance_dues regardless of item order", () => {
    const items1 = [{ paymentId: "pay_B", type: "match", matchId: "m1" }, { paymentId: "pay_A", type: "match", matchId: "m2" }];
    const items2 = [{ paymentId: "pay_A", type: "match", matchId: "m2" }, { paymentId: "pay_B", type: "match", matchId: "m1" }];

    const key1 = generateReservationKey({ type: "finance_dues", items: items1 }, "player_303");
    const key2 = generateReservationKey({ type: "finance_dues", items: items2 }, "player_303");

    assert.match(key1, /^res_dues_[a-f0-9]{32}$/);
    assert.equal(key1, key2);
  });

  it("rejects invalid or empty obligation data without timestamp fallback", () => {
    assert.throws(
      () => generateReservationKey(null, "player_1"),
      /Missing or invalid payment intentData/,
    );
    assert.throws(
      () => generateReservationKey({ type: "match" }, "player_1"),
      /matchId and paymentId are required/,
    );
    assert.throws(
      () => generateReservationKey({ type: "finance_dues", items: [] }, "player_1"),
      /Cannot generate reservation key for empty finance dues/,
    );
    assert.throws(
      () => generateReservationKey({ type: "unknown_type" }, "player_1"),
      /Unsupported intent type/,
    );
  });

  // ── 2. Two Truly Concurrent Reservation Attempts ───────────────────────────
  it("two truly concurrent reservation attempts grant reservation to only ONE request with unique token", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_test_concurrency_1";
    const authUid = "user_abc";
    const payableAmount = 500;
    const currency = "INR";

    const [resA, resB] = await Promise.all([
      acquirePaymentReservation(mockDb, reservationKey, authUid, payableAmount, currency),
      acquirePaymentReservation(mockDb, reservationKey, authUid, payableAmount, currency),
    ]);

    const acquiredCount = [resA, resB].filter((r) => r.acquired === true).length;
    const waitingCount = [resA, resB].filter((r) => r.isWaiting === true).length;

    assert.equal(acquiredCount, 1, "Exactly one request must acquire the reservation lock");
    assert.equal(waitingCount, 1, "Concurrent request must receive isWaiting: true");

    const winner = resA.acquired ? resA : resB;
    assert.ok(winner.reservationToken, "Winner must receive unique reservationToken");
    assert.equal(winner.fenceVersion, 1, "Winner must receive fenceVersion 1");
  });

  // ── 3. Waiting Request Successfully Reusing Order ─────────────────────────
  it("waiting request successfully reuses the active Razorpay order once activated", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_test_reuse_1";
    const authUid = "user_abc";
    const payableAmount = 500;
    const currency = "INR";

    // Request 1 acquires reservation
    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, payableAmount, currency);
    assert.equal(res1.acquired, true);

    // Request 2 arrives concurrently and is told to wait
    const res2 = await acquirePaymentReservation(mockDb, reservationKey, authUid, payableAmount, currency);
    assert.equal(res2.isWaiting, true);

    // Request 1 completes order creation and activates reservation using its token
    await activatePaymentReservation(
      mockDb,
      reservationKey,
      res1.reservationToken,
      "order_razorpay_first_111",
      "intent_first_222",
    );

    // Request 2 rechecks and successfully reuses existing order
    const recheck = await acquirePaymentReservation(mockDb, reservationKey, authUid, payableAmount, currency);
    assert.equal(recheck.acquired, false);
    assert.ok(recheck.existingOrder);
    assert.equal(recheck.existingOrder.orderId, "order_razorpay_first_111");
    assert.equal(recheck.existingOrder.intentId, "intent_first_222");
    assert.equal(recheck.existingOrder.amount, 500);
  });

  // ── 4. Safe Lease Renewal ──────────────────────────────────────────────────
  it("allows legitimate lease owner to renew reservation lease", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_test_renew_1";
    const authUid = "user_abc";

    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR", 10000);
    assert.equal(res1.acquired, true);

    const renewal = await renewReservationLease(mockDb, reservationKey, res1.reservationToken, 45000);
    assert.equal(renewal.renewed, true);

    // Stale token cannot renew
    const badRenewal = await renewReservationLease(mockDb, reservationKey, "stale_token_xyz", 45000);
    assert.equal(badRenewal.renewed, false);
    assert.match(badRenewal.error, /Fencing conflict/);
  });

  // ── 5. Stale Reservation Owner Fenced Out ──────────────────────────────────
  it("stale reservation owner is fenced out from activating or releasing a newer reservation", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_test_fencing_1";
    const authUid = "user_abc";

    // Request 1 acquires reservation with 1ms TTL (immediately expired)
    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR", -1000);
    assert.equal(res1.acquired, true);

    // Request 2 arrives after lease expired and acquires fresh reservation with new fenceVersion
    const res2 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR", 60000);
    assert.equal(res2.acquired, true);
    assert.equal(res2.fenceVersion, 2);
    assert.notEqual(res1.reservationToken, res2.reservationToken);

    // Stale Request 1 now attempts to activate with its stale token: MUST BE REJECTED
    await assert.rejects(
      async () => {
        await activatePaymentReservation(
          mockDb,
          reservationKey,
          res1.reservationToken, // Stale token!
          "order_stale_999",
          "intent_stale_999",
        );
      },
      /Fencing conflict: reservation token mismatch/,
      "Stale token must be fenced out from activating reservation",
    );

    // Stale Request 1 now attempts to release: MUST BE REJECTED
    await assert.rejects(
      async () => {
        await releasePaymentReservation(
          mockDb,
          reservationKey,
          res1.reservationToken, // Stale token!
          "Stale error",
        );
      },
      /Fencing conflict: reservation token mismatch/,
      "Stale token must be fenced out from releasing reservation",
    );

    // Active Request 2 can activate normally
    await activatePaymentReservation(
      mockDb,
      reservationKey,
      res2.reservationToken,
      "order_valid_222",
      "intent_valid_222",
    );
    const snap = await mockDb.collection("paymentReservations").doc(reservationKey).get();
    assert.equal(snap.data()?.status, "active");
    assert.equal(snap.data()?.orderId, "order_valid_222");
  });

  // ── 6. Activation Failure & Safe Recovery ──────────────────────────────────
  it("activatePaymentReservation propagates errors and does not swallow failures", async () => {
    const failingDb = {
      runTransaction: async () => {
        throw new Error("Firestore write quota exceeded");
      },
      collection: () => ({ doc: () => ({}) }),
    };

    await assert.rejects(
      async () => {
        await activatePaymentReservation(failingDb, "key_1", "tok_1", "order_fail_1", "intent_fail_1");
      },
      /Firestore write quota exceeded/,
      "activatePaymentReservation must propagate errors rather than swallowing them",
    );
  });

  it("recovers after activation failure and reuses the existing order without creating a second order", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_test_recovery_1";
    const authUid = "user_abc";
    const payableAmount = 500;
    const currency = "INR";

    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, payableAmount, currency);
    assert.equal(res1.acquired, true);

    const createdOrderId = "order_ext_999";
    const createdIntentId = "intent_ext_888";

    // Record activation failure with orderId
    await recordActivationFailure(
      mockDb,
      reservationKey,
      res1.reservationToken,
      createdOrderId,
      createdIntentId,
      authUid,
      payableAmount,
      currency,
      "Simulated network error during activation",
    );

    // Verify reservation holds activation_failed status and retains orderId
    const snap = await mockDb.collection("paymentReservations").doc(reservationKey).get();
    assert.equal(snap.data()?.status, "activation_failed");
    assert.equal(snap.data()?.orderId, createdOrderId);

    // Retry request recognizes existing order, reconciles, and returns it
    const retryRes = await acquirePaymentReservation(mockDb, reservationKey, authUid, payableAmount, currency);
    assert.equal(retryRes.acquired, false, "Must not grant new order creation lock");
    assert.ok(retryRes.existingOrder, "Must return existing order for safe reuse");
    assert.equal(retryRes.existingOrder.orderId, createdOrderId);
    assert.equal(retryRes.existingOrder.intentId, createdIntentId);

    const snapAfter = await mockDb.collection("paymentReservations").doc(reservationKey).get();
    assert.equal(snapAfter.data()?.status, "active");
  });

  // ── 7. Ambiguous Gateway Error & External Reconciliation ────────────────────
  it("classifies ambiguous Razorpay network failures correctly", () => {
    assert.equal(isAmbiguousRazorpayError(new Error("socket hang up")), true);
    assert.equal(isAmbiguousRazorpayError({ code: "ETIMEDOUT", message: "timeout" }), true);
    assert.equal(isAmbiguousRazorpayError({ statusCode: 504, message: "Gateway Timeout" }), true);
    assert.equal(isAmbiguousRazorpayError({ statusCode: 500, message: "Internal Error" }), true);

    // Client errors are definitive (not ambiguous)
    assert.equal(isAmbiguousRazorpayError({ statusCode: 400, message: "Bad Request" }), false);
    assert.equal(isAmbiguousRazorpayError({ statusCode: 401, message: "Unauthorized" }), false);
  });

  it("handles ambiguous network timeout via reconciliation_required and reuses found order", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_ambiguous_1";
    const authUid = "user_abc";
    const receipt = "rcpt_ambiguous_123";

    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(res1.acquired, true);

    // Ambiguous network failure: record reconciliation_required
    await recordReconciliationRequired(
      mockDb,
      reservationKey,
      res1.reservationToken,
      receipt,
      authUid,
      500,
      "INR",
      "Network connection reset by peer",
    );

    // Subsequent request sees needsReconciliation: true
    const res2 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(res2.acquired, false);
    assert.equal(res2.needsReconciliation, true);

    // Mock Razorpay instance confirming order was created
    const mockRazorpaySuccess = {
      orders: {
        all: async ({ receipt: r }) => {
          if (r === receipt) {
            return { items: [{ id: "order_reconciled_from_rzp_777", amount: 50000, currency: "INR", receipt, status: "created" }] };
          }
          return { items: [] };
        },
      },
    };

    const recResult = await reconcileAmbiguousReservation(
      mockRazorpaySuccess,
      mockDb,
      reservationKey,
      authUid,
      500,
      "INR",
    );
    assert.equal(recResult.reconciled, true);
    assert.ok(recResult.existingOrder);
    assert.equal(recResult.existingOrder.orderId, "order_reconciled_from_rzp_777");

    const snap = await mockDb.collection("paymentReservations").doc(reservationKey).get();
    assert.equal(snap.data()?.status, "active");
  });

  // ── Finding 4: Authoritative Absence Semantics ──────────────────────────────
  it("Finding 4: does not assume empty list API proves absence; keeps reservation safely blocked", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_ambiguous_none_1";
    const authUid = "user_abc";
    const receipt = "rcpt_ambiguous_empty_456";

    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    await recordReconciliationRequired(
      mockDb,
      reservationKey,
      res1.reservationToken,
      receipt,
      authUid,
      500,
      "INR",
      "Request aborted",
    );

    // Mock Razorpay returning empty items array (e.g. read replica lag / search index delay)
    const mockRazorpayEmpty = {
      orders: {
        all: async () => ({ items: [] }),
      },
    };

    const recResult = await reconcileAmbiguousReservation(
      mockRazorpayEmpty,
      mockDb,
      reservationKey,
      authUid,
      500,
      "INR",
    );
    // Must NOT be marked reconciled or retriable; must not transition to failed
    assert.equal(recResult.reconciled, false);
    assert.equal(recResult.canRetry, false);
    assert.match(recResult.error, /Authoritative order absence could not be conclusively established/);

    // Reservation must remain in 'reconciliation_failed' blocked state
    const snap = await mockDb.collection("paymentReservations").doc(reservationKey).get();
    assert.equal(snap.data()?.status, "reconciliation_failed");

    // Fresh acquisition must remain blocked and require external reconciliation
    const retryAcquire = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(retryAcquire.acquired, false);
    assert.equal(retryAcquire.needsReconciliation, true);
    assert.match(retryAcquire.error, /External order reconciliation required/);
  });

  // ── Finding 1: Active Order Expiry & Authoritative Order Reconciliation ─────
  it("Finding 1: active reservation past local expiry is not auto-replaced; requires external reconciliation", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_expired_active_1";
    const authUid = "user_abc";

    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    await activatePaymentReservation(mockDb, reservationKey, res1.reservationToken, "order_rzp_expired_1", "intent_123");

    // Artificially expire the local reservation (e.g. 20 minutes ago)
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
    await mockDb.collection("paymentReservations").doc(reservationKey).update({
      expiresAt: twentyMinsAgo,
    });

    // acquirePaymentReservation should NOT overwrite with a new order! It must return needsReconciliation: true
    const res2 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(res2.acquired, false);
    assert.equal(res2.needsReconciliation, true);
    assert.equal(res2.existingOrder?.orderId, "order_rzp_expired_1");

    // Case A: Gateway status is 'paid' -> blocks replacement with new order, returns isPaid: true
    const mockRzpPaid = {
      orders: {
        fetch: async (id) => ({ id, status: "paid", amount: 50000, currency: "INR" }),
      },
    };
    const recPaid = await reconcileAmbiguousReservation(mockRzpPaid, mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(recPaid.reconciled, true);
    assert.equal(recPaid.isPaid, true);
    assert.equal(recPaid.canRetry, false);

    // Case B: Gateway status is 'created' / 'attempted' (still payable) -> extends lease and reuses order
    const reservationKeyB = "res_match_expired_active_b";
    const resB1 = await acquirePaymentReservation(mockDb, reservationKeyB, authUid, 500, "INR");
    await activatePaymentReservation(mockDb, reservationKeyB, resB1.reservationToken, "order_rzp_expired_b", "intent_b");
    await mockDb.collection("paymentReservations").doc(reservationKeyB).update({ expiresAt: twentyMinsAgo });

    const mockRzpPayable = {
      orders: {
        fetch: async (id) => ({ id, status: "created", amount: 50000, currency: "INR" }),
      },
    };
    const recPayable = await reconcileAmbiguousReservation(mockRzpPayable, mockDb, reservationKeyB, authUid, 500, "INR");
    assert.equal(recPayable.reconciled, true);
    assert.equal(recPayable.existingOrder?.orderId, "order_rzp_expired_b");
    // Verify reservation lease was extended
    const snapPayable = await mockDb.collection("paymentReservations").doc(reservationKeyB).get();
    assert.equal(snapPayable.data()?.status, "active");
    assert.ok(new Date(snapPayable.data()?.expiresAt).getTime() > Date.now());

    // Case C: Unsupported order status (e.g. 'expired' or 'cancelled') is rejected per Razorpay Orders contract
    // Razorpay Orders strictly support only 'created', 'attempted', and 'paid'. Unsupported statuses retain safe blocking.
    const reservationKeyC = "res_match_expired_active_c";
    const resC1 = await acquirePaymentReservation(mockDb, reservationKeyC, authUid, 500, "INR");
    await activatePaymentReservation(mockDb, reservationKeyC, resC1.reservationToken, "order_rzp_expired_c", "intent_c");
    await mockDb.collection("paymentReservations").doc(reservationKeyC).update({ expiresAt: twentyMinsAgo });

    const mockRzpCancelled = {
      orders: {
        fetch: async (id) => ({ id, status: "cancelled", amount: 50000, currency: "INR" }),
      },
    };
    const recCancelled = await reconcileAmbiguousReservation(mockRzpCancelled, mockDb, reservationKeyC, authUid, 500, "INR");
    assert.equal(recCancelled.reconciled, false);
    assert.equal(recCancelled.canRetry, false);
    assert.match(recCancelled.error, /Unrecognized or unsupported Razorpay order status/);

    const snapCancelled = await mockDb.collection("paymentReservations").doc(reservationKeyC).get();
    assert.equal(snapCancelled.data()?.status, "reconciliation_failed");

    // Lock takeover is safely blocked
    const resBlocked = await acquirePaymentReservation(mockDb, reservationKeyC, authUid, 500, "INR");
    assert.equal(resBlocked.acquired, false);
    assert.equal(resBlocked.needsReconciliation, true);

    // Case D: External status unavailable (network/gateway failure) -> retains safe blocked state
    const reservationKeyD = "res_match_expired_active_d";
    const resD1 = await acquirePaymentReservation(mockDb, reservationKeyD, authUid, 500, "INR");
    await activatePaymentReservation(mockDb, reservationKeyD, resD1.reservationToken, "order_rzp_expired_d", "intent_d");
    await mockDb.collection("paymentReservations").doc(reservationKeyD).update({ expiresAt: twentyMinsAgo });

    const mockRzpError = {
      orders: {
        fetch: async () => { throw new Error("Gateway connection reset"); },
      },
    };
    const recError = await reconcileAmbiguousReservation(mockRzpError, mockDb, reservationKeyD, authUid, 500, "INR");
    assert.equal(recError.reconciled, false);
    assert.equal(recError.canRetry, false);
    assert.match(recError.error, /External status unavailable/);

    const snapError = await mockDb.collection("paymentReservations").doc(reservationKeyD).get();
    assert.equal(snapError.data()?.status, "reconciliation_failed");
  });

  // ── Item 1: Receipt-Only Reconciliation for Paid Orders ─────────────────────
  it("Item 1: receipt-only reconciliation persists paid state and returns isPaid: true without checkout opportunity", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_receipt_paid_1";
    const authUid = "user_abc";
    const receipt = "rcpt_receipt_paid_1";

    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    await recordReconciliationRequired(mockDb, reservationKey, res1.reservationToken, receipt, authUid, 500, "INR", "Ambiguous timeout");

    // Mock Razorpay returning a single order matching the receipt with status 'paid'
    const mockRzpReceiptPaid = {
      orders: {
        all: async () => ({
          items: [{ id: "order_rzp_rcpt_paid_99", receipt, amount: 50000, currency: "INR", status: "paid" }],
        }),
      },
    };

    const recResult = await reconcileAmbiguousReservation(mockRzpReceiptPaid, mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(recResult.reconciled, true);
    assert.equal(recResult.isPaid, true);
    assert.equal(recResult.canRetry, false);
    assert.equal(recResult.existingOrder?.orderId, "order_rzp_rcpt_paid_99");

    // Persists isPaid: true on the reservation document
    const snap = await mockDb.collection("paymentReservations").doc(reservationKey).get();
    assert.equal(snap.data()?.status, "active");
    assert.equal(snap.data()?.isPaid, true);
    assert.equal(snap.data()?.orderId, "order_rzp_rcpt_paid_99");
  });

  // ── Finding 2: Strict Currency Validation during Reconciliation ─────────────
  it("Finding 2: strictly validates currency during reconciliation without fallback defaulting", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_curr_val_1";
    const authUid = "user_abc";
    const receipt = "rcpt_curr_val_1";

    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    await recordReconciliationRequired(mockDb, reservationKey, res1.reservationToken, receipt, authUid, 500, "INR", "Timeout");

    // Case A: Missing currency (undefined/null/empty) in Razorpay response
    const mockRzpMissingCurr = {
      orders: {
        all: async () => ({ items: [{ id: "ord_1", receipt, amount: 50000, currency: "", status: "created" }] }),
      },
    };
    const recMissing = await reconcileAmbiguousReservation(mockRzpMissingCurr, mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(recMissing.reconciled, false);
    assert.match(recMissing.error, /Missing or empty currency in reconciled Razorpay order/i);

    // Case B: Currency mismatch (e.g. USD vs INR)
    const mockRzpMismatchCurr = {
      orders: {
        all: async () => ({ items: [{ id: "ord_2", receipt, amount: 50000, currency: "USD", status: "created" }] }),
      },
    };
    const recMismatch = await reconcileAmbiguousReservation(mockRzpMismatchCurr, mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(recMismatch.reconciled, false);
    assert.match(recMismatch.error, /Currency mismatch in reconciled order: expected INR, found USD/);

    // Case C: Valid matching INR
    const mockRzpValidCurr = {
      orders: {
        all: async () => ({ items: [{ id: "ord_3", receipt, amount: 50000, currency: "INR", status: "created" }] }),
      },
    };
    const recValid = await reconcileAmbiguousReservation(mockRzpValidCurr, mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(recValid.reconciled, true);
    assert.equal(recValid.existingOrder?.currency, "INR");
  });

  // ── Finding 3: Strict Payment Intent Identity Validation ────────────────────
  describe("Finding 3: verifyAndRepairIntent strict validation", () => {
    it("rejects intent with missing or whitespace-only userId", async () => {
      const mockDb = createMockDb();
      await mockDb.collection("razorpayIntents").doc("intent_bad_user").set({
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
      });

      const res = await verifyAndRepairIntent(mockDb, "intent_bad_user", "order_123", {
        userId: "user_valid",
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
      });
      assert.equal(res.ok, false);
      assert.match(res.error, /missing required userId/);
    });

    it("rejects intent with mismatched userId", async () => {
      const mockDb = createMockDb();
      await mockDb.collection("razorpayIntents").doc("intent_mismatch_user").set({
        userId: "user_attacker",
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
      });

      const res = await verifyAndRepairIntent(mockDb, "intent_mismatch_user", "order_123", {
        userId: "user_victim",
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
      });
      assert.equal(res.ok, false);
      assert.match(res.error, /Intent user mismatch: expected user_victim, found user_attacker/);
    });

    it("rejects intent with missing reservationKey", async () => {
      const mockDb = createMockDb();
      await mockDb.collection("razorpayIntents").doc("intent_bad_res").set({
        userId: "user_valid",
        amount: 500,
        currency: "INR",
      });

      const res = await verifyAndRepairIntent(mockDb, "intent_bad_res", "order_123", {
        userId: "user_valid",
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
      });
      assert.equal(res.ok, false);
      assert.match(res.error, /missing required reservationKey/);
    });

    it("rejects intent with mismatched reservationKey", async () => {
      const mockDb = createMockDb();
      await mockDb.collection("razorpayIntents").doc("intent_mismatch_res").set({
        userId: "user_valid",
        reservationKey: "res_other_obligation",
        amount: 500,
        currency: "INR",
      });

      const res = await verifyAndRepairIntent(mockDb, "intent_mismatch_res", "order_123", {
        userId: "user_valid",
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
      });
      assert.equal(res.ok, false);
      assert.match(res.error, /Intent reservation key mismatch/);
    });

    it("rejects intent with missing or invalid amount", async () => {
      const mockDb = createMockDb();
      await mockDb.collection("razorpayIntents").doc("intent_bad_amt").set({
        userId: "user_valid",
        reservationKey: "res_key_1",
        currency: "INR",
      });

      const res = await verifyAndRepairIntent(mockDb, "intent_bad_amt", "order_123", {
        userId: "user_valid",
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
      });
      assert.equal(res.ok, false);
      assert.match(res.error, /missing valid amount/);
    });

    it("rejects intent with mismatched amount", async () => {
      const mockDb = createMockDb();
      await mockDb.collection("razorpayIntents").doc("intent_mismatch_amt").set({
        userId: "user_valid",
        reservationKey: "res_key_1",
        amount: 250,
        currency: "INR",
      });

      const res = await verifyAndRepairIntent(mockDb, "intent_mismatch_amt", "order_123", {
        userId: "user_valid",
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
      });
      assert.equal(res.ok, false);
      assert.match(res.error, /Intent amount mismatch: expected ₹500, found ₹250/);
    });

    it("rejects intent with missing currency without default fallback", async () => {
      const mockDb = createMockDb();
      await mockDb.collection("razorpayIntents").doc("intent_no_curr").set({
        userId: "user_valid",
        reservationKey: "res_key_1",
        amount: 500,
      });

      const res = await verifyAndRepairIntent(mockDb, "intent_no_curr", "order_123", {
        userId: "user_valid",
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
      });
      assert.equal(res.ok, false);
      assert.match(res.error, /missing required currency/);
    });

    it("repairs orderId atomically only after all 4 validations succeed", async () => {
      const mockDb = createMockDb();
      await mockDb.collection("razorpayIntents").doc("intent_valid").set({
        userId: "user_valid",
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
        orderId: "order_old_or_missing",
      });

      const res = await verifyAndRepairIntent(mockDb, "intent_valid", "order_new_repaired_999", {
        userId: "user_valid",
        reservationKey: "res_key_1",
        amount: 500,
        currency: "INR",
      });
      assert.equal(res.ok, true);

      const snap = await mockDb.collection("razorpayIntents").doc("intent_valid").get();
      assert.equal(snap.data()?.orderId, "order_new_repaired_999");
      assert.ok(snap.data()?.orderIdRepairedAt);
    });
  });

  // ── 8. Strict Validation: Amount, Currency, and Cross-User ───────────────────
  it("rejects reuse and returns a controlled conflict if amount changed between attempts", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_test_amt_1";
    const authUid = "user_abc";

    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    await activatePaymentReservation(mockDb, reservationKey, res1.reservationToken, "order_500", "intent_500");

    const result = await acquirePaymentReservation(mockDb, reservationKey, authUid, 650, "INR");
    assert.equal(result.acquired, false);
    assert.equal(result.conflict, true);
    assert.match(result.error, /Amount mismatch: stored reservation is ₹500, but current payable amount is ₹650/);
  });

  it("rejects reuse and returns conflict if reservation is owned by another user", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_test_user_1";
    const userA = "user_victim_123";
    const userB = "user_attacker_456";

    const resA = await acquirePaymentReservation(mockDb, reservationKey, userA, 500, "INR");
    await activatePaymentReservation(mockDb, reservationKey, resA.reservationToken, "order_userA_111", "intent_userA_222");

    const result = await acquirePaymentReservation(mockDb, reservationKey, userB, 500, "INR");
    assert.equal(result.acquired, false);
    assert.equal(result.conflict, true);
    assert.match(result.error, /Reservation belongs to a different user/);
  });

  it("releases reservation on definitive client failure (e.g. 400 Bad Request)", async () => {
    const mockDb = createMockDb();
    const reservationKey = "res_match_test_release_1";
    const authUid = "user_abc";

    const res1 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(res1.acquired, true);

    await releasePaymentReservation(mockDb, reservationKey, res1.reservationToken, "Definitive 400 rejection");
    const snap = await mockDb.collection("paymentReservations").doc(reservationKey).get();
    assert.equal(snap.data()?.status, "failed");

    const res2 = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(res2.acquired, true);
  });

  // ── 9. Paid-State Protection: Persisted Paid Reservation Must Never Reach Checkout ──
  describe("Paid-State Protection at Acquisition & Lifecycle", () => {
    it("acquirePaymentReservation returns conflict with isPaid: true and no existingOrder when doc is isPaid: true", async () => {
      const mockDb = createMockDb();
      const reservationKey = "res_paid_test_1";
      const authUid = "user_paid_123";

      // Seed an active reservation already marked paid
      await mockDb.collection("paymentReservations").doc(reservationKey).set({
        reservationKey,
        status: "active",
        orderId: "order_paid_already_111",
        intentId: "intent_paid_222",
        userId: authUid,
        amount: 800,
        currency: "INR",
        isPaid: true,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // unexpired!
      });

      const res = await acquirePaymentReservation(mockDb, reservationKey, authUid, 800, "INR");
      assert.equal(res.acquired, false);
      assert.equal(res.conflict, true);
      assert.equal(res.isPaid, true);
      assert.equal(res.orderId, "order_paid_already_111");
      assert.equal(res.existingOrder, undefined, "Paid reservation must NEVER be returned as existingOrder");
      assert.match(res.error, /Obligation has already been paid via order order_paid_already_111/);
    });

    it("validateReservationForReuse rejects checkout reuse when isPaid is true", () => {
      const result = validateReservationForReuse(
        {
          reservationKey: "res_key_1",
          userId: "user_abc",
          orderId: "order_paid_999",
          intentId: "intent_999",
          amount: 500,
          currency: "INR",
          isPaid: true,
        },
        "res_key_1",
        "user_abc",
        500,
        "INR",
      );

      assert.equal(result.valid, false);
      assert.equal(result.conflict, true);
      assert.equal(result.isPaid, true);
      assert.match(result.reason, /Obligation has already been paid via order order_paid_999/);
    });

    it("lifecycle operations (renew, activate, release) protect isPaid from being reset", async () => {
      const mockDb = createMockDb();
      const reservationKey = "res_paid_protect_1";
      const token = "tok_123";

      await mockDb.collection("paymentReservations").doc(reservationKey).set({
        reservationKey,
        reservationToken: token,
        status: "active",
        orderId: "order_protected_555",
        isPaid: true,
      });

      // Renew should fail
      const renewRes = await renewReservationLease(mockDb, reservationKey, token);
      assert.equal(renewRes.renewed, false);
      assert.match(renewRes.error, /Cannot renew lease: obligation is already marked paid/);

      // Activate should throw
      await assert.rejects(
        async () => {
          await activatePaymentReservation(mockDb, reservationKey, token, "order_new", "intent_new");
        },
        /Cannot activate reservation: obligation is already marked paid/,
      );

      // Release should throw
      await assert.rejects(
        async () => {
          await releasePaymentReservation(mockDb, reservationKey, token);
        },
        /Cannot release reservation: obligation is already marked paid/,
      );

      // Doc must remain isPaid: true
      const snap = await mockDb.collection("paymentReservations").doc(reservationKey).get();
      assert.equal(snap.data()?.isPaid, true);
      assert.equal(snap.data()?.orderId, "order_protected_555");
    });
  });
});
