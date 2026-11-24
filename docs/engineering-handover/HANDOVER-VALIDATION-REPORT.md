# KAvach Play — Engineering Handover Validation & Reconciliation Report

**Document:** Formal Handover Validation & Reconciliation Report  
**Date:** 24 November 2026  
**Auditor / Agent:** Gemini in Google Antigravity  
**Product Owner:** KAvach Cricket Club  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Current Development Branch:** `mig-mov`  
**Current Development HEAD:** `8978577d69406fcca2374767ccf1704ae1803fd0`  
**Overall Readiness Assessment:** **READY WITH CONDITIONS**  

---

## 1. Repository Branch and HEAD

- **Development Branch:** `mig-mov` (tracking `origin/mig-mov`, clean working tree).
- **Current HEAD Commit:** `8978577d69406fcca2374767ccf1704ae1803fd0` (`feat(match-center): refine match cards, eliminate rsvp wording, and enforce fail-closed db resolver`).
- **Production Branch:** `main` (hosted on AWS Amplify, connected to production database `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412`).
- **Working Tree State:** Clean; zero uncommitted modifications outside `docs/engineering-handover/`.

---

## 2. Documents & Implementation Inspected

### Documentation Inspected
1. `AGENTS.md` (root) — Persistent project governance and constraints.
2. `agent.md` (root) — Daily agent operating instructions and review cycle.
3. `cloud.md` (root) — Cloud environments, Firestore databases, and refresh state.
4. `docs/implementation/PHASE-TRACKER.md` — Active remediation master plan vs historical claims.
5. `docs/implementation/DECISION-LOG.md` — Authoritative decisions (D-01 through D-15).
6. `docs/redesign/reports/task-1.2-shared-mobile-application-shell.md` — Shell & navigation implementation report.
7. `docs/redesign/reports/phase-2.2-player-match-center.md` — Match center 5-pass correction report.
8. `docs/qa/PHASE_6_E2E_HARDENING_REPORT.md` — Phase 6 E2E hardening evidence.
9. `.github/workflows/ci.yml` — CI pipeline definitions and jobs.
10. All six handover documents in `docs/engineering-handover/`.

### Source Code & Implementation Inspected
1. `lib/database-config.ts` — Environment resolution and payment gating.
2. `lib/server-db.ts` — Admin SDK factory seam and database isolation.
3. `lib/firebase.ts` — Client Firestore initialization.
4. `lib/server-auth.ts` — Server auth guards, role checks, and token revocation.
5. `firestore.rules` — Rules enforcement, custom claim checks, and subcollection protection.
6. `components/layout/MobileBottomNav.tsx` — Mobile navigation rendering.
7. `components/layout/AppHeader.tsx` — Top header, profile avatar, and responsive controls.
8. `components/layout/MoreDrawer.tsx` — Overflow navigation and focus management.
9. `app/page.tsx` — Root application container, desktop sidebar navigation, and tab routing.
10. `components/SettingsTab.tsx` — Access Control Centre and privileges overview.
11. `components/EditPlayerInline.tsx` — Administrative role assignment toggles.
12. `app/api/razorpay/order/route.ts` & `app/api/razorpay/webhook/route.ts` — Payment workflows.
13. `lib/player-merge.ts` & `app/api/admin/merge-players/route.ts` — Merge state machine.

---

## 3. Discrepancies Identified

### Discrepancy A: Player Navigation Architecture
- **Approved Owner Directive:** 3 primary destinations: `Home`, `Club`, `Matches`. Profile accessible exclusively through the top header avatar (`AppHeader.tsx`). Identical navigation across mobile and desktop.
- **Historical Standard (`AGENTS.md` L147):** Documented 5 primary items: `Home`, `Matches`, `Payments`, `Performance`, `Club`.
- **Current Repository Implementation:**
  - `MobileBottomNav.tsx` (L173-219) implements 5 items: `Home`, `Matches`, `Finance`, `Players`, `More`.
  - `AppHeader.tsx` (L158-184) already implements the dedicated Avatar button navigating to `profile`.
  - `app/page.tsx` (L810-898) renders 6 desktop links: `Home`, `Matches`, `Finance`, `Players`, `Performance`, `Club`.
- **Finding:** The implementation partially aligns with the directive by having Profile in the Header Avatar, but the primary destinations currently differ between the owner's 3-item model (`Home, Club, Matches`) and the current 5-item mobile nav / 6-item desktop sidebar.

