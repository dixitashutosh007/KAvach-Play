# Security Remediation 1F: Atomic Identity Merge, Verified Recovery, Financial Data Integrity & Four-Way Consistency

**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `security/remediation-1f-a`  
**Baseline Commit:** `e1240d0b17a4e992da9061c3284f6b5819780d56`  
**Implementation Commit SHA:** [`1ebac7f113248733264a05b7bbad305c91cde644`](https://github.com/dixitashutosh007/KAvach-Play/commit/1ebac7f113248733264a05b7bbad305c91cde644)  
**Implementation Agent:** Antigravity (Gemini)  
**Independent Reviewer:** ChatGPT (read-only review)  
**Operating Mode:** Read-only test validation and atomic remediation with emulator verification. Zero production writes, zero live migrations, zero deployment.

---

## 1. Executive Summary & Findings Addressed

Security Remediation 1F resolves all findings (1F-01 through 1F-08) identified during the independent review of Remediation 1E:

| Finding ID | Title | Summary of Implementation & Defense | Evidence / Files |
|---|---|---|---|
| **1F-01** | **Move identity reservation validation inside the transaction** | Evaluates all 14 identity conditions and multiplicity checks inside an atomic Firestore transaction reading direct `players`, `uidIndex`, and `phoneIndex` documents before mutating any reservation data. Rejects conflicting UIDs, third-party reservations, multiple appUsers, and malformed phone/UID records with HTTP 409. Never silently overwrites or steals reservations. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeMergeIdentityStage`)<br>Tests 1–8 |
| **1F-02** | **Exclusive merge-job execution via atomic worker lease & fencing** | Enforces mutual exclusion via `acquireMergeLease` on `mergeJobs/{jobId}` (`leaseOwner`, `leaseToken`, `leaseExpiresAt`, `fencingToken`, `attemptCount`). Active leases reject concurrent workers with HTTP 409 (`ACTIVE_LEASE_EXISTS`). Monotonically increasing `fencingToken` verified on every stage transition and completion. Interrupted jobs resume safely from verified stage. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`acquireMergeLease`, `verifyWorkerFencingAndAdvanceStage`)<br>Tests 9, 17 |
| **1F-03** | **Financial record collision protection** | Before moving `otherFees`, inspects destination `keeperRef.collection("otherFees").doc(feeId)`. If identical, handles duplicate safely. If different, aborts with HTTP 409 `FINANCIAL_RECORD_COLLISION`. Source is deleted only after verifying destination has been successfully written. Preserves original record IDs, amounts, statuses, Razorpay references, timestamps, and audit history. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`migrateOtherFeesStage`, `areFeesIdentical`)<br>Tests 13, 14 |
| **1F-04** | **Bound every migration stage** | Replaced oversized single-batch mutations with bounded, resumable chunks (batch size 50–100 ops, well below Firestore's 500-write limit) across payments, otherFees, merchOrders, and appUsers/indexes. Persists intermediate chunk progress (`stats.*Chunks`, `stats.*Progress`) to `mergeJobs/{jobId}` after each commit. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`migratePaymentsStage`, `migrateMerchOrdersStage`, `migrateAppUsersAndIndexesStage`)<br>Tests 11, 12, 15, 16 |
| **1F-05** | **Independent final migration verification gate** | Before marking loser `completed` or `disabled`, independently queries payments, merchOrders, otherFees, appUsers, uidIndex, and phoneIndex to confirm zero residual loser references exist. Independently validates keeper state, authoritative phone reservation, authoritative UID reservation, and four-way consistency. Leaves job incomplete if any check fails. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeIndependentFinalVerification`)<br>Test 18 |
| **1F-06** | **Canonical phone contract and four-way consistency** | Standardized authoritative field contract on `phoneIndex/{canonicalPhone}` (`playerId`, `authUid`, `canonicalPhone`, `createdAt`, `updatedAt`) and `uidIndex/{uid}` (`playerId`, `authUid`, `canonicalPhone`, `createdAt`, `updatedAt`). Enforced 10-point four-way idempotency verification across normal transaction and post-contention fallback in `lib/account-linking.ts`. Generic `INVALID_ARGUMENT` returns 500, not 409. | [lib/account-linking.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/account-linking.ts)<br>Tests 23–29 |
| **1F-07** | **Bootstrap readiness must fail closed** | Overhauled `scripts/bootstrap-identity-index.ts` so `safeToBootstrap` fails closed (`false`) if any active player has missing or malformed phone, duplicate phone, duplicate UID, missing UID/phone index on linked player, appUsers referencing disabled/merged/missing player, or invalid merge chains. Separately reports `safeToBootstrap`, `safeToLinkExistingRecords`, `requiresManualResolution`, and detailed category counts. | [scripts/bootstrap-identity-index.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/scripts/bootstrap-identity-index.ts)<br>Tests 30–34 |
| **1F-08** | **Lock merge lifecycle fields in Firestore rules** | Delegated to `firestore-rules-author` subagent. Updated `match /players/{playerId}` create and update rules to forbid client-side mutation of `['authUid', 'mergedInto', 'mergeStatus', 'mergeJobId']` across all roles (including Super Admin and Club Admin). Maintained `/phoneIndex`, `/uidIndex`, and `/mergeJobs` as server-only (`allow read, write: if false;`). | [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L500-L506)<br>Tests 19–22 |

