# KAvach Play — Phase 4 Completion Report
## UX Blueprint, High-Fidelity Design & Navigable Prototypes (Remediated)

**Document Type:** Formal Phase Completion Report  
**Phase:** Phase 4 — UX Blueprint, High-Fidelity Design & Prototypes  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Stage 6 Specification Commit:** `c12b7a6`  
**Phase 3/4 Independent Review Remediation Commit:** *Current working tree*  
**Authoritative References:** `AGENTS.md`, `DECISION-LOG.md` (D-08, D-09), Phase 3 Architecture Sign-off (`91811ed`), Feature Traceability Matrix (`docs/implementation/REQUIREMENTS_TRACEABILITY.md`).

---

## 1. Executive Summary

Phase 4 of the KAvach Play modernisation plan has been completed and verified following the Phase 3/4 Independent Review Remediation. 

Rather than static mockups alone, Phase 4 delivers a **comprehensive, interactive, navigable prototype** housed in an isolated sandbox at `/prototype` (powered by `components/prototype/PlayerHomePrototype.tsx`), accompanied by detailed architectural specifications for all 6 approved stages and an automated Playwright responsive verification suite (`e2e/prototype-responsive.spec.ts`).

### Key Delivery Highlights
- **Player Navigation (5 Approved Tabs):** Fully navigable interactive screens for `Home`, `Matches`, `Payments`, `Performance`, and `Club` using realistic synthetic data.
- **Admin Command Center (7 Approved Hubs):** Fully interactive operational hubs for `Overview`, `Match Centre` (including Grounds & Tournaments), `Player Roster` (with member approval and duplicate merge preview), `Finance & Dues` (with Option A abandoned match accounting and ad-hoc fee levy), `Studio & Nets` (with 3-lane schedule and booking simulation), `Club Operations` (including kit pipeline, member poll, and interactive Design Studio banner generator), and `Settings & Access` (with 6-role RBAC capability matrix and timezone lock).
- **Responsive Ergonomics & Desktop Layout:** Dedicated desktop sidebar and contextual panels (not merely padded mobile frames), verified across 6 viewports (`360×800`, `390×844`, `430×932`, `768×1024`, `1280×800`, `1440×900`).
- **Design Tokens:** Strict adherence to the light-first sports-tech scarlet-led palette (`#A30F2D` primary brand, `#D51F43` primary action, `#FCE8ED` light surface, `#171C26` typography).
- **Persona Switcher:** Highly visible, dedicated dual-pill segmented control (`[ 👤 View Player ]  [ 🛡️ View Admin (Console) ]`) in the sticky prototype control bar, synchronized with header controls and desktop navigation rails.
- **Strict Sandbox Isolation:** Zero modifications to production application code (`app/page.tsx`, `firestore.rules`, etc.), zero live Firebase mutations, and zero real Razorpay transactions. All interactive simulations display unambiguous `[PROTOTYPE SIMULATION]` toast notifications.

---

## 2. Stage-by-Stage Delivery & Git Evidence

