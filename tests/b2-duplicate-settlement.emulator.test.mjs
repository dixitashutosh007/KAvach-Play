/**
 * B2 — core duplicate-settlement protection (tests/b2-duplicate-settlement.emulator.test.mjs)
 *
 * Production code against the Firestore emulator:
 *  - POST app/api/razorpay/webhook/route.ts (real HMAC signatures)
 *  - POST app/api/razorpay/order/route.ts (test auth bypass; Razorpay SDK stubbed, no network)
 *  - lib/razorpay-webhook.ts processWebhookPayment (registry, decision, dead-letter in ONE transaction)
 *
 * Stubbed: only the Razorpay SDK resources (any network attempt throws) and, in the outage tests,
 * the Firestore runTransaction wrapper used to inject failures before / after a real commit.
 *
 * Run: npm run test:emulator -- tests/b2-duplicate-settlement.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip =
  (!emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)") ||
  (process.env.KAVACH_TEST_AUTH_BYPASS !== "true" && "KAVACH_TEST_AUTH_BYPASS not set (run via npm run test:emulator)");
const SECRET = "whsec_b2_emulator_only";

describe("B2: duplicate settlement protection (Firestore emulator)", { skip }, () => {
  let db;
  let serverDb;
  let webhookPOST;
  let orderPOST;
  let getClubCalendarDate;
  let seq = 0;
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
    const { default: Razorpay } = await import("razorpay");
    let n = 0;
    Razorpay.prototype.addResources = function () {
      const refuse = () => { throw new Error("Network access to Razorpay is forbidden in tests."); };
      this.api = { get: refuse, post: refuse, put: refuse, patch: refuse, delete: refuse };
      this.orders = {
        create: async (opts) => ({ id: `order_stubB2${++n}x${Date.now()}`, amount: opts.amount, currency: opts.currency, receipt: opts.receipt, status: "created", notes: {} }),
        all: refuse,
        fetch: refuse,
      };
    };
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "kavach-b2-test" });
    db = getFirestore(app);
    serverDb = await import("../lib/server-db.ts");
    serverDb.setServerDbForTesting(db);
    ({ POST: webhookPOST } = await import("../app/api/razorpay/webhook/route.ts"));
    ({ POST: orderPOST } = await import("../app/api/razorpay/order/route.ts"));
    ({ getClubCalendarDate } = await import("../lib/utils.ts"));
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
  const data = async (path) => {
    const snap = await db.doc(path).get();
    return snap.exists ? snap.data() : null;
  };
  const addDays = (ymd, days) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  };
  const today = () => getClubCalendarDate(new Date()).dateString;

  function captured(intentId, order, pay, amountPaise, { event = "payment.captured", currency = "INR" } = {}) {
    const payment = { id: pay, order_id: order, amount: amountPaise, currency, status: "captured", notes: intentId ? { intentId } : {} };
    if (event === "order.paid") {
      return { event, payload: { order: { entity: { id: order, amount: amountPaise, amount_paid: amountPaise, currency, status: "paid", notes: { intentId } } }, payment: { entity: payment } } };
    }
    return { event, payload: { payment: { entity: payment } } };
  }

  async function deliver(body, dbOverride) {
    if (dbOverride) serverDb.setServerDbForTesting(dbOverride);
    try {
      const text = JSON.stringify(body);
      const res = await webhookPOST(new Request("http://localhost/api/razorpay/webhook", {
        method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": sign(text) }, body: text,
      }));
      return { status: res.status, json: await res.json() };
    } finally {
      if (dbOverride) serverDb.setServerDbForTesting(db);
    }
  }

  /** A player with one unpaid match fee (₹500). */
  async function seedMatchFee({ fee = 500 } = {}) {
    const playerId = uid("player");
    const matchId = uid("match");
    await db.doc(`players/${playerId}`).set({ name: "Player" });
    await db.doc(`matches/${matchId}`).set({ fee, date: "2026-11-01", opponent: "XI" });
    await db.doc(`matches/${matchId}/payments/pm`).set({ playerId, status: "Unpaid" });
    return { playerId, matchId, paymentId: "pm", path: `matches/${matchId}/payments/pm` };
  }

  /** A pending intent exactly as the order route stores it. */
  async function seedIntent(fields) {
    const intentId = uid("intent");
    const order = `order_${uid("O")}`;
    await db.doc(`razorpayIntents/${intentId}`).set({ currency: "INR", status: "pending", orderId: order, createdAt: new Date(), ...fields });
    return { intentId, order, pay: `pay_${uid("P")}` };
  }
  const matchIntent = (o, extra = {}) => seedIntent({ type: "match", matchId: o.matchId, paymentId: o.paymentId, playerId: o.playerId, userId: "u", amount: 500, ...extra });
  const duesIntent = (playerId, items, amount) => seedIntent({ type: "finance_dues", playerId, userId: "u", items, amount });
  const pay = (t, amountPaise = 50000, opts) => deliver(captured(t.intentId, t.order, t.pay, amountPaise, opts));

  // ── match fees: one application per obligation ──

  for (const order of ["first-then-second", "second-then-first"]) {
    it(`B2-01 two intents for one match fee (${order}): exactly one applied, the other recorded as duplicate`, async () => {
      const o = await seedMatchFee();
      const a = await matchIntent(o);
      const b = await matchIntent(o);
      const [x, y] = order === "first-then-second" ? [a, b] : [b, a];
      const r1 = await pay(x);
      const afterFirst = await data(o.path);
      const r2 = await pay(y);
      assert.equal(r1.json.outcome, "processed");
      assert.equal(r2.status, 200);
      assert.equal(r2.json.decision, "duplicate");
      assert.equal(r2.json.code, "OBLIGATION_SETTLED");
      assert.deepEqual(await data(o.path), afterFirst, "the applied payment is never overwritten");
      assert.equal(afterFirst.razorpayPaymentId, x.pay);
      assert.equal((await data(`gatewayPayments/${x.pay}`)).application, "applied");
      assert.equal((await data(`gatewayPayments/${y.pay}`)).application, "rejected_duplicate");
      assert.equal((await data(`razorpayIntents/${y.intentId}`)).status, "paid_unapplied");
      assert.equal((await data(`webhookDeadLetters/pay_${y.pay}`)).classification, "duplicate_payment");
    });
  }

  it("B2-02 two intents for one match fee captured concurrently (×5): exactly one application each time", async () => {
    for (let i = 0; i < 5; i += 1) {
      const o = await seedMatchFee();
      const a = await matchIntent(o);
      const b = await matchIntent(o);
      const results = await Promise.all([pay(a), pay(b)]);
      assert.deepEqual(results.map((r) => r.status), [200, 200]);
      const apps = [await data(`gatewayPayments/${a.pay}`), await data(`gatewayPayments/${b.pay}`)].map((r) => r.application).sort();
      assert.deepEqual(apps, ["applied", "rejected_duplicate"]);
      const paidBy = (await data(o.path)).razorpayPaymentId;
      assert.ok([a.pay, b.pay].includes(paidBy));
    }
  });

  it("B2-03 six concurrent deliveries of one payment (payment.captured + order.paid): one record, one application", async () => {
    const o = await seedMatchFee();
    const t = await matchIntent(o);
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => pay(t, 50000, { event: i % 2 ? "order.paid" : "payment.captured" })));
    for (const r of results) assert.equal(r.status, 200);
    assert.equal(results.filter((r) => r.json.outcome === "processed").length, 1);
    assert.equal(results.filter((r) => r.json.outcome === "already_processed").length, 5);
    assert.equal((await data(`gatewayPayments/${t.pay}`)).application, "applied");
  });

  it("B2-04 manual cash settlement, then a Razorpay capture → duplicate; the cash record is untouched", async () => {
    const o = await seedMatchFee();
    const t = await matchIntent(o);
    await db.doc(o.path).update({ status: "Paid", paymentMethod: "manual", manualMethod: "cash_collected", feeCollectedAmount: 500 });
    const cash = await data(o.path);
    const r = await pay(t);
    assert.equal(r.json.decision, "duplicate");
    assert.deepEqual(await data(o.path), cash);
    assert.equal((await data(`gatewayPayments/${t.pay}`)).application, "rejected_duplicate");
  });

  it("B2-05 pre-cutover payment redelivered: replay, never a duplicate; historical records unchanged", async () => {
    const o = await seedMatchFee();
    const t = await matchIntent(o);
    await db.doc(`razorpayIntents/${t.intentId}`).update({ status: "paid", razorpayPaymentId: t.pay });
    await db.doc(o.path).update({ status: "Paid", paymentMethod: "razorpay", razorpayPaymentId: t.pay });
    const before = [await data(o.path), await data(`razorpayIntents/${t.intentId}`)];
    const r = await pay(t);
    assert.equal(r.json.outcome, "already_processed");
    assert.deepEqual([await data(o.path), await data(`razorpayIntents/${t.intentId}`)], before);
    const reg = await data(`gatewayPayments/${t.pay}`);
    assert.equal(reg.application, "applied");
    assert.equal(reg.source, "pre_cutover_replay");
    assert.equal(await data(`webhookDeadLetters/pay_${t.pay}`), null);
    assert.equal((await pay(t)).json.outcome, "already_processed", "and replays stay replays");
  });

  it("B2-06 a second, different payment for the same intent → duplicate (CONFLICTING_PAYMENT); the first is kept", async () => {
    const o = await seedMatchFee();
    const t = await matchIntent(o);
    await pay(t);
    const before = [await data(o.path), await data(`razorpayIntents/${t.intentId}`)];
    const second = { ...t, pay: `pay_${uid("P2")}` };
    const r = await pay(second);
    assert.equal(r.json.decision, "duplicate");
    assert.equal(r.json.code, "CONFLICTING_PAYMENT");
    assert.deepEqual([await data(o.path), await data(`razorpayIntents/${t.intentId}`)], before);
    assert.equal((await data(`gatewayPayments/${second.pay}`)).application, "rejected_duplicate");
  });

  it("B2-07 wrong player, amount, currency or order identity is never applied", async () => {
    // wrong player: the obligation belongs to someone else
    const o = await seedMatchFee();
    const other = await seedMatchFee();
    const wp = await matchIntent({ ...o, playerId: other.playerId });
    const r1 = await pay(wp);
    assert.equal(r1.json.decision, "held");
    assert.equal(r1.json.code, "OBLIGATION_CONFLICT");
    assert.equal((await data(o.path)).status, "Unpaid");
    // wrong amount / currency / order
    const t = await matchIntent(o);
    assert.equal((await pay(t, 10000)).json.code, "AMOUNT_MISMATCH");
    const t2 = await matchIntent(o);
    assert.equal((await pay(t2, 50000, { currency: "USD" })).json.code, "CURRENCY_MISMATCH");
    const t3 = await matchIntent(o);
    assert.equal((await deliver(captured(t3.intentId, "order_WRONG", t3.pay, 50000))).json.code, "ORDER_MISMATCH");
    for (const x of [t, t2, t3]) {
      assert.equal((await data(`gatewayPayments/${x.pay}`)).application, "unmatched");
      assert.equal((await data(`razorpayIntents/${x.intentId}`)).status, "pending");
    }
    assert.equal((await data(o.path)).status, "Unpaid");
  });

  it("B2-08 same payment id with a different identity → identity conflict; the original record is never touched", async () => {
    const o = await seedMatchFee();
    const t = await matchIntent(o);
    await pay(t);
    const original = await data(`gatewayPayments/${t.pay}`);
    const r = await deliver(captured(t.intentId, t.order, t.pay, 99900));
    assert.equal(r.json.decision, "identity_conflict");
    assert.deepEqual(await data(`gatewayPayments/${t.pay}`), original);
    const dls = await db.collection("webhookDeadLetters").where("paymentId", "==", t.pay).get();
    assert.equal(dls.size, 1);
    assert.match(dls.docs[0].id, /^conflict_/);
    assert.equal(dls.docs[0].data().classification, "identity_conflict");
  });

  // ── bundles: all or nothing, never skipped ──

  it("B2-09 bundle with a missing obligation → held; no partial settlement", async () => {
    const o = await seedMatchFee();
    const t = await duesIntent(o.playerId, [
      { type: "match", matchId: o.matchId, paymentId: o.paymentId, amount: 500 },
      { type: "other", feeId: "fee_does_not_exist", amount: 200 },
    ], 700);
    const r = await pay(t, 70000);
    assert.equal(r.json.decision, "held");
    assert.equal(r.json.code, "OBLIGATION_MISSING");
    assert.equal((await data(o.path)).status, "Unpaid", "the payable item is not settled on its own");
    assert.equal((await data(`gatewayPayments/${t.pay}`)).application, "held_for_review");
    assert.equal((await data(`razorpayIntents/${t.intentId}`)).status, "exception");
  });

  it("B2-10 bundle with one settled and one payable obligation → duplicate; the payable one stays unpaid", async () => {
    const o = await seedMatchFee();
    await db.doc(`players/${o.playerId}/otherFees/kit`).set({ playerId: o.playerId, title: "Kit", amount: 200, status: "Paid" });
    const t = await duesIntent(o.playerId, [
      { type: "match", matchId: o.matchId, paymentId: o.paymentId, amount: 500 },
      { type: "other", feeId: "kit", amount: 200 },
    ], 700);
    const r = await pay(t, 70000);
    assert.equal(r.json.decision, "duplicate");
    assert.equal((await data(o.path)).status, "Unpaid");
  });

  it("B2-11 an amount changed after the order → held (O-5), nothing applied", async () => {
    const o = await seedMatchFee();
    const t = await matchIntent(o);
    await db.doc(o.path).update({ feeOverride: 450 });
    const r = await pay(t);
    assert.equal(r.json.code, "OBLIGATION_CHANGED");
    assert.equal((await data(o.path)).status, "Unpaid");
  });

  it("B2-12 a fully payable bundle applies every obligation in one commit (match + other + dues merch)", async () => {
    const o = await seedMatchFee();
    await db.doc(`players/${o.playerId}/otherFees/kit`).set({ playerId: o.playerId, title: "Kit", amount: 200, status: "Unpaid" });
    const merchId = uid("mo");
    await db.doc(`merchOrders/${merchId}`).set({ playerId: o.playerId, price: 300, paymentStatus: "Unpaid", orderStatus: "Order Placed" });
    const t = await duesIntent(o.playerId, [
      { type: "match", matchId: o.matchId, paymentId: o.paymentId, amount: 500 },
      { type: "other", feeId: "kit", amount: 200 },
      { type: "merch", merchId, amount: 300 },
    ], 1000);
    const r = await pay(t, 100000);
    assert.equal(r.json.outcome, "processed");
    assert.equal((await data(o.path)).status, "Paid");
    assert.equal((await data(`players/${o.playerId}/otherFees/kit`)).status, "Paid");
    assert.equal((await data(`merchOrders/${merchId}`)).paymentStatus, "Paid");
    const reg = await data(`gatewayPayments/${t.pay}`);
    assert.equal(reg.appliedTo.length, 3);
    assert.equal(reg.appliedTo.reduce((s, x) => s + x.amountPaise, 0), 100000);
  });

  // ── late fees: interim guard (§18) ──

  it("B2-13 late-fee interim guard: a recorded late fee holds a new capture that includes it", async () => {
    const o = await seedMatchFee({ fee: 350 });
    await db.doc(`players/${o.playerId}/otherFees/lf_old`).set({ playerId: o.playerId, title: "Late Fee", templateId: `latefee_${o.matchId}`, amount: 150, status: "Paid" });
    const t = await matchIntent(o, { amount: 500, lateFeeItems: [{ playerId: o.playerId, label: "Late Fee", amount: 150, templateId: `latefee_${o.matchId}_0` }] });
    const r = await pay(t);
    assert.equal(r.json.decision, "held");
    assert.equal(r.json.code, "LATE_FEE_ALREADY_RECORDED");
    assert.equal((await data(o.path)).status, "Unpaid");
    assert.equal((await db.collection(`players/${o.playerId}/otherFees`).get()).size, 1, "no second late-fee record");
  });

  it("B2-14 late-fee interim guard at order time: a recorded or exempted late fee is not offered again", async () => {
    const authUid = uid("uid");
    const o = await seedMatchFee({ fee: 350 });
    await db.doc(`players/${o.playerId}`).set({ name: "Player", authUid });
    await db.doc(`matches/${o.matchId}`).set({ fee: 350, date: "2026-01-03", opponent: "XI" }); // Saturday, long overdue
    const ask = async () => {
      const res = await orderPOST(new Request("http://localhost/api/razorpay/order", {
        method: "POST", headers: { "content-type": "application/json", "x-test-uid": authUid },
        body: JSON.stringify({ intentData: { type: "match", matchId: o.matchId, paymentId: o.paymentId, includeLateFees: true } }),
      }));
      return { status: res.status, json: await res.json() };
    };
    const first = await ask();
    assert.equal(first.status, 200);
    assert.ok(first.json.amount > 35000, "late fees offered while nothing is recorded");
    await db.doc(`paymentReservations/${(await data(`razorpayIntents/${first.json.intentId}`)).reservationKey}`).delete();
    await db.doc(`players/${o.playerId}/otherFees/lf_old`).set({ playerId: o.playerId, title: "Late Fee", templateId: `latefee_${o.matchId}`, amount: 150, status: "Paid" });
    const second = await ask();
    assert.equal(second.status, 200);
    assert.equal(second.json.amount, 35000, "only the match fee once a late fee is recorded");
  });

  // ── Studio renewal (§16, S1–S7) ──

  async function seedMember({ expiry, linked = true } = {}) {
    const authUid = uid("uid");
    const playerId = linked ? uid("player") : null;
    if (linked) {
      await db.doc(`players/${playerId}`).set({ name: "Member", authUid, ...(expiry ? { studioExpiryDate: expiry } : {}) });
      await db.doc(`appUsers/${authUid}`).set({ playerId, ...(expiry ? { studioExpiryDate: expiry } : {}) });
    } else {
      await db.doc(`appUsers/${authUid}`).set({ ...(expiry ? { studioExpiryDate: expiry } : {}) });
    }
    return { authUid, playerId };
  }
  async function seedPlan(fee = 1000, durationDays = 30) {
    const planId = uid("plan");
    await db.doc(`subscriptionPlans/${planId}`).set({ name: `Plan ${planId}`, fee, durationDays });
    return planId;
  }
  async function orderRenewal(authUid, planId) {
    const res = await orderPOST(new Request("http://localhost/api/razorpay/order", {
      method: "POST", headers: { "content-type": "application/json", "x-test-uid": authUid },
      body: JSON.stringify({ intentData: { type: "subscription", planId } }),
    }));
    const json = await res.json();
    assert.equal(res.status, 200, JSON.stringify(json));
    const intent = await data(`razorpayIntents/${json.intentId}`);
    return { intentId: json.intentId, order: json.id, pay: `pay_${uid("S")}`, amountPaise: json.amount, intent };
  }
  /** A second order for the same basis (as a second device / plan would create). */
  async function cloneRenewalIntent(src, overrides = {}) {
    const intentId = uid("intent");
    const order = `order_${uid("O")}`;
    await db.doc(`razorpayIntents/${intentId}`).set({ ...src.intent, orderId: order, reservationKey: `res_clone_${intentId}`, ...overrides });
    return { intentId, order, pay: `pay_${uid("S")}`, amountPaise: Math.round(Number(overrides.amount ?? src.intent.amount) * 100) };
  }
  const payRenewal = (t) => deliver(captured(t.intentId, t.order, t.pay, t.amountPaise));

  it("B2-S1 one renewal: the order snapshots the basis; the webhook extends from it once (player + appUsers mirror)", async () => {
    const expiry = addDays(today(), 10);
    const m = await seedMember({ expiry });
    const planId = await seedPlan(1000, 30);
    const t = await orderRenewal(m.authUid, planId);
    assert.deepEqual(
      { kind: t.intent.renewal.subjectKind, id: t.intent.renewal.subjectId, basis: t.intent.renewal.basisExpiry, days: t.intent.renewal.durationDays, paise: t.intent.renewal.amountPaise },
      { kind: "player", id: m.playerId, basis: expiry, days: 30, paise: 100000 },
    );
    assert.equal((await payRenewal(t)).json.outcome, "processed");
    const expected = addDays(expiry, 30);
    assert.equal((await data(`players/${m.playerId}`)).studioExpiryDate, expected);
    assert.equal((await data(`appUsers/${m.authUid}`)).studioExpiryDate, expected);
    const anchors = await db.collection("subscriptionHistory").where("intentId", "==", t.intentId).get();
    assert.equal(anchors.size, 1);
    assert.match(anchors.docs[0].id, /^sub_/);
    assert.equal(anchors.docs[0].data().newExpiryDate, expected);
  });

  it("B2-S2 two concurrent renewals for the same period: one extension, the other duplicate", async () => {
    const expiry = addDays(today(), 5);
    const m = await seedMember({ expiry });
    const a = await orderRenewal(m.authUid, await seedPlan());
    const b = await cloneRenewalIntent(a);
    const results = await Promise.all([payRenewal(a), payRenewal(b)]);
    const decisions = results.map((r) => r.json.outcome === "processed" ? "processed" : r.json.decision).sort();
    if (decisions.join() !== "duplicate,processed") process.stderr.write(`S2 results ${JSON.stringify(results)}\n`);
    assert.deepEqual(decisions, ["duplicate", "processed"]);
    assert.equal((await data(`players/${m.playerId}`)).studioExpiryDate, addDays(expiry, 30), "extended exactly once");
  });

  it("B2-S3 an earlier order captured after a later order was created: one extension; the later capture is a duplicate", async () => {
    const expiry = addDays(today(), 3);
    const m = await seedMember({ expiry });
    const planId = await seedPlan();
    const a = await orderRenewal(m.authUid, planId);
    const b = await cloneRenewalIntent(a); // created later, same basis
    assert.equal((await payRenewal(b)).json.outcome, "processed");
    const r = await payRenewal(a);
    assert.equal(r.json.decision, "duplicate");
    assert.equal(r.json.code, "RENEWAL_ALREADY_SETTLED");
    assert.equal((await data(`players/${m.playerId}`)).studioExpiryDate, addDays(expiry, 30));
  });

  it("B2-S4 delayed webhook: a lapsed member gets the full period from capture; an admin change in between holds it", async () => {
    const lapsed = addDays(today(), -20);
    const m = await seedMember({ expiry: lapsed });
    const t = await orderRenewal(m.authUid, await seedPlan());
    assert.equal((await payRenewal(t)).json.outcome, "processed");
    assert.equal((await data(`players/${m.playerId}`)).studioExpiryDate, addDays(today(), 30));

    const m2 = await seedMember({ expiry: addDays(today(), 2) });
    const t2 = await orderRenewal(m2.authUid, await seedPlan());
    await db.doc(`players/${m2.playerId}`).update({ studioExpiryDate: addDays(today(), 90) }); // admin edit
    const r = await payRenewal(t2);
    assert.equal(r.json.decision, "held");
    assert.equal(r.json.code, "RENEWAL_BASIS_CHANGED");
    assert.equal((await data(`players/${m2.playerId}`)).studioExpiryDate, addDays(today(), 90), "never overwritten on a stale basis");
  });

  it("B2-S5 a payment for an already-settled period is a duplicate (and a redelivery is a replay)", async () => {
    const expiry = addDays(today(), 7);
    const m = await seedMember({ expiry });
    const a = await orderRenewal(m.authUid, await seedPlan());
    await payRenewal(a);
    assert.equal((await payRenewal(a)).json.outcome, "already_processed");
    const late = await cloneRenewalIntent(a);
    assert.equal((await payRenewal(late)).json.decision, "duplicate");
    assert.equal((await data(`players/${m.playerId}`)).studioExpiryDate, addDays(expiry, 30));
  });

  it("B2-S6 the next legitimate renewal (new basis) applies", async () => {
    const expiry = addDays(today(), 4);
    const m = await seedMember({ expiry });
    const planId = await seedPlan(1000, 30);
    const a = await orderRenewal(m.authUid, planId);
    await payRenewal(a);
    await db.doc(`paymentReservations/${a.intent.reservationKey}`).delete(); // allow a fresh order for the next period
    const b = await orderRenewal(m.authUid, planId);
    assert.equal(b.intent.renewal.basisExpiry, addDays(expiry, 30));
    assert.equal((await payRenewal(b)).json.outcome, "processed");
    assert.equal((await data(`players/${m.playerId}`)).studioExpiryDate, addDays(expiry, 60));
  });

  it("B2-S7 plan change: two plans for the same basis → one applies; after it, a different plan renews the next period with its own duration", async () => {
    const expiry = addDays(today(), 6);
    const m = await seedMember({ expiry });
    const monthly = await orderRenewal(m.authUid, await seedPlan(1000, 30));
    const quarterly = await orderRenewal(m.authUid, await seedPlan(2700, 90));
    assert.equal(quarterly.intent.renewal.basisExpiry, expiry);
    assert.equal((await payRenewal(monthly)).json.outcome, "processed");
    assert.equal((await payRenewal(quarterly)).json.decision, "duplicate");
    assert.equal((await data(`players/${m.playerId}`)).studioExpiryDate, addDays(expiry, 30));
    const next = await orderRenewal(m.authUid, await seedPlan(2700, 90));
    assert.equal((await payRenewal(next)).json.outcome, "processed");
    assert.equal((await data(`players/${m.playerId}`)).studioExpiryDate, addDays(expiry, 120));
  });

  it("B2-S8 appUsers mirror: a missing account document is never created; an account-only member renews on the account", async () => {
    const authUid = uid("uid");
    const playerId = uid("player");
    await db.doc(`players/${playerId}`).set({ name: "No account doc", authUid });
    const t = await orderRenewal(authUid, await seedPlan());
    assert.equal((await payRenewal(t)).json.outcome, "processed");
    assert.equal(await data(`appUsers/${authUid}`), null);
    assert.deepEqual((await data(`gatewayPayments/${t.pay}`)).followUps.map((f) => f.code), ["appusers_mirror_missing"]);

    const acct = await seedMember({ expiry: addDays(today(), 1), linked: false });
    const t2 = await orderRenewal(acct.authUid, await seedPlan());
    assert.equal(t2.intent.renewal.subjectKind, "account");
    assert.equal((await payRenewal(t2)).json.outcome, "processed");
    assert.equal((await data(`appUsers/${acct.authUid}`)).studioExpiryDate, addDays(today(), 31));
  });

  it("B2-S9 legacy subscription intent (no snapshot): applies once; held if a renewal was recorded after it was created", async () => {
    const m = await seedMember({ expiry: addDays(today(), 8) });
    const planId = await seedPlan();
    const legacy = await seedIntent({ type: "subscription", planId, userId: m.authUid, amount: 1000, durationDays: 30, createdAt: new Date(Date.now() - 60000) });
    const r = await deliver(captured(legacy.intentId, legacy.order, legacy.pay, 100000));
    assert.equal(r.json.outcome, "processed");
    assert.equal((await data(`players/${m.playerId}`)).studioExpiryDate, addDays(today(), 38));
    const older = await seedIntent({ type: "subscription", planId, userId: m.authUid, amount: 1000, durationDays: 30, createdAt: new Date(Date.now() - 120000) });
    const r2 = await deliver(captured(older.intentId, older.order, older.pay, 100000));
    assert.equal(r2.json.decision, "held");
    assert.equal(r2.json.code, "RENEWAL_LEGACY_SUPERSEDED");
  });

  // ── merchandise (B1 regression under B2) ──

  it("B2-15 shop purchase: applied once with a registry record; replay is idempotent", async () => {
    const t = await seedIntent({ type: "merch_order", amount: 650, orderPayload: { playerId: "p_shop", merchId: "m1", merchName: "Cap", price: 650 } });
    assert.equal((await pay(t, 65000)).json.outcome, "processed");
    assert.equal((await pay(t, 65000)).json.outcome, "already_processed");
    assert.equal((await data(`merchOrders/mo_${t.intentId}`)).paymentStatus, "Paid");
    assert.equal((await data(`gatewayPayments/${t.pay}`)).application, "applied");
  });

  // ── outages: nothing is claimed unless it committed ──

  /** Runs the real transaction body, then fails instead of committing (rollback). */
  const failBeforeCommit = () => new Proxy(db, {
    get(target, key) {
      if (key === "runTransaction") {
        return (fn) => target.runTransaction(async (tx) => { await fn(tx); throw Object.assign(new Error("14 UNAVAILABLE: injected before commit"), { code: 14 }); });
      }
      const v = target[key];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  /** Commits for real, then loses the acknowledgement. */
  const loseAckAfterCommit = () => new Proxy(db, {
    get(target, key) {
      if (key === "runTransaction") {
        return async (fn) => { await target.runTransaction(fn); throw Object.assign(new Error("4 DEADLINE_EXCEEDED: ack lost"), { code: 4 }); };
      }
      const v = target[key];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

  it("B2-16 database failure before commit → 503 and no state change at all", async () => {
    const o = await seedMatchFee();
    const t = await matchIntent(o);
    const r = await deliver(captured(t.intentId, t.order, t.pay, 50000), failBeforeCommit());
    assert.equal(r.status, 503);
    assert.equal(r.json.code, "INFRASTRUCTURE");
    assert.equal((await data(o.path)).status, "Unpaid");
    assert.equal((await data(`razorpayIntents/${t.intentId}`)).status, "pending");
    assert.equal(await data(`gatewayPayments/${t.pay}`), null);
    assert.equal((await pay(t)).json.outcome, "processed", "the retry applies normally");
  });

  it("B2-17 exception persistence failure → 503; no dead-letter or registry record is claimed", async () => {
    const o = await seedMatchFee();
    await db.doc(o.path).update({ status: "Paid", paymentMethod: "manual" });
    const t = await matchIntent(o);
    const r = await deliver(captured(t.intentId, t.order, t.pay, 50000), failBeforeCommit());
    assert.equal(r.status, 503);
    assert.notEqual(r.json.outcome, "recorded_for_reconciliation");
    assert.equal(await data(`gatewayPayments/${t.pay}`), null);
    assert.equal(await data(`webhookDeadLetters/pay_${t.pay}`), null);
    const retry = await pay(t);
    assert.equal(retry.json.decision, "duplicate", "recorded on the retry");
    assert.ok(await data(`webhookDeadLetters/pay_${t.pay}`));
  });

  it("B2-18 commit succeeded but the acknowledgement was lost → 503, then the redelivery is a zero-write replay", async () => {
    const o = await seedMatchFee();
    const t = await matchIntent(o);
    const r = await deliver(captured(t.intentId, t.order, t.pay, 50000), loseAckAfterCommit());
    assert.equal(r.status, 503);
    const committed = [await data(o.path), await data(`gatewayPayments/${t.pay}`), await data(`razorpayIntents/${t.intentId}`)];
    assert.equal(committed[0].status, "Paid");
    const replay = await pay(t);
    assert.equal(replay.json.outcome, "already_processed");
    assert.deepEqual([await data(o.path), await data(`gatewayPayments/${t.pay}`), await data(`razorpayIntents/${t.intentId}`)], committed);
  });
});