---

## 2. Architecture & Detailed Design

### 2.1 Identity Transaction State Machine (`lib/player-merge.ts`)

```
[ POST /api/admin/merge-players ]
                │
                ▼
   [ Atomic Worker Lease Claim ] ─── (Active Lease Held) ───► 409 ACTIVE_LEASE_EXISTS
                │
          (Lease Granted)
                ▼
   [ Stage 1: Identity Lock Tx ] ─── (Invariant Violated) ──► 409 MergeConflictError
   - Validates all 14 identity conditions
   - Atomically updates target uidIndex & phoneIndex
   - Marks loser: { mergeStatus: 'in_progress', mergedInto: keeperId }
   - Marks keeper: { mergeStatus: 'in_progress', ...keeperPatch }
   - Advances job: stage = 'identity_locked'
                │
                ▼
   [ Stage 2: Payments Chunks ]
   - Bounded batches of 100 payments
   - Persists progress after each chunk
   - Fencing verification: advances stage to 'payments_reparented'
                │
                ▼
   [ Stage 3: OtherFees Migration with Collision Protection ]
   - Reads destination keeper fee
   - If dest exists & identical: safe delete of duplicate source
   - If dest exists & differs: HALTS with 409 FINANCIAL_RECORD_COLLISION
   - If dest absent: copies source, verifies destination read-back, deletes source
   - Fencing verification: advances stage to 'fees_moved'
                │
                ▼
   [ Stage 4: Merch Orders Chunks ]
   - Bounded batches of 100 orders
   - Fencing verification: advances stage to 'orders_reparented'
                │
                ▼
   [ Stage 5: AppUsers & Indexes Chunks ]
   - Bounded batches of 100 records
   - Fencing verification: advances stage to 'app_users_reparented'
                │
                ▼
   [ Stage 6: Independent Final Verification Gate ]
   - Confirms ZERO residual payments, orders, fees, users, indexes referencing loser
   - Confirms keeper identity, phoneIndex, uidIndex consistency
   - Atomic completion transaction: marks loser disabled, mergeStatus completed
                │
                ▼
       [ 200 OK Response ]
```

### 2.2 Financial Record Collision Protection Contract (`migrateOtherFeesStage`)

