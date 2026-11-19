# KAvach Play — Phase 2.1 Implementation Report: Player Home (Mobile-First)

**Document type:** Implementation & Verification Report  
**Phase:** Phase 2.1 — Player Home (Mobile-First Implementation)  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Starting remote HEAD:** `d1f27cc0daf45071bbfb196823e3e311f36885b8`  
**Initial Feature Commit:** `0168c51375241f8b032746164177267bac0a87ed`  
**Consolidated Correction Commit:** `eaf01db82e707e7c8ef12ae62f556d3c3df5ff9f`  
**Developer:** Antigravity (Implementation Developer)  
**Reviewer:** ChatGPT (Independent Product & Technical Reviewer)  
**Product Owner:** KAvach Cricket Club  
**Date:** 19 November 2026  

---

## 1. Executive Summary & Objective

In Phase 2.1, we implemented a complete, production-quality, mobile-first **Player Home experience** for KAvach Play. The Player Home acts as the logged-in player's personalised club dashboard: a consolidated view to understand upcoming club events, participate in eligible matches with 1-tap RSVP availability, track authoritative personal dues, review recent personal cricket performances, celebrate team birthdays, follow community activity, and explore club campaigns.

Following independent review, a consolidated correction was executed addressing:
1. **Player-Specific Match Visibility and Eligibility:** Replaced generic date filtering with authoritative rule enforcement (`lib/match-eligibility.ts`), ensuring players only see and RSVP to matches they are eligible for, search isolates ineligible matches, and admin access is preserved.
2. **Deterministic Birthday Parsing:** Replaced ambiguous JavaScript date parsing with deterministic parser (`lib/birthday-utils.ts`) supporting both `YYYY-MM-DD` and `DD/MM/YYYY`, handling year-boundary rollovers (Dec/Jan), and rejecting invalid dates safely.
3. **Portable Verification Artifacts:** Converted all visual screenshot references from machine-specific absolute paths to repository-relative paths and permanent GitHub links.

All existing business rules, security boundaries, financial invariants (Option A policy for abandoned matches), and RBAC capabilities are preserved without regressions.

---

## 2. Component Hierarchy & Inventory

The monolithic legacy `components/HomeTab.tsx` was refactored into a modular component architecture under `components/home/`:

| Component | Path | Responsibility |
|---|---|---|
| `PlayerHomeHeader` | `components/home/PlayerHomeHeader.tsx` | Personalised greeting, player display name, Kavach ID badge, and live search bar with clear button. |
| `HomeQuickActions` | `components/home/HomeQuickActions.tsx` | Contextual 1-tap action chips (Fixtures, Pay Dues, Studio & Nets, Club Shop, Leaderboard) with active state badges. |
| `CampaignHeroBanner` | `components/home/CampaignHeroBanner.tsx` | Multi-slide carousel supporting active tournaments, pinned announcements, Studio, and Shop campaigns with auto-rotation (6s), touch-pause controls, and indicators. |
| `CompactPerformanceSummary` | `components/home/CompactPerformanceSummary.tsx` | High-impact metrics (matches played, runs, wickets, catches) derived from authoritative player stats without misleading zero fallbacks; links directly to Digital Pass. |
| `PersonalPaymentCard` | `components/home/PersonalPaymentCard.tsx` | Authoritative personal dues calculation via `calculatePlayerDues`, itemised breakdown (match fees + other fees), Pay Now CTA, and settled celebration state. |
| `UpcomingMatchesSection` | `components/home/UpcomingMatchesSection.tsx` | Displays next 4 eligible upcoming matches with opponent, date, time, venue, directions link, format, jersey color, and 1-tap inline RSVP (`Playing`, `Maybe`, `Out`) with mutation locking. |
| `ClubAnnouncementsSection` | `components/home/ClubAnnouncementsSection.tsx` | Official announcements with pinned indicators, previews, and accessible reading modal with keyboard/close dismissal. |
| `BirthdaysCarousel` | `components/home/BirthdaysCarousel.tsx` | Horizontal scroll carousel highlighting today's birthdays (festive cake badge) and upcoming birthdays within the next 14 days. |
| `ClubFeedPreview` | `components/home/ClubFeedPreview.tsx` | Community posts preview with author avatar, timestamp, message text, media previews, and comments count. |
| `HomeTab` | `components/HomeTab.tsx` | Master coordinator orchestrating Match Day Alert (starts within 18h), festive windows, profile completion banners, and search query filtering. |
| `match-eligibility` | `lib/match-eligibility.ts` | Authoritative player-match eligibility rule evaluation engine. |
| `birthday-utils` | `lib/birthday-utils.ts` | Deterministic date-of-birth parser and birthday partition engine. |

