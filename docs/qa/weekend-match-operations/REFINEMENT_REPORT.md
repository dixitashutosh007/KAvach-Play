# Weekend Match Operations — Refinement & Bug Fixes (D-21 addendum)

**Branch:** `feat/weekend-match-operations`. Base `8246510` = `mig-mov` before this sprint. Final SHA: see the delivery message. · **Date:** 2026-11-24

**Verification:**
- Done by the implementation agent: unit tests, Firestore-emulator route tests, Playwright (Chromium desktop and mobile) and **Playwright WebKit with iPhone profiles**.
- **Not independent QA, and not a physical iPhone.**
- Not deployed anywhere. No production data was read or written.

---

## 1. Root causes

### 1. CricHeroes hyperlink "not working reliably / unclear where to click"

Reproduced by inspecting the rendered cards and links.

1. **The target was tiny.** The link was an 11 px "View on CricHeroes" label beside "vs", about 16 px tall against a 44 px guideline. A tap that missed it landed on the card, which opened the match details instead.
2. **Valid links were hidden.** The URL check accepted only `cricheroes.in` / `cricheroes.com`. Any `matchUrl` using another CricHeroes share or short-link domain silently showed **no link at all**.
3. **Unsafe and inconsistent elsewhere.** The detail views, Admin match card, Match info card and calendar used the raw `matchUrl` as the `href` with **no scheme check**, so `javascript:` or `data:` values were not blocked there. The Admin card's link also lacked `noopener`.

### 2. iPhone Player Matches: no T30 / Jersey at the top-right

Reproduced with Playwright WebKit (the Safari engine) using iPhone 13 Mini (375), iPhone 14 (390) and iPhone 14 Pro Max (430) profiles, plus 320 px (Display Zoom), with realistic data (Practice/Tournament ribbon, long opponent name).

- The **Player Matches card never had top-right metadata.** Only the mobile *Home* card used the top-right corner tab. The Matches list kept format + jersey inside the left identity column at every width and in every engine (WebKit and Chromium render it the same).
- At narrow widths the identity column is only about 85–100 px wide. The T20 + jersey row is about 100 px, so the **jersey overflows onto the column divider** and the opponent is truncated to "Royal Challen…" (`iphone-before-320-card.png`).
- On real iPhones, Display Zoom, larger text and long names push this further.
- No WebKit-only CSS defect was found. There is no `-webkit-mask`, container queries are supported, and `clip-path` renders correctly. The fault is the layout design at phone widths.

### 3. Admin task completion: slow, appears frozen, several clicks

Diagnosed by inspecting code. Production timing could not be measured from here.

| Cause | Effect |
|---|---|
| After a successful save the window **waited for a full refetch** of the prompt data before closing | Two server round trips before any feedback |
| Results route saved matches **one after another**: transaction, audit, and for Abandoned the waiver | Latency grew with every match |
| Fee prompt sent its ledger requests **one after another** | Same |
| POTW route did the actor-name lookup and linked-login query **sequentially** before its transaction | Extra wait |
| No success confirmation, no "Saving…" text, no in-flight guard beyond a disabled state | Admins clicked Save again; a fast double click could reach the handler twice |
| No retry state; errors were unclear | Admins could not tell whether the save had worked |

Firestore transactions, audit entries and idempotency were **not** the bottleneck and were not weakened.

### 4. Historical backfill depended on a temporary popup

- The only backfill entry point was a chip that showed only on the Match Center tab.
- It covered results only.
- There was no fee or Player of the Weekend history and no counts.
- POTW could be awarded only for the current window.

---

## 2. What changed

### 1. CricHeroes link

- New shared **`MatchOpponentName`** (`components/matches/MatchCardHeader.tsx`). The opponent name itself is the link, underlined with a small scarlet external-link icon. Same font, size and two-line clamp as before, so card layout and height are unchanged.
  - The icon sits **outside the clamped text**, so it stays visible beside a truncated name.
  - `target="_blank"`, `rel="noopener noreferrer"`. The click is stopped so it never opens the card.
  - Without a valid URL the name is plain text and no link is drawn.
