# KAvach Play — Phase 4 Completion Report
## UX Blueprint, High-Fidelity Design & Navigable Prototypes (Remediated)

**Document Type:** Formal Phase Completion Report  
**Phase:** Phase 4 — UX Blueprint, High-Fidelity Design & Prototypes  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Current Milestone Commit:** Reviewed closure milestone `0691be678b449582e9a3328c793cb68e10bee669` (parent `e421587a84b4131ab514c2bccfa6bd7ec5292ac2`) on `mig-mov`  
**Authoritative References:** `AGENTS.md`, `DECISION-LOG.md` (D-08, D-09, D-10), Phase 3 Architecture Sign-off (`91811ed`), Feature Traceability Matrix (`docs/implementation/REQUIREMENTS_TRACEABILITY.md`).  
**Status:** Developer Verified — **Pending Independent QA Review & Owner Acceptance** (Not Self-Certified)

---

## 1. Executive Summary

Phase 4 of the KAvach Play modernisation plan has been completed and verified following the Phase 3/4 Independent Review Remediation and closure findings. 

Rather than static mockups alone, Phase 4 delivers a **comprehensive, interactive, navigable prototype** housed in an isolated sandbox at `/prototype` (powered by `components/prototype/PlayerHomePrototype.tsx` and `app/prototype/page.tsx`), accompanied by detailed architectural specifications for all 6 approved stages (`docs/design/STAGE_1_...` through `STAGE_6_...`) and an automated Playwright responsive verification suite (`e2e/prototype-responsive.spec.ts`).

### Key Delivery Highlights
- **Player Navigation (5 Approved Destinations):** Fully navigable interactive screens for `Home`, `Matches`, `Payments`, `Performance`, and `Club` using realistic synthetic fixtures.
- **Admin Command Center (7 Approved Hubs):** Fully interactive operational hubs for `Overview`, `Match Centre` (including Grounds & Tournaments), `Player Roster` (with member approval and duplicate merge preview), `Finance & Dues` (with Option A abandoned match accounting and ad-hoc fee levy), `Studio & Nets` (with 3-lane schedule and booking simulation), `Club Operations` (including kit pipeline, member poll, and interactive Design Studio banner generator), and `Settings & Access` (with 6-role RBAC capability matrix and timezone lock).
- **Unified Player Experience with Authorised Admin Console Entry:** In accordance with `AGENTS.md` and Decision `D-10`, administrators experience the normal player view first. Admin Console is an authorised entry point into administrative functionality (`Overview`, `Match Centre`, `Player Roster`, `Finance & Dues`, `Studio & Nets`, `Club Operations`, `Settings & Access`), eliminating any separate global player/admin persona-switching paradigm.
- **Responsive Ergonomics & Desktop Layout:** Dedicated desktop sidebar and contextual panels (not merely padded mobile frames), verified across 6 viewports (`360×800`, `390×844`, `430×932`, `768×1024`, `1280×800`, `1440×900`).
- **Design Tokens:** Strict adherence to the light-first sports-tech scarlet-led palette (`#A30F2D` primary brand, `#D51F43` primary action, `#FCE8ED` light surface, `#171C26` typography).
- **Strict Sandbox Isolation:** Zero modifications to production application code (`app/page.tsx`, `firestore.rules`, etc.), zero live Firebase mutations, and zero real Razorpay transactions. All interactive simulations display unambiguous `[PROTOTYPE SIMULATION]` toast notifications.

---

## 2. Stage-by-Stage Delivery & Git Evidence

### Implementation Commits

| Commit SHA | Stage / Scope | Description |
|---|---|---|
| `5f0c7a5` | Stage 1 | Player Navigation & Home blueprint and navigable prototype |
| `624810f` | Stage 2 | Player Matches & Payments blueprint and prototype |
| `0c60a1f` | Stage 3 | Admin Navigation & Overview blueprint and prototype |
| `762b73c` | Stage 4 | Admin Match Centre & Player Roster blueprint and prototype |
| `a9f013c` | Stage 5 | Admin Finance, Studio & Operations blueprints and prototype |
| `c12b7a6` | Stage 6 | Shared Design System specification and Phase 4 completion report |
| `55cac20` | Remediation | Phase 3/4 review remediation and complete prototype coverage |
| `fed6936` | Remediation | Touch target audit, test coverage, and traceability distinctions |
| `6b430fb` | Remediation | 44px touch targets, responsive assertions, and report reconciliation |
| `bcfad69` | Config | Owner Super Admin custom claim and allowlist configuration |
| `e421587` | Closure | Reconcile D-10 unified model, instance-aware dialog focus, unrounded 44px targets |
| `0691be6` | Closure | Non-topmost focus handling (UX-07), background content inert isolation (UX-08) |

