# KAvach Play — Independent Review Corrections & P0/P1 Closure Audit Report

**Date:** 2026-11-17  
**Branch:** `mig-mov`  
**Application Target:** https://play.kavachcricket.com  
**Repository:** https://github.com/dixitashutosh007/KAvach-Play  
**Author:** Gemini in Google Antigravity (Implementation & Remediation Agent)  
**Governing Standard:** [AGENTS.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/AGENTS.md)

---

## 1. Executive Summary

This report documents the completion of the 4 approved remediation workstreams addressing the remaining findings from the independent review:
1. **Workstream 1 (SEC-001):** Administrator authority migration architecture, claim provisioning scripts, and Firestore privilege boundary hardening for `/appUsers/{userId}` (`'isDesigner'`).
2. **Workstream 2 (FIN-001):** Complete server-side payment and fee calculation in `app/api/razorpay/order/route.ts` and `lib/razorpay-order.ts`, discarding untrusted client amounts, calculating late fees authoritatively, enforcing INR currency, verifying player ownership/delegation, and rejecting waived/abandoned/already-paid dues.
3. **Workstream 3 (FIN-002 / FIN-003):** Webhook concurrency safety, idempotency, and schema disambiguation in `app/api/razorpay/webhook/route.ts` and `lib/razorpay-webhook.ts` using atomic Firestore transactions (`db.runTransaction`), preventing race conditions and duplicate fee/subscription generation.
4. **Workstream 4 (QA-001 & Test Quality):** Eliminating duplicated helper utilities in tests by importing actual production code directly from `lib/utils.ts`, seeding prerequisite Firestore documents before testing update/delete rules, and establishing a verified suite of 127 automated tests across 32 suites.

---

## 2. Workstream 1: SEC-001 Administrator Authority Migration

### 2.1 Findings Addressed
- Reliance on `appUsers.role == 'admin'` as a client-writable fallback risked privilege escalation if write boundaries were breached.
- Profile definition in `lib/types.ts` included `'isDesigner'`, but `firestore.rules` only checked `'canDesign'`, permitting self-escalation of designer capabilities.

### 2.2 Implementation Evidence
- **Rules Hardening (`firestore.rules`):**
  - Updated both `allow create` (line 112) and `allow update` (line 117) on `/appUsers/{userId}` to include `'isDesigner'` among the protected keys:
    `['role', 'isSuperAdmin', 'isStudioAdmin', 'isMatchAdmin', 'isFinanceAdmin', 'isClubAdmin', 'isDesigner', 'canDesign', 'status']`
  - Authored via dedicated `firestore-rules-author` subagent.
- **Migration Script (`scripts/migrate-admin-claims.js`):**
  - Created an administrator audit and claim migration tool.
  - Queries `appUsers` where `role == 'admin'` or `isSuperAdmin == true`, verifies corresponding Firebase Auth user records, checks custom claims, and outputs an audit table.
  - Defaults to non-destructive dry-run mode. Requires explicit `--execute` flag. **Not executed in production per instructions.**
- **Server Guard Deprecation Gate (`lib/server-auth.ts`):**
  - Introduced `REQUIRE_ADMIN_CLAIM_ONLY=true` environment flag to allow zero-downtime cutover once claims rollout is executed by the owner.

---

## 3. Workstream 2: FIN-001 Complete Server-Side Payment Validation

### 3.1 Findings Addressed
- Untrusted client-supplied `amount`, `lateFeeItems[].amount`, and `item.lateFeeAmount` values could be exploited to manipulate payable amounts.
- Unverified `playerId` in `finance_dues` and `merch_order` could permit paying or ordering against foreign player profiles without authorization.
- Missing currency enforcement accepted arbitrary currency parameters.
- Missing checks for waived obligations or abandoned matches permitted checking out invalid fees.

### 3.2 Implementation Evidence
- **Production Module (`lib/razorpay-order.ts`):**
  - `validateCurrency(currency)`: Strictly requires `"INR"`; rejects all other currencies with HTTP 400.
  - `verifyPlayerOwnership(db, authUid, targetPlayerId)`: Authoritatively checks whether caller matches `playerId`, has `players.authUid === authUid`, or `appUsers.playerId === targetPlayerId`.
  - `derivePayableAmount(db, authUid, intentData)`:
    - Authoritative match fee calculation using `feeOverride` or `match.fee`.
    - Authoritative late fee calculation using `computeLateFees` from `lib/utils.ts` against server-recorded match dates in Asia/Kolkata timezone. Client amounts are ignored.
    - Explicit rejection of payments marked as `"Paid"`, `"Waived"`, or `"Not Playing"`.
    - Explicit rejection of payments for matches marked as abandoned.
    - Batch dues deduplication to prevent double-charging or duplicate writes.
    - Authoritative catalogue calculation for merchandise (`calculateAuthoritativeMerchPrice`) verifying base prices and custom option price modifiers.