| Stage # | Stage Name | Specification Document | Key Capabilities Delivered | Commit SHA | Status |
|---|---|---|---|---|---|
| **Stage 1** | **Player Navigation & Home** | `docs/design/STAGE_1_PLAYER_NAV_AND_HOME_SPEC.md` | Persona toggle, device frame switcher, Next Fixture hero card, 1-tap RSVP, actionable dues alert banner, notification drawer, club community feed. | `5f0c7a5` | Verified |
| **Stage 2** | **Player Matches & Payments** | `docs/design/STAGE_2_PLAYER_MATCHES_AND_PAYMENTS_SPEC.md` | Searchable/filterable matches tab (Upcoming, Past, Abandoned), match detail slide-over drawer (playing XI, scorecard, catches), Payments tab with Option A abandoned match waiver display, itemized checkout simulation, digital receipt modal with QR verification. | `624810f` | Verified |
| **Stage 3** | **Admin Navigation & Overview** | `docs/design/STAGE_3_ADMIN_NAV_AND_OVERVIEW_SPEC.md` | High-contrast dual-pill persona switcher, 7 command hubs selector, 4 operations KPI cards (collected, dues, attendance, studio utilization), urgent action queue. | `0c60a1f` | Verified |
| **Stage 4** | **Admin Match Centre & Player Roster** | `docs/design/STAGE_4_ADMIN_MATCH_CENTRE_AND_ROSTER_SPEC.md` | Match Centre with Grounds & Venues (MOD-10) and Tournaments (MOD-17) management sub-tabs, 3-step Create Match Wizard modal, Squad Builder & Pitch Attendance drawer, Player Roster with pending approval queue, Player Profile & RBAC drawer (#10 jersey validation), duplicate player merge modal with IDT-001 audit summary. | `762b73c` | Verified |
| **Stage 5** | **Admin Finance, Studio & Club Operations** | `docs/design/STAGE_5_ADMIN_FINANCE_STUDIO_OPS_SPEC.md` | Finance Hub with collections ledger, debtor aging list, record pitch cash modal, levy ad-hoc fee modal, transaction audit drawer; Studio & Nets Hub with 3-lane schedule, slot booking modal, pass credit ledger, CRM leads; Club Operations Hub with kit order pipeline, member poll, interactive Design Studio banner generator (MOD-13); Settings Hub with 6-role RBAC capability matrix and timezone lock (`Asia/Kolkata`). | `a9f013c` | Verified |
| **Stage 6** | **Shared Design System & Components** | `docs/design/STAGE_6_DESIGN_SYSTEM_AND_COMPONENT_SPEC.md` | Complete token dictionary, typography scale (Inter), spacing/elevation scale, touch target guidelines (min 44px), component architecture catalog, 19-screen inventory matrix, WCAG AA compliance criteria. | `c12b7a6` | Verified |
| **Remediation** | **Review Remediation & Full Prototype Coverage** | `docs/implementation/REQUIREMENTS_TRACEABILITY.md` | Added complete Player Performance and Club tabs, desktop sidebar and contextual layout, Design Studio SVG canvas generator, Grounds and Tournaments sub-tabs, 44px touch targets, aria-labels, replaced alerts with simulation toasts, Playwright test suite for all 6 viewports. | *Current* | Verified |

---

## 3. Implemented Prototype Capabilities vs. Deferred Production Backend

Full feature traceability across all 18 modules is maintained in [REQUIREMENTS_TRACEABILITY.md](../implementation/REQUIREMENTS_TRACEABILITY.md).

### Interactive Prototype Coverage (Sandbox Demonstration)
The following capabilities are interactively demonstrated in the isolated sandbox prototype (`/prototype`) using realistic synthetic client fixtures (`Prototype demonstrated`). These represent high-fidelity user workflows and blueprints, NOT production backend integrations:
1. **Player Home (MOD-03, MOD-05):** Next fixture countdown, 1-tap RSVP simulation, actionable dues callout, notification drawer, club feed.
2. **Player Matches (MOD-04, MOD-07, MOD-08):** Filterable fixtures, playing XI lineup, batting/bowling scorecard, catches list.
3. **Player Payments (MOD-05, MOD-06, MOD-15):** Option A abandoned match waiver presentation, itemized checkout simulation, digital receipt verification modal.
4. **Player Performance (MOD-07, MOD-16):** Career stats (runs, wickets, average, catches), milestone badges showcase, 3-way club leaderboards, match form timeline.
5. **Player Club (MOD-02, MOD-11, MOD-12, MOD-14):** Official digital player card with QR verification, studio pass credit counter and net reservation simulation, official merchandise shop with size selector and ordering modal, member poll voting simulation, club governance details.
6. **Admin Overview (MOD-01, MOD-03):** 4 KPI pulse cards, quick operational action triggers, urgent alert queue.
7. **Admin Match Centre (MOD-04, MOD-10, MOD-17):** Schedule match modal, squad builder drawer with local 1-tap attendance cycle (Present -> Late -> Absent), Grounds & Venues (MOD-10) tab, Tournaments & Leagues (MOD-17) tab with role-based permission badges.
8. **Admin Player Roster (MOD-02, MOD-09):** In-memory member approval simulation with sequential KAV-ID assignment, profile edit drawer with #10 jersey validation, duplicate merge dry-run preview (IDT-001).
9. **Admin Finance & Dues (MOD-05, MOD-06, MOD-15):** Option A accounting, collections ledger, record pitch cash modal (mock collection in synthetic ledger), levy ad-hoc fee modal, transaction audit trail modal.
10. **Admin Studio & Nets (MOD-11):** 3-lane timetable, lane reservation simulation, pass deduction simulation, CRM lead follow-up.
11. **Admin Club Operations (MOD-12, MOD-13, MOD-14):** Merchandise order pipeline, member poll results, **Matchday Banner & Canvas Generator** (live SVG graphics rendering with template and player selection).
12. **Admin Settings & Access (MOD-01, MOD-09):** Granular 6-role capability matrix, timezone enforcement display (`Asia/Kolkata`).

### Explicitly Deferred to Production Implementation Phases (Phases 5 – 12)
- **Phase 5 (Core Auth & Server-Side Security):** Authoritative server-side Razorpay order generation (FIN-001), raw webhook signature verification (FIN-003), server-side fee calculation, and idempotent transaction processing.
- **Phase 6 (UI Implementation & Match Display):** Hardened Firestore security rules with `@firebase/rules-unit-testing` emulator test suite; production connection of Player UI screens.
- **Phase 7 (Payments, Finance & Authoritative Ledger):** Live Razorpay integration, authoritative financial ledger mutations, digital receipt generation from persisted collections.
- **Phase 8 (Match Operations & Admin Hubs):** Persisted match scheduling, live attendance recording, and automatic late-fee triggers.
- **Phase 9 (Roster, Identity & Approval Workflows):** Atomic registration approval batch linking `appUsers` and `players`, relational duplicate player merge reparenting `players` and updating `appUsers.playerId`.
- **Phase 10 (Performance, Studio & Nets, Player Profile):** Live multi-lane net booking, pass balance debit transactions, automated career stats compilation from validated scorecards, and digital player cards.
- **Phase 11 (Club Operations, Shop, Polling & Hardening):** Production merchandise order processing, live member polls, and WCAG AA accessibility certification.
- **Phase 12 (Production Verification, Audit & Cutover):** Final production readiness audit, live staging verification, and controlled owner-approved cutover.

---

## 4. Persona Switcher Architecture & Visibility

**Resolution of Persona Switcher Invisibility:**
In earlier iterations, switching between Player and Admin modes was confined to a small header icon button (`Shield`), which condensed to an ambiguous "Console" button on mobile viewports.

In this remediation:
1. **Prominent Top Bar Segment Control:** A high-contrast segmented pill control is positioned directly in the sticky prototype preview bar:
   - `[ 👤 View Player ]` (active: white text on charcoal background)
   - `[ 🛡️ View Admin (Console) ]` (active: white text on scarlet `#A30F2D`)
2. **Synchronized Header Action:** The header toggle displays explicit descriptive text: `Switch: Admin Console` (in player mode) and `Switch: View Player` (in admin mode).
3. **Desktop Sidebar Quick Toggle:** Both the Desktop Player Sidebar and Admin Command Rail feature dedicated switcher buttons at the bottom of the navigation stack.
4. **Instant In-Memory Mode Switching:** Clicking either control immediately shifts the layout between the 5 Player destinations and 7 Admin command hubs with clear visual state changes.

---

## 5. Verification and Automated Test Evidence

### 1. Developer Automated Test Suite vs. Independent QA Boundary
In accordance with `AGENTS.md` and the governance principles of this project:
- **Developer Automated Verification:** The test results documented below represent automated developer-executed regression and compliance suites (`tsc`, `lint`, `test:functional`, `build`, and Playwright end-to-end tests) verifying that all code compiles without errors, units pass cleanly, and interactive prototype behavior adheres to specifications across viewports.
- **Independent QA Acceptance Boundary:** These internal developer verification results do not constitute self-certified acceptance or independent QA approval. Formal verification of running artifacts and staging behavior remains the duty of an independent read-only QA review session and the Product Owner.

### 2. Automated Playwright Responsive & Capabilities Suite (`e2e/prototype-responsive.spec.ts`)
Executed against both official Playwright projects:
- `npx playwright test e2e/prototype-responsive.spec.ts --project="Desktop Chrome"`: **13/13 passed** (16.7s, 0 failed, 0 skipped).
- `npx playwright test e2e/prototype-responsive.spec.ts --project="Mobile Chrome"`: **13/13 passed** (20.9s, 0 failed, 0 skipped).
- **Combined Total:** **26/26 passed (0 failures, 0 skipped)**.

Tests executed in each project across all 6 target viewports:
1. **Viewport 360×800:** `renders at 360x800 (360x800) with valid layout, navigation, touch targets, and modals` — **PASS**
2. **Viewport 390×844:** `renders at 390x844 (390x844) with valid layout, navigation, touch targets, and modals` — **PASS**
3. **Viewport 430×932:** `renders at 430x932 (430x932) with valid layout, navigation, touch targets, and modals` — **PASS**
4. **Viewport 768×1024:** `renders at 768x1024 (768x1024) with valid layout, navigation, touch targets, and modals` — **PASS**
5. **Viewport 1280×800:** `renders at 1280x800 (1280x800) with valid layout, navigation, touch targets, and modals` — **PASS**
6. **Viewport 1440×900:** `renders at 1440x900 (1440x900) with valid layout, navigation, touch targets, and modals` — **PASS**
7. **Player Navigation:** `verifies all 5 player navigation destinations across tabs` (`Home`, `Matches`, `Payments`, `Performance`, `Club`) — **PASS**
8. **Admin Command Hubs:** `verifies all 7 administrator command hubs and sub-tabs` (`Overview`, `Match Centre`, `Player Roster`, `Finance & Dues`, `Studio & Nets`, `Club Operations`, `Settings & Access`) plus sub-tabs (Grounds, Tournaments) — **PASS**
9. **Drawers & Modals:** `verifies opening and closing major drawers and modals cleanly` (match details drawer, create match modal, record pitch cash modal, merge duplicate modal) — **PASS**
10. **Mandatory Checkout Simulation:** `verifies mandatory checkout workflow, heading clarity, and simulation notification` (asserts visible entry point without conditionals, verifies `Payment Checkout — Prototype Simulation` heading, toast disclaimers, auto-dismiss) — **PASS**
11. **Design Studio Generator:** `verifies interactive Design Studio generator and live SVG canvas` (template switching, POTM layout, high-res graphic download simulation) — **PASS**
12. **Keyboard Accessibility & Focus:** `verifies keyboard navigation and focus visibility across primary player navigation` (focus ring on active control, Tab keyboard navigation) — **PASS**
13. **Modal Keyboard & Escape Dismissal:** `verifies modal keyboard interaction, Escape-key dismissal, and focus containment` (asserts `role="dialog"`, `aria-modal="true"`, Enter key opening, and Escape key dismissal across modals and drawers) — **PASS**

Screenshots captured and stored under `docs/qa/screenshots/`:
- `prototype-360x800.png`
- `prototype-390x844.png`
- `prototype-430x932.png`
- `prototype-768x1024.png`
- `prototype-1280x800.png`
- `prototype-1440x900.png`

*Tests Not Run:* Live Firebase Emulator rules testing and end-to-end payment gateway settlement tests were not executed in Phase 4 because the prototype operates in an isolated client sandbox. These suites are scheduled for Phase 5 and Phase 6.

### 3. Functional & Accounting Unit Test Suite
Executed via `npm run test:functional`:
- **Result:** **198/198 passed** across 40 test suites (0 failures, 0 skipped).

### 4. TypeScript Compilation
Executed via `npx tsc --noEmit`:
- **Result:** **0 errors**.

### 5. Next.js Production Build
Executed via `npm run build`:
- **Result:** All **18 static and dynamic routes compiled and optimized cleanly**.

---

## 6. Accessibility & Touch Target Standards

The following accessibility, ergonomics, and touch target standards were audited and verified in `components/prototype/PlayerHomePrototype.tsx`:
- **Comprehensive 44×44px Touch Target Audit:** Conducted an exhaustive AST and DOM-based audit across all interactive elements. Every one of the **115 `<button>` elements** strictly satisfies the $\ge 44\text{px} \times 44\text{px}$ minimum clickable area, including:
  - Mobile bottom navigation items (Home, Matches, Payments, Performance, Club): `min-h-[44px] min-w-[44px]`
  - Match details sub-tab navigation (Squad & Info, Scorecard, Fielding & Catches): `min-h-[44px] px-3.5`
  - Pitch attendance toggle buttons (Present, Late, Absent): `min-h-[44px] min-w-[76px]`
  - Pitch cash collection buttons: `min-h-[44px] min-w-[68px]`
  - Feed post action buttons (Like, Comments, Share): `min-h-[44px] min-w-[44px] px-2`
  - Modal and slide-over close buttons: `min-h-[44px] min-w-[44px]`
  - Toast notification dismiss button: `min-h-[44px] min-w-[44px]`
- **Interactive Non-Button Elements:** Match card `<article>` containers and poll option `<div>` controls were upgraded with `role="button"`, `tabIndex={0}`, descriptive `aria-label`, visible focus indicators, and keyboard Enter/Space event handlers.
- **Dialog & Modal Standards:** All 13 modal dialogues and slide-over drawers include `role="dialog"`, `aria-modal="true"`, scrollable constraints (`max-h-[90vh] overflow-y-auto`), and prominent `min-h-[44px] min-w-[44px]` close buttons.
- **Escape Key Listener:** Added a global `Escape` key event listener in `useEffect` that immediately dismisses any active modal, slide-over drawer, or simulation toast.
- **Justified Exceptions:** Non-interactive status badges (e.g. `UPCOMING`, `PLAYED`, `CONFIRMED`), decorative indicators, and table header labels remain compact by design because they are informational displays without click handlers.
- **Accessible Names:** Added explicit `aria-label` attributes to icon-only controls (e.g. `aria-label="Close Checkout"`, `aria-label="Close match details"`, `aria-label="Close modal"`).
- **Visible Focus States:** Focusable elements include high-contrast focus rings (`focus:ring-2 focus:ring-[#D51F43]/40`).
- **Semantic Roles:** Navigation bars use `<nav>`, modal headers use `<h3 role="heading">`, and articles use `<article>`.
- **Simulation Transparency:** Replaced all blocking `window.alert` calls with accessible, non-blocking `[PROTOTYPE SIMULATION]` toast notifications that clearly state no live database mutation or payment gateway call has occurred.
- **Certification Note:** Structural AA patterns (contrast ratios > 4.5:1, 44px interactive targets, semantic HTML) are implemented. Formal external WCAG 2.1 AA screen-reader audit and axe automated certification are scheduled for the dedicated QA & Hardening phase (Phase 11).

---

## 7. Scope Controls Confirmation

- **Repository Branch:** `mig-mov`
- **Application Code:** Production application code (`app/page.tsx`, `firestore.rules`, `lib/server-auth.ts`, etc.) remains 100% untouched.
- **Data & Gateway Safety:** No live Firebase reads/writes, no real Razorpay transactions.
- **Phase Boundary:** Phase 5 (Financial Integrity & Server-Side Payment Security) has **NOT** been started.

Phase 4 is complete and ready for independent review.
