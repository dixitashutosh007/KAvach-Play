# R4 Right-Sized Architecture Proposal: Security and Payment Integrity

**Status:** PROPOSAL, revision 2, for independent review and owner approval. **Not approval to implement.** Architecture and planning only; no code, rules, tests, configuration or data changed.
**Branch / base:** `mig-mov` @ `972bcb23df0ccdebaec465be659e0dc35f1785e5` (revision 1: `972bcb2`)

**Repository restriction (owner, mandatory):** nothing is merged, cherry-picked or pushed to `main`; no Firestore rules deployment; no workflow dispatch; no staging or production deployment; no auto-merge; no production configuration change; no live Razorpay operation. Workflow: `mig-mov` → implementation → tests → independent review → owner acceptance. Production deployment is a separate future approval. `main` stays at `f5739726e75a2e6594c7379bdbfc8a866c63f787`.

**Revision history**

| Rev | Commit | Change |
|---|---|---|
| 1 | `972bcb2` | Right-sized architecture, four phases, batches B1–B16 |
| 2 | this commit | Review corrections A–F: orphan-order adoption (§14), obligation state table (§15), Studio renewal (§16), legacy late-fee transition (§17), category coverage across the cutover (§18), outage recovery (§19), B1 readiness (§20), decision register (§21). O-1 and O-2 reworked; O-6 set to "no deployment route authorised"; B2 scope extended to all categories |
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

Notes are **not** a trust anchor on their own: an order is adopted onto an intent only under the conditions in §14, otherwise the capture becomes a recorded Finance exception.

Revision 7's G-C ("no second payable order while an earlier one may be payable") is kept in a bounded form (rev 2, O-1 reworked): an obligation whose order outcome is ambiguous stays **blocked for new online orders** until the original order is adopted or Finance resolves it with evidence (§14.3). No routine manual release creates a second payable order.

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
| Studio subscription renewal | `subscriptionHistory/sub_<base64url(sha256("sub\|playerId\|basisExpiry"))>` | player + the expiry being renewed (`basisExpiry`, snapshot at order time; `NONE` if never a member). Plan is part of the snapshot, not the identity (§16) | **server** (webhook `create()` on APPLY, §16) |
| Merchandise (shop purchase) | `merchOrders/mo_{intentId}` | the intent (one purchase per intent) | **server** |
| Merchandise (admin-created order paid via dues) | `merchOrders/{existingId}` | existing ID | existing |

Segments used inside IDs (`matchId`, week) are validated against `^[A-Za-z0-9_\-]{1,128}$`; anything else is rejected at order time. No client-supplied value is used as or inside an identifier.

### 2.3 Records added or extended

- **`razorpayIntents/{id}`** (server-only): add `obligations: [{key, path, kind, amountPaise, fingerprint}]` and `amountPaise` (sum), written once at creation and never changed. `fingerprint` = the amount-bearing fields of the obligation at order time (e.g. `feeOverride` / `match.fee`, `otherFees.amount`, plan fee, merch price). Statuses: `pending` → `paid` | `paid_unapplied` | `exception`.
- **`gatewayPayments/{paymentId}`** (server-only; Finance / Super read): immutable `{paymentId, orderId, amountPaise, currency, intentId, playerId, capturedAt, firstEventId}`; `application: applied | rejected_duplicate | unmatched | held_for_review`; `reasons[]`; immutable `appliedTo: [{key, path, amountPaise}]` (APPLY only); later only an `events` list (Phase 3: `refunds/` subcollection, `resolution`).
- **`paymentReservations/obl_<hash(key)>`** (Phase 2): `{key, reservationKey, intentId, status: held | paid | exception | released, updatedAt}`. Acquired for **all** obligations of a request in the existing reservation transaction, all or nothing.
- **Obligation documents:** no new state field. The existing `status` and payment fields stay the **single source of truth**. APPLY additionally writes `gatewayPaymentId`.

---

## 3. Revised payment lifecycle

### 3.1 Order creation (`/api/razorpay/order`)

1. Authenticate (R1); the client only *selects* obligations. The server derives each obligation's identity, ownership, amount and fingerprint (`derivePayableAmount`, extended). Late-fee weeks come from `computeLateFees`, never from the request. ≤ 20 obligations per payment (**O-4**), one player.
2. Reservation transaction (existing `acquirePaymentReservation`, extended in Phase 2): acquire every `obl_` lock. A lock held by a live or ambiguous reservation → reuse that order if it is the same payer, same obligation set and same amount, otherwise 409.
3. Create the intent with the immutable snapshot (already happens before the gateway call).
4. `orders.create({receipt, notes: {intentId, reservationKey}})`.
5. Outcomes: success → activate (existing); definite failure → release (existing); **ambiguous → `reconciliation_required` (existing)**. Change: an **expired `reserving` lease is never taken over** (`lib/razorpay-order.ts:414–466` today: an expired `reserving` lease falls through to reacquisition); it becomes `reconciliation_required`. An ambiguous reservation is resolved only per §14.3 (adoption, manual settlement, or an evidenced and audited release), never by a routine release.

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
| P4 | `intent.orderId` empty (ambiguous create) | adopt **only if every condition A1–A10 in §14.1 holds**, then continue; any condition fails → **HOLD** (`ORPHAN_NOT_ADOPTABLE`) |
| P5 | Intent already `paid` / `paid_unapplied` with another payment | **DUPLICATE** |
| P6 | Classify **every** snapshot obligation with the §15 table. All `PAYABLE` → continue. Any `SETTLED` → **DUPLICATE**. Any `NOT_DUE`, `CHANGED`, `MISSING`, `CONFLICT` or `UNCLASSIFIABLE` → **HOLD**. Bundles are all or nothing: one non-payable obligation means no obligation is written | DUPLICATE / HOLD |
| P7 | Otherwise | **APPLY** |

