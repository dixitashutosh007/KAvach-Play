# R4 Phase 1A: Payment Integrity Foundation. Implementation Readiness Report

**Type:** planning and inspection only. **Not approval to implement Phase 1A.** Prepared without modifying any repository file; published afterwards as this single documentation file (§9).
**Baseline:** `mig-mov` @ `64de4f85d95167398e6b7f0da5fee6f1f2aa61e1`; architecture revision 7 + Q30 (`docs/implementation/R4_ARCHITECTURE_DESIGN.md`).
**Date:** 2026-11-24
**Prepared by:** implementation agent (Claude Code). **Reviewer:** ChatGPT (independent). **Approver:** product owner.

---

## 1. Repository baseline and current state

| Check | Result |
|---|---|
| Branch | `mig-mov` |
| Local HEAD | `64de4f85d95167398e6b7f0da5fee6f1f2aa61e1` |
| `origin/mig-mov` (fetched 2026-11-24) | `64de4f85d95167398e6b7f0da5fee6f1f2aa61e1` (match) |
| Working tree | clean (0 entries in `git status --porcelain`) |
| Architecture document | `docs/implementation/R4_ARCHITECTURE_DESIGN.md`, revision 7 + Q30 (1,293 lines), read in full |
| Code changes since the design baseline | **None.** The last commit touching `lib/`, `app/`, `hooks/`, `firestore.rules`, `tests/`, `firebase.json`, `package.json` or `scripts/` is `352a94c` (R5, 2026-11-23 14:42 UTC). The first design revision `7411f37` is later (15:54 UTC). All eight design commits change only the design document. The line references in design §1 still match the code (e.g. `processWebhookIntentTransaction` `:235`, `reconcileAmbiguousReservation` `:656`, `derivePayableAmount` `:1283`) |

### 1.1 The Phase 1A definition is cumulative and partly outside revision 7

Revision 7 §11 says "revision 4 §11, extended", and revision 4 §11 says "unchanged from revision 3 §11, with these scope additions". The full Phase 1A scope therefore exists only by combining four revisions, two of which are present only in git history:

| Source | Phase 1A content |
|---|---|
| Rev 3 §11 (`7317e1d`, history only) | `decidePaymentApplication`; `gatewayPayments` (create-only, immutable identity, anomalies); §4.3 write sets incl. REJECT_INVALID and IDENTITY_CONFLICT; first-outcome immutability; order identity recovery (rev 3 §4.4); **`lateFeeObligations` + deterministic mirror + legacy ambiguity handling; late-fee backfill script (dry run only)**; synthetic attempts; tests T1 (1A), T3–T5, T7–T13, T21, T23 |
| Rev 4 §11 (`f131e42`, history only) | Claim fields (`retainedOrders`, anomaly) created read-compatibly (missing claim = OPEN); R4–R10; terminal immutability; allocations; tests B8-1…B8-4, B8-7, B8-8, B6-4 (decision part) |
| Rev 5 additions (in rev 7 §11) | `gatewayOrders` with exposure class; retention-on-payment; R11; refund-ledger read model (for decisions); allocation lines; tests B9-4, B9-5, B11 (decision parts), B12-1 |
| Rev 6 additions (in rev 7 §11) | `retainedPossibleOrders`; both exposure dimensions; L4 / L7 in the webhook; tests B15-3, B15-4, B15-5 (webhook parts) |
| Rev 7 | No new 1A row. R5 now includes ABANDONED (§4.2) |

Consequences:
- The detailed rule tables that Phase 1A implements (R1–R10 conditions; the REPLAY / IDENTITY_CONFLICT / REJECT_INVALID / REJECT_DUPLICATE / APPLY write sets; I1–I16; T1–T26; B6–B8 tests) are "retained" by reference and are **not printed in revision 7**. This plan treats rev 4 §4.2–§4.3 and rev 3 §3.3 / §4.3 as authoritative where revision 7 does not override them. **The reviewer should confirm this reading (clarification N1).**
- The Phase 1A scope listed in the owner's brief does **not** mention late-fee obligations, the deterministic mirror, the backfill dry-run script, synthetic attempts or order-identity recovery, but the design puts all of them in Phase 1A. This plan includes them, flagged as decision **D3**.

---

## 2. Architecture-to-code gap analysis

### 2.1 What exists today (verified by source inspection)

| Area | Current implementation | File |
|---|---|---|
| Order creation | Request-shape reservation key (`res_match_…`, `res_dues_…`, `res_sub_…`, `res_merch_…`); `paymentReservations` lease and fence; expired-`reserving` takeover; `razorpayIntents.add()` with a random ID; receipt derived from the reservation key; `notes: {intentId, reservationKey}` | `app/api/razorpay/order/route.ts:25–611`, `lib/razorpay-order.ts:9–84, 313–466` |
| Payable amount | Server-derived from `feeOverride` / `match.fee` / `otherFees.amount` / `computeLateFees` / merch price / plan fee. **No base + adjustments model.** Late fees are recomputed from the current date at order time | `lib/razorpay-order.ts:1283–1602`, `lib/utils.ts:180` |
| Webhook fulfilment | One transaction per **intent**. Idempotency is `intent.status === "paid"` plus the same payment ID; a different payment ID → `CONFLICTING_PAYMENT` (permanent → dead-letter). **No obligation-level check**: a match payment or other fee already `Paid` is overwritten with the new payment's ID. Late fees are written as `otherFees/lf_${intentId}_${templateId}`, so two intents produce two late-fee records | `lib/razorpay-webhook.ts:235–619` |
| Validation | Order ID, payment ID, amount (vs intent), currency, `order.paid` partial-payment check; failures → `WebhookPermanentError` | `lib/razorpay-webhook.ts:155–228` |
| Dead-letter | R5: written in a **separate** transaction after the webhook transaction has thrown; key `pay_<paymentId>` / `evt_` / `ord_` / `body_` | `app/api/razorpay/webhook/route.ts:58–100`, `lib/webhook-dead-letter.ts:84–153` |
| Gateway payments / orders / claims / allocations / refunds | **None.** No code references `gatewayPayments`, `gatewayOrders`, `paymentAttempts`, `paymentObligationClaims`, `lateFeeObligations` or `settlementVersion` | – |
| Obligation settlement state | Legacy string `status` (`Paid` / `Unpaid` / `Waived` / `Not Playing`) plus `paymentMethod`, `manualMethod`, `sponsoredBy`. No `settlementVersion`, no settlement events | match payments, `otherFees` |
| Manual settlement | Client-side via `hooks/useStore.ts` (`updatePaymentStatus` `:1799`, `applyFeePlanToPayment` `:2154`, sponsorship `:2225–2366`), allowed by Finance rules and `isMatchAdminPaymentUpdate` | `hooks/useStore.ts`, `firestore.rules:279` |
| Rules for the new collections | Covered by the catch-all `match /{document=**} { allow read, write: if false; }` (`firestore.rules:5`) | `firestore.rules` |
| Indexes | No `firestore.indexes.json` in the repository | – |
| Tests touching the webhook | `emulator-webhook-concurrency`, `r3-webhook-route.emulator`, `r5-webhook-dead-letter.emulator`, `razorpay-webhook-concurrency`, `razorpay-webhook-negative`, `remediation1f-…emulator`, `server-security-phase5`, `r2a-account-privacy.emulator` | `tests/` |

