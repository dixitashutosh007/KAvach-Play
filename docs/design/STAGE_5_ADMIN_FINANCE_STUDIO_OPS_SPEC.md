# KAvach Play — Phase 4 Stage 5 Specification
## Admin Finance, Studio and Club Operations Blueprint

**Document Type:** UX Blueprint and Component Specification  
**Phase:** Phase 4 — High-Fidelity Design & Prototypes  
**Stage:** Stage 5 of 6 (Admin Finance, Studio & Nets, Club Operations, Settings & Access)  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Authoritative References:** `AGENTS.md` (Option A financial policy, SEC-001/002/003/004, FIN-001/002/003/005), `DECISION-LOG.md` (D-08 granular roles, D-09 7 Admin hubs).

---

## 1. Executive Summary

Stage 5 delivers the remaining administrative command hubs for KAvach Play, completing the full operational matrix across club finances, indoor training studio management, club merchandise and community operations, and governance/settings.

All hubs conform to the sports-tech design system:
- **Light-first** with crisp white cards (`#FFFFFF`) on subtle grey canvas (`#F6F7F9`).
- **Scarlet brand hierarchy** (`#A30F2D` primary header, `#D51F43` primary action).
- **Inter typography** with strict numerical readability (tabular figures for currency and stats).
- **Granular capability enforcement**: views and actions align with the non-negotiable RBAC architecture (Super Admin, Club Admin, Match Admin, Finance Admin, Studio Admin, Designer) without collapsing into a simplistic two-tier model.

---

## 2. Hub-by-Hub Architecture

### Hub 4: Finance & Dues (`adminHub === "finance"`)
**Target Audience:** Finance Admins, Club Admins, Super Admins.

#### Core Capabilities:
1. **Financial Metrics Summary:**
   - Total Collected (Season liquid cash collected, separated from uncollected or waived dues).
   - Total Outstanding Dues (Current actionable receivables from active members).
   - Waived / Voided Obligations (Option A abandoned matches and approved administrative fee waivers, tracked with full audit history).
   - Debtor Aging Breakdown:
     - Urgent (> 14 days overdue).
     - Recent (1–14 days overdue).
     - Current (< 7 days until deadline).

2. **Collections & Payment Ledger:**
   - Complete historical ledger of every transaction (Razorpay Online, Cash pitch-side, UPI transfer, Bank credit).
   - Search by player name, KAV-ID, or payment reference.
   - Filter by payment method, match vs non-match fee, and date range.
   - Digital receipt view and audit details for every transaction.

3. **Pitch-Side & Manual Payment Recording:**
   - Dedicated modal allowing authorised admins to log physical cash or UPI collections.
   - Mandatory audit logging: Collector ID, timestamp, receipt number, note/reason.
   - Direct status transition to `Paid` with immutability guarantees.

4. **Ad-hoc Fee Levying:**
   - Ability to generate individual or batch fees:
     - Match no-show penalty.
     - Custom jersey / merchandise cost.
     - Annual membership levy.
     - Equipment damage or studio booking charge.
   - Due date configuration and immediate notification dispatch.

5. **Option A Compliance:**
   - Abandoned match dues display as `Waived (Abandoned Match)` with zero remaining liability.
   - Historical collections for played or partially played matches remain untouched.

---

### Hub 5: Studio & Nets (`adminHub === "studio"`)
**Target Audience:** Studio Admins, Club Coaches, Club Admins.

#### Core Capabilities:
1. **Nets Slot Booking Calendar & Real-time Grid:**
   - 3 active training lanes (Lane 1 - Fast Bowling, Lane 2 - Spin / Multi-turf, Lane 3 - Bowling Machine).
   - 60-minute bookable slots with status tags: Available, Booked, Maintenance, Coaching Session.
   - One-tap slot reservation for registered members or walk-in guests.

2. **Membership & Session Pass Management:**
   - Tracking 10-session packs, monthly unlimited, and guest drop-in vouchers.
   - Remaining credits counter, expiry alerts, and one-tap pass renewal.

3. **Studio CRM & Trial Pipeline:**
   - New inquiry tracking (Trial Requested -> Attended -> Follow-up -> Converted Member).
   - Direct WhatsApp / Call trigger from mobile viewport.

---

### Hub 6: Club Operations (`adminHub === "operations"`)
**Target Audience:** Club Admins, Merchandise Coordinators, Designers.

#### Core Capabilities:
1. **Merchandise Fulfillment Pipeline:**
   - Kanban-style fulfillment tracker:
     - New Orders (Awaiting confirmation / payment verified).
     - In Production (Custom name/number printing).
     - Ready for Collection (Pitch-side or Studio desk).
     - Delivered / Complete.
   - Aggregated size distribution (S, M, L, XL, XXL) for batch manufacturing orders.

2. **Member Polls & Democratic Decision Center:**
   - Live vote tallying for club fixtures, tour dates, and kit designs.
   - Create new poll wizard with expiry date and options.

3. **Design Studio Hub Link:**
   - Direct launcher for creating matchday graphics, milestone banners (100 runs, 5-wicket hauls), and player digital cards with consistent scarlet branding.

---

### Hub 7: Settings & Access (`adminHub === "settings"`)
**Target Audience:** Super Admins only.

#### Core Capabilities:
1. **Granular RBAC Audit Grid:**
   - Displays all 6 system roles (Super Admin, Club Admin, Match Admin, Finance Admin, Studio Admin, Designer).
   - Capability permissions matrix (Match management, Cash collection, Financial reporting, Studio booking, Banner creation, User role assignment).

2. **Business Rules & Feature Toggles:**
   - Match Abandonment Policy: Enforces Option A (Automatic fee waiver without deleting historical payments).
   - Timezone Configuration: Explicitly locked to `Asia/Kolkata` (preventing local client device clock tampering, FIN-006).
   - Guest Surcharge: Standard +20% match fee for non-members.

---

## 3. Interaction and Responsive Specifications

| Component | Mobile (< 640px) | Desktop (>= 1024px) |
|---|---|---|
| **Finance Ledger** | Card stack with expandable transaction details | Tabular view with column sorting and export button |
| **Record Cash Modal** | Full-screen bottom sheet with 48px touch targets | Centered modal (max-w-md) with keyboard shortcuts |
| **Nets Schedule** | Horizontal date scroller with vertical lane cards | 3-column interactive lane grid |
| **Merchandise Kanban** | Horizontal swipe tabs per status stage | 4-column drag-and-drop layout |
| **Role Matrix** | Collapsible role cards with active permission badges | Full matrix grid with permission checkmarks |

---

## 4. Verification and Safety Criteria

1. **Isolation Guarantee:** Prototype operations execute purely against local React state; zero live Firestore writes or Razorpay orders are initiated.
2. **Deterministic Timezone:** All mock financial schedules and deadlines use UTC/Asia/Kolkata timestamps.
3. **Audit Trail Completeness:** Every administrative mutation (cash collected, fee levied, order status updated) logs an immutable admin audit record.
