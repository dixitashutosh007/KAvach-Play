# R4 Right-Sized Architecture Proposal: Security and Payment Integrity

**Status:** PROPOSAL for independent review and owner approval. **Not approval to implement.** Architecture and planning only; no code, rules, tests, configuration or data changed.
**Branch / base:** `mig-mov` @ `d77a2b3259c0c864d6e63979ec438ce07f21614f`
**Supersedes for execution (if approved):** the seven-phase plan in `R4_ARCHITECTURE_DESIGN.md` revision 7 (`64de4f8`). Revision 7 stays unchanged as the reference for deferred items.
**Inputs:** `R4_ARCHITECTURE_DESIGN.md` rev 7; `R4_PHASE_1A_READINESS_REPORT.md` (`d77a2b3`); source at `d77a2b3`; owner decisions of 2026-11-24.
**Date:** 2026-11-24

**Operating model designed for:** 350 active players; 5 trusted administrators; 200–300 payments per month; a small Finance team; manual review of exceptions is acceptable. **Owner decisions taken as settled:** protect historical successful payments; all four categories (match fees, late fees, Studio subscriptions, merchandise); late-fee identity per player, per match, per overdue week; manual Finance exception handling; no mandatory two-person approval for routine adjustments.

---

## 1. Simplified target architecture

### 1.1 Core idea

Revision 7 tries to prevent a second *payable order* from ever existing (claims, attempts, fences, retained orders, placeholders, exposure classes). At this scale the same **financial** guarantees can be enforced more simply at the point where money is applied:

1. **Every order maps to exactly one intent, and every intent to an immutable obligation snapshot.** The order route already commits `razorpayIntents/{id}` *before* calling `orders.create` and puts `intentId` in the order notes (`app/api/razorpay/order/route.ts:484–531`). So any order that can exist, including an orphan whose ID we never received, is correlated to one intent.
2. **One Firestore transaction in the webhook decides every capture** against the current state of the obligation documents. If every obligation in the snapshot is still unpaid, the payment is applied; otherwise it is recorded as a duplicate. Firestore serialises conflicting transactions on the same documents, so **at most one payment can be applied per obligation** however many orders or intents exist.
3. **Every capture gets one immutable record** (`gatewayPayments/{paymentId}`), so additional captures are always visible to Finance and recoverable.
4. **Order-creation guards stay** (`paymentReservations`), hardened to lock per obligation and never to take over an ambiguous reservation. They reduce how often a duplicate capture can happen. They are no longer the thing that guarantees correctness.

The one property given up is revision 7's G-C ("no second payable order while an earlier one may be payable"). It is replaced by "a second capture is detected, recorded and refunded by Finance". This follows from the owner decision that manual exception handling is acceptable. It still needs explicit owner acceptance (**O-1**).

### 1.2 Component classification (revision 7 and readiness report)

| Component | Classification | Right-sized form |
|---|---|---|
| `gatewayPayments` (one record per capture, immutable identity) | **Essential now** | New collection, the only new top-level collection in Phases 1–2 |
| Obligation-level decision function | **Essential now** | Pure function with 7 rules (§3.3) instead of R1–R11 |
| Webhook single transaction + dead-letter in the same transaction | **Essential now** | Extends the existing R3 / R5 route |
| Server-controlled obligation identity (all four categories) | **Essential now** | Existing documents with deterministic IDs (§2.2); no new obligation collections |
| `paymentObligationClaims` | **Simplify** | Per-obligation lock documents inside the existing `paymentReservations` collection (§2.3); no holder fencing, no derived states |
| `paymentAttempts` | **Defer** | `razorpayIntents` + `paymentReservations` already record one create per intent |
| `retainedOrders`, `retainedPossibleOrders` | **Defer** | Replaced by the intent-correlation argument (§1.1) plus blocked ambiguous reservations; revisit only if duplicate captures become frequent |
| Dual exposure / payability classifications | **Defer** | No decision in the simplified model depends on them |
| `gatewayOrders` registry | **Defer** | Order ↔ intent link already lives on the intent (`orderId`) and in the order notes |
| Separate `lateFeeObligations` + display mirror | **Simplify** | Weekly late fee *is* the existing `players/{p}/otherFees/{id}` document with a deterministic ID; one source of truth, no mirror |
| Allocation subcollection and `lineHash` | **Simplify** | Immutable `appliedTo[]` array on the `gatewayPayments` document |
| `allocationLineLocks`, reversal requests | **Defer** | Phase 3 refunds map to the original payment and named obligations; at ~300 payments per month no line-lock contention exists |
| Refund-ledger read model (C1–C6) | **Simplify** | Phase 3: `gatewayPayments/{id}/refunds/{refundId}` with explicit obligation mapping; totals recomputed from rows (keeps C1, C2, C5, C6) |
| Synthetic attempts | **Defer (drop)** | Not needed without `paymentAttempts` |
| One-time override, `verify_orders_unpayable`, FAILED_NO_ORDER, refund webhook, client acknowledgement | **Defer** (remain disabled / not built) | – |
| Automated reconciliation and worklists | **Defer** | Phase 3 exception dashboard = queries over `gatewayPayments` and `webhookDeadLetters`, plus manual actions |
| `adminRequests` idempotency | **Simplify** | Deterministic document IDs on every server write; `requestId` only on Phase 3 Finance endpoints |

