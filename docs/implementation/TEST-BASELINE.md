# KAVACH PLAY — Test Baseline & Coverage Report

**Phase**: 0 (Discovery & Verification)
**Date**: 2026-11-15
**Git SHA**: `f5739726e75a2e6594c7379bdbfc8a866c63f787`

---

## 1. Testing Infrastructure

| Aspect | Detail |
|--------|--------|
| **Framework** | Playwright ^1.62.1 |
| **Config** | `playwright.config.ts` |
| **Test Directory** | `e2e/` |
| **Helpers** | `e2e/helpers/auth.ts` (shared sign-in, navigation utilities) |
| **Total Spec Files** | 14 |
| **Total test() Calls** | 54 |

## 2. E2E Test File Inventory

| File | Lines | Tests | Status |
|------|-------|-------|--------|
| `e2e/admin-dashboard.spec.ts` | 49 | ~3 | Skipped (requires auth) |
| `e2e/app-loading.spec.ts` | 73 | ~3 | Active (no auth needed) |
| `e2e/club-tab.spec.ts` | 78 | ~4 | Skipped (requires auth) |
| `e2e/finance.spec.ts` | 54 | ~3 | Skipped (requires auth) |
| `e2e/grounds.spec.ts` | 47 | ~3 | Skipped (requires auth) |
| `e2e/home-match-nav.spec.ts` | 48 | ~3 | Skipped (requires auth) |
| `e2e/login.spec.ts` | 48 | ~3 | Active (tests login screen) |
| `e2e/match-fee-accounting.spec.ts` | 109 | ~6 | Skipped (requires auth) |
| `e2e/match-fees.spec.ts` | 69 | ~4 | Skipped (requires auth) |
| `e2e/mobile-ux.spec.ts` | 105 | ~6 | Skipped (requires auth) |
| `e2e/navigation.spec.ts` | 37 | ~2 | Skipped (requires auth) |
| `e2e/registration.spec.ts` | 63 | ~4 | Mixed (some active) |
| `e2e/settings-features.spec.ts` | 50 | ~3 | Skipped (requires auth) |
| `e2e/studio-admin.spec.ts` | 70 | ~4 | Skipped (requires auth) |

**Total E2E Lines**: 900

## 3. Test Coverage Assessment

### Modules WITH E2E Coverage

| Module | Spec Files | Coverage Depth |
|--------|-----------|----------------|
| Authentication | `login.spec.ts`, `registration.spec.ts` | Basic — login screen render, form elements |
| App Loading | `app-loading.spec.ts` | Basic — load time, interactive state |
| Admin Dashboard | `admin-dashboard.spec.ts` | Skeleton — skipped, structure only |
| Finance | `finance.spec.ts`, `match-fee-accounting.spec.ts`, `match-fees.spec.ts` | Skeleton — skipped, structure only |
| Navigation | `navigation.spec.ts`, `home-match-nav.spec.ts` | Skeleton — skipped, structure only |
| Mobile UX | `mobile-ux.spec.ts` | Skeleton — skipped, structure only |
| Club Tab | `club-tab.spec.ts` | Skeleton — skipped, structure only |
| Grounds | `grounds.spec.ts` | Skeleton — skipped, structure only |
| Settings | `settings-features.spec.ts` | Skeleton — skipped, structure only |
| Studio Admin | `studio-admin.spec.ts` | Skeleton — skipped, structure only |

### Modules WITHOUT E2E Coverage

| Module | Risk Level |
|--------|-----------|
| **MOD-04: Finance (payment flows)** | HIGH — no Razorpay flow tests |
| **MOD-06: Player Payment Portal** | HIGH — untested payment page |
| **MOD-05: Dues & Reminders** | HIGH — WhatsApp/email sending untested |
| **MOD-13: Design Studio (Canvas)** | MEDIUM — graphics generation untested |
| **MOD-14: Shop/Merchandise** | MEDIUM — order flow untested |
| **MOD-15: Studio/Coaching** | MEDIUM — CRM untested |
| **MOD-16: Badges & Leaderboard** | LOW |
| **MOD-17: Tournaments** | LOW |
| **MOD-18: Notifications/Opinions/Audit** | LOW |

### Unit Tests

**None found.** The project has zero unit tests. All testing relies on E2E Playwright specs, most of which are skipped.

### API Route Tests

**None found.** No test files exist for any of the 9 API routes:
- `/api/razorpay/order` — untested
- `/api/razorpay/webhook` — untested (critical for payment reliability)
- `/api/whatsapp/send` — untested
- `/api/whatsapp/invite` — untested
- `/api/whatsapp/remind-studio` — untested
- `/api/email/send` — untested
- `/api/admin/merge-players` — untested
- `/api/admin/generate-kavach-ids` — untested
- `/api/calendar/sync` — untested

### Firestore Security Rules Tests

**None found.** Despite having `@firebase/eslint-plugin-security-rules` as a devDependency, there are no rule unit tests. This is critical given CRIT-01 and CRIT-02.

## 4. Testing Gaps — Priority Order

| Priority | Gap | Impact |
|----------|-----|--------|
| P0 | No Firestore security rules tests | CRIT-01/CRIT-02 could recur with any rule change |
| P0 | No Razorpay webhook test | FIN-03 (lost late fees) discovered by code review, not testing |
| P1 | Most E2E tests skipped | ~90% of test cases never execute |
| P1 | No API route unit tests | 9 server endpoints with zero test coverage |
| P1 | No unit tests at all | Financial logic bugs (CRIT-04, FIN-01, FIN-02) untestable without unit tests |
| P2 | No mobile-specific regression tests running | Responsive issues undetected |
| P2 | No payment flow E2E | Critical revenue path untested |

## 5. Test Infrastructure Recommendations

1. **Firestore Rules Emulator Tests** — Use `@firebase/rules-unit-testing` to write regression tests for every security rule, especially CRIT-01 and CRIT-02 patterns.
2. **Unit Tests for Financial Logic** — Extract `isMatchBillable`, `getEffectiveFee`, `computeGrossValue`, `computeLateFees` as pure functions and unit test with Jest/Vitest.
3. **API Route Integration Tests** — Use Next.js test client or supertest to verify webhook handling, especially the Razorpay webhook's error paths.
4. **Enable Skipped E2E Tests** — Provide test Firebase credentials or implement Firebase emulator-based testing to run authenticated specs.
5. **CI Pipeline** — No CI configuration found (no `.github/workflows/`, no `vercel.json` with build checks). Tests are not automatically run on push/PR.
