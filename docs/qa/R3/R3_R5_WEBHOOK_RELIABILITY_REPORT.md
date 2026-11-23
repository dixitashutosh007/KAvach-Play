# R3 + R5 — Webhook Error Classification, Retry Reliability and Unmatched-Event Reconciliation

**Status:** R3 IMPLEMENTED, R5 IMPLEMENTED: automated verification passed; awaiting independent review (not ACCEPTED)
**Branch:** `mig-mov` (owner-approved; Option A = R3 and R5 together as separate commits)
**Base SHA:** `f759a74`
**Commits:** `12f8eb8` (R3), `b0719a6` (R3 evidence fix), `352a94c` (R5)
**Date:** 2026-11-23
**Environment:** Local Firestore emulator only. Nothing deployed. No real Razorpay calls.

---

## 1. Razorpay behaviour this design depends on

Verified via web search of Razorpay's documentation. razorpay.com itself is blocked by this environment's network policy, so the pages could not be fetched directly.

| Behaviour | Source |
|---|---|
| A delivery succeeds only with a **2xx within 5 seconds**; anything else, including a timeout, is a failure | [Best Practices](https://razorpay.com/docs/us/webhooks/best-practices/), [FAQs](https://razorpay.com/docs/us/webhooks/faqs) |
| **Every non-2xx (4xx included)** is retried with exponential backoff for 24 h from event creation | same |
| If failures persist for 24 h the webhook is **disabled**, an alert email is sent, and it must be re-enabled manually. The docs do not say whether one event is enough | [FAQs](https://razorpay.com/docs/us/webhooks/faqs) |
| At-least-once delivery; `x-razorpay-event-id` is unique per event | [Validate and Test](https://razorpay.com/docs/us/webhooks/validate-test) |

**Consequence:** the previous assumption that "400 = permanent, not retried" was false. Before this change, permanent failures returned 400, were retried for 24 h for nothing, and risked disabling the webhook. Unmatched events were acknowledged with 200 and **nothing was recorded**.

## 2. Pre-fix behaviour (reproduced)

Real HMAC-signed requests to the production route, run against the emulator (`docs/qa/R3/r3-characterisation-before-fix.txt`):

| Case | Before | After |
|---|---|---|
| Valid payment / duplicate / concurrent duplicates | 200 / 200 / – | 200 processed / 200 already_processed / exactly one fulfilment |
| Missing, invalid or tampered signature | 401 | 401 (unchanged), nothing recorded |
| Malformed JSON with a valid signature | **500**, parser text echoed | **400** `MALFORMED_JSON` |
| Firestore UNAVAILABLE / DEADLINE_EXCEEDED / ABORTED | **400** | **503** `INFRASTRUCTURE` |
| Player merge in progress | **400** | **503** `MERGE_IN_PROGRESS`, succeeds on retry once the merge settles |
| Unknown intent; amount, currency or order mismatch | **400**, nothing recorded | **recorded → 200** `recorded_for_reconciliation` |
| Second, different payment captured for an already-paid intent | **400**, nothing recorded (captured money untracked) | **recorded as `conflicting_payment` → 200** |
| Signed payment event without `intentId` | **200**, nothing recorded | **recorded → 200** |
| Event types not acted on (e.g. `payment.failed`) | 200 | 200 `ignored` (not recorded) |
| Store cannot write the record | n/a | **503** (never acknowledged without a record) |

## 3. Design

### Response policy (`app/api/razorpay/webhook/route.ts`)

| Status | Meaning | Razorpay effect |
|---|---|---|
| 200 `processed` / `already_processed` | Applied, or already applied (idempotent) | Done |
| 200 `ignored` | Event type not acted on | Done |
| 200 `recorded_for_reconciliation` | Permanent failure, **stored first** in `webhookDeadLetters`; never fulfils payment | Done; finance follows up |
| 400 | Signed body that is not JSON | Retried; cannot occur for genuine Razorpay events |
| 401 | Missing or invalid signature | Retried; indicates a forged request or a misconfigured secret |
| 503 | Retryable: infrastructure, merge in progress, **any unclassified error**, or the record could not be written | Retried for 24 h; idempotent processing makes retry safe |

The rule is that **unknown errors are retryable**. A retry is safe because fulfilment is idempotent per intent (FIN-002); silently dropping an event is not.

### Classification (`lib/razorpay-webhook.ts`)

`WebhookPermanentError(reason)`, `WebhookRetryableError(reason)` and `classifyWebhookError()`. Error messages are unchanged, so existing tests and callers are unaffected. `validateWebhookTransaction()` now also returns a `reason`.

Permanent reasons: `INTENT_NOT_FOUND`, `INTENT_INVALID`, `UNSUPPORTED_EVENT`, `ORDER_MISMATCH`, `PAYMENT_ID_INVALID`, `PARTIAL_PAYMENT`, `AMOUNT_INVALID`, `AMOUNT_MISMATCH`, `CURRENCY_MISMATCH`, `CONFLICTING_PAYMENT`, `MERGE_CHAIN_INVALID`, `NO_INTENT_ID`, `MALFORMED_EVENT`.
Retryable reasons: `MERGE_IN_PROGRESS`, `INFRASTRUCTURE` (default).

### Dead-letter store (`lib/webhook-dead-letter.ts`, collection `webhookDeadLetters`)

- **Key:** one record per gateway payment (`pay_<paymentId>`), falling back to `evt_<eventId>`, then `ord_<orderId>`, then `body_<sha256>`. `payment.captured` and `order.paid` for the same money therefore become one reconciliation item.
- **Fields:** `status` (`open` / `resolved`), `reason`, `classification` (`unmatched` / `mismatch` / `conflicting_payment` / `data_integrity`), `events`, `eventIds` (last 20), `orderId`, `paymentId`, `intentId`, `amountPaise`, `currency`, `firstSeenAt`, `lastSeenAt`, `deliveryCount`, `lastCorrelationId`; plus `resolution`, `resolutionNote`, `resolvedBy` and `resolvedAt` once resolved.
- **No raw payload, no payer email, phone, VPA or card data** (tested).
- Re-delivery updates `lastSeenAt`, `deliveryCount` and `eventIds`, and **never reopens** a resolved record.
- **Never modifies payments, fees, intents or ledgers.**
- Firestore rules: read for Finance Admin and Super Admin; no client writes.

### Manual reconciliation (`/api/finance/webhook-reconciliation`)

- `GET ?status=open|resolved|all`: Finance Admin or Super Admin; at most 100, newest first. Uses only a single-field equality query, so no composite index is needed.
- `POST { id, resolution, note? }`: records the outcome **once** (409 on a second attempt). Allowed values are `linked_to_obligation`, `refund_initiated`, `duplicate_no_action`, `test_or_invalid_event`, and `other` (note required). An `auditLogs` entry (`entity: webhook_dead_letter`) is written in the **same transaction**.
- Resolving records what finance did; it does **not** apply money. Linking a payment to an obligation, or refunding it, is done through the existing authorised workflows or the Razorpay dashboard.
- **No UI yet.** The API is the reconciliation path; a Finance-screen view is a follow-up UX item.

### Observability

Each request has a correlation ID (`x-razorpay-event-id` when present, otherwise a generated `wh_<uuid>`), returned in every response. There is one structured log line per request: `cid`, `outcome`, `reason`, event, and intent, order and payment IDs. **No secret, signature, raw payload or payer contact data appears in logs** (asserted in R3-18). Responses no longer echo internal amounts, IDs or exception text.

## 4. Test evidence (executed 2026-11-23, local)

| Command | Executed | Pass | Fail | Skipped |
|---|---|---|---|---|
| `tests/r3-webhook-route.emulator.test.mjs` against the **pre-R3** route | 18 | 1 | **17** | 0 |
| same, after R3 (`12f8eb8`) | 18 | 18 | 0 | 0 |
| `tests/r5-webhook-dead-letter.emulator.test.mjs` against the **R3-commit** route and rules | 15 | 4 | **11** | 0 |
| R5 + R3 files after R5 (`352a94c`) | 33 | 33 | 0 | 0 |
| `npm run test:emulator` (full) | 403 | 403 | 0 | 0 |
| `npm run test:functional` (full) | 1035 | 1035 | 0 | 0 |
| `npx tsc --noEmit` / `npm run build` | n/a | exit 0 / exit 0 | n/a | n/a |

Honest notes on the before-fix counts:
- Several pre-R3 failures reflect the new response contract (`outcome` and `code` fields) rather than defects. The behavioural evidence is the characterisation table in §2.
- The 4 R5 tests that passed before the fix are rejection and input-validation paths the old code already handled: signature, malformed JSON, duplicate, and API validation.

**Mocked elements:** infrastructure failures (R3-15/16, R5-10), injected by wrapping Firestore so `runTransaction` throws gRPC-coded errors. Reconciliation-API caller identity uses the test-only `x-test-*` headers; real token verification is covered by R1. Everything else (route handlers, HMAC, Firestore transactions, rules) is real.

Brief scenarios → tests:

| Brief scenario | Test |
|---|---|
| Valid webhook | R3-01 |
| Invalid / missing signature; altered raw payload | R3-05, R3-06, R3-07; R5-07 |
| Malformed JSON; missing event fields | R3-08, R5-08; MALFORMED_EVENT path (R5-01 covers NO_INTENT_ID) |
| Amount / currency / order mismatch | R3-10/11/12, R5-05 |
| Duplicate event; same payment via a different delivery | R3-02, R3-03, R5-09 |
| Firestore transient failure; transaction exhaustion | R3-15 |
| Recovery after transient failure | R3-16, R3-17 |
| Concurrent duplicate delivery | R3-04 |
| Valid event without intent ID / unknown order / unknown payment | R5-01, R5-02, R5-03 |
| Duplicate unmatched event | R5-04 |
| Later successful reconciliation | R5-11, R5-12 |
| Authorised vs unauthorised reconciliation access | R5-11, R5-13, R5-15 |

## 5. Security, finance and data impact

- **Finance:** no change to how payments are applied. Permanent failures still never fulfil. Previously untracked money, such as a second captured payment or an unmatched event, is now recorded for finance.
- **Operational:** removes the risk that permanently failing events get the webhook disabled.
- **Security:** signature verification is unchanged. Responses and logs disclose less.
- **Data:** new server-written collection `webhookDeadLetters`; no migration; existing data untouched.

## 6. Limitations and residual risk

1. **5-second budget:** a slow Firestore transaction can exceed Razorpay's 5 s window. Razorpay then re-sends, and idempotency makes that safe, but sustained slowness looks like failures to Razorpay. Not load-tested.
2. **No proactive alerting** when records are created; Finance must check the API. A notification or Finance-screen badge is a follow-up.
3. **No automatic re-processing** of a dead-lettered event after a fix (for example, an intent written to the wrong database). Resolution is manual by design.
4. **Event-ID de-duplication** is not used for fulfilment; idempotency is per intent, which covers duplicates. Duplicate *orders* for one obligation, each with its own intent, are R4's scope.
5. Rules change **not deployed**: rules deploy only on push to `main`, and one deploy updates both databases.
6. No staging or browser verification; no independent QA yet.
7. Disable behaviour: the docs do not confirm whether one persistently failing event can disable the webhook. The design avoids relying on either answer.

## 7. Deployment status

Local only. Not deployed to staging or production.