---

## 2. Minimum logical data model and collection reuse

### 2.1 Collections

| Collection | Status | Role | Phase |
|---|---|---|---|
| `matches/{m}/payments/{p}` | existing | match-fee obligation (identity = document path) | 1–2 |
| `players/{p}/otherFees/{id}` | existing | other-fee obligation; **weekly late-fee obligation** with deterministic ID | 1–2 |
| `subscriptionHistory/{id}` | existing (already immutable: `update`/`delete: if false`, `firestore.rules:410–418`) | **Studio renewal anchor**: an online renewal writes a deterministic ID `sub_<hash>`, so one period can be settled once | 2 |
| `merchOrders/{id}` | existing | merchandise obligation; **server-minted ID** for shop purchases | 1 (PX-1), 2 |
| `razorpayIntents/{id}` | existing, server-only | gains an immutable `obligations[]` snapshot and status `paid_unapplied` | 1–2 |
| `paymentReservations/{id}` | existing, server-only | order-creation guard; gains per-obligation lock docs `obl_<hash>` | 2 |
| `webhookDeadLetters/{id}` | existing (R5) | Finance exception queue; written **inside** the webhook transaction | 1–2 |
| `gatewayPayments/{paymentId}` (+ `refunds/` in Phase 3) | **new** | one immutable record per captured payment | 1–3 |
| `auditLogs/{id}` | existing | Phase 3: server-written for every financial action; rules made append-only | 3 |

No `paymentAttempts`, `paymentObligationClaims`, `gatewayOrders`, `lateFeeObligations`, `allocationLineLocks`, `reversalRequests`, `claimOverrides` or `adminRequests` collections. The existing `subscriptionPeriods` collection (D3 monthly finance subscriptions) is **not** reused (N7).

### 2.2 Obligation identity (server-controlled, all four categories)

| Category | Obligation document | Identity | Who mints it |
|---|---|---|---|
| Match fee | `matches/{matchId}/payments/{paymentDocId}` | document path | existing |
| Other fee | `players/{playerId}/otherFees/{feeId}` | document path | existing (Finance) |
| **Late fee (weekly)** | `players/{playerId}/otherFees/latefee_{matchId}_{week}` | player (path) + match + overdue week index (0 = first ₹150 levy, 1…n = ₹50 weekly levies of `computeLateFees`, `lib/utils.ts:180`) | **server** at order time (snapshot); document created by the webhook on APPLY. `templateId` = the same string, which keeps the existing UI test `templateId.includes("latefee_" + matchId)` working |
| Studio subscription renewal | `subscriptionHistory/sub_<base64url(sha256("sub\|playerId\|planId\|periodStart"))>` | player + plan + `periodStart` (current expiry if in the future, else purchase date; computed by the server at order time) | **server** (webhook `create()` on APPLY) |
| Merchandise (shop purchase) | `merchOrders/mo_{intentId}` | the intent (one purchase per intent) | **server** |
| Merchandise (admin-created order paid via dues) | `merchOrders/{existingId}` | existing ID | existing |

Segments used inside IDs (`matchId`, week) are validated against `^[A-Za-z0-9_\-]{1,128}$`; anything else is rejected at order time. No client-supplied value is used as or inside an identifier.

### 2.3 Records added or extended

