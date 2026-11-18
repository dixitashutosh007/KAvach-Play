# Security Remediation 1F-A: Transactional Identity Reservation Integrity & Exclusive Merge Execution

**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `security/remediation-1f-a`  
**Baseline Commit:** `e1240d0b17a4e992da9061c3284f6b5819780d56`  
**Implementation Commit:** `a042ae307822ab4bc18a0595d25a3a7ff978feca`  
**Implementation Agent:** Antigravity (Gemini)  
**Independent Reviewer:** ChatGPT (read-only review)  
**Operating Mode:** Read-only test validation and atomic remediation with emulator verification. Zero production writes, zero live migrations, zero live Razorpay charges.

---

## 1. Executive Summary & Scope

Security Remediation 1F-A delivers Gate 1F-A of Security Remediation 1F, establishing transactional identity reservation integrity and exclusive merge-job execution.

### Objectives Addressed

1. **Transactional Identity Reservation Validation:** All identity reservation rules and conflict checks are evaluated inside an atomic Firestore transaction before mutating `uidIndex` and `phoneIndex`. This eliminates race conditions where concurrent requests or pre-flight evaluations could observe stale data.
2. **Exclusive Merge Execution via Atomic Worker Lease:** Only one worker can execute a player merge job for a given loser/keeper pair at any given time. Worker lease acquisition, renewal, and release use an atomic Firestore transaction with strict mutual exclusion.
3. **Stale Worker Fencing:** Every state transition and completion check validates the worker's `leaseOwner`, `leaseToken`, unexpired `leaseExpiresAt`, and a monotonically increasing `fencingToken`. Stale workers attempting mutations after a lease timeout or reassignment are immediately rejected with `409 Conflict`.
4. **Account-Linking Coordination:** Account linking (`lib/account-linking.ts`) transactionally checks the active merge state in `mergeJobs/{jobId}`. Any active merge job locks the player against concurrent account linking. Completed merges allow linking to the verified surviving keeper record.
5. **Firestore Security Boundary:** Direct client read/write access to `mergeJobs` is denied in `firestore.rules` (`allow read, write: if false;`), ensuring only trusted Server Admin SDK processes can interact with merge state.

---

## 2. Architecture & Design

### 2.1 Worker Lease Schema (`mergeJobs/{jobId}`)

The `mergeJobs/{jobId}` document acts as an authoritative distributed lock and durable job state machine:

```typescript
export interface MergeJobData {
  jobId: string;
  loserId: string;
  keeperId: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  stage:
    | "pending"
    | "identity_locked"
    | "payments_reparented"
    | "fees_moved"
    | "orders_reparented"
    | "app_users_reparented"
    | "completed"
    | "failed";
  leaseOwner: string;        // Worker instance ID (e.g., worker-prod-1)
  leaseToken: string;        // Cryptographically secure UUID per acquisition
  leaseExpiresAt: number;    // Epoch ms when lease expires
  fencingToken: number;      // Monotonically increasing integer (1, 2, 3...)
  attemptCount: number;      // Number of acquisition attempts
  stageStats?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}
```

### 2.2 Atomic Lease Acquisition & Stealing Policy (`acquireMergeLease`)

When a worker attempts to process a merge:
1. **New Job:** If no `mergeJobs/{jobId}` document exists, it is created with `status: 'in_progress'`, `stage: 'pending'`, `attemptCount: 1`, `fencingToken: 1`, and `leaseExpiresAt = now + durationMs`.
2. **Existing Completed Job:** Returns `{ status: 'completed' }` immediately without acquiring a lease.
3. **Active Unexpired Lease:** If `leaseExpiresAt > now` and owned by another worker, the transaction aborts with `MergeConflictError("ACTIVE_LEASE_HELD")` (HTTP 409).
4. **Expired Lease (Worker Recovery):** If `leaseExpiresAt <= now`, the expired lease can be acquired by a new worker. The new worker acquires the lease, increments `attemptCount`, increments `fencingToken` by +1, generates a new `leaseToken`, and sets a fresh `leaseExpiresAt`.

### 2.3 Lease Renewal (`renewMergeLease`)

Workers executing long-running stages can renew their lease prior to expiry via `renewMergeLease` or the `PUT /api/admin/merge-players` endpoint:
- Validates inside a transaction that `leaseOwner` and `leaseToken` match.
- Verifies the lease has not already expired (`leaseExpiresAt > now`).
- Extends `leaseExpiresAt` by `additionalDurationMs` (default 60,000 ms).

### 2.4 Transactional Fencing (`verifyWorkerFencingAndAdvanceStage`)

