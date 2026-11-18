# Security Remediation 1: Firestore Authorization & Player Identity Protection

**Document type:** Security Remediation & Verification Report  
**Workstream:** Security Remediation 1  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Branch:** `mig-mov`  
**Baseline Commit:** `9a7674c8580f6a482bfbad183ea586f66aa9660e`  
**Execution Mode:** Implementation with emulator-backed tests  
**Status:** Completed & Emulator-Verified — Pending Independent Review & Owner Acceptance  

---

## 1. Baseline and Commit Metadata

- **Audited Commit Baseline:** `9a7674c8580f6a482bfbad183ea586f66aa9660e`
- **Remediation Branch:** `mig-mov`
- **Target Files Modified:**
  - `firestore.rules`:
    1. Restrict collection-group read on `otherFees` strictly to `isFinanceAdmin() || isSuperAdmin() || (isSignedIn() && isSelf(resource.data.get('playerId', '')))`.
    2. Enforce explicit changed-field allowlist (`affectedKeys().hasOnly(...)`) and helper validator `isValidPlayerSelfUpdate(incoming, existing)` on player self-updates at `/players/{playerId}`.
    3. Strengthen account-linking branch on `/players/{playerId}` to verify active account (`isAccountActive()`), unlinked state (`authUid == null`), non-disabled/non-merged state, caller-bound `authUid == request.auth.uid`, exact affected keys (`['authUid', 'updatedAt']`), server timestamp validation, and matching phone token.
    4. Unroll admin helper evaluation (`isStudioAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isClubAdmin`, `isAnyAdmin`) to prevent AST evaluation recursion and eliminate Firestore's 1000-expression execution limit error.
  - `tests/remediation1-firestore-auth.emulator.test.mjs`:
    17 comprehensive live Firebase Emulator tests covering all least-privilege matrices, allowlist checks, tamper attacks, privilege escalations, and account-linking scenarios.

---

## 2. Vulnerability and Risk Analysis

### Defect A: `otherFees` Collection-Group Over-Permission (SEC-004 Leakage)
- **Vulnerability:** In `firestore.rules`, the recursive collection-group rule was defined as:
  ```javascript
  match /{path=**}/otherFees/{feeId} {
    allow read: if isAnyAdmin() || (isSignedIn() && isSelf(resource.data.get('playerId', '')));
  }
  ```
  While the direct subcollection rule at `/players/{playerId}/otherFees/{feeId}` correctly enforced:
  ```javascript
  allow read: if isFinanceAdmin() || isSuperAdmin() || isSelf(playerId);
  ```
- **Risk:** In Cloud Firestore security rules, permissions are additive. The collection-group rule granted read permissions to `isAnyAdmin()`, enabling Match Admin, Club Admin, and Studio Admin to read any player's financial fee records via collection-group queries, violating the principle of least privilege.

### Defect B: Unconstrained Player Document Self-Service Updates
- **Vulnerability:** The self-service update rule at `/players/{playerId}` previously stated:
  ```javascript
  allow update: if isAnyAdmin() || isSelf(playerId) || (phone regex account linking);
  ```
  The `isSelf(playerId)` branch lacked an `affectedKeys().hasOnly(...)` check and did not validate data types, lengths, or state transitions on incoming updates.
- **Risk:** An authenticated player could maliciously overwrite protected identity fields (`authUid`, `id`), account status (`disabled`, `disabledAt`, `mergedInto`), administrative permissions (`isSuperAdmin`, `isClubAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isStudioAdmin`, `role`), membership statuses (`kavachId`, `isStudioMember`, `studioStartDate`, `studioEndDate`, `studioPlan`, `studioExpiryDate`), financial records (`lastPaidDate`, `lastPaidAmount`, `feePlanIds`, `monthlyPlan`), gameplay stats (`totalRuns`, `totalWickets`, `droppedCatches`, `stunningCatches`), or privilege-escalate `inviteStatus` to `Verified` or `Accepted`.

---

## 3. Remediated Firestore Rules Architecture

### 3.1 Least-Privilege `otherFees` Collection-Group Rule
```javascript
match /{path=**}/otherFees/{feeId} {
  allow read: if isFinanceAdmin() || isSuperAdmin() || (isSignedIn() && isSelf(resource.data.get('playerId', '')));
}
```
- Direct subcollection reads (`/players/{playerId}/otherFees/{feeId}`) and recursive collection-group reads (`/{path=**}/otherFees/{feeId}`) are now fully aligned.
- Only Finance Admin and Super Admin can query the entire collection group or read across players.
- Individual players can only query their own fee records via `isSelf()`.
- Match Admin, Club Admin, and Studio Admin are strictly denied from reading foreign fees.

