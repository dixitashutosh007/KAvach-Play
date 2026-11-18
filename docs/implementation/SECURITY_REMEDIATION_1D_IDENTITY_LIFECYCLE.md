# Security Remediation 1D: Close Legacy UID and Identity Index Lifecycle Gaps

**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Baseline Commit:** `3efe0f153cd70ab0596637f07561e645f0965556` (docs commit: `f74d57f894eaedf7159653c7dd0f6fd100425a3f`)  
**Implementation Commits:** `aa4b31e` (core remediation) & `b02de8f` (contention resolution & retry hardening)  
**CI Verification Run:** GitHub Actions Run ID `44255737658` (All 5 jobs passed)  
**Implementation Agent:** Antigravity (Gemini)  
**Independent Reviewer:** ChatGPT (read-only review)  
**Operating Mode:** Read-only test validation and atomic remediation with emulator verification. Zero production writes or live Razorpay charges.

---

## 1. Executive Summary

Security Remediation 1D resolves all four findings identified in the independent review of Security Remediation 1C:

1. **SEC-1C-01 — Detect existing `player.authUid` mappings across ALL players:**  
   Pre-transaction resolution in `lib/account-linking.ts` now exhaustively queries `players.where("authUid", "==", uid)`. If an active player document already holds `authUid == uid` pointing to a different player, linking fails closed with `409 Conflict` (`"User account is already linked to another player record."`). If multiple active player documents share `authUid == uid`, linking fails closed with `409 Conflict` (`"Multiple player records found associated with this user account."`).
2. **SEC-1C-02 — Establish Index Lifecycle Guarantees & Eliminate Historical Duplicate Bypasses:**  
   `linkPlayerAccount()` no longer bypasses the full players population scan when a `phoneIndex` entry exists. All historical player candidates are evaluated for formatting variations and ambiguous duplicate phone numbers. Orphaned index entries (`uidIndex` pointing to nonexistent players) and index disagreements (`phoneIndex.playerId !== uidIndex.playerId`) fail closed with `409 Conflict`. In `app/api/admin/merge-players/route.ts`, merging player records atomically reparents both `uidIndex` and `phoneIndex` entries to `keeperId` across POST and PATCH repair endpoints.
3. **SEC-1C-03 — Remove Test-Only Abort Hook from Production Contract:**  
   `_simulateAbortBeforeCommit` has been completely purged from `LinkAccountParams` and the production function contract. The atomic four-document transaction logic is exported as `executeLinkingTransaction()`. Test harnesses execute genuine Firestore transaction aborts directly inside `db.runTransaction()`, verifying that staged writes across `phoneIndex`, `uidIndex`, `players`, and `appUsers` roll back cleanly in Firestore Emulator without any production contract compromise.
4. **SEC-1C-04 — Full-Population Identity Collision & Bootstrap Audit:**  
   `scripts/bootstrap-identity-index.ts` was expanded to inspect the complete identity population: ALL players (linked & unlinked, active, disabled, merged), ALL `appUsers` (orphaned playerId, multiple UIDs per player, missing playerId), and both `phoneIndex` and `uidIndex` collections. It identifies active phone collisions, legacy format collisions, UID collisions, orphaned index entries, and cross-index disagreements, returning a deterministic report with `safeToBootstrap: boolean`.

---

## 2. Detailed Technical Remediation

### 2.1 SEC-1C-01: Authoritative `authUid` Mapping Protection (`lib/account-linking.ts`)

- **Root Cause:** `linkPlayerAccount` previously resolved candidate players strictly via phone number, leaving open a window where an authenticated user (`uid`) already bound to Player A could bind to Player B if Player B had matching phone claims or if `appUsers/{uid}.playerId` was missing or partial.
- **Fix:** Before initiating the transaction, `linkPlayerAccount` executes:
  ```typescript
  const existingAuthPlayersSnap = await db
    .collection("players")
    .where("authUid", "==", uid)
    .get();

  const activeAuthPlayers = existingAuthPlayersSnap.docs.filter(
    (d) => !d.data()?.disabled && !d.data()?.mergedInto,
  );

  if (activeAuthPlayers.length > 1) {
    return {
      ok: false,
      status: 409,
      error: "Multiple player records found associated with this user account. Manual administrator resolution required.",
    };
  }

  if (activeAuthPlayers.length === 1 && activeAuthPlayers[0].id !== resolvedPlayerId) {
    return {
      ok: false,
      status: 409,
      error: "User account is already linked to another player record.",
    };
  }
  ```
