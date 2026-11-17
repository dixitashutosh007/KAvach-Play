# KAvach Play — Independent Review Corrections & Final Payment Integrity Closure Report

**Date:** 2026-11-17  
**Branch:** `mig-mov`  
**Application Target:** https://play.kavachcricket.com  
**Repository:** https://github.com/dixitashutosh007/KAvach-Play  
**Author:** Gemini in Google Antigravity (Implementation & Remediation Agent)  
**Governing Standard:** [AGENTS.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/AGENTS.md)

---

## 1. Executive Summary

This report documents the completion of the final payment integrity, reservation race, and security corrections requested for branch `mig-mov`:

1. **FIN-001 (Atomic Razorpay Order Reservation & Race Prevention):**
   - **Waiting requests never create duplicate orders:** When `acquirePaymentReservation()` returns `isWaiting: true`, the endpoint polls `/paymentReservations/{reservationKey}` for up to 3 seconds. If active, it validates identity and amount before reusing. If failed, it safely attempts atomic reacquisition. If polling times out, it returns HTTP 409 Conflict. A waiting request can never fall through to `instance.orders.create()`.
   - **Propagate activation errors:** `activatePaymentReservation()` strictly propagates errors rather than swallowing them. A failed reservation write returns an error response instead of 200 OK.
   - **Recovery after activation failure:** If Razorpay creates an order but Firestore activation fails, `recordActivationFailure()` records `orderId`, `intentId`, amount, and currency with status `activation_failed`. Subsequent retry requests detect this existing order, reconcile the status back to `active`, and reuse it without creating a second Razorpay order.
   - **Never release blindly:** Reservations are only released to `failed` when Razorpay's API call itself failed (no external order exists).
   - **Strict identity and amount validation:** `validateReservationForReuse()` verifies authenticated user identity (`authUid`), reservation key, amount, currency, and existing order/intent IDs. Any amount discrepancy (e.g. newly added late fee) or foreign user attempt returns an explicit HTTP 409 Conflict rather than silently reusing mismatched orders.
   - Verified via unit test suite in `tests/razorpay-concurrent-orders.test.mjs` (10 tests covering all concurrency, failure, recovery, timeout, and tampering scenarios).

2. **FIN-003 (Require Payment ID for Every Fulfilment Event):**
   - Enforced that **both** `payment.captured` and `order.paid` provide a valid `pay_...` payment ID before financial fulfilment in `lib/razorpay-webhook.ts`.
   - Extracted payment IDs from all standard Razorpay event structures (`payment.entity.id`, `order.entity.payment_id`, or `order.entity.payments`).
   - Events lacking a valid payment ID are rejected before writing any state; inside `processWebhookIntentTransaction`, transaction abort leaves both `razorpayIntents` and downstream match payment records completely untouched.
   - Never writes empty `razorpayPaymentId` into financial records.
   - Verified via negative test suite in `tests/razorpay-webhook-negative.test.mjs`.

3. **Merchandise Customisation Validation:**
   - Authoritative validation of custom merchandise selections in `calculateAuthoritativeMerchPrice` (`lib/razorpay-order.ts`).
   - Unknown custom selection fields are strictly rejected (prevents field injection).
   - Missing mandatory fields and whitespace-only selections are strictly rejected.
   - Invalid/manipulated option values are strictly rejected.
   - Never silently ignores invalid selections or undercharges.
   - Verified via test suite in `tests/merchandise-validation.test.mjs`.

4. **Security Configuration & Administration:**
   - Confirmed production must not enable `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK`.
   - `scripts/migrate-admin-claims.js` remains read-only by default, requiring an explicit owner-approved UID allowlist (`--allowlist=...`) before any claim can be set.
   - Admin migration was **not executed** and production data was **not modified**.

5. **Test & Environmental Verification:**
   - `npm run test:functional`: **165 passed, 0 failed** across 37 suites.
   - `npx tsc --noEmit`: **0 errors**, clean exit code 0.
   - `npm run lint`: **0 errors**, clean exit code 0.
   - `npm run build`: **Compiled successfully**, all 17 routes generated.
   - Live Firebase Emulator: **BLOCKED** due to missing host Java runtime.

---

## 2. Requirements & Finding Traceability Matrix

| Requirement | Implementation Status | Unit Tested | Emulator Tested | Independently Verified | Production Approved |
|---|---|---|---|---|---|
| **FIN-001: Atomic Razorpay Order Reservation** | **Implemented** (`lib/razorpay-order.ts`, `app/api/razorpay/order/route.ts`) | **PASS** (`tests/razorpay-concurrent-orders.test.mjs`) | **BLOCKED** (Host Java missing) | **PENDING** (Separate review required) | **PENDING** (Awaiting owner) |
| **FIN-003: Mandatory Payment ID on Fulfilment** | **Implemented** (`lib/razorpay-webhook.ts`) | **PASS** (`tests/razorpay-webhook-negative.test.mjs`) | **BLOCKED** (Host Java missing) | **PENDING** (Separate review required) | **PENDING** (Awaiting owner) |
| **Merchandise Customisation Validation** | **Implemented** (`lib/razorpay-order.ts`) | **PASS** (`tests/merchandise-validation.test.mjs`, `tests/razorpay-tamper.test.mjs`) | N/A | **PENDING** (Separate review required) | **PENDING** (Awaiting owner) |
| **SEC-001: Custom Claim Only Authority** | **Implemented** (`firestore.rules`, `lib/server-auth.ts`, `scripts/migrate-admin-claims.js`) | **PASS** (`tests/server-auth.test.mjs`, `tests/firestore-rules.test.mjs`) | **BLOCKED** (Host Java missing) | **PENDING** (Separate review required) | **PENDING** (Awaiting owner) |
| **FIN-002: Webhook Concurrency & Idempotency** | **Implemented** (`lib/razorpay-webhook.ts`) | **PASS** (`tests/razorpay-webhook-concurrency.test.mjs`) | **BLOCKED** (Host Java missing) | **PENDING** (Separate review required) | **PENDING** (Awaiting owner) |

