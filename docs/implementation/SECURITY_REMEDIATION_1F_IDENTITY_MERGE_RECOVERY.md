# Security Remediation 1F & 1F-R: Atomic Identity Merge, Verified Recovery, Financial Data Integrity & Four-Way Consistency

**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `security/remediation-1f-a`  
**Baseline Commit:** `e1240d0b17a4e992da9061c3284f6b5819780d56`  
**1F-R Starting Baseline:** `1ebac7f113248733264a05b7bbad305c91cde644`  
**Implementation Commit SHA:** [`5b504c6`](https://github.com/dixitashutosh007/KAvach-Play/commit/5b504c6)  
**Implementation Agent:** Antigravity (Gemini)  
**Independent Reviewer:** ChatGPT (read-only review)  
**Operating Mode:** Read-only test validation and atomic remediation with emulator verification. Zero production writes, zero live migrations, zero deployment.

---

## 1. Executive Summary & Findings Addressed

Security Remediation 1F & 1F-R resolves all findings (1F-01 through 1F-08 and 1F-R Workstreams R1 through R10 / F1 through F10) identified during the independent reviews:

| Finding ID | Title | Summary of Implementation & Defense | Evidence / Files |
|---|---|---|---|
| **1F-01 / F6** | **Move identity reservation validation inside the transaction** | Evaluates all identity conditions and multiplicity checks inside an atomic Firestore transaction reading fresh `players`, `uidIndex`, and `phoneIndex` documents. Recomputes target UID, canonical phone, and keeper patch from live transaction snapshots. Rejects conflicting UIDs, third-party reservations, multiple appUsers, and malformed phone/UID records with HTTP 409. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeMergeIdentityStage`)<br>Scenarios 1–8 |
| **1F-02 / F1-F3** | **Exclusive merge-job execution, worker fencing & player locks** | Enforces mutual exclusion via `acquireMergeLease` on `mergeJobs/{jobId}` AND locks BOTH `loserRef` and `keeperRef` with exact 10-field agreement (`jobId`, `status`, `leaseOwner`, `leaseToken`, `fencingToken`, `leaseExpiresAt`, `mergeJobId`, `mergeLeaseOwner`, `mergeFencingToken`, `mergeLeaseExpiresAt`). Rejects all 13 malformed, mismatched, and cross-job states with 409 codes. Fencing token is strictly validated on EVERY mutation chunk across all migration stages (`payments`, `otherFees`, `merchOrders`, `appUsers/indexes`). Stale workers cannot modify failed or completed jobs. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`acquireMergeLease`, `renewMergeLease`, `verifyWorkerFencingAndAdvanceStage`, `recordMergeJobFailure`)<br>Scenarios 9, 17, 35–37, 48–52, 58–63, 66–80 |
| **1F-03 / F4** | **Authoritative financial record collision protection** | Before moving `otherFees`, inspects destination `keeperRef.collection("otherFees").doc(feeId)`. If identical (comparing amount, title, status, templateId, paymentMethod, razorpayPaymentId, paidAmount/feeCollectedAmount, receiptId, waivedReason, refundId, cancelledBy), safely deduplicates. If different, halts immediately with HTTP 409 `FINANCIAL_RECORD_COLLISION`. Source is deleted only after verifying destination has been written. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`migrateOtherFeesStage`, `areFeesIdentical`)<br>Scenarios 13, 14, 38–40 |
| **1F-04 / F8-F9** | **Bounded, paginated stages with durable cumulative progress** | Replaced oversized single-batch mutations with bounded, resumable chunks (`limit(batchLimit)` with 50–100 ops, well below Firestore's 500-write limit) across payments, otherFees, merchOrders, and appUsers/indexes. Tracks cumulative progress (`stats.*Chunks`, `stats.*Progress`) that never decrements across retries. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`migratePaymentsStage`, `migrateMerchOrdersStage`, `migrateAppUsersAndIndexesStage`)<br>Scenarios 11, 12, 15, 16, 44–47 |
| **1F-05 / F10** | **Fail-closed independent final verification gate** | Before marking loser `completed` or `disabled`, independently queries payments, merchOrders, otherFees, appUsers, uidIndex, and phoneIndex to confirm zero residual loser references exist. Asserts keeper's authoritative phone reservation exists (if mobile present) and UID reservation exists (if authUid present). Guarded by a collectionGroup query in the atomic completion transaction. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`executeIndependentFinalVerification`, `executeMergeCompletionStage`)<br>Scenarios 18, 42, 43, 53, 56, 57, 83 |
| **1F-06 / F7** | **Canonical phone contract and four-way consistency** | Standardized authoritative field contract on `phoneIndex/{canonicalPhone}` (`playerId`, `authUid`, `canonicalPhone`, `createdAt`, `updatedAt`) and `uidIndex/{uid}` (`playerId`, `authUid`, `canonicalPhone`, `createdAt`, `updatedAt`). Enforces 10-point four-way idempotency verification across normal transaction and post-contention fallback in `lib/account-linking.ts`. Generic `INVALID_ARGUMENT` returns 500, not 409. | [lib/account-linking.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/account-linking.ts)<br>Scenarios 23–29 |
| **1F-07** | **Bootstrap readiness must fail closed** | Overhauled `scripts/bootstrap-identity-index.ts` so `safeToBootstrap` fails closed (`false`) if any active player has missing or malformed phone, duplicate phone, duplicate UID, missing UID/phone index on linked player, appUsers referencing disabled/merged/missing player, or invalid merge chains. | [scripts/bootstrap-identity-index.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/scripts/bootstrap-identity-index.ts)<br>Scenarios 30–34 |
| **1F-08** | **Lock merge lifecycle fields in Firestore rules** | Delegated to `firestore-rules-author` subagent. Updated `match /players/{playerId}` create and update rules to forbid client-side mutation of `['authUid', 'mergedInto', 'mergeStatus', 'mergeJobId']` across all roles. Maintained `/phoneIndex`, `/uidIndex`, and `/mergeJobs` as server-only (`allow read, write: if false;`). | [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L500-L506)<br>Scenarios 19–22 |
| **F5** | **Retire legacy unfenced PATCH endpoint** | Retired legacy unfenced `PATCH /api/admin/merge-players` endpoint (Option A: returns HTTP 405 Method Not Allowed with `{ code: "METHOD_NOT_ALLOWED" }`), requiring all merges to execute via transactional, fenced `POST`. | [app/api/admin/merge-players/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/admin/merge-players/route.ts) (`PATCH`)<br>Scenario 41 |
| **P1 Write Paths** | **Payment write-path audit & merge guard enforcement** | Audited all payment write paths across the codebase. Enforced: 1) Active merges blocked (`mergeStatus === 'in_progress'` throws retryable error); 2) Completed merges safely redirected (`mergedInto` keeper resolution); 3) Concurrent writes in completion window detected by collection-group query, aborting completion. | [lib/razorpay-order.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-order.ts), [lib/razorpay-webhook.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-webhook.ts), [hooks/useStore.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/hooks/useStore.ts)<br>Scenarios 55, 65, 83–85 |
| **P1 Rupee/Paise** | **Strict denomination separation & fractional rejection** | Built unit-specific `validateRupeeAmount` (strictly rejects >2 decimal places in rupees without silent rounding) and `validatePaiseAmount` (strictly rejects fractional paise and non-integers). Required `amount` in `resolveFinancialRecordValues`. | [lib/player-merge.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/player-merge.ts) (`validateRupeeAmount`, `validatePaiseAmount`)<br>Scenarios 64, 81, 82 |
| **P2 Webhook** | **Recursive merge resolution & duplicate idempotency** | Recursive `resolveActivePlayer` with cycle detection (`Set<string>`) and missing keeper validation. Deterministic late fee ID (`lf_${intentId}_${templateId}`) prevents duplicate fee levying. Conflicting replay rejected. | [lib/razorpay-webhook.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-webhook.ts)<br>Scenarios 84, 85 |

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

## 3. Privileged Identity & Payment Write Path Inventory

### 3.1 Privileged Identity Mutation Path Inventory
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

### 3.2 Complete Payment Write-Path Matrix & Merge Guards
Every payment write path in the codebase was audited and hardened against concurrent player merges:

| Payment Write Path | Location / Caller | Target Collection | Merge Guard Behavior | Residual Window Defense |
|---|---|---|---|---|
| **Razorpay Order Intent** | `app/api/razorpay/order/route.ts`<br>`lib/razorpay-order.ts` (`verifyPlayerOwnership`) | `razorpayIntents/{intentId}` | **Rejects with 409** if `player.mergeStatus === "in_progress"`. Resolves `player.mergedInto` to keeper before binding obligation. | Pre-flight rejection blocks intent creation for merging players. |
| **Razorpay Webhook Fulfilment** | `app/api/razorpay/webhook/route.ts`<br>`lib/razorpay-webhook.ts` (`processWebhookIntentTransaction`) | `matches/{m}/payments/{p}`, `players/{p}/otherFees/{f}`, `razorpayIntents/{i}` | **Throws retryable error** if active player is undergoing merge (`mergeStatus === "in_progress"`). Recursively resolves `mergedInto` chain with cycle detection and missing keeper validation. | Residual collectionGroup payment guard inside `executeMergeCompletionStage` catches any in-flight write and fails closed. |
| **Match Squad Initialisation** | `hooks/useStore.ts` (`handleSaveSquad`) | `matches/{matchId}/payments/{paymentId}` | Filters out `p.mergedInto` and `p.mergeStatus === "in_progress"` from chargeable squad list. | Prevents creating payment obligations for merging or merged players. |
| **Manual Cash Payment Record** | `hooks/useStore.ts` (`addPaymentWithAvailability`) | `matches/{matchId}/payments/{paymentId}` | Validates target player is not disabled, merged (`mergedInto`), or actively merging (`mergeStatus === "in_progress"`). | Prevents manual pitch-side cash records under merging losers. |
| **Fee Reparenting Stage** | `lib/player-merge.ts` (`migrateOtherFeesStage`) | `players/{keeperId}/otherFees/{feeId}` | Authoritative comparator validates duplicate fees. If identical, deletes source; if conflicting, halts with 409 `FINANCIAL_RECORD_COLLISION`. | Bounded paginated batches (50 ops) guarded by worker fencing token on every chunk commit. |
| **Payment Migration Stage** | `lib/player-merge.ts` (`migratePaymentsStage`) | `matches/{matchId}/payments/{paymentId}` | Reparents `playerId` from loser to keeper in bounded chunks (100 ops). Worker fencing token validated on every chunk commit. | Cumulative progress persisted monotonically; residual collectionGroup guard verifies 0 loser payments remain. |
| **Abandoned Match Reconciliation** | `app/api/admin/reconcile-abandoned/route.ts` | `matches/{matchId}/payments/{paymentId}` | Sets status to `Waived` for unpaid fees; leaves paid amounts as historical collections. Never deletes payment documents. | Idempotent updates with audit log; leaves keeper/loser mappings intact. |

### 3.3 Strict 10-Field Completion Lock Invariant Matrix (`executeMergeCompletionStage`)
In the final completion transaction, optional comparison patterns (`(loser.mergeLeaseOwner && ...)`) have been eliminated. All 10 fields across `job`, `loser`, and `keeper` are strictly required and verified before any completion writes are executed:

| Document | Required Field | Type / Value Constraint | Negative Test Scenario | Error Thrown |
|---|---|---|---|---|
| `mergeJobs/{jobId}` | `status` | Strictly `"in_progress"` | Scenario 86 | 409 `STALE_WORKER_FENCING_ERROR` |
| `mergeJobs/{jobId}` | `leaseOwner` | Non-empty string, exact match with worker | Scenario 87 | 409 `STALE_WORKER_FENCING_ERROR` |
| `mergeJobs/{jobId}` | `leaseToken` | Non-empty string, exact match with worker | Scenario 88 | 409 `STALE_WORKER_FENCING_ERROR` |
| `mergeJobs/{jobId}` | `fencingToken` | Positive integer, exact match with worker | Scenario 89 | 409 `STALE_WORKER_FENCING_ERROR` |
| `mergeJobs/{jobId}` | `leaseExpiresAt` | Finite number, strictly `> Date.now()` | Scenarios 90, 91 | 409 `STALE_WORKER_FENCING_ERROR` |
| `players/{loserId}` | `mergeJobId` | Non-empty string, exact match with `jobId` | Scenario 73 | 409 `FINAL_VERIFICATION_FAILED` |
| `players/{loserId}` | `mergeStatus` | Strictly `"in_progress"` | Scenario 92 | 409 `FINAL_VERIFICATION_FAILED` |
| `players/{loserId}` | `mergeLeaseOwner` | Non-empty string, exact match with job and worker | Scenario 92 | 409 `FINAL_VERIFICATION_FAILED` |
| `players/{loserId}` | `mergeFencingToken` | Integer, exact match with job and worker | Scenario 93 | 409 `FINAL_VERIFICATION_FAILED` |
| `players/{loserId}` | `mergeLeaseExpiresAt` | Finite number, exact match with `job.leaseExpiresAt` | Scenario 94 | 409 `FINAL_VERIFICATION_FAILED` |
| `players/{keeperId}` | Lock fields | Symmetrical 10-field check on keeper record | Scenario 95 | 409 `FINAL_VERIFICATION_FAILED` |

### 3.4 Foreign Lock Recovery & Orphaned Lock Lifecycle Matrix (`acquireMergeLease`)
When acquiring a merge lease, if a player record has `mergeStatus: "in_progress"` pointing to a different `foreignJobId`:

| Foreign Job State | Player Lock Metadata | Player Expiry State | Handling & Resolution | Resulting Code |
|---|---|---|---|---|
| Doc exists in `mergeJobs` | Valid or invalid | Active / Unexpired (`now < leaseExpiresAt`) | Active competing job holds priority; rejected | 409 `MERGE_IN_PROGRESS` / `KEEPER_LOCKED` |
| Doc exists in `mergeJobs` | Valid | Expired or Failed | Competing job document exists; requires manual operator resolution | 409 `PLAYER_LOCKED_BY_ANOTHER_JOB` |
| Doc missing in `mergeJobs` | Missing `mergeLeaseOwner` | Any | Malformed orphaned lock cannot prove expiry; fails closed | 409 `MALFORMED_PLAYER_LOCK` (Scenario 103) |
| Doc missing in `mergeJobs` | Missing `mergeFencingToken` | Any | Malformed orphaned lock cannot prove expiry; fails closed | 409 `MALFORMED_PLAYER_LOCK` (Scenario 104) |
| Doc missing in `mergeJobs` | Missing/malformed `mergeLeaseExpiresAt` | Missing, null, string, NaN | Missing expiry cannot count as expired; fails closed | 409 `MALFORMED_PLAYER_LOCK` (Scenarios 101, 102) |
| Doc missing in `mergeJobs` | Complete & valid | Unexpired (`now < mergeLeaseExpiresAt`) | Unexpired orphaned lease cannot be overridden; fails closed | 409 `PLAYER_LOCKED_BY_ANOTHER_JOB` (Scenario 107) |
| Doc missing in `mergeJobs` | Complete & valid | Strictly expired (`now >= mergeLeaseExpiresAt`) | Safe to reclaim orphaned lock; resets lock to new job | **200 OK / Reclaimed** (Scenario 108) |

### 3.5 Monetary Precision, Half-Paise Boundaries & Float Tolerance Contract
`validateRupeeAmount` and `validatePaiseAmount` enforce strict separation between rupee and paise units:

| Input Format | Test Value | Precision Handling | Tolerance Check | Outcome |
|---|---|---|---|---|
| Rupee 2-decimal number | `123.45`, `0.05` | Validated directly | `Math.abs(val*100 - round(val*100)) <= 1e-6` | Accepted (Scenario 109) |
| Rupee 2-decimal string | `"123.45"`, `"0.05"` | Regex `/^\d+(\.\d{1,2})?$/` | Exact string pattern | Accepted (Scenario 109) |
| Rupee 3-decimal half-paise | `123.454` | Rejected | Diff = `0.4` > `1e-6` | Rejected (Scenario 110) |
| Rupee 3-decimal half-paise | `123.455` | Rejected without silent rounding | Diff = `0.5` > `1e-6` | Rejected (Scenario 110) |
| Rupee 3-decimal half-paise | `123.456` | Rejected | Diff = `0.4` > `1e-6` | Rejected (Scenario 110) |
| Integer paise number/string | `12345`, `"12345"` | Integer validation | `Number.isInteger(num)` | Accepted (Scenario 111) |
| Fractional paise number | `12345.5` | Non-integer rejected | `!Number.isInteger(num)` | Rejected (Scenario 111) |
| Fractional paise string | `"12345.5"` | Regex `/^\d+$/` rejected | Decimal point disallowed | Rejected (Scenario 111) |
| Maximum amount boundary | `10,000,000` | Boundary limit check | `num <= 10_000_000` | Accepted (Scenario 112) |
| Beyond maximum amount | `10,000,000.01` | Boundary limit check | `num > 10_000_000` | Rejected (Scenario 112) |

### 3.6 Server-Side Enforcement vs Firestore Security Rules Across Payment Write Paths
In accordance with `AGENTS.md` Non-Negotiable Rule 5 ("Do not weaken Firestore rules to make the frontend work. UI visibility is not a security boundary"):
1. **Server-Side Authorization & Token Verification:** All payment generation (`/api/razorpay/order`) and webhook processing (`/api/razorpay/webhook`) verify cryptographic signatures and Firebase Auth ID tokens server-side before touching Firestore. Client-supplied amounts and statuses are strictly discarded; authoritative prices and obligations are derived exclusively from server-side database records.
2. **Direct Client Write Restrictions in `firestore.rules`:**
   - `matches/{matchId}/payments/{paymentId}`: Non-admin users cannot create or update payment documents with `status: "Paid"`. Only server-side webhooks or authorised admins can confirm payment.
   - `players/{playerId}/otherFees/{feeId}`: Client creation, update, and deletion are restricted exclusively to `isFinanceAdmin` or `isSuperAdmin`.
   - `razorpayIntents`: Server-only collection (`allow read, write: if false;`).
   - `phoneIndex`, `uidIndex`, `mergeJobs`: Server-only collections (`allow read, write: if false;`).

---

## 4. Test Evidence & Results

### 4.1 Test Suites Execution Matrix

| Test Suite | Command | Total | Passed | Failed | Skipped | Status |
|---|---|---|---|---|---|---|
| **Adversarial Remediation 1F & 1F-R Suite** | `npm run test:emulator -- tests/remediation1f-*.mjs` | 114 | 114 | 0 | 0 | **PASSED** |
| **Remediation 1F-A Suite** | `npm run test:emulator -- tests/remediation1fa-*.mjs` | 29 | 29 | 0 | 0 | **PASSED** |
| **Remediation 1E Hardened Suite** | `npm run test:emulator -- tests/remediation1e-*.mjs` | 20 | 20 | 0 | 0 | **PASSED** |
| **Functional Tests Suite** | `npm run test:functional` | 254 | 254 | 0 | 0 | **PASSED** |
| **TypeScript Typecheck** | `npx tsc --noEmit` | - | 0 errors | 0 | 0 | **PASSED** |
| **ESLint** | `npm run lint` | - | 0 errors | 0 | 0 | **PASSED** (4 open-read warnings) |
| **Production Build** | `npm run build` | 19 pages | 19 static/dynamic | 0 | 0 | **PASSED** |

### 4.2 Adversarial Remediation 1F & 1F-R Test Details (114 Scenarios)

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
35. `Scenario 35` (1F-R R1): Worker fencing rejects chunk commits when lease is superseded.
36. `Scenario 36` (1F-R R3): Keeper already undergoing another merge: rejected with HTTP 409 (`KEEPER_LOCKED`).
37. `Scenario 37` (1F-R R3): Cross-role player locks: loser as keeper in another job rejected with HTTP 409 (`PLAYER_ROLE_CONFLICT`).
38. `Scenario 38` (1F-R R4): Financial collision on payment reference mismatch: halts with HTTP 409 (`FINANCIAL_RECORD_COLLISION`).
39. `Scenario 39` (1F-R R4): Financial collision on paidAmount / collectedAmount mismatch: halts with HTTP 409 (`FINANCIAL_RECORD_COLLISION`).
40. `Scenario 40` (1F-R R4): Financial collision on refund / audit reference mismatch: halts with HTTP 409 (`FINANCIAL_RECORD_COLLISION`).
41. `Scenario 41` (1F-R R5): Retired legacy PATCH endpoint returns HTTP 405 Method Not Allowed (`METHOD_NOT_ALLOWED`).
42. `Scenario 42` (1F-R R10): Final verification fails closed if keeper's expected phone reservation is missing (`FINAL_VERIFICATION_FAILED`).
43. `Scenario 43` (1F-R R10): Final verification fails closed if keeper's expected UID reservation is missing (`FINAL_VERIFICATION_FAILED`).
44. `Scenario 44` (1F-R R8): Cumulative progress & monotonicity on partial resume: 250 payments resumed after chunk 1 failure without decrementing or resetting counter.
45. `Scenario 45` (1F-R R8): Cumulative progress for otherFees: preserves both `feesMoved` and `feesSkipped` on resume.
46. `Scenario 46` (1F-R R9): Bounded pagination across multiple pages: appUsers and indexes migrate in bounded pages (`limit(batchLimit)`) without unbounded memory loading.
47. `Scenario 47` (1F-R R9): Bounded final verification: fails closed on dataset exceeding batch limit.
48. `Scenario 48` (1F-R R2/R3): Stale lock recovery with missing job: safely reclaims orphaned player lock.
49. `Scenario 49` (1F-R R2/R3): Stale lock recovery with failed job: reclaims failed job and increments fencing token.
50. `Scenario 50` (1F-R R2/R3): One-sided lock inconsistency: safely reconciles when one player is unlocked.
51. `Scenario 51` (1F-R R2/R3): Strict lease renewal validation: throws `LEASE_RENEWAL_FAILED` on missing or tampered player lock.
52. `Scenario 52` (1F-R R2/R3): Structured failure persistence: persists `status: "failed"` and `failedStage` via `recordMergeJobFailure`.
53. `Scenario 53` (1F-R R10): Atomic completion guard: detects concurrent record created in verification window and fails closed.
54. `Scenario 54` (1F-R R4): Strengthened financial comparator: detects contradictory internal alias pairs across 12 authoritative fields.
55. `Scenario 55` (1F-R R10): Write paths block merging players: `verifyPlayerOwnership` in `lib/razorpay-order.ts` strictly rejects actively merging players (`mergeStatus: "in_progress"`).
56. `Scenario 56` (1F-R R10): Genuine emulator concurrency between `executeMergeCompletionStage()` and concurrent payment insertion: optimistic read set invalidation triggers transaction retry, detects residual payment via collection group query, and fails closed with HTTP 409 (`FINAL_VERIFICATION_FAILED`). Job and player remain incomplete.
57. `Scenario 57` (1F-R R10): Genuine emulator concurrency between `executeMergeCompletionStage()` and concurrent `otherFees` insertion: transaction detects residual fee and aborts with HTTP 409 (`FINAL_VERIFICATION_FAILED`).
58. `Scenario 58` (1F-R R2/R3): Malformed player lock rejection: player with `mergeStatus: "in_progress"` but missing `mergeJobId` is rejected with HTTP 409 (`MALFORMED_PLAYER_LOCK`).
59. `Scenario 59` (1F-R R2/R3): Mismatched lock rejection: player lock metadata disagreeing with active job fencing token is rejected with HTTP 409 (`PLAYER_LOCK_MISMATCH`).
60. `Scenario 60` (1F-R R2/R3): Cross-job lock conflict: loser and keeper locked to distinct merge jobs rejected with HTTP 409 (`CROSS_JOB_LOCK_CONFLICT`).
61. `Scenario 61` (1F-R R2/R3): Incomplete completed job: job marked `completed` but loser remains uncompleted/enabled rejected with HTTP 409 (`INCOMPLETE_COMPLETED_JOB`).
62. `Scenario 62` (Failure Lifecycle): Worker identity and lease token mismatch: stale worker cannot record failure on active job (`WORKER_LEASE_OWNER_MISMATCH`).
63. `Scenario 63` (Failure Lifecycle): Completed job downgrade prevention: stale or late failure handler cannot downgrade completed job (`JOB_NOT_IN_PROGRESS_COMPLETED`).
64. `Scenario 64` (1F-R R4): Strengthened financial comparator input validation: `parseAuthoritativeAmount` and `resolveFinancialRecordValues` reject NaN, Infinity, negative amounts, non-numeric strings, contradictory paid amount aliases, contradictory refund aliases, and unsupported currencies while enforcing 2-decimal rupee precision.
65. `Scenario 65` (1F-R R10): Webhook transactional redirection: late fee webhook for merged player reads player state before write and safely redirects fee creation to keeper with `originalPlayerId: loserId`.
66. `Scenario 66` (Lock Invariants: Missing job leaseOwner): Rejects with HTTP 409 (`MALFORMED_JOB_LEASE`).
67. `Scenario 67` (Lock Invariants: Missing job leaseToken): Rejects with HTTP 409 (`MALFORMED_JOB_LEASE`).
68. `Scenario 68` (Lock Invariants: Missing job fencingToken): Rejects with HTTP 409 (`MALFORMED_JOB_LEASE`).
69. `Scenario 69` (Lock Invariants: Missing job leaseExpiresAt): Rejects with HTTP 409 (`MALFORMED_JOB_LEASE`).
70. `Scenario 70` (Lock Invariants: Missing loser lease metadata): Rejects with HTTP 409 (`PLAYER_LOCK_MISMATCH`).
71. `Scenario 71` (Lock Invariants: Missing keeper lease metadata): Rejects with HTTP 409 (`PLAYER_LOCK_MISMATCH`).
72. `Scenario 72` (Lock Invariants: Loser vs Keeper fencingToken disagreement): Rejects with HTTP 409 (`PLAYER_LOCK_MISMATCH`).
73. `Scenario 73` (Lock Invariants: Loser locked to different jobId): Rejects with HTTP 409 (`CROSS_JOB_LOCK_CONFLICT`).
74. `Scenario 74` (Lock Invariants: Expired job with unexpired player lock): Rejects with HTTP 409 (`PLAYER_LOCK_MISMATCH`).
75. `Scenario 75` (Lock Invariants: Unexpired job with expired player lock): Rejects with HTTP 409 (`PLAYER_LOCK_MISMATCH`).
76. `Scenario 76` (Lock Invariants: Stale worker fencing token rejected on renewal): Throws `LEASE_RENEWAL_FAILED`.
77. `Scenario 77` (Failure Lifecycle: Missing worker details): Refuses to record failure (`MISSING_WORKER_LEASE_OWNER`).
78. `Scenario 78` (Failure Lifecycle: Worker owner or fencing mismatch): Refuses to record failure (`WORKER_LEASE_OWNER_MISMATCH`).
79. `Scenario 79` (Failure Lifecycle: Expired lease): Fail-closed on recording failure (`LEASE_EXPIRED`).
80. `Scenario 80` (Failure Lifecycle: Job already failed): Stale worker cannot modify failed job (`JOB_NOT_IN_PROGRESS_FAILED`).
81. `Scenario 81` (Rupee vs Paise Unit Contract): Strict validation and fractional precision rejection (validates finite rupees, integer paise, rejects >2 decimal places in rupees without silent rounding, rejects fractional paise, enforces required amount).
82. `Scenario 82` (Rupee and Paise Boundary Cases): Negative, non-numeric, overflow and unsupported currency checks.
83. `Scenario 83` (R10 Genuine Emulator Concurrency with Barriers): Webhook blocks actively merging player; atomic completion transaction proceeds safely. Loser merged, zero payments created for loser.
84. `Scenario 83b` (R10 Barrier Concurrency with Rogue Payment Write): Atomic completion transaction detects interleaved concurrent write in completion window and aborts with HTTP 409 (`FINAL_VERIFICATION_FAILED`). Loser remains unmerged.
85. `Scenario 84` (Webhook Lifecycle: Duplicate delivery idempotency): Returns `alreadyProcessed: true` and rejects conflicting payment ID replay. Zero duplicate fee or payment documents created.
86. `Scenario 85` (Webhook Lifecycle: Multi-hop merge chain, cycles and missing keeper): Safely resolves multi-hop merge chains (A -> B -> C), detects circular merge chains (A -> B -> A), and fails closed if target keeper is nonexistent in Firestore.
87. `Scenario 86` (Completion Invariants: Job status !== in_progress): Rejects with HTTP 409 (`STALE_WORKER_FENCING_ERROR`); zero completion writes.
88. `Scenario 87` (Completion Invariants: Job leaseOwner mismatch): Rejects with HTTP 409 (`STALE_WORKER_FENCING_ERROR`); zero completion writes.
89. `Scenario 88` (Completion Invariants: Job leaseToken mismatch): Rejects with HTTP 409 (`STALE_WORKER_FENCING_ERROR`); zero completion writes.
90. `Scenario 89` (Completion Invariants: Job fencingToken mismatch): Rejects with HTTP 409 (`STALE_WORKER_FENCING_ERROR`); zero completion writes.
91. `Scenario 90` (Completion Invariants: Job lease expired): Rejects with HTTP 409 (`STALE_WORKER_FENCING_ERROR`); zero completion writes.
92. `Scenario 91` (Completion Invariants: Job leaseExpiresAt non-finite / NaN): Rejects with HTTP 409 (`STALE_WORKER_FENCING_ERROR`).
93. `Scenario 92` (Completion Invariants: Loser missing mergeLeaseOwner or mismatch): Rejects with HTTP 409 (`FINAL_VERIFICATION_FAILED`); zero completion writes.
94. `Scenario 93` (Completion Invariants: Loser missing mergeFencingToken or mismatch): Rejects with HTTP 409 (`FINAL_VERIFICATION_FAILED`).
95. `Scenario 94` (Completion Invariants: Loser missing or mismatched mergeLeaseExpiresAt): Rejects with HTTP 409 (`FINAL_VERIFICATION_FAILED`).
96. `Scenario 95` (Completion Invariants: Keeper missing or mismatched lock metadata): Rejects with HTTP 409 (`FINAL_VERIFICATION_FAILED`).
97. `Scenario 96` (Failure Lifecycle: Missing job leaseExpiresAt): Fail-closed on recording failure with `LEASE_EXPIRED`; job status remains `in_progress`.
98. `Scenario 97` (Failure Lifecycle: String or null leaseExpiresAt): Fail-closed on recording failure with `LEASE_EXPIRED`; job status remains `in_progress`.
99. `Scenario 98` (Failure Lifecycle: NaN leaseExpiresAt): Fail-closed on recording failure with `LEASE_EXPIRED`; job status remains `in_progress`.
100. `Scenario 99` (Failure Lifecycle: Infinity leaseExpiresAt): Fail-closed on recording failure with `LEASE_EXPIRED`; job status remains `in_progress`.
101. `Scenario 100` (Failure Lifecycle: Past/expired timestamp): Fail-closed on recording failure with `LEASE_EXPIRED`; job status remains `in_progress`.
102. `Scenario 101` (Foreign Lock: Missing mergeLeaseExpiresAt on foreign loser lock): Rejects with HTTP 409 (`MALFORMED_PLAYER_LOCK`).
103. `Scenario 102` (Foreign Lock: Malformed string mergeLeaseExpiresAt on foreign lock): Rejects with HTTP 409 (`MALFORMED_PLAYER_LOCK`).
104. `Scenario 103` (Foreign Lock: Missing mergeLeaseOwner on foreign lock): Rejects with HTTP 409 (`MALFORMED_PLAYER_LOCK`).
105. `Scenario 104` (Foreign Lock: Missing mergeFencingToken on foreign lock): Rejects with HTTP 409 (`MALFORMED_PLAYER_LOCK`).
106. `Scenario 105` (Foreign Lock: Existing active foreign job document): Rejects with HTTP 409 (`MERGE_IN_PROGRESS`).
107. `Scenario 106` (Foreign Lock: Existing foreign job failed or expired): Rejects with HTTP 409 (`PLAYER_LOCKED_BY_ANOTHER_JOB`).
108. `Scenario 107` (Foreign Lock: Missing foreign job doc with UNEXPIRED player lock): Rejects with HTTP 409 (`PLAYER_LOCKED_BY_ANOTHER_JOB`).
109. `Scenario 108` (Foreign Lock: Missing foreign job doc with EXPIRED player lock and valid metadata): Successfully reclaims lock and increments fencing token.
110. `Scenario 108b` (Foreign Lock: Symmetrical keeper checks): Rejects malformed foreign keeper lock and unexpired orphaned lock.
111. `Scenario 109` (Rupee Precision: 2 decimal places numeric and string): Exact acceptance without precision distortion.
112. `Scenario 110` (Rupee Precision: Half-paise and 3-decimal boundaries): Strict rejection of `123.454`, `123.455`, `123.456` without silent rounding.
113. `Scenario 111` (Paise Precision: Integer vs fractional paise boundaries): Rejects fractional paise (`12345.5`) and accepts integer paise.
114. `Scenario 112` (Amount Boundaries: Maximum allowable amount enforcement): Accepts `10,000,000` and rejects beyond (`10,000,000.01`).

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
- **Implementation Commit SHA:** `5b504c6`
- **Documentation Commit SHA:** (Recorded in Git log upon commit)
- **Independent Acceptance:** Antigravity does not self-certify. All changes and test evidence are prepared for independent read-only review by ChatGPT on branch `security/remediation-1f-a`.