### Discrepancy B: Admin Role Model Consolidation
- **Approved Owner Directive:** 3 active roles: `Super Admin`, `Club Admin`, `Finance Admin`. Match Admin, Studio Admin, and Designer are retired and consolidated into Club Admin.
- **Historical Standard (`AGENTS.md` L127, `DECISION-LOG.md` D-08):** Documented retaining 6 granular capabilities (Super Admin, Club Admin, Match Admin, Finance Admin, Studio Admin, Designer).
- **Current Repository Implementation:**
  - `lib/server-auth.ts` still actively exports `requireMatchAdmin` (L555) and `requireStudioAdmin` (L563).
  - `firestore.rules` lines 43-52 still actively define `isMatchAdmin()` and `isStudioAdmin()`, gating grounds, tournaments, and match writes.
  - `SettingsTab.tsx` (L1568-1610) and `EditPlayerInline.tsx` (L380-428) still display and toggle all 6 roles.
- **Finding:** The consolidation into 3 roles is approved by the owner, but has not yet been implemented in the security rules, server guards, or UI Access Control Centre.

### Discrepancy C: Historical 12-Phase Claims vs Active Remediation Baseline
- **Finding:** Historical notes in legacy phase documents recorded that all 12 phases were complete. The active remediation master plan governed by `AGENTS.md` baselined at commit `acff8325` showed that material defects existed. Actual progress stands at: Phases 0–6 and Pre-Phase 7 Remediations 1–1F-R complete/hardened; production Phases 7–12 remain planned / not started.

---

## 4. Corrections Made to Handover Documents

1. **`README.md`:**
   - Added Section 4 explicitly documenting Discrepancy A (Navigation) and Discrepancy B (Admin Roles) as Open Owner Decisions OD-03 and OD-04.
   - Refined test counts and exact CI run references.
2. **`ARCHITECTURE.md`:**
   - Added Section 3 (Navigation Architecture Reconciliation) detailing the 3-item approved target vs the 5-item mobile / 6-item desktop implementation.
   - Added Section 4 (Roles & Access Control Reconciliation) detailing the 3-role target model vs the 6 granular roles currently enforced in code.
   - Updated client state, API routes, and data models to reflect verified code references.
3. **`SECURITY-AND-ACCESS.md`:**
   - Updated Section 1 (RBAC Architecture) with a comparison diagram and capability mapping table showing how Match Admin, Studio Admin, and Designer will map into Club Admin under OD-04.
   - Verified and documented exact commits, files, and test files for SEC-001 through SEC-006 and Remediations 1 through 1F-R.
4. **`BUSINESS-WORKFLOWS.md`:**
   - Updated Match and Studio workflows to note that under the 3-role model, match scheduling and studio operations will be governed by `Club Admin`.
   - Documented Option A abandoned match billing, Asia/Kolkata late fee rules, and Razorpay webhook merge redirection.
5. **`TESTING-AND-QUALITY.md`:**
   - Documented exact local execution results: `462 passed, 0 failed, 0 skipped` (1.15s) at commit `8978577`.
   - Documented exact CI run numbers (44651141614, 44574075080, 44570189619, 44559161481) for the 114 emulator test scenarios in `remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs`.
   - Documented the exact local limitation (lack of Java runtime) preventing local emulator runs without modifying the environment.
6. **`PHASE-AND-IMPLEMENTATION-STATUS.md`:**
   - Standardized status classifications strictly using `Implemented`, `Automated tests passed`, `Manual testing pending`, `Independent review pending`, `Owner approval pending`, `Production-deployed`, `Production-verified`.
   - Added Open Owner Decisions OD-03 (Player Navigation Alignment) and OD-04 (Admin Role Consolidation).

---

## 5. Claims Verified and Authoritative Evidence

