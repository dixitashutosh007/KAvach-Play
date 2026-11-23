# R4 — Razorpay Order Concurrency, Ambiguous Outcomes and Duplicate Payments: Architecture Design

**Status:** DESIGN ONLY, for independent-reviewer approval. Nothing is implemented. No application code, schema, rules, routes, tests or configuration changed.
**Branch / base:** `mig-mov` @ `e92c3fa`
**Date:** 2026-11-23

**Evidence base:**
- Experiment run `r4mwtfrkta4202`: `docs/qa/R4/evidence/R4_EXPERIMENT_RESULTS_AND_ANALYSIS.md`.
- Reviewer-approved delayed re-check: `docs/qa/R4/evidence/supplemental-e5-recheck/E5_RECHECK_RESULTS.md`.

---

## 0. Evidence that drives this design

| # | Fact (test mode, one run) | Source |
|---|---|---|
| F1 | Razorpay accepts duplicate `receipt` values sequentially and concurrently (E1: 2 orders, E2: 5/5, E4: 2) | E1/E2/E4 create responses; corroborated by re-check |
| F2 | Receipt-filtered listing is **eventually consistent**: 0 results about 20–24 s after creation, all 11 known orders visible about 5 min 40 s after. Upper bound unknown | E5 + re-check |
| F3 | **Orphan orders are real**: requests aborted client-side at 50 ms and 150 ms each created an order the caller never received | Re-check (E3-50, E3-150) |
| F4 | Live-mode behaviour, order fetch-by-id, payments-per-order and whether a paid order can take a second payment are **not verified** | §9, G1–G5 |

Design principle derived from F1–F3: **the gateway offers no idempotency and no prompt negative lookup.** Protection must come from (a) never creating a second order for an obligation while an earlier attempt's outcome is unknown, (b) never exposing more than one payable order per obligation, and (c) treating every successful payment as money that must be either applied exactly once **per obligation** or routed to review.

---

## 1. Current-state architecture (verified against code at `e92c3fa`)

### 1.1 Order creation: `app/api/razorpay/order/route.ts` `POST`

1. `requireAuth` (`:38`; revocation-checked since R1). `derivePayableAmount(db, uid, intentData)` (`:82` → `lib/razorpay-order.ts:1283`) computes the authoritative amount and `verifiedIntent.reservationKey` from `generateReservationKey()` (`lib/razorpay-order.ts:9`). It rejects match fees that are already `Paid`, `Waived`, `Not Playing` or abandoned **at order time only**.
2. `acquirePaymentReservation()` (`:100` → `lib/razorpay-order.ts:313`) runs a Firestore transaction on `paymentReservations/{reservationKey}`:
   - Paid → 409.
   - `reconciliation_required` or `reconciliation_failed` → blocked (`needsReconciliation`).
   - `active` / `activation_failed` with an `orderId`: if unexpired, reuse after `validateReservationForReuse()` (`:117`); if expired, reconcile.
   - `reserving` and unexpired: another user → conflict; same user → `isWaiting`.
   - **Otherwise (no doc, or an expired `reserving`) → take over** (`:436`): new random `reservationToken`, `fenceVersion + 1`, deterministic receipt `generateAuthoritativeReceipt()` (`:189`), status `reserving`, 60 s lease.
3. `isWaiting` (`:226`): polls 6 × 500 ms, then reuses, reconciles, re-acquires or returns 409.
4. Create path:
   - `razorpayIntents.add({... status: "pending"})` (`:484`, random ID).
   - `setReservationIntentId()` (`:496`; fenced) stores the intent ID **before** the gateway call.
   - Lease renewed every 5 s (`:514`) around `instance.orders.create({amount, currency, receipt, notes: {intentId, reservationKey}})` (`:531`).
   - If the lease is lost → 409 **without returning the order**.
   - Else `intentRef.update({orderId})` (`:548`), then `activatePaymentReservation()` (`:555` → `:516`; fenced; status `active`, 15 min expiry), then the order is returned to the browser.
   - **Persist-before-expose holds today.**
5. Failure handling (`:557–600`):
   - Order created but activation failed → `recordActivationFailure()` (`:557` lib).
   - Ambiguous gateway error (`isAmbiguousRazorpayError()`, `:1105`) → `recordReconciliationRequired()` (`:605` lib).
   - Definitive 4xx → `releasePaymentReservation()` (`:1070` lib).