### 2.2 Gap summary against Phase 1A

| Phase 1A element | Status | Gap |
|---|---|---|
| `gatewayPayments` registry, immutable identity, application, anomalies | Not implemented | Entire component |
| `decidePaymentApplication` R1–R11 | Not implemented | Entire component; today's logic is per-intent only |
| Webhook write sets (5 decisions) | Partly: APPLY-like path and per-intent replay only | REPLAY by payment identity, IDENTITY_CONFLICT, REJECT_INVALID with an `unmatched` record, REJECT_DUPLICATE with first-outcome rules, all in **one** transaction with the dead-letter |
| Obligation-level duplicate protection (G-A online-vs-online, online-vs-settled) | **Absent (defect D1/D3 in the design)** | A second intent for a paid match fee or other fee overwrites the paid record |
| `gatewayOrders` + two exposure dimensions | Not implemented | Entire component |
| R11 / L4 / L7 in the webhook | Not implemented | Link-or-classify before the decision; anomaly on identity conflict |
| Claims (read-compatible), `retainedOrders`, `retainedPossibleOrders`, anomaly flag | Not implemented | Schema, reader, retention-on-payment writer |
| Allocations + allocation lines | Not implemented | `alloc_<paymentId>` with `lines[]` |
| Refund-ledger read model | Not implemented | Pure derivation of C1–C6 quantities and summary fields |
| Synthetic attempts; first-outcome immutability; intent `paid_unapplied` | Not implemented | Intent statuses today: `pending`, `paid` |
| `lateFeeObligations` + deterministic mirror + legacy ambiguity; backfill (dry run) | Not implemented | Late fees today are per-intent `lf_` documents |
| Dead-letter inside the decision transaction | Not implemented (separate transaction today) | `recordWebhookDeadLetter` runs its own transaction |

### 2.3 Conflicts and ambiguities between source and design (not resolved here)

| # | Topic | What the code does | What the design says | Why it matters |
|---|---|---|---|---|
| X-A | Late-fee identity | Match-screen path: one item per week, template `latefee_${matchId}_${weeks}` (`razorpay-order.ts:1349`). Dues path: one aggregated item, template **taken from the client** `String(item.lateFeeTemplateId \|\| …)` (`:1491`). UI treats a late fee as paid when any `otherFees.templateId` *contains* `latefee_${matchId}` (`DuesAndRemindersTab.tsx:184`, `FinanceTab.tsx:186`); manual settlement writes template `latefee_${matchId}` (`DuesAndRemindersTab.tsx:1038`) | Canonical key `latefee\|{playerId}\|{matchId}\|{templateId}`, `lfo_` = hash of that key (rev 3 §3.1, §3.3) | Per-week vs per-match granularity determines the deterministic IDs, which cannot be changed after the first write. A client-supplied template ID must not become part of an obligation identity (**D3**) |
| X-B | Late-fee amount over time | Recomputed from today's date; grows by ₹50 per week | `lfo.amountPaise` "server-computed at levy time"; R9 rejects when amount ≠ current payable | Without a fixed levy amount, a payment created before a weekly rollover and captured after it would be rejected by R9 (**D4**) |
| X-C | Allocation location and shape | – | Rev 4: `gatewayPayments/{id}/allocations/{alloc_…}` with `obligationKeys[]`, `perObligationPaise[]`, basis `intent_bound` etc. Rev 5+: `allocations/alloc_<paymentId>` with `lines[]: {obligationKey, allocatedPaise}`, basis `webhook_intent` / `webhook_attempt`; rev 7 §3 lists it under `gatewayPayments` | Path and field names. Plan follows the latest revision, as a subcollection of `gatewayPayments` (**N2**) |
| X-D | `gatewayOrders` read access | – | Rev 4 §3: deny-all. Rev 7 §3: Finance / Super read | Rules. Phase 1A needs neither (no UI); plan keeps deny-all in 1A (**N3**) |
| X-E | `subscriptionPeriods` collection name | Already used for D3 **monthly finance subscriptions** (`app/api/finance/subscriptions/route.ts:34`, `reports/sponsorship/route.ts:71`) | R4 uses `subscriptionPeriods/{sp_…}` for **Studio** subscription periods | Name collision. Phase 2, not 1A, but must be resolved before Phase 2 (**N7**) |
| X-F | Merge and canonical keys | Webhook follows `mergedInto` and rewrites `playerId` on match payments; merges reparent `otherFees` under the keeper | `fee\|{playerId}\|{feeId}` and `latefee\|{playerId}\|…` include `playerId` | After a merge, a fee's canonical key changes and claim / allocation history keyed on the old player is orphaned (**N8**) |
| X-G | T23 (bundle 20 / 21 → 400) | No bundle limit in the order route | T23 is listed under Phase 1A, but the 400 is "at claim", which is Phase 2 | Test placement and webhook behaviour for legacy bundles over 20 (**D7**) |