> **Note on Independent Verification:** In strict accordance with AGENTS.md § 2, the implementation agent does not self-certify independent verification merely because its own unit tests pass. Formal independent verification requires testing on a staging environment by an independent QA session or product owner.

---

## 3. Implementation Details: FIN-001 Reservation Race Closure

### 3.1 Waiting Requests & Concurrency Control
- **File:** [app/api/razorpay/order/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/order/route.ts)
- **Polling & Gating Mechanism:**
  - If `acquirePaymentReservation()` returns `isWaiting: true`, the endpoint polls `/paymentReservations/{reservationKey}` up to 6 times at 500ms intervals (3s total).
  - If the reservation becomes `active`, it runs `validateReservationForReuse()`:
    - If valid, returns HTTP 200 with the existing order and `reusedExistingOrder: true`.
    - If invalid (amount changed or wrong user), returns HTTP 409 Conflict with the exact reason.
  - If the reservation transitions to `failed`, it attempts to reacquire the lock via a new atomic transaction. If reacquisition succeeds, `reservationAcquired = true` is set; otherwise returns HTTP 409 Conflict.
  - If polling times out while still in `reserving`, returns HTTP 409 Conflict (`"Payment order creation is already in progress. Please wait a moment and retry."`).
  - **Guaranteed Lock Boundary:** If `reservationKey` is present and `reservationAcquired` is not true, the endpoint immediately returns HTTP 409. It never reaches `instance.orders.create()`.

### 3.2 Error Propagation & Safe Activation Recovery
- **File:** [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts)
- **Functions:**
  - `activatePaymentReservation`: Direct async call without try/catch swallowing; propagates Firestore update errors immediately.
  - `recordActivationFailure`: When Razorpay order creation succeeds but Firestore activation throws an error, the endpoint catches the error and records `orderId`, `intentId`, amount, and currency with status `"activation_failed"`.
  - `acquirePaymentReservation`: When a retry arrives for an obligation in `"activation_failed"` status with an unexpired order, it validates the identity and amount, reconciles the status back to `"active"`, and returns the existing order (`acquired: false`, `existingOrder: { ... }`).
  - `releasePaymentReservation`: Only invoked when the Razorpay API call itself fails and no external order ID exists. Never releases an active or created order blindly.

### 3.3 Strict Identity and Amount Validation
- **Function:** `validateReservationForReuse(reservationData, reservationKey, authUid, payableAmount, currency)`
- **Validations Enforced:**
  1. `reservationData.reservationKey === reservationKey`
  2. `reservationData.userId === authUid` (blocks cross-user order hijacking)
  3. `reservationData.orderId` starts with `order_`
  4. `reservationData.intentId` is non-empty string
  5. `Number(reservationData.amount) === Number(payableAmount)` (prevents reusing an order if obligation amount changed, e.g. late fees added)
  6. `reservationData.currency.toUpperCase() === currency.toUpperCase()`

---

## 4. Verification Gate Results

### 4.1 Functional & Unit Test Suite
Command:
```bash
npm run test:functional
```
Output:
```text
ℹ tests 165
ℹ suites 37
ℹ pass 165
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 640.827959
```

### 4.2 TypeScript Typecheck
Command:
```bash
npx tsc --noEmit
```
Output:
```text
Clean exit code 0, 0 type errors.
```

### 4.3 Code Linting
Command:
```bash
npm run lint
```
Output:
```text
Clean exit code 0 (4 open read warnings in firestore.rules, 0 errors).
```

### 4.4 Production Build Compilation
Command:
```bash
npm run build
```
Output:
```text
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Collecting page data
✓ Generating static pages (17/17)
✓ Collecting build traces
✓ Finalizing page optimization
All routes compiled successfully. Exit code 0.
```

### 4.5 Firebase Emulator Status
Command:
```bash
java -version
```
Output:
```text
The operation couldn’t be completed. Unable to locate a Java Runtime.
Please visit http://www.java.com for information on installing Java.
```
**Status: BLOCKED (Environmental Limitation).**
Because the local environment lacks a Java Runtime Environment (JRE), the local Firebase Emulator cannot be launched. As required by AGENTS.md, this is explicitly reported as **BLOCKED** and has not been falsely marked as PASS.

---

## 5. Security & Risk Assessment

1. **Production Admin Role Fallback:**
   - Production must not set `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK=true`. All administrative access requires verified Firebase Auth custom claims `{ admin: true }`.
2. **Administrator Account Migration:**
   - `scripts/migrate-admin-claims.js` was NOT run against production data.
   - When executed by the owner in the future, it must be run with `--allowlist=<approved_uids>` following candidate report review.
3. **Razorpay Production Mode:**
   - No real transactions were executed. All tests used mocked and synthetic payloads.
4. **Outstanding Work / Next Steps:**
   - Independent verification on staging environment with a live emulator or staging Firebase instance.
   - Owner review of candidate administrators before running the migration script.
