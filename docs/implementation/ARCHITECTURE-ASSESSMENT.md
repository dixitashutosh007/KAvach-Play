# KAVACH PLAY — Architecture & Technical Debt Assessment

**Phase**: 0 (Discovery & Verification)
**Date**: 2026-11-15
**Git SHA**: `f5739726e75a2e6594c7379bdbfc8a866c63f787`

---

## 1. Application Architecture

### Pattern: Client-Side SPA with Server API Routes

The entire application is a single-page React application rendered client-side:

- `app/page.tsx` (1,299 lines) wraps everything in `"use client"` and manages all tab navigation via `activeTab` state.
- There is no server-side rendering for authenticated views.
- All data flows through `hooks/useStore.ts` (2,737 lines) which maintains 14+ real-time Firestore `onSnapshot` subscriptions in a single hook.
- API routes (`app/api/`) handle server-side operations: Razorpay payment processing, WhatsApp messaging, email sending, and admin operations.

### State Management

**Single Global Store** (`hooks/useStore.ts`):
- 2,737 lines in a single file
- 14+ active Firestore `onSnapshot` real-time listeners
- Two unbounded `collectionGroup` queries (payments, otherFees) — see CRIT-03
- Lazy subscription pattern with `lazySubsRef` map
- All state is in-memory; no persistence layer beyond Firestore

**Risks**:
- Memory pressure from holding entire club financial history in browser (CRIT-03)
- No state isolation between modules — a bug in one subscription can cascade
- Difficult to test — the store cannot be instantiated without Firebase

### Authentication Architecture

**Dual-Identity Pattern**:
- `appUsers/{uid}` — Firebase Authentication identity (auth UID is key)
- `players/{playerId}` — Domain identity (auto-generated Firestore ID is key)
- 21 fields duplicated between the two documents
- Auto-reactivation on sign-in for deactivated players (`app/page.tsx` lines 522–524)

**Token Management**:
- `authedFetch` wrapper (`lib/authed-fetch.ts`) attaches Firebase ID token to all API calls
- WhatsApp access token is server-side only (env var `WHATSAPP_ACCESS_TOKEN`), correctly not stored in Firestore
- `updateAppConfig` strips secret fields before writing to Firestore

### Payment Architecture

- **Client**: Creates Razorpay order via `/api/razorpay/order`, opens Razorpay checkout
- **Server**: `/api/razorpay/webhook` receives payment confirmation from Razorpay
- **Client**: On success callback, updates payment status in Firestore (CRIT-01 vulnerability enables this without admin rights)
- **Gap**: Late fee documents created in client callback, not server-side (FIN-03)

---

## 2. Technical Debt Register

### TD-01: Monolith Component Files

15 files exceed 1,000 lines, totaling 27,452 lines (64.1% of frontend code).

| File | Lines | Proposed Decomposition |
|------|-------|----------------------|
| `MatchesTab.tsx` | 5,185 | Split into: MatchList, MatchDetail, MatchScoring, SquadSelection, MatchFinancials |
| `DesignTab.tsx` | 2,868 | Split into: DesignCanvas, DesignTemplates, DesignExport |
| `useStore.ts` | 2,737 | Split into: useAuthStore, useMatchStore, usePaymentStore, usePlayerStore, etc. |
| `ShopTab.tsx` | 2,581 | Split into: ProductCatalog, ProductDetail, OrderManagement |
| `SettingsTab.tsx` | 1,672 | Split into: BrandingSettings, RoleSettings, APISettings, FeatureFlags |
| `FinanceTab.tsx` | 1,635 | Split into: PlayerFinanceView, AdminFinanceReport, PaymentManagement |
| `StudioCRMView.tsx` | 1,607 | Split into: StudentList, StudentDetail, SessionTracking |
| `page.tsx` | 1,299 | Extract: TabRouter, OnboardingFlow, AutoReactivation |
| `WixFinanceView.tsx` | 1,247 | RETIRE after Phase 2 data migration |
| `AdminDashboard.tsx` | 1,233 | Split into: KPICards, DuesBreakdown, RecentActivity |
| `ProfileTab.tsx` | 1,109 | Split into: ProfileView, ProfileEdit, StatsDisplay |
| `DuesAndRemindersTab.tsx` | 1,098 | Split into: DuesTable, ReminderComposer, DuesReport |
| `StudioAdminTab.tsx` | 1,075 | Split into: SessionScheduler, StudentManager, Reports |
| `HomeTab.tsx` | 1,044 | Split into: NextMatchCard, RecentResults, AdminWidgets |
| `PlayersTab.tsx` | 1,022 | Split into: PlayerList, PlayerSearch, PlayerBulkActions |