### 3.2 Secure Self-Service Player Document Rule
```javascript
match /players/{playerId} {
  allow read: if isSignedIn();
  allow create: if isAnyAdmin() || isSelf(playerId);
  allow update: if isAnyAdmin()
    || (
      isSelf(playerId)
      && incoming().diff(existing()).affectedKeys().hasOnly([
        'name', 'email', 'mobile', 'dob', 'locality', 'bloodGroup',
        'emergencyContact', 'battingStyle', 'bowlingStyle', 'isWicketKeeper',
        'chestSize', 'waistSize', 'jerseyNumber', 'jerseyName', 'photoURL',
        'inviteStatus', 'updatedAt'
      ])
      && isValidPlayerSelfUpdate(incoming(), existing())
    )
    || (
      isSignedIn()
      && isAccountActive()
      && existing().get('authUid', null) == null
      && existing().get('disabled', false) != true
      && existing().get('mergedInto', null) == null
      && incoming().get('authUid', null) == request.auth.uid
      && incoming().diff(existing()).affectedKeys().hasOnly(['authUid', 'updatedAt'])
      && (!('updatedAt' in incoming()) || incoming().updatedAt == request.time)
      && request.auth.token.phone_number != null
      && existing().get('mobile', '') != null
      && (request.auth.token.phone_number.matches('.*' + existing().mobile + '.*') || existing().mobile.matches('.*' + request.auth.token.phone_number.replace('\\+', '') + '.*'))
    );
  allow delete: if isAnyAdmin() && isValidId(playerId);
```

### 3.3 Helper Validator `isValidPlayerSelfUpdate`
```javascript
function isValidPlayerSelfUpdate(incoming, existing) {
  return (!('name' in incoming) || (incoming.name is string && incoming.name.size() > 0 && incoming.name.size() <= 100))
    && (!('email' in incoming) || (incoming.email is string && incoming.email.size() <= 100))
    && (!('mobile' in incoming) || (incoming.mobile is string && incoming.mobile.size() <= 20))
    && (!('dob' in incoming) || (incoming.dob is string && incoming.dob.size() <= 20))
    && (!('locality' in incoming) || (incoming.locality is string && incoming.locality.size() <= 100))
    && (!('bloodGroup' in incoming) || (incoming.bloodGroup is string && incoming.bloodGroup.size() <= 10))
    && (!('emergencyContact' in incoming) || (incoming.emergencyContact is string && incoming.emergencyContact.size() <= 20))
    && (!('battingStyle' in incoming) || (incoming.battingStyle is string && incoming.battingStyle.size() <= 50))
    && (!('bowlingStyle' in incoming) || (incoming.bowlingStyle is string && incoming.bowlingStyle.size() <= 50))
    && (!('isWicketKeeper' in incoming) || incoming.isWicketKeeper is bool)
    && (!('chestSize' in incoming) || (incoming.chestSize is string && incoming.chestSize.size() <= 20))
    && (!('waistSize' in incoming) || (incoming.waistSize is string && incoming.waistSize.size() <= 20))
    && (!('jerseyNumber' in incoming) || (incoming.jerseyNumber is string && incoming.jerseyNumber.size() <= 10))
    && (!('jerseyName' in incoming) || (incoming.jerseyName is string && incoming.jerseyName.size() <= 50))
    && (!('photoURL' in incoming) || (incoming.photoURL is string && incoming.photoURL.size() <= 500))
    && (!('inviteStatus' in incoming) || incoming.inviteStatus == existing.get('inviteStatus', '') || (incoming.inviteStatus == 'Pending' && existing.get('inviteStatus', 'Unverified') in ['Pending', 'Unverified', 'Invited']))
    && (!('updatedAt' in incoming) || incoming.updatedAt == request.time);
}
```

### 3.4 AST Evaluation Optimization
By unrolling recursive calls in `isStudioAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isClubAdmin`, and `isAnyAdmin`, each role check inspects `isAccountActive()` and `token.admin` directly rather than invoking nested function calls that repeatedly fetched `/appUsers/{uid}`. This keeps rule evaluation well within Cloud Firestore's 1000-expression limit.

---

## 4. Changed-Field Allowlist & Bounds Specification