---

## 3. Component-wise implementation plan

Notation for each component: **E** existing, **G** gap, **P** proposed changes and files, **D** data, **T** transactions and concurrency, **W** webhook and idempotency, **R** rules, **B** backward compatibility, **Q** tests, **A** acceptance evidence.

### C1. Canonical obligation keys and obligation read model

- **E:** request-shape reservation keys only; obligation status read as legacy strings in several places.
- **G:** no canonical key, no deterministic claim / late-fee ID, no single reader that maps legacy fields to settlement states.
- **P:** new `lib/payments/canonical-keys.ts` (segment validation `^[A-Za-z0-9_\-]{1,128}$` or `b64:` encoding; `cl_` / `lfo_` = prefix + base64url(SHA-256(key)); stored-key comparison; `lineHash`). New `lib/payments/obligations.ts`: `readObligations(tx, keys)` returns `{key, ref, state, payablePaise, settlementVersion, legacy}` using the rev 3 §2.1 legacy read mapping.
- **D:** obligation docs gain `settlement {state, basis, gatewayPaymentId, allocationId}`, `settlementVersion` and a `settlementEvents/{evtId}` subcollection on **APPLY only** (Phase 1A has no other server transitions). Legacy fields (`status: "Paid"`, `paymentMethod: "razorpay"`, `razorpayPaymentId`, `feeCollectedAmount`) continue to be written for the UI.
- **T:** reads only. Collision → anomaly, fail closed.
- **W:** used by the decision transaction.
- **R:** see D5 (client Finance writes to the new fields remain possible until Phase 1B; I7 defers the lockdown).
- **B:** missing `settlementVersion` = 0; missing `settlement` → legacy mapping.
- **Q:** unit: key encoding, collisions, every legacy mapping row; emulator: reader against seeded legacy docs.
- **A:** mapping table coverage; collision test shows fail-closed.

### C2. `gatewayPayments` registry

- **E:** none. The payment ID is stored only on the intent and the obligation.
- **G:** entire component.
- **P:** `lib/payments/gateway-payments.ts`: record builder, identity comparison (R1 / R2), anomaly ID `an_<sha256(event identity)>`, payment events.
- **D:** `gatewayPayments/{pay_…}`: immutable identity `{paymentId, orderId, amountPaise, currency, captureState: "captured", intentId?, attemptId?, boundPlayerId?, capturedAt, firstEventId}`; `application` ∈ `applied | rejected_duplicate | unmatched` (1A writes only these three); `applicationReasons[]`; refund summary `{refundReservedPaise: 0, refundProcessedPaise: 0, netCapturedPaise, refundPendingCount: 0, refundStatus: not_required | required}`. Subcollections `events/`, `anomalies/`, `allocations/`, and `refunds/` (no writer in 1A).
- **T:** `create()` inside the webhook transaction. **Implementation note:** a `create()` conflict surfaces as `ALREADY_EXISTS`, which the Admin SDK does not retry like `ABORTED`. Because the record is read first, the server SDK's locking should serialise concurrent deliveries, but the code must also catch `ALREADY_EXISTS`, re-run once and resolve to R1 / R2. This needs a test in the emulator and an explicit statement of emulator-vs-production locking differences.
- **W:** idempotency key = payment ID; R1 REPLAY = zero writes.
- **R:** server-only (catch-all deny). No Finance read rule in 1A (no UI).
- **B:** payments processed before 1A deployment have no record; see **D2**.
- **Q:** T10, T13, B9-5, B8-7; identity-conflict variants (order, amount, currency, intent).
- **A:** byte-identical original record after conflicting deliveries; one record per payment ID after N concurrent deliveries.

### C3. `decidePaymentApplication` (pure, R1–R11)

- **E:** none; `validateWebhookTransaction` covers part of R3.
- **G:** entire component.
- **P:** `lib/payments/decide-payment-application.ts`: pure function over the pre-read snapshot. Order: R1, R2, **R11** (link-or-classify, before R3), R3, R4 (FAILED_NO_ORDER), R5 (SUPERSEDED / ABANDONED / RETIRED), R6 (anomaly), R7 (first payment exists), R8 (obligation not `unpaid`; holder rules; legacy late-fee ambiguity), R9 (amount ≠ current payable), R10 APPLY. Bundles all-or-nothing.
- **D:** none (pure).
- **T:** none.
- **W:** the single source of truth for the decision; the transaction only executes its result.
- **R:** none.
- **B:** must handle synthetic legacy attempts (C9) and pre-1A payments (D2). R8's holder clause is **ambiguous for 1A** (D1).
- **Q:** exhaustive table tests over attempt state × obligation state × claim state × identity; property test that APPLY implies every obligation `unpaid` and no anomaly; B8-1…B8-4, B8-8, B11 decision parts (terminal attempts produce events only).
- **A:** a decision-table coverage report listing every rule hit by at least one positive and one negative case.

### C4. Webhook transaction and write sets (incl. dead-letter atomicity)

