# KAvach Play — Phase 4 Stage 3: Admin Navigation and Overview Specification

**Document Type:** UX Blueprint & High-Fidelity Design Specification  
**Stage:** 3 of 6 (Admin Navigation & Operational Overview Hub)  
**Standard:** `AGENTS.md` & Approved Phase 3 Information Architecture  
**Target Viewports:** Mobile (360×800, 390×844) and Desktop (1280×800+)  
**Theme:** Light-first Sports-Tech, Scarlet-led  
**Date:** 2026-11-17  

---

## 1. Executive Summary & Design Principles

Stage 3 establishes the administrative navigation framework and the **Executive Overview Hub** for club administrators, match managers, and committee members.

### Core Architecture Principles (from `AGENTS.md`):
1. **Player Experience First:** Administrators experience the normal player view by default upon login. There is no forced persona disconnect or abrasive full-page reload.
2. **Contextual Authorised Entry:** A discrete, high-contrast **"Admin Console"** shield button in the header (and within the Club hub) allows authorised administrators to slide into operations mode.
3. **The 7 Command Hubs:** Operational workflows are consolidated into exactly seven authoritative hubs:
   1. **Overview** (`dashboard`) — Operations KPIs, action queue, quick actions.
   2. **Match Centre** (`matches`) — Scheduling, squads, pitch-side collections, scorecards, abandoned waivers.
   3. **Player Roster** (`people`) — Directory, member approvals, identity merger, invitations.
   4. **Finance & Dues** (`finance`) — Match accounting, debtor aging, ad-hoc fees, reconciliation.
   5. **Studio & Nets** (`studio`) — Passes, membership extensions, CRM, attendance.
   6. **Club Operations** (`design`) — Merchandise fulfillment, polls, badges, social canvas.
   7. **Settings & Access** (`settings`) — Role delegation, branding, notifications, audit trail.
4. **Persistent Orientation:** In admin mode, a prominent **Admin Context Banner** and top-level **"Return to Player View"** button guarantee administrators never lose orientation.

---

## 2. Admin Navigation Blueprint

### 2.1 Access & Mode Transition
```
+--------------------------------------------------------------------------+
|  Player View (Default)                                                   |
|  Header: [KAvach Crest]  KAVACH PLAY       [Admin Shield] (🔔)  (Avatar) |
+--------------------------------------------------------------------------+
                                  │ (Taps Admin Shield)
                                  ▼
+--------------------------------------------------------------------------+
|  Admin Console Active                                                    |
|  [Admin Banner: 🛡️ Match Centre Workspace  ───>  [Return to Player View]] |
|  [Hubs: Overview | Match Centre | Roster | Finance | Studio | Ops | Settings]|
+--------------------------------------------------------------------------+
```

### 2.2 Mobile Admin Navigation (< 768px)
- **Elimination of Competing Bars:** In admin mode, the redundant top horizontal pill buttons are replaced with a single, elegant **Admin Hub Selector Pill Bar** with smooth horizontal scrolling.
- **Persistent Header Banner:** A compact 40px high-contrast bar (`bg-[#A30F2D] text-white`) confirms active administrative mode with an immediate 44px tap target for **"Return to Player View"**.
- **Admin Mobile Bottom Nav:**
  - 5 primary administrative shortcuts: **Overview**, **Matches**, **Roster**, **Finance**, **More Hubs**.

### 2.3 Desktop Admin Navigation (≥ 1024px)
- **Sidebar Rail (260px fixed width):**
  - Club crest and "ADMIN CONSOLE" uppercase eyebrow badge.
  - 7 Command Hub items with distinct sports-tech iconography and active indicator pills.
  - Quick action CTA button: **"+ Create Match"**.
  - Bottom card: Logged-in admin credentials, custom claims summary (`Super Admin` / `Match Admin`), and "Return to Player View" button.

---

## 3. Screen Blueprint: Admin Overview Hub

### 3.1 Executive KPI Metrics Strip (4 Core Operations Cards)

