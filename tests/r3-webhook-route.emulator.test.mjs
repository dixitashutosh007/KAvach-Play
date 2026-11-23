/**
 * R3 — Razorpay webhook error classification and retry reliability
 * (tests/r3-webhook-route.emulator.test.mjs)
 *
 * Exercises the production HTTP route app/api/razorpay/webhook/route.ts POST() with real
 * HMAC-SHA256 signatures over the raw body, against the Firestore emulator via firebase-admin.
 * Asserts both the HTTP response and the resulting Firestore state.
 *
 * Mocked: only infrastructure failures (R3-14/15), injected by wrapping the Firestore instance so
 * runTransaction throws gRPC-coded errors as the Admin SDK does. Everything else is real.
 *
 * Razorpay context (docs, 2026-11): any non-2xx is a failed delivery, retried with exponential
 * backoff for 24 h; x-razorpay-event-id is unique per event; delivery is at-least-once.
 *
 * Run: npm run test:emulator -- tests/r3-webhook-route.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)";
const SECRET = "whsec_r3_emulator_only";

describe("R3: webhook route error classification (Firestore emulator, real HMAC)", { skip }, () => {
  let db;
  let serverDb;
  let POST;
  let seq = 0;
  const logLines = [];
  const savedConsole = {};

  before(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      AWS_BRANCH: "main",
      NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412",
      RAZORPAY_WEBHOOK_SECRET: SECRET,
    });
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "kavach-r3-route-test" });
    db = getFirestore(app);
    serverDb = await import("../lib/server-db.ts");
    serverDb.setServerDbForTesting(db);
    ({ POST } = await import("../app/api/razorpay/webhook/route.ts"));
    for (const level of ["log", "info", "warn", "error"]) {
      savedConsole[level] = console[level];
      console[level] = (...args) => logLines.push(args.map(String).join(" "));
    }
  });

  after(() => {
    for (const [level, fn] of Object.entries(savedConsole)) console[level] = fn;
  });

  // ── helpers ──
  const uid = (p) => `${p}_${++seq}_${Date.now()}`;
  const sign = (body) => crypto.createHmac("sha256", SECRET).update(body).digest("hex");

  function capturedEvent(intentId, { order, pay, amount = 50000, currency = "INR", event = "payment.captured", email } = {}) {
    if (event === "order.paid") {
      return {
        event,
        payload: {
          order: { entity: { id: order, amount, amount_paid: amount, currency, status: "paid", notes: intentId ? { intentId } : {} } },
          payment: { entity: { id: pay, order_id: order, amount, currency, status: "captured", notes: intentId ? { intentId } : {} } },
        },
      };
    }
    return {
      event,
      payload: {
        payment: {
          entity: {
            id: pay, order_id: order, amount, currency, status: "captured", method: "upi",
            email: email || "payer@example.test", contact: "+919000000001", vpa: "payer@upi",
            notes: intentId ? { intentId } : {},
          },
        },
      },
    };
  }

  async function send(body, { sig, raw, eventId } = {}) {
    const text = raw ?? JSON.stringify(body);
    const headers = { "content-type": "application/json" };
    if (sig !== null) headers["x-razorpay-signature"] = sig ?? sign(text);
    if (eventId) headers["x-razorpay-event-id"] = eventId;
    const res = await POST(new Request("http://localhost/api/razorpay/webhook", { method: "POST", headers, body: text }));
    let json = {};
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
  }

  /** Seeds a pending merch-order intent and returns ids. */
  async function seedIntent(extra = {}) {
    const intentId = uid("intent");
    const order = uid("order").replace(/^order/, "order_");
    const pay = `pay_${uid("P")}`;
    await db.collection("razorpayIntents").doc(intentId).set({
      type: "merch_order", orderId: order, amount: 500, currency: "INR", status: "pending",
      orderPayload: { id: `mo_${intentId}`, playerId: "p_r3", items: [] },
      ...extra,
    });
    return { intentId, order, pay };
  }

  const intentOf = async (id) => (await db.collection("razorpayIntents").doc(id).get()).data();
  const merchOrderExists = async (intentId) => (await db.collection("merchOrders").doc(`mo_${intentId}`).get()).exists;

  function failingDb(code, message) {
    return new Proxy(db, {
      get(target, key) {
        if (key === "runTransaction") return async () => { throw Object.assign(new Error(message), { code }); };
        const v = target[key];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  }

  // ── happy path and duplicates ──

  it("R3-01 valid payment.captured → 200 processed; intent paid; order fulfilled", async () => {
    const t = await seedIntent();
    const r = await send(capturedEvent(t.intentId, t), { eventId: "evt_R3valid01" });
    assert.equal(r.status, 200);
    assert.equal(r.json.outcome, "processed");
    assert.equal(r.json.correlationId, "evt_R3valid01");
    assert.equal((await intentOf(t.intentId)).status, "paid");
    assert.equal(await merchOrderExists(t.intentId), true);
  });

  it("R3-02 duplicate delivery of the same event → 200 already_processed, no second fulfilment", async () => {
    const t = await seedIntent();
    const ev = capturedEvent(t.intentId, t);
    assert.equal((await send(ev)).json.outcome, "processed");
    const r = await send(ev);
    assert.equal(r.status, 200);
    assert.equal(r.json.outcome, "already_processed");
  });

  it("R3-03 same payment via a different event (order.paid after payment.captured) → 200 already_processed", async () => {
    const t = await seedIntent();
    assert.equal((await send(capturedEvent(t.intentId, t), { eventId: "evt_R3a" })).json.outcome, "processed");
    const r = await send(capturedEvent(t.intentId, { ...t, event: "order.paid" }), { eventId: "evt_R3b" });
    assert.equal(r.status, 200);
    assert.equal(r.json.outcome, "already_processed");
  });

  it("R3-04 concurrent duplicate deliveries (6 in parallel) → all 200, exactly one fulfilment", async () => {
    const t = await seedIntent();
    const ev = capturedEvent(t.intentId, t);
    const results = await Promise.all(Array.from({ length: 6 }, () => send(ev)));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
    assert.equal(results.filter((r) => r.json.outcome === "processed").length, 1);
    assert.equal(results.filter((r) => r.json.outcome === "already_processed").length, 5);
    assert.equal((await intentOf(t.intentId)).razorpayPaymentId, t.pay);
  });

  // ── signature and parsing ──

  it("R3-05 missing signature → 401, no state change", async () => {
    const t = await seedIntent();
    const r = await send(capturedEvent(t.intentId, t), { sig: null });
    assert.equal(r.status, 401);
    assert.equal(r.json.code, "SIGNATURE_MISSING");
    assert.equal((await intentOf(t.intentId)).status, "pending");
  });

  it("R3-06 invalid signature → 401, no state change", async () => {
    const t = await seedIntent();
    const r = await send(capturedEvent(t.intentId, t), { sig: "ab".repeat(32) });
    assert.equal(r.status, 401);
    assert.equal(r.json.code, "SIGNATURE_INVALID");
    assert.equal((await intentOf(t.intentId)).status, "pending");
  });

  it("R3-07 altered raw payload with the original signature → 401, no state change", async () => {
    const t = await seedIntent();
    const body = JSON.stringify(capturedEvent(t.intentId, t));
    const r = await send(null, { raw: body.replace('"amount":50000', '"amount":100'), sig: sign(body) });
    assert.equal(r.status, 401);
    assert.equal((await intentOf(t.intentId)).status, "pending");
  });

  it("R3-08 malformed JSON with a valid signature → 400 MALFORMED_JSON (no parser text echoed)", async () => {
    const raw = "{not json";
    const r = await send(null, { raw, sig: sign(raw) });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "MALFORMED_JSON");
    assert.doesNotMatch(JSON.stringify(r.json), /position|SyntaxError/);
  });

  it("R3-09 event types we do not act on → 200 ignored", async () => {
    const r = await send({ event: "payment.failed", payload: {} });
    assert.equal(r.status, 200);
    assert.equal(r.json.outcome, "ignored");
  });

  // ── permanent failures: never fulfil ──

  for (const [id, label, mutate, code] of [
    ["R3-10", "amount mismatch", (t) => ({ ...t, amount: 100 }), "AMOUNT_MISMATCH"],
    ["R3-11", "currency mismatch", (t) => ({ ...t, currency: "USD" }), "CURRENCY_MISMATCH"],
    ["R3-12", "order id mismatch", (t) => ({ ...t, order: "order_SOMEONEELSE" }), "ORDER_MISMATCH"],
  ]) {
    it(`${id} ${label} → 422 ${code}; intent stays pending; nothing fulfilled; no internal values echoed`, async () => {
      const t = await seedIntent();
      const r = await send(capturedEvent(t.intentId, mutate(t)));
      assert.equal(r.status, 422);
      assert.equal(r.json.code, code);
      assert.equal((await intentOf(t.intentId)).status, "pending");
      assert.equal(await merchOrderExists(t.intentId), false);
      const echoed = JSON.stringify(r.json);
      assert.doesNotMatch(echoed, /expected|paise/i);
      for (const internal of [t.order, "order_SOMEONEELSE", t.intentId, "50000"]) {
        assert.equal(echoed.includes(internal), false, `response must not echo ${internal}`);
      }
    });
  }

  it("R3-13 unknown intentId → 422 INTENT_NOT_FOUND", async () => {
    const r = await send(capturedEvent("intent_does_not_exist", { order: "order_X1", pay: "pay_X1" }));
    assert.equal(r.status, 422);
    assert.equal(r.json.code, "INTENT_NOT_FOUND");
  });

  it("R3-14 second, different payment captured for an already-paid intent → 422 CONFLICTING_PAYMENT; original payment kept", async () => {
    const t = await seedIntent();
    assert.equal((await send(capturedEvent(t.intentId, t))).status, 200);
    const r = await send(capturedEvent(t.intentId, { ...t, pay: "pay_SECONDCAPTURE" }));
    assert.equal(r.status, 422);
    assert.equal(r.json.code, "CONFLICTING_PAYMENT");
    assert.equal((await intentOf(t.intentId)).razorpayPaymentId, t.pay);
  });

  // ── retryable failures: 5xx, then recovery ──

  it("R3-15 Firestore UNAVAILABLE / DEADLINE_EXCEEDED / contention ABORTED → 503 INFRASTRUCTURE; nothing fulfilled", async () => {
    const t = await seedIntent();
    for (const [code, msg] of [[14, "14 UNAVAILABLE: simulated"], [4, "4 DEADLINE_EXCEEDED: simulated"], [10, "10 ABORTED: Too much contention"]]) {
      serverDb.setServerDbForTesting(failingDb(code, msg));
      try {
        const r = await send(capturedEvent(t.intentId, t));
        assert.equal(r.status, 503, `gRPC code ${code} must be retryable`);
        assert.equal(r.json.code, "INFRASTRUCTURE");
      } finally {
        serverDb.setServerDbForTesting(db);
      }
    }
    assert.equal((await intentOf(t.intentId)).status, "pending");
    assert.equal(await merchOrderExists(t.intentId), false);
  });

  it("R3-16 recovery: the same event retried after a transient failure → 200 processed, once", async () => {
    const t = await seedIntent();
    serverDb.setServerDbForTesting(failingDb(14, "14 UNAVAILABLE: simulated"));
    try {
      assert.equal((await send(capturedEvent(t.intentId, t))).status, 503);
    } finally {
      serverDb.setServerDbForTesting(db);
    }
    const r = await send(capturedEvent(t.intentId, t));
    assert.equal(r.status, 200);
    assert.equal(r.json.outcome, "processed");
    assert.equal((await send(capturedEvent(t.intentId, t))).json.outcome, "already_processed");
  });

  it("R3-17 player merge in progress → 503 MERGE_IN_PROGRESS; after the merge settles the retry succeeds", async () => {
    const playerId = uid("p_merge");
    const matchId = uid("m");
    await db.collection("players").doc(playerId).set({ name: "Merging", mergeStatus: "in_progress" });
    await db.collection("matches").doc(matchId).collection("payments").doc("pm1").set({ playerId, status: "Unpaid", amount: 500 });
    const t = await seedIntent({ type: "match", matchId, paymentId: "pm1", orderPayload: null });
    const r = await send(capturedEvent(t.intentId, t));
    assert.equal(r.status, 503);
    assert.equal(r.json.code, "MERGE_IN_PROGRESS");
    assert.equal((await intentOf(t.intentId)).status, "pending");

    await db.collection("players").doc(playerId).update({ mergeStatus: "completed" });
    const retry = await send(capturedEvent(t.intentId, t));
    assert.equal(retry.status, 200);
    assert.equal(retry.json.outcome, "processed");
  });

  // ── logging hygiene ──

  it("R3-18 logs carry correlation id and reason codes but never the secret, signature or payer contact data", async () => {
    const t = await seedIntent();
    const ev = capturedEvent(t.intentId, { ...t, amount: 1, email: "leak-check@example.test" });
    const body = JSON.stringify(ev);
    logLines.length = 0;
    await send(null, { raw: body, sig: sign(body), eventId: "evt_R3logcheck" });
    const all = logLines.join("\n");
    assert.match(all, /cid=evt_R3logcheck/);
    assert.match(all, /reason=AMOUNT_MISMATCH/);
    for (const forbidden of [SECRET, sign(body), "leak-check@example.test", "+919000000001", "payer@upi"]) {
      assert.equal(all.includes(forbidden), false, `logs must not contain ${forbidden.slice(0, 12)}…`);
    }
  });
});
