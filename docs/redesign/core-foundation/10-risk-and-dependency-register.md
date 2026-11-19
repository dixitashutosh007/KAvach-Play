# KAvach Play — Core Foundation Audit
## Document 10: Risk, Vulnerability & Dependency Register (Evidence-Backed)

**Document Type:** Risk Governance & System Dependency Register  
**Status:** Revised Audit Baseline with Source-Level Evidence (Assignment 2)  
**Date:** November 2026  
**Application:** https://play.kavachcricket.com  
**Authoritative References:** `AGENTS.md`, `lib/player-dues.ts`, `lib/server-auth.ts`, `hooks/useStore.ts`, `app/api/*`

---

## 1. Executive Summary

This register catalogs the technical, financial, identity, and operational risks identified in KAvach Play. Each finding distinguishes between **Verified Mitigated Vulnerabilities** and **Unresolved Deficiencies**, specifies the exact source code location, and assigns a recommended remediation phase within the approved 4-phase master roadmap.

---

## 2. Risk Matrix & Catalog

| Risk ID | Category | Description & Source Location | Severity | Likelihood | Verified Status | Remediation Phase |
|---|---|---|---|---|---|---|
| **FIN-001** | Financial / Security | Client-side amount tampering during Razorpay order generation. `app/api/razorpay/order/route.ts:91-96`. | **P0** | High | **VERIFIED MITIGATED:** Server independently queries Firestore via `derivePayableAmount`; client amount is discarded. | Completed |
| **SEC-001** | Security / Auth | Privilege escalation via client self-write to `appUsers/{uid}` role fields. `firestore.rules:125, 133` and `lib/server-auth.ts:298-340`. | **P0** | High | **VERIFIED MITIGATED:** Rule blocks client writes to role/admin fields; server enforces custom claim `{ admin: true }`. | Completed |
| **SEC-002** | Financial / Security | Player self-marking match payment as `Paid`. `firestore.rules:580-590`. | **P0** | High | **VERIFIED MITIGATED:** Rules enforce `incoming().status in ['Unpaid', 'Not Playing']` for player writes. | Completed |
| **FIN-008** | Financial | Dues calculation divergence between Home (`lib/player-dues.ts`) and Dues Tab (`components/DuesAndRemindersTab.tsx:695-775`). | **P1** | High | **UNRESOLVED:** DuesTab calculates un-persisted "virtual late fees" inline, causing total dues discrepancy across screens. | **Phase 1 (Core Foundation)** |
| **FIN-009** | Financial | Partial payments ignored in dues logic. `lib/player-dues.ts:55-70`. | **P1** | Med | **UNRESOLVED:** `calculatePlayerDues` charges full fee if status is `Unpaid`, ignoring `feeCollectedAmount`. | **Phase 1 (Core Foundation)** |
| **UX-001** | UX / Ergonomic | Header collision at 360px–390px viewports. `app/page.tsx:673-760`. | **P1** | High | **UNRESOLVED:** Logo and club title collide with Admin button and notification bell on small screens. | **Phase 1 (Core Foundation)** |
| **UX-003** | UX / Brand | Dark-green gradient flash on load. `components/LoadingScreen.tsx:12`. | **P2** | High | **UNRESOLVED:** Flashes dark green (`#064e3b`) before light theme renders. | **Phase 1 (Core Foundation)** |
| **UX-005** | Accessibility / UX | Touch targets < 44px on pitch-side controls. `components/MatchesTab.tsx:1420-1460, 2880-2910`. | **P2** | High | **UNRESOLVED:** RSVP pills (32px) and attendance toggles (30px) violate WCAG 2.5.5. | **Phase 1 (Core Foundation)** |
| **ARCH-001** | Architecture / Performance | Eager unbounded collection streaming in `hooks/useStore.ts:433, 453`. | **P2** | High | **UNRESOLVED:** Eagerly loads all historical matches and all players on initial login. | **Phase 1 & Phase 2** |
| **ARCH-002** | Architecture | Inactive lazy listeners retained in memory until logout. `hooks/useStore.ts:503-515`. | **P2** | Med | **UNRESOLVED:** Visiting Studio once keeps `subscriptionHistory` listener active indefinitely. | **Phase 1 (Core Foundation)** |
| **POL-001** | Policy / Financial | Undefined financial policy for Cancelled, Postponed, and Partial matches. `lib/matchBillable.ts:4`. | **P1** | Med | **UNRESOLVED:** Currently treats Cancelled matches as billable if fee > 0. | **Requires Product Owner Approval** |

---

## 3. Explicit List of Verified versus Unverified Findings

### 3.1 Verified Source-Level Facts (Proven by Code Inspection)
1. **Design Tokens:** Current codebase uses `#A30F2D` and dark-green surfaces in various files; approved tokens are Deep Wine `#7A1E2B`, Scarlet `#C0394B`, Dusty Red `#E76B73`, Muted Gold `#D6A84F`, Warm White `#FFF6F4`, Soft Blush `#F8EDEE`, White `#FFFFFF`, Charcoal `#29252A`.
2. **Eager Subscriptions in `hooks/useStore.ts`:** Lines 404 (self appUser), 433 (all players), 453 (all matches), and 482 (notifications) stream eagerly on every user login.
3. **Dues Calculation Divergence:** `app/page.tsx:811` and `HomeTab.tsx:196` call `calculatePlayerDues`, whereas `DuesAndRemindersTab.tsx:695-775` executes an inline loop adding virtual late fees.
4. **Partial Payment Oversight:** `lib/player-dues.ts:65` charges full `match.fee` whenever `payment.status === "Unpaid"`, disregarding `feeCollectedAmount`.
5. **Abandoned Match Reconcile:** `app/api/admin/reconcile-abandoned/route.ts:63, 71` enforces Option A (waives unpaid, preserves paid) specifically for `match.result === "Abandoned"`. It does not handle `Cancelled` or `Postponed` matches.
6. **Mobile Header Collision:** `app/page.tsx:673-760` flex container crowds 4 interactive buttons and club title into a single row on 360px viewports.

### 3.2 Unverified Assumptions Corrected
1. **Admin Navigation Taxonomy:** Previously assumed a 5-item admin mobile nav was finalized. **Correction:** Product owner confirmed taxonomy is NOT yet approved; recommendation provided; final approval deferred to Phase 3.
2. **Player Navigation & Profile Role:** Previously treated Profile and Payments as potentially overlapping. **Correction:** Player Profile is the central personal information hub (overview, stats, memberships, complete payment/activity history); Finance is the separate, actionable payment screen for dues settlement.
3. **Master Sequence:** Previously proposed a 6-stage sequence. **Correction:** Standardized strictly to the approved 4 phases: Phase 1 (Core Foundation), Phase 2 (Player Mobile), Phase 3 (Admin Mobile), Phase 4 (Admin Desktop).
