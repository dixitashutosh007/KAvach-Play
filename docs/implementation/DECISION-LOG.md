# KAVACH PLAY — Feature Disposition & Decision Register

**Phase**: 0 (Discovery & Verification)
**Date**: 2026-11-15
**Source**: Product Rationalisation Report (55 pages) + Comprehensive Audit

---

## Open Decisions Requiring Product Owner

| # | Decision | Context | Options | Phase Dependency |
|---|----------|---------|---------|-----------------|
| **D-01** | Abandoned match billing policy | CRIT-04: Admin dashboard excludes abandoned matches from dues, but players are billed. 4 files inconsistent. | **DECIDED: Option A** — Never bill abandoned matches. Revert/void any existing charges for abandoned matches. | Phase 1 (P0 fix) |
| **D-02** | Dual-identity consolidation strategy | `appUsers/{uid}` + `players/{playerId}` have 21 duplicated fields. | **DECIDED: Option B** — Keep both collections. Designate `appUsers` as auth/role source, `players` as gameplay/profile source. Atomic batch writes on duplicated fields, gradual read migration. No login or payment disruption. | Phase 3 |
| **D-03** | WixFinanceView retirement timeline | 1,247-line legacy import tool. Is historical data migration complete? | **DECIDED: Option A** — Retire immediately. Component deleted, feature flag removed. | Phase 2 |
| **D-04** | Admin Tools page disposition | `app/admin-tools/page.tsx` (454 lines) orphaned from navigation. | **DECIDED: Option C** — Keep page (Player ID Audit + Ghost Cleanup are useful admin tools). Link from nav. Quick-access widgets for home screen are a separate feature (Phase 6). | Phase 4 |
| **D-05** | `paymentLinks` collection future | CRIT-02: Rules allow any user to update, but collection is unused. | **DECIDED: Option A** — Lock down rules to admin-only. Keep collection for future use. | Phase 1 |
| **D-06** | `isDesigner` role | Initially flagged as ghost, but actually in active use — gates Design tab access for non-admin players. Toggle exists in Settings → Elevate Player's Role. | **DECIDED: Keep** — Role is functional and actively used. Not a ghost. | N/A |
| **D-07** | **Phase 3 Product Rationalisation & UX Discovery Sign-Off** | Comprehensive product, navigation, and UX/UI audit of existing application on branch `mig-mov`. | **DECIDED: Approved by Product Owner** (2026-11-17). Authorizes implementation of Phase 4 roadmap: 5-item Player Navigation, 7-hub Admin Console, and resolution of UX-P0-01, UX-P0-02, UX-P0-03. See `PRODUCT_RATIONALISATION_AND_UX_DISCOVERY.md`. | Phase 4 |
| **D-08** | **Granular Roles & Permissions Governance** | Legacy draft proposed 3-tier collapse (`Team & Match Manager` absorbing matchAdmin, financeAdmin, clubAdmin). | **DECIDED: Retain Granular Capabilities** per `AGENTS.md` Section 4. Enforce Super Admin, Club Admin, Match Admin, Finance Admin, Studio Admin, and Designer independently. Simplify assignment UI, not enforcement boundaries. Unapproved 3-tier collapse rejected. | Governance |
| **D-09** | **Authoritative Information Architecture Reconciliation** | Legacy draft retained `Home, My Finance, Pay, Profile, More` vs `AGENTS.md` standard. | **DECIDED: Authoritative Direction Enforced** per `AGENTS.md` and Phase 3 Sign-Off. Player Nav = `Home, Matches, Payments, Performance, Club`. Admin Hubs = `Overview, Match Centre, Player Roster, Finance & Dues, Studio & Nets, Club Operations, Settings & Access`. Legacy draft formally superseded. | Phase 4 / 5 |

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
| RET-01 | WixFinanceView | **RETIRED** — Phase 2. Component deleted, isWixEnabled flag removed. |
| RET-02 | `paymentLinks` collection | **LOCKED DOWN** — Phase 1. Rules restricted to admin-only. Collection kept for future use. |
| RET-03 | `class-variance-authority` dependency | **RETIRED** — Phase 2. Removed from package.json. |
| RET-04 | `tw-animate-css` dependency | **RETIRED** — Phase 2. Removed from package.json. |
| RET-05 | ~~Ghost `isDesigner` role~~ | **NOT A GHOST** — Active role gating Design tab. Keeping. (D-06) |
| RET-06 | Admin-tools orphaned route | **KEEPING** — Useful admin utilities. Will link from nav in Phase 4. (D-04) |

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

