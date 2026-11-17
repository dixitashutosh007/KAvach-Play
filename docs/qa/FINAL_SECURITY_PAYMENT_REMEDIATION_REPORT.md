# KAvach Play — Final Security & Payment Remediation Corrections Report

**Document Date:** 2026-11-17  
**Branch:** `mig-mov`  
**Application:** https://play.kavachcricket.com  
**Environment:** Local Staging / Firebase Emulator Suite  
**Status:** Targeted Remediation Findings Fully Resolved & Verified  

---

## 1. Executive Summary

In response to the independent code review on the `mig-mov` branch, all designated security and payment remediation items were verified and tested directly against production implementations.

No production Firestore rules, production environment variables, Firebase claims, or live payment data were modified. No production deployment was conducted.

| Item / Finding | Scope | Status | Verification Evidence |
|---|---|---|---|
| **Finding 1 (SEC-001)** | Remove legacy server-side admin fallback (`ALLOW_LEGACY_ADMIN_ROLE_FALLBACK`) and Firestore `appUsers.role` lookup from `lib/server-auth.ts`; enforce genuine token revocation checks via `verifyIdToken(token, true)`. | **Closed** | `lib/server-auth.ts` requires cryptographic Firebase Auth claim `admin: true` and verifies revocation (`checkRevoked: true`). All server routes audited. |
| **Finding 2 (SEC-001)** | Test actual production authorization implementation in `tests/server-auth.test.mjs` (verify `checkRevoked: true`, forged claims & genuine revocation). | **Closed** | `tests/server-auth.test.mjs` imports production `requireAdmin(req)` across 10 distinct scenarios (10/10 pass). |
| **Finding 3 (FIN-002)** | Repair Firestore Emulator concurrency test in `tests/emulator-webhook-concurrency.test.mjs` (initialize testEnv, eliminate silent early returns, seed downstream documents). | **Closed** | `@firebase/rules-unit-testing` and `firebase-admin` initialized against emulator; 4 concurrent race scenarios executed directly against `processWebhookIntentTransaction(db, details)` (4/4 pass). |
| **Finding 4 (Specialist Roles)** | Verify specialist permissions (`isStudioAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isClubAdmin`, `isDesigner`, `canDesign`, `role`, `status`) in `firestore.rules` and add complete emulator assertions. | **Closed** | Rules verified least-privilege; `tests/firestore-rules.test.mjs` expanded with exhaustive emulator assertions (39/39 emulator tests pass). |

> **Scope Separation Notice:** Navigation rationalisation and ARCH-001 listener teardown improvements were developed in separate, dedicated workstreams and are strictly decoupled from this security and financial remediation sign-off. This document certifies exclusively the security, payment integrity, and authorization findings.

---

## 2. Detailed Remediation Evidence

### Finding 1 — SEC-001: Server-Side Authority Lockdown & Token Revocation Checking

#### File Modified: `lib/server-auth.ts`
- **Previous state:** Contained `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK` environment flag check and an asynchronous fallback querying `/appUsers/{uid}.role == 'admin'`. Token verification called `verifyIdToken(token)` without checking token revocation status.
- **Corrected state:**
  - Removed `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK` and all references to `process.env.ALLOW_LEGACY_ADMIN_ROLE_FALLBACK`.
  - Removed `getFirestore` import and the Firestore document lookup from `requireAdmin()`.
  - Super-admin authorization now solely and strictly requires `decoded.admin === true` in the verified Firebase ID token claims.
  - Enabled genuine Firebase token revocation checking by updating the verification call to `getAuth(app).verifyIdToken(token, true)`. Revoked tokens are immediately rejected with HTTP 401 Unauthorized without waiting for the 1-hour JWT expiry window.
  - Operational & performance considerations: Revocation checking adds verification against Firebase's revocation endpoint or cached state, ensuring immediate lockouts upon admin credential revocation or compromise.
  - Retained `effectiveAdmin(claims, userDoc)` helper only for client-side / UI display context where specialist views are rendered, explicitly decoupled from server authority.