### Deliverable Artifacts & Specification Files

- **Prototype Application Files:**
  - `components/prototype/PlayerHomePrototype.tsx` (Complete interactive prototype component)
  - `app/prototype/page.tsx` (Isolated sandbox route for prototype preview)
- **Design & Architecture Specification Files:**
  - `docs/design/STAGE_1_PLAYER_NAV_AND_HOME_SPEC.md`
  - `docs/design/STAGE_2_PLAYER_MATCHES_AND_PAYMENTS_SPEC.md`
  - `docs/design/STAGE_3_ADMIN_NAV_AND_OVERVIEW_SPEC.md`
  - `docs/design/STAGE_4_ADMIN_MATCH_CENTRE_AND_ROSTER_SPEC.md`
  - `docs/design/STAGE_5_ADMIN_FINANCE_STUDIO_OPS_SPEC.md`
  - `docs/design/STAGE_6_DESIGN_SYSTEM_AND_COMPONENT_SPEC.md`
- **Governance & Traceability Documents:**
  - `docs/implementation/DECISION-LOG.md` (Decisions D-01 through D-10)
  - `docs/implementation/REQUIREMENTS_TRACEABILITY.md` (Requirements-to-prototype mapping)
  - `docs/implementation/PHASE-TRACKER.md` (Active Master Plan Track vs Historical Audit Baseline)
- **Automated Verification Suites:**
  - `e2e/prototype-responsive.spec.ts` (Playwright responsive and capabilities suite)
  - `docs/qa/screenshots/prototype-*.png` (Visual capture across all 6 viewports)

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

## 4. Unified Player Experience & Authorised Admin Console Entry

**Reconciliation with Approved Product Architecture (D-10):**
In accordance with `AGENTS.md` and Decision `D-10`, the platform strictly eliminates the global player/admin persona-switching paradigm (`persona: "player" | "admin"` state, `setPersona()`, and segmented switcher). All authenticated users, including club administrators, experience the standard player view as their default application experience.

Key architectural properties implemented:
1. **Single Player Identity & Session:** The user always maintains their authoritative player identity (`MOCK_CURRENT_PLAYER`), player profile, and navigation context. Entering administrative areas does not swap the user identity or instantiate a separate session.
2. **Authorised Admin Console Entry Point:** When an authorized administrator accesses the application, a prominent `Admin Console` action is provided in the application header and desktop navigation sidebar. Clicking this opens administrative operations (`Overview`, `Match Centre`, `Player Roster`, `Finance & Dues`, `Studio & Nets`, `Club Operations`, `Settings & Access`).
3. **Persistent Return to Player View:** When inside the Admin Console, clear `Return to Player View` actions are provided in the application header, admin context banner, and desktop sidebar, immediately returning to the player dashboard while preserving player tab state.
4. **Isolated Prototype Inspector Harness:** The prototype preview/inspection controls (role simulation dropdown and viewport toggle) are visually and structurally isolated within a separate sticky top harness labeled `Prototype Inspector`. It carries an unambiguous disclaimer:
   > `*Note: Prototype inspection only. Mocked role simulation is client-side synthetic and does not demonstrate production server-side RBAC enforcement.`
5. **Preservation of 6 Granular RBAC Roles:** In accordance with Decision `D-08` and `AGENTS.md`, all six granular administrative roles are strictly retained:
   - `superAdmin` (Full administrative authority)
   - `clubAdmin` (Roster management and announcements)
   - `matchAdmin` (Fixture management, pitch attendance and cash collections)
   - `financeAdmin` (Match fee accounting, ad-hoc fee levy, ledger audit)
   - `studioAdmin` (Nets and studio lane bookings and memberships)
   - `isDesigner` (Matchday canvas and social banner graphics generator)
   - `player` (Standard member with least-privilege access)

---

## 5. Verification and Automated Test Evidence

### 1. Developer Automated Test Suite vs. Independent QA Boundary
In accordance with `AGENTS.md` and the governance principles of this project:
- **Developer Automated Verification:** The test results documented below represent automated developer-executed regression and compliance suites (`tsc`, `lint`, `test:functional`, `build`, and Playwright end-to-end tests) verifying that all code compiles without errors, units pass cleanly, and interactive prototype behavior adheres to specifications across viewports.
- **Independent QA Acceptance Boundary:** These internal developer verification results do not constitute self-certified acceptance or independent QA approval. Formal verification of running artifacts and staging behavior remains the duty of an independent read-only QA review session and the Product Owner. Phase 4 is explicitly submitted as **Pending Independent QA Review & Owner Acceptance**.

