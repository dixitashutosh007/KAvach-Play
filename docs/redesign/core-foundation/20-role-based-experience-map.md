# KAvach Play — Core Foundation
## Document 20: Role-Based Experience Map

**Document Type:** RBAC Experience Mapping & Access Governance  
**Repository Baseline:** `https://github.com/dixitashutosh007/KAvach-Play`  
**Target Branch:** `mig-mov` (Commit: `6539a21`)  
**Date:** November 2026  
**Status:** Approved Role-Based Experience Baseline

---

## 1. Executive Summary

This document maps the user experience across all 7 supported roles in KAvach Play: Super Admin, Club Admin, Match Admin, Finance Admin, Studio Admin, Player (Linked), and Guest/Unlinked User. It defines landing views, permitted destinations, restricted capabilities, visible data boundaries, and enforcement mechanisms across frontend and backend.

---

## 2. Role Experience Mapping

### 2.1 Super Admin
- **Authoritative Identity:** Firebase Auth Custom Claim `request.auth.token.admin === true` + active account status in `appUsers/{uid}` (`lib/server-auth.ts:298-340`).
- **Landing Experience:** Lands on **Admin Overview Hub** (or Player Home if toggling persona).
- **Navigation Access:** Unrestricted access to all 5 Player destinations and all 7 Administrator hubs (Overview, Match Centre, Player Roster, Finance & Dues, Studio & Nets, Club Operations, Settings & Access).
- **Primary Capabilities:**
  - Full system configuration & feature flag toggles.
  - Role assignment and Admin custom claim grants (`/api/admin/set-claim`).
  - Atomic player merge execution (`/api/admin/merge-players`).
  - Treasury oversight, fee waiver approvals, financial CSV exports (`/api/export/finances`).
  - Scorecard finalization, pitch-side collections, studio net pass adjustments.
- **Data Scope:** Global unrestricted visibility across all member profiles, private financial ledgers, audit logs, and system credentials.

---

### 2.2 Club Admin
- **Authoritative Identity:** `appUsers/{uid}.isClubAdmin === true` (write-protected in `firestore.rules:133`).
- **Landing Experience:** Lands on **Admin Overview Hub** or Player Home.
- **Navigation Access:** Player destinations + Admin Overview, Player Roster, Club Operations, Settings (read-only).
- **Primary Capabilities:**
  - New player onboarding approval (`status: 'active'`).
  - Player profile updates (bio, jersey number, contact details).
  - Ground venue guides and tournament directory configuration.
  - Broadcast notifications (`/api/send-announcement`) and member opinion polls.
  - Merchandise store order fulfillment management.
- **Prohibited Capabilities:** Cannot levy ad-hoc fees, cannot waive financial obligations, cannot access club bank ledgers, cannot grant admin custom claims.
- **Data Scope:** Full roster contact details, attendance records, non-financial operations.

---

### 2.3 Match Admin
- **Authoritative Identity:** `appUsers/{uid}.isMatchAdmin === true` (write-protected in `firestore.rules:133`).
- **Landing Experience:** Lands on **Admin Match Centre** (or Player Home).
- **Navigation Access:** Player destinations + Admin Match Centre, Player Roster (view only).
- **Primary Capabilities:**
  - Create, schedule, edit, and cancel match fixtures (`matches/{matchId}`).
  - Review live player availability (RSVP tally) and publish Playing XI squads.
  - **Pitch-Side Operations (Decision D-08):** Record pitch-side cash collections (`matches/{matchId}/payments`) for assigned matches.
  - Matchday attendance tracking ("Present / Late / Absent").
  - Upload match scorecards, player catches, and individual batting/bowling statistics.
  - Trigger match RSVP automated reminders (`/api/send-match-reminders`).
- **Prohibited Capabilities:** Strictly barred from creating or editing `otherFees`, cannot modify club fee templates or subscription plan pricing, cannot export global financial ledgers.
- **Data Scope:** Match fixtures, squad rosters, player attendance, matchday cash collected.

---

### 2.4 Finance Admin
- **Authoritative Identity:** `appUsers/{uid}.isFinanceAdmin === true` (write-protected in `firestore.rules:133`).
- **Landing Experience:** Lands on **Admin Finance & Dues Hub**.
- **Navigation Access:** Player destinations + Admin Finance & Dues, Match Centre (financial tabs).
- **Primary Capabilities:**
  - Levy ad-hoc fees (`otherFees`) across squads or individual players.
  - Set individual player custom match fee overrides (`players/{playerId}.customMatchFee`).
  - Approve and execute member fee waivers (including Option A abandoned match waivers via `/api/admin/reconcile-abandoned`).
  - Audit Razorpay gateway transaction orders, webhooks, and manual deposits.
  - Export official CSV financial ledgers (`/api/export/finances`).