`HOLD` is new in revision 2: the capture is recorded with `application: held_for_review` and per-obligation reasons, the intent becomes `exception`, and a dead-letter is written. Nothing is applied.

### 3.4 Write sets (single transaction)

| Decision | Writes | HTTP |
|---|---|---|
| REPLAY | none (P1 cutover: create the `gatewayPayments` record `applied` from the intent) | 200 |
| IDENTITY_CONFLICT | dead-letter `conflict_<paymentId>_<hash>` (high severity); nothing else | 200 |
| UNMATCHED | `gatewayPayments` `unmatched` (if the payment ID is usable); dead-letter | 200 |
| HOLD | `gatewayPayments` `held_for_review` + per-obligation reasons; dead-letter `held_for_review`; intent → `exception`; reservation and `obl_` locks → `exception`; **no obligation write** | 200 |
| DUPLICATE | `gatewayPayments` `rejected_duplicate` + reasons; dead-letter `duplicate_payment`; intent `pending` → `paid_unapplied` only if it has no first payment; reservation and `obl_` locks of this intent → `exception` (never reused); **no obligation write** | 200 |
| APPLY | obligations → existing Paid fields + `gatewayPaymentId`; weekly late-fee docs `create()`; `sub_` `create()` + expiry per §16; `mo_` `create()` or existing merch doc → Paid; `gatewayPayments` `applied` + `appliedTo[]`; intent `paid`; reservation `isPaid`; `obl_` locks `paid` | 200 |

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

All new collections are already denied by the catch-all (`firestore.rules:5–7`). Rules deploy **only via `main`** (`.github/workflows/deploy-firestore-rules.yml`), for both databases. **No deployment route is authorised at present (O-6):** rule changes are implemented and emulator-tested on `mig-mov` only. Every rule change ships with emulator tests for every role.

---

## 5. D1–D8 resolutions

| # | Resolution | Basis |
|---|---|---|
| D1 R8 holder clause | **Removed with the claim model.** The decision checks obligation state, not holders | §1.2 |
| D2 cutover replay | P1: intent `paid` with the same payment ID → REPLAY, and the missing `gatewayPayments` record is created as `applied`. Never classified as a duplicate | Owner decision (protect history) |
| D3 late-fee identity | `otherFees/latefee_{matchId}_{week}`, week index computed by the server; created on APPLY; client template IDs ignored; legacy transition per §17 | Owner decision (per player / match / week) |
| D4 payable amount | Captured amount must equal the immutable intent snapshot. An obligation whose amount fields changed after the order → DUPLICATE (exception), never applied at a stale amount (**O-5**) | Guarantee 6 |
| D5 source of truth | Existing `status` and payment fields remain the only truth; no parallel settlement field. Rules protect settled records (PX-4) | "Avoid multiple sources of truth" |
| D6 reservation after rejection | Reservation and `obl_` locks of that intent → `exception`; the order is never offered again | §3.4 |
| D7 persistent failures / bundles | Never 503 for non-transient conditions: record + 200. Order route rejects > 20 obligations with 400 (**O-4**) | Webhook availability |
| D8 categories | All four protected from B2 onward with no gap (§18); identities per §2.2; merchandise ownership in B1 (PX-1) | Owner decision |

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
| **B2 P0 duplicate settlement (all categories)** | `gatewayPayments` registry for **every** category at once; decision P1–P7 with the §15 table for match fees, other fees and dues-paid merch orders; Studio renewal per §16; interim late-fee guard per §18 (until B3); DUPLICATE / HOLD / UNMATCHED / IDENTITY_CONFLICT write sets; dead-letter inside the transaction; P1 cutover replay; outage behaviour per §19 | `lib/payments/decide.ts` (new, pure), `lib/payments/gateway-payments.ts` (new), `lib/razorpay-webhook.ts`, `app/api/razorpay/webhook/route.ts`, `lib/webhook-dead-letter.ts`; R3 / R5 test expectation updates | (1) Two intents (match screen + dues bundle) for one match fee, both orderings × 20 repetitions → exactly one Paid, one `rejected_duplicate`, the first payment's fields unchanged. (2) Manual cash Paid, then capture → DUPLICATE. (3) Pre-cutover redelivery → REPLAY, never duplicate. (4) Injected failure before commit → no state change; lost acknowledgement → REPLAY with zero writes. (5) Every non-applied capture has a `gatewayPayments` record and a dead-letter. (6) 6 concurrent deliveries → one record. (7) §16 scenarios S1–S7 pass. (8) No category is less protected than before B2 (§18 table, one test per row) |
| **B3 PX-2 / PX-3 weekly late fees** | Server weekly identity in both order paths; webhook writes `latefee_{matchId}_{week}` with `create()`; legacy transition per §17 (**O-2 revised**) | `lib/razorpay-order.ts`, `lib/razorpay-webhook.ts`, `lib/payments/decide.ts` | (1) A client `lateFeeTemplateId` has no effect. (2) The same week via two intents → one application. (3) Weeks 0..n each once. (4) §17 transition cases T1–T7 pass. (5) UI still shows the fee as paid |
| **B4 PX-4 otherFees rules** | §4 Phase 1 rule changes | `firestore.rules`, new rules emulator test | Per role: Paid fee status/amount/payment fields immutable; Paid fee not deletable; unpaid fee editable by Finance; `latefee_` IDs not client-creatable; existing UI flows that write unpaid fees still pass. **Not deployed (O-6)**; preserves the Finance workflows listed in §21 (O-3) |
| **B5 R1 / R2 / R3 verification** | Source re-verification and deployment mapping (§9.3) | report only (`docs/qa/`) | Each item marked Verified (source) / Verified (runtime) / Not deployed / Blocked, with evidence |

