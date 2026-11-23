#!/usr/bin/env node
/**
 * R4 supplemental evidence: delayed E5 re-check (reviewer-approved, 8 requests).
 * Re-lists each of the 8 receipts from run r4mwtfrkta4202 with GET /v1/orders?receipt=…, once.
 * Same safety model as receipt-uniqueness-experiment.mjs rev 3: fixed origin, GET /v1/orders only,
 * redirect:"error", placeholder credentials (proxy injects the real key), allow-listed output,
 * hard cap of 8 requests, no pagination (a full page is reported as incomplete).
 * Reads the receipts and known order ids from the ORIGINAL evidence file without modifying it.
 */
import fs from "node:fs";
import crypto from "node:crypto";

const API_ORIGIN = "https://api.razorpay.com";
const PATH = "/v1/orders";
const MAX_REQUESTS = 8;
const EVIDENCE = new URL("../r4-receipt-evidence.json", import.meta.url);
const fail = (m) => { process.stderr.write(`Refusing to run: ${m}\n`); process.exit(2); };

const KEY_ID = process.env.RAZORPAY_TEST_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_TEST_KEY_SECRET || "";
if (!/^rzp_test_[A-Za-z0-9]+$/.test(KEY_ID) || !KEY_SECRET) fail("test-mode placeholder credentials required.");
if ("RAZORPAY_API_BASE" in process.env) fail("RAZORPAY_API_BASE is not supported.");
if (process.env.R4_CONFIRM !== "execute") { process.stderr.write("Plan: 8 GET /v1/orders?receipt=… requests. Set R4_CONFIRM=execute.\n"); process.exit(0); }

const originalBytes = fs.readFileSync(EVIDENCE);
const original = JSON.parse(originalBytes.toString("utf8"));
const RUN = original.run;
const known = {};
const add = (x) => { if (x?.order?.id && x.order.receipt) (known[x.order.receipt] ||= []).push(x.order.id); };
const ex = original.experiments;
add(ex.E1_sequential.first); add(ex.E1_sequential.second);
ex.E2_concurrent.results.forEach(add);
ex.E3_client_abort.runs.forEach((r) => add(r.attempt));
add(ex.E4_discarded_then_retry.firstAttempt); add(ex.E4_discarded_then_retry.retry);
const receipts = Object.keys(ex.E5_counts.second);
if (receipts.length !== MAX_REQUESTS || !receipts.every((r) => r.startsWith(RUN))) fail("unexpected receipt set in original evidence.");

const AUTH = "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
const SAFE = /^[A-Za-z0-9_\-]{1,100}$/;
const safeOrder = (o) => (o && o.entity === "order" ? {
  id: typeof o.id === "string" && /^order_[A-Za-z0-9]{1,40}$/.test(o.id) ? o.id : null,
  receipt: typeof o.receipt === "string" && SAFE.test(o.receipt) ? o.receipt : null,
  amount: Number.isInteger(o.amount) ? o.amount : null,
  currency: typeof o.currency === "string" && /^[A-Z]{3}$/.test(o.currency) ? o.currency : null,
  status: typeof o.status === "string" && /^[a-z_]{1,20}$/.test(o.status) ? o.status : null,
  created_at: Number.isInteger(o.created_at) ? o.created_at : null,
} : null);
const safeError = (j) => (j?.error && typeof j.error === "object" ? {
  code: typeof j.error.code === "string" && /^[A-Z_]{1,60}$/.test(j.error.code) ? j.error.code : null,
  description: typeof j.error.description === "string"
    ? j.error.description.replace(/rzp_(test|live)_[A-Za-z0-9]+/g, "[redacted-key]").replace(/[A-Za-z0-9+/=_\-]{24,}/g, "[redacted-token]").slice(0, 200) : null,
} : null);

let sent = 0;
const results = {};
for (const receipt of receipts) {
  if (sent >= MAX_REQUESTS) fail("request budget exceeded");
  sent += 1;
  const url = new URL(PATH, API_ORIGIN);
  url.searchParams.set("receipt", receipt);
  url.searchParams.set("count", "100");
  if (url.origin !== API_ORIGIN || url.pathname !== PATH) fail("blocked destination");
  const requestedAt = new Date().toISOString();
  let entry;
  try {
    const res = await fetch(url, { method: "GET", headers: { Authorization: AUTH }, redirect: "error" });
    const buf = Buffer.from(await res.arrayBuffer());
    let j = null; try { j = buf.length <= 262144 ? JSON.parse(buf.toString("utf8")) : null; } catch {}
    const shapeOk = res.ok && j && j.entity === "collection" && Array.isArray(j.items) && Number.isInteger(j.count);
    const exact = shapeOk ? j.items.filter((o) => o?.receipt === receipt).map(safeOrder) : [];
    entry = {
      requestedAt, completedAt: new Date().toISOString(), httpStatus: res.status,
      status: !res.ok ? "failed" : !shapeOk ? "failed_shape" : j.items.length >= 100 ? "incomplete" : "complete",
      collectionCount: shapeOk ? j.count : null, returnedItems: shapeOk ? j.items.length : null,
      exactReceiptMatches: shapeOk && j.items.length < 100 ? exact.length : null,
      orders: exact, error: res.ok ? null : safeError(j),
      knownOrderIdsFromCreateResponses: known[receipt] || [],
      knownIdsFound: (known[receipt] || []).filter((id) => exact.some((o) => o.id === id)).length,
    };
  } catch (err) {
    entry = { requestedAt, completedAt: new Date().toISOString(), status: "network_error", errorName: SAFE.test(err?.name || "") ? err.name : "Error", knownOrderIdsFromCreateResponses: known[receipt] || [] };
  }
  results[receipt] = entry;
}

const out = JSON.stringify({
  schema: "kavach-r4-e5-recheck/v1",
  originalRun: RUN,
  originalEvidenceSha256: crypto.createHash("sha256").update(originalBytes).digest("hex"),
  originalFinishedAt: original.finishedAt,
  nodeVersion: process.version,
  credentialMode: "test (proxy-attested by owner; NOT verified by script)",
  requestsSent: sent,
  results,
}, null, 2);
if (/rzp_(test|live)_[A-Za-z0-9]+|Basic [A-Za-z0-9+/=]{8,}/.test(out) || out.includes(KEY_SECRET)) fail("output contained credential-like material; nothing written");
process.stdout.write(out + "\n");
for (const [r, e] of Object.entries(results)) {
  process.stderr.write(`${r}: ${e.status} http=${e.httpStatus ?? "-"} matches=${e.exactReceiptMatches ?? "unknown"} knownFound=${e.knownIdsFound ?? "-"}/${(e.knownOrderIdsFromCreateResponses || []).length}${e.error?.code ? " " + e.error.code : ""}\n`);
}
