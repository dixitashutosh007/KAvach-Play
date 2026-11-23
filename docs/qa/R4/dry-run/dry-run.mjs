#!/usr/bin/env node
/**
 * Static + dry-run validation of receipt-uniqueness-experiment.mjs with ZERO Razorpay calls.
 * Usage: node docs/qa/R4/dry-run/dry-run.mjs
 * Uses dummy credentials that are not real keys. Exits non-zero if any check fails.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../receipt-uniqueness-experiment.mjs");
const stub = path.resolve(here, "fetch-stub.mjs");
const DUMMY_ID = "rzp_test_DRYRUNDUMMYID01";
const DUMMY_SECRET = "dryRunDummySecretValue0001";
const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });

function run(env, { withStub = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r4dry-"));
  const stubLog = path.join(tmp, "calls.jsonl");
  const clean = { PATH: process.env.PATH, HOME: process.env.HOME };
  const args = withStub ? ["--import", stub, script] : [script];
  const r = spawnSync(process.execPath, args, { env: { ...clean, STUB_LOG: stubLog, ...env }, encoding: "utf8", timeout: 120000 });
  const calls = fs.existsSync(stubLog) ? fs.readFileSync(stubLog, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}
const creds = { RAZORPAY_TEST_KEY_ID: DUMMY_ID, RAZORPAY_TEST_KEY_SECRET: DUMMY_SECRET };
const b64 = Buffer.from(`${DUMMY_ID}:${DUMMY_SECRET}`).toString("base64");
const leaks = (s) => [DUMMY_ID, DUMMY_SECRET, b64, "Basic ", "rzp_test_", "someone@example.test", "metadata", "nope"].filter((x) => s.includes(x));

// Static checks on the source
const src = fs.readFileSync(script, "utf8");
check("S1 destination hard-coded", /const API_ORIGIN = "https:\/\/api\.razorpay\.com";/.test(src));
check("S2 no destination override read from env", !/process\.env\.RAZORPAY_API_BASE\s*\|\|/.test(src) && !/API_BASE\s*=/.test(src));
check("S3 only fetch() call sites use buildUrl()", (src.match(/await fetch\(/g) || []).length === 2 && (src.match(/await fetch\(url/g) || []).length === 2);
check("S4 endpoint allowlist is exactly POST/GET /v1/orders", /new Set\(\[`POST \$\{ORDERS_PATH\}`, `GET \$\{ORDERS_PATH\}`\]\)/.test(src));
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""); // comments removed
check("S5 both fetch() calls set redirect: \"error\" (code only, comments excluded)", (code.match(/redirect: "error"/g) || []).length === 2 && !/redirect: "(follow|manual)"/.test(code));

// N1: Node's real fetch refuses to follow a redirect when redirect: "error" (local loopback server only; no Razorpay)
{
  const http = await import("node:http");
  const hits = { target: 0 };
  const srv = http.createServer((req, res) => {
    if (req.url === "/target") { hits.target += 1; res.end("followed"); return; }
    res.writeHead(302, { location: "/target" }); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  let threw = false;
  try { await fetch(`http://127.0.0.1:${port}/start`, { method: "POST", body: "{}", redirect: "error" }); } catch { threw = true; }
  srv.close();
  check("N1 real Node fetch with redirect: \"error\" throws on 302 and never requests the redirect target", threw && hits.target === 0, `threw=${threw} targetHits=${hits.target}`);
}

// Refusals (no stub: any network attempt would be real, so these must exit before fetching)
check("R1 live key refused", run({ RAZORPAY_TEST_KEY_ID: "rzp_live_X1", RAZORPAY_TEST_KEY_SECRET: "s" }).code === 2);
check("R2 missing secret refused", run({ RAZORPAY_TEST_KEY_ID: DUMMY_ID }).code === 2);
check("R3 RAZORPAY_API_BASE refused", run({ ...creds, RAZORPAY_API_BASE: "https://evil.example" }).code === 2);
for (const [k, v] of [["R4_CONCURRENCY", "50"], ["R4_CONCURRENCY", "1"], ["R4_CONCURRENCY", "abc"], ["R4_ABORT_MS", "0"], ["R4_ABORT_MS", "1,2,3,4,5,6,7"], ["R4_ABORT_MS", "99999"]]) {
  check(`R4 bad config ${k}=${v} refused`, run({ ...creds, [k]: v }).code === 2);
}

// Plan-only mode: zero requests
{
  const r = run(creds, { withStub: true });
  check("P1 plan-only exits 0", r.code === 0);
  check("P2 plan-only sends zero requests", r.calls.length === 0, `calls=${r.calls.length}`);
  check("P3 plan reports max 14 creates by default", /up to 14 create/.test(r.stderr), r.stderr.split("\n")[0]);
}

// Executed against the stub in three modes
for (const mode of ["enforce", "allow", "faults"]) {
  const r = run({ ...creds, R4_CONFIRM: "execute", STUB_MODE: mode }, { withStub: true });
  const tag = `X-${mode}`;
  check(`${tag} exits 0`, r.code === 0, r.stderr.slice(-300));
  let ev = null;
  try { ev = JSON.parse(r.stdout); } catch {}
  check(`${tag} evidence is valid JSON`, !!ev);
  if (!ev) continue;
  check(`${tag} all requests allow-listed (origin, path, method)`, r.calls.every((c) => c.allowed && c.origin === "https://api.razorpay.com" && c.path === "/v1/orders"));
  check(`${tag} every request sets redirect: "error"`, r.calls.length > 0 && r.calls.every((c) => c.redirect === "error"));
  check(`${tag} only receipt/count/skip query keys`, r.calls.every((c) => c.queryKeys.every((k) => ["receipt", "count", "skip"].includes(k))));
  const posts = r.calls.filter((c) => c.method === "POST").length;
  check(`${tag} creates ≤ declared max (${ev.maxCreateRequests})`, posts <= ev.maxCreateRequests && posts === ev.requestsSent.creates, `posts=${posts}`);
  check(`${tag} no credential/PII/unlisted fields in stdout`, leaks(r.stdout).length === 0, leaks(r.stdout).join(","));
  check(`${tag} no credential material in stderr`, [DUMMY_ID, DUMMY_SECRET, b64].every((x) => !r.stderr.includes(x)));
  check(`${tag} node version and per-count timestamps recorded`, !!ev.nodeVersion && Object.values(ev.experiments.E5_counts.first).every((c) => c.requestedAt && c.completedAt));
  check(`${tag} E4 first attempt recorded as received+discarded`, ev.experiments.E4_discarded_then_retry.firstAttempt.callerTreatment === "discarded" && ev.experiments.E4_discarded_then_retry.firstAttempt.outcome === "response_received");
  const e1 = ev.experiments.E1_sequential;
  if (mode === "enforce") {
    check(`${tag} E1 second rejected with allow-listed error only`, e1.second.httpStatus === 400 && e1.second.error.code === "BAD_REQUEST_ERROR" && Object.keys(e1.second.error).sort().join() === "code,description" && e1.second.error.description.includes("[redacted-key]"));
    const ok = ev.experiments.E2_concurrent.results.filter((x) => x.httpStatus === 200).length;
    check(`${tag} E2 exactly one success`, ok === 1, `ok=${ok}`);
  }
  if (mode === "allow") {
    check(`${tag} E1 second created a new order`, e1.second.httpStatus === 200 && e1.second.order.id !== e1.first.order.id);
    check(`${tag} E5 E2 count = concurrency`, ev.experiments.E5_counts.second[ev.experiments.E2_concurrent.receipt].exactReceiptMatches === ev.concurrency);
  }
  if (mode === "faults") {
    const e2r = ev.experiments.E2_concurrent.receipt;
    const firstE2 = ev.experiments.E5_counts.first[e2r];
    check(`${tag} failed listing is UNKNOWN, not zero`, firstE2.status === "failed" && firstE2.exactReceiptMatches === null && firstE2.error.httpStatus === 500);
    const e1c = ev.experiments.E5_counts.second[e1.receipt];
    check(`${tag} ignored receipt filter detected`, e1c.receiptFilterAppearsApplied === false && e1c.exactReceiptMatches === 2);
    const e4c = ev.experiments.E5_counts.second[ev.experiments.E4_discarded_then_retry.receipt];
    check(`${tag} pagination followed (>1 page)`, e4c.pages.length >= 2 && e4c.status === "complete", `pages=${e4c.pages.length}`);
    const runs = ev.experiments.E3_client_abort.runs;
    const net = runs.find((x) => x.attempt.abortAfterMs === 5).attempt;
    check(`${tag} network error not misreported as abort`, net.outcome === "no_response" && net.clientError.kind === "network_error" && net.clientError.causeCode === "ECONNRESET");
    const ab = runs.find((x) => x.attempt.abortAfterMs === 50).attempt;
    check(`${tag} real abort recorded with timer fired`, ab.clientError?.kind === "aborted_by_timer" && ab.abortTimerFired === true);
    const done = runs.find((x) => x.attempt.abortAfterMs === 1000).attempt;
    check(`${tag} late abort timer did not fire; response received`, done.outcome === "response_received" && done.abortTimerFired === false);
  }
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.pass ? `  [${r.detail}]` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; Razorpay API calls made: 0 (fetch replaced in-process; refusal cases exit before any fetch).`);
process.exit(failed.length ? 1 : 0);