### 2. Automated Playwright Responsive & Capabilities Suite (`e2e/prototype-responsive.spec.ts`)
Executed against both official Playwright projects:
- `npx playwright test e2e/prototype-responsive.spec.ts --project="Desktop Chrome"`: **14/14 passed** (17.0s, 0 failed, 0 skipped).
- `npx playwright test e2e/prototype-responsive.spec.ts --project="Mobile Chrome"`: **14/14 passed** (19.9s, 0 failed, 0 skipped).
- **Combined Total:** **28/28 passed (0 failures, 0 skipped)**.

Tests executed in each project across all 6 target viewports:
1. **Viewport 360×800:** `renders at 360x800 (360x800) with valid layout, navigation, touch targets, and modals` — **PASS**
2. **Viewport 390×844:** `renders at 390x844 (390x844) with valid layout, navigation, touch targets, and modals` — **PASS**
3. **Viewport 430×932:** `renders at 430x932 (430x932) with valid layout, navigation, touch targets, and modals` — **PASS**
4. **Viewport 768×1024:** `renders at 768x1024 (768x1024) with valid layout, navigation, touch targets, and modals` — **PASS**
5. **Viewport 1280×800:** `renders at 1280x800 (1280x800) with valid layout, navigation, touch targets, and modals` — **PASS**
6. **Viewport 1440×900:** `renders at 1440x900 (1440x900) with valid layout, navigation, touch targets, and modals` — **PASS**
7. **Player Navigation:** `verifies all 5 player navigation destinations across tabs` (`Home`, `Matches`, `Payments`, `Performance`, `Club`) — **PASS**
8. **Admin Command Hubs:** `verifies all 7 administrator command hubs and sub-tabs` (`Overview`, `Match Centre`, `Player Roster`, `Finance & Dues`, `Studio & Nets`, `Club Operations`, `Settings & Access`) plus sub-tabs (Grounds, Tournaments) via authorized Admin Console entry — **PASS**
9. **Drawers & Modals:** `verifies opening and closing major drawers and modals cleanly` (match details drawer, create match modal, record pitch cash modal, merge duplicate modal) — **PASS**
10. **Mandatory Checkout Simulation:** `verifies mandatory checkout workflow, heading clarity, and simulation notification` (asserts visible entry point without conditionals, verifies `Payment Checkout — Prototype Simulation` heading, toast disclaimers, auto-dismiss) — **PASS**
11. **Design Studio Generator:** `verifies interactive Design Studio generator and live SVG canvas` (template switching, POTM layout, high-res graphic download simulation) — **PASS**
12. **Keyboard Accessibility & Focus:** `verifies keyboard navigation and focus visibility across primary player navigation` (focus ring on active control, Tab keyboard navigation) — **PASS**
13. **Instance-Aware Modal Focus Management & Restoration:** `verifies instance-aware modal focus containment, first/last element cycling, Escape dismissal, and nested dialog focus restoration` (asserts initial focus inside active dialog, first/last focus wrapping with Tab and Shift+Tab, Escape key LIFO dismissal, and focus restoration to the exact opener trigger button across single and nested dialogs e.g. Squad Drawer -> Record Cash Modal) — **PASS**
14. **Non-Topmost Dialog Closure & Background Isolation (UX-07 & UX-08):** `verifies closing non-topmost dialog retains focus within active topmost dialog and preserves stack; verifies background application content and underlying dialogs are completely isolated via inert/aria-hidden while dialogs are open, and interactivity is cleanly restored upon closing` — **PASS**

Screenshots captured and stored under `docs/qa/screenshots/`:
- `prototype-360x800.png`
- `prototype-390x844.png`
- `prototype-430x932.png`
- `prototype-768x1024.png`
- `prototype-1280x800.png`
- `prototype-1440x900.png`

*Tests Not Run (Explicitly Deferred):*
- Live Firebase Emulator security rules test suite (`@firebase/rules-unit-testing`) is deferred to Phase 6 (UI Implementation & Hardened Rules).
- Live Razorpay payment gateway API integration and webhook verification tests are deferred to Phase 5 (Core Auth & Server-Side Security) and Phase 7 (Payments & Finance).

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
- **Strict 44×44px Touch Target Standard (Unrounded Assertion):** Enforced strict unrounded $\ge 44\text{px} \times 44\text{px}$ minimum clickable area across all interactive controls (`button`, `a[href]`, `[role="button"]`, `input`, `select`, `textarea`, `[tabindex="0"]`), directly verified by Playwright with zero rounding:
  - Mobile bottom navigation items (Home, Matches, Payments, Performance, Club): `min-h-[44px] min-w-[44px]`
  - Match details sub-tab navigation (Squad & Info, Scorecard, Fielding & Catches): `min-h-[44px] px-3.5`
  - Pitch attendance toggle buttons (Present, Late, Absent): `min-h-[44px] min-w-[76px]`
  - Pitch cash collection buttons: `min-h-[44px] min-w-[68px]`
  - External venue map links: `min-h-[44px] min-w-[44px] inline-flex items-center px-1`
  - Feed post action buttons (Like, Comments, Share): `min-h-[44px] min-w-[44px] px-2`
  - Modal and slide-over close buttons: `min-h-[44px] min-w-[44px]`
  - Toast notification dismiss button: `min-h-[44px] min-w-[44px]`
  - All form `<input>` and `<select>` controls: `min-h-[44px]`