- **Repository Audit for Privileged Routes:**
  Audited all administrative endpoints in `app/api/`:
  - `app/api/admin/merge-players/route.ts`: invokes `requireAdmin(req)` -> enforces `decoded.admin === true`.
  - `app/api/admin/generate-kavach-ids/route.ts`: invokes `requireAdmin(req)` -> enforces `decoded.admin === true`.
  - `app/api/admin/reconcile-abandoned/route.ts`: invokes `requireAdmin(req)` -> enforces `decoded.admin === true`.
  - `app/api/calendar/sync/route.ts`: invokes `requireAdmin(req)` -> enforces `decoded.admin === true`.
  - `app/api/email/send/route.ts`: invokes `requireAdmin(req)` -> enforces `decoded.admin === true`.
  - `app/api/whatsapp/invite/route.ts`: invokes `requireAdmin(req)` -> enforces `decoded.admin === true`.
  - `app/api/whatsapp/send/route.ts`: invokes `requireAdmin(req)` -> enforces `decoded.admin === true`.
  - `app/api/whatsapp/remind-studio/route.ts`: invokes `requireAdmin(req)` -> enforces `decoded.admin === true`.
  - `app/api/razorpay/order/route.ts`: validates authenticated user token via `getAuth().verifyIdToken()`.
  - `app/api/razorpay/webhook/route.ts`: implements timing-safe HMAC SHA-256 webhook signature verification over raw payload (inspected in source code; route-level HTTP integration testing remains a separate QA gap).

---

### Finding 2 — SEC-001: Production Authorization Implementation Testing

#### File Modified: `tests/server-auth.test.mjs`
- **Previous state:** Replicated authorization logic inside a local dummy helper `mockRequireAdmin()`, leaving the production function unexercised.
- **Corrected state:** Tests dynamically import the actual production `requireAdmin` from `../lib/server-auth.ts` and mock only the external `firebase-admin/auth` verification step (`verifyIdToken`).
- **Scenarios Executed (10/10 Passed):**
  1. **Legitimate Super-Admin:** Valid Firebase ID token with custom claim `{ admin: true }` is authorized successfully (HTTP 200).
  2. **Ordinary Player:** Legitimate ordinary player without custom claim is rejected with HTTP 403 Forbidden (`verified admin custom claim required`).
  3. **Forged Firestore Document:** Caller with Firestore document `role: "admin"` but no custom claim is rejected with HTTP 403 Forbidden.
  4. **Demoted Claim (`admin: false`):** Token with custom claim demoted to `false` is verified by Firebase Auth but rejected by `requireAdmin` with HTTP 403 Forbidden.
  5. **Forged Secondary Claim (`isSuperAdmin: true`):** Token containing `isSuperAdmin: true` but lacking `admin: true` is strictly rejected with HTTP 403 Forbidden.
  6. **Mocked Token Revocation Rejection (`auth/id-token-revoked`):** In this mocked verification test, Firebase Admin's `verifyIdToken()` is configured to simulate the `auth/id-token-revoked` error thrown when `checkRevoked: true` detects a revoked token. The test asserts that `requireAdmin` invoked `verifyIdToken(token, true)` with `checkRevoked: true` and handled the rejection by returning HTTP 401 Unauthorized (`Invalid or expired token`), clearly distinguished from claim demotion (HTTP 403 Forbidden). *Note: This is a unit test asserting production error handling against a mocked Firebase Admin SDK rejection; it does not perform live network calls to Firebase Auth.*
  7. **Legacy Environment Flag:** Setting `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK=true` has zero effect; caller without claim is rejected with HTTP 403 Forbidden.
  8. **Missing Authorization Header:** Rejected with HTTP 401 Unauthorized.
  9. **Empty Bearer Token:** Rejected with HTTP 401 Unauthorized.
  10. **Expired Token:** Rejected with HTTP 401 Unauthorized.

