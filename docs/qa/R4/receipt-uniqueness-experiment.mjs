#!/usr/bin/env node
/**
 * R4 evidence: does Razorpay enforce `receipt` uniqueness on the Orders API?  (revision 3)
 *
 * QA tooling only; not imported by the application. Creates a small, bounded number of
 * ₹1 Razorpay TEST-MODE orders. Orders are not payments: no money moves.
 *
 * Usage (TEST-mode key only; never paste keys into chat):
 *   1. Plan only (no network calls):
 *        RAZORPAY_TEST_KEY_ID=rzp_test_xxx RAZORPAY_TEST_KEY_SECRET=xxx node receipt-uniqueness-experiment.mjs
 *   2. Execute:
 *        R4_CONFIRM=execute RAZORPAY_TEST_KEY_ID=rzp_test_xxx RAZORPAY_TEST_KEY_SECRET=xxx \
 *          node receipt-uniqueness-experiment.mjs > r4-receipt-evidence.json
 *
 * Safety properties (see docs/qa/R4/R4_RECEIPT_UNIQUENESS_EXPERIMENT.md §4):
 *  - Destination is hard-coded to https://api.razorpay.com; there is no override.
 *  - Redirects are never followed (fetch redirect: "error" on every request).
 *  - Only POST /v1/orders and GET /v1/orders are permitted (enforced before every request).
 *  - Key id must start with rzp_test_; credentials are never written to stdout/stderr/evidence.
 *  - Evidence is built only from allow-listed, type-checked fields; response bodies are never
 *    copied wholesale. The final evidence is scanned for credential material before output.
 *  - Concurrency and abort settings are bounded; the maximum request counts are printed first.
 *
 * Experiments
 *   E1 sequential duplicate receipt          E2 concurrent creates, one receipt
 *   E3 client abort after t ms (genuinely unknown outcome for the caller)
 *   E4 response received, then deliberately discarded by the caller, then retried
 *   E5 authoritative count per receipt (paginated, shape-validated), at ~3 s and ~15 s
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ── fixed destination and endpoint allowlist ────────────────────────────────
const API_ORIGIN = "https://api.razorpay.com";
const ORDERS_PATH = "/v1/orders";
const ALLOWED = new Set([`POST ${ORDERS_PATH}`, `GET ${ORDERS_PATH}`]);
const ALLOWED_QUERY_KEYS = new Set(["receipt", "count", "skip"]);

// ── bounded configuration ───────────────────────────────────────────────────
const AMOUNT_PAISE = 100; // ₹1
const CURRENCY = "INR";
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 3;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TOTAL_CREATES = 20;

function fail(msg, code = 2) {
  process.stderr.write(`Refusing to run: ${msg}\n`);
  process.exit(code);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!(nodeMajor >= 18) || typeof fetch !== "function") fail("Node.js 18 or later is required.");

const KEY_ID = process.env.RAZORPAY_TEST_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_TEST_KEY_SECRET || "";
if (!/^rzp_test_[A-Za-z0-9]+$/.test(KEY_ID)) fail("RAZORPAY_TEST_KEY_ID must be a TEST-mode key id (rzp_test_…).");
if (!KEY_SECRET) fail("RAZORPAY_TEST_KEY_SECRET must be set.");
if ("RAZORPAY_API_BASE" in process.env) fail("RAZORPAY_API_BASE is not supported; the destination is fixed to api.razorpay.com.");

function parseConcurrency(raw) {
  if (raw === undefined) return 5;
  if (!/^\d+$/.test(raw)) fail("R4_CONCURRENCY must be an integer between 2 and 10.");
  const n = Number(raw);
  if (n < 2 || n > 10) fail("R4_CONCURRENCY must be an integer between 2 and 10.");
  return n;
}
function parseAborts(raw) {
  if (raw === undefined) return [5, 50, 150, 400, 1000];
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.length < 1 || parts.length > 6 || parts.some((p) => !/^\d+$/.test(p))) {
    fail("R4_ABORT_MS must be 1–6 comma-separated integers, each 1–10000.");
  }
  const ms = parts.map(Number);
  if (ms.some((m) => m < 1 || m > 10000)) fail("R4_ABORT_MS values must be between 1 and 10000.");
  return ms;
}
const CONCURRENCY = parseConcurrency(process.env.R4_CONCURRENCY);
const ABORT_MS = parseAborts(process.env.R4_ABORT_MS);

// E1: 2, E2: CONCURRENCY, E3: one per abort value, E4: 2
const MAX_CREATES = 2 + CONCURRENCY + ABORT_MS.length + 2;
const RECEIPT_COUNT = 1 + 1 + ABORT_MS.length + 1;
const MAX_LISTS = RECEIPT_COUNT * 2 * LIST_MAX_PAGES;
if (MAX_CREATES > MAX_TOTAL_CREATES) fail(`configuration would create up to ${MAX_CREATES} orders (limit ${MAX_TOTAL_CREATES}).`);

const RUN = `r4${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
let scriptSha256 = null;
try {
  scriptSha256 = crypto.createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex");
} catch {}

const plan = {
  run: RUN,
  destination: API_ORIGIN,
  endpoints: [...ALLOWED],
  amountPaise: AMOUNT_PAISE,
  currency: CURRENCY,
  concurrency: CONCURRENCY,
  abortAfterMs: ABORT_MS,
  maxCreateRequests: MAX_CREATES,
  maxListRequests: MAX_LISTS,
  receipts: RECEIPT_COUNT,
};
process.stderr.write(
  `R4 experiment plan: up to ${MAX_CREATES} create (POST) and ${MAX_LISTS} list (GET) requests to ${API_ORIGIN}${ORDERS_PATH}; ` +
    `₹${AMOUNT_PAISE / 100} ${CURRENCY} test orders; concurrency ${CONCURRENCY}; aborts ${ABORT_MS.join("/")} ms.\n`,
);
if (process.env.R4_CONFIRM !== "execute") {
  process.stderr.write("Plan only: no requests were sent. Re-run with R4_CONFIRM=execute to execute.\n");
  process.exit(0);
}

// ── request plumbing (credentials stay in this closure) ─────────────────────
const AUTH_HEADER = "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
const counters = { creates: 0, lists: 0 };

function buildUrl(method, path, query) {
  if (!ALLOWED.has(`${method} ${path}`)) throw new Error(`Blocked request: ${method} ${path}`);
  const url = new URL(path, API_ORIGIN);
  for (const [k, v] of Object.entries(query || {})) {
    if (!ALLOWED_QUERY_KEYS.has(k)) throw new Error(`Blocked query parameter: ${k}`);
    url.searchParams.set(k, String(v));
  }
  if (url.origin !== API_ORIGIN) throw new Error("Blocked destination.");
  return url;
}

const isoNow = () => new Date().toISOString();
const SAFE_ID = /^[A-Za-z0-9_\-]{1,100}$/;

function sanitiseText(s, max = 200) {
  if (typeof s !== "string") return null;
  return s
    .replace(/rzp_(test|live)_[A-Za-z0-9]+/g, "[redacted-key]")
    .replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/[A-Za-z0-9+/=_\-]{24,}/g, "[redacted-token]")
    .replace(/\d{8,}/g, "[redacted-number]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, max);
}

function requestIdFrom(headers) {
  for (const h of ["x-razorpay-request-id", "request-id", "x-request-id"]) {
    const v = headers.get(h);
    if (v && SAFE_ID.test(v)) return v;
  }
  return null;
}

/** Allow-listed error: code, sanitised description. Nothing else from the body. */
function safeError(json) {
  const e = json && typeof json === "object" ? json.error : null;
  if (!e || typeof e !== "object") return null;
  return {
    code: typeof e.code === "string" && /^[A-Z_]{1,60}$/.test(e.code) ? e.code : null,
    description: sanitiseText(e.description),
  };
}

