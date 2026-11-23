/**
 * R2-A / R2-C — account and membership-history privacy
 * (tests/r2a-account-privacy.emulator.test.mjs)
 *
 * Firestore rules are exercised against the Firestore emulator with @firebase/rules-unit-testing,
 * using the query shapes the app actually issues:
 *   - collection("appUsers")                   (hooks/useStore.ts ensureAllAppUsers)
 *   - doc("appUsers", uid)                      (useStore self listener, AuthProvider, onboarding screens)
 *   - collection("subscriptionHistory")         (hooks/useStore.ts ensureSubscriptionHistory)
 * plus attacker shapes: filtered queries on appUsers and other-player subscriptionHistory.
 *
 * R2-C webhook data minimisation runs the production processWebhookIntentTransaction() against the
 * emulator through firebase-admin and asserts the stored intent holds no payer PII.
 *
 * Run: npm run test:emulator -- tests/r2a-account-privacy.emulator.test.mjs
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)";

describe("R2-A/R2-C: appUsers and subscriptionHistory read privacy (Firestore emulator)", { skip }, () => {
  let testEnv;
  let assertFails;
  let assertSucceeds;

  const as = (uid, claims = {}) => testEnv.authenticatedContext(uid, claims).firestore();

  before(async () => {
    const rut = await import("@firebase/rules-unit-testing");
    assertFails = rut.assertFails;
    assertSucceeds = rut.assertSucceeds;
    const [host, port] = emulatorHost.split(":");
    testEnv = await rut.initializeTestEnvironment({
      projectId: "kavach-r2a-privacy-test",
      firestore: { host, port: Number(port), rules: rulesContent },
    });
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const users = {
        uid_a: { name: "Player A", email: "a@example.test", mobile: "9000000001", role: "player", playerId: "p_a", status: "Active" },
        uid_b: { name: "Player B", email: "b@example.test", mobile: "9000000002", role: "player", playerId: "p_b", status: "Active" },
        uid_club: { name: "Club Admin", role: "player", isClubAdmin: true, status: "Active" },
        uid_fin: { name: "Finance Admin", role: "player", isFinanceAdmin: true, status: "Active" },
        uid_super: { name: "Super Admin", role: "player", status: "Active" },
        uid_designer: { name: "Designer", role: "player", isDesigner: true, status: "Active" },
        uid_disabled_club: { name: "Disabled Club Admin", role: "player", isClubAdmin: true, status: "Disabled" },
      };
      for (const [uid, data] of Object.entries(users)) await db.collection("appUsers").doc(uid).set(data);
      await db.collection("players").doc("p_a").set({ name: "Player A", authUid: "uid_a" });
      await db.collection("players").doc("p_b").set({ name: "Player B", authUid: "uid_b" });
      const hist = (playerId) => ({
        playerId, adminId: "uid_club", adminName: "Club Admin", newExpiryDate: "2027-01-01",
        planId: "plan_1", planName: "Monthly", paidAmount: 1500, createdAt: new Date(),
      });
      await db.collection("subscriptionHistory").doc("h_a").set(hist("p_a"));
      await db.collection("subscriptionHistory").doc("h_b").set(hist("p_b"));
    });
  });

  // ── appUsers ────────────────────────────────────────────────────────────────

  it("R2A-01 player reads own account doc (self listener / AuthProvider shape)", async () => {
    await assertSucceeds(as("uid_a").collection("appUsers").doc("uid_a").get());
  });

  it("R2A-02 player cannot read another player's account doc", async () => {
    await assertFails(as("uid_a").collection("appUsers").doc("uid_b").get());
  });

  it("R2A-03 player cannot enumerate appUsers (ensureAllAppUsers query shape)", async () => {
    await assertFails(as("uid_a").collection("appUsers").get());
  });

  it("R2A-04 player cannot run filtered appUsers queries (role, email, own-uid-shaped)", async () => {
    const db = as("uid_a");
    await assertFails(db.collection("appUsers").where("isClubAdmin", "==", true).get());
    await assertFails(db.collection("appUsers").where("email", "==", "b@example.test").get());
    await assertFails(db.collection("appUsers").where("playerId", "==", "p_b").get());
  });

  it("R2A-05 Club Admin, Finance Admin and Super Admin (claim) can read and list accounts", async () => {
    await assertSucceeds(as("uid_club").collection("appUsers").doc("uid_b").get());
    await assertSucceeds(as("uid_club").collection("appUsers").get());
    await assertSucceeds(as("uid_fin").collection("appUsers").get());
    await assertSucceeds(as("uid_super", { admin: true }).collection("appUsers").get());
  });

  it("R2A-06 Designer-only account reads own doc but cannot enumerate accounts", async () => {
    await assertSucceeds(as("uid_designer").collection("appUsers").doc("uid_designer").get());
    await assertFails(as("uid_designer").collection("appUsers").get());
    await assertFails(as("uid_designer").collection("appUsers").doc("uid_a").get());
  });

  it("R2A-07 disabled Club Admin cannot enumerate accounts", async () => {
    await assertFails(as("uid_disabled_club").collection("appUsers").get());
  });

  it("R2A-08 unauthenticated caller cannot read any account doc", async () => {
    await assertFails(testEnv.unauthenticatedContext().firestore().collection("appUsers").doc("uid_a").get());
  });

  it("R2A-09 regression: player still updates own non-privileged field; cannot self-escalate or write others", async () => {
    const db = as("uid_a");
    await assertSucceeds(db.collection("appUsers").doc("uid_a").update({ name: "Player A Renamed" }));
    await assertFails(db.collection("appUsers").doc("uid_a").update({ isClubAdmin: true }));
    await assertFails(db.collection("appUsers").doc("uid_a").update({ role: "admin" }));
    await assertFails(db.collection("appUsers").doc("uid_b").update({ name: "hijack" }));
  });

  it("R2A-10 regression: a brand-new user can still create and then read their own account doc", async () => {
    const db = as("uid_new");
    await assertSucceeds(db.collection("appUsers").doc("uid_new").set({ name: "New", email: "n@example.test" }));
    await assertSucceeds(db.collection("appUsers").doc("uid_new").get());
  });

  // ── subscriptionHistory ─────────────────────────────────────────────────────

  it("R2C-01 player cannot list all membership history (ensureSubscriptionHistory query shape)", async () => {
    await assertFails(as("uid_a").collection("subscriptionHistory").get());
  });

  it("R2C-02 player cannot read another player's membership history", async () => {
    await assertFails(as("uid_a").collection("subscriptionHistory").doc("h_b").get());
    await assertFails(as("uid_a").collection("subscriptionHistory").where("playerId", "==", "p_b").get());
  });

  it("R2C-03 player can read own membership history (doc and playerId-filtered query)", async () => {
    await assertSucceeds(as("uid_a").collection("subscriptionHistory").doc("h_a").get());
    await assertSucceeds(as("uid_a").collection("subscriptionHistory").where("playerId", "==", "p_a").get());
  });

  it("R2C-04 Club Admin, Finance Admin and Super Admin can list membership history", async () => {
    await assertSucceeds(as("uid_club").collection("subscriptionHistory").get());
    await assertSucceeds(as("uid_fin").collection("subscriptionHistory").get());
    await assertSucceeds(as("uid_super", { admin: true }).collection("subscriptionHistory").get());
  });

  it("R2C-05 Designer-only account cannot list membership history", async () => {
    await assertFails(as("uid_designer").collection("subscriptionHistory").get());
  });

  it("R2C-06 regression: membership history stays immutable and player-uncreatable", async () => {
    await assertFails(as("uid_a").collection("subscriptionHistory").doc("h_a").update({ paidAmount: 0 }));
    await assertFails(as("uid_a").collection("subscriptionHistory").doc("h_a").delete());
    await assertFails(as("uid_a").collection("subscriptionHistory").doc("h_x").set({
      playerId: "p_a", adminId: "uid_a", adminName: "me", newExpiryDate: "2099-01-01",
      planId: "plan_1", planName: "Free", paidAmount: 0, createdAt: new Date(),
    }));
  });
});

describe("R2-C: webhook stores no raw gateway payload (production processWebhookIntentTransaction)", { skip }, () => {
  let db;
  let webhook;

  before(async () => {
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().find((a) => a.name === "r2c") || initializeApp({ projectId: "kavach-r2c-webhook-test" }, "r2c");
    db = getFirestore(app);
    webhook = await import("../lib/razorpay-webhook.ts");
  });

  it("R2C-07 fulfilled intent keeps payment identifiers and drops payer email/contact/VPA/card data", async () => {
    const intentId = `intent_r2c_${Date.now()}`;
    await db.collection("razorpayIntents").doc(intentId).set({
      type: "merch_order",
      orderId: "order_R2C123",
      amount: 750,
      currency: "INR",
      status: "pending",
      orderPayload: { id: `mo_${intentId}`, playerId: "p_a", items: [] },
    });

    const payload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_R2C456",
            order_id: "order_R2C123",
            amount: 75000,
            currency: "INR",
            status: "captured",
            method: "upi",
            email: "payer@example.test",
            contact: "+919000000009",
            vpa: "payer@upi",
            card: { last4: "4242", network: "Visa" },
            notes: { intentId },
          },
        },
      },
    };
    const details = webhook.extractWebhookEventDetails(payload);
    const result = await webhook.processWebhookIntentTransaction(db, details, payload);
    assert.equal(result.success, true);

    const stored = (await db.collection("razorpayIntents").doc(intentId).get()).data();
    assert.equal(stored.status, "paid");
    assert.equal(stored.razorpayPaymentId, "pay_R2C456");
    assert.equal("rawPayload" in stored, false, "raw gateway payload must not be persisted");
    assert.deepEqual(
      { event: stored.gatewayEvent?.event, orderId: stored.gatewayEvent?.orderId, paymentId: stored.gatewayEvent?.paymentId, amountPaise: stored.gatewayEvent?.amountPaise, currency: stored.gatewayEvent?.currency },
      { event: "payment.captured", orderId: "order_R2C123", paymentId: "pay_R2C456", amountPaise: 75000, currency: "INR" },
    );
    const serialized = JSON.stringify(stored);
    for (const pii of ["payer@example.test", "+919000000009", "payer@upi", "4242"]) {
      assert.equal(serialized.includes(pii), false, `stored intent must not contain ${pii}`);
    }
  });
});
