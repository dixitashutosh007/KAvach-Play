# KAVACH PLAY — Implementation Phase Tracker

**Project:** KAvach Play Modernisation  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Current Remediation Agent:** Gemini in Antigravity (owner-approved transition from Claude Code)  
**Historical Audit Baseline:** Commit `ab794df` / `acff8325b559ec0f7fc9dfa04b75f6a438ee42f5` (Found NO-GO with 20+ P0/P1 defects)  
**Governing Standard:** `AGENTS.md`, `DECISION-LOG.md` (D-08, D-09, D-10), `REQUIREMENTS_TRACEABILITY.md`

---

## 1. Active Remediation Master Plan Track (Authoritative)

The table below reflects the active, owner-approved remediation master plan track. Previous claims of 12-phase completion were audited and found defective; this track governs actual verified progress.

| Phase | Phase Name | Status | Verified Deliverables / Scope | Target Milestone |
|---|---|---|---|---|
| **Phase 0** | **Discovery & Retrospective Audit** | **COMPLETE** | Audit baseline established (`acff8325`), defect register created, requirements matrix produced. | Verified Baseline |
| **Phase 1** | **Critical Security & Financial Baseline** | **COMPLETE** | CRIT-01/02 fixed, Option A abandoned match billing helper (`isMatchBillable`), FIN-01/02 calculation fixes. | Verified Commit |
| **Phase 2** | **State Integrity & Listener Lifecycle** | **COMPLETE** | CRIT-03 query scoping, WixFinanceView retired, unused dependencies removed. | Verified Commit |
| **Phase 3** | **Product Rationalisation & UX Discovery** | **COMPLETE (Sign-off `91811ed`)** | Complete product & feature inventory (32 items), D-08 (granular RBAC), D-09 (5-item Player Nav / 7-hub Admin Console), D-10 (Unified Player View + Authorised Admin Console). | Blueprint Complete |
| **Phase 4** | **UX Blueprint, High-Fidelity Design & Prototypes** | **PROTOTYPE COMPLETE (Pending Independent QA & Owner Review)** | Navigable sandbox prototype at `/prototype` covering all 5 Player tabs & 7 Admin hubs across 6 viewports, 44px touch targets, accessibility traps, Playwright 26/26 passed. Zero production code modified. | Prototype Sandbox |
| **Phase 5** | **Core Auth & Server-Side Security** | **PLANNED / NOT STARTED** | Authoritative server-side Razorpay order generation (FIN-001), raw webhook signature verification (FIN-003), server-side fee calculation, idempotent transaction processing. | Production Phase |
| **Phase 6** | **UI Implementation & Match Display** | **PLANNED / NOT STARTED** | Hardened Firestore security rules with emulator test suite; production connection of Player UI screens. | Production Phase |
| **Phase 7** | **Payments, Finance & Authoritative Ledger** | **PLANNED / NOT STARTED** | Live Razorpay integration, authoritative financial ledger mutations, digital receipt generation from persisted collections. | Production Phase |
| **Phase 8** | **Match Operations & Admin Hubs** | **PLANNED / NOT STARTED** | Persisted match scheduling, live attendance recording, and automatic late-fee triggers. | Production Phase |
| **Phase 9** | **Roster, Identity & Approval Workflows** | **PLANNED / NOT STARTED** | Atomic registration approval batch linking `appUsers` and `players`, relational duplicate player merge reparenting `players` and updating `appUsers.playerId`. | Production Phase |
| **Phase 10** | **Performance, Studio & Nets, Player Profile** | **PLANNED / NOT STARTED** | Live multi-lane net booking, pass balance debit transactions, automated career stats compilation from validated scorecards, and digital player cards. | Production Phase |
| **Phase 11** | **Club Operations, Shop, Polling & Hardening** | **PLANNED / NOT STARTED** | Production merchandise order processing, live member polls, and WCAG AA accessibility certification. | Production Phase |
| **Phase 12** | **Production Verification, Audit & Cutover** | **PLANNED / NOT STARTED** | Final production readiness audit, live staging verification, and controlled owner-approved cutover. | Release Phase |

---

## 2. Historical Unverified 12-Phase Audit Baseline (Preserved Reference)

> **Important Historical Context:** The sections below document the initial 12-phase implementation claims reported by the previous implementation agent (Claude Code). An independent Antigravity audit of commit `acff8325b559ec0f7fc9dfa04b75f6a438ee42f5` found material security (SEC-001–006), financial (FIN-001–007), and architectural defects across these claims. In accordance with `AGENTS.md`, these historical notes are preserved for retrospective auditability but are **superseded** by the Active Remediation Master Plan Track above.

