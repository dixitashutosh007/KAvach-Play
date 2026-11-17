# KAvach Play — Independent Review Corrections & Final Payment Integrity Closure Report

**Date:** 2026-11-17  
**Branch:** `mig-mov`  
**Application Target:** https://play.kavachcricket.com  
**Repository:** https://github.com/dixitashutosh007/KAvach-Play  
**Author:** Gemini in Google Antigravity (Implementation & Remediation Agent)  
**Governing Standard:** [AGENTS.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/AGENTS.md)

---

## 1. Executive Summary

This report documents the completion of the final payment integrity and security corrections requested for branch `mig-mov`:

1. **FIN-001 (Atomic Razorpay Order Reservation):**
   - Replaced non-transactional lookups with a deterministic, atomic reservation mechanism using Firestore transactions on `/paymentReservations/{reservationKey}`.
   - Only one request can acquire a reservation for a given obligation; concurrent requests poll and reuse the active Razorpay order (`reusedExistingOrder: true`).
   - Automatic expiry handling allows legitimate retry after lock/order TTL.
   - Instant release on Razorpay API failures transitions reservation status to `failed`, preventing permanent lockout.
   - Obligations are not marked paid until the verified webhook is processed.
   - Verified via unit test suite in `tests/razorpay-concurrent-orders.test.mjs`.

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
   - `npm run test:functional`: **161 passed, 0 failed** across 37 suites.
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

## 3. Implementation Details

### 3.1 FIN-001: Atomic Order Reservation Mechanism
- **Path:** [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts) & [app/api/razorpay/order/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/order/route.ts)
- **Functions:**
  - `acquirePaymentReservation(db, reservationKey, authUid, payableAmount, currency, lockTtlMs)`:
    - Runs inside `db.runTransaction` against `/paymentReservations/{reservationKey}`.
    - If active and unexpired with `orderId`, returns `{ acquired: false, existingOrder: { ... } }`.
    - If status is `reserving` and unexpired, returns `{ acquired: false, isWaiting: true }`.
    - Otherwise acquires reservation with status `reserving` and lock TTL (30s).
  - `activatePaymentReservation(db, reservationKey, orderId, intentId, orderTtlMs)`:
    - Updates reservation to `active` with `orderId` and `intentId` (15-min order TTL).
  - `releasePaymentReservation(db, reservationKey, errorMessage)`:
    - Called in `catch` blocks when Razorpay API order creation fails. Immediately sets status `failed` and expires the document, allowing instant retries.
- **Route Handling:**
  - In `app/api/razorpay/order/route.ts`, if `resResult.isWaiting` is returned, the endpoint polls the reservation document for up to 3 seconds before falling back, preventing duplicate Razorpay orders during concurrent double-clicks.

### 3.2 FIN-003: Strict Payment ID Requirement
- **Path:** [lib/razorpay-webhook.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-webhook.ts)
- **Functions:**
  - `extractWebhookEventDetails(payload)`:
    - Extracts `paymentId` from `paymentEntity.id`, `orderEntity.payment_id`, or `orderEntity.payments[0].id`.
    - Ensures payment ID starts with `pay_`.
  - `validateWebhookTransaction(intent, details)`:
    - Enforces:
      ```typescript
      if (!details.paymentId || !details.paymentId.startsWith("pay_")) {
        return {
          ok: false,
          error: `Missing or invalid payment ID (must start with 'pay_') for event '${details.event}'.`,
        };
      }
      ```
  - `processWebhookIntentTransaction(db, details, rawPayload)`:
    - When `validateWebhookTransaction` fails, throws an error inside `db.runTransaction`. The transaction is aborted cleanly, leaving intent `status: "pending"` and downstream match payment records untouched.

### 3.3 Merchandise Customisation Validation
- **Path:** [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts)
- **Logic:**
  - Maps valid custom field definitions from catalogue item.
  - Rejects unknown fields: throws `Error("Unknown merchandise custom selection field: '<key>'.")`.
  - Enforces required fields: throws `Error("Missing required merchandise selection for '<field>'.")`.
  - Validates options against allowed option list: throws `Error("Invalid selection '<value>' for field '<field>'...")`.
  - Adds authoritative price modifiers (`priceModifierType === "Add"`).

---

## 4. Verification Gate Results

### 4.1 Functional & Unit Test Suite
Command:
```bash
npm run test:functional
```
Output:
```text
ℹ tests 161
ℹ suites 37
ℹ pass 161
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 637.601875
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