- **Background Application Content Isolation (UX-08):**
  - While any modal or drawer is active, the entire background application tree (`#prototype-app-content`) and top inspector bar (`#prototype-inspector-bar`) are marked with the HTML standard `inert` and `aria-hidden="true"` attributes.
  - This guarantees that background content cannot receive keyboard focus, click/touch events, or screen reader focus.
  - When all dialogs close, `inert` and `aria-hidden` attributes are cleanly removed, restoring full interactivity immediately.
- **Instance-Aware Modal Focus Management & Non-Topmost Closure Handling (UX-07):**
  - Implemented an instance-aware dialog stack (`dialogStackRef`) tracking `{ id, triggerElement, close }` for all 13 modals and drawers.
  - Automatically shifts initial focus to the first focusable element inside newly opened dialogs via `requestAnimationFrame`.
  - Traps `Tab` and `Shift+Tab` strictly within the active topmost dialog (`topDialog`), cycling seamlessly between first and last focusable elements.
  - When a dialog closes, the system inspects whether it was the topmost dialog:
    - **If topmost:** Restores focus to its exact opener trigger element, provided that opener is still connected and usable in the DOM (`opener.isConnected`).
    - **If non-topmost (e.g. underlying drawer closed while a nested modal is still active):** Focus does NOT jump behind the active modal; focus remains strictly contained within the remaining topmost dialog.
  - Safely handles nested dialogs (e.g., opening `Record Cash Modal` from within `Admin Match Squad Drawer`): underlying dialogs receive `inert` while nested dialogs are topmost. Pressing Escape or Close dismisses only the top modal and returns focus to the "Collect" trigger button inside the underlying drawer, leaving the underlying drawer open and interactive.
- **Dialog & Modal Standards:** All 13 modal dialogues and slide-over drawers include unique `data-dialog-id`, `role="dialog"`, `aria-modal="true"`, scrollable constraints (`max-h-[90vh] overflow-y-auto`), and prominent `min-h-[44px] min-w-[44px]` close buttons.
- **Escape Key Listener:** Global `Escape` key event listener in `useEffect` pops the topmost dialog from `dialogStackRef` in strict LIFO order.
- **Justified Exceptions:** Non-interactive status badges (e.g. `UPCOMING`, `PLAYED`, `CONFIRMED`), decorative indicators, and table header labels remain compact by design because they are informational displays without click handlers.
- **Accessible Names:** Explicit `aria-label` attributes on icon-only controls (e.g. `aria-label="Close Checkout"`, `aria-label="Close match details"`, `aria-label="Close modal"`).
- **Visible Focus States:** Focusable elements include high-contrast focus rings (`focus:ring-2 focus:ring-[#D51F43]/40`).
- **Semantic Roles:** Navigation bars use `<nav>`, modal headers use `<h3 role="heading">`, and articles use `<article>`.
- **Simulation Transparency:** Replaced all blocking `window.alert` calls with accessible, non-blocking `[PROTOTYPE SIMULATION]` toast notifications that clearly state no live database mutation or payment gateway call has occurred.

---

## 7. Scope Controls Confirmation

- **Repository Branch:** `mig-mov`
- **Application Code:** Production application code (`app/page.tsx`, `firestore.rules`, `lib/server-auth.ts`, etc.) remains 100% untouched.
- **Data & Gateway Safety:** No live Firebase reads/writes, no real Razorpay transactions.
- **Phase Boundary:** Phase 5 (Core Auth & Server-Side Security) has **NOT** been started.

---

## 8. Items for Product Owner Direction & Acceptance

The following governance items are submitted for Product Owner direction and review:
1. **Staging Environment Confirmation (OD-01):** Confirm designated staging Firebase project and preview URL prior to Phase 5 server-side deployments.
2. **Production Cutover Strategy (OD-02):** Approve the phased cutover roadmap from the legacy monolithic branch upon completion of Phase 12 verification.
3. **Phase 4 Prototype Review & Sign-Off:** Review the navigable prototype at `/prototype` across both Player View and Admin Console. Note: Phase 4 status remains **Pending Independent QA Review & Owner Acceptance**; no self-certification is claimed.
