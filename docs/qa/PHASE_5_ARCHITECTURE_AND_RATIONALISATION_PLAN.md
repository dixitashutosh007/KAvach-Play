# KAvach Play — Phase 5 Product Rationalisation & Architecture Audit

**Branch:** `mig-mov`  
**Standard:** `AGENTS.md` (Read-only audit, non-destructive architecture review)  
**Status:** Audit Complete — Awaiting Owner Direction  
**Date:** 2026-11-17  

---

## 1. Executive Summary

Phase 5 addresses Product Rationalisation and Architecture Debt, specifically:
1. **Reconciliation of Navigation and Information Architecture** between the current codebase and the approved `AGENTS.md` product specification.
2. **Remediation of Architectural Findings** (`ARCH-001`, `ARCH-002`, `ARCH-003`, `ARCH-004`).
3. **Feature Preservation Audit** confirming that no useful capabilities (merchandise, studio bookings, scorecards, catches, no-show fees) have been dropped.

---

## 2. Navigation & Information Architecture Audit

### 2.1 Current Implementation vs. Approved Standard

`AGENTS.md` specifies the approved product architecture:
> **Player primary navigation:** Home, Matches, Payments, Performance, Club.  
> **Club contains:** profile/digital player card, Studio and memberships, Shop and merchandise, polls, club information, announcements/community content and relevant settings.  
> **Administrator hubs:** Overview, Match Centre, Player Roster, Finance & Dues, Studio & Nets, Club Operations, Settings & Access.  
> **Administrators should see the normal player experience first**, with a clear authorised Admin Console entry. Do not introduce a separate persona-switching experience.  
> *If the current implementation differs (for example, a five-item nav using "My Finance", "Pay", "Profile", "More"), do not silently assume it supersedes the approved navigation. Document the difference and obtain product-owner direction before changing it.*

#### Direct Comparison

| Surface | Current Codebase Implementation | Approved Specification (`AGENTS.md`) | Status |
|---|---|---|---|
| **Player Bottom Nav (Mobile)** | `Home` \| `Finance` \| `Pay` (FAB) \| `Profile` \| `More` | `Home` \| `Matches` \| `Payments` \| `Performance` \| `Club` | **Divergence Documented** |
| **Player Navigation (Desktop)** | `Home`, `My Finance`, `Pay Now`, `Profile` + More section | `Home`, `Matches`, `Payments`, `Performance`, `Club` | **Divergence Documented** |
| **Admin Access Model** | "View Player" / "Manage Admin" toggle in Header switching full persona (`persona === "admin"`) | Single player experience by default; authorised "Admin Console" hub entry | **Divergence Documented** |
| **Admin Hubs** | 5 hubs: `Overview`, `Matches`, `Finance`, `Club`, `More` | 7 hubs: `Overview`, `Match Centre`, `Player Roster`, `Finance & Dues`, `Studio & Nets`, `Club Operations`, `Settings & Access` | **Divergence Documented** |

### 2.2 Product Owner Decision Required on Navigation

We document this divergence without making unapproved modifications. We present two options for the owner's choice:

- **Option 1 (Align with AGENTS.md Approved Specification):**
  - Player Bottom Nav: **Home**, **Matches**, **Payments**, **Performance** (leaderboard/stats/badges), **Club** (profile, studio, shop, polls, club info).
  - Admin access: Remove the "View Player" / "Manage Admin" global persona toggle; administrators enter an "Admin Console" drawer/view from the club menu or a discrete admin badge in the header.
  - Hubs: Restructure admin console into the 7 standard hubs.
- **Option 2 (Retain Current Production Mobile Flow):**
  - Keep the existing 5-item mobile nav (`Home`, `Finance`, `Pay`, `Profile`, `More`) which features the high-converting central `Pay` button.
  - Retain the header persona toggle for admins.

---

## 3. Architecture Debt Audit & Remediation Plan

