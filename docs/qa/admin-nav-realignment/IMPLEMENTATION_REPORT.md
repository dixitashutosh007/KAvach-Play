# Admin Persona Navigation Realignment (D-18) — Implementation Report

**Branch:** `fix/admin-nav-realignment` · **Base:** `a10d3b7` (Player-complete D-16, also `mig-mov`) · **Date:** 2026-11-23
**Verification type:** implementation-agent verification on a local dev server with the synthetic session harness. **Not independent QA, not deployed.**
SUB-001 and IDT-003 remain **OPEN** and untouched (D-17).

## 1. Admin navigation before → after

| | Before | After (D-18) |
|---|---|---|
| Desktop sidebar | Overview · Match Centre · Player Roster · Finance & Dues · Studio & Nets · Design Studio · Settings & Access (7, role-filtered; Match Centre hidden from Club Admin) | **Home · Match Center · Club · Finance · Design Studio · Settings** (role-filtered) |
| Mobile bar | Overview · Match Centre · Player Roster · Finance & Dues · More — **shown to every admin regardless of role** | Same six destinations as desktop, same filter, no More |
| Mobile More drawer | Settings, Studio & Nets, Grounds, Design Studio, Shop, Leaderboard, Pulse, Notifications | **Removed** (component deleted); items moved into their destination |
| Club tab row | Players · Club Statistics · Badges · Shop · Pulse · Design · Leaderboard · Reminders · Activity | Player Roster · Studio · Announcements · Pulse · Leaderboard & Stats · Badges · Shop · Reminders · Activity Log (role-filtered per section) |
| Match Centre sub-tabs | Matches · Tournaments · Grounds · Assign | Unchanged (plus deep-link support for Grounds/Tournaments) |

### Screen → destination mapping

| Existing screen / action | Before | After |
|---|---|---|
| Admin Dashboard (all quick actions, Total Dues, compliance, studio renewals, upcoming matches) | Overview | **Home** |
| Club Performance widget management hint | Admin Home (D-16) | **Home** |
| Announcement publish / edit / pin / delete | Admin Home (D-16) | **Club → Announcements** (Home has a shortcut card) |
| Matches, Tournaments, Grounds, Assign (fees) | Match Centre (+ standalone Grounds via More) | **Match Center** sections; legacy `grounds` opens Match Center → Grounds |
| Player roster, verification, Invite Player | Player Roster | **Club → Player Roster** (Invite = roster action / Home shortcut) |
| Studio & Nets (members, CRM, PNA, studio No Show fee) | Studio & Nets hub | **Club → Studio** |
| Polls & Pulse management | More / Club → Pulse | **Club → Pulse** |
| Leaderboard; Club Statistics | More / Club → Leaderboard; Club → Club Statistics | **Club → Leaderboard & Stats** |
| Badges (gallery, Hall of Fame, Grant, Manage) | Club → Badges | **Club → Badges** |
| Merchandise management | More / Club → Shop | **Club → Shop** |
| Dues reminders | Club → Reminders | **Club → Reminders** |
| Audit log | Club → Activity | **Club → Activity Log** |
| Finance (accounting, dues, Razorpay report, fees, plans) | Finance & Dues | **Finance** (unchanged component) |
| Design Studio | Sidebar + Club → Design (duplicate) | **Design Studio** only |
| Settings & Access | Settings & Access | **Settings** |
| Notifications, own profile | More / header | Header bell / avatar (global) |
| Record Catches, Add No Show (match/finance), Add New Match, Assign Fees, View Calendar, Start a Poll, Grant Badge, Invite Player, Add to Studio | Overview quick actions | Home quick actions (unchanged; targets re-routed to new destinations) |

Legacy tab ids (`studio`, `grounds`, `opinion`, `leaderboard`, `shop`, `badges`, `players`, `dues_and_reminders`) are canonicalised by `resolveAdminRoute`, so every dashboard shortcut and existing deep action keeps working.

## 2. Role → destination / Club section matrix

Derived from the existing model; effective flags as computed in `app/page.tsx` (Super Admin claim folds into every role; `canDesign = Club Admin || Designer`).

