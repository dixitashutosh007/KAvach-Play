# KAvach Play — Engineering Handover Package

**Project:** KAvach Play Modernisation  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Current Development Branch:** `mig-mov`  
**Audited Baseline HEAD:** `6ed38d4d984326403196f777706ba9a16f40edf9`  
**Production Branch:** `main` (AWS Amplify / `us-west1` Firestore)  
**Production Application:** `https://play.kavachcricket.com`  
**Product Owner:** KAvach Cricket Club  
**Current Implementation Agent:** Gemini in Google Antigravity  
**Independent Technical Reviewer:** ChatGPT (read-only architectural and review partner)  
**Incoming Independent Engineering Reviewer:** Claude (future scheduled engagement)  
**Date of Handover Package:** 25 November 2026 (Reconciled & Synchronized)  

---

## 1. Overview & Purpose of This Handover

This engineering handover package establishes a permanent, comprehensive, and evidence-based architectural record of the KAvach Play platform.

It is designed to enable a future independent senior engineering agent (**Claude**) to review, understand, challenge, and harden the application without needing to reconstruct its architecture, data models, business rules, security posture, or implementation history from scratch.

### Key Governance Principles

1. **Antigravity remains the primary implementation agent.** Implementation proceeds on branch `mig-mov` under owner-approved tasks.
2. **Claude's engagement is scheduled for independent hardening.** Claude will be engaged only after planned Antigravity implementation milestones are complete.
3. **Evidence-based reporting only.** Claims in this package are substantiated by exact source files, lines, commits, and verified test execution.
4. **Strict separation of statuses.** This repository strictly distinguishes:
   - `Implemented` (code written in repository)
   - `Automated tests passed` (locally or CI verified with exact logs)
   - `Manual verification pending` (human or browser inspection not yet executed)
   - `Independently reviewed` (reviewed by ChatGPT or independent QA)
   - `Owner-approved` (explicitly signed off by product owner)
   - `Production-deployed` (built and released to production branch)
   - `Production-verified` (verified working against live production data)

---

## 2. Reading Order for Incoming Engineers

To gain a complete and accurate understanding of KAvach Play, read this documentation suite in the following order:

```
docs/engineering-handover/
├── 1. README.md (This file — orientation, governance, key architecture & review guide)
├── 2. ARCHITECTURE.md (Stack, dual-database isolation, navigation, data models, APIs)
├── 3. SECURITY-AND-ACCESS.md (Three-role model, Access Control API, rules, identity leases)
├── 4. BUSINESS-WORKFLOWS.md (Matches, squads, Option A billing, Razorpay, Studio, Shop, POTW)
├── 5. TESTING-AND-QUALITY.md (Test commands, test execution logs, test debt register, limitations)
├── 6. PHASE-AND-IMPLEMENTATION-STATUS.md (Remediation progress, commits, tech debt, open decisions)
└── 7. HANDOVER-VALIDATION-REPORT.md (Reconciliation report, verified claims, open decisions)
```

### Governing Documents Outside This Directory

- `AGENTS.md` (root) — Persistent non-negotiable operating rules, security constraints, and approved decisions.
- `agent.md` (root) — Daily agent operating instructions, review cycles, and handoff expectations.
- `cloud.md` (root) — Canonical Firebase/GCP cloud environments, database identifiers, and restore state.
- `docs/implementation/DECISION-LOG.md` — Authoritative record of approved architectural decisions (D-01 through D-22).
- `docs/implementation/PHASE-TRACKER.md` — Active remediation master plan vs historical unverified 12-phase claims.

---

## 3. High-Level System Status Summary

