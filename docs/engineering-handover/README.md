# KAvach Play — Engineering Handover Package

**Project:** KAvach Play Modernisation  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Current Development Branch:** `mig-mov`  
**Current Development HEAD:** `8978577d69406fcca2374767ccf1704ae1803fd0`  
**Production Branch:** `main` (AWS Amplify / `us-west1` Firestore)  
**Production Application:** `https://play.kavachcricket.com`  
**Product Owner:** KAvach Cricket Club  
**Current Implementation Agent:** Gemini in Google Antigravity  
**Independent Technical Reviewer:** ChatGPT (read-only architectural and review partner)  
**Incoming Independent Engineering Reviewer:** Claude (future scheduled engagement)  
**Date of Handover Package Baseline:** 24 November 2026 (Reconciled & Validated)  

---

## 1. Overview & Purpose of This Handover

This engineering handover package establishes a permanent, comprehensive, and evidence-based architectural record of the KAvach Play platform. 

It is designed to enable a future independent senior engineering agent (**Claude**) to review, understand, challenge, and harden the application without needing to reconstruct its architecture, data models, business rules, security posture, or remediation history from scratch.

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
├── 1. README.md (This file — orientation, governance, key discrepancies & review guide)
├── 2. ARCHITECTURE.md (Stack, dual-database isolation, data models, state, APIs)
├── 3. SECURITY-AND-ACCESS.md (RBAC matrix, Firestore rules, API guards, identity leases)
├── 4. BUSINESS-WORKFLOWS.md (Matches, squads, Option A billing, Razorpay, Studio, Shop)
├── 5. TESTING-AND-QUALITY.md (Test commands, test execution logs, defect register, limitations)
├── 6. PHASE-AND-IMPLEMENTATION-STATUS.md (Remediation progress, commits, tech debt, open decisions)
└── 7. HANDOVER-VALIDATION-REPORT.md (Reconciliation report, verified claims, open decisions)
```

### Governing Documents Outside This Directory

- `AGENTS.md` (root) — Persistent non-negotiable operating rules, security constraints, and approved decisions.
- `agent.md` (root) — Daily agent operating instructions, review cycles, and handoff expectations.
- `cloud.md` (root) — Canonical Firebase/GCP cloud environments, database identifiers, and restore state.
- `docs/implementation/DECISION-LOG.md` — Authoritative record of approved architectural decisions (D-01 through D-15).
- `docs/implementation/PHASE-TRACKER.md` — Active remediation master plan vs historical unverified 12-phase claims.

---

## 3. High-Level System Status Summary

| Area | Current State | Authoritative Evidence |
|---|---|---|
| **Repository Branch** | `mig-mov` (clean working tree, tracking `origin/mig-mov`) | Git HEAD commit `8978577` |
| **GCP Project** | `gen-lang-client-0004191483` | [cloud.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/cloud.md#L9) |
| **Development Database** | `kavach-play-db-ext` (`asia-south1`) | Refreshed Nov 20, 2026 from production snapshot |
| **Production Database** | `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` (`us-west1`) | Branch `main`, live on Amplify |
| **Payment Operations** | **Strictly disabled** on `mig-mov` via fail-closed guard | `lib/database-config.ts` [arePaymentOperationsEnabled](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/database-config.ts#L201-L233) |
| **Functional Tests** | **462 passed, 0 failed** across 101 suites (`node:test`) | `npm run test:functional` verified locally at `8978577` (1.15s) |
| **Security Emulator Tests**| **114 passed** in CI (Java runtime required for local run) | `scripts/run-emulator-tests.mjs`, verified in CI Run 44651141614 |
| **Active Remediation Track** | Phases 0–6 Complete / Hardened; Remediations 1–1F-R Implemented | [PHASE-TRACKER.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/docs/implementation/PHASE-TRACKER.md#L12-L43) |
| **Subsequent Prod Phases** | Phases 7–12 Planned / Not Started in Production | Authoritative Master Plan |

---

## 4. Key Reconciled Architecture & Decision Discrepancies

During validation against repository code and owner directives, two material discrepancies were identified and flagged for owner alignment:

### A. Player Navigation Architecture (OPEN OWNER DECISION — OD-03)
- **Approved Direction (Owner Directive):** 3 primary destinations: `Home`, `Club`, `Matches`. Profile accessible through the top header avatar (`AppHeader.tsx`). Same primary navigation structure across mobile and desktop.
- **Historical Standard (`AGENTS.md` L147):** Documents 5 primary items: `Home`, `Matches`, `Payments`, `Performance`, `Club`.
- **Current Code Implementation (`MobileBottomNav.tsx` L173-219, `app/page.tsx` L810-898):**
  - Mobile bottom nav has 5 items: `Home`, `Matches`, `Finance`, `Players`, `More`.
  - Header has top avatar button for `profile` (`AppHeader.tsx` L158).
  - Desktop sidebar in `app/page.tsx` renders 6 buttons: `Home`, `Matches`, `Finance`, `Players`, `Performance`, `Club`.
- **Status:** **OPEN OWNER DECISION (OD-03)**. Code currently runs the 5-item mobile nav (`Home`, `Matches`, `Finance`, `Players`, `More`) with header avatar for Profile. Reconciling mobile and desktop to `Home`, `Club`, `Matches` requires an approved implementation task.

### B. Admin Role Model & Consolidation (OPEN OWNER DECISION — OD-04)
- **Approved Direction (Owner Directive):** 3-role active model:
  1. `Super Admin`
  2. `Club Admin`
  3. `Finance Admin`
  (Match Admin, Studio Admin, and Designer are retired and consolidated into Club Admin).
- **Historical Standard (`AGENTS.md` L127, `DECISION-LOG.md` D-08):** Directed retaining 6 granular capabilities (Super Admin, Club Admin, Match Admin, Finance Admin, Studio Admin, Designer).
- **Current Code Implementation (`lib/server-auth.ts`, `firestore.rules`, `SettingsTab.tsx`, `EditPlayerInline.tsx`):**
  - `lib/server-auth.ts` still actively defines and exports guards for `requireMatchAdmin` (L555) and `requireStudioAdmin` (L563).
  - `firestore.rules` still actively evaluates `isMatchAdmin()` (L48), `isStudioAdmin()` (L43), and `isDesigner` across grounds, tournaments, and matches.
  - Access Control Centre (`SettingsTab.tsx` L1568-1610) and `EditPlayerInline.tsx` (L380-428) still display and toggle all 6 roles.
- **Status:** **OPEN OWNER DECISION / APPROVED REFACTORING REQUIREMENT (OD-04)**. The 3-role model is the approved product direction, but code and security rules currently enforce the 6 granular roles. A dedicated code and rules refactoring workstream must be planned to formally consolidate `isMatchAdmin`, `isStudioAdmin`, and `isDesigner` into `isClubAdmin` without disrupting active permissions.

---

## 5. Instructions for the Incoming Independent Engineering Reviewer

> **Mandatory directive for Claude (or any incoming senior reviewer):**  
> Do not treat this documentation package as self-certifying proof that the code is free of bugs, security holes, or race conditions. This documentation represents our honest, verified accounting of the system as constructed. Your primary responsibility is to **independently inspect, challenge, trace, and stress-test** the actual source code and rules.

### Your Review Protocol

1. **Verify the Current Git Baseline First:**
   - Execute `git status`, verify current branch (`mig-mov`) and HEAD commit SHA (`8978577`).
   - Confirm you are working in the correct repository and directory.
   - Inspect recent commit log (`git log -n 15 --oneline`).

2. **Verify Environment and Payment Isolation Invariants:**
   - Inspect `lib/database-config.ts` and `lib/server-db.ts`.
   - Confirm that development branch `mig-mov` can never connect to production database `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412`.
   - Confirm that live Razorpay payments, orders, and webhook mutations fail closed on non-`main` branches.
   - Review `tests/database-isolation-and-payment-safety.test.mjs`.

3. **Verify Security Invariants in Firestore Rules & Server Auth:**
   - Inspect `firestore.rules`. Check all `allow` rules. Remember that Firestore rules are **additive**: a restrictive rule in one block never cancels a permissive rule in an overlapping block.
   - Trace `/appUsers/{userId}` write rules: ensure no client can modify `role`, `status`, `playerId`, or admin flags.
   - Trace `/players/{playerId}` update rules: ensure client self-updates are restricted to `isValidPlayerSelfUpdate` allowlisted fields.
   - Trace `/matches/{matchId}/payments/{paymentId}`: ensure players can only update between `Unpaid` and `Not Playing`, and cannot self-escalate to `Paid`.
   - Inspect `lib/server-auth.ts`: confirm that `isSuperAdmin` strictly requires the `admin: true` custom claim from Firebase Auth, and never trusts `appUsers.role`.

4. **Verify Concurrency and Financial Integrity Invariants:**
   - Trace `app/api/razorpay/order/route.ts`: verify that client-supplied `amount` is discarded and that `derivePayableAmount()` calculates the fee from authoritative records.
   - Trace `app/api/razorpay/webhook/route.ts`: verify HMAC-SHA256 signature verification uses `crypto.timingSafeEqual` over the raw request body.
   - Trace `lib/player-merge.ts` and `app/api/admin/merge-players/route.ts`: verify worker lease acquisition, fencing tokens, transactional reservation validation, and financial record collision resolution.
   - Inspect abandoned match handling: ensure Option A is upheld (waived match fees, zero dues, cash collected preserved as informational history).

5. **Execute Automated Validation:**
   - Run `npm run test:functional` to verify the 462 unit and functional tests.
   - If a Java runtime is present or configured, run `npm run test:emulator` to execute the Firestore rules emulator suite.
   - Inspect recent CI run reports in `docs/redesign/reports/phase-2.2-player-match-center.md` and `docs/qa/`.

6. **Deliver Your Review Findings:**
   - Structure your review into: (a) Verified Invariants, (b) Suspected Vulnerabilities or Regressions, (c) Edge Cases & Concurrency Risks, (d) Architectural Recommendations.
   - For every finding, provide exact file paths, line numbers, and a reproduction trace.
