# R4 — Razorpay Order Concurrency, Ambiguous Outcomes and Duplicate Payments: Architecture Design (revision 7)

**Status:** DESIGN ONLY, for independent review. **Not approved for implementation** (§14). Revision 7 resolves findings B19 and B20 from the review of revision 6 (`cbba0da`) and clarifies capability status terms (§0.C). No application code, Firestore rules, tests, test configuration or data changed. No Razorpay call, migration, deployment or production operation.
**Branch / base:** `mig-mov` @ `cbba0da`
**Date:** 2026-11-24

**Evidence base:**
- Run `r4mwtfrkta4202`: `docs/qa/R4/evidence/R4_EXPERIMENT_RESULTS_AND_ANALYSIS.md`.
- Re-check: `docs/qa/R4/evidence/supplemental-e5-recheck/E5_RECHECK_RESULTS.md`.

**Resolution matrices:** B19–B20 §17; B15–B18 §15; B9–B14 §16.

---

## 0. Summary, evidence and guarantees

### 0.A Revision 7 summary

| Finding | Revision 6 | Revision 7 |
|---|---|---|
| **B19** retirement vs release | One operation `supersede` and one terminal state `SUPERSEDED` covered both "create never sent" (releases) and "create may have been sent" (retains); the RECOVERED path was unclear | Three independent concerns, each with its own named operation (§2.10): (1) **ending an attempt** (`supersede_unsent`, `abandon_attempt`, `retire_exposed`); (2) **retaining orders** (automatic in every operation after CREATING); (3) **releasing the claim**: only `supersede_unsent` (`CREATE_NOT_SENT_PROVEN`). New terminal state **ABANDONED** for post-CREATING abandonment. `reactivate_attempt` is the normal path for RECOVERED and ACTIVATION_FAILED |
| **B20** refund ↔ reversal binding | RF completed "a reversal request for line k" with loosely defined binding | Reversal requests bound to payment, allocation, line, amount, target and expected version; **one pending request per allocation line** via a line lock; RF checks eight conditions atomically and **always records the refund fact**, completing the reversal only if every condition holds; `map_refund` never infers the line; concurrency outcomes table (§2.9.2–§2.9.5) |
| Capability terms | "Disabled", "recommendation" used informally | Four-level status taxonomy; every gated capability listed with its current status (§0.C) |

### 0.B Terminology rule (normative, revision 7)

- **`supersede_unsent` / SUPERSEDED** means *the create request was never sent* (`CREATE_NOT_SENT_PROVEN`). It is the only operation that releases a claim.
- **`abandon_attempt` / ABANDONED** means *the create request may have been sent*. It **never** releases; it always retains the known order or a placeholder.
- **Where revision ≤ 6 text says "supersede" or "SUPERSEDED" for an attempt that had committed CREATING** (for example "superseded from UNKNOWN", "late response after supersede from CREATING", B15-1, B15-2, B15-8, B16-5, failure rows 26, 43, Q5, Q29), read **`abandon_attempt` / ABANDONED**. Revision 7's operative sections (§2.3, §2.4, §2.6.1, §2.10, §4.1, §4.2, §4.4, §4.6.3, §4.8) use the new names.
- **"Retire"** (`retire_exposed` / RETIRED) is used only for exposed (ACTIVE) attempts, as before.

### 0.C Capability status taxonomy (revision 7)

| Status | Meaning | Who changes it |
|---|---|---|
| **DISABLED_BY_DEFAULT** | The capability is gated off. If code exists, the gate refuses (403 / 409 with a code). **Recommendations and owner preferences never change this status** | – |
| **ENABLED_BY_OWNER_DECISION** | Requires *all* of: an explicit written owner approval naming the capability; independent reviewer approval of the evidence it depends on (G-checks); a recorded configuration change (flag) with `requestId`, approver and audit. It applies only to the named environment | Owner + reviewer |
| **IMPLEMENTED_NOT_DEPLOYED** | Code merged on a branch and tested; not running in any environment | Implementation phase approval |
| **DEPLOYED_OPERATIONALLY_VERIFIED** | Running in a named environment **and** verified there by independent QA with evidence | Deployment approval + QA |

**Current status of every gated capability:** none is implemented; all are design-only.

| Capability | Default | Required to enable | Current status |
|---|---|---|---|
| `expose_replacement` (one-time override) | DISABLED_BY_DEFAULT | Owner decision (Q13, Q22, Q25) | Design only; disabled |
| `verify_orders_unpayable`; `resolve_anomaly adopt` / `supersede_all` | DISABLED_BY_DEFAULT | G1 + G3/G7 evidence, Q17 | Design only; disabled |
| FAILED_NO_ORDER classification (and release via it) | DISABLED_BY_DEFAULT | G6 evidence, Q26 | Design only; disabled |
| Refund webhook ingestion | DISABLED_BY_DEFAULT | G5 evidence, Q27 | Design only; disabled |
| Client order acknowledgement | DISABLED_BY_DEFAULT | Q23 | Design only; disabled |

**Recorded recommendations (Q13, Q20, Q22–Q25) are not enablement** and do not change any status above.

### 0.1 Revision 6 summary (retained)

| Finding | Revision 5 | Revision 6 |
|---|---|---|
| **B15** exposure vs gateway payability | One class, `NEVER_EXPOSED_PROVEN`, both described the application response **and** permitted release of the claim, so a never-returned orphan was treated as harmless | **Two independent dimensions** per gateway order (§2.8): *application exposure* (`APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN` / `APPLICATION_EXPOSURE_UNKNOWN` / `APPLICATION_EXPOSURE_ACKNOWLEDGED`) and *gateway payability* (`GATEWAY_PAYABILITY_UNKNOWN` / `GATEWAY_UNPAYABLE_PROVEN`, the latter **disabled** until verified). **Release never depends on application exposure.** The only local proof that permits release is **`CREATE_NOT_SENT_PROVEN`** (the create request was never sent). Every known orphan and every possibly-existing order of an ambiguous attempt is **retained** (§2.6, §2.8.4). `supersede`, `resolve_anomaly`, L1–L7 and migration updated |
| **B16** override races | Lifecycle states only | Race matrix for every concurrent pair, trusted server time evaluated inside each transaction, a fail-closed expiry boundary with skew margin, revocation rules, and **CONSUMED is permanent**; recovery is reconciliation of the bound attempt only (§2.6.2) |
| **B17** refund ↔ reversal atomicity | R-G2 a separate Finance action after the refund was processed; non-deterministic external refunds rejected | **One local transaction RF** records the verified refund outcome and, where it completes a requested line reversal, writes the line-reversal evidence, payment application, obligation settlement, events and audit together (§2.9). External refund facts are always recorded (`unresolved` mapping if needed). Failure and retry rules, duplicate and conflicting evidence, and externally-processed refunds defined |
| **B18** sponsorship invariants | Base + adjustments | Eight explicit invariants with **deterministic adjustment IDs**, sponsorship state CAS, a non-negative payable check, and fail-closed `reconciliation_required` for multi-row or unreconstructable legacy data (§2.7.3) |

### 0.2 Contradictions removed in revision 6

Revision 5's X8–X14 still apply.

| # | Revision 5 text | Problem | Revision 6 |
|---|---|---|---|
| X15 | §2.6: release condition 1 "`NEVER_EXPOSED_PROVEN`" | Equated "no application response" with "not payable" (B15) | Release condition 1 is now `CREATE_NOT_SENT_PROVEN` (§2.6.1) |
| X16 | §2.4: `adopt` / `supersede_all` released other orders that had never been exposed | Same as X15 | `adopt` and `supersede_all` are disabled until gateway verification; `retain_all` is the only resolution (§2.4) |
| X17 | §4.4 L2/L3/L6 and B10-4: orphans "not retained" | Same as X15 | Orphans retained (§4.4) |
| X18 | §2.3: FAILED_NO_ORDER on 400/401 bodies "pending G6", but used for release | Release relied on an unverified assumption (A1) | FAILED_NO_ORDER **disabled** until G6 (Q26); errors → OUTCOME_UNKNOWN |
| X19 | §2.5.2: non-deterministic refund mapping → "reject the record" | An external processed refund cannot be rejected; it already happened (B17) | Recorded as `unresolved`; C3 suspended; Finance `map_refund` (§2.5.2, §2.9) |
| X20 | §2.7.1: R-G2 is a later manual step | The obligation and the payment could diverge from the refund fact (B17) | R-G2 completed inside transaction RF (§2.9.2) |
| X21 | §2.7.2: adjustments `adj_<uuid>` | Duplicate requests could create two adjustments (B18) | Deterministic IDs (§2.7.3) |
| X22 | §2.6.1: expiry "lazily, at first read" with an unspecified clock | Ambiguous boundary (B16) | Trusted server time inside the transaction; fail-closed boundary (§2.6.2) |

### 0.3 Evidence (unchanged)

- **F1:** duplicate receipts accepted.
- **F2:** receipt listing eventually consistent.
- **F3:** orphan orders confirmed. **They exist at Razorpay even though the caller never received their IDs.**
- **F4 (unverified):** live mode, fetch-by-ID, payments-per-order, a second payment on a paid order, cancellation or expiry, refund webhooks and partial refunds, non-creation errors.

**Firestore cannot make a Razorpay order unpayable, and absence of an application response does not make an order unpayable.**

### 0.4 Guarantees

- **G-A:** ≤ 1 payment applied per obligation per settlement cycle.
- **G-B:** one immutable accounting record per captured payment; every unapplied payment is reviewed; refunds are accounted per obligation; *initiated ≠ processed*.
- **G-C:** no obligation gains a new payable order while any earlier order **may** exist and be payable, unless every such order is gateway-verified unpayable (**disabled**) or a one-time override is consumed (**disabled by default**).
- **G-D:** no automatic re-creation after an ambiguous attempt.
- **G-E (revised):** release requires proof that **no order can exist** (`CREATE_NOT_SENT_PROVEN`) or proof that every existing order is **unpayable** (disabled). Absence of exposure evidence is never sufficient.

**Availability consequence, stated explicitly:** an ambiguous create whose order is **later recovered** keeps working (the same order is revalidated and offered to the payer, §4.4 L1). But an ambiguous create that Finance **supersedes** leaves the obligation **unavailable for online payment** (cash and manual settlement still work) until gateway verification is approved (Q17) or a one-time override is used (Q13). This is the intended fail-closed trade-off.

## 1. Current-state architecture (verified; unchanged)

- **Order creation:** `app/api/razorpay/order/route.ts`:
  - `requireAuth` `:38`, `derivePayableAmount` `:82` (`lib/razorpay-order.ts:1283`; late fees `:1347`);
  - request-shape keys `generateReservationKey` `:9`; `acquirePaymentReservation` `:313` with expired-`reserving` takeover `:361–436`;
  - create path `:484–555`; failures `:557–600`;
  - `reconcileAmbiguousReservation` `:656` (A `:698`, B `:852`, zero-match `:1010` blocked; stale comment `:653`; no resolution tool).
- **Online fulfilment:** `lib/razorpay-webhook.ts` `processWebhookIntentTransaction` `:235`:
  - per-intent idempotency `:263–275`; branches `:419` / `:457` / `:516` / `:569`; late fees `lf_${intentId}` `:370`; reservation `isPaid` `:602`;
  - no obligation check;
  - dead-letter in a separate transaction (`app/api/razorpay/webhook/route.ts:58`).
