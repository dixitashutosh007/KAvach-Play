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
| **D-10** | **Unified Player Experience with Authorised Admin Console Entry** | Independent review flagged risk of global persona switching separating admin and player personas. | **DECIDED: Unified Player Experience with Authorised Entry Point Enforced** per `AGENTS.md` Section 4. Administrators experience the normal player view first. Admin Console is an authorized entry point into administrative functionality, not a disconnected global persona or separate user account. Preserves granular RBAC and least privilege. | Phase 4 / Governance |
| **D-11** | **Framework & Dependency Baseline Assessment (Next.js 15.0.0 / React 19 RC)** | Independent review requested reassessment of pinned Next.js 15.0.0 and React 19 RC dependencies. | **DECIDED: Retain Pinned Baseline Without Unapproved Major Upgrades** per `AGENTS.md` Section 3. Upgrading to Next.js 15.1/15.2 or React 19 GA risks breaking changes in peer dependencies (`motion`, `react-dom`, etc.) and App Router server action semantics. Compatibility verified: 0 TypeScript errors, 232 unit tests pass, and production build succeeds. A formal framework stabilization track is deferred to Phase 11/12 with owner approval. | Phase 5 / Governance |
| **D-12** | **Remediation 1F-A Transactional Identity Reservation Validation & Worker Lease Fencing** | Concurrency risks during multi-worker player merges and account linking. | **DECIDED: Enforce Atomic Distributed Lease & Transactional Invariants** per Gate 1F-A. Merge operations require atomic lease acquisition with `fencingToken`, `leaseToken`, and `leaseExpiresAt` in `mergeJobs/{jobId}`. Identity reservation transfers and account-linking conflict checks are enforced transactionally inside Firestore transactions before data mutations. Client access to `/mergeJobs` is denied in `firestore.rules`. See `SECURITY_REMEDIATION_1F_A_IDENTITY_RESERVATIONS_AND_MERGE_LEASE.md`. | Remediation 1F |
| **D-13** | **Remediation 1F-R Bounded Pagination, Cumulative Progress Monotonicity, Strict Lock Validation, and Structured Failure Lifecycle** | Independent review of 1F identified cumulative progress decrement on retry, unchunked pagination, stale player-lock recovery gaps, and financial comparator alias edge-cases. | **DECIDED: Enforce Resilient Recovery & Monotonicity** per Remediation 1F-R. 1) Bounded reads (`limit(batchLimit)`) on all migration stages and final verification. 2) Strict player lock validation in `renewMergeLease` failing with `LEASE_RENEWAL_FAILED` on missing/tampered locks. 3) Safe stale lock recovery for missing/failed jobs. 4) Structured failure recording (`recordMergeJobFailure`) preserving committed stats. 5) Monotonic cumulative progress counters on resume. 6) Strengthened financial comparator (`resolveFinancialRecordValues`) failing closed on contradictory alias pairs across 12 authoritative fields. 7) Block write paths (`verifyPlayerOwnership`) for merging players. See `SECURITY_REMEDIATION_1F_IDENTITY_MERGE_RECOVERY.md`. | Remediation 1F-R |
| **D-14** | **Remediation 1F-R Final Focused Remediation: Atomic Completion Payments Guard, Lock Invariants, Failure Lifecycle & Webhook Redirection** | Independent review identified missing collection-group payment guard in completion stage, 12 lock edge cases, stale failure handler downgrade risks, and numerical comparator boundary checks. | **DECIDED: Complete Remediation 1F-R Final Safeguards**: 1) Include collection-group `payments` query in atomic `executeMergeCompletionStage()` transaction; 2) Enforce 12-case player lock invariants in `acquireMergeLease()` rejecting malformed, cross-job, and mismatched locks; 3) Execute `recordMergeJobFailure()` inside an atomic transaction strictly validating active `in_progress` status and exact worker lease credentials, preventing stale workers from downgrading completed jobs; 4) Enforce strict numerical parsing in `parseAuthoritativeAmount()` (handling NaN, Infinity, negative amounts, paise rounding, and INR currency); 5) Implement transactional read-before-write player resolution in `processWebhookIntentTransaction()`, redirecting fees for merged players to keeper records. Verified by 65 adversarial emulator tests. | Remediation 1F-R Final |
| **D-15** | **Remediation 1F-R Final Acceptance Corrections: Payment Write-Path Matrix, 10-Field Lock Invariants, Failure Lifecycle Lease Validation, Strict Rupee vs Paise Separation & Recursive Webhook Merge Resolution** | Independent review of commit `116661a` required complete write-path audit, 10-field lock invariant enforcement across 13 negative cases, exact failure lifecycle lease validation, separate rupee/paise validators rejecting silent rounding, genuine barrier concurrency tests, and recursive webhook merge redirection. | **DECIDED: Enforce Complete Final Acceptance Corrections**: 1) Audited and guarded all payment write paths against merging players; 2) Enforced exact 10-field agreement across `mergeJobs/{jobId}`, loser player, and keeper player with 409 rejection of malformed, cross-job, and mismatched locks; 3) Hardened `recordMergeJobFailure()` to validate worker credentials, active status, and non-expired lease; 4) Implemented `validateRupeeAmount()` (strictly rejecting >2 decimal places in rupees without silent rounding) and `validatePaiseAmount()` (strictly rejecting fractional paise); 5) Implemented recursive `resolveActivePlayer()` with cycle detection, keeper existence checks, deterministic late fee doc IDs, and duplicate webhook idempotency; 6) Verified via 85 emulator scenarios, 29 1F-A scenarios, 20 1E scenarios, 254 functional tests, and 0 TS/ESLint build errors. | Remediation 1F-R Final Acceptance |
| **D-16** | **Player Persona Navigation & Strict Persona Isolation** (proposed as "D-11" in the 2026-11-23 player-navigation assessment; renumbered because D-11 was already allocated) | Owner-directed Phase 1 Player Experience & Navigation Consolidation. Conflicts with D-09 (5-item player nav) and D-10 (no global persona switch). | **DECIDED: Approved by Product Owner (2026-11-23).** (1) Player primary navigation is exactly **Home, Profile, Matches**, in that order, identical on desktop and mobile; no More menu, drawer or secondary tab row. (2) The existing Player/Admin persona switch is **retained** for authorised admin users. (3) Admin menus, widgets, management actions and admin-only data are available **only in Admin persona**. (4) Admin privileges must never influence the Player navigation or Player experience. (5) Announcement publishing/editing and Club Performance Widget management move to Admin Home. **Supersedes D-09 (player navigation portion only; the 7 Admin hubs are unchanged) and D-10 (persona-switch elimination).** Server-side RBAC and Firestore rules are unchanged by this decision. | Player Experience Phase 1 |
| **D-17** | **UX work proceeds while SUB-001 / IDT-003 remain open** | P0 gate for D-16 found two open, reproduced subscription-payment defects (SUB-001, IDT-003); `AGENTS.md` §10 would otherwise block UX work. | **DECIDED: Approved by Product Owner (2026-11-23).** Player navigation implementation (D-16) is explicitly authorised to proceed. SUB-001 and IDT-003 stay **OPEN** in `SECURITY-RISK-REGISTER.md` with unchanged severity and evidence (`docs/qa/player-nav-persona/P0_VERIFICATION.md`); they are not downgraded, closed or suppressed. No fixes for them in this workstream; remediation will be a separate workstream. This decision is **not** a security clearance and does **not** confirm production is unaffected. | Player Experience Phase 1 |
| **D-18** | **Admin Persona Six-Destination Navigation** | Owner-directed Phase 2 of the navigation redesign. Conflicts with the 7-hub admin IA in D-09 / `AGENTS.md` §4. | **DECIDED: Approved by Product Owner (2026-11-23).** Admin persona primary navigation is exactly **Home, Match Center, Club, Finance, Design Studio, Settings**, in that order, identical on desktop and mobile, each shown only to roles the current permission model authorises (Finance: Finance/Super Admin; Design Studio: Designer/Club/Super Admin; Settings: Super Admin). Match Center consolidates Matches, Grounds, Tournaments; Club consolidates roster/directory, Studio, Pulse, Leaderboard & Stats, Announcements, Badges, Invite and related club operations as contextual sections. Role model, role inheritance, Firestore rules and server authorisation are unchanged; menu visibility is not authorisation. D-16 Player navigation and persona isolation remain in force. **Supersedes the 7 Admin hubs of D-09.** | Admin Experience Phase 2 |
| **D-19** | **Admin role consolidation and D-18 follow-ups** | Owner answers to the D-18 clarification questions (2026-11-23). | **DECIDED: Approved by Product Owner (2026-11-23).** (1) **Match Admin and Studio Admin are retired**; their capabilities move to **Club Admin**, and every existing Match Admin / Studio Admin account becomes Club Admin (migration). (2) **Home is shown to every admin**; anything a role cannot use shows a polite access-denied message. (3) Until the role-consolidation security change lands, Club Admins see Match Center and Studio; any action the rules still block shows access denied. (4) Player Home only displays announcements; announcement management is in Club, for Club Admin. (5) Shop → Club (Club Admin); Reminders → Finance; Activity Log → Finance (Finance Admin); **Assign (Match Center fee/squad assignment screen) is retired** (no data deleted). (6) Studio, Pulse and Leaderboard are Club Admin capabilities. (7) No Show and dropped/stunning catch counts belong on the player record; detailed catch record storage to follow an approved design. Role/rule changes run as a separate security workstream with emulator tests; navigation changes on the D-18 branch. **Supersedes the AGENTS.md §4 retention of Match Admin and Studio Admin as separate roles.** | Admin Experience Phase 2 / Security |
| **D-20** | **Player navigation: Home, Club, Matches; Profile from the avatar** | Owner-approved Player UI/UX enhancement with visual reference (Home, Club, Player Profile), 2026-11-24. | **DECIDED: Approved by Product Owner (2026-11-24).** Player primary navigation is exactly **Home, Club, Matches** (desktop and mobile). **Profile** leaves the bottom navigation and opens from the header avatar. **Club** is the player community/club-intelligence destination: club totals and circuit standings (verified data only), recent announcements and Pulse (past 30 days, View More), Polls, Leaderboard, Player Badges and the Player Directory (public fields only, per R2-B). Club may use a compact section filter row (All / Announcements / Pulse / Stats) as shown in the approved reference. Home keeps greeting, banner, dues/Pay Now, upcoming matches, Quick Access (Directory, Studio, Shop, Polls & Pulse) and Club Feed. **Supersedes the Profile-as-primary-destination part of D-16;** persona isolation (D-16) and Admin navigation (D-18/D-19) are unchanged. | Player Experience |
| **D-21** | **Weekend match operations (results, Player of the Weekend, CricHeroes link, actual match fee)** | Owner approval "Approval to Implement Weekend Match Operations", 2026-11-24, on plan `docs/implementation/WEEKEND_MATCH_OPERATIONS_PLAN.md`. | **DECIDED: Approved by Product Owner (2026-11-24).** (1) **Results** are recorded by **Super Admin and legacy Match Admin only**; Club Admin is added only after D-19 role consolidation is implemented and verified; no role assignments change. (2) **Eligibility:** estimated end = start + 4 h (T20) / 5 h (T30) / 6 h (Other); eligible 6 h after; Asia/Kolkata; never auto-assigned; missing start/format = documented exception, never guessed. (3) **Abandoned** recorded through the prompt invokes the **existing** abandoned-match waiver on the server (shared with `/api/admin/reconcile-abandoned`; no parallel mechanism; audited; idempotent); the recorder gains no Finance permission. (4) **Schedules (IST):** results Sunday 19:00; Player of the Weekend Monday 08:00 (open until Friday 23:59); actual fee Tuesday 08:00 — available on the first eligible admin visit, computed from server time and data state. (5) **Look-back:** testing 14 days (results and fees); after validation `WEEKEND_OPS_MODE=recurring` → results 7 days, fees the preceding weekend; older missing results only via the explicit **historical backfill queue** (no automatic results or awards). (6) Prompts in **Admin persona only** (results: Super/Match Admin; award: existing badge authority, Club/Super Admin; fees: Finance/Super Admin); pending indicator on the persona toggle; Skip is session-only; partial saves. (7) **POTW:** one award, badge, banner and notification per weekend; banner 7 days or until the next award; optional message ≤ 4 lines; skip creates nothing. (8) **Actual fee** = existing `matches.groundFeePaidAmount` via the existing `/api/finance/match-ledger` route (Finance/Super only; correction reason retained; configured and individual fees unchanged). | Match Operations |
| **D-21a** | **Weekend operations refinement** | Owner request "Weekend Operations: Refinement & Bug Fixes", 2026-11-24. | **DECIDED (owner request), items marked ⚠ need owner confirmation.** (1) The **opponent name** is the CricHeroes link (external-link icon, new tab, never triggers card navigation) on every match card and both detail headers; `matches.matchUrl` accepted for any https host (http upgraded; unsafe schemes rejected). (2) **Player Matches on phones** shows format + jersey in the **top-right corner tab** (as Home); desktop unchanged. ⚠ Below 400 px the Next Match chip is icon-only. (3) Task windows **close on confirmed server success**, show Saving…/Retry, keep values on failure, block double submits; results saved concurrently per match (each still transactional and audited). (4) **Match Center task panel**: pending recurring tasks + persistent **Historical Data Completion** (results, actual fees, POTW weekends), disjoint from the recurring prompts; explicit **historical POTW awards** (badge + notification + audit, no Home banner). ⚠ `POTW_HISTORY_FROM` default `2026-01-01` — owner to confirm; no "no award" disposition exists (would need a new record type). No role, rule, finance or schema-collection changes. | Match Operations |