- Used in all three card bodies: Player Home (compact and desktop), Player Matches, Admin Match Center. Also used in the **Player match detail** (`h1`) and **Admin match detail** (`h2`) headers.
- **`cricHeroesHref`** (`lib/weekend-ops.ts`):
  - Accepts any https host. `http` is upgraded to https, and a bare `host/path` gets `https://`.
  - Rejects `javascript:`, `data:`, `vbscript:`, `mailto:`, protocol-relative, credentialed, dot-less-host, whitespace and over-long values.
  - **Every** remaining `href={…matchUrl}` now goes through it: `PlayerMatchDetailModal`, `MatchesTab`, `MatchInfoCard`, `MatchCalendarView` ×2.

### 2. iPhone match card

- `PlayerMatchCard` now always passes the **top-right corner tab** (format + jersey, `md:hidden`).
- `MatchCardHeader` gains `chipsInCornerOnMobile`, which hides the identity-column chips below `md`. Desktop is unchanged.
- The top bar is safe at narrow widths:
  - The ribbon can shrink and truncate.
  - Below 400 px the "Next Match" chip shows its icon only; the text stays available to screen readers.
- Result in WebKit: corner visible on every card, no overlaps, no horizontal scroll. Card height drops from **233 to 201 px**, because the chip row no longer takes its own line.

### 3. Admin task experience (`components/weekend-ops/WeekendPrompts.tsx`)

- **Closes on confirmed success:**
  - Results: everything chosen is saved.
  - Player of the Weekend: on award.
  - Actual fee: every entered row is saved.
  - A toast confirms each.
- Local pending counts update at once, and the server refresh runs **in the background**.
- **"Saving…" state** only on that window's submit button, with `aria-busy`. A ref-based **in-flight guard** stops double clicks before React re-renders. Close and Skip keep working while saving, and nothing else on the page is blocked.
- **On failure:**
  - The window stays open and every entered value is kept.
  - The button becomes **Retry**.
  - Per-row notes appear: conflict, not eligible, server error, or waiver failed.
  - A retry resubmits only what is still unsaved.
- **Server:**
  - `/api/admin/weekend-results` processes matches **concurrently**. Each keeps its own transaction, eligibility check, no-overwrite rule, audit entry and waiver. Order is preserved. An unexpected failure on one match returns `error` for that match without blocking the others.
  - `/api/admin/player-of-weekend` runs its independent reads in parallel.
  - The fee prompt sends its existing-route requests together.
- **Match Center task panel:**
  - Lists every pending recurring task, so a skipped or closed popup stays reachable there.
  - Includes the Historical Data Completion section.
  - Completion by any admin removes the task for everyone, because state is server-derived.
  - Other admin tabs keep the compact task bar.

### 4. Historical Data Completion

- **`GET /api/admin/weekend-prompts?view=history`** is role-scoped. It returns counts and lists, **disjoint from the recurring prompts**:
  - **Match Results:** eligible matches with no result, outside the current results prompt. Missing start or format is listed as an exception, never guessed.
  - **Actual Match Fee Paid:** concluded, not archived, finance-open matches with no `groundFeePaidAmount`, outside the current fee prompt.
  - **Player of the Weekend:** past weekends (Saturday ids) with at least one *played* match (Won/Lost/Tie/Draw), on or after `POTW_HISTORY_FROM`, with no award, excluding the weekend whose regular window is open.
- **Historical POTW award:** `POST /api/admin/player-of-weekend {source:"history", weekendId, playerId, message?}`.
  - Requires the same Club/Super authority, a server-validated eligible weekend, and the same deterministic id and transaction, so it is **idempotent**.
  - Creates the badge (`historical: true`), the notification and the audit entry, but **no Home banner**, so an old award cannot displace the current one.
