# R4 — Razorpay Order Concurrency, Ambiguous Outcomes and Duplicate Payments: Architecture Design (revision 3)

**Status:** DESIGN ONLY. Revision 3 resolves the five blocking findings (B1–B5) and six clarifications from the independent review of revision 2 (`f8b1f2e`). **Implementation approval is withheld; Phases 1A and 1B must not start until this revision is approved.** No application code, Firestore rules, schemas, routes, tests, configuration or deployment settings are changed by this document.
**Branch / base:** `mig-mov` @ `f8b1f2e`
**Date:** 2026-11-23

**Evidence base:**
- Run `r4mwtfrkta4202`: `docs/qa/R4/evidence/R4_EXPERIMENT_RESULTS_AND_ANALYSIS.md`.
- Delayed re-check: `docs/qa/R4/evidence/supplemental-e5-recheck/E5_RECHECK_RESULTS.md`.

**Reviewer-response table:** §12.

---

## 0. Evidence, principle and guarantees

| # | Fact (test mode, one run) | Source |
|---|---|---|
| F1 | Razorpay accepts duplicate `receipt` values sequentially and concurrently (E1: 2 orders, E2: 5/5, E4: 2) | Create responses + re-check |
| F2 | Receipt-filtered listing is eventually consistent: 0 at about 20–24 s; all 11 known orders at about 5 min 40 s. Upper bound unknown | E5 + re-check |
| F3 | Orphan orders are real (aborts at 50 ms and 150 ms each created an order) | Re-check |
| F4 | **Not verified:** live mode; fetch-by-ID; payments-per-order; multiple payments on one order; order cancellation or expiry; refund webhooks and partial refunds; which create errors prove non-creation | §10 G1–G7 |

**Principle.** The gateway offers no idempotency, no prompt negative lookup and (as far as verified) **no way to invalidate an order once created**. Firestore state cannot make a Razorpay order unpayable. The system **cannot prevent a payer from being charged more than once** in every case.

**Guarantees:**
- **G-A (application):** no more than one payment is ever applied to an obligation.
- **G-B (accounting):** every captured payment has exactly one immutable accounting record. Every payment that is not applied is classified and routed to review, and its refund lifecycle is tracked separately from its capture.
- **G-C (exposure):** at most one **exposed, possibly-payable** order exists per obligation, **except** after an explicit, recorded Finance override (`expose_replacement`, disabled by default), whose residual risk is documented in §2.4.
- **G-D (no automatic re-creation):** after an ambiguous attempt, a new order is never created automatically.

---

## 1. Current-state architecture (verified against code)

### 1.1 Order creation: `app/api/razorpay/order/route.ts` `POST`

1. `requireAuth` (`:38`). `derivePayableAmount()` (`:82` → `lib/razorpay-order.ts:1283`) computes the amount, **server-computed late fees** (`computeLateFees`, `lib/razorpay-order.ts:1347`) and `verifiedIntent.reservationKey` from `generateReservationKey()` (`lib/razorpay-order.ts:9`). It rejects already `Paid`, `Waived`, `Not Playing` or abandoned match fees **at order time only**.
2. `acquirePaymentReservation()` (`:100` → `lib/razorpay-order.ts:313`) runs a transaction on `paymentReservations/{reservationKey}`:
   - paid → 409;
   - `reconciliation_required` / `reconciliation_failed` → blocked;
   - `active` / `activation_failed` with an `orderId` → reuse (`validateReservationForReuse()`, `:117`) or reconcile;
   - unexpired `reserving` → wait or conflict;
   - **otherwise (no doc, or expired `reserving`) → takeover** (`:436`), with a deterministic receipt `generateAuthoritativeReceipt()` (`:189`).
3. `isWaiting` poll (`:226`).
4. Create:
   - `razorpayIntents.add` (`:484`);
   - `setReservationIntentId()` (`:496`);
   - lease renewal (`:514`) around `orders.create` (`:531`);
   - lease lost → 409 without exposure;
   - `intentRef.update({orderId})` (`:548`), `activatePaymentReservation()` (`:555`), then return the order. **Persist-before-expose holds today.**
5. Failures (`:557–600`): `recordActivationFailure()`, `recordReconciliationRequired()` via `isAmbiguousRazorpayError()` (`lib/razorpay-order.ts:1105`), `releasePaymentReservation()`.
6. `reconcileAmbiguousReservation()` (`:656`):
   - Branch A (`:698`): `orders.fetch`.
   - Branch B (`:852`): `orders.all({receipt})`. More than one → blocked; one → adopt; zero → blocked (`:1010`), which is correct per F2.
   - The doc comment at `:653` is stale.
   - **No resolution tool exists for `reconciliation_failed`.**

### 1.2 Online fulfilment: `lib/razorpay-webhook.ts` `processWebhookIntentTransaction` (`:235`)

- Validates intent ↔ event.
- Idempotent **per intent**: `intent.status === "paid"` → replay; a different `paymentId` → `CONFLICTING_PAYMENT` → R5 dead-letter written in a **separate** transaction by the route (`app/api/razorpay/webhook/route.ts:58`).
- Fulfilment: `match` (`:419`), `finance_dues` (`:457`), `subscription` (`:516`), `merch_order` (`:569`). Then intent `paid` and reservation `isPaid` (`:602`).
- **No obligation-state check.** Match and dues overwrite `razorpayPaymentId`. Late fees are keyed `lf_${intentId}_…` (`:370`), so another intent creates another Paid late fee. Subscriptions extend again.

### 1.3 Manual settlement: client-side today

