# KAvach Play — Core Foundation
## Document 21: Screen Implementation Readiness Across 4 Phases

**Document Type:** Screen Architecture & Phased Implementation Readiness  
**Repository Baseline:** `https://github.com/dixitashutosh007/KAvach-Play`  
**Target Branch:** `mig-mov` (Commit: `6539a21`)  
**Date:** November 2026  
**Status:** Approved Readiness Baseline

---

## 1. Executive Summary

This document maps all screens across the approved 4-phase roadmap (Phase 1: Core Foundation, Phase 2: Player Experience Mobile, Phase 3: Admin Experience Mobile, Phase 4: Admin Experience Desktop). It establishes the unified architecture for the **Match Workspace** and **Finance Center**, documents the approved match financial policies, and provides an implementation readiness assessment for our immediate first redesign target: **Player Home**.

---

## 2. Approved Phase Roadmap & Screen Progression

```
+---------------------------------------------------------------------------------------+
| PHASE 1: CORE FOUNDATION (All Roles & Shared Primitives)                              |
| - Layout Shell (Responsive 56px/64px Header, Mobile Navigation Engine)                |
| - Authoritative Design Tokens (#7A1E2B, #C0394B, Poppins/Inter)                       |
| - Shared Reusable Component Catalog (Cards, Overlays, Inputs, Badges, 44px targets)   |
| - Safe Pitch-Side Cash Recording Component                                            |
| - Unified Deterministic Dues Engine (calculatePlayerDues)                             |
+---------------------------------------------------------------------------------------+
                                           │
                                           ▼
+---------------------------------------------------------------------------------------+
| PHASE 2: PLAYER EXPERIENCE (Mobile First)                                             |
| 1. Player Home (Next match hero card, Playing XI, club feed, mini dues)               |
| 2. Player Matches (Fixtures, reporting times, 1-tap RSVP, scorecards)                 |
| 3. Player Finance (Personal dues breakdown, Razorpay checkout, receipts)              |
| 4. Player Directory & Performance (Member directory, public cards, leaderboard)       |
| 5. Player Profile Hub (Central archive: bio, stats, memberships, complete history)    |
| 6. Player More Drawer (Studio net booking, shop, member polls, ground guides)         |
+---------------------------------------------------------------------------------------+
                                           │
                                           ▼
+---------------------------------------------------------------------------------------+
| PHASE 3: ADMIN EXPERIENCE (Mobile First)                                              |
| 1. Admin Mobile Navigation Taxonomy (Approval & implementation)                       |
| 2. Admin Overview (Executive KPIs, critical alerts, pending approvals)                |
| 3. Admin Match Centre (Squad selection, pitch-side cash, live scorecards)             |
| 4. Admin Player Roster (Member directory, registration approvals, phone linking)      |
| 5. Admin Finance Hub (Club treasury, fee waivers, ad-hoc levies, Razorpay orders)     |
| 6. Admin Studio & Nets Ops (Lane schedules, QR attendance scanner)                    |
+---------------------------------------------------------------------------------------+
                                           │
                                           ▼
+---------------------------------------------------------------------------------------+
| PHASE 4: ADMIN EXPERIENCE (Desktop Command Center)                                    |
| 1. Desktop Persistent Left Hub Navigation                                             |
| 2. Desktop Match Centre Command Workspace                                             |
| 3. Desktop Full Player Roster & Atomic Merge UI                                       |
| 4. Desktop Comprehensive Treasury Ledger & CSV Export                                 |
| 5. Desktop Studio Facility CRM Kanban & Lane Scheduling                               |
| 6. Desktop System Governance & Role Access Control                                    |
+---------------------------------------------------------------------------------------+
```

---

## 3. Unified Workspaces Specifications

