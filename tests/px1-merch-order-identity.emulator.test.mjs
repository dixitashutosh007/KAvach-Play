/**
 * B1 — PX-1 merchandise order ownership + FIN-004 checkout lifecycle
 * (tests/px1-merch-order-identity.emulator.test.mjs)
 *
 * Production code exercised against the Firestore emulator:
 *  - POST app/api/razorpay/order/route.ts (real handler; test auth bypass headers)
 *  - POST app/api/razorpay/webhook/route.ts (real handler; real HMAC-SHA256 signatures)
 *  - lib/merch-order-confirmation.ts waitForServerOrder against the real emulator document
 *
 * Stubbed: ONLY the Razorpay SDK resources. The SDK's HTTP layer is replaced so that any
 * network attempt throws; orders.create returns a local fake order (with EMPTY notes, to prove
 * the route returns the intent id explicitly). No request can reach api.razorpay.com.
 *
 * Run: npm run test:emulator -- tests/px1-merch-order-identity.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authBypass = process.env.KAVACH_TEST_AUTH_BYPASS === "true";
const skip =
  (!emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)") ||
  (!authBypass && "KAVACH_TEST_AUTH_BYPASS not set (run via npm run test:emulator)");
const SECRET = "whsec_b1_emulator_only";

describe("B1: PX-1 merchandise order identity + FIN-004 (Firestore emulator)", { skip }, () => {
  let db;
  let orderPOST;
  let webhookPOST;
  let waitForServerOrder;
  let seq = 0;
  const createCalls = [];
  const savedConsole = {};

  before(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      AWS_BRANCH: "main",
      NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412",
      RAZORPAY_WEBHOOK_SECRET: SECRET,
      RAZORPAY_KEY_ID: "stub_key_id_not_real",
      NEXT_PUBLIC_RAZORPAY_KEY_ID: "stub_key_id_not_real",
      RAZORPAY_KEY_SECRET: "stub_key_secret_not_real",
    });

    // Razorpay SDK stub: no network, deterministic orders.
    const { default: Razorpay } = await import("razorpay");
    Razorpay.prototype.addResources = function () {
      const refuse = () => { throw new Error("Network access to Razorpay is forbidden in tests."); };
      this.api = { get: refuse, post: refuse, put: refuse, patch: refuse, delete: refuse };
      this.orders = {
        create: async (opts) => {
          createCalls.push(opts);
          return { id: `order_stubB1${createCalls.length}x${Date.now()}`, entity: "order", amount: opts.amount, currency: opts.currency, receipt: opts.receipt, status: "created", notes: {} };
        },
        all: refuse,
        fetch: refuse,
      };
    };

    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "kavach-b1-test" });
    db = getFirestore(app);
    const serverDb = await import("../lib/server-db.ts");
    serverDb.setServerDbForTesting(db);
    ({ POST: orderPOST } = await import("../app/api/razorpay/order/route.ts"));
    ({ POST: webhookPOST } = await import("../app/api/razorpay/webhook/route.ts"));
    ({ waitForServerOrder } = await import("../lib/merch-order-confirmation.ts"));
    for (const level of ["log", "info", "warn", "error"]) {
      savedConsole[level] = console[level];
      console[level] = () => {};
    }
  });

  after(() => {
    for (const [level, fn] of Object.entries(savedConsole)) console[level] = fn;
  });

  // ── helpers ──
  const uid = (p) => `${p}${++seq}x${Date.now()}`;
  const sign = (body) => crypto.createHmac("sha256", SECRET).update(body).digest("hex");

  function captured(intentId, order, pay, amountPaise, event = "payment.captured") {
    const payment = { id: pay, order_id: order, amount: amountPaise, currency: "INR", status: "captured", notes: { intentId } };
    if (event === "order.paid") {
      return { event, payload: { order: { entity: { id: order, amount: amountPaise, amount_paid: amountPaise, currency: "INR", status: "paid", notes: { intentId } } }, payment: { entity: payment } } };
    }
    return { event, payload: { payment: { entity: payment } } };
  }

  async function deliver(body) {
    const text = JSON.stringify(body);
    const res = await webhookPOST(new Request("http://localhost/api/razorpay/webhook", {
      method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": sign(text) }, body: text,
    }));
    return { status: res.status, json: await res.json() };
  }

  async function createOrder(authUid, intentData) {
    const res = await orderPOST(new Request("http://localhost/api/razorpay/order", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-uid": authUid },
      body: JSON.stringify({ amount: 1, currency: "INR", intentData }),
    }));
    return { status: res.status, json: await res.json() };
  }

  /** A player linked to authUid, and a catalogue item. */
  async function seedPlayerAndMerch() {
    const authUid = uid("uid");
    const playerId = uid("player");
    const merchId = uid("merch");
    await db.collection("players").doc(playerId).set({ authUid, name: "Server Name" });
    await db.collection("merchandises").doc(merchId).set({ name: "Club Cap", basePrice: 650, customFields: [], minOrderQuantity: 1 });
    return { authUid, playerId, merchId };
  }

  /** Exactly the payload components/ShopTab.tsx (handlePlaceOrder) sends today. */
  function shopPayload(playerId, merchId, extra = {}) {
    return {
      playerId, playerName: "Client Name", merchId, merchName: "Club Cap", size: "L",
      customPriceAdditions: undefined, jerseyName: "DIXIT", jerseyNumber: "7", price: 650,
      paymentStatus: "Paid", orderStatus: "Ready to Place Order", isManual: false, ...extra,
    };
  }

  /** Legacy-shaped pending merch intent written directly (as pre-B1 intents may exist). */
  async function seedIntent(orderPayload, amount = 650) {
    const intentId = uid("intent");
    const order = `order_${uid("O")}`;
    const pay = `pay_${uid("P")}`;
    await db.collection("razorpayIntents").doc(intentId).set({
      type: "merch_order", orderId: order, amount, currency: "INR", status: "pending", userId: "u_legacy", orderPayload,
    });
    return { intentId, order, pay };
  }

  const getDocData = async (col, id) => (await db.collection(col).doc(id).get());

  // ── PX-1: server-controlled identity ──

  it("B1-01 a client id naming another player's order cannot overwrite it; the order is created at mo_{intentId}", async () => {
    const { authUid, playerId, merchId } = await seedPlayerAndMerch();
    const victimId = uid("victimOrder");
    const victim = { id: victimId, playerId: "someone_else", merchName: "Jacket", price: 2000, paymentStatus: "Unpaid", orderStatus: "Order Placed" };
    await db.collection("merchOrders").doc(victimId).set(victim);

    const created = await createOrder(authUid, { type: "merch_order", merchId, orderPayload: shopPayload(playerId, merchId, { id: victimId }) });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const intentId = created.json.intentId;
    const intent = (await getDocData("razorpayIntents", intentId)).data();
    assert.equal("id" in intent.orderPayload, false, "client id is not stored on the intent");

    const r = await deliver(captured(intentId, created.json.id, `pay_${uid("P")}`, 65000));
    assert.equal(r.status, 200);
    assert.deepEqual((await getDocData("merchOrders", victimId)).data(), victim, "victim order byte-identical");
    const mine = (await getDocData("merchOrders", `mo_${intentId}`)).data();
    assert.equal(mine.playerId, playerId);
    assert.equal(mine.paymentStatus, "Paid");
  });

  it("B1-02 ids containing '/' or over-long ids (legacy intent payload) are ignored", async () => {
    for (const badId of ["a/b/c", "x".repeat(300)]) {
      const { intentId, order, pay } = await seedIntent({ id: badId, playerId: "p_legacy", merchId: "m1", merchName: "Cap", price: 650 });
      const r = await deliver(captured(intentId, order, pay, 65000));
      assert.equal(r.status, 200);
      assert.equal((await getDocData("merchOrders", `mo_${intentId}`)).exists, true);
    }
    const all = await db.collection("merchOrders").where("playerId", "==", "p_legacy").get();
    for (const d of all.docs) assert.match(d.id, /^mo_/);
  });

  it("B1-03 client payment fields and unknown fields are never stored; server values are", async () => {
    const { intentId, order, pay } = await seedIntent({
      playerId: "p3", merchId: "m3", merchName: "Cap", price: 650,
      paymentStatus: "Unpaid", isManual: true, razorpayPaymentId: "pay_forged", intentId: "forged", evil: "x", createdAt: "1999",
    });
    await deliver(captured(intentId, order, pay, 65000));
    const o = (await getDocData("merchOrders", `mo_${intentId}`)).data();
    assert.equal(o.paymentStatus, "Paid");
    assert.equal(o.isManual, false);
    assert.equal(o.razorpayPaymentId, pay);
    assert.equal(o.intentId, intentId);
    assert.equal(o.id, `mo_${intentId}`);
    assert.equal("evil" in o, false);
    assert.notEqual(o.createdAt, "1999");
  });

  it("B1-04 an orderStatus outside the checkout enum becomes Order Placed", async () => {
    const { intentId, order, pay } = await seedIntent({ playerId: "p4", merchId: "m4", orderStatus: "Delivered", price: 650 });
    await deliver(captured(intentId, order, pay, 65000));
    assert.equal((await getDocData("merchOrders", `mo_${intentId}`)).data().orderStatus, "Order Placed");
  });

  it("B1-05 a tampered client price is ignored; the server price is charged and stored", async () => {
    const { authUid, playerId, merchId } = await seedPlayerAndMerch();
    const created = await createOrder(authUid, { type: "merch_order", merchId, orderPayload: shopPayload(playerId, merchId, { price: 1 }) });
    assert.equal(created.status, 200);
    assert.equal(created.json.amount, 65000);
    const intent = (await getDocData("razorpayIntents", created.json.intentId)).data();
    assert.equal(intent.amount, 650);
    assert.equal(intent.orderPayload.price, 650);
    await deliver(captured(created.json.intentId, created.json.id, `pay_${uid("P")}`, 65000));
    assert.equal((await getDocData("merchOrders", `mo_${created.json.intentId}`)).data().price, 650);
  });

  it("B1-06 six concurrent deliveries (payment.captured + order.paid) create exactly one order", async () => {
    const { intentId, order, pay } = await seedIntent({ playerId: "p6", merchId: "m6", price: 650 });
    const events = [0, 1, 2, 3, 4, 5].map((i) => captured(intentId, order, pay, 65000, i % 2 ? "order.paid" : "payment.captured"));
    const results = await Promise.all(events.map(deliver));
    for (const r of results) assert.equal(r.status, 200);
    assert.equal(results.filter((r) => r.json.outcome === "processed").length, 1);
    const orders = await db.collection("merchOrders").where("intentId", "==", intentId).get();
    assert.equal(orders.size, 1);
    assert.equal(orders.docs[0].id, `mo_${intentId}`);
  });

  it("B1-07 a replay after completion is already_processed and creates no second order", async () => {
    const { intentId, order, pay } = await seedIntent({ playerId: "p7", merchId: "m7", price: 650 });
    assert.equal((await deliver(captured(intentId, order, pay, 65000))).json.outcome, "processed");
    const before = (await getDocData("merchOrders", `mo_${intentId}`)).data();
    const replay = await deliver(captured(intentId, order, pay, 65000));
    assert.equal(replay.status, 200);
    assert.equal(replay.json.outcome, "already_processed");
    assert.deepEqual((await getDocData("merchOrders", `mo_${intentId}`)).data(), before);
    assert.equal((await db.collection("merchOrders").where("intentId", "==", intentId).get()).size, 1);
  });

  it("B1-08 the exact shop checkout payload yields one Paid order with every display field", async () => {
    const { authUid, playerId, merchId } = await seedPlayerAndMerch();
    const created = await createOrder(authUid, { type: "merch_order", merchId, orderPayload: shopPayload(playerId, merchId, { spec: "Full sleeve" }) });
    assert.equal(created.status, 200);
    await deliver(captured(created.json.intentId, created.json.id, `pay_${uid("P")}`, 65000));
    const o = (await getDocData("merchOrders", `mo_${created.json.intentId}`)).data();
    assert.equal(o.paymentStatus, "Paid");
    assert.equal(o.isManual, false);
    assert.equal(o.playerId, playerId);
    assert.equal(o.playerName, "Server Name");
    assert.equal(o.merchId, merchId);
    assert.equal(o.merchName, "Club Cap");
    assert.equal(o.size, "L");
    assert.equal(o.spec, "Full sleeve");
    assert.equal(o.jerseyName, "DIXIT");
    assert.equal(o.jerseyNumber, "7");
    assert.equal(o.price, 650);
    assert.equal(o.orderStatus, "Ready to Place Order");
  });

  // B2 (§15): an existing mo_{intentId} classifies as SETTLED, so the capture is recorded as a
  // duplicate (registry rejected_duplicate, intent paid_unapplied); the order is still never touched.
  it("B1-09 a pre-existing mo_{intentId} is never overwritten: MERCH_ORDER_EXISTS recorded as duplicate, 200", async () => {
    const { intentId, order, pay } = await seedIntent({ playerId: "p9", merchId: "m9", price: 650 });
    const existing = { id: `mo_${intentId}`, playerId: "p9", paymentStatus: "Unpaid", note: "pre-existing" };
    await db.collection("merchOrders").doc(`mo_${intentId}`).set(existing);
    const r = await deliver(captured(intentId, order, pay, 65000));
    assert.equal(r.status, 200);
    assert.equal(r.json.code, "MERCH_ORDER_EXISTS");
    assert.deepEqual((await getDocData("merchOrders", `mo_${intentId}`)).data(), existing);
    assert.equal((await getDocData("razorpayIntents", intentId)).data().status, "paid_unapplied");
    assert.equal((await getDocData("gatewayPayments", pay)).data().application, "rejected_duplicate");
    const dl = (await getDocData("webhookDeadLetters", `pay_${pay}`)).data();
    assert.equal(dl.reason, "MERCH_ORDER_EXISTS");
    assert.equal(dl.classification, "data_integrity");
  });

  // ── FIN-004: order route intent id and browser confirmation ──

  it("B1-10 the new-order response carries the saved intent id explicitly (gateway notes are not relied upon)", async () => {
    const { authUid, playerId, merchId } = await seedPlayerAndMerch();
    const callsBefore = createCalls.length;
    const created = await createOrder(authUid, { type: "merch_order", merchId, orderPayload: shopPayload(playerId, merchId) });
    assert.equal(created.status, 200);
    assert.equal(createCalls.length, callsBefore + 1);
    const { intentId } = created.json;
    assert.ok(intentId);
    assert.equal(created.json.notes.intentId, intentId);
    const intent = (await getDocData("razorpayIntents", intentId)).data();
    assert.equal(intent.orderId, created.json.id, "the returned intent owns the returned order");
    assert.equal(createCalls.at(-1).notes.intentId, intentId);
  });

  it("B1-11 a reused-order response returns the same order and the correct saved intent id, without a second create", async () => {
    const { authUid, playerId, merchId } = await seedPlayerAndMerch();
    const first = await createOrder(authUid, { type: "merch_order", merchId, orderPayload: shopPayload(playerId, merchId) });
    assert.equal(first.status, 200);
    const callsAfterFirst = createCalls.length;
    const second = await createOrder(authUid, { type: "merch_order", merchId, orderPayload: shopPayload(playerId, merchId) });
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(createCalls.length, callsAfterFirst, "no second gateway order");
    assert.equal(second.json.id, first.json.id);
    assert.equal(second.json.notes.reusedExistingOrder, true);
    assert.equal(second.json.intentId, first.json.intentId);
    assert.equal(second.json.notes.intentId, first.json.intentId);
  });

  it("B1-12 browser confirmation succeeds after a delayed webhook, reading only mo_{intentId}", async () => {
    const { intentId, order, pay } = await seedIntent({ playerId: "p12", merchId: "m12", price: 650 });
    const readIds = new Set();
    const reader = async (orderId) => {
      readIds.add(orderId);
      return (await db.collection("merchOrders").doc(orderId).get()).exists ? "found" : "absent";
    };
    const waiting = waitForServerOrder(reader, intentId, { intervalMs: 50, timeoutMs: 10000 });
    await new Promise((r) => setTimeout(r, 400)); // webhook arrives late
    assert.equal((await deliver(captured(intentId, order, pay, 65000))).status, 200);
    const result = await waiting;
    assert.equal(result.status, "confirmed");
    assert.ok(result.attempts > 1, "the order was absent at first and the helper kept waiting");
    assert.deepEqual([...readIds], [`mo_${intentId}`]);
  });

  it("B1-13 when the webhook has not committed, confirmation ends pending (never failed) and nothing is created", async () => {
    const { intentId } = await seedIntent({ playerId: "p13", merchId: "m13", price: 650 });
    const reader = async (orderId) => ((await db.collection("merchOrders").doc(orderId).get()).exists ? "found" : "absent");
    const result = await waitForServerOrder(reader, intentId, { intervalMs: 50, timeoutMs: 300 });
    assert.equal(result.status, "pending");
    assert.equal((await getDocData("merchOrders", `mo_${intentId}`)).exists, false);
    assert.equal((await getDocData("razorpayIntents", intentId)).data().status, "pending");
  });
});
