# Prompt for ChatGPT (independent reviewer): R4 Razorpay receipt-uniqueness experiment

Paste everything below the line into ChatGPT and attach `docs/qa/R4/receipt-uniqueness-experiment.mjs` (**revision 2**, after your review of `b52c963`), `docs/qa/R4/R4_RECEIPT_UNIQUENESS_EXPERIMENT.md` (§4 safety checklist, §5 changes) and `docs/qa/R4/dry-run/` (stub, runner, result).
**Never paste a Razorpay key or secret into the chat.**

---

You are the independent reviewer for KAvach Play, a live cricket-club platform built on Next.js, Firebase and Razorpay. The implementation agent (Claude Code) has prepared an experiment but has **not** run it. Your job is to **review the script, get it executed safely, and judge the evidence**. Do not approve any implementation; R4 is designed only after your review of the results.

## Background

- Payment orders are created server-side with a **deterministic receipt per obligation** (`rcpt_` + 32 hex chars of a SHA-256 of the reservation key). A Firestore reservation lease with fencing tokens prevents two of *our* requests from both proceeding. Fencing cannot stop an external Razorpay call that is already in flight.
- **Open question for R4:** does Razorpay's Orders API enforce `receipt` uniqueness, sequentially and under concurrency? And can a timed-out request leave an "orphan" order the caller never learned about?
- A documentation statement that "receipt must be unique" (found via search; razorpay.com was unreachable from the implementation environment) must **not** be treated as proof of an atomic idempotency guarantee. Only executed evidence counts.

## Step 1: review the attached script before anything runs

Check and report:
1. It refuses any key not starting with `rzp_test_`, and nothing can create live orders.
2. It never prints or writes the key ID, secret or the Basic-auth header (including base64).
3. It only calls `POST /v1/orders` and `GET /v1/orders?receipt=…`. It makes no payments, captures, refunds or other endpoints.
4. Amounts are ₹1 (100 paise), INR; with default settings at most 14 create requests and at most 48 list requests (bounded and printed before execution). Nothing is sent without `R4_CONFIRM=execute`.
5. The experiments actually test the questions below, and the redaction keeps only non-sensitive order fields.
6. Any flaw that would make the results misleading, for example aborts that fire before the request leaves the client, or listing by receipt being paginated or eventually consistent.

If you find a safety problem, **stop** and report it instead of running.

## Step 2: execution

- **If your environment can make outbound HTTPS calls to `api.razorpay.com` and can receive secrets securely** (not via chat): run it with the owner's TEST-mode key supplied as environment variables `RAZORPAY_TEST_KEY_ID` / `RAZORPAY_TEST_KEY_SECRET`.
- **Otherwise (the usual case):** say plainly that you cannot run it, and give the owner exact steps to run it on their own computer:
  ```bash
  RAZORPAY_TEST_KEY_ID=rzp_test_xxx RAZORPAY_TEST_KEY_SECRET=xxx node receipt-uniqueness-experiment.mjs
  R4_CONFIRM=execute RAZORPAY_TEST_KEY_ID=rzp_test_xxx RAZORPAY_TEST_KEY_SECRET=xxx node receipt-uniqueness-experiment.mjs > r4-receipt-evidence.json
  ```
  (First command = plan only, no requests; second = execute.)
  (Node 18+, about 20 s.) Then ask the owner to paste or attach **`r4-receipt-evidence.json` and the terminal summary**, which contain no secrets. Before analysing, check them for anything that looks like a key or secret.

Do not report anything as tested unless it was actually executed. Do not simulate or invent Razorpay responses.

## Step 3: analyse the evidence

The experiments:
- **E1:** sequential duplicate receipt.
- **E2:** 5 concurrent creates with one receipt.
- **E3:** client aborts at 5/50/150/400/1000 ms, then count by receipt.
- **E4:** first response received and recorded, then deliberately discarded by the caller, then retry with the same receipt.
- **E5:** authoritative count per receipt at about 3 s and about 15 s.

Report:
1. **Procedure actually executed:** who ran it, when, Node version, concurrency and abort settings.
2. **Results table per experiment:** HTTP status, Razorpay error code and description, order IDs, `created_at`, local timestamps, Razorpay request IDs where present.
3. **Are duplicate receipts rejected sequentially?** (E1, E4)
4. **Are they rejected concurrently, i.e. atomically?** (E2: count of 200s; E5 count for that receipt.) Note the limit: concurrency of 5 does not prove atomicity at higher load.
5. **Can a timed-out or unknown-outcome request leave an orphan order?** (E3: `clientError.kind = aborted_by_timer`, no headers received, and a `complete` E5 count of 1 means a confirmed orphan. A count of 0 means the abort pre-empted creation, which does not disprove orphans. `network_error` is not an abort. E5 listings with status `failed` or `incomplete` are unknown, never zero.)
6. **Is listing by receipt consistent?** (3 s vs 15 s counts.)
7. **Test vs live:** state that test-mode behaviour is assumed, not proven, to match live.

Then apply the interpretation table the implementation agent registered **before** seeing data (below). Say which row matches, and whether you agree with its R4 implication:

| Observed | Meaning | R4 implication |
|---|---|---|
| E1 second = 4xx, E2 exactly one 200, E5 counts all 1 | Uniqueness enforced atomically (at the tested concurrency) | Deterministic receipt blocks duplicate gateway orders. R4 centres on handling the duplicate-receipt rejection by fetching and reusing the existing order after validation; takeover of an expired reservation reconciles by receipt first |
| E1 second = 4xx but E2 has >1 success or E5 count >1 | Checked but not atomic | Our side must prevent concurrent creates (the reservation does), reconcile-before-create on takeover, and de-duplicate per obligation in the webhook (a second paid order goes to reconciliation, never double fulfilment) |
| E1 second = 200 with a new order ID | Receipt not unique | As the row above; multi-order reconciliation is reachable in normal operation |
| E1 second = 200 with the same order ID | Receipt acts as an idempotency key | Duplicate create is a no-op; still reconcile on takeover |
| E3 AbortError and count = 1 | Orphan confirmed | "Unknown outcome → reconciliation_required → fetch by receipt" is necessary |
| Counts change between 3 s and 15 s | Listing eventually consistent | "0 found" must not mean "no order exists"; hold and re-check |

## Step 4: verdict

Return:
- **Evidence status:** VERIFIED (executed, consistent), INCONCLUSIVE (say what is missing) or BLOCKED (not executed, say why).
- Your answers to Step 3, items 3–6.
- Whether the evidence is sufficient to start designing R4, and any extra experiment you require first.
- Any disagreement with the implementation agent's pre-registered implications.

Keep secrets, keys and any personal data out of your reply.
