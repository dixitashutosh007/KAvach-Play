# KAVACH PLAY — Security & Financial Risk Register

**Phase**: 0 (Discovery & Verification)
**Date**: 2026-11-15
**Git SHA**: `f5739726e75a2e6594c7379bdbfc8a866c63f787`

---

## Critical Security Findings

### CRIT-01: Payment Status Authorization Privilege Escalation

| Field | Detail |
|-------|--------|
| **Severity** | P0 — CRITICAL |
| **Status** | CONFIRMED against current code |
| **Area** | Firestore Security Rules |
| **Files** | `firestore.rules` lines 436, 483 |
| **Business Impact** | Any signed-in user can mark any payment as "Paid" without admin rights or completing a Razorpay transaction |
| **Requires Decision** | No — clear security flaw |

**Technical Detail**:

`firestore.rules:483` — Match payments update rule:
```
allow update: if (isMatchAdmin() || isFinanceAdmin() || (isSignedIn() && isSelf(existing().playerId)) || (isSignedIn() && incoming().status == 'Paid'))
```

The fourth OR clause `(isSignedIn() && incoming().status == 'Paid')` has **no player ownership check**. Any authenticated user can set any payment document to "Paid".

`firestore.rules:436` — Other fees update rule:
```
allow update: if isAnyAdmin() || isSelf(playerId) || (isSignedIn() && incoming().status == 'Paid');
```

Same vulnerability on the `otherFees` subcollection.

**Exploit**: Any logged-in player can execute via browser console:
```javascript
await updateDoc(doc(db, "matches", "match_123", "payments", "payment_of_player_b"), {
  status: "Paid", paymentMethod: "razorpay", updatedAt: serverTimestamp()
});
```

**Recommended Fix**: Remove `|| (isSignedIn() && incoming().status == 'Paid')` from both lines. Restrict "Paid" writes to `isFinanceAdmin() || isMatchAdmin()`. Legitimate payments should only be marked "Paid" by the server-side Razorpay webhook using Firebase Admin SDK.

---

### CRIT-02: Payment Links Collection Unprotected Updates

| Field | Detail |
|-------|--------|
| **Severity** | P2 — HIGH (latent vulnerability) |
| **Status** | CONFIRMED (rule flaw) / PARTIALLY CONFIRMED (collection currently unused by application code) |
| **Area** | Firestore Security Rules |
| **File** | `firestore.rules` lines 234–238 |
| **Business Impact** | Any signed-in user can modify any document in `paymentLinks`. Low immediate risk (collection unused), high latent risk. |
| **Requires Decision** | No |

**Technical Detail**:

```
match /paymentLinks/{linkId} {
  allow read: if true;
  allow create: if isAnyAdmin();
  allow update: if isSignedIn();   // <-- No admin check, no schema validation
}
```

No schema validation function (`isValidPaymentLink`) exists. No field immutability checks. A `grep` for `paymentLinks` across `app/`, `components/`, `hooks/`, `lib/` returns zero write operations — the collection is not used by current application code.

**Recommended Fix**: Change line 237 to:
```
allow create, update, delete: if isFinanceAdmin() || isSuperAdmin();
```

---

### CRIT-03: Payment Data Exposure via Collection Group Queries

| Field | Detail |
|-------|--------|
| **Severity** | P1 — HIGH |
| **Status** | CONFIRMED |
| **Area** | Data Privacy & Cost |
| **Files** | `hooks/useStore.ts` lines 486–499 (payments), 835–849 (otherFees); `firestore.rules` lines 275–281 |
| **Business Impact** | Every player's browser receives the entire club's financial history (~3,000+ docs). Privacy violation + Firestore cost explosion (~300,000 reads per weekend with 100 active users). |
| **Requires Decision** | No |

**Technical Detail**:

`hooks/useStore.ts:486–499`:
```typescript
const ensurePayments = useCallback(() => {
  if (!user || lazySubsRef.current.has("allPayments")) return;
  const unsub = onSnapshot(
    collectionGroup(db, "payments"),  // Unbounded — fetches ALL payments across ALL matches
    ...
  );
});
```

`hooks/useStore.ts:835–849`:
```typescript
const ensureOtherFees = useCallback(() => {
  if (!user || lazySubsRef.current.has("allOtherFees")) return;
  const unsub = onSnapshot(
    collectionGroup(db, "otherFees"),  // Unbounded — fetches ALL other fees across ALL players
    ...
  );
});
```

`firestore.rules:275–281`:
```
match /{path=**}/payments/{paymentId} {
  allow read: if isSignedIn();
}
match /{path=**}/otherFees/{feeId} {
  allow read: if isSignedIn();
}
```