/** Allow-listed, type-checked order fields. Anything unexpected is dropped. */
function safeOrder(o) {
  if (!o || typeof o !== "object" || o.entity !== "order") return null;
  const int = (v) => (Number.isInteger(v) ? v : null);
  return {
    id: typeof o.id === "string" && /^order_[A-Za-z0-9]{1,40}$/.test(o.id) ? o.id : null,
    receipt: typeof o.receipt === "string" && o.receipt.startsWith(RUN) && SAFE_ID.test(o.receipt) ? o.receipt : null,
    amount: int(o.amount),
    amount_paid: int(o.amount_paid),
    amount_due: int(o.amount_due),
    currency: typeof o.currency === "string" && /^[A-Z]{3}$/.test(o.currency) ? o.currency : null,
    status: typeof o.status === "string" && /^[a-z_]{1,20}$/.test(o.status) ? o.status : null,
    attempts: int(o.attempts),
    created_at: int(o.created_at),
  };
}

async function readJson(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    return { json: JSON.parse(buf.toString("utf8")) };
  } catch {
    return { notJson: true };
  }
}

function classifyClientError(err, timerFired) {
  const name = err && typeof err.name === "string" ? err.name : "Error";
  const causeCode = err?.cause && typeof err.cause.code === "string" && /^[A-Z_]{1,40}$/.test(err.cause.code) ? err.cause.code : null;
  if (name === "AbortError" && timerFired) return { kind: "aborted_by_timer", errorName: name };
  if (name === "AbortError") return { kind: "aborted_unexpectedly", errorName: name };
  return { kind: "network_error", errorName: SAFE_ID.test(name) ? name : "Error", causeCode };
}

