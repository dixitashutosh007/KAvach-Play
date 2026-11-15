# KAVACH PLAY — Repository Baseline Report

**Phase**: 0 (Discovery & Verification)
**Date**: 2026-11-15
**Branch**: `claude/app-review-understanding-kw86di`
**Git SHA**: `f5739726e75a2e6594c7379bdbfc8a866c63f787`
**Working Tree**: Clean (nothing to commit)
**Last Commit**: "Add player deactivation with auto-reactivation on sign-in"

---

## 1. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js | 15.0.0 |
| React | React (RC) | 19.0.0-rc-65a56d0e-20241020 |
| Language | TypeScript | 5.9.3 |
| CSS | Tailwind CSS | 4.1.11 |
| PostCSS | @tailwindcss/postcss | 4.1.11 |
| Auth | Firebase Authentication | 12.13.0 |
| Database | Cloud Firestore | 12.13.0 (client) / 14.0.0 (admin) |
| Payments | Razorpay | 2.9.6 |
| Icons | Lucide React | 0.454.0 |
| Animation | Motion | 11.11.11 |
| Email | Nodemailer | 9.0.0 |
| Date Utilities | date-fns | 4.4.0 |
| E2E Testing | Playwright | 1.62.1 |
| Linting | ESLint + next config | 9.14.0 |

## 2. Repository Metrics

| Metric | Count |
|--------|-------|
| Total source files (TS/TSX/JS/MJS/CSS/JSON, excl. node_modules/.next) | 112 |
| Total TypeScript/JavaScript lines (excl. node_modules/.next) | 42,812 |
| Application source files (excl. e2e, config) | 77 |
| E2E test spec files | 14 |
| E2E test cases (test() calls) | 54 |
| API route files | 9 |
| Component files (components/) | 48 |
| Native browser alert() calls | 155 |
| Native browser confirm() calls | 32 |
| Total native popups (alert + confirm) | 187 |

## 3. Monolith Files (>1,000 Lines)

| File | Lines | Purpose |
|------|-------|---------|
| `components/MatchesTab.tsx` | 5,185 | Match scheduling, squad selection, scoring, graphics |
| `components/DesignTab.tsx` | 2,868 | HTML5 Canvas graphic generation |
| `hooks/useStore.ts` | 2,737 | Global state, 14+ Firestore subscriptions |
| `components/ShopTab.tsx` | 2,581 | Merchandise catalog and orders |
| `components/SettingsTab.tsx` | 1,672 | Club branding, API keys, roles |
| `components/FinanceTab.tsx` | 1,635 | Financial dashboard, dues, payments |
| `components/studio/StudioCRMView.tsx` | 1,607 | Studio CRM view |
| `app/page.tsx` | 1,299 | SPA container, tab routing, onboarding |
| `components/WixFinanceView.tsx` | 1,247 | Legacy Wix/Google Sheets importer |
| `components/AdminDashboard.tsx` | 1,233 | Admin KPI dashboard |
| `components/ProfileTab.tsx` | 1,109 | Player profile management |
| `components/DuesAndRemindersTab.tsx` | 1,098 | Dues overview & WhatsApp reminders |
| `components/StudioAdminTab.tsx` | 1,075 | Studio admin management |
| `components/HomeTab.tsx` | 1,044 | Home tab with matches & admin widgets |
| `components/PlayersTab.tsx` | 1,022 | Player roster management |

**Total monolith lines**: 27,452 (64.1% of all source code)

## 4. Dependencies

### Production Dependencies (15)
- `autoprefixer` ^10.4.21
- `class-variance-authority` ^0.7.1 **[UNUSED — zero imports found]**
- `clsx` ^2.1.1
- `date-fns` ^4.4.0
- `firebase` ^12.13.0
- `firebase-admin` ^14.0.0
- `lucide-react` ^0.454.0
- `motion` ^11.11.11
- `next` 15.0.0
- `nodemailer` ^9.0.0
- `postcss` ^8.5.6
- `razorpay` ^2.9.6
- `react` 19.0.0-rc-65a56d0e-20241020
- `react-dom` 19.0.0-rc-65a56d0e-20241020
- `tailwind-merge` ^3.3.1

### Dev Dependencies (12)
- `@firebase/eslint-plugin-security-rules` ^0.0.2
- `@playwright/test` ^1.62.1
- `@tailwindcss/postcss` 4.1.11
- `@tailwindcss/typography` ^0.5.19
- `@types/node` ^20
- `@types/nodemailer` ^8.0.1
- `@types/react` ^19
- `@types/react-dom` ^19
- `eslint` ^9.14.0
- `eslint-config-next` 15.0.0
- `firebase-tools` ^15.0.0
- `tailwindcss` 4.1.11
- `tw-animate-css` ^1.4.0 **[UNUSED — zero imports found]**
- `typescript` 5.9.3

## 5. Firestore Configuration

**Firebase JSON**: Two databases share one rules file (`firestore.rules`):
1. `ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412`
2. `kavach-play-db-ext`

## 6. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/generate-kavach-ids` | POST | Generate KAvach IDs for players |
| `/api/admin/merge-players` | POST | Merge duplicate player profiles |
| `/api/calendar/sync` | POST | Google Calendar sync |
| `/api/email/send` | POST | Send email notifications |
| `/api/razorpay/order` | POST | Create Razorpay payment order |
| `/api/razorpay/webhook` | POST | Razorpay payment webhook |
| `/api/whatsapp/invite` | POST | Send WhatsApp match invitations |
| `/api/whatsapp/remind-studio` | POST | Send WhatsApp studio reminders |
| `/api/whatsapp/send` | POST | Send WhatsApp dues reminders |

## 7. Application Routes

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/page.tsx` | Main SPA (all tabs) |
| `/pay/[playerId]` | `app/pay/[playerId]/page.tsx` | Player payment page |
| `/admin-tools` | `app/admin-tools/page.tsx` | Orphaned admin tools (454 lines, unlinked from nav) |
| `/policy` | `app/policy/page.tsx` | Privacy policy |
| `/legal` | `app/legal/page.tsx` | Legal terms |

## 8. Architecture Pattern

- **Single Page Application (SPA)**: Entire app wrapped in `"use client"` in `app/page.tsx`
- **Tab-based navigation**: `activeTab` state drives all views
- **Global state**: Single `useStore.ts` hook with 14+ real-time Firestore `onSnapshot` listeners
- **Dual identity**: Every player has both `appUsers/{uid}` (auth) and `players/{playerId}` (domain) documents
- **Theme**: Dark emerald green with glassmorphism effects (CSS custom properties in `globals.css`)
