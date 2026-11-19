# KAvach Play — Core Foundation Audit
## Document 04: Business Workflow Audit & State Transition Engine

**Document Type:** Business Logic & Operational Workflow Audit  
**Status:** Approved Audit Baseline  
**Date:** November 2026  
**Application:** https://play.kavachcricket.com  
**Authoritative References:** `lib/types.ts`, `hooks/useStore.ts`, `app/api/*`, `AGENTS.md`

---

## 1. Executive Summary

This document audits the 16 primary operational business workflows powering KAvach Cricket Club operations. Each workflow is analyzed by trigger, participating actors, preconditions, step-by-step state transitions, affected Firestore documents, failure modes, and mobile/pitch-side edge cases.

---

## 2. Core Business Workflow Audit

### Workflow 1: Player Registration & Profile Onboarding
- **Trigger:** New user visits application and signs up via Phone OTP or Email/Password.
- **Actors:** Prospective Player, Club Admin.
- **Preconditions:** User has authenticated with Firebase Auth (`auth.uid` exists).
- **State Transitions:**
  1. User authenticates -> Firebase Auth creates user record.
  2. System checks `appUsers/{uid}`: Not found.
  3. User redirected to `RegistrationForm.tsx` (enters full name, mobile, batting/bowling style, jersey number, DOB).
  4. Client creates `appUsers/{uid}` with `role: 'player'`, `status: 'pending_approval'`.
  5. User views `PendingApprovalScreen.tsx`.
  6. Club Admin visits Admin Overview -> approves registration.
  7. System sets `appUsers/{uid}.status = 'active'` and creates linked `players/{playerId}` profile.
- **Documents Mutated:** `appUsers/{uid}` (create/update), `players/{playerId}` (create).
- **Failure Modes:** User closes browser halfway; orphaned `appUsers` document without linked `playerId`.

---

### Workflow 2: Account Linking (Auth UID to Player ID)
- **Trigger:** Existing club player (created manually by admin) signs up with their mobile number for the first time.
- **Actors:** Unlinked Player, Super Admin / System.
- **Preconditions:** `players/{playerId}` exists with mobile matching authenticated user's phone.
- **State Transitions:**
  1. Authenticated user has `appUsers/{uid}.playerId == null`.
  2. System queries `players` where `mobile == auth.user.phoneNumber`.
  3. Candidate match found -> Prompts user: "Link to your existing player profile?".
  4. User confirms -> Transaction writes `appUsers/{uid}.playerId = candidatePlayerId` and updates `players/{candidatePlayerId}.authUid = uid`.
- **Documents Mutated:** `appUsers/{uid}`, `players/{playerId}`.
- **Failure Modes:** Phone number format mismatch (e.g., `+91` prefix vs 10-digit raw number); duplicate players sharing a phone number.

---

### Workflow 3: Match Creation & Scheduling
- **Trigger:** Match Admin schedules upcoming club fixture.
- **Actors:** Match Admin.
- **Preconditions:** Match Admin role active; grounds and tournament records configured.
- **State Transitions:**
  1. Match Admin opens Match Centre -> "Schedule New Match".
  2. Selects Ground, Opponent, Date/Time, Format (T20/40 Overs), Match Fee (e.g., ₹600), Reporting Time.
  3. Submits form -> Writes new document to `matches/{matchId}` with `status: 'scheduled'`, `isBillable: true`.
  4. Availability roster initialized: `matches/{matchId}/availability/{playerId}` records created or left for lazy initialization.
  5. Automated notification dispatched via `/api/send-match-reminders`.
- **Documents Mutated:** `matches/{matchId}` (create).
- **Failure Modes:** Conflict in ground booking times; notification failure over external WhatsApp/Email API.

---

### Workflow 4: Player Availability / RSVP Response
- **Trigger:** Player receives fixture announcement or visits Matches tab.
- **Actors:** Playing Member.
- **Preconditions:** Player is active and linked to `players/{playerId}`; match is in `scheduled` state.
- **State Transitions:**
  1. Player navigates to Matches tab -> Views upcoming fixture card.
  2. Taps RSVP button: `Available`, `Tentative`, or `PNA` (Playing Not Available).
  3. Client updates or creates subcollection document `matches/{matchId}/availability/{playerId}` with `status`, `timestamp`, `note`.
  4. Match Admin view reflects live availability tally in real-time.
