# R4 — Razorpay Order Concurrency, Ambiguous Outcomes and Duplicate Payments: Architecture Design (revision 2)

**Status:** DESIGN ONLY. Revision 2 addresses the independent review of revision 1 (`7411f37`), which was directionally accepted but **not approved for implementation**. Nothing is implemented: no application code, tests, Firestore rules, schema, routes or configuration changed. Phase 1 must not start until this revision is independently approved.
**Branch / base:** `mig-mov` @ `7411f37`
**Date:** 2026-11-23

**Evidence base:**
- Run `r4mwtfrkta4202`: `docs/qa/R4/evidence/R4_EXPERIMENT_RESULTS_AND_ANALYSIS.md`.
- Delayed re-check: `docs/qa/R4/evidence/supplemental-e5-recheck/E5_RECHECK_RESULTS.md`.

---

## 0. Evidence that drives this design

| # | Fact (test mode, one run) | Source |
|---|---|---|
| F1 | Razorpay accepts duplicate `receipt` values sequentially and concurrently (E1: 2 orders, E2: 5/5, E4: 2) | Create responses; corroborated by re-check |
| F2 | Receipt-filtered listing is **eventually consistent**: 0 results about 20–24 s after creation; all 11 known orders visible about 5 min 40 s after. Upper bound unknown | E5 + re-check |
| F3 | **Orphan orders are real**: client-aborted requests at 50 ms and 150 ms each created an order the caller never received | Re-check |
| F4 | Live mode, fetch-by-ID, payments-per-order, multiple payments on one order and refund events are **not verified** | §9 G1–G6 |

**Principle.** The gateway offers no idempotency and no prompt negative lookup, and **the system cannot prevent a payer from being charged twice** in every case (e.g. an orphan paid via a leaked ID, or a manual and an online payment for the same fee). The design therefore guarantees:
1. **At most one payment is ever applied to an obligation.**
2. **Every additional captured payment is separately accounted for and routed to refund review.**
3. **At most one order per obligation is exposed to the payer at a time.**
4. **No new order is created automatically after an ambiguous attempt.**

---

## 1. Current-state architecture (verified against code)

### 1.1 Order creation: `app/api/razorpay/order/route.ts` `POST`

1. `requireAuth` (`:38`). `derivePayableAmount()` (`:82` → `lib/razorpay-order.ts:1283`) computes the authoritative amount and `verifiedIntent.reservationKey` from `generateReservationKey()` (`lib/razorpay-order.ts:9`). It rejects match fees already `Paid`, `Waived`, `Not Playing` or abandoned **at order time only**.
2. `acquirePaymentReservation()` (`:100` → `lib/razorpay-order.ts:313`) runs a transaction on `paymentReservations/{reservationKey}`:
   - paid → 409;
   - `reconciliation_required` / `reconciliation_failed` → blocked;
   - `active` / `activation_failed` with an `orderId` → reuse after `validateReservationForReuse()` (`:117`) if unexpired, else reconcile;
   - unexpired `reserving` → wait (same user) or conflict;
   - **otherwise (no doc, or expired `reserving`) → takeover** (`:436`): new token, `fenceVersion + 1`, deterministic receipt `generateAuthoritativeReceipt()` (`:189`), 60 s lease.
3. `isWaiting` (`:226`): polls 6 × 500 ms.
4. Create:
   - `razorpayIntents.add({status: "pending"})` (`:484`);
   - `setReservationIntentId()` (`:496`) **before** the call;
   - lease renewed every 5 s (`:514`) around `orders.create({amount, currency, receipt, notes: {intentId, reservationKey}})` (`:531`);
   - lease lost → 409, order not returned;
   - else `intentRef.update({orderId})` (`:548`), `activatePaymentReservation()` (`:555` → `:516`), then return the order. **Persist-before-expose holds today.**
5. Failures (`:557–600`):
   - order created but activation failed → `recordActivationFailure()` (`:557` lib);
   - `isAmbiguousRazorpayError()` (`:1105`) → `recordReconciliationRequired()` (`:605` lib);
   - definitive 4xx → `releasePaymentReservation()` (`:1070` lib).
6. `reconcileAmbiguousReservation()` (`:656`):
   - Branch A (`:698`): `orders.fetch(orderId)`.
   - Branch B (`:852`): `orders.all({receipt})`. More than one → `reconciliation_failed`. One → adopt. **Zero → `reconciliation_failed`, kept blocked** (`:1010`), which is correct per F2.
   - The doc comment at `:653` is **stale**.
   - **No route or tool exists to resolve `reconciliation_failed`**; it can only be fixed by editing Firestore directly.

### 1.2 Online fulfilment: `lib/razorpay-webhook.ts` `processWebhookIntentTransaction` (`:235`)

- One transaction per event. Validates intent ↔ event.
- Idempotent **per intent**: `intent.status === "paid"` → replay; a different `paymentId` → `CONFLICTING_PAYMENT` → R5 dead-letter (`:263–275`). The dead-letter is written in a **separate** transaction by the route after the processing transaction throws (`app/api/razorpay/webhook/route.ts:58`).
- Fulfilment: `match` (`:419`), `finance_dues` (`:457`), `subscription` (`:516`), `merch_order` (`:569`). Then intent `paid` and reservation `isPaid` (`:602`).
- **No branch checks the obligation's own state before writing.**
  - Match and dues set `Paid` and **overwrite** `razorpayPaymentId`.
  - Late fees are keyed `lf_${intentId}_…` (`:370`), so a different intent creates another Paid late fee.
  - Subscriptions extend from the current expiry, so they extend again.

### 1.3 Manual settlement: client-side today