- **`razorpayIntents/{id}`** (server-only): add `obligations: [{key, path, kind, amountPaise, fingerprint}]` and `amountPaise` (sum), written once at creation and never changed. `fingerprint` = the amount-bearing fields of the obligation at order time (e.g. `feeOverride` / `match.fee`, `otherFees.amount`, plan fee, merch price). Statuses: `pending` → `paid` | `paid_unapplied` | `exception`.
- **`gatewayPayments/{paymentId}`** (server-only; Finance / Super read): immutable `{paymentId, orderId, amountPaise, currency, intentId, playerId, capturedAt, firstEventId}`; `application: applied | rejected_duplicate | unmatched`; `reasons[]`; immutable `appliedTo: [{key, path, amountPaise}]` (APPLY only); later only an `events` list (Phase 3: `refunds/` subcollection, `resolution`).
- **`paymentReservations/obl_<hash(key)>`** (Phase 2): `{key, reservationKey, intentId, status: held | paid | exception | released, updatedAt}`. Acquired for **all** obligations of a request in the existing reservation transaction, all or nothing.
- **Obligation documents:** no new state field. The existing `status` and payment fields stay the **single source of truth**. APPLY additionally writes `gatewayPaymentId`.

---

## 3. Revised payment lifecycle

### 3.1 Order creation (`/api/razorpay/order`)

1. Authenticate (R1); the client only *selects* obligations. The server derives each obligation's identity, ownership, amount and fingerprint (`derivePayableAmount`, extended). Late-fee weeks come from `computeLateFees`, never from the request. ≤ 20 obligations per payment (**O-4**), one player.
2. Reservation transaction (existing `acquirePaymentReservation`, extended in Phase 2): acquire every `obl_` lock. A lock held by a live or ambiguous reservation → reuse that order if it is the same payer, same obligation set and same amount, otherwise 409.
3. Create the intent with the immutable snapshot (already happens before the gateway call).
4. `orders.create({receipt, notes: {intentId, reservationKey}})`.
5. Outcomes: success → activate (existing); definite failure → release (existing); **ambiguous → `reconciliation_required` (existing)**. Change: an **expired `reserving` lease is never taken over** (`lib/razorpay-order.ts:414–466` today: an expired `reserving` lease falls through to reacquisition); it becomes `reconciliation_required`. Release of an ambiguous reservation is a Finance action (Phase 3; Super Admin script until then) with an acknowledgement that an orphan order may exist (**O-1**).

### 3.2 Capture (`/api/razorpay/webhook`, one transaction)

1. Signature over the raw body (existing R3); parse; ignore other events (existing).
2. **Reads:** intent; `gatewayPayments/{paymentId}`; every snapshot obligation document (via the existing merge-chain resolution); weekly late-fee, `sub_` and `mo_` anchor documents; the dead-letter document.
3. **Decision (§3.3)** → write set (§3.4) → commit → **200**. Only transient failures (contention, outage, merge in progress) → **503**. Conditions that can never succeed on retry → record + 200 (D7).

### 3.3 Decision rules (pure function, evaluated in order)

| # | Condition | Decision |
|---|---|---|
| P1 | `gatewayPayments/{paymentId}` exists with the same identity; **or** no record but the intent is `paid` with this payment ID (pre-cutover payment, D2) | **REPLAY** (no writes, except creating the missing record as `applied` for a pre-cutover payment) |
| P2 | Record exists with a different identity (order, amount, currency, intent) | **IDENTITY_CONFLICT** |
| P3 | No intent; missing `intentId`; currency mismatch; captured amount ≠ snapshot `amountPaise`; order ID ≠ `intent.orderId` (except P4) | **UNMATCHED** |
| P4 | `intent.orderId` empty, intent `pending`, reservation ambiguous, and amount, currency and notes match | adopt the order ID onto the intent, then continue (rev 3 §4.4 order-identity recovery) |
| P5 | Intent already `paid` / `paid_unapplied` with another payment | **DUPLICATE** |
| P6 | **Any** snapshot obligation not unpaid (match payment not `Unpaid`; other fee not unpaid; weekly late-fee, `sub_` or `mo_` anchor already exists; match abandoned; sponsored; waived), **or** its fingerprint differs from the snapshot (**O-5**), **or** it belongs to a different player than the intent | **DUPLICATE** (all or nothing for bundles) |
| P7 | Otherwise | **APPLY** |

### 3.4 Write sets (single transaction)

| Decision | Writes | HTTP |
|---|---|---|
| REPLAY | none (P1 cutover: create the `gatewayPayments` record `applied` from the intent) | 200 |
| IDENTITY_CONFLICT | dead-letter `conflict_<paymentId>_<hash>` (high severity); nothing else | 200 |
| UNMATCHED | `gatewayPayments` `unmatched` (if the payment ID is usable); dead-letter | 200 |
| DUPLICATE | `gatewayPayments` `rejected_duplicate` + reasons; dead-letter `duplicate_payment`; intent `pending` → `paid_unapplied` only if it has no first payment; reservation and `obl_` locks of this intent → `exception` (never reused); **no obligation write** | 200 |
| APPLY | obligations → existing Paid fields + `gatewayPaymentId`; weekly late-fee docs `create()`; `sub_` `create()` + player expiry from `periodStart`; `mo_` `create()` or existing merch doc → Paid; `gatewayPayments` `applied` + `appliedTo[]`; intent `paid`; reservation `isPaid`; `obl_` locks `paid` | 200 |

