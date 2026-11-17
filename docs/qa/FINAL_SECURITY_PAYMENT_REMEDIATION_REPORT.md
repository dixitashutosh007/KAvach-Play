# KAvach Play — Final Security & Payment Remediation Corrections Report

**Document Date:** 2026-11-17  
**Branch:** `mig-mov`  
**Application:** https://play.kavachcricket.com  
**Environment:** Local Staging / Firebase Emulator Suite  
**Status:** All 4 Review Findings Remediated & Fully Verified  

---

## 1. Executive Summary

In response to the independent review findings on the `mig-mov` branch, all four designated remediation areas were resolved and verified without restarting the completed remediation programme, refactoring unrelated code, or modifying the user interface.

No production Firestore rules, production environment variables, Firebase claims, or payment data were modified. No production deployment was conducted.

| Item / Finding | Scope | Status | Verification Evidence |
|---|---|---|---|
| **Finding 1 (SEC-001)** | Remove legacy server-side admin fallback (`ALLOW_LEGACY_ADMIN_ROLE_FALLBACK`) and Firestore `appUsers.role` lookup from `lib/server-auth.ts`. | **Closed** | `lib/server-auth.ts` requires cryptographic Firebase Auth claim `admin: true`. All server routes audited. |
| **Finding 2 (SEC-001)** | Test actual production authorization implementation in `tests/server-auth.test.mjs` (replace duplicate helper). | **Closed** | `tests/server-auth.test.mjs` imports production `requireAdmin(req)` across 8 comprehensive scenarios (8/8 pass). |
| **Finding 3 (FIN-002)** | Repair Firestore Emulator concurrency test in `tests/emulator-webhook-concurrency.test.mjs` (initialize testEnv, eliminate silent early returns, seed downstream documents). | **Closed** | `@firebase/rules-unit-testing` and `firebase-admin` initialized against emulator; 4 concurrent race scenarios executed (4/4 pass). |
| **Finding 4 (Specialist Roles)** | Verify specialist permissions (`isStudioAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isClubAdmin`, `isDesigner`, `canDesign`, `role`, `status`) in `firestore.rules` and add complete emulator assertions. | **Closed** | Rules verified least-privilege; `tests/firestore-rules.test.mjs` expanded with exhaustive emulator assertions (39/39 emulator tests pass). |

---

## 2. Detailed Remediation Evidence

### Finding 1 — SEC-001: Server-Side Authority Lockdown

#### File Modified: `lib/server-auth.ts`
- **Previous state:** Contained `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK` environment flag check and an asynchronous fallback querying `/appUsers/{uid}.role == 'admin'`.
- **Corrected state:**
  - Removed `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK` and all references to `process.env.ALLOW_LEGACY_ADMIN_ROLE_FALLBACK`.
  - Removed `getFirestore` import and the Firestore document lookup from `requireAdmin()`.
  - Super-admin authorization now solely and strictly requires `decoded.admin === true` in the verified Firebase ID token claims.
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
  - `app/api/razorpay/webhook/route.ts`: validates HMAC SHA256 webhook signature over raw payload and verifies intent ownership.

---

### Finding 2 — SEC-001: Production Authorization Implementation Testing

#### File Modified: `tests/server-auth.test.mjs`
- **Previous state:** Replicated authorization logic inside a local dummy helper `mockRequireAdmin()`, leaving the production function unexercised.
- **Corrected state:** Tests now dynamically import the actual production `requireAdmin` from `../lib/server-auth.ts` and mock only the external `firebase-admin/auth` verification step.
- **Scenarios Executed (8/8 Passed):**
  1. Valid Firebase ID token with custom claim `{ admin: true }` is authorized successfully.
  2. Legitimate ordinary player without custom claim is rejected with HTTP 403 (`Forbidden: Super Admin access required`).
  3. Caller with Firestore document `role: "admin"` but no custom claim is rejected with HTTP 403.
  4. Caller with forged `isSuperAdmin: true` in token claims (without `admin: true`) is rejected with HTTP 403.
  5. User with revoked or expired ID token is rejected with HTTP 401 (`Unauthorized: Invalid or expired token`).
  6. Setting legacy environment variable `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK=true` does not restore bypass (still rejected with HTTP 403).
  7. Malformed authorization header (non-Bearer prefix) is rejected with HTTP 401.
  8. Missing authorization header is rejected with HTTP 401.

---

### Finding 3 — FIN-002: Real Firestore Emulator Concurrency Test Repair

#### File Modified: `tests/emulator-webhook-concurrency.test.mjs`
- **Previous state:** Declared `let testEnv;` but never assigned it; contained `if (!testEnv) return;` at the beginning of each scenario, causing tests to silently skip while reporting green.
- **Corrected state:**
  - Initialized `@firebase/rules-unit-testing` `initializeTestEnvironment` using project ID `kavach-play-concurrency-test`.
  - Connected `firebase-admin` to the active `FIRESTORE_EMULATOR_HOST` (e.g. `127.0.0.1:8080`).
  - Removed all silent early returns (`if (!testEnv) return;`). If the emulator is missing, the test suite explicitly fails or skips with an actionable message.
  - Implemented `beforeEach` fixture seeding to seed realistic match fee obligations, players, otherFees, merchandise items, and studio memberships before every test run.
  - Implemented strict cleanup (`testEnv.clearFirestore()`) after each test.
- **Concurrency & Race Scenarios Tested Against Live Emulator (4/4 Passed):**
  1. **Simultaneous `payment.captured` & `order.paid` for Match + Late Fee:**
     - Two concurrent `processWebhookIntentTransaction` workers fired concurrently via `Promise.all`.
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
   Result:  191 passed, 0 failed, 0 skipped (duration: 747ms)

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