---

## 3. Authoritative Business Logic & Invariants

### A. Authoritative Match Visibility & RSVP Eligibility (`lib/match-eligibility.ts`)
The authoritative eligibility validator (`isPlayerEligibleForMatch`) enforces the following invariants:
1. **Administrative Access:** Authorized club/match/super admins can view and manage all active (non-archived) fixtures across the club.
2. **Linked Player Invariant:** Unlinked users (where `resolvePlayerForUser` is null) cannot view player fixtures or submit RSVPs.
3. **Active Player Requirement:** Players who are disabled (`player.disabled`), merged (`player.mergedInto`, `mergeStatus === "in_progress"`), or unverified (`inviteStatus === "Pending"` or `"Rejected"`) are strictly disqualified from match participation.
4. **Fixture Invariants:** Archived matches (`isArchived`) and Tentatively blocked fixtures (`isTentative`) are excluded from ordinary player display.
5. **Explicit Squad & Participation Precedence:** If a player has an existing payment/squad record for a match, they are explicitly linked and eligible.
6. **Restricted Squad Gating:** If a match defines an announced/assigned squad list (`squadPlayerIds`), a player must be present in the squad list to be eligible.
7. **Open Club Fixtures:** Open upcoming fixtures without assigned squad restrictions are visible and actionable for active verified club players before squad announcement.
8. **Consistent Enforcement:** Applied across Upcoming Matches, Match Day Alerts, Search Results, Navigation dispatch, and the `handleRsvp` mutation handler.

### B. Deterministic Birthday Parsing (`lib/birthday-utils.ts`)
- Explicitly parses `YYYY-MM-DD` and `DD/MM/YYYY` formats.
- Avoids ambiguous JavaScript Date parsing where day/month order is undefined.
- Validates calendar dates strictly (e.g. rejects February 31st).
- Handles year-boundary rollovers deterministically (e.g. today is Dec 28th and birthday is Jan 3rd).
- Sorts upcoming birthdays chronologically by nearest date within the 14-day window.

### C. Financial Integrity & Option A Policy
- Outstanding dues are computed authoritatively using `calculatePlayerDues(myPlayers, payments, matches, otherFees)`.
- In accordance with the approved Option A policy, abandoned matches (`status === "Abandoned"`) are excluded from billable dues via `isMatchBillable(m)`.
- Late fees and custom fees are deduplicated and displayed with itemised obligation counts.
- Financial figures are strictly isolated to the authenticated user's linked player record.

---

## 4. Acceptance Criteria Verification Matrix

| Section 12 Requirement | Verification Criterion | Status | Evidence |
|---|---|---|---|
| **1. Header & Identity** | Personalised greeting, display name, Kavach ID badge, live search bar with clear action | PASS | `PlayerHomeHeader.tsx`, tested in Playwright test 1 |
| **2. Quick Actions** | Contextual action chips for Fixtures, Pay Dues, Studio, Shop, Leaderboard | PASS | `HomeQuickActions.tsx`, tested in Playwright test 1 |
| **3. Campaign Hero Banner** | Multi-slide carousel supporting tournaments, announcements, studio, shop; auto-rotates with pause controls | PASS | `CampaignHeroBanner.tsx`, tested in Playwright test 1 |
| **4. Compact Performance** | Displays matches, runs, wickets, catches without misleading zeros; links to pass | PASS | `CompactPerformanceSummary.tsx`, tested in Playwright test 1 |
| **5. Personal Dues Card** | Authoritative dues summary via `calculatePlayerDues`, itemised breakdown, Pay Now CTA | PASS | `PersonalPaymentCard.tsx`, tested in Playwright test 1 & 6 |
| **6. Upcoming Matches** | Shows next 4 matches with date, venue, directions link, format, jersey, 1-tap RSVP | PASS | `UpcomingMatchesSection.tsx`, tested in Playwright test 2 |
| **7. Match Eligibility** | Player sees only eligible matches; ineligible squad & tentative matches are hidden | PASS | `lib/match-eligibility.ts`, tested in Playwright test 2, 3 & unit tests |
| **8. Ineligible RSVP Blocking** | Direct RSVP attempts for ineligible matches are rejected with authoritative error toast | PASS | `HomeTab.tsx`, tested in Playwright test 3 & unit tests |
| **9. Admin Access Preservation** | Admins retain full visibility into all active and tentative fixtures | PASS | `app/page.tsx`, tested in Playwright test 4 |
| **10. Announcements Modal** | Lists notices with pinned status; opens accessible dialog with close button | PASS | `ClubAnnouncementsSection.tsx`, tested in Playwright test 5 |
| **11. Team Birthdays** | Horizontal carousel with deterministic parsing (`YYYY-MM-DD`, `DD/MM/YYYY`) & 14-day window | PASS | `BirthdaysCarousel.tsx`, `lib/birthday-utils.ts`, Playwright test 5 & unit tests |
| **12. Feed Preview** | Displays recent club activity with author, timestamp, media, comment count | PASS | `ClubFeedPreview.tsx`, tested in Playwright test 5 |
| **13. Responsive Viewports** | Validated across 360×800, 375×812, 390×844, 768×1024, 1280×800 with 0 horizontal overflow | PASS | Playwright tests 7–11, 18–22 |