---

## Open Decisions & Items for Product Owner Direction

| # | Item | Context / Description | Recommendation | Owner Status |
|---|------|-----------------------|----------------|--------------|
| **OD-01** | **Staging Environment Confirmation** | Live application at `https://play.kavachcricket.com` is production. Need confirmation of designated staging URL / Firebase project for Phase 5+ deployment tests. | Establish isolated staging Firebase project / preview channel before executing live database/auth mutations. | **Pending Owner Confirmation** |
| **OD-02** | **Production Cutover Strategy** | Cutover from legacy monolithic branch to modernized codebase. | Controlled cutover after Phase 12 verification with zero data loss and automated rollback plan. | **Pending Owner Decision** |
| **OD-03** | **Native App Scope Boundary** | Architecture should remain native-ready (API boundaries, clean data models), but native iOS/Android builds are out of scope. | Confirm native apps remain out of scope for current web modernization track. | **Confirmed Out of Scope** |

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

> **Superseded by D-16 (2026-11-23):** the 5-item player navigation below is historical. Current player primary navigation is **Home, Profile, Matches**. The Admin hubs below remain in force.

**Player Primary Navigation (5 Items) — SUPERSEDED by D-16**:
1. **Home** — Next match countdown, 1-tap RSVP, dues alert card, club feed, announcements.
2. **Matches** — Upcoming fixtures, past scorecards, innings breakdown, stunning/dropped catches.
3. **Payments** — Outstanding dues, line-item obligations, late fee notices, Razorpay checkout, receipts.
4. **Performance** — Runs/wickets leaderboards, player stats, MVP honors, badge showcase.
5. **Club** — Digital player card/profile, studio & nets passes, merchandise shop, member pulse polls, directory.

