/**
 * Database Isolation & Payment Safety Comprehensive Test Suite
 * (tests/database-isolation-and-payment-safety.test.mjs)
 *
 * Verifies all security and isolation requirements from the independent audit:
 *
 * 1. P0: arePaymentOperationsEnabled() strict authorization
 *    - Only main/master with approved production database enables payments.
 *    - mig-mov, preview branches, feature branches, unknown branches, missing branch,
 *      NODE_ENV=production on non-main branches, and conflicting DBs all return false.
 *
 * 2. P1: resolveFirestoreDatabaseId() strict validation & conflict detection
 *    - Allows only approved production and development database IDs.
 *    - Rejects arbitrary IDs, malformed values, whitespace, and (default).
 *    - Enforces mig-mov -> kavach-play-db-ext and main/master -> ai-studio-...
 *    - Throws clear configuration errors on conflicts or unrecognized branches.
 *
 * 3. P1: Actual Admin SDK named database selection & fallback elimination
 *    - Uses controlled injection seam (setFirestoreFactoryForTesting) and real SDK inspection.
 *    - Confirms getFirestore(app, "kavach-play-db-ext") on mig-mov.
 *    - Confirms getFirestore(app, "ai-studio-...") on main.
 *    - Confirms no-argument getFirestore(app) is NEVER called in deployed/non-emulator paths.
 *    - Confirms initialization errors propagate immediately without fallback.
 *
 * 4. P1: Firestore emulator exception restriction
 *    - Emulator exception active ONLY in local test run without AWS markers.
 *    - Deployed Amplify runtimes (AWS_APP_ID / AWS_EXECUTION_ENV) or NODE_ENV=production
 *      cannot bypass named database selection even if FIRESTORE_EMULATOR_HOST is set.
 *
 * 5. P1: Payment route behavior (Order and Webhook)
 *    - All non-production combinations return HTTP 403 without initializing Firestore,
 *      instantiating Razorpay, or creating reservations/intents.
 *    - main + production DB passes the authorization gate to standard auth/signature checks.
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import Razorpay from "razorpay";

import {
  resolveFirestoreDatabaseId,
  arePaymentOperationsEnabled,
  isStagingTestCheckoutEnabled,
  PRODUCTION_FIRESTORE_DATABASE_ID,
  DEVELOPMENT_FIRESTORE_DATABASE_ID,
  APPROVED_FIRESTORE_DATABASE_IDS,
} from "../lib/database-config.ts";

import {
  getServerFirestore,
  setServerDbForTesting,
  setFirestoreFactoryForTesting,
  isLocalEmulatorEnvironment,
} from "../lib/server-db.ts";

import { POST as orderPost } from "../app/api/razorpay/order/route.ts";
import { POST as webhookPost } from "../app/api/razorpay/webhook/route.ts";

describe("Database Isolation & Payment Safety Verification", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
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
    setFirestoreFactoryForTesting(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setServerDbForTesting(null);
    setFirestoreFactoryForTesting(null);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 1: P0 Payment Authorization Matrix
  // ══════════════════════════════════════════════════════════════════════════

  describe("1. P0: Strict Production Branch Payment Authorization", () => {
    it("enables payment operations ONLY when branch is 'main' AND DB is production", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), true);
    });

    it("enables payment operations when branch is 'master' AND DB is production", () => {
      process.env.AWS_BRANCH = "master";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), true);
    });

    it("disables payment operations on 'mig-mov' with development DB", () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("disables payment operations on 'mig-mov' even if configured with production DB", () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("disables payment operations on preview branches (e.g. 'preview-pr-101')", () => {
      process.env.AWS_BRANCH = "preview-pr-101";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("disables payment operations on feature branches (e.g. 'feature/payments')", () => {
      process.env.AWS_BRANCH = "feature/payments";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("disables payment operations on unknown branches", () => {
      process.env.AWS_BRANCH = "unknown-sandbox-branch";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("disables payment operations when branch identity is missing (fails closed)", () => {
      delete process.env.AWS_BRANCH;
      delete process.env.GIT_BRANCH;
      delete process.env.GITHUB_REF_NAME;
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("disables payment operations on 'main' when DB is development (conflict fails closed)", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("disables payment operations when DISABLE_PAYMENT_OPERATIONS='true' on main", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      process.env.DISABLE_PAYMENT_OPERATIONS = "true";
      assert.equal(arePaymentOperationsEnabled(), false);
    });

    it("does NOT infer production from NODE_ENV='production' on non-main branches", () => {
      process.env.NODE_ENV = "production";
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);

      process.env.AWS_BRANCH = "preview-staging";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(arePaymentOperationsEnabled(), false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 2: P1 Database ID & Branch Validation
  // ══════════════════════════════════════════════════════════════════════════

  describe("2. P1: Database ID & Branch Validation (resolveFirestoreDatabaseId)", () => {
    it("resolves development DB for mig-mov", () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;
      assert.equal(resolveFirestoreDatabaseId(), DEVELOPMENT_FIRESTORE_DATABASE_ID);
    });

    it("resolves production DB for main", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(resolveFirestoreDatabaseId(), PRODUCTION_FIRESTORE_DATABASE_ID);
    });

    it("resolves production DB for master", () => {
      process.env.AWS_BRANCH = "master";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.equal(resolveFirestoreDatabaseId(), PRODUCTION_FIRESTORE_DATABASE_ID);
    });

    it("throws configuration error when mig-mov specifies production DB (conflict)", () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.throws(
        () => resolveFirestoreDatabaseId(),
        /Conflict detected\. Branch 'mig-mov' requires development database/
      );
    });

    it("throws configuration error when main specifies development DB (conflict)", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;
      assert.throws(
        () => resolveFirestoreDatabaseId(),
        /Conflict detected\. Branch 'main' requires production database/
      );
    });

    it("rejects arbitrary / unapproved database IDs", () => {
      assert.throws(
        () => resolveFirestoreDatabaseId({ NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "arbitrary-custom-database" }),
        /Configuration Error: Unrecognized Firestore database ID 'arbitrary-custom-database'/
      );
    });

    it("rejects default database name (default)", () => {
      assert.throws(
        () => resolveFirestoreDatabaseId({ NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "(default)" }),
        /Configuration Error: Unrecognized Firestore database ID '\(default\)'/
      );
    });

    it("rejects whitespace and empty database IDs", () => {
      assert.throws(
        () => resolveFirestoreDatabaseId({ NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "   " }),
        /Configuration Error: Missing Firestore database ID/
      );
      assert.throws(
        () => resolveFirestoreDatabaseId({ NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "" }),
        /Configuration Error: Missing Firestore database ID/
      );
    });

    it("fails closed when branch is unknown", () => {
      process.env.AWS_BRANCH = "feature-experimental";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;
      assert.throws(
        () => resolveFirestoreDatabaseId(),
        /Configuration Error: Unrecognized or unauthorized branch 'feature-experimental'/
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 3: P1 Admin SDK Database Selection Verification
  // ══════════════════════════════════════════════════════════════════════════

  describe("3. P1: Admin SDK Database Selection & Fallback Elimination", () => {
    let testApp;
    let recordedCalls;

    beforeEach(() => {
      const appName = `admin-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      testApp = initializeApp({ projectId: "test-isolation-proj" }, appName);
      recordedCalls = [];

      setFirestoreFactoryForTesting((...args) => {
        recordedCalls.push({ app: args[0], databaseId: args[1], argCount: args.length });
        return { databaseId: args[1], mockedInstance: true };
      });
    });

    afterEach(async () => {
      setFirestoreFactoryForTesting(null);
      if (testApp) {
        await deleteApp(testApp);
      }
    });

    it("invokes getFirestore(adminApp, 'kavach-play-db-ext') on mig-mov with exact arguments", () => {
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;

      const db = getServerFirestore(testApp);
      assert.equal(recordedCalls.length, 1);
      assert.equal(recordedCalls[0].databaseId, DEVELOPMENT_FIRESTORE_DATABASE_ID);
      assert.equal(db.databaseId, DEVELOPMENT_FIRESTORE_DATABASE_ID);
    });

    it("invokes getFirestore(adminApp, 'ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412') on main", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;

      const db = getServerFirestore(testApp);
      assert.equal(recordedCalls.length, 1);
      assert.equal(recordedCalls[0].databaseId, PRODUCTION_FIRESTORE_DATABASE_ID);
      assert.equal(db.databaseId, PRODUCTION_FIRESTORE_DATABASE_ID);
    });

    it("NEVER calls no-argument getFirestore(adminApp) as a fallback in non-emulator execution", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;

      getServerFirestore(testApp);
      assert.equal(recordedCalls.length, 1);
      assert.ok(recordedCalls[0].databaseId !== undefined, "databaseId must never be undefined");
      assert.notEqual(recordedCalls[0].databaseId, "(default)");
    });

    it("prevents Firestore initialization when database ID is invalid", () => {
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = "invalid-db";
      assert.throws(
        () => getServerFirestore(testApp),
        /Configuration Error: Unrecognized Firestore database ID 'invalid-db'/
      );
      assert.equal(recordedCalls.length, 0, "Factory must never be invoked on invalid database ID");
    });

    it("propagates factory initialization error without falling back to default database", () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;

      setFirestoreFactoryForTesting((app, dbId) => {
        throw new Error(`Connection to database '${dbId}' failed.`);
      });

      assert.throws(
        () => getServerFirestore(testApp),
        /Connection to database 'ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412' failed\./
      );
    });

    it("verifies real Admin SDK instance property databaseId without mock overrides", () => {
      setFirestoreFactoryForTesting(null); // Use real Admin SDK
      process.env.AWS_BRANCH = "mig-mov";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = DEVELOPMENT_FIRESTORE_DATABASE_ID;

      const db = getServerFirestore(testApp);
      assert.equal(db.databaseId, DEVELOPMENT_FIRESTORE_DATABASE_ID);
      assert.notEqual(db.databaseId, "(default)");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 4: P1 Firestore Emulator Exception Restriction
  // ══════════════════════════════════════════════════════════════════════════

  describe("4. P1: Firestore Emulator Exception Restriction", () => {
    it("activates emulator single-database path ONLY in local test environment", () => {
      process.env.NODE_ENV = "test";
      delete process.env.AWS_APP_ID;
      delete process.env.AWS_EXECUTION_ENV;
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      assert.equal(isLocalEmulatorEnvironment(), true);
    });

    it("strictly disallows emulator path in production runtime (NODE_ENV='production')", () => {
      process.env.NODE_ENV = "production";
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      assert.equal(isLocalEmulatorEnvironment(), false);
    });

    it("strictly disallows emulator path in deployed Amplify environment (AWS_APP_ID present)", () => {
      process.env.NODE_ENV = "development";
      process.env.AWS_APP_ID = "d123456789amplify";
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      assert.equal(isLocalEmulatorEnvironment(), false);
    });

    it("strictly disallows emulator path in deployed Lambda / execution environment (AWS_EXECUTION_ENV)", () => {
      process.env.NODE_ENV = "development";
      process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs20.x";
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      assert.equal(isLocalEmulatorEnvironment(), false);
    });

    it("fails closed when deployed runtime has FIRESTORE_EMULATOR_HOST and invalid DB config", () => {
      process.env.NODE_ENV = "production";
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      delete process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID;
      delete process.env.AWS_BRANCH;

      assert.throws(
        () => getServerFirestore(),
        /Configuration Error: Missing Firestore database ID/
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 5: P1 Payment Route Behavior (Order & Webhook)
  // ══════════════════════════════════════════════════════════════════════════

  describe("5. P1: Payment Route Authorization & Side-Effect Prevention", () => {
    let razorpayAddResourcesSpy;
    let getServerFirestoreCalled;

    beforeEach(() => {
      getServerFirestoreCalled = 0;
      setFirestoreFactoryForTesting(() => {
        getServerFirestoreCalled++;
        return { databaseId: "mocked" };
      });

      razorpayAddResourcesSpy = mock.method(Razorpay.prototype, "addResources");
    });

    afterEach(() => {
      mock.reset();
    });

    const blockedEnvironments = [
      { name: "mig-mov + development DB", branch: "mig-mov", db: DEVELOPMENT_FIRESTORE_DATABASE_ID },
      { name: "mig-mov + production DB", branch: "mig-mov", db: PRODUCTION_FIRESTORE_DATABASE_ID },
      { name: "Unknown branch + production DB", branch: "custom-unknown-branch", db: PRODUCTION_FIRESTORE_DATABASE_ID },
      { name: "Preview branch + production DB", branch: "preview-pr-99", db: PRODUCTION_FIRESTORE_DATABASE_ID },
      { name: "main + development DB", branch: "main", db: DEVELOPMENT_FIRESTORE_DATABASE_ID },
    ];

    for (const envCase of blockedEnvironments) {
      it(`blocks Order route with HTTP 403 on ${envCase.name} without side-effects`, async () => {
        process.env.AWS_BRANCH = envCase.branch;
        process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = envCase.db;

        const req = new Request("http://localhost:3000/api/razorpay/order", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer test-admin-token",
          },
          body: JSON.stringify({
            amount: 500,
            currency: "INR",
            targetPlayerId: "player_123",
            paymentType: "match_fee",
          }),
        });

        const res = await orderPost(req);
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.code, "PAYMENTS_DISABLED");
        assert.match(data.error, /Payment order creation is disabled in this environment/);

        // Prove that Razorpay SDK was never instantiated
        assert.equal(razorpayAddResourcesSpy.mock.callCount(), 0);
        // Prove that getServerFirestore was not called
        assert.equal(getServerFirestoreCalled, 0);
      });

      it(`blocks Webhook route with HTTP 403 on ${envCase.name} without mutating Firestore`, async () => {
        process.env.AWS_BRANCH = envCase.branch;
        process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = envCase.db;

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
                  id: "pay_test_xyz",
                  order_id: "order_test_xyz",
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

        // Prove that getServerFirestore was not called
        assert.equal(getServerFirestoreCalled, 0);
      });
    }

    it("permits production path on main + production DB (Order route reaches auth guard)", async () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;

      const req = new Request("http://localhost:3000/api/razorpay/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 500 }),
      });

      const res = await orderPost(req);
      // Fails at authentication guard (401), proving it passed the 403 payment authorization gate
      assert.equal(res.status, 401);
    });

    it("permits production path on main + production DB (Webhook route reaches signature check)", async () => {
      process.env.AWS_BRANCH = "main";
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = PRODUCTION_FIRESTORE_DATABASE_ID;

      const req = new Request("http://localhost:3000/api/razorpay/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "payment.captured" }),
      });

      const res = await webhookPost(req);
      // Reached signature verification or secret check (401/500), proving it passed the 403 webhook gate
      assert.notEqual(res.status, 403);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 7: Staging Test-Mode Checkout Gate (mig-mov + kavach-play-db-ext)
  // ══════════════════════════════════════════════════════════════════════════

  describe("7. Staging Test-Mode Checkout Gate (isStagingTestCheckoutEnabled)", () => {
    const validStagingEnv = () => ({
      AWS_BRANCH: "mig-mov",
      NEXT_PUBLIC_FIRESTORE_DATABASE_ID: DEVELOPMENT_FIRESTORE_DATABASE_ID,
      ALLOW_STAGING_TEST_PAYMENTS: "true",
      RAZORPAY_KEY_ID: "rzp_test_1234567890abcd",
      NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_1234567890abcd",
      RAZORPAY_KEY_SECRET: "test_secret_value",
      RAZORPAY_WEBHOOK_SECRET: "test_webhook_secret",
    });

    it("enables staging test checkout ONLY when mig-mov + kavach-play-db-ext + flag + matching rzp_test_ keys + secrets are present", () => {
      assert.equal(isStagingTestCheckoutEnabled(validStagingEnv()), true);
      assert.equal(arePaymentOperationsEnabled(validStagingEnv()), false);
    });

    it("fails closed when ALLOW_STAGING_TEST_PAYMENTS is missing or not 'true'", () => {
      const env = validStagingEnv();
      delete env.ALLOW_STAGING_TEST_PAYMENTS;
      assert.equal(isStagingTestCheckoutEnabled(env), false);
      assert.equal(isStagingTestCheckoutEnabled({ ...validStagingEnv(), ALLOW_STAGING_TEST_PAYMENTS: "false" }), false);
    });

    it("rejects main/master and production DB even if ALLOW_STAGING_TEST_PAYMENTS='true'", () => {
      assert.equal(
        isStagingTestCheckoutEnabled({
          ...validStagingEnv(),
          AWS_BRANCH: "main",
          NEXT_PUBLIC_FIRESTORE_DATABASE_ID: PRODUCTION_FIRESTORE_DATABASE_ID,
        }),
        false,
      );
      assert.equal(
        isStagingTestCheckoutEnabled({
          ...validStagingEnv(),
          AWS_BRANCH: "master",
          NEXT_PUBLIC_FIRESTORE_DATABASE_ID: PRODUCTION_FIRESTORE_DATABASE_ID,
        }),
        false,
      );
      assert.equal(
        isStagingTestCheckoutEnabled({
          ...validStagingEnv(),
          NEXT_PUBLIC_FIRESTORE_DATABASE_ID: PRODUCTION_FIRESTORE_DATABASE_ID,
        }),
        false,
      );
    });

    it("rejects live rzp_live_ keys and mismatched server/client key IDs", () => {
      assert.equal(
        isStagingTestCheckoutEnabled({
          ...validStagingEnv(),
          RAZORPAY_KEY_ID: "rzp_live_123456",
          NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_live_123456",
        }),
        false,
      );
      assert.equal(
        isStagingTestCheckoutEnabled({
          ...validStagingEnv(),
          RAZORPAY_KEY_ID: "rzp_test_server_only",
          NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_different_client",
        }),
        false,
      );
    });

    it("fails closed when secrets are missing or DISABLE_PAYMENT_OPERATIONS='true'", () => {
      assert.equal(isStagingTestCheckoutEnabled({ ...validStagingEnv(), RAZORPAY_KEY_SECRET: "" }), false);
      assert.equal(isStagingTestCheckoutEnabled({ ...validStagingEnv(), RAZORPAY_WEBHOOK_SECRET: "  " }), false);
      assert.equal(isStagingTestCheckoutEnabled({ ...validStagingEnv(), DISABLE_PAYMENT_OPERATIONS: "true" }), false);
    });

    it("allows /api/razorpay/order and /api/razorpay/webhook on mig-mov ONLY when staging gate passes", async () => {
      const prev = {
        AWS_BRANCH: process.env.AWS_BRANCH,
        NEXT_PUBLIC_FIRESTORE_DATABASE_ID: process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID,
        ALLOW_STAGING_TEST_PAYMENTS: process.env.ALLOW_STAGING_TEST_PAYMENTS,
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
        NEXT_PUBLIC_RAZORPAY_KEY_ID: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
        RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
      };
      try {
        Object.assign(process.env, validStagingEnv());
        const orderRes = await orderPost(
          new Request("http://localhost:3000/api/razorpay/order", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ amount: 500 }),
          }),
        );
        // Passes 403 staging gate and reaches auth guard (401)
        assert.equal(orderRes.status, 401);

        const whRes = await webhookPost(
          new Request("http://localhost:3000/api/razorpay/webhook", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ event: "payment.captured" }),
          }),
        );
        // Passes 403 staging gate and reaches signature check (401)
        assert.equal(whRes.status, 401);

        // Live key on mig-mov is blocked with 403
        process.env.RAZORPAY_KEY_ID = "rzp_live_123456";
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "rzp_live_123456";
        const blockedOrderRes = await orderPost(
          new Request("http://localhost:3000/api/razorpay/order", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ amount: 500 }),
          }),
        );
        assert.equal(blockedOrderRes.status, 403);
      } finally {
        for (const [k, v] of Object.entries(prev)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    });
  });
});