| Obligation | Client write path | Rule permitting it |
|---|---|---|
| Match fee: collect (cash/UPI), mark Paid or Unpaid | `hooks/useStore.ts` `updatePaymentStatus` (≈`:1800–1830`; `status`, `paymentMethod`, `manualMethod`, `manualBy`, `feeCollectedAmount`) | `matches/{m}/payments` update: `isFinanceAdmin()` unrestricted; `isMatchAdmin() && isMatchAdminPaymentUpdate()` (`firestore.rules:279`) allows `status` Paid with `paymentMethod: "manual"` |
| Match fee: plan / override status | `applyFeePlanToPayment` (≈`:2155–2200`) | Finance Admin |
| Match fee: sponsorship (settled by another player) | `assignProxyPayment` (≈`:2335–2365`; `status: "Paid"`, `sponsoredBy`) | Finance Admin |
| Other fees | `players/{p}/otherFees` writes (`hooks/useStore.ts` ≈`:1971–2055`) | `isFinanceAdmin() || isSuperAdmin()` |
| Merchandise | `updateMerchOrder` (`:2765`) from `components/FinanceTab.tsx:362`, `components/ShopTab.tsx:769` (`paymentStatus`) | `merchOrders` admin update |
| Studio subscription | `components/StudioAdminTab.tsx:≈532`, `components/EditPlayerInline.tsx` (player `studioExpiryDate`), plus `addSubscriptionHistory` | Admin player update; Studio Admin history create |

These writes do not coordinate with online payments in any way.

### 1.4 How duplicate *application* can happen today

| Path | Mechanism | Gateway race? |
|---|---|---|
| **D1 Request-shape keys** | `generateReservationKey()` hashes the request (`match:{m}:{p}:{player}` vs `dues:{player}:{sorted items}`). The same fee from the Match screen and from a Dues bundle, or two overlapping bundles, gets **two reservations, two payable orders**; the webhook applies both | No |
| **D2 Manual ↔ online overlap** | An admin marks a fee Paid on the client (§1.3) while an order is open; the payer pays; the webhook overwrites the manual settlement | No |
| **D3 Waived / abandoned / sponsored after order** | The webhook marks a Waived or sponsored obligation Paid via Razorpay | No |
| **D4 Takeover of an expired `reserving`** | Takeover without reconciliation (`lib/razorpay-order.ts:361–436`); a second order is created (F1); the first is an orphan (F3). The orphan is unexposed unless its ID leaks | Yes (rare) |
| **D5 Adopt-after-takeover mismatch** | Branch B adopts the found order with the reservation's `intentId`; a payment then names the old intent, so it is dead-lettered and the obligation stays unpaid | Yes (rare) |

**Suspected defect (not reproduced, Q8):** `sub:{uid}:{planId}` and `merch:{merchId}:{player}` reservation keys have no period or order component, so a paid reservation may block the **next legitimate** renewal or repeat purchase.

---

## 2. State machines

Four coordinated records (details in §3):
- **Obligation record**: the existing source-of-truth document per obligation, extended with a `settlement` block and a `settlementVersion` counter.
- **Obligation claim**: one per obligation, coordinating in-flight online attempts.
- **Payment attempt**: one gateway `orders.create`, called at most once per attempt.
- **Gateway payment**: one per captured Razorpay payment ID, tracking capture, application and refund.

### 2.1 Obligation settlement states (on the obligation record)

| State | Meaning | Set by |
|---|---|---|
| `unpaid` | Obligation exists, not settled | creation, revert |
| `settled_gateway` | Settled by an applied Razorpay payment (`gatewayPaymentId`) | webhook APPLY |
| `settled_manual` | Settled by cash or UPI collection (`method`, `collectedBy`, `amount`) | settlement endpoint |
| `sponsored` | Settled by another player's or the club's sponsorship (non-cash) | settlement endpoint |
| `waived` | **No obligation** (e.g. abandoned match, Option A) | settlement endpoint, abandoned reconciliation |

`duplicate` and `refund review` are **payment** states (§2.4), never obligation states. An obligation stays settled exactly once; extra money lives on gateway payment records.

Legacy mapping, read-compatible, with no data rewrite:
- `status: "Paid"` + `paymentMethod: "razorpay"` → `settled_gateway`
- `status: "Paid"` + `"manual"` or `manualMethod` → `settled_manual`
- `status: "Paid"` + `sponsoredBy` → `sponsored`
- `"Waived"` or abandoned → `waived`
- `"Unpaid"` → `unpaid`

### 2.2 Claim states: `paymentObligationClaims/{claimId}`

`open → held(attemptId, fence) → released | settled`.
- `held` means an online attempt is CLAIMED, CREATING, ORDER_RECEIVED, ACTIVATION_FAILED, ACTIVE, OUTCOME_UNKNOWN, RECONCILING or RECOVERED.
- `settled` mirrors the obligation record.
- A claim is released only by: FAILED_NO_ORDER; SUPERSEDED (admin); a manual settlement override (§4.4); or attempt completion.

### 2.3 Attempt states: `paymentAttempts/{attemptId}`

```
CLAIMED ─► CREATING ─┬─► ORDER_RECEIVED ─► ACTIVE (exposed) ─► PAID
                     │        └─ persist fails ─► ACTIVATION_FAILED ─(revalidate)─► ACTIVE
                     ├─► FAILED_NO_ORDER        (only on a definitive gateway rejection, see below)
                     └─► OUTCOME_UNKNOWN ─► RECONCILING ─┬─► RECOVERED ─(revalidate)─► ACTIVE
                                 ▲                       ├─► OUTCOME_UNKNOWN (0 found / lookup failed)
                                 └───────────────────────┘└─► ANOMALY_MULTIPLE ─► MANUAL_RESOLUTION
any non-terminal (except PAID) ─(Finance/Super Admin, audited)─► SUPERSEDED
ACTIVE / RECOVERED / SUPERSEDED / OUTCOME_UNKNOWN ─(captured payment rejected by decidePaymentApplication)─► DUPLICATE_PAYMENT
```

**Outcome classification for `orders.create`:**

| Gateway outcome | Attempt state |
|---|---|
| 2xx with a valid `order.id` | ORDER_RECEIVED |
| A **definitive rejection proving no order was created**: a complete HTTP 400 response with a Razorpay `BAD_REQUEST_ERROR` validation error body, or a complete HTTP 401 authentication-failure body. *Which codes prove non-creation must be confirmed by gateway check G6; until then only these two qualify* | FAILED_NO_ORDER |
| 408, 409, 429, any 5xx, timeout, connection reset, TLS or proxy failure, unparsable or partial body, a 2xx without a valid order, process crash, lease lost after send, **any unclassified outcome** | **OUTCOME_UNKNOWN** |

**Transition rules:**

