# R4 — Razorpay Order Concurrency, Ambiguous Outcomes and Duplicate Payments: Architecture Design (revision 4)

**Status:** DESIGN ONLY, for independent review. **Not approved for implementation** (§13). Revision 4 resolves findings B6, B7 and B8 from the review of revision 3 (`7317e1d`) and corrects the contradictions found in the cross-cutting review (§0.2). No application code, Firestore rules, tests, test configuration, data or deployment was changed. No Razorpay call was made.
**Branch / base:** `mig-mov` @ `7317e1d`
**Date:** 2026-11-23

**Evidence base:**
- Run `r4mwtfrkta4202`: `docs/qa/R4/evidence/R4_EXPERIMENT_RESULTS_AND_ANALYSIS.md`.
- Delayed re-check: `docs/qa/R4/evidence/supplemental-e5-recheck/E5_RECHECK_RESULTS.md`.

**Resolution matrix:** §14.

---

## 0. Revision 4 summary, evidence and guarantees

### 0.1 Change summary

| Area | Revision 3 | Revision 4 |
|---|---|---|
| **Claim model (B6)** | Claim states `open / held / retained_exposed / settled`. Claims mirrored settlement; reversals set the claim to `open` | The claim describes **only online orders**, never settlement. It is a **holder** plus a **retained-orders set** plus an **anomaly flag** (§2.2). Settlement, reversal, sponsorship and waiver **never** change the claim except to retain orders. An order once exposed (or paid) is retained until one of exactly **three** release conditions (§2.6) |
| **Reversals (B6)** | Claim reopened on reversal | Per-workflow matrix of obligation / claim / attempt / payability / replacement / authorisation / audit (§2.7). Reversal never releases a claim |
| **`apply_reviewed_payment` (B7)** | Basic preconditions | Full validation decision table (identity, order, capture, amount, currency, refunds, prior allocation, player identity, anomalies); exact-amount rule; no partial payments; finance-attested allocation for unbound payments with a separate immutable allocation record; idempotency by `requestId` (§4.6) |
| **Terminal attempts (B8)** | REJECT_DUPLICATE moved "any attempt without `firstPaymentId`" to CLOSED_UNAPPLIED, which could rewrite SUPERSEDED / FAILED_NO_ORDER | An explicit eligibility table: only listed **non-terminal** states may become CLOSED_UNAPPLIED; terminal attempts receive **events only**; a payment against FAILED_NO_ORDER raises a classification anomaly (§2.3, §4.3) |
| **`ANOMALY_MULTIPLE` (B8)** | Attempt state only; resolution unspecified | Defined as **both** an attempt state (multiple orders for one attempt's receipt) and a claim **anomaly flag** (multiple possibly-payable orders for one obligation), with owner, transitions, Finance resolution and blocking guarantees (§2.4) |
| Admin actions | Idempotency implicit | Uniform `requestId` idempotency, retry and failure conventions (§4.0) |
| Cross-cutting | – | Contradictions fixed (§0.2) |

### 0.2 Contradictions found in revision 3 and corrected

| # | Revision 3 text | Problem | Revision 4 |
|---|---|---|---|
| X1 | §2.2: claim `settled` mirrors the obligation | Mixed coordination with financial truth (I11); allowed reopening on reversal | Claim has no settlement state (§2.2) |
| X2 | §2.6 R-M / R-S / R-W: "claim → `open`" | Could expose a second order while an old exposed order is payable (B6) | Claim untouched by reversals (§2.7) |
| X3 | §2.6 R-G: "claim → `open` (unpaid)" | The paid order may still accept payment (G3 unverified) | Paid order retained (§2.7) |
| X4 | §4.6: "every claim → `settled`" in `apply_reviewed_payment` | Same as X1 | Claim retains the payment's order (§4.6) |
| X5 | §4.5: manual settle with acknowledgement → "`retained_exposed`, then settled" | Retention overwritten | Retention persists (§4.5) |
| X6 | §4.3: "attempt has no `firstPaymentId` → CLOSED_UNAPPLIED" | Matched SUPERSEDED / FAILED_NO_ORDER (B8) | Eligibility table (§2.3) |
| X7 | §2.2 release rule: "or after a reversal that makes the obligation unpaid" | Contradicted retention | Removed; only §2.6 conditions |

### 0.3 Evidence and principle (unchanged)

- **F1:** duplicate receipts accepted (sequential and concurrent).
- **F2:** receipt listing eventually consistent (> 20 s, ≤ about 5 min 40 s in one run).
- **F3:** orphan orders confirmed.
- **F4 (unverified):** live mode; fetch-by-ID; payments per order; a second payment on a paid order; order cancellation or expiry; refund webhooks and partial refunds; which create errors prove non-creation.

**Firestore state cannot make a Razorpay order unpayable. The system cannot prevent a payer from being charged more than once in every case.**

### 0.4 Guarantees

- **G-A (single application):** per obligation per settlement cycle, no more than one payment is applied.
- **G-B (accounting):** every captured payment has exactly one immutable accounting record. Every payment not applied is classified and routed to review. Refund lifecycle is tracked separately from capture and application; *initiated is never refunded*.
- **G-C (single exposure):** an obligation never gains a second possibly-payable order unless an earlier exposed order is proven unpayable (release condition 2, unavailable until verified) or an authorised `expose_replacement` override is recorded (disabled by default).
- **G-D (no automatic re-creation):** after an ambiguous attempt, a new order is never created automatically.

---

## 1. Current-state architecture (verified; unchanged from revision 3)

- **Order creation:** `app/api/razorpay/order/route.ts` `POST`:
  - `requireAuth` (`:38`);
  - `derivePayableAmount` (`:82` → `lib/razorpay-order.ts:1283`, server late fees `:1347`);
  - `acquirePaymentReservation` (`:100` → `:313`) with request-shape keys (`generateReservationKey`, `:9`) and the expired-`reserving` **takeover** (`:361–436`);
  - create path `:484–555` (persist-before-expose holds);
  - failures `:557–600`;
  - `reconcileAmbiguousReservation` (`:656`; Branch A `:698`, Branch B `:852`, zero-match `:1010` stays blocked; stale comment `:653`; no resolution tool).
- **Online fulfilment:** `lib/razorpay-webhook.ts` `processWebhookIntentTransaction` (`:235`):
  - per-intent idempotency (`:263–275`);
  - branches `:419` / `:457` / `:516` / `:569`; late fees `lf_${intentId}` (`:370`); reservation `isPaid` (`:602`);
  - **no obligation-state check**;
  - R5 dead-letter written in a separate transaction (`app/api/razorpay/webhook/route.ts:58`).
- **Manual settlement:** client-side via `hooks/useStore.ts`:
  - `updatePaymentStatus` (≈`:1800`), `applyFeePlanToPayment` (≈`:2155`), `assignProxyPayment` and its clear path (≈`:2225–2365`; two records), otherFees writes, `updateMerchOrder` (`:2765`);
  - Studio expiry editors;
  - allowed by Finance-admin rules and `isMatchAdminPaymentUpdate` (`firestore.rules:279`).
- **Duplicate-application paths D1–D5 and suspected Q8:** as in revision 3 §1.4.
  - **D1:** request-shape keys.
  - **D2:** manual vs online.
  - **D3:** waived, abandoned or sponsored paid online.
  - **D4:** expired-`reserving` takeover.
  - **D5:** adopt-after-takeover mismatch.

---

## 2. Entities and state machines

| Entity | Role | Authoritative for | Never used for |
|---|---|---|---|
| **Obligation** (match payment, other fee, `lateFeeObligations`, `subscriptionPeriods`, `merchOrders`) | Financial truth | Settlement state, `settlementVersion`, settlement events | Order exposure |
| **Claim** (`paymentObligationClaims`) | Online-order coordination | Which attempt may expose an order; which exposed or paid orders may still be payable; anomaly | Settlement |
| **Attempt** (`paymentAttempts`) | One gateway `orders.create` | Order identity, exposure, first payment | Settlement |
| **Gateway payment** (`gatewayPayments`) | Captured money | Capture identity, application, allocations, refunds, anomalies | Order exposure |

### 2.1 Obligation settlement state machine

| State | Meaning |
|---|---|
| `unpaid` | Owed |
| `settled_gateway` | Settled by an applied gateway payment (`gatewayPaymentId`, `allocationId`) |
| `settled_manual` | Settled by cash or UPI |
| `sponsored` | Settled by sponsorship (linked to the sponsor's obligation) |
| `waived` | No obligation |
| `reversal_pending` | `settled_gateway` with a gateway reversal in progress (still settled) |

| From → To | Action (§4) | Actor |
|---|---|---|
| unpaid → settled_gateway | webhook APPLY (§4.3); `apply_reviewed_payment` (§4.6) | system; Finance / Super |
| unpaid → settled_manual | `settle_manual` | Finance / Super; Club Admin (match fees only, Q11) |
| unpaid → sponsored | `mark_sponsored` | Finance / Super |
| unpaid → waived | `waive`; abandoned-match reconciliation | Finance / Super; system |
| settled_manual → unpaid | `reverse_manual_settlement` (R-M) | Finance / Super |
| sponsored → unpaid | `reverse_sponsorship` (R-S) | Finance / Super |
| waived → unpaid | `reverse_waiver` (R-W) | Finance / Super |
| settled_gateway → reversal_pending | `initiate_gateway_reversal` (R-G1) | Finance / Super |
| reversal_pending → unpaid / waived | `complete_gateway_reversal` (R-G2) | Finance / Super |
| reversal_pending → settled_gateway | `cancel_gateway_reversal` (R-G3) | Finance / Super |
| settled_gateway → unpaid (direct) | **Forbidden** | – |
| any → any other | **Forbidden** | – |

Every transition is one transaction:
- compare-and-set on `settlementVersion` (+1);
- an append-only `settlementEvents/{id}` row (`type`, `from`, `to`, `actor`, `reason`, `refs`);
- `auditLogs` for human actors.

**No obligation transition writes the claim**, except the explicit retention steps named in §4.3, §4.5 and §4.6 (adding retained orders and clearing a holder that has been retired).

### 2.2 Claim model (B6): `paymentObligationClaims/{cl_…}`

**Fields:**
- `canonicalKey`
- `holderAttemptId | null`, `holderFence`
- `retainedOrders[]`: each `{orderId, attemptId, reason: "exposed_retired" | "paid_applied" | "anomaly_found", since}`
- `anomaly: false | {attemptIds[], orderIds[], since}`
- `overrideActive: false | {byRequestId, since}`
- `version`

Every change also appends a `paymentObligationClaims/{id}/events/{eventId}` row (append-only; the audit trail of the array). `retainedOrders` is bounded: it is only added to by exposure or payment, at most a handful per obligation. It is **never removed from**, except by release condition 2 (§2.6).

**Derived claim states (what callers act on):**

| Derived state | Condition | New order creation | Request for this obligation returns |
|---|---|---|---|
| `OPEN` | no holder, no retained orders, no anomaly | **Allowed** (new attempt) | new order |
| `HELD` | holder set, no retained orders, no anomaly | Not allowed | the holder's order if the holder is ACTIVE and revalidates (§2.3.1); else 409 `PAYMENT_BEING_VERIFIED` |
| `RETAINED` | no holder, ≥ 1 retained order, no anomaly | **Not allowed** | 409 `ONLINE_PAYMENT_UNAVAILABLE` ("contact the club") |
| `HELD_OVERRIDE` | holder set, ≥ 1 retained order, `overrideActive` | Not allowed | the holder's order (revalidated) |
| `ANOMALY` | `anomaly` set (any holder or retained) | **Not allowed** | 409 `PAYMENT_UNDER_REVIEW` |

### 2.3 Attempt state machine (B8): `paymentAttempts/{att_…}`

**States:**
- Non-terminal: `CLAIMED`, `CREATING`, `ORDER_RECEIVED`, `ACTIVATION_FAILED`, `ACTIVE`, `OUTCOME_UNKNOWN`, `RECONCILING`, `RECOVERED`, `ANOMALY_MULTIPLE`, `RETIRED`.
- **Terminal:** `PAID`, `CLOSED_UNAPPLIED`, `SUPERSEDED`, `FAILED_NO_ORDER`.

**Terminal rule:** a terminal attempt's `state`, `firstPaymentId` and `exposedAt` are **never written again**. Later events about it (late order response, captured payment, duplicate delivery) append rows to `paymentAttempts/{id}/events` only.

| From | To | Trigger | Actor |
|---|---|---|---|
| CLAIMED | CREATING | create about to be sent | system |
| CREATING | ORDER_RECEIVED | 2xx with valid `order.id` | system |
| CREATING | FAILED_NO_ORDER | **only** a complete HTTP 400 `BAD_REQUEST_ERROR` validation body or a complete HTTP 401 auth-failure body (pending G6) | system |
| CREATING | OUTCOME_UNKNOWN | 408, 409, 429, 5xx, timeout, reset, TLS or proxy error, partial or unparsable body, 2xx without order, crash (lease expiry observed), lease lost after send, **anything unclassified** | system |
| ORDER_RECEIVED | ACTIVE | order ID persisted + `gatewayOrders` create + claims activated; sets `exposedAt` on return | system |
| ORDER_RECEIVED | ACTIVATION_FAILED | persistence or activation transaction failed (order ID already on the attempt) | system |
| ACTIVATION_FAILED, RECOVERED | ACTIVE | revalidation succeeds (§2.3.1) | system or Finance `reconcile` |
| OUTCOME_UNKNOWN | RECONCILING | `reconcile` starts (fenced) | Finance / worker |
| RECONCILING | RECOVERED | exactly 1 order with this receipt, fetch-validated | system |
| RECONCILING | OUTCOME_UNKNOWN | 0 found, or lookup failed (**0 is not absence**) | system |
| RECONCILING | ANOMALY_MULTIPLE | > 1 order with this attempt's receipt (§2.4) | system |
| ANOMALY_MULTIPLE | RECOVERED / SUPERSEDED / RETIRED | `resolve_anomaly` (§2.4) | Finance / Super |
| ACTIVE | PAID | first captured payment APPLIED | system |
| ACTIVE | RETIRED | `retire_exposed`; manual settle / sponsor / waive with acknowledgement; `apply_reviewed_payment` with `retireConflictingAttempt` | Finance / Super (+ Club for `settle_manual` match fee) |
| RETIRED | PAID | `apply_reviewed_payment` applies a payment made on this attempt's order (§4.6) | Finance / Super |
| CLAIMED, CREATING, OUTCOME_UNKNOWN, RECONCILING, RECOVERED, ACTIVATION_FAILED (all with `exposedAt` unset) | SUPERSEDED | `supersede` (§4.7) | Finance / Super |
| **eligible** (see below) | CLOSED_UNAPPLIED | first captured payment for this attempt rejected (§4.3) | system |
| ACTIVE (`exposedAt` set) | SUPERSEDED | **Forbidden** (exposed attempts are retired) | – |
| any terminal | any | **Forbidden** | – |

**CLOSED_UNAPPLIED eligibility** (first captured payment rejected):

| Attempt state when its first captured payment is rejected | Result |
|---|---|
| ACTIVE, RETIRED, ACTIVATION_FAILED, OUTCOME_UNKNOWN, RECONCILING, RECOVERED (and `firstPaymentId` unset) | → **CLOSED_UNAPPLIED**; `firstPaymentId` = this payment; `orderIdLate` / `gatewayOrderId` recorded if missing |
| ANOMALY_MULTIPLE | **State unchanged** (Finance must resolve, §2.4); event `payment_during_anomaly` |
| PAID, CLOSED_UNAPPLIED, SUPERSEDED, FAILED_NO_ORDER | **State unchanged**; event only (§4.3) |

#### 2.3.1 Revalidation before (re-)exposure (unchanged)

One transaction; all must hold:
1. the claim holder is this attempt at its fence, and the claim has no anomaly;
2. every obligation is `unpaid` at the expected `settlementVersion`;
3. the payer binding is unchanged (`userId`; player not merged or disabled; obligation owned by that player);
4. the amount equals a fresh `derivePayableAmount()`, and the currency matches;
5. the order fetched by ID (G1) has matching amount, currency and `notes.attemptId`, and status `created` or `attempted`.

Failure → not exposed; Finance (`supersede` if never exposed, else `retire_exposed`).

### 2.4 `ANOMALY_MULTIPLE` lifecycle (B8)

**Definition.** It is **both**:
- **(a) an attempt state:** the attempt's own receipt maps to more than one gateway order (should be impossible with one create per attempt; indicates a bug, external creation or a gateway defect);
- **(b) a claim anomaly flag:** the obligation has more than one possibly-payable order that is not covered by an active override.

Sources of (b):
- (a) on the holder attempt;
- reconciliation or webhook finding a payment or order for the obligation linked to an attempt that is neither the holder nor already retained;
- migration finding more than one legacy order for one obligation (§8).

**Owner and holder:** the claim keeps `holderAttemptId` (unchanged) and records `anomaly.attemptIds` and `anomaly.orderIds`. Each discovered order is linked in `gatewayOrders/{orderId}` (`create()`; an existing link is kept, and a conflicting link → B5 identity anomaly).

**Blocking:**
- `claimObligations` (§4.1) returns 409 `PAYMENT_UNDER_REVIEW` for any claim with an anomaly. **There is no other order-creation path** (legacy creation goes through the same non-flaggable guard, §8).
- Webhook payments for obligations whose claim has an anomaly → `REJECT_DUPLICATE` (`ANOMALY_PENDING`) → review (§4.2 R6). They are never auto-applied.

**Resolution:** `resolve_anomaly` (Finance / Super; §4.7):

| Option | Preconditions | Attempt transition | Claim transition |
|---|---|---|---|
| `adopt {orderId}` | `orderId` ∈ anomaly orders; fetch-validated (G1); **every other anomaly order was never exposed** (no `exposedAt` on its attempt and not returned by any response) | → RECOVERED → revalidate → ACTIVE | anomaly cleared; other orders recorded in `retainedOrders` with `anomaly_found` **only if** they could have been exposed; never-exposed orphans recorded in claim events only |
| `supersede_all` | **No** anomaly order was ever exposed | → SUPERSEDED | anomaly cleared; holder cleared; derived OPEN (release condition 1) |
| `retain_all` | Any anomaly order was or may have been exposed | → RETIRED (if exposed) or SUPERSEDED (if never exposed) | anomaly cleared; all possibly-exposed orders → `retainedOrders` (`anomaly_found`); derived RETAINED |

**Audit:** claim event + attempt event + `auditLogs`. **Idempotency:** `requestId` (§4.0). **Failure:** 409 if preconditions fail, with no partial change.

### 2.5 Gateway payment, allocations and refunds

- **`gatewayPayments/{paymentId}`**, created with `create()`.
- **Immutable identity:** `paymentId`, `orderId`, `amountPaise`, `currency`, `captureState: "captured"`, `intentId?`, `attemptId?`, `boundPlayerId?` (from the intent), `capturedAt`, `firstEventId`.
- **Application** ∈ `applied | rejected_duplicate | unmatched | reversed`, set at creation. It is changed later only by `apply_reviewed_payment` (→ `applied`) and `complete_gateway_reversal` (→ `reversed`); each change appends a payment event and keeps the prior value in the event.
- **Allocations (B7):** `gatewayPayments/{id}/allocations/{alloc_<paymentId>}`, created with `create()`, so **at most one allocation per payment**. Fields:
  - `obligationKeys[]`, `perObligationPaise[]`, `basis: "intent_bound" | "attempt_bound" | "finance_attested"`
  - `decidedBy` (`system` | uid), `reason`, `requestId`, `at`
  - `targetPlayerId`, `payerIdentityEvidence` (finance-attested only).
  - The webhook APPLY writes the allocation with basis `intent_bound` / `attempt_bound`.
- **Refunds:** `gatewayPayments/{id}/refunds/{refundId}` (append-only rows) `{amountPaise, state: initiated|processed|failed, obligationKey?, evidence, timestamps}`.
  - Summary on the payment: `refundInitiatedPaise`, `refundProcessedPaise`, `refundPendingCount`, `refundStatus` ∈ `not_required | required | partially_refunded | refunded | intervention_required`.
  - Invariant: Σ non-failed refund rows ≤ `amountPaise`.
  - `processed` only with evidence (G5-dependent webhook, or a Finance dashboard record).
  - **`initiated` never counts as refunded.**
- **Anomalies:** `gatewayPayments/{id}/anomalies/{an_<hash>}` (B5).

### 2.6 Exposure and claim-release rules (B6)

**Adding to `retainedOrders`** (always together with a claim event):

| Event | Retained entry |
|---|---|
| An ACTIVE holder is retired (`retire_exposed`; manual settle, sponsor or waive with acknowledgement; `apply_reviewed_payment` with `retireConflictingAttempt`) | `{orderId: holder's, reason: "exposed_retired"}`; holder cleared |
| Any payment is **applied** to the obligation (webhook APPLY or `apply_reviewed_payment`) | `{orderId: the payment's order, reason: "paid_applied"}`; holder cleared if it was that attempt. *Rationale: whether a paid order can accept another payment is unverified (G3)* |
| `resolve_anomaly retain_all` / `adopt` | possibly-exposed anomaly orders, `reason: "anomaly_found"` |

**Releasing a claim (removing retained orders or clearing a holder so that new order creation becomes possible) is permitted ONLY when:**

| # | Condition | Mechanism | Status |
|---|---|---|---|
| 1 | **The order was never exposed** | Holder attempt in a never-exposed state → `supersede` (§4.7), or FAILED_NO_ORDER, or `resolve_anomaly supersede_all`. Never-exposed orders are **never added** to `retainedOrders` in the first place | Available |
| 2 | **The gateway confirms the order cannot be paid**, by a reliable, documented verification | `verify_orders_unpayable {orderIds}` (Finance / Super). Requires a reviewer-approved, evidence-backed gateway rule (G3: a paid order cannot accept another payment; and/or G7: order cancelled or expired) **and** a per-order fetch-by-ID check at action time recorded as evidence | **Disabled** until G1 + G3/G7 are verified and the rule is approved (Q17) |
| 3 | **Authorised `expose_replacement` override** | Finance / Super; `reason` (≥ 20 chars), `acknowledgeTwoPayableOrders: true`, `requestId`; sets `overrideActive`; a new attempt may become holder **while retained orders stay retained** (claim → HELD_OVERRIDE) | **Disabled by default** (Q13); enabling requires a written Finance policy |

**Nothing else releases a claim.** In particular: obligation reversal, waiver, sponsorship, manual settlement, refunds (including full processed refunds), and time do not.

### 2.7 Reversal workflow matrix (B6)

Common to all reversals:
- Finance or Super Admin only;
- `reason` required; `requestId` (§4.0);
- one transaction;
- compare-and-set on `settlementVersion`;
- an append-only settlement event that references the original event;
- `auditLogs`;
- original settlement, payment and allocation records preserved.

**No reversal releases or clears a claim, and no reversal writes an attempt state.**

| Workflow | Obligation transition | Claim transition | Existing attempt transition | Exposed order remains payable? | Replacement order permitted after reversal? | Authorisation + audit |
|---|---|---|---|---|---|---|
| **R-M** `reverse_manual_settlement` | `settled_manual` → `unpaid` | **None** (event `reversal_observed`). If the claim was RETAINED (an order was exposed when cash was taken, §4.5) it **stays RETAINED** | None (the retired attempt stays RETIRED; terminal attempts unchanged) | **Yes**, if a retained order exists; a payment on it → REJECT_DUPLICATE (`ATTEMPT_RETIRED`) → review; Finance may `apply_reviewed_payment` | Only if the claim is OPEN (no order was ever exposed). If RETAINED → **no**, except via release condition 2 or 3 | Finance / Super; settlement event `manual_settlement_reversed`; claim event; audit |
| **R-G1** `initiate_gateway_reversal` | `settled_gateway` → `reversal_pending` | None (paid order already retained, `paid_applied`) | None (PAID is terminal) | **Unverified (G3)**; treated as possibly payable | No (obligation not unpaid) | Precondition: ≥ 1 refund row `initiated` for this payment earmarked to the obligation; payment event `reversal_initiated`; audit |
| **R-G2** `complete_gateway_reversal` | `reversal_pending` → `unpaid` or `waived` (Finance chooses, reason) | **None**: the paid order **stays retained** | None | Treated as possibly payable (G3); any payment on it → REJECT_DUPLICATE (`ADDITIONAL_PAYMENT_FOR_ATTEMPT`) → review | **No**, except release condition 2 (when G3 is verified) or 3. The obligation can be settled manually | Precondition: processed refunds earmarked to this obligation ≥ its allocated amount (**processed, not initiated**); allocation → `reversed`; payment event; settlement event `gateway_settlement_reversed`; audit |
| **R-G3** `cancel_gateway_reversal` | `reversal_pending` → `settled_gateway` | None | None | as above | No | Refund failed or abandoned; events; audit |
| **R-S** `reverse_sponsorship` | Sponsored obligation `sponsored` → `unpaid`; the sponsor's obligation amount restored (`feeOverride`, `sponsoring` cleared). Both in one transaction | **None** on either claim. Precondition: **the sponsor's claim is OPEN** (no holder, no retained, no anomaly), because restoring its amount would invalidate any order exposed at the old amount; else 409 `SPONSOR_HAS_ONLINE_ORDER` | None | The sponsored player's claim: if RETAINED (an order was exposed before sponsorship) it stays RETAINED and payable → review if paid | Sponsored obligation: only if its claim is OPEN; else release condition 2 or 3 | Precondition: the sponsor's obligation `unpaid` (else 409 `SPONSOR_ALREADY_PAID`, Q15); two cross-referenced settlement events; audit |
| **R-W** `reverse_waiver` | `waived` → `unpaid` | **None**; RETAINED stays RETAINED | None | Yes if retained; payment → review | Only if the claim is OPEN; else condition 2 or 3 | Precondition: if waived by abandonment, the match is no longer abandoned; settlement event `waiver_reversed`; audit |

**Consequence:** a reversal can make an obligation `unpaid` while online payment stays unavailable (RETAINED). The payer then pays by cash (`settle_manual`), or Finance applies a later payment on the retained order through review. **A reversal never creates a second payable order.**

---

## 3. Data model and identifiers

Revision 3 §3 is retained, with these changes.

- **Collections** (all server-only; `allow write: if false`):
  - `paymentAttempts` (+ `events`)
  - `paymentObligationClaims` (+ `events`; model §2.2)
  - `gatewayOrders`
  - `gatewayPayments` (+ `allocations`, `refunds`, `anomalies`, `events`)
  - `lateFeeObligations`, `subscriptionPeriods` (+ `settlementEvents`)
  - `adminRequests` (§4.0)
- **Read access:** Finance or Super Admin for attempts, payments and their subcollections, claims (read-only, for reconciliation screens), settlement events and admin requests. `gatewayOrders` is deny-all.
- **Canonical keys and doc IDs:** segments matching `^[A-Za-z0-9_\-]{1,128}$` or encoded as `b64:`; doc ID = prefix + base64url(SHA-256(key)); stored key compared on read; a collision → anomaly, fail closed.

| Obligation | Canonical key | Record |
|---|---|---|
| Match fee | `match|{matchId}|{paymentDocId}` | `matches/{m}/payments/{p}` |
| Other fee | `fee|{playerId}|{feeId}` | `players/{p}/otherFees/{f}` |
| Late fee | `latefee|{playerId}|{matchId}|{templateId}` | `lateFeeObligations/{lfo_…}` (+ display mirror `otherFees/{lfo_…}`; legacy `lf_${intentId}` via dry-run backfill; pre-backfill ambiguity → review) |
| Subscription period | `sub|{playerId}|{planId}|{periodStart}` | `subscriptionPeriods/{sp_…}` |
| Merchandise | `merch|{merchOrderId}` (server-minted) | `merchOrders/{id}` |

**Uniqueness:**

| Constraint | Mechanism |
|---|---|
| One attempt per gateway order ID | `gatewayOrders/{orderId}` `create()` |
| One accounting record per payment ID | `gatewayPayments/{paymentId}` `create()` |
| One allocation per payment | `allocations/alloc_<paymentId>` `create()` |
| One holder per claim | compare-and-set on `holderFence` |
| One settlement per obligation per cycle | `settlementVersion` compare-and-set |
| One gateway create per attempt | CREATING entered once (fenced) |
| One result per admin request | `adminRequests/{requestId}` `create()` |

- **Bundles:** at most 20 obligations per payment, all of one player. Footprint as in revision 3 §3.5, plus one claim-event write and one allocation per obligation (≤ about 130 writes worst case). The footprint is asserted in tests and fails closed. Platform limits were not re-verified here.

---

## 4. Rules: preconditions, actors, writes, transitions, audit, failure, retry, idempotency

### 4.0 Conventions for every rule

- **Transactions:** Firestore Admin SDK; all reads before writes; contention retried by the SDK; on exhaustion the route returns **503 `{retryable: true}`** and **no partial write is visible**.
- **Admin idempotency:** every admin action carries a client-generated `requestId` (UUID v4).
  - The transaction `create()`s `adminRequests/{requestId}` with `{action, payloadHash, actor, result}`.
  - Same `requestId` + same `payloadHash` → the stored result is returned (200, `idempotentReplay: true`), with no writes.
  - Same `requestId` + different payload → 409 `REQUEST_ID_REUSED`.
- **Webhook idempotency:** keyed on `gatewayPayments/{paymentId}` (and anomaly IDs). Status: 2xx only after commit; 503 on failure; **401** bad signature; **400** malformed JSON (R3).
- **Audit:** human actions → `auditLogs` (via `writeServerAudit`) **plus** domain events, in the same transaction. System actions → domain events.
- **Failure codes:**
  - 400 input invalid;
  - 401 / 403 authentication or role;
  - 404 not found;
  - **409 precondition** (body `{code}`, no writes);
  - 503 retryable.

### 4.1 Order route: `claimObligations` + create

| Item | Rule |
|---|---|
| Actor | Authenticated player (R1 guard); only their own obligations (L5) |
| Preconditions | 1–20 obligations, one player; each obligation `unpaid`; each claim derived **OPEN** (new attempt) or **HELD** by this payer's ACTIVE attempt with an identical obligation set and amount (reuse) |
| Reads | All obligation records + claims (+ holder attempts) |
| Writes (new) | Attempt CLAIMED (`obligationKeys`, `claimIds`, amount); each claim `holderAttemptId`, `holderFence` +1, claim event; late-fee obligations, subscription periods and merch orders minted if absent |
| Outcomes | settled → 409 `ALREADY_PAID`; RETAINED → 409 `ONLINE_PAYMENT_UNAVAILABLE`; ANOMALY → 409 `PAYMENT_UNDER_REVIEW`; HELD by another or non-ACTIVE attempt → 409 `PAYMENT_BEING_VERIFIED`; HELD reuse → revalidate (§2.3.1) → order, or 409; > 20 → 400 |
| Then | CREATING written **before** `orders.create({receipt: attemptId, notes: {intentId, attemptId}})`; response → persist + `gatewayOrders` create → ACTIVE + `exposedAt` → return. Failures classified per §2.3. **Expired-`reserving` takeover removed** |
| Retry and idempotency | A repeat request finds HELD → returns the same order (reuse) or 409. It never creates twice |

### 4.2 `decidePaymentApplication(attempt, obligations, paymentEvent)` (pure; evaluated in order)

| Rule | Condition | Decision |
|---|---|---|
| R1 | `gatewayPayments/{paymentId}` exists and immutable identity matches | `REPLAY` |
| R2 | exists and any identity field conflicts | `IDENTITY_CONFLICT` |
| R3 | No binding (unknown intent or attempt, no `intentId`) or contradiction (order, amount, currency vs intent or attempt) | `REJECT_INVALID` |
| R4 | Attempt **FAILED_NO_ORDER** | `REJECT_DUPLICATE` (`FAILED_NO_ORDER_CONTRADICTED`) + classification anomaly |
| R5 | Attempt **SUPERSEDED** / **RETIRED** | `REJECT_DUPLICATE` (`ATTEMPT_SUPERSEDED` / `ATTEMPT_RETIRED`) |
| R6 | Attempt **ANOMALY_MULTIPLE**, or any claim with an anomaly | `REJECT_DUPLICATE` (`ANOMALY_PENDING`) |
| R7 | Attempt PAID or CLOSED_UNAPPLIED (has `firstPaymentId`), or intent `paid` / `paid_unapplied` with a different payment | `REJECT_DUPLICATE` (`ADDITIONAL_PAYMENT_FOR_ATTEMPT`) |
| R8 | Any obligation not `unpaid`; or the claim holder ≠ this attempt; or the attempt is not the holder (incl. HELD_OVERRIDE, where a different attempt holds); or legacy late-fee ambiguity | `REJECT_DUPLICATE` (per-obligation reasons) |
| R9 | Amount ≠ current payable sum for the attempt's obligations (e.g. fee changed after exposure) | `REJECT_DUPLICATE` (`AMOUNT_NO_LONGER_MATCHES`) |
| R10 | Otherwise | `APPLY` |

**All or nothing:** one failing obligation rejects the whole payment.

### 4.3 Webhook transaction write sets (B2 + B8)

| Decision | Writes (single transaction) | Attempt / intent effect | Response |
|---|---|---|---|
| REPLAY | none | none | 200 `already_processed` |
| IDENTITY_CONFLICT | `anomalies/{an_<hash(event identity)>}` `create()` (exists → no write); dead-letter `anom_<paymentId>_<hash>` (`identity_conflict`, severity high); event on the bound attempt (if any) | **No state change** | 200 `recorded_for_investigation`; 503 if the write fails |
| REJECT_INVALID | usable `paymentId` → `gatewayPayments` `create()` `unmatched`, refund `required`; dead-letter; event on the bound attempt (if any). No usable ID → dead-letter only | **No state change** | 200 after commit |
| REJECT_DUPLICATE | `gatewayPayments` `create()` `rejected_duplicate` (reasons, bound intent and attempt), refund `required`; dead-letter `duplicate_payment`; attempt event `captured_payment_rejected` (+ `payment_during_anomaly` / `failed_no_order_contradicted` where applicable); R4 additionally creates a high-severity classification anomaly | **Only if** the attempt is in the CLOSED_UNAPPLIED-eligible set (§2.3): attempt → CLOSED_UNAPPLIED (`firstPaymentId`); intent `pending` → `paid_unapplied`. **Otherwise** (terminal, or ANOMALY_MULTIPLE): **no attempt or intent state change** | 200 after commit |
| APPLY | obligations → `settled_gateway` (+ events, `settlementVersion` +1, legacy fields); allocation `alloc_<paymentId>` (`attempt_bound` / `intent_bound`); `gatewayPayments` `create()` `applied`, refund `not_required`; `gatewayOrders` `create()` if absent; claim: holder cleared, order → `retainedOrders` (`paid_applied`), claim event; attempt → PAID (`firstPaymentId`); intent → `paid`; side effects (late-fee mirror, subscription expiry, merch Paid) | attempt PAID, intent paid | 200 after commit |

**Retry:** a 503 is retried by Razorpay; on retry R1 gives REPLAY (if committed) or the decision is re-evaluated (if not committed).
**Idempotency:** `create()` on `gatewayPayments` and anomaly IDs. Two concurrent deliveries → one commits, the other retries → REPLAY.

### 4.4 Order identity recovery (unchanged)

If the attempt lacks `gatewayOrderId`, and `notes.attemptId` / `notes.intentId`, amount and currency match → `gatewayOrders` `create()` **before** the decision. A conflicting link → IDENTITY_CONFLICT.

### 4.5 Manual settlement endpoint (`/api/finance/settlements`, Phase 1B)

| Action | Actor | Preconditions | Writes | Claim effect |
|---|---|---|---|---|
| `settle_manual {method, amountPaise}` | Finance / Super; Club Admin (match fees only) | obligation `unpaid` at version; claim not ANOMALY; claim not HELD by a non-ACTIVE attempt (409 `ONLINE_OUTCOME_UNKNOWN`); claim HELD by ACTIVE → requires `acknowledgeOpenOnlinePayment` (else 409 `OPEN_ONLINE_ORDER`) | obligation → `settled_manual`; settlement event; audit | If acknowledged: holder attempt → RETIRED (event); its order → `retainedOrders` (`exposed_retired`); holder cleared. **Retention persists after settlement and after any reversal** |
| `mark_sponsored {sponsorObligation}` | Finance / Super | as `settle_manual` for the sponsored obligation; **sponsor's claim OPEN** and sponsor obligation `unpaid` (its amount changes) | both obligations (one transaction); two events; audit | as above for the sponsored obligation's claim; sponsor's claim untouched |
| `waive {reason}` | Finance / Super; system (abandonment) | as `settle_manual` (system abandonment path: an ACTIVE holder is retired automatically with event `retired_by_abandonment`) | obligation → `waived`; events; audit | as above |
| `reverse_manual_settlement`, `reverse_sponsorship`, `reverse_waiver` | Finance / Super | §2.7 | §2.7 | **none** |
| `apply_fee_plan_status`, `set_merch_payment_status`, `set_studio_period` | as §9 | same claim checks as `settle_manual` when settling | per action | as above |

**Failure:** 409 with a code, no writes. **Retry:** same `requestId` → replay. **Coordination with the webhook:** the same obligation record (`settlementVersion`) and claim, inside transactions. No trigger is used for concurrency control.

### 4.6 `apply_reviewed_payment` (B7)

- **Actor:** Finance Admin or Super Admin.
- **Request:** `{requestId, paymentId, targetObligationKeys[], expectedSettlementVersions[], allocationBasis, reason, confirmUnverifiedPayer?, payerIdentityEvidence?, retireConflictingAttempt?}`.
- **Reads (one transaction):**
  - `gatewayPayments/{paymentId}` + `allocations` + `refunds` + `anomalies`;
  - `gatewayOrders/{orderId}` → its attempt;
  - the bound intent;
  - every target obligation + claim + holder attempt.

**Validation decision table** (evaluated in order; first failure → 409 with `code`, **no writes**):

| # | Condition | Outcome |
|---|---|---|
| V1 | `gatewayPayments/{paymentId}` missing | 404 `PAYMENT_NOT_FOUND` (payments enter only via the signed webhook) |
| V2 | **Payment ID exists with different immutable attributes**: any open entry in `anomalies`, or the request's expected `orderId`/amount/currency differ from the stored identity | 409 `PAYMENT_IDENTITY_CONFLICT`; must be investigated first |
| V3 | `captureState` ≠ `captured` | 409 `NOT_CAPTURED` |
| V4 | Application is `applied` (or `reversed`), or allocation `alloc_<paymentId>` exists, **already allocated to another obligation or to these** | Same `requestId` → idempotent replay (200). Otherwise 409 `ALREADY_ALLOCATED` (includes "allocated to another obligation") |
| V5 | Application not in {`rejected_duplicate`, `unmatched`} | 409 `NOT_REVIEWABLE` |
| V6 | **Order ID:** the payment's `orderId` is linked in `gatewayOrders` to an attempt whose `obligationKeys` ≠ `targetObligationKeys` (exact set) | 409 `TARGET_DIFFERS_FROM_ORDER` (no cross-obligation reallocation of an order-bound payment in R4; Q18) |
| V7 | **Currency** ≠ every target obligation's currency (`INR`) | 409 `CURRENCY_MISMATCH` |
| V8 | **Refund fully processed** (`refundProcessedPaise == amountPaise`) | 409 `ALREADY_REFUNDED` |
| V9 | **Refund initiated, completion unknown** (`refundPendingCount > 0`) | 409 `REFUND_IN_PROGRESS` (initiated ≠ refunded; wait for the outcome) |
| V10 | **Net amount** = `amountPaise − refundProcessedPaise` (partial refund processed counts; failed refunds count 0) | used in V11 |
| V11 | **Amount:** net amount **equals** Σ current payable amounts of the target obligations | proceed |
| | net **lower** than the obligation sum (underpayment; includes a partial refund that leaves less) | 409 `AMOUNT_LOWER`. **Partial payments are not supported**: never applied; stays in review (refund or Finance arranges the remainder manually; Q19) |
| | net **higher** than the obligation sum (overpayment) | 409 `AMOUNT_HIGHER`. Finance must first record a refund of the excess and have it **processed**; the net then equals the sum and the action can be repeated (new `requestId`) |
| V12 | Target obligations not all `unpaid` at `expectedSettlementVersions`, or not all one player, or more than 20 | 409 `OBLIGATION_STATE_CHANGED` / `MIXED_PLAYERS` / 400 |
| V13 | **Player identity bound** (payment has `boundPlayerId` via intent or attempt): target player ≠ `boundPlayerId` | 409 `PAYMENT_BELONGS_TO_DIFFERENT_PLAYER` (no cross-player allocation in R4; Q18) |
| V14 | **Player identity unavailable** (`unmatched` with no bound intent or attempt) | Allowed **only** with `allocationBasis: "finance_attested"`, `confirmUnverifiedPayer: true`, `reason` (≥ 20 chars) and `payerIdentityEvidence` (free text reference: what was checked, e.g. payer confirmation; no PII beyond what Finance already holds; Q20 decides whether a second approver is required). Otherwise 409 `PAYER_UNVERIFIED`. **Never inferred from a guess**: the server requires these fields and records them |
| V15 | Any target claim has an anomaly | 409 `ANOMALY_PENDING` (resolve first, §2.4) |
| V16 | A target claim is HELD by a **different ACTIVE** attempt | 409 `CONFLICTING_ACTIVE_ORDER` unless `retireConflictingAttempt: true` |
| V17 | A target claim is HELD by a non-ACTIVE, non-terminal attempt (UNKNOWN, RECONCILING, RECOVERED, ACTIVATION_FAILED) | 409 `ONLINE_OUTCOME_UNKNOWN` |

**Writes on success (one transaction):**
1. `allocations/alloc_<paymentId>` `create()`: obligation keys, per-obligation amounts, basis, `decidedBy`, reason, `requestId`, `targetPlayerId`, evidence. This is **separate from** the immutable payment identity, which is not modified.
2. Payment application `rejected_duplicate` / `unmatched` → `applied`; refund status → `not_required` if no refund is processed, else `partially_refunded`. Payment event recording the previous application value.
3. Each obligation → `settled_gateway` (`gatewayPaymentId`, `allocationId`), `settlementVersion` +1, settlement event.
4. Each claim: if `retireConflictingAttempt`, the conflicting attempt → RETIRED (event) and its order → `retainedOrders` (`exposed_retired`); the payment's order → `retainedOrders` (`paid_applied`); holder cleared; claim event.
5. Payment's attempt (if bound):
   - RETIRED or other CLOSED_UNAPPLIED-eligible with `firstPaymentId` unset → **PAID** (`firstPaymentId`);
   - CLOSED_UNAPPLIED whose `firstPaymentId` is this payment → **unchanged** (terminal; event `applied_after_review`);
   - other terminal → unchanged (event only).
6. Bound intent: `pending` or `paid_unapplied` with `firstPaymentId` = this payment → event only, **state unchanged** (the first outcome is immutable); `pending` → `paid`.
7. `adminRequests/{requestId}`, `auditLogs`.

**Failure:** 409 / 400 per the table, no writes. **Retry:** contention → 503; client repeats with the same `requestId` → replay or re-evaluation. **Idempotency:** `adminRequests` + `alloc_<paymentId>` `create()`. Duplicate webhook delivery of the same payment after allocation → R1 REPLAY (identity unchanged).

### 4.7 Other Finance actions (`/api/finance/payment-attempts`)

| Action | Actor | Preconditions | Transitions and writes | Audit |
|---|---|---|---|---|
| `reconcile {attemptId}` | Finance / Super / worker | attempt non-terminal | per §2.3 (fetch-by-ID if the order is known; receipt lookup only after the settle delay, Q4; 0 → stays UNKNOWN) | attempt event (+ audit if human) |
| `attach_order {attemptId, orderId}` | Finance / Super | attempt UNKNOWN / RECONCILING; order fetch-validated (G1); `gatewayOrders` create succeeds | → RECOVERED → revalidate → ACTIVE, or stays RECOVERED | events + audit |
| `supersede {attemptId}` | Finance / Super | attempt never exposed (§2.3 list, `exposedAt` unset) | → SUPERSEDED; claim holder cleared (release condition 1) if it was holder | events + audit |
| `retire_exposed {attemptId}` | Finance / Super | attempt ACTIVE | → RETIRED; claim: order → retained (`exposed_retired`), holder cleared | events + audit |
| `resolve_anomaly` | Finance / Super | §2.4 | §2.4 | events + audit |
| `verify_orders_unpayable {orderIds}` | Finance / Super | **Disabled** until G1 + G3/G7 verified and the rule approved (Q17); then: each order fetched and shown unpayable by the approved rule | removes those orders from `retainedOrders` (release condition 2); evidence stored in a claim event | events + audit |
| `expose_replacement {obligationKeys}` | Finance / Super | **Disabled by default** (Q13); `reason` ≥ 20 chars; `acknowledgeTwoPayableOrders: true`; claim RETAINED (not ANOMALY) | `overrideActive` set; a new attempt may claim the obligation (→ HELD_OVERRIDE); retained orders **stay** | claim event + audit |
| `record_refund_initiated {paymentId, refundId, amountPaise, obligationKey?}` | Finance / Super | Σ non-failed rows + amount ≤ captured | refund row `initiated`; summary recomputed | events + audit |
| `record_refund_outcome {refundId, processed|failed, evidence}` | Finance / Super (or the refund webhook after G5) | row `initiated` | row → processed / failed; summary | events + audit |
| `initiate_gateway_reversal`, `complete_gateway_reversal`, `cancel_gateway_reversal` | Finance / Super | §2.7 | §2.7 | §2.7 |

All of these use `requestId` idempotency, 409 on a failed precondition with no writes, and 503 on contention.

---

## 5. Failure and concurrency matrix

**Guarantee wording:** *no more than one payment is applied to an obligation per settlement cycle; every additional captured payment is separately recorded and routed to refund review; refund completion is tracked separately and only on evidence.*

| # | Case | Expected result | Second payable order? |
|---|---|---|---|
| 1 | Timeout before or after the gateway; crash before persistence; lease expiry in flight | OUTCOME_UNKNOWN, blocked; recovery only via `reconcile` / `attach_order`; else `supersede` (never exposed) | No |
| 2 | Late response after `supersede` | Record-only `orderIdLate`; never exposed; payment → R5 review | No |
| 3 | Supersede of an exposed order | Refused; `retire_exposed` keeps the order retained | No |
| 4 | New request while a retained order exists | 409 `ONLINE_PAYMENT_UNAVAILABLE` | No |
| 5 | **R-M while an exposed order remains payable** | Obligation unpaid; claim stays RETAINED; online 409; payment on the old order → review | **No** |
| 6 | **R-S while an exposed order remains payable** | Sponsored obligation unpaid; claim stays RETAINED; sponsor precondition enforced | **No** |
| 7 | **R-W while an exposed order remains payable** | As case 5 | **No** |
| 8 | **R-G (refund processed) while the original order remains exposed** | Obligation unpaid or waived only after a processed refund; paid order stays retained; online 409 | **No** |
| 9 | Replacement attempted without override | 409 (override disabled, or missing acknowledgement) | **No** |
| 10 | Replacement with authorised override | HELD_OVERRIDE; two payable orders **recorded**; any second payment → review | Yes, **recorded and authorised** |
| 11 | Two payments on one intent / one order; second payment after the first applied | First APPLY; second REJECT_DUPLICATE; first intent and attempt unchanged | – |
| 12 | Duplicate delivery of an applied or rejected payment | REPLAY | – |
| 13 | Same payment ID, different identity | IDENTITY_CONFLICT; original untouched | – |
| 14 | Late captured payment for **SUPERSEDED** | REJECT_DUPLICATE (`ATTEMPT_SUPERSEDED`); attempt stays SUPERSEDED (event only) | – |
| 15 | Late captured payment for **FAILED_NO_ORDER** | REJECT_DUPLICATE (`FAILED_NO_ORDER_CONTRADICTED`) + classification anomaly; attempt stays FAILED_NO_ORDER | – |
| 16 | Multiple orders found for one attempt or obligation | ANOMALY_MULTIPLE / claim anomaly; all creation 409; payments → review until `resolve_anomaly` | No |
| 17 | Manual cash ↔ webhook (both orderings) | One settles; the other REJECT_DUPLICATE or 409 | – |
| 18 | `apply_reviewed_payment` ↔ webhook (both orderings) | Serialised; single application | – |
| 19 | `apply_reviewed_payment` validation failures (V1–V17) | Exact 409 / 404 / 400 codes; no writes | – |
| 20 | Reversal ↔ webhook (both orderings) | Single application per cycle; claim never released | No |
| 21 | Refund initiated, completion unknown | Not refunded; blocks `apply_reviewed_payment` (V9) and R-G2 | – |
| 22 | Waived, abandoned or sponsored after exposure | Holder retired (acknowledgement or system abandonment); payment → review | No |
| 23 | Bundle > 20; mixed players | 400 / 409 | – |
| 24 | Rollback with HELD / RETAINED / ANOMALY claims or unknown attempts | Legacy creation blocked (§8) | No |

---

## 6. Invariants

| # | Invariant |
|---|---|
| I1 | Single application per obligation per settlement cycle |
| I2 | Accounting: one immutable `gatewayPayments` per payment ID; application ∈ {applied, rejected_duplicate, unmatched, reversed}; ≤ 1 allocation per payment; Σ non-failed refunds ≤ captured; processed only with evidence; **initiated ≠ refunded** |
| I3 | **Exposure (B6):** an exposed or paid order is added to `retainedOrders` and removed only by release condition 2. A claim allows new creation only when derived OPEN, or under a recorded override (HELD_OVERRIDE) |
| I4 | No automatic re-creation; `supersede` only for never-exposed attempts |
| I5 | Zero is not absence |
| I6 | Fencing on all claim and attempt writes |
| I7 | All R4 records server-written; no client-writable attempt, claim, payment, allocation, refund or settlement data |
| I8 | **Terminal immutability (B8):** PAID, CLOSED_UNAPPLIED, SUPERSEDED and FAILED_NO_ORDER attempts never change `state`, `firstPaymentId` or `exposedAt`; an intent's first terminal state never changes; later events are appended only |
| I9 | Identity integrity: an existing payment record is never overwritten; a conflict → anomaly |
| I10 | No silent reversal: `settled_gateway` → `unpaid` / `waived` only after a processed refund ≥ allocation; history preserved |
| I11 | **Entity separation:** obligation = settlement; claim = online orders; attempt = one create; payment = money. **No obligation transition releases a claim** |
| I12 | Atomic audit: events (+ `auditLogs` for humans) in the same transaction |
| I13 | No secrets or PII; `payerIdentityEvidence` is a reference, not raw payer data |
| I14 | Bounded transactions (≤ 20 obligations; footprint asserted) |
| I15 | **Anomaly blocking:** while a claim has an anomaly, no order creation and no automatic application succeeds |
| I16 | **Allocation provenance:** every applied payment has exactly one allocation with basis and decider; finance-attested allocations carry a reason and evidence and are never created without `confirmUnverifiedPayer` |

---

## 7. Test matrix (mandatory)

**Conventions:**
- **Layers:** unit (pure functions and transition tables), emulator transaction, route integration (real handlers + deterministic gateway stub with release handles and injected clock), gateway contract (fixtures F1–F3; G1–G7 when verified), regression (all existing suites).
- **Races:** both orderings (→ / ←), repeated N times with seeds, through real route handlers.
- **Every row asserts:** HTTP code; obligation, claim, attempt and payment states; claim `retainedOrders`; **stub orders created and orders exposed**; event and audit rows.

**Carried from revision 3, adjusted:**
- T1–T7, T8–T13 (B2, B5), T14–T17 (B1), T19–T26, as in revision 3.
- Adjustments: T18 (reversals) and T20 (`apply_reviewed_payment`) are superseded by the B6 and B7 rows below.
- Assertions that previously expected a claim to be `settled` or `open` after settlement or reversal now expect §2.2 derived states.

**New and replacement rows:**

| # | Scenario | Must show |
|---|---|---|
| **B6-1** | Manual settlement (acknowledged) while ACTIVE → R-M | Attempt RETIRED; claim RETAINED after settlement **and after reversal**; obligation unpaid; new online request 409; **stub orders created = 1, exposed = 1** |
| **B6-2** | Sponsorship over an exposed order → R-S | As B6-1; sponsor precondition: sponsor claim not OPEN → 409; sponsor paid → 409 |
| **B6-3** | Waiver (manual and by abandonment) over an exposed order → R-W | As B6-1; abandonment guard |
| **B6-4** | Gateway-settled → refund initiated → R-G1 → refund **processed** → R-G2 | Claim RETAINED (`paid_applied`) throughout; R-G2 refused while only initiated; online 409 after R-G2; a payment on the original order → REJECT_DUPLICATE |
| **B6-5** | Replacement without override (override disabled; enabled but missing acknowledgement or short reason) | 403 / 409; no attempt created; stub orders unchanged |
| **B6-6** | Replacement with authorised override and acknowledgement | HELD_OVERRIDE; retained orders unchanged; new order exposed; audit + claim event; a payment on the old order → review; one payment on the new order → APPLY |
| **B6-7** | R-M where no order was ever exposed (cash only) | Claim OPEN after reversal; new online order allowed (control case) |
| **B6-8** | Each reversal ↔ webhook (both orderings) | Single application; claim never released |
| **B7-1** | Exact amount, intent-bound | Applied; allocation `intent_bound`; claim retains the order; attempt PAID |
| **B7-2** | Lower amount | 409 `AMOUNT_LOWER`; no writes |
| **B7-3** | Higher amount; then excess refund recorded **processed**; retry with new `requestId` | 409 `AMOUNT_HIGHER`, then success; net = sum |
| **B7-4** | Currency mismatch | 409 `CURRENCY_MISMATCH` |
| **B7-5** | Fully refunded | 409 `ALREADY_REFUNDED` |
| **B7-6** | Partial refund processed leaving net = sum / net < sum | success / 409 `AMOUNT_LOWER` |
| **B7-7** | Refund initiated, outcome unknown | 409 `REFUND_IN_PROGRESS` |
| **B7-8** | Already allocated to another obligation; same `requestId` replay; different `requestId` | 409 `ALREADY_ALLOCATED`; replay 200 with no writes |
| **B7-9** | Unmatched (no payer identity) without / with `finance_attested` + confirmation + reason + evidence | 409 `PAYER_UNVERIFIED` / success with a separate allocation record; payment identity unchanged |
| **B7-10** | Bound to a different player | 409 `PAYMENT_BELONGS_TO_DIFFERENT_PLAYER` |
| **B7-11** | Payment ID with a conflicting identity anomaly | 409 `PAYMENT_IDENTITY_CONFLICT` |
| **B7-12** | Order-bound payment targeting a different obligation set | 409 `TARGET_DIFFERS_FROM_ORDER` |
| **B7-13** | Not captured; not reviewable (already applied) | 409 `NOT_CAPTURED` / `ALREADY_ALLOCATED` |
| **B7-14** | Conflicting ACTIVE holder without / with `retireConflictingAttempt` | 409 / success with the conflicting attempt RETIRED and both orders retained |
| **B7-15** | Duplicate webhook delivery of the payment **after** allocation; contention 503 then retry with the same `requestId` | REPLAY with no writes; replay result identical |
| **B8-1** | Late captured payment for SUPERSEDED | REJECT_DUPLICATE; attempt **remains SUPERSEDED**; event appended; intent unchanged |
| **B8-2** | Late captured payment for FAILED_NO_ORDER | REJECT_DUPLICATE + classification anomaly; attempt **remains FAILED_NO_ORDER** |
| **B8-3** | Duplicate event for an already-PAID attempt (same payment, and a different payment) | REPLAY / REJECT_DUPLICATE; attempt PAID, `firstPaymentId` unchanged |
| **B8-4** | Duplicate payment on a paid obligation via a different attempt | REJECT_DUPLICATE; original settlement, allocation and attempt unchanged |
| **B8-5** | Multiple gateway orders discovered (one attempt receipt; and across attempts for one obligation) | ANOMALY_MULTIPLE / claim anomaly; creation 409; payment during anomaly → review, attempt state unchanged |
| **B8-6** | `resolve_anomaly` adopt / supersede_all / retain_all, each with violated preconditions | Exact transitions per §2.4; violations 409, no writes |
| **B8-7** | Repeated delivery of the same late event (B8-1/B8-2 payment delivered 3×, including concurrently) | One `gatewayPayments` record, one dead-letter, one anomaly; repeats REPLAY |
| **B8-8** | CLOSED_UNAPPLIED eligibility table (each listed state) | Eligible → CLOSED_UNAPPLIED; ANOMALY_MULTIPLE and terminal → unchanged |

---

## 8. Migration, compatibility and rollback

Revision 3 §8 is retained, with these changes.
- **Legacy reservations:** an `active` reservation with an exposed order → synthetic ACTIVE attempt **and** a claim holder. A legacy **paid** reservation → the paid order is added to `retainedOrders` (`paid_applied`). More than one legacy order for one obligation (D1 history) → claim anomaly.
- **Non-flaggable guard:** after Phase 2, every creation path, legacy included, refuses obligations whose claim is HELD, RETAINED, HELD_OVERRIDE or ANOMALY, or whose attempts are non-terminal. Rollback of flags never bypasses it. The Phase 1A decision function stays on.
- The late-fee backfill stays dry-run first, and production writes need owner approval.

---

## 9. Role mapping (Q11, explicit)

| Action | Super | Finance | Club | Designer | Player |
|---|---|---|---|---|---|
| Pay own obligation online | ✓ | ✓ | ✓ | ✓ | ✓ |
| `settle_manual` match fee | ✓ | ✓ | ✓ | ✗ | ✗ |
| `settle_manual` other / late fee; `mark_sponsored`; `waive`; all reversals | ✓ | ✓ | ✗ | ✗ | ✗ |
| `set_studio_period` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `set_merch_payment_status` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `reconcile`, `attach_order`, `supersede`, `retire_exposed`, `resolve_anomaly` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `apply_reviewed_payment`, refund records, gateway reversal | ✓ | ✓ | ✗ | ✗ | ✗ |
| `expose_replacement` (when enabled) | ✓ | ✓ | ✗ | ✗ | ✗ |
| `verify_orders_unpayable` (when enabled) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Read attempts, claims, payments, refunds, anomalies | ✓ | ✓ | ✗ | ✗ | ✗ |

---

## 10. Unresolved questions and assumptions

| # | Question / assumption | Recommendation | Owner of decision |
|---|---|---|---|
| Q2 | Second payment for the same subscription period | Review (refund) | Owner |
| Q3 | Automatic unblock after OUTCOME_UNKNOWN | No | Owner (confirm) |
| Q4 | Settle delay and back-off | ≥ 10 min, 30 min, 2 h, 24 h | Owner |
| Q5 | Payer-facing wording for every 409 code | Owner to approve copy | Owner |
| Q6 | Manual settlement while ACTIVE | 409 unless acknowledged (retire + retain) | Owner |
| Q7 | Refund execution | Manual via the dashboard; recorded | Owner |
| Q11 | Role mapping | §9 | **Owner to confirm** |
| Q12 | Phase 1B workflow switch-over | Approve | **Owner** |
| Q13 | Enable `expose_replacement` at all | **Disabled**; enable only with a written policy | **Owner** |
| Q14 | Partial refund of an applied payment | Keeps the obligation settled | Owner |
| Q15 | Reverse sponsorship after the sponsor paid | Out of scope; 409 | Owner |
| Q16 | Bundle limit 20 | Confirm against data | Owner |
| **Q17** | Rule for release condition 2 | Only after G1 + G3/G7 evidence and reviewer approval | Reviewer + owner |
| **Q18** | Cross-obligation or cross-player reallocation of an order-bound payment | Not in R4 (refund instead) | Owner |
| **Q19** | Partial payments | **Not supported**; underpayment stays in review | Owner |
| **Q20** | Second approver for `finance_attested` allocations | Recommended: Super Admin confirmation, or two distinct Finance users | **Owner** |
| **Q21** | Reversal of a subscription period (expiry recomputation) and merch fulfilment after reversal | Expiry recomputed from remaining settled periods; merch fulfilment unchanged, flagged | Owner |

**Assumptions** (to be verified, not relied upon for safety):
- **A1:** Razorpay `orders.create` 400 / 401 validation bodies prove non-creation (G6). Until verified, FAILED_NO_ORDER is limited to those; a contradiction raises an anomaly (§4.2 R4).
- **A2:** Retained orders are treated as payable (G3, G7 unverified). This is safe but costs availability.
- **A3:** Test mode behaves as live (not verified).

**Gateway checks** (reviewer approval; test mode only; none assumed):
- **G1:** fetch by ID.
- **G2:** payments per order.
- **G3:** a second payment on a paid order.
- **G4:** time-window listing.
- **G5:** refund webhooks and partial or multiple refunds.
- **G6:** non-creation errors.
- **G7:** order cancellation or expiry.

---

## 11. Phased implementation plan and dependencies

Unchanged from revision 3 §11, with these scope additions:

| Phase | Additions in revision 4 |
|---|---|
| 1A | Claim model fields needed by the decision (`retainedOrders`, anomaly) are created **read-compatibly** (missing claim = OPEN); R4–R10 decision rules; terminal immutability; allocations; tests B8-1…B8-4, B8-7, B8-8, B6-4 (decision part) |
| 1B | Retention on manual settle, sponsor or waive with acknowledgement; reversals never touching claims; tests B6-1…B6-3, B6-7, B6-8 |
| 2 | Derived claim states, the anomaly flag, legacy anomaly detection; tests B8-5 |
| 4 | `supersede` / `retire_exposed` / `expose_replacement` (disabled); tests B6-5, B6-6 |
| 5 | `apply_reviewed_payment` (§4.6), `resolve_anomaly`, refund records, R-G; `verify_orders_unpayable` stays **disabled**; tests B7-1…B7-15, B8-6 |

**Full D1/D2/D3 financial-integrity coverage is claimed only after 1A and 1B.**

---

## 12. Cross-cutting consistency check (performed for revision 4)

| Area | Check | Result |
|---|---|---|
| Obligation ↔ claim | Does any obligation transition write the claim other than retention? | Only retention (§4.3, §4.5, §4.6) and anomaly; fixed X1–X5 |
| Claim ↔ attempt | Is a claim holder always a non-terminal attempt? | Yes; holder cleared when the attempt becomes PAID, RETIRED, SUPERSEDED or FAILED_NO_ORDER |
| Attempt ↔ payment | Do later payments change terminal attempts? | No (I8); fixed X6 |
| Payment ↔ refund | Is "initiated" ever treated as refunded? | No: V9, R-G2, I2 |
| Manual ↔ online | Same coordination records? | Yes (obligation version + claim) |
| Sponsorship | Two-record atomicity and sponsor's exposed orders | R-S / `mark_sponsored` require the sponsor's claim OPEN |
| Waiver / abandonment | System waiver with an ACTIVE holder | Holder retired automatically (event), retained |
| Late fees | Separate obligation, claim and attempt? | Yes (`lateFeeObligations`) |
| Subscription | Period identity; renewals not blocked; reversal | Period-scoped; Q21 |
| Merchandise | Server-minted IDs; repeat purchases | Yes |
| Bundles | All-or-nothing across decision, allocation, retention | Yes; ≤ 20, one player |
| Webhook ↔ dead-letter | Every non-applied payment has a dead-letter and payment record | Yes (§4.3) |
| Finance ↔ audit | Every human action: `requestId`, events, `auditLogs` | Yes (§4.0) |
| Revision 3 corrections | B1–B5 and C1–C6 preserved? | Yes. B1 strengthened (retention extended to paid orders and reversals); C1 replaced by §4.6; no safety invariant weakened |

---

## 13. NOT approved for implementation

- **Everything in this document.** No phase may start until the independent reviewer approves revision 4 **and** the owner gives explicit approval.
- In particular, even after design approval, the following each need **separate** approval:
  - Phase 1A and Phase 1B, individually;
  - the late-fee backfill against production (dry-run report first);
  - Firestore rules deployment (only via `main`; affects both databases);
  - enabling `expose_replacement` (Q13);
  - enabling `verify_orders_unpayable` (Q17, after G1 + G3/G7 evidence);
  - any gateway check G1–G7 (test mode);
  - the Phase 1B client switch-over (Q12);
  - any production deployment.
- **No implementation of R2-B, R6 or any other workstream is implied.**

---

## 14. Resolution matrix: B6 / B7 / B8

| Requirement | Resolution | Section |
|---|---|---|
| **B6** Separate obligation status, claim status and order/attempt status | Four-entity table; claim has no settlement state; derived claim states | §2 intro, §2.2, I11 |
| B6 Reversal must not implicitly release a claim | No reversal writes a claim; release only by three conditions | §2.6, §2.7, I3, I11 |
| B6 Preserve `retained_exposed` unless verified unpayable | Retention on retire, on paid, on anomaly; condition 2 disabled until verified | §2.6 |
| B6 Release only when never exposed / gateway-verified / override | Exactly three conditions, with mechanisms and status | §2.6, §4.7 |
| B6 Override disabled by default, with reason, acknowledgement and audit | `expose_replacement`, Q13 | §2.6, §4.7, Q13 |
| B6 Per-workflow obligation / claim / attempt / payability / replacement / authorisation / audit | Reversal matrix | §2.7 |
| B6 Tests: R-M, R-S, R-W, R-G with exposed order; replacement without / with override | B6-1 … B6-8 | §7 |
| **B7** Validate payment ID and immutable identity; order ID; capture; amount; currency; refunds; prior allocation; target and player identity | V1–V17 | §4.6 |
| B7 Equal / lower / higher amount; currency mismatch; refunded; partial refund; initiated-unknown; allocated elsewhere; identity unavailable; different player; conflicting identity | V2, V4, V7–V11, V13, V14 | §4.6 |
| B7 No allocation by guess; explicit confirmation, reason and immutable audit; original identity kept separate | `finance_attested` basis; separate `allocations` record; Q20 | §2.5, §4.6 V14, I16 |
| B7 Partial payments | Not supported; underpayment stays in review; overpayment requires a processed excess refund | §4.6 V11, Q19 |
| B7 `refund_initiated` ≠ refunded | V9, R-G2, I2 | §4.6, §2.7, §6 |
| B7 Tests incl. retries and duplicate delivery after allocation | B7-1 … B7-15 | §7 |
| **B8** SUPERSEDED and FAILED_NO_ORDER remain terminal; late or duplicate events append only | Terminal rule; R4 / R5; write-set table | §2.3, §4.2, §4.3, I8 |
| B8 Only eligible non-terminal attempts → CLOSED_UNAPPLIED | Eligibility table | §2.3 |
| B8 Preserve the original paid intent and attempt; record the duplicate independently | REJECT_DUPLICATE write set; I8 | §4.3 |
| B8 `ANOMALY_MULTIPLE`: attempt vs claim, owner, transitions, Finance resolution, no bypass | Lifecycle, `resolve_anomaly`, blocking, I15 | §2.4, §4.1, §4.2 R6, §8 |
| B8 Tests | B8-1 … B8-8 | §7 |
| Cross-cutting review | Contradictions X1–X7 fixed; consistency table | §0.2, §12 |
| Unresolved questions and NOT-approved section | Q2–Q21, A1–A3, G1–G7; explicit list | §10, §13 |