```
+-------------------+ +-------------------+ +-------------------+ +-------------------+
|  NEXT MATCH READY | |  COLLECTIONS KPI  | |  ROSTER STATUS    | |  STUDIO NETS      |
|  11 / 14 Playing  | |  ₹42,500 Collected| |  38 Active Players| |  85% Slot Occupancy|
|  3 Pending RSVPs  | |  ₹6,250 Overdue   | |  2 Pending Review | |  2 Renewals Due   |
+-------------------+ +-------------------+ +-------------------+ +-------------------+
```

1. **Next Match Readiness KPI:**
   - Fixture: `vs Spartans CC (Sun 24 Nov)`
   - Confirmed XI: `11 / 14 Confirmed (78%)`
   - Pending RSVPs: `3 Players Pending` (with 1-tap "Send WhatsApp Reminder" action).
2. **Collections & Dues Health KPI:**
   - Total Collected this month: `₹42,500` (Razorpay + Verified Cash).
   - Outstanding Unpaid Dues: `₹6,250` across 9 players.
   - Status: `12% uncollected • Within healthy range (< 15%)`.
3. **Player Roster & Registrations KPI:**
   - Active Roster: `38 Active Members`.
   - Onboarding Queue: `2 New Registrations Pending Approval` (highlighted in gold).
4. **Studio & Facility Occupancy KPI:**
   - Current Week Occupancy: `85% Booking Rate`.
   - Membership Alert: `2 Pass Expiring in 48h`.

---

### 3.2 Actionable Operational Alert Queue

A prioritized feed of immediate administrative tasks that require attention today:
1. **Alert 1 (High Urgency - Match Squad):**
   - *"3 players have not submitted availability for Sunday's match vs Spartans CC."*
   - Actions: `[View Unconfirmed]` `[1-Tap WhatsApp Ping]`.
2. **Alert 2 (Medium Urgency - New Member Approval):**
   - *"Rohan Deshmukh has submitted registration with valid phone and kit size."*
   - Actions: `[Review Profile & Approve]` `[Decline]`.
3. **Alert 3 (Financial - Unsettled Match Cash):**
   - *"Match Admin Vikram Sharma collected ₹2,000 cash pitch-side for Metro CC match. Awaiting Finance Admin sign-off."*
   - Actions: `[Verify & Reconcile]` `[View Breakdown]`.

---

### 3.3 Quick Actions Command Drawer

One-tap launchpad for the four most frequent club management actions:
1. **Create Match:** Opens the 3-step Match Creation Wizard (Fixture date, Venue, Opposition, Match Fee budget).
2. **Record Pitch-Side Cash:** Fast numeric keypad modal to record player cash payments during or after matches.
3. **Add / Invite Player:** SMS / WhatsApp invite generator with automatic link binding.
4. **Broadcast Announcement:** Send push notification + feed alert to all registered club players.

---

## 4. Interaction States & Permissions

| Role | Overview Capabilities | Guard / Enforcement |
|---|---|---|
| **Super Admin / Club Admin** | Full access to all 4 KPI cards, financial aggregates, roster approvals, and settings. | Verified custom claim `admin: true` in token. |
| **Match Admin** | Scoped access to Match Readiness KPI, pitch-side cash logging for assigned matches, squad builder. | Custom claim `isMatchAdmin: true`. Financial tabs read-only. |
| **Finance Admin** | Full access to Collections KPI, reconciliation queue, and debtor aging ledger. | Custom claim `isFinanceAdmin: true`. |
| **Player (Unauthorized)** | Completely shielded from admin console; attempting navigation gracefully redirects to Player Home. | Client `effectiveAdmin` check + Firestore rule denial. |

---

## 5. Responsive Layout Behavior

- **Mobile (< 640px):** Single vertical stack. KPI metrics render as a 2×2 swipeable grid. Operational alerts stack vertically with expandable action drawers.
- **Tablet (640px – 1023px):** 2-column layout. Left column hosts KPI cards and Operational Alerts; right column hosts Quick Actions and Recent Activity.
- **Desktop (≥ 1024px):** 3-column layout. Fixed left rail navigation (260px), main operational center (60%), and right-hand activity feed & calendar ticker (40%).
