# KAvach Play — Requirements & Feature Traceability Matrix
## Phase 3 / Phase 4 Architectural Baseline & Prototype Coverage

**Document Type:** Architecture Traceability Matrix & Capability Governance  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Historical Audit Baseline Commit:** `ab794df` (Phase 3 audit baseline)  
**Phase 4 Milestone Commit:** `c12b7a6`  
**Governing Standard:** `AGENTS.md`, `DECISION-LOG.md` (D-08, D-09), `FEATURE-INVENTORY.md`  
**Status:** Remediated & Verified — Read-only Governance Baseline

---

## 1. Governance & Identity Baseline

1. **Decisions D-08 & D-09 are Preserved as Authoritative:**
   - **D-08 (Granular RBAC Enforced):** Retains 6 distinct granular roles: `Super Admin`, `Club Admin`, `Match Admin`, `Finance Admin`, `Studio Admin`, and `Designer`. Rejects any two-tier or three-tier collapse.
   - **D-09 (Information Architecture Enforced):** Enforces 5 primary Player destinations (`Home`, `Matches`, `Payments`, `Performance`, `Club`) and 7 Administrator command hubs (`Overview`, `Match Centre`, `Player Roster`, `Finance & Dues`, `Studio & Nets`, `Club Operations`, `Settings & Access`).
2. **Historical Phase 3 Audit Baseline (`ab794df`):**
   - The historical audit findings (`SEC-001` through `SEC-006`, `FIN-001` through `FIN-007`, `IDT-001` through `IDT-003`, `UX-001` through `UX-005`, `ARCH-001` through `ARCH-004`, `QA-001` through `QA-003`) remain permanent audit reference facts.
   - This remediation covers the independent review findings on Phase 3 and Phase 4 without rewriting historical audit records.
3. **Data Integrity & Non-Destructive Principles:**
   - No deletion of historical match, scorecard, player, payment, other fee, or membership records.
   - Distinct separation of `players` (club gameplay record) and `appUsers` (auth account & roles) linked via `appUsers.playerId`.
   - Option A Abandonment Policy: Rain or abandoned fixtures auto-waive pending obligations while preserving historical payment transactions.

---

## 2. Complete Feature-to-Destination Traceability Matrix

This matrix maps every functional module and sub-capability from the approved Phase 3 Feature Inventory (`FEATURE-INVENTORY.md`) to its approved target destination, prototype coverage status, and planned implementation phase.

### Coverage Status Definitions:
- **Designed:** Fully specified in design documentation, token dictionaries, and architectural blueprints.
- **Prototype demonstrated:** Interactively demonstrated in the isolated sandbox prototype (`/prototype`) using realistic synthetic client fixtures. A prototype simulation must NOT be described as a production implementation.
- **Linked:** Navigable entrypoint, route, drawer, or modal exists in prototype connecting to related operational workflow.
- **Partial:** Core user workflow demonstrated in prototype; secondary edge-cases, automated notification dispatch, or complex background processing scheduled for dedicated implementation phase.
- **Absorbed:** Legacy standalone or orphaned experimental route whose functionality has been incorporated directly into standard authoritative destinations.
- **Deferred:** Explicitly scheduled for production backend/API implementation phases (Phases 5–12) with no live data impact in prototyping.
- **Retire Approved:** Decommissioned legacy tooling with no ongoing product utility (e.g., Wix one-off importer), approved by owner.

---

