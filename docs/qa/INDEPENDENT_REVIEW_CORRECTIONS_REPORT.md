# KAvach Play — Independent Review Corrections Report

**Branch:** `mig-mov`  
**Governing Standard:** `AGENTS.md`  
**Date:** 2026-11-17  
**Status:** All 3 Review Items Resolved & Verified  

---

## 1. Executive Summary

This report documents the resolution of the three items raised during independent review of `mig-mov`:

1. **Item 1 — Complete SEC-001 server-side authority lockdown (`lib/server-auth.ts` & `tests/server-auth.test.mjs`):**
   - Verified that `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK` and the Firestore `appUsers.role` fallback are completely eliminated.
   - Verified that all server-side administrative API routes require verified Firebase custom claim `{ admin: true }`.
   - Replaced duplicate test helper logic with direct imports of production `requireAdmin()`.
   - Added production test coverage for legitimate super-admin, ordinary player, forged role document, revoked custom claim (`admin: false`), and legacy fallback environment variable injection attempts.

2. **Item 2 — Repair FIN-002 emulator concurrency test (`tests/emulator-webhook-concurrency.test.mjs`):**
   - Corrected test harness to properly initialize `@firebase/rules-unit-testing` `testEnv` and connect `firebase-admin` Firestore to the emulator.
   - Removed vacuous early return (`if (!testEnv) return;`).
   - Added real concurrency scenarios testing simultaneous `payment.captured` and `order.paid` deliveries for Match Fees + Late Fees, Merchandise Orders, and Studio Subscriptions.
   - Verified zero duplicate record creations in `otherFees`, `merchOrders`, and `subscriptionHistory`.

3. **Item 3 — Strengthen webhook validation regression coverage (`lib/razorpay-webhook.ts` & `tests/razorpay-webhook-negative.test.mjs`):**
   - Added explicit verification requiring `intent.currency` on the stored intent to prevent silent defaulting.
   - Added negative tests ensuring malformed, incomplete, or currency-missing intents are rejected.
   - Verified idempotency and transaction boundaries directly on production functions.

---

## 2. Item 1: Complete SEC-001 Server-Side Lockdown Evidence

### 2.1 Implementation Inspection (`lib/server-auth.ts`)
```ts
// Strict: verified admin custom claim is strictly required (SEC-001)
if (decoded.admin === true) {
  return { ok: true, uid: decoded.uid, email: decoded.email };
}

return {
  ok: false,
  response: NextResponse.json(
    { error: "Admin privilege required (verified admin custom claim required)." },
    { status: 403 },
  ),
};
```
- No fallback to Firestore `appUsers.role` exists.
- No legacy fallback environment variable (`ALLOW_LEGACY_ADMIN_ROLE_FALLBACK`) is recognized.

### 2.2 Test Suite Execution (`tests/server-auth.test.mjs`)
Direct execution against production `requireAdmin()`:
- `✔ authorizes a legitimate super-admin with verified custom claim { admin: true }`
- `✔ rejects an ordinary signed-in player without admin custom claim with 403 Forbidden`
- `✔ rejects a caller with role == 'admin' in Firestore who lacks custom claim (no legacy fallback)`
- `✔ rejects a caller whose admin custom claim was revoked (admin: false) with 403 Forbidden`
- `✔ strictly rejects callers without admin custom claim even when legacy fallback env vars are set`
- `✔ rejects missing Authorization header with 401 Unauthorized`
- `✔ rejects empty Bearer token with 401 Unauthorized`
- `✔ rejects expired token with 401 Unauthorized`
**Result:** 8 / 8 tests passed.

---

## 3. Item 2: Repaired FIN-002 Emulator Concurrency Test Evidence

### 3.1 Test Harness Initialization (`tests/emulator-webhook-concurrency.test.mjs`)
- `initializeTestEnvironment` sets up the emulator with live `firestore.rules`.
- `firebase-admin` connects to `kavach-play-concurrency-test`.
- `beforeEach` runs `testEnv.clearFirestore()` for repeatable isolation.
- `after` cleans up the test environment.