`create()` conflicts (`ALREADY_EXISTS`) re-run the transaction once, so they resolve to REPLAY or DUPLICATE. Bundle footprint ≤ 20 obligations is well inside Firestore's per-transaction limits.

### 3.5 Exceptions, refunds and reconciliation (Phase 3)

- **Exception dashboard:** `gatewayPayments where application != applied` plus open `webhookDeadLetters`, with actions:
  - **apply to an unpaid obligation** of the same player for the exact amount (one transaction, same P6 checks, attributed, audited);
  - **record a refund** mapped to the original payment;
  - **close with a reason.**
- **Refunds:** `gatewayPayments/{id}/refunds/{rfnd_…}` (doc ID = Razorpay refund ID); `initiated` → `processed` | `failed` on Finance-recorded evidence; Σ non-failed refunds ≤ captured; on a bundle the obligation mapping is mandatory. An obligation returns to unpaid **only** after a processed refund equal to its `appliedTo` amount (same transaction). Refund webhooks stay deferred.

---

## 4. Security and Firestore rules changes

| Phase | Change | Purpose |
|---|---|---|
| 1 (PX-4) | `players/{p}/otherFees/{id}`: mirror the match-payment `paymentFinanceGuards` for **collected money**: no client change to `status`, `amount`, `paymentMethod`, `razorpayPaymentId`, `templateId` and payment fields once Paid with real money; **no client delete** of a Paid fee; client **create** may not use IDs matching `^latefee_`. Finance can still create and edit unpaid fees and record manual Paid | Historical settlement protection; reserved weekly late-fee IDs |
| 2 | `gatewayPayments` (+ subcollections): `read: isFinanceAdmin() \|\| isSuperAdmin()`, `write: false` | Finance visibility |
| 2 | `subscriptionHistory`: client `create` may not use IDs matching `^sub_` | Reserve renewal anchors |
| 2 | `merchOrders`: client `create` may not use IDs matching `^mo_` | Reserve server-minted IDs |
| 3 | `auditLogs`: `update: if false`; `delete: if false` (today any admin may update and Super may delete, `firestore.rules:385–389`); server-written finance audit entries | Guarantees 8 and 10 |
| 3 | Manual settlement moves to a server endpoint; client Finance writes to payment fields are then removed (match payments and other fees) | Guarantee 10; single writer |

All new collections are already denied by the catch-all (`firestore.rules:5–7`). Rules deploy **only via `main`** (`.github/workflows/deploy-firestore-rules.yml`), for both databases, with owner approval (**O-6**). Every rule change ships with emulator tests for every role.

---

## 5. D1–D8 resolutions

| # | Resolution | Basis |
|---|---|---|
| D1 R8 holder clause | **Removed with the claim model.** The decision checks obligation state, not holders | §1.2 |
| D2 cutover replay | P1: intent `paid` with the same payment ID → REPLAY, and the missing `gatewayPayments` record is created as `applied`. Never classified as a duplicate | Owner decision (protect history) |
| D3 late-fee identity | `otherFees/latefee_{matchId}_{week}`, week index computed by the server; created on APPLY; client template IDs ignored | Owner decision (per player / match / week) |
| D4 payable amount | Captured amount must equal the immutable intent snapshot. An obligation whose amount fields changed after the order → DUPLICATE (exception), never applied at a stale amount (**O-5**) | Guarantee 6 |
| D5 source of truth | Existing `status` and payment fields remain the only truth; no parallel settlement field. Rules protect settled records (PX-4) | "Avoid multiple sources of truth" |
| D6 reservation after rejection | Reservation and `obl_` locks of that intent → `exception`; the order is never offered again | §3.4 |
| D7 persistent failures / bundles | Never 503 for non-transient conditions: record + 200. Order route rejects > 20 obligations with 400 (**O-4**) | Webhook availability |
| D8 categories | All four in Phase 2 with identities per §2.2; merchandise ownership in Phase 1 (PX-1) | Owner decision |

## 6. N1–N9 resolutions