- **UI:** a dedicated window per category.
  - Month filter, nothing pre-filled, batch entry (results and fees), a weekend picker for POTW.
  - Saved rows show **Saved** in place, with a "*n* completed · *m* pending" progress line.
  - Counts drop immediately after a confirmed save.
  - Lists persist across refresh, logout and other admin accounts because they are computed from the data.
- Nothing is generated automatically. Existing records are never overwritten; the results route still refuses conflicts. Writes use the existing trusted routes and audit.

---

## 3. Schema and API changes (with justification)

| Change | Why |
|---|---|
| `GET /api/admin/weekend-prompts?view=history` (replaces `?view=backfill`) | One role-scoped, read-only source for the persistent historical lists and counts |
| `POST /api/admin/player-of-weekend` accepts `source: "history"` | Explicit historical awards; same guard, validation, idempotency and audit |
| Badge field `historical: true` (historical awards only) | Distinguishes backfilled awards; no rule change (server writes only) |
| Results outcome status `"error"` | Per-match retryable failure instead of aborting the whole batch |
| Server env `POTW_HISTORY_FROM` (default `2026-01-01`) | Bounds how far back POTW history goes — **owner to confirm** |

**Unchanged:**
- Firestore rules; `lib/server-auth.ts`; role lists. Results are still Super/Match Admin; POTW is Club/Super; fees are Finance/Super.
- `/api/finance/match-ledger`; the waiver policy; payments and Razorpay; `matches.groundFeePaidAmount` as the authoritative fee; `matches.matchUrl` as the CricHeroes source.
- No new collections and no migrations.

## 4. Files changed in this sprint

