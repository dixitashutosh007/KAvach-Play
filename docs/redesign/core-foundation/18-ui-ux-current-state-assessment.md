# KAvach Play — Core Foundation
## Document 18: UI/UX Current-State Assessment on `mig-mov`

**Document Type:** UI/UX Architecture & Component State Assessment  
**Repository Baseline:** `https://github.com/dixitashutosh007/KAvach-Play`  
**Target Branch:** `mig-mov`  
**HEAD Commit:** `6539a212384ec98271119122edb6a82cc463f347`  
**Date:** November 2026  
**Status:** Read-Only Assessment Baseline

---

## 1. Executive Summary

This assessment audits the current UI/UX architecture of KAvach Play directly on `mig-mov` following the integration of the Security Remediation 1F-R commits. The objective is to establish the minimum UI/UX foundation required to begin the approved redesign, cataloging existing components into **Reuse**, **Adapt**, **Redesign**, or **Replace**, and assessing the specific visual and ergonomic impacts of recent backend merges.

---

## 2. Baseline & Remediation Merge Impact Analysis

### 2.1 Commit Lineage & Baseline Verification
- **Checked-out Branch:** `mig-mov`
- **HEAD Commit:** `6539a21` (Merge commit incorporating `security/remediation-1f-a`)
- **Parent 1:** `238a506` (`docs: record implementation commit SHA and CI run for Security Remediation 1E`)
- **Parent 2:** `4cac1e9` (`wip(security): monotonic orphan recovery fencing, shared lock invariant helper and race test updates (paused for UI/UX)`)
- **Working Tree:** Clean (all application code intact; only untracked `docs/redesign/` present).

### 2.2 Direct Impacts of the Remediation Merge on UI/UX
The 16 merged commits from `security/remediation-1f-a` touched backend server routes (`app/api/admin/merge-players/route.ts`), security rules (`firestore.rules`), core libraries (`lib/player-merge.ts`, `lib/razorpay-webhook.ts`, `lib/account-linking.ts`), and test suites.

| UI/UX Dimension | Merged Changes | Verified UI/UX Impact on `mig-mov` |
|---|---|---|
| **Login & Role Entry** | Auth claims strictly verified via `checkRevoked: true` in `lib/server-auth.ts`. | **Zero UI regressions.** Login views (`LoginScreen.tsx`, `PhoneLoginForm.tsx`) operate identically. Role resolution is more robust against stale sessions. |
| **Player / Admin Screen Access** | Protected `/mergeJobs/{jobId}` in `firestore.rules`. Excluded merging players (`p.mergeStatus === 'in_progress'`) in `hooks/useStore.ts:1346`. | **Positive UX Impact:** Merging or disabled players are cleanly excluded from fee assignments and squad selections, preventing UI error dialogs. |
| **Shared Layouts & Navigation** | No changes to layout files (`app/page.tsx`, `MobileBottomNav.tsx`, `MoreDrawer.tsx`). | **Unchanged:** Layout components remain identical to previous baseline; known 360px header collision remains present. |
| **Existing Components & Styles** | No changes to `components/*` or `globals.css`. | **Unchanged:** All 50+ React components retain existing styling, including legacy `#A30F2D` brand colors and green loading screen. |
| **Data-Loading States** | `hooks/useStore.ts` added player-level merge guards. | **Minimal:** Zero impact on snapshot loading times; eager listeners on matches and players remain active. |
| **User-Facing Error Handling** | Stricter HTTP 409 responses from `/api/admin/merge-players` and `/api/razorpay/order`. | **Action Required:** UI error dialogs must gracefully parse structured 409 Conflict payloads from merge and payment endpoints. |
| **Payment & Finance Dependencies** | Server-side valuation in `/api/razorpay/order`; strict currency checks; webhook idempotency. | **Positive UX Impact:** Online checkout is more reliable; client-side payment flow does not break. |
| **Mobile Responsiveness** | No CSS or layout modifications. | **Unchanged:** Sub-44px touch targets on match attendance and RSVP toggles remain unaddressed. |

---

## 3. UI/UX Architecture & Screen Inventory

