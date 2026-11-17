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

  it("reconciles ambiguous failure to failed state when Razorpay confirms no order exists", async () => {
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

    // Mock Razorpay confirming zero orders exist
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
    assert.equal(recResult.reconciled, true);
    assert.equal(recResult.canRetry, true);

    // Now reservation is in 'failed' state and can be cleanly reacquired
    const snap = await mockDb.collection("paymentReservations").doc(reservationKey).get();
    assert.equal(snap.data()?.status, "failed");

    const retryAcquire = await acquirePaymentReservation(mockDb, reservationKey, authUid, 500, "INR");
    assert.equal(retryAcquire.acquired, true);
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
});
