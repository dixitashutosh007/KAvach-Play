# KAvach Play — Independent Review Corrections & Final Payment Integrity Closure Report

**Date:** 2026-11-17  
**Branch:** `mig-mov`  
**Application Target:** https://play.kavachcricket.com  
**Repository:** https://github.com/dixitashutosh007/KAvach-Play  
**Author:** Gemini in Google Antigravity (Implementation & Remediation Agent)  
**Governing Standard:** [AGENTS.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/AGENTS.md)

---

## 1. Executive Summary & Findings Closure Overview

This report documents the resolution and emulator verification of the final independent review findings on branch `mig-mov`:

### 1.1 Finding 1 (P0) — Active Reservation Expiry Cannot Create Duplicate Orders
- **Defect Identified:** Previously in `acquirePaymentReservation()`, an active reservation with an existing `orderId` was only reused while its local hold `expiresAt` was in the future. Once the local hold (15 minutes) passed, the function could acquire a new reservation and create a duplicate Razorpay order for the same obligation. In Razorpay, orders without `expire_by` do not expire locally and remain payable indefinitely.
- **Correction Applied:** 
  1. An active reservation with an existing order is **never automatically replaced** merely because its local hold time elapsed.
  2. When `expiresAt <= now` on an active reservation with an `orderId`, `acquirePaymentReservation()` returns `{ acquired: false, needsReconciliation: true, existingOrder: { orderId, ... } }`.
  3. `reconcileAmbiguousReservation()` reconciles the authoritative status directly with Razorpay via primary-key fetch: `razorpayInstance.orders.fetch(orderId)`.
  4. If the order is `status === "paid"`, replacement is strictly blocked (`isPaid: true`), returning HTTP 409 Conflict if order creation is re-attempted.
  5. If the order is `status === "created"` or `"attempted"` (payable), the reservation hold is renewed by 15 minutes, retains status `active`, and the existing order is reused.
  6. Only if the order is conclusively `expired` or `cancelled` at Razorpay does the reservation transition to `failed` to permit safe reacquisition (provided the obligation is still unpaid).
  7. If external status cannot be established (network error, timeout, 5xx), the reservation transitions to `reconciliation_failed` and remains safely blocked.

### 1.2 Finding 2 (P1) — Strict Currency Validation during Reconciliation
- **Defect Identified:** In `reconcileAmbiguousReservation()`, fallback defaulting (`foundOrder.currency || "INR"`) previously masked missing currency from gateway responses.
- **Correction Applied:** 
  1. Removed all currency fallback defaulting.
  2. The gateway-returned `foundOrder.currency` is required to exist, be a non-empty string, and match the expected currency (`INR`) exactly.
  3. Missing, empty, or mismatched currency (`USD`, etc.) transitions the reservation to `reconciliation_failed` with an explicit audit error and rejects order reuse.

### 1.3 Finding 3 (P1) — Strict Payment Intent Identity Validation
- **Defect Identified:** In `verifyAndRepairIntent()`, missing identity fields were previously able to pass without validation before repairing `intent.orderId`.
- **Correction Applied:**
  1. `verifyAndRepairIntent()` strictly validates all four core attributes before applying mutations:
     - `intent.userId`: must exist, be a non-empty string, and match `expected.userId` exactly.
     - `intent.reservationKey`: must exist, be a non-empty string, and match `expected.reservationKey` exactly.
     - `intent.amount`: must exist, be a valid number, and match `expected.amount` exactly.
     - `intent.currency`: must exist, be a non-empty string, and match `expected.currency` exactly (no fallback).
  2. Only after all four identity and financial validations succeed is `orderId` repaired atomically with timestamps `repairedAt` and `orderIdRepairedAt`.

### 1.4 Finding 4 (P1) — Authoritative Absence Semantics in List API
- **Defect Identified:** When `orders.all({ receipt })` returned an empty array, the reservation was previously transitioned to `failed`, assuming no order existed. In Razorpay's architecture, `GET /v1/orders?receipt=...` is a secondary index query subject to read-replica lag, search indexing latency, and pagination boundaries. An empty list response after an ambiguous gateway timeout does **not** conclusively prove that an order was never created on the master database.
- **Correction Applied:**
  1. An empty response (`items.length === 0`) from `orders.all({ receipt })` is **not** treated as absence.
  2. The reservation remains safely blocked in `status: "reconciliation_failed"` with `canRetry: false`.
  3. Lock takeover is prevented to eliminate the possibility of duplicate order creation. Conclusive absence can only be established via explicit primary-key 404 or manual administrative verification.