| Module ID | Existing Capability Description | Source Module / Files | Authoritative Target Destination (with Secondary Links) | Phase 4 Prototype Coverage | Prototype Interaction Details | Planned Implementation Phase | Data Impact / Owner Decision |
|---|---|---|---|---|---|---|---|
| **MOD-01** | Phone OTP & Google Login / Onboarding | `components/auth/*`, `components/onboarding/*` | System Authentication Barrier | **Linked** | Simulated login state with Unified Player View and Authorised Admin Console entry point | Phase 5 (Core Auth & Identity) | Preserves Firebase Phone OTP; no Cognito. Dual-write sync hardened server-side. |
| **MOD-02A**| Hero Next Fixture & Countdown | `components/HomeTab.tsx` | Player: **Home** | **Prototype demonstrated** | Gradient hero card with countdown, match format, and venue pin | Phase 6 (UI Implementation) | None. Reads upcoming match. |
| **MOD-02B**| One-Tap Player RSVP & Tactical Note | `components/HomeTab.tsx` | Player: **Home** | **Prototype demonstrated** | Interactive Available / Tentative / Unavailable buttons with tactical note input (local UI simulation) | Phase 6 (UI Implementation) | Updates match participation record in Phase 6; triggers push to match admins. |
| **MOD-02C**| Dues Warning Banner & Direct Checkout | `components/HomeTab.tsx` | Player: **Home** | **Prototype demonstrated** | Alert card displaying actionable outstanding balance and one-tap checkout link | Phase 7 (Payments & Finance) | Eliminates client-side fee manipulation; server computes payable total. |
| **MOD-02D**| Club Community Feed & Social Posts | `components/HomeTab.tsx` | Player: **Home** | **Prototype demonstrated** | Interactive like, comment count, and announcements feed (local UI simulation) | Phase 11 (Operations) | Read-only social feed with authenticated comments. |
| **MOD-03A**| Searchable Fixture List & Status Filters | `components/MatchesTab.tsx` | Player: **Matches** | **Prototype demonstrated** | Filter by All, Upcoming, Past, Abandoned with real-time search | Phase 6 (UI Implementation) | Chronological pagination (ARCH-002). |
| **MOD-03B**| Match Scorecard & Innings Breakdown | `components/MatchesTab.tsx` | Player: **Matches** | **Prototype demonstrated** | Slide-over drawer with batsman table (Runs, Balls, 4s, 6s, SR) and extras tally | Phase 6 (UI Implementation) | Tabular cricket stats format. |
| **MOD-03C**| Playing XI Squad & Catches Tally | `components/MatchesTab.tsx` | Player: **Matches** | **Prototype demonstrated** | Squad roster display with fielding catches breakdown | Phase 6 (UI Implementation) | Retains catches field; no data loss. |
| **MOD-03D**| Match Creation & Format Wizard | `components/MatchesTab.tsx` | Admin: **Match Centre** | **Prototype demonstrated** | 3-step modal: Opposition, format, fee per player, venue ground selector | Phase 8 (Match Operations) | Auto-binds match fee obligation schema in backend. |
| **MOD-03E**| Squad Selection & Pitch Attendance | `components/MatchesTab.tsx` | Admin: **Match Centre** | **Prototype demonstrated** | Local 1-tap attendance cycle (Present -> Late -> Absent) simulated in UI; distinguishes local attendance from persisted attendance | Phase 8 (Match Operations) | Persisted attendance changes dynamically trigger late fee or fee adjustment rules in Phase 8. |
| **MOD-03F**| Pitch-Side Cash Collection | `components/MatchesTab.tsx` | Admin: **Match Centre** (Secondary: **Finance & Dues**) | **Prototype demonstrated** | Dedicated modal for Match Admin to record physical cash with collector audit (mock collection in synthetic ledger) | Phase 7 (Payments & Finance) | Restricted strictly to assigned match (SEC-002). Backend ledger records authoritative audit. |
| **MOD-04A**| Player Dues Breakdown & Checkout | `components/FinanceTab.tsx`, `/pay/[playerId]` | Player: **Payments** | **Prototype demonstrated** | Itemized obligations list, Option A waiver display, simulation checkout modal; distinguishes simulated payment from verified Razorpay settlement | Phase 7 (Payments & Finance) | Server-side order generation and signature verification (FIN-001, FIN-003). |
| **MOD-04B**| Digital Receipts with QR Token | `components/FinanceTab.tsx` | Player: **Payments** | **Prototype demonstrated** | Modal receipt viewer with verification hash, payment channel, and audit token | Phase 7 (Payments & Finance) | Retrospective receipt generation for all historical collections. |
| **MOD-04C**| Option A Abandoned Match Waivers | `components/FinanceTab.tsx` | Player: **Payments** (Secondary: Admin: **Finance & Dues**) | **Prototype demonstrated** | Clearly marked `Waived (Abandoned Match)` with zero remaining liability | Phase 7 (Payments & Finance) | Preserves historical payments; voids uncollected dues (Option A). |
| **MOD-04D**| Financial Collections Ledger | `components/FinanceTab.tsx`, `RazorReportView` | Admin: **Finance & Dues** | **Prototype demonstrated** | Searchable ledger with payment method (Razorpay, Cash, UPI), amounts, dates; distinguishes mock ledger from authoritative financial ledger | Phase 7 (Payments & Finance) | Distinct liquid cash vs sponsorship vs waivers (FIN-005). |
| **MOD-04E**| Debtor Aging Breakdown (>14d, 1-14d) | `components/FinanceTab.tsx`, `AdminDashboard` | Admin: **Finance & Dues** | **Prototype demonstrated** | Categorized aging buckets with urgent immediate collection queue | Phase 7 (Payments & Finance) | Real-time calculation using Asia/Kolkata timezone (FIN-006). |
| **MOD-04F**| Ad-Hoc Fee Generation | `components/CreateFeeAdmin.tsx`, `AssignFeesAdmin`| Admin: **Finance & Dues** | **Prototype demonstrated** | Modal fee creator: Player selection, fee category, amount, due date | Phase 7 (Payments & Finance) | Restricted to Finance Admin / Super Admin (SEC-003). |
| **MOD-04G**| Financial Reconciliation CSV Export | `components/RazorReportView.tsx` | Admin: **Finance & Dues** | **Linked** | Export action button with confirmation toast | Phase 7 (Payments & Finance) | Server-side stream export. |
| **MOD-05** | Dues Reminders (WhatsApp & Email) | `components/DuesAndRemindersTab.tsx` | Admin: **Finance & Dues** | **Partial** | Dues aging actions with reminder dispatch hooks | Phase 7 (Payments & Finance) | Integrates with existing WhatsApp/Email API routes. |
| **MOD-06** | Standalone Player Payment Portal | `app/pay/[playerId]/page.tsx` | External Portal (Secondary: Player: **Payments**) | **Linked** | Deep-link to player checkout view | Phase 7 (Payments & Finance) | Secured with server token verification; prevents ID enumeration (CRIT-03). |
| **MOD-07** | Operations KPIs & Urgent Action Queue | `components/AdminDashboard.tsx` | Admin: **Overview** | **Prototype demonstrated** | 4 Operations KPI cards, critical alert queue with 1-tap navigation | Phase 8 (Admin Hubs) | Server-side aggregated metrics. |
| **MOD-08A**| Player Roster Directory & Filters | `components/PlayersTab.tsx` | Admin: **Player Roster** | **Prototype demonstrated** | Search by name, KAV-ID, jersey, status filters (Active, Pending, Injured) | Phase 9 (Roster & Identity) | Preserves player IDs; no bulk deletion. |
| **MOD-08B**| Registration Approval & KAV-ID Assign | `components/onboarding/PendingApprovalScreen` | Admin: **Player Roster** | **Prototype demonstrated** | 1-tap local approval simulation with sequential KAV-ID assignment; distinguishes local approval from real Firestore registration approval | Phase 9 (Roster & Identity) | Atomic batch transaction linking `appUsers` and `players`. |
| **MOD-08C**| Player Profile & RBAC Assignment | `components/EditPlayerInline.tsx` | Admin: **Player Roster** | **Prototype demonstrated** | Slide-over drawer with role checkboxes and real-time jersey validation | Phase 9 (Roster & Identity) | Enforces SEC-001 (role writes require Super Admin). Bans #10. |
| **MOD-08D**| Duplicate Player Merge Tool | `components/DuplicatePlayersReport.tsx` | Admin: **Player Roster** | **Prototype demonstrated** | Side-by-side reconciliation preview; distinguishes dry-run player merge from actual Firestore reparenting and UID link update | Phase 9 (Roster & Identity) | Fixes IDT-001; non-destructive deactivation of source record. |
| **MOD-09** | Club Profile, Sponsors & Info | `components/ClubTab.tsx` | Player: **Club** (Secondary: Admin: **Club Operations**) | **Prototype demonstrated** | Club executive committee, sponsors banner, ground information | Phase 11 (Operations) | Replaces "everything bucket" with organized views. |
| **MOD-10** | Grounds & Venue Management | `components/GroundsTab.tsx` | Admin: **Match Centre** (Secondary: Admin: **Club Operations**) | **Prototype demonstrated** | Grounds list with pitch types (Turf, Matting), locations, and selector | Phase 8 (Match Operations) | Integrated into fixture scheduling. |
| **MOD-11A**| Granular 6-Role Permission Matrix | `components/SettingsTab.tsx` | Admin: **Settings & Access** | **Prototype demonstrated** | Interactive RBAC matrix displaying granted capabilities for all 6 roles | Phase 5 (Core Auth & Identity) | Replaces client-side role toggle; enforces server claims. |
| **MOD-11B**| Timezone Lock (`Asia/Kolkata`) | `components/SettingsTab.tsx`, `lib/utils.ts` | Admin: **Settings & Access** | **Prototype demonstrated** | System configuration card locking date calculations to IST | Phase 5 & 7 | Fixes FIN-006 client clock tampering. |
| **MOD-11C**| Feature Flags & Guest Surcharges | `components/SettingsTab.tsx` | Admin: **Settings & Access** | **Prototype demonstrated** | Policy toggles (+20% guest surcharge, Option A automatic waivers) | Phase 5 & 7 | Stored in `appConfig/clubSettings`. |
| **MOD-12A**| Digital Player Card & Jersey Display | `components/ProfileTab.tsx` | Player: **Club** (Secondary: Player: **Performance**) | **Prototype demonstrated** | Interactive digital player card showing Jersey, KAV-ID, avatar, and batting/bowling styles | Phase 10 (Player Profile) | Mobile-first shareable digital identity. |
| **MOD-12B**| Contact Info & Profile Management | `components/ProfileTab.tsx` | Player: **Club** | **Prototype demonstrated** | Editable player contact details with Indian phone normalization | Phase 10 (Player Profile) | Phone validation (+91 normalization). |
| **MOD-13** | Creative Matchday Graphics Studio | `components/DesignTab.tsx` | Admin: **Club Operations** (Secondary: Designer Role Studio View) | **Prototype demonstrated** | Interactive banner generator: Select template (Matchday, POTM, Squad), preview SVG banner, download simulation | Phase 11 (Operations) | Replaces browser-alert launcher with live preview generator. |
| **MOD-14A**| Merchandise Shop Catalog | `components/ShopTab.tsx` | Player: **Club** | **Prototype demonstrated** | Product cards (Match Jersey, Training Polo, Cap, Trousers), size selector, order modal simulation | Phase 11 (Operations) | Validated order creation (SEC-006). |
| **MOD-14B**| Merchandise Fulfillment Pipeline | `components/ShopTab.tsx` | Admin: **Club Operations** | **Prototype demonstrated** | Order status tracker (New -> In Production -> Ready -> Delivered) + size breakdown | Phase 11 (Operations) | Webhook/server order finalization (FIN-004). |
| **MOD-15A**| Nets Slot Booking Timetable | `components/StudioTab.tsx` | Player: **Club** (Secondary: Admin: **Studio & Nets**) | **Prototype demonstrated** | 3-lane schedule (Fast, Spin, Bowling Machine) with 1-tap slot reservation simulation; distinguishes simulated studio reservation from real booking | Phase 10 (Studio & Nets) | Multi-turf lane scheduling and session credit balance debit. |
| **MOD-15B**| Studio Passes & Credit Ledger | `components/StudioTab.tsx`, `StudioAdminTab` | Player: **Club** (Secondary: Admin: **Studio & Nets**) | **Prototype demonstrated** | 10-session pack balances, monthly unlimited passes, expiry tracking | Phase 10 (Studio & Nets) | Session credit deduction on booking. |
| **MOD-15C**| Studio CRM & Inquiries Pipeline | `components/studio/StudioCRMView.tsx` | Admin: **Studio & Nets** | **Prototype demonstrated** | Inquiries pipeline (Trial Requested -> Attended -> Converted) with follow-up | Phase 10 (Studio & Nets) | WhatsApp reminder integration. |
| **MOD-16A**| Player Career Statistics & Milestones | `components/BadgesTab.tsx`, `ProfileTab.tsx` | Player: **Performance** | **Prototype demonstrated** | Season & career totals (Runs, Avg, SR, Wickets, Catches, 50s, 100s) | Phase 10 (Performance) | Dynamic calculation from validated scorecards. |
| **MOD-16B**| Milestone Badges & Achievements | `components/BadgesTab.tsx`, `BadgeIcon.tsx` | Player: **Performance** (Secondary: Admin: **Settings & Access**) | **Prototype demonstrated** | Achievement cards (Centurion, 5-Wicket Haul, Safe Hands, POTM) | Phase 10 (Performance) | Automated badge evaluator triggers. |
| **MOD-16C**| Club Leaderboards (Runs, Wickets, SR) | `components/LeaderboardTab.tsx` | Player: **Performance** | **Prototype demonstrated** | Tabbed leaderboard rankings with podium badges and statistics | Phase 10 (Performance) | Real-time leaderboard compilation. |
| **MOD-17** | Tournament Management | `components/TournamentsTab.tsx` | Admin: **Match Centre** (Secondary: Admin: **Club Operations**) | **Prototype demonstrated** | Tournament cards (Premier League, Pre-season Cup), stage tracker | Phase 8 (Match Operations) | Tournament grouping for fixtures. |
| **MOD-18A**| Member Decision Polls & Voting | `components/OpinionTab.tsx` | Player: **Club** (Secondary: Admin: **Club Operations**) | **Prototype demonstrated** | Interactive poll with vote percentages, live tally, and voting confirmation simulation | Phase 11 (Operations) | Anonymous or member-verified vote recording. |
| **MOD-18B**| Slide-Over Notification Drawer | `components/NotificationsTab.tsx` | System Header (All views) | **Prototype demonstrated** | Slide-over drawer displaying squad announcements, payment receipts, nets alerts | Phase 6 (UI Implementation) | Unread notification badges and dismissals. |
| **MOD-18C**| Transaction & Administrative Audit Log| `components/AuditLogTab.tsx`, `lib/audit.ts` | Admin: **Settings & Access** (Secondary: Admin: **Finance & Dues**) | **Prototype demonstrated** | Slide-over drawer with immutable audit tokens for cash, waivers, and fee edits | Phase 5 & 7 | Tamper-proof server audit trail. |
| **MOD-LEGACY**| Wix Historical Finance Importer | `components/WixFinanceView.tsx` | Retired Tooling | **Retire Approved** | Not represented in Phase 4 prototype | Decommissioned | One-off migration utility; no live operational requirement. |
| **MOD-ORPHAN**| Admin Tools Experimental Route | `app/admin-tools/page.tsx` | Admin: **Settings & Access** | **Absorbed** | Absorbed into Settings & Access and Player Roster merge capabilities | Phase 5 & 9 | Orphaned route consolidated into standard admin hubs. |