| Obligation | Client write path | Rule |
|---|---|---|
| Match fee collect / mark Paid or Unpaid | `hooks/useStore.ts` `updatePaymentStatus` (≈`:1800–1830`) | Finance Admin unrestricted; Match Admin via `isMatchAdminPaymentUpdate` (`firestore.rules:279`: `Paid` with manual method) |
| Fee plan / override status | `applyFeePlanToPayment` (≈`:2155–2200`) | Finance Admin |
| Sponsorship (**two records**: sponsored fee → `Paid` + `sponsoredBy`; sponsor's fee → raised `feeOverride` + `sponsoring`), and its reversal | `assignProxyPayment` (≈`:2335–2365`) and the clear path (≈`:2225–2320`, `writeBatch`) | Finance Admin |
| Other fees | `players/{p}/otherFees` writes (≈`:1971–2055`) | Finance or Super Admin |
| Merchandise `paymentStatus` | `updateMerchOrder` (`:2765`) from `components/FinanceTab.tsx:362`, `components/ShopTab.tsx:769` | merchOrders admin update |
| Studio expiry | `components/StudioAdminTab.tsx:≈532`, `components/EditPlayerInline.tsx`, `addSubscriptionHistory` | Admin player update; Studio Admin history |

### 1.4 Duplicate-application paths today

| Path | Mechanism | Gateway race? |
|---|---|---|
| D1 | Request-shape reservation keys: Match screen vs Dues bundle, or overlapping bundles → two payable orders for one fee | No |
| D2 | Client-side manual settlement while an order is open | No |
| D3 | Waived, abandoned or sponsored obligation paid online | No |
| D4 | Expired `reserving` takeover without reconciliation (`lib/razorpay-order.ts:361–436`) → second order; orphan (F3) | Rare |
| D5 | Branch B adopts an order whose `notes.intentId` ≠ the reservation's intent → payment dead-lettered | Rare |

**Suspected (Q8, not reproduced):** `sub:{uid}:{planId}` and `merch:{merchId}:{player}` reservation keys may block legitimate renewals and repeat purchases.

---

## 2. Entities and state machines

**Four entities, kept strictly separate:**

| Entity | Role | Owns |
|---|---|---|
| **Obligation** | Authoritative financial state of one thing owed | Settlement state, `settlementVersion`, append-only settlement events |
| **Claim** | Coordination of online attempts for one obligation | Which attempt may expose an order; never financial truth |
| **Attempt** | One gateway `orders.create` (at most one call) | Order identity, exposure, its first applied payment |
| **Gateway payment** | One captured Razorpay payment | Capture identity, application outcome, refunds, anomalies |

**Ownership of duplicate-payment state (B2):** duplicate or rejected payments are owned **only** by their own `gatewayPayments` record (plus its dead-letter and events). Intents and attempts record their **first** outcome immutably and are never rewritten by later payments.

### 2.1 Obligation settlement states

| State | Meaning |
|---|---|
| `unpaid` | Owed, not settled |
| `settled_gateway` | Settled by an applied Razorpay payment (`gatewayPaymentId`) |
| `settled_manual` | Settled by cash or UPI collection |
| `sponsored` | Settled by sponsorship; linked to the sponsor's obligation |
| `waived` | No obligation (e.g. abandoned match, Option A) |
| `reversal_pending` | A gateway-settled obligation whose payment refund has been initiated for reversal (still settled; see §2.6) |

Legacy read mapping (no rewrite):
- `Paid` + `razorpay` → `settled_gateway`
- `Paid` + manual or `manualMethod` → `settled_manual`
- `Paid` + `sponsoredBy` → `sponsored`
- `Waived` or abandoned → `waived`
- `Unpaid` → `unpaid`

**Transitions** (each is one transaction that appends a settlement event and bumps `settlementVersion`):

| From → To | Trigger | Who |
|---|---|---|
| unpaid → settled_gateway | Webhook APPLY; `apply_reviewed_payment` | System; Finance / Super |
| unpaid → settled_manual | `settle_manual` | Finance / Super; Club (match fees only, Q11) |
| unpaid → sponsored | `mark_sponsored` | Finance / Super |
| unpaid → waived | `waive`; abandoned-match reconciliation | Finance / Super; system |
| settled_manual → unpaid | `reverse_manual_settlement` (§2.6) | Finance / Super |
| sponsored → unpaid | `reverse_sponsorship` (§2.6) | Finance / Super |
| waived → unpaid | `reverse_waiver` (§2.6) | Finance / Super |
| settled_gateway → reversal_pending | `initiate_gateway_reversal` (§2.6) | Finance / Super |
| reversal_pending → unpaid / waived | `complete_gateway_reversal` (requires completed full refund) | Finance / Super |
| reversal_pending → settled_gateway | `cancel_gateway_reversal` (refund failed or abandoned) | Finance / Super |
| **settled_gateway → unpaid directly** | **Forbidden** | – |

### 2.2 Claim states: `paymentObligationClaims/{cl_…}`

| State | Meaning |
|---|---|
| `open` | No live attempt |
| `held` | `holderAttemptId` is in CLAIMED, CREATING, ORDER_RECEIVED, ACTIVATION_FAILED, ACTIVE, OUTCOME_UNKNOWN, RECONCILING or RECOVERED |
| `retained_exposed` | **(B1)** Holder attempt is RETIRED: its order was exposed and may still be payable. **No new attempt may expose an order** while in this state, except via `expose_replacement` (Finance override) |
| `settled` | Obligation settled; mirrors the obligation record |

**Release rules:** a claim returns to `open` only from `held`, when the holder becomes FAILED_NO_ORDER or SUPERSEDED (never exposed), or after a reversal that makes the obligation `unpaid`. **A claim never goes from `retained_exposed` to `open`** except via `expose_replacement` (§2.4) or a verified "order no longer payable" condition (requires G7; unavailable until verified).

### 2.3 Attempt states: `paymentAttempts/{att_…}`

```
CLAIMED ─► CREATING ─┬─► ORDER_RECEIVED ─► ACTIVE (exposed) ─┬─► PAID (terminal)
                     │        └─► ACTIVATION_FAILED ─(revalidate)─┤
                     ├─► FAILED_NO_ORDER (terminal; definitive only)  ├─► CLOSED_UNAPPLIED (terminal)
                     └─► OUTCOME_UNKNOWN ─► RECONCILING ─┬─► RECOVERED ─(revalidate)─► ACTIVE
                                 ▲                       ├─► OUTCOME_UNKNOWN
                                 └───────────────────────┘└─► ANOMALY_MULTIPLE ─► (Finance)
Never-exposed attempt (CLAIMED/CREATING/UNKNOWN/RECONCILING/RECOVERED/ACTIVATION_FAILED/ANOMALY) ─(Finance)─► SUPERSEDED (terminal)
Exposed attempt (ACTIVE) ─(Finance retire, or manual settlement acknowledged)─► RETIRED (claim → retained_exposed)
```

**Outcome classification for `orders.create`:**

| Outcome | State |
|---|---|
| 2xx with a valid `order.id` | ORDER_RECEIVED |
| Complete HTTP 400 `BAD_REQUEST_ERROR` validation body, or complete HTTP 401 auth-failure body (**pending G6**; no other code qualifies) | FAILED_NO_ORDER |
| 408, 409, 429, 5xx, timeout, reset, TLS or proxy error, partial or unparsable body, 2xx without a valid order, crash, lease lost after send, **anything unclassified** | OUTCOME_UNKNOWN |

**Terminal states:** PAID, CLOSED_UNAPPLIED, FAILED_NO_ORDER, SUPERSEDED. **A terminal attempt never changes state.** Later payments touching it are recorded only on `gatewayPayments` and as appended attempt events (B2).

| From | Allowed | Forbidden |
|---|---|---|
| CLAIMED, CREATING | per diagram; SUPERSEDED (Finance) | second create; new attempt on its obligations |
| ORDER_RECEIVED | ACTIVE, ACTIVATION_FAILED | exposure before persistence |
| ACTIVE | PAID (first payment applied); CLOSED_UNAPPLIED (first payment rejected); RETIRED | **SUPERSEDED** (exposed attempts are retired, not superseded) |
| RETIRED | PAID (a payment applied via `apply_reviewed_payment` only); CLOSED_UNAPPLIED (first payment rejected) | Re-exposure; claim release |
| OUTCOME_UNKNOWN | RECONCILING; SUPERSEDED (Finance) | automatic new attempt; any transition driven by "0 found" |
| RECOVERED | ACTIVE only via revalidation (§2.3.1); SUPERSEDED | exposure before revalidation |
| PAID, CLOSED_UNAPPLIED, FAILED_NO_ORDER, SUPERSEDED | none | **any** (including PAID → DUPLICATE) |

#### 2.3.1 Revalidation before (re-)exposure

RECOVERED or ACTIVATION_FAILED → ACTIVE happens in one transaction checking:
1. every claim is `held` by this attempt at its fence;
2. every obligation is `unpaid` at the expected `settlementVersion`;
3. the payer binding is unchanged (`userId`, player not merged or disabled, obligation owned by that player);
4. the amount equals a fresh `derivePayableAmount()`, and the currency matches;
5. the order fetched by ID (G1) has matching amount, currency and `notes.attemptId`, and status `created` or `attempted`.

Any failure → the attempt stays non-exposed and goes to Finance (`supersede` or `attach_order`).

### 2.4 Supersede vs retire (B1)

| Situation | Behaviour |
|---|---|
| **Superseded before any order was received or exposed** (CLAIMED, CREATING, OUTCOME_UNKNOWN, RECONCILING, RECOVERED, ACTIVATION_FAILED, ANOMALY_MULTIPLE; `exposedAt` unset) | `supersede` (Finance or Super, audited): attempt → SUPERSEDED, fence +1, claim → `open`. A new attempt may then expose a new order. Residual risk: an order may exist (F3) but was **never returned to any client**, so paying it requires a leaked order ID |
| **Late gateway response after supersede** | The fenced activation write fails. A record-only write `orderIdLate` + `order_late` event is allowed on the SUPERSEDED attempt, plus `gatewayOrders/{orderId}` `create()` linking to it. The stale request gets 409. **Never exposed** |
| **Order already exposed** (ACTIVE, `exposedAt` set) | Cannot be superseded. Finance may **retire** it (`retire_exposed`): attempt → RETIRED, claim → **`retained_exposed`** (not released). The order remains payable at Razorpay; the system cannot invalidate it (F4) |
| **New online payment requested while an exposed order may be payable** | Claim `held` by ACTIVE → return **the same order** after revalidation (§2.3.1). If revalidation fails (e.g. amount changed) → 409 "needs admin attention"; **no new order**. Claim `retained_exposed` → 409 "online payment unavailable for this item; contact the club" (cash path below remains) |
| **Payment arrives against a retired or superseded attempt's order** | Decision rule R5 → `REJECT_DUPLICATE` (`ATTEMPT_RETIRED` / `ATTEMPT_SUPERSEDED`). The payment is recorded as `rejected_duplicate` and goes to review. Finance may then apply it (`apply_reviewed_payment`, §4.6) if the obligation is still unpaid, or refund it |
| **Allowing a second exposed order** (e.g. the payer lost the first, fee changed) | Only via **`expose_replacement`** (Finance or Super; **disabled by default, Q13**). Requires a written reason and an acknowledgement that *two payable orders will exist*. Claim → `held` by the new attempt; the old attempt stays RETIRED with a `replacedBy` event. **Residual risk:** both orders payable; any second payment → `rejected_duplicate` → refund review (G-A still holds; G-C explicitly waived for that obligation, recorded) |
| **Manual settlement while an order is exposed** | Only with `acknowledgeOpenOnlinePayment` (Q6): attempt → RETIRED, claim → `retained_exposed`, then settled. Any later online payment → `rejected_duplicate` → refund review |

**Default policy:** once an order has been exposed, the obligation **never** gets a second exposed order without Finance's explicit `expose_replacement`. Revision 2's claim that superseding released the claim is withdrawn.

### 2.5 Gateway payment: `gatewayPayments/{paymentId}` and refunds

**Immutable identity** (set at creation, never changed): `paymentId`, `orderId`, `amountPaise`, `currency`, `intentId` (if bound), `attemptId` (if bound), `capturedAt`, `firstEventId`.

**Application** (set once at creation; changed only by explicit Finance actions recorded as events):

| Value | Meaning |
|---|---|
| `applied` | To obligation keys K (by system or Finance) |
| `rejected_duplicate` | Bound to a known intent or attempt, but not applied (reasons) |
| `unmatched` | Signed captured payment that cannot be bound to a known intent or attempt, or contradicts it (§4.3) |
| `reversed` | Previously applied; full refund completed and the obligation reversed (§2.6) |

**Refunds (multiple and partial supported, clarification 4):**
- Append-only rows `gatewayPayments/{paymentId}/refunds/{refundId}`: `{ refundId, amountPaise, state: initiated|processed|failed, initiatedBy, initiatedAt, processedAt, failureCode, evidence: {source: "refund_webhook"|"finance_dashboard_record", ref} }`.
- Summary fields on the payment, recomputed in the same transaction as any refund-row change: `refundInitiatedPaise`, `refundProcessedPaise`, `refundStatus` ∈ `not_required | required | partially_refunded | refunded | intervention_required`.
- Invariant: `refundProcessedPaise ≤ amountPaise`; the sum of non-failed refund rows ≤ `amountPaise`.
- `processed` requires a signed `refund.processed` webhook for that refund ID **or** a Finance record with dashboard evidence. Both depend on **G5**; until G5 is verified, only the Finance-recorded path is enabled.
- **A dead-letter, or its `refund_initiated` resolution, never marks a refund processed.**

**Anomalies (B5):** append-only `gatewayPayments/{paymentId}/anomalies/{anomalyId}`.

### 2.6 Reversal workflows (B3)

All reversals are Finance or Super Admin only, require a `reason`, run as one transaction, **never delete or overwrite** the original settlement event or payment record, and append compensating events.

| Workflow | Preconditions | Transaction write set | Result |
|---|---|---|---|
| **R-M Reverse erroneous manual settlement** (`reverse_manual_settlement`) | Obligation `settled_manual` at the expected version; claim `settled` | Obligation → `unpaid` (`settlementVersion` +1; legacy `status: "Unpaid"`; manual fields moved to `settlement.history`); settlement event `manual_settlement_reversed` referencing the original event ID; claim → `open`; `auditLogs` | Obligation owed again. Cash handling (returned or re-booked) is recorded in the reason; no money system is changed |
| **R-G Reverse a gateway-settled obligation** (two steps) | `initiate_gateway_reversal`: obligation `settled_gateway`, payment `applied`, at least one refund row `initiated` for that payment | Step 1: obligation → `reversal_pending` (still settled; **not** payable online; claim stays `settled`); payment event `reversal_initiated`; audit | Obligation not unpaid while the payment is applied |
| | `complete_gateway_reversal`: payment `refundProcessedPaise == amountPaise` (full refund **processed**, with evidence) | Step 2: payment application → `reversed` (event, original `applied` preserved in events); obligation → `unpaid` **or** `waived` (Finance chooses, with reason); settlement event `gateway_settlement_reversed`; claim → `open` (unpaid) or `settled` (waived); audit | – |
| | `cancel_gateway_reversal`: refund failed or abandoned | obligation → `settled_gateway`; events; audit | Partial refunds **do not** unsettle (Q14) |
| **R-S Reverse sponsorship** (`reverse_sponsorship`) | Sponsored obligation `sponsored` at version; **sponsor's linked obligation `unpaid`** at its version (the extra amount is not yet collected) | Both records in one transaction: sponsored → `unpaid` (`sponsoredBy` cleared; history kept); sponsor's `feeOverride` and `sponsoring` restored; two settlement events cross-referencing each other; claims → `open`; audit | If the sponsor's obligation is already settled → **409**; requires a Finance adjustment (credit or refund) outside R4 scope (Q15) |
| **R-W Reverse a waiver** (`reverse_waiver`) | Obligation `waived` at version; if waived by abandonment, the match must no longer be abandoned (`abandoned` cleared by an admin first) | Obligation → `unpaid`; settlement event `waiver_reversed`; claim → `open`; audit | Payments earlier rejected because the obligation was waived stay in review; Finance may then use `apply_reviewed_payment` |

**Removed from revision 2:** the generic `revert_to_unpaid`.

---

## 3. Data model and deterministic identifiers

**Server-only:**
- `paymentAttempts`, `…/events`, `paymentObligationClaims`, `gatewayOrders`, `gatewayPayments`, `…/refunds`, `…/anomalies`, `lateFeeObligations` (see §3.3), and obligation `settlementEvents`: `allow write: if false`.
- Read: Finance or Super Admin for attempts, events, gatewayPayments (and subcollections) and settlement events. Claims and gatewayOrders are deny-all.
- The player's own late-fee and other-fee **display** continues via existing `otherFees` reads.
- **No client-writable attempt, claim, payment or settlement data** (I7).

### 3.1 Canonical keys and IDs

- **Canonical key:** segments joined by `|`. Each segment must match `^[A-Za-z0-9_\-]{1,128}$`; otherwise it is encoded as `b64:` + base64url(UTF-8).
- **Doc IDs:** `prefix_` + base64url(SHA-256(canonicalKey)), with prefixes `cl_` (claim) and `lfo_` (late-fee obligation). IDs are path-safe and fixed length. The stored `canonicalKey` is compared on every read, so a hash collision is detected (→ anomaly, fail closed).

| Obligation | Canonical key | Obligation record |
|---|---|---|
| Match fee | `match|{matchId}|{paymentDocId}` | `matches/{m}/payments/{p}` |
| Other fee | `fee|{playerId}|{feeId}` | `players/{p}/otherFees/{f}` |
| Late fee | `latefee|{playerId}|{matchId}|{templateId}` | **`lateFeeObligations/{lfo_…}`** (new; §3.3) |
| Subscription period | `sub|{playerId}|{planId}|{periodStart}` | `subscriptionPeriods/{sp_…}` *(see §3.4)* |
| Merchandise | `merch|{merchOrderId}` | `merchOrders/{id}` |

### 3.2 Attempts, claims, orders, payments

| Record | Key fields | Uniqueness |
|---|---|---|
| `paymentAttempts/{att_<32hex>}` | `state` (§2.3), `fenceVersion`, lease, `userId`, `playerId`, `intentId`, `obligationKeys[]`, `claimIds[]`, `amountPaise`, `currency`, `gatewayOrderId`, `orderIdLate`, `exposedAt`, `outcome`, **`firstPaymentId`** (immutable once set), `legacyReservationKey`; append-only `events/{id}` | One gateway create per attempt (CREATING entered once, fenced); `attemptId` = receipt = `notes.attemptId` |
| `paymentObligationClaims/{cl_…}` | `canonicalKey`, `state` (§2.2), `holderAttemptId`, `holderFence`, `settledBy` | At most one holder per obligation (compare-and-set on `holderFence`) |
| `gatewayOrders/{orderId}` | `attemptId`, `intentId` | `create()`: one attempt per gateway order ID |
| `gatewayPayments/{paymentId}` | §2.5 | `create()`: one accounting record per gateway payment ID |
| Attempt ↔ obligation | `attempt.obligationKeys` (immutable after CLAIMED) and `claim.holderAttemptId` | An obligation is held by at most one attempt; an attempt's obligation set never changes |

### 3.3 Late-fee obligation record (B4)

- **`lateFeeObligations/{lfo_…}`**: the authoritative late-fee obligation.
  - Fields: `canonicalKey`, `playerId`, `matchId`, `templateId`, `amountPaise` (server-computed via `computeLateFees` at levy time), settlement block and `settlementVersion`, `settlementEvents`, `createdAt`, `legacyFeeDocIds[]`.
  - **Created** idempotently (`create()`, or a read-then-set inside the claim transaction) by the server when a late fee is first levied for that triple: at order claim time (from `derivePayableAmount`), or by Finance.
- **Claim:** a separate `paymentObligationClaims/{cl_…}` document for the same canonical key (coordination only).
- **Player display (compatibility):** on settlement, the server also writes a **mirror** `players/{p}/otherFees/{lfo_…}` (same deterministic ID) so existing screens keep working. The mirror is not authoritative.
- **Legacy `lf_${intentId}_…` records:**
  - A one-time **dry-run-first backfill** (owner-approved before any production write) resolves each legacy record's `(playerId, matchId, templateId)` through its intent (`intentId` is in the doc ID; the intent holds `matchId`).
  - It then creates or updates the `lfo_` obligation as `settled_gateway`, with `legacyFeeDocIds` recording the legacy IDs. Legacy docs are not renamed or deleted.
  - Records whose intent cannot be resolved are reported, not guessed.
  - **Until the backfill has run**, the webhook decision looks up legacy records for the same player and template within the bounded read set. If any legacy Paid record for that template might belong to the same match and cannot be resolved, the decision is **conservative**: `REJECT_DUPLICATE` (`LEGACY_LATE_FEE_AMBIGUOUS`) → review. It never applies twice.
- **Uniqueness:** one `lfo_` per canonical key (deterministic ID).
- **Rollback:** `lfo_` records and mirrors stay valid Paid fees for the UI. Legacy code paths that write `lf_${intentId}` are removed in Phase 1A, and the decision remains non-flaggable (§8).

### 3.4 Subscription and merchandise identity (clarification 3)

- **Subscription periods:** `subscriptionPeriods/{sp_…}`, canonical `sub|{playerId}|{planId}|{periodStart}`.
  - `periodStart` = the player's current expiry date if in the future, else the purchase date (server-computed at claim time).
  - Each renewal is a **new** period, so legitimate renewals are never blocked.
  - Two payments for the **same** period: one applies (extends the expiry and records the period settled); the other → `rejected_duplicate` (`SUBSCRIPTION_PERIOD_ALREADY_SETTLED`) → review. Prepaying the next period is a new claim after the current one settles (Q2).
  - The player's `studioExpiryDate` remains the displayed value; the period records are authoritative for "already paid".
- **Merchandise:** each purchase gets a **server-minted** `merchOrders/{id}` before order creation; the client no longer supplies `orderPayload.id`. Canonical `merch|{merchOrderId}`. Repeat purchases are new orders and are never blocked; a duplicate payment for the same merch order → review.
- The legacy request-shape reservation keys (`sub:{uid}:{planId}`, `merch:{merchId}:{player}`) stop being used for blocking in Phase 2. This resolves Q8 without relying on them.

### 3.5 Firestore transaction constraints and maximum bundle size (clarification 5)

- **Design limit: at most 20 obligations per payment** (`MAX_BUNDLE_OBLIGATIONS = 20`). Larger dues lists are split into several payments by the UI. Owner to confirm against real data (Q16).
- **Worst-case transaction footprint (webhook APPLY, 20 obligations):**
  - **reads:** intent 1, attempt 1, `gatewayPayments` 1, `gatewayOrders` 1, per obligation: record + claim + (late fee: up to 3 legacy candidates) ≈ 2–5 → **≤ 105 document reads**, plus bounded legacy-candidate queries;
  - **writes:** per obligation: record + claim + settlement event (+ mirror) ≈ 3–4, plus about 8 fixed → **≤ 90 writes**.
- These are deliberately far below Firestore's per-transaction and per-request limits. **Exact current platform limits were not re-verified in this design task;** the implementation must assert the computed footprint in tests and fail closed above it.
- All reads complete before any write (Admin SDK transaction requirement). Contention is per obligation, so different players do not contend.

---

## 4. Transactions, API and webhook behaviour

### 4.1 Order route: claim and create

1. `claimObligations` (one transaction; reads all claims and obligation records):
   - any settled → 409;
   - any `retained_exposed` → 409 "online payment unavailable; contact the club";
   - any `held` by an ACTIVE attempt (same payer) → return that order after revalidation (§2.3.1) or 409;
   - any `held` in another state → 409 "being verified";
   - any `reversal_pending` → 409;
   - else create the attempt (CLAIMED) and set all claims `held`.
   **All or nothing; at most 20 obligations.** Late-fee obligations are created here (§3.3). Subscription periods and merch orders are minted here.
2. CREATING written **before** `orders.create({receipt: attemptId, notes: {intentId, attemptId}})`; the lease is renewed.
3. Response: persist `gatewayOrderId` (attempt + `gatewayOrders` `create()`); activate; set `exposedAt`; return the order.
4. Outcome classification as in §2.3. **The expired-`reserving` takeover is removed.**

Rules L1–L6 from revision 2 are unchanged:
- **L1:** a lease bounds who may write, never who may create.
- **L2:** all writes are fenced.
- **L3/L4:** same user or other sessions get the holder's order.
- **L5:** only the owning player may pay.
- **L6:** bundles are all-or-nothing.

### 4.2 `decidePaymentApplication(attempt, obligations, paymentEvent)` (pure)

**Inputs:** read in the webhook transaction **before any write**: intent, attempt (or a legacy synthetic attempt), every obligation record + claim (+ legacy late-fee candidates), existing `gatewayPayments/{paymentId}`, `gatewayOrders/{orderId}`, and the validated event.

| Rule | Condition | Decision |
|---|---|---|
| R1 | `gatewayPayments/{paymentId}` exists and its **immutable identity matches** (`paymentId`, `orderId`, `amountPaise`, `currency`, and `intentId` / `attemptId` where both sides have them) | `REPLAY` |
| R2 | `gatewayPayments/{paymentId}` exists and **any identity field conflicts** | `IDENTITY_CONFLICT` (B5) |
| R3 | No usable binding: unknown intent or attempt, missing intent ID, or event contradicts intent or attempt (order ID, amount, currency mismatch) | `REJECT_INVALID` (→ `unmatched`, §4.3) |
| R4 | Attempt already has a `firstPaymentId` (PAID or CLOSED_UNAPPLIED), or intent already `paid` / `paid_unapplied` with a different payment | `REJECT_DUPLICATE` (`ADDITIONAL_PAYMENT_FOR_ATTEMPT`) |
| R5 | Attempt SUPERSEDED, RETIRED or FAILED_NO_ORDER | `REJECT_DUPLICATE` (`ATTEMPT_SUPERSEDED` / `ATTEMPT_RETIRED`) |
| R6 | **Any** obligation not `unpaid` (`settled_gateway`, `settled_manual`, `sponsored`, `waived`, `reversal_pending`), or its claim held by another attempt or `retained_exposed` by another attempt, or a legacy late-fee ambiguity | `REJECT_DUPLICATE` (per-obligation reasons) |
| R7 | Otherwise | `APPLY` |

**Bundles are all-or-nothing:** one settled obligation in a bundle → the whole payment is REJECT_DUPLICATE.

### 4.3 Webhook transaction write sets (single transaction; 2xx only after commit; 503 on failure)

| Decision | Writes |
|---|---|
| **REPLAY** | **None.** Respond 200 `already_processed` |
| **IDENTITY_CONFLICT** (B5) | `gatewayPayments/{paymentId}` **unchanged**; `anomalies/{an_<sha256(event identity)>}` `create()` (idempotent per distinct conflicting identity: event ID, incoming order ID, amount, currency, intent, attempt; reason; first-seen time; delivery count is updated only on the anomaly row); dead-letter `webhookDeadLetters/{anom_<paymentId>_<hash>}` (classification `identity_conflict`, severity high); event on the bound attempt if any. **No obligation, claim, intent or attempt state change.** Respond **200** `recorded_for_investigation` after commit, so the conflict is durably recorded and flagged and never applied; retrying cannot resolve it (R3/R5 pattern). Store write fails → **503** |
| **REJECT_INVALID** (clarification 2) | If the event carries a usable `paymentId` (`pay_…`): `gatewayPayments/{paymentId}` `create()` with application **`unmatched`** (reason, any partial binding), refund `required`; dead-letter (`unmatched` / `mismatch`); event on a bound attempt if one exists (state unchanged). If there is **no usable payment ID**: dead-letter only (no accounting identity possible). **No obligation, claim, intent or attempt state change.** 200 after commit. *A payment is `unmatched` when it is a signed captured payment that cannot be bound to a known intent or attempt, or contradicts the bound intent or attempt* |
| **REJECT_DUPLICATE** (B2) | `gatewayPayments/{paymentId}` `create()` with application **`rejected_duplicate`** (reasons, bound intent and attempt), refund `required`; dead-letter (`duplicate_payment`); **append** an attempt event `additional_payment_rejected`. **If and only if** the attempt has no `firstPaymentId` (it was ACTIVE or RETIRED and this is its first captured payment): attempt → `CLOSED_UNAPPLIED`, `firstPaymentId` = this payment; intent `pending` → `paid_unapplied`. **Otherwise (already PAID / CLOSED_UNAPPLIED): intent and attempt state untouched.** No obligation or claim writes. 200 after commit |
| **APPLY** | Every obligation → `settled_gateway` (`settlementVersion` +1, settlement event, legacy fields); every claim → `settled`; `gatewayPayments/{paymentId}` `create()` `applied`, refund `not_required`; `gatewayOrders/{orderId}` `create()` if not present (identity recovery, §4.4); attempt → PAID, `firstPaymentId`; intent → `paid`; attempt event; side effects (late-fee mirror at the deterministic ID, subscription period settled + expiry extended, merch order Paid). 200 after commit |

**Concurrency:** two deliveries of the same payment race on `gatewayPayments/{paymentId}` `create()`. Firestore aborts one; it retries and re-runs the decision → R1 REPLAY. Two different payments for one obligation race on the obligation record and claim → one APPLY, one REJECT_DUPLICATE.

### 4.4 Order identity recovery (webhook)

If the attempt lacks `gatewayOrderId`, and `notes.attemptId` / `notes.intentId` match and amount and currency match, the order ID is adopted via `gatewayOrders/{orderId}` `create()` **before** the decision. A conflicting existing link → IDENTITY_CONFLICT handling.

### 4.5 Manual settlement endpoint: `/api/finance/settlements` (Phase 1B)

**One transaction per action.** Reads the obligation record(s), claim(s), any holder attempt, and `expectedSettlementVersion`.

**Preconditions:**
- version match, else 409;
- claim `held` by OUTCOME_UNKNOWN, RECONCILING, RECOVERED or ANOMALY → 409;
- claim `held` by ACTIVE → 409 unless `acknowledgeOpenOnlinePayment` (→ attempt RETIRED, claim `retained_exposed`).

**Writes:** obligation state per §2.1/§2.6, `settlementVersion` +1, settlement event, claim update, `auditLogs`.

**Actions:** `settle_manual`, `mark_sponsored`, `waive`, `reverse_manual_settlement`, `reverse_sponsorship`, `reverse_waiver`, `apply_fee_plan_status`, `set_merch_payment_status`, `set_studio_period` (manual subscription period settled). Gateway reversal actions live on the payment endpoint (§4.6).

**Coordination:** the webhook (§4.3) and this endpoint read and conditionally write the **same obligation record and claim** in Firestore transactions, so conflicting updates serialise. **No trigger is used for concurrency control.**

**Rules lockdown and client switch-over:**
- Client write access to settlement fields is removed: match payment `status` into or out of Paid/Waived, `paymentMethod`, `manualMethod`, `manualBy`, `feeCollectedAmount`, `sponsoredBy`, `sponsoring`, the settlement-affecting `feeOverride` change of sponsorship, and `settlement*`; otherFees `status`; merchOrders `paymentStatus`; player `studioExpiryDate`, `studioEndDate`, `isStudioMember`.
- Client callers switch to this endpoint.
- Deploy order: endpoint → clients → rules (§8).

### 4.6 Payment-attempt and payment endpoint: `/api/finance/payment-attempts` (Phase 5; some actions earlier)

**Attempt actions** (all one transaction, fenced, audited, appending events):
- `reconcile`: fetch-by-ID if the order ID is known; receipt lookup after the settle delay otherwise; never treats 0 as absence.
- `attach_order`: fetch-validate, then `gatewayOrders` `create()`.
- `supersede`: never-exposed attempts only.
- `retire_exposed`.
- `expose_replacement`: disabled by default; Q13.

**Payment actions:**

1. **`apply_reviewed_payment {paymentId}`** (clarification 1):
   - **Reads:** payment, its bound attempt, every target obligation + claim, and every attempt currently holding those claims.
   - **Preconditions:**
     - payment application ∈ {`rejected_duplicate`, `unmatched`};
     - refund state `required` with **no** initiated refund;
     - every obligation `unpaid` at the expected version;
     - each claim is `open`, or held or retained by the payment's own attempt, or held or retained by a **non-exposing** attempt (SUPERSEDED, CLOSED_UNAPPLIED, RETIRED).
     - If any claim is held by a **different ACTIVE attempt** (another exposed order), the request must include `retireConflictingAttempt: true`, which retires that attempt (claim then **settled**, not left held). Its order stays payable at Razorpay; any later payment goes to review.
   - **Writes:** obligations → `settled_gateway` (payment ID); **every claim → `settled`** (no stale held claim remains); payment application → `applied` (by Finance; original classification preserved in events); refund → `not_required`; the payment's attempt, **if it has no `firstPaymentId`**, → PAID with `firstPaymentId`, else events only; conflicting ACTIVE attempts → RETIRED (event); intent → `paid` only if it was `pending` (else events only); audit.
2. **Refunds:** `record_refund_initiated {paymentId, refundId, amountPaise}`, `record_refund_outcome {refundId, processed|failed, evidence}`. These maintain the §2.5 summary and invariants; the refund webhook path is enabled after G5.
3. **Gateway reversal:** `initiate_gateway_reversal`, `complete_gateway_reversal`, `cancel_gateway_reversal` (§2.6 R-G).

---

## 5. Failure-mode matrix

**Guarantee wording:** *no more than one payment is applied to an obligation; every additional captured payment is separately recorded and routed to refund review; refund completion is tracked separately and only on evidence.*

| # | Case | Expected state | Payer sees | Operational action | Financial risk |
|---|---|---|---|---|---|
| 1 | Timeout before the request reaches the gateway | OUTCOME_UNKNOWN; **blocked** (cannot be told apart from case 2) | "Confirming your payment setup" (Q5) | Reconcile after the settle delay; Finance `supersede` when satisfied | None applied; online and manual blocked until resolved |
| 2 | Timeout after the gateway created the order (F3) | OUTCOME_UNKNOWN → RECOVERED → (revalidate) ACTIVE | As case 1, then the recovered order | Usually automatic | Orphan unexposed until revalidated |
| 3 | Crash before order-ID persistence | → OUTCOME_UNKNOWN | As case 1 | As case 2 | As case 2 |
| 4 | Lease expiry in flight | OUTCOME_UNKNOWN; late `orderIdLate` record-only | 409 | Reconcile | No second order |
| 5 | Late response after `supersede` | SUPERSEDED + `orderIdLate`; never exposed | 409 (stale request) | – | Unexposed; if paid → review |
| 6 | Supersede requested for an **exposed** order | **Refused**; Finance may `retire_exposed` (claim retained) | – | – | Exposed order stays payable; any payment → review |
| 7 | New request while an exposed order may be payable | Same order returned (revalidated), or 409; **never a second order** unless `expose_replacement` | Same checkout / "contact the club" | Finance decides | G-C holds by default |
| 8 | `expose_replacement` used | Two payable orders (recorded) | New checkout | Monitor | Second payment → review (G-A holds; G-C waived, recorded) |
| 9 | Concurrent requests, same user or other sessions | One attempt | One checkout | – | None |
| 10 | Match screen and Dues bundle for one fee (D1) | Second blocked at claim (Phase 2); before Phase 2, one APPLY and one REJECT_DUPLICATE (Phase 1A) | – / under review | Refund | None double-applied |
| 11 | Webhook before activation persistence | Order identity adopted (§4.4), then decided | Paid | – | None |
| 12 | Two payment IDs on one intent / one order | First APPLY; second REJECT_DUPLICATE; first's intent and attempt **unchanged** | Under review for the second | Refund | None double-applied |
| 13 | Duplicate delivery of the first payment | R1 REPLAY | – | – | None |
| 14 | Same payment ID, **conflicting identity** | IDENTITY_CONFLICT; original untouched; anomaly + high-severity dead-letter; 200 after commit | – | Investigate | None applied |
| 15 | Orphan order (never exposed) paid via a leaked ID | Attempt still holds claims and obligations unpaid → APPLY; SUPERSEDED → REJECT_DUPLICATE | Paid / review | Refund or apply | None double-applied |
| 16 | Payment against a retired or superseded order | REJECT_DUPLICATE | Under review | Refund, or `apply_reviewed_payment` if still unpaid | None double-applied |
| 17 | Manual cash vs captured webhook (**both orderings**) | Manual first → webhook REJECT_DUPLICATE; webhook first → manual 409 | – | Refund one | None double-applied |
| 18 | `apply_reviewed_payment` vs a new webhook (both orderings) | Serialised on obligation record and claim; loser rejected or 409 | – | – | None double-applied |
| 19 | Reversal vs webhook (both orderings) | R-M first → obligation unpaid → a later online payment may APPLY (legitimately owed again); webhook first → reversal precondition fails (409) | – | – | Single application per settlement cycle |
| 20 | Gateway-settled reversal | Unpaid only after a **full processed refund**; partial refund keeps it settled | – | Track refund | No "unpaid while applied" |
| 21 | Refund initiated, failed or partial | Refund rows; summary `partially_refunded` / `intervention_required` | – | Finance follows up | A dead-letter is never proof of refund |
| 22 | Lookup returns 0 / more than 1 / unavailable | UNKNOWN stays / ANOMALY_MULTIPLE / unchanged | "Being verified" | Finance | None applied |
| 23 | Waived, abandoned or sponsored after exposure | REJECT_DUPLICATE | Under review | Refund (Option A) | None applied |
| 24 | Legacy late-fee ambiguity before the backfill | REJECT_DUPLICATE (`LEGACY_LATE_FEE_AMBIGUOUS`) | Under review | Finance applies or refunds | Conservative |
| 25 | Bundle over 20 obligations | 400 at claim | "Pay in smaller groups" | – | None |
| 26 | Rollback with held or retained claims or unknown attempts | Legacy creation **still blocked** (§8) | "Being verified" | Finance resolves | No bypass |

---

## 6. Invariants (each asserted by a test)

| # | Invariant |
|---|---|
| I1 | **Single application:** per obligation per settlement cycle, at most one payment is applied (cycles are delimited by recorded reversals, §2.6) |
| I2 | **Accounting:** every captured signed payment with a usable ID has exactly one `gatewayPayments` record with immutable identity; its application is one of `applied`, `rejected_duplicate`, `unmatched`, `reversed`; `refundProcessedPaise ≤ amountPaise`; "processed" requires evidence |
| I3 | **Exposure:** at most one exposed, possibly-payable order per obligation, except after a recorded `expose_replacement`. A claim for an exposed order is never released to `open` (only `retained_exposed` / `settled`) |
| I4 | **No automatic re-creation** after CREATING; new attempts only after `supersede` of a never-exposed attempt (Finance) |
| I5 | **Zero is not absence** |
| I6 | **Fencing:** stale holders cannot change claims, expose orders, or alter terminal attempts (record-only `orderIdLate` excepted) |
| I7 | **Server authority:** attempts, claims, orders, payments, refunds, anomalies, settlement fields and events are server-written only (settlement fields after Phase 1B) |
| I8 | **First outcome immutable:** an intent's first terminal state and an attempt's `firstPaymentId` and terminal state never change; later payments are recorded only on their own `gatewayPayments` and as appended events |
| I9 | **Identity integrity:** an existing `gatewayPayments` record is never overwritten; a conflicting identity produces an anomaly, never a REPLAY |
| I10 | **No silent reversal:** a gateway-settled obligation becomes unpaid only after a full processed refund; every reversal preserves the original settlement and payment history |
| I11 | **Entity separation:** obligation = financial truth; claim = coordination; attempt = one create; gateway payment = money. No record serves two roles (late fees included) |
| I12 | **Atomic audit:** every human action and payment decision appends events (and `auditLogs` for humans) in the same transaction |
| I13 | **No secrets or PII** in any R4 record |
| I14 | **Bounded transactions:** at most 20 obligations per payment; footprint asserted |

---

## 7. Test matrix (mandatory)

**Layers** (unchanged from revision 2): unit (pure functions and transition tables), Firestore transaction (emulator), route integration (emulator + deterministic gateway stub with release handles and injected clock), gateway contract (stub pinned to recorded evidence), regression (all existing suites).

**Races are run in both orderings** (`→` and `←`), repeated N times with seeds, through the **real route handlers**.

| # | Scenario | Layer | Must show |
|---|---|---|---|
| T1 | Match screen vs Dues bundle, same fee | Route | 1A: one APPLY, one REJECT_DUPLICATE. Phase 2: second request 409 |
| T2 | Manual cash settlement ↔ captured webhook (**both orderings**) | Route (real `/api/finance/settlements` + webhook route, concurrent) | Exactly one settlement; the loser is REJECT_DUPLICATE or 409 |
| T3 | Two intents' webhooks for one obligation (both orderings) | Route | One APPLY, one REJECT_DUPLICATE; two payment records |
| T4 | All-or-nothing Dues bundle | Webhook transaction | No obligation writes; `rejected_duplicate`; `paid_unapplied` only if first |
| T5 | Each settled state (`settled_gateway`, `settled_manual`, `sponsored`, `waived`, `reversal_pending`) | Webhook transaction | REJECT_DUPLICATE with the correct reason |
| T6 | Two payments, same subscription period; then a **next-period renewal** | Route | One extension, second rejected; **the renewal succeeds** (not blocked) |
| T6b | Repeat merchandise purchase of the same item | Route | Two merch orders, both payable and applied; a duplicate on one order → review |
| T7 | Late fee: legacy `lf_${intentId}` + deterministic `lfo_`; pre- and post-backfill | Webhook transaction + backfill dry run | One Paid late fee; ambiguity → review; backfill idempotent and reports unresolvable records |
| **T8 (B2-1)** | Two payment IDs against one intent | Route | First applied; second `rejected_duplicate`; **intent stays `paid`, attempt stays PAID, `firstPaymentId` unchanged** |
| **T9 (B2-2)** | Two payment IDs against one order | Route | Same as T8; two payment records linked to one order |
| **T10 (B2-3)** | Duplicate delivery of the first payment | Route | REPLAY, zero writes |
| **T11 (B2-4)** | Second payment after the first was applied, to a different intent for the same obligation | Route | REJECT_DUPLICATE; the first's records unchanged |
| **T12 (B2-5)** | Conflicting payment ID on the same intent | Route | REJECT_DUPLICATE; the first payment's application, intent and attempt untouched |
| **T13 (B5)** | Same payment ID with different order ID / amount / currency / intent | Route | IDENTITY_CONFLICT; original record byte-identical; anomaly + high-severity dead-letter; 200 after commit; 503 if the store fails; repeated delivery → same anomaly (idempotent) |
| **T14 (B1)** | Supersede before exposure ↔ late gateway response (both orderings) | Route + stub release | Supersede-first: record-only, never returned. Response-first: ACTIVE; supersede refused; retire keeps the claim |
| **T15 (B1)** | New request while an exposed order exists (same amount; changed amount) | Route | Same order returned; changed amount → 409; **no second order** |
| **T16 (B1)** | Payment against a retired order | Route | REJECT_DUPLICATE (`ATTEMPT_RETIRED`) |
| **T17 (B1)** | `expose_replacement` disabled → 403; enabled → two orders, second payment reviewed | Route | Policy enforced; residual risk recorded |
| **T18 (B3)** | R-M, R-S (sponsor unpaid; sponsor settled → 409), R-W (abandoned guard), R-G (initiate → partial refund keeps settled → full processed refund → reversed / unpaid; cancel path) | Route | Write sets exact; history preserved; `settled_gateway` never directly → `unpaid` |
| **T19** | Reversal ↔ webhook (both orderings) | Route | Single application per cycle |
| **T20 (clar. 1)** | `apply_reviewed_payment` with an open claim / a retained claim / a conflicting ACTIVE attempt (without and with `retireConflictingAttempt`); ↔ new webhook (both orderings) | Route | No stale held claim; conflicting attempt retired; single application |
| **T21 (clar. 2)** | REJECT_INVALID variants: unknown intent, mismatch, no payment ID | Route | `unmatched` record when the ID is usable; dead-letter only otherwise; no state changes |
| **T22 (clar. 4)** | Multiple partial refunds; refund failed; over-refund attempt | Route | Summary correct; over-refund rejected; processed only with evidence |
| **T23 (clar. 5)** | Bundle of 20 (max) and 21 | Route | 20 succeeds within the asserted footprint; 21 → 400 |
| T24 | Timeouts before and after the gateway (stub) | Route | OUTCOME_UNKNOWN; no automatic re-create; recovery only via the delayed lookup + revalidation |
| T25 | Rollback (flags off) with held / retained claims and an unknown attempt | Route | Legacy creation refused for those obligations |
| T26 | Refund lifecycle | Route | Dead-letter resolution never marks a refund processed |

---

## 8. Migration, compatibility and rollback

- **Source of truth:** obligation records (legacy mapping §2.1); claims and attempts are coordination. **No backfill is needed for correctness except late fees** (§3.3, dry run first; owner approval before production).
- **Legacy reservations:** wrapped as synthetic attempts on first touch (revalidated); `reconciliation_*` → OUTCOME_UNKNOWN. A legacy `active` reservation with an exposed order maps to ACTIVE (`exposedAt` = activation time), so its claim follows the B1 rules.
- **Legacy intents:** synthetic attempts from intent fields.
- **Subscriptions:** a period record is created for the **current** period on first touch from `studioExpiryDate` and `subscriptionHistory` (read-only derivation; ambiguous cases reported).
- **Merch:** existing `merchOrders` IDs are the obligation keys; new purchases are server-minted.
- **Rollback rule (non-flaggable guard):** feature flags gate only *new* behaviour. After Phase 2, every creation path (legacy included) checks claims and attempts; `held`, `retained_exposed`, `reversal_pending` claims, and ACTIVE, OUTCOME_UNKNOWN, RECONCILING, RECOVERED or ANOMALY attempts **block** legacy creation. The Phase 1A decision function and `gatewayPayments` identity checks stay on once deployed.
- **Rules deploy** only via `main` (both databases). The Phase 1B order is: endpoint, then client switch-over, then rules lockdown.

---

## 9. Role mapping (clarification 6 / Q11) — explicit

| Action | Super Admin | Finance Admin | Club Admin | Designer | Player |
|---|---|---|---|---|---|
| Pay own obligation online | ✓ (as player) | ✓ (as player) | ✓ (as player) | ✓ (as player) | ✓ |
| `settle_manual` match fee (cash/UPI) | ✓ | ✓ | **✓ match fees only** (former Match Admin pitch-side capability, D-19) | ✗ | ✗ |
| `settle_manual` other fee / late fee | ✓ | ✓ | ✗ | ✗ | ✗ |
| `mark_sponsored`, `reverse_sponsorship` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `waive`, `reverse_waiver` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `reverse_manual_settlement` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `set_studio_period` | ✓ | ✓ | **✓** (former Studio Admin, D-19) | ✗ | ✗ |
| `set_merch_payment_status` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `reconcile`, `attach_order`, `supersede`, `retire_exposed` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `expose_replacement` | ✓ | ✓ (only if enabled, Q13) | ✗ | ✗ | ✗ |
| `apply_reviewed_payment`, refund records, gateway reversal | ✓ | ✓ | ✗ | ✗ | ✗ |
| Read attempts, payments, refunds, anomalies | ✓ | ✓ | ✗ | ✗ | ✗ |

---

## 10. Owner decisions still required, and gateway checks

| # | Decision | Recommendation | Status |
|---|---|---|---|
| Q1 | Bundle with a settled item | Apply none; review | **Decided (reviewer)** |
| Q2 | Second payment for the same subscription period | Review (refund); prepaying the next period is a new claim | Owner |
| Q3 | Automatic unblock after OUTCOME_UNKNOWN | No; Finance `supersede` | Recommended, owner to confirm |
| Q4 | Settle delay and back-off | ≥ 10 min, then 30 min, 2 h, 24 h; alert at 30 min | Owner |
| Q5 | Payer wording | Owner to approve copy | Owner |
| Q6 | Manual settlement while ACTIVE | 409 unless acknowledged (→ RETIRED, claim retained) | Owner |
| Q7 | Refund execution | Manual via dashboard; recorded via §4.6 | Owner |
| Q8 | Renewal / repeat-purchase block | Resolved by design (§3.4); reproduce for the record | Owner to note |
| Q9 / Q11 | Role mapping | §9 table | **Owner to confirm** |
| Q10 | Reconciliation worker | Admin-triggered in R4 | Owner |
| Q12 | Phase 1B workflow switch-over | Same screens, server-backed | **Owner to approve** |
| Q13 | Enable `expose_replacement` at all | **Disabled by default**; enable only with a written Finance policy | **Owner** |
| Q14 | Partial refund of an applied payment | Keeps the obligation settled; full reversal needs a full processed refund | Owner |
| Q15 | Reversing sponsorship after the sponsor has paid | Out of R4 scope; 409 + Finance adjustment | Owner |
| Q16 | Maximum bundle size | 20 obligations per payment | Owner (check typical dues counts) |

**Gateway checks** (each needs reviewer approval; test mode only; **not assumed**):
- **G1:** fetch by ID.
- **G2:** payments per order.
- **G3:** a second payment on a paid order (test cards).
- **G4:** time-window listing.
- **G5:** refund webhooks and partial or multiple refunds.
- **G6:** which create errors prove non-creation.
- **G7:** whether an order can be cancelled or expired (would allow releasing `retained_exposed`).

---

## 11. Phased implementation plan and dependencies

| Phase | Proposed commit | Content | Depends on | Closes |
|---|---|---|---|---|
| **1A** | `payment: obligation-level decision, payment accounting and identity checks (R4-1A)` | `decidePaymentApplication` (R1–R7); `gatewayPayments` (create-only, immutable identity, anomalies); §4.3 write sets incl. REJECT_INVALID and IDENTITY_CONFLICT; first-outcome immutability; order identity recovery (§4.4); `lateFeeObligations` + deterministic mirror + legacy ambiguity handling; late-fee backfill script (**dry run only**); synthetic attempts; T1(1A), T3–T5, T7–T13, T21, T23 | – | G-A for online-vs-online and online-vs-settled; B2, B4, B5 |
| **1B** | `payment: server-controlled manual settlement and reversals (R4-1B)` | `/api/finance/settlements` (settle, sponsor, waive, reversals R-M / R-S / R-W, studio period, merch status); settlement events; rules lockdown + client switch-over; T2, T5 manual variants, T18 (R-M/R-S/R-W), T19 | 1A | D2, manual D3; B3 (non-gateway) |
| | | **Full D1/D2/D3 coverage is claimed only after 1A and 1B.** | | |
| 2 | `payment: obligation claims and exposure rules (R4-2)` | Claims incl. `retained_exposed`; all-or-nothing claim (≤ 20); subscription periods and server-minted merch IDs (§3.4); non-flaggable guard; legacy reservation wrapping; T1(2), T6, T6b, T15, T25 | 1A | D1 at source; G-C; Q8 |
| 3 | `payment: attempts and unknown-outcome state (R4-3)` | Attempts + events; receipt = `attemptId`; `gatewayOrders`; outcome classification; **remove the expired-`reserving` takeover**; T24 | 2 | D4; I4, I6 |
| 4 | `payment: supersede, retire and late-response handling (R4-4)` | `supersede` (never-exposed only), `retire_exposed`, record-only `orderIdLate`, `expose_replacement` (disabled); T14, T16, T17 | 3 | B1 |
| 5 | `payment: reconciliation, reviewed-payment application and refunds (R4-5)` | `/api/finance/payment-attempts`; settle-delay lookup; revalidation; `attach_order`; `apply_reviewed_payment` (claim-coordinated); multi-refund model; gateway reversal R-G; T18 (R-G), T20, T22, T26 | 3, 4 (G5-dependent parts gated) | Cases 1–3, 16–22; B3 (gateway) |
| 6 | `docs: R4 closure, stale comment, Finance runbooks (R4-6)` | Fix `lib/razorpay-order.ts:653`; runbooks (review, refund, reversal, late-fee backfill) | 5 | – |
| 7 | `test: R4 failure-mode regression suite (R4-7)` | All §5 rows end to end; contract fixtures F1–F3 (+ G1–G7 when run) | all | Evidence for review |

Each phase needs separate approval, tests written first, and separate commits on `mig-mov`. The late-fee **backfill is never run against production** without explicit owner approval of its dry-run report.

---

## 12. Reviewer response (review of `f8b1f2e`)

| Finding | Resolution | Section |
|---|---|---|
| **B1** Superseding an exposed order | SUPERSEDED is restricted to **never-exposed** attempts; exposed attempts are **RETIRED** with the claim **retained** (`retained_exposed`). Defined: supersede before exposure, late response after supersede, new request while an exposed order may be payable (same order or 409, never a second), payment against a superseded or retired order (REJECT_DUPLICATE → review). A second exposed order only via the disabled-by-default `expose_replacement`, with residual risk documented. The guarantee is restated (G-C with recorded exception) | §0, §2.2, §2.3, **§2.4**, §4.6, §5 rows 5–8 & 16, I3, T14–T17, Q13 |
| **B2** Preserve the original PAID intent and attempt | Duplicate state is owned only by `gatewayPayments` (+ dead-letter + events). Terminal attempts never change; `firstPaymentId` immutable. REJECT_DUPLICATE changes intent or attempt **only** if they have no first payment (→ `paid_unapplied` / `CLOSED_UNAPPLIED`); otherwise events only. PAID → DUPLICATE removed | §2 (ownership), §2.3, **§4.3 REJECT_DUPLICATE**, I8, T8–T12 |
| **B3** Safe reversal | Generic `revert_to_unpaid` removed. Separate R-M, R-G (two steps; unpaid only after a full **processed** refund; partial keeps settled; cancel path), R-S (both linked records; 409 if the sponsor has paid), R-W (abandoned guard). Compensating events, preserved history, authorisation and write sets defined | §2.1 transitions, **§2.6**, §4.5, §4.6, I10, T18–T19, Q14–Q15 |
| **B4** Separate late-fee obligation from claim | New deterministic `lateFeeObligations/{lfo_…}` (authoritative); a separate claim; display mirror in `otherFees`; legacy `lf_${intentId}` resolution via dry-run backfill; conservative pre-backfill ambiguity handling; uniqueness and rollback | §2 entity table, **§3.3**, I11, T7 |
| **B5** Validate identity before REPLAY | R1 REPLAY only when the immutable identity matches; R2 IDENTITY_CONFLICT otherwise: original untouched, idempotent anomaly row + high-severity dead-letter, 200 after commit (durably recorded and flagged, not silent), 503 on store failure | §2.5, **§4.2 R1–R2**, **§4.3 IDENTITY_CONFLICT**, I9, T13 |
| C1 `apply_reviewed_payment` claim coordination | Reads holders; preconditions; conflicting ACTIVE attempt retired only with an explicit flag; **every claim → `settled`**; first-payment rules respected | **§4.6** item 1, T20 |
| C2 REJECT_INVALID write set; when `unmatched` | Usable payment ID → `gatewayPayments` `unmatched` + dead-letter; no ID → dead-letter only; no state changes; `unmatched` defined | **§4.3**, T21 |
| C3 Subscription and merch without blocking renewals | Period-scoped subscription obligations; server-minted merch order IDs; legacy request-shape keys retired from blocking | **§3.4**, T6, T6b |
| C4 Partial and multiple refunds | Supported: append-only refund rows, summary fields, invariants, evidence rule | **§2.5**, §4.6, T22 |
| C5 Bundle size and transaction constraints | Maximum 20 obligations; worst-case read and write footprint; reads-before-writes; footprint asserted, fail closed; platform limits not re-verified (stated) | **§3.5**, I14, T23 |
| C6 Role mapping and remaining owner decisions | Explicit action × role table; decision list with status | **§9**, **§10** |
