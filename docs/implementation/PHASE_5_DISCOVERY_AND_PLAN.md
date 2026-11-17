# KAvach Play — Phase 5 Discovery Report & Implementation Plan
## Core Auth & Server-Side Security

**Document Type:** Formal Phase Discovery & Execution Plan  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Baseline Commit SHA:** `e21388a9a02fa78f9f5e9f1c69409125cbfa25e4`  
**Governing Standard:** `AGENTS.md`, `DECISION-LOG.md` (D-08, D-09, D-10), Active Remediation Master Plan Track  
**Date:** 2026-11-17  
**Status:** In Progress (Phase 5 Only)

---

## 1. Verified Repository Baseline

- **Current Branch:** `mig-mov`
- **Remote Tracking:** Up to date with `origin/mig-mov`
- **Exact Baseline Commit SHA:** `e21388a9a02fa78f9f5e9f1c69409125cbfa25e4`
- **Working Tree:** Clean (0 uncommitted, 0 untracked files)
- **Runtime Environment:** Node.js `v24.15.0`, npm `12.0.1`, Next.js `15.0.0`, macOS arm64

---

## 2. Phase 5 Source-Code Discovery Report

### 2.1 Server-Side Authentication & Authorization (`lib/server-auth.ts`)
- **Current State:**
  - Exports `requireAuth(req)` and `requireAdmin(req)`.
  - `requireAdmin(req)` strictly validates Firebase Auth custom claim `{ admin: true }` with `checkRevoked: true` (closing SEC-001 at the Super Admin tier).
  - **Findings & Defect Gaps:**
    1. **Lack of Granular Server-Side RBAC:** The six approved roles from `AGENTS.md` and Decision `D-08` (`superAdmin`, `clubAdmin`, `matchAdmin`, `financeAdmin`, `studioAdmin`, `isDesigner`) are not distinguishable by server-side guards. Endpoints currently either allow all authenticated users (`requireAuth`) or require global Super Admin (`requireAdmin`).
    2. **No Account Status Enforcement:** `requireAuth(req)` does not verify if an account is marked `status: 'Disabled'` in Firestore `/appUsers/{uid}`. A disabled user with an unexpired session token can still invoke endpoints.
    3. **Missing Role-Specific Guards:** Privileged endpoints such as `reconcile-abandoned` (Finance Admin) or `calendar/sync` (Match Admin) cannot be accessed by legitimate scoped administrators without granting them blanket `admin: true` custom claims.

### 2.2 Audit of Sensitive API Routes
- **`app/api/email/send/route.ts`:**
  - **Vulnerability:** Parses request body (`req.json()`), queries Firestore for `appConfig/default`, and validates recipients *before* invoking `requireAdmin(req)` on line 42. Unauthenticated attackers or crawlers could force JSON parsing and database lookups before authentication is verified.
- **`app/api/admin/reconcile-abandoned/route.ts`:**
  - Implements Option A abandoned match reconciliation. Currently protected by `requireAdmin(req)`. Should authoritatively permit both `superAdmin` and `financeAdmin`.
- **`app/api/admin/merge-players/route.ts`:**
  - Implements duplicate player profile merge. Currently requires `requireAdmin(req)`. Should permit `superAdmin` and `clubAdmin`.
- **`app/api/admin/generate-kavach-ids/route.ts`:**
  - Generates Kavach IDs for players. Currently requires `requireAdmin(req)`. Should permit `superAdmin` and `clubAdmin`.
- **`app/api/calendar/sync/route.ts`:**
  - Syncs matches to Google Calendar. Currently requires `requireAdmin(req)`. Should permit `superAdmin`, `clubAdmin`, and `matchAdmin`.
- **`app/api/whatsapp/send/route.ts`, `app/api/whatsapp/invite/route.ts`, `app/api/whatsapp/remind-studio/route.ts`:**
  - WhatsApp notification endpoints. Should enforce role-specific authorization (`financeAdmin` for payment reminders, `clubAdmin` for invitations, `studioAdmin` for studio expiration reminders).