---

## 3. Discrepancy & Resolution Summary

1. **Previous Phase 3 Report Text vs. Decision Log:**
   - Historical draft text in `DECISION-LOG.md` mentioned an unapproved 3-tier role collapse and an older 5-item player navigation (`Home, My Finance, Pay, Profile, More`).
   - This was formally superseded and resolved in commit `133da8b` by logging **D-08** (granular 6 roles enforced) and **D-09** (authoritative 5-tab Player nav & 7-hub Admin console enforced).
2. **Phase 4 Prototype Coverage Gaps Remediated:**
   - **Player Performance:** Added comprehensive player statistics, milestone badges, and club leaderboards.
   - **Player Club:** Added digital player card, nets pass balances, merchandise shop ordering, member polls, and club details.
   - **Desktop Layout:** Added full two-column layout with persistent sidebar navigation and right-hand contextual panel (desktop is NOT merely a padded frame around mobile).
   - **Design Studio:** Replaced browser-alert launcher with live interactive Matchday Banner & Graphics Generator.
   - **Grounds, Tournaments & Badges:** Integrated into Match Centre and Player Roster hubs.
   - **Accessible Touch Targets:** Enforced `min-h-[44px]` on all mobile interactive controls.
   - **Simulation Clarity:** Explicitly labeled all prototype actions with `[PROTOTYPE SIMULATION]` banners.