### 3.2 Real Firestore Emulator Execution
Command: `npm run test:emulator`
```
▶ FIN-002: Real Firestore Emulator Webhook Concurrency Integration Tests
  ✔ handles payment.captured and order.paid simultaneous arrivals without duplicate match/late-fee writes (6073ms)
  ✔ handles simultaneous arrivals for merchandise order without duplicate records (2790ms)
  ✔ handles simultaneous arrivals for studio subscription extending expiry exactly once (3394ms)
  ✔ safely handles repeated webhook replays after completion with alreadyProcessed: true (24ms)
✔ FIN-002: Real Firestore Emulator Webhook Concurrency Integration Tests (13849ms)
```
**Assertions Verified at Database Engine Level:**
1. **Match Fee & Late Fees:** Out of 2 simultaneous requests, exactly one executed fulfilment (`alreadyProcessed: false`) and one recognized prior processing (`alreadyProcessed: true`). Exactly 1 record written to `players/{id}/otherFees`.
2. **Merchandise Orders:** Exactly 1 update applied to `merchOrders/{id}`, paymentStatus set to `Paid`, zero duplicate orders created.
3. **Subscriptions:** 30-day plan applied to an expiry of `2026-12-01` resulted in `2026-12-31` (exactly 30 days added, never 60 days). Exactly 1 audit record written to `subscriptionHistory`.
4. **Replays:** Repeat delivery returned `{ success: true, alreadyProcessed: true }` without mutating timestamps or records.

---

## 4. Item 3: Strengthened Webhook Validation Evidence

### 4.1 Strict Intent Currency Enforcement (`lib/razorpay-webhook.ts`)
```ts
// 6. Currency verification (Strict: no silent defaulting on stored intent or payload)
if (!intent.currency || typeof intent.currency !== "string" || !intent.currency.trim()) {
  return { ok: false, error: "Stored intent is missing a valid currency." };
}
if (!details.capturedCurrency) {
  return { ok: false, error: "Missing currency in webhook payload." };
}
const expectedCurrency = intent.currency.trim().toUpperCase();
if (details.capturedCurrency !== expectedCurrency) {
  return {
    ok: false,
    error: `Currency mismatch: expected ${expectedCurrency}, received ${details.capturedCurrency}`,
  };
}
```

### 4.2 Negative Test Suite (`tests/razorpay-webhook-negative.test.mjs`)
- `✔ rejects when stored intent is missing an orderId`
- `✔ rejects when incoming webhook details is missing an orderId`
- `✔ rejects when payment.captured is missing a valid paymentId`
- `✔ rejects when captured amount is 0, negative, or missing`
- `✔ rejects when stored intent is missing a valid currency`
- `✔ rejects when currency is missing from webhook payload`
- `✔ extractWebhookEventDetails does NOT silently default missing currency to INR`
- `✔ rejects when order ID does not match stored intent`
- `✔ rejects when captured paise does not match expected amount`
- `✔ rejects when captured currency is USD instead of INR`
- `✔ rejects unexpected or unsupported webhook event types`
- `✔ extractWebhookEventDetails returns null for unsupported event types`
- `✔ rejects partial payment on order.paid event`
- `✔ extractWebhookEventDetails safely returns null for malformed payloads`

---

## 5. Global Quality Verification Summary

| Quality Gate | Command | Result |
|---|---|---|
| **Functional Tests** | `npm run test:functional` | **191 / 191 Passed** (0 failures, 699ms) |
| **Emulator Integration** | `npm run test:emulator` | **39 / 39 Passed** (FIN-002: 4, AST: 9, Rules: 8, FIN-001: 18) |
| **Playwright E2E** | `npx playwright test e2e/login.spec.ts e2e/app-loading.spec.ts` | **9 / 9 Passed** (16.8s) |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **0 Diagnostics / Clean** |
| **Production Build** | `npm run build` | **17 / 17 Routes Compiled** |

All three review items are fully resolved, tested, and documented.