- **Result:** Fails closed with 409 immediately if any other active player is bound to the UID.

### 2.2 SEC-1C-02: Index Lifecycle & Merge Reparenting (`app/api/admin/merge-players/route.ts`)

- **Root Cause:**
  1. `linkPlayerAccount` previously treated existing `phoneIndex` documents as authoritative proof that the player collection was free of duplicate numbers, skipping the duplicate candidate scan.
  2. Player merges in `/api/admin/merge-players` reparented payments, fees, merchOrders, and `appUsers`, but did not update `uidIndex` or `phoneIndex`, leaving stale player references in the identity reservation indexes.
- **Fix:**
  1. `linkPlayerAccount` unconditionally scans `players` for duplicate canonical numbers even if `phoneIndex` exists. If `phoneIndex.playerId !== resolvedPlayerId`, it fails closed with `409 Conflict`.
  2. In `app/api/admin/merge-players/route.ts`:
     - Queries `uidIndex.where("playerId", "==", loserId)` and reparents entries to `keeperId`.
     - Checks direct `uidIndex/{loser.authUid}` and reparents to `keeperId`.
     - Queries `phoneIndex.where("playerId", "==", loserId)` and reparents entries to `keeperId`.
     - Checks `phoneIndex/{loser.canonicalMobile}` and reparents to `keeperId`.
     - Patches `keeper.authUid = loser.authUid` if keeper lacked an `authUid`.
     - Updates dryRun preview and PATCH repair endpoints to maintain index synchronization.

### 2.3 SEC-1C-03: Production Contract Cleanliness & Genuine Rollback (`lib/account-linking.ts`)

- **Root Cause:** `_simulateAbortBeforeCommit` was present on the public `LinkAccountParams` interface.
- **Fix:**
  - Removed `_simulateAbortBeforeCommit` from `LinkAccountParams`.
  - Exported `executeLinkingTransaction(db, transaction, ctx: LinkingTxContext)`.
  - Test suites now test genuine rollback by invoking `executeLinkingTransaction` inside a native `db.runTransaction()` callback and throwing an error:
    ```typescript
    await assert.rejects(async () => {
      await db.runTransaction(async (transaction) => {
        await executeLinkingTransaction(db, transaction, {
          uid: "uid_abort_tester",
          canonicalAuthPhone: "+919876500001",
          resolvedPlayerId: "p_clean_1",
        });
        throw new Error("Simulated intentional abort in test harness");
      });
    });
    ```
  - Assertions verify that `phoneIndex`, `uidIndex`, `players`, and `appUsers` contain zero writes.

### 2.4 SEC-1C-04: Full-Population Bootstrap & Collision Audit (`scripts/bootstrap-identity-index.ts`)

- **Root Cause:** Prior bootstrap analysis only inspected linked players, omitting unlinked players, disabled/merged records, `appUsers` discrepancies, orphaned indexes, and cross-index disagreements.
- **Fix:** `scripts/bootstrap-identity-index.ts` now inspects:
  - **ALL Players:** Active, disabled, merged, linked, unlinked; evaluates canonical phone collisions across format variations (`9876543210` vs `+91 98765-43210`); evaluates `authUid` collisions.
  - **ALL AppUsers:** Missing `playerId`, orphaned `playerId` referencing deleted players, multiple `appUsers` pointing to the same active player.
  - **ALL Indexes:** Orphaned `phoneIndex` and `uidIndex` documents, and disagreements between `phoneIndex.playerId` and `uidIndex.playerId`.
  - Emits structured `CollisionReport` with `safeToBootstrap: boolean`, `blockingIssueCount`, `warningCount`, summary counts, and actionable remediation suggestions.