| Role | Home | Match Center | Club (sections) | Finance | Design Studio | Settings | Lands on |
|---|---|---|---|---|---|---|---|
| Super Admin | ✓ | ✓ | ✓ all 9 | ✓ | ✓ | ✓ | Home |
| Club Admin | ✓ | — ¹ | ✓ Roster, Announcements, Pulse, Leaderboard & Stats, Badges, Shop, Reminders | — | ✓ | — | Club |
| Match Admin | — ² | ✓ | ✓ Pulse, Leaderboard & Stats | — | — | — | Match Center |
| Finance Admin | — ² | — | ✓ Pulse, Leaderboard & Stats | ✓ | — | — | Finance |
| Studio Admin | — ² | — | ✓ Studio, Pulse, Leaderboard & Stats | — | — | — | Club → Studio |
| Designer | — | — | — ³ | — | ✓ | — | Design Studio |
| Match + Finance | — | ✓ | ✓ Pulse, Leaderboard & Stats | ✓ | — | — | Finance |
| Studio + Designer | — | — | ✓ Studio, Pulse, Leaderboard & Stats | — | ✓ | — | Club → Studio |

Section gates: Roster/Announcements/Badges/Shop/Reminders = Club Admin (incl. Super); Studio = Studio Admin; Pulse = any role in Firestore `isAnyAdmin()` (Super/Club/Match/Finance/Studio); Leaderboard & Stats = shown with Club (Club Statistics panel only for Club/Super); Activity Log = Super. Feature flags `opinion`, `badges`, `shop` hide their sections.

¹ ² ³ see §5 (owner clarifications) and §7 (owner answers, 2026-11-23).

## 3. Files changed

New: `lib/admin-navigation.ts` (D-18 config, visibility, aliases, landing, routing), `components/layout/navTypes.ts` (shared `Tab` type), `tests/admin-nav-realignment.test.mjs`, `e2e/admin-nav-realignment.spec.ts`, this report + screenshots.
Renamed: `components/home/AdminHomeAnnouncements.tsx` → `AdminAnnouncementsManager.tsx` (announcement management only; same gate and store calls).
Deleted: `components/layout/MoreDrawer.tsx` (navigation only; its destinations moved into Match Center / Club / header).
Modified:
- `app/page.tsx` — `adminCaps`, admin route guard, landing via `getAdminLanding`, desktop sidebar from config, admin render branch (Home panel, Club with sections, legacy screens canonicalised; each screen keeps its guard).
- `components/layout/MobileBottomNav.tsx` — admin bar from config (≤6 items, ≥48px targets), no drawer; player bar unchanged.
- `components/ClubTab.tsx` — section-driven Club with per-section role guards; Studio, Announcements, Leaderboard & Stats added; Design removed (duplicate).
- `components/MatchesTab.tsx` — section deep links (`grounds`, `tournaments`) — navigation only.
- `components/home/ClubPerformanceWidget.tsx` — hint text now points to Club → Leaderboard & Stats.
- `components/layout/AppHeader.tsx` — shared `Tab` type; titles "Club", "Settings".
- `AGENTS.md`, `docs/implementation/DECISION-LOG.md` — D-18.
- Tests updated for D-18: `tests/home-announcements-feed`, `home-screen-fixes`, `home-stats-links-identity`, `player-nav-persona`, `ui-ux-design` (removed UX-SHELL-02/03/04, which re-implemented logic in the test file — QA-001); `e2e/production-app` §6 (role matrix), `e2e/shared-shell-behavioral` 2–4, `e2e/player-home-behavioral` 2C/4H, `e2e/player-nav-persona`.

**Not changed:** Firestore rules, server/API authorisation, role assignments or inheritance, Razorpay, payment/subscription processing, fee calculations, finance workflows, business rules, Player navigation (D-16).

## 4. Test results

| Check | Command | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Lint | `npm run lint` | 0 errors, 4 warnings (Firestore rules only — TS/TSX not linted, pre-existing config) |
| Build | `GIT_BRANCH=mig-mov npm run build` | Pass (compiled, 26/26 pages) |
| Functional / unit | `npm run test:functional` | 1026 / 1026 pass, 0 skipped (incl. 32 new D-18 tests; mutation check: making Finance visible to Club Admin fails 5) |
| D-18 e2e | `npx playwright test e2e/admin-nav-realignment.spec.ts` | Desktop Chrome 11 / 11 |
| Full e2e | `npx playwright test` (Desktop + Mobile Chrome) | 220 passed, 26 failed, 98 skipped (credential-gated, not executed) |