### Phase 2: Core payment integrity

| Batch | Scope | Acceptance criteria |
|---|---|---|
| **B6 snapshot and identity** | Generalise the B2 snapshot (`obligations[]` + fingerprint) to every order path; ≤ 20 limit | Snapshot immutable; every key server-derived; a request with a foreign obligation → 403; 21 obligations → 400 |
| **B7 orphan adoption and FIN-004** | P4 adoption per §14; merch orders only from the webhook (FIN-004) | §14 adoption and rejection cases each pass; an orphan for an ambiguous intent is adopted and applied once; an order already linked to another intent → HOLD |
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
3. **Legacy late fees:** `lf_{intentId}_…` and manual `latefee_{matchId}` records stay untouched and are interpreted by the controlled transition in §17 (O-2 revised).
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
| Late-fee weekly settlement | Each week once; client template ignored; §17 T1–T7 |
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
| I3 / I18 / I26 retention and release by payability only | **Replaced** | Intent correlation + capture-time decision; ambiguous obligations blocked until adoption or evidenced resolution (§14.3, O-1 reworked) |
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

Only new questions; settled owner decisions are not reopened. The "Direction" column records the independent review's recommendation (revision 2). **None of these is implementation authorisation.**

| # | Decision | Direction |
|---|---|---|
| **O-1** | Ambiguous-order handling per §14.3: obligations stay blocked for online payment until the orphan is adopted, the obligation is settled manually, or Finance performs an evidenced, audited release after the hold period | **Rework (review)**: implemented as §14.3; no uncontrolled orphan exposure. Owner to confirm the §14.3 hold period |
| **O-2** | Legacy late-fee transition per §17 (weekly identity kept; cutover boundary; no back-charging of weeks that accrued before cutover while hidden by the legacy UI) | **Revise (review)**: implemented as §17. Owner to confirm the no-back-charge rule (§17.4) |
| **O-3** | Paid other fees become immutable from the browser (as match payments already are) until the Phase 3 correction endpoint exists | **Accept** as a security requirement, preserving the legitimate Finance workflows listed in §21 |
| **O-4** | Maximum 20 obligations per online payment | **Accept** |
| **O-5** | A payment whose obligation amount changed after the order was created goes to Finance review instead of being applied | **Accept** |
| **O-6** | Deployment route for rules (B4, pending R2-A) and code | **No deployment route is authorised at present.** Work stays on `mig-mov`; `main` unchanged |
| **O-7** | Adopt this proposal as the execution plan in place of revision 7 Phases 1A–7 | **Accept the direction**, subject to the revision 2 corrections (§14–§19) |
| **O-8** (new) | Recovery of a capture that never reached the webhook (§19.3): Finance records it from Razorpay dashboard evidence; applying it to an obligation needs either a read-only gateway fetch-by-ID in production or Finance attestation | Owner choice; until decided such payments stay `held_for_review` |

## 13. Recommended implementation sequence and dependencies

