# KAvach Play — Phase 4 Stage 6 Specification
## Shared Design System & Responsive Component Catalog

**Document Type:** Design System Specification & Reusable Component Catalog  
**Phase:** Phase 4 — High-Fidelity Design & Prototypes  
**Stage:** Stage 6 of 6 (Shared Design System & Responsive Component Specifications)  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Authoritative References:** `AGENTS.md` (Design tokens, mobile 44px touch targets, light-first sports-tech identity), `DECISION-LOG.md` (D-08 granular RBAC, D-09 5-tab Player nav & 7-hub Admin console).

---

## 1. Design System Philosophy: Light-First Sports-Tech

KAvach Play is designed as a **modern, high-performance sports-tech platform** for club cricketers and operations leaders. 
- **Light-first Canvas:** Clean white surfaces (`#FFFFFF`) set against an airy, subtle grey background (`#F6F7F9` / `#F0F2F5`) ensure maximum readability under high outdoor sunlight at cricket grounds.
- **Scarlet Brand Identity:** A signature two-tier scarlet palette—deep club scarlet (`#A30F2D`) for authoritative headers and context anchors, paired with high-energy active crimson (`#D51F43`) for primary calls to action.
- **Tabular Precision:** Pure numerical data (scores, strike rates, overs, financial dues, timestamps) utilizes monospace or tabular figures to prevent layout jitter and enable instant scannability.

---

## 2. Authoritative Token Specification

### 2.1 Color Tokens

| Token Name | Hex Code | Tailwind Equivalent / Class | Primary Semantic Purpose | WCAG Contrast against White |
|---|---|---|---|---|
| **Primary Brand** | `#A30F2D` | `from-[#A30F2D]`, `text-[#A30F2D]` | Top headers, hero gradients, modal titles | 8.2:1 (AAA) |
| **Primary Action** | `#D51F43` | `bg-[#D51F43]`, `text-[#D51F43]` | Primary CTAs, RSVP confirmations, active tabs | 5.1:1 (AA) |
| **Light Brand Surface**| `#FCE8ED` | `bg-[#FCE8ED]` | Subtle badge backgrounds, icon containers | N/A (Surface) |
| **App Canvas / Page** | `#F6F7F9` | `bg-[#F6F7F9]` | Main workspace canvas background | N/A (Surface) |
| **Card Surface** | `#FFFFFF` | `bg-white` | Elevated card containers, modals, drawers | Base |
| **Primary Text** | `#171C26` | `text-[#171C26]` | Headings, player names, bold values | 13.8:1 (AAA) |
| **Secondary Text** | `#667085` | `text-[#667085]` | Metadata, timestamps, captions, subheadings | 5.3:1 (AA) |
| **Border / Divider** | `#E5E7EB` | `border-[#E5E7EB]`, `border-gray-200` | Card borders, table dividers, inputs | Visual structural boundary |
| **Cricket Gold** | `#D6A52B` | `text-amber-500`, `text-amber-300` | Trophy accents, countdown badges, highlights | 3.2:1 (Accent) |
| **Success / Settled** | `#15803D` | `bg-emerald-600`, `text-emerald-700` | Paid dues, present attendance, active status | 4.8:1 (AA) |
| **Warning / Pending** | `#D97706` | `bg-amber-500`, `text-amber-800` | Late arrival, pending review, tentative RSVP | 4.6:1 (AA) |
| **Danger / Overdue** | `#DC2626` | `bg-rose-600`, `text-rose-700` | Overdue debts, absent attendance, alerts | 5.2:1 (AA) |
| **Info / Option A** | `#2563EB` | `bg-blue-600`, `text-blue-700` | Weather alerts, policy updates, calendar sync | 5.4:1 (AA) |

---

### 2.2 Typography Scale (Inter Font Family)

```
Font Family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
```

| Level | Size (px / rem) | Line Height | Weight | Letter Spacing | Usage |
|---|---|---|---|---|---|
| **Display / Hero** | 24px / 1.5rem | 32px | 900 (Black) | `-0.025em` | Match score banners, big totals |
| **Header 1 (H1)** | 20px / 1.25rem | 28px | 900 (Black) | `-0.02em` | Hub titles, modal headers |
| **Header 2 (H2)** | 16px / 1.0rem | 24px | 800 (ExtraBold) | `-0.01em` | Section titles, drawer headings |
| **Subtitle / Subhead**| 14px / 0.875rem| 20px | 700 (Bold) | `normal` | Card titles, player names |
| **Body Standard** | 13px / 0.8125rem| 18px | 500 (Medium) | `normal` | Descriptions, feed posts |
| **Body Small** | 12px / 0.75rem | 16px | 500 / 600 | `normal` | Metadata, match info, tables |
| **Caption / Badge** | 10px / 0.625rem| 14px | 800 (Bold) | `+0.05em` | Uppercase status badges, KAV-IDs |
| **Tabular Numbers** | Tabular figures | Inherit | 700 / 900 | Monospace | Cricket stats (R, B, 4s, 6s, SR), currency |