Both collection group queries are triggered on login via `app/page.tsx` when `activeTab` includes "home" (which is the default).

**Data exposed to every player in browser memory**:
- Full names, guest names, player IDs
- Exact fee overrides (who got discounts)
- Who owes money (status: "Unpaid") across every historical match
- Club-sponsored subsidies and member sponsorships
- Disciplinary fines, late fees, custom fee comments

**Recommended Fix**:
- Non-admin players: `query(collectionGroup(db, "payments"), where("playerId", "==", user.uid))`
- Admin tabs: Use match-scoped queries `collection(db, "matches", matchId, "payments")`

---

## Critical Financial Findings

### CRIT-04: Abandoned Match Billing Discrepancy

| Field | Detail |
|-------|--------|
| **Severity** | P0 — CRITICAL |
| **Status** | CONFIRMED |
| **Area** | Financial Logic |
| **Files** | `components/AdminDashboard.tsx` line 44, `components/FinanceTab.tsx` line 117, `app/pay/[playerId]/PayClient.tsx` line 23, `components/DuesAndRemindersTab.tsx` line 135 |
| **Business Impact** | Admin dashboard excludes abandoned matches from dues, but players are billed for them. Players receive payment demands for rained-out matches. |
| **Requires Decision** | **YES — Club policy decision required** |

**Technical Detail**:

`AdminDashboard.tsx:44` — Correctly filters:
```typescript
if (match && match.result !== "Abandoned" && match.fee) {
```

`FinanceTab.tsx:117–134` — Does NOT filter:
```typescript
myPayments.forEach((p) => {
  const match = store.matches.find((m) => m.id === p.matchId);
  if (match) {  // NO check for match.result !== "Abandoned"
    unifiedDues.push({ ... amount: p.feeOverride !== undefined ? p.feeOverride : match.fee ... });
  }
});
```

`PayClient.tsx:23–25` — Does NOT filter:
```typescript
const pendingDuesCount =
  store.payments.filter((p) => p.playerId === playerId && p.status === "Unpaid").length +
  store.otherFees.filter((f) => f.playerId === playerId && f.status === "Unpaid").length;
```

`DuesAndRemindersTab.tsx:135–148` — Does NOT filter:
```typescript
store.payments.filter((pay: any) => pay.playerId === p.id && pay.status === "Unpaid").forEach((pay: any) => {
  const m = store.matches.find((mx: any) => mx.id === pay.matchId);
  if(m) {  // NO check for match.result !== "Abandoned"
    allDues.push({ amount: pay.feeOverride ... });
  }
});
```

**Business Decision Required**:
- **Option A (Standard)**: Abandoned matches are never billed; all payment records voided/waived.
- **Option B (Shared Loss)**: If club incurs sunk ground costs, players are charged a reduced fee.
- Product owner must confirm.

**Recommended Fix (after policy decision)**: Create shared helper:
```typescript
export function isMatchBillable(match: Match): boolean {
  return match.result !== "Abandoned" && (match.fee > 0 || match.matchFeeBudget > 0);
}
```
Apply consistently across all four files.

---

### FIN-01: Guest Player Overrides vs Gross Match Value

| Field | Detail |
|-------|--------|
| **Severity** | P2 — MEDIUM |
| **Status** | CONFIRMED |
| **Area** | Financial Logic |
| **File** | `components/MatchesTab.tsx` lines 1569, 1620 |
| **Requires Decision** | No |

**Technical Detail**:

```typescript
const grossValue = playing.length * match.fee;  // Line 1569
...
const isBalanced = totalAccounted === grossValue;  // Line 1620
```

If base fee is ₹800 and a guest is charged ₹1,000 via `feeOverride`, `grossValue` = 12 × 800 = ₹9,600, but `totalAccounted` = ₹9,800. `isBalanced` evaluates to `false`, showing a false "Discrepancy" warning.

**Fix**: Calculate `grossValue` as the sum of effective fees: `playing.reduce((sum, p) => sum + getPlayerFee(p), 0)`.

---

### FIN-02: Club-Sponsored Payments Inflate Liquid Collections

| Field | Detail |
|-------|--------|
| **Severity** | P2 — MEDIUM |
| **Status** | CONFIRMED |
| **Area** | Financial Reporting |
| **File** | `components/FinanceTab.tsx` lines 1175, 1245, 1262 |
| **Requires Decision** | No |

**Technical Detail**:

- Line 1175: `feeCollected` correctly treats `club_sponsored` as ₹0 direct money.
- Line 1245: `totalCollected` sums `getFee(p)` for ALL paid players, including club_sponsored.
- Line 1262: `grandTotalCollected` aggregates `totalCollected`, inflating reported cash with non-cash subsidies.