- **Components:** `components/matches/{MatchCardHeader,PlayerMatchCard,PlayerMatchDetailModal,MatchDetailsSummary,MatchInfoCard}.tsx`, `components/{MatchesTab,MatchCalendarView}.tsx`, `components/weekend-ops/WeekendPrompts.tsx`.
- **Libraries:** `lib/weekend-ops.ts`.
- **Routes:** `app/api/admin/{weekend-results,player-of-weekend,weekend-prompts}/route.ts`.
- **Tests:**
  - New: `e2e/iphone/match-card.webkit.ts` and `playwright.webkit.config.ts`.
  - Updated: `tests/weekend-ops{,.emulator,-ui}.test.mjs`, `e2e/weekend-match-operations.spec.ts`.
  - Two existing tests updated for the requested corner-tab change: `tests/home-mobile-match-card.test.mjs` ("Scope protection") and `tests/player-match-center-ui.test.mjs` (15e now checks the card's own surface class).
- **Docs:** this report, `REFINEMENT_QA_PROMPT.md`, screenshots, and the `DECISION-LOG.md` addendum.

## 5. Screenshots (`docs/qa/weekend-match-operations/screenshots/`)

| Files | Shows |
|---|---|
| `iphone-before-{320,375,390,430}-card.png`, `iphone-after-{320,375,390,430}-card.png` | iPhone card before/after (WebKit) |
| `07-cricheroes-player-home.png`, `08-cricheroes-player-matches.png`, `08b-cricheroes-player-detail.png`, `09-cricheroes-admin-match-center.png` | CricHeroes opponent link |
| `12-results-failed-retry.png`, `13-results-saving.png`, `14-fees-partial-failure.png` | Admin task workflow |
| `01–06` | Original prompts |
| `15-match-center-tasks-history.png` | Match Center tasks + Historical Data Completion |
| `16-history-results-partial.png` | Historical results with Saved/progress and month filter |
| `17-history-potw.png` | Historical POTW |

## 6. Tests

See the delivery message for the final counts. The checks this sprint was asked to verify:

| # | Check | Evidence |
|---|---|---|
| 1 | Link opens the correct match in a new tab | Chromium e2e on Player Home, Player Matches list, Player match detail, Admin Match Center; WebKit iPhone ×4 (tap) |
| 2 | No card navigation | Card and list stay; detail view not opened |
| 3 | No broken link | `javascript:` URL renders plain text (e2e + unit) |
| 4 | T30/Jersey at the top-right | WebKit 320/375/390/430: visible, in the top-right corner, no overlap, no horizontal scroll |
| 5 | Long names | Clamp to 2 lines; icon stays visible |
| 6–8 | Windows close on success | e2e |
| 9 | Failure keeps values and retries | Results, POTW, fees |
| 10 | Double click | One request (e2e); concurrent awards → one badge (emulator WO-12/19) |
| 11 | Skipped tasks persist | Shown in the Match Center panel |
| 12 | Completion visible to other admins | Emulator WO-15/18/19; server-derived |
| 13 | Persistence after refresh | e2e reload; logout/login is the same server computation |
| 14 | Counts after partial completion | e2e + WO-18/19 |
| 15 | No duplication with recurring prompts | WO-15/18/19 + unit |
| 16 | Regression | Full functional, emulator and Playwright suites |

**Mutation checks** (each fails the suite; code restored afterwards):

| Mutation | Result |
|---|---|
| Allow any weekend for a historical award | WO-19 fails |
| Stop excluding recurring items from history | WO-18 fails, plus unit tests |

**Console and network:** the e2e suites track the save requests (counts and payloads asserted). No unexpected requests or page errors failed the runs. Production network timing was not observable.

## 7. Limitations and decisions

1. **WebKit is not a physical iPhone.**
   - iOS text autosizing, Dynamic Type and Safari chrome cannot be emulated.
   - Playwright WebKit needed `cdn.playwright.dev`. You approved adding it to the KAvach-Play environment, and this session moved onto that environment.
   - Physical-device confirmation is part of the QA prompt.
2. **Production save latency was not measured** (no production access). The fixes remove avoidable sequential waits. Cold starts on the hosting platform remain outside this change.
3. **`POTW_HISTORY_FROM` default `2026-01-01` is a placeholder.** Please confirm the date from which past weekends should be eligible.
   - There is no "no award for this weekend" disposition, so a weekend stays pending until awarded or until the start date moves past it.
   - Recording an explicit "no award" would need a small new record type: an owner decision.
4. **The historical fee list includes every concluded match since before the fee field existed** (it was introduced recently), so the initial count may be large. This is by design, as requested.
5. Phones under 400 px show the Next Match chip as icon-only (sparkle) to fit the corner tab. Owner to confirm.
6. Carried over from the first report:
   - `posts` writable by any admin client (rules unchanged).
   - The Match Center edit form's "Abandoned" path does not run the waiver.
   - SUB-001 and IDT-003 open (D-17).

## 8. Final verification (commit `41f89c7`)

| Check | Command | Result |
|---|---|---|
| Type-check | `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Unit / functional | `npm run test:functional` | 1127 / 1127 pass, 0 skipped |
| Emulator (rules, payments, identity, weekend routes) | `node scripts/run-emulator-tests.mjs` | 464 / 464 pass, 0 skipped |
| WebKit iPhone (320 / 375 / 390 / 430) | `npx playwright test -c playwright.webkit.config.ts` | 4 / 4 |
| Full e2e, Desktop + Mobile Chrome | `npx playwright test` | 263 passed, 17 failed, 98 skipped (credential-gated, not executed) |
| Build | `GIT_BRANCH=mig-mov npm run build` | Pass (30 / 30 pages) |

All 17 failures are the known pre-existing set, recorded since before D-16:
- `match-center-corrections` ×2 and `player-home-behavioral` 1 / 2 / 2B / 4D / 4E / 4G, each on both projects;
- `production-app` 3 on Desktop.

There are **no new failures**. All weekend-operations e2e tests pass on both projects.