| # | Resolution |
|---|---|
| N1 incorporation by reference | This proposal is self-contained for execution. Revision 7 is referenced only for deferred items |
| N2 allocation path | `appliedTo[]` array on `gatewayPayments` (no subcollection) |
| N3 `gatewayOrders` access | Not built (deferred) |
| N4 `lineHash` | Not needed; the obligation path is the line identity |
| N5 synthetic attempts | Not built |
| N6 B11 / B12-1 / B15-3 tests | Replaced by the test catalogue in §10 |
| N7 `subscriptionPeriods` collision | Avoided: renewals anchor on `subscriptionHistory/sub_…` |
| N8 keys after a merge | Identity is the document path and ID. The webhook already resolves `mergedInto` chains before reading (`lib/razorpay-webhook.ts:285–322`). Merges keep fee document IDs, so a reparented weekly late fee is still found by ID under the keeper. `gatewayPayments` keeps the path and player at apply time |
| N9 production dry runs | Read-only production reports still need owner approval (Phase 4) |

## 7. PX-1 to PX-4 treatment

| # | Treatment | Phase / batch |
|---|---|---|
| **PX-1** client-controlled merch order ID → overwrite | **Isolated hotfix (Batch 1, §8).** Server ignores any client `id`; the order payload is reduced to an allowlist; the webhook writes `merchOrders/mo_{intentId}` with read-then-`create()` and never overwrites an existing document | Phase 1, B1 |
| **PX-2** client-controlled late-fee template ID | Server-derived weekly identity (§2.2); `lateFeeTemplateId` from the client ignored | Phase 1, B3 |
| **PX-3** no late-fee duplicate check at order time | Deterministic weekly IDs + P6 make a second application impossible. The order route also skips weeks whose document already exists | Phase 1, B3 |
| **PX-4** otherFees edits / deletes without settlement-history protection | Rules guards (§4, Phase 1) | Phase 1, B4 |

**PX-1 safety argument (demonstrated by source, to be proven by tests in B1):**
- The legitimate shop checkout builds `orderPayload` **without** an `id` (`components/ShopTab.tsx:384–398`), so the webhook currently always takes the `crypto.randomUUID()` branch (`lib/razorpay-webhook.ts:571`).
- Ignoring a client `id` therefore changes nothing for legitimate users except the format of the generated ID (UUID → `mo_{intentId}`). No code depends on the merch order ID format: orders are listed and filtered by fields.
- The price is already server-derived and unchanged.
- The allowlist keeps every field the shop sends today: `playerId`, `playerName`, `merchId`, `merchName`, `size`, `spec`, `customSelections`, `customPriceAdditions`, `jerseyName`, `jerseyNumber`, `orderStatus` limited to `Awaiting Min Order Qnty` | `Ready to Place Order` | `Order Placed`.
- `mo_{intentId}` makes the write idempotent across `payment.captured` + `order.paid`. The existing per-intent replay check is unchanged.

**Observed, outside the hotfix (not changed by B1):** after checkout the browser handler also calls `finalizeOrderPlacement` (`components/ShopTab.tsx:437–440, 473–516`), which writes a second order with `paymentStatus: "Paid"`. For players this is refused by the `merchOrders` create rule (`firestore.rules:710–718` requires `Unpaid`). For an administrator it creates an unlinked duplicate "Paid" order. This is audit finding FIN-004 and is fixed in Phase 2 (B7: the browser no longer creates orders for online payments).

## 8. Revised four-phase implementation plan

Each batch: tests first; one commit on `mig-mov`; regression (functional + emulator suites, `tsc`, `next build`); independent review; owner acceptance.

### Phase 1: Critical security fixes