- **Manual settlement:** client-side (`hooks/useStore.ts`):
  - `updatePaymentStatus` ≈`:1800`; `applyFeePlanToPayment` ≈`:2155`;
  - sponsorship `assignProxyPayment` and clear path ≈`:2225–2365` (**sponsorship overwrites the sponsor's `feeOverride`, sets `sponsoring`; the clear path deletes them**);
  - otherFees; `updateMerchOrder` `:2765`; Studio expiry editors;
  - allowed by Finance-admin rules and `isMatchAdminPaymentUpdate` (`firestore.rules:279`).
- **Paths D1–D5 and suspected Q8:** as in revision 3 §1.4.

---

## 2. Entities and state machines

| Entity | Authoritative for |
|---|---|
| Obligation (match payment, other fee, `lateFeeObligations`, `subscriptionPeriods`, `merchOrders`) | Settlement state, amount components (§2.7.2), `settlementVersion`, settlement events |
| Claim (`paymentObligationClaims`) | Online-order coordination: holder, retained orders, anomaly, bound override |
| Attempt (`paymentAttempts`) | One gateway `orders.create`; its own order's lifecycle and exposure marker |
| Gateway order link (`gatewayOrders`) | Every known gateway order: owning attempt, discovery source, **exposure classification** |
| Gateway payment (`gatewayPayments`) | Captured money: identity, application, allocation, refunds, anomalies |
| Override (`claimOverrides`) | One-time authorisation for one replacement attempt |
| Adjustment (`obligationAdjustments`) | Append-only amount changes (sponsorship and others) |

### 2.1 Obligation settlement state machine (unchanged from revision 4, plus `basis`)

- **States:** `unpaid`, `settled_gateway` (basis `webhook` | `reviewed`), `settled_manual`, `sponsored`, `waived`, `reversal_pending`.
- **Transitions:** as in revision 4 §2.1. Direct `settled_gateway` → `unpaid` is forbidden.
- Every transition is one transaction: CAS on `settlementVersion` (+1), an append-only settlement event, and `auditLogs` for humans.
- **No obligation transition releases a claim.**

### 2.2 Claim model (revised for B15)

**Fields:**
- `canonicalKey`
- `holderAttemptId | null`, `holderFence`
- `retainedOrders[]`: **known** gateway orders that may be payable: `{orderId, attemptId?, reason: exposed_retired | paid_applied | paid_rejected | orphan_discovered | anomaly_found | legacy, applicationExposure, gatewayPayability, since}`
- `retainedPossibleOrders[]` (**new**): placeholders for orders that **may exist but whose IDs are unknown**: `{attemptId, receipt, reason: create_outcome_unknown | legacy_unknown, since}`. Removed only when the order is found (then replaced by a `retainedOrders` entry in the same transaction) or by release condition 2/3 (§2.6.1)
- `anomaly: false | {attemptIds[], orderIds[], since, source}`
- `boundOverrideId | null`
- `version`
- append-only `events`

| Derived state | Condition | Order creation |
|---|---|---|
| OPEN | no holder, no retained orders, no placeholders, no anomaly | new attempt allowed |
| HELD | holder; no retained; no placeholders; no anomaly; no bound override | none; the holder's ACTIVE order is returned after revalidation, else 409 |
| RETAINED | no holder; ≥ 1 retained order **or placeholder**; no anomaly | none (409 `ONLINE_PAYMENT_UNAVAILABLE`), unless an override is bindable (§2.6.2) |
| HELD_OVERRIDE | holder = the override's bound attempt; ≥ 1 retained order or placeholder; no anomaly | none; the holder's ACTIVE order is returned after revalidation, else 409 |
| ANOMALY | anomaly set | none (409 `PAYMENT_UNDER_REVIEW`); overrides cannot bind |

**Retention-while-held rule:** adding a retained order or placeholder to a claim whose holder is a *different* attempt also sets the **anomaly** flag (two possibly-payable orders). The single exception is an entry that predates the holder's bound override (recorded in `retainedOrdersAtAuthorisation`).

### 2.3 Attempt state machine

- **Non-terminal:** CLAIMED, CREATING, ORDER_RECEIVED, ACTIVATION_FAILED, ACTIVE, OUTCOME_UNKNOWN, RECONCILING, RECOVERED, ANOMALY_MULTIPLE, RETIRED.
- **Terminal:** PAID, CLOSED_UNAPPLIED, SUPERSEDED (create **never sent**; revision 7), **ABANDONED** (create **may have been sent**; revision 7), FAILED_NO_ORDER (disabled).

**Terminal rule (I8):** once terminal, the attempt document's fields `state`, `fenceVersion`, `gatewayOrderId`, `exposure`, `firstPaymentId` and `obligationKeys` are **never written**. All later facts (late order, late payment, review decision) are recorded on `gatewayOrders`, `gatewayPayments`, the claim, and as **appended** `paymentAttempts/{id}/events` rows.

| From | To | Trigger | Actor |
|---|---|---|---|
| CLAIMED | CREATING | create about to be sent (fenced; consumes a bound override, §2.6) | system |
| CLAIMED | SUPERSEDED | **`supersede_unsent`** (§2.10). Create never sent (`CREATE_NOT_SENT_PROVEN`) → the **only** operation that releases a claim | Finance / Super |
| CREATING | ORDER_RECEIVED | 2xx with valid `order.id` (in memory) | system |
| CREATING | FAILED_NO_ORDER | **Disabled until G6 is verified and approved (Q26).** Until then every create error, including 400/401, → OUTCOME_UNKNOWN. When enabled: complete HTTP 400 `BAD_REQUEST_ERROR` or 401 body only | system |
| CREATING | OUTCOME_UNKNOWN | any other outcome, incl. crash or lease expiry observed by another reader (**the observer bumps the fence**) | system |
| ORDER_RECEIVED | (persisted: `gatewayOrderId` set) | **Persist transaction P** (§2.8.1) | system |
| ORDER_RECEIVED (persisted) | ACTIVE | **Activation transaction A** commits the response-authorisation marker (§2.8.1) | system |
| ORDER_RECEIVED (persisted) | ACTIVATION_FAILED | transaction A failed (marker **not** committed) | system |
| ORDER_RECEIVED (not persisted) | OUTCOME_UNKNOWN | transaction P failed after retries; lease expiry observed (order exists, unrecorded) | system |
| ACTIVATION_FAILED, RECOVERED | ACTIVE | revalidation + activation transaction A (§2.3.1) | system / Finance `reconcile` |
| OUTCOME_UNKNOWN | RECONCILING | `reconcile` | Finance / worker |
| OUTCOME_UNKNOWN | RECOVERED | late response recorded by the original process **while the attempt is non-terminal** (§4.4 case L1) | system |
| RECONCILING | RECOVERED / OUTCOME_UNKNOWN / ANOMALY_MULTIPLE | 1 found / 0 or lookup failed / > 1 | system |
| ANOMALY_MULTIPLE | RETIRED / ABANDONED | `resolve_anomaly retain_all` (§2.4); `adopt` disabled until G1+G3/G7 (Q17) | Finance / Super |
| ACTIVE | PAID | first captured payment applied (webhook) | system |
| ACTIVE | RETIRED | `retire_exposed`; manual settle / sponsor / waive with acknowledgement; abandonment; `apply_reviewed_payment` with `retireConflictingAttempt` | Finance / Super (Club for match-fee `settle_manual`); system |
| CREATING, OUTCOME_UNKNOWN, RECONCILING, RECOVERED, ACTIVATION_FAILED | **ABANDONED** | **`abandon_attempt`** (§2.10), only if application exposure is `APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN`. **No release:** known order → `retainedOrders`; unknown → placeholder. RECOVERED and ACTIVATION_FAILED normally go through `reactivate_attempt` instead | Finance / Super |
| eligible (below) | CLOSED_UNAPPLIED | first captured payment for this attempt rejected | system |
| ACTIVE, RETIRED (marker committed) | SUPERSEDED / ABANDONED | **Forbidden** (exposed attempts use `retire_exposed`) | – |
| any terminal | any | **Forbidden** | – |
| RETIRED | PAID | **Forbidden** (removed in revision 5, X9) | – |

**CLOSED_UNAPPLIED eligibility:** ACTIVE, RETIRED, ACTIVATION_FAILED, OUTCOME_UNKNOWN, RECONCILING, RECOVERED, with `firstPaymentId` unset. In the same transaction: `firstPaymentId`; `gatewayOrderId` if unset and the order is linked to this attempt.
- ANOMALY_MULTIPLE → unchanged (event).
- Terminal → unchanged (event).

#### 2.3.1 Revalidation (unchanged; precedes every activation transaction A on a non-fresh path)

1. Claim holder is this attempt at its fence; no anomaly.
2. Obligations `unpaid` at the expected versions.
3. Payer binding unchanged.
4. Amount = fresh payable (§2.7.2); currency matches.
5. Order fetched by ID (G1) matches amount, currency and `notes.attemptId`, with status `created` / `attempted`.

### 2.4 `ANOMALY_MULTIPLE` lifecycle (revised for B15)

- **Definition:** (a) an attempt state: more than one order for one attempt's receipt; (b) a claim flag: more than one possibly-payable order or placeholder for one obligation (incl. the retention-while-held rule, §2.2) or an order-identity conflict (§4.4 L7).
- **Blocking:** creation (§4.1), automatic application (§4.2 R6), override binding (§2.6.2) and reviewed application (§4.6 V15) are refused while an anomaly is set.

**`resolve_anomaly` options:**

| Option | Status | Preconditions | Effect |
|---|---|---|---|
| `retain_all` | **Available** | Actor Finance / Super; `requestId`; reason; claim anomaly set | One transaction: every anomaly order → `retainedOrders` (`anomaly_found`, with both dimensions); unknown-ID possibilities → `retainedPossibleOrders`. Attempt: ANOMALY_MULTIPLE → RETIRED if any of its orders had a committed response marker, else **ABANDONED** (state change only; **no release**). Holder cleared; anomaly cleared; claim + attempt events; `auditLogs`. Result: derived RETAINED |
| `adopt {orderId}` | **Disabled** until G1 + G3/G7 are verified and Q17 is approved | Every *other* anomaly order must be `GATEWAY_UNPAYABLE_PROVEN` | (when enabled) the chosen order's attempt → RECOVERED → revalidate → ACTIVE; others stay retained with `GATEWAY_UNPAYABLE_PROVEN`, which removes them per release condition 2 |
| `supersede_all` | **Disabled** (same gate) | Every anomaly order `GATEWAY_UNPAYABLE_PROVEN`, or the attempt `CREATE_NOT_SENT_PROVEN` | (when enabled) release per §2.6.1 |

- **Failure:** 409 `ANOMALY_OPTION_DISABLED` / precondition codes, no writes.
- **Retry:** 503 on contention, then repeat with the same `requestId`.
- **Idempotency:** `adminRequests/{requestId}`; a repeated `retain_all` after success → replay.

### 2.5 Gateway payments, allocations and refunds

#### 2.5.1 Payment and allocation

- **`gatewayPayments/{paymentId}`** (`create()`); immutable identity: `paymentId`, `orderId`, `amountPaise`, `currency`, `captureState`, `intentId?`, `attemptId?`, `boundPlayerId?`, `capturedAt`, `firstEventId`.
- **Application:** `applied | rejected_duplicate | unmatched | reversed | partially_reversed`; changes are recorded as payment events.
- **Allocation:** `allocations/alloc_<paymentId>` (`create()`, **immutable**; ≤ 1 per payment). Fields: `lines[]: {obligationKey, allocatedPaise}`, `basis: webhook_intent | webhook_attempt | reviewed_bound | reviewed_finance_attested`, `decidedBy`, `reason?`, `requestId?`, `targetPlayerId`, `payerIdentityEvidence?`, `at`.
  - **Constraint:** Σ `allocatedPaise` == net captured at allocation time (§2.5.2), and each `allocatedPaise` == that obligation's payable amount at that time.
- **Per-line reversal:** `allocations/alloc_<paymentId>/lineReversals/{obligationKey-hash}` (`create()`, once per line).

#### 2.5.2 Deterministic refund ledger (B12)

**Rows:** `gatewayPayments/{id}/refunds/{refundId}`, doc ID = Razorpay refund ID (`rfnd_…`), `create()`, so a refund can never be recorded twice.
- Fields: `amountPaise`, `mapping` (see below), `state: initiated | processed | failed`, `evidence`, timestamps.
- State changes once: `initiated` → `processed` | `failed`.

**Mapping (`mapping` field):**

| Payment situation | Required mapping | Rule |
|---|---|---|
| Not allocated (`rejected_duplicate`, `unmatched`) | `{type: "payment"}` | Reduces payment-level net only |
| Allocated, single line | `{type: "line", obligationKey}`, implied if omitted | Deterministic |
| Allocated, multiple lines | **`{type: "line", obligationKey}` or `{type: "split", lines: [{obligationKey, amountPaise}]}`, mandatory** | A refund on an allocated bundle **without** an explicit per-line mapping is **rejected (400 `REFUND_MAPPING_REQUIRED`)**. Finance must decide which obligations the refund relates to |

**Derived amounts** (recomputed **from all rows** inside every transaction that reads or changes refunds, never incrementally):

| Quantity | Definition |
|---|---|
| `captured` | `amountPaise` |
| `reservedTotal` | Σ amounts of rows in `initiated` ∪ `processed` (failed excluded) |
| `processedTotal` | Σ amounts of `processed` rows |
| `netCaptured` | `captured − processedTotal` |
| `line.reserved(k)` | Σ mapped amounts to line k in `initiated` ∪ `processed` |
| `line.processed(k)` | Σ mapped amounts to line k in `processed` |
| `line.net(k)` | `allocatedPaise(k) − line.processed(k)` |
| `aggregateNetAllocated` | Σ `line.net(k)` |
| `pendingCount` | number of `initiated` rows |

**Enforced constraints** (checked when a row is created and on every transition; violation → 409, no write):

| # | Constraint |
|---|---|
| C1 | `reservedTotal ≤ captured`: total refunds, including initiated, never exceed captured |
| C2 | For each line k: `line.reserved(k) ≤ allocatedPaise(k)`. The net allocation to an obligation never exceeds what it owed, and a refund can't reduce a line below zero |
| C3 | `aggregateNetAllocated ≤ netCaptured`. Holds with equality when every processed row is line-mapped. **Suspended only while an `unresolved` external row exists** (payment `intervention_required`; all line-dependent actions blocked) |
| C4 | A row mapped to line k changes only `line.*(k)`; other lines' figures are untouched (mapping is explicit and immutable) |
| C5 | No double counting: one row per Razorpay refund ID (`create()`); one state change per row; totals recomputed from rows |
| C6 | `initiated` is never `processed`: only `processed` rows reduce `net`; `initiated` rows reserve capacity (C1/C2) and block actions that need certainty (§4.6 V9, R-G2) |

**Lifecycle effects:**
- **Multiple partial refunds:** additional rows, each C1–C5 checked.
- **Failed refund:** the row → `failed`; its reservation is released (excluded from `reserved*`); the payment summary becomes `intervention_required` until Finance records a follow-up.
- **Per-line reversal (R-G2):** allowed for line k only when `line.processed(k) == allocatedPaise(k)` and no `initiated` row maps to k. It creates `lineReversals/{k}`. Payment application → `partially_reversed`, or `reversed` when all lines are reversed.
- **Non-deterministic mapping, locally initiated** (Finance records a refund on an allocated bundle without a line mapping): rejected (400 `REFUND_MAPPING_REQUIRED`).
- **Non-deterministic mapping, external fact** (a refund already **processed** at Razorpay, reported by the refund webhook or recorded by Finance with evidence, that cannot be mapped deterministically): **recorded, never rejected**, as a row with `mapping: {type: "unresolved"}`. It counts in `reservedTotal` and `processedTotal` (C1) but in no `line.*`; C3 is suspended for that payment; the payment → `intervention_required`; every action that relies on line figures (R-G2, apply, line refunds) is blocked until Finance runs `map_refund` (§2.9.3).

**Summary fields on the payment** (cache, rewritten in the same transaction from rows): `refundReservedPaise`, `refundProcessedPaise`, `netCapturedPaise`, `refundPendingCount`, `refundStatus` ∈ `not_required | required | partially_refunded | refunded | intervention_required`.

### 2.6 Claim release and the one-time override (revised for B15, B16)

#### 2.6.1 Retention and release rules

**Retention** (added in the same transaction as the triggering event, with a claim event):

| Trigger | Entry |
|---|---|
| ACTIVE holder retired (`retire_exposed`; settle / sponsor / waive with acknowledgement; abandonment; reviewed application with `retireConflictingAttempt`) | `retainedOrders` (`exposed_retired`) |
| A captured payment recorded for an order (applied or rejected) | `retainedOrders` (`paid_applied` / `paid_rejected`) |
| A gateway order learned by any route other than as the current holder's own order: late response, reconciliation, webhook, Finance attach, migration | `retainedOrders` (`orphan_discovered` / `legacy` / `anomaly_found`), **regardless of application exposure** (B15) |
| An attempt that may have sent a create (it committed CREATING) leaves the holder role without a known order: `abandon_attempt` from CREATING / OUTCOME_UNKNOWN / RECONCILING / RECOVERED / ACTIVATION_FAILED; FAILED_NO_ORDER while G6 is unverified | `retainedPossibleOrders` (`create_outcome_unknown`, receipt = `attemptId`) |
| Legacy reservation in `reconciliation_*` without an order ID | `retainedPossibleOrders` (`legacy_unknown`) |

**Release.** Clearing a holder for re-creation, removing a retained order, or removing a placeholder is permitted **only** when:

| # | Condition | Sufficient evidence | Status |
|---|---|---|---|
| 1 | **`CREATE_NOT_SENT_PROVEN`**: the attempt never sent a create request | The attempt is CLAIMED and has never committed CREATING (CREATING is committed **before** the request is sent, §4.1), **and** its fence was bumped by the superseding transaction, so it can never commit CREATING afterwards. Evidence: attempt events show no `create_sent` / CREATING; transaction log of the fence bump | **Available** (`supersede_unsent`, §2.10 O1; `revoke_override` of a bound CLAIMED attempt, which invokes O1) |
| 1b | Definitive gateway rejection proving non-creation (FAILED_NO_ORDER) | G6 verified and the rule approved (Q26) | **Disabled** |
| 2 | **`GATEWAY_UNPAYABLE_PROVEN`** for every retained order **and** every placeholder resolved to a known order | Approved gateway rule (G3 and/or G7) **and** a per-order fetch-by-ID check at action time (G1), recorded as evidence. Placeholders with unknown IDs can **never** satisfy this (zero lookups are not absence) | **Disabled** (Q17) |
| 3 | **One-time override** consumed by exactly one replacement attempt | §2.6.2; retained orders and placeholders stay recorded | **Disabled by default** (Q13) |

**Never sufficient:**
- absence of a response marker (`APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN`);
- a receipt lookup returning zero;
- time elapsed;
- refunds;
- reversals;
- settlement;
- Finance opinion without one of the mechanisms above.

#### 2.6.2 One-time override: record, transitions and race matrix (B16)

- **Record:** `claimOverrides/{ov_<uuid>}`: `obligationKeys[]`, `reason` (≥ 20 chars), `acknowledgeTwoPayableOrders: true`, `authorisedBy`, `secondApprovalBy?` (Q25), `requestId`, `state`, `boundAttemptId?`, `authorisedAt`, `expiresAt`, `retainedOrdersAtAuthorisation[]`, `retainedPossibleOrdersAtAuthorisation[]`, `consumedAt?`, append-only `events`.
- **Feature flag:** disabled by default (Q13). When disabled, `authorise_override` → 403 `OVERRIDE_DISABLED`.

**Trusted time.**
- `serverNow` is read from the **application server's clock** (NTP-synchronised; never a client-supplied value) **at the start of each transaction attempt**, so it is re-read on every SDK retry.
- `expiresAt = authorisedAt + 24 h` (Q22); fixed at authorisation and **never extended** (release does not extend it).
- **Expiry boundary (fail-closed):** an override is *live* iff `serverNow + SKEW_MARGIN < expiresAt`, with `SKEW_MARGIN` = 60 s. At or after `expiresAt − SKEW_MARGIN` it is treated as expired. A transaction that observes this writes `state = EXPIRED` (lazy expiry) with event `expired_observed {serverNow}`.

**Transitions** (each one Firestore transaction; CAS on `state`; events + `auditLogs` for humans):

| From | To | Action / trigger | Actor | Preconditions (in the same transaction) | Writes |
|---|---|---|---|---|---|
| – | AUTHORISED | `authorise_override` | Finance / Super (+ second approver, Q25) | flag on; all claims derived RETAINED; no anomaly; no other live override for these keys | override doc; claim events; audit |
| AUTHORISED / RELEASED | BOUND | `claimObligations` (§4.1) | system (payer request) | live (time rule); covers exactly the requested keys; claims RETAINED; no anomaly | override `BOUND`, `boundAttemptId`; claims holder = attempt, `boundOverrideId`; attempt CLAIMED (`overrideId`); events |
| BOUND | CONSUMED | attempt CLAIMED → CREATING | system | override `BOUND` with `boundAttemptId` = this attempt; attempt fence valid. **No time check: binding already happened while live** | override `CONSUMED`, `consumedAt`; attempt CREATING; events |
| BOUND | RELEASED | `supersede_unsent` of the bound attempt (O1, `CREATE_NOT_SENT_PROVEN`) | Finance / Super | attempt CLAIMED, never CREATING | attempt SUPERSEDED (fence bump); claims holder cleared, `boundOverrideId` cleared; override `RELEASED`; events; audit |
| AUTHORISED / RELEASED | EXPIRED | any transaction observing the time rule | system | not live | `EXPIRED`; event |
| AUTHORISED / RELEASED | REVOKED | `revoke_override` | Finance / Super | state still AUTHORISED / RELEASED | `REVOKED`; events; audit |
| BOUND | REVOKED | `revoke_override` | Finance / Super | bound attempt still CLAIMED (create never sent) | attempt SUPERSEDED (fence bump); claims holder cleared; override `REVOKED`; events; audit |
| CONSUMED / EXPIRED / REVOKED | any | – | – | **Forbidden** (terminal) | – |

**Race matrix** (Firestore serialises conflicting transactions on the override, claim and attempt documents; the loser re-runs, sees the new state, and fails its CAS):

| Race | Outcome A (left commits first) | Outcome B (right commits first) |
|---|---|---|
| AUTHORISED → BOUND vs expiry boundary | Bind committed while live: BOUND; expiry no longer applies to BOUND | The bind transaction itself observes not-live → writes EXPIRED, returns 409 `OVERRIDE_EXPIRED`; no binding |
| AUTHORISED → BOUND vs revocation | BOUND; revoke re-runs → BOUND with a CLAIMED attempt → bound-revocation path (attempt SUPERSEDED, override REVOKED) | REVOKED; bind re-runs → 409 `OVERRIDE_REVOKED` |
| RELEASED → BOUND vs expiry | As the first row; `expiresAt` is unchanged by release | As the first row |
| RELEASED → BOUND vs revocation | As the second row | As the second row |
| BOUND → CREATING vs revocation | CONSUMED; the create is sent; revoke re-runs → 409 `OVERRIDE_CONSUMED` | REVOKED + attempt SUPERSEDED (fence bump); CREATING re-runs → fence/CAS fails → **no create sent**; the payer request gets 409 |
| BOUND → RELEASED (supersede from CLAIMED) vs concurrent CREATING | RELEASED + attempt SUPERSEDED; CREATING re-runs → fails → no create sent | CONSUMED + CREATING; supersede re-runs → attempt no longer CLAIMED → → 409 `CREATE_ALREADY_SENT`; Finance may use `abandon_attempt` (O2: no release; placeholder retained) and the override stays CONSUMED |
| Two payer requests binding the same override | One BOUND; the other re-runs → HELD_OVERRIDE → the bound attempt's order or 409 | (symmetric) |
| Transaction retry after a lost commit acknowledgement | The re-run reads the committed state (e.g. BOUND with its own attempt) → returns the same result (idempotent by `boundAttemptId` / `requestId`) | – |

**After consumption (timeout, crash, unknown outcome, persistence failure):** the override stays **CONSUMED permanently**. The only recovery is **reconciliation of `boundAttemptId`** (L1 RECOVERED → `reactivate_attempt` → ACTIVE, or Finance `abandon_attempt`, which retains the order or a placeholder). There is never automatic reuse and never a second binding. Another replacement requires a **new** override record (new approval and `requestId`), which can bind only once the claim is RETAINED again (holder cleared).

### 2.7 Reversal workflows

#### 2.7.1 Matrix (revision 4 §2.7 retained; amounts per §2.7.2)

| Workflow | Obligation | Claim | Attempt | Exposed order payable? | Replacement allowed? | Role + audit |
|---|---|---|---|---|---|---|
| R-M `reverse_manual_settlement` | `settled_manual` → `unpaid` | none (event) | none | yes if retained → payment → review | only if claim OPEN; else release condition 2 or 3 | Finance / Super; settlement event; audit |
| R-G1 `initiate_gateway_reversal {obligationKey, target}` | `settled_gateway` → `reversal_pending` | none | none (PAID terminal) | treated as payable (G3) | no | requires ≥ 1 refund row mapped to the line; creates `reversalRequests` (target recorded); completes in the same transaction if the line is already fully processed (§4.7) |
| R-G2 (completion) | `reversal_pending` → requested target (`unpaid` / `waived`) | none (paid order stays retained) | none | treated as payable | only release condition 2 or 3 | **Performed only inside transaction RF** (or R-G1 when already complete) when `line.processed(k) == allocatedPaise(k)` and no `initiated` row maps to k: line reversal + obligation transition + payment application + events + audit atomically (§2.9.2). No separate manual completion action (X20) |
| R-G3 `cancel_gateway_reversal` | `reversal_pending` → `settled_gateway` | none | none | – | no | refund failed or abandoned; request → `cancelled` |
| R-S `reverse_sponsorship` | §2.7.2 | none on either claim | none | sponsored claim RETAINED stays | only if the sponsored claim is OPEN | §2.7.2 |
| R-W `reverse_waiver` | `waived` → `unpaid` | none | none | yes if retained | only if claim OPEN | abandonment guard |

#### 2.7.2 Amounts and sponsorship (B13)

**Amount model** (all obligations whose amount can change: match fees, other fees):

| Component | Representation |
|---|---|
| **Base amount** | `amountBasePaise`: the fee from the fee plan / template / override decision. Changed only by `set_base_amount` (Finance, with event; this is today's `feeOverride` semantics) |
| **Adjustments** | `obligationAdjustments/{adjId}`, append-only, `create()` only: `{obligationKey, type: sponsorship_add \| sponsorship_remove \| other, amountPaise (signed), sponsorshipId?, compensatesAdjId?, by, reason, requestId, at}`. **Sponsorship adjustments use deterministic IDs** `adj_<sponsorshipId>_add` / `adj_<sponsorshipId>_remove` (§2.7.3); other adjustments use `adj_<requestId>` |
| **Payable amount** | `amountBasePaise + Σ adjustments(obligationKey)`, computed server-side (used by `derivePayableAmount`, revalidation and allocation) |
| **Sponsorship record** | `sponsorships/{sp_<uuid>}`: `{sponsoredKey, sponsorKey, amountPaise, state: active \| reversed, createdAdjIds, reversedAdjIds, sponsoredVersionAtCreate, sponsorVersionAtCreate}` |

**`mark_sponsored {sponsoredKey, sponsorKey}`** (Finance / Super; `requestId`; one transaction):

| Item | Rule |
|---|---|
| Preconditions | Sponsored obligation `unpaid` at its expected version; **sponsor obligation `unpaid` at its expected version**; **sponsor claim OPEN** (no holder, no retained, no anomaly), because a sponsor order exposed at the old amount must not exist; sponsored claim: OPEN or RETAINED (retained stays), or HELD by ACTIVE only with `acknowledgeOpenOnlinePayment` (→ RETIRED + retained); not HELD by a non-ACTIVE attempt; no anomaly on either |
| Amount | `X` = the sponsored obligation's **current payable amount** |
| Writes | `sponsorships/{sp}` (active, X); adjustment `sponsorship_add +X` on the sponsor; sponsored obligation → `sponsored` (`sponsorshipId`), version +1; sponsor version +1; two settlement events cross-referencing `sponsorshipId` and each other; claim events; audit |
| Failure | 409 with a code, no writes |
| Idempotency | `requestId`; one active sponsorship per sponsored obligation (CAS on its version) |

**`reverse_sponsorship {sponsorshipId}`** (Finance / Super; `requestId`; one transaction):

| Item | Rule |
|---|---|
| Preconditions | Sponsorship `active`; sponsored obligation `sponsored` with this `sponsorshipId`; **sponsor obligation `unpaid`** (else 409 `SPONSOR_ALREADY_PAID`, Q15); **sponsor claim OPEN** (else 409 `SPONSOR_HAS_ONLINE_ORDER`); no anomaly; both expected versions match |
| Amount handling | A **compensating adjustment** `sponsorship_remove −X` on the sponsor (references the original adjustment). **Nothing is restored from a snapshot**, so intervening base-amount changes on either obligation are preserved. The sponsored obligation's payable amount after reversal is its **current** base + adjustments |
| Writes | Adjustment; sponsorship → `reversed`; sponsored obligation → `unpaid` (version +1); sponsor version +1; two settlement events cross-referenced; claim events (no claim state change); audit |
| Intervening changes | Sponsor or sponsored base amount changed after sponsorship: allowed; the result is base(current) + remaining adjustments (recorded in the events: before and after payable for both). Sponsor **settled** in between: 409 (above). Sponsored obligation's settlement changed (not `sponsored` with this ID): 409 `SPONSORSHIP_STATE_CHANGED` |
| Legacy sponsorships (pre-R4, `feeOverride` overwritten, `sponsoring` set) | Migration records each as a sponsorship with `legacy: true`, the sponsor's then-current `feeOverride` and the sponsored amount, **without** splitting base and adjustment. `reverse_sponsorship` on a legacy record requires the sponsor's **current** `feeOverride` == the recorded value (no intervening change); else 409 `LEGACY_SPONSOR_AMOUNT_CHANGED` → Finance uses `set_base_amount` explicitly (audited). Never an automatic restore |
| Idempotency | `requestId`; sponsorship state CAS (`active` → `reversed` once) |

---

#### 2.7.3 Sponsorship adjustment invariants (B18)

**Identifiers:**
- Sponsorship `sponsorships/{sp_<uuid>}`, created once per `mark_sponsored` `requestId` (the transaction checks `adminRequests`).
- **Original adjustment ID `adj_<sponsorshipId>_add`**, **compensating adjustment ID `adj_<sponsorshipId>_remove`**, both written with `create()`.
- Sponsored obligation field `activeSponsorshipId | null`.

| # | Invariant | Enforcement (inside the transaction) | Violation |
|---|---|---|---|
| S1 | One active sponsorship per sponsored obligation | `mark_sponsored` requires `activeSponsorshipId == null` and CAS sets it; `reverse_sponsorship` CAS clears it | 409 `SPONSORSHIP_ALREADY_ACTIVE` |
| S2 | One original adjustment per sponsorship | Deterministic ID `adj_<sp>_add` with `create()` | `create()` conflict → transaction aborts → 409 `SPONSORSHIP_ADJUSTMENT_EXISTS` |
| S3 | Exactly one compensating adjustment per original | Deterministic ID `adj_<sp>_remove` with `create()`; it references `adj_<sp>_add` | as S2 |
| S4 | A sponsorship cannot be reversed twice | Sponsorship CAS `active → reversed`; S3 | 409 `SPONSORSHIP_NOT_ACTIVE` |
| S5 | Every adjustment is unique and idempotent | Deterministic IDs; `requestId` replay via `adminRequests` | same `requestId` → replay; a different `requestId` for the same effect → S1/S4 409 |
| S6 | Payable amount is never negative | Every transaction that writes a base amount or an adjustment recomputes `base + Σ adjustments` for each affected obligation and requires it to be ≥ 0 | 409 `NEGATIVE_PAYABLE`, no writes |
| S7 | Duplicate requests cannot apply adjustments twice | S2, S3, S5 | – |
| S8 | A concurrent sponsorship and reversal cannot leave the amounts inconsistent | Both transactions read and CAS: sponsored obligation (`settlementVersion`, `activeSponsorshipId`), sponsor obligation (`settlementVersion`), sponsorship `state`. Firestore serialises them; the loser re-runs against the new state and fails S1/S4/version CAS | 409, no writes |

**Read-time consistency check** (every transaction that computes a payable amount for an obligation with sponsorship history):
- For each sponsorship referencing the obligation: `active` ⇒ exactly `{adj_add}` exists; `reversed` ⇒ exactly `{adj_add, adj_remove}` exist, with amounts `+X` and `−X`.
- **Any other pattern** (missing add, a remove without an add, more than one row per kind, amounts not opposite, an adjustment with no sponsorship) → the sponsorship (or a synthetic record) → **`reconciliation_required`**. The obligation's payable amount is **not computed**: order creation, `settle_manual`, `apply_reviewed_payment` and reversals on either obligation return **409 `SPONSORSHIP_RECONCILIATION_REQUIRED`**. A high-severity Finance item is created.

**Legacy sponsorships** (pre-R4 `feeOverride` overwrite + `sponsoring`):
- Migration reconstructs a sponsorship **only if** exactly one sponsor/sponsored pair is identifiable, the sponsored fee is `Paid` with `sponsoredBy`, the sponsor's `sponsoring` references it, and the sponsored amount X is determinable.
- It then records `legacy: true`, the sponsor's current `feeOverride` as base, and a synthetic `adj_<sp>_add` of 0 (the amount is already inside the base). `reverse_sponsorship` on legacy uses the revision 5 guard (sponsor `feeOverride` unchanged since migration), and writes `adj_<sp>_remove` of −X **and** a base-preserving note.
- Any other legacy pattern → `reconciliation_required` (fail closed).

**`reconcile_sponsorship {sponsorshipId, resolution, baseAmounts, reason}`** (Finance / Super; `requestId`):
- Explicitly sets the base amounts via `set_base_amount` semantics.
- Marks the sponsorship `reversed` or `active`, creating the missing deterministic adjustments.
- Verifies S6.
- Writes events and audit in one transaction.
- Failure 409, no writes.

## 2.8 Application exposure, gateway payability and order lifecycle (revised for B15)

### 2.8.1 Order lifecycle stages and evidence (revision 5, retained)

| Stage | Recorded as |
|---|---|
| S0 Create request **sent** | Attempt CREATING committed **before** the HTTP request (the "create may have happened" boundary) |
| S1 Gateway order created | Not observable until S2 or later discovery |
| S2 Order ID received by the server | In memory |
| S3 Order ID persisted | **Transaction P:** attempt `gatewayOrderId` + `gatewayOrders/{orderId}` `create()` |
| S4 Response authorised | **Transaction A:** revalidate; attempt → ACTIVE; marker `responseAuthorisedAt`. **The only path that may place an order ID in an HTTP response (I17)** |
| S5 Response sent | Not reliably observable |
| S6 Exposure acknowledged | Captured payment on the order, or an authenticated client acknowledgement (optional, Q23; never needed for safety) |

### 2.8.2 Two independent dimensions per gateway order (on `gatewayOrders/{orderId}`)

**Application exposure:** describes only what *this application* may have revealed. Monotonic upward.

| Value | Condition |
|---|---|
| `APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN` | The order is linked to an R4 attempt; no transaction-A marker was ever committed for it; the attempt's fence is bumped or the attempt is terminal, so A can no longer commit |
| `APPLICATION_EXPOSURE_UNKNOWN` | A marker was committed; **or** legacy (no marker mechanism); **or** the order cannot be reliably correlated to an R4 attempt; **or** the fence condition cannot be established |
| `APPLICATION_EXPOSURE_ACKNOWLEDGED` | Captured payment on the order, or an authenticated client acknowledgement |

**Gateway payability:** describes whether *Razorpay* would still accept payment. Independent of exposure.

| Value | Condition |
|---|---|
| `GATEWAY_PAYABILITY_UNKNOWN` | **Default for every order, always**, until value 2 is proven |
| `GATEWAY_UNPAYABLE_PROVEN` | Only via `verify_orders_unpayable` (**disabled**, Q17): an approved gateway rule (G3 / G7) + a fetch-by-ID check (G1) at action time + stored evidence |

**What each dimension is used for:**

| Decision | Uses |
|---|---|
| May this order ID be returned to a payer? | I17 marker only (transaction A on the current holder) |
| May the claim be released, or the order dropped from retention? | **Payability only** (`GATEWAY_UNPAYABLE_PROVEN`), or `CREATE_NOT_SENT_PROVEN` for orders that cannot exist (§2.6.1). **Never application exposure** |
| Is the order retained? | **Always**, if it is known and not the current holder's own order, whatever the application exposure (B15) |
| Audit and risk reporting | Both (e.g. "retained, response never authorised, payability unknown" = lower risk, but still retained) |

**Three explicit distinctions for orders discovered after a failed transaction P or an ambiguous create:**
1. **"The system can prove it never returned the ID":** `APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN`. It is recorded as evidence and lowers the risk rating, but **does not permit release**.
2. **"The order may still exist and be payable at Razorpay":** `GATEWAY_PAYABILITY_UNKNOWN`, so it is **retained**.
3. **"The ID may have escaped through another route"** (Razorpay dashboard, support, logs, an operator): not observable, so it is covered by point 2; retention never relies on the absence of a leak.

### 2.8.3 Crash windows

| Crash point | Application exposure | Payability | Claim effect |
|---|---|---|---|
| Before CREATING committed | – (no create sent) | – (no order can exist) | `CREATE_NOT_SENT_PROVEN`: release allowed via `supersede` |
| After CREATING, before the request was actually sent | (unobservable) | unknown | treated as possibly created: holder kept; on supersede → placeholder retained |
| After the gateway created the order, before transaction P | not authorised (once fenced) | **unknown** | holder kept (UNKNOWN); if superseded → placeholder; if later found → retained |
| After P, before A | not authorised (once fenced) | unknown | as above (order known → retained if it leaves the holder role) |
| After A, before / while / after sending | exposure unknown (or acknowledged) | unknown | retained when it leaves the holder role |

### 2.8.4 Release evidence summary

| Evidence | Permits release? |
|---|---|
| `CREATE_NOT_SENT_PROVEN` (CLAIMED, fenced, no CREATING ever) | **Yes**, for that attempt only |
| FAILED_NO_ORDER (definitive non-creation) | Only after G6 (Q26); **disabled** |
| `GATEWAY_UNPAYABLE_PROVEN` per order | Only after G1 + G3/G7 (Q17); **disabled** |
| One-time override consumed | Permits **one** replacement holder; retention stays |
| `APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN` | **No** |
| Receipt lookup = 0 | **No** |
| Time, refund, reversal, settlement | **No** |

## 2.9 Refund completion and line reversal: transaction RF (B17)

### 2.9.1 External fact vs local state

- A Razorpay refund being processed is an **external fact**; Firestore cannot transact with Razorpay.
- The local system records that fact **after** it learns it, from:
  - the signed `refund.processed` / `refund.failed` webhook (**enabled only after G5**); or
  - Finance `record_refund_outcome` with dashboard evidence (the refund ID and a screenshot or reference ID stored as an evidence reference).
- **Until transaction RF commits, the local state is unchanged:** refund row `initiated` (or absent), obligation `settled_gateway` / `reversal_pending`, payment application unchanged. A local "unpaid" is never derived from an initiated refund, and a payment is never marked reversed before its obligation transition commits (the same transaction does both).

### 2.9.2 Transaction RF: record the refund outcome, then complete an exactly-bound reversal (revised for B20)

RF has two parts **in one Firestore transaction**:
- **Part 1 (the refund fact)** always commits when its own preconditions hold.
- **Part 2 (completion)** runs **only** if all eight binding checks pass.

A failed binding check never blocks recording the fact; it leaves the request pending and raises a worklist item.

| Item | Rule |
|---|---|
| **Idempotency key** | Razorpay refund ID (`rfnd_…`) = refund row doc ID; Finance calls also carry `requestId` |
| **Actor** | Refund webhook (system; **DISABLED_BY_DEFAULT** until G5 / Q27) or Finance / Super (`record_refund_outcome`) |
| **Reads (all before writes)** | Payment; **all** refund rows; allocation `alloc_<paymentId>`; line reversals; the allocation-line lock and its pending reversal request (§2.9.4); the target obligation |
| **Part 1 preconditions** | (a) Evidence identity = row identity: `paymentId`, `amountPaise`, currency, and refund ID (for an existing row); (b) the outcome is a valid transition (`initiated` → `processed` / `failed`), or an identical replay; (c) for an unknown refund ID: C1 holds (§2.9.3) |
| **Part 1 writes** | Refund row CAS → `processed` / `failed` (or `create()` external `processed`); evidence stored; payment refund summary recomputed from all rows; refund event; payment event |
| **Part 2 binding checks** (all, atomically) | **(1)** The refund ID and immutable identity match (Part 1). **(2)** Row state `processed` with valid evidence (`refund_webhook` signature-verified, or a Finance record with a reference). **(3)** Row mapping = `{type: line, allocationId, obligationKey}` equal to the request's `allocationId` + `obligationKey` (split rows: the component for this line). **(4)** `line.processed(k)` (from **processed** rows only) **==** the request's `allocatedPaise` == the allocation line's `allocatedPaise`. **(5)** No row on this payment has mapping `unresolved`. **(6)** The line lock's `pendingRequestId` = a request in state `pending`. **(7)** The obligation is `reversal_pending` with `settlementVersion` == the request's `expectedSettlementVersion`. **(8)** No `lineReversals/{lineHash}` exists for this allocation line (no conflicting completion) |
| **Part 2 writes** | `allocations/alloc_<paymentId>/lineReversals/{lineHash}` `create()` `{requestId: reversalRequestId, refundIds[], amountPaise}`; obligation `reversal_pending` → request target (`unpaid` / `waived`), `settlementVersion` +1, settlement event `gateway_settlement_reversed {reversalRequestId, refundIds}`; payment application recomputed (`partially_reversed` / `reversed`) + payment event; reversal request `pending` → `completed` (`completedAt`, `refundIds`) + request event; line lock `pendingRequestId` → null, `completedReversalId` set; worklist item for the request closed; `auditLogs` (Finance actor, or system with the original requester's reference) |
| **Claim** | Never written (no release on refund) |
| **Part 2 check fails** | No Part 2 writes. A worklist item with the failing check code (`REVERSAL_LINE_NOT_FULLY_REFUNDED`, `REFUND_MAPPING_UNRESOLVED`, `REVERSAL_REQUEST_NOT_PENDING`, `OBLIGATION_VERSION_CHANGED`, `LINE_ALREADY_REVERSED`, …) is created or updated. Response: webhook 200 after commit (fact recorded); Finance 200 with `completion: blocked, code` |
| **Failure (Part 1)** | Identity conflict → anomaly + intervention (no writes beyond the anomaly, §2.9.3); invalid transition → 409. Contention or outage → 503, **no partial commit** |
| **Retry** | Webhook 503 → Razorpay redelivers with the same refund ID. Finance 503 → same `requestId`. After commit: Part 1 is an identical replay (no write); Part 2 check 8 or 6 fails → no duplicate reversal |
| **Idempotent replay** | Row already in the target state with identical evidence → no writes; returns the stored completion status |

### 2.9.3 Duplicate, conflicting and externally processed refunds

| Situation | Handling |
|---|---|
| Duplicate refund webhook / repeated Finance record (same refund ID, same outcome, same amount) | Idempotent replay: no writes |
| **Conflicting evidence** for the same refund ID (different amount, payment or currency, or `processed` vs `failed`) | **No change** to the row, obligation or payment application; `gatewayPayments/{id}/anomalies/{an_<hash>}` `create()` (`refund_conflict`); payment `intervention_required`; high-severity dead-letter; 200 after commit (webhook) or 409 `REFUND_EVIDENCE_CONFLICT` (Finance) |
| **Refund processed externally, not recorded locally** (unknown refund ID; e.g. issued in the dashboard) | `create()` a row `processed` with `origin: external`. Mapping: deterministic if the payment is unallocated or single-line; otherwise `unresolved` (§2.5.2). C1 checked: **if adding it would exceed captured** → do not write the row; record a `refund_conflict` anomaly + intervention item (the external fact exceeds what local records allow; human investigation). No line reversal is performed for `unresolved` rows |
| `map_refund {refundId, mapping}` | See §2.9.5 (revision 7): explicit mapping only, never inferred from a reversal request; completion in the same transaction only if unambiguous and all RF checks hold |
| Refund `initiated` locally, never confirmed | Stays `initiated` (reserves capacity, C1/C2); blocks R-G completion and reviewed application; appears on the reconciliation worklist |

### 2.9.4 Reversal request lifecycle (B20)

**Records:**
- **`reversalRequests/{rr_<uuid>}`:** `{paymentId, allocationId, obligationKey, lineHash, allocatedPaise (exact, copied from the allocation line), target: unpaid | waived, expectedSettlementVersion (the obligation version after it entered reversal_pending), state: pending | completed | cancelled, requestedBy, requestId, reason, refundIds[], createdAt, completedAt?, cancelledAt?}` + append-only `events`.
- **`allocationLineLocks/{allocationId}_{lineHash}`:** `{pendingRequestId | null, completedReversalId | null, version}`. **Uniqueness rule: at most one pending reversal request per allocation line** (CAS on `pendingRequestId`), and at most one completed line reversal (`lineReversals/{lineHash}` `create()`).

| Operation | Actor | Preconditions | Transaction writes | Failure | Retry / idempotency |
|---|---|---|---|---|---|
| **R-G1 `initiate_gateway_reversal {paymentId, obligationKey, target, reason}`** | Finance / Super | Payment application `applied` / `partially_reversed`; the allocation line exists for `obligationKey`; obligation `settled_gateway` via this payment; the line lock has `pendingRequestId` null and `completedReversalId` null; ≥ 1 refund row (initiated or processed) mapped to this exact line; no `unresolved` row on the payment | Obligation `settled_gateway` → `reversal_pending` (version +1); request `create()` with `expectedSettlementVersion` = the new version; lock `pendingRequestId` = request; worklist item; events; audit. **Same transaction:** if `line.processed(k) == allocatedPaise` already (and every RF check 2–8 holds), perform RF Part 2 immediately | 409 `REVERSAL_ALREADY_PENDING` / `LINE_ALREADY_REVERSED` / `NO_REFUND_FOR_LINE` / `REFUND_MAPPING_UNRESOLVED` / `OBLIGATION_STATE_CHANGED` | `requestId` (`adminRequests`) |
| **RF completion** | system / Finance | §2.9.2 Part 2 | §2.9.2 | §2.9.2 | §2.9.2 |
| **R-G3 `cancel_gateway_reversal {reversalRequestId, reason}`** | Finance / Super | Request `pending`; obligation `reversal_pending` at `expectedSettlementVersion` | Request → `cancelled`; obligation → `settled_gateway` (version +1); lock `pendingRequestId` → null; events; audit. If processed refunds on the line already equal its allocation → also worklist item `REFUNDED_LINE_STILL_SETTLED` (money returned but obligation settled: Finance must re-request) | 409 `REVERSAL_COMPLETED` / `REVERSAL_NOT_PENDING` | `requestId` |

**While an obligation is `reversal_pending`,** `set_base_amount`, sponsorship operations, `settle_manual`, `waive` and any other settlement change on it return **409 `REVERSAL_PENDING`**. Any write that does change its version (none is permitted, but defensively) makes RF check 7 fail.

### 2.9.5 `map_refund` and concurrency outcomes (B20)

**`map_refund {refundId, mapping: {type: line, allocationId, obligationKey} | {type: split, lines: [...]}, reason}`** (Finance / Super; `requestId`):
- **Preconditions:** row mapping `unresolved`; the mapping is supplied **explicitly** by Finance (the server **never infers a line from a pending reversal request**); every referenced line exists in the payment's allocation; C1–C4 hold with the new mapping.
- **Writes:** row mapping CAS `unresolved` → mapped; summary recomputed; refund event; audit.
- **Same transaction:** if (and only if) the mapping is to exactly one line that has a pending request, and RF checks 2–8 all hold → RF Part 2. Otherwise the worklist item is kept.
- **Failure:** 409 `REFUND_ALREADY_MAPPED` / `MAPPING_INVALID` / `REFUND_EXCEEDS_LINE`; no writes.
- **Idempotency:** same `requestId` and the same mapping → replay.

| Race / failure | Outcome |
|---|---|
| **Refund webhook vs Finance `record_refund_outcome`** (same refund ID) | Both CAS the row. First commits Part 1 (+ Part 2 if eligible). Second: identical outcome and amount → replay (no writes); different → refund anomaly, no change |
| **Duplicate refund webhook** | Replay; no writes; HTTP 200 |
| **Two Finance users `map_refund` on the same unresolved row** | Both CAS `unresolved`. First commits; second: same `requestId` + mapping → replay; otherwise 409 `REFUND_ALREADY_MAPPED` |
| **RF vs obligation fee adjustment** (`set_base_amount`, sponsorship) | The adjustment is refused while `reversal_pending` (409 `REVERSAL_PENDING`). If it committed earlier (the obligation was not yet pending), R-G1 captured the new version; consistent |
| **RF vs another reversal request on the same line** | The line lock allows only one pending request: the second R-G1 → 409 `REVERSAL_ALREADY_PENDING`; after completion → 409 `LINE_ALREADY_REVERSED` |
| **RF vs R-G3 cancel** | Serialised on the request and the obligation. Cancel first → RF records the fact; Part 2 check 6 fails → worklist `REFUNDED_LINE_STILL_SETTLED`. RF first → cancel 409 `REVERSAL_COMPLETED` |
| **RF on two different lines of one payment** | Independent (C4); both may complete; the payment application is recomputed from line reversals in each transaction (Firestore serialises both on the payment document) |
| **Commit followed by a lost HTTP response** | Redelivery or retry → replay; no duplicate line reversal (check 8 / `create()`), no duplicate obligation transition (check 7) |
| **Refund processed at Razorpay, Firestore temporarily unavailable** | RF → 503; the local state is unchanged (obligation still `reversal_pending`, row `initiated` or absent). Razorpay redelivers (after G5) or Finance retries. The worklist item ages past Q28; Finance follows up. Never inferred as completed |

## 2.10 Ending attempts vs retaining orders vs releasing claims (B19)

**Three independent concerns:**

| Concern | Effect | Operations |
|---|---|---|
| **(1) End an attempt's ability to create or expose** | Attempt → terminal (SUPERSEDED, ABANDONED) or RETIRED; fence bump; the holder is cleared | `supersede_unsent`, `abandon_attempt`, `retire_exposed`, `resolve_anomaly retain_all` |
| **(2) Retain a known or possible order** | `retainedOrders` / `retainedPossibleOrders` entries are added (never removed) | Automatic in every concern-(1) operation after CREATING, and in LR (§4.4) |
| **(3) Release the claim** (allow a new order) | Holder cleared **with no retention added**, and no retained entries remain → derived OPEN | **Only `supersede_unsent`** (`CREATE_NOT_SENT_PROVEN`), plus the disabled gates (§0.C) |

**Rule:** no operation after CREATING clears a placeholder or a retained order, whatever the application exposure evidence.

### O1 `supersede_unsent {attemptId}`: before CREATING

| Item | Rule |
|---|---|
| Actor | Finance / Super (also invoked internally by `revoke_override` for a bound CLAIMED attempt) |
| Preconditions | Attempt state CLAIMED; **no** CREATING ever committed (attempt events contain no `creating_committed`); the attempt is the holder of all its claims at `holderFence` |
| Transaction writes | Attempt: CLAIMED → **SUPERSEDED**, `fenceVersion` +1, event `superseded_unsent`. Each claim: `holderAttemptId` → null, `holderFence` +1, **no retention added**, event `released_create_not_sent`. Override (if `boundOverrideId`): BOUND → RELEASED, claims `boundOverrideId` → null, override event. `adminRequests`; `auditLogs` |
| Resulting claim | OPEN if no other retained entries exist (otherwise still RETAINED) |
| Race with CLAIMED → CREATING | Firestore serialises: supersede first → CREATING fails its CAS, **no request sent**; CREATING first → precondition fails → 409 `CREATE_ALREADY_SENT` (use `abandon_attempt`) |
| Failure | 409 with a code, no writes |
| Retry / idempotency | 503 → retry with the same `requestId`; replay returns the stored result |

### O2 `abandon_attempt {attemptId, reason}`: after CREATING (includes "retiring an OUTCOME_UNKNOWN attempt")

| Item | Rule |
|---|---|
| Actor | Finance / Super |
| Preconditions | Attempt in CREATING, OUTCOME_UNKNOWN, RECONCILING, RECOVERED or ACTIVATION_FAILED; **no committed response marker** (application exposure `APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN`; otherwise use `retire_exposed`); the attempt is the holder |
| Transaction writes | Attempt → **ABANDONED**, `fenceVersion` +1, event `abandoned {reason}` (terminal; `gatewayOrderId` unchanged). Each claim: holder → null, `holderFence` +1; **retention:** a known order (`gatewayOrderId`, or linked in `gatewayOrders`) → `retainedOrders` (`orphan_discovered`, both dimensions); no known order → `retainedPossibleOrders` (`create_outcome_unknown`, receipt = `attemptId`); retention-while-held rule n/a (holder cleared in the same transaction); claim event. Override (if bound): stays **CONSUMED** (it was consumed at CREATING); `boundOverrideId` → null on the claims; override event `bound_attempt_abandoned`. `adminRequests`; `auditLogs` |
| Resulting claim | RETAINED (never OPEN) |
| Failure | 409 (wrong state, marker committed → `USE_RETIRE_EXPOSED`), no writes |
| Retry / idempotency | `requestId` replay |

### O3 `reactivate_attempt {attemptId}`: normal handling of RECOVERED and ACTIVATION_FAILED

| Item | Rule |
|---|---|
| Actor | System on the owning payer's order request (§4.1), or Finance / Super (**Q30: owner approved**) |
| Preconditions | Attempt RECOVERED or ACTIVATION_FAILED, with a known `gatewayOrderId`; the claim holder is this attempt at its fence; no anomaly; revalidation §2.3.1 passes (obligations unpaid at version, payer binding, amount = current payable, order fetched by ID matches; G1) |
| Transaction writes | **Transaction A** (§2.8.1): attempt → ACTIVE, marker `responseAuthorisedAt`; `gatewayOrders` application exposure → `APPLICATION_EXPOSURE_UNKNOWN`; events. Claims unchanged (holder's own order) |
| Result | The **same** order is returned to the payer; no new order |
| Revalidation fails | 409 `ORDER_REVALIDATION_FAILED` (e.g. amount changed); attempt state unchanged; the claim and its order stay held by the attempt for Finance review (no release, no replacement order); Finance options: wait (if transient), or `abandon_attempt` (O2, retains the order) |
| Retry / idempotency | Repeated payer requests re-run O3; once ACTIVE they take the normal reuse path |

### O4 `retire_exposed {attemptId}`: exposed attempts (unchanged)

ACTIVE → RETIRED; order → `retainedOrders` (`exposed_retired`); holder cleared; a bound override stays CONSUMED. **No release.**

### O5 Late gateway response: transaction LR `record_late_order` (§4.4)

| Attempt state when the response arrives | Attempt write | Claim write | Override write |
|---|---|---|---|
| OUTCOME_UNKNOWN and still holder (L1) | → RECOVERED (`gatewayOrderId`) | none (holder's own) | none |
| SUPERSEDED (CLAIMED-superseded, so the create was never sent) | event only | **anomaly** on all its claims (contradiction, L7) | none |
| ABANDONED / RETIRED / PAID / CLOSED_UNAPPLIED (L2 / L3) | event only | order → `retainedOrders` (replaces this attempt's placeholder in the same transaction) (+ anomaly if another attempt holds) | none (CONSUMED stays CONSUMED) |
| Any, with a conflicting identity (L7) | event only | anomaly | none |

Idempotent on `gatewayOrders/{orderId}`; the original HTTP request gets 409; never ACTIVE without transaction A.

### O6 Summary transition table (claim release column)

| From attempt state | Operation | To | Claim release? | Retention added |
|---|---|---|---|---|
| CLAIMED | `supersede_unsent` | SUPERSEDED | **Yes** | none |
| CREATING / OUTCOME_UNKNOWN / RECONCILING | `abandon_attempt` | ABANDONED | **No** | placeholder, or known order |
| RECOVERED / ACTIVATION_FAILED | `reactivate_attempt` | ACTIVE | – (holder keeps it) | none |
| RECOVERED / ACTIVATION_FAILED | `abandon_attempt` | ABANDONED | **No** | known order |
| ACTIVE | `retire_exposed` | RETIRED | **No** | known order |
| ANOMALY_MULTIPLE | `resolve_anomaly retain_all` | RETIRED / ABANDONED | **No** | all orders and placeholders |
| any terminal | any | – | – | LR may add retention; the attempt is never written |

## 3. Data model and identifiers

Revision 4 §3 is retained; changes and additions:

| Collection | Notes |
|---|---|
| `paymentAttempts` (+ `events`) | `exposure {markerAt?}` replaces `exposedAt`; `overrideId?`. **No `orderIdLate`** (late orders live on `gatewayOrders`) |
| `gatewayOrders/{orderId}` | `{attemptId?, intentId?, obligationKeys[], source: create_response \| late_response \| reconcile \| webhook \| finance_attach \| legacy_migration, correlation: exact \| none \| ambiguous, applicationExposure, gatewayPayability, exposureEvidence[], payabilityEvidence[], firstSeenAt}`. `create()`; both dimensions monotonic (§2.8.2); an existing link with a different `attemptId` → L7 anomaly |
| `paymentObligationClaims` (+ `events`) | §2.2 fields, including `retainedPossibleOrders[]` |
| `claimOverrides/{ov_…}` (+ `events`) | §2.6.1 |
| `gatewayPayments` (+ `allocations`/`lineReversals`, `refunds`, `anomalies`, `events`) | §2.5 |
| `obligationAdjustments`, `sponsorships` | §2.7.2, §2.7.3 (deterministic adjustment IDs; `activeSponsorshipId` on the sponsored obligation; sponsorship `state: active \| reversed \| reconciliation_required`) |
| `lateFeeObligations`, `subscriptionPeriods`, `merchOrders` (server-minted IDs) | unchanged |
| `adminRequests/{requestId}` | admin idempotency |
| `reversalRequests/{rr_<uuid>}` | R-G1 request bound to `paymentId`, `allocationId`, `obligationKey`, `lineHash`, exact `allocatedPaise`, `target`, `expectedSettlementVersion`, `requestedBy`, `requestId` (§2.9.4) |
| `allocationLineLocks/{allocationId}_{lineHash}` | `pendingRequestId`, `completedReversalId`; at most one pending request per allocation line (§2.9.4) |
| `refundReconcileItems/{refundId}` | worklist for refunds still `initiated` past Q28's threshold |
| `orderAcks/{orderId}_{uid}` | client acknowledgement (S6b), `create()` |

All of these are server-written only (`allow write: if false`). Finance / Super read access applies to attempts, claims, orders, payments (+ subcollections), overrides, adjustments, sponsorships and admin requests.

**Canonical keys and IDs** (unchanged): validated or `b64:`-encoded segments; doc ID = prefix + base64url(SHA-256); collision detection fails closed.

**Uniqueness (additions):**
- one override binding per override (CAS);
- one consumption per override;
- one refund row per Razorpay refund ID;
- one line reversal per (payment, obligation);
- one active sponsorship per sponsored obligation;
- one acknowledgement per (order, uid).

**Bundles:** ≤ 20 obligations, one player. Transaction footprint asserted (≤ about 150 writes worst case including adjustments and refund recomputation); fail closed above it.

---

## 4. Rules

### 4.0 Conventions (unchanged)

- Admin Firestore transactions read before they write.
- Contention: SDK retry; on exhaustion **503 `{retryable: true}`** with no partial effect.
- Admin `requestId` idempotency via `adminRequests` (same payload → replay 200; different → 409 `REQUEST_ID_REUSED`).
- Webhook idempotency via `gatewayPayments` / anomaly / `gatewayOrders` `create()`; 2xx only after commit; 401 bad signature; 400 malformed JSON.
- Audit: domain events always; `auditLogs` for humans, in the same transaction.
- Failure: 400 / 401 / 403 / 404 / 409 (code, no writes) / 503.

### 4.1 Order route

| Step | Rule |
|---|---|
| Claim (transaction) | ≤ 20 obligations, one player, all `unpaid`. Each claim: **OPEN** → new attempt (holder); **RETAINED** with a bindable override covering exactly these keys → bind (§2.6.2); **HELD / HELD_OVERRIDE** by this payer's ACTIVE attempt with an identical set and amount → revalidate and reuse; **HELD / HELD_OVERRIDE by this payer's RECOVERED or ACTIVATION_FAILED attempt → `reactivate_attempt` (§2.10 O3): revalidate + transaction A → reuse the same order, or 409 if revalidation fails** (revision 7); otherwise 409 (`ONLINE_PAYMENT_UNAVAILABLE`, `PAYMENT_UNDER_REVIEW`, `PAYMENT_BEING_VERIFIED`, `ALREADY_PAID`) |
| CREATING (transaction) | fenced; consumes a bound override; then `orders.create({receipt: attemptId, notes: {intentId, attemptId}})` |
| Response | Transaction P (persist), then transaction A (marker), then return the order (§2.8.1) |
| Failures | §2.3 classification |
| Legacy | expired-`reserving` takeover removed |
| Idempotency | the claim holder makes repeats return the same order or 409 |

### 4.2 Decision function `decidePaymentApplication` (revision 4 rules R1–R10 retained; R11 added)

- **R1:** REPLAY on matching identity.
- **R2:** IDENTITY_CONFLICT.
- **R3:** REJECT_INVALID.
- **R4:** FAILED_NO_ORDER → REJECT_DUPLICATE + classification anomaly.
- **R5:** SUPERSEDED / **ABANDONED** / RETIRED → REJECT_DUPLICATE (`ATTEMPT_SUPERSEDED` / `ATTEMPT_ABANDONED` / `ATTEMPT_RETIRED`).
- **R6:** anomaly (attempt or claim) → REJECT_DUPLICATE.
- **R7:** attempt has `firstPaymentId` → REJECT_DUPLICATE.
- **R8:** obligation not `unpaid`, or holder ≠ attempt → REJECT_DUPLICATE.
- **R9:** amount ≠ current payable → REJECT_DUPLICATE.
- **R10:** APPLY.
- **New R11 (evaluated before R3):** order not linked in `gatewayOrders` → link-or-classify per §4.4 L4 first, then evaluate.

### 4.3 Webhook write sets

Revision 4 §4.3 is retained, with these changes:
- Every decision that records a payment for a linked order also **raises that order's `applicationExposure` to `APPLICATION_EXPOSURE_ACKNOWLEDGED`** (event `exposure_acknowledged_by_payment`); `gatewayPayability` stays `GATEWAY_PAYABILITY_UNKNOWN` (G3 unverified).
- **APPLY:** claim holder cleared; order → `retainedOrders` (`paid_applied`).
- **REJECT_DUPLICATE:** order → `retainedOrders` (`paid_rejected`) on every claim of the bound obligations, applying the retention-while-held rule (§2.2).
- The CLOSED_UNAPPLIED eligibility table (§2.3) governs attempt changes; terminal attempts get events only.
- Allocation (APPLY): `alloc_<paymentId>` with basis `webhook_attempt` / `webhook_intent`; lines = the obligations' payable amounts; Σ = captured (else R9 had already rejected).

### 4.4 Late responses and discovered orders (revised for B15)

**Transaction LR** (one per order; idempotency key `gatewayOrders/{orderId}`; event dedupe key = hash(orderId, source, gateway event ID or response hash)):
1. Read `gatewayOrders/{orderId}`, the correlated attempt (via `notes.attemptId`, else `notes.intentId` → intent → attempt; otherwise none), its claims (+ holders), and any bound override.
2. **Link:**
   - absent → `create()` `{attemptId?, source, applicationExposure, gatewayPayability: GATEWAY_PAYABILITY_UNKNOWN, correlation: exact | none | ambiguous}`;
   - present with the same `attemptId` → no write;
   - present with a different `attemptId` → L7.
3. **Application exposure** per §2.8.2 (evidence only).
4. **Claim effect:**
   - if the order is the **current holder's own** order (`attemptId` = holder, attempt non-terminal) → no retention (it is the holder's single order);
   - **otherwise → `retainedOrders`** (`orphan_discovered` / `paid_*`), replacing any matching `retainedPossibleOrders` placeholder for that attempt in the same transaction;
   - the retention-while-held rule (§2.2) may set the anomaly.
5. **Attempt:** non-terminal with its own fence → per case; terminal → **appended event only**.
6. **Response to a late HTTP request:** 409 `ORDER_NOT_AVAILABLE`, never the order ID (I17).
7. Events; `auditLogs` when a human triggered it.

**Failure:** no writes; webhook 503 / Finance 503 → retry with the same key. **Idempotent:** a repeat → no writes.

| Case | Situation | Attempt effect | Claim effect | Notes |
|---|---|---|---|---|
| **L1** | Late response; attempt OUTCOME_UNKNOWN and **still the holder** | → RECOVERED (`gatewayOrderId`) using the observer's fence | none (holder's own order) | Exposure only via revalidation + transaction A (`reconcile`); the original request gets 409 |
| **L2** | Late response after `abandon_attempt` (ABANDONED) | event only (terminal) | order → `retainedOrders`; the attempt's placeholder removed (replaced) | If superseded **from CLAIMED** (create never sent), a late response is a **contradiction** → L7 |
| **L3** | Late response after another terminal state (PAID, CLOSED_UNAPPLIED with a different known order; FAILED_NO_ORDER when enabled) | event only | order → `retainedOrders` (+ anomaly if held by another) | FAILED_NO_ORDER → also a classification anomaly (G6 contradicted) |
| **L4** | Captured payment on an order not yet linked | per §4.3 (terminal → event) | correlated → link + `retainedOrders` (`paid_*`) on the correlated obligations' claims; **uncorrelated** → link with `correlation: none`, **no claim known** → payment `unmatched`, Finance item | Application exposure → ACKNOWLEDGED |
| **L5** | Duplicate late response or event | none | none | Idempotent |
| **L6** | Reconciliation discovers an order (any time after supersede or terminal state) | event only (terminal) / per §2.3 (non-terminal holder) | as L1 or L2 | Discovered orphans are always retained unless they are the holder's own |
| **L7** | **Order identity cannot be reliably correlated**: `gatewayOrders` already links a different attempt; `notes.attemptId` and `notes.intentId` disagree; notes missing but the receipt matches; a late response for a CLAIMED-superseded attempt | event on every candidate attempt | **anomaly flag on every candidate obligation's claim** (fail closed); the order linked with `correlation: ambiguous`; high-severity dead-letter `order_identity_conflict` | Resolution only via `resolve_anomaly retain_all` (§2.4); never auto-released |

**Never:**
- a late response or discovery changes a terminal attempt's fields;
- moves any attempt to ACTIVE without transaction A;
- returns an order ID without the I17 marker;
- removes a retained order or placeholder;
- releases a claim.

### 4.5 Manual settlement endpoint (revision 4 §4.5 retained; amounts per §2.7.2)

| Action | Role | Preconditions | Writes | Claim |
|---|---|---|---|---|
| `settle_manual` | Finance / Super; Club (match fees) | `unpaid` at version; no anomaly; not HELD by a non-ACTIVE attempt; HELD by ACTIVE → `acknowledgeOpenOnlinePayment` | `settled_manual`; event; audit | acknowledged → holder RETIRED; order retained (always, whatever its application exposure; B15) |
| `mark_sponsored` / `reverse_sponsorship` | Finance / Super | §2.7.2 | §2.7.2 | §2.7.2 |
| `waive` (Finance / system abandonment) | Finance / Super; system | as `settle_manual`; abandonment retires the ACTIVE holder automatically | `waived`; event; audit | as above |
| `set_base_amount {amountPaise, reason}` | Finance / Super | `unpaid` at version; claim OPEN or RETAINED (**not HELD**: an ACTIVE order at the old amount must be retired first) | base change; event; audit | none |
| R-M, R-W | Finance / Super | §2.7.1 | §2.7.1 | none |

All use `requestId`; failure 409 with no writes; contention 503.

### 4.6 `apply_reviewed_payment` (B7 retained; B11 and B12 applied)

#### 4.6.1 Validation (revision 4 V1–V17, with these refinements)

- **V8–V11 (B12):** compute §2.5.2 from refund rows.
  - `refundPendingCount > 0` → 409 `REFUND_IN_PROGRESS`.
  - `netCaptured == 0` → 409 `ALREADY_REFUNDED`.
  - Target lines: each target obligation's **current payable amount** (§2.7.2). The **sum must equal `netCaptured`** exactly; lower → 409 `AMOUNT_LOWER`; higher → 409 `AMOUNT_HIGHER`.
  - Only `{type: payment}` refund rows can exist on an unallocated payment, so the mapping is deterministic. Anything else → 409 `REFUND_MAPPING_NOT_DETERMINISTIC`.
- **V15 (B11):** reject if the claim **or** the bound attempt is ANOMALY_MULTIPLE, **or** the payment or its order has an open identity or classification anomaly → 409 `ANOMALY_PENDING`.
- **V18 (new):** the bound attempt is **FAILED_NO_ORDER** with an unacknowledged classification anomaly → 409 `CLASSIFICATION_ANOMALY_OPEN` (Finance must first record `acknowledge_classification_anomaly`, audited).

#### 4.6.2 Writes on success (one transaction; **no attempt or intent state change**)

1. `allocations/alloc_<paymentId>` `create()`: lines (payable amounts), basis `reviewed_bound` / `reviewed_finance_attested`, `decidedBy`, reason, `requestId`, `targetPlayerId`, evidence. The payment's immutable identity is untouched.
2. Payment application → `applied` (event records the previous `rejected_duplicate` / `unmatched`); refund summary recomputed.
3. Each target obligation → `settled_gateway` with `basis: "reviewed"`, `gatewayPaymentId`, `allocationId`; version +1; settlement event.
4. Claims: the payment's order (`APPLICATION_EXPOSURE_ACKNOWLEDGED`, payability unknown) stays or is added in `retainedOrders` (`paid_applied`); if `retireConflictingAttempt`, the conflicting ACTIVE attempt → RETIRED, its order retained; holder cleared if the holder was the payment's attempt or the retired one; claim events.
5. **Bound attempt: state unchanged; event `reviewed_payment_applied {paymentId, allocationId}` appended.**
6. **Bound intent: state unchanged; event `reviewed_settlement_recorded` appended.**
7. `adminRequests`, `auditLogs`.

#### 4.6.3 Per-state handling of the bound attempt (B11)

| Bound attempt state | Allowed? | Attempt write | Intent write |
|---|---|---|---|
| CLOSED_UNAPPLIED (this was its first payment) | yes | **event only** | event only (stays `paid_unapplied`) |
| PAID (additional payment) | yes, if the target obligations are `unpaid` (e.g. after R-G2) and V1–V18 pass | event only | event only (stays `paid`) |
| SUPERSEDED / ABANDONED (late payment on an orphan) | yes, if V1–V18 pass | event only | event only (stays `pending`) |
| FAILED_NO_ORDER | only after `acknowledge_classification_anomaly` (V18) | event only | event only |
| RETIRED | **not reachable**: any captured payment on a RETIRED attempt's order already moved it to CLOSED_UNAPPLIED (§2.3); a RETIRED attempt with no payment has nothing to review | – | – |
| ANOMALY_MULTIPLE | **no** (V15) | – | – |
| Non-terminal other (ACTIVE, UNKNOWN, …) bound to a reviewable payment | not reachable (first payment moves it to CLOSED_UNAPPLIED or PAID) | – | – |
| **No attempt** (unmatched, unbound) | yes, only with `finance_attested` (V14) | none | none |

### 4.7 Refund actions (revised for B17)

| Action | Role | Preconditions | Writes | Failure | Retry / idempotency |
|---|---|---|---|---|---|
| `record_refund_initiated {paymentId, refundId, amountPaise, mapping}` | Finance / Super | mapping rule (§2.5.2; `unresolved` is not allowed for local initiation); C1–C2 hold after adding | row `create()` (`initiated`); summary recomputed; event; audit | 400 `REFUND_MAPPING_REQUIRED`; 409 `REFUND_EXCEEDS_CAPTURED` / `REFUND_EXCEEDS_LINE` / `REFUND_ID_EXISTS` | `requestId`; row ID = refund ID |
| `record_refund_outcome {refundId, processed\|failed, evidence}` | Finance / Super (webhook after G5) | §2.9.2 | **Transaction RF** | §2.9.2 / §2.9.3 | refund ID; `requestId` |
| `map_refund {refundId, mapping}` | Finance / Super | §2.9.5 (revision 7) | §2.9.5 | §2.9.5 | `requestId`; mapping CAS |
| R-G1 `initiate_gateway_reversal {paymentId, obligationKey, target: unpaid\|waived, reason}` | Finance / Super | §2.9.4 (revision 7) | §2.9.4 | §2.9.4 | `requestId` |
| R-G3 `cancel_gateway_reversal {reversalRequestId, reason}` | Finance / Super | §2.9.4 (revision 7) | §2.9.4 | §2.9.4 | `requestId` |
| ~~R-G2 manual completion~~ | – | **Removed** (X20): completion happens only inside RF or R-G1 | – | – | – |

### 4.8 Attempt, claim and override actions (revised for B15, B16)

| Action | Role | Preconditions | Writes / transitions | Claim effect | Audit |
|---|---|---|---|---|---|
| `reconcile` | Finance / Super / worker | attempt non-terminal | §2.3; discovered orders via LR (§4.4) | per LR | events (+ audit) |
| `attach_order` | Finance / Super | attempt UNKNOWN / RECONCILING (holder); fetch-validated (G1); LR link with the same `attemptId` | → RECOVERED → revalidate + A → ACTIVE | holder's own order | events + audit |
| `supersede_unsent` | Finance / Super | §2.10 O1 | §2.10 O1 | **release** (`CREATE_NOT_SENT_PROVEN`) | events + audit |
| `abandon_attempt` | Finance / Super | §2.10 O2 | §2.10 O2 | **no release**; order or placeholder retained | events + audit |
| `reactivate_attempt` | system (payer request) / Finance / Super | §2.10 O3 | §2.10 O3 | none (holder's own order) | events (+ audit) |
| `retire_exposed` | Finance / Super | attempt ACTIVE | → RETIRED | order → `retainedOrders` | events + audit |
| `resolve_anomaly` | Finance / Super | §2.4 | §2.4 | §2.4 | events + audit |
| `authorise_override` | Finance / Super (+ Super second approval, Q25) | §2.6.2 | §2.6.2 | – | events + audit |
| `revoke_override` | Finance / Super | §2.6.2 | §2.6.2 | bound CLAIMED attempt → release | events + audit |
| `verify_orders_unpayable` | Finance / Super | **Disabled** (Q17) | – | – | – |
| `acknowledge_classification_anomaly` | Finance / Super | open classification anomaly | anomaly acknowledged | none | events + audit |

All use `requestId` (`adminRequests`), 409 with no writes on a failed precondition, and 503 on contention (retry with the same `requestId`).

## 5. Failure and concurrency matrix (revision 4 rows retained; additions and changes)

| # | Case | Expected result | Second payable order? |
|---|---|---|---|
| 25 | Late response, attempt UNKNOWN (L1) | RECOVERED; the original request gets 409; exposure only after revalidation + A | No |
| 26 | Late response after supersede (L2) | *Superseded by revision 6 row 26 (changed): order **retained**.* | No |
| 27 | Late response after PAID / CLOSED_UNAPPLIED / FAILED_NO_ORDER (L3) | *Superseded by revision 6 row 27 (changed): order **retained**; attempt unchanged; FAILED_NO_ORDER (when enabled) → classification anomaly.* | No |
| 28 | Payment on an unlinked order (L4), resolvable / not resolvable | Linked + retained + decided / `unmatched` | – |
| 29 | Duplicate late response or event (L5) | No writes | No |
| 30 | Reconcile finds an order after supersede (L6) | *Superseded by revision 6 row 30 (changed): **retained**.* | No |
| 31 | Crash before CREATING / after CREATING / after gateway create before P / after P before A / after A (before, during, after send) | Release possible (`CREATE_NOT_SENT_PROVEN`) / placeholder / placeholder or retained / retained if it leaves the holder role / retained (§2.8.3). Application exposure is evidence only | No |
| 32 | Override: sequential use | One BOUND → CONSUMED; next request returns the same order or 409 | Only the one authorised |
| 33 | Override: concurrent binding | One wins; the loser gets the winner's order or 409 | Only one |
| 34 | Override: timeout / persistence failure / crash | CONSUMED; no second replacement; reconcile path | Only one |
| 35 | Override: bound attempt superseded from CLAIMED | RELEASED; rebind allowed before expiry | – |
| 36 | Override expired, revoked or consumed, then a new request | 409 `ONLINE_PAYMENT_UNAVAILABLE` | No |
| 37 | Reviewed payment for CLOSED_UNAPPLIED / PAID / SUPERSEDED / FAILED_NO_ORDER / unmatched | Attempt and intent unchanged; allocation + settlement recorded | – |
| 38 | Bundle refund without mapping | 400 `REFUND_MAPPING_REQUIRED` | – |
| 39 | Refund exceeding a line or the captured amount | 409 | – |
| 40 | Refund initiated then failed | Reservation released; `intervention_required` | – |
| 41 | Sponsorship reversal after an intervening base change | Compensating adjustment; current base preserved | – |
| 42 | Sponsorship reversal with sponsor paid / sponsor order exposed / sponsored state changed / legacy amount changed | 409 with the specific code | No |

---

**Revision 6 additions and changes to the failure and concurrency matrix:**

| # | Case | Expected result | Second payable order? |
|---|---|---|---|
| 26 (changed) | Late response after supersede from UNKNOWN (L2) | Order **retained**; attempt unchanged | No |
| 27 (changed) | Late response after terminal (L3) | **Retained**; attempt unchanged | No |
| 30 (changed) | Reconcile discovers an orphan (L6) | **Retained** | No |
| 43 | Order created at Razorpay, never persisted locally; attempt superseded | Placeholder retained; online unavailable; later discovery → concrete retained | No |
| 44 | Response marker absent but the order is still payable | Retained (payability unknown); payment on it → review | No |
| 45 | Unlinked order found via webhook, correlated / uncorrelated | Retained on the correlated claims / `unmatched` + Finance | No |
| 46 | Order identity not reliably correlated (L7) | Anomaly on every candidate claim | No |
| 47 | Supersede from CLAIMED | Release (`CREATE_NOT_SENT_PROVEN`) | – |
| 48 | Override bind vs expiry / revocation; CREATING vs revocation; release vs create | Per the §2.6.2 race matrix | At most one replacement |
| 49 | Override consumed then timeout or crash | Stays CONSUMED; reconcile the bound attempt only | One |
| 50 | Refund processed at Razorpay, local RF fails | Local state unchanged; retry or worklist; RF later idempotent | – |
| 51 | RF commits, response lost, webhook retried | Replay, no writes | – |
| 52 | Conflicting refund evidence | Anomaly; no state change | – |
| 53 | External refund on a bundle without mapping | Row `unresolved`; C3 suspended; line actions blocked until `map_refund` | – |
| 54 | Partial bundle refund completing line k | Only k reversed; others untouched | – |
| 55 | Concurrent `mark_sponsored` ×2 / sponsor ↔ reverse / duplicate reverse | One wins; S1–S8 hold | – |
| 56 | Sponsorship with malformed adjustment rows / unreconstructable legacy | `reconciliation_required`; dependent actions 409 | – |

**Revision 7 additions to the failure and concurrency matrix:**

| # | Case | Expected result | Second payable order? |
|---|---|---|---|
| 57 | `supersede_unsent` vs CREATING (both orderings) | Release with no request sent / 409 `CREATE_ALREADY_SENT` | No |
| 58 | `abandon_attempt` on UNKNOWN / RECOVERED / ACTIVATION_FAILED | ABANDONED; order or placeholder retained; claim RETAINED | No |
| 59 | Payer request with a RECOVERED holder | `reactivate_attempt` → same order (or 409 on revalidation failure) | No |
| 60 | Late response after ABANDONED | Order retained, replacing the placeholder | No |
| 61 | Late response after SUPERSEDED (create never sent) | Contradiction → anomaly | No |
| 62 | Two reversal requests on one line | Second 409 `REVERSAL_ALREADY_PENDING` | – |
| 63 | RF with any binding check failing | Fact recorded; no completion; worklist item | – |
| 64 | RF races (webhook ↔ Finance, map ↔ map, RF ↔ cancel, RF ↔ fee change, lost response, Firestore outage) | Per §2.9.5 | – |

## 6. Invariants (revision 4 I1–I16 retained; changes and additions)

| # | Invariant |
|---|---|
| I3 | *Superseded by revision 6 I3 (revised) below.* |
| I8 (revised) | Terminal attempts: `state`, `fenceVersion`, `gatewayOrderId`, `exposure`, `firstPaymentId` and `obligationKeys` are never written; intents never change state after their first terminal state; reviewed application changes neither |
| I17 | **Response gateway:** no order ID leaves the server without a committed transaction-A marker for that order on a non-terminal, fence-valid attempt |
| I18 | *Superseded by revision 6 I18 (revised) below.* |
| I19 | **One-time override:** an override is bound to at most one attempt that reaches CREATING; once `CONSUMED`, `EXPIRED` or `REVOKED` it admits nothing; overrides never alter retained orders or bypass an anomaly |
| I20 | **Refund ledger:** C1–C6 (§2.5.2); C3 suspended only while an `unresolved` external row exists, with all line-dependent actions blocked |
| I21 | **Allocation exactness:** each allocation line equals the obligation's payable amount at allocation; Σ lines = net captured at allocation; per-line reversal requires that line's processed refunds = its allocation |
| I22 | **Amounts:** payable = base + Σ append-only adjustments; no workflow restores an amount from a snapshot; sponsorship reversal is a compensating adjustment |

---

**Revision 6 invariant changes and additions:**

| # | Invariant |
|---|---|
| I3 (revised) | Every known gateway order that is not the current holder's own order is retained, **independent of application exposure**. Every attempt that committed CREATING and left the holder role without a known order leaves a placeholder. Retained orders and placeholders are removed only by release conditions 2 or 3, or when a placeholder is replaced by its concrete order |
| I18 (revised) | Application exposure and gateway payability are independent, monotonic dimensions. **Only payability (or `CREATE_NOT_SENT_PROVEN`) can justify release**; application exposure never can |
| I19 (revised) | An override binds at most one attempt; it binds only while live by the trusted-time rule; CONSUMED, EXPIRED and REVOKED are terminal; a CONSUMED override is never reused; recovery is reconciliation of its bound attempt only |
| I23 | **External-fact recording:** a refund processed at Razorpay is always recorded once known (deterministic or `unresolved` mapping); a refund is never inferred from `initiated`; a payment line is reversed and its obligation transitioned **in the same transaction** (RF / R-G1) or not at all |
| I24 | **Sponsorship:** S1–S8 (§2.7.3); payable ≥ 0; malformed sponsorship history blocks all dependent actions (fail closed) |
| I25 | **Disabled capabilities stay disabled:** FAILED_NO_ORDER release (G6), `verify_orders_unpayable` / `adopt` / `supersede_all` (G1+G3/G7), refund webhook ingestion (G5), `expose_replacement` (Q13). None is reachable until its evidence and approval exist |

**Revision 7 invariants:**

| # | Invariant |
|---|---|
| I26 | **Release only by `supersede_unsent`:** after an attempt has committed CREATING, no operation clears its holder without adding a retained order or placeholder. SUPERSEDED attempts never committed CREATING; ABANDONED attempts always left a retention entry |
| I27 | **One pending reversal per allocation line;** at most one line reversal per allocation line (`allocationLineLocks` CAS + `lineReversals` `create()`) |
| I28 | **Bound completion:** a line reversal and its obligation transition exist only if all eight RF checks held in the same transaction; the refund fact is recorded even when completion is blocked |
| I29 | **Capability status:** a capability's status changes only by the §0.C procedure; recommendations never change it |

## 7. Test matrix

Revision 4 rows B6-1…B8-8 and the revision 3 rows are retained. All races run in both orderings, N repetitions, through real route handlers with a deterministic gateway stub (release handles, crash injection points P / A / send) and an injected clock. Every row asserts states, retained orders, exposure classes, **stub orders created and orders returned to clients**, and events / audit.

| # | Scenario | Must show |
|---|---|---|
| **B9-1** | L1: late response after an observer marks UNKNOWN | Original request 409 (no order ID); attempt RECOVERED; application exposure `APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN` (evidence only; holder's own order); exposure only after `reconcile` (revalidate + A) |
| **B9-2** | L2: late response after `supersede` (both orderings with supersede) | Supersede-first: order **retained** (replaces the placeholder), attempt SUPERSEDED unchanged. Response-first: A commits → ACTIVE → supersede refused |
| **B9-3** | L3: late response after PAID / CLOSED_UNAPPLIED (and FAILED_NO_ORDER once enabled) | Attempt field set byte-identical; event appended; order **retained** (+ anomaly if another attempt holds); FAILED_NO_ORDER → classification anomaly |
| **B9-4** | L4: payment on an unlinked order (resolvable; unresolvable) | Linked + `APPLICATION_EXPOSURE_ACKNOWLEDGED` + retained (+ anomaly if held by another) / `unmatched` |
| **B9-5** | L5: same late response 3× (incl. concurrent); same payment 3× | Single link, single event, no state change on repeats |
| **B9-6** | L6: reconcile after supersede, R4 order vs legacy order | Both **retained** (R4: `APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN`; legacy: `APPLICATION_EXPOSURE_UNKNOWN`); payability unknown for both |
| **B9-7** | Late response never restores a terminal attempt to ACTIVE (fuzz over all terminal states) | Invariant holds |
| **B10-1** | Override sequential: authorise → bind → CREATING → ACTIVE → second request | `CONSUMED`; second request returns the same order; no new attempt |
| **B10-2** | Override concurrent binding (2–6 parallel requests) | Exactly one `BOUND`; others get the same order or 409; stub creates = 1 |
| **B10-3** | Override with gateway timeout | `CONSUMED`; attempt UNKNOWN; new request 409; no second create |
| **B10-4** | Override, create OK, transaction P fails / transaction A fails / crash after A | P-fail: UNKNOWN; a later-discovered order is **retained** (or a placeholder if superseded before discovery); A-fail: ACTIVATION_FAILED; crash after A: `UNKNOWN`, retained when it leaves the holder role; never a second override use |
| **B10-5** | Override bound attempt superseded from CLAIMED, then rebound | `RELEASED` → `BOUND`; then `CONSUMED` |
| **B10-6** | Override expired / revoked / consumed / anomaly present / different keys | Binding refused with code |
| **B10-7** | Second replacement requires a new override | Without: 409; with a new authorised override: allowed once |
| **B10-8** | Retry of the order request during override CREATING | Same attempt; 409 or the same order |
| **B11-1** | Reviewed payment, bound CLOSED_UNAPPLIED | Applied; attempt CLOSED_UNAPPLIED unchanged; intent `paid_unapplied` unchanged; events appended |
| **B11-2** | Reviewed payment, bound PAID (after R-G2 made the obligation unpaid) | Applied; attempt PAID with `firstPaymentId` unchanged |
| **B11-3** | Reviewed payment, bound SUPERSEDED | Applied; attempt unchanged; intent `pending` unchanged |
| **B11-4** | Reviewed payment, FAILED_NO_ORDER without / with acknowledgement | 409 `CLASSIFICATION_ANOMALY_OPEN` / applied; attempt unchanged |
| **B11-5** | Reviewed payment, ANOMALY_MULTIPLE attempt or claim | 409 `ANOMALY_PENDING` |
| **B11-6** | Reviewed payment, unmatched, no attempt | `finance_attested` path only |
| **B11-7** | Byte-level terminal immutability check after every B11 path | Attempt and intent docs unchanged except none; events appended |
| **B12-1** | Bundle of 3 applied; refund mapped to line 2 (partial), processed | Line 2 net reduced; lines 1 and 3 unchanged; aggregate correct |
| **B12-2** | Bundle refund without mapping | 400 `REFUND_MAPPING_REQUIRED` |
| **B12-3** | Split refund across lines; over-line amount | Accepted / 409 `REFUND_EXCEEDS_LINE` |
| **B12-4** | Multiple partial refunds up to the captured amount; one more | Accepted until C1; then 409 |
| **B12-5** | Initiated refund counts as reserved but not processed; then failed | Blocks R-G2 / apply; then released; `intervention_required` |
| **B12-6** | Same refund ID recorded twice (same / different payload) | Replay / 409 `REFUND_ID_EXISTS` |
| **B12-7** | Per-line reversal only when that line is fully processed; others still applied | `partially_reversed`; others unchanged |
| **B12-8** | `apply_reviewed_payment` on an unallocated payment with payment-level partial refunds | Net exact match required |
| **B13-1** | Sponsor then reverse, no intervening change | Payables back to base(current) + 0 |
| **B13-2** | Base change on the sponsor between sponsor and reverse | New base preserved; compensating adjustment |
| **B13-3** | Base change on the sponsored obligation in between | Sponsored payable = new base after reversal |
| **B13-4** | Sponsor paid in between / sponsor order exposed / sponsored settlement changed | 409 `SPONSOR_ALREADY_PAID` / `SPONSOR_HAS_ONLINE_ORDER` / `SPONSORSHIP_STATE_CHANGED` |
| **B13-5** | Legacy sponsorship reverse with unchanged / changed `feeOverride` | Allowed / 409 `LEGACY_SPONSOR_AMOUNT_CHANGED` |
| **B13-6** | Concurrent reverse ↔ sponsor payment (both orderings) | One wins; no amount restored over a settled obligation |
| **B14-1** | Crash before CREATING committed / after CREATING before send | `CREATE_NOT_SENT_PROVEN` → `supersede` releases / possibly sent → placeholder retained on supersede |
| **B14-2** | Crash after the gateway create, before P; and after P, before A | `APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN` (after fence bump); `supersede` allowed as a state change but **retains** the order or placeholder |
| **B14-3** | Crash after A, before response construction | `APPLICATION_EXPOSURE_UNKNOWN`; `supersede` refused; retained on retire |
| **B14-4** | Crash during send | `APPLICATION_EXPOSURE_UNKNOWN`; retained |
| **B14-5** | Crash after send (with and without client ack) | `APPLICATION_EXPOSURE_UNKNOWN` / `APPLICATION_EXPOSURE_ACKNOWLEDGED`; retained either way |
| **B14-6** | `resolve_anomaly` adopt / supersede_all (disabled → 409 `ANOMALY_OPTION_DISABLED`) / retain_all with mixed exposure evidence | retain_all retains every order regardless of exposure; placeholders kept (§2.4) |
| **B14-7** | Legacy migration orders | `APPLICATION_EXPOSURE_UNKNOWN`, `GATEWAY_PAYABILITY_UNKNOWN` → retained; never released by `supersede` |
| **B14-8** | I17 check: every code path returning an order ID | Static and route test: no path returns an order ID without a committed marker |

---

**Revision 6 test additions and changes.** Same conventions: both orderings for races, N seeded repetitions, real route handlers, a deterministic gateway stub with crash-injection points (before CREATING, after CREATING before send, after the gateway create, after P, after A, during send), and an injected server clock.

| # | Scenario | Must show |
|---|---|---|
| B10-4, B14-1, B14-2, B9-2, B9-3, B9-6 (changed) | Previously "orphan not retained" | **Now: orphan retained / placeholder retained**; online unavailable afterwards |
| **B15-1** | Order created remotely, never persisted locally (crash after the gateway create, before P); Finance supersedes | Attempt SUPERSEDED; placeholder in `retainedPossibleOrders`; online 409; reconcile later finds the order → placeholder replaced by `retainedOrders` in one transaction; still 409 |
| **B15-2** | Late order discovered after a terminal attempt (SUPERSEDED-from-UNKNOWN, PAID, CLOSED_UNAPPLIED) | Attempt docs byte-identical; order retained; anomaly when another attempt holds |
| **B15-3** | Response marker absent (`APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN`) but the stub reports the order payable; then a payment arrives | Order retained throughout; payment → REJECT_DUPLICATE → review; no release at any point |
| **B15-4** | Unlinked order discovered by webhook: correlated via notes / uncorrelated | Linked + retained on the correct claims / `unmatched`, `correlation: none`, Finance item, no claim touched |
| **B15-5** | Identity cannot be correlated (conflicting link; notes disagree; notes missing; late response for a CLAIMED-superseded attempt) | Anomaly on every candidate claim; `correlation: ambiguous`; creation and application blocked |
| **B15-6** | Supersede from CLAIMED (never CREATING), incl. a race with CREATING (both orderings) | Release only when supersede commits first; else no release and a placeholder |
| **B15-7** | `resolve_anomaly adopt` / `supersede_all` while disabled | 409 `ANOMALY_OPTION_DISABLED` |
| **B15-8** | FAILED_NO_ORDER disabled: a 400 / 401 create error | OUTCOME_UNKNOWN (not FAILED_NO_ORDER); placeholder on supersede |
| **B15-9** | Legacy migration: a reservation with an order ID; a reservation in `reconciliation_*` without one | Retained (`legacy`, `APPLICATION_EXPOSURE_UNKNOWN`) / placeholder (`legacy_unknown`) |
| **B16-1** | Bind at `expiresAt − SKEW_MARGIN − 1 ms` / exactly at `expiresAt − SKEW_MARGIN` / after `expiresAt` (injected clock) | Bound / EXPIRED + 409 / EXPIRED + 409 |
| **B16-2** | Bind vs revoke, both orderings, N repetitions | Per the race matrix; never both |
| **B16-3** | RELEASED → bind vs expiry / revoke; `expiresAt` not extended by release | Per matrix |
| **B16-4** | CREATING vs revoke, both orderings (stub counts creates) | Revoke-first: **0 creates**; create-first: 1 create, revoke 409 `OVERRIDE_CONSUMED` |
| **B16-5** | Supersede-from-CLAIMED vs CREATING, both orderings | RELEASED + 0 creates / CONSUMED + placeholder on later supersede |
| **B16-6** | Consumed override then timeout / crash / P failure; then a second bind attempt | Stays CONSUMED; second bind 409; only reconciliation of the bound attempt |
| **B16-7** | SDK transaction retry crossing the expiry boundary (first attempt live, retry not live) | The retry re-reads time → EXPIRED; no binding from the stale first attempt |
| **B16-8** | Two concurrent payer requests binding; retry after a lost commit acknowledgement | One binding; the retry returns the same bound attempt |
| **B17-1** | R-G1 → refund processed → RF completes the reversal (one transaction) | Row processed, line reversal, obligation `unpaid`, payment `partially_reversed`, events and audit, all committed together |
| **B17-2** | RF fails **before** commit (injected), then retried (webhook redelivery / Finance retry) | First: no state change at all; retry: full commit once |
| **B17-3** | RF commits, response lost, webhook redelivered | Replay with no writes |
| **B17-4** | Duplicate refund webhook; repeated Finance record | Replay |
| **B17-5** | Conflicting evidence (amount, payment, processed vs failed) | Anomaly; row, obligation and payment unchanged; dead-letter |
| **B17-6** | Externally processed refund, unknown refund ID: single-line / bundle / exceeding captured | Processed row mapped / `unresolved` + C3 suspended + line actions blocked / not written + conflict anomaly |
| **B17-7** | `map_refund` completing a pending line reversal | Mapping + reversal in one transaction |
| **B17-8** | Initiated refund never confirmed | Obligation stays `reversal_pending`; worklist; reviewed apply and R-G blocked |
| **B17-9** | Bundle: partial refund on line 2 completing its reversal | Only line 2 reversed; lines 1 and 3 allocation, obligation and payment state unchanged |
| **B18-1** | Duplicate `mark_sponsored` (same / different `requestId`) | Replay / 409 `SPONSORSHIP_ALREADY_ACTIVE`; one `adj_add` |
| **B18-2** | Duplicate `reverse_sponsorship` (same / different `requestId`), incl. concurrent | Replay / 409 `SPONSORSHIP_NOT_ACTIVE`; one `adj_remove` |
| **B18-3** | Concurrent `mark_sponsored` ↔ `reverse_sponsorship`, and ↔ sponsor payment, both orderings | S8; versions consistent; never a restore over a settled obligation |
| **B18-4** | Base change that would make the payable negative | 409 `NEGATIVE_PAYABLE` |
| **B18-5** | Malformed history (two add rows; a remove without an add; mismatched amounts) | `reconciliation_required`; order, settle, apply and reverse 409 |
| **B18-6** | Legacy: reconstructable / not reconstructable | Legacy sponsorship record / `reconciliation_required` |
| **B18-7** | `reconcile_sponsorship` | Missing deterministic adjustments created; S6 verified; events and audit |

**Revision 7 tests.** Same conventions: both orderings for every race; N seeded repetitions; real route handlers; deterministic gateway stub with crash injection; injected clock; **injected Firestore transaction failures** (before the commit, and after the commit with a lost response).

| # | Scenario | Must show |
|---|---|---|
| **B19-1** | Claim release is impossible after CREATING: run `abandon_attempt`, `retire_exposed`, `resolve_anomaly retain_all` and LR on attempts in every post-CREATING state | Claim never derived OPEN; a retained entry exists after each; `supersede_unsent` → 409 `CREATE_ALREADY_SENT` |
| **B19-2** | Placeholders survive attempt retirement: abandon an UNKNOWN attempt → placeholder; then any further admin action (settle, reverse, waive, override-bind attempt while disabled) | Placeholder still present; online 409 |
| **B19-3** | Recovered order revalidated and reused: L1 → RECOVERED → payer request | `reactivate_attempt` → ACTIVE; the **same** order ID returned; stub creates = 1 |
| **B19-4** | Abandoning a recovered order does not enable a second order | ABANDONED; order retained; new request 409; stub creates = 1 |
| **B19-5** | ACTIVATION_FAILED → payer request (revalidation passes / fails) | Same order / 409, attempt unchanged; then `abandon_attempt` retains |
| **B19-6** | Terminal immutability: byte-compare attempt docs before and after LR, reviewed application, refunds and reversals for SUPERSEDED / ABANDONED / RETIRED-then-terminal / PAID / CLOSED_UNAPPLIED | Unchanged; events appended |
| **B19-7** | `supersede_unsent` ↔ CREATING (both orderings), with and without a bound override | Release + RELEASED override + 0 creates / 409 + CONSUMED override |
| **B19-8** | Late response after SUPERSEDED (impossible case injected) | Anomaly on claims |
| **B20-1** | R-G1 → refund processed (webhook path, gated test harness) → RF completes | Line reversal, obligation target, payment `partially_reversed`, request `completed`, lock cleared, all in one commit |
| **B20-2** | Each binding check 1–8 failing individually | Fact recorded; no completion; correct worklist code |
| **B20-3** | Two R-G1 on the same line (concurrent) | One `pending`; the other 409 |
| **B20-4** | Unresolved external refund → `map_refund` to the requested line / to a different line / a split | Completes / no completion / completes only if exactly one line with a pending request and all checks hold |
| **B20-5** | `map_refund` attempts to infer from a request (no mapping supplied) | 400 `MAPPING_REQUIRED` |
| **B20-6** | Webhook ↔ Finance outcome on the same refund ID (both orderings) | One commit; the other replay or anomaly |
| **B20-7** | Duplicate webhook ×3 incl. concurrent | Single row transition; single line reversal |
| **B20-8** | Two Finance users mapping concurrently | One mapping; the other replay / 409 |
| **B20-9** | RF ↔ `set_base_amount` / sponsorship on the obligation (both orderings) | Adjustment 409 while pending; or a version captured before R-G1 |
| **B20-10** | RF ↔ R-G3 cancel (both orderings) | Completion, or cancellation + `REFUNDED_LINE_STILL_SETTLED` worklist |
| **B20-11** | RF ↔ another line's RF on the same payment | Both complete; the application recomputed correctly |
| **B20-12** | Injected failure **before** commit, then retry | No state change, then a single completion |
| **B20-13** | Commit then **lost response**, then retry / redelivery | Replay; no second line reversal or obligation transition |
| **B20-14** | Firestore unavailable (503) while the refund is processed at Razorpay | Local state unchanged; retry succeeds later; worklist ages |
| **B20-15** | R-G1 when the line is already fully refunded | Completion in the same R-G1 transaction |

## 8. Migration, compatibility and rollback

Revision 4 §8 is retained, plus:
- **Legacy orders** (from `paymentReservations` or `razorpayIntents.orderId`) are linked in `gatewayOrders` with `source: legacy_migration`, **`APPLICATION_EXPOSURE_UNKNOWN`** and `GATEWAY_PAYABILITY_UNKNOWN` → retained on their obligations' claims. More than one per obligation → claim anomaly.
- **Legacy sponsorships** → `sponsorships` with `legacy: true` (§2.7.2).
- **Base amounts:** `amountBasePaise` = current effective fee for non-sponsored obligations; for legacy sponsors, the overwritten `feeOverride` is kept as base with `legacy` marking.
- **Rollback:** the non-flaggable guard (claims, attempts, overrides, anomaly) applies to every creation path. The response-gateway invariant I17 is code-level and stays. The Phase 1A decision stays on.
- **The late-fee backfill and all migration steps:** dry run first, with an owner-approved report before any production write.

---

**Revision 6 migration and rollback changes:**
- **Legacy orders** → `gatewayOrders` (`source: legacy_migration`, `APPLICATION_EXPOSURE_UNKNOWN`, `GATEWAY_PAYABILITY_UNKNOWN`) → `retainedOrders` (`legacy`) on their obligations' claims.
- **Legacy `reconciliation_*` reservations without an order ID** → `retainedPossibleOrders` (`legacy_unknown`).
- **Legacy correlation failures** → anomaly (L7).
- **Legacy sponsorships** → §2.7.3 reconstruction or `reconciliation_required`.
- **Rollback:** none of the disabled capabilities (I25) can be enabled by a rollback. Retained orders and placeholders are never cleared by rollback. The guard stays non-flaggable.

## 9. Role mapping (revision 4 §9 retained, plus)

| Action | Super | Finance | Club | Designer | Player |
|---|---|---|---|---|---|
| `set_base_amount` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `authorise_override`, `revoke_override` | ✓ | ✓ (if enabled) | ✗ | ✗ | ✗ |
| `acknowledge_classification_anomaly` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Order acknowledgement (`/order/ack`) | own orders | own orders | own orders | own orders | own orders |

---

## 10. Unresolved questions, owner recommendations and assumptions

**Owner recommendations recorded as requested.** These are **recommendations only**: they grant no permission to enable or implement any feature.

| # | Topic | Recommendation recorded | Status |
|---|---|---|---|
| Q13 | Replacement override (`expose_replacement`) | **Disabled for the initial release** | Recommendation; feature stays disabled |
| Q22 | Override expiry | 24 hours (`expiresAt = authorisedAt + 24 h`; fail-closed boundary with 60 s skew margin) | Recommendation |
| Q23 | Client acknowledgement | Optional; **never relied upon for safety** | Recommendation |
| Q24 | Base-amount changes on retained obligations | Finance / Super only, with a warning and audit | Recommendation |
| Q25 | Second approval for the replacement override | **Super Admin second approval** required | Recommendation |
| Q20 | Finance-attested payment allocation | **Second approver required** (a different user: Super Admin, or a second Finance Admin) | Recommendation |

**Still open (owner):**
- Q2 (second payment for the same subscription period): review.
- Q3 (no automatic unblock).
- Q4 (settle delay and back-off).
- Q5 (payer wording, incl. the new 409 `ONLINE_PAYMENT_UNAVAILABLE` after a superseded ambiguous create).
- Q6 (manual settlement while ACTIVE).
- Q7 (manual refunds).
- Q11 (roles).
- Q12 (Phase 1B switch-over).
- Q14 (partial refund keeps the obligation settled).
- Q15 (sponsor already paid).
- Q16 (bundle ≤ 20).
- Q18 (no cross-obligation or cross-player reallocation).
- Q19 (no partial payments).
- Q21 (subscription and merch reversal).

**Still open (reviewer + owner):**
- **Q17:** the gateway-unpayable verification rule (needs G1 + G3/G7). Until approved, `verify_orders_unpayable`, `adopt` and `supersede_all` stay disabled, and a superseded ambiguous create makes the obligation online-unavailable indefinitely (cash path only, or a one-time override if Q13 is ever reversed).
- **Q26 (new):** enabling FAILED_NO_ORDER (needs G6). Until then, every create error is OUTCOME_UNKNOWN.
- **Q27 (new):** the refund webhook ingestion design (needs G5): event shape, refund ID, signature. Until then, Finance-recorded evidence only.
- **Q28 (new):** the age threshold for the refund reconciliation worklist (recommend 24 h).
- **Q29 (new):** the availability impact of permanent retention. Should the owner accept that a superseded ambiguous attempt blocks online payment for that obligation until gateway verification exists? (The design assumes **yes**: fail-closed.)

**Assumptions** (not relied upon for safety unless stated):
- **A1:** 400 / 401 create bodies prove non-creation. **No longer relied upon** (FAILED_NO_ORDER disabled).
- **A2:** retained orders are payable (the fail-closed default).
- **A3:** test mode = live.
- **A4:** Firestore serialises conflicting transactions. **Relied upon**, a platform guarantee.
- **A5 (new):** application server clocks are NTP-synchronised within the 60 s skew margin. **Relied upon** for override expiry. A violation can only make an override expire *earlier* if the clock is ahead, or later by up to the clock error beyond the margin; mitigated by the margin and Q25 second approval.
- **A6 (new):** Razorpay refund IDs are unique and stable. Relied upon for refund idempotency; to be confirmed by G5.

**Gateway checks** G1–G7: none performed; none assumed.

**Revision 7 questions:**
- **Q30: RESOLVED — OWNER APPROVED (2026-11-24).** A payer's own order request automatically triggers `reactivate_attempt` (§2.10 O3) when their existing attempt is RECOVERED or ACTIVATION_FAILED. Reactivation reuses the **same** existing Razorpay order and never creates a replacement order. Mandatory server-side revalidation (§2.3.1) is unchanged. If revalidation fails, the response is 409 `ORDER_REVALIDATION_FAILED`, the attempt is left unchanged, and the claim and order stay retained for Finance review. Finance / Super Admin may also invoke reactivation. *This approves the Q30 behaviour only; it is not approval to implement any phase (§14).*
- **Q31:** When RF finds the obligation version changed (check 7), is cancel + re-request the required Finance path (recommended), or should Finance be able to re-bind the request to the current version (not recommended)?
- **Q32:** Wording for 409 `ORDER_REVALIDATION_FAILED` and `REVERSAL_PENDING`.

**Remaining assumptions** (unchanged from revision 6 unless noted):
- A2: retained orders are payable.
- A3: test = live.
- **A4 (relied upon):** Firestore serialises transactions.
- **A5 (relied upon):** clock skew ≤ 60 s.
- **A6:** refund IDs are unique and stable (G5).
- A1 is not relied upon.

## 11. Phased implementation plan and dependencies (revision 4 §11, extended)

| Phase | Revision 5 additions |
|---|---|
| 1A | `gatewayOrders` with exposure class; retention-on-payment; R11; refund ledger read model (for decisions); allocation lines; B9-4, B9-5, B11 (decision parts), B12-1 |
| 1B | Amount model (base + adjustments), `mark_sponsored` / `reverse_sponsorship` (§2.7.2), `set_base_amount`; B13-1…B13-6 |
| 2 | Derived claim states incl. retention-while-held anomaly; legacy order linking (`APPLICATION_EXPOSURE_UNKNOWN`, retained); B14-7 |
| 3 | Transactions P and A, the response-authorisation marker, I17, crash-window handling; B14-1…B14-5, B14-8 |
| 4 | Transaction LR (late responses, L1–L6), `supersede` with classification, `retire_exposed`, `claimOverrides` lifecycle (disabled); B9-1…B9-3, B9-6, B9-7, B10-1…B10-8 |
| 5 | `apply_reviewed_payment` (no attempt or intent writes), refund actions and ledger constraints, R-G per line, `resolve_anomaly`, classification-anomaly acknowledgement; B11-1…B11-7, B12-2…B12-8, B14-6 |

**Full D1/D2/D3 coverage is claimed only after 1A and 1B.**

---

**Revision 6 additions to the phase plan:**

| Phase | Addition |
|---|---|
| 1A | `retainedPossibleOrders`; both exposure dimensions on `gatewayOrders`; L4 / L7 in the webhook; B15-3, B15-4, B15-5 (webhook parts) |
| 1B | Sponsorship invariants S1–S8, deterministic adjustment IDs, `reconcile_sponsorship`; B18-1…B18-7 |
| 3 | CREATING-before-send boundary; FAILED_NO_ORDER disabled (Q26); B15-1, B15-8 |
| 4 | LR L1–L7; supersede rules (CLAIMED vs others); override race matrix and trusted time; B15-2, B15-6, B15-7, B16-1…B16-8 |
| 5 | Transaction RF, `map_refund`, R-G1 with in-transaction completion, refund worklist; B17-1…B17-9 |
| 2 / migration | Legacy placeholders and anomaly; B15-9 |

## 12. (reserved; numbering kept stable for cross-references)

---

## 13. Cross-cutting consistency check (revision 6)

| Area | Check | Result |
|---|---|---|
| Claim release vs gateway payability | Does any rule release a claim or drop a retained order based on application exposure, time, a zero lookup, refund, reversal or settlement? | **No.** Only `CREATE_NOT_SENT_PROVEN`, `GATEWAY_UNPAYABLE_PROVEN` (disabled) or a consumed one-time override (disabled) (§2.6.1, I3, I18). X15–X17 fixed |
| Application exposure classification | Used only for I17 response gating, evidence and risk rating? | Yes (§2.8.2) |
| Terminal attempt immutability | Any write path to a terminal attempt document? | None. LR, RF, reviewed application and anomaly resolution append events only (I8) |
| Intent immutability | Unchanged by later facts? | Yes |
| One-time override | Single binding; trusted-time expiry; CONSUMED permanent; races defined; no bypass of anomaly or retention | Yes (§2.6.2, I19) |
| Refund and line-reversal accounting | External facts recorded; local reversal atomic with the obligation transition; C1–C6 (C3 suspended only while `unresolved` exists) | Yes (§2.5.2, §2.9, I20, I23). X19, X20 fixed |
| Sponsorship amounts | Deterministic adjustments; S1–S8; fail-closed history check | Yes (§2.7.3, I24). X21 fixed |
| Reconciliation after external side effects | Order creation (LR), payments (webhook), refunds (RF + worklist) all have idempotent, retryable local recording that never infers safety from absence | Yes |
| Legacy migration and rollback | Legacy orders retained; unknown legacy creates → placeholders; disabled capabilities not enabled by rollback | Yes (§8) |
| Disabled capabilities | FAILED_NO_ORDER release, verification, adopt, supersede_all, refund webhook, override | All explicitly disabled with their gates (I25) |
| Earlier protections B1–B14 | Weakened? | **No.** B14's never-exposed proof is kept as evidence but **no longer permits release** (stricter). B10's `RELEASED` is now limited to `CREATE_NOT_SENT_PROVEN` (unchanged in effect). B12 is extended with external facts. B13 is extended with S1–S8 |

**Revision 7 consistency additions:**

| Area | Check | Result |
|---|---|---|
| Attempt ending vs release | Does any operation after CREATING release a claim? | No: only `supersede_unsent` releases (O1, I26); ABANDONED always retains |
| RECOVERED handling | Normal path reuses the same order; abandonment retains | Yes (O3, O2) |
| Override | Abandoning a bound attempt keeps the override CONSUMED; `supersede_unsent` → RELEASED | Yes (O1, O2, §2.6.2) |
| Reversal binding | One pending request per line; RF completion only with all eight checks; the refund fact always recorded | Yes (§2.9.2, §2.9.4, I27, I28) |
| Obligation writes while `reversal_pending` | All settlement and amount changes refused | Yes (§2.9.4) |
| Capability status | All gated capabilities DISABLED_BY_DEFAULT, design only; recommendations are not enablement | Yes (§0.C, I29) |
| Earlier safeguards B1–B18 | Weakened? | No |

## 14. NOT approved for implementation

- **Everything in this document.** No phase (1A, 1B, 2–7) may start until the independent reviewer approves revision 7 **and** the owner gives explicit approval for that specific phase. The owner's approval of Q30 (§10) is a behavioural decision only and does **not** approve Phase 1A, Phase 1B or any other phase.
- **Recorded owner recommendations (Q13, Q20, Q22–Q25) are not approvals** and enable nothing.
- **Separately approval-gated, even after design approval:**
  - enabling FAILED_NO_ORDER (Q26, G6);
  - `verify_orders_unpayable`, `resolve_anomaly adopt` / `supersede_all` (Q17; G1 + G3/G7);
  - refund webhook ingestion (Q27, G5);
  - `expose_replacement` (Q13, Q22, Q25);
  - the client acknowledgement endpoint (Q23);
  - the Phase 1B client switch-over (Q12);
  - the late-fee backfill and all migrations (dry-run report first);
  - Firestore rules deployment (only via `main`; both databases);
  - any gateway check G1–G7;
  - any production deployment or production data operation.
- **No other workstream** (R2-B, R6, UX) is implied.

- **Revision 7 additions to the NOT-approved list:** `supersede_unsent`, `abandon_attempt`, `reactivate_attempt`, reversal requests, line locks, transaction RF, `map_refund` and the worklist are **design only**. Every capability in §0.C remains **DISABLED_BY_DEFAULT**, with status "design only". Moving any capability to ENABLED_BY_OWNER_DECISION, IMPLEMENTED_NOT_DEPLOYED or DEPLOYED_OPERATIONALLY_VERIFIED requires the §0.C procedure and separate approval.

## 15. Resolution matrix: B15–B18

| Requirement | Resolution | Section |
|---|---|---|
| **B15** Separate the five concepts (response not authorised / exposure unknown / acknowledged / payability unknown / unpayable proven) | Two independent dimensions on `gatewayOrders` | §2.8.2 |
| B15 Absence of a marker ≠ unpayability | Exposure never used for release | §2.8.2, §2.6.1, I18 |
| B15 Discovered after failed P / ambiguous create: never-returned proof vs may-still-be-payable vs may-have-escaped | The three distinctions | §2.8.2 |
| B15 Default retain orphans whose status or exposure cannot be established | Retention table; placeholders for unknown IDs | §2.2, §2.6.1, I3 |
| B15 When a claim can be released; when an orphan is retained; sufficient evidence | Release table + evidence summary | §2.6.1, §2.8.4 |
| B15 Update supersede, resolve_anomaly, L1–L6, migration | Supersede split (CLAIMED vs others); `adopt` / `supersede_all` disabled; L1–L7; legacy placeholders | §2.3, §2.4, §4.4, §4.8, §8 |
| B15 Tests (remote-created never persisted; late after terminal; marker absent but payable; unlinked via webhook; uncorrelated identity) | B15-1…B15-9 | §7 |
| **B16** Races: AUTHORISED/RELEASED → BOUND vs expiry/revocation; BOUND → CREATING vs revocation; BOUND → RELEASED vs create; CONSUMED after timeout/crash/unknown | Transition table + race matrix | §2.6.2 |
| B16 Trusted server time in the transaction; expiry boundary | Server clock at each transaction attempt; `serverNow + 60 s < expiresAt`; lazy EXPIRED | §2.6.2, A5 |
| B16 CONSUMED never reusable; recovery = reconcile the bound attempt | Stated; I19 | §2.6.2, §6 |
| B16 Tests (concurrency, retries, clock boundaries) | B16-1…B16-8 | §7 |
| **B17** One local transaction: refund completion, summary, line-reversal evidence, payment application, obligation state, events, audit | Transaction RF (and R-G1 when already complete) | §2.9.2, §4.7 |
| B17 External fact; Firestore cannot transact with Razorpay; failure keeps the prior state and retries | §2.9.1; retry and worklist | §2.9.1, §2.9.2 |
| B17 Not unpaid on initiation; not reversed before the obligation transition | Same-transaction rule; C6; I23 | §2.9.1, I23 |
| B17 Same refund identity on retry; idempotent | Refund ID = row ID | §2.9.2 |
| B17 Partial bundle refund reverses only the mapped line | C4; RF step 3 | §2.5.2, §2.9.2 |
| B17 Duplicate webhooks; conflicting evidence; processed externally but not recorded | Table | §2.9.3 |
| B17 Tests (failure before and after commit, retry) | B17-1…B17-9 | §7 |
| **B18** Invariants 1–8 | S1–S8 with enforcement | §2.7.3, I24 |
| B18 Multiple adjustment rows / unreconstructable legacy → fail closed, Finance reconciliation | Read-time check → `reconciliation_required`; `reconcile_sponsorship` | §2.7.3 |
| B18 Tests (concurrency, duplicates) | B18-1…B18-7 | §7 |
| Cross-cutting review | X15–X22; consistency table | §0.2, §13 |
| Owner recommendations recorded, not approvals | Q13, Q20, Q22–Q25 | §10, §14 |

## 16. Resolution matrix: B9–B14 (revision 5, retained; read B14 rows together with B15 in §15)

| Requirement | Resolution | Section |
|---|---|---|
| **B9** Exact claim writes: late response after UNKNOWN / after supersede / after terminal; payment on an unlinked order; duplicates; reconcile after supersede | Transaction LR + cases L1–L6 | §4.4 |
| B9 Terminal stays terminal, yet the order is recorded | Recorded on `gatewayOrders` + claim + attempt event; attempt untouched | §2.3, §4.4, I8 |
| B9 Distinguish created / received / persisted / response sent / proven / uncertain | Stages S1–S6 | §2.8.1 |
| B9 Retain whenever exposure can't be disproven | Retention rule + fail-closed classes | §2.6, §2.8.2 |
| B9 Transaction boundaries, idempotency, audit, conflicts | LR keyed on `gatewayOrders/{orderId}`; event dedupe key; identity conflict → anomaly | §4.4 |
| B9 Never restore a terminal attempt to ACTIVE or create another payable order | Explicit "Never" list; I17 | §4.4, §6 |
| **B10** Holder acquisition; consumption; exactly one; concurrency; timeout; persistence failure; old retained orders kept; new approval for another; not a bypass | Override record and state machine; rules table | §2.6.1, §4.8, I19, B10-1…8 |
| **B11** CLOSED_UNAPPLIED vs reviewed payment conflict | Reviewed application never changes attempt or intent state | §4.6.2, X9, X10 |
| B11 Per-state handling (CLOSED_UNAPPLIED, SUPERSEDED, FAILED_NO_ORDER, PAID, RETIRED, no attempt) | Table | §4.6.3 |
| B11 No bypass of attempt or claim anomaly restrictions | V15 extended, V18 added | §4.6.1 |
| B11 Tests for terminal immutability on every path | B11-1…B11-7 | §7 |
| **B12** Captured; per-obligation allocation; refund mapping; per-obligation net; aggregate net; unmapped refunds; multiple partial; initiated; failed | Refund ledger | §2.5.2 |
| B12 Constraints 1–6 | C1–C6 | §2.5.2, I20 |
| B12 Reject when not deterministic | `REFUND_MAPPING_REQUIRED`, `REFUND_MAPPING_NOT_DETERMINISTIC` | §2.5.2, §4.6.1 |
| B12 Bundle-level tests | B12-1…B12-8 | §7 |
| **B13** Original amount; amount after sponsorship; sponsor reference; override representation; restored amount; both versions; intervening changes; sponsor paid or exposed order; audit links | Base + adjustments; sponsorship record; compensating reversal; legacy guard | §2.7.2, I22 |
| B13 No overwrite of intervening adjustments | No snapshot restore | §2.7.2 |
| B13 Tests | B13-1…B13-6 | §7 |
| **B14** NEVER_EXPOSED_PROVEN / EXPOSURE_UNKNOWN / EXPOSED_PROVEN | Revision 5 classes; **renamed and split in revision 6** into application exposure + gateway payability (§2.8.2); no longer used for release (B15) | §2.8.2, I18 |
| B14 Never-exposed only with reliable evidence | Write-ahead marker + response gateway + fence | §2.8.1, I17 |
| B14 Uncertain windows → retained | Crash-window table | §2.8.3 |
| B14 Apply to adopt / supersede_all / retain_all / supersede / late responses / rollback and migration | Each rule updated | §2.4, §4.4, §4.8, §8 |
| B14 Crash tests (before response, after construction, during send, after send) | B14-1…B14-5 (+ 6–8) | §7 |
| Cross-cutting review | X8–X14; consistency table | §0.2, §13 |

## 17. Resolution matrix: B19–B20

| Requirement | Resolution | Section |
|---|---|---|
| **B19** Distinguish (1) ending an attempt, (2) retaining orders, (3) releasing the claim | Three-concern table; separate operations | §2.10 |
| B19 Only `CREATE_NOT_SENT_PROVEN` permits release | `supersede_unsent` is the only releasing operation; I26 | §2.10 O1, O6, §6 |
| B19 Named operations and transitions: supersede CLAIMED; abandon after CREATING; retire OUTCOME_UNKNOWN; RECOVERED; ACTIVATION_FAILED; late response | O1 `supersede_unsent`; O2 `abandon_attempt` (incl. OUTCOME_UNKNOWN); O3 `reactivate_attempt`; O4 `retire_exposed`; O5 LR | §2.10 |
| B19 Recovered order normally revalidated and reused; if abandoned, claim and order retained | O3 default (incl. on the payer request); O2 retains | §2.10, §4.1 |
| B19 No post-CREATING operation clears a placeholder or retained order because no response was authorised | Rule + I26 | §2.10, §6 |
| B19 Exact claim, attempt and override writes per transition | Per-operation tables | §2.10 O1–O5 |
| B19 New terminal state distinguishing abandonment | ABANDONED; terminology rule | §0.B, §2.3 |
| B19 Tests (no release after CREATING; placeholders survive; reuse; abandon ≠ second order; terminal immutability) | B19-1…B19-8 | §7 |
| **B20** Bind the request to payment, allocation, obligation, exact amount, target, expected version, actor, request ID | `reversalRequests` fields | §2.9.4 |
| B20 One pending request per allocation line | `allocationLineLocks` CAS; I27 | §2.9.4, §6 |
| B20 RF checks 1–8 atomically | Part 2 binding checks | §2.9.2 |
| B20 RF success writes (refund, line reversal, obligation, application + summary, request, events, audit) | Part 2 writes | §2.9.2 |
| B20 Unresolved mapping: record the fact; no completion; explicit `map_refund`; no inference; completion only if unambiguous and the request is valid; conflicts stay on the worklist | `map_refund` rules | §2.9.3, §2.9.5 |
| B20 Concurrency: webhook vs Finance; duplicate webhook; two mappers; RF vs fee adjustment; RF vs another request; commit + lost response; Razorpay processed + Firestore unavailable | Outcomes table | §2.9.5 |
| B20 Idempotent by refund ID and request ID; no duplicate line reversal or obligation transition | Keys; checks 6–8; `create()` | §2.9.2, §2.9.5 |
| B20 Tests incl. orderings and injected failures | B20-1…B20-15 | §7 |
| **Consistency** Disabled-by-default / enabled-by-owner / implemented-not-deployed / deployed-verified; recommendations ≠ enablement | Taxonomy + current status table; I29 | §0.C, §6, §14 |
