# KAvach Play — Phase & Implementation Status

**Document:** Engineering Handover — Implementation Status, Commit History, Tech Debt & Decisions  
**Status:** Living Engineering Record (Reconciled & Validated)  
**Target Audience:** Engineering Leads, Product Owner, Incoming Reviewers  
**Authoritative References:** `docs/implementation/PHASE-TRACKER.md`, `docs/implementation/DECISION-LOG.md`, `agent.md`, `cloud.md`  

---

## 1. Active Remediation Master Plan Track (Authoritative)

The table below reflects the verified status of the active, owner-approved remediation track on branch `mig-mov`. All previous claims of complete 12-phase delivery from prior coding agents were audited and found defective; this track governs actual progress.

| Phase / Milestone | Status | Verified Scope & Deliverables | Test & Review Evidence |
|---|---|---|---|
| **Phase 0: Discovery & Retrospective Audit** | **COMPLETE & OWNER APPROVED** | Baselined commit `acff8325`; established defect register (20+ defects); produced requirements traceability matrix. | `BASELINE.md`, `REQUIREMENTS_TRACEABILITY.md` |
| **Phase 1: Critical Security & Financial Baseline** | **COMPLETE & OWNER APPROVED** | Fixed SEC-001 (custom claim SuperAdmin), SEC-002 (payment status lock), FIN-001 (server amount derivation), FIN-005 (Option A abandoned match billing). | `tests/accounting-functional.test.mjs`, `tests/razorpay-tamper.test.mjs` |
| **Phase 2: State Integrity & Listener Lifecycle** | **COMPLETE & OWNER APPROVED** | Retired legacy `WixFinanceView`; implemented `lazySubsRef` listener teardown; scoped collection-group queries (CRIT-03). | `tests/architecture-optimization.test.mjs` |
| **Phase 3: Product Rationalisation & UX Discovery** | **COMPLETE & OWNER SIGN-OFF** | Completed 32-item feature inventory; approved Decision D-08 (granular RBAC), D-09 (5-tab Player Nav / 7-hub Admin), D-10 (Unified Player View). | Sign-off commit `91811ed`; `PRODUCT_RATIONALISATION_AND_UX_DISCOVERY.md` |
| **Phase 4: UX Blueprint & Prototypes** | **PROTOTYPE COMPLETE** | Interactive prototype sandbox at `/prototype` covering all 5 Player tabs and 7 Admin hubs across 6 viewports. 44px touch targets. | Playwright 26/26 passed in sandbox; `PHASE_4_COMPLETION_REPORT.md`. Zero production code modified. |
| **Phase 5: Core Auth & Server-Side Security** | **COMPLETE (Remediated — Pending Independent QA & Owner Review)** | Granular RBAC (`requireRole`, `requireClubAdmin`, etc.); fail-closed account status checks; test bypass isolation; webhook replay guard. | 34 Phase 5 security scenarios & 39 emulator tests passed. Baseline commit `246712a`. |
| **Phase 6: UI Implementation & Match Display** | **COMPLETE (Remediated & Hardened — Pending Independent QA & Owner Review)** | Production Player View default; Hero Next Fixture card; 1-Tap Player Availability; Read-only Dues Summary; Match filter/search; Scorecards. | 30/30 Playwright E2E tests + 4/4 production smoke tests passed. Baseline commit `021b41a`. |
| **Pre-Phase 7: Security Remediations 1–1F-R** | **IMPLEMENTED (Pending Independent QA Review)** | Transactional identity reservations (`phoneIndex`, `uidIndex`); distributed merge worker lease with fencing tokens; 10-field player locks; 12-field financial collision protection; bounded resumable stages; independent verification gate; webhook merge redirection. | 114 adversarial emulator tests passed (`remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs`); 29 1F-A tests; 20 1E tests; 254 functional tests. Commit `5b504c6`. |
| **Phase 2.1: Player Home Redesign** | **COMPLETE (Remediated)** | Mobile-first Player Home; campaign banner; payment summary; upcoming match card; quick availability toggle; responsive shell. | `tests/phase2.1-player-home-corrections.test.mjs` (all pass); CI Run 44559161481. |
| **Phase 2.2: Player Match Center** | **COMPLETE (Hardened via 5 Passes)** | Mobile Match Center with progressive disclosure; squad gating (`validateMatchNavigation`); Option A waived presentation; multi-channel payment aggregation; deterministic fee overrides; Jersey infographic. | 130+ tests in `tests/player-match-center-ui.test.mjs` & `tests/phase2.2-player-match-center.test.mjs`; CI Run 44651141614. Head commit `8978577`. |
| **Phase 7: Payments, Finance & Authoritative Ledger** | **PLANNED / NOT STARTED** | Live Razorpay integration on production, digital receipts generation, authoritative ledger mutations. | Production Phase (Requires staging verification) |
| **Phase 8: Match Operations & Admin Hubs** | **PLANNED / NOT STARTED** | Admin match scheduling, pitch-side attendance, automatic late-fee batch triggers. | Production Phase |
| **Phase 9: Roster, Identity & Approval Workflows** | **PLANNED / NOT STARTED** | Atomic registration approval batch, relational duplicate player merge UI integration. | Production Phase |
| **Phase 10: Performance, Studio & Nets, Player Profile** | **PLANNED / NOT STARTED** | Multi-lane net booking, coaching pass debit, career stats compilation from validated scorecards, digital player cards. | Production Phase |
| **Phase 11: Club Operations, Shop, Polling & Hardening** | **PLANNED / NOT STARTED** | Production merchandise order batching, live member polls, WCAG AA accessibility certification. | Production Phase |
| **Phase 12: Production Verification, Audit & Cutover** | **PLANNED / NOT STARTED** | Final production readiness audit, live staging verification, controlled cutover. | Release Phase |