> **Superseded by D-18 (2026-11-23):** Admin primary navigation is Home, Match Center, Club, Finance, Design Studio, Settings.

**Admin Operational Command Hubs (7 Hubs) — SUPERSEDED by D-18**:
1. **Overview** (`dashboard`) — Operations KPIs, urgent action queue, quick action launchpad.
2. **Match Centre** (`matches`) — Scheduler, squad selection, pitch-side collections, scorecard entry, abandoned match waivers.
3. **Player Roster** (`people`) — Player directory, verification queue, ghost profile merger, SMS/WhatsApp invites.
4. **Finance & Dues** (`finance`) — Match fee accounting ledger, debtor aging, ad-hoc fees, Razorpay reconciliation.
5. **Studio & Nets** (`studio`) — Member roster, pass extensions, attendance, facility CRM.
6. **Club Operations** (`design`) — Merchandise catalog, poll manager, badge awards, social graphics.
7. **Settings & Access** (`settings`) — Role delegation, branding, notifications, audit trail.

**Reconciliation Decision (D-09):** The legacy pre-audit draft proposing `Home, My Finance, Pay, Profile, More` is **FORMALLY SUPERSEDED**. The authoritative 5-item Player Navigation and 7 Admin Command Hubs defined above govern all Phase 4 designs and future implementations. Admin mode is accessible via an authorized Admin Console banner/entry point, preserving the player view first.

