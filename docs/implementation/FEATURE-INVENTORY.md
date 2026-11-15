# KAVACH PLAY — Feature & Module Inventory

**Phase**: 0 (Discovery & Verification)
**Date**: 2026-11-15
**Git SHA**: `f5739726e75a2e6594c7379bdbfc8a866c63f787`

---

## Module Registry

### MOD-01: Authentication & Onboarding

| Field | Detail |
|-------|--------|
| **Files** | `components/auth/LoginScreen.tsx`, `components/PhoneLoginForm.tsx`, `components/onboarding/RegistrationForm.tsx`, `components/onboarding/PendingApprovalScreen.tsx`, `components/onboarding/AccountDisabledScreen.tsx`, `components/onboarding/RejectedScreen.tsx`, `components/onboarding/QuotaExceededScreen.tsx`, `components/onboarding/PhoneSyncPrompt.tsx` |
| **Auth Methods** | Firebase Phone OTP (primary), Google OAuth (secondary) |
| **Firestore Collections** | `appUsers/{uid}`, `players/{playerId}` |
| **Data Dependencies** | `appUsers` (auth state), `players` (profile), `appConfig` (club settings) |
| **Roles** | All users |
| **Issues** | Dual-identity architecture (appUsers + players) with 21 duplicated fields |

### MOD-02: Home Tab

| Field | Detail |
|-------|--------|
| **Files** | `components/HomeTab.tsx` (1,044 lines) |
| **Firestore Collections** | `matches`, `players`, `appConfig` |
| **Data Dependencies** | Matches, payments (via ensurePayments), grounds, players |
| **Roles** | Player + Admin |
| **Issues** | Auto-triggers ensurePayments on login (CRIT-03) |

### MOD-03: Matches & Scoring

| Field | Detail |
|-------|--------|
| **Files** | `components/MatchesTab.tsx` (5,185 lines) |
| **Firestore Collections** | `matches/{matchId}`, `matches/{matchId}/payments/{paymentId}`, `matches/{matchId}/comments/{commentId}`, `players`, `grounds` |
| **Data Dependencies** | Matches, payments (per-match + global), players, grounds |
| **Roles** | Player (view), MatchAdmin (create/edit/score), FinanceAdmin (fees) |
| **Issues** | Largest monolith in codebase. FIN-01 gross value calculation bug. |

### MOD-04: Finance & Payments

| Field | Detail |
|-------|--------|
| **Files** | `components/FinanceTab.tsx` (1,635 lines), `components/AssignFeesAdmin.tsx` (612 lines), `components/CreateFeeAdmin.tsx`, `components/FeePlansAdmin.tsx`, `components/PlansView.tsx`, `components/RazorReportView.tsx` |
| **Firestore Collections** | `matches/*/payments`, `players/*/otherFees`, `feeTemplates`, `feePlans`, `razorpayIntents` |
| **API Routes** | `/api/razorpay/order`, `/api/razorpay/webhook` |
| **Data Dependencies** | Payments (global), otherFees (global), players, matches, feeTemplates, feePlans |
| **Roles** | Player (own dues), FinanceAdmin (all finance), SuperAdmin |
| **Issues** | CRIT-04 abandoned match billing. FIN-02 inflated collections. FIN-03 interrupted mobile workflow. |

### MOD-05: Dues & Reminders

| Field | Detail |
|-------|--------|
| **Files** | `components/DuesAndRemindersTab.tsx` (1,098 lines) |
| **Firestore Collections** | `matches/*/payments`, `players/*/otherFees`, `players` |
| **API Routes** | `/api/whatsapp/send`, `/api/email/send` |
| **Data Dependencies** | Payments (global), otherFees, players, matches |
| **Roles** | SuperAdmin, FinanceAdmin |
| **Issues** | CRIT-04 abandoned match billing gap |

### MOD-06: Player Payment Portal

| Field | Detail |
|-------|--------|
| **Files** | `app/pay/[playerId]/page.tsx`, `app/pay/[playerId]/PayClient.tsx` |
| **Data Dependencies** | Payments (global), otherFees (global), player |
| **API Routes** | `/api/razorpay/order` |
| **Roles** | Player (self) |
| **Issues** | CRIT-04 abandoned match billing gap. CRIT-03 data exposure. |

### MOD-07: Admin Dashboard