| Historical Phase | Legacy Name | Reported Legacy Status | Independent Audit Finding |
|---|---|---|---|
| 0 | Discovery & Verification | Reported Complete | Baselined; uncovered CRIT-01 through CRIT-04 |
| 1 | Critical Security & Financial Fixes | Reported Complete | Incomplete; FIN-001–003, SEC-001–004 remained |
| 2 | Data Integrity & Schema Cleanup | Reported Complete | Incomplete; duplicate dual-writes lacked server atomicity |
| 3 | Identity Consolidation | Reported Complete | IDT-001 merge bug persisted; appUsers.playerId not reparented |
| 4 | Component Decomposition | Reported Complete | MatchesTab partially decomposed; useStore monolith remained |
| 5 | Navigation Rationalisation | Reported Complete | Superseded by D-09 / D-10 authoritative architecture |
| 6 | UI/UX Redesign | Reported Complete | Incomplete; dark backgrounds leaked into modals; UX-001–005 |
| 7 | Financial Logic Overhaul | Reported Complete | Webhook client-side dependency; lack of server-side order calculation |
| 8 | Workflow Simplification | Reported Complete | AccountDisabledScreen wired up but admin workflows unhardened |
| 9 | Studio & Shop Enhancement | Reported Complete | SS-D1 orderPayload bug remained |
| 10 | Testing & Quality Infrastructure | Reported Complete | QA-001 mock tests; QA-002 no emulator suite; skipped tests |
| 11 | Performance & Optimization | Reported Complete | useStore monolith & listener lifecycle unaddressed |

---

## Phase 0 — Discovery & Verification

### Deliverables

| # | Deliverable | File | Status |
|---|------------|------|--------|
| 1 | Repository baseline report | `BASELINE.md` | COMPLETE |
| 2 | Security & financial risk register | `SECURITY-RISK-REGISTER.md` | COMPLETE |
| 3 | Feature & module inventory | `FEATURE-INVENTORY.md` | COMPLETE |
| 4 | Test baseline & coverage report | `TEST-BASELINE.md` | COMPLETE |
| 5 | Architecture & tech debt assessment | `ARCHITECTURE-ASSESSMENT.md` | COMPLETE |
| 6 | Feature disposition & decision register | `DECISION-LOG.md` | COMPLETE |
| 7 | Phase readiness assessment | `PHASE-READINESS.md` | COMPLETE |
| 8 | Phase tracker | `PHASE-TRACKER.md` | COMPLETE |

### Critical Findings Verification

| Finding | Verified | Line References Match | Current Status |
|---------|----------|----------------------|----------------|
| CRIT-01 | YES | `firestore.rules` L436, L483 | **FIXED** — Phase 1 |
| CRIT-02 | YES | `firestore.rules` L237 | **FIXED** — Phase 1 |
| CRIT-03 | YES | `useStore.ts` L486–499, L835–849 | **FIXED** — Phase 2 (client + rules) |
| CRIT-04 | YES | `AdminDashboard.tsx` L44, `FinanceTab.tsx` L117, `PayClient.tsx` L23, `DuesAndRemindersTab.tsx` L135 | **FIXED** — Phase 1 |
| FIN-01 | YES | `MatchesTab.tsx` L1569, L1620 | **FIXED** — Phase 1 |
| FIN-02 | YES | `FinanceTab.tsx` L1245, L1262 | **FIXED** — Phase 1 |
| FIN-03 | YES | `FinanceTab.tsx` L329–341 | **FIXED** — Phase 7 (server-side webhook creation) |

### Open Decisions

| Decision | Status | Required Before |
|----------|--------|----------------|
| D-01: Abandoned match billing policy | **DECIDED** — Never bill. Revert existing charges. | Phase 1 |
| D-02: Dual-identity consolidation strategy | **DECIDED** — Keep both, designate sources of truth, atomic sync. | Phase 3 |
| D-03: WixFinanceView retirement | **DECIDED** — Retire immediately. Done in Phase 2. | Phase 2 |
| D-04: Admin-tools page disposition | **DECIDED** — Keep, link from nav in Phase 4. | Phase 4 |
| D-05: paymentLinks collection future | **DECIDED** — Lock down rules, keep collection. | Phase 1 |
| D-06: isDesigner role | **DECIDED** — Keep. Not a ghost; actively gates Design tab. | N/A |

---

## Phase 1 — Critical Security & Financial Fixes

### Tasks

| # | Task | File(s) | Complexity | Status |
|---|------|---------|-----------|--------|
| 1.1 | Remove CRIT-01 payment status bypass (L436) | `firestore.rules` | Low | COMPLETE |
| 1.2 | Remove CRIT-01 payment status bypass (L483) | `firestore.rules` | Low | COMPLETE |
| 1.3 | Lock down CRIT-02 paymentLinks updates (L237) | `firestore.rules` | Low | COMPLETE |
| 1.4 | Create `isMatchBillable()` shared helper | `lib/matchBillable.ts` | Low | COMPLETE |
| 1.5 | Apply abandoned match filter in FinanceTab (player view + admin grand totals) | `components/FinanceTab.tsx` | Low | COMPLETE |
| 1.6 | Apply abandoned match filter in PayClient | `app/pay/[playerId]/PayClient.tsx` | Low | COMPLETE |
| 1.7 | Apply abandoned match filter in DuesAndRemindersTab (4 locations) | `components/DuesAndRemindersTab.tsx` | Low | COMPLETE |
| 1.8 | Fix FIN-01 grossValue calculation (guest fee overrides) | `components/MatchesTab.tsx` | Low | COMPLETE |
| 1.9 | Fix FIN-02 grandTotalCollected inflation (club-sponsored) | `components/FinanceTab.tsx` | Low | COMPLETE |
| 1.10 | Write Firestore rules regression tests | `tests/` | Medium | DEFERRED to Phase 10 |

---

## Phase 2 — Data Integrity & Schema Cleanup

### Tasks

