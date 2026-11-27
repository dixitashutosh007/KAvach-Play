# KAvach Play — Security Review & Remediation History

**Governing Policy:** [`docs/security/SECURITY_BASELINE.md`](SECURITY_BASELINE.md)  
**Branch:** `mig-mov`  
**Current HEAD:** `bf8e2c75735d27487e18892bd0a488efaa58b146` (`bf8e2c7`)

> **Evidence Integrity Rule:** This document distinguishes between (1) code/rules verified in the repository, (2) automated tests executed by the implementation agent, (3) findings reviewed by the independent reviewer (ChatGPT), and (4) items still awaiting independent sign-off or staging/production verification.

---

## 1. Timeline of Security Audits & Remediation Phases

### Phase 0 — Initial Independent Audit & Baseline (`2026-11-15` to `2026-11-17`)
- **Prior Independent Audit (`acff8325b559ec0f7fc9dfa04b75f6a438ee42f5`):** Issued **NO-GO for production**, identifying P0/P1/P2 defects across Firestore rules (`SEC-001`–`SEC-006`), Razorpay/financial flows (`FIN-001`–`FIN-007`), identity linking (`IDT-001`–`IDT-003`), UX, architecture, and test quality (`QA-001`–`QA-003`).
- **Phase 0 Baseline & Risk Register:** Documented in `docs/implementation/SECURITY-RISK-REGISTER.md` and `docs/qa/PHASE_0_SECURITY_BASELINE.md`.

### Phase 1 / Releases 1–3 — Core Security, Payment & Identity Remediation (`2026-11-17` to `2026-11-25`)
- **SEC-001 / Server & Rules Auth Lockdown (`docs/qa/PHASE_1_SEC001_REMEDIATION_REPORT.md`):**
  - Removed legacy `role == "admin"` fallback from `isSuperAdmin()` and `lib/server-auth.ts`.
  - Enforced `checkRevoked: true`, disabled-account fail-closed checks, and `test` bypass isolation.
- **FIN-001 – FIN-004 / Razorpay & Financial Integrity (`docs/qa/PHASE_2_FIN003_REMEDIATION_REPORT.md`, `PHASE_3_CONCURRENCY_STATE_INTEGRITY_REPORT.md`, `FINAL_SECURITY_PAYMENT_REMEDIATION_REPORT.md`):**
  - Server-side `derivePayableAmount()` + `INR` enforcement in `/api/razorpay/order`.
  - Deterministic `paymentReservations` lease locking against duplicate checkout orders.
  - Webhook HMAC verification, captured amount/currency/order matching, idempotent `gatewayPayments`, server-side merchandise/subscription fulfillment, and `webhookDeadLetters` persistence.
  - Environment guard (`arePaymentOperationsEnabled()`) blocking live Razorpay orders on non-production databases.
- **Identity & Player Merge (`SECURITY_REMEDIATION_1A` through `1F_IDENTITY_MERGE_RECOVERY.md`):**
  - Server-authoritative `uidIndex` and `phoneIndex` collections (`allow read, write: if false`).
  - Transactional linking (`lib/account-linking.ts`) and leased/fenced `mergeJobs` (`lib/player-merge.ts`, `/api/admin/merge-players`).
- **Release 3 / D-22 Role Consolidation (`884b224` and subsequent Phase 2 commits):**
  - Retired `isMatchAdmin`, `isStudioAdmin`, `isDesigner`, `canDesign`, `role: "admin"` into Club Admin (D-22).
  - Locked `roleKeys()` on `appUsers` in `firestore.rules` so only `/api/admin/access` and the CLI migration runner can modify roles.

### Phase 2 Final Security Closure (`962e1fb` → `bf8e2c7`)
Iterative independent reviews by **ChatGPT** against Phase 2 diffs drove targeted security hardening across commits:
- `962e1fb`: Authoritative server audits, registration fix, cursor pagination, shared rate limiter, own-player get/list hardening.
- `06df566`: Atomic merge audit, operation-scoped linking audits, `>250` cursor pagination, hashed TTL rate limiter, deterministic TZ tests.
- `e58d678`: Strict create-only server audits (`lib/server-audit.ts`), atomic player lifecycle API (`/api/admin/players`), unbounded client pagination fixes.
- `0dc1da0`: `P2-API-08` directory error/retry state, historical-record delete guard, pagination failure tests.
- `dc2c9a8`: Kept `PATCH /api/admin/players` able to disable players with historical records; restricted `409` history guard to `DELETE`.
- `d0033dc`: `P2-ID-04` durable Super Admin transitions (`roleTransitions`), `P2-DEL-01` complete delete/unlink guards, resumable role consolidation.
- `a01979b`: Fail-closed pending/failed revoke auth (`pendingRevokes` in `firestore.rules` and `getUserAccount()`), consolidation lease & checkpoint resilience, complete player delete guards, Access Control recovery UI.
- `c479ab0`: `Symbol`-branded `WeakSet` migration auth, fenced lease renewal, `clubLeads` delete guard, Access Control reconciliation E2E.
- `e146be2`: Isolated `lib/role-consolidation-runner.ts` from Next.js runtime (`NEXT_RUNTIME` guard), single-transaction TOCTOU lease fencing, and plan fingerprinting.
- `bf8e2c7` (Current HEAD): Enforced exact SHA-256 `planFingerprint` and already-migrated tamper checks on resume and completion, with expanded emulator regression tests.

