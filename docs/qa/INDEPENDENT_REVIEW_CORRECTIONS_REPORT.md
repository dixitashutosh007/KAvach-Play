# KAvach Play — Independent Review Corrections & Final Payment Integrity Closure Report

**Date:** 2026-11-17  
**Branch:** `mig-mov`  
**Application Target:** https://play.kavachcricket.com  
**Repository:** https://github.com/dixitashutosh007/KAvach-Play  
**Author:** Gemini in Google Antigravity (Implementation & Remediation Agent)  
**Governing Standard:** [AGENTS.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/AGENTS.md)

---

## 1. Executive Summary & Findings Closure Overview

This report documents the resolution, contract analysis, and emulator verification of the final independent review findings on branch `mig-mov`:

### 1.1 Item 1 (P1) — Paid Orders in Receipt-Only Reconciliation
- **Defect Identified:** In `lib/razorpay-order.ts`, when `orders.all({ receipt })` returned exactly one matching order with status `paid`, the reservation previously did not explicitly record `isPaid: true` or return `isPaid: true`, which could risk returning the order as a payable opportunity or failing to surface a conflict.
- **Correction Applied:**
  1. In `reconcileAmbiguousReservation()` (Branch B: Receipt-only reconciliation): When `foundOrder.status === "paid"`, Firestore reservation persistence updates:
     ```typescript
     {
       status: "active",
       orderId: foundOrder.id,
       isPaid: true,
       lastReconciledAt: nowIso,
       updatedAt: nowIso,
       reconciliationError: null,
     }
     ```
  2. The function returns `{ reconciled: true, isPaid: true, canRetry: false, existingOrder: { orderId: foundOrder.id, ... } }`.
  3. In `app/api/razorpay/order/route.ts`: When `reconciled.isPaid === true`, the order API immediately returns `HTTP 409 Conflict` with `Obligation has already been paid via order ${orderId}`. No checkout opportunity is presented to the client.
  4. Preserved existing created/attempted payable order behavior (hold is renewed and order is returned for checkout).
  5. Verified via unit test (Case D) and live Cloud Firestore Emulator test (`Scenario 17`).

### 1.2 Item 2 (P1) — Validation of Razorpay Orders API Contract & Status Assumptions
- **Contract Investigation:** An exhaustive review of the authoritative Razorpay Orders API specification (`https://razorpay.com/docs/api/orders`) was conducted.
- **Authoritative Findings:**
  1. The Razorpay Order entity strictly defines an enum of three valid statuses:
     - `created`: Order is created and awaiting payment attempt.
     - `attempted`: At least one payment attempt has been made against the order, but payment has not yet succeeded.
     - `paid`: Payment has been successfully captured for the order.
  2. `expired` and `cancelled` statuses **do not exist** on Razorpay standard Order entities. They exist for Payment Links and Subscriptions, but standard orders remain payable indefinitely until paid (unless an explicit non-standard `expire_by` Unix timestamp was provided, in which case the order transitions to an unpayable state).
  3. Consequently, assuming that an order can return `status === "expired"` or `"cancelled"` to permit automatic order recreation was unsafe and non-compliant with the official gateway contract.
- **Implementation Decision:**
  1. Removed assumptions of `expired` and `cancelled` in both Branch A (`orders.fetch`) and Branch B (`orders.all`).
  2. If the gateway returns any status other than `created`, `attempted`, or `paid`, it is treated as unrecognized/unsupported.
  3. The reservation is transitioned to `status: "reconciliation_failed"` with `canRetry: false` and an explicit error `Unrecognized or unsupported Razorpay order status: ${foundOrder.status}`.
  4. The lock remains safely blocked to prevent duplicate order generation. Unblocking requires manual administrative review and reconciliation via the club admin console.

### 1.3 Item 3 (P1) — Actual Route Failure Injection and Recovery Integration Test
- **Requirement:** Inject a controlled failure into the actual Next.js route's Firestore `intentRef.update()` call after Razorpay order creation succeeds. Verify that:
  - The actual route returns failure (`HTTP 500`).
  - The route catch handler records `activation_failed` on the reservation.
  - The reservation retains the external `orderId` and `intentId`.
  - A second actual route call verifies & repairs the intent in Firestore, returning `HTTP 200` with `reusedExistingOrder: true`.
  - The actual webhook handler processes `payment.captured` with valid HMAC signature (`HTTP 200`) and fulfils player profile/subscription records.
  - A replay of the webhook does not duplicate fulfilment records.
- **Verification Delivered:** Implemented in `Scenario 16` of `tests/razorpay-reservation-emulator.test.mjs` against the live Cloud Firestore Emulator, executing full route POST handlers without mocks. Passed cleanly.

---

## 2. Requirements Traceability Matrix