> **Superseded by D-16 (2026-11-23):** the Player/Admin persona switch is retained for authorised admins, with strict persona isolation (admin capabilities appear only in Admin persona).

**Reconciliation Decision (D-10) — SUPERSEDED by D-16:** Elimination of Global Persona Switcher & Implementation of Unified Player Model with Authorised Admin Console Entry.
The application eliminates any separate global player/admin persona-switching experience (`persona: 'player' | 'admin'`). The standard player experience is the default for all authenticated users. Authorised administrators are provided a distinct "Admin Console" entry point in the application header and navigation to access administrative hubs (`Overview`, `Match Centre`, `Player Roster`, `Finance & Dues`, `Studio & Nets`, `Club Operations`, `Settings & Access`). Entering and leaving administrative functionality preserves the user's player identity, session, and navigation context. Design-preview inspection controls in prototype environments are visually and structurally isolated as prototype inspection harnesses and do not replace production server-side RBAC enforcement. Granular administrative roles (Super Admin, Club Admin, Match Admin, Finance Admin, Studio Admin, Designer) are strictly retained.

---

## Remediation 1F-R Decisions Register

**Decision (D-1FR-08): Strict 10-Field Lock Invariant Validation in `executeMergeCompletionStage()`:**
In the atomic completion stage, optional comparison checks (`(loser.mergeLeaseOwner && ...)`) are eliminated. The transaction strictly requires and validates 10 lock fields:
1. Job `status === "in_progress"`
2. Job `leaseOwner` matches worker exactly (non-empty string)
3. Job `leaseToken` matches worker exactly (non-empty string)
4. Job `fencingToken` matches worker exactly (positive integer)
5. Job `leaseExpiresAt` is a finite number and strictly unexpired (`now < leaseExpiresAt`)
6. Loser `mergeJobId === jobId`
7. Loser `mergeStatus === "in_progress"`
8. Loser `mergeLeaseOwner` matches job and worker exactly
9. Loser `mergeFencingToken` matches job and worker exactly
10. Loser `mergeLeaseExpiresAt` is a finite number and matches job `leaseExpiresAt` exactly
Identical symmetric rules apply to the keeper player. Any missing, malformed, or mismatched field fails closed with HTTP 409 (`STALE_WORKER_FENCING_ERROR` or `FINAL_VERIFICATION_FAILED`) before any completion writes are executed.

