# R4 — Razorpay Receipt-Uniqueness Experiment: Procedure (revision 3, results pending)

**Status:** NOT EXECUTED. Revision 2 (`81de7bd`) passed independent review in principle; revision 3 makes the two required final corrections (redirect protection; refined §3 criteria) and **awaits independent approval before the owner runs it**. No conclusion about Razorpay behaviour is drawn here, and none should be drawn from documentation alone; the statement that "receipt must be unique" is not treated as an atomic idempotency guarantee.
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

## 3. How to read the results (pre-registered; refined in revision 3 before any data exists)

### 3.1 Definitions

- **Valid successful order:** `outcome = response_received`, HTTP 200, and `order` present with a non-null `id`, `receipt` equal to the receipt sent, `amount = 100`, `currency = "INR"`.
- **Duplicate-specific rejection:** `outcome = response_received`, HTTP 4xx **other than** 401, 403, 404, 408 and 429, **and** the sanitised `error.description` explicitly refers to the receipt being already used or duplicated (for example it mentions "receipt" together with "already", "exists", "duplicate" or "unique"). A 4xx whose description does not clearly say this is an **unclear rejection**, not a duplicate-specific one.
- **Unrelated failure:** HTTP 429 or 5xx, any `no_response` (`aborted_by_timer`, `aborted_unexpectedly`, `network_error`), an unclear rejection, or a 200 without a valid order.
- **Complete count:** an E5 listing with `status = "complete"`. `failed` or `incomplete` listings are **unknown**: never zero, never one. Both E5 rounds are considered; if they disagree, see 3.5.

### 3.2 E1: sequential uniqueness

"**Duplicate receipts are rejected sequentially**" requires **all** of:
1. the first request is a valid successful order;
2. the second request is a duplicate-specific rejection;
3. a complete E5 count of exactly 1 for the E1 receipt.

Other E1 patterns:
- second request is a valid successful order with a **new** `id` → **receipt not unique**;
- with the **same** `id` → **receipt acts as an idempotency key**;
- anything else (unrelated failure, unclear rejection, unknown count) → **E1 inconclusive** (re-run).

### 3.3 E2: atomic uniqueness under concurrency

"**Duplicate receipts are rejected atomically** (at the tested concurrency)" requires **all** of:
1. exactly one valid successful order;
2. every other request is a duplicate-specific rejection;
3. no 429, no 5xx and no network or abort error among the E2 requests;
4. a complete E5 count of exactly 1 for the E2 receipt.

If any E2 request failed for an unrelated reason, E2 is **not** classified as atomic, even with one success and a count of 1. It is **inconclusive** (re-run, possibly at lower concurrency). More than one valid successful order, or a complete count above 1, means **not atomic**.

### 3.4 Overall conclusion: "Razorpay enforces receipt uniqueness atomically (at the tested concurrency)"

Requires E1 (3.2) and E2 (3.3) to meet their criteria, **and** complete E5 counts of exactly 1 for the **E1, E2 and E4** receipts. E3 receipts are **evaluated separately** (3.5): a complete count of 0 for an E3 receipt is valid, because an abort may have prevented creation, and does not count against the conclusion.

### 3.5 E3 orphans, E4 recovery and consistency (unchanged in substance)

| Observed | Meaning |
|---|---|
| E3 `aborted_by_timer`, `headersReceived = false`, complete E5 count = 1 | **Orphan confirmed**: the caller had a genuinely unknown outcome, yet the order exists |
| E3 `aborted_by_timer`, complete E5 count = 0 | The abort pre-empted creation in that run. Does **not** disprove orphans; inconclusive for that run |
| E3 `network_error` | Not an abort; report separately; no orphan conclusion |
| E3 `response_received` (timer did not fire) | Not an unknown-outcome case |
| E3 count > 1 | Unexpected; investigate |
| E4 retry = duplicate-specific rejection, complete count 1 | A recovering caller **cannot create a second order** but also does **not** get the existing order back; it must fetch by receipt |
| E4 retry = valid order with the **same** `id`, count 1 | Retry is idempotent and returns the existing order |
| E4 retry = valid order with a **new** `id`, count 2 | A recovering retry **creates a duplicate order** |
| E5 counts differ between the two rounds | Listing is eventually consistent: "0 found" must not mean "no order"; hold and re-check |

### 3.6 R4 implications by outcome

