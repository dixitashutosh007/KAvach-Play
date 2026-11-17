# KAvach Play — Phase 0: Baseline & Security Readiness Audit Report

**Date:** 2026-11-17  
**Branch:** `mig-mov`  
**Current HEAD Commit SHA:** `06dd03ec4272a3c82a2eb49d1a5abcacb6e5f1dd`  
**Baseline Review SHA:** `06dd03ec4272a3c82a2eb49d1a5abcacb6e5f1dd` (Matches HEAD exactly, clean working tree)  
**Author:** Gemini in Google Antigravity (Senior Security Architect & QA Lead)  
**Governing Standard:** [AGENTS.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/AGENTS.md)

---

## 1. Executive Summary

This Phase 0 Baseline Audit establishes the current state of authentication, authorization, admin authority, and security boundaries in KAvach Play before executing any remediation changes.

### Current Security Architecture Snapshot
- **Authentication:** Firebase Authentication (Google OAuth popup, Email/Password, and Anonymous) is the sole identity provider.
- **Super-Admin Authority (Firestore Rules):** `firestore.rules` relies on `request.auth.token.get('admin', false) == true` (Firebase Auth Custom Claims). The legacy `data.role == 'admin'` fallback was removed from `isSuperAdmin()`.
- **Specialist Admin Authority (Firestore Rules):** Four specialist roles (`isStudioAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isClubAdmin`) inherit from `isSuperAdmin()` OR read Boolean flags in `/databases/$(database)/documents/appUsers/$(request.auth.uid)`.
- **Server API Guard:** [lib/server-auth.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/server-auth.ts) provides `requireAdmin(req)` which validates `decoded.admin === true`. However, an emergency fallback `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK === "true"` remains in the source code.
- **Client-Side Authorization:** Multiple client components still evaluate `appUser?.role === "admin" || hasAdminClaim` for UI visibility. A user with a forged `role: "admin"` document in Firestore will see the administrative UI (though Firestore rules block actual mutations).
- **Quality Gates:** 184 functional unit tests, 34 Cloud Firestore Emulator tests, clean TypeScript strict typecheck (0 errors), ESLint (0 errors), and clean Next.js 15 production build.

---

## 2. Files Reviewed

1. **Security Rules & Server Auth:**
   - [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules) (591 lines)
   - [lib/server-auth.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/server-auth.ts) (157 lines)
2. **Authentication & Identity Contexts:**
   - [components/AuthProvider.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/AuthProvider.tsx) (246 lines)
   - [app/page.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/page.tsx) (1321 lines)
   - [components/EditPlayerInline.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/EditPlayerInline.tsx) (655 lines)
   - [components/SettingsTab.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/SettingsTab.tsx) (1625 lines)
   - [components/ProfileTab.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/ProfileTab.tsx) (371 lines)
   - [components/MatchesTab.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/MatchesTab.tsx) (1050 lines)
   - [components/MatchCalendarView.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/MatchCalendarView.tsx) (350 lines)
3. **Server API Routes (All 8 Protected Routes):**
   - [app/api/calendar/sync/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/calendar/sync/route.ts)
   - [app/api/admin/generate-kavach-ids/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/admin/generate-kavach-ids/route.ts)
   - [app/api/admin/merge-players/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/admin/merge-players/route.ts)
   - [app/api/admin/reconcile-abandoned/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/admin/reconcile-abandoned/route.ts)
   - [app/api/email/send/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/email/send/route.ts)
   - [app/api/whatsapp/remind-studio/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/whatsapp/remind-studio/route.ts)
   - [app/api/whatsapp/invite/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/whatsapp/invite/route.ts)
   - [app/api/whatsapp/send/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/whatsapp/send/route.ts)
4. **Admin Claims Migration & Provisioning Tools:**
   - [scripts/migrate-admin-claims.js](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/scripts/migrate-admin-claims.js) (220 lines)
   - [scripts/set-admin-claim.js](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/scripts/set-admin-claim.js) (73 lines)
   - [docs/admin-custom-claim.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/docs/admin-custom-claim.md)
5. **Automated Tests:**
   - [tests/server-auth.test.mjs](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/tests/server-auth.test.mjs)
   - [tests/firestore-rules.test.mjs](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/tests/firestore-rules.test.mjs)

---

## 3. Comprehensive Administrative Privilege Inventory

Every place in the codebase where administrative privileges are granted, checked, inherited, or revoked was inventoried:

### 3.1 Granting Authority
| Mechanism | Target | Code Location | Security Boundary |
|---|---|---|---|
| Firebase Auth Custom Claim | Super Admin (`admin: true`) | `scripts/set-admin-claim.js`<br>`scripts/migrate-admin-claims.js` | Authoritative cryptographic claim signed by Firebase Auth server private key. |
| Firestore Doc Field Write | Specialist Admin Flags (`isStudioAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isClubAdmin`, `isDesigner`) | `components/EditPlayerInline.tsx:380-442` | Direct Firestore write to `appUsers/{uid}`. Permitted only if caller is `isSuperAdmin()`. |
| Firestore Doc Role Write | `role: "admin"` | `components/EditPlayerInline.tsx:387` | Direct Firestore write to `appUsers/{uid}`. Permitted only if caller is `isSuperAdmin()`. |

> [!WARNING]
> **Architectural Disconnect in Role Assignment:** When a super-admin toggles "Super Admin" in `EditPlayerInline.tsx`, it executes `store.updateAppUserProfile(uid, { role: "admin", isStudioAdmin: true, ... })`. This updates the Firestore document, but **does not grant the Firebase Auth custom claim (`{ admin: true }`)**. Because `firestore.rules` now strictly requires `request.auth.token.admin == true`, that newly assigned user cannot perform super-admin operations in Firestore until an offline script runs.

### 3.2 Checking Authority
| Subsystem | Authority Checked | Code Location | Behavior |
|---|---|---|---|
| **Firestore Rules** | Super Admin | `firestore.rules:21-25` (`isSuperAdmin`) | Checks `request.auth.token.get('admin', false) == true`. Role fallback completely removed. |
| **Firestore Rules** | Studio Admin | `firestore.rules:27-31` (`isStudioAdmin`) | `isSuperAdmin() \|\| appUsers/{uid}.isStudioAdmin == true` |
| **Firestore Rules** | Match Admin | `firestore.rules:33-37` (`isMatchAdmin`) | `isSuperAdmin() \|\| appUsers/{uid}.isMatchAdmin == true` |
| **Firestore Rules** | Finance Admin | `firestore.rules:39-43` (`isFinanceAdmin`) | `isSuperAdmin() \|\| appUsers/{uid}.isFinanceAdmin == true` |
| **Firestore Rules** | Club Admin | `firestore.rules:45-49` (`isClubAdmin`) | `isSuperAdmin() \|\| appUsers/{uid}.isClubAdmin == true` |
| **Firestore Rules** | Any Admin | `firestore.rules:51-53` (`isAnyAdmin`) | Any of the above 5 roles. |
| **Server API Routes** | Super Admin | `lib/server-auth.ts:125` (`requireAdmin`) | Checks `decoded.admin === true`. |
| **Server API Routes** | Legacy Role Fallback | `lib/server-auth.ts:130-148` (`requireAdmin`) | Checks `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK === "true"` -> reads `appUsers/{uid}.role === "admin"`. |
| **Client UI Routing** | Super Admin | `app/page.tsx:557-558` | Checks `appUser?.role === "admin" \|\| hasAdminClaim`. |
| **Client Settings** | Admin Access | `components/SettingsTab.tsx:34` | Checks `currentUserRecord?.role === "admin" \|\| hasAdminClaim`. |
| **Client Profiles** | Admin Access | `components/ProfileTab.tsx:45` | Checks `appUser?.role === "admin" \|\| hasAdminClaim`. |
| **Client Matches** | Match Admin | `components/MatchesTab.tsx:287` | Checks `currentUserObj?.role === "admin" \|\| hasAdminClaim`. |

### 3.3 Inheriting Authority
- `isSuperAdmin()` inherits full access across all specialist domains (`isStudioAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isClubAdmin`, `isAnyAdmin`) in both `firestore.rules` and `app/page.tsx`.
- Specialist admins (`isStudioAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isClubAdmin`) do NOT inherit Super Admin privileges.
- In `firestore.rules`, `isClubAdmin()` has update access to `/appUsers/{userId}`, but is strictly prevented by field-diff rules from escalating `['role', 'isSuperAdmin', 'isStudioAdmin', 'isMatchAdmin', 'isFinanceAdmin', 'isClubAdmin', 'isDesigner', 'canDesign', 'status']`.