| Area | Current State | Authoritative Evidence |
|---|---|---|
| **Repository Branch** | `mig-mov` (tracking `origin/mig-mov`) | Git HEAD `6ed38d4` |
| **GCP Project** | `gen-lang-client-0004191483` | [cloud.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/cloud.md#L9) |
| **Development Database** | `kavach-play-db-ext` (`asia-south1`) | Refreshed Nov 20, 2026 from production snapshot |
| **Production Database** | `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` (`us-west1`) | Branch `main`, live on Amplify |
| **Payment Operations** | **Strictly disabled** on `mig-mov` via fail-closed guard | `lib/database-config.ts` [arePaymentOperationsEnabled](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/database-config.ts#L201-L233) |
| **Functional Tests** | **1,154 passed, 20 test debt failures** across 276 suites (`node:test`) | `npm run test:functional` verified locally at `6ed38d4` (3.1s) |
| **Security Emulator Tests**| **114 passed** in CI (Java runtime required for local run) | `scripts/run-emulator-tests.mjs`, verified in CI Run 44651141614 |
| **TypeScript / Lint Status** | **0 errors** in `npx tsc --noEmit`; **0 errors** in `npm run lint` | Verified locally across entire codebase |
| **Active Remediation Track** | Phases 0–6 Complete / Hardened; D-16–D-22 Implemented | [PHASE-TRACKER.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/docs/implementation/PHASE-TRACKER.md) |
| **Subsequent Prod Phases** | Phases 7–12 Planned / Not Started in Production | Authoritative Master Plan |

---

## 4. Key Reconciled Architecture & Approved Decisions

The following key decisions are approved and implemented in the current codebase:

### A. Player Navigation Architecture (Approved & Implemented — D-20)
- **Player Navigation:** Exactly **`Home`, `Club`, `Matches`**, in that order, identical across mobile and desktop.
- **Profile Location:** Personal Profile opens exclusively from the top header avatar (`AppHeader.tsx`), with a contextual back affordance.
- **No More Drawer:** The More menu/drawer is eliminated for the Player persona. Secondary destinations (Directory, Studio, Shop, Polls & Pulse) open contextually from Home or Club.
- **Implemented In:** [lib/player-navigation.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-navigation.ts), [components/layout/MobileBottomNav.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/layout/MobileBottomNav.tsx#L121-L152), and [app/page.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/page.tsx#L840-L900) in commit `0ea901b`.

### B. Admin Navigation & Persona Isolation (Approved & Implemented — D-18, D-19)
- **Admin Navigation:** Exactly **`Home`, `Match Center`, `Club`, `Finance`, `Design Studio`, `Settings`**, in that order, identical on mobile and desktop.
- **Persona Isolation:** Administrators experience the Player persona first. Admin menus, prompt banners, and management actions are rendered **only in Admin persona**. Menu visibility is never authorisation.
- **Access Denied:** Unauthorized destinations render a polite access-denied screen (D-19).
- **Implemented In:** [lib/admin-navigation.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/admin-navigation.ts), [components/layout/MobileBottomNav.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/layout/MobileBottomNav.tsx#L80-L118), and [app/page.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/page.tsx) in commits `ad99245` and `c2a910b`.

### C. Three-Role Admin Model & Access Control Centre (Approved & Implemented — D-22)
- **Active Roles:** Exactly **`Super Admin`**, **`Club Admin`**, and **`Finance Admin`**.
  - **Super Admin:** Granted strictly via Firebase Auth custom claim `admin: true` (SEC-001).
  - **Club Admin:** Consolidated operational authority; absorbed retired Match Admin, Studio Admin, and Designer roles.
  - **Finance Admin:** Governs match payments, fee plans, reconciliation, and ledger operations.
- **Retired Flags Grant Nothing:** `isMatchAdmin`, `isStudioAdmin`, `isDesigner`, and `canDesign` flags grant 0 access in `firestore.rules` and `lib/server-auth.ts`.
- **Single Role Writer:** Roles are modified exclusively via the Super-Admin-only server API `/api/admin/access`. In `firestore.rules`, `roleKeys()` on `appUsers` are server-only.
- **Access Control Centre:** Fully implemented in **Settings → Access Control** ([components/access/AccessControlCentre.tsx](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/access/AccessControlCentre.tsx)) in commit `e2c7b32`.

---

## 5. Instructions for the Incoming Independent Engineering Reviewer

> **Mandatory directive for Claude (or any incoming senior reviewer):**  
> Do not treat this documentation package as self-certifying proof that the code is free of bugs, security holes, or race conditions. This documentation represents our honest, verified accounting of the system as constructed. Your primary responsibility is to **independently inspect, challenge, trace, and stress-test** the actual source code and rules.

### Your Review Protocol

1. **Verify the Current Git Baseline First:**
   - Execute `git status`, verify current branch (`mig-mov`) and HEAD commit SHA (`6ed38d4`).
   - Confirm you are working in the correct repository and directory.
   - Inspect recent commit log (`git log -n 15 --oneline`).

2. **Verify Environment and Payment Isolation Invariants:**
   - Inspect `lib/database-config.ts` and `lib/server-db.ts`.
   - Confirm that development branch `mig-mov` can never connect to production database `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412`.
   - Confirm that live Razorpay payments, orders, and webhook mutations fail closed on non-`main` branches.
   - Review `tests/database-isolation-and-payment-safety.test.mjs`.

3. **Verify Security Invariants in Firestore Rules & Server Auth:**
   - Inspect `firestore.rules`. Check all `allow` rules. Remember that Firestore rules are **additive**: a restrictive rule in one block never cancels a permissive rule in an overlapping block.
   - Trace `/appUsers/{userId}` write rules: ensure `roleKeys()` cannot be modified by any client SDK.
   - Trace `/players/{playerId}` update rules: ensure client self-updates are restricted to `isValidPlayerSelfUpdate` allowlisted fields.
   - Trace `/matches/{matchId}/payments/{paymentId}`: ensure players can only update between `Unpaid` and `Not Playing`, and cannot self-escalate to `Paid`.
   - Inspect `lib/server-auth.ts`: confirm that `isSuperAdmin` strictly requires the `admin: true` custom claim from Firebase Auth, and never trusts `appUsers.role`.

4. **Verify Concurrency and Financial Integrity Invariants:**
   - Trace `app/api/razorpay/order/route.ts`: verify client amount is discarded and `derivePayableAmount()` calculates fees from authoritative records.
   - Trace `app/api/razorpay/webhook/route.ts`: verify HMAC-SHA256 signature verification uses `crypto.timingSafeEqual` over the raw request body.
   - Trace B1 (merch order ownership in `lib/razorpay-order.ts`) and B2 (duplicate settlement guard in `lib/payment-settlement.ts`).
   - Trace `lib/player-merge.ts`: verify worker lease acquisition, fencing tokens, transactional reservation validation, and financial record collision resolution.
   - Inspect abandoned match handling: ensure Option A is upheld (waived match fees, zero dues, cash collected preserved as informational history).

5. **Execute Automated Validation & Review Test Debt:**
   - Run `npm run test:functional` to inspect the 1,174 tests.
   - Review the 20 failing tests in Section 6 of `TESTING-AND-QUALITY.md` (all 20 are assertion drift against D-22).
   - If a Java runtime is present, run `npm run test:emulator` to execute the Firestore rules emulator suite.

6. **Deliver Your Review Findings:**
   - Structure your review into: (a) Verified Invariants, (b) Suspected Vulnerabilities or Regressions, (c) Edge Cases & Concurrency Risks, (d) Architectural Recommendations.
   - For every finding, provide exact file paths, line numbers, and a reproduction trace.
