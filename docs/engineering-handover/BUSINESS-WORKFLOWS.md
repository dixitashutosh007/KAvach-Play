# KAvach Play — Business Workflows & Operational Specifications

**Document:** Engineering Handover — Business Workflows, Financial Integrity, and Operations  
**Status:** Living Engineering Record (Reconciled & Validated)  
**Target Audience:** Product Engineers, Domain Specialists, Independent Reviewers  
**Authoritative Code References:** `lib/match-eligibility.ts`, `lib/personal-match-payment.ts`, `lib/razorpay-order.ts`, `lib/razorpay-webhook.ts`, `app/api/admin/reconcile-abandoned/route.ts`  

---

## 1. Matches & Squad Management Workflow

KAvach Play separates player availability (RSVP) from authoritative squad selection and fee obligation creation.

```
                      MATCH LIFECYCLE STATE MACHINE
                      
  [1. FIXTURE CREATED] ----------> Managed by Club Admin (historically Match Admin)
           |
           v
  [2. FIXTURE OPEN] -------------> Players submit 1-Tap Availability
           |                       (availability: "Confirmed" | "Tentative" | "No")
           v                       (status remains "Not Playing" or unassigned)
  [3. SQUAD ANNOUNCED] ----------> Administrator assigns official Squad
           |                       (status transitions to "Unpaid")
           |                       (Fee obligation created; Squad list visible)
           v
  [4. MATCH LIVE / ONGOING] -----> Pitch-side scoring, catches logging
           |
           +--------------------------------+
           |                                |
           v                                v
  [5A. COMPLETED]                  [5B. ABANDONED (Rain / Washout)]
  - Scorecard recorded             - Approved Option A Policy Applied
  - Player of the Match awarded    - Unpaid fee obligations WAIVED
  - Career statistics compiled     - Cash collected preserved as history
                                   - Zero outstanding dues
```

### Key Workflow Rules

1. **Player Availability vs Squad Assignment (D-10 / Pass 3):**
   - **Player RSVP:** Expresses availability intent (`availability: "Confirmed" | "Tentative" | "No"`). Does **not** obligate match fees.
   - **Squad Assignment:** Administrative action performed by Club Admin (or Match Admin). Moves a player into the official playing squad, transitioning the subcollection record `matches/{matchId}/payments/{paymentId}` to `status: "Unpaid"`, which creates an authoritative fee obligation.
2. **Progressive Disclosure & Eligibility Gating (`validateMatchNavigation`):**
   - **Open Fixtures (No Squad Assigned):** All active, verified club members are eligible to view fixture details, pitch directions, match format, and submit availability.
   - **Closed Fixtures (Squad Announced):** Players outside the announced squad or waitlist see the fixture card with squad summary, but match tactical notes and payment sheets are restricted to squad members. Administrators retain full access across all fixtures.
3. **Abandoned Match Policy (Approved Option A):**
   - An abandoned fixture (rainout, ground cancellation) creates **zero player match fee obligation**.
   - Any unpaid match fee obligations are marked `status: "Waived"`, `waivedReason: "Match Abandoned"`.
   - **Never delete payment records:** Historical records are preserved for auditability.
   - Already-collected payments (paid prior to abandonment) remain intact as historical cash transactions; they are excluded from outstanding dues but tracked as collected club revenue.
   - Automated reconciliation endpoint: `POST /api/admin/reconcile-abandoned`.

---

## 2. Match Fees, Finance & Payment Reconciliation

The financial engine guarantees that all payable amounts are derived server-side from authoritative club rules, eliminating client manipulation (FIN-001).

```
                      RAZORPAY PAYMENT TRANSACTION FLOW
                      
   [Client Browser]                                      [KAvach Server / DB]
          |                                                       |
          | 1. POST /api/razorpay/order { intentData }            |
          |------------------------------------------------------>|
          |                                                       | 2. Check arePaymentOperationsEnabled()
          |                                                       |    (Disabled on mig-mov)
          |                                                       | 3. derivePayableAmount(db, uid, intent)
          |                                                       |    (Calculates fee from match/late fees)
          |                                                       | 4. acquirePaymentReservation()
          |                                                       |    (Locks reservation key with lease)
          |                                                       | 5. razorpay.orders.create()
          | 6. Return { orderId, amount, receipt }                |
          |<------------------------------------------------------|
          |
  [Razorpay Checkout Modal]
          |
          | 7. Player completes UPI / Netbanking / Card payment
          v
  [Razorpay Gateway] 
          |
          | 8. Webhook POST /api/razorpay/webhook (payment.captured)
          +------------------------------------------------------>|
                                                                  | 9. Verify HMAC-SHA256 signature
                                                                  | 10. processWebhookIntentTransaction()
                                                                  |     - Check idempotent alreadyProcessed
                                                                  |     - Resolve active player (redirect merge)
                                                                  |     - Write payment: status="Paid"
                                                                  |     - Release reservation lock
                                                                  | 11. Return HTTP 200 { success: true }
                                                                  |<--------------------------------------
```

