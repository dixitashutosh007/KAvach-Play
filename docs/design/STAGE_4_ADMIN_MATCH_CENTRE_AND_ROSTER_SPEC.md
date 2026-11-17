# KAvach Play — Phase 4 Stage 4: Admin Match Centre and Player Roster Specification

**Document Type:** UX Blueprint & High-Fidelity Design Specification  
**Stage:** 4 of 6 (Admin Match Centre & Player Roster Hubs)  
**Standard:** `AGENTS.md`, Phase 3 Information Architecture & Reconciled Decision Register (`D-08`, `D-09`)  
**Target Viewports:** Mobile (360×800, 390×844) and Desktop (1280×800+)  
**Theme:** Light-first Sports-Tech, Scarlet-led  
**Date:** 2026-11-17  

---

## 1. Executive Summary & Administrative Objectives

Stage 4 designs the two core operational engines of club administration:
1. **Match Centre Hub:** Empowering match admins, captains, and committee members to schedule fixtures, coordinate squad availability, announce playing XIs, mark pitch-side attendance, record cash/UPI collections safely, and enter scorecards.
2. **Player Roster Hub:** Providing a unified player directory, managing member approvals, maintaining playing profiles, assigning granular roles (without authority elevation bypasses), and performing ghost profile and duplicate cleanup with full relational reparenting.

---

## 2. Screen Blueprint: Admin Match Centre Hub

### 2.1 Viewport Layouts & Hub Architecture

#### Mobile View (360px–390px)
- **Top Actions & Filters:**
  - Sticky sub-bar with filter pills: `All Matches` | `Upcoming (2)` | `Active / Live` | `Completed` | `Abandoned`.
  - Primary Action Button: **"+ Schedule Match"** (48px touch height, `#D51F43`).
- **Match Management Cards:**
  - **Match Header:** Fixture title, format badge, date, reporting time (`06:45 AM`), venue pin.
  - **Readiness Meter:** Visual progress bar (`11 / 14 Confirmed (78%)`).
  - **Operational Action Grid (44px touch targets):**
    - `[Squad & RSVPs]` — Opens Squad Builder drawer.
    - `[Pitch Attendance]` — 1-tap presence tracking sheet.
    - `[Record Cash]` — Fast cash collection keypad.
    - `[Scorecard Entry]` — Runs/wickets entry (or match completion).

#### Desktop View (≥ 1024px)
- Full 2-column operational workspace:
  - **Left Rail (60%):** Tabular/card list of fixtures with live attendance and fee collection indicators.
  - **Right Panel (40%):** Active match inspector showing real-time RSVP list, ground weather, and pitch-side cash balance tally.
  - **Top Toolbar:** Ground venue manager shortcut, abandoned match financial waiver trigger, and tournament filter.

---

### 2.2 Match Creation Wizard (3-Step Flow)

```
[Step 1: Fixture Details] ──> [Step 2: Venue & Logistics] ──> [Step 3: Budget & Fees]
• Opposition Club Name         • Ground (with Map Link)        • Match Fee / Player
• Match Date & Start Time      • Pitch Type (Turf/Matting)     • Club Sponsored Target
• Match Format (T20 / 35 Ov)   • Reporting Time                • Budget Cap (Fee × 12)
```

1. **Validation Rules Enforced:**
   - Date cannot be in the past.
   - Ground must be selected from verified grounds directory or added with valid map link.
   - Match fee must default to `₹500` but allows explicit per-match overrides.
2. **Confirmation State:**
   - Generates fixture document, seeds empty payment obligations with status `Unpaid`, and broadcasts availability prompt to the club roster.

---

### 2.3 Pitch-Side Cash Collection Workflow (Scoped Match Admin)

Per `AGENTS.md` Section 4:
> *Any narrow match-manager/pitch-side cash capability must be restricted to assigned matches and explicitly approved operations; it must not confer broad Finance Admin or Super Admin authority.*

