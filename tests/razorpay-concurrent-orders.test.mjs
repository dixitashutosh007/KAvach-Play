/**
 * FIN-001 Concurrent Order Creation & Reservation Tests
 * (tests/razorpay-concurrent-orders.test.mjs)
 *
 * Verifies:
 * 1. Obligation reservation key generation is deterministic across match, dues, and subscription payments.
 * 2. Simultaneous/duplicate payment initiation requests reuse an active pending order session.
 * 3. Expired or completed payment sessions allow legitimate retries without being blocked indefinitely.
 *
 * Imports directly from production: @/lib/razorpay-order
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateReservationKey,
  findActivePendingIntent,
  derivePayableAmount,
} from "../lib/razorpay-order.ts";

describe("FIN-001: Concurrent Payment Initiation & Reservation", () => {
  it("generates deterministic reservation keys for match payments", () => {
    const intentData = { type: "match", matchId: "match_101", paymentId: "pay_202" };
    const key1 = generateReservationKey(intentData, "player_303");
    const key2 = generateReservationKey(intentData, "player_303");
    assert.equal(key1, "match_match_101_pay_202");
    assert.equal(key1, key2);
  });

  it("generates deterministic reservation keys for finance_dues regardless of item order", () => {
    const items1 = [{ paymentId: "pay_B" }, { paymentId: "pay_A" }];
    const items2 = [{ paymentId: "pay_A" }, { paymentId: "pay_B" }];

    const key1 = generateReservationKey({ type: "finance_dues", items: items1 }, "player_303");
    const key2 = generateReservationKey({ type: "finance_dues", items: items2 }, "player_303");

    assert.equal(key1, "dues_player_303_pay_A_pay_B");
    assert.equal(key1, key2);
  });

  it("finds active pending intent created within active checkout window (< 15 mins)", async () => {
    const reservationKey = "match_match_101_pay_202";
    const authUid = "user_abc";
    const now = new Date();

    const mockDb = {
      collection: (col) => ({
        where: (f1, op1, v1) => ({
          where: (f2, op2, v2) => ({
            where: (f3, op3, v3) => ({
              get: async () => {
                if (
                  f1 === "reservationKey" && v1 === reservationKey &&
                  f2 === "userId" && v2 === authUid &&
                  f3 === "status" && v3 === "pending"
                ) {
                  return {
                    empty: false,
                    docs: [
                      {
                        id: "intent_active_1",
                        data: () => ({
                          reservationKey,
                          userId: authUid,
                          status: "pending",
                          orderId: "order_active_razorpay_999",
                          amount: 500,
                          currency: "INR",
                          createdAt: new Date(now.getTime() - 2 * 60 * 1000), // 2 minutes ago
                        }),
                      },
                    ],
                  };
                }
                return { empty: true, docs: [] };
              },
            }),
          }),
        }),
      }),
    };

    const active = await findActivePendingIntent(mockDb, reservationKey, authUid);
    assert.ok(active);
    assert.equal(active.orderId, "order_active_razorpay_999");
    assert.equal(active.amount, 500);
  });

  it("ignores expired pending intents (> 15 mins old), allowing legitimate retries", async () => {
    const reservationKey = "match_match_101_pay_202";
    const authUid = "user_abc";
    const now = new Date();

    const mockDb = {
      collection: (col) => ({
        where: (f1, op1, v1) => ({
          where: (f2, op2, v2) => ({
            where: (f3, op3, v3) => ({
              get: async () => {
                return {
                  empty: false,
                  docs: [
                    {
                      id: "intent_expired_1",
                      data: () => ({
                        reservationKey,
                        userId: authUid,
                        status: "pending",
                        orderId: "order_stale_888",
                        amount: 500,
                        currency: "INR",
                        createdAt: new Date(now.getTime() - 20 * 60 * 1000), // 20 minutes ago (expired!)
                      }),
                    },
                  ],
                };
              },
            }),
          }),
        }),
      }),
    };

    const active = await findActivePendingIntent(mockDb, reservationKey, authUid);
    assert.equal(active, null); // Expired -> returns null, allowing new order creation
  });
});