| Field | Detail |
|-------|--------|
| **Files** | `components/AdminDashboard.tsx` (1,233 lines) |
| **Data Dependencies** | Payments (global), otherFees, matches, players |
| **Roles** | SuperAdmin, FinanceAdmin |
| **Issues** | Only component that correctly filters abandoned matches from dues |

### MOD-08: Player Management

| Field | Detail |
|-------|--------|
| **Files** | `components/PlayersTab.tsx` (1,022 lines), `components/EditPlayerInline.tsx` (653 lines), `components/DuplicatePlayersReport.tsx` |
| **Firestore Collections** | `players`, `appUsers` |
| **API Routes** | `/api/admin/merge-players`, `/api/admin/generate-kavach-ids` |
| **Roles** | ClubAdmin, SuperAdmin |
| **Issues** | Dual identity management |

### MOD-09: Club Management

| Field | Detail |
|-------|--------|
| **Files** | `components/ClubTab.tsx` |
| **Firestore Collections** | `appConfig`, `grounds`, `players` |
| **Roles** | ClubAdmin, SuperAdmin |
| **Issues** | "Everything bucket" — combines grounds, players, club settings into one tab |

### MOD-10: Grounds Management

| Field | Detail |
|-------|--------|
| **Files** | `components/GroundsTab.tsx` |
| **Firestore Collections** | `grounds` |
| **Roles** | ClubAdmin, MatchAdmin |
| **Issues** | None critical |

### MOD-11: Settings & Configuration

| Field | Detail |
|-------|--------|
| **Files** | `components/SettingsTab.tsx` (1,672 lines) |
| **Firestore Collections** | `appConfig`, `admins` |
| **Data Dependencies** | appConfig (club branding, feature flags, API keys) |
| **Roles** | SuperAdmin |
| **Issues** | Second-largest component. Mixes UI settings, role management, API configuration. |

### MOD-12: Profile

| Field | Detail |
|-------|--------|
| **Files** | `components/ProfileTab.tsx` (1,109 lines) |
| **Firestore Collections** | `players`, `appUsers`, `badges` |
| **Roles** | Player (self) |
| **Issues** | Large monolith |

### MOD-13: Design Studio (Graphics)

| Field | Detail |
|-------|--------|
| **Files** | `components/DesignTab.tsx` (2,868 lines) |
| **Firestore Collections** | `matches`, `players`, `grounds`, `appConfig` |
| **Roles** | MatchAdmin, SuperAdmin |
| **Issues** | Second-largest monolith. HTML5 Canvas rendering. |

### MOD-14: Shop / Merchandise

| Field | Detail |
|-------|--------|
| **Files** | `components/ShopTab.tsx` (2,581 lines) |
| **Firestore Collections** | `merchandises`, `merchandiseOrders` |
| **Roles** | Player (browse/order), ClubAdmin (manage) |
| **Issues** | Third-largest monolith |

### MOD-15: Studio (Coaching/Academy)

| Field | Detail |
|-------|--------|
| **Files** | `components/StudioTab.tsx` (617 lines), `components/StudioAdminTab.tsx` (1,075 lines), `components/studio/StudioCRMView.tsx` (1,607 lines) |
| **Firestore Collections** | `studioSessions`, `studioStudents`, `subscriptionPlans`, `subscriptionHistory` |
| **API Routes** | `/api/whatsapp/remind-studio` |
| **Roles** | StudioAdmin, SuperAdmin |
| **Issues** | CRM view is a monolith (1,607 lines) |

### MOD-16: Badges & Leaderboard

| Field | Detail |
|-------|--------|
| **Files** | `components/BadgesTab.tsx` (896 lines), `components/BadgeIcon.tsx` (560 lines), `components/LeaderboardTab.tsx`, `components/StatsBadgeEvaluator.tsx` (586 lines), `components/TenureBadgeEvaluator.tsx` (608 lines) |
| **Firestore Collections** | `badges`, `players`, `matches` |
| **Roles** | Player (view), SuperAdmin (award) |
| **Issues** | None critical |

### MOD-17: Tournaments

| Field | Detail |
|-------|--------|
| **Files** | `components/TournamentsTab.tsx` (908 lines) |
| **Firestore Collections** | `tournaments` |
| **Roles** | MatchAdmin, SuperAdmin |
| **Issues** | None critical |

### MOD-18: Notifications, Opinions, Audit

| Field | Detail |
|-------|--------|
| **Sub-modules** | 18A: `components/NotificationsTab.tsx`, 18B: `components/OpinionTab.tsx`, 18C: `components/AuditLogTab.tsx` |
| **Firestore Collections** | `notifications`, `opinions`, (audit via lib) |
| **Roles** | Player (notifications/opinions), SuperAdmin (audit) |
| **Issues** | None critical |

