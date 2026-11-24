# Access Control Centre & Admin Role Consolidation — Assessment and Design (D-22)

**Owner decisions (2026-11-24):**
- Active roles are exactly **Super Admin, Club Admin and Finance Admin**.
- **Match Admin, Studio Admin and Designer are retired into Club Admin.**
- One Access Control Centre under Settings becomes the only place roles are managed.
- No production migration or deployment without explicit approval.

**Branch:** `feat/access-control-centre` from `mig-mov` @ `41f89c7`.

## 1. Current role model (before)

```
Firebase Auth custom claim  admin:true ─────────────► SUPER ADMIN (SEC-001: the only super-admin authority)
                                                         └─ inherits every role below
/appUsers/{uid} boolean flags (client-writable only by Super Admin under the rules)
   isClubAdmin    ──► Club Admin      (players, shop, pulse, announcements, badges, invites, leaderboard, design)
   isMatchAdmin   ──► Match Admin     (matches, grounds, tournaments, squad, availability, cash/UPI collection, stats)
   isStudioAdmin  ──► Studio Admin    (studio subscriptions, studio reminders)
   isFinanceAdmin ──► Finance Admin   (finance, fees, plans, reconciliation, ground fee)
   isDesigner / canDesign ──► Designer (Design Studio)
   role: "clubAdmin" | "matchAdmin" | "studioAdmin" | "financeAdmin" | "designer" | "admin" | "player"
         (string fallback read by the SERVER only; the rules ignore it; "admin" is NOT an authority)
```

The **flags are assigned in two places:**
- Player Roster → Edit player → *Privileges* toggles, which write `appUsers` straight from the client.
- Settings → *Privileges Overview*, a read-only list that still lists six roles and treats `role == "admin"` as Super Admin, which is incorrect after SEC-001.

## 2. Role storage, readers and writers

| Where | What | Reads / writes |
|---|---|---|
| Firebase Auth custom claims | `admin: true` | Read by `lib/server-auth.ts` (`getUserAccount`) and the rules (`isSuperAdmin()` etc.). Written only by `scripts/set-admin-claim.js` and `scripts/migrate-admin-claims.js` (local, service account) |
| `appUsers.{isClubAdmin,isMatchAdmin,isStudioAdmin,isFinanceAdmin,isDesigner,canDesign,role}` | Granular roles | **Written** by `components/EditPlayerInline.tsx` via `store.updateAppUserProfile` (client SDK, Super Admin only under the rules). **Read** by `lib/server-auth.ts`, `firestore.rules`, `app/page.tsx`, `ProfileTab`, `MatchesTab`, `MatchCalendarView`, `SettingsTab`, `AdminDashboard`, `ClubTab`, `StudioAdminTab`, `PlayersTab`, `MobileBottomNav`, `lib/admin-navigation.ts` |
| `firestore.rules` | `isMatchAdmin()`, `isStudioAdmin()`, `isClubAdmin()`, `isFinanceAdmin()`, `isAnyAdmin()` | 55 references. Retired-flag-only rules: `studioSubscriptions`/`subscriptionHistory` (`isStudioAdmin`); `playerStats`, `grounds`, `tournaments`, `matches` create/delete, payment Match-Admin paths, squad (`isMatchAdmin`) |
| Server guards | `requireMatchAdmin` (match/club/super), `requireStudioAdmin` (studio/super), `requireRole([... "matchAdmin" ...])` | `calendar/sync`, `whatsapp/remind-studio`, `finance/assignments`, `finance/match-plans`, weekend results |

### All Match Admin / Studio Admin / Designer references (application code)