- **Documents Mutated:** `matches/{matchId}/availability/{playerId}` (write).
- **Failure Modes:** Poor mobile connectivity at pitch-side prevents Firestore write; optimistic UI reverts on network failure.

---

### Workflow 5: Squad Selection & Playing XI Announcement
- **Trigger:** Match Admin finalizes team sheet 24–48 hours prior to match.
- **Actors:** Match Admin.
- **Preconditions:** Sufficient players responded `Available`.
- **State Transitions:**
  1. Match Admin opens Match Centre -> "Squad Selection".
  2. Selects 11 Playing XI players and up to 4 reserves from available pool.
  3. Assigns Captain and Wicketkeeper flags.
  4. Clicks "Publish Squad" -> Updates `matches/{matchId}` with `squad: string[]`, `status: 'squad_announced'`.
  5. Automated alert broadcast to selected players.
- **Documents Mutated:** `matches/{matchId}` (update).
- **Failure Modes:** Admin accidentally selects player who marked `PNA`; last-minute withdrawal requires manual roster unlock.

---

### Workflow 6: Pitch-Side Cash Fee Collection
- **Trigger:** Match Admin collects physical cash or direct UPI from player at the ground on matchday.
- **Actors:** Match Admin, Player.
- **Preconditions:** Player is in match Playing XI; match status is `squad_announced`, `live`, or `completed`.
- **State Transitions:**
  1. Match Admin opens Match Centre -> Match Sheet -> Player Row.
  2. Taps "Mark Cash Collected" (₹600).
  3. System creates `matches/{matchId}/payments/{paymentId}`:
     - `playerId`: Player ID
     - `amount`: 600
     - `status`: 'Paid'
     - `method`: 'cash_collected'
     - `recordedBy`: Admin UID
     - `recordedAt`: Current timestamp
  4. Player's dues calculation instantly subtracts ₹600 from outstanding ledger.
- **Documents Mutated:** `matches/{matchId}/payments/{paymentId}` (create).
- **Failure Modes:** Weak network connectivity at remote grounds causes duplicate taps; lack of idempotent payment ID could produce duplicate payment docs.

---

### Workflow 7: Online Match Fee Payment (Razorpay)
- **Trigger:** Player visits Payments tab to settle outstanding match dues digitally.
- **Actors:** Player, Razorpay Gateway, Webhook Handler.
- **Preconditions:** Player has unsettled match obligation; Razorpay API credentials active.
- **State Transitions:**
  1. Player clicks "Pay Now" on match fee card.
  2. Client calls `POST /api/razorpay/order` with `matchId`, `playerId`.
  3. Server validates authoritative payable amount from match config; creates Razorpay Order; writes `paymentIntents/{intentId}` with `status: 'created'`.
  4. Client opens Razorpay Checkout modal; user completes UPI/Card payment.
  5. Razorpay dispatches `payment.captured` webhook to `/api/razorpay/webhook`.
  6. Server verifies HMAC-SHA256 signature; confirms amount and currency match intent.
  7. Server transaction creates `matches/{matchId}/payments/{paymentId}` with `method: 'razorpay'`, `razorpayPaymentId`, `status: 'Paid'`, and marks intent `completed`.
  8. Client dues listener updates UI to show settled status.
- **Documents Mutated:** `paymentIntents/{intentId}`, `matches/{matchId}/payments/{paymentId}`.
- **Failure Modes:** Webhook delayed; user closes browser before client callback; handled idempotently by server webhook verification.

---

### Workflow 8: Other / Ad-Hoc Fee Creation & Assignment
- **Trigger:** Finance Admin levies annual club dues, jersey fees, tournament registration, or late fines.
- **Actors:** Finance Admin.
- **Preconditions:** Finance Admin role active.
- **State Transitions:**
  1. Finance Admin visits Finance & Dues -> "Create Fee".
  2. Selects Fee Type (`annual_membership`, `merchandise`, `penalty`, `custom`), Amount, Due Date, Description.
  3. Selects target players (All Active, Specific Squad, or Individual Player).
  4. System batch-writes `players/{playerId}/otherFees/{feeId}` with `status: 'Pending'`, `amount`, `title`.
  5. Player balance recalculates to include new fee.
