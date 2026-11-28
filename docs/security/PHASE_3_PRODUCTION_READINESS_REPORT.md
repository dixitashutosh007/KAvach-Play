# KAvach Play 2.0 — Phase 3: Consolidated Production Readiness Report

**Repository:** `https://github.com/dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Security Governance Commit:** `598784424b03cfb607353816582df5917eb2e0dc` (`5987844`)  
**Phase 2 Final Remediation Commit:** `bf8e2c75735d27487e18892bd0a488efaa58b146` (`bf8e2c7`)  
**Governing Policy:** [`docs/security/SECURITY_BASELINE.md`](SECURITY_BASELINE.md)  
**Assessment Date:** `2026-11-27`

---

## 1. Executive Summary

KAvach Play is a private cricket club operations and financial management application serving approximately **300 members** of KAvach Cricket Club. Evaluated against [`docs/security/SECURITY_BASELINE.md`](SECURITY_BASELINE.md) and [`docs/security/THREAT_MODEL.md`](THREAT_MODEL.md):

- **P0 (Critical / Launch Blocker):** **0**
- **P1 (Important / Operational Pre-Launch Gates):** **2** (`OPS-P1-01` pre-deploy D-22 role consolidation migration & staging confirmation `OD-01`; `OPS-P1-02` operational backup/secret/MFA verification outside source control — plus `AR-04`/`AR-06` tracked in [`ACCEPTED_RISKS.md`](ACCEPTED_RISKS.md))
- **P2 (Hardening / Post-Launch):** **3** (all non-blocking: `FS-P2-01` `isMatchAdminPayment*` Club Admin rule scope, `OPS-P2-01` full post-Phase-2 Playwright suite refresh on staging, `OPS-P2-02` existing `AR-01`–`AR-03` baseline items)
- **Phase 2 Closure (`bf8e2c7`):** **Recommended for Approval** (all bounded Phase 2 items verified in source and passing in the local Firebase Emulator suite).
- **Overall Production-Readiness Recommendation:** **CONDITIONAL GO** — safe for a controlled production pilot **after** completing the bounded pre-launch operational checklist in Section 16 (pre-deploy D-22 migration, staging/production env verification, and explicit owner deployment approval).

---

## 2. Application and Review Scope

This review covers the six required domains across `mig-mov` at `5987844`:
- **Domain A:** Authentication, Identity, and Authorization
- **Domain B:** Firebase and Firestore Security
- **Domain C:** Razorpay and Financial Integrity
- **Domain D:** Player Data and Administrative Operations
- **Domain E:** Functional and Workflow Readiness
- **Domain F:** Production Operations and Recovery
- **Bounded Phase 2 Closure:** Verification of `bf8e2c7` deliverables recorded in [`SECURITY_REVIEW_HISTORY.md`](SECURITY_REVIEW_HISTORY.md)

### Evidence Provenance
1. **Source-code verified in this review:** `firestore.rules`, `lib/server-auth.ts`, `lib/server-db.ts`, `lib/database-config.ts`, `lib/role-consolidation-runner.ts`, `scripts/migrate-role-consolidation.mjs`, `app/api/admin/players/route.ts`, `lib/account-linking.ts`, `app/api/razorpay/order/route.ts`, `app/api/razorpay/webhook/route.ts`, `app/api/finance/match-plans/route.ts`, `app/api/calendar/sync/route.ts`, `app/api/whatsapp/remind-studio/route.ts`, `app/api/audit/log/route.ts`, `app/api/players/public/route.ts`, `app/api/finance/players/route.ts`, `lib/rate-limit-server.ts`, `.env.example`, `firebase.json`, `.firebaserc`, `amplify.yml`, `export-firestore.js`, and all `app/api/**` auth guards.
2. **Test verified in this review (executed locally on `5987844`):**
   - `npx tsc --noEmit`: **0 errors**
   - `npm run lint`: **0 errors**, 4 pre-existing `@firebase/security-rules/no-open-reads` warnings in `firestore.rules`
   - `npm run test:functional`: **1,284 passed, 0 failed, 0 skipped** across 291 suites (emulator-gated suites execute via `test:emulator`)
   - `npm run test:emulator`: **562 passed, 0 failed, 0 skipped** across 50 suites (including all 10 tests in `tests/phase2-final-security.emulator.test.mjs`)
3. **Test results reported earlier by implementation agent (not re-executed in this review):**
   - `TZ=Asia/Kolkata npm run test:functional` (`1,284/1,284`), `npm run build` (`43/43` static pages), `npx playwright test e2e/access-control-reconciliation.spec.ts --project="Desktop Chrome" --project="Mobile Chrome"` (`4/4`), and earlier `RELEASE_3_QA_REPORT.md` runs at `884b224`.
4. **Operationally unverified (external to repository):** Cloud Firestore PITR/backups, live Amplify/Firebase Console secrets, admin Google 2SV status, and live staging URL (`OD-01`).

---

## 3. Architecture and Threat Context

- **Users:** ~300 club members, guests, Club Admins, Finance Admins, and Super Admins.
- **Stack:** Next.js 15 App Router + React 19 + Firebase Auth + Cloud Firestore + Firebase Admin SDK + Razorpay (INR).
- **Authoritative Role Model (D-22):** `Super Admin` (`admin: true` custom claim + `!hasPendingSuperRevoke()` + active account), `Club Admin` (`isClubAdmin: true`), `Finance Admin` (`isFinanceAdmin: true`). Retired flags (`isMatchAdmin`, `isStudioAdmin`, `isDesigner`, `canDesign`, `role: "admin"`) grant zero privileges.
- **No Server Actions:** `grep -rn '"use server"' app/ lib/` confirmed **0 Next.js Server Actions**; all privileged server mutations run through `app/api/**` route handlers.

---

## 4. Phase 2 Closure Verification (`bf8e2c7`)

Bounded verification of the pending items in [`SECURITY_REVIEW_HISTORY.md`](SECURITY_REVIEW_HISTORY.md):

| Item | Verified Source Control | Supporting Evidence |
|---|---|---|
| **Role consolidation runner isolation** | `lib/role-consolidation-runner.ts` is imported only by `scripts/migrate-role-consolidation.mjs` and `tests/phase2-final-security.emulator.test.mjs`; `authorizeRoleConsolidationExecution()` rejects `process.env.NEXT_RUNTIME`. | `grep -rn "role-consolidation-runner"` + `lib/role-consolidation-runner.ts:70-85` |
| **Credential & execution authorization** | Validates `serviceAccountKey.json` fields on disk or `FIRESTORE_EMULATOR_HOST`, mints frozen `Symbol`-branded `MigrationExecutionAuth` registered in module-private `WeakSet` (`AUTHORIZED_EXECUTIONS`), and `scripts/migrate-role-consolidation.mjs` rejects `--actor*` overrides and unapproved `--database` IDs. | `lib/role-consolidation-runner.ts:27-96,134-144`; `scripts/migrate-role-consolidation.mjs:33-58` |
| **Atomic lease fencing** | Each batch executes inside a single `db.runTransaction` reading `migrationRuns/{migrationId}` + up to 100 `appUsers` docs, verifying `fencingToken` + `leaseOwner`, updating `appUsers`, writing create-only `auditLogs`, and advancing the checkpoint atomically. | `lib/role-consolidation-runner.ts:173-416` |
| **Plan fingerprint & tamper detection** | Computes SHA-256 `planFingerprint` over per-UID `signatureForPlan()`; verifies `migratedUntampered`, `sameRemainingUids`, `sameSignatures`, and reconstructed `planFingerprint` on resume and completion (`409` on mismatch). | `lib/role-consolidation-runner.ts:98-104,174-238` |
| **Player delete & identity unlink** | `DELETE /api/admin/players` runs 20 historical-reference queries + `feePlanIds` check (`409` if referenced), delegates to `inspectAndUnlinkPlayerIdentityInTx` (requiring `?unlink=true` if linked and rejecting cross-player index conflicts), and writes create-only unlink + delete audits atomically. | `app/api/admin/players/route.ts:693-826`; `lib/account-linking.ts:691-810` |
| **Emulator regression coverage** | All 10 tests in `tests/phase2-final-security.emulator.test.mjs` passed in `npm run test:emulator` (`562/562`). | Executed in this review |

**Phase 2 Sign-Off Recommendation:** **Approve Phase 2 Closure** (`bf8e2c7`). No remaining material code defects were found in the Phase 2 closure scope.

---

## 5. Authentication and Authorization Findings (Domain A)

- **Token & Status Enforcement:** `lib/server-auth.ts` verifies ID tokens with `checkRevoked: true`, fails closed (`503`) on auth/DB outages, blocks `status === "Disabled"` accounts, and isolates `x-test-*` bypasses strictly behind `NODE_ENV === "test" && KAVACH_TEST_AUTH_BYPASS === "true"` (disabled in production).
- **API Guard Coverage:** Every route under `app/api/**` enforces `requireAuth`, `requireRole`, `requireSuperAdmin`, `requireClubAdmin`, `requireMatchAdmin` (Club Admin), `requireStudioAdmin` (Club Admin), `requireFinanceAdmin`, or Razorpay HMAC signature verification (`/api/razorpay/webhook`).
- **Role Transition & Revocation Consistency:** `/api/admin/access` (`requireSuperAdmin`) uses `roleTransitions`, `accessControl/superAdmins.pendingRevokes`, last-Super-Admin protection, and refresh-token revocation; `firestore.rules` (`hasPendingSuperRevoke()`) and `getUserAccount()` fail closed immediately.
- **Confirmed P0/P1 Findings:** None.

---

## 6. Firebase and Firestore Security Findings (Domain B)

### Public-Readable Collections Audit (`allow read: if true;`)
| Collection | Line | Intentional? | Data Exposed | Abuse Assessment |
|---|---|---|---|---|
| `appConfig/{docId}` | `121` | Yes (login branding/club name) | Club name, logo, theme, non-secret settings | Secret keys (`razorpayKeySecret`, `smtpPassword`, `resendApiKey`, `whatsappAccessToken`) blocked from client writes (`L123-135`) and stored in env vars. Tracked as `AR-01` (P2). |
| `paymentLinks/{linkId}` | `437` | Yes (legacy/future link lookup) | Unused collection; writes restricted to `isFinanceAdmin() || isSuperAdmin()` | No PII or active records; low abuse risk (`AR-01`, P2). |
| `grounds/{groundId}` | `575` | Yes (venue/map display) | Ground name, address, map URL | Non-sensitive public venue info; writes restricted to `isMatchAdmin()` (`isClubAdmin()`). (`AR-01`, P2). |
| `matches/{matchId}` | `665` | Yes (public match schedule/cards) | Fixture metadata, ground, status, results | No player PII or payment records (`payments` subcollection is strictly protected). (`AR-01`, P2). |

### Sensitive Collections & Rules
- `players`: `list` is `isClubAdmin()` only; `get` is `isClubAdmin() || isSelf(playerId)`; self-update uses `affectedKeys().hasOnly(...)`; `authUid`/`mergedInto`/`mergeStatus`/`mergeJobId` are protected.
- `appUsers`: `get` is owner or `isAnyAdmin()`; `list` is `isAnyAdmin()`; `roleKeys()` and `playerId` are server-only.
- `payments` & `otherFees` (direct + collection-group): reads restricted to `isFinanceAdmin() || isSuperAdmin() || isSelf(...)`.
- `auditLogs`: read `isSuperAdmin()`, write `false`.
- `phoneIndex`, `uidIndex`, `mergeJobs`, `roleTransitions`, `migrationRuns`: `read, write: if false`.
- **Finding `FS-P2-01`:** Recorded in Section 11 (legacy `isMatchAdminPaymentCreate`/`Update` aliasing `isClubAdmin()`, already tracked as `AR-05`).

---

## 7. Razorpay and Financial Integrity Findings (Domain C)

Verified across `app/api/razorpay/order/route.ts`, `app/api/razorpay/webhook/route.ts`, `lib/razorpay-order.ts`, `lib/razorpay-webhook.ts`, and `npm run test:emulator` (`B2`, `r3-webhook-route`, `r5-webhook-dead-letter`, `razorpay-reservation-emulator`, `b1-merch-order-confirmation`):
1. **Amount manipulation:** Impossible via client payload — `derivePayableAmount()` computes authoritative INR amounts server-side.
2. **Unverified payment status:** Players cannot set `Paid` in `firestore.rules`; only server webhook / authorized admin routes settle payments.
3. **Duplicate processing / concurrent orders:** Prevented by deterministic `paymentReservations` leases and atomic `gatewayPayments` idempotency (`B2-01` through `B2-S4` passing).
4. **Cross-player financial access:** Blocked by `firestore.rules` (`isSelf`) and `/api/finance/*` (`requireFinanceAdmin` / `requireRole(["superAdmin", "financeAdmin"])`).
5. **Webhook retries & browser close:** All obligations (match fees, other fees, subscriptions, merchandise) fulfill server-side in `/api/razorpay/webhook`; permanent mismatches write `webhookDeadLetters` before returning `200`; transient errors return `503` for Razorpay retry.
6. **Non-production isolation:** `arePaymentOperationsEnabled()` blocks live Razorpay orders on non-production databases (`403 PAYMENTS_DISABLED`).

- **Confirmed P0/P1 Findings:** None.

---

## 8. Player Data and Administration Findings (Domain D)

- **PII Boundaries:** `/api/players/public` projects `PUBLIC_PLAYER_FIELDS` with `checkSharedRateLimit` and bounded cursor pagination; `/api/finance/players` projects `FINANCE_PLAYER_FIELDS` without `mobile`, `email`, `dob`, `bloodGroup`, `emergencyContact`, or `locality`.
- **Player Lifecycle & Merge:** `POST`/`PATCH`/`DELETE /api/admin/players` require `requireClubAdmin` and commit atomic create-only `auditLogs`; `DELETE` blocks on 20 historical collections + `feePlanIds` (`409`); `/api/admin/merge-players` uses leased `mergeJobs`, reparents `appUsers`/`uidIndex`/`phoneIndex`, and writes atomic audits.
- **Audit Redaction:** `/api/audit/log` derives actor/timestamp server-side, redacts PII/secret keys, and blocks `SERVER_AUTHORITATIVE_ONLY_ENTITIES`.
- **Confirmed P0/P1 Findings:** None.

---

## 9. Functional Workflow Findings (Domain E)

- **TypeScript, Lint, Functional & Emulator Suites:** All pass with 0 errors (`tsc`, `eslint`, `1,284/1,284` functional, `562/562` emulator) on `5987844`.
- **Previously Reported E2E Note (`OPS-P2-01`):** `docs/qa/RELEASE_3_QA_REPORT.md` (recorded at `884b224`, prior to Phase 2 closure) noted partial Playwright runs with `ADMIN_EMAIL` / shell-navigation mismatches on `884b224`. While `e2e/access-control-reconciliation.spec.ts` (`4/4`) passed at `bf8e2c7`, a full Playwright sweep against the staging build is recommended as part of pre-pilot staging validation (`OD-01`), without blocking security sign-off.

---

## 10. Operational Readiness Findings (Domain F)

- **Branch-Aware Database Isolation:** `lib/database-config.ts` and `amplify.yml` deterministically map `mig-mov` → `kavach-play-db-ext` and `main`/`master` → `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412`, failing closed on conflicting branch env vars.
- **Backup & Export Tooling:** `export-firestore.js` and `import-to-firestore.js` exist in repo for manual JSON export/restore using `serviceAccountKey.json`. Cloud Firestore automated backup/PITR schedules are **operationally unverified** from source code.
- **Secrets & Runtime Config:** `.env.example` and `amplify.yml` properly separate server secrets (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `RESEND_API_KEY`, `SMTP_PASSWORD`, `WHATSAPP_ACCESS_TOKEN`). Live Amplify/Firebase Console values are **operationally unverified** from source code.

---

## 11. P0 / P1 / P2 Summary

| ID | Domain | Priority | Title | Evidence | Attack Path | Impact | Recommendation | Launch Impact | Previous Status | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| **OPS-P1-01** | Operations | **P1** | Pre-deploy D-22 migration & staging confirmation (`OD-01`) | `scripts/migrate-role-consolidation.mjs`, `firestore.rules:58-76`, `DECISION-LOG.md` (`D-22`, `OD-01`) | Deploying D-22 rules before running `migrate-role-consolidation.mjs --execute` would strip Match/Studio/Designer admins of Club Admin access until migrated. | Temporary admin lockout for unmigrated legacy role holders. | Run dry-run and `--execute` migration (with owner approval) **before** deploying D-22 rules/app; confirm staging URL (`OD-01`). | **Pre-launch gate** (operational) | Existing (`D-22`, `AR-06`) | High |
| **OPS-P1-02** | Operations | **P1** | Operational verification of Cloud backups, live env secrets & admin Google 2SV | `.env.example`, `export-firestore.js`, `ACCEPTED_RISKS.md` (`AR-04`) | Missing cloud PITR/backup or misconfigured `RAZORPAY_WEBHOOK_SECRET` / `FIREBASE_SERVICE_ACCOUNT_KEY` in Amplify runtime causes payment webhook `503`s or unrecoverable accidental data loss. | Delayed payment confirmation or inability to restore Firestore after operational error. | Verify Amplify env vars, enable/confirm Firestore scheduled backups/PITR in GCP Console, and confirm Google 2SV on Super Admin accounts before pilot. | **Pre-launch gate** (operational) | Existing (`AR-04`) | High |
| **FS-P2-01** | Security (Firestore) | **P2** | `isMatchAdminPaymentCreate` / `Update` aliases to `isClubAdmin()` | `firestore.rules:62-64,704,730` | Trusted Club Admin updates non-closed match payment status within `paymentFinanceGuards(matchId)`. | Low; closed matches, `reversals`, and `financeSnapshot` remain locked. | Confirm whether Club Admins should retain pitch-side payment rule access or narrow to Finance Admin post-launch (`AR-05`). | **Non-blocker** | Existing (`AR-05`) | High |
| **OPS-P2-01** | Functional / QA | **P2** | Full Playwright E2E refresh on designated staging build | `docs/qa/RELEASE_3_QA_REPORT.md`, `e2e/` | N/A (QA coverage currency) | Low; core security, finance, and reconciliation suites passed at `bf8e2c7`/`5987844`. | Run full Playwright regression against staging once `OD-01` is confirmed. | **Non-blocker** | Existing | Medium |
| **OPS-P2-02** | Operations / Hardening | **P2** | Baseline accepted hardening items (`AR-01`, `AR-02`, `AR-03`) | `ACCEPTED_RISKS.md` | Public read of non-PII `appConfig`/`matches`/`grounds`/`paymentLinks`; pinned Next 15.0.0; no enterprise WAF/SIEM. | Negligible for ~300-member private club. | Retain under `ACCEPTED_RISKS.md` review triggers. | **Non-blocker** | Accepted (`AR-01`–`AR-03`) | High |

---

## 12. Closed Findings Not Requiring Further Action

All prior P0/P1 remediation items verified as closed in current source and emulator tests:
- `SEC-001` (claim-only Super Admin, server-only `roleKeys()`, D-22 retirement of legacy role flags)
- `SEC-002` / `SEC-003` / `SEC-004` (player self-pay/self-fee tampering and collection-group exposure)
- `SEC-005` / `SEC-006` (post/announcement and `merchOrders` integrity)
- `FIN-001` / `FIN-002` / `FIN-003` / `FIN-004` / `FIN-005` / `FIN-006` / `FIN-007` (server pricing, reservations, webhook idempotency/verification/dead-lettering, Option A abandoned-match policy, deterministic IST late fees)
- `IDT-001` / `IDT-002` / `IDT-003` / `P2-ID-04` / `P2-DEL-01` / `P2-AUD-03` / `P2-API-08` (transactional identity linking, leased merges, durable Super Admin transitions & fail-closed revocation, 20-query delete guard & validated unlink, create-only server audits, bounded cursor pagination & error/retry UI)

---

## 13. Accepted and Deferred Risks

All accepted and deferred risks are documented in [`docs/security/ACCEPTED_RISKS.md`](ACCEPTED_RISKS.md) (`AR-01` through `AR-06`), with zero unresolved `P0` issues accepted.

---

## 14. Outstanding Operational Confirmations

1. **Staging URL / Database Mapping (`OD-01`):** Owner confirmation of staging environment before cloud E2E / pre-prod rehearsal.
2. **Production Runtime Environment Variables:** Owner verification of `RAZORPAY_*`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `APP_URL`, `RESEND_API_KEY`, `SMTP_PASSWORD`, and `WHATSAPP_ACCESS_TOKEN` in hosting console.
3. **Firestore Backups / PITR:** Owner confirmation of automated Firestore backup schedule in Google Cloud Console.
4. **D-22 Migration Execution Window:** Owner approval to run `scripts/migrate-role-consolidation.mjs --database=<id> --execute` prior to deploying D-22 rules/code.

---

## 15. Final Production-Readiness Recommendation

**CONDITIONAL GO — ACCEPTED BY PRODUCT OWNER**

- **Phase 2 (`bf8e2c75735d27487e18892bd0a488efaa58b146`):** **CLOSED** (owner-approved based on available remediation and verification evidence).
- **Phase 3 Assessment:** **ACCEPTED – CONDITIONAL GO** (`P0: 0`, `P1: 2` operational gates `OPS-P1-01` and `OPS-P1-02` preserved unchanged, `P2: 3` deferred improvements).
- **Phase 4 (Operational Readiness):** **AUTHORIZED TO PROCEED** — see [`docs/PROJECT_PHASE_STATUS.md`](../PROJECT_PHASE_STATUS.md) and [`docs/operations/PHASE_4_OPERATIONAL_READINESS.md`](../operations/PHASE_4_OPERATIONAL_READINESS.md).

KAvach Play has **0 unresolved P0 vulnerabilities**. Authentication, RBAC, Firestore rules, Razorpay order/webhook integrity, player lifecycle/identity linking, audit logging, and the Phase 2 role-consolidation runner are implemented with strong, proportionate controls and verified by `1,284` functional tests and `562` Firebase Emulator tests on `5987844`.

The application is ready for a **controlled production pilot** subject to completing the Phase 4 operational gates (`OPS-P1-01`, `OPS-P1-02`) in Section 16.

---

## 16. Recommended Next Actions & Launch Checklist

### Concise Pre-Pilot Launch Checklist
- [x] **Owner Approval:** Approve Phase 2 closure (`bf8e2c7`) and Phase 3 Conditional Go (authorizing Phase 4).
- [ ] **Backup Snapshot (`OPS-P1-02`):** Run `node export-firestore.js` (or verify GCP Firestore scheduled backup/PITR) before any production migration.
- [ ] **Dry-Run & Execute D-22 Migration (`OPS-P1-01`):** Run `node scripts/migrate-role-consolidation.mjs --database=ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` (dry run), review output, then run `--execute` **before** deploying rules/app.
- [ ] **Verify Hosting & Secrets (`OPS-P1-02`):** Confirm production `NEXT_PUBLIC_FIRESTORE_DATABASE_ID`, Razorpay live keys + webhook secret, and `FIREBASE_SERVICE_ACCOUNT_KEY` in Amplify/hosting console.
- [ ] **Admin Account Hygiene (`OPS-P1-02`):** Confirm Google 2-Step Verification is enabled for all Super Admin, Club Admin, and Finance Admin accounts.
- [ ] **Controlled Deploy & Smoke Check:** Deploy `firestore.rules` and application build with explicit owner approval, verify `/api/razorpay/webhook` health and Access Control Centre overview, and monitor `webhookDeadLetters` and `auditLogs` during the initial pilot weekend.