- **Scoped Keypad Interface:**
  - Lists only players selected in the playing squad for the active match.
  - Pre-fills individual payable amount (e.g. `₹500`).
  - Options: `Full Cash (₹500)`, `Pitch UPI (₹500)`, `Partial / Custom Amount`.
  - Generates instant verified transaction record (`CASH-REC-{TIMESTAMP}`) with status `Verified by Match Admin`.
  - Flags transaction for automatic batch sign-off in Finance Admin ledger.

---

## 3. Screen Blueprint: Player Roster Hub

### 3.1 Roster Directory & Operational Filters

- **Directory Header:**
  - Search bar (by Player Name, Mobile, KAvach ID `KAV-XXX`, or Jersey Number).
  - Status Pills: `All Players (38)` | `Pending Review (2)` | `Active` | `Injured / Out of Play (3)` | `Disabled / Merged`.
- **Roster Row / Card Anatomy:**
  - Player Avatar + Full Name + KAvach ID badge.
  - Playing Specialization (`All-Rounder`, `Right-hand bat`, `Right-arm medium`).
  - Jersey Number Chip (with reserved number safeguards).
  - Role Tags (`Super Admin`, `Match Admin`, `Designer`, `Member`).
  - Operational Actions (44px touch targets): `[Edit Profile]`, `[Assign Role]`, `[View Ledger]`.

---

### 3.2 Member Approval & Verification Queue

- **Onboarding Review Card:**
  - Displays submitted player data: Name, Phone number (verified via OTP), DOB, Blood Group, T-Shirt size, Trouser size, Preferred Jersey Number.
  - **Reserved Jersey Safeguard:** If player requested reserved Jersey `#10` (retired honor), form flags a warning and suggests alternate available numbers.
  - **Actions:**
    - `[Approve & Assign KAvach ID]` — Generates next sequential ID (`KAV-039`) and activates player profile.
    - `[Request Info]` — Pings applicant via WhatsApp for missing details.
    - `[Decline]` — Rejects registration with reason.

---

### 3.3 Player Profile & Role Assignment Drawer

- **Profile Editor:**
  - Personal details (Name, Nickname, Emergency Contact).
  - Cricket attributes (Batting position, Bowling style, Wicket-keeping proficiency).
  - Membership status (Active Member, Guest, Out of Play / Rehabilitation).
- **Granular Role Assignment (SEC-001 Compliant):**
  - Toggles for granular capabilities:
    - `Match Admin` — Can manage fixtures, squads, and pitch-side cash.
    - `Finance Admin` — Can edit budgets, other fees, and reconcile bank statements.
    - `Studio Admin` — Can issue nets passes and extend memberships.
    - `Designer` — Can access Design Studio.
  - Note: Role updates invoke server-side token claim updates; non-superadmins are strictly barred from self-escalation.

---

### 3.4 Ghost Profile & Duplicate Merger Preview (IDT-001 Compliant)

- **Dry-Run Preview Interface:**
  - Source Player (Duplicate/Ghost) vs. Target Player (Authoritative Profile).
  - Displays count of matches, scorecards, catches, payment records, and `appUsers.playerId` links to be reparented.
  - Explicit confirmation requirement: *"Reparent 14 matches, 8 payment records, and link Firebase Account to Target Player. Source player will be marked Disabled."*

---

## 4. Responsive & Accessibility Specifications

1. **Squad Selection Sheet Touch Targets:**
   - Checkboxes and drag handles enforce `≥ 44×44px` touch surfaces on mobile to prevent mistaps on crowded team rosters.
2. **Pitch-Side Cash Numeric Keypad:**
   - Oversized keypad buttons (`min-h-[52px]`) for outdoor, high-glare pitch environments.
3. **Contrast Compliance:**
   - Playing XI confirmation indicators use deep emerald (`#15803D`) and high-contrast bold typography (contrast ratio > 7:1 against white).