| # | Task | File(s) | Complexity | Status |
|---|------|---------|-----------|--------|
| 2.1 | Remove unused class-variance-authority dependency | `package.json` | Low | COMPLETE |
| 2.2 | Remove unused tw-animate-css dependency | `package.json` | Low | COMPLETE |
| 2.3 | Lock paymentLinks to admin-only | `firestore.rules` | Low | COMPLETE (done in Phase 1) |
| 2.4 | Retire WixFinanceView (D-03) | `components/WixFinanceView.tsx`, `components/FinanceTab.tsx`, `components/SettingsTab.tsx`, `lib/types.ts` | Low | COMPLETE |
| 2.5 | CRIT-03: Scope payment collectionGroup queries for non-admins | `hooks/useStore.ts`, `app/page.tsx` | Medium | COMPLETE |
| 2.6 | CRIT-03: Scope otherFees collectionGroup queries for non-admins | `hooks/useStore.ts`, `app/page.tsx` | Medium | COMPLETE |
| 2.7 | CRIT-03: Tighten collection group read rules in Firestore | `firestore.rules` | Low | COMPLETE |

---

## Phase 3 — Identity Consolidation

### Tasks

| # | Task | File(s) | Complexity | Status |
|---|------|---------|-----------|--------|
| 3.1 | Define shared SYNCED_PROFILE_FIELDS constant | `hooks/useStore.ts` | Low | COMPLETE |
| 3.2 | Make updatePlayer → appUsers sync atomic (writeBatch) | `hooks/useStore.ts` | Medium | COMPLETE |
| 3.3 | Complete sync field list (add email, photoURL, jerseyName, waistSize) | `hooks/useStore.ts` | Low | COMPLETE |
| 3.4 | Add reverse sync: updateAppUserProfile → players (atomic) | `hooks/useStore.ts` | Medium | COMPLETE |
| 3.5 | Replace fragile mobile-based matching with authUid lookup | `hooks/useStore.ts` | Low | COMPLETE |

### Notes

- Strategy (D-02): `appUsers` = auth/role source, `players` = gameplay/profile source
- All profile field writes now use `writeBatch` for atomicity
- Reverse sync added so edits from either ProfileTab or admin role toggles propagate consistently
- ProfileTab still does its own dual write for domain logic (duplicate detection, invite status); the redundant sync is idempotent and harmless
- No data migration performed — only future writes are affected

---

## Phase 4 — Component Decomposition

### Tasks

| # | Task | File(s) | Complexity | Status |
|---|------|---------|-----------|--------|
| 4.1 | Link admin-tools from AdminDashboard nav (D-04) | `components/AdminDashboard.tsx` | Low | COMPLETE |
| 4.2 | Extract `useSessionState` to shared hook | `hooks/useSessionState.ts` (new), `components/MatchesTab.tsx` | Low | COMPLETE |
| 4.3 | Extract `MatchCalendarView` (627 lines) | `components/MatchCalendarView.tsx` (new), `components/MatchesTab.tsx` | Medium | COMPLETE |
| 4.4 | Extract `MatchToolbar` (323 lines) | `components/MatchToolbar.tsx` (new), `components/MatchesTab.tsx` | Medium | COMPLETE |
| 4.5 | Extract `MatchSheetView` (463 lines) | `components/MatchSheetView.tsx` (new), `components/MatchesTab.tsx` | Medium | COMPLETE |

### Notes

- MatchesTab.tsx reduced from 5,185 to 3,721 lines (28% reduction)
- `AssignMatchAdmin` (L3499-3721) found to be dead code: defined but never rendered. Left in place per non-negotiable rules.
- All extracted components are self-contained with explicit imports; no circular dependencies
- Zero new TypeScript errors introduced

---

## Phase 5 — Navigation Rationalisation

### Tasks

| # | Task | File(s) | Complexity | Status |
|---|------|---------|-----------|--------|
| 5.1 | Confirm navigation structure (D-07) | `DECISION-LOG.md` | Low | COMPLETE |
| 5.2 | Create MoreDrawer bottom-sheet component | `components/layout/MoreDrawer.tsx` (new) | Medium | COMPLETE |
| 5.3 | Restructure player mobile bottom nav (5 items) | `components/layout/MobileBottomNav.tsx` | Medium | COMPLETE |
| 5.4 | Add slide-up animation for MoreDrawer | `app/globals.css` | Low | COMPLETE |
| 5.5 | Restructure player desktop sidebar (primary + More section) | `app/page.tsx` | Medium | COMPLETE |
| 5.6 | Add player finance tab rendering | `app/page.tsx` | Low | COMPLETE |
| 5.7 | Replace admin desktop sidebar with 7 command hubs | `app/page.tsx` | Medium | COMPLETE |
| 5.8 | Replace admin mobile `<select>` with pill nav | `app/page.tsx` | Medium | COMPLETE |
| 5.9 | Add Design tab to admin content rendering | `app/page.tsx` | Low | COMPLETE |
| 5.10 | Update PHASE-READINESS.md prerequisite | `docs/implementation/PHASE-READINESS.md` | Low | COMPLETE |

### Notes

