# Security Remediation 1A: Hardened Player Account Linking

**Document type:** Security Remediation & Verification Report  
**Workstream:** Security Remediation 1A — Harden Player Account Linking  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Current Baseline Commit:** `6d714a180cb1529cb993397b249d2acca77272ed`  
**Status:** Completed & Emulator-Verified — Pending Independent Review & Owner Acceptance  

---

## 1. Original Security Finding

The independent review of Security Remediation 1 (commit `6d714a1`) identified an outstanding High-severity finding in the player account linking mechanism:

> **Finding:** The Firestore account-linking rule previously used substring matching between the authenticated phone number and the stored player mobile number:
> ```javascript
> (request.auth.token.phone_number.matches('.*' + existing().mobile + '.*') ||
>  existing().mobile.matches('.*' + request.auth.token.phone_number.replace('\\+', '') + '.*'))
> ```
> This was insufficient to establish reliable player identity. A user with a phone number containing a substring of a club player's phone number (or vice versa) could claim another person's player profile. Furthermore, Firestore security rules cannot perform arbitrary collection queries or transactions across documents to verify collection-wide player uniqueness or enforce 1-to-1 UID mapping.

---

## 2. Root Cause Analysis

1. **Permissive Regular Expressions in Security Rules:**
   - The use of `.*` prefix and suffix wildcards allowed partial matches, prefix-only matches, and suffix matches.
   - For example, an attacker with phone number `+919876543210` could match a stored number `987654` or `987654321000`.
2. **Collection-Level Uniqueness Limitation in Rules:**
   - Cloud Firestore Security Rules evaluate strictly within the scope of a single document write (`match /players/{playerId}`).
   - Firestore security rules cannot run queries (e.g. `collection('players').where('mobile', '==', ...)`), count documents, or verify whether multiple player records share the same mobile number.
3. **Absence of 1-to-1 Cross-Collection Binding in Client Writes:**
   - When account linking occurred via direct client SDK `updateDoc`, the client updated `players/{playerId}.authUid`.
   - The client SDK could not atomically guarantee that `appUsers/{uid}.playerId` was also bound in the same transaction, or verify that the caller UID was not already bound to another player elsewhere in the collection.
   - An attacker or network failure could cause identity desynchronization.

---

## 3. Account Linking Architecture: Before vs After

### 3.1 Previous Architecture (Insecure Client-Side Direct Write)
```
[Client Browser]
       │
       ├── Reads players collection client-side
       ├── Selects candidate matching mobile substring
       └── Directly calls updateDoc(doc(db, "players", candidate.id), { authUid: user.uid })
              │
              └── Evaluated by firestore.rules regex:
                  (token.phone_number.matches('.*' + mobile + '.*'))
                  [VULNERABLE: Substring match + No collection uniqueness + No atomic dual-write]
```

### 3.2 Revised Architecture (Trusted Server-Side Transactional Engine)
```
[Client Browser]
       │
       └── Calls POST /api/player/link-account (Bearer <Firebase ID Token>)
              │
              ▼
[Next.js Server API: app/api/player/link-account/route.ts]
       │
       ├── 1. requireAuth(req): Verifies Firebase ID token, extracts UID & token.phone_number
       ├── 2. Body Hygiene: Rejects any attempt to inject roles, status, authUid, or profile fields
       │
       ▼
[Server Linking Engine: lib/account-linking.ts]
       │
       ├── 3. Strict Phone Canonicalisation:
       │      Validates token.phone_number matches E.164 canonical format: ^\+91\d{10}$
       │
       ├── 4. Account Status & 1-to-1 UID Guard:
       │      - Verifies appUsers/{uid}.status != "Disabled"
       │      - Verifies appUsers/{uid}.playerId is not bound to a different player
       │      - Queries players.where("authUid", "==", uid) to ensure UID is not already bound
       │
       ├── 5. Collection-Wide Candidate Scan & Strict Equality:
       │      - Scans non-disabled, non-merged players
       │      - Compares normalizeIndianMobile(p.mobile) === canonicalAuthPhone (Strict Equality)
       │      - If matches == 0: Rejects (404 Not Found)
       │      - If matches > 1: Rejects (409 Conflict: Ambiguous identity requires admin merge)
       │
       ├── 6. Candidate Eligibility Verification:
       │      - Ensures candidate.disabled != true
       │      - Ensures candidate.mergedInto == null
       │      - Ensures candidate.authUid == null (or already matches UID for idempotent retry)
       │      - If client passed requestedPlayerId, verifies it strictly matches candidate.id
       │
       └── 7. Atomic Firestore Transaction (db.runTransaction):
              - Re-reads players/{id} and appUsers/{uid} inside transaction
              - Atomically updates:
                players/{id}.authUid = uid
                appUsers/{uid}.playerId = id
              - If transaction fails/aborts, ZERO partial state is written.

[Firestore Security Rules: firestore.rules]
       └── All direct client writes to authUid are strictly DENIED (PERMISSION_DENIED).
           Non-admins cannot mutate authUid via client SDK under any circumstances.
```