6. `reconcileAmbiguousReservation()` (`:656`):
   - **Branch A** (`:698`, order ID known): `orders.fetch(orderId)` validates amount, currency and status, then reuses or marks paid. Fetch failure → `reconciliation_failed`.
   - **Branch B** (`:852`, receipt only): `orders.all({receipt})`. More than one order → `reconciliation_failed`. Exactly one → adopt. **Zero → `reconciliation_failed`, kept blocked** (`:1010`), which is correct given F2.
   - The doc comment at `:653` ("if confirmed no order … allowing safe new order creation") is **stale**.

### 1.2 Fulfilment: `lib/razorpay-webhook.ts` `processWebhookIntentTransaction` (`:235`), behind the R3/R5 route

- One Firestore transaction per event.
- Validates intent ↔ event (order ID, payment ID, amount, currency).
- **Idempotent per intent**: `intent.status === "paid"` → replay; a different `paymentId` on the same intent → `CONFLICTING_PAYMENT` → R5 dead-letter (`:263–275`).
- Fulfilment branches: `match` (`:419`), `finance_dues` (`:457`), `subscription` (`:516`), `merch_order` (`:569`). Then intent `paid`, and reservation `isPaid` (`:602`).
- **No branch checks the underlying obligation's state before applying.** Match and dues set `status: "Paid"` unconditionally and **overwrite** `razorpayPaymentId`. Late fees are written to `lf_${intentId}_…` (`:370`), so a different intent creates a **new** late-fee record. Subscriptions extend from the current expiry, so a second payment **extends again**.

### 1.3 R5

`webhookDeadLetters` plus `/api/finance/webhook-reconciliation` record unmatched and contradicting events and give Finance a one-time resolution. This covers a second payment on the **same intent**, not a payment on a **different intent for the same obligation**.

### 1.4 How duplicate payment can actually happen today (ranked by likelihood)

| Path | Mechanism | Needs a gateway race? |
|---|---|---|
| **D1 Request-shape keys** | `generateReservationKey()` hashes the *request*: `match:{matchId}:{paymentId}:{player}` versus `dues:{player}:{sorted items}`. The same match fee paid from the Match screen and inside a Dues bundle, or two different Dues bundles sharing an item, get **different reservations, so two payable orders exist at once**. Both can be paid, and the webhook applies both | **No** |
| **D2 Manual collection overlap** | Admin marks a fee `Paid` (cash/UPI) through client writes (e.g. `hooks/useStore.ts:2349`) while the player has an open Razorpay order. The player pays; the webhook overwrites the cash record | No |
| **D3 Waived / abandoned after order** | Match abandoned or fee waived after the order was exposed; the payer pays; the webhook marks a `Waived` obligation `Paid` | No |
| **D4 Takeover of an expired `reserving`** | An expired `reserving` lease is taken over **without reconciliation** (`lib/razorpay-order.ts:361–436`), even when `intentId` was set, which proves the old holder reached the gateway. A second order is created (F1). The first is an orphan (F3). The orphan was **never exposed**, so it is not payable through Checkout unless its ID leaks | Yes (rare) |
| **D5 Adopt-after-takeover mismatch** | Branch B adopts the single found order but keeps the *reservation's* `intentId`. After a takeover, that order's `notes.intentId` names the *old* intent, so a payment is dead-lettered and the obligation stays unpaid (money in review) | Yes (rare) |

**Also found (outside the brief, not reproduced):** subscription keys `sub:{uid}:{planId}` and merchandise keys `merch:{merchId}:{player}` have no period or order component. Once a reservation is marked paid, `acquirePaymentReservation()` returns "already paid" for the **next legitimate renewal or repeat purchase**. This is inferred from code and must be reproduced before acting (decision Q8).

---

## 2. Proposed state machine

Two coordinated entities:
- **Attempt**: one gateway `orders.create` call, at most once.
- **Obligation claim**: one per underlying obligation, coordinating which attempt may expose an order.

### 2.1 Attempt states (`paymentAttempts/{attemptId}`)