- Player nav: 5-item bottom nav (Home, My Finance, Pay, Profile, More) with overflow drawer
- Pay button: prominent accent-colored FAB-style on mobile, "Pay Now" link on desktop sidebar
- Pay action navigates to standalone `/pay/{playerId}` route
- My Finance renders FinanceTab with persona="player" (PlayerFinanceView)
- More drawer contains: Matches, Leaderboard, Studio, Shop, Design (all feature-gated)
- Admin nav: 7 command hubs (Dashboard Hub, Match Centre, Finance Command, People & Teams, Design Studio, Club Settings, Studio/Coaching)
- Admin mobile: replaced `<select>` dropdown with pill-button row
- Design tab now accessible to admins who have canDesign permission
- Zero new TypeScript errors introduced (14 pre-existing unchanged)

---

## Phase 6 — UI/UX Redesign

### Tasks

| # | Task | File(s) | Complexity | Status |
|---|------|---------|-----------|--------|
| 6.1 | Switch to light theme with red branding (D-08) | `lib/theme.ts`, `hooks/useTheme.ts` | Medium | COMPLETE |
| 6.2 | Add semantic color token system to globals.css @theme | `app/globals.css` | Medium | COMPLETE |
| 6.3 | Wire ToastProvider and ConfirmProvider into layout | `app/layout.tsx` | Low | COMPLETE |
| 6.4 | Update loading spinner to brand colors | `app/layout.tsx` | Low | COMPLETE |
| 6.5 | Migrate header/nav to semantic tokens | `app/page.tsx`, `components/layout/MobileBottomNav.tsx`, `components/layout/MoreDrawer.tsx` | Medium | COMPLETE |
| 6.6 | Bulk migrate 1,800+ hardcoded colors across 50+ files | All component files | High | COMPLETE |
| 6.7 | Create Toast notification system (ToastProvider + useToast) | `components/ui/Toast.tsx` (new) | Medium | COMPLETE |
| 6.8 | Replace 151 browser alert() with typed toast() | 24 component files | High | COMPLETE |
| 6.9 | Create Confirm dialog system (ConfirmProvider + useConfirm) | `components/ui/ConfirmDialog.tsx` (new) | Medium | COMPLETE |
| 6.10 | Replace 29 browser confirm() with styled confirmAction() | 16 component files | High | COMPLETE |

### Notes

- Theme decision (D-08): #A30F2D brand, #D51F43 action, #F6F7F9 bg, #FFFFFF cards, #171C26 text
- Semantic tokens: text-primary, text-secondary, text-muted, surface, surface-hover, border, text-accent
- CSS custom properties bridge via `@theme` block for Tailwind v4 compatibility
- Toast types: success (emerald), error (red), warning (amber), info (blue); auto-dismiss 4s
- ConfirmDialog: destructive variant with red styling and AlertTriangle icon
- All alert() replacements include content-based type detection (error/success/warning)
- All confirm() replacements include async handler fixes and destructive flag detection
- Modal overlays (bg-black/40+) intentionally left as-is for proper backdrop effect
- Zero new TypeScript errors introduced (14 pre-existing unchanged)

---

## Phase 7 — Financial Logic Overhaul

### Audit Findings

| Finding | Severity | Description | Status |
|---------|----------|-------------|--------|
| FIN-03 | HIGH | Late fees created in browser callback — lost if user navigates away after Razorpay payment | **FIXED** |
| FIN-04 | MEDIUM | Webhook silently swallows errors in 3 catch blocks (`catch(e) {}`) | **FIXED** |
| FIN-05 | MEDIUM | Late fee feeIds in intent are synthetic (not real doc IDs) — webhook can't find them | **FIXED** (by FIN-03 fix) |
| FIN-08 | LOW | No duplicate guard when admin creates late fee docs repeatedly | **FIXED** |
| FIN-06 | LOW | Subscription webhook queries player by `where("id", "==", ...)` — fragile | DOCUMENTED |
| FIN-07 | LOW | Optimistic UI state not reverted on Firestore write failure | DOCUMENTED |

### Tasks

| # | Task | File(s) | Complexity | Status |
|---|------|---------|-----------|--------|
| 7.1 | Move late fee creation to server-side webhook (FIN-03) | `app/api/razorpay/webhook/route.ts` | Medium | COMPLETE |
| 7.2 | Add error logging to webhook catch blocks (FIN-04) | `app/api/razorpay/webhook/route.ts` | Low | COMPLETE |
| 7.3 | Send late fee metadata in FinanceTab order intent | `components/FinanceTab.tsx` | Low | COMPLETE |
| 7.4 | Remove client-side late fee creation from FinanceTab handler | `components/FinanceTab.tsx` | Low | COMPLETE |
| 7.5 | Send late fee metadata in MatchesTab order intent | `components/MatchesTab.tsx` | Low | COMPLETE |
| 7.6 | Remove client-side late fee creation from MatchesTab handler | `components/MatchesTab.tsx` | Low | COMPLETE |
| 7.7 | Add duplicate guard for admin late fee creation in MatchesTab | `components/MatchesTab.tsx` | Low | COMPLETE |
| 7.8 | Add duplicate guard for admin late fee creation in DuesAndRemindersTab | `components/DuesAndRemindersTab.tsx` | Low | COMPLETE |
| 7.9 | Add duplicate guard for admin late fee creation in AssignFeesAdmin | `components/AssignFeesAdmin.tsx` | Low | COMPLETE |

### Notes

