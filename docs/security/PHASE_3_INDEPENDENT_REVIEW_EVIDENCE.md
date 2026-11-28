# KAvach Play 2.0 — Phase 3 Independent Review Evidence Package

**Repository:** `https://github.com/dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Governance Commit:** `598784424b03cfb607353816582df5917eb2e0dc` (`5987844`)  
**Phase 2 Final Remediation Commit:** `bf8e2c75735d27487e18892bd0a488efaa58b146` (`bf8e2c7`)  
**Phase 3 Assessment Report:** [`docs/security/PHASE_3_PRODUCTION_READINESS_REPORT.md`](PHASE_3_PRODUCTION_READINESS_REPORT.md)  
**Governing Policy:** [`docs/security/SECURITY_BASELINE.md`](SECURITY_BASELINE.md)

---

## A. Git and Review Scope

- **Current Branch:** `mig-mov`
- **Current HEAD Commit (at start of Phase 3 assessment):** `598784424b03cfb607353816582df5917eb2e0dc` (`docs(security): establish application-specific security baseline`)
- **Working Tree Status (prior to adding Phase 3 docs):** Clean (`5987844` was HEAD; only `docs/security/PHASE_3_PRODUCTION_READINESS_REPORT.md` and this file `docs/security/PHASE_3_INDEPENDENT_REVIEW_EVIDENCE.md` have been created, uncommitted).
- **Files Changed During Assessment:** Documentation only (`docs/security/PHASE_3_PRODUCTION_READINESS_REPORT.md` and `docs/security/PHASE_3_INDEPENDENT_REVIEW_EVIDENCE.md`). Zero application code, Firestore rules, auth/authz logic, Razorpay integration, dependencies, tests, or deployment configs were modified.

---

## B. Authentication and Authorization

### 1. Authentication Middleware & Helpers (`lib/server-auth.ts`)
- `requireAuth(req)` ([`lib/server-auth.ts:244`](../../lib/server-auth.ts#L244)): Extracts Bearer token and verifies via `getAuth(app).verifyIdToken(token, true)` (`checkRevoked: true`, `L305`).
- `requireRole(req, allowedRoles)` ([`lib/server-auth.ts:460`](../../lib/server-auth.ts#L460)): Verifies token with `checkRevoked: true` (`L555`), loads authoritative account via `getUserAccount(db, uid, decoded)` (`L127`), fails closed (`503`) on auth/DB errors, and rejects `status === "Disabled"`.
- Role-specific guards ([`lib/server-auth.ts:606-626`](../../lib/server-auth.ts#L606-L626)):
  - `requireSuperAdmin(req)` → `["superAdmin"]` (`admin: true` custom claim + `!pendingRevokes`)
  - `requireClubAdmin(req)` / `requireMatchAdmin(req)` / `requireStudioAdmin(req)` → `["clubAdmin", "superAdmin"]` (D-22 consolidation)
  - `requireFinanceAdmin(req)` → `["financeAdmin", "superAdmin"]`
- Test bypass isolation (`isTestAuthBypassAllowed()`, [`lib/server-auth.ts:60-66`](../../lib/server-auth.ts#L60-L66)): Returns `false` whenever `NODE_ENV === "production"`; requires both `NODE_ENV === "test"` and `KAVACH_TEST_AUTH_BYPASS === "true"`.
- **Server Actions:** `grep -rn '"use server"' app/ lib/` confirmed **0 Next.js Server Actions** in the codebase.

### 2. API Route Authorization Coverage
Every route handler under `app/api/**` was verified to enforce server-side authentication/authorization:
- **Super Admin only:** `app/api/admin/access/route.ts` (`requireSuperAdmin`, `L25, L62`).
- **Club Admin / Super Admin:** `app/api/admin/players/route.ts` (`requireClubAdmin`, `L15, L95, L157`), `app/api/admin/merge-players/route.ts` (`requireClubAdmin`, `L54, L102`), `app/api/admin/allocate-kavach-id/route.ts` (`requireClubAdmin`, `L8`), `app/api/admin/generate-kavach-ids/route.ts` (`requireClubAdmin`, `L15`), `app/api/admin/shop/route.ts` (`requireClubAdmin`, `L19`), `app/api/admin/studio-membership/remove/route.ts` (`requireClubAdmin`, `L20`), `app/api/admin/match-captain/route.ts` (`requireClubAdmin`, `L16`), `app/api/admin/circuit-standings/route.ts` (`requireClubAdmin`, `L37`), `app/api/admin/action-centre/route.ts` (`requireClubAdmin`, `L21, L38`), `app/api/admin/club-stats/route.ts` (`requireClubAdmin`, `L19`), `app/api/whatsapp/invite/route.ts` (`requireClubAdmin`, `L7`), `app/api/calendar/sync/route.ts` (`requireMatchAdmin` → Club Admin, `L54`), `app/api/whatsapp/remind-studio/route.ts` (`requireStudioAdmin` → Club Admin, `L8`), `app/api/admin/player-of-weekend/route.ts`, `app/api/admin/player-stats/route.ts`, `app/api/admin/catches/route.ts`, `app/api/admin/weekend-results/route.ts`.
- **Finance Admin / Super Admin:** `app/api/admin/reconcile-abandoned/route.ts` (`requireFinanceAdmin`, `L25`), `app/api/finance/match-plans/route.ts` (`requireFinanceAdmin`, `L129`), `app/api/finance/assignments/route.ts` (`requireFinanceAdmin`, `L36, L70`), `app/api/finance/players/route.ts` (`requireFinanceAdmin`, `L48`), `app/api/finance/match-ledger/route.ts` (`requireFinanceAdmin`, `L67`), `app/api/finance/subscriptions/route.ts` (`requireFinanceAdmin`, `L59, L81`), `app/api/finance/reports/sponsorship/route.ts` (`requireFinanceAdmin`, `L21`), `app/api/finance/webhook-reconciliation/route.ts` (`requireRole(["financeAdmin", "superAdmin"])`, `L31, L74`).
- **Role-scoped multi-admin:** `app/api/audit/log/route.ts` (`requireRole(["superAdmin", "clubAdmin", "financeAdmin"])`, `L82`), `app/api/email/send/route.ts` (`requireRole(["clubAdmin", "financeAdmin", "superAdmin"])`, `L12`), `app/api/whatsapp/send/route.ts` (`requireRole(["financeAdmin", "clubAdmin", "superAdmin"])`, `L8`), `app/api/admin/weekend-prompts/route.ts` (`requireRole`).
- **Authenticated Player:** `app/api/razorpay/order/route.ts` (`requireAuth`, `L39`), `app/api/players/public/route.ts` (`requireAuth`, `L43`), `app/api/player/link-account/route.ts` (`requireAuth`, `L7`), `app/api/player/link-google/route.ts` (`requireAuth`, `L13`).
- **Webhook (HMAC-authenticated):** `app/api/razorpay/webhook/route.ts` (`x-razorpay-signature` HMAC-SHA256 verification, `L139-152`).

### 3. Pending Revocation & Durable Role Transitions
- [`lib/access-control-server.ts:360,577`](../../lib/access-control-server.ts#L360): `setAccountRoles()` and `reconcileRoleTransition()` manage `roleTransitions` state, enforce last-Super-Admin protection, write `accessControl/superAdmins.pendingRevokes` on Super Admin revocation, and revoke Firebase refresh tokens.
- [`lib/server-auth.ts:156-157`](../../lib/server-auth.ts#L156-L157): `getUserAccount()` checks `accessControl/superAdmins.pendingRevokes` and denies `superAdmin` even before token expiry.
- [`firestore.rules:39-52`](../../firestore.rules#L39-L52): `hasPendingSuperRevoke()` blocks `isSuperAdmin()`, `isFinanceAdmin()` claim branch, `isClubAdmin()` claim branch, and `isAnyAdmin()` claim branch.

### 4. Identity Linking & Unlinking
- [`lib/account-linking.ts`](../../lib/account-linking.ts): Transactional linking (`executeLinkingTransaction`, `linkPlayerAccount`) and deletion-time unlinking (`inspectAndUnlinkPlayerIdentityInTx`, `L691-810`) enforce unique `uidIndex` and `phoneIndex` invariants and reject cross-player collisions with `LinkingError(409)`.

---

## C. Firestore

### 1. Public-Readable Collections (`allow read: if true;`)
Verified via `grep -n -B 3 "allow read: if true" firestore.rules`:
1. `appConfig/{docId}` ([`firestore.rules:121`](../../firestore.rules#L121)): Intentional for pre-login club branding/theme. Client writes to `razorpayKeySecret`, `smtpPassword`, `resendApiKey`, `whatsappAccessToken` are blocked (`L123-135`), and writes require `isSuperAdmin()`.
2. `paymentLinks/{linkId}` ([`firestore.rules:437`](../../firestore.rules#L437)): Unused collection; writes restricted to `isFinanceAdmin() || isSuperAdmin()` (`L438`).
3. `grounds/{groundId}` ([`firestore.rules:575`](../../firestore.rules#L575)): Intentional public venue names/maps; writes restricted to `isMatchAdmin()` (`isClubAdmin()`).
4. `matches/{matchId}` ([`firestore.rules:665`](../../firestore.rules#L665)): Intentional public schedule/results; `payments` subcollection is strictly protected (`L700-756`).

### 2. Sensitive Collection Protections & Server-Only Writes
- Root default deny: `match /{document=**} { allow read, write: if false; }` ([`firestore.rules:5-7`](../../firestore.rules#L5-L7)).
- `appUsers/{userId}` ([`firestore.rules:151-177`](../../firestore.rules#L151-L177)): `get` owner or `isAnyAdmin()`, `list` `isAnyAdmin()`, `roleKeys()` and `playerId` blocked from all client writes (including Super Admin).
- `players/{playerId}` ([`firestore.rules:624-657`](../../firestore.rules#L624-L657)): `list` `isClubAdmin()`, `get` `isClubAdmin() || isSelf(playerId)`, self-update allowlist (`L647-653`), `authUid`/`mergedInto`/`mergeStatus`/`mergeJobId` blocked.
- `matches/{matchId}/payments/{paymentId}` ([`firestore.rules:700-756`](../../firestore.rules#L700-L756)), `players/{playerId}/otherFees/{feeId}` ([`L658-661`](../../firestore.rules#L658-L661)), and collection-group `payments`/`otherFees` ([`L478-484`](../../firestore.rules#L478-L484)): reads limited to `isFinanceAdmin() || isSuperAdmin() || isSelf(...)`; player writes limited to `['Unpaid', 'Not Playing']` availability/notes; `paymentFinanceGuards(matchId)` protects closed matches, `reversals`, and `financeSnapshot`.
- `merchOrders/{orderId}` ([`firestore.rules:791-813`](../../firestore.rules#L791-L813)): `read` owner or `isAnyAdmin()`, `create`/`delete` `isClubAdmin()`, server-only keys blocked (`L787-789`).
- Server-only internal collections (`allow read, write: if false`): `phoneIndex` (`L179`), `uidIndex` (`L183`), `mergeJobs` (`L187`), `roleTransitions` (`L191`), `migrationRuns` (`L195`).
- `auditLogs/{logId}` ([`firestore.rules:431-434`](../../firestore.rules#L431-L434)): `read` `isSuperAdmin()`, `create, update, delete: if false`.
- `webhookDeadLetters/{recordId}` ([`firestore.rules:426-429`](../../firestore.rules#L426-L429)): `read` `isFinanceAdmin() || isSuperAdmin()`, `write: if false`.

### 3. Security Rule Tests
Covered in `tests/firestore-rules.test.mjs`, `tests/phase1-security-rules.emulator.test.mjs`, `tests/phase5-firestore-security.emulator.test.mjs`, `tests/phase6-match-rules.emulator.test.mjs`, `tests/roster-r1-payment-rules.emulator.test.mjs`, `tests/finance-d4-payment-rules.emulator.test.mjs`, `tests/r2a-account-privacy.emulator.test.mjs`, `tests/def-r3-004-rules.emulator.test.mjs`, `tests/phase2-player-pii-and-audit.emulator.test.mjs`, and `tests/phase2-final-security.emulator.test.mjs` (all passed in `npm run test:emulator` on `5987844`).

---

## D. Razorpay

- **Environment Isolation:** `arePaymentOperationsEnabled()` (`lib/database-config.ts`, `app/api/razorpay/order/route.ts:28-37`) returns `403 PAYMENTS_DISABLED` on non-production databases.
- **Order Creation & Server Pricing:** `app/api/razorpay/order/route.ts:81-93` calls `derivePayableAmount(db, auth.uid, intentData)` (`lib/razorpay-order.ts:1380`), discarding client amounts and enforcing `INR` via `validateCurrency()` (`L1161`).
- **Reservation Concurrency Controls:** `acquirePaymentReservation`, `renewReservationLease`, `activatePaymentReservation`, `verifyAndRepairIntent`, and `reconcileAmbiguousReservation` (`lib/razorpay-order.ts:245-671`) enforce deterministic `reservationKey` locking and prevent duplicate active orders.
- **Webhook Signature & Verification:** `app/api/razorpay/webhook/route.ts:139-152` verifies HMAC-SHA256 `x-razorpay-signature` with `crypto.timingSafeEqual` over the raw body; `extractWebhookEventDetails` (`lib/razorpay-webhook.ts:97`) and `validateWebhookTransaction` (`L176`) validate captured amount (paise), currency, order ID, and intent binding.
- **Idempotency, State Transitions & Dead-Lettering:** `processWebhookPayment` (`lib/razorpay-webhook.ts:765`) and `processWebhookIntentTransaction` (`L998`) atomically write `gatewayPayments` and fulfill match fees, `otherFees`, `subscriptionHistory`, and `merchOrders` in one transaction, returning `200` on idempotent duplicates/dead-lettered permanent errors (`webhookDeadLetters`) and `503` on transient failures.
- **Existing Razorpay Tests:** `tests/b2-duplicate-settlement.emulator.test.mjs`, `tests/razorpay-reservation-emulator.test.mjs`, `tests/emulator-webhook-concurrency.test.mjs`, `tests/r3-webhook-route.emulator.test.mjs`, `tests/r5-webhook-dead-letter.emulator.test.mjs`, `tests/px1-merch-order-identity.emulator.test.mjs`, `tests/razorpay-tamper.test.mjs`, `tests/razorpay-concurrent-orders.test.mjs`, `tests/razorpay-lifecycle.test.mjs`, `tests/razorpay-webhook-concurrency.test.mjs`, `tests/razorpay-webhook-negative.test.mjs`.

---

## E. Phase 2 Closure (`bf8e2c7`)

| Control | Reference | Verification Basis |
|---|---|---|
| Runner isolation (`NEXT_RUNTIME` guard + zero Next.js imports) | `lib/role-consolidation-runner.ts:70-76`; `grep -rn "role-consolidation-runner"` | **Source-reviewed & test-verified** (by current reviewer on `5987844`) |
| Execution auth (`Symbol` + `WeakSet` `MigrationExecutionAuth`) | `lib/role-consolidation-runner.ts:27-36,88-96,134-144` | **Source-reviewed & test-verified** (`phase2-final-security.emulator.test.mjs` #9) |
| Credential & project safeguards (`serviceAccountKey.json`, `APPROVED_FIRESTORE_DATABASE_IDS`, `--actor*` rejection) | `lib/role-consolidation-runner.ts:38-59,77-86`; `scripts/migrate-role-consolidation.mjs:33-58` | **Source-reviewed** (CLI script); emulator path **test-verified** |
| Atomic migration lease & transaction fencing | `lib/role-consolidation-runner.ts:164-416` | **Source-reviewed & test-verified** (`phase2-final-security.emulator.test.mjs` #7, #9) |
| Plan fingerprint (`planFingerprint` SHA-256) & resume/completion tamper detection | `lib/role-consolidation-runner.ts:98-104,174-238` | **Source-reviewed & test-verified** (`phase2-final-security.emulator.test.mjs` #9) |
| Player deletion (20-query + `feePlanIds` guard) & validated `?unlink=true` identity unlink | `app/api/admin/players/route.ts:693-826`; `lib/account-linking.ts:691-810` | **Source-reviewed & test-verified** (`phase2-final-security.emulator.test.mjs` #5, #6, #10) |
| Access Control reconciliation Playwright UI flow | `e2e/access-control-reconciliation.spec.ts` | **Reported as tested by implementation agent** (`4/4` at `bf8e2c7`; not re-run in this review) |

---

## F. Test Evidence

### Freshly Executed During This Phase 3 Review (on `5987844`)
- **`npx tsc --noEmit`:** **Passed** (`0` errors).
- **`npm run lint`:** **Passed** (`0` errors; 4 pre-existing `@firebase/security-rules/no-open-reads` warnings on `firestore.rules` L121, L437, L575, L665).
- **`npm run test:functional`:** **Passed** — `1,284` passed, `0` failed, `0` skipped across `291` suites (emulator-gated suites execute under `test:emulator`).
- **`npm run test:emulator`:** **Passed** — `562` passed, `0` failed, `0` skipped across `50` suites (including all `10` tests in `tests/phase2-final-security.emulator.test.mjs`).

### Historical / Implementation-Agent Reported Results (Not Re-Executed in Phase 3)
- `TZ=Asia/Kolkata npm run test:functional`: `1,284/1,284` (reported at `bf8e2c7`).
- `npm run build`: `43/43` static pages (reported at `bf8e2c7`).
- `npx playwright test e2e/access-control-reconciliation.spec.ts --project="Desktop Chrome" --project="Mobile Chrome"`: `4/4` (reported at `bf8e2c7`).
- `docs/qa/RELEASE_3_QA_REPORT.md`: partial Playwright runs recorded earlier at `884b224` (prior to Phase 2 closure).

---

## G. Operational Gates

### `OPS-P1-01` — D-22 Migration & Staging Mapping (`OD-01`)
- **Target Firebase Project & Database IDs:** `.firebaserc` (`gen-lang-client-0004191483`); `lib/database-config.ts:8-15` maps `main`/`master` → `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` (production) and `mig-mov` → `kavach-play-db-ext` (development).
- **Repository-verifiable:** `scripts/migrate-role-consolidation.mjs` and `lib/role-consolidation-runner.ts` are complete and emulator-tested.
- **Operationally outstanding:**
  1. Confirm staging environment / database mapping (`OD-01`) if staging pre-prod QA is required.
  2. Run `node scripts/migrate-role-consolidation.mjs --database=ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` (dry run), review summary with owner, obtain explicit approval, and run `--execute` **before** deploying D-22 `firestore.rules` and app code.

### `OPS-P1-02` — Backups, Runtime Secrets & Admin 2SV
- **Repository-verifiable:** `.env.example`, `amplify.yml`, and `export-firestore.js` / `import-to-firestore.js` exist and keep secrets out of `firestore.rules` / client bundles.
- **Operationally outstanding:**
  1. Verify Google Cloud Firestore scheduled backups / PITR (or take a pre-deploy `node export-firestore.js` snapshot).
  2. Verify live Amplify / hosting runtime env vars (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `APP_URL`, `RESEND_API_KEY`, `SMTP_PASSWORD`, `WHATSAPP_ACCESS_TOKEN`).
  3. Confirm Google 2-Step Verification on Super Admin, Club Admin, and Finance Admin Google accounts (`AR-04`).

---

## Independent-Review Handoff

1. **What is verified:** All core auth/RBAC guards, `firestore.rules`, Razorpay order/webhook/reservation integrity, player lifecycle/identity linking, audit logging, and Phase 2 closure (`bf8e2c7`) controls are verified in source on `5987844`, with `tsc` (0 errors), `eslint` (0 errors), `test:functional` (`1,284/1,284`), and `test:emulator` (`562/562`) executed and passing in this review.
2. **What is not independently verified in this review:** Production `npm run build` (`43/43`), `TZ=Asia/Kolkata` functional run (`1,284/1,284`), and Playwright E2E specs (`e2e/access-control-reconciliation.spec.ts` `4/4` and full E2E suite on staging) were not re-executed during this Phase 3 session.
3. **What remains operationally outstanding:** `OPS-P1-01` (D-22 dry-run + `--execute` migration before rules/app deploy, plus `OD-01` staging confirmation) and `OPS-P1-02` (GCP Firestore backup/PITR, live Amplify runtime secrets, admin Google 2SV).
4. **What would prevent a controlled pilot:** Deploying D-22 rules/app before running the D-22 role-consolidation migration (would lock out legacy Match/Studio/Designer admins), misconfigured live Razorpay/Firebase secrets, or absence of a pre-deploy backup/snapshot.
5. **What can safely be deferred until after launch:** `FS-P2-01` (`AR-05` Club Admin `isMatchAdminPayment*` scope review), `OPS-P2-01` (full staging Playwright sweep), and `AR-01`–`AR-03` (public non-PII reads, pinned Next 15.0.0 per `D-11`, enterprise WAF/SIEM out of scope).