| From | Allowed | Forbidden |
|---|---|---|
| CLAIMED | CREATING; SUPERSEDED | Exposure |
| CREATING | ORDER_RECEIVED; FAILED_NO_ORDER (definitive only); OUTCOME_UNKNOWN; SUPERSEDED (admin) | **Any second create**; any new attempt on its obligations |
| ORDER_RECEIVED | ACTIVE; ACTIVATION_FAILED | Returning the order before persistence |
| ACTIVATION_FAILED | ACTIVE via revalidation; SUPERSEDED | New attempt |
| ACTIVE | PAID; DUPLICATE_PAYMENT; SUPERSEDED (admin, e.g. amount change) | New attempt while ACTIVE |
| OUTCOME_UNKNOWN | RECONCILING; SUPERSEDED (admin) | **Automatic new attempt**; any transition driven by a lookup returning 0 |
| RECONCILING | RECOVERED; OUTCOME_UNKNOWN; ANOMALY_MULTIPLE | Concurrent reconciliation (fenced) |
| **RECOVERED** | ACTIVE **only** via revalidation; MANUAL_RESOLUTION; SUPERSEDED | **Exposure before revalidation succeeds** |
| ANOMALY_MULTIPLE | MANUAL_RESOLUTION | Auto-adopting any order |
| SUPERSEDED, FAILED_NO_ORDER, PAID | none (terminal) | Exposure, re-activation |

**Revalidation before (re-)exposure.** RECOVERED → ACTIVE and ACTIVATION_FAILED → ACTIVE happen in **one transaction** that checks all of:
1. every claim is still `held` by this attempt at its fence;
2. every obligation record is still `unpaid` with an unchanged `settlementVersion`;
3. the payer binding is unchanged: same `userId`, the player is not merged or disabled, and the obligation is still owned by that player;
4. the amount equals a fresh `derivePayableAmount()` and the currency matches;
5. the gateway order, fetched by ID, has matching amount, currency and `notes.attemptId`, and status `created` or `attempted`.

Any failure → MANUAL_RESOLUTION; the order is **never** exposed.

**Late response vs SUPERSEDED (race).** `supersede` runs one transaction that:
- sets the attempt to SUPERSEDED and increments its `fenceVersion`;
- releases its claims (or hands them to a new attempt);
- appends an event.

A late `orders.create` response arriving afterwards can no longer activate, because its fenced write fails. The route then performs a **record-only** write, allowed only when the attempt is SUPERSEDED or OUTCOME_UNKNOWN: `orderIdLate = order.id` plus an `order_late` event. It returns 409 to that (stale) request. The order is **never exposed**. If it is later paid, `decidePaymentApplication` rejects it as `SUPERSEDED_ATTEMPT_PAID` (§2.5).

If the response wins the race, the attempt is ACTIVE and its order exposed. A `supersede` arriving afterwards must then be an explicit "supersede active order" action, which is warned and audited; any later payment on that order is rejected and reviewed. **Both orders are therefore safe with respect to application.**

### 2.4 Gateway payment states: `gatewayPayments/{paymentId}`

| Dimension | Values |
|---|---|
| Capture | `captured` (signed `payment.captured` / `order.paid` received and validated) |
| Application | `applied` (to obligation keys K by attempt A) · `rejected_duplicate` (reason) · `unmatched` (R5, no intent or attempt) |
| Refund | `not_required` (applied, or Finance decided to apply manually via §4.5) · `required` (rejected or unmatched, awaiting Finance) · `initiated` (Finance recorded a Razorpay refund ID) · `completed` (**only** when a signed `refund.processed` webhook arrives for that refund ID, or Finance records dashboard evidence with the refund ID; verified by G5) · `failed` (`refund.failed`, or Finance records failure) → `intervention_required` |

**A dead-letter record or its `refund_initiated` resolution is never treated as proof of refund completion.** Completion lives only on `gatewayPayments.refund`.

### 2.5 `decidePaymentApplication(attempt, obligations, paymentEvent)` (pure function)

**Inputs** (all read inside the webhook transaction **before any write**):
- the intent;
- the attempt (or a legacy synthetic attempt from intent fields);
- every obligation record and claim for the attempt's obligation keys;
- the existing `gatewayPayments/{paymentId}` (if any);
- the validated event (order ID, payment ID, amount, currency).

**Output:** `{ decision, reasons[], perObligation[] }`, evaluated in this order:

| # | Condition | Decision |
|---|---|---|
| 1 | `gatewayPayments/{paymentId}` exists | `REPLAY` (no writes; 200) |
| 2 | Event fails intent validation (existing `validateWebhookTransaction`) | `REJECT_INVALID` (R5 unmatched or mismatch path) |
| 3 | Attempt SUPERSEDED or FAILED_NO_ORDER | `REJECT_DUPLICATE` (`SUPERSEDED_ATTEMPT_PAID`) |
| 4 | Intent already `paid` with a different payment ID, or attempt already PAID | `REJECT_DUPLICATE` (`CONFLICTING_PAYMENT`) |
| 5 | **Any** obligation is not `unpaid` (`settled_gateway`, `settled_manual`, `sponsored` or `waived`), or its claim is held by **another** attempt, or (subscription) the current expiry ≠ `baseExpiry` | `REJECT_DUPLICATE` with per-obligation reasons (`OBLIGATION_SETTLED_OTHERWISE`, `OBLIGATION_WAIVED`, `DUPLICATE_OBLIGATION_PAYMENT`, `SUBSCRIPTION_PERIOD_ALREADY_EXTENDED`) |
| 6 | Otherwise | `APPLY` (to all obligations) |

**Bundles are all-or-nothing:** one settled obligation in a bundle → the whole payment is `REJECT_DUPLICATE`.

**Atomic persistence** (single Firestore transaction; reads complete before writes):