### Fee Calculation Hierarchy (`lib/personal-match-payment.ts`)

For any match fixture, the net payable amount is evaluated deterministically:

$$\text{Net Payable} = \max(0, \text{Effective Match Fee} + \text{Late Fees} - \text{Sponsorship Offsets} - \text{Cash Collected})$$

1. **Effective Match Fee Precedence:**
   - Evaluates `resolvePlayerFeeOverride()`: Individual player fee overrides take precedence over the base match fee. Conflicting overrides are resolved deterministically by latest `updatedAt` timestamp, with document ID as a tie-breaker.
   - Fallback: Base fixture fee (`matches.fee`).
2. **Late Fee Calculation (`computeLateFees`):**
   - Timezone: Evaluated strictly in `Asia/Kolkata` time, regardless of client device local time (FIN-006).
   - Saturday & Sunday Matches: Base late fee (₹150) applies after Tuesday 23:59:59 IST. An additional ₹50 per week applies for subsequent weeks past the deadline.
   - Weekday Matches: Late fees do not apply to weekday fixtures.
   - Deduplication (FIN-007): Server checks existing `otherFees` records for matching `templateId` to prevent duplicate levies.
3. **Plan Bifurcation & Sponsorship:**
   - **Fixed Fee Plan:** Player obligation capped at fixed amount; remainder marked as club-sponsored.
   - **Monthly Subscription:** 100% of match fee offset by active subscription.
   - **Club Sponsored:** 100% subsidized by club; `totalCollected` is ₹0, `totalOffset` equals the fee.
4. **Reservation & Replay Protection:**
   - During checkout, an atomic reservation is written to prevent duplicate order generation for the same obligation.
   - Leases expire automatically after 15 minutes if payment is not captured.

---

## 3. Practice Studio & Indoor Nets Subscriptions

The Practice Studio workflow manages monthly and annual lane bookings, coaching passes, and membership subscriptions.

### Subscription Lifecycle & Single Source of Truth (SS-01)
- Historically, both client handlers and the server webhook computed and extended `studioExpiryDate`, causing race conditions and doubled subscription durations.
- **Current Rule:** The Razorpay client callback updates only local UI state. The server webhook (`app/api/razorpay/webhook/route.ts`) is the **exclusive authoritative source of truth** for:
  1. Computing `studioExpiryDate` and `studioEndDate` in `YYYY-MM-DD` format.
  2. Recording durable subscription audit records in `subscriptionHistory`.
  3. Updating active membership status flags on the player's profile.

### Multi-Lane Net Booking & Pass Debits
- Players with active memberships receive allotted booking tokens.
- Net reservations are recorded in `studioBookings` with lane identifiers, time slots, and check-in confirmation.

---

## 4. Shop & Merchandise Fulfillment Workflow

The Club Shop supports official cricket match kits, training wear, customized jerseys, and club accessories.

### Order Placement & Minimum Order Quantity (MOQ)
1. **Catalog & Customization:**
   - Products defined in `merchandises/{merchId}` with sizing, customization options (jersey name, number, chest/waist measurements), and prices.
2. **Order Submission:**
   - Client creates an order record in `merchOrders/{orderId}` with `paymentStatus: "Unpaid"`, `orderStatus: "Order Placed"`.
   - Players cannot modify pricing or status once created.
3. **Payment Finalization:**
   - Payment is collected via Razorpay.
   - Upon capture, the webhook updates `paymentStatus: "Paid"`.
   - Batch manufacturing triggers when minimum batch size (MOQ) is achieved.

---

## 5. Communications & Notification Channels

KAvach Play orchestrates player communications across three channels:

1. **In-App & Push Notifications (`notifications` collection):**
   - Dispatched for squad selections, payment reminders, match schedule alterations, and poll announcements.
2. **WhatsApp Business API (`app/api/whatsapp/`):**
   - Official fixture announcements with 1-tap availability deep links.
   - Membership expiry alerts (`app/api/whatsapp/remind-studio`).
   - Official club invitations (`app/api/whatsapp/invite`).
3. **Transactional Email (`app/api/email/send`):**
   - Automated digital payment receipts and detailed fee breakdowns dispatched via Nodemailer.