```
lib/server-auth.ts            AppRole union; getUserAccount flag + role-string reads; super-admin inheritance; test bypass; requireMatchAdmin/requireStudioAdmin
lib/types.ts                  AppUser.isStudioAdmin / isMatchAdmin / isDesigner
lib/admin-navigation.ts       AdminCapabilities.isMatchAdmin / isStudioAdmin / canDesign; Studio & Match Center visibility; landing order
lib/weekend-ops-server.ts     RESULT_RECORDER_ROLES = superAdmin + matchAdmin
lib/match-eligibility.ts      comment only
app/page.tsx                  isAdmin detection, adminCaps, adminPermissions, isStudioAdmin/isMatchAdmin/canDesign props
app/api/finance/assignments   requireRole(... "matchAdmin")
app/api/finance/match-plans   requireRole(... "matchAdmin")
app/api/admin/weekend-*       comments / role constants
components/EditPlayerInline   Privileges toggles (Studio/Match/Finance/Club/Designer) — client role writes
components/SettingsTab        Privileges Overview (six roles; role=="admin" as Super Admin)
components/AdminDashboard     isMatchAdmin / isStudioAdmin widgets
components/ClubTab            isStudioAdmin for the Studio section
components/StudioAdminTab     isStudioAdmin prop
components/PlayersTab         isStudioAdmin as "is admin" gate
components/ProfileTab         admin detection with isMatchAdmin / isStudioAdmin
components/MatchesTab         isMatchAdmin prop + appUser.isMatchAdmin for plans
components/MatchCalendarView  currentUser.isMatchAdmin
components/layout/MobileBottomNav   adminPermissions.isMatchAdmin / isStudioAdmin / canDesign
firestore.rules               isStudioAdmin(), isMatchAdmin(), isAnyAdmin() flag reads; appUsers protected-key lists
scripts/migrate-admin-claims.js     (super-admin claim tool; unchanged)
```

Tests also reference the retired flags: about 128 references in 29 files (unit, emulator and e2e). They are listed in the implementation report (§7).

## 3. Role-to-capability matrix (after)

| Capability | Super Admin | Club Admin | Finance Admin | Player |
|---|:-:|:-:|:-:|:-:|
| **Access Control Centre** (grant/revoke roles, history) | ✅ | — | — | — |
| Settings & platform configuration | ✅ | — | — | — |
| Match Center: matches, grounds, tournaments, calendar sync | ✅ | ✅ *(was Match Admin)* | — | — |
| Squad, availability, catches, No Show, player stats | ✅ | ✅ *(was Match Admin)* | — | — |
| Match results (weekend prompt and backfill) | ✅ | ✅ *(was Match Admin)* | — | — |
| Cash/UPI collection at the recorded fee (Match-Admin payment path) | ✅ | ✅ *(was Match Admin)* | ✅ | — |
| Studio memberships, subscriptions, studio reminders | ✅ | ✅ *(was Studio Admin)* | — | — |
| Design Studio | ✅ | ✅ *(was Designer)* | — | — |
| Club: roster, invites, announcements, Pulse, badges, POTW, shop, leaderboard | ✅ | ✅ | — | — |
| Finance: dashboard, payments, plans, reconciliation, reports, actual ground fee | ✅ | — | ✅ | — |
| Own profile, dues, matches (Player persona) | ✅ | ✅ | ✅ | ✅ |

Notes:
- Roles combine. Club Admin + Finance Admin gets both columns. Super Admin is a superset.
- Finance Admin does not gain Club powers, and Club Admin does not gain Finance powers.

## 4. Migration rules and dry run

`lib/role-consolidation.ts` (pure, unit-tested) decides each `appUsers` document:

| Holds (any of) | Result |
|---|---|
| `isMatchAdmin`, `isStudioAdmin`, `isDesigner`, `canDesign`, `role ∈ {matchAdmin, studioAdmin, designer}` | `isClubAdmin: true` (once) |
| `isClubAdmin` | unchanged |
| `isFinanceAdmin` | preserved |
| Super Admin claim | untouched (claims are not read or written by the migration) |

- Retired flags are **removed** from the document: `isMatchAdmin`, `isStudioAdmin`, `isDesigner`, `canDesign`.
- A retired `role` string becomes `clubAdmin`.
- The original values are kept in `appUsers.roleMigration = {from: [...], migratedAt, migrationId}`, and one `auditLogs` entry is written per changed user (`entity: "access"`).
- UID, `playerId` and every other field are untouched.
- **Idempotent:** a document with no retired fields produces no change.
- **Reported, not changed:**
  - disabled accounts with retired flags (migrated, but flagged for review);
  - accounts without a linked `playerId` (migrated, flagged);
  - unknown `role` strings (left as-is, flagged).