---

## 5. Playwright Behavioral Verification Evidence

The full Playwright test suite (`e2e/player-home-behavioral.spec.ts`) was executed across Chromium (both Mobile Chrome and Desktop Chrome projects):

```
Running 22 tests using 1 worker

  ✓ 1. Player Home loads greeting, identity, search, hero carousel, performance, and dues (Mobile Chrome)
  ✓ 2. Displays next 4 upcoming matches with accurate availability and enables 1-tap RSVP updates (Mobile Chrome)
  ✓ 3. Enforces player-specific match visibility, search isolation, and blocks ineligible match RSVP (Mobile Chrome)
  ✓ 4. Preserves legitimate administrator match access and search visibility for admin users (Mobile Chrome)
  ✓ 5. Announcements open modal dialog, birthdays carousel renders, and feed displays recent activity (Mobile Chrome)
  ✓ 6. Pay Now navigates to Finance tab and Match Details navigates to Matches tab (Mobile Chrome)
  ✓ 7. Responsive visual validation at 360x800 with zero horizontal overflow (Mobile Chrome)
  ✓ 8. Responsive visual validation at 375x812 with zero horizontal overflow (Mobile Chrome)
  ✓ 9. Responsive visual validation at 390x844 with zero horizontal overflow (Mobile Chrome)
  ✓ 10. Responsive visual validation at 768x1024 with zero horizontal overflow (Mobile Chrome)
  ✓ 11. Responsive visual validation at 1280x800 with zero horizontal overflow (Mobile Chrome)
  ✓ 12. Player Home loads greeting, identity, search, hero carousel, performance, and dues (Desktop Chrome)
  ✓ 13. Displays next 4 upcoming matches with accurate availability and enables 1-tap RSVP updates (Desktop Chrome)
  ✓ 14. Enforces player-specific match visibility, search isolation, and blocks ineligible match RSVP (Desktop Chrome)
  ✓ 15. Preserves legitimate administrator match access and search visibility for admin users (Desktop Chrome)
  ✓ 16. Announcements open modal dialog, birthdays carousel renders, and feed displays recent activity (Desktop Chrome)
  ✓ 17. Pay Now navigates to Finance tab and Match Details navigates to Matches tab (Desktop Chrome)
  ✓ 18. Responsive visual validation at 360x800 with zero horizontal overflow (Desktop Chrome)
  ✓ 19. Responsive visual validation at 375x812 with zero horizontal overflow (Desktop Chrome)
  ✓ 20. Responsive visual validation at 390x844 with zero horizontal overflow (Desktop Chrome)
  ✓ 21. Responsive visual validation at 768x1024 with zero horizontal overflow (Desktop Chrome)
  ✓ 22. Responsive visual validation at 1280x800 with zero horizontal overflow (Desktop Chrome)

22 passed (31.8s)
```

---

## 6. Portable Visual Verification & Screenshot Artifacts