| Decision | Writes in the same transaction |
|---|---|
| APPLY | Each obligation record → `settled_gateway` (`settlement.gatewayPaymentId`, `settlementVersion + 1`, plus existing legacy fields `status: "Paid"`, `paymentMethod: "razorpay"`); each claim → `settled`; `gatewayPayments/{paymentId}` create (`captured`, `applied`, refund `not_required`); `gatewayOrders/{orderId}` link; intent → `paid`; attempt → PAID; attempt event; existing side effects (late-fee record at its deterministic ID, subscription history and expiry, merch order) |
| REJECT_DUPLICATE | **No obligation or claim writes.** `gatewayPayments/{paymentId}` create (`captured`, `rejected_duplicate`, refund `required`); `webhookDeadLetters/{pay_<paymentId>}` create (classification `duplicate_payment`, reasons, attempt, obligation keys); intent → `paid_unapplied`; attempt → DUPLICATE_PAYMENT; attempt event |
| REPLAY | None |

The webhook acknowledges REJECT_DUPLICATE with **200 after the transaction commits** (the R5 "record, then acknowledge" pattern). If the transaction fails it returns **503** (retryable, R3). Moving the duplicate dead-letter **into** the processing transaction removes today's separate-transaction gap for this class. `gatewayPayments/{paymentId}` is created with `create()` semantics, so two concurrent deliveries of the same payment cannot both apply: Firestore transaction conflict, retry, then REPLAY.

---

## 3. Firestore data model (all new collections server-only)

**Rules:** `paymentAttempts`, `paymentAttempts/*/events`, `paymentObligationClaims`, `gatewayOrders`, `gatewayPayments`: `allow write: if false`. Read: `isFinanceAdmin() || isSuperAdmin()` for attempts, events and gatewayPayments; claims and gatewayOrders are deny-all. **No client-writable attempt, claim or payment-accounting data.** Phase 1B also removes client write access to settlement fields on existing obligation records (§4.4).

### 3.1 Canonical obligation identifiers

- **Canonical key** (stable, human-readable, stored as a field): segments `type`, `scope ids…` joined with `|`. Each segment is validated against `^[A-Za-z0-9_\-]{1,128}$`. Any other segment is encoded as `b64:` + base64url(UTF-8). Example: `match|M123|P456`.
- **Document ID** (path-safe, fixed length): `ob_` + base64url(SHA-256(canonicalKey)) (46 chars). There are no `/`, `.` or `__…__` issues. The canonical key is kept in the document, and a lookup verifies it matches, so a hash collision would be detected, not silently merged.

| Obligation | Canonical key | Source-of-truth record |
|---|---|---|
| Match fee | `match|{matchId}|{paymentDocId}` | `matches/{m}/payments/{p}` |
| Other fee | `fee|{playerId}|{feeId}` | `players/{p}/otherFees/{f}` |
| Late fee | `latefee|{playerId}|{matchId}|{templateId}` | the claim document itself (no pre-existing record); late-fee records are written at the **deterministic** ID `lf_` + claim doc ID |
| Subscription period | `sub|{playerId}|{planId}|{baseExpiry or none}` | `players/{p}` (`studioExpiryDate`) |
| Merchandise | `merch|{merchOrderId}` | `merchOrders/{id}` |

### 3.2 `paymentAttempts/{attemptId}`

- **Identity:** `attemptId` = `att_` + 32 hex. This is also the gateway **receipt** (≤ 40 chars) and `notes.attemptId`.
- **Fields:** `state`, `fenceVersion`, `leaseExpiresAt`, `heartbeatAt`, `userId`, `playerId`, `intentId`, `intentType`, `obligationKeys[]` (canonical), `claimIds[]`, `amountPaise`, `currency`, `gatewayOrderId`, `orderIdLate`, `exposedAt`, `outcome {kind, httpStatus, code}`, `paidPaymentId`, `legacyReservationKey`, `createdAt`, `updatedAt`.
- **Append-only history:** `paymentAttempts/{id}/events/{eventId}`, server-created, never updated or deleted. Each event has `type` (state change, `create_sent`, `order_received`, `order_late`, `reconcile_lookup`, `revalidation_failed`, `supersede`, `attach_order`, `payment_decision`, …), `from`, `to`, `actor` (`system` | uid), `at`, `details` (identifiers and codes only). This is the **authoritative audit trail**; there is no capped mutable array. Admin actions are **also** written to `auditLogs` via `writeServerAudit()` in the same transaction.

### 3.3 `paymentObligationClaims/{ob_…}`

`{ canonicalKey, state, holderAttemptId, holderFence, settledBy: {kind, ref}, updatedAt }`

### 3.4 `gatewayOrders/{orderId}` (uniqueness index)

`{ attemptId, intentId, createdAt }`, written with `create()`. **One attempt per gateway order ID**: a second attempt claiming the same order ID fails.

### 3.5 `gatewayPayments/{paymentId}` (payment accounting)

`{ paymentId, orderId, attemptId, intentId, amountPaise, currency, capturedAt, application: {state, obligationKeys, reasons, decidedAt}, refund: {state, refundId, amountPaise, initiatedBy, initiatedAt, completedAt, failureCode, evidence} }`

Written with `create()`: **one accounting record per gateway payment ID**.

### 3.6 Uniqueness constraints

| Constraint | Enforced by |
|---|---|
| One attempt per gateway order ID | `gatewayOrders/{orderId}` `create()` |
| One accounting record and at most one application per gateway payment ID | `gatewayPayments/{paymentId}` `create()` in the webhook transaction |
| At most one in-flight attempt per obligation | Claim `holderAttemptId` (transactional compare-and-set on `holderFence`) |
| At most one settlement per obligation | Obligation record `settlementVersion` compare-and-set; `decidePaymentApplication` rule 5; manual endpoint precondition |
| One create call per attempt | Attempt state CREATING is entered once (fenced); no code path re-sends |

### 3.7 Additive changes to existing records

- Obligation records gain `settlement {state, kind, ref, by, at}` and `settlementVersion`. Legacy fields stay written for UI compatibility.
- `razorpayIntents` gains `attemptId`, `obligationKeys[]`, and state value `paid_unapplied`.
- `webhookDeadLetters` gains classification `duplicate_payment`, new reasons, `attemptId`, `obligationKeys` and `gatewayPaymentId`.

---

## 4. API, webhook and settlement changes

### 4.1 Order route (`app/api/razorpay/order/route.ts`)

