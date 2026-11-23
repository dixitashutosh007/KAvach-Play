/**
 * DRY-RUN ONLY. Preloaded with `node --import` by dry-run.mjs. Replaces globalThis.fetch with an
 * in-process fake so the experiment script can be exercised with ZERO network calls.
 * It is not evidence about Razorpay. Behaviour is selected by STUB_MODE:
 *   enforce   – duplicate receipts rejected (400 BAD_REQUEST_ERROR), atomically
 *   allow     – duplicate receipts create new orders
 *   faults    – allow + list for the E2 receipt fails (500) on the first round,
 *               list for E1 ignores the receipt filter, list for E4 needs pagination (>100 items),
 *               the 5 ms E3 abort surfaces as a network error instead of an abort
 * Every call is checked against the allowlist and logged to STUB_LOG (method, path, query keys,
 * presence of Authorization; never its value).
 */
import fs from "node:fs";
const MODE = process.env.STUB_MODE || "enforce";
const LOG = process.env.STUB_LOG;
const orders = [];
let seq = 0;
const listRound = {};
const log = (o) => LOG && fs.appendFileSync(LOG, JSON.stringify(o) + "\n");
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-razorpay-request-id": `req_STUB${++seq}`, ...headers } });

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = (init.method || "GET").toUpperCase();
  const ok = url.origin === "https://api.razorpay.com" && url.pathname === "/v1/orders" && (method === "POST" || method === "GET");
  log({ method, origin: url.origin, path: url.pathname, queryKeys: [...url.searchParams.keys()], hasAuth: !!new Headers(init.headers).get("authorization"), redirect: init.redirect ?? null, allowed: ok });
  if (!ok) throw new Error("STUB: disallowed request");
  // Injected connection failure happens immediately (before latency), so it is not pre-empted by the abort timer.
  if (MODE === "faults" && method === "POST" && JSON.parse(init.body).receipt.endsWith("-E3-5")) {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  }
  const latency = method === "POST" ? 60 : 5;
  await new Promise((resolve, reject) => {
    const t = setTimeout(resolve, latency);
    init.signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); });
  });
  if (method === "POST") {
    const b = JSON.parse(init.body);
    if (MODE === "enforce" && orders.some((o) => o.receipt === b.receipt)) {
      return json(400, { error: { code: "BAD_REQUEST_ERROR", description: "STUB duplicate receipt for key rzp_test_SHOULDBEREDACTED", source: "x", metadata: { secret: "nope" } } });
    }
    const o = { id: `order_STUB${++seq}`, entity: "order", amount: b.amount, amount_paid: 0, amount_due: b.amount, currency: b.currency, receipt: b.receipt, status: "created", attempts: 0, notes: { email: "someone@example.test" }, created_at: Math.floor(Date.now() / 1000) };
    orders.push(o);
    return json(200, o);
  }
  const receipt = url.searchParams.get("receipt");
  const skip = Number(url.searchParams.get("skip") || 0);
  listRound[receipt] = (listRound[receipt] || 0) + (skip === 0 ? 1 : 0);
  if (MODE === "faults" && receipt.endsWith("-E2") && listRound[receipt] === 1) return json(500, { error: { code: "SERVER_ERROR", description: "STUB outage" } });
  let items = orders.filter((o) => o.receipt === receipt);
  if (MODE === "faults" && receipt.endsWith("-E1")) items = orders.slice(); // filter ignored
  if (MODE === "faults" && receipt.endsWith("-E4")) {
    const filler = Array.from({ length: 150 }, (_, i) => ({ ...items[0], id: `order_FILL${i}` }));
    items = [...items, ...filler];
  }
  const page = items.slice(skip, skip + 100);
  return json(200, { entity: "collection", count: page.length, items: page });
};