Before advancing from one stage to the next (e.g. from `payments_reparented` to `fees_moved`):
- Executes inside a Firestore transaction.
- Reads `mergeJobs/{jobId}`.
- Asserts `snap.leaseOwner === worker.leaseOwner`.
- Asserts `snap.leaseToken === worker.leaseToken`.
- Asserts `snap.fencingToken === worker.fencingToken`.
- Asserts `snap.leaseExpiresAt > Date.now()`.
- If any check fails, aborts with `StaleWorkerError` (HTTP 409).
- Upon success, updates `stage = nextStage`, `updatedAt = Date.now()`, and merges `stageStats`.

### 2.5 Transactional Identity Stage Execution (`executeMergeIdentityStage`)

Stage 1 locks the identity state atomically inside a single Firestore transaction:
1. Validates that the active worker holds the lease and fencing token.
2. Reads in the transaction:
   - `players/{loserId}`
   - `players/{keeperId}`
   - `uidIndex` documents for target UIDs
   - `phoneIndex` documents for target phone numbers
3. Evaluates all 14 identity reservation invariants:
   - `CONFLICTING_AUTH_UIDS`: Keeper and loser both have distinct `authUid`.
   - `KEEPER_INELIGIBLE`: Keeper is disabled or marked merged.
   - `CONFLICTING_CANONICAL_PHONES`: Keeper and loser have distinct valid canonical phones.
   - `KEEPER_UID_RESERVATION_CONFLICT`: Keeper UID reserved to another player.
   - `KEEPER_PHONE_RESERVATION_CONFLICT`: Keeper phone reserved to another player.
   - `LOSER_UID_RESERVATION_THIRD_PARTY`: Loser UID reserved to another player.
   - `LOSER_PHONE_RESERVATION_THIRD_PARTY`: Loser phone reserved to another player.
   - `MULTIPLE_KEEPER_APP_USERS`: Multiple `appUsers` records for keeper.
   - `MULTIPLE_LOSER_APP_USERS`: Multiple `appUsers` records for loser.
   - `CONFLICTING_APP_USERS`: Both keeper and loser have distinct `appUsers`.
   - `MALFORMED_RESERVATION_RECORD`: Reservation points to wrong UID or phone.
4. In the same transaction:
   - Updates target `uidIndex` to point to `keeperId`.
   - Updates target `phoneIndex` to point to `keeperId`.
   - Marks loser: `{ mergeStatus: 'in_progress', mergedInto: keeperId }`.
   - Marks keeper: `{ mergeStatus: 'in_progress', ...keeperPatch }`.
   - Advances `mergeJobs/{jobId}`: `{ stage: 'identity_locked' }`.

### 2.6 Account-Linking Coordination (`lib/account-linking.ts`)

During `linkPlayerAccount`:
- Inside `executeLinkingTransaction`, reads `mergeJobs/job_${playerId}_*` or any active merge referencing the target player.
- If an active merge is found:
  - If lease is unexpired: throws 409 `"Player record is currently undergoing an active administrative merge."`
  - If lease is expired: throws 409 `"Player record is locked by an interrupted or expired merge job."`
  - If status is incomplete: throws 409 `"Player record is in an incomplete or unfinalized merge state."`
- If merge job status is `"completed"`, allows linking to the verified surviving player record.

---

## 3. Test Evidence

### 3.1 Dedicated Remediation 1F-A Test Suite

Test suite: `tests/remediation1fa-identity-reservations-and-merge-lease.emulator.test.mjs`  
Execution result: **29 / 29 passed (100%)**

#### Group 1: Transactional Identity Reservation Tests (11 Tests)
- `Test 1`: Conflicting authUid records between keeper and loser rejected inside transaction (`CONFLICTING_AUTH_UIDS`).
- `Test 2`: Keeper phone reservation pointing to another player rejected inside transaction (`KEEPER_PHONE_RESERVATION_CONFLICT`).
- `Test 3`: Loser phone reservation pointing to third party rejected inside transaction (`LOSER_PHONE_RESERVATION_THIRD_PARTY`).
- `Test 4`: Keeper uidIndex reservation pointing to another player rejected inside transaction (`KEEPER_UID_RESERVATION_CONFLICT`).
- `Test 5`: Loser uidIndex reservation pointing to third party rejected inside transaction (`LOSER_UID_RESERVATION_THIRD_PARTY`).
- `Test 6`: Conflicting canonical phones rejected inside transaction (`CONFLICTING_CANONICAL_PHONES`).
- `Test 7`: Disabled or already-merged keeper rejected inside transaction (`KEEPER_INELIGIBLE`).
- `Test 8`: Multiple appUsers pointing to keeper rejected inside transaction (`MULTIPLE_KEEPER_APP_USERS`).
- `Test 9`: Multiple appUsers pointing to loser rejected inside transaction (`MULTIPLE_LOSER_APP_USERS`).
- `Test 10`: Malformed phoneIndex document detected and rejected inside transaction (`MALFORMED_RESERVATION_RECORD`).
- `Test 11`: Valid reservation transfer updates uidIndex, phoneIndex, loser, and keeper atomically in transaction.