- FIN-03 was the highest-severity open finding from Phase 0 audit. Root cause: `computeLateFees()` runs client-side, fee docs created in Razorpay success callback which can be interrupted by navigation/crash/network failure.
- Fix strategy: client now sends late fee metadata (label, amount, templateId) in the Razorpay order intent data. The webhook creates and immediately marks the fee docs as "Paid" server-side — no client-side doc creation needed for Razorpay payments.
- Admin manual-payment flows (MatchesTab status dropdown, DuesAndRemindersTab mark-paid, AssignFeesAdmin mark-paid) still create late fee docs client-side, but now with a duplicate guard checking `templateId`.
- Webhook error logging now captures item-level context for debugging payment reconciliation failures.
- Zero new TypeScript errors introduced (build passes clean)

---

## Phase 8 — Workflow Simplification

### Audit Findings

| Finding | Severity | Description | Status |
|---------|----------|-------------|--------|
| WF-01 | HIGH | Auto-reactivation silently bypasses admin disable — disabled players re-enabled on every login | **FIXED** |
| WF-02 | MEDIUM | `AccountDisabledScreen` fully implemented but never imported or rendered — dead code | **FIXED** (wired up) |
| WF-03 | MEDIUM | `handleSyncAccount` swallows Firestore errors silently — no user feedback on failure | **FIXED** |
| WF-04 | MEDIUM | 50+ hardcoded dark-theme colors in modals and select dropdowns (Phase 6 spillover) | **FIXED** |

### Tasks

