# Player UI/UX Enhancement — Home, Club & Player Profile (D-20)

**Branch:** `fix/player-ui-enhancement` (from `mig-mov` @ `e7177fa`, which already contained the D-16/D-18/D-19 navigation work and the R1–R5/B1–B2 security and payment remediations) · **Date:** 2026-11-24
**Verification type:** implementation-agent verification on a local dev server with the synthetic session harness and the Firestore emulator. **Not independent QA.**
SUB-001 and IDT-003 remain open (D-17); nothing here touches them.

## 1. Navigation before → after

| | Before (D-16) | After (D-20) |
|---|---|---|
| Player bottom nav / desktop sidebar | Home · Profile · Matches | **Home · Club · Matches** |
| Profile | Primary destination | Header **avatar** → Profile (back returns to the previous primary screen) |
| Announcements | Player Home section | **Club** → Recent Announcements (30 days) → View More (full, paginated) |
| Club performance totals | Player Home widget | **Club** → At a Glance |
| Polls & Pulse | Home quick access → Polls screen (loaded no polls — regression) | Home quick access + **Club** tiles (Polls, Pulse); Pulse preview on Club |
| Leaderboard / Club badges | Profile cards | **Club** tiles (+ leaderboard preview under Stats) |
| Directory | Home quick access → full roster component | Home quick access + **Club** → paginated Directory with public profiles |
| Admin navigation | D-18/D-19 | **Unchanged** |

Secondary screens and their back link: Directory, Polls, Pulse, Announcements, Leaderboard, Player Badges → Club; Studio, Shop → Home; My Payments → Profile; Notifications → last primary screen.

## 2. Screens

**Home:** greeting + "Cricket • Community • KAvach", search (kept), campaign banner, dues + Pay Now, upcoming matches with availability, Quick Access grid (Directory, Studio, Shop, Polls & Pulse), birthdays, club feed.

**Club:** section chips (All / Announcements / Pulse / Stats); At a Glance (total matches, matches won, win rate from `appConfig/clubStats`); circuit standings (see §5); tiles (Leaderboard, Player Badges, Polls, Pulse); Recent Announcements (last 30 days, 2 shown, View More); Latest Pulse (last 30 days, vote count + "You voted"/"Vote now", View More); leaderboard preview (Stats); Player Directory entry.

**Player Profile (avatar):** header (back, edit, account settings), identity card (photo, name, role, club, Player ID), chips (Overview / Payments / Membership / Performance), Personal Information (view + Edit → existing form), Your Badges (preview + View All), Studio Membership (status/plan/validity; non-members see configured plans and "View plans & join in Studio"), Payment Dues + Pay Now, Past Payments (match & club fees + Studio membership payments), Out of Play Calendar (month view + existing add/edit/delete editor), My Performance (dropped / stunning catches only), account (privacy policy, sign out).

## 3. Padding / layout changes

| Where | Before | After |
|---|---|---|
| `app/page.tsx` `<main>` | `px-4` gutter, `pt-24 sm:pt-28` (≈34px gap under the header), `pb-12` | Same single gutter; `pt-[calc(76px+safe-area)]` / `sm:84px` (16px under the header, notch-safe); `pb-6` |
| `components/HomeTab.tsx` container | `p-4 sm:p-6 … pb-28` → **32px** total side gutter on mobile and 112px extra bottom | No own padding; `gap-4` between sections |
| `OpinionTab` / `PlayerMatchCenter` wrappers | `pb-24` / `pb-12` extra bottom | Removed (bottom-nav space is owned once by the root `pb-20`) |
| Desktop sidebar | `sticky top-28` | `top-24`; content column `space-y-4 md:space-y-6` |

Verified: Home content starts exactly 16px from the mobile viewport edge; no horizontal overflow at 360, 390, 430, 768, 1280 and 1440 px for Home, Club and Profile (e2e).

## 4. Data loading

- **No whole-collection listeners on Club.** The Player Club tab maps to a loader key outside every lazy-listener set, so the admin Club's payments / fees / polls / badges / merchandise listeners never start for players.
- **Bounded one-shot queries** (`hooks/useClubData.ts`): posts `createdAt ≥ now-30d` (limit 50); polls `isActive == true` + polls `createdAt ≥ now-30d`; the member's own `pollResponses` (`playerId == uid`); `getCountFromServer` vote counts for the ≤2 previewed polls; one player's badges (`playerId == id`) for a public profile. Single-field filters only — **no new indexes**.
- **Shared 60-second cache with in-flight de-duplication**, invalidated by pull-to-refresh (`refreshNonce`), so tab switches and re-renders don't repeat reads.
- **Announcements View More:** cursor pagination (`orderBy createdAt desc`, `startAfter`, 20 per page).
- **Directory:** renders 20 at a time from player records the app already holds (no extra reads; no per-player detail fetches). Badge type definitions loaded once.
- **Profile:** own `subscriptionHistory` only (`playerId == own id`, R2-C); payments/fees/out-of-play/plans via the existing scoped loaders.
- Skeleton, empty and error states on every preview.

## 5. Circuit standings — data source