```
B1 PX-1 ─────────────┐                     (independent; first)
B5 verification ─────┤ parallel review
B4 PX-4 rules ───────┘ (independent; not deployed, O-6)
B2 P0 duplicate settlement (all categories) ──► B3 weekly late fees ──► B6 snapshot ──► B7 orphan adoption ──► B8 order route
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
- **Review checkpoints:** ChatGPT reviews each batch's diff and evidence. The owner authorises each batch. B15 and B16 (staging and production) need a separate deployment authorisation that does not exist today (O-6).
- **First batch:** B1 (PX-1), contingent on independent review and owner authorisation. **Next:** B2 (P0 duplicate settlement).

Nothing in this document authorises implementation, deployment, a rules change, a migration or any gateway operation.

---

# Revision 2 corrections

## 14. Orphan gateway order identity and recovery (review item A)

**Principle:** order notes are untrusted data. An order is adopted onto an intent only when **our own records** independently show that exactly this intent had an unknown create outcome, and that no other order or intent claims it.

### 14.1 Adoption conditions (all checked inside the webhook transaction)

| # | Condition | Source of truth |
|---|---|---|
| A1 | Event signature valid over the raw body (authenticates order ID, payment ID, amount, currency) | existing R3 check (`app/api/razorpay/webhook/route.ts:126–147`) |
| A2 | **Intent provenance:** `razorpayIntents/{notes.intentId}` exists. The collection has no client write path (catch-all deny), and from B2 the order route stamps `source: "order-route"`. Intent status `pending`; `orderId` empty | intent |
| A3 | **Reservation identity:** `notes.reservationKey == intent.reservationKey`; `paymentReservations/{reservationKey}.intentId == intent.id`; reservation state is ambiguous (`reconciliation_required`, `reconciliation_failed`, or expired `reserving`) | reservation |
| A4 | **Not linked elsewhere:** no other intent has `orderId == X` (transaction query); reservation `orderId` empty or `== X`; no `gatewayPayments` record for order X bound to a different intent (transaction query) | intents, reservation, registry |
| A5 | **Player ownership:** the intent's payer resolves (merge chain) to the owner of every snapshot obligation | obligations |
| A6 | **Amount:** captured paise == immutable snapshot `amountPaise` | intent |
| A7 | **Currency:** event currency == intent currency (INR) | intent |
| A8 | **Order consistency:** when the event includes the order entity (`order.paid`), `order.receipt` == the reservation's receipt and `order.notes.intentId` == the intent. An event with neither payment notes nor the order entity is not adoptable | event |
| A9 | **Payment identity:** no `gatewayPayments/{paymentId}` with a different identity (P2); intent not paid by another payment (P5) | registry, intent |
| A10 | **Obligations:** every snapshot obligation `PAYABLE` (§15) | obligations |

All hold → in the same transaction:
- `intent.orderId = X`, `orderAdoptedAt`;
- reservation `orderId = X`, event `order_adopted`;
- then APPLY.

### 14.2 Conditions that produce a Finance exception (never adoption)

| Failing condition | Result | Severity |
|---|---|---|
| Intent missing / notes missing (A2) | UNMATCHED | normal |
| Intent already linked to a **different** order | HOLD `ORDER_MISMATCH` (a second order for one intent) | high |
| Order already linked to **another** intent or payment (A4) | HOLD `ORDER_LINKED_ELSEWHERE` | high |
| Reservation not ambiguous, or bound to another intent (A3) | HOLD `RESERVATION_MISMATCH` | high |
| Intent `superseded` (§14.3 R-c) | HOLD `INTENT_SUPERSEDED` | high |
| Amount / currency mismatch (A6, A7) | UNMATCHED | normal |
| Receipt or notes disagree (A8) | HOLD `ORDER_IDENTITY_CONFLICT` | high |
| Payment identity conflict (A9) | IDENTITY_CONFLICT | high |
| Any obligation not `PAYABLE` (A10) | DUPLICATE or HOLD per §15 | normal |

### 14.3 Ambiguous obligations: bounded resolution (O-1 reworked)

While a reservation is ambiguous, its obligations are **blocked for new online orders** (409 `PAYMENT_BEING_VERIFIED`; payer told to wait or pay the club directly). There is **no routine release**. Resolution paths:

| Path | Trigger | Effect | Orphan exposure |
|---|---|---|---|
| R-a Adoption | the orphan is captured | §14.1 → applied once | none |
| R-b Manual settlement | Finance records cash / UPI | obligation Paid; locks → `settled_elsewhere`; a later orphan capture → DUPLICATE → refund | no new order created |
| R-c Evidenced release (Phase 3 Finance action) | Finance, after the hold period (**proposed 72 h; owner to confirm**) | Requires recorded dashboard evidence (orders searched by receipt / notes: none found, or the found order attached through R-a checks), a reason, actor and audit. Old intent → `superseded`, reservation → `released`, then a new order may be created | bounded: at most one orphan per ambiguous create; any capture on it → HOLD `INTENT_SUPERSEDED`, **never auto-applied**; Finance applies it only if the obligation is still unpaid, else refunds |

Until B10 / B13 exist, only R-a and R-b are available.

## 15. Canonical obligation state table (review item B)

**Classes:** `PAYABLE`; `SETTLED` → DUPLICATE; `NOT_DUE`, `CHANGED`, `MISSING`, `CONFLICT`, `UNCLASSIFIABLE` → HOLD.

**Bundle rule:**
- Every obligation `PAYABLE` → APPLY.
- Every non-payable obligation `SETTLED` → DUPLICATE.
- Otherwise → HOLD.

No obligation is ever written unless the whole bundle applies. **A missing obligation is never skipped.** At order time the route also rejects (409 `OBLIGATION_NOT_PAYABLE`, naming the items) instead of silently dropping unpayable items, as `derivePayableAmount` does today (`lib/razorpay-order.ts`, dues branch `continue` statements).

Rows are evaluated top to bottom; the first match wins.

**Match fee** (`matches/{m}/payments/{p}`):

| State | Detection | Class |
|---|---|---|
| Missing | payment or match document absent | MISSING |
| Wrong player | merge-resolved `playerId` ≠ snapshot player | CONFLICT |
| Abandoned / cancelled | `!isMatchBillable(match)` (`lib/matchBillable.ts`, same predicate as the UI) | NOT_DUE |
| Paid through Razorpay | `status == "Paid"` and (`paymentMethod == "razorpay"` or `razorpayPaymentId` set); same payment ID is P1 REPLAY | SETTLED |
| Paid manually | `status == "Paid"` and manual method (`cash_collected`, `deposited_directly`, or `paymentMethod == "manual"`) | SETTLED |
| Sponsored / plan-settled | `sponsoredBy` set or `manualMethod` ∈ {`club_sponsored`, `part_of_plan`} | SETTLED |
| Waived / not playing / zero fee | `status` ∈ {`Waived`, `Not Playing`} or `feeOverride == 0` | NOT_DUE |
| Amount changed | `feeOverride ?? match.fee` ≠ snapshot fingerprint (O-5) | CHANGED |
| Inconsistent | `Unpaid` with `razorpayPaymentId`, or any unknown `status` | UNCLASSIFIABLE |
| Unpaid | `status == "Unpaid"` | PAYABLE |

**Other fee** (`players/{p}/otherFees/{id}`, not a late fee):

| State | Class |
|---|---|
| Missing (keeper path and original path) | MISSING |
| Path player ≠ snapshot player after merge resolution | CONFLICT |
| `Paid` (Razorpay or manual) | SETTLED |
| `Waived` / `Cancelled` | NOT_DUE |
| `amount` ≠ snapshot | CHANGED |
| `Unpaid` | PAYABLE |
| Anything else | UNCLASSIFIABLE |

**Weekly late fee** (`otherFees/latefee_{m}_{w}`): §17.

**Studio renewal** (`subscriptionHistory/sub_…`): §16.
- Player missing → MISSING.
- Anchor exists → SETTLED.
- Expiry ≠ snapshot basis → CHANGED.
- Plan fee ≠ snapshot → CHANGED.
- Otherwise → PAYABLE.

**Merchandise:**

| Kind | State | Class |
|---|---|---|
| Shop purchase `mo_{intentId}` | absent | PAYABLE |
| | present | SETTLED |
| Dues-paid `merchOrders/{id}` | missing | MISSING |
| | `playerId` ≠ snapshot player | CONFLICT |
| | `paymentStatus == "Paid"` | SETTLED |
| | cancelled order status (values enumerated from the shop code in B2) | NOT_DUE |
| | `price` ≠ snapshot | CHANGED |
| | `Unpaid` | PAYABLE |
| | anything else | UNCLASSIFIABLE |

**Existing payment identity conflict** (any category) is decided before classification: P2 → IDENTITY_CONFLICT.

## 16. Studio subscription renewal (review item C)

**Today:**
- the webhook extends from the player's expiry **at capture time** (`lib/razorpay-webhook.ts:338–347, 516–568`);
- it writes a random `subscriptionHistory` ID;
- it is idempotent per intent only;
- the reservation key is per player + plan, so orders for two plans can coexist.

Two intents for one period therefore extend twice (pre-existing).

**Immutable renewal snapshot** (on the intent, written once at order time):

`{playerId (merge-resolved), planId, planName, durationDays, amountPaise, basisExpiry, orderedAt}`

`basisExpiry` = the player's stored `studioExpiryDate` (fallback `studioEndDate`, as the webhook reads today), or `NONE`.

**Identity:**
- `renewalKey = "sub|{playerId}|{basisExpiry}"`: the renewal of *that* expiry. The plan is deliberately not part of the identity.
- Anchor `subscriptionHistory/sub_<base64url(sha256(renewalKey))>` (immutable collection).

**APPLY transaction** (reads player, `appUsers`, anchor; then writes):
1. Anchor exists → DUPLICATE.
2. Current stored expiry ≠ `basisExpiry` → CHANGED → HOLD. Never re-based silently.
3. Plan fee ≠ snapshot → CHANGED → HOLD (O-5).
4. `start = max(basisExpiry, clubToday)` using the club calendar date (`getClubCalendarDate`, not server local time); `newExpiry = start + durationDays`.
5. Assert `newExpiry > currentExpiry`.
6. Write in the same transaction: anchor `create()` (`{planId, oldExpiry, newExpiry, paymentId, intentId}`), the player and `appUsers` expiry, and the `gatewayPayments` record.

Correctness rests on the **compare-and-set of the expiry inside one transaction** (step 2). The deterministic ID adds a second, explicit duplicate marker.

| # | Scenario | Result |
|---|---|---|
| S1 | One renewal (basis E0) | E0 + d (or today + d if lapsed); one anchor |
| S2 | Two concurrent orders for the same period (both basis E0) | Serialised on the player document: first → E0 + d; second sees the anchor → DUPLICATE → refund. One extension |
| S3 | Order A (E0) still unpaid when order B is created | B also has basis E0 → same identity; whichever is captured first applies; the other is DUPLICATE |
| S4 | Delayed webhook | Expiry still E0 → applies with `start = max(E0, today)` (a lapsed member gets the full period from capture). If an administrator changed the expiry meanwhile → HOLD |
| S5 | Payment for an already-settled period | Anchor exists → DUPLICATE (same payment → P1 REPLAY) |
| S6 | Next legitimate renewal after A applied (E1) | New basis E1 → new anchor → E1 + d; prepaying while active works |
| S7 | Plan change | Orders for plan X and plan Y with the same basis are one period: only the first captured applies, with its own snapshot duration; the other → DUPLICATE. After A applies, a plan-Y order has basis E1 and extends with Y's duration |

The expiry is never shortened (step 5), never overwritten on a stale basis (step 2), and never extended twice for one period (anchor + step 2).

**Legacy subscription intents (no snapshot):** if any `subscriptionHistory` entry for the player is newer than `intent.createdAt` → HOLD. Otherwise apply today's semantics and write the anchor computed from the expiry read at capture.

## 17. Legacy late-fee transition (review item D; O-2 revised)

### 17.1 Recognition

For player p and match m (same predicates as the UI, `components/FinanceTab.tsx:170–189`, `components/DuesAndRemindersTab.tsx:172–186`):

- **Weekly (v2) record:** `otherFees/latefee_{m}_{w}` with server field `lateFee: {version: 2, matchId, week}`.
- **Exemption:** title starts `Late Fee Exemption:` and includes `m`, status ≠ `Cancelled` → no late fee for (p, m).
- **Legacy record:** any other fee with status ≠ `Cancelled` where `templateId` contains `latefee_{m}`, or the title starts `Late Fee` and the title or comment contains `m`. Kinds:
  - **K1:** per-week webhook record `lf_{intentId}_latefee_{m}_{w}` (template `latefee_{m}_{w}`), from the match screen (`lib/razorpay-webhook.ts:370`);
  - **K2:** aggregated dues webhook record (`:410`);
  - **K3:** manual Finance record, template `latefee_{m}` (`DuesAndRemindersTab.tsx:1026–1040`);
  - **K4:** title-only match.

### 17.2 Interpretation (records are never modified)

| Kind | Paid | Unpaid |
|---|---|---|
| K1 | settles week w | is the obligation for week w (payable through the other-fee path; no v2 duplicate) |
| K2 / K3 / K4 | settles weeks 0…k where amount = 150 + 50k exactly (`computeLateFees` schedule, `lib/utils.ts:180–228`) | covers the same weeks as an existing obligation |
| Amount not on the schedule | (p, m) is `LEGACY_AMBIGUOUS` | same |

### 17.3 Cutover boundary

`T_cut` = the activation instant of B3. It is a server constant fixed in code and in the B3 release notes, not configurable from a client. Each week has a deterministic accrual date from the `computeLateFees` schedule.

### 17.4 Generating weekly obligations (server, at order time)

A late fee is due for week w only while the match fee is `Unpaid`, the match is billable, the fee is above 0 and no exemption exists. This matches the UI (`FinanceTab.tsx:164–168`). For each accrued week w:

- covered by a v2 or legacy record → excluded;
- (p, m) has a legacy record, w is not covered, and accrual(w) < `T_cut` → **excluded (transition waiver)**. The legacy UI hid these weeks once any record existed, so they were never billed and are **not back-charged** (owner to confirm);
- (p, m) is `LEGACY_AMBIGUOUS` → late fees for m are excluded from online payment and flagged to Finance;
- otherwise → snapshot obligation `latefee_{m}_{w}` (₹150 for w = 0, ₹50 for each later week).

### 17.5 Duplicate prevention across the transition

- The webhook re-reads the player's other fees inside the transaction (one player's bounded set) and re-classifies every snapshot week by 17.1–17.4:
  - covered → SETTLED;
  - exemption, waiver or match no longer due → NOT_DUE;
  - ambiguous → UNCLASSIFIABLE;
  - otherwise PAYABLE, and the v2 document is written with `create()`.
- Pre-B3 intents carrying old-format late-fee items are mapped to weeks (per-week templates; aggregated amounts by the schedule) and written as v2 records.
- **No `lf_` record is written after B3.** No client-supplied template ID ever determines an identity.
- Until B9 updates the UI, the screens still hide later weeks once any record exists. That can only under-bill, never double-bill.

### 17.6 Tests

| # | Case | Expected |
|---|---|---|
| T1 | No legacy, weeks 0–3 accrued | four v2 records, each once |
| T2 | K1 week 0 paid; weeks 1–2 accrued before `T_cut`, week 3 after | weeks 1–2 waived, week 3 due |
| T3 | K2 paid ₹250 | weeks 0–2 covered |
| T4 | K3 paid ₹230 | ambiguous → excluded online; webhook HOLD if present |
| T5 | Pre-B3 intent and v2 intent for the same week | one application, one DUPLICATE |
| T6 | Tampered `lateFeeTemplateId` | ignored |
| T7 | Exemption present / match fee paid / match abandoned | no late fee |

## 18. Category coverage across the cutover (review item E)

The registry (`gatewayPayments` with P1, P2, P3, P5) is introduced in **B2 for every category at once**. Obligation-level rules are layered on top. **At no point is any category less protected than today.**

| Category | Today | After B1 | From B2 (cutover) | From B3 |
|---|---|---|---|---|
| Match fee | per intent only; a second intent overwrites the Paid record (P0) | unchanged | §15: at most one application | unchanged |
| Other fee | same as match | unchanged | §15 | unchanged |
| Late fee | per-intent `lf_` records; a second intent writes a second record | unchanged | **interim guard:** any recorded late fee for (p, m) (§17.1 predicate, as the UI uses today) → the order route excludes late fees for m, and the webhook HOLDs a snapshot that includes them | weekly v2 identity (§17) |
| Studio renewal | per intent; two intents extend twice | unchanged | §16 in full | unchanged |
| Merch, shop purchase | per intent; client `id` overwrite (PX-1) | `mo_{intentId}`, `create()` only | registry record | unchanged |
| Merch, paid via dues | per intent; marked Paid unconditionally | unchanged | §15 | unchanged |

**Transition sequence:**
- **Existing behaviour:** unchanged until a batch's code is deployed. No deployment is authorised (O-6), so "cutover" means the future deployment of B2. In tests it is simulated with pre-B2-shaped intents.
- **Cutover:** intents created before B2 (no snapshot) are decided with their stored per-intent fields mapped to obligations (§9.5) under the same §15 / §16 / §17 rules.
- **New registry behaviour:** every capture creates exactly one `gatewayPayments` record.
- **Historical replay:** a pre-cutover payment redelivered after cutover → P1 REPLAY (a missing registry record is created as `applied`). No historical document is modified. No registry backfill is required.

## 19. Webhook and database outage recovery (review item F)

### 19.1 Behaviour

| Situation | Response | Local state | Recovery |
|---|---|---|---|
| Firestore unavailable / deadline exceeded | 503 after SDK retries | unchanged (nothing committed) | Razorpay redelivers with back-off for up to 24 h; the next delivery decides normally |
| Transaction contention (`ABORTED`) | SDK retries; on exhaustion 503 | unchanged | as above |
| `ALREADY_EXISTS` on a `create()` | the transaction re-runs once in-process | the other delivery's commit | resolves to REPLAY / DUPLICATE |
| Commit succeeded, acknowledgement lost (or > 5 s) | Razorpay redelivers | committed | P1 REPLAY, zero writes |
| Duplicate delivery (incl. `payment.captured` + `order.paid`) | 200 REPLAY | unchanged | – |
| Permanent inconsistency (missing obligation, invalid merge chain, unclassifiable) | HOLD / UNMATCHED **committed**, then 200 | recorded | Finance (B13) |
| Writing the exception record fails | 503; logged as `retryable`, **never** as `recorded` | unchanged | Razorpay retry |
| Retry exhaustion (24 h) or webhook disabled by Razorpay | none | captured at Razorpay, nothing local | §19.3 |

The route reports or logs `processed` / `recorded_for_reconciliation` only after the commit that contains the record. The R5 route already follows this rule (`app/api/razorpay/webhook/route.ts:72–99`). B2 keeps it, with the dead-letter in the same transaction as the decision.

### 19.2 Monitoring (decided at deployment time; nothing deployed now)

Alert on any 503 sustained for more than 1 hour. Check the Razorpay dashboard webhook status weekly and re-enable it if it was disabled (runbook in B13).

### 19.3 Captures that never reached the webhook

Weekly Finance reconciliation:
1. Finance supplies the payment IDs from the Razorpay dashboard export.
2. A read-only B13 tool compares them with `gatewayPayments`. No gateway call is made.
3. Each missing ID → Finance records a `held_for_review` registry entry with evidence (`source: finance_import`).

Applying such a payment to an obligation needs **O-8** (read-only gateway fetch-by-ID in production, or Finance attestation). Until O-8 is decided, these entries stay held, and they stay visible.

## 20. B1 (PX-1) implementation readiness

| Item | Detail |
|---|---|
| Files and functions | `lib/razorpay-order.ts` `derivePayableAmount`, `merch_order` branch (`:1556–1600`): build `orderPayload` from an allowlist; drop the client `id`. `lib/razorpay-webhook.ts` `processWebhookIntentTransaction`: read `merchOrders/mo_{intentId}` in the read phase; in the `merch_order` write branch (`:569–584`) use `transaction.create()` with allowlisted + server fields; add permanent reason `MERCH_ORDER_EXISTS` (`:26–39`). `lib/webhook-dead-letter.ts` `classifyDeadLetter`: map it to `data_integrity`. `generateReservationKey` (`:72–80`) unchanged |
| Allowlist (validated) | `playerId` (ownership-verified, as today), `playerName` (player record when available, else ≤ 100 chars), `merchId` (must exist), `merchName` (from the merch document), `size` ≤ 50, `spec` ≤ 200, `customSelections` (≤ 20 string pairs, key ≤ 50, value ≤ 100), `customPriceAdditions` (informational), `jerseyName` ≤ 30, `jerseyNumber` ≤ 10, `orderStatus` ∈ {`Awaiting Min Order Qnty`, `Ready to Place Order`, `Order Placed`} (default `Order Placed`) |
| Server-set fields | `id = mo_{intentId}`, `price` (server, as today), `paymentStatus: "Paid"`, `isManual: false`, `razorpayPaymentId`, `intentId`, `createdAt`, `updatedAt` |
| Behaviour preserved | Server price; ownership check (`verifyPlayerOwnership`); reservation key; per-intent replay; R3 / R5 HTTP semantics; shop UI unchanged; every field the Club Orders view shows; other intent types untouched |
| Security boundaries | No client value is used as or inside a document ID; no client value can set server fields; `create()` never overwrites; no rules or data change |
| New tests | `tests/px1-merch-order-identity.emulator.test.mjs` (real route, real HMAC, R3 harness). (1) Client `id` = another player's order → that document byte-identical. (2) `id` with `/` or over-long → ignored. (3) Client `paymentStatus` / `isManual` / `razorpayPaymentId` / unknown fields → absent or server values. (4) `orderStatus` outside the enum → default. (5) Tampered price → server price. (6) `payment.captured` + `order.paid` × 6 concurrently → one order. (7) Replay → `already_processed`, no second order. (8) Exact `ShopTab.tsx:384–398` payload → one Paid order with all display fields. (9) Pre-existing `mo_{intentId}` → not overwritten, dead-letter `MERCH_ORDER_EXISTS`, 200 |
| Existing test change | `tests/emulator-webhook-concurrency.test.mjs` merchandise case seeds `orderPayload.id` = an existing order and expects that order to be updated. That **is** the PX-1 behaviour. New expectation: the seeded order is untouched, and one `mo_` order is created. R3 / R5 / R2-A fixtures already use `mo_${intentId}` and are unaffected |
| Regression | `npm run test:functional`, `npm run test:emulator`, `npx tsc --noEmit`, `npm run build` |
| Independent of B2 | **Yes.** Only the merchandise branches change; no registry, rules or migration dependency; B2 later wraps the same branch |
| Known limitations | **FIN-004:** after checkout the browser also calls `finalizeOrderPlacement` (`ShopTab.tsx:437–440, 473–516`). For players the second write is denied by the `merchOrders` create rule (`firestore.rules:710–718` requires `Unpaid`), so a player may see an "Order failed" message after a successful payment. For administrators it creates an unlinked duplicate Paid order. **Not changed in B1; fixed in B7.** The MOQ status is still computed in the browser (bounded by the enum). No deployment is authorised (O-6) |

## 21. Decision register (revision 2)

| # | Review observation | Response | Resolution | Remaining owner decision |
|---|---|---|---|---|
| A | Notes alone must not establish trust in orphan orders; O-1 risk | Agreed | §14: adoption requires A1–A10 from our own records; exception table; ambiguous obligations stay blocked; evidenced release only | Hold period for R-c (proposed 72 h) |
| B | P6 too broad; missing items must not be skipped; all or nothing | Agreed | §15 state table per type; bundle rule; HOLD class; order route rejects unpayable selections | None |
| C | Renewal basis conflict (order time vs capture time) | Agreed; the defect is pre-existing | §16 immutable snapshot, expiry compare-and-set, anchor, scenarios S1–S7 | None |
| D | O-2 too broad; keep weekly identity | Agreed | §17 recognition, interpretation, `T_cut`, generation, transition waiver, tests | Confirm the no-back-charge rule (§17.4) |
| E | No gap while the registry is introduced | Agreed | §18: registry for all categories in B2; §16 moved into B2; interim late-fee guard; per-category table | None |
| F | Outage recovery; never claim an unrecorded exception | Agreed | §19 behaviour table, logging rule, weekly reconciliation | O-8 |
| O-1 | Rework | Done | §14.3 | Hold period |
| O-2 | Revise | Done | §17 | §17.4 rule |
| O-3 | Accept, preserving Finance workflows | Recorded | Still allowed: create unpaid fees; edit unpaid fees; record manual Paid on an unpaid fee; waive or cancel an unpaid fee; create exemption records. Blocked until B10: edit, revert or delete a **Paid** fee | None |
| O-4 | Accept | Recorded | ≤ 20 obligations | None |
| O-5 | Accept | Recorded | CHANGED → HOLD (§15, §16) | None |
| O-6 | No deployment route authorised | Recorded | All work on `mig-mov`; `main` unchanged | Future deployment approval |
| O-7 | Accept direction subject to corrections | Recorded | This revision | Approval of revision 2 |

**None of the above authorises implementation.** B1 is ready for owner authorisation once the reviewer accepts revision 2.
