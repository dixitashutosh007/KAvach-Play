# Match Management — financial data model and lifecycle

Status: design for the Match Management redesign on `mig-mov` (owner-approved
direction, 2026-11-23). Extends the existing model; no new collections, no
migration. All new fields are optional, so existing matches and payments stay
valid and read as "finance open, nothing recorded".

## 1. Existing model reused

| Concern | Existing source (unchanged) |
|---|---|
| Per-player fee, plan, sponsorship | `matches/{id}/payments/{pid}`: `feeOverride`, `feeOffsetAmount`, `feeCollectedAmount`, `manualMethod`, `planTag`, `sponsoredBy`/`sponsoring`, `financeSnapshot` |
| Plan application / overrides | `/api/finance/match-plans` (server, audited) |
| Razorpay collection | webhook (`lib/razorpay-webhook.ts`, Admin SDK): `status: Paid`, `paymentMethod: razorpay`, `razorpayPaymentId`, `feeCollectedAmount` |
| Cash collection | `store.updatePaymentStatus(..., "Paid", ..., "manual")` (client, rules-checked) |
| Abandoned matches | `/api/admin/reconcile-abandoned` (status `Waived`) |
| Squad removal | payment `status: "Not Playing"` (payments are never deleted) |
| Audit | `auditLogs` via `writeServerAudit` (server, in the same transaction) |

## 2. New fields

### Match document (server-only — written only by `/api/finance/match-ledger`)

| Field | Meaning |
|---|---|
| `groundFeePaidAmount` (existing) | Actual ground / vendor expense, ₹ |
| `isGroundFeePaid` (existing) | `true` once an amount is recorded |
| `groundFeeSetBy`, `groundFeeSetByName`, `groundFeeSetAt` | Last actor / time |
| `groundFeeHistory[]` | Append-only: `{ kind: "set" \| "correction" \| "adjustment", from, to, reason, by, byName, at }` |
| `financeStatus` | `"open"` (default when absent) or `"closed"` |
| `financeClosedAt`, `financeClosedBy`, `financeClosedByName` | Last close |
| `financeHistory[]` | Append-only: `{ action: "closed" \| "reopened", reason?, statement, by, byName, at }` — `statement` is the financial statement at that moment (traceable; never recalculated) |

### Payment document

| Field | Meaning |
|---|---|
| `reversals[]` | Append-only, server-only: `{ amount, method, reference, reason, removedFromSquad, original: { status, paymentMethod, manualMethod, feeCollectedAmount, feeOverride, razorpayPaymentId, manualBy }, resultStatus, by, byName, at }` |

A reversal **does not delete or overwrite** `razorpayPaymentId`,
`feeCollectedAmount` or `paymentMethod`; it changes `status` only and copies
the original transaction into `reversals[]`. (If the player later pays again,
the webhook writes the new transaction on the payment; the earlier one remains
in `reversals[]` and in `razorpayIntents`.)

## 3. Real money vs non-cash settlements

A payment is **real money collected** when: `status == "Paid"`, it is not
settled by `manualMethod` `club_sponsored` / `part_of_plan`, it is not paid by
another player (`sponsoredBy`), and its collected amount
(`feeCollectedAmount`, else `feeOverride`, else the match fee) is above ₹0.
Only these enter the refund / reversal workflow. Non-cash settlements are
changed through Finance Plans / overrides, never "refunded".

## 4. Financial statement (one shared pure function)

`buildMatchFinancialStatement` in `lib/match-finance.ts`, used by the squad
rows, the summary card, the Finance tab and the server (close snapshot):

- per payment (Not Playing / Waived excluded): `contribution` (player pays) and
  `sponsorship` (club pays);
- **System Match Fee** = Σ(contribution + sponsorship);
- **Club Sponsored** = Σ sponsorship; **Maximum Player Collection** = Σ contribution;
- **Collected** = Σ contribution of Paid rows; **Outstanding** = Σ contribution of
  other rows (so Collected + Outstanding = Maximum);
- **Actual Match Fee Paid** = `groundFeePaidAmount` (null → "Not recorded");
- **Net Match Result** = Maximum Player Collection − Actual Match Fee Paid
  (null when the actual fee is not recorded — never invented);
- **Current Cash Position** (secondary) = Collected − Actual Match Fee Paid.

Payment status never changes the net result. Subscription matches still
awaiting period close contribute ₹0 / ₹0 and are counted as "allocation
pending" (shown, not guessed).

## 5. Lifecycle transitions

### Match finance

```
open ──close (Finance/Super; actual fee recorded)──▶ closed
closed ──reopen (Finance/Super; reason required)──▶ open
```

| Action | Open | Closed |
|---|---|---|
| Set / correct actual ground fee | Finance/Super (reason required for a correction) | refused — use **adjustment** |
| Adjust actual ground fee | refused (use set) | Finance/Super, reason required |
| Apply Finance Plans / overrides / back to plan rule | as today | refused |
| Add players (new row or Not Playing → Unpaid) | as today | refused (UI + rules) |
| Remove an unpaid player | allowed (confirmation) | allowed (confirmation) |
| Remove a player with real money collected | only after reversal | only after reversal |
| Collect outstanding (cash / Razorpay) | allowed | allowed |
| Reverse a real payment | Finance/Super | Finance/Super |
| Change match fee / budget | as today | refused (rules) |
| Edit non-financial match info | as today | allowed |
| Delete match | as today | refused (rules) |

### Payment

```
Unpaid ──collect (cash / Razorpay webhook)──▶ Paid (real money)
Paid (real) ──reverse (Finance/Super: reason, amount = collected, method,
               reference / cash confirmation)──▶ Unpaid (stays in squad)
                                              └─▶ Not Playing (removed)
Unpaid ──remove (confirmation)──▶ Not Playing
Paid (club_sponsored / part_of_plan) ── only via Finance Plans / overrides
```

Reversal must refund the full collected amount (see gaps).

## 6. Authorisation and rules (repository only — not deployed)

- `/api/finance/match-ledger` (new, Admin SDK, transactional, audited):
  `setGroundFee`, `adjustGroundFee`, `closeFinance`, `reopenFinance`,
  `reversePayment` — Finance Admin / Super Admin only.
- `/api/finance/match-plans`: apply / override / clear refused while closed.
- `firestore.rules`:
  - **C1 (matches):** clients may not change the server-only fields in §2;
    while closed, clients may not change `fee` / `matchFeeBudget` or delete the
    match. All other match updates unchanged.
  - **C2 (payments):** no client (any role) may change `status`,
    `paymentMethod`, `manualMethod`, `feeCollectedAmount`, `razorpayPaymentId`
    or fee fields of a payment holding real money collected; nobody may write
    `reversals` or `financeSnapshot` from the client; while closed, no client
    may create payments, move Not Playing → Unpaid / Paid, or change fee
    fields. Availability / notes edits unchanged. Webhook and Admin SDK
    routes are unaffected (they bypass rules).

## 7. Gaps (reported, not worked around)

1. **Partial refunds** cannot be represented: payment status is Paid / Unpaid
   only. Reversal therefore requires the full collected amount.
2. **Razorpay refunds are not executed in-app** (no Razorpay operations); the
   reversal records a refund done in the Razorpay dashboard (reference = refund
   id) or a documented cash / UPI / bank return.
3. **Removing an unpaid player after close** is allowed (as approved) but does
   lower the expected player collection.
4. **Changing `result` to Abandoned after close** still runs the existing
   abandoned-match reconciliation (server route), which waives unpaid
   obligations; no new lock added.
5. Client-written `auditLogs` remain updatable by admins (existing gap); all
   new actions audit through the server.
