# KAvach Play — Security & Access Architecture

**Document:** Engineering Handover — Security, Authorization, and Identity Governance  
**Status:** Living Engineering Record (Reconciled & Validated)  
**Target Audience:** Security Engineers, Independent Auditors, Backend Engineers  
**Authoritative Code References:** `firestore.rules`, `lib/server-auth.ts`, `lib/account-linking.ts`, `lib/player-merge.ts`, `lib/database-config.ts`  

---

## 1. Role-Based Access Control (RBAC) Architecture

KAvach Play implements a least-privilege Role-Based Access Control model. Administrative authority is granted via verified server claims and authoritative database records, never by client assertions.

### Active Roles vs Target Consolidation (OPEN OWNER DECISION — OD-04)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    Approved Target Role Model (Owner Directive)            │
│                                                                            │
│  1. Super Admin   - Governed strictly by Auth Custom Claim { admin: true } │
│  2. Club Admin    - Consolidated authority: players, matches, grounds,     │
│                     studio, shop, design, operations.                      │
│  3. Finance Admin - Financial obligations, offline cash, reports, dues.    │
│                                                                            │
│  (Match Admin, Studio Admin, and Designer consolidated into Club Admin)    │
└────────────────────────────────────────────────────────────────────────────┘
                                      vs
┌────────────────────────────────────────────────────────────────────────────┐
│                    Current Repository Implementation                       │
│                                                                            │
│  The codebase currently enforces 6 granular roles:                         │
│  - Super Admin, Club Admin, Match Admin, Finance Admin, Studio Admin,      │
│    and Designer.                                                           │
│  - Refactoring rules and code to the 3-role model is pending (OD-04).      │
└────────────────────────────────────────────────────────────────────────────┘
```

### Detailed Capability Matrix (Current Implementation & Target Mapping)

| Role | Current Authority Source | Current Scope & Enforcement | Target 3-Role Mapping |
|---|---|---|---|
| **Super Admin** | Firebase Auth Custom Claim (`admin: true`) | Full platform governance, system configuration, destructive merges, KAvach ID generation. | **Retained as Super Admin** |
| **Club Admin** | `/appUsers/{uid}.isClubAdmin == true` or Custom Claim | Player roster management, member onboarding approvals, player merges, ground administration, tournament coordination. | **Retained as Club Admin** (absorbs Match Admin, Studio Admin, Designer) |
| **Finance Admin** | `/appUsers/{uid}.isFinanceAdmin == true` or Custom Claim | Manage fee templates, issue manual fees, record offline cash/UPI collections, reconcile abandoned matches, view grand totals. | **Retained as Finance Admin** |
| **Match Admin** | `/appUsers/{uid}.isMatchAdmin == true` or Custom Claim | Gated in `firestore.rules` (grounds, tournaments, matches) and `lib/server-auth.ts` (`requireMatchAdmin`). | *To be consolidated into Club Admin* |
| **Studio Admin** | `/appUsers/{uid}.isStudioAdmin == true` or Custom Claim | Gated in `firestore.rules` and `lib/server-auth.ts` (`requireStudioAdmin`). | *To be consolidated into Club Admin* |
| **Designer** | `/appUsers/{uid}.isDesigner == true` or `canDesign == true` | Gated in UI and `MoreDrawer.tsx`. | *To be consolidated into Club Admin* |
| **Player (Standard)** | Signed-in User (`request.auth.uid`) | View fixtures, submit availability, view personal dues, pay via Razorpay, update personal cricket profile. | **Retained as Player** |

---

## 2. Remediation of Critical Vulnerabilities (SEC-001 through SEC-006)

An independent retrospective audit of earlier codebase snapshots revealed material security vulnerabilities. These have been remediated and verified:

### SEC-001 (P0): Privilege Escalation Elimination
- **Vulnerability:** Users could update their own `/appUsers/{uid}` document, while server-side guards and `isSuperAdmin()` trusted `appUsers.role == 'admin'`. A standard user could set `role: "admin"` on their own account and assume super-admin authority.
- **Remediation:**
  1. `isSuperAdmin()` in [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L35-L41) was decoupled completely from `appUsers.role` and bound strictly to the cryptographically signed Firebase Auth token: `request.auth.token.get('admin', false) == true`.
  2. In `lib/server-auth.ts`, `requireSuperAdmin()` enforces custom claim verification (`decodedToken.admin === true`).
  3. In `firestore.rules`, updates to `/appUsers/{userId}` explicitly reject client modifications to `role`, `isSuperAdmin`, `isClubAdmin`, `isMatchAdmin`, `isFinanceAdmin`, `isStudioAdmin`, `isDesigner`, `status`, or `playerId`.
- **Verified In:** Commit `246712a` (Phase 5 baseline) and `5b504c6`. Tested in `tests/server-auth.test.mjs` and `tests/remediation1-firestore-auth.emulator.test.mjs`.

### SEC-002 (P0): Payment Status Self-Marking Elimination
- **Vulnerability:** Players could self-update `/matches/{matchId}/payments/{paymentId}` while the rule accepted status `'Paid'`, allowing players to self-mark match fees as paid without payment.
- **Remediation:**
  1. In [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L577-L602), player self-updates are strictly confined to:
     - Field allowlist: `['availability', 'tacticalNote', 'availabilityNote', 'status', 'updatedAt']`.
     - Status constraint: Transition permitted **only** between `'Unpaid'` and `'Not Playing'` (`(incoming().status in ['Unpaid', 'Not Playing'] && existing().status in ['Unpaid', 'Not Playing'])`).
  2. Marking an obligation as `'Paid'` is permitted **only** by authorized administrators or via server-side Admin SDK transactions following Razorpay webhook verification.
- **Verified In:** Tested in `tests/phase6-match-rules.emulator.test.mjs` and `tests/razorpay-tamper.test.mjs`.

### SEC-003 & SEC-004 (P1): Financial Record Tampering & Data Exposure
- **Vulnerability:** Players could create or mutate `/players/{playerId}/otherFees/{feeId}` records, and broad nested reads exposed other players' financial ledgers.
- **Remediation:**
  1. [firestore.rules](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/firestore.rules#L518-L522) restricts `otherFees` mutations to `isFinanceAdmin() || isSuperAdmin()`.
  2. `otherFees` reads are restricted to Finance Admins, Super Admins, or the player themselves (`isSelf(playerId)`).
  3. Firestore collection-group queries are scoped to the authenticated player's ID for non-administrative users.
- **Verified In:** Tested in `tests/remediation1-firestore-auth.emulator.test.mjs`.

### SEC-005 & SEC-006 (P2): Post and Merchandise Integrity
- **Vulnerability:** Signed-in players could create or edit club announcements (`posts`) and manipulate merchandise pricing on orders (`merchOrders`).
- **Remediation:**
  1. `/posts/{postId}` writes are restricted exclusively to administrators (`isAnyAdmin()`).
  2. `/merchOrders/{orderId}` creation requires `paymentStatus: 'Unpaid'` and `orderStatus: 'Order Placed'`. Updates by players cannot alter `price`, `paymentStatus`, or `playerId`.
- **Verified In:** Tested in `tests/merchandise-validation.test.mjs`.

---

## 3. Firestore Rules Architecture (`firestore.rules`)

The security rules enforce defense-in-depth:
1. **Global Deny-All Baseline (Lines 5-7):**
   ```firestore-rules
   match /{document=**} {
     allow read, write: if false;
   }
   ```
2. **Account Status Verification (`isAccountActive`):**
   - Access is denied if `/appUsers/{uid}.status == 'Disabled'`.
3. **Player Self-Update Schema Enforcement (`isValidPlayerSelfUpdate`):**
   - Players can update only allowlisted profile attributes: `name`, `email`, `mobile`, `dob`, `locality`, `bloodGroup`, `emergencyContact`, `battingStyle`, `bowlingStyle`, `isWicketKeeper`, `chestSize`, `waistSize`, `jerseyNumber`, `jerseyName`, `photoURL`, `inviteStatus`, `updatedAt`.
   - Players **cannot** modify `authUid`, `mergedInto`, `mergeStatus`, or `mergeJobId`.
4. **Internal Identity Lockout:**
   - Collections `/phoneIndex/{phone}`, `/uidIndex/{uid}`, and `/mergeJobs/{jobId}` are completely closed to client requests:
     ```firestore-rules
     match /phoneIndex/{phone} { allow read, write: if false; }
     match /uidIndex/{uid}     { allow read, write: if false; }
     match /mergeJobs/{jobId}   { allow read, write: if false; }
     ```

---

## 4. Server-Side Authorization (`lib/server-auth.ts`)

All API routes enforce strict server-side authentication:

```typescript
// Token verification with revocation check
const decodedToken = await auth.verifyIdToken(token, true /* checkRevoked */);