| Field Name | Permitted Mutation | Type / Constraints | Validated Bounds |
|---|---|---|---|
| `name` | Self & Admin | `string` | `1 <= size() <= 100` (non-empty) |
| `email` | Self & Admin | `string` | `size() <= 100` |
| `mobile` | Self & Admin | `string` | `size() <= 20` |
| `dob` | Self & Admin | `string` | `size() <= 20` |
| `locality` | Self & Admin | `string` | `size() <= 100` |
| `bloodGroup` | Self & Admin | `string` | `size() <= 10` |
| `emergencyContact` | Self & Admin | `string` | `size() <= 20` |
| `battingStyle` | Self & Admin | `string` | `size() <= 50` |
| `bowlingStyle` | Self & Admin | `string` | `size() <= 50` |
| `isWicketKeeper` | Self & Admin | `bool` | Must be boolean |
| `chestSize` | Self & Admin | `string` | `size() <= 20` |
| `waistSize` | Self & Admin | `string` | `size() <= 20` |
| `jerseyNumber` | Self & Admin | `string` | `size() <= 10` |
| `jerseyName` | Self & Admin | `string` | `size() <= 50` |
| `photoURL` | Self & Admin | `string` | `size() <= 500` |
| `inviteStatus` | Self & Admin | `string` | Unchanged, or `Pending` from `Unverified`/`Invited`/`Pending` |
| `updatedAt` | Self & Admin | `timestamp` | Must equal `request.time` |
| `authUid` | **Admin or Verified Phone Linking Only** | `string` | Blocked on self-service profile update |
| `id` | **Admin Only** | `string` | Immutable document identifier |
| `disabled`, `disabledAt` | **Admin Only** | `bool`, `timestamp` | Protected account state |
| `mergedInto` | **Admin Only** | `string` | Protected identity pointer |
| `role`, `is*Admin` | **Admin Only** | RBAC flags | Protected authority flags |
| `status` | **Admin Only** | `string` | Protected account status |
| `kavachId` | **Admin Only** | `string` | Club membership sequence |
| `isStudioMember`, `studio*` | **Admin Only** | Studio CRM flags | Protected membership data |
| `lastPaidDate`, `lastPaidAmount` | **Server / Admin Only**| Financial fields | Immutable by player |
| `feePlanIds`, `monthlyPlan` | **Admin Only** | Billing plan pointers | Immutable by player |
| `totalRuns`, `totalWickets`, etc. | **Admin Only** | Gameplay stats | Immutable by player |
| `createdAt` | **Immutable** | `timestamp` | Creation timestamp |

---

## 5. Non-Breaking Impact Analysis

1. **Player Profile Editing (`components/ProfileTab.tsx`):**
   - Profile tab updates standard profile fields (`name`, `mobile`, `email`, kit sizes, batting/bowling style).
   - All editable fields are explicitly present in the allowlist.
   - Profile submission sets `inviteStatus` to `"Pending"` (for unverified players) or retains existing `"Accepted"`/`"Verified"` status. Both transitions are permitted by `isValidPlayerSelfUpdate`.
2. **Account Linking (`app/page.tsx:482-486`):**
   - Linking updates only `{ authUid: user.uid, updatedAt: serverTimestamp() }`.
   - The dedicated linking branch specifically permits `affectedKeys().hasOnly(['authUid', 'updatedAt'])` when verified by phone token.
3. **Registration & Onboarding (`components/RegistrationForm.tsx`):**
   - New player creation uses `allow create: if isAnyAdmin() || isSelf(playerId)`.
   - Unlinked or pending registrations are fully preserved.
4. **Shop & Merchandise (`components/ShopTab.tsx`):**
   - Kit size updates map to `chestSize` and `waistSize`, both in the allowlist.
5. **Admin Operations:**
   - Administrative updates bypass self-service restrictions via `isAnyAdmin()`, preserving admin management workflows.

---

## 6. Emulator Verification Battery (Positive & Negative Test Matrix)

**Suite:** `tests/remediation1-firestore-auth.emulator.test.mjs`  
**Execution:** `node --test tests/remediation1-firestore-auth.emulator.test.mjs` (via Firebase Local Emulator)  
**Total Tests:** 17  
**Pass:** 17  
**Fail:** 0  