The four standings (India / Bangalore × Most Wins / Most Played) have **no data source in the application** (searched code, types and Firestore usage; `appConfig/clubStats` stores only `matchesPlayed` and `matchesWon`). They are shown as **"Not available"** with an explanation; no ranks are invented. To enable them the club needs an approved source (e.g. admin-maintained ranks in `appConfig/clubStats` with source/date, or an integration) — owner decision.

## 6. Existing workflows reused (not duplicated)

- **Pay Now / dues:** `calculatePlayerDues` + `PersonalPaymentCard` → existing player payments screen (`FinanceTab` player view). No client-side payment state changes.
- **Payment history:** existing `PlayerFinanceView` (history mode) + the member's own `subscriptionHistory`.
- **Studio membership:** status via `lib/studio-membership` (same rules as StudioTab); plans from `subscriptionPlans`; joining/renewing happens on the existing Studio screen (existing order/webhook flow). No hardcoded prices.
- **Profile edit:** existing ProfileTab form, validation and Firestore rules.
- **Out of Play:** existing `OutOfPlayConfig` editor; new month view reads the same records.
- **Polls voting:** existing OpinionTab; Pulse results use the existing `PollResults`.
- **Badges:** existing badge records/definitions and `MyBadgesSection`; award logic untouched.

## 7. Files changed

New: `lib/club-feed.ts`, `lib/out-of-play-calendar.ts`, `hooks/useClubData.ts`, `components/club/{PlayerClubTab,PlayerDirectory,ClubAnnouncementsScreen,PulseScreen}.tsx`, `components/profile/PlayerProfileHub.tsx`, `tests/player-ui-enhancement.test.mjs`, `e2e/player-ui-enhancement.spec.ts`, this report and screenshots.
Modified: `lib/player-navigation.ts` (D-20 config), `app/page.tsx` (player routing, loader scoping, back links, layout gutter), `components/layout/{MobileBottomNav,AppHeader,navTypes}.tsx`, `components/HomeTab.tsx`, `components/home/{HomeQuickActions,PlayerHomeHeader}.tsx`, `components/ProfileTab.tsx` (player hub entry, exports), `components/OpinionTab.tsx`, `components/matches/PlayerMatchCenter.tsx` (padding only), `AGENTS.md`, `docs/implementation/DECISION-LOG.md` (D-20), tests/e2e updated from D-16 to D-20 expectations.

**Not changed:** Firestore rules, server/API authorisation, roles, Admin navigation, Razorpay, payment processing/reconciliation, subscription logic, match lifecycle, fee calculation, badge award logic.

## 8. Test results

| Check | Command | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Lint | `npm run lint` | 0 errors, 4 warnings (Firestore rules only — TS/TSX not linted, pre-existing config) |
| Build | `GIT_BRANCH=mig-mov npm run build` | Pass (27/27 pages) |
| Functional / unit | `npm run test:functional` | 1086 / 1086 pass, 0 skipped (incl. 14 new D-20 tests; mutation check: adding `mobile` to the public field list fails 2) |
| Emulator (rules, payments, identity) | `node scripts/run-emulator-tests.mjs` | 444 / 444 pass |
| D-20 e2e | `npx playwright test e2e/player-ui-enhancement.spec.ts` | 13 / 13 (Desktop Chrome) |
| Full e2e (Desktop + Mobile Chrome) | `npx playwright test` | 235 passed, 19 failed, 98 skipped (credential-gated, not executed) |

**Full e2e breakdown:** 17 failures are the pre-existing ones that also fail before D-16 (`match-center-corrections` ×2 and `player-home-behavioral` 1/2/2B/4D/4E/4G on both projects; `production-app` 3 on Desktop). 2 were one stale D-18 assertion (`admin-nav-realignment` refresh test still expected Home/Profile/Matches); fixed and re-run: 2 / 2 pass on both projects. All persona-isolation (7 roles), navigation, Club, Directory-privacy, Profile and responsive tests pass.

## 9. Known gaps and deferred items

1. **Profile photo upload — not implemented (blocked by data/security constraints).** Firebase Storage is not configured (no storage rules) and the Firestore rules cap `photoURL` at 500 characters, so an uploaded image cannot be stored without a rules or storage change, which this UI workstream may not make. Recommendation (needs owner approval as a security workstream): enable Firebase Storage with rules allowing `avatars/{uid}` writes only by that user (image types, ≤2 MB), store the download URL in the player's `photoURL`; or a dedicated `playerPhotos/{playerId}` document holding a ≤64 KB compressed avatar with self-only write rules. Existing photos (Google account photo or `photoURL`) are displayed.
2. **Circuit standings:** no verified source (see §5).
3. **Directory privacy is presentation-level.** Other players' private fields are never rendered (`toPublicPlayer`), but player documents remain readable by signed-in members until the R2-B security work lands.
4. **Navigation history:** tabs are client state (pre-existing) — refresh returns to Home and browser Back is not wired to tab changes; in-app back links are provided on every secondary screen.
5. **Fixed regression from D-16:** the Player Polls screen previously loaded no polls; it now does.
6. Annual personal performance summaries — future enhancement (not built).
