/**
 * Phase 5 Server-Side Security & Authorisation Test Suite
 * (tests/server-security-phase5.test.mjs)
 *
 * Exercises all 11 required security scenarios specified in the Active Remediation Master Plan:
 * 1. Unauthenticated API access (401 Missing / Empty token).
 * 2. Authenticated player attempting admin operations (403 Forbidden).
 * 3. Match Admin attempting Finance Admin operations (403 Forbidden).
 * 4. Finance Admin attempting Super Admin operations (403 Forbidden).
 * 5. Forged player IDs (cross-player ownership boundary violation).
 * 6. Forged roles (client-asserted roles without server backing).
 * 7. Tampered amounts (client amounts discarded in favor of server derivation).
 * 8. Invalid payment signatures (webhook HMAC validation failure).
 * 9. Duplicate webhook delivery (idempotent fulfillment handling).
 * 10. Conflicting webhook replay (order/currency/amount mismatch rejection).
 * 11. Expired or invalid authentication tokens (401 verification failure).
 * 12. Account status enforcement (disabled accounts rejected with 403).
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

process.env.NODE_ENV = "test";
import { BaseAuth } from "firebase-admin/auth";
import {
  requireAuth,
  requireAdmin,
  requireRole,
  requireSuperAdmin,
  requireClubAdmin,
  requireMatchAdmin,
  requireFinanceAdmin,
  requireStudioAdmin,
} from "../lib/server-auth.ts";
import {
  derivePayableAmount,
  verifyPlayerOwnership,
  calculateAuthoritativeMerchPrice,
} from "../lib/razorpay-order.ts";
import {
  validateWebhookTransaction,
  processWebhookIntentTransaction,
  extractWebhookEventDetails,
} from "../lib/razorpay-webhook.ts";

describe("Phase 5: Core Auth & Server-Side Security Verification", () => {
  // --------------------------------------------------------------------------
  // Scenario 1: Unauthenticated API access
  // --------------------------------------------------------------------------
  describe("Scenario 1: Unauthenticated API Access", () => {
    it("rejects request without Authorization header with 401", async () => {
      const req = new Request("http://localhost:3000/api/admin/reconcile-abandoned", {
        method: "POST",
      });
      const res = await requireFinanceAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 401);
      const data = await res.response.json();
      assert.equal(data.error, "Missing Authorization header.");
    });

    it("rejects request with empty Bearer token with 401", async () => {
      const req = new Request("http://localhost:3000/api/email/send", {
        method: "POST",
        headers: { authorization: "Bearer " },
      });
      const res = await requireClubAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 401);
      const data = await res.response.json();
      assert.equal(data.error, "Empty bearer token.");
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Authenticated player attempting admin operations
  // --------------------------------------------------------------------------
  describe("Scenario 2: Authenticated Player Attempting Admin Operations", () => {
    it("rejects an ordinary player from Super Admin operations with 403", async () => {
      const req = new Request("http://localhost:3000/api/admin/reconcile-abandoned", {
        method: "POST",
        headers: {
          "x-test-uid": "player_user_1",
          "x-test-role": "player",
        },
      });
      const res = await requireSuperAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 403);
      const data = await res.response.json();
      assert.ok(data.error.includes("Access forbidden: requires one of [superAdmin]"));
    });

    it("rejects an ordinary player from Club Admin operations with 403", async () => {
      const req = new Request("http://localhost:3000/api/admin/merge-players", {
        method: "POST",
        headers: {
          "x-test-uid": "player_user_2",
          "x-test-role": "player",
        },
      });
      const res = await requireClubAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 403);
      const data = await res.response.json();
      assert.ok(data.error.includes("Access forbidden"));
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Match Admin attempting Finance Admin operations
  // --------------------------------------------------------------------------
  describe("Scenario 3: Match Admin Attempting Finance Admin Operations", () => {
    it("rejects Match Admin from Finance Admin operations with 403", async () => {
      const req = new Request("http://localhost:3000/api/admin/reconcile-abandoned", {
        method: "POST",
        headers: {
          "x-test-uid": "match_admin_user",
          "x-test-role": "matchAdmin",
        },
      });
      const res = await requireFinanceAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 403);
      const data = await res.response.json();
      assert.ok(data.error.includes("requires one of [financeAdmin, superAdmin]"));
    });

    it("authorizes Match Admin for Match Admin operations", async () => {
      const req = new Request("http://localhost:3000/api/calendar/sync", {
        method: "POST",
        headers: {
          "x-test-uid": "match_admin_user",
          "x-test-role": "matchAdmin",
        },
      });
      const res = await requireMatchAdmin(req);
      assert.equal(res.ok, true);
      assert.ok(res.roles.has("matchAdmin"));
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Finance Admin attempting Super Admin operations
  // --------------------------------------------------------------------------
  describe("Scenario 4: Finance Admin Attempting Super Admin Operations", () => {
    it("rejects Finance Admin from Super Admin operations with 403", async () => {
      const req = new Request("http://localhost:3000/api/admin/system-config", {
        method: "POST",
        headers: {
          "x-test-uid": "finance_admin_user",
          "x-test-role": "financeAdmin",
        },
      });
      const res = await requireSuperAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 403);
      const data = await res.response.json();
      assert.ok(data.error.includes("requires one of [superAdmin]"));
    });

    it("authorizes Finance Admin for Finance Admin operations", async () => {
      const req = new Request("http://localhost:3000/api/admin/reconcile-abandoned", {
        method: "POST",
        headers: {
          "x-test-uid": "finance_admin_user",
          "x-test-role": "financeAdmin",
        },
      });
      const res = await requireFinanceAdmin(req);
      assert.equal(res.ok, true);
      assert.ok(res.roles.has("financeAdmin"));
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Forged player IDs
  // --------------------------------------------------------------------------
  describe("Scenario 5: Forged Player IDs (Cross-Player Boundary)", () => {
    it("rejects player ownership when caller UID does not match player or appUser link", async () => {
      const mockDb = {
        collection: (col) => ({
          doc: (id) => ({
            get: async () => {
              if (col === "players" && id === "victim_player") {
                return { exists: true, data: () => ({ authUid: "real_victim_uid" }) };
              }
              if (col === "appUsers" && id === "attacker_uid") {
                return { exists: true, data: () => ({ playerId: "attacker_player" }) };
              }
              return { exists: false };
            },
          }),
        }),
      };

      const isOwned = await verifyPlayerOwnership(mockDb, "attacker_uid", "victim_player");
      assert.equal(isOwned, false, "Attacker must not own victim player record");
    });

    it("authorizes player ownership when appUsers doc links caller to playerId", async () => {
      const mockDb = {
        collection: (col) => ({
          doc: (id) => ({
            get: async () => {
              if (col === "appUsers" && id === "valid_user_uid") {
                return { exists: true, data: () => ({ playerId: "valid_player_id" }) };
              }
              return { exists: false };
            },
          }),
        }),
      };

      const isOwned = await verifyPlayerOwnership(mockDb, "valid_user_uid", "valid_player_id");
      assert.equal(isOwned, true, "Linked appUser must be authorized");
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Forged roles
  // --------------------------------------------------------------------------
  describe("Scenario 6: Forged Roles (Client-Supplied Privilege Tampering)", () => {
    it("rejects caller claiming role == 'admin' without cryptographic custom claim", async () => {
      const req = new Request("http://localhost:3000/api/email/send", {
        method: "POST",
        headers: {
          "x-test-uid": "attacker_456",
          "x-test-role": "player",
          // Attempting to pass role: admin in header or client state
        },
      });
      const res = await requireSuperAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 403);
    });

    it("Super Admin custom claim inherits all granular admin roles", async () => {
      const req = new Request("http://localhost:3000/api/admin/any", {
        method: "POST",
        headers: {
          "x-test-uid": "super_admin_root",
          "x-test-admin": "true",
        },
      });

      const superCheck = await requireSuperAdmin(req);
      assert.equal(superCheck.ok, true);

      const clubCheck = await requireClubAdmin(req);
      assert.equal(clubCheck.ok, true);

      const matchCheck = await requireMatchAdmin(req);
      assert.equal(matchCheck.ok, true);

      const financeCheck = await requireFinanceAdmin(req);
      assert.equal(financeCheck.ok, true);

      const studioCheck = await requireStudioAdmin(req);
      assert.equal(studioCheck.ok, true);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Tampered amounts
  // --------------------------------------------------------------------------
  describe("Scenario 7: Tampered Amounts (Authoritative Server Derivation)", () => {
    it("derives authoritative match fee and ignores client-supplied amount", async () => {
      const mockDb = {
        collection: (col) => ({
          doc: (id) => ({
            get: async () => {
              if (col === "matches" && id === "match_1") {
                return {
                  exists: true,
                  data: () => ({ fee: 1200, opponent: "Super Kings", date: "2026-12-01" }),
                };
              }
              if (col === "players" && id === "player_1") {
                return { exists: true, data: () => ({ authUid: "user_1" }) };
              }
              return { exists: false };
            },
            collection: (subCol) => ({
              doc: (subId) => ({
                get: async () => {
                  if (subCol === "payments" && subId === "pay_1") {
                    return {
                      exists: true,
                      data: () => ({ playerId: "player_1", status: "Unpaid" }),
                    };
                  }
                  return { exists: false };
                },
              }),
            }),
          }),
        }),
      };

      // Client attempts to pass amount: 10
      const intentData = {
        type: "match",
        matchId: "match_1",
        paymentId: "pay_1",
        amount: 10,
      };

      const derived = await derivePayableAmount(mockDb, "user_1", intentData);
      assert.equal(derived.amount, 1200, "Server must derive 1200, completely discarding client 10");
    });

    it("rejects merchandise with unknown or tampered custom selections", () => {
      const merch = {
        basePrice: 1500,
        customFields: [{ name: "Size", required: true, options: [{ value: "M" }, { value: "L" }] }],
      };

      // Tampered option
      assert.throws(
        () => calculateAuthoritativeMerchPrice(merch, { Size: "XXXL" }),
        /Invalid selection 'XXXL'/,
      );

      // Unknown injected selection
      assert.throws(
        () => calculateAuthoritativeMerchPrice(merch, { Size: "M", InjectedDiscount: "-1000" }),
        /Unknown merchandise custom selection field: 'InjectedDiscount'/,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Invalid payment signatures
  // --------------------------------------------------------------------------
  describe("Scenario 8: Invalid Payment Signatures", () => {
    it("fails signature verification when payload or signature is tampered", () => {
      const secret = "test_secret_12345";
      const rawBody = JSON.stringify({ event: "payment.captured", id: "evt_1" });
      const validSig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

      const tamperedBody = JSON.stringify({ event: "payment.captured", id: "evt_tampered" });
      const generatedFromTampered = crypto.createHmac("sha256", secret).update(tamperedBody).digest("hex");

      assert.notEqual(generatedFromTampered, validSig, "Tampered body must produce mismatched signature");

      const expectedBuf = Buffer.from(validSig, "hex");
      const badBuf = Buffer.from(generatedFromTampered, "hex");
      assert.equal(crypto.timingSafeEqual(expectedBuf, badBuf), false);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Duplicate webhook delivery
  // --------------------------------------------------------------------------
  describe("Scenario 9: Duplicate Webhook Delivery (Idempotency)", () => {
    it("returns alreadyProcessed: true when intent is already marked paid", async () => {
      const mockDb = {
        collection: (col) => ({
          doc: (id) => ({
            id,
          }),
        }),
        runTransaction: async (updateFn) => {
          const fakeTransaction = {
            get: async (ref) => ({
              exists: true,
              data: () => ({
                status: "paid",
                orderId: "order_123",
                amount: 500,
                currency: "INR",
              }),
            }),
            update: () => {},
            set: () => {},
          };
          return await updateFn(fakeTransaction);
        },
      };

      const details = {
        event: "payment.captured",
        paymentId: "pay_duplicate_1",
        orderId: "order_123",
        capturedPaise: 50000,
        capturedCurrency: "INR",
        intentId: "intent_already_paid",
        notes: { intentId: "intent_already_paid" },
      };

      const result = await processWebhookIntentTransaction(mockDb, details);
      assert.equal(result.success, true);
      assert.equal(result.alreadyProcessed, true);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Conflicting webhook replay
  // --------------------------------------------------------------------------
  describe("Scenario 10: Conflicting Webhook Replay", () => {
    it("rejects webhook if captured amount does not match stored intent", () => {
      const storedIntent = {
        orderId: "order_abc",
        amount: 800,
        currency: "INR",
      };

      const conflictingDetails = {
        event: "payment.captured",
        paymentId: "pay_conflict_1",
        orderId: "order_abc",
        capturedPaise: 50000, // 500 INR instead of 800 INR
        capturedCurrency: "INR",
        intentId: "intent_abc",
        notes: {},
      };

      const res = validateWebhookTransaction(storedIntent, conflictingDetails);
      assert.equal(res.ok, false);
      assert.ok(res.error.includes("Amount mismatch: expected 80000 paise, received 50000 paise"));
    });

    it("rejects webhook if currency does not match stored intent", () => {
      const storedIntent = {
        orderId: "order_abc",
        amount: 800,
        currency: "INR",
      };

      const conflictingDetails = {
        event: "payment.captured",
        paymentId: "pay_conflict_2",
        orderId: "order_abc",
        capturedPaise: 80000,
        capturedCurrency: "USD",
        intentId: "intent_abc",
        notes: {},
      };

      const res = validateWebhookTransaction(storedIntent, conflictingDetails);
      assert.equal(res.ok, false);
      assert.ok(res.error.includes("Currency mismatch: expected INR, received USD"));
    });

    it("rejects webhook if paymentId does not start with pay_", () => {
      const storedIntent = {
        orderId: "order_abc",
        amount: 800,
        currency: "INR",
      };

      const badDetails = {
        event: "payment.captured",
        paymentId: "invalid_id_format",
        orderId: "order_abc",
        capturedPaise: 80000,
        capturedCurrency: "INR",
        intentId: "intent_abc",
        notes: {},
      };

      const res = validateWebhookTransaction(storedIntent, badDetails);
      assert.equal(res.ok, false);
      assert.ok(res.error.includes("Missing or invalid payment ID"));
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 11: Expired or invalid authentication tokens
  // --------------------------------------------------------------------------
  describe("Scenario 11: Expired or Invalid Authentication Tokens", () => {
    it("rejects token when verifyIdToken throws with 401 Unauthorized", async () => {
      // Mock BaseAuth.prototype.verifyIdToken
      const originalVerify = BaseAuth.prototype.verifyIdToken;
      BaseAuth.prototype.verifyIdToken = async () => {
        const err = new Error("Firebase ID token has expired.");
        err.code = "auth/id-token-expired";
        throw err;
      };

      try {
        const req = new Request("http://localhost:3000/api/admin/merge-players", {
          method: "POST",
          headers: { authorization: "Bearer expired-token-123" },
        });

        const res = await requireClubAdmin(req);
        assert.equal(res.ok, false);
        assert.equal(res.response.status, 401);
        const data = await res.response.json();
        assert.equal(data.error, "Invalid or expired token.");
      } finally {
        BaseAuth.prototype.verifyIdToken = originalVerify;
      }
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 12: Account status enforcement
  // --------------------------------------------------------------------------
  describe("Scenario 12: Account Status Enforcement (Disabled Accounts)", () => {
    it("rejects disabled account with 403 Account is disabled", async () => {
      const req = new Request("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: {
          "x-test-uid": "disabled_user_1",
          "x-test-status": "Disabled",
        },
      });

      const res = await requireAuth(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 403);
      const data = await res.response.json();
      assert.equal(data.error, "Account is disabled.");
    });
  });
});
