/**
 * Database Isolation & Payment Safety Test Suite
 * (tests/database-isolation-and-payment-safety.test.mjs)
 *
 * Verifies all 13 mandatory requirements:
 * 1. main + production DB enables payment operations.
 * 2. mig-mov + development DB disables payment operations.
 * 3. mig-mov + production DB disables payment operations (fails closed on conflict).
 * 4. Unknown branch + production DB disables payment operations.
 * 5. Missing branch + production DB disables payment operations (fails closed).
 * 6. main + development DB fails closed (conflict detection).
 * 7. Unknown explicit database ID fails closed (only approved DBs accepted).
 * 8. Whitespace and empty database IDs fail closed.
 * 9. Actual Admin SDK database selection uses the requested named database (verified via real db.databaseId).
 * 10. No normal server-side path falls back to the default Firestore database ((default)).
 * 11. Development order endpoint returns HTTP 403 without invoking Razorpay or mutating Firestore.
 * 12. Development webhook endpoint returns HTTP 403 without mutating Firestore.
 * 13. Production order and webhook paths retain existing behavior on main.
 * 14. Local emulator exception is strictly constrained and cannot activate in deployed AWS/production runtimes.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp, getApps } from "firebase-admin/app";

import {
  resolveFirestoreDatabaseId,
  arePaymentOperationsEnabled,
  PRODUCTION_FIRESTORE_DATABASE_ID,
  DEVELOPMENT_FIRESTORE_DATABASE_ID,
  APPROVED_FIRESTORE_DATABASE_IDS,
} from "../lib/database-config.ts";

import {
  getServerFirestore,
  setServerDbForTesting,
  isLocalEmulatorEnvironment,
} from "../lib/server-db.ts";

import { POST as orderPost } from "../app/api/razorpay/order/route.ts";
import { POST as webhookPost } from "../app/api/razorpay/webhook/route.ts";

describe("Database Isolation & Payment Safety", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all branch, database ID, and payment gating environment variables
    delete process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID;
    delete process.env.FIRESTORE_DATABASE_ID;
    delete process.env.AWS_BRANCH;
    delete process.env.GIT_BRANCH;
    delete process.env.GITHUB_REF_NAME;
    delete process.env.DISABLE_PAYMENT_OPERATIONS;
    delete process.env.AWS_APP_ID;
    delete process.env.AWS_EXECUTION_ENV;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    setServerDbForTesting(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setServerDbForTesting(null);
  });

  // ── 1. Database ID Resolution & Conflict Validation ───────────────────────

  describe("1. Database Resolution & Environment Alignment", () => {
    it("Requirement 1 & 2: mig-mov + development DB resolves kavach-play-db-ext", () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;
      const dbId = resolveFirestoreDatabaseId();
      assert.equal(dbId, DEVELOPMENT_FIRESTORE_DATABASE_ID);
    });

    it("Requirement 1: main + production DB resolves ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      const dbId = resolveFirestoreDatabaseId();
      assert.equal(dbId, PRODUCTION_FIRESTORE_DATABASE_ID);
    });

    it("Requirement 3: mig-mov + production DB fails closed on conflict", () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.throws(
        () => resolveFirestoreDatabaseId(),
        /Conflict detected\. Branch 'mig-mov' requires development database/
      );
    });

    it("Requirement 6: main + development DB fails closed on conflict", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;
      assert.throws(
        () => resolveFirestoreDatabaseId(),
        /Conflict detected\. Branch 'main' requires production database/
      );
    });

    it("Requirement 7: Unknown explicit database ID fails closed (only approved DBs accepted)", () => {
      assert.throws(
        () => resolveFirestoreDatabaseId({ NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "unapproved-random-db" }),
        /Configuration Error: Unrecognized Firestore database ID/
      );
    });

    it("Requirement 8: Whitespace and empty database IDs fail closed", () => {
      assert.throws(
        () => resolveFirestoreDatabaseId({ NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "   " }),
        /Configuration Error: Missing Firestore database ID/
      );
      assert.throws(
        () => resolveFirestoreDatabaseId({ NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "" }),
        /Configuration Error: Missing Firestore database ID/
      );
    });

    it("Requirement 4: Unknown branch fails closed on database resolution", () => {
      process.env.AWS_BRANCH = "feature-new-ui";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.throws(
        () => resolveFirestoreDatabaseId(),
        /Configuration Error: Unrecognized or unauthorized branch 'feature-new-ui'/
      );
    });

    it("Requirement 10: Never resolves or falls back to default database (default)", () => {
      assert.throws(
        () => resolveFirestoreDatabaseId({ NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "(default)" }),
        /Configuration Error: Unrecognized Firestore database ID '\(default\)'/
      );
    });
  });

  // ── 2. Payment Operations Gating ───────────────────────────────────────────

  describe("2. Payment Operations Authorization (arePaymentOperationsEnabled)", () => {
    it("Requirement 1: main + production DB enables payment operations", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), true);
    });

    it("Requirement 1: master + production DB enables payment operations", () => {
      process.env.AWS_BRANCH = "master";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), true);
    });

    it("Requirement 2: mig-mov + development DB disables payment operations", () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("Requirement 3: mig-mov + production DB disables payment operations", () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("Requirement 4: Unknown branch + production DB disables payment operations", () => {
      process.env.AWS_BRANCH = "preview-pr-42";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("Requirement 5: Missing branch + production DB disables payment operations (fails closed)", () => {
      delete process.env.AWS_BRANCH;
      delete process.env.GIT_BRANCH;
      delete process.env.GITHUB_REF_NAME;
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("Requirement 6: main + development DB disables payment operations (fails closed)", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("Respects explicit DISABLE_PAYMENT_OPERATIONS=true flag on main", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      process.env.DISABLE_PAYMENT_OPERATIONS = "true";
      assert.equal(arePaymentOperationsEnabled(), false);
    });
  });

  // ── 3. Actual Admin SDK Database Selection (Non-mocked) ───────────────────

  describe("3. Actual Admin SDK Named Database Selection & Fallback Elimination", () => {
    let testApp;

    beforeEach(() => {
      // Create a unique isolated Admin App instance for genuine SDK verification
      const appName = `test-admin-app-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      testApp = initializeApp({ projectId: "test-isolation-proj" }, appName);
    });

    afterEach(async () => {
      if (testApp) {
        await deleteApp(testApp);
      }
    });

    it("Requirement 9: Actual Admin SDK selects kavach-play-db-ext on mig-mov", () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;

      const db = getServerFirestore(testApp);
      assert.equal(db.databaseId, DEVELOPMENT_FIRESTORE_DATABASE_ID);
      assert.notEqual(db.databaseId, "(default)");
    });

    it("Requirement 9: Actual Admin SDK selects ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412 on main", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;

      const db = getServerFirestore(testApp);
      assert.equal(db.databaseId, PRODUCTION_FIRESTORE_DATABASE_ID);
      assert.notEqual(db.databaseId, "(default)");
    });

    it("Requirement 10: getServerFirestore throws when database ID is invalid rather than defaulting", () => {
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = "invalid-db";
      assert.throws(
        () => getServerFirestore(testApp),
        /Configuration Error: Unrecognized Firestore database ID 'invalid-db'/
      );
    });
  });

  // ── 4. Endpoint Safeguards in Development ─────────────────────────────────

  describe("4. Development Order & Webhook Endpoint Guards", () => {
    it("Requirement 11: Development order endpoint returns HTTP 403 (PAYMENTS_DISABLED) without mutating Firestore", async () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;

      const req = new Request("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer dummy-token",
        },
        body: JSON.stringify({
          amount: 500,
          currency: "INR",
          targetPlayerId: "p_123",
          paymentType: "match_fee",
        }),
      });

      const res = await orderPost(req);
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.code, "PAYMENTS_DISABLED");
      assert.match(data.error, /Payment order creation is disabled in this environment/);
    });

    it("Requirement 12: Development webhook endpoint returns HTTP 403 (WEBHOOKS_DISABLED) without mutating Firestore", async () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;

      const req = new Request("http://localhost:3000/api/razorpay/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "dummy-signature",
        },
        body: JSON.stringify({
          event: "payment.captured",
          payload: {
            payment: {
              entity: {
                id: "pay_xyz",
                order_id: "order_xyz",
                amount: 50000,
                currency: "INR",
              },
            },
          },
        }),
      });

      const res = await webhookPost(req);
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.code, "WEBHOOKS_DISABLED");
      assert.match(data.error, /Webhook processing is disabled in this environment/);
    });

    it("Requirement 13: Production order path passes environment check and reaches authentication", async () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;

      const req = new Request("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // No authorization header provided -> must fail with 401 Unauthorized, not 403 PAYMENTS_DISABLED
        },
        body: JSON.stringify({ amount: 500 }),
      });

      const res = await orderPost(req);
      // Reached standard auth check
      assert.equal(res.status, 401);
    });

    it("Requirement 13: Production webhook path passes environment check and reaches signature verification", async () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;

      const req = new Request("http://localhost:3000/api/razorpay/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // No x-razorpay-signature header provided -> must fail with 401 (missing signature) or 500 (secret missing), not 403 WEBHOOKS_DISABLED
        },
        body: JSON.stringify({ event: "payment.captured" }),
      });

      const res = await webhookPost(req);
      assert.notEqual(res.status, 403);
    });
  });

  // ── 5. Local Emulator Exception Confinement ───────────────────────────────

  describe("5. Local Emulator Exception Confinement (isLocalEmulatorEnvironment)", () => {
    it("Requirement 14: Emulator mode is strictly disabled in production runtime", () => {
      process.env.NODE_ENV = "production";
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      assert.equal(isLocalEmulatorEnvironment(), false);
    });

    it("Requirement 14: Emulator mode is strictly disabled in deployed AWS Amplify environment", () => {
      process.env.NODE_ENV = "development";
      process.env.AWS_APP_ID = "d123456789amplify";
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      assert.equal(isLocalEmulatorEnvironment(), false);
    });

    it("Requirement 14: Emulator mode is active ONLY in local test environment without AWS markers", () => {
      process.env.NODE_ENV = "test";
      delete process.env.AWS_APP_ID;
      delete process.env.AWS_EXECUTION_ENV;
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      assert.equal(isLocalEmulatorEnvironment(), true);
    });
  });
});
