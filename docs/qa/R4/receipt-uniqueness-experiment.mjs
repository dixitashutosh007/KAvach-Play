#!/usr/bin/env node
/**
 * R4 evidence: does Razorpay enforce `receipt` uniqueness on the Orders API?
 *
 * QA tooling only. Not imported by the application. Creates a handful of small Razorpay
 * TEST-MODE orders (₹1 each). Orders are not payments: no money moves, and unpaid orders
 * simply remain in "created" state in the test dashboard.
 *
 * Run on a machine you trust, with a TEST-mode key (never live):
 *   RAZORPAY_TEST_KEY_ID=rzp_test_xxx RAZORPAY_TEST_KEY_SECRET=xxx \
 *     node docs/qa/R4/receipt-uniqueness-experiment.mjs > r4-receipt-evidence.json
 *
 * The script refuses any Key ID that does not start with "rzp_test_". It never prints the key
 * id or secret. Output is JSON evidence (stdout) plus a human summary (stderr).
 *
 * Experiments
 *   E1  sequential: create(receipt A), then create(receipt A) again (same amount/currency)
 *   E2  concurrent: N simultaneous create(receipt B)
 *   E3  timeout: create(receipt C_i) aborted client-side after t ms (several t), then list by
 *       receipt after a delay to see whether an order exists that the caller never received
 *   E4  lost response: create(receipt D), discard the response (caller sees "unknown"), retry
 *       create(receipt D) exactly as a recovering server would
 *   E5  for every receipt used: GET /v1/orders?receipt=… (twice, 3 s and 15 s later) and count
 */

const KEY_ID = process.env.RAZORPAY_TEST_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_TEST_KEY_SECRET || "";
const API = process.env.RAZORPAY_API_BASE || "https://api.razorpay.com";
const CONCURRENCY = Number(process.env.R4_CONCURRENCY || 5);
const ABORT_AFTER_MS = (process.env.R4_ABORT_MS || "5,50,150,400,1000").split(",").map(Number);
const AMOUNT = 100; // paise = ₹1
const CURRENCY = "INR";

if (!KEY_ID.startsWith("rzp_test_") || !KEY_SECRET) {
  console.error("Refusing to run: RAZORPAY_TEST_KEY_ID must be a TEST-mode key (rzp_test_…) and RAZORPAY_TEST_KEY_SECRET must be set.");
  process.exit(2);
}
const AUTH = "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
const RUN = `r4${Date.now().toString(36)}`; // receipts stay well under Razorpay's 40-char limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Keeps only non-sensitive order fields; error bodies kept as returned (they hold no secrets). */
function redactOrder(o) {
  if (!o || typeof o !== "object") return o;
  const { id, entity, amount, amount_paid, amount_due, currency, receipt, status, attempts, created_at } = o;
  return { id, entity, amount, amount_paid, amount_due, currency, receipt, status, attempts, created_at };
}

async function call(method, path, body, { signal } = {}) {
  const sentAt = new Date().toISOString();
  const t0 = performance.now();
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { nonJsonBody: text.slice(0, 300) }; }
    return {
      sentAt,
      receivedAt: new Date().toISOString(),
      ms: Math.round(performance.now() - t0),
      httpStatus: res.status,
      requestId: res.headers.get("x-razorpay-request-id") || res.headers.get("request-id") || null,
      order: json?.entity === "order" ? redactOrder(json) : undefined,
      error: json?.error ?? (json?.entity === "order" ? undefined : json),
    };
  } catch (err) {
    return { sentAt, receivedAt: new Date().toISOString(), ms: Math.round(performance.now() - t0), httpStatus: null, clientError: err?.name || String(err) };
  }
}

const createOrder = (receipt, opts) =>
  call("POST", "/v1/orders", { amount: AMOUNT, currency: CURRENCY, receipt, notes: { purpose: "kavach-r4-receipt-experiment", run: RUN } }, opts);

