# R4 — Razorpay Order Concurrency, Ambiguous Outcomes and Duplicate Payments: Architecture Design (revision 5)

**Status:** DESIGN ONLY, for independent review. **Not approved for implementation** (§14). Revision 5 resolves findings B9–B14 from the review of revision 4 (`f131e42`) and re-checks all state machines for contradictions (§13). No application code, Firestore rules, tests, test configuration or data changed. No Razorpay call, migration or deployment.
**Branch / base:** `mig-mov` @ `f131e42`
**Date:** 2026-11-23

**Evidence base:**
- Run `r4mwtfrkta4202`: `docs/qa/R4/evidence/R4_EXPERIMENT_RESULTS_AND_ANALYSIS.md`.
- Re-check: `docs/qa/R4/evidence/supplemental-e5-recheck/E5_RECHECK_RESULTS.md`.

**B9–B14 resolution matrix:** §15.

---

## 0. Summary, evidence and guarantees

### 0.1 Revision 5 summary

| Finding | Revision 4 | Revision 5 |
|---|---|---|
| **B14** exposure evidence | `exposedAt` unset was treated as "never exposed" | Fail-closed **exposure classification** per order: `NEVER_EXPOSED_PROVEN`, `EXPOSURE_UNKNOWN`, `EXPOSED_PROVEN`, built on a **write-ahead response-authorisation marker** that is the only gateway to any client response (§2.8). Everything that previously used `exposedAt` now uses the classification |
| **B9** late orders | `orderIdLate` written on the attempt (conflicted with terminal immutability); claim effect unspecified | Order-lifecycle stages defined (§2.8.1). Late or discovered orders are recorded on **`gatewayOrders`** (not the attempt) plus an appended attempt event, and **retained on the claim whenever exposure cannot be disproven**. Exact write sets, idempotency and conflicts for six cases (§4.4) |
| **B10** override | `overrideActive` flag; lifecycle unspecified | `claimOverrides/{ov_…}` record with states `AUTHORISED → BOUND → CONSUMED` (+ `EXPIRED`, `REVOKED`, `RELEASED`). **Exactly one replacement attempt**, consumed on entering CREATING. CAS-fenced binding; a new override needs a new approval (§2.6, §4.8) |
| **B11** reviewed payments vs terminal attempts | §4.6 allowed RETIRED → PAID and implied terminal changes | **`apply_reviewed_payment` never changes any attempt or intent state.** It writes allocation, payment application, obligation settlement (`basis: reviewed`) and appended events only. Per-state table (§4.6.3). RETIRED → PAID removed |
| **B12** refund accounting | Optional `obligationKey`; payment-level net | **Deterministic per-obligation refund ledger** with reservation-on-initiation, mandatory mapping for allocated bundles, per-obligation and aggregate net, six enforced constraints, rejection when the mapping is not deterministic (§2.5.2) |
| **B13** sponsorship amounts | Restore `feeOverride` and `sponsoring` | Amounts as **base amount + append-only adjustments** (`obligationAdjustments`); reversal = compensating adjustment, never value restoration; legacy guard; both versions CAS-checked (§2.7.2) |

### 0.2 Contradictions removed (in addition to revision 4's X1–X7)

| # | Revision 4 | Problem | Revision 5 |
|---|---|---|---|
| X8 | §2.3 "SUPERSEDED requires `exposedAt` unset" | Unset ≠ never exposed (B14) | Requires `NEVER_EXPOSED_PROVEN` (§2.8) |
| X9 | §4.6 step 5: RETIRED / eligible → PAID on review | Conflicted with first-outcome immutability; an attempt that has a payment is already CLOSED_UNAPPLIED (terminal) | Removed; reviewed application never touches attempt state (§4.6) |
| X10 | §4.6 step 6: intent `pending` → `paid` on review | Rewrote the intent based on a later human decision | Intent unchanged; event only (§4.6) |
| X11 | Revision 3/4 "`orderIdLate` on terminal attempt" | Wrote a terminal attempt document | Recorded on `gatewayOrders` + attempt event (§4.4) |
| X12 | §2.4 adopt: "every other anomaly order was never exposed (no `exposedAt`)" | Same as X8 | Uses classification (§2.4) |
| X13 | §2.2 HELD_OVERRIDE derived from a boolean flag | No consumption; reusable bypass | Bound to a one-time override record (§2.6) |
| X14 | §2.3 ACTIVATION_FAILED "order ID already on the attempt" even when persistence failed | Ambiguous | Persistence and activation split into two transactions (§2.8.1) |

### 0.3 Evidence (unchanged)

- **F1:** duplicate receipts accepted.
- **F2:** receipt listing eventually consistent.
- **F3:** orphan orders confirmed.
- **F4 (unverified):** live mode, fetch-by-ID, payments-per-order, a second payment on a paid order, cancellation or expiry, refund webhooks, non-creation errors.

**Firestore cannot make a Razorpay order unpayable.**

### 0.4 Guarantees

- **G-A:** ≤ 1 payment applied per obligation per settlement cycle.
- **G-B:** one immutable accounting record per captured payment; every unapplied payment is classified and reviewed; refunds are accounted per obligation; *initiated ≠ processed*.
- **G-C:** no obligation gains a second possibly-payable order unless a prior order is gateway-verified unpayable (disabled until verified) or a **one-time** authorised override is consumed (disabled by default).
- **G-D:** no automatic re-creation after an ambiguous attempt.
- **G-E (new): an order is treated as never exposed only with proof.** Every uncertain order is retained.

---

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

### 2.2 Claim model

Fields:
- `canonicalKey`
- `holderAttemptId | null`, `holderFence`
- `retainedOrders[]`: `{orderId, attemptId, reason: exposed_retired | paid_applied | paid_rejected | exposure_unknown | anomaly_found, exposureClass, since}`
- `anomaly: false | {attemptIds[], orderIds[], since, source}`
- `boundOverrideId | null`
- `version`
- append-only `events`

