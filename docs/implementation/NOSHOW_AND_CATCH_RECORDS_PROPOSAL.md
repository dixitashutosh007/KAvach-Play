# No Show and Catch Records — Current State and Recommendation

**Status:** Proposal for owner decision (D-19 item 7). No code changed.
**Date:** 2026-11-23 · **Branch inspected:** `fix/admin-nav-realignment`

## 1. How it works today (verified in code)

### Catches (stunning / dropped)

| Where | What is stored | Written by |
|---|---|---|
| `players/{playerId}.stunningCatches`, `.droppedCatches` | Running totals | `store.recordCatch()` (`hooks/useStore.ts` ~L875) via `increment()`; **also hand-editable** in the Player Roster table view (`components/PlayersTab.tsx` ~L830–840) |
| `catchLog/{id}` | One entry per recording: `playerId`, `playerName`, `type`, `count`, optional `matchId`, `comment`, `recordedBy`, `recordedAt` | `store.recordCatch()` right after the total update |
| `auditLogs` | "Recorded N catches for X" with the real actor | `logAudit()` |

Weaknesses:
1. **Not atomic** — the total and the log entry are two separate writes; a failure in between leaves them out of step.
2. **`recordedBy` is always the literal `"admin"`** — the real recorder is only in the audit log.
3. **Totals can be edited by hand** without any log entry, so the log cannot explain the totals.
4. **`catchLog` is never read** anywhere in the app — the detail exists but nobody can see it.
5. **Rules precedence bug** (`firestore.rules` L485): `isMatchAdmin() || isClubAdmin() && <field checks>` — the field checks only apply to Club Admin. Low severity (P3).
6. `catchLog` is readable by every signed-in user, including free-text comments.

### No Show

| Where | What is stored | Written by |
|---|---|---|
| `players/{playerId}/otherFees/{id}` with `title: "No Show"`, `amount`, `comment`, `status: "Unpaid"` | A fee obligation | `store.addOtherFee()` from Home ("Add No Show") and Studio ("Add No Show Fee") |

It already behaves as a fee: it appears in the player's dues, reminders and payment history. Weaknesses:
1. A No Show is identified only by the **title string** "No Show" — fragile for counting/reporting.
2. **No link to the match/session** that was missed.
3. Amount is **typed freely** by the admin.
4. Firestore rules allow fee creation by **Finance/Super Admin only**, so Studio's "Add No Show Fee" already fails for Studio Admins who are not Finance Admins (and will for Club Admins).

## 2. Recommendation

### 2.1 Catches — append-only log as the source of truth, totals derived atomically

- **`catchLog` becomes the authoritative, append-only record.** Each entry: `playerId`, `type`, `count`, `matchId` (required when recorded from a match; else `comment` required), `comment`, `recordedByUid`, `recordedByName`, `recordedAt`, optional `reversalOf`.
- **No edits or deletes.** Corrections are new *reversal/adjustment* entries with a reason — the history always explains the totals.
- **Write through one trusted server endpoint** (e.g. `POST /api/club/catches`) using the Admin SDK in a single transaction: verify Club/Super Admin from the ID token, write the log entry and increment the player totals together. `recordedBy` comes from the verified token, never from the client.
- **Lock down the rules**: no client writes to `catchLog`, and players' `stunningCatches`/`droppedCatches` become server-only fields. Replace the hand-edit in the roster table with an "Adjust" action that creates an adjustment entry.
- **Opening balances**: a one-off, dry-run-first migration writes one "opening balance" entry per player for any difference between today's totals and the existing log, so history reconciles from day one. Includes a reconciliation report (sum of log vs totals).
- **Read access**: a player sees their own history; admins see everyone's. (Today all signed-in users can read all entries, including comments.)

### 2.2 No Show — stays a fee, but structured and authority-safe

- Keep No Show as an `otherFees` obligation (it must flow through dues, reminders, Razorpay and receipts).
- Add a **`category: "no_show"`** field and a **`matchId` or `sessionDate`** reference; stop relying on the title string. Backfill existing "No Show" fees by title (dry run first).
- **Amount from a configured No Show fee template**, not typed freely; exceptions require Finance Admin.
- **Authority**: because a No Show creates money owed, create it through a server endpoint that allows **Club Admin to raise the standard No Show fee** (template amount only) and **Finance Admin for any amount/waiver**. This keeps Firestore's "only Finance/Super write fees" rule intact for direct client writes (SEC-003) while letting Club Admins do their operational job.

### 2.3 Where it is shown

- **Player Roster → player record (admin)**: catches summary (stunning / dropped), paginated catch history (date, match, count, recorded by, comment, corrections), and No Show history (date, match/session, amount, paid/unpaid/waived).
- **Player Profile (player)**: own totals (already shown) plus own catch history and own No Show fees (already in payments).
- **Recording**: from Match Center → match (preferred, match context pre-filled) and the existing Home quick action.

### 2.4 Why this design

| Concern | How it is addressed |
|---|---|
| Security | Server-verified actor and role; no client writes to logs or totals; fee creation stays authority-checked; history immutable |
| Operations | One place to record (match-linked), corrections without data loss, clear history on each player record, No Show amounts consistent |
| Scalability | Totals stored on the player doc (leaderboards never scan logs); history queried per player with an index on `playerId + recordedAt`, paginated |
| Auditability | Every change has who/when/why; totals always reconcile with the log |

## 3. Decisions needed from the owner

1. Approve catches as an append-only server-written log with reversal/adjustment entries (no hand-editing of totals).
2. Approve the opening-balance migration (dry run → review → apply) and the reconciliation report.
3. No Show: confirm a fixed No Show amount via fee template, Club Admin may raise it, Finance Admin handles exceptions/waivers.
4. Catch history visibility: own history for players, all for admins (instead of all signed-in users).

This work needs Firestore rules, a server endpoint, a migration and emulator tests, so it would run as its own workstream after role consolidation.