**Decision (D-1FR-09): Failure Lifecycle Lease Expiry Validation:**
`recordMergeJobFailure()` requires `job.leaseExpiresAt` to exist, be a finite number (`Number.isFinite`), and strictly greater than current time (`now < job.leaseExpiresAt`). Missing, null, string, NaN, Infinity, or expired timestamps immediately return `{ recorded: false, reason: "LEASE_EXPIRED" }` without mutating job status, preventing stale or malformed workers from altering job state.

**Decision (D-1FR-10): Foreign Lock Recovery & Orphaned Lock Integrity:**
In `acquireMergeLease()`, an existing foreign job is authoritative: if active, it returns 409 `MERGE_IN_PROGRESS`; if expired/failed, it returns 409 `PLAYER_LOCKED_BY_ANOTHER_JOB` (operator resolution required). When the foreign job document is missing in `mergeJobs` (orphaned lock):
- Missing, null, or malformed lock metadata (`mergeLeaseOwner`, `mergeFencingToken`, `mergeLeaseExpiresAt`) fails closed with HTTP 409 `MALFORMED_PLAYER_LOCK` and never counts as proof of expiry.
- An unexpired player lock returns HTTP 409 `PLAYER_LOCKED_BY_ANOTHER_JOB`.
- An orphaned lock is reclaimable ONLY when complete valid metadata exists AND `now >= mergeLeaseExpiresAt`. Identical symmetric validation applies to both loser and keeper.

**Decision (D-1FR-11): Rupee-Paise Monetary Precision & Half-Paise Boundary Handling:**
`validateRupeeAmount()` enforces strict 2-decimal rupee precision with floating-point tolerance `1e-6` (`Math.abs(val * 100 - Math.round(val * 100)) <= 1e-6`). Half-paise values (`123.454`, `123.455`, `123.456`) and >2 decimal representations are strictly rejected without silent rounding. `validatePaiseAmount()` strictly enforces integer paise and rejects non-integers and fractional paise strings. Maximum allowable amount is bounded at `10,000,000` rupees (`1,000,000,000` paise).