| Derived state | Condition | Order creation |
|---|---|---|
| OPEN | no holder, no retained, no anomaly | new attempt allowed |
| HELD | holder, no retained, no anomaly, no bound override | none; the holder's ACTIVE order is returned after revalidation, else 409 |
| RETAINED | no holder, retained ≥ 1, no anomaly | none (409 `ONLINE_PAYMENT_UNAVAILABLE`), unless an `AUTHORISED` override exists (§2.6) |
| HELD_OVERRIDE | holder = the override's bound attempt, retained ≥ 1, no anomaly | none; the holder's ACTIVE order is returned after revalidation, else 409 |
| ANOMALY | anomaly set | none (409 `PAYMENT_UNDER_REVIEW`); overrides cannot be bound |

**Retention-while-held rule:** if an order with class `EXPOSURE_UNKNOWN` or `EXPOSED_PROVEN` must be retained on a claim whose holder is a *different* attempt (any state), the transaction also sets the **anomaly** flag (two possibly-payable orders). This holds unless the holder is the override-bound replacement and the retained order predates the override.

### 2.3 Attempt state machine

- **Non-terminal:** CLAIMED, CREATING, ORDER_RECEIVED, ACTIVATION_FAILED, ACTIVE, OUTCOME_UNKNOWN, RECONCILING, RECOVERED, ANOMALY_MULTIPLE, RETIRED.
- **Terminal:** PAID, CLOSED_UNAPPLIED, SUPERSEDED, FAILED_NO_ORDER.

**Terminal rule (I8):** once terminal, the attempt document's fields `state`, `fenceVersion`, `gatewayOrderId`, `exposure`, `firstPaymentId` and `obligationKeys` are **never written**. All later facts (late order, late payment, review decision) are recorded on `gatewayOrders`, `gatewayPayments`, the claim, and as **appended** `paymentAttempts/{id}/events` rows.

| From | To | Trigger | Actor |
|---|---|---|---|
| CLAIMED | CREATING | create about to be sent (fenced; consumes a bound override, §2.6) | system |
| CLAIMED | SUPERSEDED | `supersede` (§4.8) | Finance / Super |
| CREATING | ORDER_RECEIVED | 2xx with valid `order.id` (in memory) | system |
| CREATING | FAILED_NO_ORDER | complete HTTP 400 `BAD_REQUEST_ERROR` or 401 body only (pending G6) | system |
| CREATING | OUTCOME_UNKNOWN | any other outcome, incl. crash or lease expiry observed by another reader (**the observer bumps the fence**) | system |
| ORDER_RECEIVED | (persisted: `gatewayOrderId` set) | **Persist transaction P** (§2.8.1) | system |
| ORDER_RECEIVED (persisted) | ACTIVE | **Activation transaction A** commits the response-authorisation marker (§2.8.1) | system |
| ORDER_RECEIVED (persisted) | ACTIVATION_FAILED | transaction A failed (marker **not** committed) | system |
| ORDER_RECEIVED (not persisted) | OUTCOME_UNKNOWN | transaction P failed after retries; lease expiry observed (order exists, unrecorded) | system |
| ACTIVATION_FAILED, RECOVERED | ACTIVE | revalidation + activation transaction A (§2.3.1) | system / Finance `reconcile` |
| OUTCOME_UNKNOWN | RECONCILING | `reconcile` | Finance / worker |
| OUTCOME_UNKNOWN | RECOVERED | late response recorded by the original process **while the attempt is non-terminal** (§4.4 case L1) | system |
| RECONCILING | RECOVERED / OUTCOME_UNKNOWN / ANOMALY_MULTIPLE | 1 found / 0 or lookup failed / > 1 | system |
| ANOMALY_MULTIPLE | RECOVERED / SUPERSEDED / RETIRED | `resolve_anomaly` (§2.4) | Finance / Super |
| ACTIVE | PAID | first captured payment applied (webhook) | system |
| ACTIVE | RETIRED | `retire_exposed`; manual settle / sponsor / waive with acknowledgement; abandonment; `apply_reviewed_payment` with `retireConflictingAttempt` | Finance / Super (Club for match-fee `settle_manual`); system |
| CREATING, OUTCOME_UNKNOWN, RECONCILING, RECOVERED, ACTIVATION_FAILED | SUPERSEDED | `supersede`, **only if the attempt's exposure class is `NEVER_EXPOSED_PROVEN`** (§2.8) | Finance / Super |
| eligible (below) | CLOSED_UNAPPLIED | first captured payment for this attempt rejected | system |
| ACTIVE, RETIRED (marker committed) | SUPERSEDED | **Forbidden** | – |
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

### 2.4 `ANOMALY_MULTIPLE` lifecycle (B14 applied)

- **Definition:** as in revision 4. (a) An attempt state: more than one order for one attempt's receipt. (b) A claim anomaly flag: more than one possibly-payable order for one obligation, including via the retention-while-held rule (§2.2).
- **Blocking:** creation (§4.1), automatic application (§4.2 R6), override binding (§2.6) and reviewed application (§4.6 V15) are all refused while an anomaly is set.

`resolve_anomaly` (Finance / Super; `requestId`; one transaction; events + audit):

| Option | Preconditions (fail-closed) | Effect |
|---|---|---|
| `adopt {orderId}` | `orderId` ∈ anomaly orders; fetch-validated (G1); **every other anomaly order is `NEVER_EXPOSED_PROVEN`** | Attempt → RECOVERED → (revalidate, transaction A) ACTIVE; anomaly cleared; other orders recorded as orphans in claim events (not retained). If any other order is `EXPOSURE_UNKNOWN` / `EXPOSED_PROVEN` → **409 `OTHER_ORDERS_POSSIBLY_EXPOSED`** (use `retain_all`) |
| `supersede_all` | **Every** anomaly order and the attempt are `NEVER_EXPOSED_PROVEN` | Attempt → SUPERSEDED; anomaly cleared; holder cleared (release condition 1). Otherwise **409** |
| `retain_all` | Always allowed | Each order: `NEVER_EXPOSED_PROVEN` → orphan event only; otherwise → `retainedOrders` (`anomaly_found`, with class). Attempt → RETIRED if its marker was committed, else SUPERSEDED (only if `NEVER_EXPOSED_PROVEN`), else RETIRED (fail-closed). Anomaly cleared; holder cleared |

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
| C3 | `aggregateNetAllocated ≤ netCaptured`. For allocated payments, every processed refund is line-mapped, so this holds with equality; payment-level rows on an allocated payment are rejected (table above) |
| C4 | A row mapped to line k changes only `line.*(k)`; other lines' figures are untouched (mapping is explicit and immutable) |
| C5 | No double counting: one row per Razorpay refund ID (`create()`); one state change per row; totals recomputed from rows |
| C6 | `initiated` is never `processed`: only `processed` rows reduce `net`; `initiated` rows reserve capacity (C1/C2) and block actions that need certainty (§4.6 V9, R-G2) |

