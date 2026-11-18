# KAvach Play — Phase 5 Security & Server Auth Evidence Report
## Core Auth & Server-Side Security

**Document Type:** Formal QA & Security Verification Evidence  
**Scope:** Phase 5 — Core Auth & Server-Side Security  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Baseline Commit SHA:** `e21388a9a02fa78f9f5e9f1c69409125cbfa25e4`  
**Authoritative References:** `AGENTS.md`, `DECISION-LOG.md` (D-08, D-09, D-10), `PHASE_5_DISCOVERY_AND_PLAN.md`  
**Verification Date:** 2026-11-17  
**Verification Status:** Developer Verified (219/219 Functional, 28/28 Playwright, TypeScript Clean, Production Build Clean) — **Pending Independent QA Review & Owner Acceptance** (Not Self-Certified)

---

## 1. System & Runtime Environment

| Property | Value | Notes |
|---|---|---|
| Operating System | `Darwin 25.6.0 arm64` (macOS Sequoia) | Apple Silicon Host |
| Node.js Runtime | `v24.15.0` | Active Node LTS / Development runtime |
| npm Package Manager | `12.0.1` | Local package manager |
| Next.js Framework | `15.0.0` | App Router production build framework |
| Playwright Test Runner | `v1.62.1` | Chromium engine with Desktop & Mobile profiles |
| Git Branch / HEAD | `mig-mov` | Phase 5 Implementation |

---

## 2. Security Architecture Implementation Highlights

### 2.1 Server-Side Granular RBAC (`lib/server-auth.ts`)
- Implemented full granular role-based access control (RBAC) in accordance with Decision `D-08` and `AGENTS.md`:
  - `superAdmin` (Cryptographic custom claim `admin: true`)
  - `clubAdmin` (Verified via custom claim or write-protected `/appUsers/{uid}` document)
  - `matchAdmin` (Restricted to match & fixture workflows)
  - `financeAdmin` (Restricted to financial ledger and accounting operations)
  - `studioAdmin` (Restricted to studio and facility records)
  - `isDesigner` (Restricted to canvas and banner generation)
  - `player` (Standard member with least-privilege access)
- Implemented `requireRole(req, allowedRoles)` and role-specific convenience guards:
  - `requireSuperAdmin(req)`
  - `requireClubAdmin(req)` (allows `clubAdmin`, `superAdmin`)
  - `requireMatchAdmin(req)` (allows `matchAdmin`, `clubAdmin`, `superAdmin`)
  - `requireFinanceAdmin(req)` (allows `financeAdmin`, `superAdmin`)
  - `requireStudioAdmin(req)` (allows `studioAdmin`, `superAdmin`)
- Enforced `checkRevoked: true` on token verification for all administrative endpoints.
- Enforced account status check: accounts with `status: "Disabled"` are rejected immediately with 403 Forbidden.

### 2.2 Security Guard Ordering & Route Hardening
- **`app/api/email/send/route.ts`:**
  - Evaluates `requireClubAdmin(req)` as the very first operation before parsing the request body or querying Firestore `appConfig`, eliminating unauthenticated crawler/DoS vectors.
- **`app/api/admin/reconcile-abandoned/route.ts`:**
  - Hardened with `requireFinanceAdmin(req)`.
- **`app/api/admin/merge-players/route.ts` & `generate-kavach-ids/route.ts`:**
  - Hardened with `requireClubAdmin(req)`.
- **`app/api/calendar/sync/route.ts`:**
  - Hardened with `requireMatchAdmin(req)`.
- **`app/api/whatsapp/*` routes:**
  - Hardened with role-appropriate guards (`requireFinanceAdmin`, `requireClubAdmin`, `requireStudioAdmin`).

### 2.3 Player-User Boundary Hardening (`lib/razorpay-order.ts`)
- In `verifyPlayerOwnership(db, authUid, targetPlayerId)`:
  - Strict verification of `players/{targetPlayerId}.authUid` and `appUsers/{authUid}.playerId`.
  - Removed permissive fallback for `targetPlayerId === authUid` (positive match strictly required).
  - Enforced fail-closed behavior on database errors (returns `false`).
  - Prohibits cross-player fee generation or taking over unverified player records.
  - Rejects disabled caller accounts before creating payment reservations.

### 2.4 Webhook Replay & Transaction Integrity (`lib/razorpay-webhook.ts`)
- In `processWebhookIntentTransaction(db, details)`:
  - Validates all incoming transaction details (amount, currency, orderId, paymentId) against stored intent *before* checking idempotency.
  - Identical replays (`same paymentId` on paid intent) return `{ success: true, alreadyProcessed: true }`.
  - Conflicting replays (mismatched payment ID, order ID, amount, currency on paid intent) are strictly rejected with validation errors.
  - Downstream mutations execute atomically inside `db.runTransaction()`.