### TD-02: Native Browser Popups (187 Total)

| Type | Count |
|------|-------|
| `alert()` | 155 |
| `confirm()` | 32 |
| **Total** | **187** |

These provide no styling, no accessibility, and block the main thread. Should be replaced with a reusable modal/toast component.

### TD-03: Unused Dependencies

| Package | Location | Action |
|---------|----------|--------|
| `class-variance-authority` (^0.7.1) | `dependencies` | REMOVE — zero imports found |
| `tw-animate-css` (^1.4.0) | `devDependencies` | REMOVE — zero imports found |

### TD-04: React Release Candidate

React `19.0.0-rc-65a56d0e-20241020` is a release candidate, not a stable release. This was appropriate during initial development but should be upgraded to stable React 19 when available.

### TD-05: Orphaned Route

`app/admin-tools/page.tsx` (454 lines) is a standalone page not linked from any navigation. Its functionality may overlap with `AdminDashboard.tsx`.

### TD-06: No CI/CD Pipeline

No `.github/workflows/` directory, no `vercel.json` with build checks, no automated test execution on push/PR.

### TD-07: Shared Firestore Rules File

Both Firestore databases (`ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412` and `kavach-play-db-ext`) share the same `firestore.rules` file. This means a rules change for one database affects both.

### TD-08: Ghost Role — `isDesigner`

A check for `isDesigner` appears in security rules but has no corresponding UI or assignment mechanism. It is never assigned to users through the application.

---

## 3. Design System Assessment

### Current State

- **Theme**: Dark emerald green base with glassmorphism effects
- **CSS**: Tailwind CSS v4 with custom properties in `globals.css`
- **No design tokens system**: Colors defined inline throughout components
- **No component library**: Each component implements its own styling
- **Typography**: Not standardized

### Proposed Design Tokens (from Rationalisation Report)

| Token | Value | Purpose |
|-------|-------|---------|
| `--color-primary-brand` | `#A30F2D` | Brand identity |
| `--color-primary-action` | `#D51F43` | CTA buttons |
| `--color-bg-app` | `#F6F7F9` | Application background |
| `--color-surface-card` | `#FFFFFF` | Card surface |
| `--color-text-main` | `#171C26` | Primary typography |

### Icon System

- Lucide React (v0.454.0) used throughout
- No custom icon set
- Consistent usage pattern

---

## 4. Performance Concerns

| Concern | Impact | Severity |
|---------|--------|----------|
| Unbounded collectionGroup queries loading ~3,000+ docs per login | High Firestore costs + browser memory | HIGH |
| All 14+ onSnapshot listeners active simultaneously | Connection overhead + Firestore read costs | MEDIUM |
| No code splitting — all tab components bundled together | Large initial bundle size | MEDIUM |
| No image optimization for player avatars/logos | Slow load on mobile networks | LOW |
| 187 native popups blocking main thread | Poor UX on slow devices | LOW |

---

## 5. Security Architecture Summary

| Layer | Status | Issues |
|-------|--------|--------|
| Authentication | Firebase Phone + Google OAuth | Sound |
| Authorization (server) | Firebase Admin SDK in API routes | Sound |
| Authorization (client rules) | Firestore security rules | **CRITICAL** — CRIT-01, CRIT-02 |
| Data Access Control | Collection group rules | **HIGH** — CRIT-03 oversharing |
| API Key Management | Server-side env vars | Sound (WhatsApp token correctly server-only) |
| Input Validation | Firestore schema validators | Partial — `paymentLinks` has no validator |
| CORS/XSS | Next.js defaults | Standard |