1. For each `feeDoc` in `loserRef.collection("otherFees")`:
   - Checks `destRef = keeperRef.collection("otherFees").doc(feeDoc.id)`.
   - If `destRef` exists:
     - Calls `areFeesIdentical(srcData, destData)` (compares `amount`, `title`, `status`, `templateId`).
     - If identical: Deletes source copy (idempotent recovery).
     - If differing: Aborts immediately with `MergeConflictError(409, ..., "FINANCIAL_RECORD_COLLISION")`. Both source and destination documents are preserved untouched.
   - If `destRef` does not exist:
     - Sets `destRef` with `playerId: keeperId`.
     - Reads back `destRef` to independently verify data.
     - Deletes source fee document only after verified destination write.

---

## 3. Privileged Identity Mutation Path Inventory (Section 13)

Exhaustive audit of every write path to protected identity fields in the repository:

| Path / Field | Caller & Location | Authorization | Invariant Validation | Atomicity & Staged Execution | Idempotency & Audit Trail |
|---|---|---|---|---|---|
| `phoneIndex/{phone}` | `lib/account-linking.ts` (`executeLinkingTransaction`) | Server Admin SDK via authenticated user token | Strict canonical E.164 (+91[6-9]\d{9}), candidate uniqueness, cross-index matching | Atomic Firestore transaction covering all 4 identity documents | Idempotent on identical 4-way match; writes `createdAt`, `updatedAt` |
| `phoneIndex/{phone}` | `lib/player-merge.ts` (`executeMergeIdentityStage`) | Server Admin SDK via `requireClubAdmin` | All 14 identity conditions validated inside transaction | Transactional lease + Stage 1 transaction | Monotonic fencing token, durable job audit in `mergeJobs` |
| `uidIndex/{uid}` | `lib/account-linking.ts` (`executeLinkingTransaction`) | Server Admin SDK via authenticated user token | One-to-one UID reservation, no orphaned player reference | Atomic Firestore transaction | Idempotent on verified 4-way link; writes `createdAt`, `updatedAt` |
| `uidIndex/{uid}` | `lib/player-merge.ts` (`executeMergeIdentityStage`) | Server Admin SDK via `requireClubAdmin` | Target UID reservation matching, third-party collision checks | Transactional lease + Stage 1 transaction | Monotonic fencing token, durable job audit in `mergeJobs` |
| `players/{id}.authUid` | `lib/account-linking.ts` (`executeLinkingTransaction`) | Server Admin SDK via authenticated user token | Candidate active, unmerged, matching verified phone | Atomic Firestore transaction | Idempotent on verified 4-way link |
| `players/{id}.authUid` | `lib/player-merge.ts` (`executeMergeIdentityStage`) | Server Admin SDK via `requireClubAdmin` | Rejects distinct active UIDs (`CONFLICTING_AUTH_UIDS`), verifies keeper | Transactional lease + Stage 1 transaction | Monotonic fencing token |
| `appUsers/{uid}.playerId` | `lib/account-linking.ts` (`executeLinkingTransaction`) | Server Admin SDK via authenticated user token | User active, matching candidate player | Atomic Firestore transaction | Idempotent on verified 4-way link |
| `appUsers/{uid}.playerId` | `lib/player-merge.ts` (`migrateAppUsersAndIndexesStage`) | Server Admin SDK via `requireClubAdmin` | Target player active keeper | Bounded chunked batches (<= 100 ops) | Tracked in `stats.appUsersReparentedProgress` |
| `players.mergedInto` | `lib/player-merge.ts` (`executeMergeIdentityStage`, `executeMergeCompletionStage`) | Server Admin SDK via `requireClubAdmin` | Keeper eligible, loser not already merged | Transactional lease + completion transaction | Protected by fencing token; client rules strictly block mutation |
| `players.mergeStatus` | `lib/player-merge.ts` (`executeMergeIdentityStage`, `executeMergeCompletionStage`) | Server Admin SDK via `requireClubAdmin` | Transition: pending -> in_progress -> completed | Transactional lease + completion transaction | Client rules strictly block mutation |
| `players.mergeJobId` | `lib/player-merge.ts` (`executeMergeIdentityStage`) | Server Admin SDK via `requireClubAdmin` | Bound to active lease `jobId` | Transactional lease | Client rules strictly block mutation |
| `mergeJobs/{jobId}` | `lib/player-merge.ts` (`acquireMergeLease`, `renewMergeLease`, `verifyWorkerFencingAndAdvanceStage`) | Server Admin SDK via `requireClubAdmin` | Lease duration, worker token, monotonic fencing | Transactional lease state machine | Client rules strictly deny read & write |

