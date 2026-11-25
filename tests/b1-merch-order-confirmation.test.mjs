/**
 * B1 (PX-1 + FIN-004) — unit and static checks (tests/b1-merch-order-confirmation.test.mjs)
 *
 * Unit (production code, injected reader / clock / sleep):
 *  - lib/merch-order-confirmation.ts: merchOrderIdForIntent, waitForServerOrder
 *  - lib/razorpay-order.ts: buildMerchOrderPayload (order-route allowlist)
 *  - lib/razorpay-webhook.ts: pickStoredMerchOrderFields (webhook allowlist, never throws)
 *
 * STATIC source checks (labelled; no React renderer exists in this repository):
 *  - components/ShopTab.tsx online Razorpay callback writes nothing and only waits for the
 *    server-created order; the ₹0 and manual/offline paths still create orders.
 *
 * Emulator-backed route/webhook tests are in tests/px1-merch-order-identity.emulator.test.mjs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  merchOrderIdForIntent,
  isValidIntentId,
  waitForServerOrder,
  CONFIRMATION_INTERVAL_MS,
  CONFIRMATION_TIMEOUT_MS,
} from "../lib/merch-order-confirmation.ts";
import { buildMerchOrderPayload, MERCH_CHECKOUT_ORDER_STATUSES } from "../lib/razorpay-order.ts";
import { pickStoredMerchOrderFields } from "../lib/razorpay-webhook.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Deterministic clock: sleep advances virtual time instantly. */
function fakeTime() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms, signal) => {
      if (!signal?.aborted) t += ms;
    },
  };
}

describe("B1: merchandise order identity", () => {
  it("derives mo_{intentId} and rejects unsafe intent ids", () => {
    assert.equal(merchOrderIdForIntent("AbC123_-x"), "mo_AbC123_-x");
    for (const bad of ["", "a/b", "x".repeat(129), "has space", "..", null, 42]) {
      assert.equal(isValidIntentId(bad), false, String(bad));
      assert.throws(() => merchOrderIdForIntent(bad));
    }
  });
});

describe("B1: waitForServerOrder (browser confirmation helper)", () => {
  it("uses the approved 2 s interval and 60 s timeout by default", () => {
    assert.equal(CONFIRMATION_INTERVAL_MS, 2000);
    assert.equal(CONFIRMATION_TIMEOUT_MS, 60000);
  });

  it("reads only the single document mo_{intentId}", async () => {
    const seen = [];
    const clock = fakeTime();
    await waitForServerOrder(async (id) => { seen.push(id); return seen.length === 3 ? "found" : "absent"; }, "intentA", clock);
    assert.deepEqual([...new Set(seen)], ["mo_intentA"]);
  });

  it("confirms immediately when the order already exists", async () => {
    const clock = fakeTime();
    const r = await waitForServerOrder(async () => "found", "intentB", clock);
    assert.deepEqual(r, { status: "confirmed", attempts: 1 });
  });

  it("confirms after a delayed webhook (found on the 5th poll)", async () => {
    const clock = fakeTime();
    let n = 0;
    const r = await waitForServerOrder(async () => (++n >= 5 ? "found" : "absent"), "intentC", clock);
    assert.equal(r.status, "confirmed");
    assert.equal(r.attempts, 5);
  });

  it("treats permission-denied / network errors as pending and keeps polling", async () => {
    const clock = fakeTime();
    let n = 0;
    const r = await waitForServerOrder(async () => {
      n += 1;
      if (n < 3) throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
      return "found";
    }, "intentD", clock);
    assert.equal(r.status, "confirmed");
  });

  it("returns pending (never failed) when the order never appears within 60 s", async () => {
    const clock = fakeTime();
    const start = clock.now();
    let reads = 0;
    const r = await waitForServerOrder(async () => { reads += 1; throw new Error("permission-denied"); }, "intentE", clock);
    assert.equal(r.status, "pending");
    assert.ok(clock.now() - start <= 60000, "never waits beyond the timeout");
    assert.equal(reads, 31, "reads at t = 0, 2, …, 60 s (both endpoints inclusive) = 31");
    assert.notEqual(r.status, "failed");
  });

  it("returns pending without reading when the intent id is missing or invalid", async () => {
    let reads = 0;
    for (const bad of [undefined, "", "a/b"]) {
      const r = await waitForServerOrder(async () => { reads += 1; return "found"; }, bad, fakeTime());
      assert.equal(r.status, "pending");
    }
    assert.equal(reads, 0);
  });

  it("stops polling when cancelled (unmount / dialog closed) and performs no further reads", async () => {
    const controller = new AbortController();
    let reads = 0;
    const realTimers = { now: () => Date.now() };
    const p = waitForServerOrder(async () => { reads += 1; return "absent"; }, "intentF", {
      ...realTimers,
      intervalMs: 20,
      timeoutMs: 60000,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 70));
    controller.abort();
    const r = await p;
    assert.equal(r.status, "cancelled");
    const readsAtAbort = reads;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(reads, readsAtAbort, "no reads after cancellation");
  });

  it("returns cancelled without reading when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let reads = 0;
    const r = await waitForServerOrder(async () => { reads += 1; return "found"; }, "intentG", { signal: controller.signal });
    assert.equal(r.status, "cancelled");
    assert.equal(reads, 0);
  });

  it("an in-flight read that resolves after abort is reported as cancelled, not confirmed", async () => {
    const controller = new AbortController();
    const r = await waitForServerOrder(async () => { controller.abort(); return "found"; }, "intentH", { signal: controller.signal });
    assert.equal(r.status, "cancelled");
  });
});