#### Group 2: Merge Lease & Worker Fencing Tests (13 Tests)
- `Test 12`: Initial merge lease acquired with attemptCount 1, fencingToken 1, and unexpired leaseExpiresAt.
- `Test 13`: Second worker acquiring lease while active lease is held receives 409 ACTIVE_LEASE_HELD.
- `Test 14`: Expired lease acquired by new worker; attemptCount and fencingToken incremented.
- `Test 15`: Lease renewal extends leaseExpiresAt when called by current leaseOwner with valid leaseToken.
- `Test 16`: Lease renewal rejected if lease has already expired.
- `Test 17`: Lease renewal rejected if attempted by worker other than leaseOwner.
- `Test 18`: verifyWorkerFencingAndAdvanceStage succeeds with matching fencingToken, leaseToken, and leaseOwner.
- `Test 19`: verifyWorkerFencingAndAdvanceStage rejected with StaleWorkerError if fencingToken is stale.
- `Test 20`: verifyWorkerFencingAndAdvanceStage rejected with StaleWorkerError if leaseToken does not match.
- `Test 21`: verifyWorkerFencingAndAdvanceStage rejected with StaleWorkerError if leaseOwner does not match.
- `Test 22`: verifyWorkerFencingAndAdvanceStage rejected with StaleWorkerError if lease has expired.
- `Test 23`: Final stage completion verifies fencing token before marking job and players completed.
- `Test 24`: Final stage completion rejected if worker holds stale fencing token.

#### Group 3: Account Linking & Merge Coordination Tests (5 Tests)
- `Test 25`: Account linking rejected with 409 when target player is in an active in-progress merge job.
- `Test 26`: Account linking rejected with 409 when target player is in an expired in-progress merge job.
- `Test 27`: Account linking rejected with 409 when target player is in an unfinalized/failed merge job.
- `Test 28`: Account linking permitted for surviving keeper player after merge job completes.
- `Test 29`: Account linking rejected with 404 when target player is disabled merged loser record.

### 3.2 Full Regression Test Suite Results

| Test Suite | Commands | Results | Status |
|---|---|---|---|
| **TypeScript Typecheck** | `npx tsc --noEmit` | 0 errors | **PASSED** |
| **ESLint** | `npm run lint` | 0 errors (4 rules warnings on open reads) | **PASSED** |
| **Production Build** | `npm run build` | Next.js standalone build clean | **PASSED** |
| **Functional Tests** | `npm run test:functional` | 253 passed / 253 total | **PASSED** |
| **Adversarial 1F-A Emulator Suite** | `npm run test:emulator -- tests/remediation1fa-*.mjs` | 29 passed / 29 total | **PASSED** |
| **Complete Emulator Suite** | `npm run test:emulator` | 180 passed / 180 total across 16 files | **PASSED** |

---

## 4. Git Evidence & Baseline Tracking

- **Repository:** `dixitashutosh007/KAvach-Play`
- **Branch:** `security/remediation-1f-a`
- **Starting Baseline SHA:** `e1240d0b17a4e992da9061c3284f6b5819780d56`
- **Implementation Commit SHA:** `a042ae307822ab4bc18a0595d25a3a7ff978feca`
- **Modified & Added Files:**
  - `firestore.rules` (Added `/mergeJobs/{jobId}` rule locking access to Admin SDK)
  - `lib/player-merge.ts` (Core lease acquisition, renewal, fencing verification, identity & completion stages)
  - `app/api/admin/merge-players/route.ts` (Admin route using `lib/player-merge.ts`, adding HTTP PUT for lease renewal)
  - `lib/account-linking.ts` (Transactional merge job coordination in `executeLinkingTransaction`)
  - `tests/remediation1fa-identity-reservations-and-merge-lease.emulator.test.mjs` (29 adversarial emulator tests)

---

## 5. Next Steps & Handoff

In accordance with `AGENTS.md` and project governance:
- **Implementation Agent:** Antigravity (Gemini) does not self-certify.
- **Independent Reviewer:** ChatGPT performs independent read-only review of branch `security/remediation-1f-a` at commit `a042ae307822ab4bc18a0595d25a3a7ff978feca`.
- **Subsequent Scope:** Remediation Gate 1F-B (distributed background worker / queue processing / dead-letter handling) and Phase 7 (Payments) remain strictly unopened until Gate 1F-A review is accepted.
