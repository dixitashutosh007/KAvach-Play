# KAvach Play — Core Foundation Audit
## Document 03: Comprehensive Screen & Component Inventory (Corrected)

**Document Type:** UI/UX Screen Inventory & Layout Audit  
**Status:** Revised Audit Baseline (Assignment 2)  
**Date:** November 2026  
**Application:** https://play.kavachcricket.com  
**Authoritative References:** `app/page.tsx`, `components/*`, `components/layout/*`, Approved Navigation Architecture

---

## 1. Inventory Overview

This document categorizes every view, screen, modal, and drawer in KAvach Play, updated to align with the approved navigation architecture:
- **Player Persona (5 Bottom Destinations):** `Home | Matches | Finance | Players | More` (with Profile accessed via the top header avatar).
- **Admin Persona (Desktop & Mobile):** Overview, Match Centre, Player Roster, Finance & Dues, Studio & Nets, Club Operations, Settings & Access.

---

## 2. Screen & Component Catalog

### 2.1 Player Persona Views

| Destination | Component & File Path | Purpose & Distinct Scope | Key Data Displayed | Key Actions / Interactions | Associated Modals / Drawers |
|---|---|---|---|---|---|
| **Home** | `components/HomeTab.tsx` (`HomeTab`) | Matchday activity hub and announcements. | Next upcoming match hero card, squad announcement, recent club posts, mini dues widget. | 1-Tap RSVP toggle, quick "Pay Dues" navigation, post interactions. | Comment drawer, post creation modal (admins). |
| **Matches** | `components/MatchesTab.tsx` (`MatchesTab`) | Fixtures schedule and past scorecards. | Upcoming fixtures, ground coordinates, reporting times, Playing XI squads, scorecard summaries. | Declare availability (Available, Tentative, PNA), view ground on Google Maps, inspect scorecard. | `MatchSheetView`, `MatchCalendarView`. |
| **Finance (Payments)** | `components/DuesAndRemindersTab.tsx` (`DuesAndRemindersTab`) | **Actionable dues settlement experience (Personal Only).** | Outstanding match obligations, itemized unpaid fees, Razorpay payment flow, payment receipts. | Initiate Razorpay online payment (UPI/Card), view fee breakdown, copy club bank details. | Razorpay checkout modal, receipt view modal. |
| **Players** | `components/PlayersTab.tsx` / `LeaderboardTab.tsx` | Club member directory & leaderboards. | Active squad roster, player public cards (batting/bowling style), batting/bowling leaderboards. | Search player directory, filter stats by tournament/season, view player public profile. | `BadgesTab`, player stat card. |
| **More** | `components/layout/MoreDrawer.tsx` | Secondary services & club utilities. | Studio net booking shortcuts, club merchandise shop, member opinion polls, ground directory. | Book net practice lane, purchase club kit/jerseys, cast poll vote, read club constitution. | `StudioTab`, `ShopTab`, `OpinionTab`. |
| **Player Profile Hub** | `components/ProfileTab.tsx` (`ProfileTab`) | **Central Personal Information Hub** (Accessed via Header Avatar). | Personal bio, photo, contact, lifetime cricket stats, studio/club memberships, **complete payment history**, **previous match charges ledger**, activity record. | Edit profile bio, update contact info, change password, upload avatar, review historical receipts and waivers. | `EditPlayerInline`, password change dialog. |

---

### 2.2 Administrator Console Hubs

| Hub | Component & Source File | Primary Administrative Responsibilities | Key Data Displayed | Key Actions / Modals |
|---|---|---|---|---|
| **Overview** | `components/AdminDashboard.tsx` | Executive operational health & rapid alerts. | Active members, next match countdown, total club receivables, pending approvals. | Approve pending player registrations, broadcast alert push/email. |
| **Match Centre** | `components/MatchesTab.tsx`, `GroundsTab.tsx`, `TournamentsTab.tsx` | Complete matchday operations command center. | Fixtures, venue status, Playing XI squads, pitch-side attendance, live scorecards. | Create fixture, announce squad, record **pitch-side cash collections**, log catches/scores. |
| **Player Roster** | `components/PlayersTab.tsx`, `DuplicatePlayersReport.tsx`, `AuditLogTab.tsx` | Membership directory, identity linking & merge. | Full player roster, linked Firebase auth accounts, duplicate candidate pairs, merge history. | Add player, edit profile, execute atomic player merge dry-run/migration, link mobile number. |
| **Finance & Dues** | `components/FinanceTab.tsx`, `AssignFeesAdmin.tsx`, `CreateFeeAdmin.tsx`, `RazorReportView.tsx` | Club treasury & fee management. | Collected vs outstanding dues, individual player debt ledgers, Razorpay transaction orders. | Levy ad-hoc fees (`otherFees`), waive match fees (Option A), record manual bank transfers, export CSV. |
| **Studio & Nets Ops**| `components/StudioAdminTab.tsx`, `components/studio/StudioCRMView.tsx` | Indoor facility scheduling & pass management. | Daily net lane slots, pass balances, checked-in members, prospective member CRM leads. | Scan member QR code for pass deduction, manual pass adjustment, update lead status. |
| **Club Operations** | `components/ShopTab.tsx`, `components/OpinionTab.tsx`, `components/NotificationsTab.tsx` | Club merchandise, member polls, communications. | Merchandise orders, active polls, broadcast message logs. | Update merch order status (`in_production`, `delivered`), create poll, send club broadcast. |
| **Settings & Access**| `components/SettingsTab.tsx` | Access control & club configuration. | System feature toggles, admin user roster, role assignments, club payment bank details. | Toggle feature flags, assign granular admin roles, sync custom claims. |