---

## 4. Phone-Number Canonicalisation Strategy

- **Format Standard:** Strict E.164 representation for Indian mobile numbers: `+91XXXXXXXXXX` (13 characters: `+91` followed by exactly 10 digits).
- **Validation Regex:** `/^\+91\d{10}$/`
- **Normalization Function:** `normalizeIndianMobile` (in `lib/utils.ts`):
  - Strips all non-digit characters (`\D`).
  - Strips prefixes: `+91`, `91`, `091`, and leading `0`.
  - Extracts the authoritative 10-digit sequence.
  - Formats as `+91${digits}`.
  - Returns unchanged if the digits do not form a valid 10-digit number.
- **Strict Equality Guarantee:**
  - Candidate matching uses `candidateCanonical === canonicalAuthPhone`.
  - Rejects partial strings (e.g. `987654321` vs `9876543210`).
  - Rejects prefix/suffix numbers (e.g. `987654321000`).
  - Rejects empty, missing, or malformed numbers.
  - Historical database values are **never modified in-place** during matching; canonicalization is applied safely in memory during comparison.

---

## 5. Uniqueness Enforcement & Ambiguity Resolution

When a verified phone number is processed:
1. **Zero matches:** Returns `404 Not Found` (`"No eligible player record found matching verified phone number."`).
2. **Multiple matches (`candidates.length > 1`):**
   - Condition: Two or more active player records share the same mobile number (e.g., family members sharing a phone, or unmerged duplicate roster records).
   - Action: **Strict rejection** with `409 Conflict`:
     `"Multiple player records found with this phone number. Ambiguous identity requires manual administrator resolution."`
   - Neither player record is linked.
   - An administrator must inspect `/admin-tools` and merge/update records before self-service linking can proceed.
3. **Exactly one match:** Linking proceeds to atomic transactional execution.

---

## 6. One-to-One UID/playerId Relationship Guarantees

| Invariant | Enforcement Mechanism |
|---|---|
| A Firebase UID cannot be linked to multiple players | Checked against `appUsers/{uid}.playerId` and query `players.where("authUid", "==", uid)` before linking. Rejects with `409 Conflict`. |
| A player record cannot be rebound to another UID | Candidate `authUid` must be null or match caller UID. Rejects with `409 Conflict`. |
| Existing `appUsers/{uid}.playerId` cannot silently change | Inside transaction, verifies `appUsers.playerId` matches target player ID or is null. |
| A previously linked player cannot be claimed again | Rejects if `candidate.authUid != uid` (`409 Conflict`). |
| Re-linking attempt by the same owner | Idempotent success: returns `200 OK` with `{ ok: true, alreadyLinked: true }`. Zero duplicate mutations. |
| Interrupted or failed linking transaction | Enclosed in `db.runTransaction()`. Either both documents are updated atomically or neither. |
| Client cannot supply arbitrary `playerId` | If `requestedPlayerId` is provided by the client, the server verifies it matches the authoritatively resolved record. Rejects with `403 Forbidden` if mismatched. |

---

## 7. Compatibility Analysis across Player Categories

1. **Existing Linked Players:**
   - Continue to function normally.
   - Legitimate re-requests return idempotent success (`alreadyLinked: true`).
   - Profile self-edits continue via `isSelf(playerId)` on the 17 allowlisted fields.