| Claim | Verified Status | Exact Source File & Line Evidence |
|---|---|---|
| **Fail-Closed Multi-Database Isolation** | **VERIFIED** | `lib/database-config.ts` [L80-184](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/database-config.ts#L80-L184). `mig-mov` strictly requires `kavach-play-db-ext`; live payments disabled on non-`main`. 13 unit tests pass. |
| **Server Admin Factory Seam** | **VERIFIED** | `lib/server-db.ts` [L82-104](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/server-db.ts#L82-L104). Named database passed directly to `firestoreFactory` without no-argument fallback. |
| **Super Admin Decoupled from `appUsers.role` (SEC-001)** | **VERIFIED** | `firestore.rules` [L35-41](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L35-L41) checks `request.auth.token.admin == true`. `lib/server-auth.ts` [L547-550](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/server-auth.ts#L547-L550). |
| **Payment Status Self-Marking Blocked (SEC-002)** | **VERIFIED** | `firestore.rules` [L577-602](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L577-L602). Client status update restricted strictly to `Unpaid` ↔ `Not Playing`. |
| **Fee Tampering Blocked (SEC-003)** | **VERIFIED** | `firestore.rules` [L518-522](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L518-L522). `otherFees` mutations restricted to `isFinanceAdmin() \|\| isSuperAdmin()`. |
| **Authoritative Amount Derivation (FIN-001)** | **VERIFIED** | `app/api/razorpay/order/route.ts` [L81-85](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/order/route.ts#L81-L85). Client amount discarded; server invokes `derivePayableAmount()`. |
| **Webhook Atomic Transaction & HMAC (FIN-002/003)** | **VERIFIED** | `app/api/razorpay/webhook/route.ts` [L45-56](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/webhook/route.ts#L45-L56). Verifies signature with `crypto.timingSafeEqual`; updates in Firestore transaction. |
| **Abandoned Match Billing Policy (Option A)** | **VERIFIED** | `lib/personal-match-payment.ts`, `app/api/admin/reconcile-abandoned/route.ts`. Unpaid match fees marked Waived; collected cash preserved. |
| **Functional Test Suite (462/462 Pass)** | **VERIFIED** | `npm run test:functional` executed locally: 462 tests passed, 0 failures, 0 skipped, duration 1.15s. |
| **Security Emulator Suite (114 Pass in CI)** | **VERIFIED** | CI Run 44651141614 on GitHub Actions passed all jobs including `test-emulator`. |
| **Profile Entry in Top Header Avatar** | **VERIFIED** | `components/layout/AppHeader.tsx` [L158-184](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/layout/AppHeader.tsx#L158-L184). Avatar button directly opens `profile`. |

---

## 6. Claims That Could Not Be Verified Locally

1. **Local Execution of Firebase Rules Emulator (`npm run test:emulator`):**
   - **Reason:** Local macOS environment lacks a Java Runtime Environment (JRE/JDK 11+). Running `java -version` returns `Unable to locate a Java Runtime`.
   - **Constraint Respected:** Per instructions, Java was not installed and the environment was not altered.
   - **Alternative Evidence:** The exact emulator test suite was confirmed passing in GitHub Actions CI (Run 44651141614 and Run 44574075080).
2. **Live Production Browser Payment Capture on `mig-mov`:**
   - **Reason:** Payments are intentionally blocked fail-closed on `mig-mov` by `arePaymentOperationsEnabled()`.
   - **Alternative Evidence:** Verified through unit simulation in `tests/database-isolation-and-payment-safety.test.mjs` and `tests/razorpay-tamper.test.mjs`.

---

## 7. Open Owner Decisions

| Decision ID | Summary | Options / Context | Action Required |
|---|---|---|---|
| **OD-01** | **Staging Environment Confirmation** | Live application at `https://play.kavachcricket.com` is production. Need confirmation of designated staging URL / preview channel for Phase 7 live testing. | Owner to confirm staging deployment channel. |
| **OD-02** | **Production Cutover Strategy** | Merge modernizations from `mig-mov` to `main` without downtime or data corruption. | Owner to approve cutover runbook prior to Phase 12. |
| **OD-03** | **Player Navigation Alignment** | Owner approved direction is 3 primary items (`Home`, `Club`, `Matches`) with Profile in Header Avatar. Code currently runs 5 items (`Home`, `Matches`, `Finance`, `Players`, `More`) on mobile, and 6 on desktop. | Owner approval to plan navigation alignment task restructuring bottom nav and desktop links to the 3-item model. |
| **OD-04** | **Admin Role Consolidation Plan** | Owner approved direction is 3 active roles (`Super Admin`, `Club Admin`, `Finance Admin`), consolidating Match Admin, Studio Admin, and Designer into Club Admin. Code and rules currently enforce 6 granular roles. | Owner approval to plan rules and code refactoring task consolidating `isMatchAdmin`, `isStudioAdmin`, and `isDesigner` into `isClubAdmin`. |

---

## 8. Security and Privacy Concerns

1. **No Sensitive Secrets Exposed:** All documentation was audited to ensure no API keys, private keys, service account JSON files, or personal phone numbers were included.
2. **Fail-Closed Guarantee Preserved:** The development environment remains strictly locked out from production database writes and live Razorpay payment processing.
3. **additive Firestore Rules Note:** When implementing OD-04 (role consolidation), engineers must remember that Firestore rules are **additive**. Simply adding `isClubAdmin()` to an existing rule does not remove a stale `isMatchAdmin()` permission unless the old helper is cleanly refactored.

---

## 9. Final Handover Readiness Assessment

### **Assessment: READY WITH CONDITIONS**

**Rationale:**
- **Architecture & Invariants:** Thoroughly documented, verified against code, and backed by passing automated test suites (462/462 unit tests, 114 emulator tests in CI).
- **Security & Integrity:** Critical vulnerabilities SEC-001 through SEC-006 and Remediations 1 through 1F-R are resolved and verified. Database isolation guarantees safety on branch `mig-mov`.
- **Conditions for Incoming Reviewer (Claude):**
  1. The reviewer must acknowledge Open Decisions **OD-03** (Player Navigation) and **OD-04** (Admin Role Consolidation) as approved targets requiring upcoming implementation refactoring, rather than treating the current 5-item nav or 6-role code as final.
  2. The reviewer must verify claims against the actual code rather than assuming documentation self-certifies correctness.
  3. Live payment operations remain blocked on `mig-mov` until an owner-approved staging or production cutover is executed.