**Dry run:**
- Command: `node scripts/migrate-role-consolidation.mjs` (read-only by default; `--execute` to write).
- The report includes:
  - Match Admin, Studio Admin and Designer counts;
  - users holding several retired roles;
  - users who will receive Club Admin;
  - roles preserved (Finance Admin, existing Club Admin);
  - disabled, unlinked and ambiguous accounts.
- The Access Control Centre shows the same dry-run summary to Super Admins (read-only).
- **Production counts:** this environment has no production credentials, so the production dry run must be run by the owner (read-only) before approval. The figures in the implementation report come from an emulator fixture.

**Deployment order** (owner approval needed for each step):
1. Run the dry run.
2. Run `--execute`.
3. Deploy the rules and app.

The new rules and server no longer honour retired flags. Deploying them **before** the migration would temporarily remove access from Match/Studio/Designer users who are not yet Club Admin.

## 5. Security design

- **Server** (`lib/server-auth.ts`):
  - Only `isClubAdmin` or `role == "clubAdmin"` grants Club Admin.
  - The retired capability names (`matchAdmin`, `studioAdmin`, `isDesigner`) are kept as **internal aliases derived only from Club Admin**, so existing route guards keep working.
  - The retired flags themselves **no longer grant anything**.
- **Rules:**
  - `isMatchAdmin()` and `isStudioAdmin()` now mean Club Admin (or the Super claim).
  - `isAnyAdmin()` = Super claim, Club or Finance.
  - Role keys on `appUsers` (`isClubAdmin`, `isFinanceAdmin`, retired flags, `role`, `roleMigration`) become **server-only**: no client may change them, Super Admin included. The Access Control API (Admin SDK) is the single writer.
- **API** `/api/admin/access` (Super Admin only, verified ID token):
  - Role requests are checked against the allowlist `superAdmin | clubAdmin | financeAdmin`.
  - **Self-changes are refused.**
  - The **last active Super Admin cannot be removed**.
  - Optimistic concurrency: the request carries the roles the admin saw, and a mismatch returns 409.
  - Super Admin is granted or revoked through the `admin` custom claim (Admin SDK). Revocation also revokes refresh tokens. Server routes reject the old session immediately (R1); Firestore rules see the change at the next ID-token refresh (≤ 1 hour).
  - Every change writes one `auditLogs` entry (`entity: "access"`) with previous roles, new roles and the actor.

## 6. Proposed Access Control Centre (Settings → Access Control)

```
┌ Access Control ───────────────────────────────────────────────────────────┐
│ [Super Admin  2]   [Club Admin  9]   [Finance Admin  3]      ← role cards │
│  full access        matches·studio·   payments·reconcil.     (click =     │
│  Manage users ›     design·club ›     Manage users ›          filter)     │
├───────────────────────────────────────────────────────────────────────────┤
│ 🔍 Search name / Player ID / email / phone    [All ▾ Super|Club|Finance|  │
│                                                Multiple roles|No role]    │
│ ○ Rohit Sharma   KAV-018   Club · Finance   Active   12 Nov   [Manage]    │
│ ○ Virat Kohli    KAV-022   —                Active   —        [Manage]    │
│ …                                              ‹ Prev  1–25 of 140  Next ›│
├───────────────────────────────────────────────────────────────────────────┤
│ Access change history — who · before → after · by · when                  │
└───────────────────────────────────────────────────────────────────────────┘
Manage (side panel; bottom sheet on mobile):
  identity · Player ID · linked account · status
  [✓] Club Admin     Matches, squad, studio, Design Studio, club operations
  [ ] Finance Admin  Finance dashboard, payments, reconciliation, ground fee
  [ ] Super Admin    Full access incl. Access Control and Settings
  Change summary: Current → Proposed → Grant Finance Admin
  [Cancel] [Save changes]
```

**Player Roster:**
- Shows read-only role chips and a "Manage in Access Control" link (Super Admin).
- The Privileges toggles and the Settings *Privileges Overview* are removed.