---

## 4. Security Remediation 1F-A Requirements Traceability Matrix

| Requirement ID | Source | Requirement | Phase/Workstream | Implementation Evidence | Test Evidence | Status |
|---|---|---|---|---|---|---|
| **REQ-1FA-01** | Gate 1F-A | Transactional reservation checks inside Firestore transaction before mutating identity indexes | Security Remediation 1F-A | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeMergeIdentityStage`) | `remediation1fa-*.emulator.test.mjs` Tests 1–11 | **Emulator-tested** |
| **REQ-1FA-02** | Gate 1F-A | Atomic merge lease acquisition and single active worker mutual exclusion | Security Remediation 1F-A | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`acquireMergeLease`) | `remediation1fa-*.emulator.test.mjs` Tests 12–14 | **Emulator-tested** |
| **REQ-1FA-03** | Gate 1F-A | Worker lease renewal prior to expiry by current leaseOwner | Security Remediation 1F-A | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`renewMergeLease`), [route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/admin/merge-players/route.ts) (`PUT`) | `remediation1fa-*.emulator.test.mjs` Tests 15–17 | **Emulator-tested** |
| **REQ-1FA-04** | Gate 1F-A | Stale-worker fencing via monotonic fencingToken validation across stage transitions | Security Remediation 1F-A | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`verifyWorkerFencingAndAdvanceStage`) | `remediation1fa-*.emulator.test.mjs` Tests 18–22 | **Emulator-tested** |
| **REQ-1FA-05** | Gate 1F-A | Fencing token validation on final merge completion | Security Remediation 1F-A | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeMergeCompletionStage`) | `remediation1fa-*.emulator.test.mjs` Tests 23–24 | **Emulator-tested** |
| **REQ-1FA-06** | Gate 1F-A | In-progress merge blocks account linking with 409 Conflict | Security Remediation 1F-A | [lib/account-linking.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/account-linking.ts) (`executeLinkingTransaction`) | `remediation1fa-*.emulator.test.mjs` Tests 25–27 | **Emulator-tested** |
| **REQ-1FA-07** | Gate 1F-A | Completed merge permits account linking for surviving keeper record | Security Remediation 1F-A | [lib/account-linking.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/account-linking.ts) (`executeLinkingTransaction`) | `remediation1fa-*.emulator.test.mjs` Tests 28–29 | **Emulator-tested** |
| **REQ-1FA-08** | Gate 1F-A | Firestore rules deny all direct client access to `/mergeJobs/{jobId}` | Security Remediation 1F-A | [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L147-L149) | Emulator suite / Admin SDK execution | **Emulator-tested** |