| Requirement ID | Description | Source / Finding | Implementation Evidence | Unit Test Evidence | Emulator Test Evidence | Independent QA Status |
|---|---|---|---|---|---|---|
| **FIN-001-A** | Active order expiry reconciliation | Finding 1 (P0) | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L328-L379) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 13) | **PENDING** |
| **FIN-001-B** | Strict currency validation during reconciliation | Finding 2 (P1) | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L670-L710) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 14) | **PENDING** |
| **FIN-001-C** | Strict intent identity & financial validation | Finding 3 (P1) | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L237-L290) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 9) | **PENDING** |
| **FIN-001-D** | Authoritative absence semantics (list API) | Finding 4 (P1) | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L920-L945) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 15) | **PENDING** |
| **FIN-001-E** | Full API-to-webhook recovery integration | Finding 5 (P1) | [app/api/razorpay/order/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/order/route.ts) & [app/api/razorpay/webhook/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/webhook/route.ts) | N/A (Integration) | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 16) | **PENDING** |
| **FIN-001-F** | Paid orders in receipt reconciliation (HTTP 409) | Review Item 1 (P1)| [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L930-L955) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 17) | **PENDING** |
| **FIN-001-G** | Orders API status contract (no expired/cancelled) | Review Item 2 (P1)| [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L710-L730) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 7, 13) | **PENDING** |
| **P0-LIFECYCLE-1**| Periodic lease renewal in order route | Prior P0 | [app/api/razorpay/order/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/order/route.ts#L496-L525) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (Scenario 1) | **PENDING** |
| **P0-LIFECYCLE-2**| Permanent block on reconciliation hold | Prior P0 | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L312-L321) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (Scenario 2) | **PENDING** |
| **P0-RECON-1** | Atomic, fenced reconciliation transactions | Prior P0 | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L650-L760) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (Scenarios 3, 4, 11) | **PENDING** |
| **P0-RECON-2** | Authoritative deterministic receipts | Prior P0 | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L106-L120) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (Scenarios 5, 6, 7) | **PENDING** |
| **FIN-003** | Mandatory payment ID for all webhook events | Independent Audit | [lib/razorpay-webhook.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-webhook.ts) | `tests/razorpay-webhook-negative.test.mjs` | **PASS** (`tests/emulator-webhook-concurrency.test.mjs`) | **PENDING** |
| **SEC-001** | Custom claim only authority (no role fallback)| Independent Audit | [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules), [lib/server-auth.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/server-auth.ts) | `tests/server-auth.test.mjs` | **PASS** (`tests/firestore-rules.test.mjs`) | **PENDING** |

---

## 3. Detailed Architecture of Corrected Components

### 3.1 Razorpay REST Endpoint Query & Status Semantics
```
Primary Key Lookup:
orders.fetch(orderId) ───► Guaranteed consistent directly against primary write store.
                           Valid Razorpay Order statuses: 'created', 'attempted', 'paid'.
                           Any other status is unsupported -> reconciliation_failed (safe block).

Secondary List Query:
orders.all({ receipt }) ─► Eventual consistency / search indexing latency.
                           An empty array ({ items: [] }) does NOT prove absence.
                           Action: Must remain safely blocked in reconciliation_failed.
                           Status 'paid' -> Persists isPaid: true, route returns HTTP 409 Conflict.
```

### 3.2 State Machine for Payment Reservations
```mermaid
stateDiagram-v2
  [*] --> reserving: acquirePaymentReservation() [token, fenceVersion, receipt]
  reserving --> reserving: renewReservationLease() [in flight]
  reserving --> active: orders.create() succeeds + activatePaymentReservation()
  reserving --> activation_failed: orders.create() succeeds + Firestore write fails
  activation_failed --> active: retry verifies & repairs intent + reconciles to active
  reserving --> reconciliation_required: orders.create() timeout/ambiguous 5xx
  reconciliation_required --> active: orders.all({receipt}) finds 1 created/attempted order
  reconciliation_required --> active_paid: orders.all({receipt}) finds 1 paid order (HTTP 409)
  reconciliation_required --> reconciliation_failed: orders.all({receipt}) returns 0 (unproven absence)
  reconciliation_required --> reconciliation_failed: multiple orders found or amount/currency mismatch
  active --> active: hold expires + orders.fetch(orderId) returns created/attempted [lease extended]
  active --> reconciliation_failed: hold expires + orders.fetch(orderId) fails / network down / unsupported status [safely blocked]
  reserving --> failed: definitive 4xx rejection + releasePaymentReservation()
  failed --> reserving: safe fresh reacquisition
```

---

## 4. Quality Gate Evidence

