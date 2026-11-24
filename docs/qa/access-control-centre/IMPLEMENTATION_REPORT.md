# Access Control Centre & Role Consolidation — Implementation Report (D-22)

**Branch:** `feat/access-control-centre`, from `mig-mov` @ `8910281`. The final SHA is in the delivery message.
**Status:** implemented. **Not deployed.** **No production migration run.**

**What was run, per the owner's instruction "do not run full testing / e2e / Playwright":**
- TypeScript, lint and build.
- One new unit file for the migration logic.
- A migration dry run and execution against the **local Firestore emulator** with synthetic accounts.

The full unit, emulator and e2e suites were **not** run. See §7 for the tests expected to need updating.

Pre-implementation assessment, role-model diagrams, the reference list and the screen design are in `docs/implementation/ACCESS_CONTROL_CENTRE_PLAN.md`.

## 1. Final role model

| Role | Stored in | Notes |
|---|---|---|
| **Super Admin** | Firebase Auth custom claim `admin: true` (SEC-001) | Superset of all roles |
| **Club Admin** | `appUsers.isClubAdmin` | Absorbs Match Admin, Studio Admin and Designer |
| **Finance Admin** | `appUsers.isFinanceAdmin` | Unchanged |
| ~~Match Admin, Studio Admin, Designer~~ | `isMatchAdmin`, `isStudioAdmin`, `isDesigner`, `canDesign`, `role ∈ {matchAdmin, studioAdmin, designer}` | **Grant nothing** (server, rules, client); removed by the migration |

### Role-to-capability matrix

| Capability | Super | Club | Finance |
|---|:-:|:-:|:-:|
| Access Control Centre; Settings | ✅ | — | — |
| Match Center (matches, grounds, tournaments, calendar sync), results, squad, availability, catches, No Show, stats | ✅ | ✅ | — |
| Match-Admin cash/UPI collection path (rules `isMatchAdminPayment*`) | ✅ | ✅ | ✅ (own path) |
| Studio memberships, subscriptions, Studio reminders | ✅ | ✅ | — |
| Design Studio | ✅ | ✅ | — |
| Roster, invites, announcements, Pulse, badges, POTW, shop, leaderboard | ✅ | ✅ | — |
| Finance dashboard, payments, plans (apply: also Club), reconciliation, reports, actual ground fee | ✅ | plans only | ✅ |

Finance Admin does **not** gain Club powers, and Club Admin does **not** gain Finance powers.

## 2. What changed

**Server authorisation** (`lib/server-auth.ts`):
- Club Admin comes **only** from `isClubAdmin === true` or `role === "clubAdmin"`.
- `matchAdmin`, `studioAdmin` and `isDesigner` remain as **internal aliases added together with Club Admin**, so existing guards keep their meaning. They are never derived from retired flags.
- `requireMatchAdmin` and `requireStudioAdmin` now require Club Admin or Super Admin.
- Routes that listed `matchAdmin` (finance assignments, match plans) now name `clubAdmin`.
- Weekend results moved to Super + Club Admin, ending the D-21 interim rule.
- The test auth bypass mirrors this: a retired role name supplied alone grants nothing.

**Firestore rules:**
- `isMatchAdmin()` and `isStudioAdmin()` now mean `isClubAdmin()`.
- `isAnyAdmin()` = Super claim, Club or Finance.
- A new `roleKeys()` list (all role flags, `role`, `roleMigration`, `rolesUpdatedAt/By`) is **server-only for every client, Super Admin included**. `appUsers` create allows only `role: "player"`.
- New server-only document `accessControl/superAdmins`. The global `deny all` already covers it; no client rule was added.

**Single role writer:** `lib/access-control-server.ts` and `app/api/admin/access/route.ts` (**Super Admin only**, verified ID token).
- Allowlist: `superAdmin | clubAdmin | financeAdmin`. Retired roles return 400.
- **Self-changes are refused (403).**
- **Optimistic concurrency:** the client sends the roles it saw; a mismatch returns 409.
- **Last active Super Admin:** a transaction on `accessControl/superAdmins` serialises Super Admin changes, and the remaining count is cross-checked with Firebase Auth. Two admins revoking each other at once cannot leave zero.
- Super Admin is granted or revoked via the custom claim. Revocation also revokes refresh tokens.
- Granting roles to a disabled account is refused.
- Every change writes one `auditLogs` entry (`entity: "access"`): previous roles, new roles, actor, timestamp.

**Removed role writers:**
- Player Roster *Privileges* toggles (`EditPlayerInline`, which wrote `appUsers` from the client).
- The Settings *Privileges Overview* (six roles; treated `role=="admin"` as Super Admin).
- The unused `handleRoleChange` / `store.updateAppUserRole`.
- The client mirroring of `role: "admin"` onto a Super Admin's own `appUsers` document (`hooks/useStore.ts`). The claim is the authority, and this write would now be denied.