1. `claimObligations(db, obligationKeys, attempt)`: one transaction reading all claims and obligation records.
   - Any settled → 409 "already paid".
   - Any held by an ACTIVE attempt of the same payer and amount → return that order after fetch-validation if past its local TTL.
   - Any held by another attempt in any other state → 409 "payment in progress / being verified".
   - Else create the attempt (CLAIMED) and set all claims held. **All or nothing.**
2. CREATING written **before** `orders.create({receipt: attemptId, notes: {intentId, attemptId}})`; lease renewed as today.
3. On response: persist `gatewayOrderId` (attempt + `gatewayOrders` index) first; then activate (claims are revalidated as still held); then expose.
4. Classify failures per §2.3. **Remove the expired-`reserving` takeover** (L1 below).

**Lease and concurrency rules:**
- **L1:** A lease bounds who may *write*, never who may *create*. Expiry in CREATING → OUTCOME_UNKNOWN (set by the next reader).
- **L2:** All writes are fenced.
- **L3/L4:** Concurrent requests from the same user or other sessions get the holder's order or "in progress".
- **L5:** Only the obligation's player may pay.
- **L6:** Bundles claim all keys atomically or fail.

### 4.2 Webhook (`lib/razorpay-webhook.ts`)

`processWebhookIntentTransaction` becomes:
1. Read everything (§2.5 inputs).
2. Run `decidePaymentApplication`.
3. Perform the decision's writes (§2.5 table).

Legacy intents without `attemptId`: obligation keys are derived from intent fields (`matchId`/`paymentId`, `items[]`, `planId` + current expiry, `orderPayload.id`), giving a synthetic attempt.

**Order identity recovery:** if the attempt has no `gatewayOrderId` but `notes.attemptId` and `notes.intentId` match and amount and currency match, the order ID is adopted (event is signature-verified and the notes were server-set) through the `gatewayOrders` `create()` check, before the decision runs.

### 4.3 Reconciliation (`lib/payment-reconciliation.ts`; `/api/finance/payment-attempts`, Finance and Super Admin)

- **Known order ID:** `orders.fetch(id)` (G1).
- **Unknown order ID:** receipt lookup only after a settle delay (≥ 10 min, then back-off, Q4). One result → RECOVERED → revalidate → ACTIVE. More than one → ANOMALY_MULTIPLE. Zero → stays OUTCOME_UNKNOWN.
- **Manual actions** (audited, fenced, once each): `attach_order` (server fetch-validates), `supersede`, `close`.
- **Payment-level actions:** `record_refund_initiated(refundId)`, `record_refund_outcome(completed|failed, evidence)`, `apply_reviewed_payment` (§4.5).

### 4.4 Server-controlled manual settlement (Phase 1B): `/api/finance/settlements`

**Single transactional path** for every non-gateway settlement change. Actions:
- `settle_manual {method: cash|upi, amount}`
- `mark_sponsored {sponsor}`
- `waive {reason}`
- `revert_to_unpaid {reason}`
- `apply_fee_plan_status`
- `set_studio_expiry` (subscription)
- `set_merch_payment_status`

**Who may call:**
- Finance Admin and Super Admin: all actions.
- Club Admin (holds the former Match Admin pitch-side capability per D-19): `settle_manual` only, for match fees, matching today's `isMatchAdminPaymentUpdate` scope.
- Studio Admin / Club Admin: `set_studio_expiry`.

This preserves current capabilities; **owner to confirm the role mapping (Q11).**

**One transaction per request:**
1. Read the obligation record and its claim.
2. Precondition: the obligation is in the expected state at the client-supplied `expectedSettlementVersion`; else 409 "changed since you loaded it".
3. Claim check:
   - held by an attempt in OUTCOME_UNKNOWN, RECONCILING, RECOVERED or ANOMALY_MULTIPLE → **409** "online payment outcome unknown; resolve in Payment Attempts first" (cash must not race an unknown online charge);
   - held by an ACTIVE attempt → **409** unless the request carries `acknowledgeOpenOnlinePayment: true` (Q6). If acknowledged: the attempt moves to SUPERSEDED (fence +1, event), the claim is released, and the manual settlement proceeds. Any later payment on that order is rejected as `SUPERSEDED_ATTEMPT_PAID` → refund review.
4. Write the obligation record (`settlement`, `settlementVersion + 1`, legacy fields), set the claim to `settled` or `open` (for revert/waive as appropriate), append a settlement event (`settlementEvents/{id}` on the obligation, append-only), and write `auditLogs`. All in the same transaction.

**Coordination guarantee:** the online webhook (§2.5) and this endpoint both read and conditionally write the **same obligation record** (`settlementVersion`) and the **same claim** inside Firestore transactions. Firestore serialises conflicting transactions, so one commits and the other re-runs and sees the result. Manual first → webhook rule 5 → REJECT_DUPLICATE. Webhook first → manual precondition fails → 409. **No Firestore trigger is used for concurrency control.**

**Rules lockdown (Phase 1B):** remove client write access to settlement fields: `status` transitions into or out of Paid/Waived, `paymentMethod`, `manualMethod`, `manualBy`, `feeCollectedAmount`, `sponsoredBy`, `settlement*` on match payments; `status` on otherFees; `paymentStatus` on merchOrders; `studioExpiryDate`/`studioEndDate`/`isStudioMember` on players. Non-settlement fields (availability, notes, fee overrides that do not settle) keep their current rules. Client callers (`updatePaymentStatus`, `applyFeePlanToPayment`, `assignProxyPayment`, `updateMerchOrder` for `paymentStatus`, studio expiry editors) switch to the endpoint. **This is a user-visible workflow change and needs owner approval of the UI behaviour** (same screens, server-backed, a 409 shown as a clear message).

### 4.5 Applying a reviewed payment instead of refunding

`apply_reviewed_payment {paymentId, obligationKeys}` (Finance and Super Admin). Allowed only if the payment is `rejected_duplicate` or `unmatched` with refund state `required`, and every target obligation is `unpaid` at the expected version. One transaction: obligation → `settled_gateway` with that payment ID; payment application → `applied` (by Finance); refund → `not_required`; event and audit.

---

## 5. Failure-mode matrix

**Guarantee wording:** *no more than one payment is applied to an obligation; every additional captured payment is separately recorded (`gatewayPayments` + dead-letter) and routed to refund review.* Duplicate capture cannot be prevented in every case.