```
                 ┌──────────── definitive 4xx (no order possible) ─────────────► FAILED_NO_ORDER (terminal)
                 │
CLAIMED ──► CREATING ──► ORDER_RECEIVED ──► ACTIVE (exposed to payer) ──► PAID ──► (terminal)
   │           │              │                 │                          │
   │           │              └─ persist fails ─┴─► ACTIVATION_FAILED ─────┤ (order ID known; reuse after fetch-validate)
   │           │                                                           │
   │           ├── timeout / 5xx / network / lease lost / crash ──► OUTCOME_UNKNOWN
   │           │                                                     │
   │           │                                RECONCILING ◄────────┘ (worker or admin; fenced)
   │           │                                   │   │   │
   │           │      found exactly 1 (fetch-validated) │   └─ found >1 ──► ANOMALY_MULTIPLE ─► MANUAL_RESOLUTION
   │           │                                   ▼   └─ found 0 / lookup failed ──► OUTCOME_UNKNOWN (stays blocked)
   │           │                              RECOVERED ──► ACTIVE
   │           │
   └── superseded by an admin decision (Finance / Super Admin) ──► SUPERSEDED (terminal; obligation may open a new attempt)

PAID → a payment arriving for an obligation already settled by any means ──► DUPLICATE_PAYMENT ──► REFUND_REVIEW ──► MANUAL_RESOLUTION (terminal outcome recorded)
```

| State | Meaning | Allowed next | Forbidden |
|---|---|---|---|
| CLAIMED | Claims taken on all obligation keys; attempt ID and receipt allocated; not yet sent | CREATING; SUPERSEDED | Exposing anything |
| CREATING | `orders.create` in flight; lease held and renewed | ORDER_RECEIVED; OUTCOME_UNKNOWN; FAILED_NO_ORDER | **A second create for the same attempt**; **any new attempt on its obligations** |
| ORDER_RECEIVED | Response with `order.id` received in memory | ACTIVE (persist succeeded); ACTIVATION_FAILED | Returning the order before it is persisted |
| ACTIVATION_FAILED | Order ID known (persisted on the attempt by a fallback write) but claims not activated | ACTIVE via fetch-validate; MANUAL_RESOLUTION | A new attempt |
| ACTIVE | Order persisted on the attempt **and** claims; returned to payer | PAID; (expiry) RECONCILING via fetch-by-ID | A new attempt while the order may still be paid |
| OUTCOME_UNKNOWN | Create may or may not have produced an order; **ID unknown** | RECONCILING; SUPERSEDED (admin only) | **Automatic new attempt**; reading "lookup = 0" as absence |
| RECONCILING | Fenced lookup in progress | RECOVERED; OUTCOME_UNKNOWN; ANOMALY_MULTIPLE | Concurrent reconciliations (fenced) |
| RECOVERED | Order found and validated (amount, currency, `notes.attemptId`) | ACTIVE | – |
| ANOMALY_MULTIPLE | Lookup found more than one order for one attempt receipt (should be impossible; one create per attempt) | MANUAL_RESOLUTION | Auto-adopting any |
| PAID | Payment applied to all obligations of this attempt | (terminal) | Re-applying |
| DUPLICATE_PAYMENT | Payment captured but at least one obligation was already settled (by any method), waived or superseded | REFUND_REVIEW | Fulfilment |
| REFUND_REVIEW / MANUAL_RESOLUTION | Finance records an outcome via R5 | (terminal outcome) | Changing ledgers from the review record |
| SUPERSEDED | Admin authorised abandoning this attempt | (terminal) | Exposing its order later; its payments go to DUPLICATE_PAYMENT if obligations were meanwhile paid, else reviewed |
| FAILED_NO_ORDER | Definitive gateway rejection before creation | (terminal) | – |

### 2.2 Obligation claim states (`paymentObligationClaims/{obligationKey}`)

`OPEN → HELD(attemptId) → SETTLED(method, ref)`. While HELD, any request for this obligation (any request shape) is answered with the **holder's** order (if ACTIVE and same payer) or "payment in progress / needs review". It never creates a new attempt. SETTLED is mirrored from the obligation's own record, which stays the source of truth (§3.3).

### 2.3 Leases and concurrency rules