---

## 2. Current Phase 2 Closure Position (Verification Status)

### 2.1 Implemented Controls (Verified in Current Source on `mig-mov` @ `bf8e2c7`)
- **Authentication & Fail-Closed RBAC:** `lib/server-auth.ts` (`checkRevoked: true`, fail-closed `503`, `pendingRevokes` fail-closed check in `getUserAccount()` and `firestore.rules`), D-22 3-role enforcement (`superAdmin`, `clubAdmin`, `financeAdmin`), retired flags grant zero privileges.
- **Role Management & Transitions:** `/api/admin/access` + `lib/access-control-server.ts` with `roleTransitions`, `pendingRevokes`, last-Super-Admin protection, refresh-token revocation, and reconciliation UI.
- **Role Consolidation Runner:** `lib/role-consolidation-runner.ts` + `scripts/migrate-role-consolidation.mjs` isolated from Next.js routes, `NEXT_RUNTIME` rejection, credential-backed `Symbol`/`WeakSet` capability, atomic batch transaction fencing, and SHA-256 `planFingerprint` verification.
- **Player Lifecycle & Identity Linking:** `DELETE /api/admin/players` 20-query + `feePlanIds` history guard, `inspectAndUnlinkPlayerIdentityInTx` (`?unlink=true`), `lib/account-linking.ts` transactional `uidIndex`/`phoneIndex` checks, and `lib/player-merge.ts` leased merges.
- **PII & Directory Projections:** `players` list restricted to `isClubAdmin()` in `firestore.rules`; `/api/players/public` (`PUBLIC_PLAYER_FIELDS` + `checkSharedRateLimit`); `/api/finance/players` (`FINANCE_PLAYER_FIELDS` only).
- **Financial & Razorpay Controls:** Server `derivePayableAmount`, `paymentReservations`, webhook HMAC + idempotency + `webhookDeadLetters`, abandoned-match Option A waiver.
- **Server Audit Integrity:** `lib/server-audit.ts` create-only custom IDs, `/api/audit/log` server-derived actor/timestamp and PII redaction, `firestore.rules` denying client writes to `auditLogs`.

### 2.2 Controls Reported as Tested by the Implementation Agent
The implementation agent (Antigravity) executed and reported the following results against the `bf8e2c7` codebase (no independent agent re-executed these suites locally):
- `npx tsc --noEmit`: 0 errors.
- `npm run lint`: 0 errors (4 pre-existing `@firebase/security-rules/no-open-reads` warnings in `firestore.rules`).
- `npm run test:functional` (default TZ and `TZ=Asia/Kolkata`): 1,284 passed, 0 failed, 0 skipped across 291 suites (emulator-only suites are gated out of `test:functional` when `FIRESTORE_EMULATOR_HOST` is unset and run under `test:emulator`).
- `npm run test:emulator`: 562 passed, 0 failed, 0 skipped across 50 suites (including all 10 tests in `tests/phase2-final-security.emulator.test.mjs`).
- `npm run build`: passed (43/43 static pages).
- `npx playwright test e2e/access-control-reconciliation.spec.ts --project="Desktop Chrome" --project="Mobile Chrome"`: 4 passed, 0 failed, 0 skipped.

### 2.3 Independently Reviewed Controls
- **ChatGPT (Independent Read-Only Reviewer):** Reviewed successive Phase 2 diffs (`962e1fb` through `e146be2`), confirming improvements across audit integrity, pagination, rate limiting, Super Admin claim consistency, fail-closed revocation, player delete/unlink guards, and migration runner isolation, and requested the `bf8e2c7` evidence package for final Phase 2 security sign-off.
- **Pending Sign-Off:** Formal ChatGPT sign-off on `bf8e2c7` (`planFingerprint` & already-migrated tamper checks) has not yet been recorded as received in this repository.

### 2.4 Outstanding Verification Items
1. **Formal Phase 2 Independent Sign-Off:** Reviewer acceptance of the `bf8e2c7` source-level evidence package.
2. **Staging Environment Confirmation (`OD-01`):** Product owner confirmation of a dedicated staging URL / Firebase database mapping before running live deployment or staging E2E tests.
3. **Pre-Deploy Role Consolidation Migration:** Running `node scripts/migrate-role-consolidation.mjs --database=<id>` (dry-run review, then `--execute` with owner approval) **before** deploying D-22 rules/app to production.
4. **Residual Rule Alignment Check:** Confirming whether legacy `isMatchAdminPaymentCreate` / `isMatchAdminPaymentUpdate` (which now resolve to `isClubAdmin()` via `isMatchAdmin()` alias) should remain as-is for match-day collection or be further narrowed in a future release.
5. **Production Deployment Approval:** Explicit product owner authorization (`AGENTS.md` §3).

### 2.5 Accepted Residual Risks
Tracked in [`docs/security/ACCEPTED_RISKS.md`](ACCEPTED_RISKS.md).
