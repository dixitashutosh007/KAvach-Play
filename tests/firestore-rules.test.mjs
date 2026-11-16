/**
 * Security Rules Unit Tests for Firestore (tests/firestore-rules.test.mjs)
 *
 * Verifies rules enforcement for SEC-001 through SEC-006:
 * - SEC-001: Non-admin users cannot write privileged fields or escalate roles in /appUsers/{uid}
 * - SEC-002: Non-admins cannot mark match payment status as "Paid"
 * - SEC-003: Non-admins cannot create, update, or delete /players/{playerId}/otherFees records
 * - SEC-004: Non-admins cannot read other players' otherFees or match payments
 * - SEC-005: Non-admins cannot update /posts/{postId}
 * - SEC-006: Non-admins must follow schema validation and cannot set paymentStatus: "Paid" on /merchOrders
 *
 * Runs against Firebase Firestore Emulator when FIRESTORE_EMULATOR_HOST is available.
 * Always verifies rule AST syntax validity using @firebase/eslint-plugin-security-rules.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rulesPath = path.resolve(__dirname, "../firestore.rules");
const rulesContent = fs.readFileSync(rulesPath, "utf8");

// ── 1. Static AST Syntax Verification ────────────────────────────────────────

describe("Firestore Security Rules — AST Syntax Validation", () => {
  it("parses firestore.rules without syntax errors", async () => {
    const parser = await import("@firebase/eslint-plugin-security-rules/parser");
    const result = parser.parseForESLint(rulesContent);
    assert.ok(result.ast, "AST should be generated");
    assert.equal(typeof result.ast.type, "string");
  });

  it("contains mandatory security boundaries and collections", () => {
    assert.match(rulesContent, /match \/appUsers\/\{userId\}/);
    assert.match(rulesContent, /match \/matches\/\{matchId\}/);
    assert.match(rulesContent, /match \/payments\/\{paymentId\}/);
    assert.match(rulesContent, /match \/otherFees\/\{feeId\}/);
    assert.match(rulesContent, /match \/posts\/\{postId\}/);
    assert.match(rulesContent, /match \/merchOrders\/\{orderId\}/);
  });

  it("enforces SEC-001: appUsers keys cannot be escalated by non-superadmins", () => {
    assert.match(rulesContent, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasAny\(\['role', 'isSuperAdmin', 'isStudioAdmin'/);
  });

  it("enforces SEC-002: match payment status cannot be marked Paid by player", () => {
    assert.match(rulesContent, /incoming\(\)\.status in \['Unpaid', 'Not Playing'\]/);
  });

  it("allows 'Waived' status in isValidMatchPayment for abandoned match policy (Option A)", () => {
    assert.match(rulesContent, /data\.status in \['Paid', 'Unpaid', 'Not Playing', 'Waived'\]/);
  });

  it("enforces SEC-003: otherFees restricted to isFinanceAdmin or isSuperAdmin", () => {
    assert.match(rulesContent, /allow create, update, delete: if isFinanceAdmin\(\) \|\| isSuperAdmin\(\);/);
  });

  it("enforces SEC-004: otherFees read restricted to admins or owner", () => {
    assert.match(rulesContent, /allow read: if isFinanceAdmin\(\) \|\| isSuperAdmin\(\) \|\| isSelf\(playerId\);/);
  });

  it("enforces SEC-005: posts update restricted to isAnyAdmin", () => {
    assert.match(rulesContent, /match \/posts\/\{postId\} \{\s+allow read: if isSignedIn\(\);\s+allow create: if isAnyAdmin\(\);\s+allow update: if isAnyAdmin\(\);/);
  });

  it("enforces SEC-006: merchOrders requires isValidMerchOrder and unpaid on create", () => {
    assert.match(rulesContent, /function isValidMerchOrder\(data\)/);
    assert.match(rulesContent, /incoming\(\)\.paymentStatus == 'Unpaid'/);
    assert.match(rulesContent, /incoming\(\)\.orderStatus == 'Order Placed'/);
  });
});

// ── 2. Live Emulator Tests (Executes when emulator host is reachable) ──────────

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

describe("Firestore Security Rules — Emulator Integration Tests", { skip: !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (requires Java runtime for local emulator)" }, () => {
  let testEnv;

  before(async () => {
    if (!emulatorHost) return;
    const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
    testEnv = await initializeTestEnvironment({
      projectId: "kavach-play-test",
      firestore: {
        host: emulatorHost.split(":")[0],
        port: parseInt(emulatorHost.split(":")[1], 10),
        rules: rulesContent,
      },
    });
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
  });

  it("SEC-001: player cannot self-escalate role to admin", async () => {
    const { assertFails, assertSucceeds } = await import("@firebase/rules-unit-testing");
    const playerContext = testEnv.authenticatedContext("user_123");
    const userDoc = playerContext.firestore().collection("appUsers").doc("user_123");

    // Can create own profile as player
    await assertSucceeds(userDoc.set({ name: "Player 123", role: "player" }));

    // Cannot update own role to admin
    await assertFails(userDoc.update({ role: "admin" }));

    // Cannot update own admin flags
    await assertFails(userDoc.update({ isSuperAdmin: true }));
    await assertFails(userDoc.update({ isFinanceAdmin: true }));
  });

  it("SEC-002: player cannot mark match payment as Paid", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");
    const playerContext = testEnv.authenticatedContext("player_1");
    const paymentDoc = playerContext.firestore()
      .collection("matches").doc("match_1")
      .collection("payments").doc("pay_1");

    await assertFails(paymentDoc.update({ status: "Paid" }));
  });

  it("SEC-003: player cannot create or delete otherFees", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");
    const playerContext = testEnv.authenticatedContext("player_1");
    const feeDoc = playerContext.firestore()
      .collection("players").doc("player_1")
      .collection("otherFees").doc("fee_1");

    await assertFails(feeDoc.set({ title: "Late Fee", amount: 150, status: "Unpaid" }));
    await assertFails(feeDoc.delete());
  });

  it("SEC-004: player cannot read other players' otherFees", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");
    const playerContext = testEnv.authenticatedContext("player_1");
    const otherFeeDoc = playerContext.firestore()
      .collection("players").doc("player_2")
      .collection("otherFees").doc("fee_2");

    await assertFails(otherFeeDoc.get());
  });

  it("SEC-005: player cannot update posts", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");
    const playerContext = testEnv.authenticatedContext("player_1");
    const postDoc = playerContext.firestore().collection("posts").doc("post_1");

    await assertFails(postDoc.update({ title: "Hacked Announcement" }));
  });

  it("SEC-006: player cannot create pre-paid merch order", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");
    const playerContext = testEnv.authenticatedContext("player_1");
    const orderDoc = playerContext.firestore().collection("merchOrders").doc("order_1");

    await assertFails(orderDoc.set({
      id: "order_1",
      playerId: "player_1",
      playerName: "Player One",
      merchId: "jersey_1",
      merchName: "Match Jersey",
      price: 999,
      paymentStatus: "Paid", // Tampered
      orderStatus: "Order Placed",
      createdAt: new Date(),
    }));
  });
});
