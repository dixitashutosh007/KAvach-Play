# KAvach Play — Core Foundation Audit
## Document 06: Finance Subsystem & Financial Data Integrity

**Document Type:** Financial Architecture & Integrity Audit  
**Status:** Revised Audit Baseline with Source-Level Evidence (Assignment 2)  
**Date:** November 2026  
**Application:** https://play.kavachcricket.com  
**Authoritative References:** `lib/player-dues.ts`, `lib/types.ts`, `hooks/useStore.ts`, `app/api/razorpay/*`, `app/api/admin/reconcile-abandoned/*`

---

## 1. Executive Summary

This document details the financial architecture of KAvach Play with verifiable source code references. It traces how dues are calculated across the application, establishes the current authoritative source of balances, audits Razorpay order and webhook lifecycles, inspects how partial payments and reversals are represented, documents the existing abandoned match implementation versus the approved Option A policy, and outlines a safe pitch-side cash recording UX.

---

## 2. Tracing `calculatePlayerDues` & Balance Derivation

### 2.1 Engine Definition (`lib/player-dues.ts:32-91`)
`calculatePlayerDues(myPlayers, payments, matches, otherFees)` is the shared, deterministic dues calculator.
- **Lines 55–57:** Filters match payments where `p.status === "Unpaid"` and `myPlayerIds.has(p.playerId)`.
- **Lines 60–68:** For each unpaid payment, locates the corresponding `Match` and verifies `isMatchBillable(match)`. If billable, charges `payment.feeOverride ?? match.fee`.
- **Lines 73–76:** Filters other fees where `f.status === "Unpaid"` and sums `f.amount`.
- **Lines 78–90:** Returns `{ totalDue, dueCount, hasDues, matchDue, otherFeeDue, billableMatchPayments, unpaidOtherFees }`.

### 2.2 Trace of Callers Across Codebase

1. **Desktop Sidebar Mini-Dues Widget (`app/page.tsx:811`):**
   ```typescript
   // app/page.tsx:811
   const duesSummary = calculatePlayerDues(
     myPlayers,
     store.payments,
     store.matches,
     store.otherFees
   );
   ```
   *Verified Behavior:* Computes dues in memory to display the player's outstanding balance in the left sidebar.
2. **Player Home Dues Hero Card (`components/HomeTab.tsx:196`):**
   ```typescript
   // components/HomeTab.tsx:196
   () => calculatePlayerDues(myPlayers, store.payments, store.matches, store.otherFees)
   ```
   *Verified Behavior:* Memoized calculation feeding the "Outstanding Balance" hero widget on the mobile Home screen.
3. **Automated Unit Tests (`tests/phase6-identity-dues.test.mjs:22, 235, 299, 331, 351, 378`):**
   Directly tests production logic for abandoned match exclusions, fee overrides, and multi-player dues.

### 2.3 Divergent Inline Calculation Defect (`components/DuesAndRemindersTab.tsx:695-775`)
- **Verified Behavior:** Rather than importing `calculatePlayerDues`, `DuesAndRemindersTab.tsx` implements an inline `getDues()` loop over all players.
- **Critical Discrepancy:** Lines 737–771 calculate **"virtual late fees"** dynamically on the fly (`computeLateFees`) and inject synthetic dues objects (`uid: latefee_${pay.id}_${idx}`) into the dues list.
- **Business Impact:** The dues total shown in the desktop sidebar (`app/page.tsx`) and Home screen (`HomeTab.tsx`) differs from the total shown in `DuesAndRemindersTab.tsx`! A player may see ₹600 on their Home card, but ₹850 in the Dues tab due to un-persisted virtual late fees.
- **Recommended Remediation (Phase 1):** Unify all dues displays around `calculatePlayerDues`. Late fees must be explicit, persisted records in `otherFees` rather than synthetic virtual items generated during rendering.

### 2.4 Authoritative Source of Financial Balances
- **Current Architecture:** There is **NO single authoritative balance ledger document** in Firestore.
- Balances are dynamically derived in client memory on every render by scanning all `matches`, all child `payments`, and all `otherFees`.
- **Architectural Risk:** If an in-flight network query drops or a payment record fails to load, the calculated balance changes abruptly, creating "phantom dues" or false zero balances.

---

## 3. Representation of Payments, Partials, Waivers & Reversals

In `lib/types.ts:325-355`, financial transactions on matches are represented as:

```typescript
export type ManualPaymentMethod = "cash_collected" | "club_sponsored" | "part_of_plan" | "deposited_directly";

export type MatchPayment = {
  id: string;
  matchId: string;
  playerId: string;
  status: "Paid" | "Unpaid" | "Not Playing" | "Failed" | "Waived";
  paymentMethod?: "razorpay" | "manual";
  razorpayPaymentId?: string;
  manualMethod?: ManualPaymentMethod;
  manualBy?: string;
  feeCollectedAmount?: number;
  feeOffsetAmount?: number;
  waivedReason?: string;
  waivedAt?: any;
  feeOverride?: number;
  updatedAt?: any;
};
```

