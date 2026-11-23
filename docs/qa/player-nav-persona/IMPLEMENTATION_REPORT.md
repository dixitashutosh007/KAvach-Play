# Player Persona Navigation (D-16) — Implementation Report

**Branch:** `fix/player-nav-persona` · **Base:** `5f85974` (D-17 deferral record) · **Date:** 2026-11-23
**Decisions:** D-16 (navigation & persona isolation), D-17 (UX proceeds with SUB-001 / IDT-003 OPEN)
**Verification type:** implementation-agent verification against the local dev server with the synthetic session harness. **Not independent QA** and **not deployed** anywhere.

> SUB-001 and IDT-003 remain **OPEN** (see `SECURITY-RISK-REGISTER.md`). Nothing in this workstream touches them and nothing here is a security clearance.

## 1. Navigation before → after

| Surface | Before | After |
|---|---|---|
| Player mobile bottom nav | Home · Matches · Finance · Players · More | **Home · Profile · Matches** |
| Player desktop sidebar | Home · Matches · Finance · Players · Performance · Club | **Home · Profile · Matches** (same config as mobile) |
| Player More drawer | Performance, Studio, Shop, Pulse, Design Studio*, Club, Profile | **Removed** (drawer is Admin persona only) |
| Player Club tab row | My Card · Studio · Shop · Pulse · Directory · Badges | **Removed** (ClubTab is Admin persona only) |
| Admin navigation | Overview · Match Centre · Player Roster · Finance & Dues · More (+ sidebar hubs) | **Unchanged** |

\* shown to Designers in Player persona (persona leak, fixed).

### Feature → destination mapping

| Feature | Before (player) | After (player) |
|---|---|---|
| Home dashboard (search, campaigns, dues + Pay Now, next 4 matches + availability, announcements, birthdays, feed) | Home | Home (unchanged content) |
| Club Directory | Players tab / Club → Directory | Home quick access → Directory (back to Home) |
| Studio | More / Club → Studio | Home quick access → Studio; Profile → Studio card (back to Home) |
| Shop / Merchandise | More / Club → Shop | Home quick access → Shop (back to Home) |
| Polls & Pulse | More / Club → Pulse | Home quick access → Polls & Pulse (back to Home) |
| Club Announcements / Feed | Home | Home (quick access scrolls to Announcements) |
| Notifications | Header bell → **blank screen** (no player render) | Header bell → Notification Hub (back to Home) |
| Profile / My Card | Avatar / More / Club → My Card | **Profile** (primary) and avatar |
| Badges (own) | Profile | Profile |
| Club badges gallery & Hall of Fame | Club → Badges | Profile → "Club badges & Hall of Fame" (back to Profile) |
| Performance / Leaderboard | Sidebar Performance / More | Profile → "My Performance" card (rank per category) → Club leaderboard (back to Profile) |
| Payment history & receipts, dues | Finance tab; Profile | Profile (PlayerFinanceView); Home Pay Now → My Payments (back to Profile) |
| Studio membership | Studio | Profile → Studio Membership card; Studio |
| Matches (upcoming, past, details, squad, availability, fee status, results) | Matches | Matches (unchanged component) |
| Design Studio | Player More (Designers) | Admin persona only |

## 2. Persona isolation fixes

| ID | Leak (before) | Fix |
|---|---|---|
| L1 | Super/Club Admins could publish, edit, delete announcements on Player Home | Moved to Admin Home (`AdminHomeAnnouncements`); Player Home has no publishing path |
| L2 | Club Performance widget management hint on Player Home | Hint only on Admin Home |
| L3 | Admins saw squad-restricted / tentative matches in Player persona (Home + Matches) | `HomeTab isAdmin={false}`; `PlayerMatchCenter` no longer reads claim/flags |
| L4 | Designers had Design Studio in Player persona | Player branch never renders DesignTab |
| L5 | Admins could edit jersey number in the Player Home profile prompt | `isAdmin={false}` in Player persona |
| L6 | Profile chip showed the raw account role (e.g. "admin") | Player persona shows "player" |
| L7 | Admins in Player persona loaded club-wide payments / fees | Player persona is scoped to own player id; subscriptions re-scoped on persona switch |
| — | Admin-only tabs could be reached in Player persona via state/test hooks | Player persona guard (`resolvePlayerTab`) redirects |

The underlying authorisation model is unchanged: no Firestore rules, API routes, role assignments, payment/Razorpay or subscription logic were modified. Persona is a presentation boundary; rules and server RBAC remain the security boundary.

## 3. Files changed

New:
- `lib/player-navigation.ts` — D-16 nav config (primary items, secondary → parent map, guard, back link). Takes no role input.
- `lib/leaderboard.ts` — ranking extracted from `LeaderboardTab` (shared with Profile).
- `lib/studio-membership.ts` — Studio status extracted unchanged from `StudioTab` (shared with Profile).
- `components/home/AdminHomeAnnouncements.tsx` — relocated announcement handlers + widget management (same `hasAdminClaim || isClubAdmin` gate).
- `components/profile/ProfileHubCards.tsx` — My Performance and Studio Membership cards (existing data only).
- `tests/player-nav-persona.test.mjs`, `e2e/player-nav-persona.spec.ts`.