## Role Consolidation & Permissions Register

### Authoritative Club Roles (Enforced in Rules & Server Authority)

| Role | Operational Scope | Firestore Security Guard | Authority Boundary |
|------|-------------------|--------------------------|-------------------|
| `superAdmin` | Complete club administration, settings, sensitive financials, role assignment | `isSuperAdmin()` | Cryptographic Firebase custom claim (`decoded.admin === true`) |
| `clubAdmin` | Player verification, club announcements, roster management | `isClubAdmin()` | Custom claim / token role |
| `matchAdmin` | Fixture scheduling, squad selection, pitch-side attendance & cash | `isMatchAdmin()` | Restricted strictly to assigned matches; no general finance authority |
| `financeAdmin` | Match fee accounting, ad-hoc fee generation, transaction reconciliation | `isFinanceAdmin()` | Dedicated financial ledger authority |
| `studioAdmin` | Studio & nets pass management, duration extension, slot allocation | `isStudioAdmin()` | Studio facility records |
| `isDesigner` | Canvas social graphics, match flyer generation | `isDesigner()` / `canDesign` | Design Studio feature access |
| `player` | Personal RSVP, dues settlement, profile, scorecard access | Default authenticated user | Least-privilege player access |

**Reconciliation Decision (D-08):** Unapproved legacy drafts proposing a 3-tier collapse (`Team & Match Manager` absorbing matchAdmin + financeAdmin + clubAdmin) are **REJECTED**. Per `AGENTS.md` Section 4, granular capabilities are strictly retained. Pitch-side cash capabilities remain scoped exclusively to assigned matches and explicitly approved actions.

---

## Navigation & Information Architecture Register

### Authoritative Architecture (Approved in Phase 3 Sign-Off & AGENTS.md)

**Player Primary Navigation (5 Items)**:
1. **Home** — Next match countdown, 1-tap RSVP, dues alert card, club feed, announcements.
2. **Matches** — Upcoming fixtures, past scorecards, innings breakdown, stunning/dropped catches.
3. **Payments** — Outstanding dues, line-item obligations, late fee notices, Razorpay checkout, receipts.
4. **Performance** — Runs/wickets leaderboards, player stats, MVP honors, badge showcase.
5. **Club** — Digital player card/profile, studio & nets passes, merchandise shop, member pulse polls, directory.

**Admin Operational Command Hubs (7 Hubs)**:
1. **Overview** (`dashboard`) — Operations KPIs, urgent action queue, quick action launchpad.
2. **Match Centre** (`matches`) — Scheduler, squad selection, pitch-side collections, scorecard entry, abandoned match waivers.
3. **Player Roster** (`people`) — Player directory, verification queue, ghost profile merger, SMS/WhatsApp invites.
4. **Finance & Dues** (`finance`) — Match fee accounting ledger, debtor aging, ad-hoc fees, Razorpay reconciliation.
5. **Studio & Nets** (`studio`) — Member roster, pass extensions, attendance, facility CRM.
6. **Club Operations** (`design`) — Merchandise catalog, poll manager, badge awards, social graphics.
7. **Settings & Access** (`settings`) — Role delegation, branding, notifications, audit trail.

**Reconciliation Decision (D-09):** The legacy pre-audit draft proposing `Home, My Finance, Pay, Profile, More` is **FORMALLY SUPERSEDED**. The authoritative 5-item Player Navigation and 7 Admin Command Hubs defined above govern all Phase 4 designs and future implementations. Admin mode is accessible via an authorized Admin Console banner/entry point, preserving the player view first.
