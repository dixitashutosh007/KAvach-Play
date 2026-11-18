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
    assert.match(rulesContent, /'isDesigner', 'canDesign'/);
    // Enforce that create rules also forbid isDesigner, admin flags, and playerId
    assert.match(rulesContent, /!incoming\(\)\.keys\(\)\.hasAny\(\['isSuperAdmin', 'isStudioAdmin', 'isMatchAdmin', 'isFinanceAdmin', 'isClubAdmin', 'isDesigner', 'canDesign', 'status', 'playerId'\]\)/);
    // Enforce that isSuperAdmin strictly relies on auth token custom claim and no longer has appUsers.role fallback
    assert.match(rulesContent, /request\.auth\.token\.get\('admin', false\) == true;/);
    assert.ok(!rulesContent.includes("data.role == 'admin'"), "legacy appUsers.role fallback must be completely removed");
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

  it("SEC-001: player cannot self-escalate role or specialist permissions", async () => {
    const { assertFails, assertSucceeds } = await import("@firebase/rules-unit-testing");
    const playerContext = testEnv.authenticatedContext("user_123");
    const userDoc = playerContext.firestore().collection("appUsers").doc("user_123");

    // Can create own profile as player
    await assertSucceeds(userDoc.set({ name: "Player 123", role: "player" }));

    // Cannot create own profile with escalated flags or non-player role
    const prohibitedFlags = [
      { isSuperAdmin: true },
      { isStudioAdmin: true },
      { isMatchAdmin: true },
      { isFinanceAdmin: true },
      { isClubAdmin: true },
      { isDesigner: true },
      { canDesign: true },
      { status: "Active" },
      { role: "admin" },
    ];

    for (const flag of prohibitedFlags) {
      await assertFails(playerContext.firestore().collection("appUsers").doc("evil_user_" + Object.keys(flag)[0]).set({
        name: "Evil",
        role: "player",
        ...flag,
      }));
    }

    // Cannot update own role to admin
    await assertFails(userDoc.update({ role: "admin" }));

    // Cannot update own admin, specialist, status, or designer flags
    await assertFails(userDoc.update({ isSuperAdmin: true }));
    await assertFails(userDoc.update({ isStudioAdmin: true }));
    await assertFails(userDoc.update({ isMatchAdmin: true }));
    await assertFails(userDoc.update({ isFinanceAdmin: true }));
    await assertFails(userDoc.update({ isClubAdmin: true }));
    await assertFails(userDoc.update({ isDesigner: true }));
    await assertFails(userDoc.update({ canDesign: true }));
    await assertFails(userDoc.update({ status: "Active" }));

    // Cannot update another user's document
    const otherUserDoc = playerContext.firestore().collection("appUsers").doc("other_user");
    await assertFails(otherUserDoc.set({ name: "Hacked", role: "player" }));
    await assertFails(otherUserDoc.update({ name: "Hacked" }));

    // SuperAdmin with admin claim CAN manage roles, status, and specialist flags
    const adminContext = testEnv.authenticatedContext("admin_1", { admin: true });
    await assertSucceeds(adminContext.firestore().collection("appUsers").doc("user_123").update({
      isStudioAdmin: true,
      isMatchAdmin: true,
      isFinanceAdmin: true,
      isClubAdmin: true,
      isDesigner: true,
      canDesign: true,
      status: "Active",
      role: "admin",
    }));
  });

  it("SEC-001: user with forged role: 'admin' in Firestore without custom claim cannot perform super-admin operations", async () => {
    const { assertFails, assertSucceeds } = await import("@firebase/rules-unit-testing");
    // Seed appUsers document with role: "admin"
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection("appUsers").doc("fake_admin_uid")
        .set({ role: "admin", name: "Forged Admin" });
      await context.firestore()
        .collection("auditLogs").doc("log_1")
        .set({ action: "critical_action", timestamp: new Date() });
    });

    // Authenticated user with NO custom claim (even though their Firestore doc says role: "admin")
    const fakeAdminContext = testEnv.authenticatedContext("fake_admin_uid");
    const appConfigDoc = fakeAdminContext.firestore().collection("appConfig").doc("global");
    const auditLogDoc = fakeAdminContext.firestore().collection("auditLogs").doc("log_1");

    // Must fail to write appConfig
    await assertFails(appConfigDoc.set({ clubName: "Hacked Club" }));

    // Must fail to read or delete auditLogs
    await assertFails(auditLogDoc.get());
    await assertFails(auditLogDoc.delete());

    // Verified super-admin with custom claim { admin: true } succeeds
    const realAdminContext = testEnv.authenticatedContext("real_admin_uid", { admin: true });
    await assertSucceeds(realAdminContext.firestore().collection("appConfig").doc("global").set({ clubName: "Legit Club" }));
    await assertSucceeds(realAdminContext.firestore().collection("auditLogs").doc("log_1").get());
  });

  it("SEC-001: specialist admin (isFinanceAdmin) can manage otherFees but cannot access super-admin boundaries", async () => {
    const { assertFails, assertSucceeds } = await import("@firebase/rules-unit-testing");
    // Seed finance admin appUsers doc
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection("appUsers").doc("finance_admin_uid")
        .set({ role: "player", isFinanceAdmin: true });
      await context.firestore()
        .collection("players").doc("p_1")
        .set({ name: "Player 1", status: "Active" });
    });

    const financeContext = testEnv.authenticatedContext("finance_admin_uid");

    // Finance admin can manage otherFees
    const feeDoc = financeContext.firestore().collection("players").doc("p_1").collection("otherFees").doc("fee_fin");
    await assertSucceeds(feeDoc.set({ title: "Kit Fee", amount: 500, status: "Unpaid" }));

    // Finance admin CANNOT write appConfig (super-admin only)
    const appConfigDoc = financeContext.firestore().collection("appConfig").doc("global");
    await assertFails(appConfigDoc.set({ clubName: "Finance Takeover" }));

    // Finance admin CANNOT alter other user's appUsers document roles
    const victimUserDoc = financeContext.firestore().collection("appUsers").doc("victim_uid");
    await assertFails(victimUserDoc.set({ name: "Victim", role: "admin" }));
  });

  it("SEC-002: player cannot mark match payment as Paid", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");
    // Seed prerequisite match and payment documents
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection("matches").doc("match_1")
        .collection("payments").doc("pay_1")
        .set({ playerId: "player_1", status: "Unpaid", feeCollectedAmount: 0 });
    });

    const playerContext = testEnv.authenticatedContext("player_1");
    const paymentDoc = playerContext.firestore()
      .collection("matches").doc("match_1")
      .collection("payments").doc("pay_1");

    await assertFails(paymentDoc.update({ status: "Paid" }));
  });

  it("SEC-003: player cannot create or delete otherFees", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");
    // Seed prerequisite otherFee document before testing delete
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection("players").doc("player_1")
        .collection("otherFees").doc("fee_1")
        .set({ title: "Legit Fee", amount: 150, status: "Unpaid" });
    });

    const playerContext = testEnv.authenticatedContext("player_1");
    const feeDoc = playerContext.firestore()
      .collection("players").doc("player_1")
      .collection("otherFees").doc("fee_new");

    await assertFails(feeDoc.set({ title: "Late Fee", amount: 150, status: "Unpaid" }));

    const existingFeeDoc = playerContext.firestore()
      .collection("players").doc("player_1")
      .collection("otherFees").doc("fee_1");
    await assertFails(existingFeeDoc.delete());
  });

  it("SEC-004: player cannot read other players' otherFees", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");
    // Seed foreign player's otherFee
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection("players").doc("player_2")
        .collection("otherFees").doc("fee_2")
        .set({ title: "Secret Fee", amount: 200, status: "Unpaid" });
    });

    const playerContext = testEnv.authenticatedContext("player_1");
    const otherFeeDoc = playerContext.firestore()
      .collection("players").doc("player_2")
      .collection("otherFees").doc("fee_2");

    await assertFails(otherFeeDoc.get());
  });

  it("SEC-005: player cannot update posts", async () => {
    const { assertFails } = await import("@firebase/rules-unit-testing");
    // Seed prerequisite post document
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection("posts").doc("post_1")
        .set({ title: "Admin Announcement", content: "Original content" });
    });

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