---

### 2.3 Spacing & Elevation Architecture

- **Base Spacing Unit:** `4px` (`0.25rem`) following standard 8pt/4pt layout principles.
- **Card Padding:**
  - Mobile: `16px` (`p-4`)
  - Desktop: `20px` to `24px` (`p-5` to `p-6`)
- **Corner Radii:**
  - Badges / Micro buttons: `8px` (`rounded-lg`)
  - Interactive Buttons / Inputs: `12px` (`rounded-xl`)
  - Cards & Modals: `16px` (`rounded-2xl`)
  - Full-pill Indicators: `9999px` (`rounded-full`)
- **Shadows:**
  - Subtle Elevation: `0 1px 2px 0 rgba(0, 0, 0, 0.05)` (`shadow-xs` / `shadow-sm`)
  - Modal Backdrop: `0 20px 25px -5px rgba(0, 0, 0, 0.1)` (`shadow-2xl`) with `backdrop-blur-xs`

---

## 3. Responsive Breakpoints & Ergonomics

| Breakpoint | Window Width | Layout Characteristics | Navigation Pattern |
|---|---|---|---|
| **Mobile** | `< 640px` | Single-column fluid stack, full-width touch cards | Fixed Mobile Bottom Navigation (5 tabs) + Sticky Header |
| **Tablet** | `640px – 1023px` | 2-column dashboard grids, inline filters | Combined Top Bar & horizontal scrollable hubs |
| **Desktop** | `>= 1024px` | Multi-column command center, max-width 1024px/1280px | Persistent side drawers, rich data tables, full KPI row |

### Touch Target Standard (WCAG 2.5.5 Compliance)
- **Minimum Interactive Dimension:** Every interactive element on mobile viewports is styled with `min-h-[44px]` (or `min-h-[40px]` with `min-w-[44px]` virtual tap padding).
- **Pitch-Side Usability:** Buttons designed for one-handed operation while standing at pitch-side:
  - 1-Tap RSVP buttons: `min-h-[44px]` with high-contrast active states.
  - Match Attendance toggles: `min-h-[44px]` with sequential status cycling (Present -> Late -> Absent).
  - Cash collection quick action: `min-h-[44px]` with clear tactile confirmation.

---

## 4. Reusable Component Catalog

### 4.1 Navigation & Mode Architecture
1. **`PlayerMobileBottomNav`:**
   - 5 primary tabs: `Home`, `Matches`, `Payments`, `Performance`, `Club`.
   - Distinct icons (`Activity`, `Trophy`, `CreditCard`, `TrendingUp`, `Shield`).
   - Active state renders scarlet accent with subtle glow pill.
2. **`AdminCommandHubSelector`:**
   - 7 primary operational hubs: `Overview`, `Match Centre`, `Player Roster`, `Finance & Dues`, `Studio & Nets`, `Club Operations`, `Settings`.
   - Horizontal swipeable container with smooth deceleration on mobile touch devices.
3. **`AdminContextBanner`:**
   - Scarlet bar alerting the user of administrative elevated mode.
   - Includes one-tap "Return to Player View" escape hatch.
4. **`SlideOverDrawer`:**
   - Right-anchored sheet for match scorecards, player profiles, and transaction audit logs.
   - Full height with sticky action footer and native scroll bounce.

---

### 4.2 Data & Metric Components
1. **`OperationsKpiCard`:**
   - Displays label, bold value, and contextual trend/subtext.
   - Color-coded (Emerald for collected funds, Scarlet for actionable dues, Amber for urgent aging, Blue for active members).
2. **`MatchHeroCard`:**
   - High-contrast gradient header (`from-[#A30F2D] to-[#D51F43]`).
   - Countdown timer pill (`In 2 Days`).
   - Teams, format badge, venue pin, and inline RSVP status container.
