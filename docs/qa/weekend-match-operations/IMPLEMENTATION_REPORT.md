# Weekend Match Operations — Implementation Report (D-21)

**Branch:** `feat/weekend-match-operations` (base `192fdd6` = `mig-mov`) · **Date:** 2026-11-24
**Plan:** `docs/implementation/WEEKEND_MATCH_OPERATIONS_PLAN.md` · **Decision:** D-21 in `docs/implementation/DECISION-LOG.md`
**Verification type:** implementation-agent verification only: unit tests, Firestore-emulator route tests, and Playwright on a local dev server with the synthetic session harness. **This is not independent QA.** Nothing has been deployed to staging or production, and no production data was read or written.

## 1. What was built

| Feature | Where | Writes through |
|---|---|---|
| **A. Weekend results prompt** (+ historical backfill queue) | Admin persona modal; Match Center → "Missing results (backfill)" | **New** `POST /api/admin/weekend-results` |
| **B. Player of the Weekend** | Admin persona modal; Home banner slide; new SVG badge | **New** `POST /api/admin/player-of-weekend` |
| **C. CricHeroes hyperlink** | "vs" row of every match card (Player Home, Player Matches, Admin Match Center) | Read-only (`matches.matchUrl`) |
| **D. Actual match fee prompt** | Admin persona modal | **Existing** `POST /api/finance/match-ledger {action:"setGroundFee"}` (unchanged) |
| Schedule and pending state | All prompts and the persona-toggle indicator | **New** read-only `GET /api/admin/weekend-prompts` |

The features are independent. Each has its own route or read path, modal, tests and screenshots. Shared rules live in one pure module, `lib/weekend-ops.ts`.

## 2. Role matrix (enforced server-side; UI visibility is not authority)

| Action | Super Admin | Match Admin (legacy) | Club Admin | Finance Admin | Designer / Studio | Player | Anonymous |
|---|---|---|---|---|---|---|---|
| See / record match results, backfill queue | ✅ | ✅ | ❌ 403 *(until D-19 Workstream B)* | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 401 |
| Grant Player of the Weekend | ✅ | ❌ 403 | ✅ (existing badge authority) | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 401 |
| Enter actual match fee (existing route) | ✅ | ❌ 403 | ❌ 403 | ✅ | ❌ 403 | ❌ 403 | ❌ 401 |
| Abandoned-match waiver | Runs **inside** the results route as a fixed server transition. Match Admins cannot call the Finance reconcile route (403, test WO-08). |

The role lists are in `lib/weekend-ops-server.ts`: `RESULT_RECORDER_ROLES`, `POTW_AWARD_ROLES` and `FEE_ROLES`. `GET /api/admin/weekend-prompts` returns only the sections the caller's verified roles allow.

## 3. Scheduler configuration

No new infrastructure was added; the hosting has no scheduled jobs. A prompt becomes due from server time (Asia/Kolkata) and pending data state. It is offered on the **first Admin-persona visit after its scheduled time**, and it disappears for every admin once the work is recorded.

| Prompt | Due | Items | Clears when |
|---|---|---|---|
| Results | Sunday 19:00 IST | Matches started within the look-back with no result, 6 h after estimated end (T20 4 h / T30 5 h / Other 6 h) as of that Sunday 19:00 | `matches.result` is set |
| Player of the Weekend | Monday 08:00 → Friday 23:59 IST | Preceding Sat–Sun (`weekendId` = Saturday) | Badge `potw_<weekendId>` (or its post) exists |
| Actual fee | Tuesday 08:00 IST | Concluded matches with no `groundFeePaidAmount`, finances open, not archived | `groundFeePaidAmount` is set (₹0 counts) |

**Look-back mode:** server env `WEEKEND_OPS_MODE`.
- **Testing (default, unset):** results and fees use 14 days.
- **`recurring`:** results use 7 days and fees use the preceding Sat–Sun.

Switching to `recurring` after validation is an environment setting and needs no code change.

**Exceptions:** matches with a missing or invalid start time or format are never guessed. They are listed as exceptions in the results prompt (within its window) and in the backfill queue.

## 4. Abandoned-match integration (no parallel waiver)

The existing per-match logic in `app/api/admin/reconcile-abandoned/route.ts` was extracted **unchanged** into `lib/abandoned-match.ts`, and both routes now call it:
- Unpaid obligations become `Waived` with `waivedReason "Match Abandoned"` and `waivedAt`. Original amount, player, match and other fields are untouched.
- `Paid` records are not modified, and no refund is made.
- Records that are already waived are left alone.

The one addition is a server audit entry per match when something is waived, written to the existing `auditLogs` via `writeServerAudit`. This also applies to the Finance route; dry runs write nothing.

