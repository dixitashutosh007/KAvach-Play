# KAvach Play 2.0 — Release 3 Independent QA, Security & E2E Validation Report

**Date:** 2026-11-25  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Baseline Commit:** `884b2246036ae7330d0ac0481d77c6caa9c7bde9` (0 subsequent commits)  
**Author:** Antigravity (Implementation Agent — QA Execution & Evidence Gathering; awaiting ChatGPT independent review & Product Owner authorization before any fixes)

---

## 1. Repository & Commit Baseline Report
- **Branch / Working Tree:** `mig-mov...origin/mig-mov`, clean before report generation.
- **HEAD SHA:** `884b2246036ae7330d0ac0481d77c6caa9c7bde9` (`fix(auth): deny Club Admin-only financial due reminders on email and WhatsApp APIs`).
- **Static & Build Baseline:**
  - `npm run lint`: **0 errors**, 4 warnings (`@firebase/security-rules/no-open-reads` on `firestore.rules` L108, L403, L546, L622).
  - `npx tsc --noEmit`: **Passed** (exit code `0`, `strict: true`).
  - `npm run build` (verified at `884b224`): **Passed** (exit code `0`, 39/39 static/dynamic routes built).

---

## 2. Automated Test Execution Report

| Suite | Command | Executed | Passed | Failed | Skipped | Notes |
|---|---|---:|---:|---:|---:|---|
| ESLint | `npm run lint` | 1 | 1 | 0 | 0 | 4 open-read warnings in `firestore.rules` |
| TypeScript | `npx tsc --noEmit` | 1 | 1 | 0 | 0 | Clean |
| Production Build | `npm run build` | 1 | 1 | 0 | 0 | Verified at `884b224` |
| Functional Unit Tests | `npm run test:functional` | 1265 | 1228 | 37 | 0* | *26 emulator-gated suites self-skip when `FIRESTORE_EMULATOR_HOST` unset |
| Firebase Emulator Suite | `npm run test:emulator` | 516 | 489 | 27 | 0 | Failures in rules/D-22/weekend-ops suites (see Defect Register) |
| Playwright: `app-loading` + `login` + `shared-shell-behavioral` | `npx playwright test e2e/app-loading.spec.ts e2e/login.spec.ts e2e/shared-shell-behavioral.spec.ts` | 32 | 30 | 2 | 0 | 2 failures in `shared-shell-behavioral` (Club Admin bottom nav shows Finance/Settings) |
| Playwright: `admin-dashboard` (diagnostic) | `npx playwright test e2e/admin-dashboard.spec.ts -g "dashboard loads without errors"` | 2 | 1 | 1 | 0 | Desktop passed; Mobile Chrome failed in `e2e/helpers/auth.ts` (`admin-tab-select` missing / Player persona default) |
| Playwright: `weekend-match-operations` (Desktop Chrome, partial) | `npx playwright test e2e/weekend-match-operations.spec.ts --project="Desktop Chrome"` | 8 (of 13) | 6 | 2 | 5 (stopped) | Tests 1, 3, 4, 5, 7 passed; Tests 2 & 6 timed out at 1.0m |

---

## 3. Persona-Based Authorization Matrix (Source + Emulator + API Inspection)