---

## 3. Verification Battery & Evidence

| Test Suite / Check | Command | Result | Notes |
|---|---|---|---|
| **Remediation 1D Suite** | `npm run test:emulator -- tests/remediation1d-identity-lifecycle.emulator.test.mjs` | **13/13 PASS** | Tests 1-13 covering all 1D lifecycle and population audit requirements. |
| **All Emulator Tests** | `npm run test:emulator` | **133/133 PASS** | 14 suites executed in Firestore Emulator (all passing, 0 failed, 0 skipped). |
| **Functional Suite** | `npm run test:functional` | **253/253 PASS** | Complete functional tests including utilities, finance, and rules AST. |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **0 ERRORS** | Strict type-safety verified across all files. |
| **Linting** | `npm run lint` | **0 ERRORS** | ESLint verified (0 errors, 4 production open-read warnings on public collections). |
| **Production Build** | `npm run build` | **SUCCESS (0)** | Standalone Next.js production build generated. |
| **Production Smoke E2E** | `npm run test:e2e:prod` | **4/4 PASS** | Playwright standalone production smoke test passing. |

---

## 4. Test Matrix: Remediation 1D Suite

File: `tests/remediation1d-identity-lifecycle.emulator.test.mjs`

1. `✔ Test 1: Existing players.authUid = uid with missing appUsers.playerId -> Rejected 409`
2. `✔ Test 2: Existing players.authUid = uid pointing to different player -> Rejected 409`
3. `✔ Test 3: Two player documents with same authUid -> Rejected 409`
4. `✔ Test 4: Linked/unlinked duplicate phone numbers -> Rejected 409`
5. `✔ Test 5: Duplicate phone numbers with different formatting -> Rejected 409`
6. `✔ Test 6: Existing phoneIndex with additional unindexed duplicate player -> Rejected 409`
7. `✔ Test 7: Existing uidIndex with orphaned player reference -> Rejected 409`
8. `✔ Test 8: phoneIndex and uidIndex disagreement -> Rejected 409`
9. `✔ Test 9: appUsers pointing to missing player is rejected`
10. `✔ Test 10: Multiple appUsers pointing to same player -> Rejected 409 and flagged in audit`
11. `✔ Test 11: Real transaction abort without test-only production flags`
12. `✔ Test 12: Player merge reparents uidIndex and phoneIndex`
13. `✔ Test 13: Bootstrap collision audit inspects full population and emits safeToBootstrap`

---

## 5. Summary of Modified & Created Files

1. `lib/account-linking.ts`:
   - Removed `_simulateAbortBeforeCommit` from `LinkAccountParams`.
   - Exported `executeLinkingTransaction(db, transaction, ctx)`.
   - Added pre-transaction check for `players.where("authUid", "==", uid)` (SEC-1C-01).
   - Enforced candidate resolution check across historical players even when `phoneIndex` exists (SEC-1C-02).
   - Added orphaned `uidIndex` and `phoneIndex`/`uidIndex` disagreement detection (SEC-1C-02).
   - Added Firestore contention handling to map aborted/closed emulator transactions to `409 Conflict`.
2. `app/api/admin/merge-players/route.ts`:
   - Added `uidIndex` and `phoneIndex` reparenting to `keeperId` during player merge.
   - Added `uidIndex` and `phoneIndex` repair loops to `PATCH /api/admin/merge-players`.
   - Added `uidIndexReparented` and `phoneIndexReparented` to preview and response contracts.
3. `scripts/bootstrap-identity-index.ts`:
   - Comprehensive full-population audit across players, appUsers, phoneIndex, and uidIndex (SEC-1C-04).
   - Emits structured report with `safeToBootstrap: boolean`.
4. `tests/remediation1c-bidirectional-identity.emulator.test.mjs`:
   - Updated rollback test to use `executeLinkingTransaction` without `_simulateAbortBeforeCommit`.
5. `tests/remediation1d-identity-lifecycle.emulator.test.mjs`:
   - Dedicated 13-test emulator suite covering all Remediation 1D requirements.