The waiver runs after the result is saved. If it fails, the result stays "Abandoned" and the outcome reports `waiver: failed`. Re-sending the same result retries it safely (test WO-08). Dues already exclude abandoned matches through the existing `isMatchBillable`.

## 5. Idempotency and concurrency

- **Results:** one transaction per match. An existing result is never overwritten (`conflict`), and the same value is a no-op. Two admins saving different values at the same time: exactly one wins, with one audit entry (WO-06).
- **Player of the Weekend:** one transaction creates the badge, the banner post, the notification (only when the player has exactly one linked login in `appUsers.playerId`) and an audit entry. All use deterministic ids `potw_<weekendId>` and `tx.create`. Concurrent or retried awards produce exactly one of each; the other caller gets 409 (WO-12).
  - The badge is excluded from the manual award picker, so it can only come from this workflow.
  - A pinned POTW post still yields one banner slide.
- **Fees:** the existing route already rejects a changed amount without a reason. The prompt only lists matches with no recorded fee.

## 6. Files changed (vs `192fdd6`)

**New:**
- Server: `lib/weekend-ops.ts`, `lib/weekend-ops-server.ts`, `lib/abandoned-match.ts`.
- Routes: `app/api/admin/{weekend-results,player-of-weekend,weekend-prompts}/route.ts`.
- UI: `components/weekend-ops/WeekendPrompts.tsx`.
- Tests: `tests/weekend-ops.test.mjs`, `tests/weekend-ops-ui.test.mjs`, `tests/weekend-ops.emulator.test.mjs`, `e2e/weekend-match-operations.spec.ts`.
- Docs: the plan, this report, the QA prompt and screenshots.

**Modified:**
- `app/api/admin/reconcile-abandoned/route.ts`: uses the shared waiver and adds the audit entry; behaviour is otherwise identical.
- `app/page.tsx`: mounts the prompt host and feeds the pending count.
- `components/layout/AppHeader.tsx`: pending indicator on the toggle.
- `components/matches/MatchCardHeader.tsx`: shared `MatchVsLabel` with the CricHeroes link.
- `components/BadgeIcon.tsx`: POTW definition and SVG.
- `components/BadgesTab.tsx`: POTW excluded from manual awards.
- `components/home/{bannerSlides.ts,CampaignHeroBanner.tsx}`: POTW slide.
- `lib/types.ts`: optional `Post.kind` and `Post.potw`.
- `docs/implementation/DECISION-LOG.md`: D-21.

**Not changed:**
- Firestore rules.
- `lib/server-auth.ts` and every existing role check.
- `/api/finance/match-ledger`, Razorpay and payment processing, dues and fee calculation, configured or individual match fees.
- Role assignments.

There are **no new collections and no data migrations.** The only new fields are on documents these routes create: badge `weekendId`; post `kind` and `potw`.

## 7. Test evidence

See §9 for counts. Key emulator scenarios, all run against the real route code (`tests/weekend-ops.emulator.test.mjs`):

| ID | Scenario |
|---|---|
| WO-01 | Results: anonymous 401; player, Finance Admin and **Club Admin** 403 |
| WO-02 | Match Admin and Super Admin record a result; audit entry written |
| WO-03 | No overwrite (conflict); same value is a no-op |
| WO-04 | Server re-checks eligibility: too early, missing format, Pending/Draw rejected, unknown or invalid ids |
| WO-05 | Partial save |
| WO-06 | Concurrent different results → exactly one saved |
| WO-07 | Abandoned → unpaid waived (amounts kept), paid preserved, not-playing untouched, waiver audited with the actor |
| WO-08 | Waiver retry is idempotent; picks up a late unpaid record; Finance route sees nothing left; Match Admin 403 on the Finance route |
| WO-09 | Finance reconcile: dry run writes nothing; real run waives and audits; non-abandoned match rejected |
| WO-10 | Award authority (anonymous, player, Match Admin, Finance Admin denied) |
| WO-11 | Award validation: closed window, past weekend, unknown, disabled or merged player, message over 4 lines or 120 characters |
| WO-12 | Two admins award at once → one badge, one post, one notification, one audit; retry 409 |
| WO-13 | Unlinked player: award and banner, no notification |
| WO-14 | Prompt sections per role |
| WO-15 | Results due only from Sunday 19:00; old matches never in the recurring prompt; backfill queue role-gated |
| WO-16 | POTW window Mon 08:00 – Fri 23:59; pending until awarded; a revoked badge with a remaining post is not re-prompted |
| WO-17 | Fee prompt lists open matches, including abandoned ones; only Finance/Super can write; amount stored with history and audit; configured `fee` unchanged; correction needs a reason; ₹0 counts as recorded |

