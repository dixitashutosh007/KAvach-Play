# R4 — Razorpay Receipt-Uniqueness Experiment: Procedure (revision 2, results pending)

**Status:** NOT EXECUTED. Revision 2 addresses the independent review of revision 1 (`b52c963`) and **awaits independent review before the owner runs it**. No conclusion about Razorpay behaviour is drawn here, and none should be drawn from documentation alone; the statement that "receipt must be unique" is not treated as an atomic idempotency guarantee.
**Application code:** unchanged. The script is QA tooling, not imported by the app. R4 is not implemented.

## 1. How to run (owner, after review approval)

Requirements: Node.js 18+, a Razorpay **TEST-mode** key (Key ID `rzp_test_…`), and a trusted machine. Never paste the key into any chat.

```bash
# Step 1: plan only. Validates the key format and settings and prints the request budget. Sends nothing.
RAZORPAY_TEST_KEY_ID=rzp_test_xxx RAZORPAY_TEST_KEY_SECRET=xxx node docs/qa/R4/receipt-uniqueness-experiment.mjs
```

```bash
# Step 2: execute. Evidence JSON goes to the file; the human summary goes to the terminal.
R4_CONFIRM=execute RAZORPAY_TEST_KEY_ID=rzp_test_xxx RAZORPAY_TEST_KEY_SECRET=xxx node docs/qa/R4/receipt-uniqueness-experiment.mjs > r4-receipt-evidence.json
```

**Request budget with default settings** (concurrency 5; aborts 5/50/150/400/1000 ms):

| | Count |
|---|---|
| Create requests (`POST /v1/orders`) | **at most 14** = E1 2 + E2 5 + E3 5 + E4 2 |
| ₹1 test orders that can exist afterwards | **at most 14** (fewer if Razorpay rejects duplicates or an abort pre-empts a request) |
| List requests (`GET /v1/orders`) | **at most 48** = 8 receipts × 2 rounds × 3 pages (normally 16) |

Revision 1's documentation said "about 13"; the correct default maximum is 14. Settings are bounded: `R4_CONCURRENCY` 2–10; `R4_ABORT_MS` 1–6 values, each 1–10000 ms; total creates are hard-capped at 20. Runtime is about 20 s.

Share `r4-receipt-evidence.json` and the terminal summary. Before sharing, glance at them: they should contain only order IDs, receipts, amounts, statuses, timestamps, HTTP statuses, Razorpay error codes and redacted descriptions, and request IDs.

## 2. Experiments

| ID | Procedure | Question answered |
|---|---|---|
| E1 | Create with receipt A; then create again with receipt A (same amount and currency) | Are duplicate receipts rejected **sequentially**? Status and error code? |
| E2 | `R4_CONCURRENCY` simultaneous creates with receipt B | Are duplicates rejected **under concurrency** (atomic)? |
| E3 | For each t in `R4_ABORT_MS`: create with receipt C_t, aborting client-side after t ms | Can the caller face a **genuinely unknown outcome** while an order exists (orphan)? |
| E4 | Create with receipt D; the response **is received and recorded**, then the caller **deliberately discards** it and retries with receipt D | What does a recovering retry get: rejection, the same order, or a second order? (Models caller-side "unknown"; network-level unknowns are E3.) |
| E5 | For every receipt: paginated `GET /v1/orders?receipt=…` at about 3 s and about 15 s | Authoritative order count per receipt, and whether it settles |

## 3. How to read the results (pre-registered, unchanged from revision 1)

| Observed | Meaning | R4 implication |
|---|---|---|
| E1 second = 4xx **and** E2 exactly one 200 **and** all E5 counts `complete` and equal to 1 | Uniqueness enforced atomically (at the tested concurrency) | Deterministic receipt blocks duplicate gateway orders. R4 centres on handling the duplicate-receipt rejection by fetching and reusing the existing order after validating amount, currency and status. Takeover of an expired `reserving` reservation reconciles by receipt first |
| E1 second = 4xx but E2 has >1 success, or E5 count >1 for B | Checked but **not atomic** | Our side must prevent concurrent creates (the reservation does), reconcile-before-create on takeover, and de-duplicate per obligation in the webhook (a second paid order goes to R5, never double fulfilment) |
| E1 second = 200 with a **new** order ID | Receipt **not** unique | As the row above; multi-order reconciliation is reachable in normal operation |
| E1 second = 200 with the **same** order ID | Receipt acts as an idempotency key | Duplicate create is a no-op; still reconcile on takeover |
| E3 `aborted_by_timer`, no headers received, and E5 count = 1 (`complete`) | **Orphan confirmed** | "Unknown outcome → reconciliation_required → fetch by receipt" is necessary |
| E3 `aborted_by_timer` and E5 count = 0 (`complete`) | The abort pre-empted creation in that run | Does **not** disprove orphans; inconclusive for that run |
| E5 status `failed` or `incomplete` | Count **unknown** | Never read as zero; re-run that listing |
| E5 counts differ between rounds | Listing eventually consistent | "0 found" must not mean "no order"; hold and re-check |

**Not concluded by this experiment:** atomicity above the tested concurrency or across regions; equivalence of test and live mode.

## 4. Safety checklist (revision 2)

