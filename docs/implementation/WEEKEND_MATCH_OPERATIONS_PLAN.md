# Weekend Match Operations — Inspection & Implementation Plan

**Status:** Plan for owner approval. **No application code changed.**
**Branch:** `feat/weekend-match-operations` from `192fdd6` (= `mig-mov` = latest UI branch `fix/player-ui-enhancement`). Working tree clean.
**Date:** 2026-11-24

## 1. Existing fields and code (verified)

| Need | Existing field / code | Notes |
|---|---|---|
| Match date / start | `matches.date` (YYYY-MM-DD), `matches.time` (HH:mm, IST) | **No end-time field.** `format` is T20 / T30 / Other. |
| Match result | `matches.result` ∈ `KAvach Won`, `KAvach Lost`, `Draw`, `Tie`, `Abandoned`, `Pending` (rules `isValidMatch`); optional `resultMarginType/Amount` | Brief's Won/Loss/Tie/Abandoned map to `KAvach Won` / `KAvach Lost` / `Tie` / `Abandoned`. Written today by the client Match Center form; rules allow update by `isMatchAdmin()` or `isFinanceAdmin()` (**not** Club Admin until role consolidation, D-19). |
| Abandoned side-effects | `isMatchBillable()` already excludes abandoned matches from dues; waiver status reconciliation is `POST /api/admin/reconcile-abandoned` (Finance Admin), **not called by any UI** | Recording "Abandoned" changes dues immediately via `isMatchBillable`; waiver records need the Finance route. |
| CricHeroes URL | `matches.matchUrl` (form placeholder `https://cricheroes.in/...`; shown as "CricHeroes Scorecard" in match detail and in calendar views) | Field exists — **no schema change.** (Brief spells it "Cricheros"; the product is CricHeroes.) |
| Opponent rendering | `components/matches/MatchCardHeader.tsx` — used by `PlayerMatchCard` (Player Home + Player Matches) and the Admin Match Center cards | One change covers all three screens. |
| **Actual Match Fee Paid** | **`matches.groundFeePaidAmount`** (+ `isGroundFeePaid`, `groundFeeSetBy/Name/At`, append-only `groundFeeHistory`) | Match-level **aggregate expense actually paid to the ground/vendor**. Server-only field (rules `matchFinanceServerKeys`). **Written only** by `POST /api/finance/match-ledger` `{action: "setGroundFee" \| "adjustGroundFee"}` guarded by `requireFinanceAdmin` (Finance/Super), in a transaction with server audit; correction needs a reason; locked when `financeStatus == "closed"` (adjustment path). **Read** by `buildMatchFinancialStatement()` as `actualFeePaid` → Net Match Result = max player collection − actual fee; required before closing match finances. Distinct from `matches.fee` (configured per-player fee) and `matchFeeBudget`. **Unambiguous — reused as-is.** |
| Badges | `badges/{id}` {playerId, playerName, badgeType, note?, matchId?, awardedBy, awardedByName, awardedAt, redeemed}; types in `DEFAULT_BADGE_DEFS` (`components/BadgeIcon.tsx`) + custom `badgeTypeDefs`; client create rule `isClubAdmin()` | New default type `player_of_weekend` (stackable, gold). |
| Home banner | `components/home/bannerSlides.ts` builds slides from pinned announcements (`posts` with `isAnnouncement` + `isPinned`), promos and birthdays; `CampaignHeroBanner` renders them | Add a `potw` slide kind fed by a pinned announcement post — no parallel banner framework. |
| Notifications | `notifications` collection {userId (login uid), title, message, type, metadata, expiresAt}; `lib/notifications.createNotification` | Server writes with a deterministic id for idempotency. |
| Scheduling | **None.** Amplify Hosting has no scheduled jobs; `scripts/run-dues-check.sh` is a manual local script; CI only runs tests/rules deploy | See §2. |

## 2. Scheduler approach — server-computed, time-gated prompts (no new infra)

Prompts are **derived from data + the server clock (Asia/Kolkata)**, not fired by a job:

- `GET /api/admin/weekend-prompts` (ID-token authenticated) returns, for the caller's verified roles only, the prompts that are **due** and still **pending**:
  - **Results:** due from **Sunday 19:00 IST**; items = matches in the look-back window with `result` missing/`Pending` and *estimated end + 6 h ≤ now*.
  - **Player of the Weekend:** due **Monday 08:00 IST** until **Friday 23:59 IST** for the preceding Sat–Sun weekend, if no award exists for that weekend.
  - **Actual fee:** due from **Tuesday 08:00 IST**; items = matches in the look-back window with no `groundFeePaidAmount` and finances open.
- The client asks once after login (and on pull-to-refresh) and shows at most one modal per workflow per session; **Skip for Later** stores a session-only dismissal. Nothing depends on a device timer being open at the scheduled time — an admin who logs in later still gets the prompt.
- Pending/completed state **is the data itself** (result set, award exists, fee set), so multiple admins can't double-complete and retries are safe.
- One shared module `lib/weekend-ops.ts` (pure, unit-tested) holds the IST calendar, due-times, weekend id and eligibility rules for all three prompts.