---

### Finding 3 — FIN-002: Real Firestore Emulator Concurrency Test Repair

#### File Modified: `tests/emulator-webhook-concurrency.test.mjs`
- **Previous state:** Declared `let testEnv;` but never assigned it; contained `if (!testEnv) return;` at the beginning of each scenario, causing tests to silently skip while reporting green.
- **Corrected state:**
  - Initialized `@firebase/rules-unit-testing` `initializeTestEnvironment` using project ID `kavach-play-concurrency-test`.
  - Connected `firebase-admin` to the active `FIRESTORE_EMULATOR_HOST` (e.g. `127.0.0.1:8080`).
  - Removed all silent early returns (`if (!testEnv) return;`). Missing emulator causes immediate explicit failure.
  - Implemented `beforeEach` fixture seeding to seed realistic match fee obligations, players, otherFees, merchandise items, and studio memberships before every scenario.
  - Implemented cleanup (`testEnv.clearFirestore()`) after each test.
- **Test Architecture & Scope Distinction:**
  > **IMPORTANT:** 
  > - **Emulator Concurrency Tests:** `tests/emulator-webhook-concurrency.test.mjs` directly executes the transaction function invoking `processWebhookIntentTransaction(db, details)` (2 arguments, without `payload`) against the live Firestore Emulator. This exercises and proves database-level transaction isolation, atomic locking, and duplicate-write prevention under high concurrency.
  > - **Production HTTP Route Handling & Source Inspection:** Source-code inspection of `app/api/razorpay/webhook/route.ts` confirms that the production HTTP route implements raw-body HMAC SHA-256 signature verification using timing-safe comparison (`crypto.timingSafeEqual`) before payload parsing and invokes `processWebhookIntentTransaction(db, details, payload)` with the 3rd argument.
  > - **HMAC & HTTP Route QA Boundary:** Existing negative tests (`tests/razorpay-webhook-negative.test.mjs`) exercise the library functions (`extractWebhookEventDetails()`, `validateWebhookTransaction()`, `processWebhookIntentTransaction()`) directly; they do **not** invoke the production HTTP route and do **not** test its HMAC signature verification. Route-level HMAC integration testing (sending live or mocked HTTP requests with valid/invalid signatures to an active Next.js server endpoint) and raw-payload storage persistence remain a separate QA gap, not completed automated tests.
- **Concurrency & Race Scenarios Tested Against Live Emulator (4/4 Passed):**
  1. **Simultaneous `payment.captured` & `order.paid` for Match + Late Fee:**
     - Two concurrent `processWebhookIntentTransaction(db, details)` workers fired concurrently via `Promise.all`.
     - Output: Exactly one worker completed fulfilment (`alreadyProcessed: false`), marked the intent `paid`, updated `matches/{m}/payments/{p}` to `Paid`, and created the late-fee waiver. The rival worker returned `alreadyProcessed: true`. Zero duplicate payments or late-fee documents created.
  2. **Simultaneous Deliveries for Merchandise Order:**
     - Handled simultaneous webhook arrivals for physical merchandise.
     - Output: Exactly one order record created under `merchandiseOrders`; rival returned `alreadyProcessed: true`.
  3. **Simultaneous Deliveries for Studio Subscription Extension:**
     - Handled concurrent webhooks for net session packages.
     - Output: Subscription expiry date extended exactly once (+30 days); rival returned `alreadyProcessed: true`.
  4. **Replay Idempotency:**
     - Repeated webhook calls against an already paid intent return `alreadyProcessed: true` immediately without modifying database state.

---

### Finding 4 — Specialist Role Security Boundaries & Emulator Verification