- **Prohibited Capabilities:** Cannot edit match scorecards or Playing XI squads, cannot assign admin roles, cannot execute player duplicate merges.
- **Data Scope:** Full club treasury receivables, member debt records, payment receipts, bank reconciliation data.

---

### 2.5 Studio Admin
- **Authoritative Identity:** `appUsers/{uid}.isStudioAdmin === true` (write-protected in `firestore.rules:133`).
- **Landing Experience:** Lands on **Admin Studio & Nets Hub**.
- **Navigation Access:** Player destinations + Admin Studio & Nets Ops.
- **Primary Capabilities:**
  - Indoor net training lane schedule management.
  - **Attendance Verification:** Scan member Studio QR code to execute atomic pass deduction (`/api/studio/checkin`).
  - Manual pass balance adjustments and plan extensions.
  - Manage prospective member CRM inquiry pipeline (`clubLeads/{leadId}`).
  - Record drop-in non-member session payments.
- **Prohibited Capabilities:** Cannot access match fixtures, cannot modify club financial dues, cannot assign club roles.
- **Data Scope:** Studio subscription history, pass balances, lane utilization, CRM prospect pipeline.

---

### 2.6 Player (Linked Member)
- **Authoritative Identity:** Authenticated Firebase user with `appUsers/{uid}.playerId !== null` (linked to authoritative `players/{playerId}`).
- **Landing Experience:** Lands on **Player Home**.
- **Navigation Access (Approved 5 Destinations):**
  1. **Home:** Upcoming fixture card, team announcement, club feed, mini dues widget.
  2. **Matches:** Match schedule, reporting times, ground info, past scorecards, 1-tap RSVP.
  3. **Finance (Personal Only):** Outstanding dues breakdown, itemized unpaid fees, Razorpay online checkout, receipts. **Strictly displays player's own dues; zero club treasury data.**
  4. **Players:** Member directory, public player cards, club batting/bowling leaderboards.
  5. **More:** Studio net bookings, merchandise shop, voting polls, ground guides.
- **Player Profile Hub (Header Avatar Entry Point):**
  - Central personal hub: personal bio, lifetime stats, membership status, **complete payment history**, **previous match charges ledger**, and activity timeline.
- **Prohibited Capabilities:** Strictly barred from all Admin hubs; cannot view other players' private financial debts; cannot modify match scores; cannot set payment status to `Paid`.

---

### 2.7 Guest / Unlinked User
- **Authoritative Identity:** Authenticated user with `appUsers/{uid}.playerId === null` or new sign-up.
- **Landing Experience:** Lands on **Onboarding / Claim Profile Screen**.
- **Navigation Access:** Restricted public views:
  - Public club fixtures and results.
  - Ground venue guides.
  - Club constitution and public documents.
- **Primary Capabilities:**
  - Submit onboarding registration questionnaire (`RegistrationForm.tsx`).
  - Claim an existing unlinked player profile matching their mobile number (`PhoneSyncPrompt.tsx`).
- **Prohibited Capabilities:** Zero access to private squad discussions, zero access to financial ledgers, cannot submit match RSVPs, cannot view private club announcements.

---

## 3. Enforcement Matrix Across Architecture Layers

| Capability / Action | Client UI Guard (`useStore`) | Server API Guard (`lib/server-auth.ts`) | Firestore Security Rules (`firestore.rules`) |
|---|---|---|---|
| **View Admin Navigation** | `isAdmin || isMatchAdmin || isFinanceAdmin ...` | N/A (Client presentation) | Declarative document-level rules block unauthorized reads. |
| **Pitch-Side Cash Collection** | Visible to Match Admin & Finance Admin | Handled via client Firestore write | `isMatchAdmin() || isFinanceAdmin() || isSuperAdmin()` (`firestore.rules:556, 578`). |
| **Levy Ad-Hoc Fee (`otherFees`)**| Visible to Finance Admin & Super Admin | Protected in server endpoints | `isFinanceAdmin() || isSuperAdmin()` (`firestore.rules:445`). |
| **Studio QR Check-in** | Visible to Studio Admin | `requireStudioAdmin()` (`/api/studio/checkin`) | `isStudioAdmin() || isSuperAdmin()` (`firestore.rules:380`). |
| **Player Duplicate Merge** | Visible to Super Admin | `requireAdmin()` with custom claim (`/api/admin/merge-players`) | Server Admin SDK only (`mergeJobs` blocked in `firestore.rules:147`). |
| **Self Match Payment Update** | Player UI shows "Pay Now" | Server valuation in `/api/razorpay/order` | `isSelf(playerId)` allows RSVP/notes, but `status in ['Unpaid', 'Not Playing']` strictly blocks marking Paid (`firestore.rules:580-590`). |
