# KAvach Play 2.0 — Phase 4B: Operational Verification & Closure Checklist

**Status:** Phase 4B Verification Complete (Awaiting Operator / Owner Evidence to Close Phase 4)  
**Branch:** `mig-mov`  
**Firebase Project:** `gen-lang-client-0004191483`  
**Production DB (`main`/`master`):** `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412`  
**Development & Staging DB (`mig-mov`):** `kavach-play-db-ext`  
**Governing Phase Status:** [`docs/PROJECT_PHASE_STATUS.md`](../PROJECT_PHASE_STATUS.md)

> **Execution Guardrail:** Do not execute `--execute` migrations, modify payment config, change application code, deploy, or push without explicit owner approval. Never commit or print secret values.

---

## 1. Amplify Console Verification Checklist (`mig-mov` Branch Overrides)

Verify in **AWS Amplify Console → Hosting → Environment variables** (do not print or commit secret values):

- [ ] **Branch DB override:** `mig-mov` sets `NEXT_PUBLIC_FIRESTORE_DATABASE_ID = kavach-play-db-ext` (matches `amplify.yml:17-18` and `lib/database-config.ts:151-158`).
- [ ] **App-level / `main` DB:** `main` / `master` resolves to `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` (never `kavach-play-db-ext`).
- [ ] **Razorpay test-key overrides on `mig-mov`:** `RAZORPAY_KEY_ID` (`rzp_test_*`), `NEXT_PUBLIC_RAZORPAY_KEY_ID` (`rzp_test_*`), `RAZORPAY_KEY_SECRET` (test secret), and `RAZORPAY_WEBHOOK_SECRET` (test webhook secret) are overridden on `mig-mov` so production Razorpay keys are not inherited (`docs/branch-db-isolation.md:66`).
- [ ] **`APP_URL` override on `mig-mov`:** Set to the `mig-mov` Amplify preview URL (not `https://play.kavachcricket.com`).
- [ ] **Notification & Firebase Admin vars:** `FIREBASE_SERVICE_ACCOUNT_KEY`, `RESEND_API_KEY` / `SMTP_*`, and `WHATSAPP_ACCESS_TOKEN` are present in Amplify runtime `.env.production` (`amplify.yml:24-25`).

---

## 2. D-22 Dry-Run Command & Source-Verified Read-Only Behavior

### Exact Dry-Run Command (`kavach-play-db-ext`)
With `serviceAccountKey.json` placed locally in the repository root (gitignored; never committed):

```bash
node scripts/migrate-role-consolidation.mjs --database=kavach-play-db-ext --json > /tmp/d22-dryrun-staging.json
```

### Source-Verified Read-Only Guarantees
- **No `--execute` flag:** `scripts/migrate-role-consolidation.mjs:31,56-59` sets `execute = false` and passes `auth: undefined`.
- **Zero writes in `runRoleConsolidation()`:** `lib/role-consolidation-runner.ts:146-157` reads `appUsers` once, computes `summariseConsolidation(docs)`, and returns `{ migrationId, executed: false, alreadyCompleted: false, summary, changed: [] }` **before** touching `migrationRuns`, `appUsers`, or `auditLogs`.
- **Database & actor guards:** Rejects `--actor*` (`exit 2`), validates `--database=` against `APPROVED_FIRESTORE_DATABASE_IDS`, and validates `serviceAccountKey.json` before running (`scripts/migrate-role-consolidation.mjs:35-51`).

---

## 3. Dry-Run Result Validation Checklist

Inspect `/tmp/d22-dryrun-staging.json` (and later the production dry-run output) before any `--execute` approval:

- [ ] **Target database:** Confirm command targeted the intended `--database=` ID (`kavach-play-db-ext` for staging; `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` for prod).
- [ ] **Execution mode:** Confirm `executed === false` and `changed` is `[]`.
- [ ] **Affected accounts & role changes:** Verify `summary.scanned`, `summary.matchAdmin`, `summary.studioAdmin`, `summary.designer`, `summary.multipleRetired`, `summary.receiveClubAdmin`, `summary.alreadyClubAdmin`, `summary.financePreserved`, and `summary.changes` match expected club officials.
- [ ] **Skipped / flagged records:** Review every entry in `summary.flagged` (disabled, unlinked, or unknown-role accounts) with the owner before migrating.
- [ ] **Conflicts / idempotency:** Confirm no active/conflicting `migrationRuns/{migrationId}` exists if reusing a date-based `migrationId`.
- [ ] **Audit records plan:** Confirm `summary.changes` equals the exact number of `auditLogs` entries (`role_consolidation_${migrationId}_${uid}`) that `--execute` will create.

---

## 4. Pre-Migration Firestore Export & Recovery Procedure

*(Do not execute against production without explicit owner approval.)*

### Export & Secure Snapshot Handling (`export-firestore.js`)
1. Ensure local `serviceAccountKey.json` is present (gitignored).
2. Run `node export-firestore.js` to produce `firestore-backup.json` (walks root collections and nested subcollections).
3. **Secure handling:** `firestore-backup.json` contains club PII and financial records — **never** commit it to git, **never** paste it into logs/prompts, store it in an encrypted/access-restricted location (or delete the local plaintext copy after verification), and verify `.gitignore` excludes it before any `git add`.
4. Verify the target database/snapshot timestamp before running any `--execute` migration.

### Recovery Procedure
- **Staging / non-production restore:** `node import-to-firestore.js kavach-play-db-ext` (note: `import-to-firestore.js:32-34` explicitly refuses to import into `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` or `(default)`).
- **Production recovery:** Use **GCP Firestore PITR / scheduled backups** (manual Cloud Console prerequisite in Section 6). For D-22 role flags specifically, original pre-migration values are also preserved per-user in `appUsers.roleMigration.from` (`lib/role-consolidation-runner.ts:349-355`).