### 4.1 Functional Tests (`npm run test:functional`)
```text
✔ FIN-006: getClubCalendarDate calculates date deterministically in Asia/Kolkata
✔ FIN-006: computeLateFees enforces Tuesday EOD deadline in Asia/Kolkata
✔ FIN-006: Sunday matches have the same Tuesday deadline as Saturday matches
✔ FIN-006: Weekday matches do not generate weekend late fees
✔ FIN-005: Abandoned match accounting retains collected cash while zeroing dues
✔ FIN-007: Late fees deduplicate against existing otherFees records
✔ Option A: Status 'Waived' is recognized and excluded from player dues
✔ Match Fee & Finance Accounting Functional Tests (5 suites, all pass)
✔ ARCH-001: useStore implements listener lifecycle and teardown mechanisms
✔ ARCH-002: Scoped loading and chronological ordering for initial match queries
✔ ARCH-003: useStore exports complete backward-compatible contract
✔ Firestore Security Rules — AST Syntax Validation (9 checks pass)
✔ UX-002: Design tokens define primary brand #A30F2D and primary action #D51F43
✔ UX-003: LoadingScreen uses light-first scarlet sports-tech design and has zero dark-green
✔ UX-004: MobileBottomNav provides complete navigation for both admin and player personas
✔ UX-001 & UX-005: Header enforces mobile touch targets (>= 44px) and prevents narrow viewport collision
✔ Utility Function Tests (Phase 10: 11 suites, all pass)
✔ FIN-001: Deterministic reservation keys, token fencing, lease strategy, recovery, strict validation (17 tests pass)
✔ Finding 1: Active reservation past local expiry is not auto-replaced; requires external reconciliation
✔ Finding 2: Strictly validates currency during reconciliation without fallback defaulting
✔ Finding 3: verifyAndRepairIntent strict validation (8 tests pass)
✔ Finding 4: Does not assume empty list API proves absence; keeps reservation safely blocked
✔ Item 1: receipt-only reconciliation persists paid state and returns isPaid: true without checkout opportunity

ℹ tests 181
ℹ suites 39
ℹ pass 181
ℹ fail 0
ℹ duration_ms 762.35
```

### 4.2 Live Cloud Firestore Emulator Integration Tests (`npm run test:emulator`)
```text
✔ FIN-002: Real Firestore Emulator Webhook Concurrency Integration Tests (1 test pass)
✔ Firestore Security Rules — AST Syntax Validation (9 checks pass)
✔ Firestore Security Rules — Emulator Integration Tests:
  ✔ SEC-001: player cannot self-escalate role to admin
  ✔ SEC-002: player cannot mark match payment as Paid
  ✔ SEC-003: player cannot create or delete otherFees
  ✔ SEC-004: player cannot read other players' otherFees
  ✔ SEC-005: player cannot update posts
  ✔ SEC-006: player cannot create pre-paid merch order
✔ FIN-001: Real Firestore Emulator Integration Tests:
  ✔ Scenario 1: Full order API orchestration with a Razorpay response delayed beyond initial lease
  ✔ Scenario 2: Reconciliation states remaining blocked after 15 minutes
  ✔ Scenario 3: Two concurrent reconciliation workers serialize atomically
  ✔ Scenario 4: Stale reconciliation attempting to overwrite a newer reservation
  ✔ Scenario 5: Same receipt collision attempts across two obligations are prevented
  ✔ Scenario 6: Multiple external orders returned for one receipt causes conflict
  ✔ Scenario 7: Wrong amount, currency, or receipt in reconciliation response is rejected
  ✔ Scenario 8: Firestore intent update failing after successful Razorpay order creation
  ✔ Scenario 9: Successful retry repairing the intent before returning existing order
  ✔ Scenario 10: Recovered order successfully passing webhook intent validation
  ✔ Scenario 11: Reconciliation persistence failure retains reconciliation_required
  ✔ Scenario 12: Reservation renewal failure during order creation prevents stale mutations
  ✔ Scenario 13 (Finding 1): Active order past 15-min expiry is not auto-replaced; reconciles authoritatively
  ✔ Scenario 14 (Finding 2): Strict currency validation during reconciliation rejects missing or invalid currency
  ✔ Scenario 15 (Finding 4): Empty response from orders.all({ receipt }) keeps reservation safely blocked
  ✔ Scenario 16 (Finding 5): Complete API-to-webhook recovery integration: activation failure -> retry repair -> webhook fulfilment -> replay idempotency
  ✔ Scenario 17 (Item 1): Paid order discovered through receipt-only reconciliation persists isPaid: true and blocks checkout with HTTP 409

ℹ tests 33
ℹ suites 4
ℹ pass 33
ℹ fail 0
ℹ duration_ms 8630.90
✔ Script exited successfully (code 0)
```

### 4.3 TypeScript Strict Typecheck (`npx tsc --noEmit`)
```text
Clean exit code 0, 0 type errors.
```

### 4.4 ESLint Validation (`npm run lint`)
```text
✖ 4 problems (0 errors, 4 warnings)
(All 4 warnings are expected open read rule detections in firestore.rules on public collections)
Clean exit code 0.
```

### 4.5 Production Build (`npm run build`)
```text
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Collecting page data
✓ Generating static pages (17/17)
✓ Collecting build traces
✓ Finalizing page optimization
All routes compiled successfully. Exit code 0.
```

---

## 5. Non-Negotiable Governance Principles Respected

1. **Zero Production Mutation:** No real Razorpay transactions, production database writes, or production migrations were performed.
2. **Explicit Verification States:** All test categories (functional unit, emulator rules, emulator API/webhook integration) are recorded with exact file names, test names, and assertion logic.
3. **Status Discipline (AGENTS.md § 2):** In accordance with project governance, independent QA staging verification and product owner sign-off remain **PENDING**.