2. **Unlinked Historical Players:**
   - Single eligible historical players are cleanly resolved and atomically linked upon phone OTP verification.
   - All historical data (gameplay stats, match scorecards, fee records, payments) is preserved intact under the original document ID.
3. **Players with Legacy Phone Formats:**
   - `normalizeIndianMobile` safely parses 10-digit Indian numbers without country codes, leading zeros, or formatting spaces/dashes (e.g. `9876543210` -> `+919876543210`).
   - Historical numbers that are malformed or missing cannot be auto-linked and remain protected until updated by an admin.
4. **Duplicate Mobile-Number Records:**
   - Protected against accidental or malicious claiming. Both records remain unlinked until resolved by an administrator in `/admin-tools`.
5. **Disabled Players:**
   - Records with `disabled: true` are filtered out and rejected (`403/404`).
6. **Merged Players:**
   - Records with `mergedInto: "<keeperId>"` are filtered out and rejected (`403/404`).
7. **Users with Existing `appUsers` Documents:**
   - Atomically updated with `playerId: candidate.id`. If `appUsers` doc already exists, it is updated; if not, it is created with role `player` and status `Active`.
8. **Players whose Firebase UID differs from their player ID:**
   - Fully supported (`playerId !== Firebase UID`). The player document retains its original ID, while `players.authUid` and `appUsers.playerId` store the bidirectional link.

---

## 8. Files Changed

1. `firestore.rules`:
   - Removed insecure client-side substring account linking rule (lines 494–506).
   - Player document updates on `/players/{playerId}` are restricted strictly to `isAnyAdmin()` or `isSelf(playerId)` with the 17 allowlisted profile fields.
   - Direct client writes to `authUid` are completely blocked.
2. `lib/server-auth.ts`:
   - Added `phoneNumber?: string` to `AuthGuardResult`.
   - Populated `phoneNumber` from verified token claims (`decoded.phone_number`) in `requireAuth` (and `x-test-phone` for isolated test bypass).
   - Exported `getEffectiveDb` and `ensureAdminApp`.
3. `lib/account-linking.ts`:
   - Implemented `linkPlayerAccount(db, params)` and `isCanonicalIndianMobile(phone)`.
   - Implemented strict canonical E.164 phone verification, collection-wide uniqueness checks, 1-to-1 mapping validation, and atomic transactional dual-writes.
4. `app/api/player/link-account/route.ts`:
   - Created POST endpoint for authenticated account linking.
   - Enforces valid bearer token, rejects privileged/profile field injection, and delegates to `linkPlayerAccount`.
5. `app/page.tsx`:
   - Updated `handleSyncAccount` to invoke `POST /api/player/link-account` with the user's Firebase ID token instead of direct client `updateDoc`.
6. `tests/remediation1-firestore-auth.emulator.test.mjs`:
   - Updated Section 3 to assert that direct client SDK updates to `authUid` fail with `PERMISSION_DENIED` across all scenarios.
7. `tests/remediation1a-account-linking.emulator.test.mjs`:
   - Created comprehensive live Firebase Emulator test suite with 23 scenarios.

---

## 9. Comprehensive Test Matrix & Actual Verification Results

### 9.1 Remediation 1A Emulator Suite (`tests/remediation1a-account-linking.emulator.test.mjs`)
**Execution:** `node --test tests/remediation1a-account-linking.emulator.test.mjs` against live Firestore Emulator  
**Results:** **23/23 PASSED** (0 failed, 0 skipped, 0 cancelled)

