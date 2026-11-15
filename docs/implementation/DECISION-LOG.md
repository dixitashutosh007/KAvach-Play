# KAVACH PLAY — Feature Disposition & Decision Register

**Phase**: 0 (Discovery & Verification)
**Date**: 2026-11-15
**Source**: Product Rationalisation Report (55 pages) + Comprehensive Audit

---

## Open Decisions Requiring Product Owner

| # | Decision | Context | Options | Phase Dependency |
|---|----------|---------|---------|-----------------|
| **D-01** | Abandoned match billing policy | CRIT-04: Admin dashboard excludes abandoned matches from dues, but players are billed. 4 files inconsistent. | **DECIDED: Option A** — Never bill abandoned matches. Revert/void any existing charges for abandoned matches. | Phase 1 (P0 fix) |
| **D-02** | Dual-identity consolidation strategy | `appUsers/{uid}` + `players/{playerId}` have 21 duplicated fields. | **A**: Merge into single collection **B**: Keep both, designate one as source of truth with sync | Phase 3 |
| **D-03** | WixFinanceView retirement timeline | 1,247-line legacy import tool. Is historical data migration complete? | **A**: Retire immediately **B**: Keep until explicit data migration sign-off | Phase 2 |
| **D-04** | Admin Tools page disposition | `app/admin-tools/page.tsx` (454 lines) orphaned from navigation. | **A**: Absorb into AdminDashboard **B**: Delete if redundant **C**: Link from nav | Phase 4 |
| **D-05** | `paymentLinks` collection future | CRIT-02: Rules allow any user to update, but collection is unused. | **DECIDED: Option A** — Lock down rules to admin-only. Keep collection for future use. | Phase 1 |
| **D-06** | Ghost `isDesigner` role | Defined in security rules but never assigned via UI. | **A**: Remove from rules **B**: Wire up to UI | Phase 3 |

---

## Feature Disposition Register (32 Items)

Source: Product Rationalisation Report, Section 12.

### IMPROVE (14 items — 43.8%)

| ID | Feature | Current State | Improvement |
|----|---------|--------------|-------------|
| IMP-01 | Match Scheduling | Functional but monolithic (5,185 lines) | Decompose into sub-components |
| IMP-02 | Squad Selection | Inside MatchesTab | Extract, add clone-from-previous |
| IMP-03 | Scoring & Results | Inside MatchesTab | Extract, streamline workflow |
| IMP-04 | Match Fee Management | Spread across 4 files with inconsistencies | Centralize logic, fix CRIT-04 |
| IMP-05 | Player Dashboard (Home) | Functional but triggers CRIT-03 | Scope queries to logged-in player |
| IMP-06 | Admin Dashboard | Functional, correctly filters abandoned | Decompose from 1,233-line monolith |
| IMP-07 | Finance Overview | FIN-02 inflated collections bug | Fix calculation, decompose |
| IMP-08 | Dues & Reminders | CRIT-04 billing gap | Apply isMatchBillable filter |
| IMP-09 | Player Management | Functional but tied to dual identity | Consolidate identity model |
| IMP-10 | Settings | 1,672-line monolith | Decompose into sections |
| IMP-11 | Profile | 1,109-line monolith | Decompose |
| IMP-12 | Studio CRM | 1,607-line monolith | Decompose |
| IMP-13 | WhatsApp Integration | Functional, templates correct | Add retry logic, queue management |
| IMP-14 | Payment Gateway (Razorpay) | Functional but CRIT-01 + FIN-03 | Fix security rules, server-side fee creation |

### MERGE (6 items — 18.8%)

| ID | Features to Merge | Target |
|----|-------------------|--------|
| MRG-01 | HomeTab admin widgets + AdminDashboard | Unified Admin Home |
| MRG-02 | FinanceTab PlayerView + PayClient | Unified Player Finance View |
| MRG-03 | ClubTab (grounds) + GroundsTab | Single Grounds Management |
| MRG-04 | PlayersTab + EditPlayerInline + DuplicatePlayersReport | Unified Player Management Hub |
| MRG-05 | StudioAdminTab + StudioCRMView | Unified Studio Admin |
| MRG-06 | Multiple alert/confirm patterns | Unified Modal/Toast system |

### RETIRE (6 items — 18.8%)

| ID | Feature | Reason |
|----|---------|--------|
| RET-01 | WixFinanceView | Legacy import tool, migration-era artifact |
| RET-02 | `paymentLinks` collection | Unused by application code |
| RET-03 | `class-variance-authority` dependency | Zero imports |
| RET-04 | `tw-animate-css` dependency | Zero imports |
| RET-05 | Ghost `isDesigner` role | Never assigned via UI |
| RET-06 | Admin-tools orphaned route | Unlinked, potentially redundant |

### MOVE (2 items — 6.2%)

| ID | Feature | From | To |
|----|---------|------|----|
| MOV-01 | Ground management from ClubTab | ClubTab | Dedicated GroundsHub or MatchesTab |
| MOV-02 | Role management from SettingsTab | SettingsTab | Dedicated Admin/People section |

### KEEP (2 items — 6.2%)

| ID | Feature | Reason |
|----|---------|--------|
| KEP-01 | Firebase Authentication (Phone + Google) | Working correctly, preserve as-is |
| KEP-02 | Razorpay Payment Gateway | Working correctly, preserve integration |

### ARCHIVE (1 item — 3.1%)

| ID | Feature | Reason |
|----|---------|--------|
| ARC-01 | Independence Day festive component | Seasonal, not active |

### INVESTIGATE (1 item — 3.1%)

| ID | Feature | Question |
|----|---------|----------|
| INV-01 | Admin-tools page (454 lines) | Determine overlap with AdminDashboard, decide absorb vs delete |

---

## Role Consolidation Register

### Current Roles (6)

| Role | Function | Security Rules |
|------|----------|---------------|
| `superAdmin` | Full access | `isSuperAdmin()` |
| `matchAdmin` | Match management | `isMatchAdmin()` |
| `financeAdmin` | Finance & payments | `isFinanceAdmin()` |
| `clubAdmin` | Club & player management | `isClubAdmin()` |
| `studioAdmin` | Studio/coaching management | `isStudioAdmin()` |
| `isDesigner` | Undefined (ghost role) | Exists in rules, never assigned |

### Proposed Consolidation (3 + 1 Specialist)

| Tier | Role | Absorbs |
|------|------|---------|
| Tier 1 | **Super Admin** | superAdmin (unchanged) |
| Tier 2 | **Team & Match Manager** | matchAdmin + financeAdmin + clubAdmin |
| Tier 3 | **Player** | Default authenticated user |
| Specialist | **Studio Specialist** | studioAdmin (optional, for coaching features) |

**Decision Required**: Confirm role consolidation before Phase 3 implementation.

---

## Navigation Rationalisation Register

### Current Navigation

- **Admin**: 14+ tabs in horizontal scrollable bar
- **Player**: 5+ tabs with limited discoverability
- **No "Pay" shortcut**: Payment requires navigating through Finance tab

### Proposed Navigation

**Player Bottom Nav (5 items)**:
1. Home (matches, scores)
2. My Finance (dues, payments)
3. Pay (1-tap payment action)
4. Profile (stats, badges)
5. More (shop, studio, tournaments)

**Admin Command Hubs (7)**:
1. Dashboard Hub
2. Match Centre
3. Finance Command
4. People & Teams
5. Design Studio
6. Club Settings
7. Studio/Coaching

**Decision Required**: Confirm navigation structure before Phase 5 implementation.
