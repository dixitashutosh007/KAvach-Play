# Security Remediation 1E: Secure Identity Merge, Privileged Write Paths and Bootstrap Readiness

**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Baseline Commit:** `b02de8f4233347cc08923c1d9b83b74101a9ec23` (docs commit: `a281a8e`)  
**Implementation Commit:** `e1240d0b17a4e992da9061c3284f6b5819780d56`  
**CI Verification Run:** GitHub Actions Run ID `44260461149` (All 5 jobs passed)  
**Implementation Agent:** Antigravity (Gemini)  
**Independent Reviewer:** ChatGPT (read-only review)  
**Operating Mode:** Read-only test validation and atomic remediation with emulator verification. Zero production writes or live Razorpay charges.

---

## 1. Executive Summary & Findings Resolved

Security Remediation 1E comprehensively resolves all five findings identified during the independent review of Remediation 1D:

| Finding ID | Title | Root Cause & Resolution | Evidence / Files |
|---|---|---|---|
| **SEC-1D-01** | **Unsafe identity reassignment during player merge** | `POST /api/admin/merge-players` previously allowed merging players with conflicting UIDs and did not pre-flight inspect existing `phoneIndex` or `uidIndex` reservations. The endpoint now resolves the complete identity state across loser, keeper, appUsers, uidIndex, and phoneIndex before modifying any data. Merges are rejected with `409 Conflict` if both players possess distinct active UIDs, if either player has an identity reservation owned by a third party, if multiple appUsers conflict, or if canonical phone numbers disagree. | [app/api/admin/merge-players/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/admin/merge-players/route.ts#L170-L380)<br>Tests 1–6 in `remediation1e` |
| **SEC-1D-02** | **Non-atomic multi-batch player merge** | Large player merges (> 400 operations) formerly used uncoordinated batch flushes that could fail midway and leave partial, corrupted records without a recovery trail. Merge architecture is now split into an atomic identity state transaction (`stage: identity_locked`) and a durable staged state machine recorded in `mergeJobs/{jobId}`. Loser is soft-deleted and marked `mergeStatus: completed` only after all migration batches (payments, otherFees, merchOrders, appUsers) succeed. Failed or interrupted merges are 100% idempotent and resumable. In-progress merges lock both players against concurrent merges and account linking. | [app/api/admin/merge-players/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/admin/merge-players/route.ts#L380-L550)<br>[lib/account-linking.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/account-linking.ts#L164-L168)<br>Tests 7–10 in `remediation1e` |
| **SEC-1D-03** | **Privileged client-side writes bypass identity indexes** | `firestore.rules` permitted Super Admins to write `appUsers.playerId` and any admin to write `players.authUid` via the client SDK. The rules were updated via `firestore-rules-author` to prepend unconditional affected-keys checks: `!incoming().diff(existing()).affectedKeys().hasAny(['authUid'])` on `players` and `!incoming().diff(existing()).affectedKeys().hasAny(['playerId'])` on `appUsers`. All client users, including Super Admin, are strictly blocked from directly mutating identity binding fields. Legitimate mutations are reserved strictly for trusted server Admin SDK operations. | [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L119-L135)<br>[firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L496-L512)<br>Tests 11–14 in `remediation1e` |
| **SEC-1D-04** | **Bootstrap readiness can ignore unresolved historical identities** | `scripts/bootstrap-identity-index.ts` previously classified malformed phones and unverified duplicates as benign warnings, allowing `safeToBootstrap` to return true in ambiguous databases. The script was overhauled to strictly classify all identity states. `safeToBootstrap` returns `false` if any unverified disabled duplicates, malformed phones on active/linked players, or unresolved collisions exist. The report explicitly distinguishes `safeToBootstrap`, `safeToLinkExistingRecords`, and `requiresManualResolution`. Missing index reservations for already-linked players are identified. | [scripts/bootstrap-identity-index.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/scripts/bootstrap-identity-index.ts#L1-L430)<br>Tests 15–16 in `remediation1e` |
| **SEC-1D-05** | **Contention error classification and idempotency verification are incomplete** | `lib/account-linking.ts` previously caught generic gRPC code 3 (`INVALID_ARGUMENT`) as contention and omitted checking canonical phone consistency during post-contention recovery. Error classification was narrowed strictly to genuine aborted transactions (`code: 10`, `code: "aborted"`, or messages containing "Transaction is invalid or closed"). Generic invalid arguments return internal error 500. Post-contention idempotency verification now validates all four documents and checks `canonicalPhone` matching on both `phoneIndex` and `uidIndex`. | [lib/account-linking.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/account-linking.ts#L520-L585)<br>Tests 17–18 in `remediation1e` |

---

## 2. Identity Merge State Machine & Durable Job Tracking

### 2.1 Pre-Flight Conflict Matrix (`app/api/admin/merge-players/route.ts`)

Before any database write occurs, the route reads the full identity context:
- `loserSnap = players/{loserId}`
- `keeperSnap = players/{keeperId}`
- `appUsersLoserSnap = appUsers.where("playerId", "==", loserId)`
- `appUsersKeeperSnap = appUsers.where("playerId", "==", keeperId)`
- `uidIndexLoserSnap = uidIndex.where("playerId", "==", loserId)`
- `uidIndexKeeperSnap = uidIndex.where("playerId", "==", keeperId)`
- `phoneIndexLoserSnap = phoneIndex.where("playerId", "==", loserId)`
- `phoneIndexKeeperSnap = phoneIndex.where("playerId", "==", keeperId)`
- Direct `uidIndex` documents for `loser.authUid` and `keeper.authUid`
- Direct `phoneIndex` documents for canonical mobile numbers of both players
- `mergeJobSnap = mergeJobs/job_${loserId}_${keeperId}`

The merge immediately halts with a controlled `409 Conflict` if:
1. `loser.authUid && keeper.authUid && loser.authUid !== keeper.authUid` (`CONFLICTING_AUTH_UIDS`).
2. Keeper's authUid or canonical phone is reserved by another player (`KEEPER_UID_RESERVATION_CONFLICT`, `KEEPER_PHONE_RESERVATION_CONFLICT`).
3. Loser's authUid or canonical phone is reserved by an unrelated third party (`LOSER_UID_RESERVATION_THIRD_PARTY`, `LOSER_PHONE_RESERVATION_THIRD_PARTY`).
4. Multiple conflicting appUsers or multiple UID reservations exist for either player (`MULTIPLE_KEEPER_APP_USERS`, `MULTIPLE_LOSER_APP_USERS`, `CONFLICTING_APP_USERS`).
5. Keeper and loser have distinct canonical phone numbers (`CONFLICTING_CANONICAL_PHONES`).
6. Keeper is disabled or already merged (`KEEPER_INELIGIBLE`).
7. Either player is locked in an active in-progress merge from a competing job (`MERGE_IN_PROGRESS`).

### 2.2 Staged State Machine Execution

```
[ POST /api/admin/merge-players ]
               │
               ▼
   [ Pre-Flight Validation ] ────── (Conflict Found) ───► 409 Conflict
               │
          (All Clear)
               ▼
   [ Stage 1: Atomic Transaction ]
   - Sets mergeJobs/{jobId}: { status: 'in_progress', stage: 'identity_locked' }
   - Sets loserRef: { mergeStatus: 'in_progress', mergedInto: keeperId }
   - Sets keeperRef: { mergeStatus: 'in_progress', ...keeperPatch }
   - Atomically updates target uidIndex & phoneIndex reservations to keeperId
               │
               ▼
   [ Stage 2: Payments Reparenting ]
   - Chunked batch processing (limit 400) of matches/{m}/payments
   - Updates mergeJobs/{jobId}: stage = 'payments_reparented'
               │
               ▼
   [ Stage 3: OtherFees Migration ]
   - Chunked batch processing (limit 200 items = 400 ops)
   - Copies to keeperRef/otherFees, deletes from loserRef/otherFees
   - Updates mergeJobs/{jobId}: stage = 'fees_moved'
               │
               ▼
   [ Stage 4: Merch Orders Reparenting ]
   - Chunked batch processing (limit 400) of merchOrders
   - Updates mergeJobs/{jobId}: stage = 'orders_reparented'
               │
               ▼
   [ Stage 5: AppUsers & Secondary Index Reparenting ]
   - Reparents all appUsers and residual indexes to keeperId
   - Updates mergeJobs/{jobId}: stage = 'app_users_reparented'
               │
               ▼
   [ Stage 6: Final Verification & Soft-Delete ]
   - Marks loser: { disabled: true, mergedInto: keeperId, mergeStatus: 'completed' }
   - Marks keeper: { mergeStatus: 'completed' }
   - Marks mergeJobs/{jobId}: { status: 'completed', stage: 'completed' }
               │
               ▼
     [ 200 OK Response ]
```

### 2.3 Failure Recovery Semantics
- If any batch fails during Stages 2–5, the error is caught and `mergeJobs/{jobId}` is updated to `{ status: 'failed', error: err.message }`.
- The loser remains in `mergeStatus: 'in_progress'` and `disabled: false`. The loser is NEVER falsely marked completed.
- Retrying the merge with the same `loserId` and `keeperId` resumes execution from the uncompleted stage. Because each stage queries unmigrated records (`where("playerId", "==", loserId)`), operations are strictly idempotent.
- In-progress merges protect the player against concurrent account linking (`linkPlayerAccount` returns `409` if `player.mergeStatus === 'in_progress'`).

---

## 3. Inventory of All Identity Mutation Paths

Every identity mutation path across the application was audited:

| Target Document / Field | Access Vector | Mechanism | Authority & Invariant Guarantees |
|---|---|---|---|
| `players/{id}.authUid` | Client SDK | **BLOCKED** in `firestore.rules` (L496, L498) | `!incoming().diff(existing()).affectedKeys().hasAny(['authUid'])` unconditionally denies all client updates (Super Admin, Club Admin, self). |
| `players/{id}.authUid` | Server Admin SDK | `lib/account-linking.ts` | Atomic four-document transaction binds `authUid` only after bidirectional validation (`phoneIndex`, `uidIndex`, `players`, `appUsers`). |
| `players/{id}.authUid` | Server Admin SDK | `app/api/admin/merge-players` | Reparented only if keeper has no `authUid` and loser has one, inside Stage 1 atomic transaction with full collision pre-flight check. |
| `appUsers/{uid}.playerId` | Client SDK | **BLOCKED** in `firestore.rules` (L119, L128) | `!incoming().diff(existing()).affectedKeys().hasAny(['playerId'])` unconditionally blocks all client updates (Super Admin, Club Admin, self). |
| `appUsers/{uid}.playerId` | Server Admin SDK | `lib/account-linking.ts` | Updated only inside the atomic four-document linking transaction. |
| `appUsers/{uid}.playerId` | Server Admin SDK | `app/api/admin/merge-players` | Reparented in Stage 5 after Stage 1 atomic identity lock. |
| `phoneIndex/{canonicalPhone}` | Client SDK | **BLOCKED** in `firestore.rules` (L140) | `allow read, write: if false;` Client access completely denied. |
| `phoneIndex/{canonicalPhone}` | Server Admin SDK | `lib/account-linking.ts` | Reserved atomically on linking; fails on third-party ownership. |
| `phoneIndex/{canonicalPhone}` | Server Admin SDK | `app/api/admin/merge-players` | Reparented in Stage 1 transaction; fails if third party owns reservation. |
| `uidIndex/{uid}` | Client SDK | **BLOCKED** in `firestore.rules` (L144) | `allow read, write: if false;` Client access completely denied. |
| `uidIndex/{uid}` | Server Admin SDK | `lib/account-linking.ts` | Reserved atomically on linking; fails on third-party ownership. |
| `uidIndex/{uid}` | Server Admin SDK | `app/api/admin/merge-players` | Reparented in Stage 1 transaction; fails if third party owns reservation. |
| `players/{id}.mergedInto` | Client SDK | **BLOCKED** in `firestore.rules` (L503) | Self-update allowlist excludes `mergedInto`. |
| `players/{id}.mergedInto` | Server Admin SDK | `app/api/admin/merge-players` | Staged merge machine marks `in_progress` in Stage 1, soft-deletes in Stage 6. |

---

## 4. Conservative Bootstrap Readiness (`scripts/bootstrap-identity-index.ts`)

`generateIdentityCollisionReport` produces deterministic categorization:

```typescript
export interface CollisionReport {
  timestamp: string;
  safeToBootstrap: boolean;
  safeToLinkExistingRecords: boolean;
  requiresManualResolution: boolean;
  blockingIssueCount: number;
  warningCount: number;
  summary: {
    players: {
      total: number;
      active: number;
      disabled: number;
      merged: number;
      linked: number;
      unlinked: number;
      validPhoneCount: number;
      invalidPhoneCount: number;
      missingPhoneCount: number;
      verifiedMergedCount: number;
      unverifiedMergedCount: number;
    };
    appUsers: { total: number; withPlayerId: number; missingPlayerId: number };
    indexes: { phoneIndexTotal: number; uidIndexTotal: number };
  };
  phoneCollisions: PhoneCollision[];
  uidCollisions: UidCollision[];
  appUserInconsistencies: AppUserInconsistency[];
  orphanIndexes: OrphanIndexEntry[];
  indexDisagreements: IndexDisagreement[];
  missingIndexReservations: MissingIndexReservation[];
  remediationSuggestions: string[];
}
```

### Readiness Evaluation Logic:
- **`safeToBootstrap: boolean`**: Evaluated as `blockingIssueCount === 0`. It is strictly `false` if ANY active phone collision, unverified disabled duplicate, UID collision, orphaned index, index disagreement, unverified merged record, or active/linked player with a malformed phone exists.
- **`safeToLinkExistingRecords: boolean`**: Evaluated as `true` only if no blocking UID collisions exist, zero missing index reservations remain on linked players, zero blocking appUser inconsistencies exist, and zero malformed phones exist on linked players.
- **`requiresManualResolution: boolean`**: Evaluated as `!safeToBootstrap || blockingIssueCount > 0`. Triggers when administrator intervention is required before indexing.

---

## 5. Adversarial Emulator Test Evidence

File: `tests/remediation1e-secure-merge-and-privileged-writes.emulator.test.mjs`  
All 18 adversarial tests pass with 100% success against the live Firestore Emulator:

| # | Test Description | Result | Execution Details |
|---|---|---|---|
| 1 | Keeper and loser have different Firebase UIDs: merge rejected | **PASS** | Returns `409 Conflict` (`CONFLICTING_AUTH_UIDS`). |
| 2 | Keeper phoneIndex belongs to a different player: merge rejected | **PASS** | Returns `409 Conflict` (`KEEPER_PHONE_RESERVATION_CONFLICT`). |
| 3 | Loser phoneIndex belongs to a third player: merge rejected | **PASS** | Returns `409 Conflict` (`LOSER_PHONE_RESERVATION_THIRD_PARTY`). |
| 4 | Keeper uidIndex belongs to another player: merge rejected | **PASS** | Returns `409 Conflict` (`KEEPER_UID_RESERVATION_CONFLICT`). |
| 5 | Loser uidIndex conflicts with another player: merge rejected | **PASS** | Returns `409 Conflict` (`LOSER_UID_RESERVATION_THIRD_PARTY`). |
| 6 | Multiple appUsers point to keeper and loser: controlled conflict | **PASS** | Returns `409 Conflict` (`MULTIPLE_KEEPER_APP_USERS`). |
| 7 | Merge with more than 400 writes: recoverable staged execution | **PASS** | 420 payments reparented across chunked batches; all 420 verified on keeper. |
| 8 | Failure during migration: no false merge completion | **PASS** | Incomplete merge leaves loser `mergeStatus: 'in_progress'` and `disabled: false`. |
| 9 | Retry of partially completed merge: idempotent recovery | **PASS** | Subsequent merge invocation on interrupted job completes all stages cleanly. |
| 10 | Concurrent merge and account-link attempt: in-progress merge prevents account linking | **PASS** | `linkPlayerAccount` returns `409` (`Player record is currently undergoing an administrative merge`). |
| 11 | Club Admin client write to authUid: denied | **PASS** | `assertFails` confirmed via client Firestore SDK. |
| 12 | Super Admin client write to authUid: denied | **PASS** | `assertFails` confirmed via client Firestore SDK. |
| 13 | Super Admin client write to appUsers.playerId: denied | **PASS** | `assertFails` confirmed via client Firestore SDK. |
| 14 | Existing legitimate profile updates still work | **PASS** | `assertSucceeds` confirmed updating permitted fields (`locality`, `jerseyNumber`). |
| 15 | Invalid bootstrap population cannot be classified as fully safe | **PASS** | Active player with malformed phone + unverified merged player flags `safeToBootstrap: false`. |
| 16 | Missing index reservation for linked player is reported | **PASS** | Linked player lacking `uidIndex` or `phoneIndex` populated in `missingIndexReservations`. |
| 17 | Contention fallback rejects inconsistent canonical phone fields | **PASS** | Inconsistent phone fields fail contention recovery verification. |
| 18 | Generic INVALID_ARGUMENT is not misclassified as contention | **PASS** | Generic error returns `500 Internal Server Error`, not `409`. |

---

## 6. Complete Verification Battery

| Test Suite / Quality Gate | Command | Result | Notes |
|---|---|---|---|
| **Remediation 1E Suite** | `npm run test:emulator -- tests/remediation1e-secure-merge-and-privileged-writes.emulator.test.mjs` | **18/18 PASS** | All 18 adversarial scenarios pass against Firestore Emulator. |
| **All Emulator Tests** | `npm run test:emulator` | **151/151 PASS** | 15 test suites executed in Firestore Emulator (0 failed, 0 skipped). |
| **Functional Suite** | `npm run test:functional` | **253/253 PASS** | Complete functional tests passing. |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **0 ERRORS** | Strict typecheck clean. |
| **Linting** | `npm run lint` | **0 ERRORS** | Clean (4 production open-read warnings on public collections). |
| **Production Build** | `npm run build` | **SUCCESS (0)** | Standalone deployment artifact built cleanly. |
| **Production Smoke E2E** | `npm run test:e2e:prod` | **4/4 PASS** | Playwright standalone production smoke passed (4/4). |
| **Playwright Dev Suite** | `npx playwright test e2e/production-app.spec.ts` | **30/30 PASS** | Full 7-role RBAC, touch target, and view tests passed (30/30). |

---

## 7. Remaining Limitations & Phase Boundary Governance

1. **Production Deployment Restriction:**  
   Per `AGENTS.md`, zero production writes, migrations, or deployments were performed. All test validations run against local Firebase Emulator and standalone builds.
2. **Phase Status:**  
   Remediation 1E hardens player merge, privileged client writes, and bootstrap auditing. Phases 5 and 6 remain formally pending independent reviewer verification and product owner acceptance.
3. **Offline Dry-Run Bootstrap:**  
   `scripts/bootstrap-identity-index.ts` remains strictly read-only. It reports population health and missing reservations without executing writes to live or staging databases.
