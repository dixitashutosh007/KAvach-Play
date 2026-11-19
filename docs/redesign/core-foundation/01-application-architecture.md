# KAvach Play — Core Foundation Audit
## Document 01: Application Architecture & Source-Level Technical Inventory

**Document Type:** Technical Architecture Audit & Dependency Inventory  
**Status:** Revised Audit Baseline with Source-Level Evidence (Assignment 2)  
**Date:** November 2026  
**Application:** https://play.kavachcricket.com  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Current Baseline Commit:** `4cac1e9` (Branch: `security/remediation-1f-a`)

---

## 1. Executive Summary

This document provides a factual, source-code-evidenced architectural audit of KAvach Play. It identifies exact Firestore subscriptions in `hooks/useStore.ts`, maps component dependencies to subscriptions, categorizes eager versus lazy listeners, details server route implementations, and isolates performance bottlenecks to prepare for the approved 4-phase modernization roadmap.

---

## 2. Runtime Topology & Framework Stack

| Component / Layer | Package & Exact Version | Implementation Details | Verified Source File |
|---|---|---|---|
| **Framework** | Next.js 15.0.0 (`next`) | App Router architecture with Turbopack support (`next dev --turbopack`). | `package.json:28` |
| **View Layer** | React 19.0.0-rc-65a0b1a-20241020 | React 19 Release Candidate with Server Components (RSC) and Client Components (`"use client"`). | `package.json:29` |
| **DOM Engine** | React DOM 19.0.0-rc | Concurrent rendering with streaming hydration. | `package.json:30` |
| **Styling** | Tailwind CSS 4.1.11 | PostCSS-driven atomic CSS engine with `@tailwindcss/postcss`. | `package.json:44` |
| **Icons** | Lucide React 0.454.0 | Standardized SVG icons across mobile and desktop interfaces. | `package.json:31` |
| **Animation** | Motion 11.11.11 (`framer-motion`) | Spring physics and animated transitions for drawers and tabs. | `package.json:32` |
| **Database** | Google Cloud Firestore | NoSQL document database utilizing root collections and subcollections. | `firebase-applet-config.json` |
| **Client SDK** | `firebase` 12.13.0 | Client-side reactive Firestore subscriptions and offline cache. | `package.json:25` |
| **Admin SDK** | `firebase-admin` 12.6.0 / 14.0.0 | Server-side elevated privileges in Next.js Route Handlers. | `package.json:26` |
| **Payment Gateway**| `razorpay` 2.9.6 | Server-side order creation and inbound HMAC webhook settlement. | `package.json:33` |
| **Email Gateway** | `nodemailer` 9.0.0 | Asynchronous SMTP notifications for dues and fixtures. | `package.json:34` |

---

## 3. Firestore Subscriptions Audit in `hooks/useStore.ts`

The custom React hook `useStore()` in `hooks/useStore.ts` manages all client-side Firestore data streaming. A deep source inspection reveals 18 distinct `onSnapshot` listeners, divided into **4 Eager Global Listeners** and **14 Lazy Domain Listeners**:

### 3.1 Eager Global Subscriptions (Initialized on User Login)

These listeners are initiated unconditionally inside the primary `useEffect` hook (`hooks/useStore.ts:390-500`) as soon as a Firebase user is authenticated:

| Subscription Name | Source Code Line | Target Firestore Path / Query | Consuming Components & Screens | Performance & Read Quota Impact |
|---|---|---|---|---|
| **`unsubAppUsers`** | `hooks/useStore.ts:404-420` | `doc(db, "appUsers", user.uid)` | `app/page.tsx` (role check, header avatar, profile binding). | **Low:** Single document listener. Reads 1 doc on auth state change. |
| **`unsubPlayers`** | `hooks/useStore.ts:433-450` | `collection(db, "players")` | `app/page.tsx`, `HomeTab.tsx`, `MatchesTab.tsx`, `PlayersTab.tsx`, `LeaderboardTab.tsx`. | **CRITICAL READ CONCERN:** Eagerly fetches and listens to the **entire club player roster** for every user on app load, even if the user only views their own profile. For a 150-player club, this costs 150 reads per login. |
| **`unsubMatches`** | `hooks/useStore.ts:453-475` | `query(collection(db, "matches"), orderBy("date", "desc"))` | `HomeTab.tsx`, `MatchesTab.tsx`, `DuesAndRemindersTab.tsx`, `FinanceTab.tsx`. | **CRITICAL READ CONCERN:** Eagerly streams **every historical match fixture** from the beginning of time. As the club plays 40+ matches a year, this listener reads hundreds of docs on every login, causing memory inflation on mobile devices. |
| **`unsubNotifications`** | `hooks/useStore.ts:482-500` | `query(collection(db, "notifications"), limit(20))` | Top app header (`app/page.tsx:723`), `NotificationsTab.tsx`. | **Low:** Properly bounded by `limit(20)`. |

---

### 3.2 Lazy Domain Subscriptions (Initialized On-Demand)

These listeners are initialized via explicit callback functions (`ensureX()`) and tracked in a component ref `lazySubsRef` to prevent duplicate attachment:

| Callback Function | Source Code Line | Target Firestore Path / Query | Triggering Screen / Component | Eager vs. Lazy Assessment |
|---|---|---|---|---|
| **`ensurePayments`** | `hooks/useStore.ts:580-595` | `collectionGroup(db, "payments")` (filtered by `playerId` for players; unfiltered for admins) | Triggered when opening `DuesAndRemindersTab`, `FinanceTab`, or calculating dues. | **Lazy:** Properly deferred, but collection-group query over all payments for admins reads thousands of historical payments. |
| **`ensureMatchPayments`**| `hooks/useStore.ts:598-615`| `collection(db, "matches", matchId, "payments")` | `MatchSheetView.tsx`, `MatchesTab.tsx` (when expanding match card). | **Lazy:** Scoped to single match; excellent design pattern. |
| **`ensurePosts`** | `hooks/useStore.ts:623-635` | `collection(db, "posts")` | `HomeTab.tsx` (social feed section). | **Lazy:** Called when HomeTab mounts. |
| **`ensurePlayerStats`** | `hooks/useStore.ts:639-650` | `collection(db, "playerStats")` | `LeaderboardTab.tsx`. | **Lazy:** Properly deferred until user opens Performance/Leaderboard tab. |
| **`ensureMerchOrders`** | `hooks/useStore.ts:653-664` | `collection(db, "merchOrders")` | `ShopTab.tsx`. | **Lazy:** Deferred until Shop tab is visited. |
| **`ensurePolls`** | `hooks/useStore.ts:667-678` | `collection(db, "polls")` | `OpinionTab.tsx`. | **Lazy:** Deferred until Opinion tab is visited. |
| **`ensurePollResponses`**| `hooks/useStore.ts:681-692`| `collection(db, "pollResponses")` | `OpinionTab.tsx`. | **Lazy:** Deferred until Opinion tab is visited. |
| **`ensureBadges`** | `hooks/useStore.ts:695-705` | `collection(db, "badges")` | `LeaderboardTab.tsx`, `BadgesTab.tsx`. | **Lazy:** Deferred until badges evaluated. |
| **`ensureBadgeTypeDefs`**| `hooks/useStore.ts:754-765`| `collection(db, "badgeTypes")` | `BadgesTab.tsx`. | **Lazy:** Deferred. |
| **`ensureOtherFees`** | `hooks/useStore.ts:933-945` | `collectionGroup(db, "otherFees")` | `DuesAndRemindersTab.tsx`, `FinanceTab.tsx`. | **Lazy:** Deferred until finance view is rendered. |
| **`ensureAllAppUsers`** | `hooks/useStore.ts:949-965` | `collection(db, "appUsers")` | Admin `PlayersTab.tsx`, `SettingsTab.tsx`. | **Lazy:** Restricts sensitive user PII from ordinary players. |
| **`ensureSubscriptionHistory`**| `hooks/useStore.ts:969-980`| `collection(db, "subscriptionHistory")` | `StudioTab.tsx`, `StudioAdminTab.tsx`. | **Lazy:** Deferred until Studio tab visited. |
| **`ensureOutOfPlays`** | `hooks/useStore.ts:1056-1068`| `collection(db, "outOfPlays")` | `MatchesTab.tsx` (squad availability). | **Lazy:** Deferred. |
| **`ensureLeads`** | `hooks/useStore.ts:1072-1085`| `collection(db, "clubLeads")` | `components/studio/StudioCRMView.tsx`. | **Lazy:** Deferred to Studio CRM. |

---

### 3.3 One-Off Snapshot Fetches (`getDocs`)

Several metadata collections are fetched once via `getDocs` rather than retaining active listeners:
- `grounds`: `hooks/useStore.ts:423, 865`
- `tournaments`: `hooks/useStore.ts:874`
- `subscriptionPlans`: `hooks/useStore.ts:885`
- `feeTemplates`: `hooks/useStore.ts:896`
- `feePlans`: `hooks/useStore.ts:907`
- `merchandises`: `hooks/useStore.ts:918`
- `appConfig`: `hooks/useStore.ts:362`

---

## 4. Architectural Bottlenecks & Evidence

1. **Eager Global Matches Listener (`hooks/useStore.ts:453`):**
   - **Verified Behavior:** Every user login opens an unbounded Firestore listener across the entire `matches` collection ordered by date descending.
   - **Business Impact:** High mobile memory usage, prolonged hydration delay on 4G pitch-side connections, and elevated Firestore read costs ($0.06 per 100,000 reads adds up rapidly as matches accumulate).
   - **Remediation Phase:** Phase 1 / Phase 2 (bound matches query to recent 20 matches + on-demand pagination).
2. **Monolithic Store State Retention (`hooks/useStore.ts`):**
   - **Verified Behavior:** Once lazy listeners attach (e.g., `merchOrders`, `allSubscriptionHistory`), they remain active in memory until the user completely logs out or refreshes the page (`hooks/useStore.ts:503-515`). Navigating away from the Studio tab does not detach the `subscriptionHistory` listener.
   - **Business Impact:** Client memory retention on low-end mobile phones during long matchday sessions.
   - **Remediation Phase:** Phase 1 Core Foundation (lifecycle detachment when tab unmounts).