| Batch | Scope | Files (expected) | Acceptance criteria |
|---|---|---|---|
| **B1 PX-1 hotfix** | §7 | `lib/razorpay-order.ts` (merch branch, `:1556–1600`), `lib/razorpay-webhook.ts` (merch branch, `:569–584`), new emulator test | (1) A request carrying `orderPayload.id` = an existing order of another player leaves that order byte-identical. (2) The created order ID is `mo_{intentId}`; replay with both events → one order. (3) Non-allowlisted fields are absent. (4) Price is the server price. (5) The existing shop flow (no `id`) produces one Paid order. (6) No other payment category is touched (all existing webhook suites pass unchanged) |
| **B2 P0 duplicate settlement** | `gatewayPayments` registry; decision P1–P3, P5–P7 for **match fees and other fees**; DUPLICATE / UNMATCHED / IDENTITY_CONFLICT write sets; dead-letter inside the transaction; P1 cutover replay | `lib/payments/decide.ts` (new, pure), `lib/payments/gateway-payments.ts` (new), `lib/razorpay-webhook.ts`, `app/api/razorpay/webhook/route.ts`, `lib/webhook-dead-letter.ts`; R3 / R5 test expectation updates | (1) Two intents (match screen + dues bundle) for one match fee, both orderings × 20 repetitions → exactly one Paid, one `rejected_duplicate`, the first payment's fields unchanged. (2) Manual cash Paid, then capture → DUPLICATE. (3) Pre-cutover redelivery → REPLAY, never duplicate. (4) Injected failure before commit → no state change; lost acknowledgement → REPLAY with zero writes. (5) Every non-applied capture has a `gatewayPayments` record and a dead-letter. (6) 6 concurrent deliveries → one record |
| **B3 PX-2 / PX-3 weekly late fees** | Server weekly identity in both order paths; webhook writes `latefee_{matchId}_{week}` with `create()`; legacy coverage (**O-2**) | `lib/razorpay-order.ts`, `lib/razorpay-webhook.ts`, `lib/payments/decide.ts` | (1) A client `lateFeeTemplateId` has no effect. (2) The same week via two intents → one application. (3) Weeks 0..n each once. (4) A legacy late-fee record for (player, match) → no new levy for that match (O-2). (5) UI still shows the fee as paid |
| **B4 PX-4 otherFees rules** | §4 Phase 1 rule changes | `firestore.rules`, new rules emulator test | Per role: Paid fee status/amount/payment fields immutable; Paid fee not deletable; unpaid fee editable by Finance; `latefee_` IDs not client-creatable; existing UI flows that write unpaid fees still pass. **Deploy separately (O-6)** |
| **B5 R1 / R2 / R3 verification** | Source re-verification and deployment mapping (§9.3) | report only (`docs/qa/`) | Each item marked Verified (source) / Verified (runtime) / Not deployed / Blocked, with evidence |

### Phase 2: Core payment integrity

| Batch | Scope | Acceptance criteria |
|---|---|---|
| **B6 snapshot and identity** | `obligations[]` snapshot + fingerprint on intents for all four categories; ≤ 20 limit; `sub_` and `mo_` identities | Snapshot immutable; every key server-derived; a request with a foreign obligation → 403; 21 obligations → 400 |
| **B7 webhook for all categories** | P4 order adoption; P6 for weekly late fees, subscriptions (`sub_` anchor), merch (`mo_` / existing); merch orders only from the webhook (FIN-004) | Two payments for the same renewal period → one extension; a next-period renewal succeeds; a fingerprint change → exception; an orphan order for an ambiguous intent → adopted and applied once |
| **B8 order-route hardening** | Per-obligation `obl_` locks; no expired-`reserving` takeover (→ `reconciliation_required`); `exception` locks never reused | Match screen + dues for one fee concurrently → one order or 409; expired `reserving` → blocked, no second create (gateway stub counts creates); existing `tests/razorpay-concurrent-orders.test.mjs` protections still pass |
| **B9 legacy compatibility** | Read-only legacy anomaly report script (dry run); UI shows weekly late fees | Report lists double-paid obligations and `lf_` records; no writes possible |

### Phase 3: Finance and audit

| Batch | Scope | Acceptance criteria |
|---|---|---|
| **B10 server manual settlement + audit** | Endpoint for cash/UPI Paid, waive, reverse manual; server `auditLogs` (actor, before/after); `auditLogs` append-only rules; client payment-field writes removed | Every financial write attributable; a client cannot change payment fields; audit entries immutable |
| **B11 base fee + adjustments, sponsorship** | Append-only `adjustments[]` on the obligation (server-written, deterministic IDs `sp_<sponsor>_<sponsored>`); sponsorship and reversal as compensating entries; payable = base + Σ adjustments ≥ 0 | Sponsor / reverse with intervening base changes keeps the current base; double sponsor or double reverse refused; P6 fingerprint includes adjustments |
| **B12 refunds** | §3.5 refunds; reversal of a gateway obligation only after a processed refund | Refund > captured refused; bundle refund without mapping refused; partial refund keeps the obligation Paid; full processed refund → unpaid in the same transaction |
| **B13 exception dashboard + reconciliation** | Finance / Super screen and actions (§3.5) | Every `rejected_duplicate` / `unmatched` payment listed; apply-to-unpaid applies once and only for the same player and exact amount; actions audited |

### Phase 4: Regression and production readiness

