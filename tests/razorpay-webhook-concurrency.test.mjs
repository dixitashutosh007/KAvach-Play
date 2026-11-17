/**
 * FIN-002 / FIN-003 Webhook Reliability, Concurrency & Idempotency Tests
 * (tests/razorpay-webhook-concurrency.test.mjs)
 *
 * Verifies:
 * 1. Event Payload Extraction: correctly parses payment.captured vs order.paid without
 *    conflating paymentId and orderId.
 * 2. Transaction Validation (FIN-003): amount (paise vs rupees), currency, and order ID checks.
 * 3. Concurrency & Idempotency (FIN-002): atomic Firestore transactions prevent duplicate
 *    processing, duplicate late fee generation, and double subscription extensions on race conditions.
 *
 * Imports directly from production: @/lib/razorpay-webhook
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractWebhookEventDetails,
  validateWebhookTransaction,
  processWebhookIntentTransaction,
} from "../lib/razorpay-webhook.ts";

// ── 1. Event Payload Extraction ──────────────────────────────────────────────

describe("FIN-003: Webhook Event Schema Disambiguation", () => {
  it("extracts payment.captured with distinct paymentId and orderId", () => {
    const payload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_KAvachPay999",
            order_id: "order_KAvachOrder888",
            amount: 50000, // ₹500 in paise
            currency: "INR",
            notes: { intentId: "intent_match_123" },
          },
        },
      },
    };

    const details = extractWebhookEventDetails(payload);
    assert.ok(details);
    assert.equal(details.event, "payment.captured");
    assert.equal(details.paymentId, "pay_KAvachPay999");
    assert.equal(details.orderId, "order_KAvachOrder888");
    assert.equal(details.capturedPaise, 50000);
    assert.equal(details.capturedCurrency, "INR");
    assert.equal(details.intentId, "intent_match_123");
  });

  it("extracts order.paid without confusing order_id for paymentId", () => {
    const payload = {
      event: "order.paid",
      payload: {
        order: {
          entity: {
            id: "order_KAvachOrder777",
            amount: 75000,
            amount_paid: 75000,
            currency: "INR",
            notes: { intentId: "intent_merch_456" },
          },
        },
      },
    };

    const details = extractWebhookEventDetails(payload);
    assert.ok(details);
    assert.equal(details.event, "order.paid");
    assert.equal(details.orderId, "order_KAvachOrder777");
    // paymentId must NOT be set to the order ID
    assert.notEqual(details.paymentId, "order_KAvachOrder777");
    assert.equal(details.capturedPaise, 75000);
    assert.equal(details.capturedCurrency, "INR");
    assert.equal(details.intentId, "intent_merch_456");
  });

  it("returns null for non-entity or malformed payloads", () => {
    assert.equal(extractWebhookEventDetails(null), null);
    assert.equal(extractWebhookEventDetails({}), null);
    assert.equal(extractWebhookEventDetails({ payload: {} }), null);
  });
});

// ── 2. Transaction Validation (FIN-003) ──────────────────────────────────────

describe("FIN-003: Transaction Validation Rules", () => {
  const intent = {
    amount: 500,
    currency: "INR",
    orderId: "order_legit_123",
  };

  it("succeeds when amount in paise, currency, and orderId match", () => {
    const details = {
      event: "payment.captured",
      paymentId: "pay_1",
      orderId: "order_legit_123",
      capturedPaise: 50000,
      capturedCurrency: "INR",
      intentId: "intent_1",
      notes: {},
    };
    const res = validateWebhookTransaction(intent, details);
    assert.equal(res.ok, true);
  });

  it("fails when captured amount does not match expected intent amount", () => {
    const details = {
      event: "payment.captured",
      paymentId: "pay_1",
      orderId: "order_legit_123",
      capturedPaise: 100, // Tampered: ₹1
      capturedCurrency: "INR",
      intentId: "intent_1",
      notes: {},
    };
    const res = validateWebhookTransaction(intent, details);
    assert.equal(res.ok, false);
    assert.match(res.error, /Amount mismatch/);
  });

  it("fails when captured currency does not match", () => {
    const details = {
      event: "payment.captured",
      paymentId: "pay_1",
      orderId: "order_legit_123",
      capturedPaise: 50000,
      capturedCurrency: "USD",
      intentId: "intent_1",
      notes: {},
    };
    const res = validateWebhookTransaction(intent, details);
    assert.equal(res.ok, false);
    assert.match(res.error, /Currency mismatch/);
  });

  it("fails when orderId does not match intent orderId", () => {
    const details = {
      event: "payment.captured",
      paymentId: "pay_1",
      orderId: "order_mismatch_456",
      capturedPaise: 50000,
      capturedCurrency: "INR",
      intentId: "intent_1",
      notes: {},
    };
    const res = validateWebhookTransaction(intent, details);
    assert.equal(res.ok, false);
    assert.match(res.error, /Order ID mismatch/);
  });
});

// ── 3. Concurrency & Idempotency Simulation (FIN-002) ────────────────────────

describe("FIN-002: Concurrency-Safe Transactional Processing", () => {
  function createTransactionalMockDb() {
    const storage = new Map();
    let writeLock = Promise.resolve();

    function createDocRef(path) {
      const parts = path.split("/");
      const id = parts[parts.length - 1];
      return {
        id,
        path,
        get: async () => ({
          exists: storage.has(path),
          data: () => storage.get(path),
          ref: { path, id },
        }),
        collection: (subCol) => ({
          doc: (subId) => createDocRef(`${path}/${subCol}/${subId}`),
        }),
      };
    }

    return {
      storage,
      collection: (col) => ({
        doc: (id) => createDocRef(`${col}/${id}`),
      }),
      runTransaction: async (updateFunction) => {
        // Serialize transactions to accurately model Firestore's OCC/lock behavior
        const previousLock = writeLock;
        let releaseLock;
        writeLock = new Promise((resolve) => {
          releaseLock = resolve;
        });

        await previousLock;
        try {
          const transactionContext = {
            get: async (ref) => {
              const path = ref.path;
              const exists = storage.has(path);
              return {
                exists,
                data: () => storage.get(path),
                ref,
              };
            },
            update: (ref, data) => {
              const current = storage.get(ref.path) || {};
              storage.set(ref.path, { ...current, ...data });
            },
            set: (ref, data) => {
              storage.set(ref.path, data);
            },
          };

          return await updateFunction(transactionContext);
        } finally {
          releaseLock();
        }
      },
    };
  }

  it("handles duplicate deliveries idempotently without re-executing writes", async () => {
    const mockDb = createTransactionalMockDb();
    const intentId = "intent_test_dup";
    mockDb.storage.set(`razorpayIntents/${intentId}`, {
      status: "pending",
      type: "match",
      matchId: "m1",
      paymentId: "p1",
      amount: 400,
      currency: "INR",
      orderId: "order_dup_1",
    });

    const eventDetails = {
      event: "payment.captured",
      paymentId: "pay_dup_999",
      orderId: "order_dup_1",
      capturedPaise: 40000,
      capturedCurrency: "INR",
      intentId,
      notes: { intentId },
    };

    // First delivery
    const res1 = await processWebhookIntentTransaction(mockDb, eventDetails);
    assert.equal(res1.success, true);
    assert.equal(res1.alreadyProcessed, undefined);

    // Intent should now be 'paid'
    const intentAfter = mockDb.storage.get(`razorpayIntents/${intentId}`);
    assert.equal(intentAfter.status, "paid");

    // Second delivery (duplicate delivery 5 minutes later)
    const res2 = await processWebhookIntentTransaction(mockDb, eventDetails);
    assert.equal(res2.success, true);
    assert.equal(res2.alreadyProcessed, true);
  });

  it("safely handles concurrent simultaneous webhook events (race condition)", async () => {
    const mockDb = createTransactionalMockDb();
    const intentId = "intent_race_1";
    mockDb.storage.set(`razorpayIntents/${intentId}`, {
      status: "pending",
      type: "match",
      matchId: "m1",
      paymentId: "p1",
      amount: 500,
      currency: "INR",
      orderId: "order_race_1",
      lateFeeItems: [
        { playerId: "player_1", label: "Late Fee", amount: 150, templateId: "lf_1" },
      ],
    });

    const capturedDetails = {
      event: "payment.captured",
      paymentId: "pay_race_1",
      orderId: "order_race_1",
      capturedPaise: 50000,
      capturedCurrency: "INR",
      intentId,
      notes: { intentId },
    };

    const orderPaidDetails = {
      event: "order.paid",
      paymentId: "pay_race_1",
      orderId: "order_race_1",
      capturedPaise: 50000,
      capturedCurrency: "INR",
      intentId,
      notes: { intentId },
    };

    // Simulate simultaneous arrivals
    const [result1, result2] = await Promise.all([
      processWebhookIntentTransaction(mockDb, capturedDetails),
      processWebhookIntentTransaction(mockDb, orderPaidDetails),
    ]);

    // Exactly one must be the primary processor, and the other must be flagged alreadyProcessed
    const results = [result1, result2];
    const processedPrimary = results.filter((r) => r.success && !r.alreadyProcessed);
    const skippedSecondary = results.filter((r) => r.success && r.alreadyProcessed);

    assert.equal(processedPrimary.length, 1);
    assert.equal(skippedSecondary.length, 1);

    // Verify exactly 1 late fee record was written across the whole database
    let lateFeeCount = 0;
    for (const [key] of mockDb.storage.entries()) {
      if (key.includes("otherFees")) {
        lateFeeCount++;
      }
    }
    assert.equal(lateFeeCount, 1);
  });
});