**Client capability model:**
- `AdminCapabilities` is now `{isSuperAdmin, isClubAdmin, isFinanceAdmin}`.
- Match Center, Studio and Design Studio are Club Admin areas.
- `app/page.tsx` derives the `isMatchAdmin`, `isStudioAdmin` and `canDesign` props **only** from Club Admin.
- `ProfileTab`, `MatchesTab` and `MatchCalendarView` no longer read retired flags.
- `lib/types.ts` marks the retired fields `@deprecated`.

**UI:**
- **Settings → Access Control**: entry card plus a full screen (`components/access/AccessControlCentre.tsx`).
  - Three role cards with live counts; clicking one filters the directory.
  - User Access Directory: server-side search (name, Player ID / KAvach ID, uid, email, phone) and filters (All, each role, Multiple roles, No admin role). 25 per page; only the page is sent to the browser.
  - Manage panel (right drawer on desktop, bottom sheet on mobile): identity, Player ID, linked-account status, roles with capability lists, then **Review changes** → *Current / Proposed / Change* → Save or Back.
  - Access Change History.
  - A "Role consolidation pending" banner while retired flags remain.
- **Player Roster** shows read-only role chips and **Manage in Access Control →**, via a small app-wide `kavach:navigate` event. Settings stays Super-Admin-guarded.

**Migration:**
- `lib/role-consolidation.ts`: pure decision logic.
- `runRoleConsolidation()` in `lib/access-control-server.ts`.
- `scripts/migrate-role-consolidation.mjs`: dry run by default; `--execute` writes; `--database=<approved id>` and `serviceAccountKey.json` are required outside the emulator.

## 3. Migration execution report (local emulator, synthetic accounts)

Full output: `docs/qa/access-control-centre/migration-emulator-run.txt`. Fifteen synthetic accounts cover every combination: Match, Studio, Designer, `canDesign`, Match+Studio, all three+Finance, Match+Finance, Studio+Designer, Club+Studio, Club, Finance, `role:"matchAdmin"`, disabled, unlinked, plain player.

| | Dry run | Execute | Re-run |
|---|--:|--:|--:|
| Match Admin holders | 6 | 6 | 0 |
| Studio Admin holders | 5 | 5 | 0 |
| Designer holders | 5 | 5 | 0 |
| Holding more than one retired role | 3 | 3 | 0 |
| Receive Club Admin (new) | 11 | 11 | 0 |
| Already Club Admin (flags cleaned) | 1 | 1 | 0 |
| Finance Admin preserved | 2 | 2 | 0 |
| Accounts changed | (12 planned) | **12** | **0 (idempotent)** |
| Flagged for review | 2 (disabled, unlinked) | 2 | 0 |

**After the run:**
- Every former Match, Studio or Designer account is **Club Admin** (once). Match+Finance and all-three+Finance are **Club + Finance**.
- Club Only, Finance Only and Plain Player are **unchanged**.
- No retired flags remain. `playerId` is unchanged everywhere. `role:"matchAdmin"` became `role:"clubAdmin"`.
- The original values are in `appUsers.roleMigration.from`. **12 audit entries** were written (`entity: "access"`).
- Super Admin claims were not read or written.

**Production dry run:** this environment has no production credentials. The owner runs (read-only):

```bash
node scripts/migrate-role-consolidation.mjs --database=ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412
```

The same summary is also shown read-only in the Access Control Centre banner.

**Required deployment order** (each step needs owner approval):
1. Production dry run; review the flagged accounts.
2. `--execute`.
3. Deploy the app.
4. Deploy `firestore.rules`.

Deploying the rules or app **before** the migration would remove access from Match, Studio and Designer holders who are not yet Club Admin.

## 4. Confirmations (scope: code on this branch; verified by source review, type-check, build, the new unit file and the emulator migration run — not by the full test suites)

- **Retired roles are not assignable:**
  - The API allowlist has three roles; the UI shows three cards, three filters and three checkboxes.
  - The rules forbid any client write of role keys.
- **Retired roles are not independently authorised:**
  - The server never reads the retired flags or strings.
  - The rules helpers map to Club Admin.
  - `isAnyAdmin()` ignores the retired flags.
  - Client capabilities derive only from Club Admin.
  - Enforced by `tests/role-consolidation.test.mjs` source checks.