**Lifecycle effects:**
- **Multiple partial refunds:** additional rows, each C1–C5 checked.
- **Failed refund:** the row → `failed`; its reservation is released (excluded from `reserved*`); the payment summary becomes `intervention_required` until Finance records a follow-up.
- **Per-line reversal (R-G2):** allowed for line k only when `line.processed(k) == allocatedPaise(k)` and no `initiated` row maps to k. It creates `lineReversals/{k}`. Payment application → `partially_reversed`, or `reversed` when all lines are reversed.
- **Non-deterministic mapping** (e.g. a refund recorded in the dashboard without knowing which item it relates to): reject the record; the payment stays `intervention_required` for Finance reconciliation.

**Summary fields on the payment** (cache, rewritten in the same transaction from rows): `refundReservedPaise`, `refundProcessedPaise`, `netCapturedPaise`, `refundPendingCount`, `refundStatus` ∈ `not_required | required | partially_refunded | refunded | intervention_required`.

### 2.6 Claim release and the one-time override (B10)

**Retention** (adding to `retainedOrders`) happens whenever an order's exposure class is `EXPOSURE_UNKNOWN` or `EXPOSED_PROVEN` and it is not the current holder's own ACTIVE order (§2.8, §4.4). Paid orders are retained (`paid_applied` / `paid_rejected`).

**Release is permitted only by:**
1. **`NEVER_EXPOSED_PROVEN`** for the order or attempt (§2.8): `supersede`, FAILED_NO_ORDER, `resolve_anomaly supersede_all`. Such orders are never retained.
2. **Gateway-verified unpayable** (`verify_orders_unpayable`): **disabled** until G1 + G3/G7 are verified and the rule approved (Q17).
3. **One-time override (consumed):** described below.

#### 2.6.1 Override record: `claimOverrides/{ov_<uuid>}`

- **Fields:** `obligationKeys[]` (exactly the claims of one obligation or one bundle), `reason` (≥ 20 chars), `acknowledgeTwoPayableOrders: true`, `authorisedBy`, `requestId`, `state`, `boundAttemptId?`, `expiresAt` (authorisation + 24 h, Q22), `retainedOrdersAtAuthorisation[]` (snapshot), append-only `events`.
- **Feature flag:** `expose_replacement` disabled by default (Q13). When disabled, authorisation returns 403 `OVERRIDE_DISABLED`.

| State | Meaning | Next |
|---|---|---|
| `AUTHORISED` | Approved; not yet used | `BOUND` (a replacement attempt claims it); `EXPIRED` (lazily, at first read after `expiresAt`); `REVOKED` (Finance) |
| `BOUND` | A replacement attempt (CLAIMED) holds the claims under this override | `CONSUMED` (the attempt enters CREATING); `RELEASED` (the bound attempt is SUPERSEDED **from CLAIMED**, i.e. no create was ever sent) |
| `RELEASED` | Bound attempt never sent a create | `BOUND` again (same override, still before `expiresAt`) |
| `CONSUMED` | The one permitted replacement create was sent (or may have been) | terminal |
| `EXPIRED`, `REVOKED` | Unused | terminal |

**Rules:**

| Question | Rule |
|---|---|
| How the replacement acquires the holder | In `claimObligations` (§4.1), one transaction: all claims RETAINED, no anomaly; override `AUTHORISED` (or `RELEASED`), not expired, and covering exactly these obligation keys; CAS override `state` → `BOUND`, `boundAttemptId` = new attempt; each claim `holderAttemptId` = new attempt, `boundOverrideId` = override; attempt CLAIMED with `overrideId` |
| When consumed | In the **same transaction** that moves the bound attempt CLAIMED → CREATING (before `orders.create` is sent). From then on an order may exist, so the override can never be reused |
| Exactly one replacement order creation | Yes. A `BOUND` / `CONSUMED` override admits only `boundAttemptId`; a `CONSUMED` override admits nothing further |
| Concurrent requests | Both transactions CAS the override state and claim holders; exactly one commits `BOUND`; the other re-reads and sees HELD_OVERRIDE (another attempt) → returns that attempt's ACTIVE order or 409 `PAYMENT_BEING_VERIFIED` |
| Timeout / unknown outcome | Attempt → OUTCOME_UNKNOWN; override stays `CONSUMED`; claim HELD_OVERRIDE with a non-ACTIVE holder → 409 for new requests; normal reconciliation. **No second replacement** |
| Create succeeded, persistence (transaction P) failed | Attempt → OUTCOME_UNKNOWN after lease expiry; order unrecorded; later discovery → `NEVER_EXPOSED_PROVEN` (no marker) → orphan event; override `CONSUMED`. If activation transaction A failed → ACTIVATION_FAILED → revalidate → ACTIVE, or `supersede` (`NEVER_EXPOSED_PROVEN`) |
| Retry | The client retries the order request → claim HELD_OVERRIDE → the same attempt's ACTIVE order is returned after revalidation, or 409. Never a new attempt |
| Old retained orders | **Permanently recorded**; never removed by the override. The replacement's own order, when the replacement attempt leaves the holder role (PAID, RETIRED, SUPERSEDED), is added to `retainedOrders` per §2.8, and `boundOverrideId` is cleared |
| Another replacement | Requires a **new** override record (new approval, new `requestId`, new reason and acknowledgement) |
| Not a general bypass | Binding is refused while there's an anomaly, for different obligation keys, after expiry or revocation, or when consumed. An override never changes retained orders, settlement, or another obligation |

### 2.7 Reversal workflows

#### 2.7.1 Matrix (revision 4 §2.7 retained; amounts per §2.7.2)