| Batch | Scope | Acceptance criteria |
|---|---|---|
| **B14 regression suite** | §10 catalogue end to end | 100 % of catalogue executed; 0 failed; skips listed with reason |
| **B15 staging test-mode verification** | Razorpay **test mode** on a named staging deployment: notes propagation on `payment.captured` and `order.paid`, duplicate capture, refund recording, webhook retry | Each check recorded with evidence; no live keys |
| **B16 dry-run reconciliation + production** | Owner-approved read-only production report; rules deploy via `main`; app deploy; smoke test | Owner sign-off on report; deployment-to-commit mapping recorded; smoke test passed |

## 9. Migration and backward compatibility

1. **No bulk migration.** Every existing record is read-compatible: existing `status` values stay authoritative; new fields are additive.
2. **Historical payments:** never rewritten. Pre-cutover redeliveries → REPLAY (P1). Obligations already Paid cannot receive a second application (P6).
3. **Legacy late fees:** `lf_{intentId}_…` and manual `latefee_{matchId}` records stay untouched. Under **O-2**, any legacy late-fee record for a (player, match) counts as settling that match's late fees. This is today's UI behaviour (`DuesAndRemindersTab.tsx:184`, `FinanceTab.tsx:186`), and it never double-charges.
4. **Legacy reservations:** existing `reconciliation_required` / `reconciliation_failed` blocks remain; existing expired `reserving` documents are treated as `reconciliation_required`.
5. **Legacy intents without a snapshot:** decided with the current per-intent fields (amount, `matchId` / `paymentId` / `items`) mapped to obligations at decision time; P6 still applies.
6. **Rollback:** code revert only. `gatewayPayments` and anchors remain and are harmless to older code. Rules rollback never re-enables deletion of Paid fees without owner approval.

### 9.3 R1 / R2-A / R2-C / R3 verification status (input to B5)

| Item | Source (`mig-mov`) | `main` | Runtime |
|---|---|---|---|
| R1 token revocation (`2496b04`) | present | **not merged** | unknown: no deployment-to-commit evidence available to this session |
| R2-A / R2-C privacy rules and payload (`3a72484`) | present | **not merged**; the rules deploy workflow runs on `main` (or manual dispatch) | rules **not deployed by the workflow**; whether anyone dispatched it manually is unknown |
| R3 webhook classification (`12f8eb8`), R5 (`352a94c`) | present | not merged | unknown |

`origin/main` is at `f573972` (2026-11-08). The owner must supply the production and staging deployment mapping for B5.

## 10. Test strategy and measurable acceptance criteria

**Layers:**
- unit tests of the pure decision function (every rule P1–P7, positive and negative);
- Firestore-emulator transaction tests;
- route tests through the real webhook `POST` with real HMAC;
- concurrency in both orderings via a test-only barrier, 20 seeded repetitions;
- rules tests for every role (`@firebase/rules-unit-testing`);
- regression of all existing suites.

The barrier hook is injected and cannot be enabled outside tests. **No reimplemented business logic in tests.**

| Catalogue | Must show |
|---|---|
| Duplicate / concurrent payments | ≤ 1 application per obligation in every ordering; extra captures recorded |
| Historical replay | Pre-cutover redelivery = REPLAY; historical docs byte-identical |
| Wrong player / wrong amount / wrong currency / wrong order | UNMATCHED or DUPLICATE; no obligation write |
| Late-fee weekly settlement | Each week once; client template ignored; legacy coverage (O-2) |
| Subscription renewal | One extension per period; next period allowed; concurrent renewals → one |
| Merchandise ownership | PX-1 cases; no overwrite; one order per intent |
| Refund and sponsorship (Phase 3) | §8 B11 / B12 criteria |
| Rules | Each §4 rule, each role, positive and negative |
| Ambiguous orders | Expired lease blocked; orphan capture adopted or recorded; no second application |

**Programme-level acceptance:**
1. 0 failed tests.
2. Every skip justified.
3. Each of the ten guarantees (§3 of the owner brief) mapped to at least one passing test (§11).
4. `tsc` and `next build` clean.
5. No disabled capability enabled.

## 11. Revision 7 invariant comparison