- **Club Admin mapping:** every former Match, Studio or Designer holder becomes Club Admin once; Finance Admin and existing Club Admin are preserved (unit tests plus the emulator run).
- **Security controls are intact:**
  - SEC-001 claim authority is unchanged.
  - The disabled-account fail-closed path is unchanged.
  - R1 token revocation and R2-A account privacy are unchanged.
  - Role writes are now **narrower**: server only, Super Admin only, audited.
  - No rule was loosened. `isAnyAdmin()` and `appUsers` writes are now **stricter**.

## 5. Files changed

- **New:**
  - `lib/role-consolidation.ts`, `lib/access-control-server.ts`
  - `app/api/admin/access/route.ts`
  - `components/access/AccessControlCentre.tsx`
  - `scripts/migrate-role-consolidation.mjs`
  - `tests/role-consolidation.test.mjs`
  - `docs/implementation/ACCESS_CONTROL_CENTRE_PLAN.md`, this report, `migration-emulator-run.txt`
- **Modified:**
  - `lib/server-auth.ts`, `firestore.rules`, `lib/admin-navigation.ts`, `lib/types.ts`, `lib/weekend-ops-server.ts`
  - `app/page.tsx`
  - `app/api/finance/{assignments,match-plans}/route.ts`, `app/api/admin/weekend-{results,prompts}/route.ts` (comments)
  - `components/{SettingsTab,EditPlayerInline,ProfileTab,MatchesTab,MatchCalendarView}.tsx`, `components/layout/MobileBottomNav.tsx`
  - `hooks/useStore.ts`
  - `AGENTS.md`, `docs/implementation/DECISION-LOG.md` (D-22)

## 6. Checks executed

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| `npm run lint` | 0 errors, 4 pre-existing warnings (Firestore rules open reads) |
| `GIT_BRANCH=mig-mov npm run build` | Pass (31 / 31 pages; `/api/admin/access` built) |
| `node --test tests/role-consolidation.test.mjs` | 15 / 15 pass |
| Migration dry run, execute and re-run on the Firestore emulator | As in §3 |
| Full functional, emulator and e2e suites; screenshots | **Not run**, per owner instruction |

## 7. Tests expected to need updating in the test pass

These existing tests encode the **retired** model and are expected to fail until updated. They were deliberately not changed blind.

- **Rules emulator tests that grant access via `isMatchAdmin` / `isStudioAdmin` flags.** That access now requires `isClubAdmin`, and client writes of role flags by Super Admin are now denied:
  - `tests/firestore-rules.test.mjs`, `phase5-firestore-security`, `phase6-match-rules`, `finance-d4-payment-rules`, `match-finance-lifecycle-rules`, `remediation1-firestore-auth`, `r2a-account-privacy`.
- **Route tests using `x-test-roles: matchAdmin` / `studioAdmin` / `isDesigner`.** These no longer authorise; use `clubAdmin`:
  - `weekend-ops.emulator` (results now Super + Club; Club Admin is no longer denied), `r5-webhook-dead-letter`.
- **Static/unit tests asserting the old guards, constants or six-role navigation:**
  - `weekend-ops.test.mjs` (`RESULT_RECORDER_ROLES`), `admin-nav-realignment`, `phase6-navigation-rbac`, `match-center-admin-access`, `player-nav-persona`, `server-security-phase5`, `finance-plans*`, `match-management`, `home-stats-links-identity`, `accounting-functional`.
- **e2e:**
  - Synthetic sessions with `isMatchAdmin` / `isStudioAdmin` / `isDesigner` role configs (`admin-nav-realignment`, `player-nav-persona`, `production-app`, `match-center-corrections`, `player-home-behavioral`, `weekend-match-operations`) now see those users as non-admins.

## 8. Limitations and residual risks

1. **Super Admin revocation:**
   - It is immediate for server routes (refresh tokens revoked; R1).
   - Firestore **client rules** still see the old ID token's claim until it refreshes, **up to 1 hour**. Granting has the same delay until the user's token refreshes; signing out and in applies it.
2. **Directory loading:** the server reads `appUsers` and `players` (field masks) and Auth claims (in batches of 100) per directory request, then searches and paginates on the server. This suits the club's size; a much larger roster would need indexed search.
3. **Super Admin claim holders with no `appUsers` document** are not listed (no account record to show). The existing set-admin-claim script can create such holders.
4. **Super Admin list drift:** `accessControl/superAdmins` is seeded from Auth on first use. Super Admins changed later by `scripts/set-admin-claim.js` can make that list drift. The Auth cross-check means drift can only cause an extra refusal, never the removal of the last Super Admin.
5. **Migrated disabled accounts** receive `isClubAdmin` but stay disabled, which grants nothing. **Unlinked accounts** are migrated and flagged. Both are listed in the report for review.
6. Screenshots of the Access Control Centre were not captured (no browser runs, per instruction). They can be produced on request.
