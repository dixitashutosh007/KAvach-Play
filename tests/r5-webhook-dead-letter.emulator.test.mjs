/**
 * R5 — unmatched / rejected webhook events and reconciliation
 * (tests/r5-webhook-dead-letter.emulator.test.mjs)
 *
 * Production code exercised against the Firestore emulator:
 *   - app/api/razorpay/webhook/route.ts POST (real HMAC signatures over the raw body)
 *   - app/api/finance/webhook-reconciliation/route.ts GET/POST
 *     (caller identity via the KAVACH_TEST_AUTH_BYPASS x-test-* headers, which the emulator runner
 *      enables; token verification itself is covered by R1)
 *   - firestore.rules for webhookDeadLetters (@firebase/rules-unit-testing)
 * Mocked: only the "dead-letter store unavailable" case (R5-10), injected by wrapping Firestore.
 *
 * Run: npm run test:emulator -- tests/r5-webhook-dead-letter.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)";
const SECRET = "whsec_r5_emulator_only";
const DL = "webhookDeadLetters";

describe("R5: webhook dead-letter recording and finance reconciliation", { skip }, () => {
  let db;
  let serverDb;
  let webhookPOST;
  let recon;
  let seq = 0;
  const savedConsole = {};

  before(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      KAVACH_TEST_AUTH_BYPASS: "true",
      AWS_BRANCH: "main",
      NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412",
      RAZORPAY_WEBHOOK_SECRET: SECRET,
    });
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "kavach-r5-deadletter-test" });
    db = getFirestore(app);
    serverDb = await import("../lib/server-db.ts");
    serverDb.setServerDbForTesting(db);
    ({ POST: webhookPOST } = await import("../app/api/razorpay/webhook/route.ts"));
    recon = await import("../app/api/finance/webhook-reconciliation/route.ts");
    for (const level of ["log", "info", "warn", "error"]) {
      savedConsole[level] = console[level];
      console[level] = () => {};
    }
  });

  after(() => {
    for (const [level, fn] of Object.entries(savedConsole)) console[level] = fn;
  });

  const uid = (p) => `${p}_${++seq}_${Date.now()}`;
  const sign = (b) => crypto.createHmac("sha256", SECRET).update(b).digest("hex");

  function evt({ intentId, order, pay, amount = 50000, currency = "INR", event = "payment.captured" }) {
    return {
      event,
      payload: {
        payment: {
          entity: {
            id: pay, order_id: order, amount, currency, status: "captured", method: "upi",
            email: "payer-r5@example.test", contact: "+919000000005", vpa: "payer@upi",
            notes: intentId ? { intentId } : {},
          },
        },
      },
    };
  }

  async function sendWebhook(body, { sig, raw, eventId } = {}) {
    const text = raw ?? JSON.stringify(body);
    const headers = { "content-type": "application/json" };
    if (sig !== null) headers["x-razorpay-signature"] = sig ?? sign(text);
    if (eventId) headers["x-razorpay-event-id"] = eventId;
    const res = await webhookPOST(new Request("http://localhost/api/razorpay/webhook", { method: "POST", headers, body: text }));
    let json = {};
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
  }

  async function seedIntent() {
    const intentId = uid("intent");
    const order = `order_${uid("O")}`;
    const pay = `pay_${uid("P")}`;
    await db.collection("razorpayIntents").doc(intentId).set({
      type: "merch_order", orderId: order, amount: 500, currency: "INR", status: "pending",
      orderPayload: { id: `mo_${intentId}`, playerId: "p_r5", items: [] },
    });
    return { intentId, order, pay };
  }

  const dl = async (key) => (await db.collection(DL).doc(key).get()).data();
  const dlCount = async () => (await db.collection(DL).count().get()).data().count;

  function asCaller(method, { uid: callerUid, roles, body, query = "" } = {}) {
    const headers = { "content-type": "application/json" };
    if (callerUid) {
      headers["x-test-uid"] = callerUid;
      if (roles) headers["x-test-roles"] = roles;
    }
    const url = `http://localhost/api/finance/webhook-reconciliation${query}`;
    const req = new Request(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return (method === "GET" ? recon.GET : recon.POST)(req);
  }

  // ── recording ──

  it("R5-01 valid event without intentId → recorded (unmatched), 200, no payer PII stored", async () => {
    const pay = `pay_${uid("NOINTENT")}`;
    const r = await sendWebhook(evt({ order: `order_${uid("O")}`, pay }), { eventId: "evt_R5noIntent" });
    assert.equal(r.status, 200);
    assert.equal(r.json.outcome, "recorded_for_reconciliation");
    assert.equal(r.json.code, "NO_INTENT_ID");
    const rec = await dl(`pay_${pay}`);
    assert.equal(rec.status, "open");
    assert.equal(rec.classification, "unmatched");
    assert.equal(rec.paymentId, pay);
    assert.deepEqual(rec.eventIds, ["evt_R5noIntent"]);
    assert.equal(rec.amountPaise, 50000);
    const blob = JSON.stringify(rec);
    for (const pii of ["payer-r5@example.test", "+919000000005", "payer@upi"]) assert.equal(blob.includes(pii), false);
  });

  it("R5-02 valid event with an unknown intent / order → recorded INTENT_NOT_FOUND", async () => {
    const pay = `pay_${uid("UNKNOWN")}`;
    const r = await sendWebhook(evt({ intentId: "intent_unknown_r5", order: "order_UNKNOWNR5", pay }));
    assert.equal(r.status, 200);
    assert.equal(r.json.code, "INTENT_NOT_FOUND");
    const rec = await dl(`pay_${pay}`);
    assert.equal(rec.classification, "unmatched");
    assert.equal(rec.intentId, "intent_unknown_r5");
    assert.equal(rec.orderId, "order_UNKNOWNR5");
  });

  it("R5-03 valid event with an unusable payment id → recorded PAYMENT_ID_INVALID; intent untouched", async () => {
    const t = await seedIntent();
    const r = await sendWebhook(evt({ ...t, pay: "not_a_payment_id" }), { eventId: "evt_R5badPay" });
    assert.equal(r.status, 200);
    assert.equal(r.json.code, "PAYMENT_ID_INVALID");
    assert.equal((await dl("evt_evt_R5badPay")).classification, "mismatch");
    assert.equal((await db.collection("razorpayIntents").doc(t.intentId).get()).data().status, "pending");
  });

  it("R5-04 duplicate unmatched event → same single record, deliveryCount 2, both event ids kept", async () => {
    const pay = `pay_${uid("DUP")}`;
    const order = `order_${uid("O")}`;
    const before = await dlCount();
    await sendWebhook(evt({ order, pay }), { eventId: "evt_R5dupA" });
    await sendWebhook(evt({ order, pay, event: "order.paid" }), { eventId: "evt_R5dupB" });
    assert.equal(await dlCount(), before + 1);
    const rec = await dl(`pay_${pay}`);
    assert.equal(rec.deliveryCount, 2);
    assert.deepEqual(rec.eventIds, ["evt_R5dupA", "evt_R5dupB"]);
  });

  it("R5-05 amount mismatch → recorded, intent pending, nothing fulfilled", async () => {
    const t = await seedIntent();
    const r = await sendWebhook(evt({ ...t, amount: 100 }));
    assert.equal(r.status, 200);
    assert.equal(r.json.code, "AMOUNT_MISMATCH");
    assert.equal((await dl(`pay_${t.pay}`)).classification, "mismatch");
    assert.equal((await db.collection("razorpayIntents").doc(t.intentId).get()).data().status, "pending");
    assert.equal((await db.collection("merchOrders").doc(`mo_${t.intentId}`).get()).exists, false);
  });

  it("R5-06 second captured payment on a paid intent → recorded conflicting_payment; original payment kept", async () => {
    const t = await seedIntent();
    assert.equal((await sendWebhook(evt(t))).json.outcome, "processed");
    const second = `pay_${uid("SECOND")}`;
    const r = await sendWebhook(evt({ ...t, pay: second }));
    assert.equal(r.status, 200);
    assert.equal(r.json.code, "CONFLICTING_PAYMENT");
    const rec = await dl(`pay_${second}`);
    assert.equal(rec.classification, "conflicting_payment");
    assert.equal(rec.intentId, t.intentId);
    assert.equal((await db.collection("razorpayIntents").doc(t.intentId).get()).data().razorpayPaymentId, t.pay);
  });

  it("R5-07 invalid signature → 401 and nothing recorded", async () => {
    const before = await dlCount();
    const r = await sendWebhook(evt({ order: "order_SIG", pay: `pay_${uid("SIG")}` }), { sig: "cd".repeat(32) });
    assert.equal(r.status, 401);
    assert.equal(await dlCount(), before);
  });

  it("R5-08 malformed JSON → 400 and nothing recorded", async () => {
    const before = await dlCount();
    const raw = "{oops";
    assert.equal((await sendWebhook(null, { raw, sig: sign(raw) })).status, 400);
    assert.equal(await dlCount(), before);
  });

  it("R5-09 already-processed duplicate → 200 already_processed and nothing recorded", async () => {
    const t = await seedIntent();
    await sendWebhook(evt(t));
    const before = await dlCount();
    const r = await sendWebhook(evt(t));
    assert.equal(r.json.outcome, "already_processed");
    assert.equal(await dlCount(), before);
  });

  it("R5-10 (mocked store failure) if the record cannot be written → 503 so Razorpay retries; never 200", async () => {
    const failing = new Proxy(db, {
      get(target, key) {
        if (key === "runTransaction") return async () => { throw Object.assign(new Error("14 UNAVAILABLE: simulated"), { code: 14 }); };
        const v = target[key];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    serverDb.setServerDbForTesting(failing);
    try {
      const r = await sendWebhook(evt({ order: "order_STOREDOWN", pay: `pay_${uid("DOWN")}` }));
      assert.equal(r.status, 503);
      assert.equal(r.json.code, "DEAD_LETTER_WRITE_FAILED");
    } finally {
      serverDb.setServerDbForTesting(db);
    }
  });

  // ── reconciliation API ──

  it("R5-11 Finance Admin lists open records and resolves one; outcome and audit entry stored; resolve is once-only", async () => {
    const pay = `pay_${uid("RESOLVE")}`;
    await sendWebhook(evt({ order: `order_${uid("O")}`, pay }));
    const key = `pay_${pay}`;

    const list = await asCaller("GET", { uid: "uid_fin_r5", roles: "financeAdmin" });
    assert.equal(list.status, 200);
    const items = (await list.json()).items;
    assert.ok(items.some((i) => i.id === key && i.status === "open"));
    assert.equal(JSON.stringify(items).includes("payer-r5@example.test"), false);

    const res = await asCaller("POST", { uid: "uid_fin_r5", roles: "financeAdmin", body: { id: key, resolution: "refund_initiated", note: "Refunded via Razorpay dashboard" } });
    assert.equal(res.status, 200);
    const rec = await dl(key);
    assert.equal(rec.status, "resolved");
    assert.equal(rec.resolution, "refund_initiated");
    assert.equal(rec.resolvedBy, "uid_fin_r5");
    assert.equal(rec.resolutionNote, "Refunded via Razorpay dashboard");
    const audit = await db.collection("auditLogs").where("entityId", "==", key).get();
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0].data().entity, "webhook_dead_letter");

    const again = await asCaller("POST", { uid: "uid_fin_r5", roles: "financeAdmin", body: { id: key, resolution: "other", note: "change" } });
    assert.equal(again.status, 409);
  });

  it("R5-12 re-delivery after resolution does not reopen the record", async () => {
    const pay = `pay_${uid("REOPEN")}`;
    const order = `order_${uid("O")}`;
    await sendWebhook(evt({ order, pay }));
    await asCaller("POST", { uid: "uid_super_r5", roles: "superAdmin", body: { id: `pay_${pay}`, resolution: "linked_to_obligation" } });
    const r = await sendWebhook(evt({ order, pay }));
    assert.equal(r.status, 200);
    const rec = await dl(`pay_${pay}`);
    assert.equal(rec.status, "resolved");
    assert.equal(rec.resolution, "linked_to_obligation");
    assert.equal(rec.deliveryCount, 2);
  });

  it("R5-13 unauthorised callers: unauthenticated 401; player, Club Admin and Designer 403 (list and resolve)", async () => {
    const pay = `pay_${uid("AUTHZ")}`;
    await sendWebhook(evt({ order: `order_${uid("O")}`, pay }));
    assert.equal((await asCaller("GET", {})).status, 401);
    for (const roles of ["player", "clubAdmin", "isDesigner"]) {
      assert.equal((await asCaller("GET", { uid: "uid_x", roles })).status, 403, `${roles} list`);
      assert.equal((await asCaller("POST", { uid: "uid_x", roles, body: { id: `pay_${pay}`, resolution: "duplicate_no_action" } })).status, 403, `${roles} resolve`);
    }
    assert.equal((await dl(`pay_${pay}`)).status, "open");
  });

  it("R5-14 resolve input validation: unknown keys, bad resolution, missing note for 'other', unknown id", async () => {
    const fin = { uid: "uid_fin_r5", roles: "financeAdmin" };
    assert.equal((await asCaller("POST", { ...fin, body: { id: "x", resolution: "refund_initiated", status: "resolved" } })).status, 400);
    assert.equal((await asCaller("POST", { ...fin, body: { id: "x", resolution: "mark_paid" } })).status, 400);
    assert.equal((await asCaller("POST", { ...fin, body: { id: "x", resolution: "other" } })).status, 400);
    assert.equal((await asCaller("POST", { ...fin, body: { id: "no_such_record", resolution: "duplicate_no_action" } })).status, 404);
  });
});

describe("R5: firestore.rules for webhookDeadLetters", { skip }, () => {
  let testEnv;
  let assertFails;
  let assertSucceeds;

  before(async () => {
    const rut = await import("@firebase/rules-unit-testing");
    ({ assertFails, assertSucceeds } = rut);
    const rules = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../firestore.rules"), "utf8");
    const [host, port] = emulatorHost.split(":");
    testEnv = await rut.initializeTestEnvironment({ projectId: "kavach-r5-rules-test", firestore: { host, port: Number(port), rules } });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.firestore();
      await d.collection("appUsers").doc("uid_fin").set({ isFinanceAdmin: true, status: "Active" });
      await d.collection("appUsers").doc("uid_club").set({ isClubAdmin: true, status: "Active" });
      await d.collection("appUsers").doc("uid_player").set({ status: "Active" });
      await d.collection(DL).doc("pay_rules1").set({ status: "open", reason: "NO_INTENT_ID" });
    });
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  const as = (u, claims = {}) => testEnv.authenticatedContext(u, claims).firestore();

  it("R5-15 Finance Admin and Super Admin can read; player and Club Admin cannot; nobody can write", async () => {
    await assertSucceeds(as("uid_fin").collection(DL).get());
    await assertSucceeds(as("uid_super", { admin: true }).collection(DL).doc("pay_rules1").get());
    await assertFails(as("uid_player").collection(DL).get());
    await assertFails(as("uid_club").collection(DL).get());
    await assertFails(as("uid_fin").collection(DL).doc("pay_rules1").update({ status: "resolved" }));
    await assertFails(as("uid_fin").collection(DL).doc("pay_new").set({ status: "open" }));
    await assertFails(as("uid_super", { admin: true }).collection(DL).doc("pay_rules1").delete());
  });
});