| # | Task | File(s) | Complexity | Status |
|---|------|---------|-----------|--------|
| 8.1 | Wire AccountDisabledScreen into page.tsx disabled-player guard | `app/page.tsx`, `components/onboarding/AccountDisabledScreen.tsx` | Medium | COMPLETE |
| 8.2 | Add toast error feedback to handleSyncAccount catch block | `app/page.tsx` | Low | COMPLETE |
| 8.3 | Fix bg-[#1a1a2e] modal backgrounds → bg-surface (5 instances) | `AdminDashboard.tsx`, `DuesAndRemindersTab.tsx`, `BadgesTab.tsx` | Low | COMPLETE |
| 8.4 | Fix [&>option]:bg-neutral-950/900 → [&>option]:bg-surface (29 instances) | 8 component files | Low | COMPLETE |
| 8.5 | Fix bg-neutral-950 form backgrounds → bg-surface-hover | `RegistrationForm.tsx`, `ProfileTab.tsx` | Low | COMPLETE |
| 8.6 | Fix bg-neutral-900 backgrounds → bg-surface in CRM dropdowns | `StudioCRMView.tsx` | Low | COMPLETE |
| 8.7 | Fix bg-black/60 select backgrounds → bg-surface-hover | `ShopTab.tsx` | Low | COMPLETE |
| 8.8 | Fix border-white/15 → border-border in CRM dropdown | `StudioCRMView.tsx` | Low | COMPLETE |
| 8.9 | Fix bg-black in AccountDisabledScreen → bg-background | `AccountDisabledScreen.tsx` | Low | COMPLETE |

### Notes

- WF-01 was a critical workflow bug: admin trash/disable action was silently reversed on every player login. The fix renders the existing `AccountDisabledScreen` (with 3-day cooldown and server-time anti-tamper check) instead of auto-reactivating.
- Phase 6 spillover: ~50 hardcoded dark-theme colors in select `<option>` elements, modal backgrounds, and form controls were missed during the bulk color migration. These rendered as dark backgrounds on the light theme. All replaced with semantic tokens (`bg-surface`, `bg-surface-hover`).
- Zero new TypeScript errors introduced (build passes clean)

---

## Phase 9 — Studio & Shop Enhancement

### Audit Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| SS-01 | **HIGH** | Subscription dual-write race: both client handler and webhook compute/write `studioExpiryDate`, causing potential 2x duration extension and duplicate `subscriptionHistory` entries | `StudioTab.tsx` handler + `webhook/route.ts` |
| SS-02 | **MEDIUM** | Webhook wrote ISO 8601 dates (`toISOString()`) but all client-side parsers expect `YYYY-MM-DD` format — caused `NaN` dates when webhook value was read by StudioTab | `webhook/route.ts:172` |
| SS-03 | **MEDIUM** | Webhook `subscriptionHistory` schema diverged from client schema (`userId`/`amount`/`startDate` vs `playerId`/`adminId`/`paidAmount`) — made history view show incomplete entries | `webhook/route.ts:174-182` |
| SS-04 | **MEDIUM** | `getMembershipStatus` in StudioAdminTab used dark-palette `bg-red-900/40`, `bg-red-950/20` colors that rendered as dark muddy tints on light theme | `StudioAdminTab.tsx:327-370` |
| SS-05 | **LOW** | Same dark-palette status colors in PlayersTab `getMembershipStatus` (`bg-red-950/10`, `bg-amber-950/10`, `bg-emerald-950/10`) | `PlayersTab.tsx:114-158` |
| SS-06 | **LOW** | Inactive plan border used `border-red-900/30` (dark) | `PlansView.tsx:192` |
| SS-07 | **LOW** | `<optgroup>` background used `bg-emerald-900` (dark) | `AssignFeesAdmin.tsx:276` |
| SS-08 | **MEDIUM** | ShopTab dead code: `defaultJerseyName/Number/ChestSize` computed but never read; shadowed `hasJerseyDetails` + dead `orderPayload` in Razorpay branch | `ShopTab.tsx:158-160, 385-401` |
| SS-09 | **MEDIUM** | ShopTab typo `bg-surface-hover0` (undefined class) on WhatsApp report textarea | `ShopTab.tsx:2275` |
| SS-10 | **MEDIUM** | ShopTab 5 no-op hover effects: `bg-surface-hover hover:bg-surface-hover` (identical) | `ShopTab.tsx` (5 locations) |
| SS-11 | **MEDIUM** | ShopTab dark-theme gradient banners (`from-emerald-950/80`, `from-emerald-950`) unreadable on light bg | `ShopTab.tsx` (4 gradient locations) |
| SS-12 | **MEDIUM** | ShopTab 15+ dark-theme status badges (`*-950/*` alpha, `text-*-300/400`) invisible or unreadable on light bg | `ShopTab.tsx` (bulk) |
| SS-13 | **HIGH** | `bg-card` token undefined (no `--color-card` in theme system) — 13 elements had no background at all | `StudioCRMView.tsx` (12), `PlayersTab.tsx` (1) |
| SS-14 | **MEDIUM** | StudioCRMView `bg-gray-800` dropdown, all `text-*-300/400` colors unreadable on light background | `StudioCRMView.tsx` (30+ instances) |
| SS-15 | **LOW** | StudioCRMView `text-black` on accent buttons should use semantic `text-text-accent` | `StudioCRMView.tsx:1036, 1490` |

### Documented (Not Fixed — Requires Product Decision)

| ID | Finding | Reason |
|----|---------|--------|
| SS-D1 | ShopTab `finalizeOrderPlacement` and `handleAddManualOrder` duplicate ~80 lines of order logic (MOQ calc, payload construction, sister order updates, email sending) | Refactoring into a shared helper is beneficial but is a structural change that should be tested with real orders |
| SS-D2 | ShopTab `text-white` on colored buttons (`bg-emerald-600 text-white`, `bg-blue-600 text-white`) | White text on saturated colored buttons is correct for both light and dark themes — no change needed |
| SS-D3 | `bg-black/80` modal overlays used across all modules | Standard scrim pattern, works on both light and dark themes — no change needed |

### Tasks

| Task | Description | Files Changed | Priority | Status |
|------|-------------|--------------|----------|--------|
| 9.1 | Fix subscription dual-write: remove expiry date and subscription history writes from client handler (webhook is single source of truth) | `StudioTab.tsx` | High | COMPLETE |
| 9.2 | Fix webhook subscription date format: ISO → YYYY-MM-DD, align history schema with client schema | `webhook/route.ts` | Medium | COMPLETE |
| 9.3 | Fix webhook to also write `studioEndDate` (client code reads both `studioExpiryDate` and `studioEndDate`) | `webhook/route.ts` | Medium | COMPLETE |
| 9.4 | Fix dark-palette membership status colors in StudioAdminTab | `StudioAdminTab.tsx` | Medium | COMPLETE |
| 9.5 | Fix dark-palette membership status colors in PlayersTab | `PlayersTab.tsx` | Low | COMPLETE |
| 9.6 | Fix dark-palette inactive plan border | `PlansView.tsx` | Low | COMPLETE |
| 9.7 | Fix dark-palette optgroup background | `AssignFeesAdmin.tsx` | Low | COMPLETE |
| 9.8 | Remove dead code: unused vars + shadowed hasJerseyDetails + dead orderPayload | `ShopTab.tsx` | Medium | COMPLETE |
| 9.9 | Fix typo `bg-surface-hover0` → `bg-surface-hover` | `ShopTab.tsx` | Medium | COMPLETE |
| 9.10 | Fix 5 no-op hover effects → `hover:bg-border` | `ShopTab.tsx` | Low | COMPLETE |
| 9.11 | Fix dark-theme gradients → `from-accent/10 to-surface-hover` | `ShopTab.tsx` | Medium | COMPLETE |
| 9.12 | Fix 15+ dark-theme status badges (`*-950/*` → `*-500/*`, text `*-300/400` → `*-600`) | `ShopTab.tsx` | Medium | COMPLETE |
| 9.13 | Fix undefined `bg-card` → `bg-surface` (13 instances) | `StudioCRMView.tsx`, `PlayersTab.tsx` | High | COMPLETE |
| 9.14 | Fix dark-theme colors in StudioCRMView: `bg-gray-800`, all `text-*-300/400` → `text-*-600`, `bg-*-500/20` → `bg-*-500/10` | `StudioCRMView.tsx` | Medium | COMPLETE |
| 9.15 | Fix `text-black` → `text-text-accent` on accent buttons | `StudioCRMView.tsx` | Low | COMPLETE |

### Notes

- SS-01 was the highest-impact finding: the Razorpay client `handler` callback and the server webhook BOTH computed and wrote `studioExpiryDate`. If the webhook fired after the client (common timing), it read the already-extended date and extended again — doubling the subscription duration. Fix: client handler now only writes membership status fields (`isStudioMember`, `studioPlan`, `studioStartDate`, `lastPaidDate`, `lastPaidAmount`); expiry calculation and subscription history are handled exclusively by the webhook.
- This follows the pattern established in Phase 7/8 for match late fees (FinanceTab line 340: "Late fees are created and marked Paid server-side by the webhook").
- Zero new TypeScript errors introduced (build passes clean)
- Second pass (SS-08 through SS-15) completed comprehensive light-theme audit of ShopTab (2,581 lines) and StudioCRMView (1,607 lines), fixing dead code, undefined tokens, dark-theme gradients/badges/text colors, and semantic token compliance across all Studio & Shop components

---

## Phase 10 — Testing & Quality Infrastructure

### Task Breakdown

| Task | Description | Files | Status |
|------|-------------|-------|--------|
| 10.1 | Baseline test run — existing accounting tests | `tests/accounting-functional.test.mjs` | COMPLETE (12/12 pass) |
| 10.2 | TypeScript strict-mode audit | `npx tsc --noEmit` | COMPLETE (15 pre-existing errors, 0 introduced) |
| 10.3 | Utility function test suite | `tests/utils-functional.test.mjs` | COMPLETE (52 tests, 11 suites) |
| 10.4 | E2E test infrastructure audit | `e2e/`, `playwright.config.ts` | COMPLETE (documented) |
| 10.5 | Coverage gap analysis | — | COMPLETE (documented below) |

### Test Suite Summary

**Functional tests (node:test)**: 64 total tests, 18 suites, 0 failures
- `tests/accounting-functional.test.mjs` — 12 tests across 5 suites (match fee accounting)
- `tests/utils-functional.test.mjs` — 52 tests across 11 suites (utility functions)

**New test coverage added (Phase 10)**:
1. **normalizeIndianMobile** — 9 tests: plain 10-digit, +91 prefix, 91 prefix, 091 prefix, leading 0, spaces/dashes, short input, null/undefined, overflow digits
2. **normalizeEmail** — 2 tests: case normalization, null handling
3. **formatDate** — 7 tests: YYYY-MM-DD, DD/MM/YYYY, Firestore timestamp, Date object, null/fallback, garbage input, toDate() mock
4. **dbToInputDate** — 4 tests: YYYY-MM-DD conversion, Firestore timestamp, null, Date object
5. **inputToDbDate** — 4 tests: DD/MM/YYYY conversion, padding, passthrough, null
6. **computeLateFees** — 7 tests: weekday rejection, empty date, Saturday base fee, Sunday base fee, weekly increments, Saturday→Tuesday deadline, Sunday→Tuesday deadline
7. **findExistingPlayer** — 7 tests: mobile match, email case-insensitive match, disabled skip, merged skip, excludeId, no match, mobile-before-email priority
8. **validateJerseyNumber** — 5 tests: valid numbers, reserved 10, non-numeric, >3 digits, empty
9. **parseExpiryDate** — 3 tests: YYYY-MM-DD, DD/MM/YYYY, ISO 8601 NaN proof (validates Phase 9 fix)
10. **toYMD webhook helper** — 2 tests: zero-padded formatting, roundtrip with parseExpiryDate
11. **Date conversion roundtrip** — 2 tests: inputToDbDate↔dbToInputDate, formatDate chain

### TypeScript Error Inventory (15 pre-existing)

| # | File | Error | Type |
|---|------|-------|------|
| 1 | `app/page.tsx` | `isFeatureEnabled` type mismatch (string vs union) | TS2769 (x2) |
| 2 | `components/AdminDashboard.tsx` | `OtherFee.label` property missing | TS2339 |
| 3 | `components/AdminDashboard.tsx` | `Match.title` property missing | TS2339 |
| 4 | `components/AssignFeesAdmin.tsx` | `Match.title` property missing | TS2339 |
| 5 | `components/ClubTab.tsx` | `persona` string vs "admin" \| "player" literal | TS2769 (x3) |
| 6 | `components/FinanceTab.tsx` | `Match.title` property missing | TS2339 |
| 7 | `components/FinanceTab.tsx` | `paymentMethod` not in `Partial<MerchOrder>` | TS2353 |
| 8 | `components/MatchesTab.tsx` | `Match.title` property missing (x2) | TS2339 |
| 9 | `components/RazorReportView.tsx` | `razorpayPaymentId` not in `MatchPayment` | TS2339 |
| 10 | `components/RazorReportView.tsx` | "cash" comparison with no overlap | TS2367 |
| 11 | `components/ShopTab.tsx` | `orderPayload` not found in scope | TS2304 |

**Note**: Error #11 (`ShopTab.tsx:390 orderPayload`) is a pre-existing scope bug in `handleRazorpayCheckout` — `orderPayload` is defined later in `finalizeOrderPlacement` (line 468) but referenced in the intent payload at line 390. This is the same duplicated-order-logic issue documented as SS-D1 in Phase 9.

### E2E Test Infrastructure

**Playwright config**: Mobile-first (Pixel 5 emulation) + Desktop Chrome, base URL `localhost:3000`, auto dev server, `data-testid` selectors.

**15 spec files**: login, registration, app-loading, navigation, finance, match-fees, studio-admin, club-tab, settings-features, admin-dashboard, home-match-nav, mobile-ux, match-fee-accounting, grounds, plus auth helpers.

**Limitations**: E2E tests require `ADMIN_EMAIL`/`ADMIN_PASSWORD` environment variables and a running Firebase backend — not executable in this audit environment without credentials. Spec files audited for structural correctness; no regressions detected from Phase 6-9 changes (tests use `data-testid` attributes which remain stable).

### Coverage Gap Analysis

| Gap | Priority | Notes |
|-----|----------|-------|
| Subscription payment webhook end-to-end | High | Requires Firebase emulator setup; webhook logic covered by toYMD/parseExpiryDate unit tests |
| AccountDisabledScreen 3-day cooldown logic | Medium | Anti-tamper server-time check depends on Firestore `_ping` document |
| Razorpay order creation intent flow | Medium | ShopTab `orderPayload` scope bug (SS-D1) blocks correct testing |
| Firestore security rules regression tests | Medium | Deferred from Phase 1 (task 1.10); requires Firebase emulator |
| `alert()` → toast migration verification | Low | 107 `alert()` calls documented in prior review; systematic migration deferred |

---

## Phase 11 — Performance & Optimization

### Task Breakdown

| Task | Description | Status |
|------|-------------|--------|
| 11.1 | Bundle & code-splitting audit | COMPLETE |
| 11.2 | Firestore listener lifecycle audit | COMPLETE |
| 11.3 | Memoization & re-render analysis | COMPLETE |
| 11.4 | Image optimization audit | COMPLETE |
| 11.5 | Console output audit | COMPLETE |
| 11.6 | Next.js config audit | COMPLETE |

### Findings

**11.1 — Bundle & Code Splitting** (GOOD)
- All 15 tab components use `next/dynamic` with `{ ssr: false }` — proper code splitting already in place
- Only `HomeTab`, `ProfileTab`, and `LoadingScreen` are statically imported (correctly — they're needed on first paint)
- `output: "standalone"` configured for production deployment

**11.2 — Firestore Listener Lifecycle** (GOOD)
- 20 `onSnapshot` real-time listeners in `useStore.ts`
- 12 core listeners established on auth; all cleaned up in `useEffect` return
- 8+ lazy subscriptions tracked via `lazySubsRef` (Map of unsub functions)
- Lazy pattern: `ensurePayments()`, `ensurePosts()`, `ensurePlayerStats()`, etc. — only subscribed when tab that needs them activates
- All lazy subs torn down on user change via `lazySubsRef.current.forEach(unsub => unsub())`

**11.3 — Memoization & Re-render Patterns** (ACCEPTABLE)
- 31 `useCallback`/`useMemo` instances in `useStore.ts` for expensive computations
- `useStore` returns a new object literal per render (~110 properties) — this is the expected pattern for this single-page architecture. Converting to a proper state management library (Zustand, Jotai) would be a major architectural change outside audit scope
- 0 `React.memo` wrappers on components — not needed since `dynamic()` imports mean inactive tabs aren't in the tree
- **Recommendation (future)**: Extract read-heavy selectors via `useMemo` in consuming components to avoid unnecessary child re-renders when unrelated store slices change

**11.4 — Image Optimization** (GOOD)
- Only 1 raw `<img>` tag found (in `BadgeIcon.tsx` for dynamic badge SVGs)
- `next/image` is imported in `app/page.tsx` (via `Image from "next/image"`)
- `next.config.ts` has proper `remotePatterns` for `picsum.photos` and `*.googleusercontent.com`

**11.5 — Console Output** (ACCEPTABLE)
- 86 console calls across 38 files
- Only 4 are `console.log` (2 in e2e test, 2 in WhatsApp API route)
- Remaining 82 are `console.error`/`console.warn` — appropriate for error reporting
- **Recommendation (future)**: Replace `console.error`/`console.warn` with structured logging for production observability

**11.6 — Next.js Config** (GOOD)
- `reactStrictMode: true` — correct
- `eslint.ignoreDuringBuilds: true` and `typescript.ignoreBuildErrors: true` — needed due to pre-existing TS errors; should be revisited when those are resolved
- `serverExternalPackages` correctly lists Firebase packages
- HMR disable option via `DISABLE_HMR` env var for AI Studio agent editing

### Pre-existing Architecture Notes (NOT actionable within audit constraints)

| Item | Description | Impact | Recommendation |
|------|-------------|--------|----------------|
| P-01 | `useStore.ts` is 2,778 lines — single monolithic hook | Re-renders all consumers when any state slice changes | Extract domain-specific stores (match, finance, studio) with Zustand or context splitting |
| P-02 | `MatchesTab.tsx` is 3,733 lines — largest component | Long initial parse, complex state | Decompose into sub-components (match list, match detail, match form) |
| P-03 | 107 `alert()` calls (from prior review) | Blocks UI thread, no branding | Migrate to toast system (Toast provider already exists) |
| P-04 | `ignoreBuildErrors: true` in next.config | Masks real type errors at build | Fix 15 pre-existing TS errors, then disable |
| P-05 | `ShopTab.tsx` `orderPayload` scope bug (SS-D1) | Razorpay merch intent missing order details | Refactor `handleRazorpayCheckout` to build payload before API call |

---

## Non-Negotiable Constraints (Carry Forward)

1. Firebase Authentication — PRESERVE (do not introduce Cognito or alternative auth)
2. Razorpay — PRESERVE (do not change payment gateway)
3. Claude Code — SOLE implementation agent
4. Antigravity — Read-only QA verification only
5. No data migrations without explicit approval
6. No deployments without explicit approval