| Outcome | R4 implication |
|---|---|
| 3.4 met | The deterministic receipt blocks duplicate gateway orders per obligation. R4 centres on handling the duplicate-receipt rejection by fetching by receipt and reusing the existing order after validating amount, currency and status. Takeover of an expired `reserving` reservation reconciles by receipt before any create |
| E1 met but E2 **not atomic** | Our side must prevent concurrent creates (the reservation does), reconcile-before-create on takeover, and de-duplicate per obligation in the webhook (a second paid order goes to R5, never double fulfilment) |
| Receipt **not unique** | As the row above; multi-order reconciliation is reachable in normal operation |
| Receipt acts as an **idempotency key** | Duplicate create is a no-op; still reconcile on takeover |
| E1 or E2 **inconclusive** | No R4 design decision; re-run the affected experiment |
| Orphan confirmed (E3) | "Unknown outcome → reconciliation_required → fetch by receipt" is necessary |

**Not concluded by this experiment:** atomicity above the tested concurrency or across regions; equivalence of test and live mode.

## 4. Safety checklist (revisions 2–3)

| # | Property | How it is enforced | Verified by (dry-run, §6) |
|---|---|---|---|
| 1 | Credentials can only go to `https://api.razorpay.com` | Origin is a constant; no override exists; the script **refuses to start** if `RAZORPAY_API_BASE` is set; `buildUrl()` re-checks the origin before every request | S1, S2, R3, X-* allow-list checks |
| 2 | Only `POST /v1/orders` and `GET /v1/orders` | `ALLOWED` set checked in `buildUrl()`; query keys limited to `receipt`, `count`, `skip`; only 2 `fetch` call sites, both via `buildUrl()` | S3, S4, X-* allow-list and query-key checks |
| 2a | Redirects never followed | Both `fetch()` calls set `redirect: "error"`, so a 3xx response throws instead of sending the request (and its Authorization header) elsewhere | S5 (static, comments excluded), X-* every request has `redirect: "error"`, N1 (real Node fetch on a loopback 302: throws, target never requested) |
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

### Revision 3 (after review of `81de7bd`)

| Required correction | Change |
|---|---|
| Redirect protection | `redirect: "error"` added to the POST and GET `fetch()` options; origin and endpoint allowlists unchanged; evidence schema `v3` |
| Refined interpretation | §3 rewritten: E1 needs a valid first order, a duplicate-specific 4xx and a complete count of 1; E2 atomic needs exactly one success, all others duplicate-specific, no 429/5xx/network errors and a complete count of 1, otherwise inconclusive; overall conclusion needs counts of 1 for E1, E2 and E4; E3 evaluated separately (complete 0 valid); E3 orphan and E4 recovery readings preserved |

Experiment scope (E1–E5, request budget) is unchanged.

## 6. Dry-run validation (no Razorpay calls)

`node docs/qa/R4/dry-run/dry-run.mjs` runs static checks, refusal cases (which exit before any request), plan-only mode, and three executed runs in which `globalThis.fetch` is replaced in-process by `docs/qa/R4/dry-run/fetch-stub.mjs`. The stub asserts every request's origin, path and method, and logs only whether an Authorization header was present, never its value. Modes:
- `enforce`: duplicates rejected.
- `allow`: duplicates created.
- `faults`: a listing returns 500; a listing ignores the receipt filter; a listing needs pagination; an E3 request fails with a connection reset.

**Result, revision 3 (2026-11-23, Node v22.23.5): 58/58 checks passed; Razorpay API calls made: 0.** (Revision 2: 53/53.) New checks: S5, N1, and "every request sets `redirect: "error"`" in each of the three stub modes. Output: `docs/qa/R4/dry-run/dry-run-result.txt`.

During revision 3 validation, the new static check S5 first miscounted, because the script's header comment also contains `redirect: "error"`; S5 now ignores comments, and the script was not changed for it. During revision 2 validation, one check initially failed because the **stub** injected its network error after its simulated latency, so the 5 ms abort fired first. The script correctly recorded `aborted_by_timer`. The stub was corrected so the network-error path is genuinely exercised; the script did not change.

The stub models assumptions about Razorpay's responses (error shape, collection shape, `skip` pagination). **It is not evidence about Razorpay.** In particular, whether `GET /v1/orders` honours the `receipt` filter is itself measured by the real run (`receiptFilterAppearsApplied`).

## 7. Next steps

1. Independent approval of revision 3 (script, stub, dry-run result).
2. Owner runs Step 1 (plan), then Step 2 (execute), and shares the evidence.
3. Analysis against §3, recorded here, then independent review of the evidence.
4. Only then is R4 designed.