---

## 2. Granular Status Classifications

In strict adherence to `AGENTS.md`, statuses across modules are defined as follows:

| Module / Feature | Exact Status | Evidence / Notes |
|---|---|---|
| **Multi-Database Branch Isolation** | **Automated tests passed & Implemented** | `lib/database-config.ts`, 13 tests in `tests/database-isolation-and-payment-safety.test.mjs` pass. |
| **Server Admin Factory Seam** | **Automated tests passed & Implemented** | `lib/server-db.ts`, tests prove exact named DB arguments without fallback. |
| **Super Admin RBAC via Custom Claims** | **Automated tests passed & Implemented** | `lib/server-auth.ts`, `firestore.rules`, verified by unit tests. |
| **Player Match Center UI (Mobile)** | **Independently reviewed & Implemented** | Reviewed by ChatGPT across 5 correction passes; 130+ unit tests pass. |
| **Option A Abandoned Match Billing** | **Automated tests passed & Implemented** | `lib/personal-match-payment.ts`, `tests/abandoned-match-accounting.test.mjs` pass. |
| **Player Merge Distributed Lease Engine** | **Independently reviewed & Implemented** | 114 emulator tests pass in CI; reviewed by ChatGPT (Remediation 1F-R). |
| **Account Linking Canonical Phone Index** | **Automated tests passed & Implemented** | `app/api/player/link-account`, `tests/remediation1a-account-linking.emulator.test.mjs`. |
| **Production App Deployment** | **Production-deployed** (Legacy snapshot) | Live app at `https://play.kavachcricket.com` runs earlier branch; recent `mig-mov` commits not yet deployed. |
| **Production Payments on `mig-mov`** | **Blocked by Design** | Fail-closed guard intentionally disables live orders on `mig-mov`. |

---

## 3. Key Commits Log (From Audit Baseline to Current HEAD)