- **`app/api/razorpay/order/route.ts` & `lib/razorpay-order.ts`:**
  - Enforces currency INR. Derives payable amount authoritatively server-side (`derivePayableAmount`). Client-supplied amounts are discarded. Implements concurrency-safe payment reservations.
  - **Ownership Edge Case:** In `verifyPlayerOwnership(db, authUid, targetPlayerId)`, `if (targetPlayerId === authUid) return true;` must verify that the target player record is actually bound to `authUid` and that caller account status is active (`status !== 'Disabled'`).
- **`app/api/razorpay/webhook/route.ts` & `lib/razorpay-webhook.ts`:**
  - Enforces HMAC SHA256 timing-safe signature verification over raw request body text. Validates captured amount in paise, currency, payment ID starting with `pay_`, and order ID against stored intent. Executes mutations atomically in a Firestore transaction. Idempotent on already-paid intents.

---

## 3. Existing Security and Financial Defect Mapping

| Defect ID | Description | Historical Severity | Phase 5 Server-Side Remediation |
|---|---|---|---|
| **SEC-001** | Privilege Escalation via client-controlled roles | P0 | Strict server-side RBAC: Custom claims (`admin: true`) for Super Admin; authoritative `/appUsers/{uid}` flags (`isFinanceAdmin`, `isMatchAdmin`, etc.) verified server-side; client role parameters completely ignored. |
| **SEC-002** | Payment status manipulation | P0 | Client-side status updates to `Paid` prohibited; only server webhook inside atomic Firestore transaction or trusted server-side manual collection can mark obligations `Paid`. |
| **SEC-003** | Fee tampering | P1 | `derivePayableAmount` derives amounts authoritatively from match, dues, and subscription records; client-submitted amount is discarded. |
| **FIN-001** | Razorpay order amount verification | P0 | Order generation route derives payable amount server-side; strict INR currency check. |
| **FIN-002** | Durable webhook transaction | P1 | Webhook executes within `db.runTransaction()`; atomic updates to payments, fees, subscriptions, and intents. |
| **FIN-003** | Webhook payload & intent validation | P1 | Compares orderId, paymentId (`pay_*`), amount in paise, and currency against stored intent before applying effects. |
| **FIN-005** | Abandoned match obligation exclusion | P1 | Server rejects order generation for abandoned matches (`abandoned: true` or `status: 'abandoned'`) with 400 error. |
| **IDT-001** | Identity & Player Ownership | P1 | Strict player ownership verification in `lib/razorpay-order.ts`; verifies `appUsers.playerId` and `players.authUid` without assuming `uid === playerId`. |

---

## 4. Detailed Implementation Plan

1. **Server-Side Granular RBAC (`lib/server-auth.ts`):**
   - Export role types: `AppRole = "superAdmin" | "clubAdmin" | "matchAdmin" | "financeAdmin" | "studioAdmin" | "isDesigner" | "player"`.
   - Implement `getUserRoles(db, uid, decodedToken)`:
     - Check `decodedToken.admin === true` -> grants `superAdmin` and all subordinate roles.
     - Query authoritative `/appUsers/{uid}` document via Firebase Admin SDK.
     - Extract `isSuperAdmin`, `isClubAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isStudioAdmin`, `isDesigner`, `status`, `playerId`.
     - If `status === 'Disabled'`, reject caller with 403 Account Disabled.
   - Implement `requireRole(req: Request, allowedRoles: AppRole[])`:
     - Checks Bearer token.
     - If caller has any of `allowedRoles`, return `{ ok: true, uid, email, roles, playerId }`.
     - Otherwise return 403 Forbidden.
   - Implement convenient role helpers:
     - `requireSuperAdmin(req)`
     - `requireClubAdmin(req)` (allows `clubAdmin`, `superAdmin`)
     - `requireMatchAdmin(req)` (allows `matchAdmin`, `clubAdmin`, `superAdmin`)
     - `requireFinanceAdmin(req)` (allows `financeAdmin`, `superAdmin`)
     - `requireStudioAdmin(req)` (allows `studioAdmin`, `superAdmin`)
   - Add deterministic test bypass hooks in test mode (`x-test-role`, `x-test-status`, `x-test-admin`).

