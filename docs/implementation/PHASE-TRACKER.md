# KAVACH PLAY — Implementation Phase Tracker

**Created**: 2026-11-15
**Git SHA at Phase 0**: `f5739726e75a2e6594c7379bdbfc8a866c63f787`

---

## Phase Status Overview

| Phase | Name | Status | Start Date | End Date |
|-------|------|--------|------------|----------|
| 0 | Discovery & Verification | **COMPLETE** | 2026-11-15 | 2026-11-15 |
| 1 | Critical Security & Financial Fixes | **COMPLETE** | 2026-11-15 | 2026-11-15 |
| 2 | Data Integrity & Schema Cleanup | **COMPLETE** | 2026-11-15 | 2026-11-15 |
| 3 | Identity Consolidation | NOT STARTED | — | — |
| 4 | Component Decomposition | NOT STARTED | — | — |
| 5 | Navigation Rationalisation | NOT STARTED | — | — |
| 6 | UI/UX Redesign | NOT STARTED | — | — |
| 7 | Financial Logic Overhaul | NOT STARTED | — | — |
| 8 | Workflow Simplification | NOT STARTED | — | — |
| 9 | Studio & Shop Enhancement | NOT STARTED | — | — |
| 10 | Testing & Quality Infrastructure | NOT STARTED | — | — |
| 11 | Performance & Optimization | NOT STARTED | — | — |

---

## Phase 0 — Discovery & Verification

### Deliverables

| # | Deliverable | File | Status |
|---|------------|------|--------|
| 1 | Repository baseline report | `BASELINE.md` | COMPLETE |
| 2 | Security & financial risk register | `SECURITY-RISK-REGISTER.md` | COMPLETE |
| 3 | Feature & module inventory | `FEATURE-INVENTORY.md` | COMPLETE |
| 4 | Test baseline & coverage report | `TEST-BASELINE.md` | COMPLETE |
| 5 | Architecture & tech debt assessment | `ARCHITECTURE-ASSESSMENT.md` | COMPLETE |
| 6 | Feature disposition & decision register | `DECISION-LOG.md` | COMPLETE |
| 7 | Phase readiness assessment | `PHASE-READINESS.md` | COMPLETE |
| 8 | Phase tracker | `PHASE-TRACKER.md` | COMPLETE |

### Critical Findings Verification

| Finding | Verified | Line References Match | Current Status |
|---------|----------|----------------------|----------------|
| CRIT-01 | YES | `firestore.rules` L436, L483 | **FIXED** — Phase 1 |
| CRIT-02 | YES | `firestore.rules` L237 | **FIXED** — Phase 1 |
| CRIT-03 | YES | `useStore.ts` L486–499, L835–849 | **FIXED** — Phase 2 (client + rules) |
| CRIT-04 | YES | `AdminDashboard.tsx` L44, `FinanceTab.tsx` L117, `PayClient.tsx` L23, `DuesAndRemindersTab.tsx` L135 | **FIXED** — Phase 1 |
| FIN-01 | YES | `MatchesTab.tsx` L1569, L1620 | **FIXED** — Phase 1 |
| FIN-02 | YES | `FinanceTab.tsx` L1245, L1262 | **FIXED** — Phase 1 |
| FIN-03 | YES | `FinanceTab.tsx` L329–341 | CONFIRMED — late fee loss on mobile |

### Open Decisions

| Decision | Status | Required Before |
|----------|--------|----------------|
| D-01: Abandoned match billing policy | **DECIDED** — Never bill. Revert existing charges. | Phase 1 |
| D-02: Dual-identity consolidation strategy | AWAITING PRODUCT OWNER | Phase 3 |
| D-03: WixFinanceView retirement | AWAITING PRODUCT OWNER | Phase 2 |
| D-04: Admin-tools page disposition | AWAITING PRODUCT OWNER | Phase 4 |
| D-05: paymentLinks collection future | **DECIDED** — Lock down rules, keep collection. | Phase 1 |
| D-06: Ghost isDesigner role | AWAITING PRODUCT OWNER | Phase 3 |

---

## Phase 1 — Critical Security & Financial Fixes

### Tasks

| # | Task | File(s) | Complexity | Status |
|---|------|---------|-----------|--------|
| 1.1 | Remove CRIT-01 payment status bypass (L436) | `firestore.rules` | Low | COMPLETE |
| 1.2 | Remove CRIT-01 payment status bypass (L483) | `firestore.rules` | Low | COMPLETE |
| 1.3 | Lock down CRIT-02 paymentLinks updates (L237) | `firestore.rules` | Low | COMPLETE |
| 1.4 | Create `isMatchBillable()` shared helper | `lib/matchBillable.ts` | Low | COMPLETE |
| 1.5 | Apply abandoned match filter in FinanceTab (player view + admin grand totals) | `components/FinanceTab.tsx` | Low | COMPLETE |
| 1.6 | Apply abandoned match filter in PayClient | `app/pay/[playerId]/PayClient.tsx` | Low | COMPLETE |
| 1.7 | Apply abandoned match filter in DuesAndRemindersTab (4 locations) | `components/DuesAndRemindersTab.tsx` | Low | COMPLETE |
| 1.8 | Fix FIN-01 grossValue calculation (guest fee overrides) | `components/MatchesTab.tsx` | Low | COMPLETE |
| 1.9 | Fix FIN-02 grandTotalCollected inflation (club-sponsored) | `components/FinanceTab.tsx` | Low | COMPLETE |
| 1.10 | Write Firestore rules regression tests | `tests/` | Medium | DEFERRED to Phase 10 |

---

## Phase 2 — Data Integrity & Schema Cleanup

### Tasks

| # | Task | File(s) | Complexity | Status |
|---|------|---------|-----------|--------|
| 2.1 | Remove unused class-variance-authority dependency | `package.json` | Low | COMPLETE |
| 2.2 | Remove unused tw-animate-css dependency | `package.json` | Low | COMPLETE |
| 2.3 | Lock paymentLinks to admin-only | `firestore.rules` | Low | COMPLETE (done in Phase 1) |
| 2.4 | WixFinanceView disposition (D-03) | — | — | AWAITING DECISION |
| 2.5 | CRIT-03: Scope payment collectionGroup queries for non-admins | `hooks/useStore.ts`, `app/page.tsx` | Medium | COMPLETE |
| 2.6 | CRIT-03: Scope otherFees collectionGroup queries for non-admins | `hooks/useStore.ts`, `app/page.tsx` | Medium | COMPLETE |
| 2.7 | CRIT-03: Tighten collection group read rules in Firestore | `firestore.rules` | Low | COMPLETE |

---

## Phases 3–11

Task breakdowns will be added as each phase is approved.

---

## Non-Negotiable Constraints (Carry Forward)

1. Firebase Authentication — PRESERVE (do not introduce Cognito or alternative auth)
2. Razorpay — PRESERVE (do not change payment gateway)
3. Claude Code — SOLE implementation agent
4. Antigravity — Read-only QA verification only
5. No data migrations without explicit approval
6. No deployments without explicit approval