| # | Case | Expected state | Payer sees | Operational action | Financial risk |
|---|---|---|---|---|---|
| 1 | Timeout before the request reaches the gateway | **OUTCOME_UNKNOWN**. It cannot be distinguished from case 2; the system cannot know no order exists. **Stays blocked** | "We're confirming your payment setup" (Q5) | Reconciliation after the settle delay; 0 results keeps it blocked; Finance `supersede` when satisfied | None applied; obligation unpayable online until resolved (cash blocked too while unknown, §4.4) |
| 2 | Timeout after the gateway created the order (F3) | OUTCOME_UNKNOWN → RECOVERED → (revalidate) ACTIVE | As case 1, then the recovered order on retry | Usually automatic; `attach_order` or `supersede` otherwise | Orphan unexposed until revalidated |
| 3 | Crash before order-ID persistence | CREATING, lease expired → OUTCOME_UNKNOWN | As case 1 | As case 2 | As case 2 |
| 4 | Lease expiry with the request in flight | OUTCOME_UNKNOWN; a late response is stored as `orderIdLate`, **not exposed** | 409 "try again shortly" | Reconciliation revalidates the `orderIdLate` | No second order (L1) |
| 5 | Late response racing `supersede` | Whichever transaction commits first wins (§2.3). Supersede first: the late order is record-only, never exposed. Response first: ACTIVE; supersede must be an explicit "supersede active" action | Old request gets 409 | If an order from a superseded attempt is paid → refund review | No double application |
| 6 | Concurrent requests, same user | One attempt; others get its order or "in progress" | One checkout | – | None |
| 7 | Concurrent requests, different sessions | As case 6 | One checkout | – | None |
| 8 | Match screen and Dues bundle for the same fee (D1) | Second request blocked at claim time | "Already in a payment in progress" | – | Eliminated at source |
| 9 | Webhook before activation persistence | Order ID adopted from notes (§4.2), then the decision runs | Paid | – | None |
| 10 | Two orders both paid (legacy D1/D4, leaked orphan, after supersede) | First APPLY; second REJECT_DUPLICATE (`gatewayPayments` rejected, refund `required`; dead-letter) | First paid; second "received, under review" | Refund, recording `initiated` then `completed` (evidence) | Money held until refunded; **never double-applied** |
| 11 | **Orphan order (never exposed) paid** (needs a leaked ID) | If the attempt still holds the claims and the obligations are unpaid → APPLY; if SUPERSEDED or the obligations are settled → REJECT_DUPLICATE (`SUPERSEDED_ATTEMPT_PAID`) | Paid / under review | As case 10 | No double application |
| 12 | **Payment after supersede** (any order of a superseded attempt) | REJECT_DUPLICATE; refund `required` | Under review | Refund, or `apply_reviewed_payment` if the obligation is still unpaid | No double application |
| 13 | Manual cash settlement racing a captured webhook | Firestore serialises: manual first → webhook REJECT_DUPLICATE; webhook first → manual 409 | – | Refund the online payment or reverse the cash per policy | No double application |
| 14 | Duplicate webhook delivery | REPLAY (via `gatewayPayments`) | – | – | None |
| 15 | Conflicting payment ID on the same intent | REJECT_DUPLICATE (`CONFLICTING_PAYMENT`) | Under review | Refund | No double application |
| 16 | Gateway lookup returns 0 | Stays OUTCOME_UNKNOWN; back-off | "Being verified" | Finance decides after the window | None applied |
| 17 | Gateway lookup returns more than 1 | ANOMALY_MULTIPLE | "Being verified" | Investigate; `attach_order` | None applied |
| 18 | Reconciliation or gateway unavailable | Unchanged; lookup failure recorded in events | "Being verified" | Retry; alert on backlog | None |
| 19 | Waived, abandoned or sponsored after the order was exposed | REJECT_DUPLICATE (`OBLIGATION_WAIVED` / `OBLIGATION_SETTLED_OTHERWISE`) | Under review | Refund per Option A | None applied |
| 20 | Refund initiated but not completed or failed | Refund `initiated`, then `completed` only on evidence; `failed` → `intervention_required` | – | Finance follows up | A dead-letter is never proof of refund |
| 21 | Rollback (flags off) with held claims or unknown attempts | Legacy creation **still blocked** for those obligations (§8) | "Being verified" | Finance resolves the attempts | No bypass |

---

## 6. Security and financial invariants (each asserted by a test)

| # | Invariant |
|---|---|
| I1 | **Single application:** per obligation, at most one payment is applied, across intents, attempts, gateway orders and manual methods |
| I2 | **Full accounting:** every captured, signed payment ends with exactly one `gatewayPayments` record whose application is `applied`, `rejected_duplicate` or `unmatched`; a refund state of `completed` requires refund evidence |
| I3 | **Single exposure:** an order is returned to a client only if its attempt holds every claim at its fence and passed persistence (and revalidation, for RECOVERED or ACTIVATION_FAILED) |
| I4 | **No automatic re-create:** after CREATING, a new attempt on those obligations requires `supersede` by Finance or Super Admin |
| I5 | **Zero is not absence:** no transition is driven by a lookup returning 0 |
| I6 | **Fencing:** a stale holder cannot change claims, expose, or overwrite a superseded attempt (record-only `orderIdLate` excepted) |
| I7 | **Server authority:** settlement fields, attempts, claims, `gatewayOrders` and `gatewayPayments` are server-written only (Phase 1B for settlement fields) |
| I8 | **Atomic audit:** every manual action and payment decision appends an attempt or settlement event, plus `auditLogs` for human actions, in the same transaction |
| I9 | **No secrets or PII** in attempts, events, payments or dead-letters |
| I10 | **Uniqueness** per §3.6 |

---

## 7. Test strategy