| Test Scenario | Context / Role | Expected | Actual Result | Status |
|---|---|---|---|---|
| Unauthenticated direct fee read | Unauthenticated | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Unauthenticated collection-group fee read | Unauthenticated | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Player reads own `otherFees` direct | Player 1 (`uid_player_1`) | Allowed | Allowed | PASS |
| Player reads foreign `otherFees` direct | Player 1 (`uid_player_1`) | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Player queries collection-group scoped to self | Player 1 (`uid_player_1`) | Allowed | Allowed | PASS |
| Player queries collection-group scoped to foreign | Player 1 (`uid_player_1`) | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Player unscoped collection-group query | Player 1 (`uid_player_1`) | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Finance Admin direct & collection-group fee read | Finance Admin (`uid_fin_admin`) | Allowed | Allowed | PASS |
| Super Admin direct & collection-group fee read | Super Admin (`uid_super_admin`) | Allowed | Allowed | PASS |
| Club Admin foreign fee & collection-group read | Club Admin (`uid_club_admin`) | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Match Admin foreign fee & collection-group read | Match Admin (`uid_match_admin`) | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Studio Admin foreign fee & collection-group read | Studio Admin (`uid_studio_admin`)| Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Disabled Finance Admin fee read | Disabled Finance Admin | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Legitimate profile field self-update | Player 1 (`uid_player_1`) | Allowed | Allowed | PASS |
| Retain existing `inviteStatus: Accepted` | Player 1 (`uid_player_1`) | Allowed | Allowed | PASS |
| Transition `Unverified` to `Pending` | Unverified Player | Allowed | Allowed | PASS |
| Privilege escalation to `Verified` or `Accepted` | Player self-update | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Tamper attacks on 29 protected fields | Player self-update | Denied | All 29 attacks Denied | PASS |
| Bounds validation (empty name, name > 100, etc.) | Player self-update | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Foreign player profile update | Player 1 (`uid_player_1`) | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Admin update of player status / admin fields | Club Admin (`uid_club_admin`) | Allowed | Allowed | PASS |
| Phone-verified account linking | Authenticated phone user | Allowed | Allowed | PASS |
| Linking with wrong phone number | Authenticated user | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Linking spoofed `authUid` | Authenticated user | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Linking with extra modified fields (`name`, etc.) | Authenticated user | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Re-linking an already-linked player | Authenticated user | Denied | Denied (`PERMISSION_DENIED`) | PASS |
| Linking a disabled or merged player | Authenticated user | Denied | Denied (`PERMISSION_DENIED`) | PASS |

---

## 7. Production Smoke & Regression Results

Full local verification battery executed:
1. **Full Firebase Emulator Suite (`npm run test:emulator`):**
   - **Suites:** 10 suites executed.
   - **Tests:** 69 total tests executed.
   - **Passed:** 69 passed.
   - **Failed:** 0 failed.
   - **Skipped:** 0 skipped.
2. **Functional Test Suite (`npm run test:functional`):**
   - **Suites:** 64 suites.
   - **Tests:** 253 total tests executed.
   - **Passed:** 253 passed.
   - **Failed:** 0 failed.
3. **TypeScript Compilation (`npx tsc --noEmit`):**
   - Exited with code `0` (clean, zero type errors).
4. **ESLint (`npm run lint`):**
   - Exited with code `0` (zero errors, 4 expected security-rules warning notices on public matches/config).
5. **Standalone Production Smoke Suite (`npm run test:e2e:prod`):**
   - Next.js production build (`NODE_ENV=production next build`): Successful.
   - Standalone artifact preparation: Successful (`.next/standalone`).
   - Standalone web server launch on port 3005: Successful.
   - Playwright production smoke tests (`e2e/production-smoke.spec.ts`): 4/4 passed (Desktop Chrome & Mobile Safari).

---

## 8. Limitations & Independence Disclaimer

- **Testing Environment:** Tests were executed in the local Firebase Firestore Emulator and local standalone production environment. Zero production database writes occurred.
- **Review Status:** In compliance with `AGENTS.md` Section 2, the implementation engineer does **NOT** self-certify this work. This report presents evidence for independent review (ChatGPT / Independent Antigravity QA session) and subsequent product owner acceptance.

---

## 9. Traceability & Decision Alignment

| Source Requirement | Implementation Evidence | Test Evidence | Verdict |
|---|---|---|---|
| Restrict `otherFees` collection-group to Finance & Super Admin | `firestore.rules:331-333` | `tests/remediation1-firestore-auth.emulator.test.mjs:220-323` | **Remediated & Verified** |
| Player self-update changed-field allowlist | `firestore.rules:483-494` | `tests/remediation1-firestore-auth.emulator.test.mjs:325-470` | **Remediated & Verified** |
| Field bounds & type validations on player update | `firestore.rules:152-171` | `tests/remediation1-firestore-auth.emulator.test.mjs:445-470` | **Remediated & Verified** |
| Prevent privilege escalation on `inviteStatus` | `firestore.rules:169` | `tests/remediation1-firestore-auth.emulator.test.mjs:374-405` | **Remediated & Verified** |
| Protect identity & account linking on player doc | `firestore.rules:495-508` | `tests/remediation1-firestore-auth.emulator.test.mjs:475-555` | **Remediated & Verified** |
| Prevent AST limit overflow in rules engine | `firestore.rules:43-69` | `tests/remediation1-firestore-auth.emulator.test.mjs` (all 17 pass) | **Remediated & Verified** |

---

## 10. Recommended Next Action

1. Review and verify the commit diff on `firestore.rules` and `tests/remediation1-firestore-auth.emulator.test.mjs`.
2. Commit and push the changes to branch `mig-mov`.
3. Submit evidence to the independent reviewer for formal sign-off.