### 3.4 Revoking Authority
- Custom claim revocation: `node scripts/set-admin-claim.js <email> --revoke`.
- In Firestore: Super-admin can toggle off flags in `EditPlayerInline.tsx`.
- **Latency / Semantics:** Firebase ID tokens cache claims on the client for up to 60 minutes unless `auth.currentUser.getIdToken(true)` is invoked or the user signs out and in.

---

## 4. Current Audit Findings & Defect Register

| Finding ID | Severity | Area | Description | Status |
|---|---|---|---|---|
| **SEC-001-A** | P1 | `lib/server-auth.ts` | `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK` remains in code. If toggled on, server trusts editable `appUsers.role == 'admin'`. Must be completely removed. | **Confirmed Defect** |
| **SEC-001-B** | P1 | Client UI (`app/page.tsx`, etc.) | Client evaluates `appUser?.role === "admin" \|\| hasAdminClaim`. Forged Firestore document causes UI to show Admin Console. Must be decoupled to claim-only for super-admin. | **Confirmed Defect** |
| **SEC-001-C** | P1 | `tests/server-auth.test.mjs` | Test re-implements a fake `evaluateAdminAuthorization()` function instead of importing production `requireAdmin` (violates QA-001). | **Confirmed Defect** |
| **SEC-001-D** | P1 | `EditPlayerInline.tsx` | Super Admin toggle in UI updates Firestore doc `role: "admin"` but cannot update custom claims, leading to desynchronization between UI and security rules. | **Confirmed Defect** |
| **SEC-001-E** | P2 | `firestore.rules` Tests | `tests/firestore-rules.test.mjs` does not have negative tests asserting that a forged `role: "admin"` document without custom claim fails super-admin operations. | **Confirmed Gap** |
| **SEC-001-F** | P2 | Operational | No checked-in approved allowlist template (`config/admin-allowlist.json`) exists for production migration governance. | **Confirmed Gap** |

---

## 5. Proposed Phase 1 Scope (SEC-001 Lockdown)

### 5.1 Architecture Target
1. **Zero Role Fallbacks on Server:** Delete `ALLOW_LEGACY_ADMIN_ROLE_FALLBACK` completely from `lib/server-auth.ts`. `requireAdmin` strictly requires `decoded.admin === true`.
2. **Client UI Super-Admin Decoupling:** In `app/page.tsx`, `components/SettingsTab.tsx`, `components/ProfileTab.tsx`, `components/MatchesTab.tsx`, `components/MatchCalendarView.tsx`, and `components/EditPlayerInline.tsx`, derive `isSuperAdmin` strictly from `hasAdminClaim === true`.
3. **Synchronize Super-Admin Assignment:** In `EditPlayerInline.tsx`, disable direct client-side toggling of "Super Admin" and surface a clear badge/tooltip explaining that Super Admin requires server-side custom claim provisioning. Specialist roles (`isStudioAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isClubAdmin`, `isDesigner`) remain manageable by super-admins.
4. **Fix Test Quality (QA-001):** Replace fake evaluator in `tests/server-auth.test.mjs` with tests executing the actual `requireAdmin` function with mocked token verification.
5. **Comprehensive Emulator Tests:** Add live Firestore Emulator test cases in `tests/firestore-rules.test.mjs`:
   - Forged `appUsers` document with `role: "admin"` fails super-admin rules.
   - User with `admin: true` custom claim succeeds.
   - Specialist admin permissions remain functional for assigned collections and blocked for unassigned collections.
6. **Admin Allowlist & Migration Deliverables:**
   - Create `config/admin-allowlist.json` template.
   - Produce `docs/qa/PHASE_1_ADMIN_INVENTORY.md` and `docs/qa/PHASE_1_PRODUCTION_MIGRATION_PLAN.md`.
   - Never execute migration against production.

---

## 6. Global Quality Gates Baseline

Executed baseline quality gates on current commit `06dd03ec4272a3c82a2eb49d1a5abcacb6e5f1dd`:
- `npm run test:functional`: **184 passed, 0 failed** (702ms)
- `npm run test:emulator`: **34 passed, 0 failed** (10.3s)
- `npx tsc --noEmit`: **0 errors**
- `npm run lint`: **0 errors** (4 open-read warnings)
- `npm run build`: **Clean Next.js 15 production build (17/17 pages)**

---

## 7. Phase 0 Gate & Approval Request

Phase 0 Baseline and Security Readiness Audit is complete. **Zero application code has been modified.**

Awaiting product owner approval to proceed to **PHASE 1 — SEC-001: Complete Admin Privilege and Role-Escalation Lockdown**.
