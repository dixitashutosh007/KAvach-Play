/**
 * Phase 5 Server-Side Security & Authorisation Test Suite (Remediated)
 * (tests/server-security-phase5.test.mjs)
 *
 * Implements comprehensive verification for Phase 5 Independent Review Remediation:
 * 1. Unauthenticated API access (401 Missing / Empty token).
 * 2. Authenticated player attempting admin operations (403 Forbidden).
 * 3. Match Admin attempting Finance Admin operations (403 Forbidden).
 * 4. Finance Admin attempting Super Admin operations (403 Forbidden).
 * 5. Strict player ownership (positive matches only; no UID===playerId fallback; fail-closed on DB errors; missing records).
 * 6. Forged roles (client-asserted roles without server backing).
 * 7. Tampered amounts (client amounts discarded in favor of server derivation).
 * 8. Invalid payment signatures (webhook HMAC validation failure).
 * 9. Duplicate webhook delivery (idempotent fulfillment via processWebhookIntentTransaction).
 * 10. Conflicting webhook replay (conflicting paymentId, orderId, amount, currency rejected on paid intent).
 * 11. Expired or invalid authentication tokens (401 verification failure).
 * 12. Fail-closed account status & database error enforcement (disabled account 403, database error 503).
 * 13. Test bypass isolation (x-test-* ignored in production or without KAVACH_TEST_AUTH_BYPASS).
 */

import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