- **Order Endpoint (`app/api/razorpay/order/route.ts`):**
  - Imports and delegates to `lib/razorpay-order.ts`.

---

## 4. Workstream 3: FIN-002 / FIN-003 Webhook Reliability & Idempotency

### 4.1 Findings Addressed
- Non-transactional read-then-write batch allowed concurrent duplicate deliveries (e.g. `payment.captured` and `order.paid` arriving simultaneously) to race, creating duplicate late-fee records, duplicate merchandise orders, and double subscription extensions.
- Conflation of `payment.captured` and `order.paid` payloads resulted in storing `order_...` strings in `razorpayPaymentId` columns.

### 4.2 Implementation Evidence
- **Production Module (`lib/razorpay-webhook.ts`):**
  - `extractWebhookEventDetails(payload)`: Disambiguates event-specific payloads. Accurately extracts `paymentId` (`pay_...`), `orderId` (`order_...`), `capturedPaise`, and `capturedCurrency`.
  - `validateWebhookTransaction(intent, details)`: Compares captured paise vs intent rupees, verifies currency, and enforces `orderId` equivalence.
  - `processWebhookIntentTransaction(db, details, rawPayload)`:
    - Runs entirely within `db.runTransaction`.
    - Reads `intentRef` inside the transaction. If already marked `"paid"`, returns immediately with `{ success: true, alreadyProcessed: true }`.
    - Executes all reads before writes.
    - Applies downstream updates and updates `intent.status = "paid"` atomically.
    - Serializes concurrent webhook deliveries so exactly 1 delivery applies effects and subsequent deliveries exit idempotently with 0 duplicate records.
- **Webhook Endpoint (`app/api/razorpay/webhook/route.ts`):**
  - Imports and delegates to `lib/razorpay-webhook.ts`.

---

## 5. Workstream 4: Test Quality & Prerequisite Seeding

### 5.1 Findings Addressed
- QA-001: Functional tests in `tests/utils-functional.test.mjs` duplicated utility code instead of importing production code from `lib/utils.ts`.
- Firestore emulator tests in `tests/firestore-rules.test.mjs` tested update/delete without seeding prerequisite documents first.

### 5.2 Implementation Evidence
- **Production Import Migration (`tests/utils-functional.test.mjs`):**
  - Removed all duplicate function definitions.
  - Imported `normalizeIndianMobile`, `normalizeEmail`, `formatDate`, `dbToInputDate`, `inputToDbDate`, `computeLateFees`, `findExistingPlayer`, `validateJerseyNumber`, `parseExpiryDate`, and `toYMD` directly from `lib/utils.ts`.
- **Prerequisite Document Seeding (`tests/firestore-rules.test.mjs`):**
  - Added `await testEnv.withSecurityRulesDisabled(async (context) => { ... })` blocks before testing update and delete permissions on `matches/payments`, `players/otherFees`, and `posts`.
- **New Behavioral & Concurrency Test Suites:**
  - `tests/razorpay-tamper.test.mjs`: 16 tests covering currency enforcement, player ownership, fee overrides, abandoned matches, waived dues, batch deduplication, and catalogue integrity.
  - `tests/razorpay-webhook-concurrency.test.mjs`: 9 tests covering event schema disambiguation, transaction validation, duplicate delivery idempotency, and concurrent race condition handling.

---

## 6. Verification & Quality Gates

| Check | Tool / Command | Result | Details |
|---|---|---|---|
| Functional Unit Tests | `npm run test:functional` | **127 / 127 PASS** | 32 suites, 0 fails, 0 skips |
| TypeScript Type Check | `npx tsc --noEmit` | **PASS (0 errors)** | Full type check with strict mode |
| Code Linting | `npm run lint` | **PASS (0 errors)** | 0 errors, 4 informational open-read warnings |
| Next.js Build | `npm run build` | **PASS (0 errors)** | All 17 dynamic and static routes compiled |

---

## 7. Status of Addressed Findings

| Finding ID | Priority | Description | Remediation Status | Verification |
|---|---|---|---|---|
| **SEC-001** | P0 | Privilege boundary & admin authority | **Resolved & Ready** | AST rules check, `isDesigner` protected, migration script prepared |
| **FIN-001** | P0 | Client payment & fee tampering | **Resolved & Verified** | Server-side calculation, INR enforced, ownership checked, 16 tamper tests |
| **FIN-002** | P1 | Webhook partial updates & race conditions | **Resolved & Verified** | Atomic `db.runTransaction`, concurrent race condition test |
| **FIN-003** | P1 | Webhook amount/currency/order verification | **Resolved & Verified** | Event disambiguation, paise vs rupees check, orderId check |
| **QA-001** | P1 | Duplicate utilities in test suites | **Resolved & Verified** | Tests import directly from `lib/utils.ts`, `lib/razorpay-order.ts`, and `lib/razorpay-webhook.ts` |