3. **`InningsScorecardTable`:**
   - Batsman table with columns: Batsman, Dismissal info, Runs (Bold), Balls, 4s, 6s, Strike Rate (Tabular).
   - Extras tally and Fall of Wickets summary line.
4. **`OptionAWaiverBadge`:**
   - Distinct grey/blue badge stating `Waived (Abandoned Match)`.
   - Explicit tooltip confirming zero remaining player liability while retaining historical collection records.

---

### 4.3 Action & Form Components
1. **`CreateMatchWizard`:**
   - Multi-field modal: Opposition, Match Format, Fee per Player, Venue ground picker, Date/Time.
   - Auto-computes budget based on standard 12-man squad.
2. **`PitchAttendanceToggle`:**
   - 3-state circular toggle (`Present` [Green], `Late` [Amber], `Absent` [Rose]).
   - Instantly updates player matchday fee liability.
3. **`PlayerMergeModal`:**
   - Side-by-side reconciliation preview: Source duplicate player (to be deactivated) vs Target authoritative player.
   - Confirms reparenting of matches, payments, other fees, and `appUsers.playerId` linkage (IDT-001).
4. **`JerseyNumberInput`:**
   - Real-time client validator flagging non-numeric inputs and reserved #10 club honor.

---

## 5. Screen Inventory Matrix (All 19 Prototype Views)

| # | Screen / View Name | Experience Persona | Deliverable Stage | Key Interaction Highlights |
|---|---|---|---|---|
| 1 | **Player Home** | Player | Stage 1 | Hero next match, 1-tap RSVP, dues warning, club social feed |
| 2 | **Matches Listing** | Player | Stage 2 | Filter (Upcoming, Past, Abandoned), search query, format badges |
| 3 | **Match Details & Scorecard** | Player | Stage 2 | Playing XI squad list, innings breakdown, catches tally |
| 4 | **Payments & Dues** | Player | Stage 2 | Itemized obligations, Option A rain waiver display, pay modal |
| 5 | **Payment History & Receipts** | Player | Stage 2 | Transaction ledger, digital receipt modal with QR verification |
| 6 | **Performance Dashboard** | Player | Stage 2 | Batting/bowling stats, milestone badges, run progression |
| 7 | **Player Profile & Digital Card**| Player | Stage 1/4 | Player avatar, stats, jersey number, role, KAV-ID pill |
| 8 | **Announcements & Feed** | Player | Stage 1 | Club posts, captain updates, like/comment counters |
| 9 | **Admin Overview Hub** | Administrator | Stage 3 | 4 operational KPIs, urgent action queue, hub quick-launch |
| 10 | **Match Centre Hub** | Administrator | Stage 4 | Upcoming fixtures list, attendance manager, result entry |
| 11 | **Schedule Match Wizard** | Administrator | Stage 4 | 3-step modal fixture creator with fee and venue bindings |
| 12 | **Squad & Pitch Attendance**| Administrator | Stage 4 | 1-tap Present/Late/Absent cycle, pitch cash collection |
| 13 | **Player Roster Hub** | Administrator | Stage 4 | Member directory, pending registration approval queue |
| 14 | **Player Profile & RBAC Drawer**| Administrator | Stage 4 | Role checkboxes, profile editor, real-time jersey check |
| 15 | **Duplicate Player Merge Modal**| Administrator | Stage 4 | Full relationship reparenting preview (IDT-001) |
| 16 | **Finance & Dues Hub** | Administrator | Stage 5 | Collections ledger, debtor aging list, ad-hoc fee levying |
| 17 | **Studio & Nets Hub** | Administrator | Stage 5 | 3-lane timetable grid, slot booking, pass credit ledger |
| 18 | **Club Operations Hub** | Administrator | Stage 5 | Kit order pipeline, democratic member poll, design banner |
| 19 | **Settings & Access Hub** | Administrator | Stage 5 | 6-role RBAC capability matrix, timezone lock (`Asia/Kolkata`) |

---

## 6. Verification and Acceptance Standards

- **TypeScript Type Safety:** 100% strict check (`npx tsc --noEmit` exits with code 0).
- **Zero Test Regressions:** All 198 existing unit and functional tests pass (`npm run test:functional` passes 198/198).
- **Production Build Cleanliness:** Next.js compiles 18/18 static and dynamic routes cleanly with zero build errors.
- **Strict Isolation:** Prototypes reside entirely in `app/prototype/` and `components/prototype/` without touching live Firestore rules or initiating real Razorpay orders.