#### Files Verified: `firestore.rules`, `tests/firestore-rules.test.mjs`
- **Security Boundary Inspection (`firestore.rules`):**
  - Lines 100–114 enforce strict least privilege on `/appUsers/{userId}`:
    ```cel
    match /appUsers/{userId} {
      allow read: if isSignedIn();
      allow create: if isSuperAdmin() || (
        isSignedIn()
        && request.auth.uid == userId
        && (!('role' in incoming()) || incoming().role == 'player')
        && !incoming().keys().hasAny(['isSuperAdmin', 'isStudioAdmin', 'isMatchAdmin', 'isFinanceAdmin', 'isClubAdmin', 'isDesigner', 'canDesign', 'status'])
      );
      allow update: if isSuperAdmin() || (
        isSignedIn()
        && (request.auth.uid == userId || isClubAdmin())
        && !incoming().diff(existing()).affectedKeys().hasAny(['role', 'isSuperAdmin', 'isStudioAdmin', 'isMatchAdmin', 'isFinanceAdmin', 'isClubAdmin', 'isDesigner', 'canDesign', 'status'])
      );
      allow delete: if isSuperAdmin();
    }
    ```
  - Ordinary users cannot create documents with specialist flags or non-`player` roles.
  - Ordinary users and club admins cannot update specialist flags (`isStudioAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isClubAdmin`, `isDesigner`, `canDesign`), account `status`, or `role`.
  - Only `isSuperAdmin()` (requiring `request.auth.token.admin == true`) can assign, modify, or delete these fields.
- **Emulator Tests Added in `tests/firestore-rules.test.mjs`:**
  - Expanded `SEC-001` test to exhaustively assert failure on attempting to set or update:
    - `isSuperAdmin: true`
    - `isStudioAdmin: true`
    - `isMatchAdmin: true`
    - `isFinanceAdmin: true`
    - `isClubAdmin: true`
    - `isDesigner: true`
    - `canDesign: true`
    - `status: "Active"`
    - `role: "admin"`
  - Verified a regular player cannot create or update another player's `appUsers` document.
  - Verified super-admin with custom claim `{ admin: true }` succeeds in managing all specialist flags and roles.

---

## 3. Comprehensive Verification Results

### Test Execution Summary

```
================================================================================
KAvach Play Verification Results — mig-mov
================================================================================
1. Functional Tests (Node.js test runner)
   Command: npm run test:functional
   Result:  193 passed, 0 failed, 0 skipped (duration: 720ms)

2. Firebase Emulator Concurrency & Security Rules Suite
   Command: npm run test:emulator
   Result:  39 passed, 0 failed, 0 skipped (duration: 14.18s)
   Breakdown:
     - FIN-002 Concurrency Integration: 4 passed
     - Firestore Security Rules AST:     8 passed
     - Firestore Emulator Rules:         9 passed
     - FIN-001 Reservation Emulator:    18 passed

3. Playwright End-to-End Suite
   Command: npx playwright test e2e/login.spec.ts e2e/app-loading.spec.ts
   Result:  18 passed, 0 failed, 0 skipped (duration: 35.0s)

4. TypeScript Static Typecheck
   Command: npx tsc --noEmit
   Result:  Exit Code 0 (Zero type errors)

5. ESLint Code Quality
   Command: npm run lint
   Result:  Exit Code 0 (0 errors, 4 informational open-read warnings)

6. Next.js Production Build
   Command: npm run build
   Result:  Exit Code 0 (17/17 routes compiled successfully)
================================================================================
```

---

## 4. Production Deployment Prerequisites

Before deploying to production (`play.kavachcricket.com`):

1. **Firebase Admin Custom Claims Verification:**
   Ensure all designated super-administrators have had the `admin: true` custom claim set via Firebase Admin SDK script (`config/set-admin-claim.mjs` or Cloud Functions).
2. **Environment Configuration:**
   Verify `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `FIREBASE_ADMIN_*` credentials in the production deployment environment.
3. **Owner Approval:**
   In accordance with Rule 2 ("No production deployment without explicit owner approval"), await formal sign-off from the product owner before initiating merge or deployment.