**Fix**: Use `feeCollected` (actual liquid collections) instead of `totalCollected` in grand totals.

---

### FIN-03: Interrupted Mobile Workflows & Late Fee Loss

| Field | Detail |
|-------|--------|
| **Severity** | P1 — HIGH |
| **Status** | **FIXED** — Phase 7 |
| **Area** | Payment Reliability |
| **Files** | `components/FinanceTab.tsx`, `components/MatchesTab.tsx`, `app/api/razorpay/webhook/route.ts` |
| **Requires Decision** | No |

**Technical Detail**:

1. Dynamic late fees are computed in the browser via `computeLateFees`.
2. ~~The `otherFees` document is created inside the browser's Razorpay success callback (`store.addOtherFee` at line 333).~~
3. ~~The server-side webhook receives the payment but the late fee document doesn't exist yet, so the webhook's update fails silently.~~
4. ~~If a mobile user pays and navigates away before line 333 completes, Razorpay collects the money but no fee record is written to Firestore.~~

**Fix Applied (Phase 7)**: Late fee metadata (label, amount, templateId) is now included in the Razorpay order intent data. The server-side webhook creates the otherFees documents and marks them as "Paid" — eliminating the client-side creation dependency. Admin manual-payment flows retain client-side creation with a duplicate guard.

---

## Risk Summary Matrix

| ID | Severity | Area | Fix Complexity | Decision Required? | Remediation Status |
|----|----------|------|---------------|-------------------|--------------------|
| CRIT-01 | P0 | Security | Low (15 min) | No | **FIXED** (Phase 1 & Phase 5) |
| CRIT-04 | P0 | Finance | Low (30 min) | **YES** | **FIXED** (Option A, Phase 1 & 5) |
| CRIT-03 | P1 | Privacy/Cost | Medium (2 hours) | No | **FIXED** (Phase 2) |
| FIN-03 | P1 | Payments | Medium (3 hours) | No | **FIXED** (Phase 5) |
| CRIT-02 | P2 | Security | Low (10 min) | No | **FIXED** (Phase 1) |
| FIN-01 | P2 | Finance | Low (20 min) | No | **FIXED** (Phase 1) |
| FIN-02 | P2 | Finance | Low (20 min) | No | **FIXED** (Phase 1) |
| SEC-001 | P0 | Auth/RBAC | High | **D-08** | **FIXED** (Phase 5: Granular Server RBAC + fail-closed store) |
| SEC-002 | P0 | Payments | High | No | **FIXED** (Phase 5: Server-only 'Paid' status transitions) |
| SEC-003 | P1 | Financial | High | No | **FIXED** (Phase 5: Authoritative server fee calculations) |
| FIN-001 | P0 | Orders | High | No | **FIXED** (Phase 5: Server-derived Razorpay amounts & currency) |
| FIN-002 | P1 | Webhook | High | No | **FIXED** (Phase 5: Atomic Firestore transaction + replay guards) |
| FIN-003 | P1 | Webhook | Medium | No | **FIXED** (Phase 5: Strict signature, amount, currency & order validation) |
| IDT-001 | P1 | Identity | High | **D-02** | **FIXED** (Phase 5: Positive link ownership, no UID===playerId fallback) |
| SUB-001 | P0 (proposed; owner has not reclassified) | Webhook / Studio subscriptions | Low | Owner | **OPEN** — reproduced 2026-11-23 on emulator. First Studio subscription (no prior expiry) throws in `lib/razorpay-webhook.ts:476` (`oldExpiryDate: undefined`); webhook returns 400 on every retry; intent stays pending; membership not applied. Evidence: `docs/qa/player-nav-persona/P0_VERIFICATION.md` §4. Remediation deferred to a separate workstream (D-17). |
| IDT-003 | P0 per Phase 5/6 audit §9; P2 per AGENTS.md §5 (unresolved) | Identity / Subscriptions | Medium | Owner | **OPEN** — reproduced 2026-11-23 on emulator. Subscription intents store only `userId: authUid` (`lib/razorpay-order.ts:1531-1555`); webhook resolves `players/{authUid}` (`lib/razorpay-webhook.ts:275-283, 452-455`), so players whose playerId differs from their UID are not credited. Evidence: `docs/qa/player-nav-persona/P0_VERIFICATION.md` §4. Remediation deferred to a separate workstream (D-17). |

> **D-17 (2026-11-23):** The product owner authorised Player navigation UX work (D-16) to proceed while SUB-001 and IDT-003 remain OPEN. This is a sequencing decision only. It is **not** a security clearance, does not change either finding's severity, and does not confirm that production is unaffected (the production deployment commit has not been verified).