### MOD-LEGACY: Wix Finance Import

| Field | Detail |
|-------|--------|
| **Files** | `components/WixFinanceView.tsx` (1,247 lines) |
| **Purpose** | Import historical data from Wix/Google Sheets |
| **Disposition** | RETIRE — migration tool, not a recurring feature |

### MOD-ORPHAN: Admin Tools

| Field | Detail |
|-------|--------|
| **Files** | `app/admin-tools/page.tsx` (454 lines) |
| **Purpose** | Standalone admin tools page |
| **Status** | Orphaned — not linked from any navigation |
| **Disposition** | INVESTIGATE — determine if functionality should be absorbed into Admin Dashboard |

---

## Data Dependency Matrix

| Module | matches | payments | otherFees | players | appUsers | grounds | appConfig | feeTemplates | feePlans |
|--------|---------|----------|-----------|---------|----------|---------|-----------|-------------|----------|
| MOD-01 Auth | | | | R/W | R/W | | R | | |
| MOD-02 Home | R | R | R | R | | R | R | | |
| MOD-03 Matches | R/W | R/W | | R | | R | | | |
| MOD-04 Finance | R | R/W | R/W | R | | | R | R/W | R/W |
| MOD-05 Dues | R | R | R | R | | | | | |
| MOD-06 PayPortal | R | R/W | R/W | R | | | | | |
| MOD-07 AdminDash | R | R | R | R | | | | | |
| MOD-08 Players | | | | R/W | R/W | | | | |
| MOD-09 Club | | | | R | | R/W | R/W | | |
| MOD-10 Grounds | | | | | | R/W | | | |
| MOD-11 Settings | | | | | | | R/W | | |
| MOD-12 Profile | | | | R/W | R/W | | | | |
| MOD-13 Design | R | | | R | | R | R | | |
| MOD-14 Shop | | | | R | | | R | | |
| MOD-15 Studio | | | | R | | | R | | |

**R** = Read, **W** = Write, **R/W** = Read + Write

---

## Firestore Collections Catalog (28 Collections)

| Collection | Type | Path | Disposition |
|------------|------|------|-------------|
| `appConfig` | Document | `appConfig/{key}` | KEEP |
| `appUsers` | Top-level | `appUsers/{uid}` | IMPROVE (consolidate with players) |
| `admins` | Top-level | `admins/{userId}` | KEEP |
| `players` | Top-level | `players/{playerId}` | IMPROVE (consolidate with appUsers) |
| `matches` | Top-level | `matches/{matchId}` | KEEP |
| `payments` | Subcollection | `matches/{matchId}/payments/{paymentId}` | KEEP |
| `comments` | Subcollection | `matches/{matchId}/comments/{commentId}` | KEEP |
| `otherFees` | Subcollection | `players/{playerId}/otherFees/{feeId}` | KEEP |
| `grounds` | Top-level | `grounds/{groundId}` | KEEP |
| `paymentLinks` | Top-level | `paymentLinks/{linkId}` | RETIRE (unused) |
| `feeTemplates` | Top-level | `feeTemplates/{templateId}` | KEEP |
| `feePlans` | Top-level | `feePlans/{planId}` | KEEP |
| `razorpayIntents` | Top-level | `razorpayIntents/{intentId}` | KEEP (server-only) |
| `merchandises` | Top-level | `merchandises/{merchandiseId}` | KEEP |
| `merchandiseOrders` | Top-level | `merchandiseOrders/{orderId}` | KEEP |
| `studioSessions` | Top-level | `studioSessions/{sessionId}` | KEEP |
| `studioStudents` | Top-level | `studioStudents/{studentId}` | KEEP |
| `subscriptionPlans` | Top-level | `subscriptionPlans/{planId}` | KEEP |
| `subscriptionHistory` | Top-level | `subscriptionHistory/{historyId}` | KEEP |
| `tournaments` | Top-level | `tournaments/{tournamentId}` | KEEP |
| `badges` | Top-level | `badges/{badgeId}` | KEEP |
| `notifications` | Top-level | `notifications/{notificationId}` | KEEP |
| `opinions` | Top-level | `opinions/{opinionId}` | KEEP |
| `lateFeeConfig` | Top-level | `lateFeeConfig/{configId}` | KEEP |