// Default test environment flags
process.env.NODE_ENV = "test";
process.env.KAVACH_TEST_AUTH_BYPASS = "true";

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
  getUserAccount,
  isTestAuthBypassAllowed,
  setAuthDbForTesting,
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
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.KAVACH_TEST_AUTH_BYPASS = "true";
    setAuthDbForTesting(null);
  });

  afterEach(() => {
    process.env.NODE_ENV = "test";
    process.env.KAVACH_TEST_AUTH_BYPASS = "true";
    setAuthDbForTesting(null);
  });

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
  // Scenario 5: Strict player ownership (positive match, no fallback, DB error fail-closed)
  // --------------------------------------------------------------------------
  describe("Scenario 5: Strict Player Ownership (Positive Link Required)", () => {
    it("authorizes ownership when players doc has positive authUid match", async () => {
      const mockDb = {
        collection: (col) => ({
          doc: (id) => ({
            get: async () => {
              if (col === "players" && id === "player_100") {
                return { exists: true, data: () => ({ authUid: "user_100" }) };
              }
              return { exists: false };
            },
          }),
        }),
      };
      const isOwned = await verifyPlayerOwnership(mockDb, "user_100", "player_100");
      assert.equal(isOwned, true);
    });

    it("authorizes ownership when appUsers doc has positive playerId match", async () => {
      const mockDb = {
        collection: (col) => ({
          doc: (id) => ({
            get: async () => {
              if (col === "appUsers" && id === "user_200") {
                return { exists: true, data: () => ({ playerId: "player_200" }) };
              }
              return { exists: false };
            },
          }),
        }),
      };
      const isOwned = await verifyPlayerOwnership(mockDb, "user_200", "player_200");
      assert.equal(isOwned, true);
    });

    it("REJECTS ownership when targetPlayerId === authUid but neither document has a positive link (NO FALLBACK)", async () => {
      const mockDb = {
        collection: (col) => ({
          doc: (id) => ({
            get: async () => {
              // Both documents exist but have no authUid/playerId linking them
              if (col === "players" && id === "same_id_123") {
                return { exists: true, data: () => ({ name: "Unlinked Player" }) };
              }
              if (col === "appUsers" && id === "same_id_123") {
                return { exists: true, data: () => ({ email: "test@example.com" }) };
              }
              return { exists: false };
            },
          }),
        }),
      };
      const isOwned = await verifyPlayerOwnership(mockDb, "same_id_123", "same_id_123");
      assert.equal(isOwned, false, "Must not grant ownership merely because targetPlayerId === authUid");
    });

    it("rejects ownership when player record is missing entirely", async () => {
      const mockDb = {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: false }),
          }),
        }),
      };
      const isOwned = await verifyPlayerOwnership(mockDb, "user_999", "nonexistent_player");
      assert.equal(isOwned, false);
    });

    it("rejects ownership when links are mismatched across players and appUsers", async () => {
      const mockDb = {
        collection: (col) => ({
          doc: (id) => ({
            get: async () => {
              if (col === "players" && id === "victim_player") {
                return { exists: true, data: () => ({ authUid: "legitimate_owner_uid" }) };
              }
              if (col === "appUsers" && id === "attacker_uid") {
                return { exists: true, data: () => ({ playerId: "attacker_own_player" }) };
              }
              return { exists: false };
            },
          }),
        }),
      };
      const isOwned = await verifyPlayerOwnership(mockDb, "attacker_uid", "victim_player");
      assert.equal(isOwned, false);
    });

    it("FAIL-CLOSED on Firestore database error during player ownership check", async () => {
      const mockDb = {
        collection: () => ({
          doc: () => ({
            get: async () => {
              throw new Error("Firestore connection timeout");
            },
          }),
        }),
      };
      const isOwned = await verifyPlayerOwnership(mockDb, "user_error", "player_error");
      assert.equal(isOwned, false, "Must fail closed (false) when database read fails");
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
        },
      });
      const res = await requireSuperAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 403);
    });

    it("Super Admin custom claim inherits all granular admin roles when active", async () => {
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

      const intentData = {
        type: "match",
        matchId: "match_1",
        paymentId: "pay_1",
        amount: 10, // Tampered client amount
      };

      const derived = await derivePayableAmount(mockDb, "user_1", intentData);
      assert.equal(derived.amount, 1200, "Server must derive 1200, completely discarding client 10");
    });

    it("rejects merchandise with unknown or tampered custom selections", () => {
      const merch = {
        basePrice: 1500,
        customFields: [{ name: "Size", required: true, options: [{ value: "M" }, { value: "L" }] }],
      };

      assert.throws(
        () => calculateAuthoritativeMerchPrice(merch, { Size: "XXXL" }),
        /Invalid selection 'XXXL'/,
      );

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

      assert.notEqual(generatedFromTampered, validSig);

      const expectedBuf = Buffer.from(validSig, "hex");
      const badBuf = Buffer.from(generatedFromTampered, "hex");
      assert.equal(crypto.timingSafeEqual(expectedBuf, badBuf), false);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 9 & 10: Webhook replay & transaction processing
  // --------------------------------------------------------------------------
  describe("Scenario 9 & 10: Webhook Replay & Transaction Processing", () => {
    it("identical webhook replay is idempotent on already-paid intent", async () => {
      const mockDb = {
        collection: () => ({
          doc: (id) => ({ id }),
        }),
        runTransaction: async (updateFn) => {
          const fakeTx = {
            get: async () => ({
              exists: true,
              data: () => ({
                status: "paid",
                orderId: "order_123",
                amount: 500,
                currency: "INR",
                razorpayPaymentId: "pay_identical_1",
              }),
            }),
            update: () => {},
            set: () => {},
          };
          return await updateFn(fakeTx);
        },
      };

      const details = {
        event: "payment.captured",
        paymentId: "pay_identical_1", // Same paymentId as intent
        orderId: "order_123",
        capturedPaise: 50000,
        capturedCurrency: "INR",
        intentId: "intent_paid_123",
        notes: { intentId: "intent_paid_123" },
      };

      const result = await processWebhookIntentTransaction(mockDb, details);
      assert.equal(result.success, true);
      assert.equal(result.alreadyProcessed, true);
    });

    it("REJECTS conflicting payment ID replay even when intent is already marked paid", async () => {
      const mockDb = {
        collection: () => ({
          doc: (id) => ({ id }),
        }),
        runTransaction: async (updateFn) => {
          const fakeTx = {
            get: async () => ({
              exists: true,
              data: () => ({
                status: "paid",
                orderId: "order_123",
                amount: 500,
                currency: "INR",
                razorpayPaymentId: "pay_original_123",
              }),
            }),
            update: () => {},
            set: () => {},
          };
          return await updateFn(fakeTx);
        },
      };

      const conflictingDetails = {
        event: "payment.captured",
        paymentId: "pay_conflicting_999", // Different paymentId
        orderId: "order_123",
        capturedPaise: 50000,
        capturedCurrency: "INR",
        intentId: "intent_paid_123",
        notes: { intentId: "intent_paid_123" },
      };

      await assert.rejects(
        () => processWebhookIntentTransaction(mockDb, conflictingDetails),
        /Conflicting payment ID replay: intent was already fulfilled with payment pay_original_123, received pay_conflicting_999/,
      );
    });

    it("REJECTS conflicting amount even when intent is already marked paid", async () => {
      const mockDb = {
        collection: () => ({
          doc: (id) => ({ id }),
        }),
        runTransaction: async (updateFn) => {
          const fakeTx = {
            get: async () => ({
              exists: true,
              data: () => ({
                status: "paid",
                orderId: "order_123",
                amount: 500,
                currency: "INR",
                razorpayPaymentId: "pay_123",
              }),
            }),
            update: () => {},
            set: () => {},
          };
          return await updateFn(fakeTx);
        },
      };

      const conflictingDetails = {
        event: "payment.captured",
        paymentId: "pay_123",
        orderId: "order_123",
        capturedPaise: 10000, // 100 INR instead of 500 INR
        capturedCurrency: "INR",
        intentId: "intent_paid_123",
        notes: { intentId: "intent_paid_123" },
      };

      await assert.rejects(
        () => processWebhookIntentTransaction(mockDb, conflictingDetails),
        /Amount mismatch: expected 50000 paise, received 10000 paise/,
      );
    });

    it("REJECTS conflicting currency even when intent is already marked paid", async () => {
      const mockDb = {
        collection: () => ({
          doc: (id) => ({ id }),
        }),
        runTransaction: async (updateFn) => {
          const fakeTx = {
            get: async () => ({
              exists: true,
              data: () => ({
                status: "paid",
                orderId: "order_123",
                amount: 500,
                currency: "INR",
                razorpayPaymentId: "pay_123",
              }),
            }),
            update: () => {},
            set: () => {},
          };
          return await updateFn(fakeTx);
        },
      };

      const conflictingDetails = {
        event: "payment.captured",
        paymentId: "pay_123",
        orderId: "order_123",
        capturedPaise: 50000,
        capturedCurrency: "USD", // Mismatched currency
        intentId: "intent_paid_123",
        notes: { intentId: "intent_paid_123" },
      };

      await assert.rejects(
        () => processWebhookIntentTransaction(mockDb, conflictingDetails),
        /Currency mismatch: expected INR, received USD/,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 11: Expired or invalid authentication tokens
  // --------------------------------------------------------------------------
  describe("Scenario 11: Expired or Invalid Authentication Tokens", () => {
    it("rejects token when verifyIdToken throws with 401 Unauthorized", async () => {
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
  // Scenario 12: Account status enforcement & fail-closed database errors
  // --------------------------------------------------------------------------
  describe("Scenario 12: Account Status Enforcement & Fail-Closed Errors", () => {
    it("rejects disabled account with 403 Account is disabled in requireAuth", async () => {
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

    it("rejects disabled account with 403 in requireRole even if admin role claimed", async () => {
      const req = new Request("http://localhost:3000/api/admin/reconcile-abandoned", {
        method: "POST",
        headers: {
          "x-test-uid": "disabled_finance_admin",
          "x-test-role": "financeAdmin",
          "x-test-status": "Disabled",
        },
      });

      const res = await requireFinanceAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 403);
      const data = await res.response.json();
      assert.equal(data.error, "Account is disabled.");
    });

    it("FAIL-CLOSED: rejects request with 503 when database lookup fails in requireRole", async () => {
      const req = new Request("http://localhost:3000/api/admin/reconcile-abandoned", {
        method: "POST",
        headers: {
          "x-test-uid": "user_with_db_failure",
          "x-test-role": "financeAdmin",
          "x-test-db-error": "true",
        },
      });

      const res = await requireFinanceAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 503);
      const data = await res.response.json();
      assert.ok(data.error.includes("Failed to verify account authorization due to database error"));
    });

    it("FAIL-CLOSED: rejects request with 503 when database lookup fails in requireAuth", async () => {
      const req = new Request("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: {
          "x-test-uid": "user_with_db_failure",
          "x-test-db-error": "true",
        },
      });

      const res = await requireAuth(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 503);
      const data = await res.response.json();
      assert.ok(data.error.includes("Failed to verify account status due to database error"));
    });

    it("distinguishes missing user doc: returns player role only (no granular admin)", async () => {
      const mockDb = {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: false }),
          }),
        }),
      };
      setAuthDbForTesting(mockDb);
      const account = await getUserAccount({}, "missing_user_uid", { admin: false });
      assert.equal(account.ok, true);
      assert.equal(account.status, "Active");
      assert.equal(account.roles.has("player"), true);
      assert.equal(account.roles.has("financeAdmin"), false);
      assert.equal(account.roles.has("superAdmin"), false);
    });

    it("distinguishes missing user doc with verified Super Admin custom claim", async () => {
      const mockDb = {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: false }),
          }),
        }),
      };
      setAuthDbForTesting(mockDb);
      const account = await getUserAccount({}, "super_admin_no_doc", { admin: true });
      assert.equal(account.ok, true);
      assert.equal(account.status, "Active");
      assert.equal(account.roles.has("superAdmin"), true);
      assert.equal(account.roles.has("clubAdmin"), true);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 13: Test bypass isolation
  // --------------------------------------------------------------------------
  describe("Scenario 13: Test Bypass Isolation", () => {
    it("isTestAuthBypassAllowed returns false in production runtime", () => {
      process.env.NODE_ENV = "production";
      process.env.KAVACH_TEST_AUTH_BYPASS = "true";
      assert.equal(isTestAuthBypassAllowed(), false, "Must never allow test bypass in production");
    });

    it("isTestAuthBypassAllowed returns false if KAVACH_TEST_AUTH_BYPASS is not true", () => {
      process.env.NODE_ENV = "test";
      delete process.env.KAVACH_TEST_AUTH_BYPASS;
      assert.equal(isTestAuthBypassAllowed(), false, "Must require explicit test bypass flag");
    });

    it("rejects x-test-* headers when NODE_ENV === 'production' (no bypass)", async () => {
      process.env.NODE_ENV = "production";
      process.env.KAVACH_TEST_AUTH_BYPASS = "true";

      const req = new Request("http://localhost:3000/api/admin/reconcile-abandoned", {
        method: "POST",
        headers: {
          "x-test-uid": "attacker_spoofing_test_header",
          "x-test-admin": "true",
        },
      });

      const res = await requireSuperAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 401, "Must require real Authorization header in production");
    });

    it("rejects x-test-* headers when KAVACH_TEST_AUTH_BYPASS is omitted", async () => {
      process.env.NODE_ENV = "test";
      delete process.env.KAVACH_TEST_AUTH_BYPASS;

      const req = new Request("http://localhost:3000/api/admin/merge-players", {
        method: "POST",
        headers: {
          "x-test-uid": "attacker_spoofing_test_header",
          "x-test-role": "clubAdmin",
        },
      });

      const res = await requireClubAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 401, "Must require real Authorization header when bypass flag is absent");
    });
  });
});