| Capability / Surface | Super Admin | Finance Admin | Club Admin (only) | Player | Evidence / Gap |
|---|---|---|---|---|---|
| `/api/admin/access` (GET/POST) | Allowed | 403 | 403 | 403 | `requireSuperAdmin` ([access/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/admin/access/route.ts)) |
| `/api/email/send` (`due_reminder`) | Allowed | Allowed | **403** | 403 | Verified in `reminder-resolver.emulator.test.mjs` |
| `/api/email/send` (non-Finance) | Allowed | **403** | Allowed | 403 | Verified in `reminder-resolver.emulator.test.mjs` |
| `/api/whatsapp/send` (`due_reminder`) | Allowed | Allowed | **403** | 403 | Verified in `reminder-resolver.emulator.test.mjs` |
| `/api/whatsapp/send` (non-Finance) | Allowed | **403** | Allowed | 403 | Verified in `reminder-resolver.emulator.test.mjs` |
| `/api/finance/match-ledger` (POST) | Allowed | Allowed | 403 | 403 | `requireFinanceAdmin` |
| `/api/finance/webhook-reconciliation` | Allowed | Allowed | 403 | 403 | `requireRole(["superAdmin", "financeAdmin"])` |
| `/api/finance/assignments` (GET) | Allowed | Allowed | **ALLOWED (DEFECT)** | 403 | **DEF-R3-001**: `requireRole` includes `"clubAdmin"` |
| `/api/finance/reports/sponsorship` (GET) | Allowed | Allowed | **ALLOWED (DEFECT)** | 403 | **DEF-R3-001**: `requireRole` includes `"clubAdmin"` |
| `/api/finance/subscriptions` (GET) | Allowed | Allowed | **ALLOWED (DEFECT)** | 403 | **DEF-R3-001**: `requireRole` includes `"clubAdmin"` |
| `/api/finance/match-plans` (`preview`/`apply`) | Allowed | Allowed | **ALLOWED (DEFECT)** | 403 | **DEF-R3-001**: `requireRole` includes `"clubAdmin"` |
| Firestore `matches/{m}/payments/{p}` write (`Paid`) | Allowed | Allowed | **ALLOWED (DEFECT)** | 403 | **DEF-R3-002**: `isMatchAdminPaymentUpdate` aliases `isClubAdmin()` |
| Firestore `players/{id}` read (all PII) | Allowed | Allowed | Allowed | **ALLOWED (DEFECT)** | **DEF-R3-003**: `allow read: if isSignedIn()` |
| Firestore `notifications` read / broadcast create | Allowed | Allowed | Allowed | **ALLOWED (DEFECT)** | **DEF-R3-004**: `allow read: if isSignedIn()`, broadcast `"admin"/"all"` |
| UI Finance Tab (`app/page.tsx`) | Shown | Shown | AccessDenied | Hidden | `isFinanceAdmin \|\| isSuperAdmin` ([app/page.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/page.tsx#L1461)) |

---

## 4. Finance & Razorpay Validation Summary
- **Server-side order amount derivation & reservation concurrency:** Verified via `npm run test:emulator` (`razorpay-reservation-emulator.test.mjs`, `b2-duplicate-settlement.emulator.test.mjs` — all passed). Client-supplied `amount` is discarded (`derivePayableAmount`), currency is locked to `INR`, and deterministic reservation keys prevent duplicate active orders.
- **Webhook authenticity, idempotency & dead-lettering:** Verified via `r3-webhook-route.emulator.test.mjs`, `r5-webhook-dead-letter.emulator.test.mjs`, `emulator-webhook-concurrency.test.mjs`, and `b1-merch-order-confirmation.test.mjs` / `px1-merch-order-identity.emulator.test.mjs` — all passed.
- **Match finance & abandoned-match accounting:** Verified via `finance-remediation.test.mjs` and `finance-consolidation-r2.test.mjs` (18/18 passed).
- **Gaps:** No live Razorpay transactions executed (prohibited); Release 2/2.1 consolidated 7-section Finance UI lacks dedicated Playwright E2E coverage.

---

## 5. Data Integrity & Concurrency Summary
- **Passed Emulator Concurrency Suites:**
  - `b2-duplicate-settlement.emulator.test.mjs` (concurrent captures, duplicate intents, conflicting payments, subscription renewals)
  - `admin-club-recognition.emulator.test.mjs` (concurrent catch edits/deletes, deterministic KAvach stats, POTW concurrent edit/retract)
  - `match-captain.emulator.test.mjs` (atomic captain-squad transaction)
  - `action-centre.emulator.test.mjs` (per-admin popup dismissal transaction)
  - `remediation1b-concurrency-identity.emulator.test.mjs` & `remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs`
- **Gaps:** No automated concurrency tests for two admins editing the same match document simultaneously or simultaneous subscription period closures.

---

## 6. Consolidated Defect Register

| ID | Severity | Module | Summary | Root Cause |
|---|---|---|---|---|
| **DEF-R3-001** | **P0** | `app/api/finance/{assignments,reports/sponsorship,subscriptions,match-plans}/route.ts` | Club Admin-only users can query Finance assignments, sponsorship reports, subscription periods, and preview/apply match fee plans via direct API calls. | `requireRole` still includes `"clubAdmin"` on these Finance routes. |
| **DEF-R3-002** | **P0** | `firestore.rules` (L290–306, L687) | Club Admin-only users can mark match payments as `Paid` (`cash_collected` / `deposited_directly`) directly in Firestore. | `isMatchAdmin()` aliases `isClubAdmin()` under D-22, so `isMatchAdminPaymentUpdate` grants Club Admins payment-collection writes. |
| **DEF-R3-003** | **P1** | `firestore.rules` (L595–596) | Any signed-in player can read all `players` documents including PII (`mobile`, `email`, `dob`, `bloodGroup`, `emergencyContact`). | `allow read: if isSignedIn();` on `/players/{playerId}` (noted in `PlayerDirectory.tsx` as pending R2-B). |
| **DEF-R3-004** | **P1** | `firestore.rules` (L398, L508, L527–533, L752–760, L781–786) | Multiple Firestore rule gaps: (a) `/notifications` allows any signed-in user to read all notifications & create `"admin"`/`"all"` broadcasts; (b) `/merchOrders` owner update does not lock `orderStatus`/`merchId`/`merchName`; (c) `/pollResponses` create lacks `isSelf(incoming().playerId)`; (d) `/auditLogs` allows `update` by any admin; (e) `/catchLog` create has operator-precedence bug (`\|\|` before `&&`). | Missing field/owner constraints and missing parentheses in `firestore.rules`. |
| **DEF-R3-005** | **P1** | `tests/` (37 functional failures, 27 emulator failures) | `test:functional` and `test:emulator` fail across stale D-22 role assertions, refactored source-regex checks, and `firestore.rules` emulator evaluation errors (`L140`, `L445`, `L623`, `L631`, `L658`, `L685`). | Tests not updated after D-22/R2 refactors + `firestore.rules` evaluation errors under emulator test fixtures. |
| **DEF-R3-006** | **P2** | `components/layout/MobileBottomNav.tsx`, `e2e/` | `MobileBottomNav` shows all 6 admin tabs to Club Admin (failing `shared-shell-behavioral.spec.ts` & contradicting D-18 role-hidden nav); `e2e/helpers/auth.ts` fails on Mobile Chrome; `weekend-match-operations.spec.ts` had 2 timeouts; Finance workspace lacks E2E spec. | Intentional `AccessDenied`-on-click pattern conflicts with D-18/E2E assertions; stale mobile E2E auth helper. |
| **DEF-R3-007** | **P3** | `firestore.rules` (L108, L403, L546, L622) | ESLint `@firebase/security-rules/no-open-reads` warns on 4 `allow read: if true;` rules (`appConfig`, `paymentLinks`, `grounds`, `matches`). | Intentional public reads for login/public views, except `paymentLinks` should be reviewed for `isSignedIn()` if unauthenticated payment links are not required. |

---

## 7. Release 3 Readiness Recommendation

**Recommendation: NOT READY**

Blocking reasons:
1. **Two unresolved P0 authorization defects (`DEF-R3-001`, `DEF-R3-002`):** Club Admin-only users still have direct API access to Finance endpoints and Firestore write access to mark match payments `Paid`.
2. **Unresolved P1 Firestore security & test-suite failures (`DEF-R3-003`, `DEF-R3-004`, `DEF-R3-005`):** Player PII exposure, notification/poll/merchOrder/auditLog rule gaps, and 37 functional + 27 emulator test failures.
3. **Incomplete E2E coverage (`DEF-R3-006`):** Consolidated Finance workspace UI and Mobile Chrome credentialed flows lack passing E2E verification.