---

## 5. Security Remediation 1F Requirements Traceability Matrix

| Requirement ID | Finding / Source | Requirement Description | Implementation Evidence | Test Evidence | Status |
|---|---|---|---|---|---|
| **REQ-1F-01** | Finding 1F-01 | Transactional reservation validation inside transaction before mutations; reject conflicting UID/phone reservations with HTTP 409 | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeMergeIdentityStage`) | `remediation1f-*.emulator.test.mjs` Scenarios 1–6 | **Emulator-tested** |
| **REQ-1F-02** | Finding 1F-02 | Exclusive merge-job execution: atomic worker lease acquisition, heartbeat renewal, and monotonic stale-worker fencing | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts), [route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/admin/merge-players/route.ts) | `remediation1f-*.emulator.test.mjs` Scenarios 7–12, 1fa Tests 12–24 | **Emulator-tested** |
| **REQ-1F-03** | Finding 1F-03 | Financial record collision protection (`otherFees`, `payments`, `merchOrders`); reject conflicting records with HTTP 409; preserve amounts, original IDs, Razorpay refs | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`migratePaymentsStage`, `migrateOtherFeesStage`, `migrateMerchOrdersStage`) | `remediation1f-*.emulator.test.mjs` Scenarios 17–20 | **Emulator-tested** |
| **REQ-1F-04** | Finding 1F-04 | Bounded, resumable migration stages strictly under Firestore 500-write transaction/batch limit (chunk size 50–100 ops) | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (staged batch architecture with cursor resumption) | `remediation1f-*.emulator.test.mjs` Scenarios 13–16 | **Emulator-tested** |
| **REQ-1F-05** | Finding 1F-05 | Independent final migration verification gate before soft-delete and merge job completion | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeIndependentFinalVerification`) | `remediation1f-*.emulator.test.mjs` Scenarios 21–22 | **Emulator-tested** |
| **REQ-1F-06** | Finding 1F-06 | Canonical `phoneIndex` / `uidIndex` field contracts and strict 10-point four-way consistency in account linking | [lib/account-linking.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/account-linking.ts) (`executeLinkingTransaction`) | `remediation1f-*.emulator.test.mjs` Scenarios 23–27 | **Emulator-tested** |
| **REQ-1F-07** | Finding 1F-07 | Fail-closed bootstrap readiness reporting: `safeToBootstrap: false` on missing mobile on active players, malformed mobile, or index mismatches | [scripts/bootstrap-identity-index.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/scripts/bootstrap-identity-index.ts) | `remediation1f-*.emulator.test.mjs` Scenarios 28–30 | **Emulator-tested** |
| **REQ-1F-08** | Finding 1F-08 | Lock merge lifecycle fields (`authUid`, `mergedInto`, `mergeStatus`, `mergeJobId`) in `firestore.rules` for `/players/{playerId}` | [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L170-L195) | `remediation1f-*.emulator.test.mjs` Scenarios 31–34 | **Emulator-tested** |

