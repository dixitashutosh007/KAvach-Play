/**
 * FIN-003 Razorpay Webhook Strict Negative Tests
 * (tests/razorpay-webhook-negative.test.mjs)
 *
 * Verifies strict validation and error handling for:
 * 1. Missing order ID (stored intent or incoming webhook)
 * 2. Missing payment ID on payment.captured
 * 3. Missing amount
 * 4. Missing currency (no silent defaulting)
 * 5. Incorrect order ID
 * 6. Incorrect amount (paise vs rupees mismatch)
 * 7. Incorrect currency
 * 8. Unsupported event types
 * 9. Partial payment on order.paid
 * 10. Malformed payloads
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

describe("FIN-003: Strict Razorpay Webhook Negative Tests", () => {
  const baseIntent = {
    amount: 500, // ₹500
    currency: "INR",
    orderId: "order_KAvachExpected123",
  };

  const validCapturedDetails = {
    event: "payment.captured",
    paymentId: "pay_KAvach999",
    orderId: "order_KAvachExpected123",
    capturedPaise: 50000,
    capturedCurrency: "INR",
    intentId: "intent_123",
    notes: {},
  };

  // 1. Missing Order ID
  it("rejects when stored intent is missing an orderId", () => {
    const intentWithoutOrder = { ...baseIntent, orderId: "" };
    const res = validateWebhookTransaction(intentWithoutOrder, validCapturedDetails);
    assert.equal(res.ok, false);
    assert.match(res.error, /Stored intent is missing a valid orderId/);
  });

  it("rejects when incoming webhook details is missing an orderId", () => {
    const detailsWithoutOrder = { ...validCapturedDetails, orderId: "" };
    const res = validateWebhookTransaction(baseIntent, detailsWithoutOrder);
    assert.equal(res.ok, false);
    assert.match(res.error, /Incoming webhook event is missing a valid orderId/);
  });

  // 2. Missing Payment ID on payment.captured
  it("rejects when payment.captured is missing a valid paymentId", () => {
    const detailsWithoutPaymentId = { ...validCapturedDetails, paymentId: "" };
    const res = validateWebhookTransaction(baseIntent, detailsWithoutPaymentId);
    assert.equal(res.ok, false);
    assert.match(res.error, /Missing or invalid payment ID/);
  });

  // 3. Missing Amount
  it("rejects when captured amount is 0, negative, or missing", () => {
    const detailsZeroAmount = { ...validCapturedDetails, capturedPaise: 0 };
    const res = validateWebhookTransaction(baseIntent, detailsZeroAmount);
    assert.equal(res.ok, false);
    assert.match(res.error, /Missing or invalid captured amount/);
  });

  // 4. Missing Currency (No Silent Defaulting)
  it("rejects when stored intent is missing a valid currency", () => {
    const intentNoCurrency = { ...baseIntent, currency: "" };
    const res = validateWebhookTransaction(intentNoCurrency, validCapturedDetails);
    assert.equal(res.ok, false);
    assert.match(res.error, /Stored intent is missing a valid currency/);
  });

  it("rejects when currency is missing from webhook payload", () => {
    const detailsNoCurrency = { ...validCapturedDetails, capturedCurrency: "" };
    const res = validateWebhookTransaction(baseIntent, detailsNoCurrency);
    assert.equal(res.ok, false);
    assert.match(res.error, /Missing currency in webhook payload/);
  });

  it("extractWebhookEventDetails does NOT silently default missing currency to INR", () => {
    const payloadNoCurrency = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_123",
            order_id: "order_123",
            amount: 50000,
            // currency omitted!
          },
        },
      },
    };
    const details = extractWebhookEventDetails(payloadNoCurrency);
    assert.ok(details);
    assert.equal(details.capturedCurrency, ""); // must be empty string, not "INR"
  });

  // 5. Incorrect Order ID
  it("rejects when order ID does not match stored intent", () => {
    const detailsWrongOrder = { ...validCapturedDetails, orderId: "order_hacked_456" };
    const res = validateWebhookTransaction(baseIntent, detailsWrongOrder);
    assert.equal(res.ok, false);
    assert.match(res.error, /Order ID mismatch/);
  });

  // 6. Incorrect Amount
  it("rejects when captured paise does not match expected amount", () => {
    const detailsWrongAmount = { ...validCapturedDetails, capturedPaise: 100 }; // ₹1
    const res = validateWebhookTransaction(baseIntent, detailsWrongAmount);
    assert.equal(res.ok, false);
    assert.match(res.error, /Amount mismatch/);
  });

  // 7. Incorrect Currency
  it("rejects when captured currency is USD instead of INR", () => {
    const detailsWrongCurrency = { ...validCapturedDetails, capturedCurrency: "USD" };
    const res = validateWebhookTransaction(baseIntent, detailsWrongCurrency);
    assert.equal(res.ok, false);
    assert.match(res.error, /Currency mismatch/);
  });

  // 8. Unsupported Event Types
  it("rejects unexpected or unsupported webhook event types", () => {
    const detailsBadEvent = { ...validCapturedDetails, event: "refund.processed" };
    const res = validateWebhookTransaction(baseIntent, detailsBadEvent);
    assert.equal(res.ok, false);
    assert.match(res.error, /Unsupported webhook event type/);
  });

  it("extractWebhookEventDetails returns null for unsupported event types", () => {
    const payload = {
      event: "subscription.cancelled",
      payload: {
        subscription: { entity: { id: "sub_123" } },
      },
    };
    assert.equal(extractWebhookEventDetails(payload), null);
  });

  // 9. Partial Payment on order.paid
  it("rejects partial payment on order.paid event", () => {
    const partialOrderPayload = {
      event: "order.paid",
      payload: {
        order: {
          entity: {
            id: "order_KAvachExpected123",
            payment_id: "pay_partial_test_123",
            amount: 50000,
            amount_paid: 25000, // Partial: ₹250 of ₹500
            status: "attempted",
            currency: "INR",
            notes: { intentId: "intent_123" },
          },
        },
      },
    };
    const details = extractWebhookEventDetails(partialOrderPayload);
    assert.ok(details);
    assert.equal(details.isFullyPaid, false);

    const res = validateWebhookTransaction(baseIntent, details);
    assert.equal(res.ok, false);
    assert.match(res.error, /Partial payment detected/);
  });

  // 10. Malformed Payloads
  it("extractWebhookEventDetails safely returns null for malformed payloads", () => {
    assert.equal(extractWebhookEventDetails(null), null);
    assert.equal(extractWebhookEventDetails(undefined), null);
    assert.equal(extractWebhookEventDetails("not-an-object"), null);
    assert.equal(extractWebhookEventDetails({}), null);
    assert.equal(extractWebhookEventDetails({ event: "payment.captured" }), null);
    assert.equal(extractWebhookEventDetails({ event: "payment.captured", payload: {} }), null);
  });

  // 11. FIN-003: Mandatory Payment ID on order.paid
  it("rejects order.paid when payment ID is missing or empty", () => {
    const orderPaidWithoutPaymentId = {
      event: "order.paid",
      payload: {
        order: {
          entity: {
            id: "order_KAvachExpected123",
            amount: 50000,
            amount_paid: 50000,
            status: "paid",
            currency: "INR",
            notes: { intentId: "intent_123" },
            // payment_id omitted, payments omitted
          },
        },
      },
    };
    const details = extractWebhookEventDetails(orderPaidWithoutPaymentId);
    assert.ok(details);
    assert.equal(details.paymentId, ""); // empty paymentId

    const res = validateWebhookTransaction(baseIntent, details);
    assert.equal(res.ok, false);
    assert.match(res.error, /Missing or invalid payment ID \(must start with 'pay_'\)/);
  });

  it("rejects order.paid when payment ID does not start with pay_", () => {
    const orderPaidMalformedPaymentId = {
      event: "order.paid",
      payload: {
        order: {
          entity: {
            id: "order_KAvachExpected123",
            amount: 50000,
            amount_paid: 50000,
            status: "paid",
            currency: "INR",
            payment_id: "invalid_id_format_not_pay",
            notes: { intentId: "intent_123" },
          },
        },
      },
    };
    const details = extractWebhookEventDetails(orderPaidMalformedPaymentId);
    assert.ok(details);
    assert.equal(details.paymentId, ""); // filtered out because does not start with pay_

    const res = validateWebhookTransaction(baseIntent, details);
    assert.equal(res.ok, false);
    assert.match(res.error, /Missing or invalid payment ID/);
  });

  it("rejects order.paid when payment ID is prefix-only 'pay_' with no identifier", () => {
    const detailsPrefixOnly = {
      ...validCapturedDetails,
      paymentId: "pay_",
    };
    const res = validateWebhookTransaction(baseIntent, detailsPrefixOnly);
    assert.equal(res.ok, false);
    assert.match(res.error, /Missing or invalid payment ID/);
  });

  it("filters out invalid order ID in payment entity that lacks 'order_' prefix", () => {
    const payloadBadOrder = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_valid123",
            order_id: "fake_order_without_prefix",
            amount: 50000,
            currency: "INR",
            notes: { intentId: "intent_123" },
          },
        },
      },
    };
    const details = extractWebhookEventDetails(payloadBadOrder);
    assert.ok(details);
    assert.equal(details.orderId, ""); // filtered out because no order_ prefix

    const res = validateWebhookTransaction(baseIntent, details);
    assert.equal(res.ok, false);
    assert.match(res.error, /Incoming webhook event is missing a valid orderId/);
  });

  it("ensures rejected event leaves intent and downstream records completely unchanged", async () => {
    const store = new Map();
    store.set("razorpayIntents/intent_test_101", {
      status: "pending",
      orderId: "order_KAvachExpected123",
      amount: 500,
      currency: "INR",
      type: "match",
      matchId: "match_xyz",
      paymentId: "pay_record_abc",
    });
    store.set("matches/match_xyz/payments/pay_record_abc", {
      status: "Unpaid",
      playerId: "player_001",
    });

    const mockDb = {
      collection: (col) => ({
        doc: (docId) => {
          const key = `${col}/${docId}`;
          return {
            id: docId,
            path: key,
            ref: { id: docId, path: key },
            get: async () => ({
              exists: store.has(key),
              data: () => store.get(key),
            }),
          };
        },
      }),
      runTransaction: async (txFn) => {
        const tx = {
          get: async (ref) => ref.get(),
          set: (ref, val) => store.set(ref.path, val),
          update: (ref, val) => store.set(ref.path, { ...(store.get(ref.path) || {}), ...val }),
          create: (ref, val) => {
            if (store.has(ref.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
            store.set(ref.path, val);
          },
        };
        return await txFn(tx);
      },
    };

    // Invalid details lacking valid paymentId
    const invalidDetails = {
      event: "order.paid",
      intentId: "intent_test_101",
      orderId: "order_KAvachExpected123",
      paymentId: "", // Missing payment ID!
      capturedPaise: 50000,
      capturedCurrency: "INR",
      isFullyPaid: true,
      notes: {},
    };

    // Processing must fail with error
    await assert.rejects(
      async () => {
        await processWebhookIntentTransaction(mockDb, invalidDetails);
      },
      /Missing or invalid payment ID/,
    );

    // Verify intent status is STILL "pending"
    const intentAfter = store.get("razorpayIntents/intent_test_101");
    assert.equal(intentAfter.status, "pending");

    // Verify downstream match payment is STILL "Unpaid" and has no razorpayPaymentId
    const paymentAfter = store.get("matches/match_xyz/payments/pay_record_abc");
    assert.equal(paymentAfter.status, "Unpaid");
    assert.equal(paymentAfter.razorpayPaymentId, undefined);
  });
});