| # | Property | How it is enforced | Verified by (dry-run, §6) |
|---|---|---|---|
| 1 | Credentials can only go to `https://api.razorpay.com` | Origin is a constant; no override exists; the script **refuses to start** if `RAZORPAY_API_BASE` is set; `buildUrl()` re-checks the origin before every request | S1, S2, R3, X-* allow-list checks |
| 2 | Only `POST /v1/orders` and `GET /v1/orders` | `ALLOWED` set checked in `buildUrl()`; query keys limited to `receipt`, `count`, `skip`; only 2 `fetch` call sites, both via `buildUrl()` | S3, S4, X-* allow-list and query-key checks |
| 3 | Test mode only | Key ID must match `^rzp_test_[A-Za-z0-9]+$` | R1 |
| 4 | Nothing sent until explicitly confirmed | Without `R4_CONFIRM=execute` the script prints the plan and exits | P1, P2 (0 requests) |
| 5 | Bounded volume | Concurrency 2–10; 1–6 aborts of 1–10000 ms; total creates ≤ 20; per-run create and list budgets enforced at call time; maximums printed before execution | R4 (6 bad configs refused), P3, X-* creates ≤ declared max |
| 6 | Credentials never output | The Basic-auth header lives only in the request closure. The final guard aborts output (exit 3) if the evidence contains the key ID, secret, Basic header, their base64 forms, `Basic <token>` or any `rzp_test_`/`rzp_live_` string. Stderr never prints credentials | X-* stdout/stderr leak checks |
| 7 | No arbitrary response data | Orders: allow-listed, type-checked fields only (`id, receipt, amount, amount_paid, amount_due, currency, status, attempts, created_at`); `notes` and everything else dropped. Errors: `code` (pattern-checked) and a sanitised `description` (keys, emails, long tokens and long numbers redacted; 200 chars). Request IDs pattern-checked. Bodies over 256 KB are not parsed | X-enforce allow-listed error check; X-* leak checks (stub injects `notes.email`, `metadata`, a key in the description) |
| 8 | Evidence integrity | Node version, script SHA-256, per-call send/receive/fail timestamps, per-listing request/completion timestamps, actual request counts | X-* timestamps/node check |

## 5. Changes in revision 2 (review findings → change)

| Finding | Change |
|---|---|
| 1 Destination override | `RAZORPAY_API_BASE` removed; origin hard-coded; presence of the variable is refused |
| 2 Arbitrary error bodies | Error = `{ code, description }` only; HTTP status and request ID stored alongside |
| 3 Credentials and metadata | Allow-listed order fields; final credential scan before output; Authorization never logged |
| 4 Config bounds | Validated concurrency and abort lists; hard cap on total creates; budgets enforced at call time; plan printed first; `R4_CONFIRM=execute` required |
| 5 Endpoint restriction | Method+path allowlist and query-key allowlist checked before every request |
| 6 E3 abort vs network failure | Outcome `response_received` or `no_response`; `clientError.kind` is `aborted_by_timer`, `aborted_unexpectedly` or `network_error` (with cause code); `abortTimerFired` and `headersReceived` recorded. No claim that a request reached Razorpay unless E5 shows an order |
| 7 E4 wording | First attempt recorded as **received**, marked `callerTreatment: "discarded"`; described as caller-side unknown, not loss |
| 8 E5 robustness | HTTP status and collection shape validated; pagination via `skip` (up to 3 pages); `failed` or `incomplete` listings give `exactReceiptMatches: null` (never 0); detects an ignored receipt filter |
| 9 Timestamps and version | Per-listing `requestedAt`/`completedAt`; `nodeVersion`; `scriptSha256` |
| 10 Count | Documentation and summary state at most 14 creates (default) and the list maximum |

## 6. Dry-run validation (no Razorpay calls)

`node docs/qa/R4/dry-run/dry-run.mjs` runs static checks, refusal cases (which exit before any request), plan-only mode, and three executed runs in which `globalThis.fetch` is replaced in-process by `docs/qa/R4/dry-run/fetch-stub.mjs`. The stub asserts every request's origin, path and method, and logs only whether an Authorization header was present, never its value. Modes:
- `enforce`: duplicates rejected.
- `allow`: duplicates created.
- `faults`: a listing returns 500; a listing ignores the receipt filter; a listing needs pagination; an E3 request fails with a connection reset.

**Result (2026-11-23, Node v22.23.5): 53/53 checks passed; Razorpay API calls made: 0.** Output: `docs/qa/R4/dry-run/dry-run-result.txt`.

During validation, one check initially failed because the **stub** injected its network error after its simulated latency, so the 5 ms abort fired first. The script correctly recorded `aborted_by_timer`. The stub was corrected so the network-error path is genuinely exercised; the script did not change.

The stub models assumptions about Razorpay's responses (error shape, collection shape, `skip` pagination). **It is not evidence about Razorpay.** In particular, whether `GET /v1/orders` honours the `receipt` filter is itself measured by the real run (`receiptFilterAppearsApplied`).

## 7. Next steps

1. Independent review of revision 2 (script, stub, dry-run result).
2. Owner runs Step 1 (plan), then Step 2 (execute), and shares the evidence.
3. Analysis against §3, recorded here, then independent review of the evidence.
4. Only then is R4 designed.