describe("B1: order-route merchandise payload allowlist (buildMerchOrderPayload)", () => {
  const server = { merchId: "m1", merchName: "Club Cap", price: 650, playerId: "p1", playerRecordName: "Server Name" };

  it("drops the client id, payment fields and unknown fields; server values win", () => {
    const out = buildMerchOrderPayload({
      id: "victim_order", paymentStatus: "Paid", isManual: true, razorpayPaymentId: "pay_forged",
      intentId: "forged", price: 1, merchName: "Forged", playerId: "other", evil: "x", createdAt: "x",
      size: "M", orderStatus: "Ready to Place Order",
    }, server);
    for (const k of ["id", "paymentStatus", "isManual", "razorpayPaymentId", "intentId", "evil", "createdAt"]) {
      assert.equal(k in out, false, k);
    }
    assert.equal(out.price, 650);
    assert.equal(out.merchName, "Club Cap");
    assert.equal(out.playerId, "p1");
    assert.equal(out.playerName, "Server Name");
    assert.equal(out.size, "M");
    assert.equal(out.orderStatus, "Ready to Place Order");
  });

  it("keeps every field the shop checkout sends today", () => {
    const shop = {
      playerId: "p1", playerName: "Client Name", merchId: "m1", merchName: "Club Cap", size: "L",
      spec: "Full sleeve", customSelections: { size: "L" }, customPriceAdditions: 50,
      jerseyName: "DIXIT", jerseyNumber: "7", price: 700, paymentStatus: "Paid",
      orderStatus: "Awaiting Min Order Qnty", isManual: false,
    };
    const out = buildMerchOrderPayload(shop, { ...server, customPriceAdditions: 50, playerRecordName: undefined });
    assert.deepEqual(out, {
      playerId: "p1", playerName: "Client Name", merchId: "m1", merchName: "Club Cap", size: "L",
      spec: "Full sleeve", customSelections: { size: "L" }, customPriceAdditions: 50,
      jerseyName: "DIXIT", jerseyNumber: "7", quantity: 1, price: 650,
      priceSnapshot: { unitPrice: 650, quantity: 1, totalAmount: 650, currency: "INR" },
      trustedSource: "server", orderStatus: "Awaiting Min Order Qnty",
    });
  });

  it("defaults an unknown orderStatus to Order Placed", () => {
    assert.deepEqual([...MERCH_CHECKOUT_ORDER_STATUSES], ["Awaiting Min Order Qnty", "Ready to Place Order", "Order Placed"]);
    assert.equal(buildMerchOrderPayload({ orderStatus: "Delivered" }, server).orderStatus, "Order Placed");
  });

  it("rejects over-long or malformed fields instead of storing them", () => {
    assert.throws(() => buildMerchOrderPayload({ jerseyName: "x".repeat(31) }, server));
    assert.throws(() => buildMerchOrderPayload({ spec: "x".repeat(201) }, server));
    assert.throws(() => buildMerchOrderPayload({ size: { a: 1 } }, server));
    assert.throws(() => buildMerchOrderPayload({ customSelections: ["a"] }, server));
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, "v"]));
    assert.throws(() => buildMerchOrderPayload({ customSelections: many }, server));
    assert.throws(() => buildMerchOrderPayload({ customSelections: { size: "x".repeat(101) } }, server));
  });
});