- **E:** `processWebhookIntentTransaction` (per intent); dead-letter in a separate transaction; R3 status mapping.
- **G:** five decision write sets; dead-letter inside the same transaction; removal of the `lf_${intentId}` writers (rev 3 §3.3: "removed in Phase 1A").
- **P:** new `lib/payments/webhook-apply.ts` (reads → decide → writes); `lib/razorpay-webhook.ts` keeps `extractWebhookEventDetails`, `validateWebhookTransaction` and the error classes, and delegates processing; `app/api/razorpay/webhook/route.ts` maps outcomes; `lib/webhook-dead-letter.ts` gains a transaction-participating writer (`recordWebhookDeadLetterInTx`) and new classifications (`duplicate_payment`, `identity_conflict`).
- **D:** write sets exactly per rev 4 §4.3 + rev 7 §4.3 (APPLY: obligations `settled_gateway`, allocation, payment `applied`, `gatewayOrders` link, claim retention `paid_applied`, intent `paid`, side effects; REJECT_DUPLICATE: payment `rejected_duplicate`, dead-letter, retention `paid_rejected`, attempt / intent only if CLOSED_UNAPPLIED-eligible; REJECT_INVALID: `unmatched` record if a usable payment ID exists, else dead-letter only; IDENTITY_CONFLICT: anomaly + high-severity dead-letter, nothing else).
- **T:** one transaction; all reads before writes; read set (≤ 20 obligations): intent, payment, anomaly doc, `gatewayOrders` doc, merge-chain players, obligations, claims, late-fee obligations + bounded legacy candidate query, dead-letter doc. Footprint asserted (design: ≤ about 150 writes) and fail closed above it. Contention is per player and obligation.
- **W:** 2xx only after commit; REPLAY 200 with no writes; REJECT_* / IDENTITY_CONFLICT 200 after commit; retryable failures (contention, outage, merge in progress) 503 with no partial effect. **Persistent** fail-closed conditions (footprint exceeded, canonical collision) need an HTTP mapping: 503 would make Razorpay retry for 24 h and risk the webhook being disabled (**D7**).
- **R:** none required.
- **B:** R3 / R5 behaviour changes: `CONFLICTING_PAYMENT` becomes REJECT_DUPLICATE (still 200 and recorded, now also with a `gatewayPayments` record); amount, order and currency mismatches become REJECT_INVALID with an `unmatched` record. Existing tests R3-10…R3-14 and R5 tests need updated assertions (expectations change, nothing is weakened).
- **Q:** T1 (1A), T3, T4, T5, T8–T13, T21, B6-4 (decision part), B8-1…B8-4, B8-7; route-level tests through the real `POST` with real HMAC (as R3); injected Firestore failure before commit (no partial state) and lost acknowledgement (REPLAY).
- **A:** per-test state snapshots of obligation, claim, payment, intent, dead-letter; "no partial commit" evidence for every injected failure.

### C5. `gatewayOrders` registry and exposure dimensions (R11, L4, L7)

- **E:** order ID stored on the intent and reservation only.
- **G:** entire component.
- **P:** `lib/payments/gateway-orders.ts`: `linkOrClassify(tx, order, correlation)`; monotonic `applicationExposure`; `gatewayPayability` fixed at `GATEWAY_PAYABILITY_UNKNOWN`.
- **D:** `gatewayOrders/{order_…}`: `{attemptId?, intentId?, obligationKeys[], source: "webhook", correlation: exact | none | ambiguous, applicationExposure, gatewayPayability, exposureEvidence[], payabilityEvidence[], firstSeenAt}` + events.
- **T:** `create()` if absent; same link → no write; a different link → L7.
- **W:** in 1A **every** order is unlinked when its first payment arrives (transaction P is Phase 3), so every payment goes through R11 / L4 first. Correlated via `notes.intentId` → intent → link; uncorrelated → `correlation: none`, payment `unmatched`, Finance dead-letter. Exposure → `APPLICATION_EXPOSURE_ACKNOWLEDGED` on any recorded payment. `APPLICATION_RESPONSE_NOT_AUTHORISED_PROVEN` can never be produced in 1A (it needs the Phase 3 marker); this is a constraint, not a conflict.
- **R:** deny-all in 1A (X-D).
- **B:** Phase 2 legacy migration must treat 1A `source: webhook` links as already present (same correlation → no write).
- **Q:** B9-4, B9-5, B15-4, B15-5 (webhook parts: conflicting link; `notes.attemptId` vs `notes.intentId` disagreement), B15-3 (seeded "marker absent" order; retained, payment → review).
- **A:** both dimensions present and monotonic in every test; L7 sets the anomaly on every candidate claim.

### C6. Claims (read-compatible) and retention-on-payment

- **E:** none (reservations only).
- **G:** schema, reader, retention writer, anomaly flag.
- **P:** `lib/payments/claims.ts`: `readClaim` (missing = OPEN), derived state, `addRetainedOrder`, `setAnomaly`, append-only claim events. `retainedPossibleOrders[]` exists in the schema and reader only; its writers (`abandon_attempt`, legacy migration) are Phases 4 and 2.
- **D:** `paymentObligationClaims/{cl_…}`: `{canonicalKey, holderAttemptId: null, holderFence: 0, retainedOrders[], retainedPossibleOrders[], anomaly: false | {…}, boundOverrideId: null, version}` + `events/`. Created lazily inside the webhook transaction.
- **T:** claim docs are in the transaction's read set; CAS on `version`.
- **W:** APPLY → `paid_applied`; REJECT_DUPLICATE → `paid_rejected` on every bound obligation's claim; L7 → anomaly.
- **R:** server-only.
- **B:** **retention has no enforcement effect in 1A**, because the order route does not consult claims until Phase 2. The existing `paymentReservations` remain the only creation guard in 1A (see D6).
- **Q:** derived-state unit tests; emulator tests that retention entries are added and never removed by any 1A path.
- **A:** after each test, claim contents match the expected retention list exactly.

### C7. Allocations and allocation lines

- **E:** none.
- **P:** `lib/payments/allocations.ts`: builder plus checks Σ `allocatedPaise` == net captured and each line == that obligation's payable amount.
- **D:** `gatewayPayments/{id}/allocations/alloc_<paymentId>` (path per N2): `{lines: [{obligationKey, lineHash, allocatedPaise}], basis: webhook_intent | webhook_attempt, decidedBy: "system", targetPlayerId, at}`; `create()` (≤ 1 per payment).
- **T / W:** written only on APPLY in the same transaction.
- **B:** none (new). `lineHash` must be fixed now because Phase 5 `allocationLineLocks/{allocationId}_{lineHash}` depends on it (N4).
- **Q:** unit checks for sum and per-line equality; APPLY tests assert one allocation per payment.
- **A:** I21 holds for every APPLY test.

### C8. Refund-ledger read model (decisions only)