**Mutation checks** (the tests fail when the production code is broken, then the code was restored):

| Mutation | Result |
|---|---|
| Add Club Admin to the result roles | 3 tests fail |
| Remove the duplicate-award guard and use `set` instead of `create` | WO-12 fails |
| Remove the no-overwrite check | 4 tests fail |

## 8. Screenshots — `docs/qa/weekend-match-operations/screenshots/`

| # | Shows |
|---|---|
| 00 | Pending indicator on the toggle (Player persona) |
| 01 | Results modal |
| 02 | POTW modal with live banner preview |
| 03 | Actual fee modal |
| 04 | Task bar after partial completion |
| 05 | Results bottom sheet at 390 px |
| 06 | Historical backfill queue |
| 07 – 09 | CricHeroes link on Player Home, Player Matches and Admin Match Center |
| 10 – 11 | POTW banner at desktop and 390 px; the new badge is in the banner |

## 9. Commands and results

| Check | Command | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Lint | `npm run lint` | 0 errors, 4 warnings (pre-existing, Firestore rules only) |
| Unit / functional | `npm run test:functional` | 1119 / 1119 pass, 0 skipped (33 new) |
| Emulator (rules, payments, identity, new routes) | `node scripts/run-emulator-tests.mjs` | 461 / 461 pass, 0 skipped (17 new) |
| New e2e | `npx playwright test e2e/weekend-match-operations.spec.ts` | 9 / 9 (Desktop Chrome) |
| Full e2e (Desktop + Mobile Chrome) | `npx playwright test` | 251 passed, 21 failed, 98 skipped (credential-gated, not executed) — see §9a |
| Re-run after fix | `npx playwright test e2e/player-match-center-behavioral.spec.ts e2e/weekend-match-operations.spec.ts` | 46 / 46 (both projects) |
| Build | `GIT_BRANCH=mig-mov npm run build` | Pass (30/30 pages) |

### 9a. Full e2e breakdown

- **17 failures are pre-existing** and also fail before D-16:
  - `match-center-corrections` ×2;
  - `player-home-behavioral` 1 / 2 / 2B / 4D / 4E / 4G;
  - both of the above on both projects;
  - `production-app` 3 on Desktop.
- **4 failures were caused by this workstream and are fixed.** `player-match-center-behavioral` 1 and 2 failed on both projects because the shared "vs" label dropped the space between "vs" and the opponent: the text read "vsDelhi Challengers", which screen readers would also read. The space is restored, a unit test now guards it, and both specs plus the weekend suite re-ran 46 / 46.

## 10. Limitations and residual risks

1. **Prompts are shown on visit, not pushed.** With no scheduler there is no phone or email reminder at the scheduled minute. A Cloud Scheduler job calling an authenticated endpoint is a future option.
2. **The e2e suite mocks the weekend API routes**, because the synthetic session has no ID token. The routes' authorisation and data effects are verified only against the Firestore emulator. No staging run has been done; that needs a staging environment and synthetic accounts (AGENTS.md §6).
3. **Recording "Abandoned" through the existing Match Center edit form still does not run the waiver.** That is pre-existing behaviour and was left unchanged (out of scope). Finance can run the shared reconcile route, and dues already exclude abandoned matches. Owner decision: should the edit form use the same server route?
4. **`posts` are writable by any admin client** (existing rule `isAnyAdmin()`), so an admin could hand-craft a `kind:"potw"` post that the banner would show. This is not reachable by players. Tightening it is a rules change, so it was not made; flagged for the security workstream.
5. If a Club Admin deletes a POTW badge, its banner post remains and that weekend is treated as awarded. Revoking an award fully means removing both; there is no UI for revocation.
6. The fee modal saves matches one by one through the existing route. A failed row is reported and kept while the others save.
7. The backfill queue reads the whole `matches` collection, but only when an admin explicitly opens it.
8. The prompt offers Won, Loss, Tie and Abandoned as approved. "Draw" stays available only in the Match Center form.
9. SUB-001 and IDT-003 remain open (D-17); not touched.

## 11. Security statement

No security control was weakened:
- No Firestore rules changes.
- No change to `lib/server-auth.ts` or any existing guard.
- Results are deliberately narrower than `requireMatchAdmin`, which already admits Club Admin.
- Client-supplied roles are never trusted; the routes use `requireRole` on the verified ID token.
- The test clock override (`x-test-now`) works only behind the existing test-auth bypass, which is disabled in production.
- Players cannot reach any new write path.
- No Razorpay, payment, dues or configured-fee logic changed.
- No production deployment and no historical data migration.
