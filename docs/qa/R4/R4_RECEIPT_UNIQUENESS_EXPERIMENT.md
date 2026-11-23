# R4 — Razorpay Receipt-Uniqueness Experiment: Procedure (results pending)

**Status:** BLOCKED. The experiment has **not** been run against Razorpay. The owner declined to provide a test-mode key to the implementation session (2026-11-23). No conclusion about Razorpay behaviour is drawn here, and none should be drawn from documentation alone.
**Purpose:** settle, with evidence, whether Razorpay's Orders API enforces `receipt` uniqueness for sequential and concurrent requests, and whether a timed-out request can leave an orphan order. This must be settled before R4 is designed.
**Application code:** unchanged. The script below is QA tooling, not imported by the app.

## 1. How to run (owner or independent reviewer)

Requirements: Node 18+, a Razorpay **TEST-mode** key (Key ID starts `rzp_test_`), and a machine you trust.

```bash
RAZORPAY_TEST_KEY_ID=rzp_test_xxx RAZORPAY_TEST_KEY_SECRET=xxx node docs/qa/R4/receipt-uniqueness-experiment.mjs > r4-receipt-evidence.json
```

- The script refuses to run unless the Key ID starts with `rzp_test_`. It never prints the key ID or secret.
- It creates about **13 orders of ₹1** in test mode. An order is not a payment: no money moves, and nothing needs to be paid. Unpaid test orders simply stay `created`.
- Runtime is about 20 seconds. The human summary goes to the terminal (stderr); full JSON evidence goes to `r4-receipt-evidence.json`.
- Optional settings: `R4_CONCURRENCY` (default 5), `R4_ABORT_MS` (default `5,50,150,400,1000`).
- Share `r4-receipt-evidence.json` (and the summary). It contains order IDs, receipts, amounts, statuses, timestamps, HTTP statuses, Razorpay error bodies and request IDs. It contains no key, no customer data and no payment data.

## 2. Experiments

| ID | Procedure | Question answered |
|---|---|---|
| E1 | Create order with receipt A; then create again with receipt A, same amount and currency | Are duplicate receipts rejected **sequentially**? With what HTTP status and error code? |
| E2 | Fire N (default 5) creates with receipt B **simultaneously** | Are duplicates rejected **under concurrency**, i.e. is the check atomic? |
| E3 | Create with receipt C_t, aborting the HTTP request client-side after t ms (5–1000 ms); later list orders by receipt | Can the caller see "timeout/unknown" while an order **exists** (orphan)? |
| E4 | Create with receipt D and treat the response as lost; retry with receipt D exactly as a recovering server would | What does a recovering retry get: rejection, the same order, or a second order? |
| E5 | For every receipt used, `GET /v1/orders?receipt=…` at about 3 s and about 15 s | Authoritative order count per receipt; does the count settle over time? |

Captured per call: local send and receive timestamps, latency, HTTP status, Razorpay request ID (if the header is present), redacted order (`id, amount, amount_paid, amount_due, currency, receipt, status, attempts, created_at`) or Razorpay error body, or a client error such as `AbortError`.

## 3. How to read the results (pre-registered, before seeing data)

| Observed | Meaning | R4 implication |
|---|---|---|
| E1 second = 4xx **and** E2 exactly one 200 with the rest 4xx **and** E5 counts all 1 | Razorpay enforces uniqueness **atomically**, at least at the concurrency tested | The deterministic receipt already blocks duplicate gateway orders per obligation. R4 centres on handling the duplicate-receipt rejection: fetch the existing order by receipt and reuse it after validating amount, currency and status, instead of failing. Takeover of an expired `reserving` reservation must reconcile by receipt first. |
| E1 second = 4xx but E2 shows **more than one 200**, or E5 count above 1 for B | Uniqueness is checked but **not atomic** under concurrency | Gateway cannot be relied on. R4 needs our side to prevent concurrent creates per obligation (the reservation already does this) **plus** reconcile-before-create on takeover **plus** obligation-level de-duplication in the webhook (a second paid order goes to R5 reconciliation, never double fulfilment). |
| E1 second = **200 with a new order ID** | Receipt is **not** unique | Same as the row above; receipts are labels only. The existing multi-order reconciliation path is reachable in normal operation. |
| E1 second = 200 with the **same** order ID | Receipt behaves as an idempotency key | Strongest case: duplicate creation is a no-op. Still reconcile on takeover; it then just returns the existing order. |
| E3: caller `AbortError` and E5 count = 1 | **Orphan order confirmed**: the outcome was unknown to the caller, yet the order exists | The "unknown outcome → reconciliation_required → fetch by receipt" path is necessary, not theoretical. |
| E3: caller `AbortError` and E5 count = 0 | The abort happened before Razorpay created the order | No orphan in that run; this does not disprove orphans. E4 is the deterministic case. |
| E5 counts differ between 3 s and 15 s | Listing by receipt is **eventually consistent** | Reconciliation must not treat "0 found" as "no order exists"; it must re-check or hold. This is already the code's behaviour per the baseline (empty result keeps the reservation blocked). |

**Not to be concluded from this experiment:**
- A rejection at concurrency 5 does not prove atomicity at higher concurrency or across Razorpay regions.
- Test-mode behaviour is assumed, but not proven, to match live mode.
- The documentation's statement that "receipt must be unique" is **not** treated as an atomic idempotency guarantee (owner instruction).

## 4. Script verification (mechanics only, not evidence)

The script was exercised against a **local mock gateway** in two modes: one that rejects duplicate receipts and one that allows them. This was only to verify that it:
- refuses non-`rzp_test_` keys (exit 2)
- never emits the key ID, secret or their base64 form
- distinguishes the two behaviours in E1, E2 and E4
- detects orphans in E3 (caller saw `AbortError` while an order existed)

**These mock runs say nothing about Razorpay** and are not stored as evidence.

## 5. Next step

1. Owner or reviewer runs the script with a test-mode key and shares `r4-receipt-evidence.json`.
2. The implementation session analyses it against §3 and records results in this document.
3. Independent review of the evidence.
4. Only then is R4 designed and implemented.
