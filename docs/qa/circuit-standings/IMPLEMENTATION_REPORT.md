# Circuit Standings management — implementation report

**Branch:** `feat/circuit-standings`. Nothing deployed; no production data touched.

## Revision 2 (owner correction, 2026-11-24)

The first version (`5e48cd6`) modelled a standing as a ranked list of **players**. The owner clarified that a standing is the **club's own** position in each circuit:

> KAvach is #20 in all-time wins across India with 500 wins · #15 in all-time matches played across India with 700 played · #4 in all-time wins across Bangalore with 115 wins · #4 in all-time matches played across Bangalore with 200 played.

So there is no player selection. There are exactly four standings, and each has a **rank** and a **total** (wins or matches played). This revision replaces the player-based model, API, admin screen and Player display.

## 1. Investigation (unchanged)

- Admin Club → Club Stats is the `leaderboard` section ("Leaderboard & Stats"), Club/Super only. It already held `ClubStatisticsAdmin` (club totals → `appConfig/clubStats`).
- The Player Club card (`ClubAtAGlance`) had four hard-coded slots showing "Not available". No data source existed anywhere.
- `appConfig` is publicly readable (login page), so the standings get their own signed-in-only collection.

## 2. Data model (single source of truth)

Collection **`circuitStandings`**, one document per circuit, with the **document id equal to the circuit key**. There are at most four documents.

| Field | Type | Rule |
|---|---|---|
| `circuit` | string | `india-wins`, `india-played`, `bangalore-wins`, `bangalore-played` (must equal the doc id) |
| `rank` | int | KAvach's position, 1–100,000 |
| `value` | int | 0–100,000: wins (Most Wins) or matches played (Most Played) |
| `updatedAt`, `updatedBy` | server | Admin SDK timestamp and the acting uid |

Shared logic lives in `lib/circuit-standings.ts`: validation, formatting, and a defensive read that drops malformed or old player-shaped records.

## 3. Permissions

| Operation | Player | Finance Admin | Club Admin | Super Admin | Enforced by |
|---|---|---|---|---|---|
| Read standings | ✓ | ✓ | ✓ | ✓ | rules: `allow read: if isSignedIn()` |
| Set / edit (PUT) or clear (DELETE) | 403 | 403 | ✓ | ✓ | `requireClubAdmin` (retired Match Admin → 403) |
| Direct Firestore writes | ✗ | ✗ | ✗ | ✗ | rules: `allow write: if false` |
| See the manager | — | — | ✓ | ✓ | Club Stats section is Club/Super only |

Every set, edit and clear writes an `auditLogs` entry (`entity: circuit_standing`, `entityId: <circuit>`) in the same transaction, with old and new values.

## 4. Screens

- **Admin Club → Club Stats:** a Circuit Standings section below Club Statistics with four cards (India / Bangalore × Most Wins / Most Played).
  - Each card shows the saved value (e.g. "#20 · 500 wins" or "Not set") and two fields pre-filled with it: **Rank (#)** and **Wins** / **Matches played**.
  - **Save** is enabled only when something has changed. **Clear** asks for confirmation.
- **Player Club card:** the same layout as before. Each circuit shows **#rank** and the total (e.g. "#20 / 500 wins"), or "Not available" when not set. The footnote reads "KAvach's all-time rank in each circuit."

## 5. Files

| File | Change |
|---|---|
| `lib/circuit-standings.ts` | Model, validation, formatting |
| `app/api/admin/circuit-standings/route.ts` | PUT (set/edit) and DELETE (clear): Club/Super only, transactional, audited |
| `hooks/useCircuitStandings.ts` | Live read; malformed records dropped |
| `components/club/CircuitStandingsAdmin.tsx` | Four-card manager |
| `components/ClubTab.tsx` | Mounts the manager under Club Statistics |
| `components/club/PlayerClubTab.tsx` | Card shows the club's rank and total per circuit |
| `firestore.rules` | `circuitStandings` block (read: signed-in; write: none) |
| `tests/circuit-standings.test.mjs` | 23 unit/source tests (production imports) |
| `tests/circuit-standings.emulator.test.mjs` | CS-01 to CS-05 (API), CS-R1 and CS-R2 (rules) |
| `e2e/circuit-standings.spec.ts` | 7 scenarios × desktop and mobile |

## 6. Tests executed (2026-11-24)

| Run | Result |
|---|---|
| `node --test tests/circuit-standings.test.mjs` | **23/23** |
| `node scripts/run-emulator-tests.mjs tests/circuit-standings.emulator.test.mjs` | **7/7**. It found a bug: the first save of a circuit failed (an audit field was `undefined`). Fixed and re-run. |
| `npx playwright test e2e/circuit-standings.spec.ts` (Desktop and Mobile Chrome) | **14/14** |
| `npx playwright test e2e/player-ui-enhancement.spec.ts e2e/club-shop.spec.ts` | **42/42** |
| `npx tsc --noEmit` / `npm run lint` / `npm run build` | 0 errors / 0 errors (4 pre-existing warnings) / pass (33/33) |
| `npm run test:functional` | 1154/1174. The **same 20 pre-existing failures** as base `84b715c` (D-22 role-model tests). |
| All 22 emulator suites | 436/461. The **same 25 pre-existing failures** (D-22 role-model tests). |

The e2e runs use the synthetic-session harness with the API mocked. Authorisation and persistence are covered against the emulator. Local e2e runs need `AWS_BRANCH=mig-mov`, because database routing fails closed for feature-branch names (by design).

## 7. Deployment notes and limitations

- **Rules:** the `circuitStandings` rule must be applied to a database before players can read the standings. Without it, the card shows "Circuit standings couldn't be loaded right now." Not deployed here.
- **Old records:** any record saved with the first (player-based) version has an id like `india-wins__<playerId>`. These are ignored by the app and never shown. They can be deleted from the console; the app does not delete them.
- No standings are seeded. Each circuit shows "Not available" until an admin saves it.