### 1.5 Finding 5 (P1) — Complete API-to-Webhook Recovery Integration Test
- **Evidence Delivered:** Added full end-to-end integration test (`Scenario 16` in `tests/razorpay-reservation-emulator.test.mjs`) exercising both actual Next.js route handlers (`app/api/razorpay/order/route.ts` and `app/api/razorpay/webhook/route.ts`) against the live Cloud Firestore Emulator:
  - Step 1: Client calls `POST /api/razorpay/order` for membership subscription (`subscriptionPlans` with `fee: 750, durationDays: 90`).
  - Step 2: Gateway order creation succeeds (`externalOrderId`).
  - Step 3: Simulated failure updating `intent.orderId` (`activation_failed`).
  - Step 4: Reservation retains `orderId` and `intentId` in Firestore.
  - Step 5: Client retries `POST /api/razorpay/order`.
  - Step 6: `verifyAndRepairIntent` repairs `intent.orderId` in Firestore before returning HTTP 200 with `reusedExistingOrder: true`.
  - Step 7: Webhook delivers `POST /api/razorpay/webhook` with authentic HMAC SHA-256 signature for `payment.captured`.
  - Step 8: Fulfilment transaction creates `subscriptionHistory` record and updates player profile with extended membership.
  - Step 9: Replay of identical webhook returns HTTP 200 with `already_processed: true` without duplicate writes.

---

## 2. Requirements Traceability Matrix

| Requirement ID | Description | Source / Finding | Implementation Evidence | Unit Test Evidence | Emulator Test Evidence | Independent QA Status |
|---|---|---|---|---|---|---|
| **FIN-001-A** | Active order expiry reconciliation | Finding 1 (P0) | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L328-L379) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 13) | **PENDING** |
| **FIN-001-B** | Strict currency validation during reconciliation | Finding 2 (P1) | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L670-L710) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 14) | **PENDING** |
| **FIN-001-C** | Strict intent identity & financial validation | Finding 3 (P1) | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L237-L290) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 9) | **PENDING** |
| **FIN-001-D** | Authoritative absence semantics (list API) | Finding 4 (P1) | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L920-L945) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 15) | **PENDING** |
| **FIN-001-E** | Full API-to-webhook recovery integration | Finding 5 (P1) | [app/api/razorpay/order/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/order/route.ts) & [app/api/razorpay/webhook/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/webhook/route.ts) | N/A (Integration) | **PASS** (`tests/razorpay-reservation-emulator.test.mjs` Scenario 16) | **PENDING** |
| **P0-LIFECYCLE-1**| Periodic lease renewal in order route | Prior P0 | [app/api/razorpay/order/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/order/route.ts#L496-L525) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (Scenario 1) | **PENDING** |
| **P0-LIFECYCLE-2**| Permanent block on reconciliation hold | Prior P0 | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L312-L321) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (Scenario 2) | **PENDING** |
| **P0-RECON-1** | Atomic, fenced reconciliation transactions | Prior P0 | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L650-L760) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (Scenarios 3, 4, 11) | **PENDING** |
| **P0-RECON-2** | Authoritative deterministic receipts | Prior P0 | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts#L106-L120) | `tests/razorpay-concurrent-orders.test.mjs` | **PASS** (Scenarios 5, 6, 7) | **PENDING** |
| **FIN-003** | Mandatory payment ID for all webhook events | Independent Audit | [lib/razorpay-webhook.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-webhook.ts) | `tests/razorpay-webhook-negative.test.mjs` | **PASS** (`tests/emulator-webhook-concurrency.test.mjs`) | **PENDING** |
| **SEC-001** | Custom claim only authority (no role fallback)| Independent Audit | [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules), [lib/server-auth.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/server-auth.ts) | `tests/server-auth.test.mjs` | **PASS** (`tests/firestore-rules.test.mjs`) | **PENDING** |

---

## 3. Detailed Architecture of Corrected Components

### 3.1 Razorpay REST Endpoint Query Semantics
```
Primary Key Lookup:
orders.fetch(orderId) ───► Guaranteed consistent directly against primary write store.
                           Returns authoritative status: 'created', 'attempted', 'paid', 'expired'.

Secondary List Query:
orders.all({ receipt }) ─► Eventual consistency / search indexing latency.
                           An empty array ({ items: [] }) does NOT prove absence.
                           Action: Must remain safely blocked in reconciliation_failed.
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
  reconciliation_required --> active: orders.all({receipt}) finds 1 matching order
  reconciliation_required --> reconciliation_failed: orders.all({receipt}) returns 0 (unproven absence)
  reconciliation_required --> reconciliation_failed: multiple orders found or amount/currency mismatch
  active --> active: hold expires + orders.fetch(orderId) returns created/attempted [lease extended]
  active --> reconciliation_failed: hold expires + orders.fetch(orderId) fails / network down [safely blocked]
  active --> failed: hold expires + orders.fetch(orderId) returns expired/cancelled [safe reacquisition]
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
✔ FIN-001: Deterministic reservation keys, token fencing, lease strategy, recovery, strict validation (16 tests pass)
✔ Finding 1: Active reservation past local expiry is not auto-replaced; requires external reconciliation
✔ Finding 2: Strictly validates currency during reconciliation without fallback defaulting
✔ Finding 3: verifyAndRepairIntent strict validation (8 tests pass)
✔ Finding 4: Does not assume empty list API proves absence; keeps reservation safely blocked

ℹ tests 180
ℹ suites 39
ℹ pass 180
ℹ fail 0
ℹ duration_ms 633.67
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

ℹ tests 32
ℹ suites 4
ℹ pass 32
ℹ fail 0
ℹ duration_ms 9155.42
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