| # | Scenario | Tested Component | Expected | Actual Result | Status |
|---|---|---|---|---|---|
| 1 | Exact canonical verified phone match, one eligible player | Engine | Allow (200, links player & user) | Allowed, both records updated | PASS |
| 2 | UID different from playerId | Engine | Allow (establishes mapping) | Allowed, ID preserved, authUid bound | PASS |
| 3 | Valid retry of completed linking operation | Engine | Allow (idempotent 200, alreadyLinked) | Allowed, alreadyLinked: true | PASS |
| 4 | Partial phone-number match | Engine | Deny (404) | Denied (404) | PASS |
| 5 | Prefix-only match (9 digits vs 10 digits) | Engine | Deny (400/404) | Denied (400/404) | PASS |
| 6 | Suffix-only match | Engine | Deny (404) | Denied (404) | PASS |
| 7 | Malformed stored phone number (e.g. "12345") | Engine | Deny (404) | Denied (404) | PASS |
| 8 | Empty stored phone number | Engine | Deny (404) | Denied (404) | PASS |
| 9 | Missing verified phone claim in token | Engine | Deny (400) | Denied (400) | PASS |
| 10 | No matching player in collection | Engine | Deny (404) | Denied (404) | PASS |
| 11 | Two players sharing same phone number | Engine | Deny (409 Ambiguous identity) | Denied (409 Ambiguous) | PASS |
| 12 | Matching player already linked to another UID | Engine | Deny (409 Rebinding blocked) | Denied (409) | PASS |
| 13 | Disabled player | Engine | Deny (404/403) | Denied (404) | PASS |
| 14 | Merged player | Engine | Deny (404/403) | Denied (404) | PASS |
| 15 | Firebase UID already linked to another player | Engine | Deny (409 Duplicate UID) | Denied (409) | PASS |
| 16 | Existing appUsers playerId conflicts with target | Engine | Deny (409 Conflict) | Denied (409) | PASS |
| 17 | Attempt to link another user's player record | Engine | Deny (403 Mismatched identity) | Denied (403) | PASS |
| 18 | Disabled user account | Engine | Deny (403 Disabled user) | Denied (403) | PASS |
| 19 | API Route: modify profile fields during linking | API Route | Deny (400 Forbidden fields) | Denied (400) | PASS |
| 20 | API Route: modify roles/status during linking | API Route | Deny (400 Privileged fields) | Denied (400) | PASS |
| 21 | API Route: valid request | API Route | Allow (200, clean response) | Allowed (200 OK) | PASS |
| 22 | Interrupted/failed linking transaction | Transaction | Zero partial identity mutation | Verified, zero partial state | PASS |
| 23 | Direct client SDK update of authUid | firestore.rules | Deny (`PERMISSION_DENIED`) | Denied by rules engine | PASS |

---

### 9.2 Full Verification Suite Results

1. **Full Firebase Emulator Battery (`npm run test:emulator`):**
   - **Suites:** 11 suites.
   - **Tests:** 92 total tests executed.
   - **Passed:** 92 passed.
   - **Failed:** 0 failed.
   - **Skipped:** 0 skipped.
2. **Functional Test Suite (`npm run test:functional`):**
   - **Suites:** 65 suites.
   - **Tests:** 253 total tests executed.
   - **Passed:** 253 passed.
   - **Failed:** 0 failed.
3. **TypeScript Compilation (`npx tsc --noEmit`):**
   - Exited with code `0` (clean, zero type errors).
4. **ESLint (`npm run lint`):**
   - Exited with code `0` (zero errors, 4 expected security-rules warning notices on public matches/config).
5. **Next.js Production Build (`npm run build`):**
   - Exited with code `0` (19/19 pages compiled; `/api/player/link-account` created).
6. **Standalone Production Smoke Suite (`npm run test:e2e:prod`):**
   - Exited with code `0` (4/4 Playwright tests passed against the Next.js standalone artifact).

---

## 10. Remaining Risks & Limitations

- **Duplicate Mobile Records Requiring Manual Merge:**
  - Where multiple active historical player records have identical mobile numbers, self-service linking is intentionally blocked to protect identity integrity. Administrators must use `/admin-tools` or `/api/admin/merge-players` to merge duplicate profiles before the player can link.
- **Zero Production Data Writes:**
  - In accordance with non-negotiable rules, all verification was performed strictly against the local Firebase Emulator. No production database writes, migrations, or deployments were performed.

---

## 11. Implementation Commit

- **Commit SHA:** `208715bb0e4a79d696fe24e31a34f08b79940cc3`
- **Branch:** `mig-mov`
- **Reviewer Status:** Developer remediated and emulator-verified. Ready for independent review and owner acceptance.
