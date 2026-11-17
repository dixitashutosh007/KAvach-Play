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
- **Complete:** Fully designed, specified, and interactively demonstrated in the navigable `/prototype` sandbox with realistic synthetic fixtures.
- **Partial:** Core user workflow demonstrated in prototype; secondary edge-cases or admin actions deferred to backend implementation phase.
- **Linked:** Navigable route, drawer, or modal entrypoint exists in prototype connecting to related operational workflow.
- **Deferred:** Explicitly scheduled for production backend/API implementation phases (Phase 5–12) with no data impact in prototyping.
- **Retire Approved:** Decommissioned legacy tooling with no ongoing product utility (e.g., Wix one-off importer).

---

| Module ID | Existing Capability Description | Source Module / Files | Approved Target Destination | Phase 4 Prototype Coverage | Prototype Interaction Details | Planned Implementation Phase | Data Impact / Owner Decision |
|---|---|---|---|---|---|---|---|
| **MOD-01** | Phone OTP & Google Login / Onboarding | `components/auth/*`, `components/onboarding/*` | System Authentication Barrier | **Linked** | Simulated login state with Admin/Player persona toggle and profile card | Phase 5 (Core Auth & Identity) | Preserves Firebase Phone OTP; no Cognito. Dual-write sync hardened server-side. |
| **MOD-02A**| Hero Next Fixture & Countdown | `components/HomeTab.tsx` | Player: **Home** | **Complete** | Gradient hero card with countdown, match format, and venue pin | Phase 6 (UI Implementation) | None. Reads upcoming match. |
| **MOD-02B**| One-Tap Player RSVP & Tactical Note | `components/HomeTab.tsx` | Player: **Home** | **Complete** | Interactive Available / Tentative / Unavailable buttons with tactical note input | Phase 6 (UI Implementation) | Updates match participation record; triggers push to match admins. |
| **MOD-02C**| Dues Warning Banner & Direct Checkout | `components/HomeTab.tsx` | Player: **Home** | **Complete** | Alert card displaying actionable outstanding balance and one-tap checkout link | Phase 7 (Payments & Finance) | Eliminates client-side fee manipulation; server computes payable total. |
| **MOD-02D**| Club Community Feed & Social Posts | `components/HomeTab.tsx` | Player: **Home** | **Complete** | Interactive like, comment count, and announcements feed | Phase 11 (Operations) | Read-only social feed with authenticated comments. |
| **MOD-03A**| Searchable Fixture List & Status Filters | `components/MatchesTab.tsx` | Player: **Matches** | **Complete** | Filter by All, Upcoming, Past, Abandoned with real-time search | Phase 6 (UI Implementation) | Chronological pagination (ARCH-002). |
| **MOD-03B**| Match Scorecard & Innings Breakdown | `components/MatchesTab.tsx` | Player: **Matches** | **Complete** | Slide-over drawer with batsman table (Runs, Balls, 4s, 6s, SR) and extras tally | Phase 6 (UI Implementation) | Tabular cricket stats format. |
| **MOD-03C**| Playing XI Squad & Catches Tally | `components/MatchesTab.tsx` | Player: **Matches** | **Complete** | Squad roster display with fielding catches breakdown | Phase 6 (UI Implementation) | Retains catches field; no data loss. |
| **MOD-03D**| Match Creation & Format Wizard | `components/MatchesTab.tsx` | Admin: **Match Centre** | **Complete** | 3-step modal: Opposition, format, fee per player, venue ground selector | Phase 8 (Match Operations) | Auto-binds match fee obligation schema. |
| **MOD-03E**| Squad Selection & Pitch Attendance | `components/MatchesTab.tsx` | Admin: **Match Centre** | **Complete** | Interactive 1-tap attendance cycle (Present -> Late -> Absent) | Phase 8 (Match Operations) | Attendance changes dynamically trigger late fee or fee adjustment rules. |
| **MOD-03F**| Pitch-Side Cash Collection | `components/MatchesTab.tsx` | Admin: **Match Centre** / **Finance** | **Complete** | Dedicated modal for Match Admin to record physical cash with collector audit | Phase 7 (Payments & Finance) | Restricted strictly to assigned match (SEC-002). |
| **MOD-04A**| Player Dues Breakdown & Checkout | `components/FinanceTab.tsx`, `/pay/[playerId]` | Player: **Payments** | **Complete** | Itemized obligations list, Option A waiver display, Razorpay checkout modal | Phase 7 (Payments & Finance) | Server-side order generation (FIN-001). |
| **MOD-04B**| Digital Receipts with QR Token | `components/FinanceTab.tsx` | Player: **Payments** | **Complete** | Modal receipt viewer with verification hash, payment channel, and audit token | Phase 7 (Payments & Finance) | Retrospective receipt generation for all historical collections. |
| **MOD-04C**| Option A Abandoned Match Waivers | `components/FinanceTab.tsx` | Player: **Payments** & Admin: **Finance** | **Complete** | Clearly marked `Waived (Abandoned Match)` with zero remaining liability | Phase 7 (Payments & Finance) | Preserves historical payments; voids uncollected dues (Option A). |
| **MOD-04D**| Financial Collections Ledger | `components/FinanceTab.tsx`, `RazorReportView` | Admin: **Finance & Dues** | **Complete** | Searchable ledger with payment method (Razorpay, Cash, UPI), amounts, dates | Phase 7 (Payments & Finance) | Distinct liquid cash vs sponsorship vs waivers (FIN-005). |
| **MOD-04E**| Debtor Aging Breakdown (>14d, 1-14d) | `components/FinanceTab.tsx`, `AdminDashboard` | Admin: **Finance & Dues** | **Complete** | Categorized aging buckets with urgent immediate collection queue | Phase 7 (Payments & Finance) | Real-time calculation using Asia/Kolkata timezone (FIN-006). |
| **MOD-04F**| Ad-Hoc Fee Generation | `components/CreateFeeAdmin.tsx`, `AssignFeesAdmin`| Admin: **Finance & Dues** | **Complete** | Modal fee creator: Player selection, fee category, amount, due date | Phase 7 (Payments & Finance) | Restricted to Finance Admin / Super Admin (SEC-003). |
| **MOD-04G**| Financial Reconciliation CSV Export | `components/RazorReportView.tsx` | Admin: **Finance & Dues** | **Linked** | Export action button with confirmation toast | Phase 7 (Payments & Finance) | Server-side stream export. |
| **MOD-05** | Dues Reminders (WhatsApp & Email) | `components/DuesAndRemindersTab.tsx` | Admin: **Finance & Dues** | **Partial** | Dues aging actions with reminder dispatch hooks | Phase 7 (Payments & Finance) | Integrates with existing WhatsApp/Email API routes. |
| **MOD-06** | Standalone Player Payment Portal | `app/pay/[playerId]/page.tsx` | External Portal / Player: **Payments** | **Linked** | Deep-link to player checkout view | Phase 7 (Payments & Finance) | Secured with server token verification; prevents ID enumeration (CRIT-03). |
| **MOD-07** | Operations KPIs & Urgent Action Queue | `components/AdminDashboard.tsx` | Admin: **Overview** | **Complete** | 4 Operations KPI cards, critical alert queue with 1-tap navigation | Phase 8 (Admin Hubs) | Server-side aggregated metrics. |
| **MOD-08A**| Player Roster Directory & Filters | `components/PlayersTab.tsx` | Admin: **Player Roster** | **Complete** | Search by name, KAV-ID, jersey, status filters (Active, Pending, Injured) | Phase 9 (Roster & Identity) | Preserves player IDs; no bulk deletion. |
| **MOD-08B**| Registration Approval & KAV-ID Assign | `components/onboarding/PendingApprovalScreen` | Admin: **Player Roster** | **Complete** | 1-tap "Approve & Assign ID" button assigning sequential KAV-IDs | Phase 9 (Roster & Identity) | Atomic batch transaction linking `appUsers` and `players`. |
| **MOD-08C**| Player Profile & RBAC Assignment | `components/EditPlayerInline.tsx` | Admin: **Player Roster** | **Complete** | Slide-over drawer with role checkboxes and real-time jersey validation | Phase 9 (Roster & Identity) | Enforces SEC-001 (role writes require Super Admin). Bans #10. |
| **MOD-08D**| Duplicate Player Merge Tool | `components/DuplicatePlayersReport.tsx` | Admin: **Player Roster** | **Complete** | Side-by-side reconciliation preview with `appUsers.playerId` reparenting | Phase 9 (Roster & Identity) | Fixes IDT-001; non-destructive deactivation of source record. |
| **MOD-09** | Club Profile, Sponsors & Info | `components/ClubTab.tsx` | Player: **Club** & Admin: **Club Operations** | **Complete** | Club executive committee, sponsors banner, ground information | Phase 11 (Operations) | Replaces "everything bucket" with organized views. |
| **MOD-10** | Grounds & Venue Management | `components/GroundsTab.tsx` | Admin: **Match Centre** / **Club Operations** | **Complete** | Grounds list with pitch types (Turf, Matting), locations, and selector | Phase 8 (Match Operations) | Integrated into fixture scheduling. |
| **MOD-11A**| Granular 6-Role Permission Matrix | `components/SettingsTab.tsx` | Admin: **Settings & Access** | **Complete** | Interactive RBAC matrix displaying granted capabilities for all 6 roles | Phase 5 (Core Auth & Identity) | Replaces client-side role toggle; enforces server claims. |
| **MOD-11B**| Timezone Lock (`Asia/Kolkata`) | `components/SettingsTab.tsx`, `lib/utils.ts` | Admin: **Settings & Access** | **Complete** | System configuration card locking date calculations to IST | Phase 5 & 7 | Fixes FIN-006 client clock tampering. |
| **MOD-11C**| Feature Flags & Guest Surcharges | `components/SettingsTab.tsx` | Admin: **Settings & Access** | **Complete** | Policy toggles (+20% guest surcharge, Option A automatic waivers) | Phase 5 & 7 | Stored in `appConfig/clubSettings`. |
| **MOD-12A**| Digital Player Card & Jersey Display | `components/ProfileTab.tsx` | Player: **Club** & **Performance** | **Complete** | Interactive digital player card showing Jersey, KAV-ID, avatar, and batting/bowling styles | Phase 10 (Player Profile) | Mobile-first shareable digital identity. |
| **MOD-12B**| Contact Info & Profile Management | `components/ProfileTab.tsx` | Player: **Club** | **Complete** | Editable player contact details with Indian phone normalization | Phase 10 (Player Profile) | Phone validation (+91 normalization). |
| **MOD-13** | Creative Matchday Graphics Studio | `components/DesignTab.tsx` | Admin: **Club Operations** / Designer Hub | **Complete** | Interactive banner generator: Select template (Matchday, POTM, Squad), preview SVG banner, download | Phase 11 (Operations) | Replaces browser-alert launcher with live preview generator. |
| **MOD-14A**| Merchandise Shop Catalog | `components/ShopTab.tsx` | Player: **Club** | **Complete** | Product cards (Match Jersey, Training Polo, Cap, Trousers), size selector | Phase 11 (Operations) | Validated order creation (SEC-006). |
| **MOD-14B**| Merchandise Fulfillment Pipeline | `components/ShopTab.tsx` | Admin: **Club Operations** | **Complete** | Order status tracker (New -> In Production -> Ready -> Delivered) + size breakdown | Phase 11 (Operations) | Webhook/server order finalization (FIN-004). |
| **MOD-15A**| Nets Slot Booking Timetable | `components/StudioTab.tsx` | Player: **Club** & Admin: **Studio & Nets** | **Complete** | 3-lane schedule (Fast, Spin, Bowling Machine) with 1-tap slot reservation | Phase 10 (Studio & Nets) | Multi-turf lane scheduling. |
| **MOD-15B**| Studio Passes & Credit Ledger | `components/StudioTab.tsx`, `StudioAdminTab` | Player: **Club** & Admin: **Studio & Nets** | **Complete** | 10-session pack balances, monthly unlimited passes, expiry tracking | Phase 10 (Studio & Nets) | Session credit deduction on booking. |
| **MOD-15C**| Studio CRM & Inquiries Pipeline | `components/studio/StudioCRMView.tsx` | Admin: **Studio & Nets** | **Complete** | Inquiries pipeline (Trial Requested -> Attended -> Converted) with follow-up | Phase 10 (Studio & Nets) | WhatsApp reminder integration. |
| **MOD-16A**| Player Career Statistics & Milestones | `components/BadgesTab.tsx`, `ProfileTab.tsx` | Player: **Performance** | **Complete** | Season & career totals (Runs, Avg, SR, Wickets, Catches, 50s, 100s) | Phase 10 (Performance) | Dynamic calculation from validated scorecards. |
| **MOD-16B**| Milestone Badges & Achievements | `components/BadgesTab.tsx`, `BadgeIcon.tsx` | Player: **Performance** & Admin: **Settings** | **Complete** | Achievement cards (Centurion, 5-Wicket Haul, Safe Hands, POTM) | Phase 10 (Performance) | Automated badge evaluator triggers. |
| **MOD-16C**| Club Leaderboards (Runs, Wickets, SR) | `components/LeaderboardTab.tsx` | Player: **Performance** | **Complete** | Tabbed leaderboard rankings with podium badges and statistics | Phase 10 (Performance) | Real-time leaderboard compilation. |
| **MOD-17** | Tournament Management | `components/TournamentsTab.tsx` | Admin: **Match Centre** / **Club Operations** | **Complete** | Tournament cards (Premier League, Pre-season Cup), stage tracker | Phase 8 (Match Operations) | Tournament grouping for fixtures. |
| **MOD-18A**| Member Decision Polls & Voting | `components/OpinionTab.tsx` | Player: **Club** & Admin: **Club Operations** | **Complete** | Interactive poll with vote percentages, live tally, and voting confirmation | Phase 11 (Operations) | Anonymous or member-verified vote recording. |
| **MOD-18B**| Slide-Over Notification Drawer | `components/NotificationsTab.tsx` | System Header (All views) | **Complete** | Slide-over drawer displaying squad announcements, payment receipts, nets alerts | Phase 6 (UI Implementation) | Unread notification badges and dismissals. |
| **MOD-18C**| Transaction & Administrative Audit Log| `components/AuditLogTab.tsx`, `lib/audit.ts` | Admin: **Settings & Access** / **Finance** | **Complete** | Slide-over drawer with immutable audit tokens for cash, waivers, and fee edits | Phase 5 & 7 | Tamper-proof server audit trail. |
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