The application operates as a single-page orchestrator in [`app/page.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/page.tsx), rendering dynamic views based on local state `activeTab` and persona state `persona` (`player` | `admin`).

```
app/page.tsx (Single-Page Shell)
├── Top Header (<header className="fixed top-0 ...">) [L673-760]
├── Main Content Grid
│   ├── Left Desktop Sidebar (Desktop only) [L765-865]
│   └── Tab View Content Container [L1110-1325]
│       ├── Player Persona Views (Home, Matches, Finance, Leaderboard, Club, etc.)
│       └── Admin Console Hubs (Overview, Match Centre, Roster, Finance, Studio, Ops, Settings)
└── Mobile Bottom Navigation (<MobileBottomNav />) [L1330-1345]
    └── Slide-Up Drawer (<MoreDrawer />)
```

### 3.1 Component Classification Matrix

Every relevant component on `mig-mov` is classified for the upcoming redesign:
- **Reuse:** Production-proven component that requires zero or minimal styling updates.
- **Adapt:** Sound underlying component that requires design-token alignment, touch-target enlargement, or layout polish.
- **Redesign:** Component requiring substantial architectural, responsive, or UX re-work.
- **Replace:** Legacy or fragmented component to be decommissioned in favor of a clean, unified modern component.

| Component Name | Source File Path | Current Role / Responsibility | Classification | Rationale & Remediation Scope |
|---|---|---|---|---|
| **`TopHeader`** (inline) | [`app/page.tsx:673-760`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/page.tsx#L673-L760) | Top navigation bar with logo, club name, admin switch, notifications, avatar. | **Redesign** | Collides horizontally at < 390px. Must be refactored into a responsive 56px/64px bar using Deep Wine (`#7A1E2B`). |
| **`MobileBottomNav`** | [`components/layout/MobileBottomNav.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/layout/MobileBottomNav.tsx) | Fixed bottom bar rendering 5 tabs on mobile. | **Adapt** | Update Player taxonomy to `Home | Matches | Finance | Players | More`. Implement dedicated Admin bottom nav in Phase 3. |
| **`MoreDrawer`** | [`components/layout/MoreDrawer.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/layout/MoreDrawer.tsx) | Mobile slide-up overflow menu. | **Adapt** | Organize items into clear categories (Studio, Shop, Polls, Documents). Synchronize with browser back button (`popstate`). |
| **`HomeTab`** | [`components/HomeTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/HomeTab.tsx) | Player dashboard, next match hero, feed, mini dues. | **Redesign** | **Primary Phase 2 Target:** Rebuild hero card, announcement feed, and dues card with approved tokens (`#7A1E2B`, `#C0394B`). |
| **`MatchesTab`** | [`components/MatchesTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/MatchesTab.tsx) | Match fixtures, RSVP availability, scorecards. | **Redesign** | Enforce 44px touch targets on RSVP pills; separate into unified 4-section Match Workspace in later phase. |
| **`DuesAndRemindersTab`**| [`components/DuesAndRemindersTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/DuesAndRemindersTab.tsx) | Player payments & dues ledger. | **Redesign** | Isolate to personal dues only; replace inline virtual late-fee calculation with `calculatePlayerDues`. |
| **`ProfileTab`** | [`components/ProfileTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/ProfileTab.tsx) | Personal player profile. | **Redesign** | Expand into central Personal Information Hub (overview, stats, memberships, complete payment/charge history). |
| **`LeaderboardTab`** | [`components/LeaderboardTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/LeaderboardTab.tsx) | Cricket statistics, batting/bowling rankings. | **Adapt** | Implement sticky first-column freezing on mobile tables; tabular monospace figures. |
| **`PlayersTab`** | [`components/PlayersTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/PlayersTab.tsx) | Club player directory. | **Adapt** | Transform into public player directory under new `Players` nav tab. |
| **`StudioTab`** | [`components/StudioTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/StudioTab.tsx) | Net practice pass balance & booking. | **Adapt** | Accessible via `More`; update plan cards and pass counter to approved tokens. |
| **`ShopTab`** | [`components/ShopTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/ShopTab.tsx) | Merchandise store. | **Adapt** | Accessible via `More`; style product cards and order history with Soft Blush (`#F8EDEE`). |
| **`OpinionTab`** | [`components/OpinionTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/OpinionTab.tsx) | Member voting polls. | **Adapt** | Clean card layout, explicit visual indicator of voted state. |
| **`AdminDashboard`** | [`components/AdminDashboard.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/AdminDashboard.tsx) | Admin Overview hub. | **Adapt** | Modernize metric cards; defer deep layout rewrite to Phase 3/4. |
| **`FinanceTab`** | [`components/FinanceTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/FinanceTab.tsx) | Club treasury management. | **Redesign** | Defer to Phase 3/4; will form the unified 4-section Finance Center. |
| **`StudioAdminTab`** | [`components/StudioAdminTab.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/StudioAdminTab.tsx) | Studio net ops & QR check-in. | **Adapt** | Improve mobile camera scanner error handling; defer to Phase 3. |
| **`LoadingScreen`** | [`components/LoadingScreen.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/LoadingScreen.tsx) | Full-screen initial load state. | **Replace** | Eliminate dark-green gradient (`#064e3b`); replace with Warm White (`#FFF6F4`) canvas and Charcoal/Scarlet brand spinner. |
| **`ConfirmDialog`** | [`components/ui/ConfirmDialog.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/ui/ConfirmDialog.tsx) | Global confirmation modal. | **Reuse** | Update styling to approved tokens; core logic is solid. |
| **`Toast` Provider** | [`components/ui/Toast.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/ui/Toast.tsx) | Floating toast notifications. | **Reuse** | Reliable toast queue; update borders and colors to approved tokens. |
| **`BadgeIcon`** | [`components/BadgeIcon.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/BadgeIcon.tsx) | Milestone badge icons. | **Reuse** | High-quality SVG icons; ready for immediate reuse. |
| **`ClientOnly`** | [`components/ClientOnly.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/ClientOnly.tsx) | Hydration boundary guard. | **Reuse** | Essential utility preventing React 19 hydration mismatch warnings. |
| **`PhoneLoginForm`** | [`components/PhoneLoginForm.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/PhoneLoginForm.tsx) | Mobile OTP authentication. | **Reuse** | Battle-tested phone auth flow; update styling to Deep Wine. |

---

## 4. Design Tokens & Styling Status

### 4.1 Current Styling Baseline in `globals.css`
The application currently imports Tailwind CSS via `@tailwindcss/postcss` and specifies ad-hoc custom classes.
- Brand colors in current code frequently reference `#A30F2D`, `#D51F43`, and generic Tailwind grays (`gray-100` to `gray-900`).
- Several components retain dark-green surfaces (`#064e3b`, `#022c22`).

### 4.2 Approved Design System Alignment
The Core Foundation must formalize the approved design tokens in Tailwind and CSS variables:
- **`--brand-wine`:** `#7A1E2B` (Deep Wine)
- **`--brand-scarlet`:** `#C0394B` (Scarlet)
- **`--brand-dusty`:** `#E76B73` (Dusty Red)
- **`--brand-gold`:** `#D6A84F` (Muted Gold)
- **`--canvas-warm`:** `#FFF6F4` (Warm White)
- **`--surface-blush`:** `#F8EDEE` (Soft Blush)
- **`--surface-card`:** `#FFFFFF` (White)
- **`--text-charcoal`:** `#29252A` (Charcoal)

---

## 5. Responsive & Ergonomic Analysis

1. **Mobile Viewports (< 390px):**
   - **Header Collision:** Fixed header flex container forces logo, club title, persona toggle, notification bell, and avatar into a single horizontal row, causing severe truncation on narrow screens (Galaxy S21, iPhone SE).
   - **Touch Targets:** RSVP buttons (`MatchesTab.tsx:1420-1460`) measure 32px height; attendance toggles (`MatchesTab.tsx:2880-2910`) measure 30px height, violating WCAG 2.5.5 minimum 44×44px standards.
2. **Desktop Viewports (>= 1024px):**
   - The current desktop experience renders a static 260px left sidebar alongside a wide content canvas.
   - Tables in `FinanceTab` and `LeaderboardTab` stretch across wide viewports without container max-widths, causing eye strain and dispersed actions.
   - Dedicated desktop command center implementation is properly scheduled for **Phase 4**.
