/**
 * Club Shop availability (`tests/club-shop.emulator.test.mjs`).
 *
 * Production code exercised against the Firestore emulator:
 *   - app/api/admin/shop/route.ts          (enable/disable — existing features.shop flag)
 *   - app/api/razorpay/order/route.ts      (new Shop purchases blocked server-side when disabled)
 *   - firestore.rules merchOrders create   (direct client order writes blocked when disabled)
 * Razorpay is stubbed (no network); caller identity via the KAVACH_TEST_AUTH_BYPASS headers.
 *
 * Run: node scripts/run-emulator-tests.mjs tests/club-shop.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip =
  (!emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via scripts/run-emulator-tests.mjs)") ||
  (process.env.KAVACH_TEST_AUTH_BYPASS !== "true" && "KAVACH_TEST_AUTH_BYPASS not set");

describe("Club Shop — server enforcement and admin toggle", { skip }, () => {
  let db;
  let shopPOST;
  let orderPOST;
  let seq = 0;
  const createCalls = [];
  const saved = {};
  const id = (p) => `${p}_${++seq}_${Date.now()}`;

  before(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      AWS_BRANCH: "main",
      NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412",
      RAZORPAY_KEY_ID: "stub_key_id_not_real",
      NEXT_PUBLIC_RAZORPAY_KEY_ID: "stub_key_id_not_real",
      RAZORPAY_KEY_SECRET: "stub_key_secret_not_real",
    });
    const { default: Razorpay } = await import("razorpay");
    Razorpay.prototype.addResources = function () {
      const refuse = () => {
        throw new Error("Network access to Razorpay is forbidden in tests.");
      };
      this.api = { get: refuse, post: refuse, put: refuse, patch: refuse, delete: refuse };
      this.orders = {
        create: async (opts) => {
          createCalls.push(opts);
          return { id: `order_stubShop${createCalls.length}x${Date.now()}`, entity: "order", amount: opts.amount, currency: opts.currency, receipt: opts.receipt, status: "created", notes: {} };
        },
        all: refuse,
        fetch: refuse,
      };
    };
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "kavach-shop-test" });
    db = getFirestore(app);
    (await import("../lib/server-db.ts")).setServerDbForTesting(db);
    ({ POST: shopPOST } = await import("../app/api/admin/shop/route.ts"));
    ({ POST: orderPOST } = await import("../app/api/razorpay/order/route.ts"));
    for (const l of ["log", "info", "warn", "error"]) {
      saved[l] = console[l];
      console[l] = () => {};
    }
    await db.collection("appConfig").doc("default").set({ clubName: "KAvach", features: { payments: true, studio: true, shop: true, opinion: true } });
  });
  after(() => Object.assign(console, saved));

  const toggle = async (enabled, who = { uid: "u_club", roles: "clubAdmin" }) => {
    const headers = { "content-type": "application/json" };
    if (who) {
      headers["x-test-uid"] = who.uid;
      if (who.roles) headers["x-test-roles"] = who.roles;
    }
    const res = await shopPOST(new Request("http://localhost/api/admin/shop", { method: "POST", headers, body: JSON.stringify({ enabled }) }));
    return { status: res.status, json: await res.json() };
  };
  const config = async () => (await db.doc("appConfig/default").get()).data();
  async function seed() {
    const authUid = id("uid");
    const playerId = id("player");
    const merchId = id("merch");
    await db.collection("players").doc(playerId).set({ authUid, name: "Shop Player" });
    await db.collection("merchandises").doc(merchId).set({ name: "Club Cap", basePrice: 499, customFields: [], minOrderQuantity: 1, status: "Accepting Orders" });
    return { authUid, playerId, merchId };
  }
  const buy = async ({ authUid, playerId, merchId }) => {
    const res = await orderPOST(
      new Request("http://localhost/api/razorpay/order", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-uid": authUid },
        body: JSON.stringify({ amount: 1, currency: "INR", intentData: { type: "merch_order", merchId, orderPayload: { playerId, playerName: "x", merchId, merchName: "Club Cap", price: 1, paymentStatus: "Paid", orderStatus: "Order Placed" } } }),
      }),
    );
    return { status: res.status, json: await res.json() };
  };

  it("SHOP-01 only Club Admin / Super Admin can change the Shop setting", async () => {
    assert.equal((await toggle(false, null)).status, 401);
    for (const who of [{ uid: "u_p" }, { uid: "u_fin", roles: "financeAdmin" }, { uid: "u_legacy", roles: "matchAdmin" }]) {
      assert.equal((await toggle(false, who)).status, 403, JSON.stringify(who));
    }
    assert.equal((await config()).features.shop, true);
    assert.equal((await toggle("no")).status, 400);
  });

  it("SHOP-02 toggle flips only the existing features.shop flag, is audited, and is idempotent", async () => {
    const r = await toggle(false);
    assert.equal(r.status, 200);
    assert.equal(r.json.changed, true);
    const c = await config();
    assert.deepEqual(c.features, { payments: true, studio: true, shop: false, opinion: true }); // other flags untouched
    assert.equal(c.clubName, "KAvach");
    assert.equal((await toggle(false)).json.changed, false);
    const audit = (await db.collection("auditLogs").where("entity", "==", "shop").get()).docs.map((d) => d.data());
    assert.equal(audit.length, 1);
    assert.deepEqual(audit[0].changes, [{ field: "features.shop", oldValue: "Enabled", newValue: "Disabled" }]);
    assert.equal((await toggle(true, { uid: "u_super", roles: "superAdmin" })).json.enabled, true);
  });

  it("SHOP-03 disabled: a direct API purchase is refused (403 SHOP_CLOSED) — no Razorpay order, no intent", async () => {
    await toggle(false);
    const s = await seed();
    const before = createCalls.length;
    const intentsBefore = (await db.collection("razorpayIntents").count().get()).data().count;
    const r = await buy(s);
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "SHOP_CLOSED");
    assert.equal(createCalls.length, before);
    assert.equal((await db.collection("razorpayIntents").count().get()).data().count, intentsBefore);
  });

  it("SHOP-04 enabled: the same purchase creates exactly one Razorpay order at the server-calculated price", async () => {
    await toggle(true);
    const s = await seed();
    const before = createCalls.length;
    const r = await buy(s);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(createCalls.length, before + 1);
    assert.equal(createCalls.at(-1).amount, 49900); // ₹499 from the catalogue, not the client's ₹1
  });

  it("SHOP-05 disabling never touches products, orders or payment records", async () => {
    const s = await seed();
    await db.collection("merchOrders").doc("mo_existing_1").set({ id: "mo_existing_1", playerId: s.playerId, playerName: "Shop Player", merchId: s.merchId, merchName: "Club Cap", price: 499, paymentStatus: "Paid", orderStatus: "Order Placed", createdAt: new Date() });
    const productBefore = (await db.doc(`merchandises/${s.merchId}`).get()).data();
    await toggle(false);
    const order = (await db.doc("merchOrders/mo_existing_1").get()).data();
    assert.equal(order.paymentStatus, "Paid");
    assert.equal(order.orderStatus, "Order Placed");
    assert.deepEqual((await db.doc(`merchandises/${s.merchId}`).get()).data(), productBefore);
    await toggle(true);
  });

  it("SHOP-06 disabled: an existing unpaid Shop order can still be paid through the dues checkout", async () => {
    await toggle(false);
    const s = await seed();
    const orderId = id("mo_unpaid");
    await db.collection("merchOrders").doc(orderId).set({
      playerId: s.playerId, playerName: "Shop Player", merchId: s.merchId, merchName: "Club Cap", price: 499,
      paymentStatus: "Unpaid", orderStatus: "Order Placed", createdAt: new Date(),
      trustedSource: "server", intentId: `intent_${orderId}`, priceSnapshot: { totalAmount: 499 },
    });
    const before = createCalls.length;
    const res = await orderPOST(
      new Request("http://localhost/api/razorpay/order", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-uid": s.authUid },
        body: JSON.stringify({ amount: 1, currency: "INR", intentData: { type: "finance_dues", playerId: s.playerId, items: [{ type: "merch", merchId: orderId, amount: 1 }] } }),
      }),
    );
    const json = await res.json();
    assert.equal(res.status, 200, JSON.stringify(json));
    assert.equal(createCalls.length, before + 1);
    assert.equal(createCalls.at(-1).amount, 49900); // stored order price, not the client's ₹1
    await toggle(true);
  });
});

describe("Club Shop — Firestore rules (merchOrders create)", { skip }, () => {
  let testEnv;
  let rut;
  before(async () => {
    rut = await import("@firebase/rules-unit-testing");
    const [host, port] = emulatorHost.split(":");
    testEnv = await rut.initializeTestEnvironment({
      projectId: "kavach-shop-rules",
      firestore: { host, port: Number(port), rules: fs.readFileSync("firestore.rules", "utf8") },
    });
  });
  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  const setShop = (shop) =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      const fs_ = ctx.firestore();
      const { doc, setDoc } = await import("firebase/firestore");
      await setDoc(doc(fs_, "appConfig/default"), { features: { shop } });
      await setDoc(doc(fs_, "appUsers/p_uid"), { name: "P", playerId: "p1", role: "player" });
      await setDoc(doc(fs_, "players/p1"), { name: "P", authUid: "p_uid", mobile: "1", inviteStatus: "Accepted" });
    });
  const playerOrder = async (orderId) => {
    const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
    const db = testEnv.authenticatedContext("p_uid").firestore();
    return setDoc(doc(db, "merchOrders", orderId), {
      id: orderId, playerId: "p1", playerName: "P", merchId: "m1", merchName: "Cap", price: 499,
      paymentStatus: "Unpaid", orderStatus: "Order Placed", createdAt: serverTimestamp(),
    });
  };

  it("SHOP-R1 Shop enabled: direct client merchOrders creation by a player is denied (server order API required)", async () => {
    await setShop(true);
    await rut.assertFails(playerOrder("o_enabled"));
  });
  it("SHOP-R2 Shop disabled: the same direct write is denied", async () => {
    await setShop(false);
    await rut.assertFails(playerOrder("o_disabled"));
  });
  it("SHOP-R3 Shop disabled: the player can still read their existing order", async () => {
    const { doc, setDoc, getDoc } = await import("firebase/firestore");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "merchOrders/o_keep"), {
        id: "o_keep", playerId: "p1", playerName: "P", merchId: "m_cap", merchName: "Cap",
        price: 499, paymentStatus: "Unpaid", orderStatus: "Order Placed", createdAt: new Date(),
      });
    });
    await setShop(false);
    await rut.assertSucceeds(getDoc(doc(testEnv.authenticatedContext("p_uid").firestore(), "merchOrders/o_keep")));
  });

  // Owner decision (2026-11-24): Shop management is Club Admin / Super Admin only.
  const seedRoles = () =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      const { doc, setDoc } = await import("firebase/firestore");
      const d = ctx.firestore();
      await setDoc(doc(d, "appUsers/fin_uid"), { name: "Fin", role: "player", isFinanceAdmin: true });
      await setDoc(doc(d, "appUsers/club_uid"), { name: "Club", role: "player", isClubAdmin: true });
      await setDoc(doc(d, "merchandises/m_cap"), { name: "Cap", basePrice: 499 });
      await setDoc(doc(d, "merchOrders/o_admin"), { id: "o_admin", playerId: "p1", playerName: "P", merchId: "m_cap", merchName: "Cap", price: 499, paymentStatus: "Paid", orderStatus: "Order Placed", createdAt: new Date() });
    });

  it("SHOP-R4 Finance Admin cannot manage products or orders, but can read Shop payment records", async () => {
    await seedRoles();
    const { doc, setDoc, updateDoc, deleteDoc, getDoc } = await import("firebase/firestore");
    const fin = testEnv.authenticatedContext("fin_uid").firestore();
    await rut.assertFails(setDoc(doc(fin, "merchandises/m_new"), { name: "Jersey", basePrice: 1299 }));
    await rut.assertFails(updateDoc(doc(fin, "merchandises/m_cap"), { basePrice: 1 }));
    await rut.assertFails(deleteDoc(doc(fin, "merchandises/m_cap")));
    await rut.assertFails(updateDoc(doc(fin, "merchOrders/o_admin"), { orderStatus: "Fulfilled" }));
    await rut.assertFails(deleteDoc(doc(fin, "merchOrders/o_admin")));
    await rut.assertSucceeds(getDoc(doc(fin, "merchOrders/o_admin")));
  });

  it("SHOP-R5 Club Admin and Super Admin manage products and orders whether the Shop is enabled or disabled", async () => {
    const { doc, setDoc, updateDoc } = await import("firebase/firestore");
    for (const shop of [true, false]) {
      await setShop(shop);
      await seedRoles();
      const club = testEnv.authenticatedContext("club_uid").firestore();
      const sup = testEnv.authenticatedContext("super_uid", { admin: true }).firestore();
      await rut.assertSucceeds(setDoc(doc(club, "merchandises/m_" + shop), { name: "Item", basePrice: 100 }));
      await rut.assertSucceeds(updateDoc(doc(club, "merchOrders/o_admin"), { orderStatus: "Order Received" }));
      await rut.assertSucceeds(updateDoc(doc(sup, "merchandises/m_cap"), { basePrice: 549 }));
      await rut.assertSucceeds(updateDoc(doc(sup, "merchOrders/o_admin"), { orderStatus: "Fulfilled" }));
    }
  });

  it("SHOP-R6 players and admins get no Shop admin privilege: products, others' orders, payment fields, deletion", async () => {
    await setShop(true);
    await seedRoles();
    const { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp } = await import("firebase/firestore");
    const p = testEnv.authenticatedContext("p_uid").firestore();
    // Player: no product management.
    await rut.assertFails(setDoc(doc(p, "merchandises/m_p"), { name: "X", basePrice: 1 }));
    await rut.assertFails(updateDoc(doc(p, "merchandises/m_cap"), { basePrice: 1 }));
    await rut.assertFails(deleteDoc(doc(p, "merchandises/m_cap")));
    // Player: own order — cannot self-mark paid, reprice or delete it.
    await rut.assertFails(updateDoc(doc(p, "merchOrders/o_admin"), { paymentStatus: "Unpaid" }));
    await rut.assertFails(updateDoc(doc(p, "merchOrders/o_admin"), { price: 1 }));
    await rut.assertFails(deleteDoc(doc(p, "merchOrders/o_admin")));
    // Another player's order is neither readable nor writable.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "merchOrders/o_other"), { id: "o_other", playerId: "p2", playerName: "Q", merchId: "m_cap", merchName: "Cap", price: 499, paymentStatus: "Unpaid", orderStatus: "Order Placed", createdAt: new Date() });
    });
    await rut.assertFails(getDoc(doc(p, "merchOrders/o_other")));
    await rut.assertFails(updateDoc(doc(p, "merchOrders/o_other"), { orderStatus: "Fulfilled" }));
    // Finance Admin cannot create merchOrders; Club Admin may create Unpaid manual orders (without server-only payment keys).
    const fin = testEnv.authenticatedContext("fin_uid").firestore();
    const club = testEnv.authenticatedContext("club_uid").firestore();
    await rut.assertFails(setDoc(doc(fin, "merchOrders", "o_for_p1_fin"), {
      id: "o_for_p1_fin", playerId: "p1", playerName: "P", merchId: "m_cap", merchName: "Cap", price: 499,
      paymentStatus: "Unpaid", orderStatus: "Order Placed", createdAt: serverTimestamp(),
    }));
    await rut.assertFails(setDoc(doc(club, "merchOrders", "o_for_p1_club_paid"), {
      id: "o_for_p1_club_paid", playerId: "p1", playerName: "P", merchId: "m_cap", merchName: "Cap", price: 499,
      paymentStatus: "Paid", razorpayPaymentId: "pay_fake", trustedSource: "server", orderStatus: "Order Placed", createdAt: serverTimestamp(),
    }));
    await rut.assertSucceeds(setDoc(doc(club, "merchOrders", "o_for_p1_club"), {
      id: "o_for_p1_club", playerId: "p1", playerName: "P", merchId: "m_cap", merchName: "Cap", price: 499,
      paymentStatus: "Unpaid", orderStatus: "Order Placed", createdAt: serverTimestamp(),
    }));
  });
});