describe("B1: webhook merchandise field allowlist (pickStoredMerchOrderFields)", () => {
  it("never copies id or payment fields and never throws on legacy garbage", () => {
    const out = pickStoredMerchOrderFields({
      id: "victim", paymentStatus: "Unpaid", isManual: true, razorpayPaymentId: "pay_x", evil: 1,
      size: "x".repeat(500), customSelections: "not-an-object", jerseyNumber: 9, orderStatus: "Delivered",
      merchId: "m1", playerId: "p1",
    }, 650);
    for (const k of ["id", "paymentStatus", "isManual", "razorpayPaymentId", "evil", "size", "customSelections"]) {
      assert.equal(k in out, false, k);
    }
    assert.equal(out.jerseyNumber, "9");
    assert.equal(out.price, 650);
    assert.equal(out.orderStatus, "Order Placed");
    assert.doesNotThrow(() => pickStoredMerchOrderFields(null, undefined));
    assert.doesNotThrow(() => pickStoredMerchOrderFields("string", "x"));
  });
});

describe("B1: ShopTab checkout lifecycle (STATIC source checks)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../components/ShopTab.tsx"), "utf8");

  function block(startMarker, endMarker) {
    const i = src.indexOf(startMarker);
    assert.ok(i >= 0, `missing ${startMarker}`);
    const j = src.indexOf(endMarker, i + startMarker.length);
    assert.ok(j > i, `missing ${endMarker} after ${startMarker}`);
    return src.slice(i, j);
  }

  it("the Razorpay success handler creates no order and writes nothing", () => {
    const handler = block("handler: function", "prefill:");
    assert.match(handler, /confirmOnlineOrder\(/);
    for (const forbidden of ["finalizeOrderPlacement", "addMerchOrder", "setDoc", "updateDoc", "updateMerchOrder"]) {
      assert.equal(handler.includes(forbidden), false, `handler must not call ${forbidden}`);
    }
  });

  it("confirmOnlineOrder only waits for the server order (no browser order write)", () => {
    const fn = block("const confirmOnlineOrder", "const closeOrderDialog");
    assert.match(fn, /waitForServerOrder\(readServerMerchOrder/);
    for (const forbidden of ["finalizeOrderPlacement", "addMerchOrder", "setDoc"]) {
      assert.equal(fn.includes(forbidden), false, forbidden);
    }
    assert.equal(/toast\([^)]*failed/i.test(fn), false, "never reports a paid checkout as failed");
  });

  it("the server order is read as a single document, never via a collection query", () => {
    const fn = block("const readServerMerchOrder", "const confirmOnlineOrder");
    assert.match(fn, /getDoc\(doc\(db, "merchOrders", orderId\)\)/);
    assert.equal(/onSnapshot|collection\(|query\(/.test(fn), false);
  });

  it("polling is cancelled on unmount and when the dialog is closed", () => {
    assert.match(src, /useEffect\(\(\) => \(\) => confirmAbortRef\.current\?\.abort\(\), \[\]\)/);
    const close = block("const closeOrderDialog", "};");
    assert.match(close, /confirmAbortRef\.current\?\.abort\(\)/);
  });

  it("the ₹0 path still creates its order through finalizeOrderPlacement", () => {
    assert.match(src, /} else \{\s*await finalizeOrderPlacement\(finalPrice, customPriceAdditions, true\);/);
    const fin = block("const finalizeOrderPlacement", "const ONLINE_ORDER_PENDING_MESSAGE");
    assert.match(fin, /await store\.addMerchOrder\(orderPayload\)/);
  });

  it("manual / offline admin orders are unchanged (still created by handleAddManualOrder)", () => {
    const manual = block("const handleAddManualOrder", "const handleUpdateOrderStatus");
    assert.match(manual, /await store\.addMerchOrder\(orderPayload\)/);
  });
});