2. **Harden API Route Guards & Execution Order:**
   - `app/api/email/send/route.ts`: Move authentication guard (`requireClubAdmin(req)`) to line 1 of the route handler, *before* parsing request body or loading config.
   - Update `reconcile-abandoned`, `merge-players`, `generate-kavach-ids`, `calendar/sync`, and `whatsapp/*` endpoints to use granular role guards.

3. **Harden Razorpay Order & Player Ownership (`lib/razorpay-order.ts`):**
   - Enhance `verifyPlayerOwnership` to strictly verify that `authUid` is associated with `targetPlayerId` in `players` doc (`authUid`) or `appUsers` doc (`playerId`).
   - Add account status verification: ensure disabled accounts cannot create orders.

4. **Add Comprehensive Security Test Suite (`tests/server-security-phase5.test.mjs`):**
   - Exercise all 11 mandatory security test scenarios specified in the master plan.

---

## 5. Files and Services Expected to Change

- `lib/server-auth.ts` (Core authentication & granular RBAC)
- `lib/razorpay-order.ts` (Player ownership verification & active status enforcement)
- `app/api/email/send/route.ts` (Security guard ordering & clubAdmin authorization)
- `app/api/admin/reconcile-abandoned/route.ts` (Granular financeAdmin guard)
- `app/api/admin/merge-players/route.ts` (Granular clubAdmin guard)
- `app/api/admin/generate-kavach-ids/route.ts` (Granular clubAdmin guard)
- `app/api/calendar/sync/route.ts` (Granular matchAdmin guard)
- `app/api/whatsapp/send/route.ts` (Granular financeAdmin guard)
- `app/api/whatsapp/invite/route.ts` (Granular clubAdmin guard)
- `app/api/whatsapp/remind-studio/route.ts` (Granular studioAdmin guard)
- `tests/server-security-phase5.test.mjs` (New test suite for Phase 5 scenarios)
- `docs/implementation/PHASE-TRACKER.md` (Update active track)
- `docs/qa/PHASE_5_SECURITY_EVIDENCE.md` (Evidence document)

---

## 6. Test Coverage Gaps

- Missing automated tests for granular RBAC cross-role boundaries (e.g. Match Admin attempting Finance Admin actions).
- Missing automated test verifying that `email/send` rejects unauthenticated requests before body parsing.
- Missing automated test ensuring disabled accounts are blocked from generating payment orders.

---

## 7. Risks and Dependencies

- **Risk:** Existing tests or admin UI calling endpoints without the required role.  
  *Mitigation:* Super Admin custom claim (`admin: true`) retains universal access across all administrative hubs, preserving full backward compatibility.
- **Risk:** Latency on Firestore lookups for `/appUsers/{uid}` in API routes.  
  *Mitigation:* Read single document `/appUsers/{uid}` using Admin SDK with minimal field selection; cache roles where appropriate.

---

## 8. Phase 5 Execution Sequence

1. Persist discovery report (`docs/implementation/PHASE_5_DISCOVERY_AND_PLAN.md`).
2. Update `lib/server-auth.ts` with granular RBAC and account status validation.
3. Update API routes with granular guards and corrected authentication order.
4. Refine `lib/razorpay-order.ts` player ownership validation and account status checks.
5. Create `tests/server-security-phase5.test.mjs` covering all 11 security scenarios.
6. Run full verification suite (`npm run test:functional`, `npx tsc --noEmit`, `npm run build`).
7. Document QA evidence in `docs/qa/PHASE_5_SECURITY_EVIDENCE.md` and update `docs/implementation/PHASE-TRACKER.md`.
8. Commit Phase 5 to `mig-mov` and stop for independent review.