---

## 6. Security Remediation 1F-R Requirements Traceability Matrix

| Requirement ID | Workstream / Source | Requirement Description | Implementation Evidence | Test Evidence | Status |
|---|---|---|---|---|---|
| **REQ-1FR-01** | Workstream R1 | Worker fencing on every migration mutation chunk across all stages (`payments`, `otherFees`, `merchOrders`, `appUsers/indexes`). Stale or superseded workers rejected immediately. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`migratePaymentsStage`, `migrateOtherFeesStage`, `migrateMerchOrdersStage`, `migrateAppUsersAndIndexesStage`) | `tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs` Scenario 35 | **Emulator-tested** |
| **REQ-1FR-02** | Workstream R2 | Integrated lease renewal and heartbeat in server-side orchestration before lease expiration, strictly adhering to Firestore read-before-write constraints. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`renewMergeLease`, `migratePaymentsStage`, `migrateOtherFeesStage`) | `tests/remediation1fa-identity-reservations-and-merge-lease.emulator.test.mjs` Test 16, `remediation1f` Scenario 15 | **Emulator-tested** |
| **REQ-1FR-03** | Workstream R3 | Exclusive player-level locking for BOTH loser and keeper in `acquireMergeLease`. Rejects concurrent merges on keeper or cross-role player locks with HTTP 409. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`acquireMergeLease`) | `tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs` Scenarios 36–37 | **Emulator-tested** |
| **REQ-1FR-04** | Workstream R4 | Authoritative financial collision protection comparing amount, title, status, templateId, paymentMethod, razorpayPaymentId, paidAmount/feeCollectedAmount, receiptId, waivedReason, refundId, and cancelledBy. Aborts with 409 `FINANCIAL_RECORD_COLLISION`. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`areFeesIdentical`, `migrateOtherFeesStage`) | `tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs` Scenarios 38–40 | **Emulator-tested** |
| **REQ-1FR-05** | Workstream R5 | Retire legacy unauthenticated/unfenced `PATCH /api/admin/merge-players` endpoint (Option A: retired with HTTP 405 Method Not Allowed). | [app/api/admin/merge-players/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/admin/merge-players/route.ts) (`PATCH`) | `tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs` Scenario 41 | **Emulator-tested** |
| **REQ-1FR-06** | Workstream R6 | Recompute identity decisions from fresh transactional data inside `executeMergeIdentityStage`, eliminating stale pre-flight assumptions. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeMergeIdentityStage`) | `tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs` Scenarios 1–6 | **Emulator-tested** |
| **REQ-1FR-07** | Workstream R7 | Authoritative multiplicity and orphan detection across all identity queries (`uidIndex`, `phoneIndex`, `appUsers`). Rejects 409 on multiple or orphaned reservations. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeMergeIdentityStage`) | `tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs` Scenarios 7–8 | **Emulator-tested** |
| **REQ-1FR-08** | Workstream R8 | Durable cumulative progress tracking in `mergeJobs/{jobId}` (`stats.*Progress` and `stats.*Chunks`). Retries never decrement cumulative progress. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`migratePaymentsStage`, `migrateOtherFeesStage`, `migrateMerchOrdersStage`, `migrateAppUsersAndIndexesStage`) | `tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs` Scenarios 15–16 | **Emulator-tested** |
| **REQ-1FR-09** | Workstream R9 | Bounded reads and writes via chunked pagination (`limit(batchLimit)`), enforcing strict compliance with Firestore 500-op limits and preventing unbounded memory growth. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`migratePaymentsStage`, `migrateOtherFeesStage`, `migrateMerchOrdersStage`, `migrateAppUsersAndIndexesStage`) | `tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs` Scenarios 11–12 | **Emulator-tested** |
| **REQ-1FR-10** | Workstream R10 | Fail-closed independent final verification in `executeIndependentFinalVerification`. Confirms zero residual loser records AND confirms keeper's phone/UID index reservations exist. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeIndependentFinalVerification`) | `tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs` Scenarios 42–43 | **Emulator-tested** |