| Workflow | Obligation | Claim | Attempt | Exposed order payable? | Replacement allowed? | Role + audit |
|---|---|---|---|---|---|---|
| R-M `reverse_manual_settlement` | `settled_manual` → `unpaid` | none (event) | none | yes if retained → payment → review | only if claim OPEN; else release condition 2 or 3 | Finance / Super; settlement event; audit |
| R-G1 `initiate_gateway_reversal {obligationKey}` | `settled_gateway` → `reversal_pending` | none | none (PAID terminal) | treated as payable (G3) | no | requires ≥ 1 `initiated` or `processed` refund row mapped to that line |
| R-G2 `complete_gateway_reversal {obligationKey, to: unpaid\|waived}` | `reversal_pending` → `unpaid` / `waived` | none (paid order stays retained) | none | treated as payable | only release condition 2 or 3 | requires `line.processed(k) == allocatedPaise(k)` and no `initiated` row mapped to k (§2.5.2); creates `lineReversals/{k}` |
| R-G3 `cancel_gateway_reversal` | `reversal_pending` → `settled_gateway` | none | none | – | no | refund failed or abandoned |
| R-S `reverse_sponsorship` | §2.7.2 | none on either claim | none | sponsored claim RETAINED stays | only if the sponsored claim is OPEN | §2.7.2 |
| R-W `reverse_waiver` | `waived` → `unpaid` | none | none | yes if retained | only if claim OPEN | abandonment guard |

#### 2.7.2 Amounts and sponsorship (B13)

**Amount model** (all obligations whose amount can change: match fees, other fees):