(True push reminders at the exact minute would need a scheduler — e.g. Cloud Scheduler → authenticated endpoint. Not required by the brief; listed as a future option.)

## 3. Writes, permissions and idempotency

| Workflow | Write path | Guard (existing architecture) | Idempotency |
|---|---|---|---|
| Results | **New** `POST /api/admin/weekend-results` (Admin SDK transaction per match) | `requireMatchAdmin` (Super Admin; legacy Match Admin flag) — see Q1 | Writes only if `result` is still missing/`Pending`; otherwise 409 (no silent overwrite). Corrections stay in the existing Match Center edit form. Server audit entry. |
| Player of the Weekend | **New** `POST /api/admin/player-of-weekend` (one transaction) | `requireClubAdmin` (Super + Club Admin = existing badge authority) | Deterministic ids: `badges/potw_<weekendId>`, `posts/potw_<weekendId>`, `notifications/potw_<weekendId>`; transaction aborts if the badge already exists → one award, one banner, one notification on any retry or concurrent admin. |
| Actual fee | **Existing** `POST /api/finance/match-ledger {action:"setGroundFee"}` | `requireFinanceAdmin` (unchanged) | Prompt sends only for matches with no recorded fee; the route already rejects silent changes (correction needs a reason) and closed matches. Existing Match → Finance tab remains the edit/correction path. |
| CricHeroes link | Read-only (`matchUrl`) | — | Shown only for a valid `https://` CricHeroes URL (`cricheroes.in` / `cricheroes.com`); opened with `target="_blank" rel="noopener noreferrer"` via the existing safe-href helper. |

**No Firestore rules changes** (server routes use the Admin SDK with existing server-side role checks). **No new collections.** New *fields* only on new documents: badge `weekendId` + `note` (message); post `kind: "potw"` with `{playerId, playerName, photoURL, message, weekendId}`.

## 4. UI

- **Prompt host** in `app/page.tsx` (Admin persona and Player persona for admins — prompts are admin work; see Q6): modals matching the storyboard — *Enter Match Results* (grouped by date, Won/Loss/Tie/Abandoned radios, Save Results / Skip for Later), *Select Player of the Weekend* (searchable player select, optional message ≤ 4 lines / 120 chars, live banner preview, Skip / Grant Award), *Enter Actual Match Fee* (per-match ₹ input, numeric ≥ 0 validation, Save Fees / Skip for Later).
- **CricHeroes link:** `View on CricHeroes ↗` placed in the existing "vs" label row above the opponent inside `MatchCardHeader` → no new row, no height change.
- **Banner:** new `potw` slide in the existing carousel (photo, crown + "Player of the Weekend", name, message), gold/scarlet; **badge:** new SVG trophy-and-laurel badge in `BadgeIcon`.

## 5. Testing plan

Unit (production imports): IST due-time/weekend-id maths incl. week boundaries; eligibility (6-hour rule, look-back, already-recorded exclusion); result mapping; message validation; CricHeroes URL validation. Emulator: the two new routes — role checks (player / wrong role / no token denied), no-overwrite, idempotent award (concurrent + retry → exactly one badge/post/notification), fee route unchanged. E2E (synthetic sessions): each modal, partial save, skip, role visibility, banner + badge rendering, link present/absent on all three screens. Plus full functional, emulator and e2e suites, tsc, lint, build.

## 6. Questions for the owner (block the marked items)

1. **Who records results now?** Rules today allow Match Admin (legacy) and Finance/Super Admin, **not Club Admin** (D-19 role consolidation not yet implemented). Proposal: Super Admin + legacy Match Admins now; Club Admins automatically once Workstream B lands. Or implement Workstream B first.
2. **Match end time** (no field exists). Proposal: estimated end = start + 4 h (T20) / 5 h (T30) / 6 h (Other); eligible 6 h after that.
3. **Abandoned:** should saving "Abandoned" in the prompt also run the existing waiver reconciliation for that match (a Finance Admin action today), or leave waivers to Finance as now? Dues exclude abandoned matches either way.
4. **Times:** Results Sunday 19:00; POTW Monday 08:00 (open until Friday 23:59); Fees Tuesday 08:00 — all IST. OK?
5. **Look-back:** 14 days for testing; after testing, reduce to 7 days (current weekend + stragglers)? Proposed as one server constant changed by a follow-up commit.
6. **Where prompts appear:** only in Admin persona, or also when an admin is in Player persona (D-16 isolates admin actions from the Player persona — proposal: Admin persona only, with a small badge on the header Admin toggle when prompts are pending).
7. **POTW banner:** how long should it stay in the Home banner — 7 days (until the next award)? Uses `players.photoURL` (initials fallback when no photo).