async function countByReceipt(receipt) {
  const res = await fetch(`${API}/v1/orders?receipt=${encodeURIComponent(receipt)}&count=100`, { headers: { Authorization: AUTH } });
  const json = await res.json().catch(() => ({}));
  const items = Array.isArray(json.items) ? json.items : [];
  const exact = items.filter((o) => o.receipt === receipt);
  return {
    at: new Date().toISOString(),
    httpStatus: res.status,
    returned: items.length,
    exactReceiptMatches: exact.length,
    orders: exact.map(redactOrder),
    error: json.error,
  };
}

const evidence = { run: RUN, apiBase: API, keyMode: "test", amountPaise: AMOUNT, currency: CURRENCY, startedAt: new Date().toISOString(), experiments: {} };
const receiptsUsed = [];

// E1 — sequential duplicate
{
  const receipt = `${RUN}-E1`;
  receiptsUsed.push(receipt);
  const first = await createOrder(receipt);
  const second = await createOrder(receipt);
  evidence.experiments.E1_sequential = { receipt, first, second };
}

// E2 — concurrent duplicates
{
  const receipt = `${RUN}-E2`;
  receiptsUsed.push(receipt);
  const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => createOrder(receipt)));
  evidence.experiments.E2_concurrent = { receipt, concurrency: CONCURRENCY, results };
}

// E3 — client-side timeout (abort) after the request may have reached Razorpay
{
  const runs = [];
  for (const ms of ABORT_AFTER_MS) {
    const receipt = `${RUN}-E3-${ms}`;
    receiptsUsed.push(receipt);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    const attempt = await createOrder(receipt, { signal: ac.signal });
    clearTimeout(timer);
    runs.push({ receipt, abortAfterMs: ms, callerSaw: attempt });
  }
  evidence.experiments.E3_timeout = { runs };
}

// E4 — response lost, then a recovering retry with the same receipt
{
  const receipt = `${RUN}-E4`;
  receiptsUsed.push(receipt);
  const lost = await createOrder(receipt); // pretend this response never arrived
  const retry = await createOrder(receipt);
  evidence.experiments.E4_lost_response_retry = { receipt, firstAttemptActualResult: lost, retry };
}

// E5 — authoritative counts by receipt, twice
await sleep(3000);
const countsEarly = {};
for (const r of receiptsUsed) countsEarly[r] = await countByReceipt(r);
await sleep(12000);
const countsLate = {};
for (const r of receiptsUsed) countsLate[r] = await countByReceipt(r);
evidence.experiments.E5_counts = { after3s: countsEarly, after15s: countsLate };
evidence.finishedAt = new Date().toISOString();

process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");

// Human summary (stderr)
const line = (s) => process.stderr.write(s + "\n");
const st = (x) => (x.httpStatus ?? `client:${x.clientError}`) + (x.error?.code ? ` ${x.error.code}` : "") + (x.order?.id ? ` ${x.order.id}` : "");
line(`\nR4 receipt-uniqueness experiment, run ${RUN} (TEST mode)`);
line(`E1 sequential: first=${st(evidence.experiments.E1_sequential.first)} second=${st(evidence.experiments.E1_sequential.second)}`);
line(`E2 concurrent x${CONCURRENCY}: ${evidence.experiments.E2_concurrent.results.map(st).join(" | ")}`);
for (const r of evidence.experiments.E3_timeout.runs) line(`E3 abort@${r.abortAfterMs}ms: caller saw ${st(r.callerSaw)}; orders with receipt after 15s = ${countsLate[r.receipt].exactReceiptMatches}`);
line(`E4 lost+retry: first=${st(evidence.experiments.E4_lost_response_retry.firstAttemptActualResult)} retry=${st(evidence.experiments.E4_lost_response_retry.retry)}`);
for (const r of receiptsUsed) line(`E5 ${r}: ${countsEarly[r].exactReceiptMatches} order(s) @3s, ${countsLate[r].exactReceiptMatches} @15s`);