- **L1. A lease bounds who may *write*, never who may *create*.** Lease expiry in CREATING moves the attempt to OUTCOME_UNKNOWN (by the next reader, in a transaction), **never** to a takeover that creates a new order. This replaces today's takeover at `lib/razorpay-order.ts:436` for the case where the old holder may have called the gateway. That case is detected by attempt state ≥ CREATING, which is written **before** the call, and replaces today's `intentId`-set heuristic.
- **L2. Fencing:** every attempt and claim write checks `(attemptId, fenceVersion)`. A stale holder that later receives an order **cannot** activate. It records `orderIdLate` on its own attempt (allowed: the attempt row is its own) so the order becomes known, and reconciliation flips UNKNOWN → RECOVERED → ACTIVE if the attempt still holds the claims; otherwise → SUPERSEDED, recorded as unexposed.
- **L3. Concurrent requests, same user:** the second request sees HELD/CREATING. It waits briefly (as today) and then receives the ACTIVE order or "in progress"; it never creates.
- **L4. Concurrent requests, different sessions or devices of the same user:** same as L3. Claims are keyed by obligation, not by session.
- **L5. Concurrent requests, different users for the same obligation:** only the obligation's player may pay (unchanged `derivePayableAmount` ownership check), so there is no cross-user claim. A dues bundle never contains another player's obligations.
- **L6. Bundles:** a request claims **all** its obligation keys in one transaction (all or nothing). If any key is HELD by a different attempt, the request fails with a clear message naming the item. It does not partially create.

---

## 3. Proposed Firestore data model (minimum, server-only)

All new collections are **Admin-SDK only** (rules `allow read, write: if false`, except Finance/Super Admin read where noted). No existing collection's schema changes meaning.

### 3.1 `paymentAttempts/{attemptId}` (new)

| Field | Purpose |
|---|---|
| `attemptId` (doc ID: `att_` + 32 hex) | Identity; also the gateway **receipt** (≤ 40 chars) and in order `notes.attemptId` |
| `state`, `fenceVersion`, `leaseExpiresAt`, `heartbeatAt` | State machine and fencing |
| `userId`, `playerId`, `intentId`, `intentType` | Binding (the intent stays the webhook entry point) |
| `obligationKeys[]` | Canonical keys claimed (§3.3) |
| `amountPaise`, `currency` | Authoritative amounts |
| `createRequestedAt`, `createRespondedAt`, `gatewayOrderId`, `orderIdLate` | Gateway identity, including late recovery |
| `exposedAt` | First time the order was returned to a client (the "exposed" invariant) |
| `outcome: { kind: "order"|"definitive_reject"|"timeout"|"network"|"gateway_5xx"|"lease_lost"|"crash_detected", code }` | Why UNKNOWN or FAILED |
| `reconciliation: [{ at, by: "worker"|uid, method: "fetch_by_id"|"receipt_list"|"manual", result, count }]` (capped, last 20) | Reconciliation history |
| `paidPaymentId`, `paidAt` | Settlement |
| `resolution: { action, by, at, note }` | Manual outcome (supersede, attach order, close) |
| `legacyReservationKey` | Compatibility link to `paymentReservations` |

### 3.2 `paymentObligationClaims/{obligationKey}` (new)

`{ obligationKey, state: "open"|"held"|"settled", holderAttemptId, holderFence, settledBy: {method: "razorpay"|"manual"|"waived", ref}, updatedAt }`

### 3.3 Canonical obligation keys (source of truth for "settled" remains the existing records)