Full-page screenshots were captured across 5 target viewports during automated browser verification, confirming zero horizontal overflow (`scrollWidth <= clientWidth`), proper vertical rhythm, and contrast conformance:

| Viewport | Device Target | Relative Repository Path | Permanent GitHub Link |
|---|---|---|---|
| 360 × 800 | Compact Android (e.g. Galaxy S20 / A-series) | [player-home-360x800.png](../../qa/screenshots/player-home/player-home-360x800.png) | [GitHub Link](https://github.com/dixitashutosh007/KAvach-Play/blob/mig-mov/docs/qa/screenshots/player-home/player-home-360x800.png) |
| 375 × 812 | Standard iOS (iPhone X / 12 Mini / 13 Mini) | [player-home-375x812.png](../../qa/screenshots/player-home/player-home-375x812.png) | [GitHub Link](https://github.com/dixitashutosh007/KAvach-Play/blob/mig-mov/docs/qa/screenshots/player-home/player-home-375x812.png) |
| 390 × 844 | Modern iOS (iPhone 13 / 14 / 15 / 16) | [player-home-390x844.png](../../qa/screenshots/player-home/player-home-390x844.png) | [GitHub Link](https://github.com/dixitashutosh007/KAvach-Play/blob/mig-mov/docs/qa/screenshots/player-home/player-home-390x844.png) |
| 768 × 1024 | Tablet Portrait (iPad Mini / Air) | [player-home-768x1024.png](../../qa/screenshots/player-home/player-home-768x1024.png) | [GitHub Link](https://github.com/dixitashutosh007/KAvach-Play/blob/mig-mov/docs/qa/screenshots/player-home/player-home-768x1024.png) |
| 1280 × 800 | Desktop / Laptop Screen | [player-home-desktop-1280x800.png](../../qa/screenshots/player-home/player-home-desktop-1280x800.png) | [GitHub Link](https://github.com/dixitashutosh007/KAvach-Play/blob/mig-mov/docs/qa/screenshots/player-home/player-home-desktop-1280x800.png) |

---

## 7. Regression Verification Suite

All regression test suites across the application passed cleanly with zero regressions:

| Suite | Command | Total Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| Player Home Real Browser | `npx playwright test e2e/player-home-behavioral.spec.ts` | 22 | 22 | 0 | 0 |
| Phase 2.1 Corrections Unit | `node --test tests/phase2.1-player-home-corrections.test.mjs` | 17 | 17 | 0 | 0 |
| Shared Shell Real Browser | `npx playwright test e2e/shared-shell-behavioral.spec.ts --project="Mobile Chrome"` | 7 | 7 | 0 | 0 |
| UI/UX Design System | `node --test tests/ui-ux-design.test.mjs` | 14 | 14 | 0 | 0 |
| Production Unit / Functional | `npm run test:functional` | 276 | 276 | 0 | 0 |
| ESLint Rules Validation | `npm run lint` | — | 0 errors | 0 | 4 warnings (existing firestore.rules open reads) |
| Next.js Static Production Build | `npm run build` | 19 routes | 19 | 0 | 0 |

---

## 8. Git Handover & Commit History

| Commit SHA | Type | Description |
|---|---|---|
| `d1f27cc0daf45071bbfb196823e3e311f36885b8` | Baseline | Starting remote HEAD on branch `mig-mov` |
| `0168c51375241f8b032746164177267bac0a87ed` | Feature | `feat(ui): implement mobile-first player home dashboard (phase 2.1)` |
| `7a282a758cdfd387d2026b4fbae66a4e6fdc5c82` | Docs | Initial Phase 2.1 implementation report |
| `eaf01db82e707e7c8ef12ae62f556d3c3df5ff9f` | Fix | `fix(ui): enforce player match eligibility and deterministic birthday parsing (phase 2.1)` |
| `*(This Documentation Commit)*` | Docs | `docs(ui): finalize phase 2.1 player home report with corrections and portable links` |

---

## 9. Stop Condition & Next Steps

Phase 2.1 consolidated corrections are fully implemented, verified across real-browser and unit test suites, documented with portable artifacts, and submitted for independent review.

Per Section 1.3 and Section 7 of the instructions:
> **STOP CONDITION:** Do not begin Phase 2.2 or any subsequent roadmap task until Phase 2.1 has been reviewed and accepted by ChatGPT.