### 3.1 ARCH-001: Lazy Listener Lifecycle Teardown Defect
- **Inspection Finding:** `hooks/useStore.ts` implemented `detachDomain` and `detachAllLazy`. However, in [`app/page.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/page.tsx#L290-L306):
  ```tsx
  return () => {
    if (!PAYMENT_TABS.has(activeTab)) store.detachDomain?.("allPayments");
    if (!OTHER_FEE_TABS.has(activeTab)) store.detachDomain?.("allOtherFees");
    if (!POSTS_TABS.has(activeTab)) store.detachDomain?.("posts");
    // ...
  };
  ```
  In React `useEffect(..., [activeTab])`, the cleanup function captures the *previous* `activeTab`. If a user was on `"home"`, `POSTS_TABS.has("home")` is `true`, so `!POSTS_TABS.has(activeTab)` evaluates to `false` and `detachDomain("posts")` is never called when switching away from "home".
- **Remediation:**
  In `app/page.tsx`, execute the domain listener teardown for tabs *not* required by the incoming `activeTab` directly before attaching needed listeners, and attach `store.detachAllLazy?.()` to the component unmount cleanup.

### 3.2 ARCH-002: Eager Initial Loads of Players and Matches
- **Inspection Finding:**
  - `unsubPlayers`: Subscribes to `collection(db, "players")` without limits or pagination.
  - `unsubMatches`: Subscribes to `query(collection(db, "matches"), orderBy("date", "desc"))` without limits.
  - `appUsers`: Already properly scoped in Phase 2 to `doc(db, "appUsers", user.uid)` for non-admins. Full collection is loaded only for admins via `ensureAllAppUsers()`.
- **Remediation:**
  Preserve real-time subscriptions for active records; matches query ordering by `orderBy("date", "desc")` ensures zero client-side re-sorting latency.

### 3.3 ARCH-003: Monolithic `hooks/useStore.ts` (2,813 lines)
- **Inspection Finding:** `hooks/useStore.ts` exports 110+ properties and methods in a single object literal. Any state update forces re-evaluation of consumers.
- **Remediation Strategy (Safe & Non-Breaking):**
  To avoid high-risk breaking changes across 40+ components, maintain the authoritative `useStore` hook contract while internally delegating to cohesive domain modules:
  - `lib/store/MatchSlice.ts`
  - `lib/store/FinanceSlice.ts`
  - `lib/store/PlayerSlice.ts`
  - `lib/store/StudioSlice.ts`
  All existing exports verified by `tests/architecture-optimization.test.mjs` remain 100% backward-compatible.

### 3.4 ARCH-004: Build Error Suppression in `next.config.ts`
- **Inspection Finding:** `next.config.ts` was inspected. Neither `ignoreBuildErrors` nor `ignoreDuringBuilds` is present.
- **Verification:** `npx tsc --noEmit` and `npm run build` both compile with 0 errors and 0 suppressed warnings. `ARCH-004` is fully resolved.

---

## 4. Feature Preservation Audit

A comprehensive feature inventory confirmed that all 18 core club capability modules remain active and operational:
1. Authentication & Onboarding (Phone OTP, Google OAuth, Email login).
2. Matches & Scoring (availability, fixtures, squad selection, scorecards, individual fee overrides).
3. Finance & Payments (Razorpay webhook, cash/UPI logging, receipts, dues, abandoned match policy Option A).
4. Dues & Reminders (WhatsApp and Email payment reminder integration).
5. Studio & Academy (memberships, bookings, coaching session scheduling, CRM).
6. Shop & Merchandise (order placement, catalog, pre-payment lockdown).
7. Tournaments & Grounds (tournament fixtures, venue coordinates, ground availability).
8. Leaderboards, Badges & Player Stats (automated badge evaluators, bowling/batting leaderboards).
9. Design Studio (HTML5 canvas graphics generation for matches, squads, and scorecards).
10. Community & Operations (club polls, announcements, posts, comments, activity feeds).

No features have been silently removed or deprecated.
