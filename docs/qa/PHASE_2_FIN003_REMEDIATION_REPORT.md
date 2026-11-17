# KAvach Play — Phase 2: FIN-003 Webhook Validation & Payment Integrity Report

**Date:** 2026-11-17  
**Branch:** `mig-mov`  
**Phase:** 2 (FIN-003 Webhook Validation & Payment Event Hardening)  
**Status:** Completed, verified against Quality Gates, awaiting Owner & Independent QA review  
**Governing Standard:** [AGENTS.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/AGENTS.md)

---

## 1. Executive Summary

Phase 2 addresses and hardens **FIN-003** (P1 Webhook Transaction Validation & Integrity) along with related findings **FIN-002** (Webhook Concurrency & Idempotency) and **FIN-004** (Autonomous Server-Side Merchandise Fulfillment).

The Razorpay webhook integration in KAvach Play has been fortified with strict cryptographic signature verification, mandatory payment ID extraction across all supported events (`payment.captured` and `order.paid`), exact amount and currency verification against stored intents, and atomic Firestore transactions for all financial state transitions.

---

## 2. Key Hardening & Verification Measures

### 2.1 Cryptographic Signature Verification (`app/api/razorpay/webhook/route.ts`)
- Signature validation is computed over the raw request body buffer (`crypto.createHmac("sha256", secret).update(rawBody).digest("hex")`).
- Timing attacks are prevented using constant-time comparison via `crypto.timingSafeEqual`.
- Missing or invalid signatures reject immediately with HTTP 401 Unauthorized before any JSON parsing or database reads.

### 2.2 Strict Payment ID Enforcement (FIN-003)
- Both `payment.captured` and `order.paid` events **require** an authoritative gateway payment ID starting with `pay_` (`pay_...`).
- Payment ID extraction safely parses `payment.entity.id`, `order.entity.payment_id`, and `order.entity.payments[0]`.
- Empty or malformed IDs (such as prefix-only `"pay_"`, non-string values, or invalid formats) are strictly rejected.
- No financial records (`matches/{m}/payments`, `players/{p}/otherFees`, `subscriptionHistory`, `merchOrders`, `paymentReservations`) can be updated to `Paid` without the authoritative gateway `paymentId`.

### 2.3 Exact Amount & Currency Matching
- Amount in paise from the gateway payload is strictly compared against `Math.round(Number(intent.amount) * 100)`.
- Currency is strictly compared against `intent.currency` without silent fallback to `"INR"`.
- Order ID from the gateway payload must match the stored `intent.orderId`.
- Partial payments on `order.paid` are detected (`amount_paid < amount` or `status !== "paid"`) and rejected.

### 2.4 Autonomous Server-Side Fulfillment (FIN-004)
- Merchandise order fulfillment (`type === "merch_order"`) is performed directly and durably inside the webhook transaction, eliminating any reliance on client browser execution or `finalizeOrderPlacement()`.

### 2.5 Concurrency & Idempotency (FIN-002)
- All fulfillment mutations execute atomically inside `db.runTransaction()`.
- Idempotency guard: If `intent.status === "paid"`, duplicate webhook deliveries return `{ success: true, alreadyProcessed: true }` without repeating side effects or re-levying fees.

---

## 3. Code Modifications & Deliverables

1. [lib/razorpay-webhook.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/lib/razorpay-webhook.ts):
   - Trimmed and validated `paymentId` (`startsWith("pay_")` and `!== "pay_"`).
   - Trimmed and validated `orderId` (`startsWith("order_")`).
   - Strict validation in `validateWebhookTransaction`.
2. [app/api/razorpay/webhook/route.ts](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/api/razorpay/webhook/route.ts):
   - Added explicit `try / catch` around `processWebhookIntentTransaction` to return `HTTP 400 Bad Request` on transaction validation errors.
3. [tests/razorpay-webhook-negative.test.mjs](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/tests/razorpay-webhook-negative.test.mjs):
   - Added test: Prefix-only `"pay_"` without identifier is rejected.
   - Added test: Non-`order_` order IDs in payment entities are filtered and rejected.

---

## 4. Quality Gates Execution Evidence

| Quality Gate | Command | Result |
|---|---|---|
| **Unit / Functional Tests** | `npm run test:functional` | **188 passed, 0 failed** across 40 suites (777ms) |
| **Firestore Emulator Tests** | `npm run test:emulator` | **36 passed, 0 failed** across 4 suites (9.8s) |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **0 errors** |
| **ESLint** | `npm run lint` | **0 errors** (4 expected open-read warnings) |
| **Production Build** | `npm run build` | **Clean Next.js 15 build** (17/17 routes generated) |

---

## 5. Next Phase Gate

Per [AGENTS.md](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/AGENTS.md) non-negotiable rules, execution has stopped here.

**Awaiting owner review and approval of Phase 2 before proceeding to PHASE 3: Concurrency, Race Conditions & State Integrity.**