- **E:** none.
- **P:** `lib/payments/refund-ledger.ts`: pure derivation of `captured`, `reservedTotal`, `processedTotal`, `netCaptured`, `line.reserved / processed / net`, `aggregateNetAllocated`, `pendingCount`; constraint checkers C1–C6; summary-field calculator.
- **D:** no refund writer in 1A (refund recording is Phase 5). The webhook writes initial summary fields only.
- **Q:** B12-1 as a **pure / seeded-data** test (bundle of 3, partial refund mapped to line 2 → only line 2's net changes). The `unresolved` mapping suspends C3.
- **A:** constraint checker results for each C1–C6 boundary.

### C9. Synthetic attempts and first-outcome immutability

- **E:** intent statuses `pending` / `paid`; `paymentReservations.isPaid` set by the webhook.
- **G:** first-outcome rules; `paid_unapplied`; CLOSED_UNAPPLIED eligibility.
- **P:** inside `webhook-apply.ts`: a synthetic attempt derived in memory from the intent (and its reservation) for the decision. **Persistence and ID scheme are not specified by the design (N5).** Proposed: not persisted in 1A, `gatewayPayments.attemptId` left unset, `intentId` used for correlation.
- **D:** intent: `paid_unapplied` added; `gatewayEvent` recorded as in R2-C.
- **T / W:** REJECT_DUPLICATE changes the intent `pending` → `paid_unapplied` only when it has no first payment; otherwise events only.
- **R:** `razorpayIntents` stays deny-all (no client reads found; the client never reads intents).
- **B:** see D2 and D6.
- **Q:** T8, T9, T11, T12, B8-3, B8-8; byte-level immutability of a paid intent after later payments.
- **A:** intent and attempt (where seeded) byte-identical except appended events.

### C10. Late-fee obligations, mirror, legacy ambiguity, backfill (dry run)

- **E:** `otherFees/lf_${intentId}_${templateId}` per intent; per-week vs aggregated template IDs (X-A); no duplicate check at order time.
- **G:** entire component.
- **P:** `lib/payments/late-fee-obligations.ts` (`lfo_` creation, mirror `players/{p}/otherFees/{lfo_…}` whose `templateId` keeps the `latefee_${matchId}` substring the UI relies on, pre-backfill ambiguity check → REJECT_DUPLICATE `LEGACY_LATE_FEE_AMBIGUOUS`); `scripts/late-fee-backfill.mjs` (dry-run only; refuses any write mode; emulator-tested). Remove the `lf_${intentId}` writers. Possibly small order-route changes to put server-derived late-fee identities on the intent (D3).
- **D:** `lateFeeObligations/{lfo_…}` per rev 3 §3.3.
- **T:** `lfo` created idempotently (`create()` or read-then-set) inside the webhook transaction; legacy candidate query bounded per player and match.
- **R:** server-only; the mirror is written by the Admin SDK (Finance can still edit `otherFees` from the client until 1B; D5).
- **B:** legacy `lf_` documents untouched; the backfill links them later (production run needs owner approval of a dry-run report).
- **Q:** T7 (pre- and post-backfill), idempotent backfill on seeded emulator data, unresolvable legacy records reported.
- **A:** one Paid late fee per obligation; ambiguity → review; dry-run report from synthetic data.

### 3.1 Dependencies

```
C1 ──► C3 ──► C4
C1 ──► C6, C7, C10 ──► C4
C2, C5, C8, C9 ──► C4
D1, D2, D4, D5 must be settled before C3
D3, D4 before C10
D6, D7 before C4
```

---

## 4. File-level change inventory (proposed; nothing created yet)

| File | Change | Component |
|---|---|---|
| `lib/payments/canonical-keys.ts` | new | C1 |
| `lib/payments/obligations.ts` | new | C1 |
| `lib/payments/decide-payment-application.ts` | new (pure) | C3 |
| `lib/payments/gateway-payments.ts` | new | C2 |
| `lib/payments/gateway-orders.ts` | new | C5 |
| `lib/payments/claims.ts` | new | C6 |
| `lib/payments/allocations.ts` | new | C7 |
| `lib/payments/refund-ledger.ts` | new (pure) | C8 |
| `lib/payments/late-fee-obligations.ts` | new | C10 |
| `lib/payments/webhook-apply.ts` | new (transaction orchestration) | C4, C9 |
| `lib/razorpay-webhook.ts` | modify: delegate processing; remove `lf_${intentId}` writers; keep extract / validate / classify | C4, C10 |
| `app/api/razorpay/webhook/route.ts` | modify: outcome mapping; dead-letter in the transaction | C4 |
| `lib/webhook-dead-letter.ts` | modify: transaction-participating writer; new classifications; R5 resolution endpoint unchanged | C4 |
| `lib/razorpay-order.ts`, `app/api/razorpay/order/route.ts` | **conditional** (D3, D6, D7): server-derived late-fee identities on the intent; reservation handling after REJECT_DUPLICATE; bundle limit | C10 |
| `scripts/late-fee-backfill.mjs` | new, dry-run only | C10 |
| `firestore.rules` | **no change proposed for 1A** (new collections are covered by the catch-all deny). Optional field guards only if D5 decides so; deploy stays separately gated (only via `main`, both databases) | – |
| `tests/r4-1a-*.test.mjs`, `tests/r4-1a-*.emulator.test.mjs` | new | all |
| `tests/r3-webhook-route.emulator.test.mjs`, `tests/r5-webhook-dead-letter.emulator.test.mjs`, `tests/emulator-webhook-concurrency.test.mjs`, `tests/razorpay-webhook-concurrency.test.mjs`, `tests/razorpay-webhook-negative.test.mjs`, `tests/remediation1f-…emulator.test.mjs`, `tests/server-security-phase5.test.mjs` | expectation updates where behaviour changes (`lf_` → `lfo_`; conflicting payment → `rejected_duplicate`); each change listed in the evidence pack | C4, C10 |
| `firestore.indexes.json` | none needed for 1A (the transaction query is a single-field equality on a subcollection) | – |

No UI file changes in 1A.

---

## 5. Data model and transaction design

### 5.1 New and changed records (1A writers only)

| Record | 1A writer | Key | Uniqueness |
|---|---|---|---|
| `gatewayPayments/{paymentId}` (+ `events`, `anomalies`, `allocations`) | webhook | Razorpay payment ID | `create()` |
| `gatewayOrders/{orderId}` (+ `events`) | webhook (R11 / L4) | Razorpay order ID | `create()`; a different link → L7 |
| `paymentObligationClaims/{cl_…}` (+ `events`) | webhook (retention, anomaly) | hash of canonical key | deterministic ID; CAS on `version` |
| `lateFeeObligations/{lfo_…}` (+ `settlementEvents`) | webhook | hash of canonical key | deterministic ID |
| `players/{p}/otherFees/{lfo_…}` (mirror) | webhook | same as `lfo_` | deterministic ID |
| Obligation `settlement`, `settlementVersion`, `settlementEvents/` | webhook APPLY | – | CAS on `settlementVersion` |
| `razorpayIntents/{id}.status = paid_unapplied` | webhook REJECT_DUPLICATE | – | first outcome only |
| `webhookDeadLetters/{key}` | webhook, **inside the transaction** | `pay_<paymentId>` (existing) / `anom_<paymentId>_<hash>` | deterministic |

### 5.2 Webhook transaction (one Firestore transaction)

1. Reads (all before writes): intent → payment record → anomaly doc for this event identity → `gatewayOrders/{orderId}` → merge-chain player docs → obligations (≤ 20) → claims → `lfo_` docs + bounded legacy late-fee query → dead-letter doc.
2. Pure decision (C3), including R11 link-or-classify.
3. Writes per the decision's write set; footprint asserted before the first write.
4. Commit → HTTP 200. Contention / outage → SDK retry → on exhaustion 503 with no partial effect. `ALREADY_EXISTS` on `create()` → re-run once → REPLAY / IDENTITY_CONFLICT.

**Concurrency cases covered by design:** duplicate deliveries of one payment (serialised on the payment doc → REPLAY); `payment.captured` + `order.paid` for one payment (REPLAY); two payments for one obligation via two intents (serialised on the obligation and claim docs → one APPLY, one REJECT_DUPLICATE); client manual settlement vs webhook (Admin SDK locks the obligation doc; the loser sees the other's state).

**Not covered in 1A by design:** online-vs-online prevention at order creation (Phase 2 claims); manual-vs-online where the manual path is client-side (Phase 1B).

---

## 6. Test strategy and acceptance criteria

### 6.1 Layers (all against production modules, no reimplemented logic)

| Layer | Content | Runner |
|---|---|---|
| Unit (pure) | canonical keys, legacy mapping, decision table (exhaustive), allocation and refund-ledger arithmetic, footprint calculator | `node --test` (functional suite) |
| Emulator transaction | webhook transaction write sets, claims, `gatewayOrders`, late-fee obligations, backfill dry run | `npm run test:emulator` (Firestore + Auth emulators) |
| Route integration | real `POST /api/razorpay/webhook` with real HMAC (as R3), injected Firestore failures, lost acknowledgements | emulator |
| Concurrency | both orderings via a test-only barrier between reads and writes; N seeded repetitions; 2–6 parallel deliveries | emulator |
| Rules | client read and write denied on every new collection and subcollection, for every role (no deploy) | emulator, `@firebase/rules-unit-testing` |
| Regression | full functional suite (1035 at R5) and emulator suite (403 at R5); `tsc`; `next build` | existing |

The test-only barrier must be dependency-injected and impossible to enable in production code paths.

### 6.2 Design test IDs mapped to Phase 1A

T1 (1A form), T3, T4, T5, T7, T8, T9, T10, T11, T12, T13, T21, T23 (subject to D7), B6-4 (decision part), B8-1, B8-2, B8-3, B8-4, B8-7, B8-8, B9-4, B9-5, B11 (decision parts), B12-1 (pure / seeded), B15-3, B15-4, B15-5 (webhook parts). Proposed additions for the clarifications: legacy redelivery at cutover (D2), settlement-field precedence (D5), reservation state after REJECT_DUPLICATE (D6), `ALREADY_EXISTS` handling, footprint overflow mapping (D7).

### 6.3 Acceptance criteria for independent review

1. Every test listed in §6.2 implemented and passing; counts reported as executed / passed / failed / skipped / blocked per layer, with the reason for every skip.
2. G-A demonstrated at the webhook: for every pair of payments on one obligation (both orderings, N repetitions), exactly one APPLY.
3. No partial commit under every injected failure point; REPLAY with zero writes after a lost acknowledgement.
4. Original records byte-identical after REPLAY, IDENTITY_CONFLICT and REJECT_DUPLICATE paths.
5. Decision-table coverage report: each R1–R11 rule hit by positive and negative cases.
6. Footprint assertion output for a 20-obligation bundle.
7. No client access to any new collection (rules emulator), and no rules change or deployment.
8. Backfill dry-run report from synthetic emulator data only; the script has no write mode.
9. Diff limited to the files in §4; each changed existing test listed with the reason.
10. `tsc` and `next build` clean; all disabled capabilities (§0.C) untouched.

---

## 7. Risks, dependencies and unresolved decisions

### 7.1 Decisions that block implementation (owner and / or reviewer)

| # | Question | Why it blocks | Options (no choice made) |
|---|---|---|---|
| **D1** | **R8 holder clause in Phase 1A.** Rev 4 R8 rejects when "the claim holder ≠ this attempt; or the attempt is not the holder". In 1A no claim has a holder and every attempt is synthetic, so a literal reading rejects **every** payment | Determines whether 1A applies any payment at all | (a) In 1A, the holder clause applies only when a holder is set; (b) another reading the reviewer specifies |
| **D2** | **Cutover replay.** A payment applied before 1A deployment has no `gatewayPayments` record. A Razorpay redelivery of it (up to 24 h) would reach R8 ("obligation not `unpaid`", settled by itself) and be recorded as `rejected_duplicate` and sent to refund review | Wrong financial classification of legitimate payments | (a) Intent `paid` with the same payment ID and no record → REPLAY (optionally create the record as `applied`); (b) other |
| **D3** | **Late-fee obligation identity and creation point.** Per-week or per-match `lfo_`? Created at order time (requires order-route changes) or at APPLY? Server-derived template IDs (the dues path currently uses a client-supplied one) | Deterministic IDs cannot be changed after the first write; the owner's brief did not list late fees | Per-match key `latefee\|{playerId}\|{matchId}` with an amount snapshot; or per-week keys; creation point |
| **D4** | **"Current payable" before the Phase 1B amount model.** What R9 compares against in 1A, especially for time-varying late fees | Legitimate payments rejected across a weekly rollover, or the check weakened | Late fee: amount fixed at levy (with D3); match / other fees: legacy fields at decision time |
| **D5** | **Source-of-truth precedence** between the new `settlement` field and the legacy `status` while manual settlement is still client-side (Finance can edit both today, I7 defers lockdown to 1B) | A forged or stale field could cause double application if the wrong one wins | Fail closed: the obligation is `unpaid` only if **both** say unpaid; optionally add server-only field guards to the rules now (rules change, separately approved) |
| **D6** | **Legacy reservation after REJECT_DUPLICATE / `unmatched`.** The webhook currently sets `paymentReservations.isPaid` only on fulfilment. After a rejected payment, the reservation could keep returning the same (already paid) order to the payer until Phase 2 | Possible repeat payments on a paid order (G3 unverified) | Mark the reservation blocked (new status); or leave it unchanged (risk accepted) |
| **D7** | **Persistent fail-closed conditions and bundles over 20.** Today there is no bundle limit; T23 needs the Phase 2 claim. Which HTTP status for a footprint overflow or canonical collision: 503 (24 h retries, possible webhook disable) or 200 + high-severity dead-letter + `unmatched` / review? Does 1A add the 400 bundle limit to the order route? (Q16 open) | Webhook availability and test placement | 200 + record + review, plus a 400 limit in the order route; or defer T23 to Phase 2 |
| **D8** | **Subscription and merchandise intents in 1A.** Their obligations (`subscriptionPeriods`, server-minted merch orders) are Phase 2. What does the 1A decision do for them? | Scope of R1–R11 in 1A | `gatewayPayments` identity, replay and conflict handling for all intents, with obligation-level rules for match fees, other fees and late fees only |

### 7.2 Clarifications that do not block (proposed reading stated)

| # | Topic | Proposed reading |
|---|---|---|
| N1 | Incorporation by reference (rev 3 / rev 4 tables) | Authoritative unless revision 7 overrides |
| N2 | Allocation path and fields (X-C) | Latest revision: subcollection, `lines[]`, `webhook_*` basis |
| N3 | `gatewayOrders` read access (X-D) | Deny-all in 1A |
| N4 | `lineHash` | base64url(SHA-256(obligationKey)) |
| N5 | Synthetic attempts | In memory, not persisted; `attemptId` unset on 1A records |
| N6 | B11, B12-1, B15-3 in 1A | Decision-level and seeded-data tests only |
| N7 | `subscriptionPeriods` name collision (X-E) | Resolve before Phase 2 |
| N8 | Canonical keys after a player merge (X-F) | Resolve before Phase 2; 1A records keep the key at decision time |
| N9 | Backfill dry run against production data | Even read-only, needs separate owner approval; 1A uses emulator data only |

### 7.3 Risk register

| Risk | Severity | Mitigation in plan |
|---|---|---|
| Duplicate payment application via two intents (exists today) | P0 (current) | Closed by C3 / C4 at the webhook |
| Duplicate gateway orders (receipt not unique, F1) | P1 | **Not closed by 1A.** Retention is recorded but enforced only from Phase 2; creation is still guarded only by reservations, including the expired-`reserving` takeover (removed in Phase 3) |
| Delayed / ambiguous / late gateway responses | P1 | Out of 1A (Phases 3–4). 1A records orders when payments arrive (L4) |
| Webhook retries and out-of-order delivery | P1 | Payment-ID idempotency; L7 anomaly; REPLAY with zero writes |
| Persistent 503 disabling the webhook | P1 | D7 |
| Cutover misclassification | P1 | D2 |
| Firestore contention on large bundles; 5 s webhook deadline | P2 | ≤ 20 obligations; footprint assertion; per-player contention only |
| `create()` conflict semantics (`ALREADY_EXISTS`) and emulator vs production locking | P2 | Explicit handling and test; documented limitation |
| Late-fee identity mistakes (irreversible IDs) | P1 | D3 before any write |
| Client Finance edits to settlement fields before 1B | P1 | D5 |
| Refund identity and allocation consistency | P2 | Only read model in 1A; `lineHash` fixed now (N4) |
| Legacy data (paid `lf_` records, old intents, reservations) | P2 | Read mapping; no migration in 1A; dry-run backfill only |
| Changes to existing R3 / R5 test expectations misread as weakening | P2 | Each change listed with before / after behaviour |
| Phase 1A is non-flaggable once deployed (rev 3 §8) | – | Rollback is code revert only; records stay |

### 7.4 Pre-existing defects found during inspection (outside Phase 1A; source inspection only, not reproduced)

| # | Finding | Location | Suggested handling |
|---|---|---|---|
| PX-1 | **Merchandise order ID is client-supplied and overwritten by the webhook.** `derivePayableAmount` copies the client's `orderPayload` (including `id`) into the intent; the webhook does `transaction.set(merchOrders/{orderPayload.id}, …)`, which overwrites any existing document with that ID, including another player's order | `lib/razorpay-order.ts:1568–1597`, `lib/razorpay-webhook.ts:569–584` | Owner decision: separate P1 fix, or wait for Phase 2 server-minted IDs |
| PX-2 | Client-supplied `lateFeeTemplateId` used in a document ID | `lib/razorpay-order.ts:1491`, `lib/razorpay-webhook.ts:410` | Covered by D3 |
| PX-3 | No duplicate check for late fees at order time (two intents can each include the same late fee) | `lib/razorpay-order.ts:1342–1362, 1472–1496` | Closed at the webhook by C10 / C3 |
| PX-4 | Finance client can change `otherFees` status freely (no finance guards like match payments have) | `firestore.rules:604–607` | Phase 1B (server-controlled settlement); D5 |

### 7.5 Technical recommendations vs decisions requiring owner approval

**Owner design preferences recorded (2026-11-24).** These are **preferences, not implementation authorisation**, and they do not by themselves close D1–D8:

| Preference | Affects | Effect on this plan | What remains open |
|---|---|---|---|
| **Existing payments:** protect historical paid records and recognise legitimate webhook retries without falsely classifying them as duplicates | D2 | Points to D2 option (a): an intent already `paid` with the same payment ID and no `gatewayPayments` record → REPLAY, never `rejected_duplicate`; historical paid obligations are never rewritten | Reviewer to confirm the exact rule, and whether the replay also creates a `gatewayPayments` record (`applied`) |
| **Payment categories:** all categories (match fees, late fees, subscriptions, merchandise) | D8 | Phase 1A protection should cover all four categories, not only match / other / late fees | **Tension with the design:** the subscription-period and server-minted merchandise obligations are Phase 2 (rev 3 §3.4, §11), and `subscriptionPeriods` already names another collection (N7). Covering them in 1A means either pulling part of Phase 2 forward (design change; reviewer + owner) or a 1A interim rule for those two categories (e.g. identity, replay, conflict and per-intent duplicate handling, with full obligation rules in Phase 2). PX-1 (merch order overwrite) is relevant here |
| **Late-fee identity:** per player, per match, per overdue week, with stable server-controlled identity | D3, D4, PX-2 | Canonical key per week, e.g. `latefee\|{playerId}\|{matchId}\|{week}` with the week index computed by the server (never from the client). Each weekly obligation has a fixed amount (₹150 for week 0, ₹50 per later week in today's `computeLateFees`), which also addresses D4 for late fees | (1) The dues path currently aggregates all weeks into one item with a client-supplied template ID; it must be split per week. (2) Mirror documents must keep `latefee_{matchId}` in `templateId`, which the UI relies on. (3) Mapping of legacy `lf_` and manual `latefee_{matchId}` records (one record covering several weeks) to per-week obligations in the backfill, and the pre-backfill ambiguity rule. (4) When each weekly obligation is created (order time vs payment) |

**Who decides what:**

| Item | Technical recommendation (implementation agent; not binding) | Decision required from |
|---|---|---|
| D1 R8 holder clause | Apply the holder clause only when a holder is set (1A has no holders) | Reviewer (design interpretation) + owner |
| D2 cutover replay | Option (a), consistent with the owner preference | Reviewer confirms rule; owner preference recorded |
| D3 late-fee identity | Per-week server-derived keys, per owner preference; resolve points (1)–(4) above | Owner (identity is irreversible) + reviewer |
| D4 current payable | Late fee: fixed per-week amount; match / other fees: legacy fields read inside the decision transaction | Reviewer + owner |
| D5 field precedence | Fail closed: unpaid only if both the new and legacy fields say unpaid. Rule hardening only with separate approval | Owner (any rules change) + reviewer |
| D6 legacy reservation | Block the reservation after a rejected payment | Owner (payer-visible behaviour) |
| D7 persistent failures / bundles | 200 + high-severity record + review rather than 503; add a 400 limit of 20 in the order route (Q16) | Owner (Q16) + reviewer |
| D8 subscription / merch | Follow the owner preference (all categories) via an interim 1A rule or by pulling Phase 2 items forward | Owner + reviewer (scope change) |
| N1–N9 | Readings stated in §7.2 | Reviewer confirmation |
| PX-1 … PX-4 | Report only; PX-1 merits a separate P1 decision | Owner |

Nothing in this section enables a capability, changes the architecture document, or authorises implementation.

---

## 8. Recommended implementation sequence (after authorisation)

Each step: tests first, one commit on `mig-mov`, full regression before the next step.

1. **C1** canonical keys + obligation read model (pure + emulator reads).
2. **C7, C8** allocation builder and refund-ledger read model (pure).
3. **C3** decision function (pure, exhaustive table tests). Requires D1, D2, D4, D5, D8.
4. **C2, C5, C6** registries and claim helpers (transaction writers, emulator tests).
5. **C10** late-fee obligations + mirror + ambiguity check. Requires D3, D4.
6. **C9** synthetic attempts, `paid_unapplied`, first-outcome rules.
7. **C4** webhook transaction orchestration, dead-letter inside the transaction, route mapping, removal of `lf_${intentId}` writers. Requires D6, D7.
8. Concurrency suite (both orderings, N repetitions) and updates to existing tests.
9. Backfill dry-run script (emulator data only).
10. Evidence pack for the reviewer (§6.3).

No rules deployment, no production data access, no Razorpay call and no change to any disabled capability at any step.

---

## 9. Confirmation that no files were modified

- No file in the repository was created, modified or deleted. `git status --porcelain` is empty; HEAD = `origin/mig-mov` = `64de4f8`.
- No commit, push, branch or merge. `main` was not touched.
- No test, rule, configuration, data, migration or backfill was run or written. No Razorpay API was called. Nothing was deployed. No capability was enabled.
- Earlier revisions of the design were read with `git show` into the session scratchpad (outside the repository).
- **Publication (2026-11-24):** at the owner's request, this report was added as the single file `docs/implementation/R4_PHASE_1A_READINESS_REPORT.md` on `mig-mov`, with §7.5 added to record the owner's design preferences and to separate recommendations from decisions. No other file was changed. Publication is not approval to implement.

---

## Recommendation

**BLOCKED — DESIGN CLARIFICATION REQUIRED.**

Decisions D1–D8 (§7.1) must be answered by the reviewer and / or owner before Phase 1A can be implemented without either weakening a safeguard or silently redesigning it. D1, D2 and D3 are the most consequential: D1 decides whether any payment can be applied in 1A, D2 prevents misclassification of legitimate payments at cutover, and D3 fixes identifiers that cannot be changed later. The owner's preferences (§7.5) give direction on D2, D3 and D8 but leave the specific points listed there open. Once they are resolved, the plan in §3–§8 is ready for owner authorisation without further inspection.
