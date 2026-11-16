# KAVACH PLAY — Implementation Phase Tracker

**Created**: 2026-11-15
**Git SHA at Phase 0**: `f5739726e75a2e6594c7379bdbfc8a866c63f787`

---

## Phase Status Overview

| Phase | Name | Status | Start Date | End Date |
|-------|------|--------|------------|----------|
| 0 | Discovery & Verification | **COMPLETE** | 2026-11-15 | 2026-11-15 |
| 1 | Critical Security & Financial Fixes | **COMPLETE** | 2026-11-15 | 2026-11-15 |
| 2 | Data Integrity & Schema Cleanup | **COMPLETE** | 2026-11-15 | 2026-11-15 |
| 3 | Identity Consolidation | **COMPLETE** | 2026-11-16 | 2026-11-16 |
| 4 | Component Decomposition | **COMPLETE** | 2026-11-16 | 2026-11-16 |
| 5 | Navigation Rationalisation | **COMPLETE** | 2026-11-16 | 2026-11-16 |
| 6 | UI/UX Redesign | **COMPLETE** | 2026-11-16 | 2026-11-16 |
| 7 | Financial Logic Overhaul | **COMPLETE** | 2026-11-16 | 2026-11-16 |
| 8 | Workflow Simplification | **COMPLETE** | 2026-11-16 | 2026-11-16 |
| 9 | Studio & Shop Enhancement | NOT STARTED | — | — |
| 10 | Testing & Quality Infrastructure | NOT STARTED | — | — |
| 11 | Performance & Optimization | NOT STARTED | — | — |

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

## Phases 9–11

Task breakdowns will be added as each phase is approved.

---

## Non-Negotiable Constraints (Carry Forward)

1. Firebase Authentication — PRESERVE (do not introduce Cognito or alternative auth)
2. Razorpay — PRESERVE (do not change payment gateway)
3. Claude Code — SOLE implementation agent
4. Antigravity — Read-only QA verification only
5. No data migrations without explicit approval
6. No deployments without explicit approval