/** One POST /v1/orders. Optionally aborted after abortMs. Returns only safe fields. */
async function createOrder(receipt, abortMs) {
  if (counters.creates >= MAX_CREATES) throw new Error("Create-request budget exceeded.");
  counters.creates += 1;
  const url = buildUrl("POST", ORDERS_PATH);
  const ac = abortMs ? new AbortController() : null;
  let timerFired = false;
  const timer = ac ? setTimeout(() => { timerFired = true; ac.abort(); }, abortMs) : null;
  const sentAt = isoNow();
  const t0 = performance.now();
  let headersAt = null;
  let httpStatus = null;
  let requestId = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: AMOUNT_PAISE, currency: CURRENCY, receipt }),
      signal: ac?.signal,
      redirect: "error", // never follow a redirect (credentials must not leave api.razorpay.com)
    });
    headersAt = isoNow();
    httpStatus = res.status;
    requestId = requestIdFrom(res.headers);
    const body = await readJson(res);
    return {
      outcome: "response_received",
      sentAt, headersReceivedAt: headersAt, completedAt: isoNow(), ms: Math.round(performance.now() - t0),
      ...(abortMs ? { abortAfterMs: abortMs, abortTimerFired: timerFired } : {}),
      httpStatus, requestId,
      order: res.ok ? safeOrder(body.json) : null,
      error: res.ok ? null : safeError(body.json),
      bodyProblem: body.tooLarge ? "too_large" : body.notJson ? "not_json" : null,
    };
  } catch (err) {
    return {
      outcome: "no_response",
      sentAt, failedAt: isoNow(), ms: Math.round(performance.now() - t0),
      ...(abortMs ? { abortAfterMs: abortMs, abortTimerFired: timerFired } : {}),
      // If headers arrived before the abort, the status is known even though the body was not read.
      headersReceived: headersAt !== null, httpStatus, requestId,
      clientError: classifyClientError(err, timerFired),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Paginated GET /v1/orders?receipt=…; an unsuccessful or incomplete listing is never a count of zero. */
async function countByReceipt(receipt) {
  const requestedAt = isoNow();
  const pages = [];
  const exact = [];
  let returned = 0;
  let status = "complete";
  let error = null;
  let filterApplied = true;
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    if (counters.lists >= MAX_LISTS) { status = "incomplete"; error = { reason: "list_budget_exceeded" }; break; }
    counters.lists += 1;
    const url = buildUrl("GET", ORDERS_PATH, { receipt, count: LIST_PAGE_SIZE, skip: page * LIST_PAGE_SIZE });
    let res;
    try {
      res = await fetch(url, { method: "GET", headers: { Authorization: AUTH_HEADER }, redirect: "error" });
    } catch (err) {
      status = "failed";
      error = { reason: "network_error", ...classifyClientError(err, false) };
      break;
    }
    const requestId = requestIdFrom(res.headers);
    const body = await readJson(res);
    const j = body.json;
    const shapeOk = res.ok && j && j.entity === "collection" && Array.isArray(j.items) && Number.isInteger(j.count);
    pages.push({ skip: page * LIST_PAGE_SIZE, httpStatus: res.status, requestId, collectionCount: shapeOk ? j.count : null, items: shapeOk ? j.items.length : null });
    if (!res.ok) { status = "failed"; error = { reason: "http_error", httpStatus: res.status, ...(safeError(j) || {}) }; break; }
    if (!shapeOk) { status = "failed"; error = { reason: body.tooLarge ? "body_too_large" : "unexpected_shape" }; break; }
    returned += j.items.length;
    for (const o of j.items) {
      if (o && o.receipt === receipt) exact.push(safeOrder(o));
      else filterApplied = false;
    }
    if (j.items.length < LIST_PAGE_SIZE) break;
    if (page === LIST_MAX_PAGES - 1) { status = "incomplete"; error = { reason: "page_limit_reached" }; }
  }
  return {
    requestedAt,
    completedAt: isoNow(),
    status, // complete | failed | incomplete
    pages,
    returnedItems: returned,
    receiptFilterAppearsApplied: status === "complete" ? filterApplied : null,
    exactReceiptMatches: status === "complete" ? exact.length : null, // null = unknown, never 0 by default
    orders: exact,
    error,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── experiments ─────────────────────────────────────────────────────────────
const evidence = {
  schema: "kavach-r4-receipt-evidence/v3",
  ...plan,
  nodeVersion: process.version,
  scriptSha256,
  keyMode: "test",
  startedAt: isoNow(),
  experiments: {},
};
const receipts = [];

{
  const receipt = `${RUN}-E1`;
  receipts.push(receipt);
  const first = await createOrder(receipt);
  const second = await createOrder(receipt);
  evidence.experiments.E1_sequential = { receipt, first, second };
}
{
  const receipt = `${RUN}-E2`;
  receipts.push(receipt);
  const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => createOrder(receipt)));
  evidence.experiments.E2_concurrent = { receipt, concurrency: CONCURRENCY, results };
}
{
  const runs = [];
  for (const ms of ABORT_MS) {
    const receipt = `${RUN}-E3-${ms}`;
    receipts.push(receipt);
    runs.push({ receipt, attempt: await createOrder(receipt, ms) });
  }
  evidence.experiments.E3_client_abort = {
    note: "Whether an aborted request reached Razorpay is NOT inferred here; only E5 counts can confirm an order exists.",
    runs,
  };
}
{
  const receipt = `${RUN}-E4`;
  receipts.push(receipt);
  const firstAttempt = await createOrder(receipt);
  const retry = await createOrder(receipt);
  evidence.experiments.E4_discarded_then_retry = {
    note: "The first response WAS received and is recorded; the caller then deliberately ignores it (modelling a caller that treats the outcome as unknown) and retries with the same receipt. Genuine network-level unknown outcomes are E3.",
    receipt,
    firstAttempt: { ...firstAttempt, callerTreatment: "discarded" },
    retry,
  };
}

await sleep(3000);
const early = {};
for (const r of receipts) early[r] = await countByReceipt(r);
await sleep(12000);
const late = {};
for (const r of receipts) late[r] = await countByReceipt(r);
evidence.experiments.E5_counts = { first: early, second: late };
evidence.requestsSent = { ...counters };
evidence.finishedAt = isoNow();

// ── final guard: no credential material may leave the process ──────────────
const out = JSON.stringify(evidence, null, 2);
const forbidden = [
  KEY_ID,
  KEY_SECRET,
  AUTH_HEADER,
  Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64"),
  Buffer.from(KEY_SECRET).toString("base64"),
];
if (forbidden.some((f) => f && out.includes(f)) || /Basic [A-Za-z0-9+/=]{8,}/.test(out) || /rzp_(test|live)_[A-Za-z0-9]+/.test(out)) {
  fail("evidence contained credential-like material; nothing was written.", 3);
}
process.stdout.write(out + "\n");

// ── human summary (stderr) ──────────────────────────────────────────────────
const st = (x) => {
  if (x.outcome === "no_response") return `${x.clientError.kind}${x.headersReceived ? `(after headers ${x.httpStatus})` : ""}`;
  return `${x.httpStatus}${x.error?.code ? ` ${x.error.code}` : ""}${x.order?.id ? ` ${x.order.id}` : ""}`;
};
const cnt = (c) => (c.status === "complete" ? String(c.exactReceiptMatches) : `UNKNOWN(${c.status})`);
const line = (s) => process.stderr.write(s + "\n");
line(`\nR4 receipt-uniqueness experiment ${RUN} (TEST mode, Node ${process.version})`);
line(`Requests sent: ${counters.creates} create (max ${MAX_CREATES}), ${counters.lists} list (max ${MAX_LISTS})`);
line(`E1 sequential: first=${st(evidence.experiments.E1_sequential.first)} second=${st(evidence.experiments.E1_sequential.second)}`);
line(`E2 concurrent x${CONCURRENCY}: ${evidence.experiments.E2_concurrent.results.map(st).join(" | ")}`);
for (const r of evidence.experiments.E3_client_abort.runs) {
  line(`E3 abort@${r.attempt.abortAfterMs}ms (timer fired: ${r.attempt.abortTimerFired}): caller saw ${st(r.attempt)}; orders later: ${cnt(late[r.receipt])}`);
}
const e4 = evidence.experiments.E4_discarded_then_retry;
line(`E4 first (received, discarded)=${st(e4.firstAttempt)} retry=${st(e4.retry)}`);
for (const r of receipts) line(`E5 ${r}: ${cnt(early[r])} @${early[r].completedAt}, ${cnt(late[r])} @${late[r].completedAt}`);
