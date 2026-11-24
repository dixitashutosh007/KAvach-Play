# Circuit Standings management — implementation report

**Branch:** `feat/circuit-standings` (from `84b715c`, the current `mig-mov`). Not merged to `mig-mov`; nothing deployed; no production data touched.

## 1. Investigation

| Question | Finding |
|---|---|
| Admin Club → Club Stats | Admin Club section `leaderboard` (tab label "Leaderboard & Stats"), Club/Super only (`lib/admin-navigation.ts`). It renders `ClubStatisticsAdmin` (club totals → `appConfig/clubStats` via `POST /api/admin/club-stats`) and the Leaderboard. |
| Player Circuit Standings | `components/club/PlayerClubTab.tsx` → `ClubAtAGlance`: four hard-coded circuit slots, each showing "Not available". No data was read. |
| Existing data model | None. No collection, type, rule or code stores circuit standings. `appConfig/clubStats` holds only `matchesPlayed` and `matchesWon`, and `appConfig` is publicly readable (login page), so player names do not belong there. The earlier report (player-ui-enhancement §5) recorded this as an open owner decision. |
| Fields needed | Each circuit is a ranked list of club players: **player**, **rank**, the circuit's **metric value** (wins for *Most Wins*, matches played for *Most Played*) and the **as-of date** the standing was taken. |

## 2. Data model (single source of truth)

A new collection, **`circuitStandings`**, holds one document per (circuit, player), with id `${circuit}__${playerId}`. No other copy exists. The Player Club card and the admin manager both read this collection.

| Field | Type | Rule |
|---|---|---|
| `circuit` | string | `india-wins`, `india-played`, `bangalore-wins`, `bangalore-played` |
| `playerId` | string | `players/{id}`; must exist, not disabled, not merged (never a Firebase UID) |
| `playerName` | string | Set by the server from `players/{id}.name` on every save (never client-supplied) |
| `rank` | int | 1–999; ties allowed |
| `value` | int | 0–10,000: wins (Most Wins) or matches played (Most Played) |
| `asOf` | `YYYY-MM-DD` | A real date, not in the future (club timezone Asia/Kolkata) |
| `createdAt`, `updatedAt`, `updatedBy` | server | Admin SDK timestamps and the acting uid |

The shared logic is in `lib/circuit-standings.ts`: validation, ordering, formatting and player eligibility. The server, the admin UI and the Player UI all use it.

## 3. Permissions

| Operation | Player | Finance Admin | Club Admin | Super Admin | Enforced by |
|---|---|---|---|---|---|
| Read standings | ✓ | ✓ | ✓ | ✓ | rules: `allow read: if isSignedIn()` (unauthenticated denied) |
| Add / edit / delete via API | 403 | 403 | ✓ | ✓ | `requireClubAdmin` on POST/PUT/DELETE (retired Match Admin → 403) |
| Direct Firestore writes | ✗ | ✗ | ✗ | ✗ | rules: `allow write: if false` (the API is the only writer) |
| See the manager UI | — | — | ✓ | ✓ | Club → Leaderboard & Stats is Club/Super only; Finance gets access-denied |

Every create, edit and delete writes an `auditLogs` entry (`entity: circuit_standing`) in the same transaction. Edits record the old and new values.

## 4. Files

| File | Change |
|---|---|
| `lib/circuit-standings.ts` | **New.** Model, validation, ordering, formatting |
| `app/api/admin/circuit-standings/route.ts` | **New.** POST/PUT/DELETE: Club/Super only, transactional, audited |
| `hooks/useCircuitStandings.ts` | **New.** Live read of the collection; malformed records dropped |
| `components/club/CircuitStandingsAdmin.tsx` | **New.** Manager: circuit tabs with counts, review list, add/edit form (player search and select, rank, metric, as-of), delete with confirmation |
| `components/ClubTab.tsx` | Mounts the manager under Club Statistics in the Club Stats section |
| `components/club/PlayerClubTab.tsx` | Card shows each circuit's leader (#rank name, value) or "Not available"; footnote shows the as-of date. The **Stats** chip adds the full ranked list. Layout unchanged. |
| `firestore.rules` | **New** `circuitStandings` block (read: signed-in; write: none) |
| `tests/circuit-standings.test.mjs` | **New.** 31 unit/source tests (production imports) |
| `tests/circuit-standings.emulator.test.mjs` | **New.** CS-01 to CS-07 (API), CS-R1 and CS-R2 (rules) |
| `e2e/circuit-standings.spec.ts` | **New.** 7 scenarios × desktop and mobile |

## 5. Tests executed (2026-11-24)

| Run | Result |
|---|---|
| `node --test tests/circuit-standings.test.mjs` | **31/31** |
| `node scripts/run-emulator-tests.mjs tests/circuit-standings.emulator.test.mjs` | **9/9** |
| Mutation: rules write changed to `isClubAdmin()` | CS-R2 **fails** as expected (8/9); rules restored |
| `npx playwright test e2e/circuit-standings.spec.ts e2e/player-ui-enhancement.spec.ts e2e/club-shop.spec.ts` (Desktop and Mobile Chrome) | **56/56** |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 4 pre-existing warnings |
| `npm run build` | pass (33/33 pages) |
| `npm run test:functional` | 1162/1182. The **same 20 failures as base `84b715c`** (1131/1151), all pre-existing D-22 role-model tests. |
| All 22 emulator suites | 438/463. The **same 25 failures as before**, all pre-existing D-22 role-model tests. |

The e2e runs use the synthetic-session harness with the API mocked. Authorisation and persistence are covered against the emulator. Local runs need `AWS_BRANCH=mig-mov`, because database routing fails closed for feature-branch names (by design).

## 6. Deployment note and limitations

- **Rules deployment needed before use:** until `firestore.rules` with the `circuitStandings` block is applied to a database, the catch-all deny rule blocks reads. Players then see "Circuit standings couldn't be loaded right now." Not deployed here.
- No standings were seeded. Every circuit shows "Not available" until an admin enters verified records.
- `playerName` is a snapshot taken at save time. If a player is renamed, the standing keeps the old name until it is next edited.
- Records are not removed automatically when a player is later disabled or merged. They stay visible until an admin edits or deletes them.