Modified:
- `app/page.tsx` — tab type, Player persona guard, persona-scoped data loading, desktop player sidebar, player render branch (back bar, notifications, badges, player-only props), Admin Home mount.
- `components/layout/MobileBottomNav.tsx` — player nav from shared config, no drawer.
- `components/layout/MoreDrawer.tsx` — admin-only.
- `components/layout/AppHeader.tsx` — `badges` tab title.
- `components/HomeTab.tsx` — removed publishing/management; added quick access.
- `components/home/HomeQuickActions.tsx` — Directory, Studio, Shop, Polls & Pulse, Announcements.
- `components/ProfileTab.tsx` — `persona`/`onNavigate` props, hub cards, player chip.
- `components/ClubTab.tsx` — player sub-tab row removed (admin only).
- `components/matches/PlayerMatchCenter.tsx` — no admin authority reads.
- `components/LeaderboardTab.tsx`, `components/StudioTab.tsx` — use extracted helpers (no behaviour change).
- Tests updated to D-16 (previous assertions encoded the superseded 5-item nav / Club tab / player More drawer / Player-Home publishing): `tests/google-player-linking`, `home-and-match-card-refinement`, `home-announcements-feed`, `home-screen-fixes`, `home-stats-links-identity`, `match-center-admin-access`, `ui-ux-design`; `e2e/shared-shell-behavioral` (tests 1, 3), `e2e/player-home-behavioral` (2C, 4H), `e2e/production-app` (2, 7).

## 4. Test results

See the final report in the session for exact counts; recorded here:

| Check | Command | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit -p tsconfig.json` | 0 errors (baseline 0) |
| Lint | `npm run lint` | 0 errors, 4 warnings — **note:** `eslint.config.mjs` only lints Firestore rules; TS/TSX are not linted (pre-existing limitation) |
| Build | `GIT_BRANCH=mig-mov npm run build` | Pass. Without `GIT_BRANCH` the build fails closed at page-data collection because the branch resolver rejects `fix/player-nav-persona` (intended safety) |
| Functional / unit | `npm run test:functional` | 997 / 997 pass, 0 skipped (baseline 963 / 963; +34 new) |
| New D-16 unit tests | `node --test tests/player-nav-persona.test.mjs` | 34 / 34; mutation check (re-introducing an admin flag) fails 4 tests as expected |
| D-16 e2e | `npx playwright test e2e/player-nav-persona.spec.ts` | Desktop Chrome 28 / 28, Mobile Chrome 28 / 28 |
| Full e2e | `npx playwright test` | see §4.1 |

### 4.1 Full e2e suite

FULL_E2E_PLACEHOLDER

## 5. Known limitations

- **No real accounts.** Persona tests use the synthetic session harness (mocked auth claim + synthetic store) on a local dev server. They exercise the real UI code, but not Firebase Auth / Firestore. No staging run; independent QA pending.
- **No per-match individual performance history** exists in the data model. Profile shows aggregate runs / wickets / catches / badges and club rank only. Future enhancement: per-match player performance records (requires data modelling; out of scope per D2).
- Header context chip still shows "Finance" for the player payments screen (shared title map); the back bar labels it "My Payments".
- Admin persona can still open the shared `ProfileTab` via the avatar (unchanged behaviour); it shows the account role there.
- Lint does not cover TS/TSX (pre-existing config).
- Legacy screenshot folders under `docs/qa/screenshots/` are regenerated by some older specs; those regenerated files were not committed.

## 6. Independent QA handoff prompt (read-only)

```
You are an independent, READ-ONLY QA reviewer for KAvach Play.
Do NOT edit code/config/rules, commit, deploy, change permissions, write production data or make real payments.

Build under test: branch fix/player-nav-persona, commit <SHA from report>. Environment: <staging URL — to be provided by owner; no staging is currently mapped to this branch>.
Accounts: owner-provided test accounts for Regular Player, Match Admin, Finance Admin, Studio Admin, Club Admin, Designer, Super Admin (no secrets in reports).
Requirement IDs: D-16 (player nav, persona isolation), D-17 (SUB-001/IDT-003 remain open — not in scope).

For EACH account, at 360×800, 390×844, 430×932, 768×1024, 1280×800, 1440×900:
1. Player persona primary navigation is exactly Home, Profile, Matches (same order desktop/mobile); no More, no drawer, no Club tab row.
2. No admin menus, hubs, widgets, "New" announcement button, announcement edit/delete, pending-approval alert, Design Studio, Grant/Manage badge controls, Add/Edit Match, squad/fee tools.
3. Home quick access opens Directory, Studio, Shop, Polls & Pulse; each shows a "← Home" back link; Announcements scrolls to the section.
4. Bell opens Notification Hub (not blank).
5. Profile shows My Performance (real values / club rank), Club leaderboard and Club badges links (back to Profile), Studio Membership card, payment history.
6. Pay Now opens My Payments (own dues only).
7. Matches: upcoming/past, details, squad, availability marking, own fee status; restricted/tentative fixtures not shown to admins in Player persona.
8. Admins only: header toggle → Admin persona shows the previous admin navigation and hubs for that role; Club/Super Admin see announcement management on Admin Home; toggle back returns to Player Home with 3-item nav.
9. Refresh / direct navigation / back button behave sensibly; no console errors.
Report Pass/Fail/Blocked per scenario with screenshots; inaccessible scenarios are Blocked, not Passed.
```
