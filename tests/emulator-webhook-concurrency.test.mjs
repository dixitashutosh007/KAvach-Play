/**
 * FIN-002 Real Firestore Emulator Transaction Concurrency Integration Tests
 * (tests/emulator-webhook-concurrency.test.mjs)
 *
 * Verifies real Firestore atomic transaction behavior for webhook idempotency:
 * 1. Two simultaneous deliveries for one intent (race condition: payment.captured & order.paid)
 * 2. Exactly one fulfilment and one paid intent across all event arrivals
 * 3. Duplicate late-fee creation in otherFees is strictly prevented
 * 4. Duplicate merchandise fulfilment is strictly prevented
 * 5. Subscription duration is extended exactly once (never double-counted)
 * 6. Repeat/replayed webhooks return alreadyProcessed: true without modifying state
 *
 * Executed via: npm run test:emulator
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processWebhookIntentTransaction } from "../lib/razorpay-webhook.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rulesPath = path.resolve(__dirname, "../firestore.rules");
const rulesContent = fs.readFileSync(rulesPath, "utf8");

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skipReason = !emulatorHost
  ? "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator with local emulator)"
  : false;

describe("FIN-002: Real Firestore Emulator Webhook Concurrency Integration Tests", { skip: skipReason }, () => {
  let testEnv;
  let db;

  before(async () => {
    if (!emulatorHost) return;
    const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
    const [host, portStr] = emulatorHost.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "kavach-play-concurrency-test",
      firestore: {
        host,
        port: parseInt(portStr, 10),
        rules: rulesContent,
      },
    });

    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = !getApps().some((a) => a.name === "concurrency-test")
      ? initializeApp({ projectId: "kavach-play-concurrency-test" }, "concurrency-test")
      : getApps().find((a) => a.name === "concurrency-test");
    db = getFirestore(app);
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
  });

  it("handles payment.captured and order.paid simultaneous arrivals without duplicate match/late-fee writes", async () => {
    assert.ok(db, "Firebase Admin database must be initialized in emulator environment");

    const intentId = "intent_emulator_race_match_1";
    await db.collection("razorpayIntents").doc(intentId).set({
      id: intentId,
      status: "pending",
      type: "match",
      matchId: "m_race_1",
      paymentId: "p_race_1",
      amount: 500,
      currency: "INR",
      orderId: "order_emulator_race_1",
      lateFeeItems: [
        { playerId: "player_race_1", label: "Late Fee", amount: 150, templateId: "lf_em_1" },
      ],
    });

    await db.collection("matches").doc("m_race_1").collection("payments").doc("p_race_1").set({
      playerId: "player_race_1",
      status: "Unpaid",
      feeCollectedAmount: 0,
    });

    const capturedDetails = {
      event: "payment.captured",
      paymentId: "pay_em_race_1",
      orderId: "order_emulator_race_1",
      capturedPaise: 50000,
      capturedCurrency: "INR",
      intentId,
      notes: { intentId },
    };

    const orderPaidDetails = {
      event: "order.paid",
      paymentId: "pay_em_race_1",
      orderId: "order_emulator_race_1",
      capturedPaise: 50000,
      capturedCurrency: "INR",
      intentId,
      notes: { intentId },
      isFullyPaid: true,
    };

    // Execute real simultaneous transactions against Firebase Emulator
    const [res1, res2] = await Promise.all([
      processWebhookIntentTransaction(db, capturedDetails),
      processWebhookIntentTransaction(db, orderPaidDetails),
    ]);

    const results = [res1, res2];
    assert.equal(results.filter((r) => r.success && !r.alreadyProcessed).length, 1);
    assert.equal(results.filter((r) => r.success && r.alreadyProcessed).length, 1);

    // Verify intent status is paid
    const intentSnap = await db.collection("razorpayIntents").doc(intentId).get();
    assert.equal(intentSnap.data().status, "paid");
    assert.equal(intentSnap.data().razorpayPaymentId, "pay_em_race_1");

    // Verify match payment is marked Paid
    const paymentSnap = await db.collection("matches").doc("m_race_1").collection("payments").doc("p_race_1").get();
    assert.equal(paymentSnap.data().status, "Paid");
    assert.equal(paymentSnap.data().feeCollectedAmount, 500);

    // Verify exactly one late fee record was written into otherFees (no race duplication)
    const feesSnap = await db.collection("players").doc("player_race_1").collection("otherFees").get();
    assert.equal(feesSnap.size, 1);
    assert.equal(feesSnap.docs[0].data().amount, 150);
  });

  it("handles simultaneous arrivals for merchandise order without duplicate records", async () => {
    assert.ok(db, "Firebase Admin database must be initialized in emulator environment");

    const intentId = "intent_emulator_race_merch_1";
    const merchOrderId = "merch_order_em_1";

    await db.collection("merchOrders").doc(merchOrderId).set({
      id: merchOrderId,
      items: [{ name: "Club Cap", qty: 1, price: 650 }],
      paymentStatus: "Unpaid",
      orderStatus: "Order Placed",
      totalAmount: 650,
    });

    await db.collection("razorpayIntents").doc(intentId).set({
      id: intentId,
      status: "pending",
      type: "merch_order",
      amount: 650,
      currency: "INR",
      orderId: "order_emulator_race_merch_1",
      orderPayload: {
        id: merchOrderId,
        items: [{ name: "Club Cap", qty: 1, price: 650 }],
        totalAmount: 650,
      },
    });

    const capturedDetails = {
      event: "payment.captured",
      paymentId: "pay_em_merch_1",
      orderId: "order_emulator_race_merch_1",
      capturedPaise: 65000,
      capturedCurrency: "INR",
      intentId,
      notes: { intentId },
    };

    const orderPaidDetails = {
      event: "order.paid",
      paymentId: "pay_em_merch_1",
      orderId: "order_emulator_race_merch_1",
      capturedPaise: 65000,
      capturedCurrency: "INR",
      intentId,
      notes: { intentId },
      isFullyPaid: true,
    };

    const [res1, res2] = await Promise.all([
      processWebhookIntentTransaction(db, capturedDetails),
      processWebhookIntentTransaction(db, orderPaidDetails),
    ]);

    const results = [res1, res2];
    assert.equal(results.filter((r) => r.success && !r.alreadyProcessed).length, 1);
    assert.equal(results.filter((r) => r.success && r.alreadyProcessed).length, 1);

    // B1 (PX-1): the intent's client-supplied orderPayload.id must NOT select the target document.
    // Previously this test expected the pre-existing order to be overwritten, which is the PX-1
    // vulnerability. Now the pre-existing order stays untouched and exactly one order is created
    // at the server-controlled id mo_{intentId}.
    const seededSnap = await db.collection("merchOrders").doc(merchOrderId).get();
    assert.equal(seededSnap.data().paymentStatus, "Unpaid");
    assert.equal(seededSnap.data().razorpayPaymentId, undefined);

    const orderSnap = await db.collection("merchOrders").doc(`mo_${intentId}`).get();
    assert.equal(orderSnap.data().paymentStatus, "Paid");
    assert.equal(orderSnap.data().razorpayPaymentId, "pay_em_merch_1");

    const allOrdersSnap = await db.collection("merchOrders").get();
    assert.equal(allOrdersSnap.size, 2, "the seeded order plus exactly one webhook-created order");
    assert.equal(allOrdersSnap.docs.filter((d) => d.data().razorpayPaymentId === "pay_em_merch_1").length, 1);
  });

  it("handles simultaneous arrivals for studio subscription extending expiry exactly once", async () => {
    assert.ok(db, "Firebase Admin database must be initialized in emulator environment");

    const intentId = "intent_emulator_race_sub_1";
    const playerId = "player_sub_race_1";

    // Seed player with existing active expiry of 2026-12-01
    await db.collection("players").doc(playerId).set({
      id: playerId,
      name: "Studio Member",
      isStudioMember: true,
      studioExpiryDate: "2026-12-01",
    });

    await db.collection("appUsers").doc(playerId).set({
      id: playerId,
      name: "Studio Member",
      isStudioMember: true,
      studioExpiryDate: "2026-12-01",
    });

    await db.collection("razorpayIntents").doc(intentId).set({
      id: intentId,
      status: "pending",
      type: "subscription",
      userId: playerId,
      planId: "monthly_sub_30d",
      durationDays: 30,
      amount: 2500,
      currency: "INR",
      orderId: "order_emulator_race_sub_1",
    });

    const capturedDetails = {
      event: "payment.captured",
      paymentId: "pay_em_sub_1",
      orderId: "order_emulator_race_sub_1",
      capturedPaise: 250000,
      capturedCurrency: "INR",
      intentId,
      notes: { intentId },
    };

    const orderPaidDetails = {
      event: "order.paid",
      paymentId: "pay_em_sub_1",
      orderId: "order_emulator_race_sub_1",
      capturedPaise: 250000,
      capturedCurrency: "INR",
      intentId,
      notes: { intentId },
      isFullyPaid: true,
    };

    const [res1, res2] = await Promise.all([
      processWebhookIntentTransaction(db, capturedDetails),
      processWebhookIntentTransaction(db, orderPaidDetails),
    ]);

    const results = [res1, res2];
    assert.equal(results.filter((r) => r.success && !r.alreadyProcessed).length, 1);
    assert.equal(results.filter((r) => r.success && r.alreadyProcessed).length, 1);

    // Verify subscriptionHistory has exactly 1 entry (not 2)
    const historySnap = await db.collection("subscriptionHistory").where("playerId", "==", playerId).get();
    assert.equal(historySnap.size, 1);
    assert.equal(historySnap.docs[0].data().planId, "monthly_sub_30d");

    // 2026-12-01 + 30 days = 2026-12-31 (exactly 30 days extension, not 60)
    const playerSnap = await db.collection("players").doc(playerId).get();
    assert.equal(playerSnap.data().studioExpiryDate, "2026-12-31");
  });

  it("safely handles repeated webhook replays after completion with alreadyProcessed: true", async () => {
    assert.ok(db, "Firebase Admin database must be initialized in emulator environment");

    const intentId = "intent_emulator_replay_1";
    await db.collection("razorpayIntents").doc(intentId).set({
      id: intentId,
      status: "paid", // Already paid
      type: "match",
      matchId: "m_replay_1",
      paymentId: "p_replay_1",
      amount: 400,
      currency: "INR",
      orderId: "order_emulator_replay_1",
      razorpayPaymentId: "pay_orig_123",
    });

    const replayDetails = {
      event: "payment.captured",
      paymentId: "pay_orig_123",
      orderId: "order_emulator_replay_1",
      capturedPaise: 40000,
      capturedCurrency: "INR",
      intentId,
      notes: { intentId },
    };

    const result = await processWebhookIntentTransaction(db, replayDetails);
    assert.equal(result.success, true);
    assert.equal(result.alreadyProcessed, true);

    const intentSnap = await db.collection("razorpayIntents").doc(intentId).get();
    assert.equal(intentSnap.data().status, "paid");
    assert.equal(intentSnap.data().razorpayPaymentId, "pay_orig_123");
  });
});