// Account status verification: fail closed on disabled accounts or DB errors
const userDoc = await db.collection("appUsers").doc(decodedToken.uid).get();
if (userDoc.data()?.status === "Disabled") {
  return { ok: false, response: NextResponse.json({ error: "Account disabled." }, { status: 403 }) };
}
```

### Test Authentication Bypass Isolation
To support automated integration tests without exposing test headers to production:
- The helper `isTestAuthBypassAllowed()` in [lib/server-auth.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/server-auth.ts#L48-L54) strictly requires:
  1. `process.env.NODE_ENV === "test"`
  2. `process.env.KAVACH_TEST_AUTH_BYPASS === "true"`
  3. `process.env.NODE_ENV !== "production"`
- In production, test headers (`x-test-uid`, `x-test-role`) are ignored unconditionally, and authentication falls back to verified Firebase ID tokens.

---

## 5. Identity Linking & Concurrency-Safe Merges (Remediations 1A–1F-R)

To eliminate account collisions, identity hijacking, and concurrent merge corruption, the platform implements an authoritative identity pipeline:

### Canonical Phone & UID Indexing
- Phone numbers are normalized using `parseStrictIndianMobile()`:
  - Strips `+91`, `91`, leading `0`.
  - Enforces exactly 10 digits starting with `[6-9]`.
- Account linking atomically reserves:
  - `/phoneIndex/{canonicalPhone}`: `{ playerId, uid, linkedAt }`
  - `/uidIndex/{uid}`: `{ playerId, canonicalPhone, linkedAt }`

### Resilient Merge State Machine (`lib/player-merge.ts`)
Duplicate player profile merges (e.g. merging a guest or unlinked player into an active member) are orchestrated via a distributed state machine:
1. **Worker Lease & Fencing Tokens:**
   - Every merge operation acquires an exclusive lease on `/mergeJobs/{jobId}` with `leaseOwner`, `leaseToken`, `fencingToken`, and `leaseExpiresAt`.
   - Every subsequent chunk mutation verifies worker credentials and the monotonically increasing fencing token. Stale workers are blocked fail-closed.
2. **Dual Player Locks:**
   - Both `loser` and `keeper` profiles are locked with a 10-field invariant: `mergeStatus: "in_progress"`, `mergeJobId`, `mergeRole`, `lockedAt`, etc.
   - Any client write path encountering a locked player is immediately rejected (HTTP 409).
3. **Financial Record Collision Resolution:**
   - When merging subcollections (`payments`, `otherFees`), records are compared across 12 authoritative fields (amount, status, templateId, paymentMethod, razorpayPaymentId, etc.).
   - Contradictory alias records fail closed.
4. **Independent Verification Gate:**
   - Before completing a merge, an independent query audits the loser's subcollections to guarantee zero residual unmigrated documents exist.
- **Verified In:** Commit `5b504c6`. Tested via 114 emulator test scenarios in `tests/remediation1f-secure-merge-recovery-and-consistency.emulator.test.mjs`.

---

## 6. Payment Security & Environment Gating

1. **Development Branch Lockout:**
   - [lib/database-config.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/database-config.ts#L201-L233) evaluates `arePaymentOperationsEnabled()`.
   - On branch `mig-mov`, live Razorpay orders and webhook writes return HTTP 403 `PAYMENTS_DISABLED`.
2. **Authoritative Amount Derivation (FIN-001):**
   - In `app/api/razorpay/order/route.ts`, client-supplied `amount` is discarded.
   - The server calls `derivePayableAmount()` to calculate the exact obligation from Firestore match fees, fee overrides, and late fees.
3. **Webhook HMAC Signature Verification:**
   - `app/api/razorpay/webhook/route.ts` computes the HMAC-SHA256 signature over the raw request body using `RAZORPAY_WEBHOOK_SECRET` and verifies it using `crypto.timingSafeEqual` to prevent timing attacks.
4. **Payment Redirection for Merged Players:**
   - If an asynchronous Razorpay webhook arrives for a player who was merged, `processWebhookIntentTransaction()` automatically redirects the payment and receipt to the surviving keeper profile.