| Commit SHA | Date | Author | Summary & Scope |
|---|---|---|---|
| `8978577` (HEAD) | 2026-11-20 | Antigravity | `feat(match-center): refine match cards, eliminate rsvp wording, and enforce fail-closed db resolver` |
| `e901b86` | 2026-11-20 | Antigravity | `fix(db): ensure client-side safe database ID resolution on mig-mov without throwing in browser` |
| `af91dda` | 2026-11-20 | Antigravity | `fix(build): inject authoritative branch database ID for Amplify and Next.js client bundling` |
| `eb94c4e` | 2026-11-20 | Antigravity | `feat(match-center): refine player match center card ui, progressive disclosure, and jersey infographic` |
| `f9cc468` | 2026-11-20 | Antigravity | `fix(db): add controlled Admin SDK factory seam and expand payment authorization test matrix` |
| `176b136` | 2026-11-20 | Antigravity | `fix(db): enforce strict production branch payment gating and approved environment validation` |
| `e6819ce` | 2026-11-20 | Product Owner | `Document KAvach Play cloud environments and refresh state (cloud.md)` |
| `a0b570c` | 2026-11-20 | Product Owner | `Add KAvach Play agent instructions (agent.md)` |
| `61ded57` | 2026-11-20 | Antigravity | `feat(db): enforce strict Firestore database isolation and disable development Razorpay operations` |
| `9590e87` | 2026-11-20 | Antigravity | `fix(matches): simplify squad eligibility to authoritative fee obligations (Pass 5)` |
| `946548e` | 2026-11-20 | Antigravity | `fix(matches): enforce authoritative administrative waitlist removal over stale availability (Pass 4)` |
| `450c487` | 2026-11-20 | Antigravity | `fix(matches): separate player rsvp from squad assignment, enforce fee override precedence (Pass 3)` |
| `7c000b2` | 2026-11-20 | Antigravity | `fix(matches): resolve squad eligibility bypass, payment deduplication, and sponsorship accounting (Pass 2)` |
| `5b504c6` | 2026-11-19 | Antigravity | `Security Remediation 1F & 1F-R: Atomic Identity Merge, Recovery, and Concurrency Fencing` |
| `021b41a` | 2026-11-18 | Antigravity | `Phase 6 UI Implementation & Match Display Hardening Milestone` |
| `246712a` | 2026-11-18 | Antigravity | `Phase 5 Core Auth & Server-Side Security Remediation Baseline` |
| `91811ed` | 2026-11-17 | Product Owner | `Phase 3 Product Rationalisation & UX Discovery Official Sign-off` |
| `acff832` | 2026-11-16 | — | Historical audit baseline commit (Found NO-GO with 20+ defects) |

---

## 4. Technical Debt Register

| Debt ID | Priority | Module | Description & Proposed Remediation |
|---|---|---|---|
| **TD-01** | Medium | `hooks/useStore.ts` | **Store Monolith:** `useStore.ts` is ~2,778 lines and returns a 110-property object literal on every render. Plan: extract domain slices (matches, finance, studio) or adopt Zustand/Jotai in Phase 11. |
| **TD-02** | Low | `firestore.rules` | **Unused Rule Helpers:** Compiler emits warnings for unused helpers `isVerified` and `isValidPlayer`. Plan: clean up unused helper declarations during Phase 12 security audit. |
| **TD-03** | Low | `next.config.ts` | **Build Error Suppression Flags:** `ignoreBuildErrors: true` and `ignoreDuringBuilds: true` were historically set. Zero new TS errors exist, but 15 legacy errors remain in unrefactored tabs (e.g. `ShopTab.tsx`, `RazorReportView.tsx`). Plan: resolve the 15 legacy type errors and remove suppression flags. |
| **TD-04** | Low | `components/MatchesTab.tsx` | **Monolithic Legacy Component:** While `PlayerMatchCenter.tsx` replaced the player match experience, the admin `MatchesTab.tsx` remains ~3,700 lines. Plan: decompose in Phase 8 (Match Operations & Admin Hubs). |

---

## 5. Open Owner Decisions & Next Implementation Steps

| ID | Item | Current State | Required Action |
|---|---|---|---|
| **OD-01** | **Staging Environment Provisioning** | Production is live at `https://play.kavachcricket.com`. Development database `kavach-play-db-ext` has been refreshed, but no deployed staging URL exists. | Product owner to confirm whether an Amplify staging branch or preview channel should be deployed for Phase 7 live testing. |
| **OD-02** | **Production Cutover Plan** | Modernized features on `mig-mov` must eventually be merged to `main` without interrupting live club operations or payments. | Agree on zero-downtime cutover strategy and database migration runbook. |
| **OD-03** | **Player Navigation Alignment** | Owner approved direction is 3 primary items (`Home`, `Club`, `Matches`) with Profile in Header Avatar. Code currently runs 5 items (`Home`, `Matches`, `Finance`, `Players`, `More`) on mobile, and 6 on desktop. | Owner approval to plan navigation alignment task restructuring bottom nav and desktop links to the 3-item model. |
| **OD-04** | **Admin Role Consolidation Transition** | Owner approved direction is 3 active roles (`Super Admin`, `Club Admin`, `Finance Admin`), consolidating Match Admin, Studio Admin, and Designer into Club Admin. Code and rules currently enforce 6 granular roles. | Owner approval to plan rules and code refactoring task consolidating `isMatchAdmin`, `isStudioAdmin`, and `isDesigner` into `isClubAdmin`. |