- **Documents Mutated:** `players/{playerId}/otherFees/{feeId}` (batch create).
- **Failure Modes:** Firestore 500-write batch limit if roster exceeds 500 players; requires chunked batch writes.

---

### Workflow 9: Match Abandonment Fee Waiver (Approved Option A)
- **Trigger:** Match called off due to rain, unplayable ground, or opposition forfeit.
- **Actors:** Match Admin / Super Admin.
- **Preconditions:** Match exists; obligations or collections may have been initiated.
- **State Transitions:**
  1. Admin sets `matches/{matchId}.status = 'abandoned'`.
  2. System triggers Option A waiver reconciliation:
     - For all players with unpaid match obligations: writes `matches/{matchId}/payments/{paymentId}` with `status: 'waived'`, `method: 'abandoned_waiver'`, `amount: 0`.
     - For players who already paid via cash or Razorpay: payment record is PRESERVED (no deletion); amount remains in historical cash collected.
     - Refund/credit workflow remains a separate authorized action.
  3. Player dues calculation excludes abandoned match from outstanding balance.
- **Documents Mutated:** `matches/{matchId}` (update), `matches/{matchId}/payments/{paymentId}` (create/update waiver docs).
- **Failure Modes:** Accidental trigger on match delayed by rain; reconciliation must be idempotent so re-running does not corrupt records.

---

### Workflow 10: Studio Membership Purchase & Pass Allocation
- **Trigger:** Player purchases monthly or multi-month indoor net training package.
- **Actors:** Player, Razorpay Gateway, Studio Admin.
- **Preconditions:** Active subscription plans configured in `subscriptionPlans`.
- **State Transitions:**
  1. Player visits Studio tab -> Selects plan (e.g., 3-Month Plan, 24 Passes, ₹4,500).
  2. Calls `/api/studio/purchase-plan` -> Razorpay order generated.
  3. Payment completed -> Webhook verifies payment and writes `subscriptionHistory/{subId}`:
     - `playerId`: Player ID
     - `planId`: Plan ID
     - `passesTotal`: 24
     - `passesRemaining`: 24
     - `expiresAt`: Current date + 90 days
     - `status`: 'active'
  4. Player's active pass tally in `StudioTab.tsx` updates immediately.
- **Documents Mutated:** `subscriptionHistory/{subId}` (create).
- **Failure Modes:** Plan expires while passes remain; system must enforce expiration date strictly.

---

### Workflow 11: Studio Session Check-In & Pass Deduction
- **Trigger:** Player arrives at indoor facility for practice net session.
- **Actors:** Player, Studio Admin.
- **Preconditions:** Player holds active subscription with `passesRemaining > 0`.
- **State Transitions:**
  1. Player presents personal Studio QR code from `StudioTab.tsx`.
  2. Studio Admin scans QR via `StudioAdminTab.tsx` camera scanner (or inputs Player ID manually).
  3. Client calls `/api/studio/checkin` with `playerId`.
  4. Server transaction:
     - Locates oldest unexpired active plan in `subscriptionHistory` with `passesRemaining > 0`.
     - Decrements `passesRemaining` by 1.
     - Logs check-in document in `studioCheckins/{checkinId}`.
  5. Scanner emits audio chime and displays green pass confirmation.
- **Documents Mutated:** `subscriptionHistory/{subId}` (update), `studioCheckins/{checkinId}` (create).
- **Failure Modes:** Zero remaining passes; camera permission denied on admin device.

---

### Workflow 12: Merchandise Order Placement & Fulfillment
- **Trigger:** Player orders club gear (jersey, kit bag) via Shop tab.
- **Actors:** Player, Club Admin, Razorpay.
- **Preconditions:** Item in stock in `merchandise/{itemId}`.
- **State Transitions:**
  1. Player selects size, custom jersey name/number -> Taps "Order & Pay".
  2. Order created in `merchOrders/{orderId}` with `status: 'payment_pending'`.
  3. Razorpay payment captured -> Order updated to `status: 'paid'`, `paymentRef: razorpayPaymentId`.
  4. Club Admin views Admin Ops -> Merch Orders -> Marks order `in_production` -> Marks `delivered`.