**Layers:**
- **Unit** (production imports): `decidePaymentApplication` truth table (every rule × every obligation state × bundle size); `canTransition` allowed and forbidden table; canonical key and doc-ID encoding (unsafe characters, length, round-trip, collision check); outcome classification (§2.3 table).
- **Firestore transaction (emulator):** claims, fencing, settlement compare-and-set, `gatewayPayments` / `gatewayOrders` `create()` uniqueness under concurrency.
- **Route integration (emulator + deterministic gateway stub):** order route, webhook route, `/api/finance/settlements`, `/api/finance/payment-attempts`. The stub is driven by explicit release handles, with an injected clock and configurable F1/F2/F3 behaviour. Each case asserts HTTP response, attempt/claim/obligation/payment states, **stub orders created**, **orders exposed**, and ledger entries.
- **Gateway contract:** stub fixtures pinned to recorded evidence (F1–F3; G1–G6 when run); a test fails if the stub drifts.
- **Regression:** all current suites (403 emulator, 1035 functional) green; existing reservation and tamper scenarios ported, not deleted.

**Mandatory scenarios (review item 7):**

| # | Scenario | Layer | Must show |
|---|---|---|---|
| T1 | Match screen and Dues bundle create separate intents for the **same** match fee | Route integration | Before Phase 2: both captured → one APPLY, one REJECT_DUPLICATE. After Phase 2: second request 409 at claim time |
| T2 | **Manual cash settlement racing a captured webhook** | Route integration through the **real** `/api/finance/settlements` handler and the real webhook route, concurrently against the emulator (not a mocked function), repeated N times with both orderings | Exactly one settlement; the other is REJECT_DUPLICATE (webhook) or 409 (manual); never both applied |
| T3 | Two different intents' webhooks racing for one obligation | Webhook route, concurrent | One APPLY, one REJECT_DUPLICATE; two `gatewayPayments` records |
| T4 | All-or-nothing Dues bundle (one item already settled) | Webhook transaction | No obligation written; payment `rejected_duplicate`; intent `paid_unapplied`; one dead-letter |
| T5 | Paid and waived obligations (`settled_gateway`, `settled_manual`, `sponsored`, `waived`) | Webhook transaction | REJECT_DUPLICATE with the correct reason each |
| T6 | Two payments for the same subscription period (`baseExpiry`) | Webhook transaction | One extension; second rejected (`SUBSCRIPTION_PERIOD_ALREADY_EXTENDED`) |
| T7 | Duplicate late-fee identity across different intents (legacy `lf_${intentId}` plus deterministic) | Webhook transaction | One Paid late fee; second rejected |
| T8 | Duplicate webhook delivery, and a conflicting payment ID on the same intent | Webhook route | REPLAY (no writes); conflicting → REJECT_DUPLICATE |
| T9 | Supersede racing a late gateway response (both orderings) | Route integration with a stub release handle | Supersede-first: order record-only, never returned, later payment rejected. Response-first: ACTIVE, explicit supersede-active path |
| T10 | Rollback (flags off) with a held claim and an OUTCOME_UNKNOWN attempt | Route integration | Legacy order creation refused for those obligations; unaffected obligations work |
| T11 | Timeout before and after the gateway (stub) | Route integration | Both OUTCOME_UNKNOWN; no second create; recovery only after a delayed lookup and revalidation |
| T12 | Refund lifecycle | Route integration (reconciliation API + refund webhook stub) | Dead-letter `refund_initiated` does not set `completed`; only refund evidence does |

---

## 8. Migration, compatibility and rollback

- **Source of truth unchanged:** obligation records keep meaning "settled" (legacy mapping §2.1). Claims and attempts are coordination only, so **no backfill is needed for correctness**: a missing claim is `open`, and rule 5 reads obligation records directly.
- **Legacy reservations** (`paymentReservations`): `active` / `activation_failed` with an `orderId` are wrapped as synthetic attempts on first touch (revalidated before reuse). `reconciliation_required` / `reconciliation_failed` become OUTCOME_UNKNOWN attempts and appear in the Finance report.
- **Legacy intents:** synthetic attempts (§4.2).
- **Late fees:** legacy `lf_${intentId}_…` records are matched by `(player, match, template)`; new writes are deterministic; there is no rename.
- **Rollback rule:** feature flags (`R4_PHASE_n`) control only *new* behaviour. The **R4 guard is not flaggable**. Once Phase 2 is deployed, every order-creation path, legacy included, first checks `paymentObligationClaims` and `paymentAttempts` for the obligation keys. Held claims or ACTIVE, OUTCOME_UNKNOWN, RECONCILING, RECOVERED or ANOMALY attempts **block** legacy creation. Rolling back therefore cannot bypass existing R4 claims or unknown attempts; they must be resolved through the Finance endpoint. Phase 1A's webhook decision likewise stays on after deployment (disabling it would re-open double application).
- **Rules** deploy only via `main`, and one deploy covers both databases. Phase 1B's rules lockdown and its client switch-over **must ship together**, otherwise Finance screens break. Sequence: deploy the endpoint, switch clients, then deploy the rules.

---

## 9. Open decisions (owner) and gateway checks (reviewer-approved, test mode)

| # | Decision | Recommendation |
|---|---|---|
| Q1 | Bundle with a settled item | **Decided by reviewer:** apply none; review |
| Q2 | Second payment for the same subscription period | Duplicate → review |
| Q3 | Automatic unblock after OUTCOME_UNKNOWN | **No**; Finance `supersede` only |
| Q4 | Settle delay and back-off | First lookup ≥ 10 min, then 30 min, 2 h, 24 h; alert at 30 min |
| Q5 | Payer wording ("being verified", "received, under review") | Owner to approve copy |
| Q6 | Manual settlement while an online order is ACTIVE | **409 unless explicitly acknowledged**, which supersedes the attempt; always 409 while the outcome is unknown |
| Q7 | Refund execution | Manual via the dashboard; recorded via §4.3; Refunds API out of scope |
| Q8 | Suspected renewal and repeat-purchase block | Reproduce first; fix in Phase 2 via period- and order-scoped keys |
| Q9 | Who may `supersede`, `attach_order`, `apply_reviewed_payment` or record refunds | Finance Admin and Super Admin |
| Q10 | Scheduled reconciliation worker | Admin-triggered in R4 |
| Q11 | Role mapping for `/api/finance/settlements` (§4.4) | As listed; preserves current capabilities under D-19 |
| Q12 | Phase 1B UI switch-over (same screens, server-backed) | Approve as a non-visual workflow change |