### 3.1 Partial Payments Defect in Dues Logic
- **Verified Code:** In `lib/player-dues.ts:55-70`, `calculatePlayerDues` checks ONLY `p.status === "Unpaid"`. If true, it charges the full `payment.feeOverride ?? match.fee`.
- **Finding:** If a player has paid ₹300 toward a ₹600 match fee, and the admin records `feeCollectedAmount: 300` while keeping `status: "Unpaid"`, `calculatePlayerDues` **completely ignores `feeCollectedAmount`** and charges the full ₹600! Conversely, if `status` is set to `"Paid"`, the remaining ₹300 debt is wiped out.
- **Remediation Phase:** Phase 1 / Phase 2 (update `calculatePlayerDues` to charge `effectiveFee - (payment.feeCollectedAmount || 0)` when status is Unpaid).

### 3.2 Payment Reversal & Correction Architecture
- **Verified Code in `hooks/useStore.ts:1693-1728` (`updatePaymentStatus`):**
  When an admin changes a payment to `status: "Paid"`, it immediately calls `updateDoc(docRef, updateData)`.
- **Defect:** There is no dedicated **Reversal or Correction action**. If a Match Admin accidentally marks a player as paid at pitch-side, they must re-enter the edit dialog, manually select "Unpaid", clear the manual method, and save. There is no audit record of why the payment was reversed.

---

## 4. Pitch-Side Cash Recording UX Blueprint

Under approved decision **D-08**, Match Admins require a safe, pitch-side mobile cash logging capability.

### 4.1 Existing Implementation Bottlenecks
- In `components/MatchesTab.tsx:2950-2970` and `components/DuesAndRemindersTab.tsx:1000-1050`, recording cash requires navigating a multi-field modal, selecting payment method dropdowns, and manually entering amounts.
- On a mobile device at the boundary line, small tap targets (< 32px) and multi-step forms lead to operator errors and delay.

### 4.2 Recommended Safe Pitch-Side UX (Phase 1 Shared Component)
1. **Clear Player & Match Identification:** Modal/Drawer header prominently displays:
   - Match: Opponent name, date, venue.
   - Player: Player name, jersey number, photo, standard match fee (e.g., ₹600).
2. **Explicit Amount & Method Visibility:**
   - Pre-populated fee: ₹600 (or player's `customMatchFee`).
   - Prominent badge: `Payment Method: Cash Collected (Pitch-side)`.
3. **Two-Step Confirm with Visual Tactile Feedback:**
   - Single large primary button: `Confirm Cash Received (₹600)` with `min-h-[48px]`.
   - On tap: Immediate auditory click/vibration, spinner state, and transition to green checkmark.
4. **Duplicate-Action Prevention (Debounce & State Lock):**
   - Button immediately disables on first tap to prevent double-logging from rapid taps on pitch-side.
5. **Audit Metadata Capture:**
   - Payload automatically binds: `recordedBy: auth.uid`, `recordedByName: appUser.name`, `method: 'cash_collected'`, `recordedAt: serverTimestamp()`.
6. **Built-In Correction / Reversal Workflow:**
   - If marked in error, the payment card displays an "Undo / Correct Cash Entry" button for 15 minutes, prompting the admin for a mandatory reason (e.g., "Wrong player tapped", "Cash not handed over") and logging a reversal audit entry.

---

## 5. Abandoned Match Policy & Scenarios

### 5.1 Current Implementation Audit

| Component | Code Reference | Verified Behavior |
|---|---|---|
| **Dues Exclusion** | `lib/player-dues.ts:26, 63` | Checks `isMatchBillable(match)`. Excludes matches where `match.result === "Abandoned"`. |
| **Billability Check** | `lib/matchBillable.ts:4` | `return match.result !== "Abandoned" && (match.fee > 0 || ...)` |
| **Order Guard** | `lib/razorpay-order.ts:1306` | Checks `if (matchData.abandoned === true || matchData.status === "abandoned")` -> Throws error preventing payment order creation. |
| **Admin Reconcile** | `app/api/admin/reconcile-abandoned/route.ts:63, 71` | Endpoint queries `matches.where("result", "==", "Abandoned")`. Batch-updates unpaid payments to `status: 'Waived'`, `waivedReason: 'Match Abandoned'`. Preserves all paid payments without deletion. |

---

### 5.2 Scenario Comparison & Policy Status

| Scenario | Definition | Paid Fees Treatment | Unpaid Fees Treatment | Business Policy Status |
|---|---|---|---|---|
| **1. Abandoned Match (Option A)** | Match called off without a result (e.g. rain before start or unplayable pitch). | **PRESERVED:** Paid records remain intact in Firestore and count toward historical cash collected. Refunds/credits handled as a separate process. | **WAIVED:** Unpaid obligations are marked `Waived` (`waivedReason: "Match Abandoned"`) and excluded from dues. | **APPROVED POLICY (Option A)** |
| **2. Cancelled Match** | Match cancelled in advance by agreement or opposition forfeiture. | Currently NOT excluded by `lib/matchBillable.ts:4` unless `result === "Abandoned"`. | Currently treated as billable if `fee > 0`! | **REQUIRES PRODUCT-OWNER APPROVAL** *(Recommended: Waive unpaid obligations, preserve paid)* |
| **3. Postponed Match** | Match rescheduled to a future date. | Paid fees should roll over to the rescheduled match fixture. | Obligations deferred to new date. | **REQUIRES PRODUCT-OWNER APPROVAL** |
| **4. Partially Played Match** | Match started (e.g., 8 overs bowled) then stopped due to weather/light. | Ground fees, umpire costs, and balls were consumed. Does full fee, partial fee, or zero fee apply? | Currently either 100% billable or 100% waived if result marked Abandoned. | **REQUIRES PRODUCT-OWNER APPROVAL** |