---

## 4. Test Evidence & Results

### 4.1 Test Suites Execution Matrix

| Test Suite | Command | Total | Passed | Failed | Skipped | Status |
|---|---|---|---|---|---|---|
| **Adversarial Remediation 1F Suite** | `npm run test:emulator -- tests/remediation1f-*.mjs` | 34 | 34 | 0 | 0 | **PASSED** |
| **Remediation 1F-A Suite** | `npm run test:emulator -- tests/remediation1fa-*.mjs` | 29 | 29 | 0 | 0 | **PASSED** |
| **Full Emulator Suite (17 files)** | `npm run test:emulator` | 215 | 215 | 0 | 0 | **PASSED** |
| **Functional Tests Suite** | `npm run test:functional` | 254 | 254 | 0 | 0 | **PASSED** |
| **TypeScript Typecheck** | `npx tsc --noEmit` | - | 0 errors | 0 | 0 | **PASSED** |
| **ESLint** | `npm run lint` | - | 0 errors | 0 | 0 | **PASSED** (4 open-read warnings) |
| **Production Build** | `npm run build` | 19 pages | 19 static/dynamic | 0 | 0 | **PASSED** |

### 4.2 Adversarial Remediation 1F Test Details (34 Scenarios)

1. `Scenario 1`: Reservation changes after pre-flight but before transaction: rejected inside transaction (`LOSER_PHONE_RESERVATION_THIRD_PARTY`).
2. `Scenario 2`: Keeper and loser have distinct active UIDs: HTTP 409 (`CONFLICTING_AUTH_UIDS`).
3. `Scenario 3`: Keeper phoneIndex owned by third party: HTTP 409 (`KEEPER_PHONE_RESERVATION_CONFLICT`).
4. `Scenario 4`: Loser phoneIndex owned by third party: HTTP 409 (`LOSER_PHONE_RESERVATION_THIRD_PARTY`).
5. `Scenario 5`: Keeper uidIndex owned by third party: HTTP 409 (`KEEPER_UID_RESERVATION_CONFLICT`).
6. `Scenario 6`: Loser uidIndex owned by third party: HTTP 409 (`LOSER_UID_RESERVATION_THIRD_PARTY`).
7. `Scenario 7`: Multiple appUsers point to keeper/loser: HTTP 409 (`MULTIPLE_KEEPER_APP_USERS`).
8. `Scenario 8`: Multiple phoneIndex or uidIndex records reference the same player: HTTP 409 (`KEEPER_MULTIPLE_UID_RESERVATIONS`).
9. `Scenario 9`: Two concurrent requests attempt the same merge: only one obtains job lease (`ACTIVE_LEASE_EXISTS`).
10. `Scenario 10`: Account linking races with merge execution: one safely wins; no inconsistent identity state.
11. `Scenario 11`: More than 400 payments migrate successfully through bounded chunks (420 payments tested).
12. `Scenario 12`: More than 400 identity/user records migrate without exceeding Firestore batch limits (420 records tested).
13. `Scenario 13`: Existing keeper otherFees document with identical content: safe idempotent handling.
14. `Scenario 14`: Existing keeper otherFees document with different content: conflict; both source and dest intact (`FINANCIAL_RECORD_COLLISION`).
15. `Scenario 15`: Failure after a committed migration chunk: loser remains incomplete (fault injection test).
16. `Scenario 16`: Retry after genuine partial migration resumes from verified progress.
17. `Scenario 17`: Worker lease expires and is safely reclaimed; stale worker cannot continue (`StaleWorkerError`).
18. `Scenario 18`: Final verification detects a deliberately retained loser reference and refuses completion (`FINAL_VERIFICATION_FAILED`).
19. `Scenario 19`: Club Admin cannot change authUid, mergedInto, mergeStatus, or mergeJobId via client SDK (`PERMISSION_DENIED`).
20. `Scenario 20`: Super Admin cannot change these same fields via client SDK (`PERMISSION_DENIED`).
21. `Scenario 21`: Super Admin cannot change appUsers.playerId via client SDK (`PERMISSION_DENIED`).
22. `Scenario 22`: Legitimate profile updates still work for self and admin.
23. `Scenario 23`: Normal idempotency rejects wrong `phoneIndex.canonicalPhone`.
24. `Scenario 24`: Normal idempotency rejects wrong `uidIndex.canonicalPhone`.
25. `Scenario 25`: Contention fallback rejects inconsistent four-way state.
26. `Scenario 26`: Contention fallback accepts only a fully consistent four-way state.
27. `Scenario 27`: Transaction-created phoneIndex records satisfy canonical field contract (`canonicalPhone`, `playerId`, `authUid`).
28. `Scenario 28`: Generic Firestore INVALID_ARGUMENT returns 500, not 409.
29. `Scenario 29`: Genuine transaction contention returns 409 unless complete concurrent success is verified.
30. `Scenario 30`: Missing phone number on active player blocks bootstrap readiness (`safeToBootstrap: false`).
31. `Scenario 31`: Invalid merge chain blocks bootstrap readiness (`invalidMergeRelationships > 0`).
32. `Scenario 32`: appUsers pointing to disabled/merged player is reported as blocking in bootstrap report.
33. `Scenario 33`: Missing UID and phone indexes prevent safe linking (`safeToLinkExistingRecords: false`).
34. `Scenario 34`: Duplicate canonical phone and UID ownership block bootstrap (`duplicatePhones: 1`).