### 3.1 Unified Match Workspace (Approved 4 Sections)
The match management experience across player and administrator views is structured into 4 cohesive sections:
1. **Overview:** Match fixture header, countdown, opponent, ground coordinates, reporting time, match format, and weather notice.
2. **Squad:** Playing XI team announcement, bench reserves, captain/wicketkeeper tags, and tactical batting orders.
3. **Availability (RSVP):** Live member response tallies (`Available`, `Tentative`, `PNA`), notes, and automated reminder triggers.
4. **Operations:** Pitch-side cash collection logging, matchday attendance toggles ("Present / Late / Absent"), live scorecard entry, and catches log.

### 3.2 Unified Finance Center (Approved 4 Sections)
The club finance and treasury experience is structured into 4 clear sections:
1. **Overview:** Executive financial summary, total receivables, collected cash vs. outstanding debt, payment health KPIs.
2. **Dues:** Actionable itemized member debt ledgers, individual player breakdown, automated reminder dispatchers.
3. **Transactions:** Authoritative gateway transaction history, Razorpay orders, inbound webhook receipts, manual cash logs.
4. **Other Fees:** Ad-hoc fee creation, fee plans (annual membership, kit fees), late penalties, and fee waiver records.

---

## 4. Approved Match Financial Policies (Product Requirements)

The application enforces the approved financial policies for non-standard match outcomes:

| Match Outcome | Approved Business Policy | Financial Obligation & Ledger Treatment |
|---|---|---|
| **Cancelled Match** | `waive-refund` | Match fee obligations are **waived** for all unpaid players (`status: 'Waived'`, `waivedReason: 'Match Cancelled'`). Any amounts already collected via cash or Razorpay are queued for an authorized credit or refund. |
| **Postponed Match** | `settle` | The match fee obligation is **preserved and deferred**. Obligations roll over to the rescheduled fixture date. Already-paid amounts remain credited against the rescheduled match. |
| **Partially Played Match** | `admin` | Handled via **administrative determination**. Match Admins / Treasurers assess incurred ground, ball, and umpire costs, and apply an administrative fee offset or partial waiver. |
| **Abandoned Match** | `Option A` | Unpaid obligations are waived; historical paid amounts are preserved and count toward historical cash collected. |

---

## 5. First Redesign Target: Player Home Screen Readiness

As confirmed by the product owner, the first active redesign target is **Player Home**.

### 5.1 Player Home Screen Profile

| Attribute | Specification & Evidence |
|---|---|
| **Existing Component** | [`components/HomeTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/HomeTab.tsx) (Lines 1–450). |
| **Target Viewport** | Mobile First (`< 640px`), expanding gracefully to desktop canvas (`>= 1024px`). |
| **Primary Audience** | Playing Club Members (authenticated & linked). |
| **Core Responsibilities** | 1. Next Match Hero Card (ground, opponent, reporting time, countdown).<br>2. 1-Tap RSVP Availability Toggle (`Available`, `Tentative`, `PNA`).<br>3. Playing XI Squad Announcement (if announced by admin).<br>4. Personal Mini-Dues Widget (outstanding amount + "Pay Dues" deep link).<br>5. Club Announcement Feed (social posts, alerts, likes/comments). |
| **Authoritative Data Sources** | - `matches` (next scheduled match where `date >= today`).<br>- `matches/{matchId}/availability/{playerId}` (current user RSVP status).<br>- `matches/{matchId}/payments` & `players/{playerId}/otherFees` (evaluated via `calculatePlayerDues`).<br>- `posts` (recent club announcements). |
| **Reusable Components Available** | `BadgeIcon.tsx` (milestones), `Toast.tsx` (feedback), `ClientOnly.tsx` (hydration guard). |
| **Mobile UX Considerations** | - High outdoor contrast: Warm White canvas (`#FFF6F4`), Charcoal headings (`#29252A`).<br>- Touch targets: RSVP buttons must measure `min-h-[44px]` with tactile active states.<br>- Avoid horizontal feed overflow on 360px viewports. |
| **Desktop UX Considerations** | - Constrain max feed width to 800px centered, with sidebar widgets for next match and mini-dues. |
| **Known Blockers Before Start** | **None.** Following Phase 1 Core Foundation token and shell setup, Player Home can proceed immediately. |