- **Documents Mutated:** `merchOrders/{orderId}`.
- **Failure Modes:** Custom jersey name submitted with inappropriate text; size out of stock during payment processing.

---

### Workflow 13: Poll Creation & Member Voting
- **Trigger:** Executive committee seeks player opinion on club matters (e.g., tournament entry, tour dates).
- **Actors:** Club Admin, Players.
- **Preconditions:** Club Admin role active.
- **State Transitions:**
  1. Admin visits Opinion tab -> "Create Poll".
  2. Enters question, choices, multi-choice toggle, expiration date.
  3. Writes `polls/{pollId}` with `status: 'active'`.
  4. Player visits Opinion tab -> Selects choice -> Submits vote.
  5. System writes `pollResponses/{responseId}` (keyed by `pollId_playerId` to prevent double voting).
  6. Real-time vote tally updates on poll card.
- **Documents Mutated:** `polls/{pollId}`, `pollResponses/{responseId}`.
- **Failure Modes:** Player attempts to alter vote after deadline; Firestore rules enforce `request.time < poll.expiresAt`.

---

### Workflow 14: Performance Stat Recording & Badge Award
- **Trigger:** Match scorecard uploaded or approved post-match.
- **Actors:** Match Admin / System.
- **Preconditions:** Match status is `completed`; batting/bowling figures recorded in scorecard.
- **State Transitions:**
  1. Match Admin finalizes scorecard in `matches/{matchId}`.
  2. System aggregates player performance:
     - Increments runs, wickets, catches, matches played in `playerStats/{playerId}`.
  3. Badge evaluator runs:
     - Checks milestone criteria (e.g., 50 wickets, 1,000 runs, 5-wicket haul).
     - If earned, writes `players/{playerId}/badges/{badgeId}`.
  4. Leaderboard rankings recalculate automatically.
- **Documents Mutated:** `matches/{matchId}`, `playerStats/{playerId}`, `players/{playerId}/badges/{badgeId}`.
- **Failure Modes:** Scorecard edited after submission; stats must be recalculated via idempotent delta.

---

### Workflow 15: Player Duplicate Detection & Merge Execution
- **Trigger:** Club Admin identifies duplicate player profiles (e.g., guest profile created before auth signup).
- **Actors:** Super Admin, Merge Worker (`/api/admin/merge-players`).
- **Preconditions:** Super Admin custom claim verified; Keeper and Loser player IDs identified.
- **State Transitions:**
  1. Admin opens Player Roster -> Duplicate Detection -> Selects Keeper and Loser.
  2. Admin runs Dry Run -> Endpoint returns validation report and count of records to migrate.
  3. Admin confirms Merge -> Transaction acquires exclusive lease and fencing token on both player records.
  4. Stage 1–3 migrations execute: reparents match payments, other fees, availability, attendance, and updates `appUsers.playerId`.
  5. Stage 4 completion: marks Loser `merged: true`, sets `mergedInto: keeperId`, releases locks.
- **Documents Mutated:** `players/{loserId}`, `players/{keeperId}`, `appUsers/{uid}`, child payment/fee documents, `mergeJobs/{jobId}`.
- **Failure Modes:** Concurrent merge job; residual payment written during migration; handled by monotonic fencing and OCC barrier checks.

---

### Workflow 16: Admin Role Assignment & Custom Claim Sync
- **Trigger:** Club President appoints new Match Admin or Finance Admin.
- **Actors:** Super Admin.
- **Preconditions:** Caller has `token.admin === true`.
- **State Transitions:**
  1. Super Admin opens Settings & Access -> Admin Permissions.
  2. Toggles capability flags for target user (e.g., `isFinanceAdmin: true`).
  3. System updates `appUsers/{targetUid}` with updated boolean flags.
  4. If Super Admin status is granted/revoked, calls `/api/admin/set-claim` to set `customUserClaims: { admin: true }`.
  5. Target user token refreshes on next API call or re-auth to receive updated claims.
- **Documents Mutated:** `appUsers/{targetUid}`, Firebase Auth user claims.
- **Failure Modes:** Target user does not refresh token; UI remains in previous role state until token refresh or logout/login.