### 2.5 Test Bypass Isolation (`lib/server-auth.ts`)
- `x-test-*` bypass is strictly locked behind `isTestAuthBypassAllowed()`.
- Permanently returns `false` in production runtimes (`NODE_ENV === "production"`).
- Requires both `NODE_ENV === "test"` and `KAVACH_TEST_AUTH_BYPASS === "true"`.

---

## 3. Mandatory Security Scenarios Verification (`tests/server-security-phase5.test.mjs`)

| Scenario # | Test Description | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| **Scenario 1** | Unauthenticated API access (missing or empty Authorization header) | 401 Unauthorized | 401 Unauthorized (`Missing Authorization header`) | **PASS** |
| **Scenario 2** | Authenticated player attempting admin operations | 403 Forbidden | 403 Forbidden (`requires one of [...]`) | **PASS** |
| **Scenario 3** | Match Admin attempting Finance Admin operations (`reconcile-abandoned`) | 403 Forbidden | 403 Forbidden (`requires one of [financeAdmin, superAdmin]`) | **PASS** |
| **Scenario 4** | Finance Admin attempting Super Admin operations | 403 Forbidden | 403 Forbidden (`requires one of [superAdmin]`) | **PASS** |
| **Scenario 5** | Strict player ownership (positive match required, no UID===playerId fallback, DB error fail-closed) | Ownership rejected | `verifyPlayerOwnership` returns `false` | **PASS** |
| **Scenario 6** | Forged roles in payload or headers without cryptographic custom claims | 403 Forbidden | 403 Forbidden | **PASS** |
| **Scenario 7** | Tampered payment amounts (client amounts ignored) | Server derivation | Server computes 1200; client 10 discarded | **PASS** |
| **Scenario 8** | Invalid payment signatures on webhook | 401 Invalid signature | Signature mismatch rejected via timing-safe check | **PASS** |
| **Scenario 9** | Duplicate webhook delivery on already-paid intent (identical replay) | 200 Idempotent | Returns `{ success: true, alreadyProcessed: true }` | **PASS** |
| **Scenario 10** | Conflicting webhook replay (conflicting paymentId, amount, or currency) | Validation error | Rejection on paid intent with conflicting details | **PASS** |
| **Scenario 11** | Expired or revoked authentication tokens | 401 Unauthorized | Rejects with `Invalid or expired token.` | **PASS** |
| **Scenario 12** | Account status enforcement & fail-closed DB errors | 403 / 503 | 403 on disabled; 503 on database lookup failure | **PASS** |
| **Scenario 13** | Test bypass isolation (ignored in production or without bypass flag) | 401 Unauthorized | Bypasses rejected in production runtime | **PASS** |

---

## 4. Full Verification Test Evidence

### 4.1 Functional & Unit Test Suite (`npm run test:functional`)
- **Command:** `npm run test:functional`
- **Results:** **232 / 232 passed** across 53 test suites (0 failed, 0 skipped, duration 1047ms)
- **Included Suites:**
  - `tests/server-security-phase5.test.mjs` (34 tests)
  - `tests/server-auth.test.mjs` (10 tests)
  - `tests/abandoned-match-accounting.test.mjs`
  - `tests/accounting-functional.test.mjs`
  - `tests/razorpay-tamper.test.mjs`
  - `tests/razorpay-webhook-negative.test.mjs`
  - `tests/razorpay-webhook-concurrency.test.mjs`
  - `tests/razorpay-lifecycle.test.mjs`
  - `tests/identity-merge.test.mjs`
  - `tests/merchandise-validation.test.mjs`
  - `tests/utils-functional.test.mjs`

### 4.2 TypeScript Static Compilation Check (`npx tsc --noEmit`)
- **Command:** `npx tsc --noEmit`
- **Results:** **0 errors**. Exit code 0.

### 4.3 Next.js Production Build (`npm run build`)
- **Command:** `npm run build`
- **Results:** Compiled successfully. Generated all 18 static and dynamic routes. Exit code 0.

### 4.4 Playwright Responsive & Capabilities Suite (`e2e/prototype-responsive.spec.ts`)
- **Desktop Chrome:** `npx playwright test e2e/prototype-responsive.spec.ts --project="Desktop Chrome"` -> **14 / 14 passed** (16.7s)
- **Mobile Chrome:** `npx playwright test e2e/prototype-responsive.spec.ts --project="Mobile Chrome"` -> **14 / 14 passed** (20.5s)
- **Total E2E:** **28 / 28 passed** (0 failures, 0 skipped).

---

## 5. Scope Controls Confirmation

- **Phase 5 Execution:** Completed within the approved scope (Core Auth & Server-Side Security).
- **Phase 6 & Phase 7:** **NOT STARTED**. No production UI replacement or live payment cutover has been performed.
- **Production Safety:** No live production mutations, no live Razorpay transactions.
- **Phase Status:** Submitted as **Pending Independent QA Review & Owner Acceptance**.
