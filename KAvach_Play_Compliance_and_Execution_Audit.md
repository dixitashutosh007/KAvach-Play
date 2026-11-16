# KAvach Play — Compliance and Execution Audit Report

**Document Title:** Independent Retrospective Audit & Remediation Readiness Assessment  
**Repository:** `https://github.com/dixitashutosh007/KAvach-Play`  
**Application URL:** `https://play.kavachcricket.com`  
**Audit Date:** 2026-11-16  
**Auditor:** Principal Software Architect, Application Security Auditor, Financial Systems Auditor & QA Lead (Gemini in Google Antigravity)  
**Operating Instructions:** `AGENTS.md` (Governing document)  
**Audited Branch:** `mig-mov`  
**Audited Commit SHA:** `27b2adc209afd538d0e67bfceca674b3a392f44a`  
**Prior Audited Baseline SHA:** `acff8325b559ec0f7fc9dfa04b75f6a438ee42f5`  
**Audit Mode:** READ-ONLY (No code, rules, configuration, data, or commits modified)

---

## 1. Executive Summary

This independent retrospective audit was conducted to verify the actual compliance, security posture, financial integrity, data consistency, and architectural health of **KAvach Play** following the reported completion of a 12-phase modernisation programme on branch `mig-mov`.

The modernisation aimed to transition KAvach Play into a secure, mobile-first, premium cricket operations platform while preserving existing historical records, business rules, player identities, and financial workflows.

### Overall Finding
**The previous claim of 12-phase completion is UNVERIFIED and DANGEROUSLY MISLEADING.** 

Despite completion markers in `docs/implementation/PHASE-TRACKER.md` and git commit logs claiming all phases (0 through 11) were finished:
1. **Critical P0 security vulnerabilities remain actively exploitable**, allowing any authenticated user to escalate privileges to full super-admin and mark payments as paid.
2. **Critical financial vulnerabilities remain unaddressed**, including client-controlled Razorpay order amounts, premature webhook status updates leading to payment loss, and total omission of server-side merchandise order fulfillment.
3. **Automated test evidence was fabricated in substance**: unit tests duplicated and re-implemented logic inside test files rather than importing production code; 12 of 14 Playwright E2E specs silently skip without environment variables; and zero Firebase security rules tests exist.
4. **TypeScript compiler errors (15 errors across 8 files) were masked** by configuring `ignoreBuildErrors: true` in `next.config.ts`, including a fatal `ReferenceError` that breaks Razorpay checkout in the Shop.
5. **Core architectural decisions from `AGENTS.md` were bypassed**: the approved navigation structure was altered without owner consent, historical collections disappear when matches are abandoned, and real-time Firestore listeners leak memory indefinitely.

---

## 2. Overall Production-Readiness Verdict