| Rev 7 invariant | Right-sized status | Mechanism |
|---|---|---|
| I1 single application per obligation per cycle | **Kept** | P6 in one transaction |
| I2 one immutable record per capture; refunds ≤ captured; initiated ≠ processed | **Kept** | `gatewayPayments`; Phase 3 refunds |
| I3 / I18 / I26 retention and release by payability only | **Replaced** | Intent correlation + capture-time decision; ambiguous reservations blocked; manual release accepts orphan risk (O-1) |
| I4 no automatic re-creation after an ambiguous create | **Kept** | `reconciliation_required`; no lease takeover |
| I5 zero is not absence | **Kept** | Receipt lookups never release anything |
| I6 fencing | **Simplified** | Existing reservation token + fence on order creation only |
| I7 server authority | **Kept** (Phases 1–3 progressively) | Rules §4 |
| I8 first-outcome immutability | **Kept** | Intent first status and `gatewayPayments` identity never rewritten |
| I9 identity integrity | **Kept** | P2 |
| I10 / I23 no silent reversal; refund then reversal atomically | **Kept** (Phase 3) | §3.5 |
| I11 entity separation | **Simplified** | Obligation = existing doc; payment = `gatewayPayments`; coordination = reservation |
| I12 atomic audit | **Kept** (Phase 3 server audit) | B10 |
| I13 no secrets / PII | **Kept** | R2-C pattern |
| I14 bounded transactions | **Kept** | ≤ 20 obligations |
| I15 anomaly blocking | **Simplified** | IDENTITY_CONFLICT and exceptions never apply money |
| I16 / I21 allocation provenance and exactness | **Kept** | `appliedTo[]` = snapshot amounts |
| I17 response gateway marker | **Deferred** | Not needed for financial guarantees |
| I19 one-time override | **Deferred** (not built) | – |
| I20 refund ledger C1–C6 | **Simplified** | C1, C2, C5, C6 kept; C3 / C4 implicit with explicit mapping |
| I22 / I24 amounts and sponsorship invariants | **Kept, simplified** (Phase 3) | Append-only adjustments, deterministic IDs |
| I25 / I29 disabled capabilities | **Kept** | None built |
| I27 / I28 line locks, eight RF checks | **Deferred** | Single Finance refund action per payment |

**Owner guarantees 1–10:**

| # | Guarantee | Enforced by |
|---|---|---|
| 1 | applied at most once | P6 |
| 2 | additional captures visible | `gatewayPayments` + dead-letter |
| 3 | history not rewritten | P1, P6, PX-4 |
| 4 | server identities | §2.2 |
| 5 | weekly late fee | §2.2 |
| 6 | amount vs snapshot | P3, P6 |
| 7 | unapplied recoverable | B13 |
| 8 | no silent overwrite or delete | PX-4, B10 |
| 9 | exact refund mapping | B12 |
| 10 | attributable adjustments | B10, B11 |

## 12. Decisions requiring explicit owner approval

Only new questions; settled owner decisions are not reopened.

| # | Decision | Recommendation |
|---|---|---|
| **O-1** | Accept the simplified ambiguous-order model: if Finance releases an ambiguous reservation, a possible orphan order may later be paid; that capture is detected, recorded and refunded manually (replaces revision 7's G-C) | Accept |
| **O-2** | Legacy late fees: any existing late-fee record for a (player, match) settles that match's late fees (preserves today's behaviour; never double-charges) | Accept |
| **O-3** | Paid other fees become immutable from the browser (as match payments already are) until the Phase 3 correction endpoint exists | Accept |
| **O-4** | Maximum 20 obligations per online payment | Accept |
| **O-5** | A payment whose obligation amount changed after the order was created goes to Finance review instead of being applied | Accept |
| **O-6** | Rules deployment route for B4 and the pending R2-A rules: merge to `main` (both databases) or a controlled manual dispatch | Owner choice |
| **O-7** | Adopt this proposal as the execution plan in place of revision 7 Phases 1A–7 | Approve after review |

## 13. Recommended implementation sequence and dependencies

```
B1 PX-1 ─────────────┐                     (independent; first)
B5 verification ─────┤ parallel review
B4 PX-4 rules ───────┘ (independent; deploy needs O-6)
B2 P0 duplicate settlement ──► B3 weekly late fees ──► B6 snapshot ──► B7 all categories ──► B8 order route
                                                                    └► B9 legacy report
B7 ──► B10 manual settlement + audit ──► B11 adjustments/sponsorship
B7 ──► B12 refunds ──► B13 exception dashboard
all ──► B14 regression ──► B15 staging test mode ──► B16 production
```

- **Critical path:** B2 → B3 → B6 → B7 → B10 / B12 → B14 → B15 → B16.
- **Parallel work and review:**
  - B1, B4 and B5 alongside B2;
  - B9 alongside B8;
  - B11 alongside B12;
  - the B13 UI can start once the B12 data shapes are fixed.
- **Review checkpoints:** ChatGPT reviews each batch's diff and evidence. The owner authorises each batch, and authorises deployment separately.
- **First batch:** B1 (PX-1), contingent on independent review and owner authorisation. **Next:** B2 (P0 duplicate settlement).

Nothing in this document authorises implementation, deployment, a rules change, a migration or any gateway operation.