| Obligation | Key | Settled when (source of truth) |
|---|---|---|
| Match fee | `match:{matchId}:{paymentDocId}` | `matches/{m}/payments/{p}.status` ∈ {Paid, Waived} or match abandoned |
| Other fee | `fee:{playerId}:{feeId}` | `players/{p}/otherFees/{f}.status` = Paid |
| Late fee | `latefee:{playerId}:{matchId}:{templateId}` | a Paid late-fee record exists for that triple (see §8 on today's per-intent IDs) |
| Subscription period | `sub:{playerId}:{planId}:{baseExpiry}` (expiry date being extended from, or `none`) | the player's current expiry ≠ `baseExpiry`, i.e. already extended |
| Merchandise | `merch:{orderPayloadId}` | `merchOrders/{id}.paymentStatus` = Paid |

### 3.4 Changes to existing records (additive only)

- `razorpayIntents`: add `attemptId`, `obligationKeys[]`, and state value `paid_unapplied` (money received, not applied; points to its dead-letter record).
- `webhookDeadLetters` (R5): new reasons `DUPLICATE_OBLIGATION_PAYMENT`, `OBLIGATION_WAIVED`, `OBLIGATION_SETTLED_OTHERWISE`, `SUPERSEDED_ATTEMPT_PAID`, `ORPHAN_ORDER_PAID`; classification `duplicate_payment`; existing resolution `refund_initiated` reused. Records carry `attemptId` and `obligationKeys`.
- Audit: every manual action (supersede, attach order, resolve) writes `auditLogs` via `writeServerAudit()` in the same transaction, as R5 does.

---

## 4. API and webhook changes required

### 4.1 Order route (`app/api/razorpay/order/route.ts`)

1. Replace `acquirePaymentReservation` with `claimObligations(db, obligationKeys, attempt)`. One transaction:
   - read all claims;
   - any HELD by a live attempt → return its ACTIVE order (same payer, same amount, fetch-validated if older than its local TTL) or 409 "payment in progress";
   - any HELD by an UNKNOWN or ANOMALY attempt → 409 "payment being verified" (no create);
   - any SETTLED → 409 "already paid";
   - else create the attempt (CLAIMED) and set all claims HELD.
2. Write state CREATING **before** calling `orders.create` with `receipt = attemptId` and `notes = { intentId, attemptId }`. Renew the lease as today.
3. On response: **persist `gatewayOrderId` on the attempt first** (single-document write, retried), then activate the claims, then expose. If activation fails: ACTIVATION_FAILED (the order ID is already on the attempt).
4. On an ambiguous error, or a lost lease after the call was sent: OUTCOME_UNKNOWN. On a definitive 4xx before creation: FAILED_NO_ORDER and release the claims.
5. **Remove the takeover of expired `reserving`** (L1).
6. The payer-facing message for UNKNOWN is fixed text (Q5). No automatic retry.

### 4.2 Reconciliation (new `lib/payment-reconciliation.ts`; endpoint `/api/finance/payment-attempts`, Finance/Super Admin; optional scheduled worker)

- Order ID known (ACTIVATION_FAILED, ACTIVE past TTL, or `orderIdLate`): `orders.fetch(id)`. Validate amount, currency and `notes.attemptId`. This is today's Branch A, keyed by attempt. *Fetch-by-ID capability must be confirmed (G1).*
- Order ID unknown (OUTCOME_UNKNOWN): receipt lookup `orders.all({receipt: attemptId})` **only after a settle delay**. F2 shows < 25 s is unreliable; the proposed first lookup is ≥ 10 min after the attempt, then retried with back-off. 1 result → validate → RECOVERED → ACTIVE (exposable again to the same payer). More than 1 → ANOMALY_MULTIPLE. 0 → stays OUTCOME_UNKNOWN. **Zero is never treated as absence.**
- Manual actions (audited, one per attempt, fenced):
  - `attach_order` (Finance supplies an order ID seen in the Razorpay dashboard; the server fetch-validates it);
  - `supersede` (authorises a new attempt for the obligations; the old attempt can never be exposed);
  - `close` (obligation settled outside Razorpay).
- **Why `supersede` is financially safe:** an UNKNOWN attempt's order, if it exists, was never returned to any client, so a payer cannot pay it through Checkout. If it is somehow paid, §4.3 routes the money to review. The residual risk is therefore an *unexposed orphan being paid*, which needs a leaked order ID. It is bounded and detected, not silent.

### 4.3 Webhook (`lib/razorpay-webhook.ts` `processWebhookIntentTransaction`)

Inside the existing single transaction, **before any fulfilment write**:
1. Resolve the attempt (`notes.attemptId`, or the intent's `attemptId`) and its `obligationKeys`.
2. Read every obligation's source-of-truth record (§3.3); most are already read today for merge resolution.
3. **Already settled by anything other than this attempt** (Paid with a different `razorpayPaymentId`, manually Paid, Waived, match abandoned, subscription expiry ≠ `baseExpiry`, merch already Paid) **or attempt SUPERSEDED**:
   - apply **nothing**;
   - mark the intent `paid_unapplied` and the attempt DUPLICATE_PAYMENT;
   - record a dead-letter (`duplicate_payment`, reason as in §3.4);
   - acknowledge 200 (R5 pattern).
   **All or nothing for bundles** (Q1).
4. Otherwise apply as today. Then mark the claims SETTLED, the attempt PAID and the intent `paid`.
5. **Order identity recovery:** if the intent has no `orderId` but `notes.attemptId` and `notes.intentId` match the attempt and intent, and amount and currency match, **adopt** the order ID. This is safe: the notes were set server-side and the event is signature-verified. It fixes D5 and the "webhook before activation" case.
6. Late fees: write to the deterministic `latefee` identity, not `lf_${intentId}_…` (§8).

### 4.4 Manual (cash/UPI) collection

When an admin marks an obligation Paid while its claim is HELD by an ACTIVE attempt, the admin action should **warn** ("an online payment is open"). Either way, a later online payment goes to review per §4.3 (Q6). This requires routing manual Paid writes through a server endpoint, or a trigger, to update claims. Until then, the webhook-side check alone already prevents double application.

---

## 5. Failure-mode matrix

| Case | Expected state | Payer sees | Operational action | Financial risk after design |
|---|---|---|---|---|
| 1. Timeout **before** the request reaches the gateway | CREATING → OUTCOME_UNKNOWN (cannot be distinguished from case 2) | "We're confirming your payment setup; try again in a few minutes" | Worker lookup after the settle delay, then 0 results; Finance `supersede` if it persists | None: no order exists |
| 2. Timeout **after** the gateway created the order (F3) | OUTCOME_UNKNOWN → (lookup ≥ 10 min) RECOVERED → ACTIVE | Same message; on retry after recovery, the recovered order is returned | Usually automatic recovery; manual `attach_order` or `supersede` if the lookup keeps returning 0 | Orphan unexposed until recovered; no double charge |
| 3. Process crash before order-ID persistence | CREATING with expired lease → OUTCOME_UNKNOWN (set by the next reader) | As case 1 | As case 2 | As case 2 |
| 4. Lease expiry while the gateway request is in flight | Holder renews every 5 s; if renewal fails → OUTCOME_UNKNOWN. A late response is recorded as `orderIdLate` and **not exposed** | 409 "try again shortly" | Reconciliation adopts `orderIdLate` (fetch-validate) | No second order is created (L1) |
| 5. Concurrent requests, same user | One CREATING; others wait, then get the same ACTIVE order | One checkout | – | None |
| 6. Concurrent requests, different sessions | As case 5 (claims keyed by obligation) | One checkout | – | None |
| 7. Webhook before activation persistence | Only possible for orders not yet exposed; webhook adopts the order ID from notes (§4.3 step 5) and applies if the attempt holds the claims, else review | Paid | – | None |
| 8. Two orders both paid (D1/D4 legacy, a leaked orphan, or after supersede) | First applied → PAID; second → DUPLICATE_PAYMENT, dead-letter | First: paid. Second: "payment received, under review" (Q5) | Finance refunds via the Razorpay dashboard and records `refund_initiated` | **Money held until refunded; never double-applied** |
| 9. Duplicate webhook delivery | Intent `paid` → replay 200 (unchanged) | – | – | None |
| 10. Gateway lookup returns 0 | Stays OUTCOME_UNKNOWN; retry with back-off; never "absent" | "Being verified" | After the configured window, Finance decides (`supersede` or `attach_order`) | Obligation temporarily unpayable online (cash still possible) |
| 11. Gateway lookup returns more than 1 | ANOMALY_MULTIPLE (one create per attempt, so this indicates a bug or external creation) | "Being verified" | Finance investigates in the dashboard; `attach_order` for the right one; others are unexposed orphans | None applied automatically |
| 12. Reconciliation service or gateway unavailable | Attempt unchanged (UNKNOWN or ACTIVE); reconciliation history records a failure | "Being verified" | Worker retries; alert if the backlog grows | None |
| 13. Obligation waived or match abandoned after the order was exposed | Payment → DUPLICATE_PAYMENT (`OBLIGATION_WAIVED`) | Under review | Refund per abandoned-match policy | None applied |
| 14. Admin cash collection while an order is open | Webhook → DUPLICATE_PAYMENT (`OBLIGATION_SETTLED_OTHERWISE`) | Under review | Refund one of the two | None double-applied |
| 15. Overlapping bundles (D1) | Second request blocked at claim time (L6) | "This fee is already in another payment in progress" | – | Eliminated at source |

---

## 6. Security and financial invariants (each to be asserted by a test)

- **I1 No double application:** for every obligation key, at most one payment is ever applied, across all intents, attempts and methods.
- **I2 At most one exposed order per obligation at a time:** an order ID is returned to a client only if its attempt holds the claim on **every** obligation it covers, and is persisted first.
- **I3 No automatic create after unknown:** once an attempt reaches CREATING, no new attempt on its obligations is possible except via `supersede` by Finance or Super Admin (audited).
- **I4 Zero is not absence:** no transition is ever driven by a receipt lookup returning 0.
- **I5 Every captured payment is accounted for:** each signed captured payment ends as applied (PAID) or recorded (`webhookDeadLetters`); never dropped (R5 invariant extended).
- **I6 Fencing:** a stale attempt holder cannot change claims or expose orders.
- **I7 Server authority:** amounts, obligation keys and attempt identity are derived server-side; the client supplies only *which* obligations (unchanged FIN-001 rules). Claims and attempts are not client-writable.
- **I8 Audit:** every manual reconciliation or supersede action has an `auditLogs` entry written atomically.
- **I9 No secrets or PII:** attempts and dead-letters store identifiers only (R2-C/R5 standard).

---

## 7. Test strategy

| Layer | Scope | Examples |
|---|---|---|
| **Unit** (production imports, no I/O) | Pure functions | `obligationKeysFor(intent)` for every type, bundle overlap and canonical ordering; state-transition guard `canTransition(from, to, actor)` exhaustively (allowed and forbidden table §2.1); receipt and attempt-ID format ≤ 40 chars; dedupe decision `decideApplication(obligationsState, attempt)` |
| **Firestore transaction (emulator)** | Claims, attempts, fencing | Concurrent claim of the same and overlapping obligations (N parallel, exactly one HELD); lease expiry in CREATING → UNKNOWN, never a new attempt; stale holder `orderIdLate` cannot activate; `supersede` audited and once-only; reconciliation fenced against a concurrent request |
| **Webhook transaction (emulator)** | Obligation-level dedupe | Two intents and two orders for one match fee, both paid → one applied, one `DUPLICATE_PAYMENT`; dues bundle with one already-paid item → nothing applied (all or nothing); waived and abandoned → review; manual cash then online → review; subscription paid twice from the same `baseExpiry` → one extension; late fee by deterministic key not duplicated; webhook before activation adopts the order ID |
| **Route integration (emulator + gateway stub)** | `POST /api/razorpay/order`, webhook route, admin endpoints | Stub with controllable latency, timeout-after-create, timeout-before-create, lost response, 5xx, definitive 4xx, duplicate-receipt acceptance (F1), delayed list visibility (F2: 0 then N after a configurable delay), multiple matches. Each failure-mode row (§5) becomes one scenario asserting state, HTTP response, **number of stub orders created**, **number of orders exposed**, and ledger entries |
| **Gateway contract (stub conformance)** | Keep the stub honest | Stub behaviours pinned to recorded evidence: F1/F2/F3 from `r4mwtfrkta4202` + re-check. G1–G5 results added when run. A contract test fails if the stub drifts from recorded fixtures |
| **Regression** | Existing suites | All current emulator suites (403) and functional suites (1035) green; existing FIN-001 tamper and reservation scenarios ported, not deleted |

Determinism: injected clock and lease durations; the stub is driven by explicit `release()` handles, not real timers; each concurrency test is asserted over a fixed number of repetitions with a seed.

---

## 8. Migration and backward compatibility

- **Source of truth unchanged:** obligation records (payment docs, fee docs, merch orders, player expiry) keep meaning "paid". Claims and attempts are coordination data, so **no backfill is required for correctness**. A missing claim is OPEN, and the webhook check reads the source records directly.
- **In-flight legacy reservations** at deploy time: `paymentReservations` docs in `active` / `activation_failed` keep working through a compatibility read. A request whose obligation maps to a legacy reservation with an `orderId` reuses it (wrapped into a synthetic attempt). `reconciliation_required` / `reconciliation_failed` become OUTCOME_UNKNOWN attempts on first touch. A report lists them for Finance.
- **Legacy intents without `attemptId`:** the webhook falls back to the intent's `reservationKey` and its obligation fields to compute obligation keys. Dedupe still applies.
- **Late fees:** existing `lf_${intentId}_…` records stay. The dedupe check matches on `(playerId, matchId, templateId)` across both ID shapes. New writes use the deterministic key. No rename.
- **Receipts:** new attempts use `att_…`; legacy `rcpt_…` remain valid for fetch.
- **Rules:** add deny-all for `paymentAttempts` and `paymentObligationClaims` (Finance/Super Admin read for attempts). Rules deploy only via `main`, and one deploy covers both databases.
- **Reversibility:** each phase is behind a server flag (`R4_PHASE_n`), default off until verified. Turning a flag off returns to legacy behaviour except where data was written additively.

---

## 9. Open questions and decisions requiring owner (and reviewer) approval

| # | Decision | Recommendation |
|---|---|---|
| Q1 | Bundle where some items are already settled: apply none (send whole payment to review) or apply the unsettled items? | **Apply none**: simplest, auditable; Finance refunds or adjusts |
| Q2 | A second subscription payment from the same `baseExpiry`: duplicate (refund) or prepayment of the next period? | Duplicate → review, unless the owner prefers prepay |
| Q3 | After OUTCOME_UNKNOWN: manual `supersede` only (reviewer requirement) or allow automatic unblock after a quarantine window? | **Manual only** (meets the requirement); revisit after G5 data |
| Q4 | Settle delay before the first receipt lookup and the back-off schedule | First lookup ≥ 10 min, then 30 min, 2 h, 24 h; Finance alerted after 30 min |
| Q5 | Payer-facing wording for "being verified" and "payment received, under review" | Owner to approve copy |
| Q6 | Manual collection while an online order is open: block, warn, or allow and review? | **Warn and allow**; webhook routes any later online payment to review |
| Q7 | Refund execution: manual via the dashboard (today) or the Razorpay Refunds API? | Manual for R4; API is a separate scoped change |
| Q8 | Suspected defect: paid subscription and merch reservations block legitimate renewals and repeat purchases (§1.4) | Reproduce first; fix within R4 phase 2 via period- and order-scoped keys |
| Q9 | Who may `supersede` / `attach_order` | Finance Admin and Super Admin only |
| Q10 | Scheduled reconciliation worker (needs a scheduler) or admin-triggered only | Admin-triggered in R4; worker later |

**Gateway capability checks (each needs reviewer approval; test mode only):**
- **G1:** `GET /v1/orders/{id}`, i.e. fetch by ID, which Branch A already relies on (unverified).
- **G2:** `GET /v1/orders/{id}/payments`, payments per order.
- **G3:** whether a paid order can accept a second payment. This needs test-mode test-card payments.
- **G4:** time-window listing (`from`/`to`) as an alternative lookup, and its consistency.
- **G5:** distribution of the receipt-listing visibility lag (several samples).

**The design does not assume any of these:** it relies only on IDs we received and persisted, on webhook notes, and on manual resolution.

---

## 10. Phased implementation plan (proposed commits; each needs approval, tests first)

| Phase | Commit (proposed message) | Content | Closes |
|---|---|---|---|
| 1 | `payment: obligation-level deduplication in webhook fulfilment (R4-1)` | §4.3 steps 2–4 and 6 using legacy intents (obligation keys computed from intent fields); new dead-letter reasons; deterministic late-fee identity check; tests for D1/D2/D3/D4 double payments → exactly one application | **I1, I5** for every path, including legacy. Highest value; no change to order creation |
| 2 | `payment: obligation claims across request shapes (R4-2)` | `paymentObligationClaims`; order route claims all keys (L6); overlapping bundles blocked; legacy reservation compatibility read; Q8 fix if reproduced | D1 at source; **I2** |
| 3 | `payment: payment attempts and unknown-outcome state (R4-3)` | `paymentAttempts`; receipt = `attemptId`; CREATING before the call; persist order ID first; OUTCOME_UNKNOWN; **remove the expired-`reserving` takeover** | D4; **I3, I6** |
| 4 | `payment: order identity recovery from webhook notes (R4-4)` | §4.3 step 5 | D5; case 7 |
| 5 | `payment: finance reconciliation for payment attempts (R4-5)` | `lib/payment-reconciliation.ts`; `/api/finance/payment-attempts` (list, fetch-validate, `attach_order`, `supersede`, `close`; audited); settle-delay lookup (Q4) | Cases 1–4, 10–12; **I4, I8** |
| 6 | `docs: R4 design closure, stale reconciliation comment, runbook (R4-6)` | Fix the stale comment at `lib/razorpay-order.ts:653`; Finance runbook for refund review | – |
| 7 | `test: R4 regression and failure-mode suite (R4-7)` | Full §5 matrix through route integration + stub; contract fixtures from F1–F3 (+ G1–G5 when available) | Evidence for review |

Phase 1 is independent and closes double application for all known paths, including D1, D2 and D3, which need no gateway race. It is the proposed first implementation step once this design is approved.