---

## 5. Razorpay Test-Mode Assessment & Minimum Safe Staging Option

- **Backend Emulator Coverage (Sufficient for Logic):** `npm run test:emulator` (`562/562` passing) directly validates `derivePayableAmount`, `acquirePaymentReservation`, concurrent captures, HMAC signature verification, idempotent `gatewayPayments`, `webhookDeadLetters`, and match/otherFee/subscription/merchandise fulfillment (`razorpay-reservation-emulator.test.mjs`, `b2-duplicate-settlement.emulator.test.mjs`, `r3-webhook-route.emulator.test.mjs`, `r5-webhook-dead-letter.emulator.test.mjs`, `emulator-webhook-concurrency.test.mjs`, `px1-merch-order-identity.emulator.test.mjs`).
- **Hosted `mig-mov` Checkout Limitation:** Complete hosted test-mode checkout **cannot** run on `mig-mov` without a code change because `arePaymentOperationsEnabled()` (`lib/database-config.ts:201-233`) returns `false` unless `branch === "main" | "master"` and `dbId === "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412"`, causing `/api/razorpay/order` (`app/api/razorpay/order/route.ts:28-37`) and `/api/razorpay/webhook` to return `403 PAYMENTS_DISABLED`.
- **Smallest Safe Change (If Hosted `mig-mov` Test Checkout Is Required — Not Implemented Without Separate Approval):**
  Add a fail-closed helper in `lib/database-config.ts` allowing Razorpay routes on `mig-mov` **only when** `ALLOW_STAGING_TEST_PAYMENTS === "true"` **and** `dbId === "kavach-play-db-ext"` **and** both `RAZORPAY_KEY_ID` and `NEXT_PUBLIC_RAZORPAY_KEY_ID` start with `"rzp_test_"`. Live `rzp_live_` keys remain permanently blocked on `mig-mov`.

---

## 6. Cloud-Console & Admin 2SV Checklist (`OPS-P1-02`)

- [ ] **GCP Firestore Backups / PITR:** Confirm Point-in-Time Recovery and/or daily scheduled backups are enabled for `gen-lang-client-0004191483` (`ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412`).
- [ ] **Administrator Google 2SV Verification Procedure:** Super Admin reviews the active admin list in **Settings → Access Control** (`Super Admin`, `Club Admin`, `Finance Admin`), and each listed admin confirms Google 2-Step Verification is enabled on their sign-in Google account (`myaccount.google.com/security`); owner records pass/fail confirmation.
- [ ] **Amplify Rollback Readiness:** Confirm prior working `main` build artifact is retained in Amplify Console for immediate one-click rollback if needed.

---

## 7. Consolidated Phase 4 Closure Checklist

| Gate / Item | Owner / Operator | Evidence Required to Close Phase 4 | Status |
|---|---|---|---|
| **1. Amplify `mig-mov` overrides** | Owner / Operator (manual) | Pass/fail confirmation of `NEXT_PUBLIC_FIRESTORE_DATABASE_ID=kavach-play-db-ext`, `APP_URL`, and `rzp_test_*` overrides (no secrets printed) | Open |
| **2. Production env vars (`main`)** | Owner / Operator (manual) | Pass/fail confirmation that `RAZORPAY_*` (live), `FIREBASE_SERVICE_ACCOUNT_KEY`, email/WhatsApp vars, and `APP_URL` are set | Open |
| **3. D-22 dry-run (`kavach-play-db-ext`)** | Operator places key → Antigravity / Operator runs | Saved dry-run JSON/summary (`executed: false`), Section 3 checklist reviewed, owner approval recorded | Open |
| **4. Backup / PITR & snapshot** | Owner / Operator (manual) | GCP PITR/scheduled backup confirmation + pre-migration `export-firestore.js` snapshot stored securely outside git | Open |
| **5. Admin Google 2SV** | Owner / Admins (manual) | Pass/fail confirmation that all active Super/Club/Finance Admins have Google 2SV enabled | Open |
| **6. Razorpay validation path** | Owner decision | Accept emulator coverage (`562/562`) **or** authorize narrow `rzp_test_*`-only staging flag for `mig-mov` | Open |
| **7. Staging 11-item smoke** | Antigravity (once `mig-mov` preview URL & test creds provided) / Owner | Pass/fail results for the 11-item staging checklist on `mig-mov` (`kavach-play-db-ext`) | Open |

---

## 8. Essential Staging Validation Checklist (`mig-mov` / `kavach-play-db-ext`)

1. Login and account access (Google/Email login, disabled account fail-closed).
2. Player and administrator permissions (Player persona default; D-22 role hubs; `403`/Access Denied on unauthorized actions).
3. Match creation and squad assignment (Club Admin creates/edits match, ground, captain, squad).
4. Player availability (Playing / Not Playing + notes persist).
5. Razorpay test payment (emulator-verified by default; or hosted test checkout if narrow `rzp_test_*` flag is approved).
6. Payment reconciliation (webhook idempotency + `webhookDeadLetters` + `/api/finance/webhook-reconciliation`).
7. Finance operations (`/api/finance/players`, cash/UPI settlement, fee plans, abandoned-match waiver, reminders).
8. Studio subscriptions (renewal + `/api/admin/studio-membership/remove` atomic sync).
9. Player identity linking (onboarding/Google link, `DELETE /api/admin/players` `409` history guard & `?unlink=true`).
10. Mobile usability (`360×800` Player & Admin navigation, no header collision).
11. Error handling (directory retry `P2-API-08`, validation & API failure recovery).
