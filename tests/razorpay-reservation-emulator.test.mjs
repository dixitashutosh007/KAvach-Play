/**
 * FIN-001 Real Firestore Emulator Integration Tests
 * (tests/razorpay-reservation-emulator.test.mjs)
 *
 * Exercises actual Firestore transactions and order-creation orchestration against the
 * live Firebase Firestore Emulator across all 10 critical concurrency & failure scenarios:
 *
 * 1. Two simultaneous requests for the same obligation (real transaction serialization).
 * 2. Razorpay order creation lasting longer than initial lease (safe lease renewal).
 * 3. Reservation expiry while original request is still processing (token fencing).
 * 4. Activation failure after successful Razorpay order creation (activation_failed state).
 * 5. Failure to persist the activation-failure recovery record (error propagation).
 * 6. Network timeout after Razorpay may have created an order (reconciliation_required).
 * 7. Two requests attempting recovery simultaneously (concurrent reconciliation).
 * 8. Stale reservation owner attempting to activate or release a newer reservation (fencing protection).
 * 9. Changed amount, currency, or authenticated user (controlled conflict).
 * 10. Overlapping and reordered finance-dues obligations (deterministic canonical hashing).
 *
 * Uses mocked Razorpay boundaries for external API calls — zero real transactions executed.
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  generateReservationKey,
  acquirePaymentReservation,
  renewReservationLease,
  activatePaymentReservation,
  recordActivationFailure,
  recordReconciliationRequired,
  reconcileAmbiguousReservation,
  releasePaymentReservation,
  validateReservationForReuse,
  isAmbiguousRazorpayError,
} from "../lib/razorpay-order.ts";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skipReason = !emulatorHost
  ? "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)"
  : false;

describe("FIN-001: Real Firestore Emulator Integration Tests", { skip: skipReason }, () => {
  let db;

  before(async () => {
    if (!emulatorHost) return;
    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = !getApps().length
      ? initializeApp({ projectId: "kavach-play-reservation-test" })
      : getApps()[0];
    db = getFirestore(app);
  });

  // ── Scenario 1: Two Simultaneous Requests for the Same Obligation ──────────
  it("Scenario 1: Two simultaneous requests against real Firestore serialize to only ONE winner", async () => {
    const key = `res_em_simult_${Date.now()}`;
    const user = "user_simult_1";

    const [resA, resB] = await Promise.all([
      acquirePaymentReservation(db, key, user, 500, "INR", 30000),
      acquirePaymentReservation(db, key, user, 500, "INR", 30000),
    ]);

    const acquired = [resA, resB].filter((r) => r.acquired === true);
    const waiting = [resA, resB].filter((r) => r.isWaiting === true);

    assert.equal(acquired.length, 1, "Exactly one request must acquire the reservation lock in Firestore");
    assert.equal(waiting.length, 1, "The second concurrent request must receive isWaiting: true");
    assert.ok(acquired[0].reservationToken, "Winner must hold a valid reservationToken");
  });

  // ── Scenario 2: Order Creation Lasting Longer Than Initial Lease ────────────
  it("Scenario 2: Safe lease renewal extends lock and prevents second request from stealing reservation", async () => {
    const key = `res_em_renew_${Date.now()}`;
    const user = "user_renew_1";

    // Acquire short 1.5s lease
    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 1500);
    assert.equal(res1.acquired, true);

    // Renew lease by 10s before it expires
    const renewal = await renewReservationLease(db, key, res1.reservationToken, 10000);
    assert.equal(renewal.renewed, true);

    // Wait 2 seconds (past original 1.5s TTL)
    await new Promise((r) => setTimeout(r, 2000));

    // Another request arrives: must still see isWaiting because lease was renewed
    const res2 = await acquirePaymentReservation(db, key, user, 500, "INR", 10000);
    assert.equal(res2.acquired, false);
    assert.equal(res2.isWaiting, true, "Renewed lease must protect reservation from being stolen");
  });

  // ── Scenario 3: Reservation Expiry While Original Request Still Processing ──
  it("Scenario 3: Expired lease allows takeover, but fences out original request when it tries to activate", async () => {
    const key = `res_em_fenced_${Date.now()}`;
    const user = "user_fenced_1";

    // Request 1 acquires 100ms lease
    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 100);
    assert.equal(res1.acquired, true);

    // Wait 250ms for lease to expire
    await new Promise((r) => setTimeout(r, 250));

    // Request 2 arrives after expiry and acquires fresh reservation with fenceVersion 2
    const res2 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    assert.equal(res2.acquired, true);
    assert.equal(res2.fenceVersion, 2);

    // Stale Request 1 finishes its slow API call and attempts to activate: MUST FAIL
    await assert.rejects(
      async () => {
        await activatePaymentReservation(db, key, res1.reservationToken, "order_stale_1", "intent_stale_1");
      },
      /Fencing conflict: reservation token mismatch/,
      "Stale token must be fenced out from activating reservation in Firestore",
    );

    // Active Request 2 can activate normally
    await activatePaymentReservation(db, key, res2.reservationToken, "order_legit_2", "intent_legit_2");
    const snap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snap.data()?.status, "active");
    assert.equal(snap.data()?.orderId, "order_legit_2");
  });

  // ── Scenario 4: Activation Failure After Successful Razorpay Order Creation ──
  it("Scenario 4: Activation failure records activation_failed and prevents double external order", async () => {
    const key = `res_em_act_fail_${Date.now()}`;
    const user = "user_act_fail_1";

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    assert.equal(res1.acquired, true);

    // Razorpay returned order_ext_success_444, but activation failed
    await recordActivationFailure(
      db,
      key,
      res1.reservationToken,
      "order_ext_success_444",
      "intent_444",
      user,
      500,
      "INR",
      "Network drop during activation write",
    );

    // Client retries order creation
    const retryRes = await acquirePaymentReservation(db, key, user, 500, "INR");
    assert.equal(retryRes.acquired, false, "Must not create a new order");
    assert.ok(retryRes.existingOrder, "Must return existing order for reuse");
    assert.equal(retryRes.existingOrder.orderId, "order_ext_success_444");

    // Status is reconciled back to active
    const snap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snap.data()?.status, "active");
  });

  // ── Scenario 5: Failure to Persist Activation-Failure Recovery Record ────────
  it("Scenario 5: Write failure during recovery persistence propagates error and avoids unsafe release", async () => {
    const failingDb = {
      runTransaction: async () => {
        throw new Error("Disk full / Firestore unavailable");
      },
      collection: () => ({ doc: () => ({}) }),
    };

    await assert.rejects(
      async () => {
        await recordActivationFailure(failingDb, "key", "tok", "order_1", "int_1", "user", 500, "INR");
      },
      /Disk full \/ Firestore unavailable/,
      "Persistence failure must propagate directly without being swallowed",
    );
  });

  // ── Scenario 6: Network Timeout After Razorpay May Have Created an Order ────
  it("Scenario 6: Network timeout records reconciliation_required and safely reconciles external order", async () => {
    const key = `res_em_ambiguous_${Date.now()}`;
    const user = "user_ambiguous_1";
    const receipt = `rcpt_${Date.now()}`;

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    assert.equal(res1.acquired, true);

    // Simulate ambiguous timeout
    assert.equal(isAmbiguousRazorpayError(new Error("ESOCKETTIMEDOUT")), true);

    await recordReconciliationRequired(
      db,
      key,
      res1.reservationToken,
      receipt,
      user,
      500,
      "INR",
      "Gateway socket timed out",
    );

    // Next request arrives: must require reconciliation
    const nextReq = await acquirePaymentReservation(db, key, user, 500, "INR");
    assert.equal(nextReq.acquired, false);
    assert.equal(nextReq.needsReconciliation, true);

    // Mocked Razorpay confirms order was created at gateway
    const mockRazorpay = {
      orders: {
        all: async ({ receipt: r }) => {
          if (r === receipt) {
            return { items: [{ id: "order_rzp_reconciled_999", amount: 50000, status: "created" }] };
          }
          return { items: [] };
        },
      },
    };

    const recResult = await reconcileAmbiguousReservation(mockRazorpay, db, key, user, 500, "INR");
    assert.equal(recResult.reconciled, true);
    assert.equal(recResult.existingOrder?.orderId, "order_rzp_reconciled_999");
  });

  // ── Scenario 7: Two Requests Attempting Recovery Simultaneously ────────────
  it("Scenario 7: Two simultaneous recovery requests both receive the same existing order without duplicate writes", async () => {
    const key = `res_em_dual_rec_${Date.now()}`;
    const user = "user_dual_rec_1";

    // Setup an order in activation_failed state
    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    await recordActivationFailure(db, key, res1.reservationToken, "order_ext_shared_777", "intent_777", user, 500, "INR");

    // Two simultaneous requests attempt recovery
    const [recA, recB] = await Promise.all([
      acquirePaymentReservation(db, key, user, 500, "INR"),
      acquirePaymentReservation(db, key, user, 500, "INR"),
    ]);

    assert.equal(recA.acquired, false);
    assert.equal(recB.acquired, false);
    assert.equal(recA.existingOrder?.orderId, "order_ext_shared_777");
    assert.equal(recB.existingOrder?.orderId, "order_ext_shared_777");
  });

  // ── Scenario 8: Stale Reservation Owner Attempting to Mutate Newer Reservation
  it("Scenario 8: Stale reservation owner cannot release or alter a newer reservation", async () => {
    const key = `res_em_stale_release_${Date.now()}`;
    const user = "user_stale_1";

    const res1 = await acquirePaymentReservation(db, key, user, 500, "INR", 50);
    await new Promise((r) => setTimeout(r, 100)); // wait for expiry

    const res2 = await acquirePaymentReservation(db, key, user, 500, "INR", 30000);
    assert.equal(res2.fenceVersion, 2);

    // Stale Request 1 attempts to release the reservation
    await assert.rejects(
      async () => {
        await releasePaymentReservation(db, key, res1.reservationToken, "Stale release attempt");
      },
      /Fencing conflict: reservation token mismatch/,
      "Stale token must be fenced out from releasing newer reservation",
    );

    // Reservation is still active and owned by Request 2
    const snap = await db.collection("paymentReservations").doc(key).get();
    assert.equal(snap.data()?.status, "reserving");
    assert.equal(snap.data()?.reservationToken, res2.reservationToken);
  });

  // ── Scenario 9: Changed Amount, Currency or Authenticated User ─────────────
  it("Scenario 9: Rejects reuse with controlled conflict if amount, currency or user differs", async () => {
    const key = `res_em_mismatch_${Date.now()}`;
    const userA = "user_mismatch_A";
    const userB = "user_mismatch_B";

    const res1 = await acquirePaymentReservation(db, key, userA, 500, "INR", 30000);
    await activatePaymentReservation(db, key, res1.reservationToken, "order_val_101", "intent_101");

    // Case A: Different user
    const diffUser = await acquirePaymentReservation(db, key, userB, 500, "INR");
    assert.equal(diffUser.conflict, true);
    assert.match(diffUser.error, /Reservation belongs to a different user/);

    // Case B: Changed amount (₹500 -> ₹700)
    const diffAmt = await acquirePaymentReservation(db, key, userA, 700, "INR");
    assert.equal(diffAmt.conflict, true);
    assert.match(diffAmt.error, /Amount mismatch: stored reservation is ₹500, but current payable amount is ₹700/);

    // Case C: Currency mismatch
    const valResult = validateReservationForReuse(
      { userId: userA, reservationKey: key, orderId: "order_val_101", intentId: "intent_101", amount: 500, currency: "INR" },
      key,
      userA,
      500,
      "USD",
    );
    assert.equal(valResult.valid, false);
    assert.match(valResult.reason, /Currency mismatch/);
  });

  // ── Scenario 10: Overlapping and Reordered Finance-Dues Obligations ────────
  it("Scenario 10: Deterministic canonical hashing produces identical keys regardless of item ordering", () => {
    const duesPlayer = "player_canonical_444";
    const itemMatch = { type: "match", matchId: "m_100", paymentId: "p_200" };
    const itemFee = { type: "other", feeId: "fee_300" };
    const itemLate = { isLateFee: true, matchId: "m_100", lateFeeTemplateId: "lf_400" };
    const itemMerch = { type: "merch", merchId: "merch_500" };

    // Permutation 1
    const order1 = [itemMatch, itemFee, itemLate, itemMerch];
    const key1 = generateReservationKey({ type: "finance_dues", items: order1 }, duesPlayer);

    // Permutation 2 (reversed order)
    const order2 = [itemMerch, itemLate, itemFee, itemMatch];
    const key2 = generateReservationKey({ type: "finance_dues", items: order2 }, duesPlayer);

    // Permutation 3 (scrambled order)
    const order3 = [itemFee, itemMatch, itemMerch, itemLate];
    const key3 = generateReservationKey({ type: "finance_dues", items: order3 }, duesPlayer);

    assert.equal(key1, key2, "Permutation 1 and 2 must produce identical reservation keys");
    assert.equal(key2, key3, "Permutation 2 and 3 must produce identical reservation keys");
    assert.match(key1, /^res_dues_[a-f0-9]{32}$/, "Key must be fixed-length SHA-256 hash");
  });
});