| Component | Representation |
|---|---|
| **Base amount** | `amountBasePaise`: the fee from the fee plan / template / override decision. Changed only by `set_base_amount` (Finance, with event; this is today's `feeOverride` semantics) |
| **Adjustments** | `obligationAdjustments/{adj_<uuid>}`, append-only: `{obligationKey, type: sponsorship_add \| sponsorship_remove \| other, amountPaise (signed), sponsorshipId?, compensatesAdjId?, by, reason, requestId, at}` |
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

## 2.8 Exposure classification (B14) and order lifecycle (B9)

### 2.8.1 Order lifecycle stages and evidence

| Stage | Recorded as | Durable? |
|---|---|---|
| S1 Gateway order created | Not observable by us until S2 or later discovery | – |
| S2 Order ID received by the server | In memory only | No |
| S3 Order ID persisted | **Transaction P:** attempt `gatewayOrderId` (attempt non-terminal, fence valid) + `gatewayOrders/{orderId}` `create()` `{attemptId, source: "create_response", exposureClass: NEVER_EXPOSED_PROVEN}` + event | Yes |
| S4 **Response authorised (write-ahead marker)** | **Transaction A:** revalidate; attempt → ACTIVE; `exposure.markerAt`; `gatewayOrders/{orderId}.exposureClass` → `EXPOSURE_UNKNOWN`; claim holder confirmed; event `response_authorised`. **This is the only code path permitted to place a gateway order ID in any HTTP response** | Yes |
| S5 Response sent to the client | Not reliably observable (a crash may occur during or after send) | – |
| S6 Exposure proven | `gatewayOrders/{orderId}.exposureClass` → `EXPOSED_PROVEN` via (a) a signed captured payment on the order, or (b) the client checkout acknowledgement `POST /api/razorpay/order/ack {orderId}` (authenticated payer; idempotent; optional evidence, Q23) | Yes |

**Response gateway invariant (I17):** the server returns an order ID to a client **only** after transaction A for that order has committed, and only on that request or on a later revalidated reuse of the same ACTIVE attempt. Transaction A requires the attempt to be non-terminal with a valid fence. Every fence bump (OUTCOME_UNKNOWN observation, supersede, retire, anomaly) is itself transactional, so either A committed before the bump (the marker exists) or A cannot commit afterwards.

### 2.8.2 Classification (stored on `gatewayOrders/{orderId}.exposureClass`; monotonic: may only move up)

| Class | Condition (fail-closed) |
|---|---|
| `NEVER_EXPOSED_PROVEN` | The order is linked to an R4 attempt **and** no `response_authorised` marker (transaction A) was ever committed for it **and** the attempt's fence has been bumped, or the attempt is terminal, so transaction A can no longer commit |
| `EXPOSURE_UNKNOWN` | A marker was committed (response may or may not have been sent or received); **or** the order belongs to a **legacy** (pre-R4) reservation or intent (no marker mechanism); **or** the order cannot be linked to an R4 attempt; **or** the fence condition above cannot be established |
| `EXPOSED_PROVEN` | A signed captured payment on the order, or an authenticated client acknowledgement |

**Transitions:** `NEVER_EXPOSED_PROVEN → EXPOSURE_UNKNOWN → EXPOSED_PROVEN` only. A payment on a `NEVER_EXPOSED_PROVEN` order moves it to `EXPOSED_PROVEN` (it was paid, so it was reachable, e.g. a leaked ID) and triggers retention (§4.4 case L4).

**Where the classification is used** (fail-closed: anything not `NEVER_EXPOSED_PROVEN` is retained or blocks release):

| Use | Rule |
|---|---|
| `supersede` | Allowed only if the attempt's order (if any) is `NEVER_EXPOSED_PROVEN` and no marker exists on the attempt |
| `resolve_anomaly adopt` / `supersede_all` / `retain_all` | §2.4 |
| Late responses and discovered orders | §4.4 |
| Retire / settle with acknowledgement | The retired order's class is `EXPOSURE_UNKNOWN` or higher, so it is retained |
| Rollback and legacy migration | Legacy orders → `EXPOSURE_UNKNOWN` → retained (§8) |

### 2.8.3 Crash windows

| Crash point | Marker committed? | Class | Claim effect |
|---|---|---|---|
| Before transaction P | no | order unrecorded; on discovery → `NEVER_EXPOSED_PROVEN` (if the attempt's fence is bumped or it is terminal) | orphan event, not retained |
| After P, before A | no | `NEVER_EXPOSED_PROVEN` (after fence bump) | not retained; `supersede` allowed |
| After A commits, before the response is constructed | yes | `EXPOSURE_UNKNOWN` | retained if it leaves the holder role |
| During send | yes | `EXPOSURE_UNKNOWN` | retained |
| After send | yes | `EXPOSURE_UNKNOWN` (or `EXPOSED_PROVEN` after ack or payment) | retained |

---

## 3. Data model and identifiers

Revision 4 §3 is retained; changes and additions:

| Collection | Notes |
|---|---|
| `paymentAttempts` (+ `events`) | `exposure {markerAt?}` replaces `exposedAt`; `overrideId?`. **No `orderIdLate`** (late orders live on `gatewayOrders`) |
| `gatewayOrders/{orderId}` | `{attemptId?, intentId?, obligationKeys[], source: create_response \| late_response \| reconcile \| webhook \| finance_attach \| legacy_migration, exposureClass, exposureEvidence[], firstSeenAt}`. `create()`; class monotonic; an existing link with a different `attemptId` → IDENTITY anomaly (§4.4) |
| `paymentObligationClaims` (+ `events`) | §2.2 fields |
| `claimOverrides/{ov_…}` (+ `events`) | §2.6.1 |
| `gatewayPayments` (+ `allocations`/`lineReversals`, `refunds`, `anomalies`, `events`) | §2.5 |
| `obligationAdjustments`, `sponsorships` | §2.7.2 |
| `lateFeeObligations`, `subscriptionPeriods`, `merchOrders` (server-minted IDs) | unchanged |
| `adminRequests/{requestId}` | admin idempotency |
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
| Claim (transaction) | ≤ 20 obligations, one player, all `unpaid`. Each claim: **OPEN** → new attempt (holder); **RETAINED** with a bindable override covering exactly these keys → bind (§2.6.1); **HELD / HELD_OVERRIDE** by this payer's ACTIVE attempt with an identical set and amount → revalidate and reuse; otherwise 409 (`ONLINE_PAYMENT_UNAVAILABLE`, `PAYMENT_UNDER_REVIEW`, `PAYMENT_BEING_VERIFIED`, `ALREADY_PAID`) |
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
- **R5:** SUPERSEDED / RETIRED → REJECT_DUPLICATE.
- **R6:** anomaly (attempt or claim) → REJECT_DUPLICATE.
- **R7:** attempt has `firstPaymentId` → REJECT_DUPLICATE.
- **R8:** obligation not `unpaid`, or holder ≠ attempt → REJECT_DUPLICATE.
- **R9:** amount ≠ current payable → REJECT_DUPLICATE.
- **R10:** APPLY.
- **New R11 (evaluated before R3):** order not linked in `gatewayOrders` → link-or-classify per §4.4 L4 first, then evaluate.

### 4.3 Webhook write sets

Revision 4 §4.3 is retained, with these changes:
- Every decision that records a payment for a linked order also **raises that order's `exposureClass` to `EXPOSED_PROVEN`** (event `exposure_proven_by_payment`).
- **APPLY:** claim holder cleared; order → `retainedOrders` (`paid_applied`).
- **REJECT_DUPLICATE:** order → `retainedOrders` (`paid_rejected`) on every claim of the bound obligations, applying the retention-while-held rule (§2.2).
- The CLOSED_UNAPPLIED eligibility table (§2.3) governs attempt changes; terminal attempts get events only.
- Allocation (APPLY): `alloc_<paymentId>` with basis `webhook_attempt` / `webhook_intent`; lines = the obligations' payable amounts; Σ = captured (else R9 had already rejected).

### 4.4 Late responses and discovered orders (B9)

**Common transaction LR** (one transaction per order; idempotency key = `gatewayOrders/{orderId}`):
1. Read `gatewayOrders/{orderId}`, the attempt, its claims (+ holders), and any override.
2. **Link:** absent → `create()` `{attemptId, source, exposureClass}`. Present with the same `attemptId` → no write (idempotent). Present with a **different** `attemptId` → `gatewayPayments`-independent **order identity anomaly** (claim anomaly flag + high-severity dead-letter `order_identity_conflict`), no other writes.
3. **Classify** per §2.8.2.
4. **Claim effect:** if the class ≠ `NEVER_EXPOSED_PROVEN` and the order is not the current holder's own ACTIVE order → add to `retainedOrders` with its class (retention-while-held rule may set the anomaly). If `NEVER_EXPOSED_PROVEN` → claim event `orphan_order_recorded` only.
5. **Attempt:** non-terminal and own fence valid → as per the case; terminal → **appended event only**.
6. Audit: events; a human-triggered reconcile also writes `auditLogs`.
7. Response to the original HTTP request (late response cases): **409 `ORDER_NOT_AVAILABLE`, never the order ID** (the I17 marker was not committed by this request).

| Case | Attempt state when the order is learned | Class | Claim effect | Attempt effect | Payable-order outcome |
|---|---|---|---|---|---|
| **L1** Late response, attempt OUTCOME_UNKNOWN, fence bumped by an observer | non-terminal | `NEVER_EXPOSED_PROVEN` (no marker; fence bumped) | holder unchanged (same attempt); no retention | → **RECOVERED** with `gatewayOrderId` (non-terminal, so allowed; the observer's fence is used) | Exposure only after revalidation + transaction A via `reconcile`; the original request gets 409 |
| **L2** Late response after `supersede` (attempt was `NEVER_EXPOSED_PROVEN`) | SUPERSEDED (terminal) | `NEVER_EXPOSED_PROVEN` | orphan event; **no retention** (the claim may have a new holder) | event `order_late_after_supersede` only | none; if ever paid → L4 |
| **L3** Late response after another terminal state: PAID / CLOSED_UNAPPLIED (a different order was used) or FAILED_NO_ORDER | terminal | `NEVER_EXPOSED_PROVEN` (marker can only exist for the attempt's own activated order) | orphan event; FAILED_NO_ORDER → also a **classification anomaly** (high; G6 rule contradicted) | event only | none |
| **L4** Captured payment on an order not yet linked | any or none | → `EXPOSED_PROVEN` | attempt resolvable via `notes.attemptId` / intent → link + retain (`paid_*`) on that attempt's obligations' claims (retention-while-held rule). **Not resolvable** → no claim known → payment `unmatched` (REJECT_INVALID), dead-letter | per §4.3 (terminal → event only) | retained; payment decided by §4.2 |
| **L5** Duplicate late response / duplicate payment event | – | unchanged (monotonic) | none (link exists, same `attemptId` → no write; event deduped by `eventId` = hash(orderId, source, gateway event id)) | none | none |
| **L6** Reconciliation discovers an order after the attempt was superseded | SUPERSEDED | per §2.8.2: `NEVER_EXPOSED_PROVEN` if no marker + terminal | orphan event, no retention; if the class is not provable (e.g. legacy) → `EXPOSURE_UNKNOWN` → **retained** (+ anomaly if the claim is held) | event only | none, or retained |

**Never:** a late response or discovery moves a terminal attempt to any state, sets ACTIVE without transaction A, returns an order ID in a response without transaction A, or releases a claim.

### 4.5 Manual settlement endpoint (revision 4 §4.5 retained; amounts per §2.7.2)

| Action | Role | Preconditions | Writes | Claim |
|---|---|---|---|---|
| `settle_manual` | Finance / Super; Club (match fees) | `unpaid` at version; no anomaly; not HELD by a non-ACTIVE attempt; HELD by ACTIVE → `acknowledgeOpenOnlinePayment` | `settled_manual`; event; audit | acknowledged → holder RETIRED; order retained (class ≥ `EXPOSURE_UNKNOWN`) |
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
4. Claims: the payment's order (class `EXPOSED_PROVEN`) stays or is added in `retainedOrders` (`paid_applied`); if `retireConflictingAttempt`, the conflicting ACTIVE attempt → RETIRED, its order retained; holder cleared if the holder was the payment's attempt or the retired one; claim events.
5. **Bound attempt: state unchanged; event `reviewed_payment_applied {paymentId, allocationId}` appended.**
6. **Bound intent: state unchanged; event `reviewed_settlement_recorded` appended.**
7. `adminRequests`, `auditLogs`.

#### 4.6.3 Per-state handling of the bound attempt (B11)

| Bound attempt state | Allowed? | Attempt write | Intent write |
|---|---|---|---|
| CLOSED_UNAPPLIED (this was its first payment) | yes | **event only** | event only (stays `paid_unapplied`) |
| PAID (additional payment) | yes, if the target obligations are `unpaid` (e.g. after R-G2) and V1–V18 pass | event only | event only (stays `paid`) |
| SUPERSEDED (late payment on an orphan) | yes, if V1–V18 pass | event only | event only (stays `pending`) |
| FAILED_NO_ORDER | only after `acknowledge_classification_anomaly` (V18) | event only | event only |
| RETIRED | **not reachable**: any captured payment on a RETIRED attempt's order already moved it to CLOSED_UNAPPLIED (§2.3); a RETIRED attempt with no payment has nothing to review | – | – |
| ANOMALY_MULTIPLE | **no** (V15) | – | – |
| Non-terminal other (ACTIVE, UNKNOWN, …) bound to a reviewable payment | not reachable (first payment moves it to CLOSED_UNAPPLIED or PAID) | – | – |
| **No attempt** (unmatched, unbound) | yes, only with `finance_attested` (V14) | none | none |

### 4.7 Refund actions (B12)

| Action | Role | Preconditions | Writes | Failure | Idempotency |
|---|---|---|---|---|---|
| `record_refund_initiated {paymentId, refundId, amountPaise, mapping}` | Finance / Super | mapping per §2.5.2 table; C1, C2 hold after adding | refund row `create()` (`initiated`); summary recomputed; payment event; audit | 400 `REFUND_MAPPING_REQUIRED`; 409 `REFUND_EXCEEDS_CAPTURED` / `REFUND_EXCEEDS_LINE`; 409 `REFUND_ID_EXISTS` (different payload) | row ID = refund ID; same payload → replay |
| `record_refund_outcome {refundId, processed\|failed, evidence}` | Finance / Super; refund webhook (after G5) | row `initiated` | row → `processed` / `failed`; summary; event; audit | 409 `REFUND_NOT_PENDING` | state CAS; same outcome → replay |
| R-G1 / R-G2 / R-G3 | Finance / Super | §2.7.1 | §2.7.1 | 409 | `requestId` |

### 4.8 Attempt, claim and override actions

| Action | Role | Preconditions | Writes / transitions | Audit |
|---|---|---|---|---|
| `reconcile` | Finance / Super / worker | attempt non-terminal | §2.3; discovered orders via transaction LR (§4.4) | events (+ audit) |
| `attach_order` | Finance / Super | attempt UNKNOWN / RECONCILING; fetch-validated; transaction LR link succeeds with the same `attemptId` | → RECOVERED → (revalidate + A) ACTIVE | events + audit |
| `supersede` | Finance / Super | attempt in the listed non-exposed states **and** `NEVER_EXPOSED_PROVEN` (§2.8) | → SUPERSEDED; fence bump; holder cleared; if bound to an override and the attempt was CLAIMED → override `RELEASED` | events + audit |
| `retire_exposed` | Finance / Super | attempt ACTIVE | → RETIRED; order retained; holder cleared; override binding cleared | events + audit |
| `resolve_anomaly` | Finance / Super | §2.4 | §2.4 | events + audit |
| `authorise_override` (`expose_replacement`) | Finance / Super | flag enabled; claims RETAINED; no anomaly; reason; acknowledgement | `claimOverrides` `AUTHORISED` (snapshot of retained orders) | events + audit |
| `revoke_override` | Finance / Super | override `AUTHORISED` / `RELEASED` | → `REVOKED` | events + audit |
| `verify_orders_unpayable` | Finance / Super | **disabled** (Q17) | – | – |
| `acknowledge_classification_anomaly` | Finance / Super | open classification anomaly | anomaly → acknowledged (reason) | events + audit |

All use `requestId`, 409 on failed preconditions with no writes, and 503 on contention.

---

## 5. Failure and concurrency matrix (revision 4 rows retained; additions and changes)

| # | Case | Expected result | Second payable order? |
|---|---|---|---|
| 25 | Late response, attempt UNKNOWN (L1) | RECOVERED; the original request gets 409; exposure only after revalidation + A | No |
| 26 | Late response after supersede (L2) | Orphan recorded; not retained; attempt stays SUPERSEDED | No (never exposed) |
| 27 | Late response after PAID / CLOSED_UNAPPLIED / FAILED_NO_ORDER (L3) | Orphan; attempt unchanged; FAILED_NO_ORDER → classification anomaly | No |
| 28 | Payment on an unlinked order (L4), resolvable / not resolvable | Linked + retained + decided / `unmatched` | – |
| 29 | Duplicate late response or event (L5) | No writes | No |
| 30 | Reconcile finds an order after supersede (L6) | Orphan or retained per class | No |
| 31 | Crash before P / after P before A / after A / during send / after send | `NEVER` / `NEVER` / `UNKNOWN` / `UNKNOWN` / `UNKNOWN` (`PROVEN` after ack or payment) | No |
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

## 6. Invariants (revision 4 I1–I16 retained; changes and additions)

| # | Invariant |
|---|---|
| I3 (revised) | An order whose class is not `NEVER_EXPOSED_PROVEN`, and which is not the current holder's own ACTIVE order, is in `retainedOrders`; it is removed only by release condition 2. New creation requires derived OPEN, or a bindable one-time override |
| I8 (revised) | Terminal attempts: `state`, `fenceVersion`, `gatewayOrderId`, `exposure`, `firstPaymentId` and `obligationKeys` are never written; intents never change state after their first terminal state; reviewed application changes neither |
| I17 | **Response gateway:** no order ID leaves the server without a committed transaction-A marker for that order on a non-terminal, fence-valid attempt |
| I18 | **Exposure monotonicity and fail-closed:** `exposureClass` only moves up; only `NEVER_EXPOSED_PROVEN` permits release or supersede; legacy and unlinkable orders are never `NEVER_EXPOSED_PROVEN` |
| I19 | **One-time override:** an override is bound to at most one attempt that reaches CREATING; once `CONSUMED`, `EXPIRED` or `REVOKED` it admits nothing; overrides never alter retained orders or bypass an anomaly |
| I20 | **Refund ledger:** C1–C6 (§2.5.2) |
| I21 | **Allocation exactness:** each allocation line equals the obligation's payable amount at allocation; Σ lines = net captured at allocation; per-line reversal requires that line's processed refunds = its allocation |
| I22 | **Amounts:** payable = base + Σ append-only adjustments; no workflow restores an amount from a snapshot; sponsorship reversal is a compensating adjustment |

---

## 7. Test matrix

Revision 4 rows B6-1…B8-8 and the revision 3 rows are retained. All races run in both orderings, N repetitions, through real route handlers with a deterministic gateway stub (release handles, crash injection points P / A / send) and an injected clock. Every row asserts states, retained orders, exposure classes, **stub orders created and orders returned to clients**, and events / audit.

| # | Scenario | Must show |
|---|---|---|
| **B9-1** | L1: late response after an observer marks UNKNOWN | Original request 409 (no order ID); attempt RECOVERED; class `NEVER_EXPOSED_PROVEN`; exposure only after `reconcile` (revalidate + A) |
| **B9-2** | L2: late response after `supersede` (both orderings with supersede) | Supersede-first: orphan, not retained, attempt SUPERSEDED unchanged. Response-first: A commits → ACTIVE → supersede refused |
| **B9-3** | L3: late response after PAID / CLOSED_UNAPPLIED / FAILED_NO_ORDER | Attempt field set byte-identical; event appended; FAILED_NO_ORDER → classification anomaly |
| **B9-4** | L4: payment on an unlinked order (resolvable; unresolvable) | Linked + `EXPOSED_PROVEN` + retained (+ anomaly if held by another) / `unmatched` |
| **B9-5** | L5: same late response 3× (incl. concurrent); same payment 3× | Single link, single event, no state change on repeats |
| **B9-6** | L6: reconcile after supersede, R4 order vs legacy order | Orphan vs retained (`EXPOSURE_UNKNOWN`) |
| **B9-7** | Late response never restores a terminal attempt to ACTIVE (fuzz over all terminal states) | Invariant holds |
| **B10-1** | Override sequential: authorise → bind → CREATING → ACTIVE → second request | `CONSUMED`; second request returns the same order; no new attempt |
| **B10-2** | Override concurrent binding (2–6 parallel requests) | Exactly one `BOUND`; others get the same order or 409; stub creates = 1 |
| **B10-3** | Override with gateway timeout | `CONSUMED`; attempt UNKNOWN; new request 409; no second create |
| **B10-4** | Override, create OK, transaction P fails / transaction A fails / crash after A | P-fail: UNKNOWN, later orphan `NEVER`; A-fail: ACTIVATION_FAILED; crash after A: `UNKNOWN`, retained when it leaves the holder role; never a second override use |
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
| **B14-1** | Crash before transaction P | Discovered order `NEVER_EXPOSED_PROVEN`; `supersede` allowed |
| **B14-2** | Crash after P, before A | `NEVER_EXPOSED_PROVEN` (after fence bump); `supersede` allowed |
| **B14-3** | Crash after A, before response construction | `EXPOSURE_UNKNOWN`; `supersede` refused; retained on retire |
| **B14-4** | Crash during send | `EXPOSURE_UNKNOWN`; retained |
| **B14-5** | Crash after send (with and without client ack) | `UNKNOWN` / `EXPOSED_PROVEN`; retained |
| **B14-6** | `resolve_anomaly` adopt / supersede_all / retain_all with a mix of classes | Refusals and retention per §2.4 |
| **B14-7** | Legacy migration orders | `EXPOSURE_UNKNOWN` → retained; never released by `supersede` |
| **B14-8** | I17 check: every code path returning an order ID | Static and route test: no path returns an order ID without a committed marker |

---

## 8. Migration, compatibility and rollback

Revision 4 §8 is retained, plus:
- **Legacy orders** (from `paymentReservations` or `razorpayIntents.orderId`) are linked in `gatewayOrders` with `source: legacy_migration` and **`EXPOSURE_UNKNOWN`** → retained on their obligations' claims. More than one per obligation → claim anomaly.
- **Legacy sponsorships** → `sponsorships` with `legacy: true` (§2.7.2).
- **Base amounts:** `amountBasePaise` = current effective fee for non-sponsored obligations; for legacy sponsors, the overwritten `feeOverride` is kept as base with `legacy` marking.
- **Rollback:** the non-flaggable guard (claims, attempts, overrides, anomaly) applies to every creation path. The response-gateway invariant I17 is code-level and stays. The Phase 1A decision stays on.
- **The late-fee backfill and all migration steps:** dry run first, with an owner-approved report before any production write.

---

## 9. Role mapping (revision 4 §9 retained, plus)

| Action | Super | Finance | Club | Designer | Player |
|---|---|---|---|---|---|
| `set_base_amount` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `authorise_override`, `revoke_override` | ✓ | ✓ (if enabled) | ✗ | ✗ | ✗ |
| `acknowledge_classification_anomaly` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Order acknowledgement (`/order/ack`) | own orders | own orders | own orders | own orders | own orders |

---

## 10. Unresolved questions and assumptions

| # | Question | Recommendation | Decision by |
|---|---|---|---|
| Q2–Q7, Q11, Q12, Q14–Q16, Q18–Q21 | as in revision 4 | unchanged | Owner |
| Q13 | Enable `expose_replacement` | Disabled; if enabled, a one-time override per §2.6 | **Owner** |
| Q17 | Release condition 2 rule | After G1 + G3/G7 evidence | Reviewer + owner |
| **Q22** | Override authorisation expiry | 24 h | Owner |
| **Q23** | Client checkout acknowledgement (S6b) | Optional; useful evidence but not required for safety (UNKNOWN is already retained) | Owner |
| **Q24** | Who may change base amounts while an order is RETAINED (amount mismatch → later payments reviewed) | Finance / Super only; warn | Owner |
| **Q25** | Second approver for overrides | Recommended (Super Admin confirmation) | **Owner** |

**Assumptions** (not relied upon for safety):
- **A1:** 400 / 401 create bodies prove non-creation (G6). A contradiction is detected (L3, R4).
- **A2:** retained orders are treated as payable (G3 / G7).
- **A3:** test mode = live.
- **A4:** Firestore transactions serialise conflicting writes to the same documents (platform guarantee relied upon for I17 and fencing).

**Gateway checks:** G1–G7 (unchanged; none performed; none assumed).

---

## 11. Phased implementation plan and dependencies (revision 4 §11, extended)

| Phase | Revision 5 additions |
|---|---|
| 1A | `gatewayOrders` with exposure class; retention-on-payment; R11; refund ledger read model (for decisions); allocation lines; B9-4, B9-5, B11 (decision parts), B12-1 |
| 1B | Amount model (base + adjustments), `mark_sponsored` / `reverse_sponsorship` (§2.7.2), `set_base_amount`; B13-1…B13-6 |
| 2 | Derived claim states incl. retention-while-held anomaly; legacy order linking (`EXPOSURE_UNKNOWN`); B14-7 |
| 3 | Transactions P and A, the response-authorisation marker, I17, crash-window handling; B14-1…B14-5, B14-8 |
| 4 | Transaction LR (late responses, L1–L6), `supersede` with classification, `retire_exposed`, `claimOverrides` lifecycle (disabled); B9-1…B9-3, B9-6, B9-7, B10-1…B10-8 |
| 5 | `apply_reviewed_payment` (no attempt or intent writes), refund actions and ledger constraints, R-G per line, `resolve_anomaly`, classification-anomaly acknowledgement; B11-1…B11-7, B12-2…B12-8, B14-6 |

**Full D1/D2/D3 coverage is claimed only after 1A and 1B.**

---

## 12. (reserved; numbering kept stable for cross-references)

---

## 13. Cross-cutting consistency check (revision 5)

| Area | Check | Result |
|---|---|---|
| Claim holder lifecycle | Is the holder always a non-terminal attempt, cleared on PAID / RETIRED / SUPERSEDED / FAILED_NO_ORDER / CLOSED_UNAPPLIED? | Yes (§2.2, §2.3, §4.3, §4.8) |
| Override lifecycle | Single use; fenced; no anomaly bypass; retained orders untouched | Yes (§2.6.1, I19) |
| Attempt terminal immutability | Any write path to a terminal attempt document? | None: late orders → `gatewayOrders`; reviews → events (X9, X11, I8) |
| Intent terminal immutability | Reviewed application changes the intent? | No (X10) |
| Payment allocation | One immutable allocation; lines exact; per-line reversals separate | Yes (§2.5.1, I21) |
| Refund accounting | Per-line, deterministic, recomputed, C1–C6 | Yes (§2.5.2, I20) |
| Sponsorship reversal | No snapshot restore; both versions CAS; legacy guard | Yes (§2.7.2, I22) |
| Anomaly resolution | Uses proven exposure only | Yes (§2.4, X12) |
| Exposure evidence | A single gateway (transaction A); monotonic classes; legacy fail-closed | Yes (§2.8, I17, I18) |
| Reconciliation and dead-letter | Every unapplied payment has a payment record + dead-letter; every discovered order is linked and classified | Yes (§4.3, §4.4) |
| Migration and rollback | Legacy orders `UNKNOWN`; guard non-flaggable | Yes (§8) |
| Earlier safeguards | Revision 3/4 B1–B8 and C1–C6 preserved; no invariant weakened. B7's RETIRED → PAID removed (stricter) | Yes |

---

## 14. NOT approved for implementation

- **Everything in this document.** No phase (1A, 1B, 2–7) may start until the independent reviewer approves revision 5 **and** the owner gives explicit approval for that phase.
- **Separately approval-gated, even after design approval:**
  - the late-fee backfill and all migrations (dry-run report first);
  - Firestore rules deployment (only via `main`; both databases);
  - enabling `expose_replacement` (Q13, Q22, Q25);
  - enabling `verify_orders_unpayable` (Q17);
  - the client acknowledgement endpoint (Q23);
  - the Phase 1B client switch-over (Q12);
  - any gateway check G1–G7;
  - any production deployment.
- **No other workstream** (R2-B, R6, UX) is implied.

---

## 15. Resolution matrix: B9–B14

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
| **B14** NEVER_EXPOSED_PROVEN / EXPOSURE_UNKNOWN / EXPOSED_PROVEN | Classes, conditions, monotonicity | §2.8.2, I18 |
| B14 Never-exposed only with reliable evidence | Write-ahead marker + response gateway + fence | §2.8.1, I17 |
| B14 Uncertain windows → retained | Crash-window table | §2.8.3 |
| B14 Apply to adopt / supersede_all / retain_all / supersede / late responses / rollback and migration | Each rule updated | §2.4, §4.4, §4.8, §8 |
| B14 Crash tests (before response, after construction, during send, after send) | B14-1…B14-5 (+ 6–8) | §7 |
| Cross-cutting review | X8–X14; consistency table | §0.2, §13 |