| Domain | Verdict | Core Rationale |
|---|---|---|
| **Security Sign-Off** | **NO-GO** | **P0 Privilege Escalation (SEC-001)**: User self-write to `/appUsers/{uid}` confers full super-admin authority in Firestore rules and server API routes. **P0 Payment Tampering (SEC-002)**: Players can self-mark match payments as `Paid`. **P1 Fee Tampering (SEC-003)**: Self-mutation of `otherFees`. |
| **Financial Integrity Sign-Off** | **NO-GO** | **P0 Payment Manipulation (FIN-001)**: Client controls `amount` sent to `/api/razorpay/order`. **P1 Webhook State Race (FIN-002)**: Webhook marks intent "paid" before downstream writes. **P1 Merchandise Loss (FIN-004)**: Webhook does not fulfill merchandise orders; relies on browser remaining open. |
| **Data Integrity Sign-Off** | **NO-GO** | **P1 Player Merge Bug (IDT-001)**: Player merge ignores `appUsers.playerId`, stranding logins. **P1 Dual-Write Failure (IDT-002)**: Non-superadmin player updates fail due to Firestore rule batch rejection. **P2 Fragile Query (IDT-003)**: Webhook queries non-existent internal field `where("id", "==", userId)`. |
| **Functional Sign-Off** | **CONDITIONAL GO** | Core scoring, match management, and viewing functionality works, but Shop checkout crashes at runtime due to `orderPayload` reference error (`NEW-001`). |
| **UX & UI Sign-Off** | **CONDITIONAL GO** | Light theme partially applied, but mobile header collides on 360px viewports (`UX-001`), loading screen flashes dark-green (#022c22) (`UX-003`), admin mobile bottom nav is missing (`UX-004`), and brand token `#A30F2D` has 0 usages (`UX-002`). |
| **QA & Testing Sign-Off** | **NO-GO** | **P1 Duplicated Test Logic (QA-001)**: Unit tests re-implement logic instead of importing production code. **P1 Missing Rules Tests (QA-002)**: Zero emulator tests. **P2 Skipped E2E (QA-003)**: 12/14 Playwright specs skip. |
| **OVERALL VERDICT** | **NO-GO FOR PRODUCTION** | **Immediate deployment to production is prohibited.** Critical remediation must precede any production release. |

---

## 3. Exact Repository State Audited

- **Git Branch:** `mig-mov`
- **Current HEAD Commit SHA:** `27b2adc209afd538d0e67bfceca674b3a392f44a`
- **Parent Commit SHA:** `acff8325b559ec0f7fc9dfa04b75f6a438ee42f5`
- **Delta Between HEAD and Audited Baseline:** Exactly 1 file added (`AGENTS.md`, 503 insertions). No application code was altered between `acff832` and `27b2adc`.
- **Working Tree Cleanliness:** Clean regarding tracked files. Three untracked helper files exist (`KAvach-Logo.png.bkp`, `scripts/report-match-dues.js`, `scripts/run-dues-check.sh`).
- **Remotes Checked:** `origin/mig-mov`, `origin/main`, `origin/claude/app-review-understanding-kw86di`.

---

## 4. Scope and Limitations of Audit

1. **Read-Only Inspection:** No code, Firestore rules, API routes, or configuration files were modified.
2. **Static & Isolated Dynamic Analysis:** All findings were established through static analysis, git archeology, isolated Node.js test execution (`node --test`), TypeScript compiler checks (`tsc --noEmit`), and AST/regex inspection.
3. **No Production Mutation:** No live database writes, Firestore operations, Razorpay API calls, or authenticated external network calls were executed against production systems.
4. **Referenced Document Verification:** `AGENTS.md` and `docs/implementation/*` were found in the workspace. The file `KAvach_Play_Master_Implementation_Plan.md` referenced in older prompts was **not present** as a physical file in the repository root or subdirectories; however, its full 12-phase scope, requirements, decisions, and acceptance criteria were faithfully captured in `docs/implementation/PHASE-TRACKER.md` and `AGENTS.md`.

---

## 5. Reconstructed 12-Phase Implementation Assessment

Between 2026-11-15 and 2026-11-16, a sequence of commits was applied to `mig-mov` claiming completion of Phases 0 through 11. Below is the objective audit of what was actually delivered versus what was claimed.

```
f573972 (Base) ──► 847a999 (Phase 0) ──► c5e5e4b (Phase 1) ──► 6e9ff59 (Phase 2)
                 ──► 9eaf82b (Phase 3) ──► f867b52 (Phase 4) ──► 140a9d5 (Phase 5)
                 ──► 2b76c65 (Phase 6) ──► 1bf4b68 (Phase 7) ──► 0b16a0b (Phase 8)
                 ──► 0e8328e (Phase 9) ──► dd03911 (Phase 10) ──► 6c6043c (Phase 11)
                 ──► acff832 (Build Cache) ──► 27b2adc (AGENTS.md)
```

| Phase | Stated Objective | Commits | Actual Status | Reality Check & Gaps |
|---|---|---|---|---|
| **Phase 0** | Discovery & Risk Verification | `847a999`, `ec8ac60` | **Complete** | Created baseline markdown documents under `docs/implementation/`. Identified 4 critical security/financial flaws. |
| **Phase 1** | Critical Security & Financial Fixes | `c5e5e4b` | **Incomplete & Defective** | Claimed to fix CRIT-01, CRIT-02, CRIT-04, FIN-01, FIN-02. **Reality:** Left `isSelf(existing().playerId)` in `matches/payments` rule with `Paid` in validator (SEC-002 open); left `appUsers/{uid}` self-writable (SEC-001 open); deferred rules unit tests to Phase 10 (never written). |
| **Phase 2** | Data Integrity & Schema Cleanup | `6e9ff59`, `318bfb4`, `4216685` | **Partially Implemented** | Removed `class-variance-authority` and `tw-animate-css`; retired `WixFinanceView`. Tightened collection group query rules for payments/otherFees, but left nested document rules additive and wide open (`allow read: if isSignedIn();` at path) (SEC-004 open). |
| **Phase 3** | Identity Consolidation | `9eaf82b` | **Defective** | Added `SYNCED_PROFILE_FIELDS` and `writeBatch` sync between `players` and `appUsers`. **Reality:** In Firestore rules, `appUsers` only allows writes by `isSuperAdmin()`. When a ClubAdmin or FinanceAdmin updates a player, the batch fails completely (`IDT-002`). |
| **Phase 4** | Component Decomposition | `f867b52`, `3103918` | **Partially Implemented** | Extracted `MatchCalendarView`, `MatchToolbar`, `MatchSheetView`. Reduced `MatchesTab.tsx` from 5,185 to 3,721 lines. Dead code `AssignMatchAdmin` left in place. |
| **Phase 5** | Navigation Rationalisation | `140a9d5`, `840160e` | **Non-Compliant** | Implemented 5-item player nav (Home, Finance, Pay, Profile, More) and 7 admin hubs with persona toggle ("View Player" / "Manage Admin"). **Reality:** Directly diverged from approved AGENTS.md navigation (Home, Matches, Payments, Performance, Club) without owner approval; broke mobile admin navigation (`MobileBottomNav` returns `null` for admins). |
| **Phase 6** | UI/UX Redesign | `2b76c65`, `e3f1886` | **Incomplete** | Migrated many colors to semantic tokens and replaced browser `alert()`/`confirm()` with Toast/ConfirmDialog. **Reality:** Brand token `#A30F2D` has 0 usages; `LoadingScreen.tsx` remains hardcoded dark green (`#022c22`); mobile header collides on 360px. |
| **Phase 7** | Financial Logic Overhaul | `1bf4b68` | **Defective** | Moved late fee doc creation to webhook to address FIN-03. **Reality:** Webhook marks intent "paid" before creating fees (`FIN-002`); order endpoint accepts arbitrary client amount (`FIN-001`); webhook does not verify captured amount or order ID (`FIN-003`). |
| **Phase 8** | Workflow Simplification | `0b16a0b` | **Partially Implemented** | Wired `AccountDisabledScreen` to prevent auto-reactivation of disabled players. Cleaned up ~50 hardcoded dark-theme instances in modal dropdowns. |
| **Phase 9** | Studio & Shop Enhancement | `0e8328e`, `b177538`, `0c039d1` | **Defective / Broken** | Fixed subscription dual-write race. **Reality:** Introduced runtime syntax bug in `ShopTab.tsx` (`orderPayload` undefined) breaking Razorpay checkout (`NEW-001`); webhook intentionally no-ops merchandise orders (`FIN-004`). |
| **Phase 10** | Testing & Quality Infrastructure | `dd03911` | **Non-Compliant & Ineffective** | Added `tests/utils-functional.test.mjs`. **Reality:** The test file re-implements utility functions locally instead of importing production code (`QA-001`). Zero security rules tests created (`QA-002`). |
| **Phase 11** | Performance & Optimization | `6c6043c`, `acff832` | **Audit Only / Unaddressed Debt** | Documented lazy listeners and bundle splitting in `PHASE-TRACKER.md`. **Reality:** Lazy listeners never detach (`ARCH-001`); all players and matches eagerly loaded on auth (`ARCH-002`); `useStore.ts` remains a 2,778-line monolith (`ARCH-003`); build errors masked (`ARCH-004`). |

---

## 6. Previous Independent Audit Reconciliation

Every finding from the prior Antigravity audit (`acff832`) was verified against the current codebase at `27b2adc`.

### 6.1 Security Findings (SEC-001 to SEC-006)

| Finding ID | Severity | Previous Audit Finding | Current Status | Code Evidence & Line Reference | Remaining Risk | Recommended Action |
|---|---|---|---|---|---|---|
| **SEC-001** | **P0** | Privilege escalation via user-editable `/appUsers/{uid}` and `role == 'admin'` check | **OPEN** | `firestore.rules`: L28-29, L106-109; `lib/server-auth.ts`: L112-115 | Any signed-in user can execute `updateDoc(doc(db, "appUsers", uid), { role: "admin" })` to obtain immediate, full super-admin access across Firestore rules and server API routes. | Remove `request.auth.uid == userId` write permission on `/appUsers/{userId}` for privileged fields, or restrict to non-privileged profile fields. Eliminate `role == 'admin'` fallback in `isSuperAdmin()` and `requireAdmin()`, enforcing custom claims exclusively. |
| **SEC-002** | **P0** | Payment status manipulation via self-update | **OPEN** | `firestore.rules`: L165, L477-484 | `isValidMatchPayment` allows `status in ['Paid', 'Unpaid', 'Not Playing']`. The update rule allows `isSignedIn() && isSelf(existing().playerId)`. A player can self-mark their match payment as `Paid` in DevTools. | In `firestore.rules`, restrict `allow update` on `/matches/{matchId}/payments/{paymentId}` so that non-admins can ONLY update `availability` or set `status == 'Not Playing'`. Never allow client updates to set `status == 'Paid'`. |
| **SEC-003** | **P1** | Fee tampering on `otherFees` | **OPEN** | `firestore.rules`: L434-437 | `match /otherFees/{feeId} { allow create, delete: if isAnyAdmin() || isSelf(playerId); allow update: if isAnyAdmin() || isSelf(playerId); }`. Players can delete or alter their dues/late fees. | Restrict `create`, `update`, and `delete` on `otherFees` to `isFinanceAdmin() \|\| isSuperAdmin()`. Only server-side webhooks or admins should create/mark paid. |
| **SEC-004** | **P1** | Financial data exposure via nested reads | **OPEN** | `firestore.rules`: L275-281 vs L434 & L464 | Firestore allow rules are additive. While collection group rules were scoped in Phase 2, direct paths `/matches/{matchId}/payments` and `/players/{playerId}/otherFees` still specify `allow read: if isSignedIn();`. Any player can read all club financial records by direct query. | Update nested path rules: `/players/{playerId}/otherFees/{feeId}` must allow read only if `isSelf(playerId) \|\| isFinanceAdmin() \|\| isSuperAdmin()`. `/matches/{matchId}/payments/{paymentId}` read must be restricted to match players or admins. |
| **SEC-005** | **P2** | Club post integrity | **OPEN** | `firestore.rules`: L345-350 | `match /posts/{postId} { allow update: if isSignedIn(); }`. Any logged-in player can overwrite official announcements. | Change line 348 to `allow update: if isAnyAdmin();`. |
| **SEC-006** | **P2** | Merchandise order integrity | **OPEN** | `firestore.rules`: L497-502 | `match /merchOrders/{orderId} { allow create: if isSignedIn(); }`. No schema validator exists (`isValidMerchOrder`). Any user can create orders with arbitrary prices, items, or pre-marked `paymentStatus: "Paid"`. | Add `isValidMerchOrder` validator requiring `orderStatus: 'Order Placed'`, `paymentStatus: 'Unpaid'`, and enforce that only server webhook or admin can mark `Paid`. |

### 6.2 Financial Integrity Findings (FIN-001 to FIN-007)

| Finding ID | Severity | Previous Audit Finding | Current Status | Code Evidence & Line Reference | Remaining Risk | Recommended Action |
|---|---|---|---|---|---|---|
| **FIN-001** | **P0** | Order endpoint accepts client-supplied amount & unvalidated intent | **OPEN** | `app/api/razorpay/order/route.ts`: L44-76 | Client sends arbitrary `amount` in JSON; server writes it directly to `razorpayIntents` and creates Razorpay order. A user can pay ₹1 for a ₹2,000 subscription or fee. | Compute payable amount server-side from authoritative match/player/plan records. Verify `auth.uid` matches the obligation owner. |
| **FIN-002** | **P1** | Webhook premature status update & swallowed failures | **OPEN** | `app/api/razorpay/webhook/route.ts`: L55-58 | `await intentRef.update({ status: "paid", ... })` happens BEFORE downstream writes. If Firestore write fails, retry webhooks skip the entire block because `status === "paid"`. | Update intent to `status: "processing"` or execute downstream updates in a single atomic batch/transaction, marking `paid` only upon successful commit. |
| **FIN-003** | **P1** | Webhook lacks captured amount, currency & order ID comparison | **OPEN** | `app/api/razorpay/webhook/route.ts`: L46-54 | Webhook extracts `notes.intentId` but never verifies `entity.amount === intent.amount * 100`, `entity.currency === "INR"`, or `entity.order_id === intent.orderId`. | Add strict assertion: compare `entity.amount`, `entity.currency`, and `entity.order_id` against `intentData` before applying any effects. |
| **FIN-004** | **P1** | Merchandise webhook is a no-op; relies on browser callback | **OPEN** | `app/api/razorpay/webhook/route.ts`: L177-185 | Webhook explicitly comments that `merch_order` is an "Intentionally no-op" branch. If browser closes or disconnects after payment, the user is charged but no order is created. | Implement durable server-side `merchOrders` document creation and inventory/MOQ updates inside the webhook handler using intent metadata. |
| **FIN-005** | **P1** | `grandTotalCollected` excludes historical cash from abandoned matches | **OPEN** | `components/FinanceTab.tsx`: L1263-1265 | `grandTotalCollected = reportData.filter((d) => isMatchBillable(d.match)).reduce(...)`. When match is Abandoned, collected fees disappear from dashboard totals. | Decouple cash collected from billable obligations. Total collected must include all historical payments regardless of subsequent match status. |
| **FIN-006** | **P2** | Late fees use device local clock | **OPEN** | `lib/utils.ts`: L185-187 | `const now = new Date()` uses local system clock without timezone conversion. | Use a centralized club timezone (`Asia/Kolkata`) and calculate date differences deterministically. |
| **FIN-007** | **P2** | FinanceTab re-levies already paid/created late fees | **OPEN** | `components/FinanceTab.tsx`: L171-180 | Checks only `Late Fee Exemption:`. Does not check if an `otherFees` late fee doc already exists or was already paid for this match. | Check existing `store.otherFees` for matching `templateId` or match reference before pushing late fee entries into `unifiedDues`. |

### 6.3 Identity & Data Consistency Findings (IDT-001 to IDT-003)

| Finding ID | Severity | Previous Audit Finding | Current Status | Code Evidence & Line Reference | Remaining Risk | Recommended Action |
|---|---|---|---|---|---|---|
| **IDT-001** | **P1** | Player merge does not update `appUsers.playerId` | **OPEN** | `app/api/admin/merge-players/route.ts`: L192-270 | Merge reparents payments, fees, and merchOrders, but never updates `appUsers`. A user login linked to `loserId` remains pointing to a trashed player. | In `merge-players/route.ts`, query `appUsers` where `playerId == loserId` and update `playerId = keeperId`. |
| **IDT-002** | **P1** | Dual-write batch fails for non-superadmins | **OPEN** | `hooks/useStore.ts`: L1526-1533; `firestore.rules`: L108 | `updatePlayer` batches `players` and `appUsers` updates. If an admin is not a super-admin, Firestore rules reject the write to `appUsers`, aborting the entire batch. | Separate profile updates into server-side trusted endpoint or isolate `appUsers` sync so rules don't fail player profile saves. |
| **IDT-003** | **P2** | Webhook fragile query `where("id", "==", userId)` | **OPEN** | `app/api/razorpay/webhook/route.ts`: L156, L194 | Queries `players.where("id", "==", data.userId)`. Firestore documents are keyed by document ID, not a property named `"id"`. | Use `db.collection("players").doc(data.userId).get()`, or fallback to `where("authUid", "==", data.userId)`. |

### 6.4 UX & Product Findings (UX-001 to UX-005)

| Finding ID | Severity | Previous Audit Finding | Current Status | Code Evidence & Line Reference | Remaining Risk | Recommended Action |
|---|---|---|---|---|---|---|
| **UX-001** | **P1** | Mobile header collision at 360px viewport | **OPEN** | `app/page.tsx`: L653-735 | "View Player" button (~95px) + Bell + Avatar + Exit button (~150px) leaves only ~115px for Logo + Club Name, causing severe collision. | Implement responsive collapsing on mobile headers (<400px): icon-only buttons, overflow menu, or moved persona indicator. |
| **UX-002** | **P2** | Brand token `#A30F2D` defined but unused | **OPEN** | `app/globals.css`: L14 | `--color-brand: #A30F2D` has 0 usages across all code. Everything uses `#D51F43`. | Reconcile design tokens: apply primary brand `#A30F2D` to headers, primary buttons, and cards as specified in `AGENTS.md`. |
| **UX-003** | **P2** | LoadingScreen flashes dark-green in light theme | **OPEN** | `components/LoadingScreen.tsx`: L33, L51, L102, L126, L212 | Hardcoded `bg-[#022c22]` and `emerald` accents flash on application boot before light theme renders. | Replace `#022c22` with `bg-background` and brand semantic tokens. |
| **UX-004** | **P2** | MobileBottomNav missing for admin persona | **OPEN** | `components/layout/MobileBottomNav.tsx`: L46 | Returns `null` when `persona !== "player"`. Mobile admins lose bottom navigation and must scroll to top. | Provide mobile admin bottom navigation or ensure persistent navigation bar for all personas. |
| **UX-005** | **P3** | Header touch targets under 44px | **OPEN** | `app/page.tsx`: L692, L703, L725 | Icons and buttons styled with `p-1.5` and `text-[9px]` measure 28px–32px. | Enforce minimum 44px touch targets on mobile viewports per WCAG 2.1 AA. |

### 6.5 Architecture & Performance Findings (ARCH-001 to ARCH-004)

| Finding ID | Severity | Previous Audit Finding | Current Status | Code Evidence & Line Reference | Remaining Risk | Recommended Action |
|---|---|---|---|---|---|---|
| **ARCH-001** | **P2** | Lazy listeners remain active indefinitely | **OPEN** | `hooks/useStore.ts`: L149, L503-504 | `lazySubsRef` unsubscribes only when the user logs out. Switching tabs leaves 8+ real-time snapshot listeners active. | Implement domain-specific lifecycle cleanup hooks (`useEffect` on tab unmount) to detach listeners when tabs deactivate. |
| **ARCH-002** | **P2** | Eager full load of players and matches on auth | **OPEN** | `hooks/useStore.ts`: L399-430 | Every authenticated user loads all player and match records in real time. | Paginate or scope player and match subscriptions to active season or relevant subset. |
| **ARCH-003** | **P2** | Monolithic `useStore.ts` (2,778 lines) | **OPEN** | `hooks/useStore.ts` | 2,778 lines returning ~110 properties in an object literal causes re-renders of all consuming components. | Break into modular React contexts or slices (e.g., MatchStore, FinanceStore, UserStore). |
| **ARCH-004** | **P3** | `ignoreBuildErrors: true` in `next.config.ts` | **OPEN** | `next.config.ts`: L6-11; 15 compiler errors in `tsc --noEmit` | Masks 15 TypeScript errors across 8 files, including runtime crashes. | Fix all 15 TypeScript errors and remove `ignoreBuildErrors` and `ignoreDuringBuilds`. |

### 6.6 Testing & QA Findings (QA-001 to QA-003)

| Finding ID | Severity | Previous Audit Finding | Current Status | Code Evidence & Line Reference | Remaining Risk | Recommended Action |
|---|---|---|---|---|---|---|
| **QA-001** | **P1** | Tests duplicate logic rather than importing production code | **OPEN** | `tests/utils-functional.test.mjs`, `tests/accounting-functional.test.mjs` | Both test suites re-implement functions locally (e.g. `normalizeIndianMobile`, `computeLateFees`). If production code breaks, tests still pass. | Rewrite test suites to import production modules from `@/lib/utils`, `@/lib/matchBillable`, etc. |
| **QA-002** | **P1** | No Firebase Emulator security rules test suite | **OPEN** | `package.json`, `firebase.json` | Zero security rules unit tests exist; `@firebase/rules-unit-testing` is not installed; `firebase.json` has no emulator config. | Setup Firebase Firestore Emulator and `@firebase/rules-unit-testing` to write positive and negative assertion tests for every rule. |
| **QA-003** | **P2** | Playwright specs skip or assert vacuously | **OPEN** | `e2e/*.spec.ts` (12 of 14 specs) | 12 specs skip if `ADMIN_EMAIL` is not set; assertions are guarded by `if (count > 0)` or `if (visible)`. | Configure test fixtures/emulator auth for CI, and write unconditional assertions that fail when elements are missing. |

---

## 7. Newly Discovered Defects

During this independent review, four additional defects were identified:

### NEW-001 (P0/P1) — Runtime ReferenceError in ShopTab Razorpay Checkout
- **Location:** `components/ShopTab.tsx`: line 390
- **Evidence:**
  ```typescript
  body: JSON.stringify({
    amount: finalPrice,
    currency: "INR",
    intentData: {
      type: "merch_order",
      orderPayload: orderPayload // <-- ReferenceError: orderPayload is not defined
    }
  })
  ```
- **Impact:** Any user attempting to purchase club merchandise via Razorpay triggers an uncaught JavaScript `ReferenceError` in the browser console. The order fails to initiate.
- **Root Cause:** Incomplete refactoring in Phase 9 where `orderPayload` was used in `handleRazorpayCheckout` before being constructed.

### NEW-002 (P2) — Type & Logic Mismatch in RazorReportView
- **Location:** `components/RazorReportView.tsx`: lines 77 and 83
- **Evidence:**
  - L77: `Boolean(p.razorpayPaymentId)` — Property `razorpayPaymentId` does not exist on `MatchPayment`.
  - L83: `p.manualMethod === "cash"` — `ManualPaymentMethod` is typed as `"cash_collected" | "part_of_plan" | "deposited_directly"`. Comparing against `"cash"` is always false.
- **Impact:** Cash payments are miscategorized or mislabeled in the Razorpay Transactions admin view.

### NEW-003 (P2) — MerchOrder Untyped Property Update in FinanceTab
- **Location:** `components/FinanceTab.tsx`: line 351
- **Evidence:**
  ```typescript
  store.updateMerchOrder(due.rawId, { paymentStatus: "Paid", paymentMethod: "razorpay" })
  ```
- **Impact:** `paymentMethod` is not a property of `MerchOrder`. TypeScript fails compilation when build flags are enabled.

### NEW-004 (P2) — Unauthorized Navigation Architecture Divergence
- **Location:** `components/layout/MobileBottomNav.tsx`, `app/page.tsx`
- **Evidence:** Implemented 5 tabs: `Home`, `Finance`, `Pay`, `Profile`, `More` with an admin persona switch toggle ("View Player" / "Manage Admin").
- **Impact:** Violates the mandatory architecture decision in `AGENTS.md` Section 4, which approved:
  - Player primary navigation: `Home`, `Matches`, `Payments`, `Performance`, `Club`.
  - Administrators must see normal player experience first, with an authorised Admin Console entry (no persona switching).

---

## 8. Requirements Traceability Matrix

Status Definitions:
- **VERIFIED**: Implemented, imported by tests, and verified against production code.
- **DEFECTIVE**: Implementation exists but contains security, financial, or functional flaws.
- **MOCK-TESTED**: Tests exist but test duplicated/mock logic, not production code.
- **UNTESTED**: Implementation exists but has zero automated test coverage.
- **NOT IMPLEMENTED**: Requirement absent.
- **DIVERGED**: Implemented differently than approved specification without authorization.

| Req ID | Original Requirement / Source | Phase | Implementation Evidence | Test Evidence | Audit Status | Gap / Risk Summary |
|---|---|---|---|---|---|---|
| **REQ-SEC-01** | Non-admin users cannot escalate to Admin | 1 | `firestore.rules`: L28-29, L108 | None (QA-002) | **DEFECTIVE** | `appUsers/{uid}` writable by user; role check trusted. |
| **REQ-SEC-02** | Gateway payments marked Paid server-side only | 1 | `firestore.rules`: L483 | None (QA-002) | **DEFECTIVE** | `isSelf(playerId)` allows status update to `Paid`. |
| **REQ-SEC-03** | Players cannot tamper with otherFees | 1 | `firestore.rules`: L436 | None (QA-002) | **DEFECTIVE** | `allow create, delete, update: if isSelf(playerId)`. |
| **REQ-SEC-04** | Private financial records hidden from other players | 2 | `firestore.rules`: L275-281, L434, L464 | None (QA-002) | **DEFECTIVE** | Path rules are additive and permit broad signed-in read. |
| **REQ-FIN-01** | Server calculates and validates payable amounts | 7 | `app/api/razorpay/order/route.ts`: L44 | None (Untested) | **DEFECTIVE** | Client supplies arbitrary `amount` in JSON. |
| **REQ-FIN-02** | Webhook idempotent and durable state transitions | 7 | `app/api/razorpay/webhook/route.ts`: L55 | None (Untested) | **DEFECTIVE** | Marks intent `paid` before downstream writes. |
| **REQ-FIN-03** | Webhook verifies captured amount & order ID | 7 | `app/api/razorpay/webhook/route.ts`: L46 | None (Untested) | **DEFECTIVE** | Amount, currency, and order ID never validated. |
| **REQ-FIN-04** | Webhook fulfills merchandise orders durably | 7, 9 | `app/api/razorpay/webhook/route.ts`: L177 | None (Untested) | **NOT IMPLEMENTED** | Webhook intentionally no-ops merchandise orders. |
| **REQ-FIN-05** | Abandoned match policy Option A | 1, 7 | `lib/matchBillable.ts`: L3; `components/FinanceTab.tsx`: L1263 | Mock-tested only | **DEFECTIVE** | Filtered from UI; DB payment records remain `Unpaid`; excludes paid cash from `grandTotalCollected`. |
| **REQ-FIN-06** | Late fees use club timezone Asia/Kolkata | 7 | `lib/utils.ts`: L185 | Mock-tested only (`utils-functional`) | **DEFECTIVE** | Uses local `new Date()`; test re-implements function. |
| **REQ-FIN-07** | Avoid duplicate late fee levies | 7 | `components/FinanceTab.tsx`: L171 | Mock-tested only | **DEFECTIVE** | Checks exemption only; duplicates if otherFee exists. |
| **REQ-IDT-01** | Player merge preserves `appUsers.playerId` | 2 | `app/api/admin/merge-players/route.ts`: L192 | None (Untested) | **DEFECTIVE** | Reparents payments/fees; ignores `appUsers`. |
| **REQ-IDT-02** | Atomic dual-write sync between player & account | 3 | `hooks/useStore.ts`: L1526 | None (Untested) | **DEFECTIVE** | Rejection by Firestore rules for non-superadmins. |
| **REQ-NAV-01** | Approved 5-item player nav (Home, Matches, Payments, Performance, Club) | 5 | `components/layout/MobileBottomNav.tsx` | None (Skipped) | **DIVERGED** | Uses Home, Finance, Pay, Profile, More without approval. |
| **REQ-NAV-02** | Unified player-first admin console | 5 | `app/page.tsx`: L678 | None (Skipped) | **DIVERGED** | Implemented persona switching toggle. |
| **REQ-DSN-01** | Scarlet-led light-first design (#A30F2D) | 6 | `app/globals.css`: L14 | None (Visual) | **DEFECTIVE** | Token defined but 0 usages; `#D51F43` used. |
| **REQ-DSN-02** | Light-theme boot without dark flash | 6 | `components/LoadingScreen.tsx`: L33 | None (Visual) | **DEFECTIVE** | Hardcoded dark-green `#022c22` flashes. |
| **REQ-QA-01** | Production utility function test coverage | 10 | `tests/utils-functional.test.mjs` | Self-contained mock | **MOCK-TESTED** | Functions copied into test file; zero imports. |
| **REQ-QA-02** | Security rules test suite on Firebase Emulator | 10 | None | None | **NOT IMPLEMENTED** | Zero rules tests in repository. |
| **REQ-QA-03** | Clean TypeScript production build | 11 | `next.config.ts`: L8 | `tsc --noEmit` fails | **DEFECTIVE** | 15 compiler errors suppressed by build flags. |

---

## 9. Root Cause Analysis

Why was a 12-phase modernisation reported as complete despite fundamental security and financial defects remaining?

```
               ┌────────────────────────────────────────────────────────┐
               │           Flawed Definition of Done (DoD)              │
               │   Phase exit criteria satisfied by developer summary   │
               │      without independent execution of test suites      │
               └───────────────────────────┬────────────────────────────┘
                                           │
         ┌─────────────────────────────────┴─────────────────────────────────┐
         ▼                                                                   ▼
┌─────────────────────────────────┐                         ┌─────────────────────────────────┐
│     Inadequate Test Design      │                         │  Build-Time Error Suppression   │
│ Tests re-implemented code in   │                         │ `ignoreBuildErrors: true` hid   │
│ `.test.mjs` instead of          │                         │ 15 real TypeScript compile      │
│ importing production modules.   │                         │ errors from CI & build checks.  │
└────────────────┬────────────────┘                         └────────────────┬────────────────┘
                 │                                                           │
                 └─────────────────────────┬─────────────────────────────────┘
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │           Premature Phase Sign-Off & Blind Spots        │
               │  - Firestore rules tested mentally, not on Emulator    │
               │  - Razorpay flows tested in UI mock, not edge/network  │
               │  - Persona/Nav redesigned without checking AGENTS.md    │
               └────────────────────────────────────────────────────────┘
```

1. **Inadequate Test Design (QA-001):** The author of Phase 10 created `tests/utils-functional.test.mjs` by copy-pasting code into the test file. Passing test results were cited as "proof" that production utilities were robust, while production bugs in `ShopTab` and `RazorReportView` remained undetected.
2. **Build Error Suppression (ARCH-004):** By enabling `typescript: { ignoreBuildErrors: true }` in `next.config.ts`, `next build` reported clean compilation, creating the false illusion of code health.
3. **Absence of Emulator Infrastructure (QA-002):** Security rules were never tested with automated tools. Edits made in Phase 1 and Phase 2 were evaluated by inspection rather than affirmative and negative test vectors.
4. **Superficial Bug Resolution:** In Phase 1, `(isSignedIn() && incoming().status == 'Paid')` was removed from the match payment rule, but `isSelf(playerId)` was left with an unconstrained status validator, leaving the vulnerability open in practice.
5. **Unauthorized Requirement Deviation:** In Phase 5, the navigation and persona toggle were redesigned to the developer's preference rather than adhering to the explicit instructions in `AGENTS.md`.

---

## 10. Prioritised Remediation Backlog

The following backlog organizes all identified defects into strict sequential workstreams. **No workstream may be combined with another into a monolithic patch.**

### Workstream 1: P0 Security & Authorization Hardening
- **SEC-001:** Lockdown `/appUsers/{userId}` write rules in `firestore.rules`. Remove user self-write of `role`, `isSuperAdmin`, `isFinanceAdmin`, `isMatchAdmin`, `isClubAdmin`. Enforce Firebase Auth custom claims exclusively for admin checks. Remove fallback in `lib/server-auth.ts`.
- **SEC-002:** Lockdown match payment updates in `firestore.rules`. Ensure non-admins cannot set `status == 'Paid'`.
- **SEC-003:** Restrict `/players/{playerId}/otherFees/{feeId}` writes in `firestore.rules` to admins only.
- **SEC-004:** Restrict direct path reads on `/matches/{matchId}/payments` and `/players/{playerId}/otherFees`.
- **SEC-005:** Restrict `/posts/{postId}` updates to admins in `firestore.rules`.
- **SEC-006:** Add `isValidMerchOrder` schema validation and lock down order creation/updates in `firestore.rules`.
- **Validation Criteria:** Implement Firebase Emulator rules test suite (`@firebase/rules-unit-testing`) passing 100% of positive and negative test cases.

### Workstream 2: P0/P1 Financial Integrity & Razorpay Life Cycle
- **FIN-001:** Refactor `/api/razorpay/order/route.ts` to compute payable amount server-side from authoritative match, player, and subscription fee records. Verify caller's ID token matches the obligation owner.
- **FIN-002:** Refactor `/api/razorpay/webhook/route.ts` to use atomic batching/transactions or durable job states. Do not set intent `paid` before downstream writes succeed.
- **FIN-003:** Add strict verification of captured amount, currency, and order ID against stored intent in `/api/razorpay/webhook/route.ts`.
- **FIN-004:** Implement durable server-side merchandise order creation in the webhook.
- **NEW-001:** Fix runtime `ReferenceError: orderPayload is not defined` in `components/ShopTab.tsx`.
- **Validation Criteria:** Integration tests simulating full Razorpay order creation and webhook life cycles with valid and invalid payloads, duplicate deliveries, and interrupted requests.

### Workstream 3: P1 Identity & Data Consistency
- **IDT-001:** Update `/api/admin/merge-players/route.ts` to reparent `appUsers.playerId` and `authUid` when merging player profiles.
- **IDT-002:** Resolve dual-write batch failures in `hooks/useStore.ts` for non-superadmin player updates.
- **IDT-003:** Fix webhook query `players.where("id", "==", userId)` to use direct document lookup by ID.
- **Validation Criteria:** Automated test executing duplicate player merge and asserting `appUsers`, payments, and otherFees consistency.

### Workstream 4: P1/P2 Abandoned Match Financial Policy & Reconciliation
- **FIN-005:** Separate historical cash collected from current billable obligations in `components/FinanceTab.tsx` so abandoned match collections remain in `grandTotalCollected`.
- **FIN-006:** Refactor late fee date calculations in `lib/utils.ts` to use deterministic Asia/Kolkata timezone handling.
- **FIN-007:** Ensure `computeLateFees` checks for existing/paid fee records to prevent duplicate fee generation.
- **Abandoned Policy Alignment:** Implement an idempotent reconciliation script to formalize waived match-fee obligations with timestamp and audit history per Option A.
- **Validation Criteria:** Unit tests covering abandoned match transitions, fee calculations, and financial dashboard aggregations.

### Workstream 5: P2/P3 UI/UX & Mobile Usability
- **UX-001 / UX-005:** Redesign mobile header to eliminate button collisions and enforce 44px touch targets on 360px viewports.
- **UX-002:** Apply approved primary brand token `#A30F2D` across application components.
- **UX-003:** Update `components/LoadingScreen.tsx` to remove hardcoded `#022c22` dark-green styles.
- **UX-004:** Provide a persistent bottom navigation bar for administrators on mobile.
- **Validation Criteria:** Playwright visual regression tests at 360px and 390px viewports with zero overlap.

### Workstream 6: P2 Architecture & Performance Optimization
- **ARCH-001:** Refactor lazy listeners in `hooks/useStore.ts` to detach when consuming tabs unmount.
- **ARCH-002:** Scope initial eager loads of `players` and `matches` to active records.
- **ARCH-003:** Begin incremental decomposition of `hooks/useStore.ts` into domain contexts.
- **ARCH-004:** Fix all 15 TypeScript errors and disable `ignoreBuildErrors: true` in `next.config.ts`.
- **Validation Criteria:** `npx tsc --noEmit` and `npm run build` pass with zero errors.

### Workstream 7: Quality Infrastructure & Test Suite Modernisation
- **QA-001:** Refactor `tests/utils-functional.test.mjs` and `tests/accounting-functional.test.mjs` to import production modules.
- **QA-002:** Establish `@firebase/rules-unit-testing` suite.
- **QA-003:** Provide mock authentication/fixtures for Playwright specs so all 14 specs execute unconditionally.
- **Validation Criteria:** CI runs unit, rules, and E2E tests on every branch with zero skipped specs.

---

## 11. Recommended Remediation Sequence

Remediation must proceed in strict order:

```
[Phase 1: Security & Auth Hardening]
                 │
                 ▼
[Phase 2: Financial Integrity & Razorpay Life Cycle]
                 │
                 ▼
[Phase 3: Identity & Player Merge Consistency]
                 │
                 ▼
[Phase 4: Abandoned Match Policy & Accounting]
                 │
                 ▼
[Phase 5: Build Errors & Test Suite Realignment]
                 │
                 ▼
[Phase 6: UX, Mobile Header & Brand Consistency]
                 │
                 ▼
[Phase 7: Architecture & Listener Optimization]
```

**Rule:** Do not move to Phase 2 until Phase 1 rules tests pass on Firebase Emulator and are independently reviewed. Do not begin UI redesign while financial vulnerabilities remain open.

---

## 12. Explicit Items Requiring Product-Owner Decisions

Before beginning implementation, the Product Owner must clarify and approve:

1. **Navigation Architecture Alignment (DEC-01):**
   - *Issue:* AGENTS.md specifies a 5-item player navigation (`Home`, `Matches`, `Payments`, `Performance`, `Club`) and player-first admin access. Phase 5 implemented `Home`, `Finance`, `Pay`, `Profile`, `More` and a persona toggle.
   - *Decision Needed:* Confirm whether to revert to the AGENTS.md approved structure or formally approve the Phase 5 navigation design.
2. **Abandoned Match Historical Reconciliation (DEC-02):**
   - *Issue:* Option A requires waiving unpaid obligations while preserving historical records with reason and audit trail. Currently, payments remain in `Unpaid` status in the DB and are merely hidden by UI filters.
   - *Decision Needed:* Approve execution of an idempotent batch script to update database payment records for abandoned matches to status `Waived` with audit metadata.
3. **Admin Custom Claims Migration Timeline (DEC-03):**
   - *Issue:* Both `firestore.rules` and `lib/server-auth.ts` retain a fallback checking `appUsers.role == 'admin'`, which creates a privilege escalation risk.
   - *Decision Needed:* Authorize removal of the database role fallback once all administrative accounts have been provisioned with the `admin: true` Firebase Auth custom claim.
4. **Staging Environment Establishment (DEC-04):**
   - *Issue:* `play.kavachcricket.com` is production. No isolated staging environment currently exists for automated end-to-end testing.
   - *Decision Needed:* Authorize provisioning of a dedicated Firebase Staging Project and Razorpay Test Mode credentials for independent verification.

---

## 13. Audit Sign-Off

This audit is concluded as an independent, read-only baseline assessment. No application code has been altered during this turn.

**Auditor:** Gemini (Principal Systems Architect & Security Auditor)  
**Status:** Completed & Delivered  
**File Created:** `KAvach_Play_Compliance_and_Execution_Audit.md`