---

## 5. Rollback & Recovery Strategy

1. **Transaction Abort Rollback:**
   - If any reservation conflict, multiplicity violation, or lease conflict occurs during Stage 1, the Firestore transaction aborts, leaving all `players`, `uidIndex`, and `phoneIndex` records unchanged.
2. **Mid-Flight Staged Recovery:**
   - If a worker crashes during Stage 2 (payments), Stage 3 (fees), Stage 4 (orders), or Stage 5 (appUsers), intermediate progress is recorded in `mergeJobs/{jobId}`.
   - Upon lease expiry, a recovering worker reclaims the lease, increments `fencingToken`, and resumes execution from the uncompleted stage. All chunks are idempotent.
3. **Collision Fail-Closed Guarantee:**
   - If conflicting financial records or residual documents are discovered, the merge halts without overwriting or deleting any financial data, leaving the job in `failed` status for manual administrative review.

---

## 6. Known Limitations & Remaining Risks

1. **Staging Environment Confirmation (OD-01):** Live testing must be performed against the isolated staging environment before any live database migration.
2. **Phase 7 Payments Dependency:** Live Razorpay operations remain unopened and will build upon this verified identity and financial integrity baseline.
3. **Framework Pinned Versions (D-11):** Next.js 15.0.0 and React 19 RC remain pinned per project governance.

---

## 7. Delivery & Independent Review Handoff

- **Zero Production Mutations:** Zero deployment, zero production writes, zero production migrations performed.
- **Implementation Commit SHA:** `1ebac7f113248733264a05b7bbad305c91cde644`
- **Documentation Commit SHA:** (Recorded in Git log upon commit)
- **Independent Acceptance:** Antigravity does not self-certify. All changes and test evidence are prepared for independent read-only review by ChatGPT on branch `security/remediation-1f-a`.