**Gateway checks** (none is assumed by the design; each needs reviewer approval):
- **G1:** fetch order by ID.
- **G2:** payments per order.
- **G3:** a second payment on a paid order (test cards).
- **G4:** time-window listing.
- **G5:** refund webhooks (`refund.processed` / `refund.failed`) and refund IDs.
- **G6:** which `orders.create` error responses prove non-creation (400/401 bodies).

---

## 10. Phased implementation plan (each phase: approval, tests first, separate commits)

| Phase | Proposed commit | Content | Closes |
|---|---|---|---|
| **1A** | `payment: obligation-level payment decision and payment accounting in webhook (R4-1A)` | `decidePaymentApplication`; `gatewayPayments` (create-only); the §2.5 atomic write sets; duplicate dead-letter inside the transaction; deterministic late-fee identity check; legacy synthetic attempts; obligation `settlement` mapping (read-compatible); T1 (pre-claim form), T3–T8 | Double **application** from D1, D3, D4 and D5 for online-vs-online and online-vs-already-settled |
| **1B** | `payment: server-controlled manual settlement coordination (R4-1B)` | `/api/finance/settlements` with `settlementVersion` and claim checks; settlement events and audit; client switch-over; rules lockdown of settlement fields; T2 (real-route race), T5 manual variants | **D2**, and the manual side of D3 (waive/sponsor) |
| | | *Full D1/D2/D3 financial-integrity coverage is claimed only after **both 1A and 1B***. | |
| 2 | `payment: obligation claims across request shapes (R4-2)` | Claims; all-or-nothing claim; non-flaggable guard; legacy reservation wrapping; Q8 fix if reproduced; T1 (claim form), T10 | D1 at source; I3 |
| 3 | `payment: payment attempts and unknown-outcome state (R4-3)` | Attempts and events; receipt = `attemptId`; `gatewayOrders` index; §2.3 classification; **remove the expired-`reserving` takeover**; T11 | D4; I4, I6 |
| 4 | `payment: order identity recovery and supersede race (R4-4)` | Notes-based adoption; record-only `orderIdLate`; T9 | D5; cases 4, 5, 9 |
| 5 | `payment: finance reconciliation and refund tracking (R4-5)` | `/api/finance/payment-attempts`; settle-delay lookup; revalidation; `attach_order`, `supersede`, `close`, `apply_reviewed_payment`; refund state recording (G5-dependent parts gated); T12 | Cases 1–3, 10–12, 16–20 |
| 6 | `docs: R4 closure, stale reconciliation comment, Finance runbook (R4-6)` | Fix `lib/razorpay-order.ts:653`; runbooks | – |
| 7 | `test: R4 failure-mode regression suite (R4-7)` | All §5 rows end to end; contract fixtures | Evidence for review |

---

## 11. Reviewer response: corrections from the review of `7411f37`

| # | Required correction | Resolution in this revision |
|---|---|---|
| 1 | Manual settlement concurrency: server-controlled transactional path, same record or claim as Razorpay, no trigger as primary control | §1.3 inventories every client settlement path and rule. §4.4 defines `/api/finance/settlements`: a single transaction over the **obligation record (`settlementVersion`) and claim**, the same records the webhook decision reads (§2.5); unknown-outcome and active-order handling; rules lockdown and client switch-over. **No trigger.** §8 sequencing. Phase 1B |
| 2 | Explicit `decidePaymentApplication(attempt, obligations, paymentEvent)`; all states evaluated before writes; bundle with one settled item → apply none, `paid_unapplied`, duplicate review record, acknowledge per R5; atomic persistence documented | §2.5: inputs read first, ordered rules 1–6, all-or-nothing, write-set table per decision in one transaction (obligations, claims, `gatewayPayments`, intent, attempt, event, dead-letter); 200 only after commit, 503 on failure; dead-letter moved inside the transaction |
| 3 | Capture vs application vs refund states; dead-letter is not proof of refund | §2.4 `gatewayPayments`: capture, application (`applied` / `rejected_duplicate` / `unmatched`) and refund (`not_required` / `required` / `initiated` / `completed` / `failed` → `intervention_required`); completion only on refund evidence (G5); I2; T12 |
| 4 | `FAILED_NO_ORDER` only on definitive proof; 408/429/5xx/timeout/network/crash/unclassified ambiguous; late response vs SUPERSEDED; revalidate before exposing recovered; RECOVERED ≠ ACTIVE | §2.3 outcome table (only complete 400 validation / 401 bodies, pending G6); full list of ambiguous outcomes; late-response race (both orderings); RECOVERED → ACTIVE only through the 5-check revalidation transaction; T9, T11 |
| 5 | Append-only audit; distinguish paid/waived/sponsored/manual/duplicate/refund-review; canonical safe IDs; uniqueness for order IDs, payment IDs, attempt↔obligation; no client-writable attempt or claim data | §3.2 append-only `events` subcollection (plus `auditLogs`); §2.1 obligation states vs §2.4 payment states; §3.1 canonical keys with segment validation or encoding plus hashed doc IDs and collision check; §3.6 uniqueness table (`gatewayOrders`, `gatewayPayments` create-only, claim compare-and-set); §3 rules (server-only) |
| 6 | Timeout-before-gateway stays unknown and blocked; accurate guarantee wording; include orphan orders and payments after supersede | §5 row 1 corrected; guarantee wording in §0 and §5; rows 11 (orphan paid) and 12 (payment after supersede) added; I1/I2 reworded |
| 7 | Mandatory tests list; manual race through the actual server transaction path | §7 T1–T12; T2 runs the real settlement route and webhook route concurrently against the emulator |
| 8 | Rollback cannot bypass held claims or unknown attempts; legacy creation blocked | §8 rollback rule: a non-flaggable R4 guard on every creation path; Phase 1A decision stays on; §5 row 21; T10 |
| Plan | Split Phase 1 into 1A and 1B; both required for full D1/D2/D3 coverage | §10 phases 1A and 1B with the explicit coverage statement |

**Additional findings while revising (not in the review):**
- Club Admin now holds the former Match Admin pitch-side settlement capability (D-19), so the role mapping needs owner confirmation (Q11).
- Phase 1B is a workflow change requiring a coordinated deploy order (§8).
- Gateway check G6 was added for the `FAILED_NO_ORDER` definition, and G5 for refund evidence.