**Full e2e breakdown.**
- 17 of the failures are pre-existing (they also fail on the base commit before D-16 and D-18): `match-center-corrections` ×2 and `player-home-behavioral` 1/2/2B/4D/4E/4G on both projects (16), plus `production-app` 3 on Desktop (1). The old `production-app` 6A/6B/6C matrix failures are gone (tests rewritten for D-18 and passing).
- 9 were new failures (shell test 2 on both projects; the 7 matrix tests on Mobile) caused by two races in my own new tests (Club sections read before the lazy section bar rendered; `.first()` matched the hidden desktop sidebar on mobile). Fixed; rerun of all D-18 matrix + shell tests on both projects: **20 / 20 pass**.

## 5. Owner clarifications requested

1. **Club Admin and Match Center.** Hidden. The previous desktop nav also hid it and Firestore rules grant match/ground/tournament writes only to Match Admin/Super Admin; only the old mobile bar (which showed every hub to every admin) and the screen guard admitted Club Admin. The screen guard itself is unchanged; the admin route guard now redirects. Confirm, or approve showing Match Center to Club Admins.
2. **Home for Match / Finance / Studio-only admins and Designers.** Not shown (unchanged: Overview was "Hub Restricted" for them). Enabling it would surface Grant Badge / Invite Player tiles to Match Admins that rules don't authorise. Confirm, or approve a role-scoped Home (needs AdminDashboard gating fixes).
3. **No Show and Catch Records** have no standalone screens. They exist as Home quick-action modals (No Show: Finance; Record Catches: Club/Match) and inside Studio ("Add No Show Fee"). Not duplicated into Club to avoid inventing screens. Confirm, or approve extracting them into Club sections.
4. **Announcements** are managed only in Club → Announcements; Home shows a shortcut card plus the Club Performance widget. Confirm this satisfies "Home accommodates announcement management".
5. **Preserved but not in the approved Club list:** Shop (merchandise management), Reminders (dues reminders; Finance Admins also have Finance → Dues — pre-existing overlap), Activity Log (Super Admin; could move to Settings). Assign (fee assignment) stays in Match Center.
6. **Pulse / Leaderboard for Match, Finance and Studio Admins** are in Club (previously in their More drawer). Pulse matches rules `isAnyAdmin()`.

## 6. Known limitations

- Synthetic sessions on a local dev server; no real Firebase accounts, no staging, no independent QA.
- Tab navigation is client state (pre-existing): refresh returns to Player persona Home; browser Back is not wired to tab changes; there are no URL deep links for admin tabs (dashboard/action deep links are internal and covered).
- Lint covers Firestore rules only (pre-existing configuration).
- Legacy screenshot folders regenerated by older specs were not committed.

## 7. Owner answers (2026-11-23) — follow-up, not yet implemented

The owner answered the §5 questions. Several answers change the role model (retire Match Admin and Studio Admin into Club Admin; Activity Log to Finance Admin), which requires Firestore rules and server-authorisation changes that this navigation phase may not make. Follow-up questions are pending with the owner (migration of existing Match/Studio Admin users; separate security workstream; interim visibility; No Show / catch history on the player record). This commit does **not** implement those answers.

## 8. D-19 follow-up implementation (commit `c2a910b`) — verification

Implemented on this branch (navigation/UI only; no rules, server authorisation, role data, payment or Razorpay changes):
- Home shown to every admin; unauthorised destinations and Club sections show a polite access-denied card (no redirect); writes rejected by Firestore rules raise an access-denied toast.
- Club Admin sees Match Center and Club → Studio; legacy Match/Studio Admin flags keep their former areas until the role-consolidation migration.
- Club sections are Club Admin capabilities; Reminders and the Activity Log moved to Finance; the Match Center Assign screen is retired (component removed, data untouched).

| Check | Result |
|---|---|
| Type-check | 0 errors |
| Functional / unit (`npm run test:functional`) | 1029 / 1029 pass, 0 skipped |
| Full e2e (Desktop + Mobile Chrome) | 233 passed, 17 failed, 98 skipped (credential-gated, not executed) |
| Build (`GIT_BRANCH=mig-mov npm run build`) | Pass |

All 17 e2e failures are the same pre-existing failures that also fail on the base commit before D-16/D-18 (`match-center-corrections` ×2, `player-home-behavioral` 1/2/2B/4D/4E/4G on both projects, `production-app` 3 on Desktop). No new failures. All D-16/D-18/D-19 navigation, persona-isolation and role-matrix tests pass on both projects.

Known interim limitation (by owner decision D-19 item 3): Club Admin saves in Match Center and Studio are rejected by the current Firestore rules and show the access-denied message until the role-consolidation security workstream is deployed.
