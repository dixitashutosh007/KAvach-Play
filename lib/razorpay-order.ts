import { assertShopOpen } from "./shop-config.ts";
import crypto from "crypto";
import { computeLateFees } from "./utils.ts";
import { currentExpiryOf, isLateFeeExemption, isRecordedLateFee, toPaise } from "./payment-decision.ts";
import { resolveRenewalSubject } from "./razorpay-webhook.ts";

/**
 * B2 interim late-fee guard (§18): a late fee is offered only while nothing is recorded for
 * (player, match): no recorded late fee and no exemption. Same predicate as the dues screens.
 */
async function lateFeeAlreadyRecordedOrExempt(db: any, playerId: string, matchId: string): Promise<boolean> {
  const qs = await db.collection("players").doc(playerId).collection("otherFees").get();
  return qs.docs.some((d: any) => {
    const f = d.data() || {};
    return isRecordedLateFee(f, matchId) || isLateFeeExemption(f, matchId);
  });
}

/**
 * Generates a deterministic, fixed-length reservation key by hashing canonical obligation data (FIN-001).
 * Eliminates invalid document paths, avoids excessive ID lengths, handles reordered dues items,
 * and rejects unidentifiable / non-idempotent obligation requests without timestamp fallback.
 */
export function generateReservationKey(intentData: any, playerId: string): string {
  if (!intentData || typeof intentData !== "object" || !intentData.type) {
    throw new Error("Missing or invalid payment intentData for reservation key generation.");
  }
  if (!playerId || typeof playerId !== "string" || !playerId.trim()) {
    throw new Error("Missing playerId for reservation key generation.");
  }

  const type = intentData.type;

  if (type === "match") {
    const { matchId, paymentId } = intentData;
    if (!matchId || !paymentId) {
      throw new Error("matchId and paymentId are required for match reservation key.");
    }
    const canonical = `match:${matchId}:${paymentId}:${playerId}`;
    const hash = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
    return `res_match_${hash}`;
  }

  if (type === "finance_dues") {
    const items = Array.isArray(intentData.items) ? intentData.items : [];
    if (items.length === 0) {
      throw new Error("Cannot generate reservation key for empty finance dues.");
    }

    // Build canonical descriptors for each item to handle ordering & overlapping types
    const canonicalItemDescriptors: string[] = [];
    for (const item of items) {
      if (item.type === "match" && item.matchId && item.paymentId) {
        canonicalItemDescriptors.push(`m:${item.matchId}:${item.paymentId}`);
      } else if (item.type === "other" && item.feeId) {
        canonicalItemDescriptors.push(`o:${item.feeId}`);
      } else if (item.isLateFee && item.matchId) {
        canonicalItemDescriptors.push(`l:${item.matchId}:${item.lateFeeTemplateId || "lf"}`);
      } else if (item.type === "merch" && item.merchId) {
        canonicalItemDescriptors.push(`g:${item.merchId}`);
      } else if (item.paymentId || item.feeId || item.merchId || item.matchId) {
        canonicalItemDescriptors.push(`x:${item.type || "gen"}:${item.paymentId || item.feeId || item.merchId || item.matchId}`);
      }
    }

    if (canonicalItemDescriptors.length === 0) {
      throw new Error("Cannot generate reservation key: no valid item identifiers in dues.");
    }

    // Sort items alphabetically to ensure reordering yields identical hash
    canonicalItemDescriptors.sort();
    const canonical = `dues:${playerId}:${canonicalItemDescriptors.join("|")}`;
    const hash = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
    return `res_dues_${hash}`;
  }

  if (type === "subscription") {
    const planId = intentData.planId;
    if (!planId) {
      throw new Error("planId is required for subscription reservation key.");
    }
    const canonical = `sub:${playerId}:${planId}`;
    const hash = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
    return `res_sub_${hash}`;
  }

  if (type === "merch_order") {
    const merchId = intentData.orderPayload?.merchId || intentData.merchId;
    if (!merchId) {
      throw new Error("merchId is required for merchandise reservation key.");
    }
    const canonical = `merch:${merchId}:${playerId}`;
    const hash = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
    return `res_merch_${hash}`;
  }

  throw new Error(`Unsupported intent type for deterministic reservation: ${type}`);
}

export interface PaymentReservationResult {
  acquired: boolean;
  reservationToken?: string;
  fenceVersion?: number;
  receipt?: string;
  isWaiting?: boolean;
  conflict?: boolean;
  isPaid?: boolean;
  orderId?: string;
  needsReconciliation?: boolean;
  error?: string;
  existingOrder?: {
    orderId: string;
    intentId: string;
    amount: number;
    currency: string;
    isPaid?: boolean;
  };
}

export interface ReservationValidationResult {
  valid: boolean;
  conflict?: boolean;
  isPaid?: boolean;
  reason?: string;
}

/**
 * Validates reservation identity, amount, currency, and existing order/intent IDs
 * before reusing an active or recovered reservation (FIN-001).
 * If the stored amount or identity differs, returns a controlled conflict.
 */
export function validateReservationForReuse(
  reservationData: any,
  reservationKey: string,
  authUid: string,
  payableAmount: number,
  currency: string,
): ReservationValidationResult {
  if (!reservationData || typeof reservationData !== "object") {
    return { valid: false, conflict: true, reason: "Reservation record is missing or invalid." };
  }

  // 0. Paid-state protection: a reservation marked paid must never be reused for checkout
  if (reservationData.isPaid === true || reservationData.status === "paid") {
    return {
      valid: false,
      conflict: true,
      isPaid: true,
      reason: `Obligation has already been paid via order ${reservationData.orderId || "unknown"}.`,
    };
  }

  // 1. Validate reservation key
  if (reservationData.reservationKey && reservationData.reservationKey !== reservationKey) {
    return { valid: false, conflict: true, reason: "Reservation key mismatch." };
  }

  // 2. Validate authenticated user identity
  if (reservationData.userId !== authUid) {
    return { valid: false, conflict: true, reason: "Reservation belongs to a different user." };
  }

  // 3. Validate existing order ID and intent ID
  if (
    !reservationData.orderId ||
    typeof reservationData.orderId !== "string" ||
    !reservationData.orderId.startsWith("order_")
  ) {
    return { valid: false, conflict: true, reason: "Reservation is missing a valid Razorpay order ID." };
  }

  if (!reservationData.intentId || typeof reservationData.intentId !== "string") {
    return { valid: false, conflict: true, reason: "Reservation is missing a valid intent ID." };
  }

  // 4. Validate expected amount (do not silently reuse order if amount changed)
  if (Number(reservationData.amount) !== Number(payableAmount)) {
    return {
      valid: false,
      conflict: true,
      reason: `Amount mismatch: stored reservation is ₹${reservationData.amount}, but current payable amount is ₹${payableAmount}.`,
    };
  }

  // 5. Validate currency
  const storedCurrency = String(reservationData.currency || "INR").toUpperCase();
  const requestedCurrency = String(currency || "INR").toUpperCase();
  if (storedCurrency !== requestedCurrency) {
    return {
      valid: false,
      conflict: true,
      reason: `Currency mismatch: reservation currency is ${storedCurrency}, requested ${requestedCurrency}.`,
    };
  }

  return { valid: true };
}

/**
 * Generates an authoritative, unique Razorpay receipt string derived deterministically
 * from the reservationKey (FIN-001).
 * Length is guaranteed <= 40 characters (Razorpay API constraint: max 40 chars).
 */
export function generateAuthoritativeReceipt(reservationKey: string): string {
  if (!reservationKey) {
    throw new Error("reservationKey is required to generate authoritative receipt.");
  }
  const hash = crypto.createHash("sha256").update(reservationKey).digest("hex").slice(0, 32);
  return `rcpt_${hash}`;
}

/**
 * Stores the intentId in the reservation atomically before external Razorpay order creation (FIN-001).
 * Ensures that if external creation times out or fails, the intentId is already preserved on the reservation.
 */
export async function setReservationIntentId(
  db: any,
  reservationKey: string,
  reservationToken: string,
  intentId: string,
): Promise<void> {
  const reservationRef = db.collection("paymentReservations").doc(reservationKey);
  await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(reservationRef);
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (data.isPaid === true) {
      throw new Error("Cannot set intentId: obligation is already marked paid.");
    }
    if (data.reservationToken !== reservationToken) {
      throw new Error("Fencing conflict: reservation token mismatch when storing intentId.");
    }
    transaction.update(reservationRef, {
      intentId,
      updatedAt: new Date(),
    });
  });
}

/**
 * Verifies that the payment intent exists, matches the reservation (user, amount, currency, reservationKey),
 * and repairs intent.orderId atomically if missing or mismatched (FIN-001).
 * Safe, idempotent repair ensures webhook validation can subsequently validate the recovered order.
 */
export async function verifyAndRepairIntent(
  db: any,
  intentId: string,
  orderId: string,
  expected: {
    userId: string;
    amount: number;
    currency: string;
    reservationKey: string;
  },
): Promise<{ ok: boolean; intent?: any; error?: string }> {
  if (!intentId) {
    return { ok: false, error: "Missing intent ID for order repair." };
  }
  if (!orderId) {
    return { ok: false, error: "Missing order ID for intent repair." };
  }

  const intentRef = db.collection("razorpayIntents").doc(intentId);

  return await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(intentRef);
    if (!snap.exists) {
      return { ok: false, error: `Payment intent document not found: ${intentId}` };
    }
    const intent = snap.data() || {};

    // 1. Verify user identity exists and matches exactly (Finding 3)
    if (!intent.userId || typeof intent.userId !== "string" || !intent.userId.trim()) {
      return { ok: false, error: "Payment intent is missing required userId." };
    }
    if (intent.userId !== expected.userId) {
      return { ok: false, error: `Intent user mismatch: expected ${expected.userId}, found ${intent.userId}` };
    }

    // 2. Verify reservationKey exists and matches exactly (Finding 3)
    if (!intent.reservationKey || typeof intent.reservationKey !== "string" || !intent.reservationKey.trim()) {
      return { ok: false, error: "Payment intent is missing required reservationKey." };
    }
    if (intent.reservationKey !== expected.reservationKey) {
      return { ok: false, error: `Intent reservation key mismatch: expected ${expected.reservationKey}, found ${intent.reservationKey}` };
    }

    // 3. Verify amount exists, is valid number, and matches exactly (Finding 3)
    if (intent.amount === undefined || intent.amount === null || isNaN(Number(intent.amount))) {
      return { ok: false, error: "Payment intent is missing valid amount." };
    }
    if (Number(intent.amount) !== Number(expected.amount)) {
      return { ok: false, error: `Intent amount mismatch: expected ₹${expected.amount}, found ₹${intent.amount}` };
    }

    // 4. Verify currency exists, is non-empty string, and matches expected (Finding 3: no default fallback)
    if (!intent.currency || typeof intent.currency !== "string" || !intent.currency.trim()) {
      return { ok: false, error: "Payment intent is missing required currency." };
    }
    const intentCurr = intent.currency.trim().toUpperCase();
    const expectedCurr = String(expected.currency || "").trim().toUpperCase();
    if (intentCurr !== expectedCurr) {
      return { ok: false, error: `Intent currency mismatch: expected ${expectedCurr}, found ${intentCurr}` };
    }

    // 5. Only after all identity and financial validations succeed, repair orderId if missing or different
    const now = new Date();
    if (intent.orderId !== orderId) {
      transaction.update(intentRef, {
        orderId,
        repairedAt: now,
        orderIdRepairedAt: now,
        updatedAt: now,
      });
    }

    return {
      ok: true,
      intent: { ...intent, orderId },
    };
  });
}

/**
 * Atomically acquires or reuses an existing order reservation for an obligation (FIN-001).
 * Implements token-based fencing and lease management to prevent duplicate external order creation.
 */
export async function acquirePaymentReservation(
  db: any,
  reservationKey: string,
  authUid: string,
  payableAmount: number,
  currency: string,
  leaseDurationMs = 60 * 1000,
): Promise<PaymentReservationResult> {
  const reservationRef = db.collection("paymentReservations").doc(reservationKey);

  return await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(reservationRef);
    const now = new Date();

    if (snap.exists) {
      const data = snap.data() || {};

      // P1: Paid-state protection: an obligation marked as paid must NEVER be reacquired,
      // renewed, or returned as a payable existingOrder!
      if (data.isPaid === true || data.status === "paid") {
        return {
          acquired: false,
          conflict: true,
          isPaid: true,
          orderId: data.orderId,
          error: `Obligation has already been paid via order ${data.orderId || "unknown"}.`,
        };
      }

      // P0: reconciliation_required and reconciliation_failed MUST remain blocked regardless of expiresAt!
      // Do not allow automatic lock takeover simply because a reconciliation hold expires.
      if (data.status === "reconciliation_required" || data.status === "reconciliation_failed") {
        return {
          acquired: false,
          needsReconciliation: true,
          error: "External order reconciliation required before new order can be created.",
        };
      }

      const expiresAt = data.expiresAt
        ? data.expiresAt.toDate
          ? data.expiresAt.toDate()
          : new Date(data.expiresAt)
        : new Date(0);

      // P0 (Finding 1): An active reservation with an existing order must NOT be automatically replaced
      // just because its local expiry has passed. Reconcile the authoritative external status first.
      if ((data.status === "active" || data.status === "activation_failed") && data.orderId) {
        if (expiresAt > now) {
          // Unexpired active reservation: validate and reuse immediately
          const validation = validateReservationForReuse(
            data,
            reservationKey,
            authUid,
            payableAmount,
            currency,
          );

          if (!validation.valid) {
            // If the reservation is for the same user, currency, and valid order,
            // but the authoritative payable amount changed (e.g. admin updated match fee),
            // route through authoritative Razorpay reconciliation instead of failing immediately.
            const storedCurrency = String(data.currency || "INR").toUpperCase();
            const requestedCurrency = String(currency || "INR").toUpperCase();
            if (
              !validation.isPaid &&
              data.userId === authUid &&
              typeof data.orderId === "string" &&
              data.orderId.startsWith("order_") &&
              typeof data.intentId === "string" &&
              data.intentId.length > 0 &&
              storedCurrency === requestedCurrency &&
              Number(data.amount) !== Number(payableAmount)
            ) {
              return {
                acquired: false,
                conflict: true,
                needsReconciliation: true,
                existingOrder: {
                  orderId: data.orderId,
                  intentId: data.intentId,
                  amount: data.amount,
                  currency: data.currency || currency,
                },
                error: validation.reason,
              };
            }

            return {
              acquired: false,
              conflict: true,
              isPaid: validation.isPaid,
              orderId: data.orderId,
              error: validation.reason,
            };
          }

          if (data.status === "activation_failed") {
            transaction.update(reservationRef, {
              status: "active",
              updatedAt: now,
            });
          }

          return {
            acquired: false,
            existingOrder: {
              orderId: data.orderId,
              intentId: data.intentId,
              amount: data.amount,
              currency: data.currency || currency,
            },
          };
        } else {
          // Expired active reservation with existing order: NEVER auto-replace!
          // Must reconcile authoritative external status before any action.
          return {
            acquired: false,
            needsReconciliation: true,
            existingOrder: {
              orderId: data.orderId,
              intentId: data.intentId,
              amount: data.amount,
              currency: data.currency || currency,
            },
            error: "Active reservation hold expired locally. Authoritative Razorpay order reconciliation required.",
          };
        }
      }

      // Check if existing reservation is reserving and unexpired
      if (expiresAt > now) {
        if (data.status === "reserving") {
          // Check ownership of active lock
          if (data.userId && data.userId !== authUid) {
            return {
              acquired: false,
              conflict: true,
              error: "Obligation is currently reserved by another user.",
            };
          }

          // Same user is actively creating the order in another concurrent request
          return {
            acquired: false,
            isWaiting: true,
          };
        }
      }
    }

    // Acquire or reacquire reservation lock atomically with token and fencing version
    const prevFence = snap.exists ? Number(snap.data()?.fenceVersion || 0) : 0;
    const newFenceVersion = prevFence + 1;
    const reservationToken = `${authUid}_${crypto.randomUUID()}`;
    const authoritativeReceipt = generateAuthoritativeReceipt(reservationKey);

    transaction.set(reservationRef, {
      reservationKey,
      status: "reserving",
      reservationToken,
      fenceVersion: newFenceVersion,
      receipt: authoritativeReceipt,
      userId: authUid,
      amount: payableAmount,
      currency,
      createdAt: now,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + leaseDurationMs),
    });

    return {
      acquired: true,
      reservationToken,
      fenceVersion: newFenceVersion,
      receipt: authoritativeReceipt,
    };
  });
}

/**
 * Safely renews an active reservation lease for the legitimate token holder (FIN-001).
 * Validates reservation token and atomic fenceVersion before extending expiresAt.
 */
export async function renewReservationLease(
  db: any,
  reservationKey: string,
  reservationToken: string,
  extensionMs = 30 * 1000,
): Promise<{ renewed: boolean; error?: string }> {
  const reservationRef = db.collection("paymentReservations").doc(reservationKey);

  return await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(reservationRef);
    if (!snap.exists) {
      throw new Error("Reservation not found for lease renewal.");
    }
    const data = snap.data() || {};
    if (data.isPaid === true || data.status === "paid") {
      return {
        renewed: false,
        error: "Cannot renew lease: obligation is already marked paid.",
      };
    }
    if (data.reservationToken !== reservationToken) {
      return {
        renewed: false,
        error: "Fencing conflict: lease was acquired by another request or token is invalid.",
      };
    }
    if (data.status !== "reserving") {
      return {
        renewed: false,
        error: `Cannot renew lease for reservation in status '${data.status}'.`,
      };
    }

    const now = new Date();
    transaction.update(reservationRef, {
      expiresAt: new Date(now.getTime() + extensionMs),
      heartbeatAt: now,
      updatedAt: now,
    });
    return { renewed: true };
  });
}

/**
 * Activates reservation with created Razorpay order details.
 * Strictly verifies reservationToken to prevent stale/fenced requests from activating (FIN-001).
 * Propagates errors to caller without swallowing.
 */
export async function activatePaymentReservation(
  db: any,
  reservationKey: string,
  reservationToken: string,
  orderId: string,
  intentId: string,
  orderTtlMs = 15 * 60 * 1000,
): Promise<void> {
  const reservationRef = db.collection("paymentReservations").doc(reservationKey);

  await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(reservationRef);
    if (!snap.exists) {
      throw new Error(`Reservation not found for activation: ${reservationKey}`);
    }
    const data = snap.data() || {};

    if (data.isPaid === true) {
      throw new Error(`Cannot activate reservation: obligation is already marked paid via order ${data.orderId || orderId}.`);
    }

    if (data.reservationToken !== reservationToken) {
      throw new Error("Fencing conflict: reservation token mismatch. Stale request cannot activate reservation.");
    }

    const now = new Date();
    transaction.update(reservationRef, {
      status: "active",
      orderId,
      intentId,
      expiresAt: new Date(now.getTime() + orderTtlMs),
      updatedAt: now,
    });
  });
}

/**
 * Records an activation failure atomically with reservation token validation.
 * Preserves the orderId so the order can be safely reconciled and reused on retry (FIN-001).
 * Propagates errors to caller without swallowing.
 */
export async function recordActivationFailure(
  db: any,
  reservationKey: string,
  reservationToken: string,
  orderId: string,
  intentId: string | undefined,
  userId: string,
  amount: number,
  currency: string,
  errorMessage?: string,
  orderTtlMs = 15 * 60 * 1000,
): Promise<void> {
  const reservationRef = db.collection("paymentReservations").doc(reservationKey);

  await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(reservationRef);
    if (!snap.exists) {
      throw new Error(`Reservation not found for recording activation failure: ${reservationKey}`);
    }
    const data = snap.data() || {};
    if (data.isPaid === true) {
      return; // Do not overwrite paid reservation with activation_failed
    }
    if (data.reservationToken !== reservationToken) {
      throw new Error("Fencing conflict: reservation token mismatch. Stale request cannot update reservation.");
    }

    const now = new Date();
    transaction.update(reservationRef, {
      status: "activation_failed",
      orderId,
      intentId: intentId || "",
      userId,
      amount,
      currency,
      activationError: errorMessage || "Activation failed after order creation",
      expiresAt: new Date(now.getTime() + orderTtlMs),
      updatedAt: now,
    });
  });
}

/**
 * Records an ambiguous API failure (e.g. timeout / network drop / 5xx) where Razorpay
 * may or may not have created an order (FIN-001).
 * Sets status to 'reconciliation_required' and preserves token and receipt for external reconciliation.
 * Propagates errors to caller without swallowing.
 */
export async function recordReconciliationRequired(
  db: any,
  reservationKey: string,
  reservationToken: string,
  receipt: string,
  userId: string,
  amount: number,
  currency: string,
  errorMessage?: string,
  holdDurationMs = 15 * 60 * 1000,
): Promise<void> {
  const reservationRef = db.collection("paymentReservations").doc(reservationKey);

  await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(reservationRef);
    if (!snap.exists) {
      throw new Error(`Reservation not found for reconciliation record: ${reservationKey}`);
    }
    const data = snap.data() || {};
    if (data.isPaid === true) {
      return; // Do not overwrite paid reservation with reconciliation_required
    }
    if (data.reservationToken !== reservationToken) {
      throw new Error("Fencing conflict: reservation token mismatch. Stale request cannot update reservation.");
    }

    const now = new Date();
    transaction.update(reservationRef, {
      status: "reconciliation_required",
      receipt,
      userId,
      amount,
      currency,
      reconciliationReason: errorMessage || "Ambiguous gateway response; reconciliation required",
      expiresAt: new Date(now.getTime() + holdDurationMs),
      updatedAt: now,
    });
  });
}

/**
 * Reconciles an ambiguous reservation against Razorpay's API atomically and with fencing (FIN-001).
 * Queries Razorpay by authoritative receipt:
 * - Validates reservation token and fenceVersion in a Firestore transaction to prevent concurrent overwrites.
 * - Filters returned orders by exact matching receipt.
 * - Rejects multiple matching orders as a reconciliation conflict.
 * - Strictly validates returned order's receipt, amount, currency, and status.
 * - If order found: atomically activates reservation with orderId and intentId.
 * - If confirmed no order at Razorpay: atomically transitions status to 'failed', allowing safe new order creation.
 * - If Razorpay query fails: atomically records 'reconciliation_failed' without releasing lock.
 */
export async function reconcileAmbiguousReservation(
  razorpayInstance: any,
  db: any,
  reservationKey: string,
  authUid: string,
  payableAmount: number,
  currency: string,
): Promise<{ reconciled: boolean; existingOrder?: any; canRetry?: boolean; superseded?: boolean; reservationToken?: string; fenceVersion?: number; isPaid?: boolean; isExpired?: boolean; error?: string }> {
  const reservationRef = db.collection("paymentReservations").doc(reservationKey);

  // 1. Snapshot reservation to obtain token, fenceVersion, receipt, intentId, orderId
  const snap = await reservationRef.get();
  if (!snap.exists) {
    return { reconciled: false, canRetry: true };
  }
  const data = snap.data() || {};

  // Validate ownership before attempting reconciliation
  if (data.userId && data.userId !== authUid) {
    return { reconciled: false, error: "Reservation belongs to a different user." };
  }

  // If already marked isPaid, return isPaid: true immediately without making external gateway calls
  if (data.isPaid === true || data.status === "paid") {
    return {
      reconciled: true,
      isPaid: true,
      canRetry: false,
      existingOrder: {
        orderId: data.orderId,
        intentId: data.intentId,
        amount: data.amount || payableAmount,
        currency: data.currency || currency,
      },
    };
  }

  const receipt = data.receipt || generateAuthoritativeReceipt(reservationKey);
  const token = data.reservationToken;
  const fence = data.fenceVersion;
  const intentId = data.intentId || "";

  // ── BRANCH A: Existing Order ID is Known (Finding 1) ───────────────────────
  // An active reservation with an existing order must NOT be automatically replaced.
  // We authoritatively reconcile its status directly via razorpayInstance.orders.fetch(orderId).
  if (data.orderId) {
    try {
      const foundOrder = await razorpayInstance.orders.fetch(data.orderId);

      // Strict currency validation (Finding 2: no fallback, must exist and match exactly)
      if (!foundOrder.currency || typeof foundOrder.currency !== "string" || !foundOrder.currency.trim()) {
        await db.runTransaction(async (transaction: any) => {
          const freshSnap = await transaction.get(reservationRef);
          if (!freshSnap.exists) return;
          const fresh = freshSnap.data() || {};
          if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
          transaction.update(reservationRef, {
            status: "reconciliation_failed",
            reconciliationError: "Missing or empty currency in fetched Razorpay order.",
            updatedAt: new Date(),
          });
        });
        return { reconciled: false, error: "Missing or empty currency in fetched Razorpay order." };
      }

      const foundCurrency = foundOrder.currency.trim().toUpperCase();
      const expectedCurrency = String(currency || "").trim().toUpperCase();
      if (foundCurrency !== expectedCurrency) {
        await db.runTransaction(async (transaction: any) => {
          const freshSnap = await transaction.get(reservationRef);
          if (!freshSnap.exists) return;
          const fresh = freshSnap.data() || {};
          if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
          transaction.update(reservationRef, {
            status: "reconciliation_failed",
            reconciliationError: `Currency mismatch in fetched order: expected ${expectedCurrency}, found ${foundCurrency}`,
            updatedAt: new Date(),
          });
        });
        return { reconciled: false, error: `Currency mismatch in fetched order: expected ${expectedCurrency}, found ${foundCurrency}` };
      }

      const expectedPaise = Math.round(payableAmount * 100);
      const amountMatches = Number(foundOrder.amount) === expectedPaise;
      const now = new Date();

      // Case A.1: Order already PAID at Razorpay (Finding 1)
      // A paid order must NEVER be replaced or superseded!
      if (foundOrder.status === "paid") {
        if (!amountMatches) {
          await db.runTransaction(async (transaction: any) => {
            const freshSnap = await transaction.get(reservationRef);
            if (!freshSnap.exists) return;
            const fresh = freshSnap.data() || {};
            if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
            transaction.update(reservationRef, {
              status: "reconciliation_failed",
              reconciliationError: `Amount mismatch in paid order: expected ${expectedPaise} paise, found ${foundOrder.amount} paise`,
              updatedAt: now,
            });
          });
          return { reconciled: false, canRetry: false, error: "Amount mismatch in fetched order." };
        }
        await db.runTransaction(async (transaction: any) => {
          const freshSnap = await transaction.get(reservationRef);
          if (!freshSnap.exists) return;
          const fresh = freshSnap.data() || {};
          if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
          transaction.update(reservationRef, {
            status: "active",
            isPaid: true,
            updatedAt: now,
          });
        });
        return {
          reconciled: true,
          isPaid: true,
          canRetry: false,
          existingOrder: {
            orderId: foundOrder.id,
            intentId: intentId || data.intentId || "",
            amount: data.amount || payableAmount,
            currency: foundCurrency,
          },
        };
      }

      // Case A.2: Order still PAYABLE at Razorpay (created or attempted)
      if (foundOrder.status === "created" || foundOrder.status === "attempted") {
        if (amountMatches) {
          // Refresh local expiry by 15 minutes, retain status active, and reuse order.
          await db.runTransaction(async (transaction: any) => {
            const freshSnap = await transaction.get(reservationRef);
            if (!freshSnap.exists) return;
            const fresh = freshSnap.data() || {};
            if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
            transaction.update(reservationRef, {
              status: "active",
              expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
              updatedAt: now,
            });
          });
          return {
            reconciled: true,
            existingOrder: {
              orderId: foundOrder.id,
              intentId: intentId || data.intentId || "",
              amount: data.amount || payableAmount,
              currency: foundCurrency,
            },
          };
        }

        // Amount changed (e.g. admin set a custom match fee).
        // Never reuse an order for a different amount; verify NO active/ambiguous
        // payment attempt exists at Razorpay before superseding the stale reservation.
        const markBlocked = async (msg: string) => {
          await db.runTransaction(async (transaction: any) => {
            const freshSnap = await transaction.get(reservationRef);
            if (!freshSnap.exists) return;
            const fresh = freshSnap.data() || {};
            if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
            transaction.update(reservationRef, {
              status: "reconciliation_failed",
              reconciliationError: msg,
              updatedAt: new Date(),
            });
          });
        };

        if (typeof razorpayInstance.orders?.fetchPayments !== "function") {
          await markBlocked("Unable to verify order payment attempts; fetchPayments unavailable.");
          return { reconciled: false, canRetry: false, error: "Amount mismatch in fetched order." };
        }

        const PAGE_SIZE = 100;
        const MAX_PAYMENT_PAGES = 10;
        const allPaymentItems: any[] = [];
        try {
          let skip = 0;
          let page = 0;
          while (true) {
            if (page >= MAX_PAYMENT_PAGES) {
              await markBlocked(`Stale order ${data.orderId} exceeded ${MAX_PAYMENT_PAGES * PAGE_SIZE} payment attempts; manual reconciliation required.`);
              return { reconciled: false, canRetry: false, error: "Unable to verify all payment attempts; reconciliation required." };
            }
            const paymentsResp = await razorpayInstance.orders.fetchPayments(data.orderId, { count: PAGE_SIZE, skip });
            const pageItems = Array.isArray(paymentsResp?.items) ? paymentsResp.items : null;
            if (!pageItems) {
              await markBlocked(`Malformed payment-attempts response for stale order ${data.orderId}.`);
              return { reconciled: false, canRetry: false, error: "Unable to verify stale order payment status; reconciliation required." };
            }
            allPaymentItems.push(...pageItems);
            if (pageItems.length < PAGE_SIZE) break;
            skip += pageItems.length;
            page += 1;
          }
        } catch (payFetchErr: any) {
          await markBlocked(`Failed to fetch payment attempts for stale order ${data.orderId}: ${payFetchErr?.message || "unknown"}`);
          return { reconciled: false, canRetry: false, error: "Unable to verify stale order payment status; reconciliation required." };
        }

        if (foundOrder.status === "created" && allPaymentItems.length > 0) {
          await markBlocked(`Order ${data.orderId} reported 'created' but has ${allPaymentItems.length} payment attempt(s).`);
          return { reconciled: false, canRetry: false, error: "Order has unexpected payment attempts; reconciliation required." };
        }

        const hasNonFailedPayment = allPaymentItems.some(
          (p: any) => String(p?.status || "").trim().toLowerCase() !== "failed",
        );
        if (hasNonFailedPayment) {
          await markBlocked(`Stale order ${data.orderId} has an authorized, captured, pending, or ambiguous payment attempt.`);
          return { reconciled: false, canRetry: false, error: "Previous order has an active or ambiguous payment; reconciliation required." };
        }

        // Confirmed unpaid: atomically supersede stale reservation under fencing token
        const newToken = `${authUid}_${crypto.randomUUID()}`;
        let newFenceVersion = 0;
        await db.runTransaction(async (transaction: any) => {
          const freshSnap = await transaction.get(reservationRef);
          if (!freshSnap.exists) {
            throw new Error("Fencing conflict: reservation no longer exists.");
          }
          const fresh = freshSnap.data() || {};
          if (fresh.isPaid === true || fresh.status === "paid") {
            throw new Error("Fencing conflict: reservation became paid.");
          }
          if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) {
            throw new Error("Fencing conflict during stale reservation supersession.");
          }
          newFenceVersion = Number(fresh.fenceVersion || 0) + 1;
          transaction.update(reservationRef, {
            status: "reserving",
            reservationToken: newToken,
            fenceVersion: newFenceVersion,
            amount: payableAmount,
            currency: expectedCurrency,
            supersededOrderId: data.orderId,
            supersededAmount: data.amount,
            orderId: null,
            intentId: null,
            heartbeatAt: now,
            expiresAt: new Date(now.getTime() + 60 * 1000),
            updatedAt: now,
          });
        });

        return {
          reconciled: true,
          canRetry: true,
          superseded: true,
          reservationToken: newToken,
          fenceVersion: newFenceVersion,
        };
      }

      // Case A.3: Contract Validation (P1)
      // Per official Razorpay Orders API contract (https://razorpay.com/docs/api/orders),
      // Order entities strictly possess three enum statuses: 'created', 'attempted', and 'paid'.
      // Core orders never possess 'expired' or 'cancelled' status (those belong to Payment Links/Subscriptions).
      // An order stays created/attempted indefinitely until paid.
      // If any unexpected/unsupported status is returned, the order cannot be proven unusable.
      // Retain safe blocking in 'reconciliation_failed' to prevent duplicate order creation; manual administrative review required.
      await db.runTransaction(async (transaction: any) => {
        const freshSnap = await transaction.get(reservationRef);
        if (!freshSnap.exists) return;
        const fresh = freshSnap.data() || {};
        if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
        transaction.update(reservationRef, {
          status: "reconciliation_failed",
          reconciliationError: `Unrecognized or unsupported Razorpay order status '${foundOrder.status}'. Per official Razorpay Orders API contract, orders only possess 'created', 'attempted', and 'paid' statuses. Reservation remains safely blocked to prevent duplicate order creation; manual administrative review required.`,
          updatedAt: now,
        });
      });
      return {
        reconciled: false,
        canRetry: false,
        error: `Unrecognized or unsupported Razorpay order status: ${foundOrder.status}`,
      };
    } catch (fetchErr: any) {
      if (fetchErr.message?.includes("Fencing conflict")) {
        return { reconciled: false, error: fetchErr.message };
      }
      // External status unavailable (network error, timeout, 5xx): retain safe blocked state (Finding 1)
      await db.runTransaction(async (transaction: any) => {
        const freshSnap = await transaction.get(reservationRef);
        if (!freshSnap.exists) return;
        const fresh = freshSnap.data() || {};
        if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
        transaction.update(reservationRef, {
          status: "reconciliation_failed",
          reconciliationError: `External status unavailable: ${fetchErr.message}`,
          updatedAt: new Date(),
        });
      });
      return { reconciled: false, canRetry: false, error: `External status unavailable: ${fetchErr.message}` };
    }
  }

  // ── BRANCH B: Only Receipt is Known (orderId not yet received) ──────────────
  try {
    // Query Razorpay for orders containing this receipt
    const response = await razorpayInstance.orders.all({ receipt });
    const rawItems = response?.items || [];
    // Filter to ensure exact match on authoritative receipt
    const matchingOrders = rawItems.filter((o: any) => o.receipt === receipt);

    if (matchingOrders.length > 1) {
      // Multiple orders found for the same receipt! Reconciliation conflict!
      await db.runTransaction(async (transaction: any) => {
        const freshSnap = await transaction.get(reservationRef);
        if (!freshSnap.exists) return;
        const fresh = freshSnap.data() || {};
        if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) {
          throw new Error("Fencing conflict during reconciliation conflict recording.");
        }
        transaction.update(reservationRef, {
          status: "reconciliation_failed",
          reconciliationError: `Multiple Razorpay orders (${matchingOrders.length}) found for receipt ${receipt}. Manual intervention required.`,
          updatedAt: new Date(),
        });
      });
      return {
        reconciled: false,
        error: `Reconciliation conflict: multiple orders found for receipt ${receipt}.`,
      };
    }

    if (matchingOrders.length === 1) {
      const foundOrder = matchingOrders[0];

      // Strict currency validation (Finding 2: no fallback, must exist and match exactly)
      if (!foundOrder.currency || typeof foundOrder.currency !== "string" || !foundOrder.currency.trim()) {
        await db.runTransaction(async (transaction: any) => {
          const freshSnap = await transaction.get(reservationRef);
          if (!freshSnap.exists) return;
          const fresh = freshSnap.data() || {};
          if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
          transaction.update(reservationRef, {
            status: "reconciliation_failed",
            reconciliationError: "Missing or empty currency in reconciled Razorpay order.",
            updatedAt: new Date(),
          });
        });
        return { reconciled: false, error: "Missing or empty currency in reconciled Razorpay order." };
      }

      const foundCurrency = foundOrder.currency.trim().toUpperCase();
      const expectedCurrency = String(currency || "").trim().toUpperCase();
      if (foundCurrency !== expectedCurrency) {
        await db.runTransaction(async (transaction: any) => {
          const freshSnap = await transaction.get(reservationRef);
          if (!freshSnap.exists) return;
          const fresh = freshSnap.data() || {};
          if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
          transaction.update(reservationRef, {
            status: "reconciliation_failed",
            reconciliationError: `Currency mismatch in reconciled order: expected ${expectedCurrency}, found ${foundCurrency}`,
            updatedAt: new Date(),
          });
        });
        return { reconciled: false, error: `Currency mismatch in reconciled order: expected ${expectedCurrency}, found ${foundCurrency}` };
      }

      // Validate order fields: receipt, amount, status
      if (foundOrder.receipt !== receipt) {
        return { reconciled: false, error: "Receipt mismatch in returned Razorpay order." };
      }
      const expectedPaise = Math.round(payableAmount * 100);
      if (Number(foundOrder.amount) !== expectedPaise) {
        await db.runTransaction(async (transaction: any) => {
          const freshSnap = await transaction.get(reservationRef);
          if (!freshSnap.exists) return;
          const fresh = freshSnap.data() || {};
          if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
          transaction.update(reservationRef, {
            status: "reconciliation_failed",
            reconciliationError: `Amount mismatch in reconciled order: expected ${expectedPaise} paise, found ${foundOrder.amount} paise`,
            updatedAt: new Date(),
          });
        });
        return { reconciled: false, error: "Amount mismatch in reconciled order." };
      }

      if (foundOrder.status !== "created" && foundOrder.status !== "attempted" && foundOrder.status !== "paid") {
        await db.runTransaction(async (transaction: any) => {
          const freshSnap = await transaction.get(reservationRef);
          if (!freshSnap.exists) return;
          const fresh = freshSnap.data() || {};
          if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
          transaction.update(reservationRef, {
            status: "reconciliation_failed",
            reconciliationError: `Unrecognized or unsupported Razorpay order status '${foundOrder.status}'. Per official Razorpay Orders API contract, orders only possess 'created', 'attempted', and 'paid' statuses. Reservation remains safely blocked to prevent duplicate order creation; manual administrative review required.`,
            updatedAt: new Date(),
          });
        });
        return {
          reconciled: false,
          canRetry: false,
          error: `Unrecognized or unsupported Razorpay order status: ${foundOrder.status}`,
        };
      }

      const isPaid = foundOrder.status === "paid";
      const now = new Date();

      // Authoritative order found and validated! Transition to active atomically in transaction
      await db.runTransaction(async (transaction: any) => {
        const freshSnap = await transaction.get(reservationRef);
        if (!freshSnap.exists) {
          throw new Error(`Reservation not found: ${reservationKey}`);
        }
        const fresh = freshSnap.data() || {};
        if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) {
          throw new Error("Fencing conflict: reservation was modified by another request during reconciliation.");
        }
        if (fresh.status === "active" && Boolean(fresh.isPaid) === isPaid) {
          return;
        }

        transaction.update(reservationRef, {
          status: "active",
          orderId: foundOrder.id,
          intentId: intentId || fresh.intentId || "",
          receipt,
          isPaid,
          updatedAt: now,
        });
      });

      // Item 1: If status is 'paid', persist the paid state, return isPaid: true,
      // and do NOT return the order as a checkout opportunity
      if (isPaid) {
        return {
          reconciled: true,
          isPaid: true,
          canRetry: false,
          existingOrder: {
            orderId: foundOrder.id,
            intentId: intentId || data.intentId || "",
            amount: data.amount || payableAmount,
            currency: foundCurrency,
          },
        };
      }

      // Preserve existing created/attempted payable behavior
      return {
        reconciled: true,
        existingOrder: {
          orderId: foundOrder.id,
          intentId: intentId || data.intentId || "",
          amount: data.amount || payableAmount,
          currency: foundCurrency,
        },
      };
    } else {
      // 0 matching orders found in list.
      // Finding 4: Do not assume an empty list response proves absence.
      // An empty response from a paginated list API can be due to read-replica delay or indexing lag.
      // Keep the reservation blocked. Do not transition it to 'failed'. Do not permit another order.
      await db.runTransaction(async (transaction: any) => {
        const freshSnap = await transaction.get(reservationRef);
        if (!freshSnap.exists) return;
        const fresh = freshSnap.data() || {};
        if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
        transaction.update(reservationRef, {
          status: "reconciliation_failed",
          reconciliationError: "Authoritative order absence could not be conclusively established by gateway list API. Reservation remains safely blocked to prevent duplicate order creation.",
          updatedAt: new Date(),
        });
      });

      return {
        reconciled: false,
        canRetry: false,
        error: "Authoritative order absence could not be conclusively established by gateway list API.",
      };
    }
  } catch (reconcileErr: any) {
    if (reconcileErr.message?.includes("Fencing conflict")) {
      return {
        reconciled: false,
        error: reconcileErr.message,
      };
    }

    // Try to record reconciliation_failed atomically if not already fenced
    try {
      await db.runTransaction(async (transaction: any) => {
        const freshSnap = await transaction.get(reservationRef);
        if (!freshSnap.exists) return;
        const fresh = freshSnap.data() || {};
        if (fresh.reservationToken !== token || fresh.fenceVersion !== fence) return;
        transaction.update(reservationRef, {
          status: "reconciliation_failed",
          reconciliationError: reconcileErr.message || "Failed to reach Razorpay during reconciliation",
          updatedAt: new Date(),
        });
      });
    } catch {
      // Preserve reservation in reconciliation_required if recording fails
    }

    return {
      reconciled: false,
      error: `Reconciliation query failed: ${reconcileErr.message}`,
    };
  }
}

/**
 * Releases reservation on definitive Razorpay failure (e.g. 400 Bad Request, invalid credentials)
 * where NO external order could possibly have been created (FIN-001).
 * Validates reservationToken before releasing.
 * Propagates errors to caller without swallowing.
 */
export async function releasePaymentReservation(
  db: any,
  reservationKey: string,
  reservationToken: string,
  errorMessage?: string,
): Promise<void> {
  const reservationRef = db.collection("paymentReservations").doc(reservationKey);

  await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(reservationRef);
    if (!snap.exists) {
      return;
    }
    const data = snap.data() || {};
    if (data.isPaid === true) {
      throw new Error("Cannot release reservation: obligation is already marked paid.");
    }
    if (data.reservationToken !== reservationToken) {
      throw new Error("Fencing conflict: reservation token mismatch. Stale request cannot release reservation.");
    }

    const now = new Date();
    transaction.update(reservationRef, {
      status: "failed",
      error: errorMessage || "Order creation failed",
      expiresAt: now,
      updatedAt: now,
    });
  });
}

/**
 * Identifies whether an error from Razorpay order creation represents an ambiguous failure
 * (e.g. network timeout, server 5xx) where an external order may have been created (FIN-001).
 */
export function isAmbiguousRazorpayError(err: any): boolean {
  if (!err) return true;
  const msg = String(err.message || "").toLowerCase();
  const code = String(err.code || "").toLowerCase();
  const statusCode = Number(err.statusCode || err.status || 0);

  // Definitive client rejection (4xx except 408 Request Timeout)
  if (statusCode >= 400 && statusCode < 500 && statusCode !== 408) {
    return false;
  }
  if (
    msg.includes("bad request") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("not found")
  ) {
    return false;
  }

  // Ambiguous network drops, socket timeouts, 5xx server errors
  if (
    code === "etimedout" ||
    code === "econnreset" ||
    code === "esockettimedout" ||
    code === "econnrefused" ||
    msg.includes("timeout") ||
    msg.includes("socket") ||
    msg.includes("network") ||
    statusCode >= 500 ||
    statusCode === 408
  ) {
    return true;
  }

  // Default to treating unknown errors as ambiguous to protect financial integrity
  return true;
}

/**
 * Validates currency string. Only INR is supported per business rules.
 */
export function validateCurrency(currency: string | undefined | null): boolean {
  return String(currency || "").toUpperCase() === "INR";
}

/**
 * Validates that the authenticated user owns or is linked to the target playerId.
 * Enforces strict player-to-user boundary (SEC-001, IDT-001):
 * - Must have a positive match via players/{targetPlayerId}.authUid === authUid OR appUsers/{authUid}.playerId === targetPlayerId.
 * - Never grants ownership merely because targetPlayerId === authUid.
 * - Never grants ownership after a failed Firestore lookup (fail-closed).
 */
export async function verifyPlayerOwnership(
  db: any,
  authUid: string,
  targetPlayerId: string,
): Promise<boolean> {
  if (!targetPlayerId || !authUid || typeof targetPlayerId !== "string" || typeof authUid !== "string") {
    return false;
  }

  // 1. Check players collection: does the target player document have authUid matching caller?
  try {
    const pDoc = await db.collection("players").doc(targetPlayerId).get();
    if (pDoc.exists) {
      const pData = pDoc.data() || {};
      // Reject if player is disabled, merged into another profile, or actively merging
      if (pData.disabled === true || pData.mergedInto || pData.mergeStatus === "in_progress") {
        return false;
      }
      if (pData.authUid && pData.authUid === authUid) {
        return true;
      }
    }
  } catch (err) {
    // Fail-closed on database read error
    console.error(`[verifyPlayerOwnership] Database error reading players/${targetPlayerId}:`, err);
    return false;
  }

  // 2. Check appUsers collection: does caller's account record link to targetPlayerId?
  try {
    const uDoc = await db.collection("appUsers").doc(authUid).get();
    if (uDoc.exists) {
      const uData = uDoc.data() || {};
      if (uData.playerId && uData.playerId === targetPlayerId) {
        // Also verify the player document is not disabled/merging
        const pDoc = await db.collection("players").doc(targetPlayerId).get();
        if (pDoc.exists) {
          const pData = pDoc.data() || {};
          if (pData.disabled === true || pData.mergedInto || pData.mergeStatus === "in_progress") {
            return false;
          }
        }
        return true;
      }
    }
  } catch (err) {
    // Fail-closed on database read error
    console.error(`[verifyPlayerOwnership] Database error reading appUsers/${authUid}:`, err);
    return false;
  }

  // Strict: no fallback. Without a confirmed positive link in players or appUsers, reject.
  return false;
}

/**
 * Authoritatively validates merchandise custom selections and calculates total price.
 * Rejects unknown selections, invalid option values, and missing required custom fields.
 * Never silently ignores invalid selections.
 */
export function calculateAuthoritativeMerchPrice(
  merch: any,
  customSelections: Record<string, any> = {},
): number {
  if (!merch || typeof merch !== "object") {
    throw new Error("Invalid merchandise item.");
  }

  let price = Number(merch.basePrice ?? merch.price ?? 0);
  if (price <= 0) {
    throw new Error("Invalid merchandise base price.");
  }

  const customFields: any[] = Array.isArray(merch.customFields) ? merch.customFields : [];
  const validFieldMap = new Map<string, any>();
  for (const f of customFields) {
    if (f && f.name) {
      validFieldMap.set(f.name, f);
    }
  }

  // 1. Reject unknown custom selections
  if (customSelections && typeof customSelections === "object") {
    for (const key of Object.keys(customSelections)) {
      if (!validFieldMap.has(key)) {
        throw new Error(`Unknown merchandise custom selection field: '${key}'.`);
      }
    }
  }

  // 2. Enforce mandatory fields and validate allowed option values
  for (const [fieldName, field] of validFieldMap.entries()) {
    const isRequired = field.required !== false; // Required by default if custom field is defined
    const selectedVal = customSelections ? customSelections[fieldName] : undefined;

    if (isRequired && (selectedVal === undefined || selectedVal === null || String(selectedVal).trim() === "")) {
      throw new Error(`Missing required merchandise selection for '${fieldName}'.`);
    }

    if (selectedVal !== undefined && selectedVal !== null && String(selectedVal).trim() !== "") {
      const allowedOptions: any[] = Array.isArray(field.options) ? field.options : [];
      const matchedOpt = allowedOptions.find((opt: any) => opt.value === selectedVal);

      if (!matchedOpt) {
        const allowedVals = allowedOptions.map((o: any) => o.value).join(", ");
        throw new Error(
          `Invalid selection '${selectedVal}' for field '${fieldName}'. Allowed options: [${allowedVals}].`,
        );
      }

      if (matchedOpt.priceModifierType === "Add" && matchedOpt.priceModifierValue) {
        const modVal = Number(matchedOpt.priceModifierValue);
        if (!isNaN(modVal) && modVal > 0) {
          price += modVal;
        }
      }
    }
  }

  return price;
}

/**
 * Derives and verifies the authoritative payable amount server-side.
 * Client-supplied amounts are ignored/overridden to prevent fee tampering (FIN-001).
 */
/** B1 (PX-1): order statuses a shop checkout may request (MOQ display state only). */
export const MERCH_CHECKOUT_ORDER_STATUSES = [
  "Awaiting Min Order Qnty",
  "Ready to Place Order",
  "Order Placed",
] as const;

function optionalBoundedString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`Invalid merchandise order field: ${field}.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new Error(`Merchandise order field ${field} exceeds ${max} characters.`);
  return trimmed;
}

/**
 * B1 (PX-1): builds the stored merchandise order payload from the approved allowlist.
 * Client-supplied ids, payment fields and any unlisted field are dropped; server values win.
 */
export function buildMerchOrderPayload(
  clientPayload: any,
  server: { merchId: string; merchName: string; price: number; customPriceAdditions?: number; playerId: string; playerRecordName?: string },
): Record<string, any> {
  const src = clientPayload && typeof clientPayload === "object" ? clientPayload : {};

  const playerName =
    server.playerRecordName ||
    optionalBoundedString(src.playerName, "playerName", 100) ||
    "Player";

  let customSelections: Record<string, string> | undefined;
  if (src.customSelections !== undefined && src.customSelections !== null) {
    if (typeof src.customSelections !== "object" || Array.isArray(src.customSelections)) {
      throw new Error("Invalid merchandise order field: customSelections.");
    }
    const entries = Object.entries(src.customSelections);
    if (entries.length > 20) throw new Error("Too many merchandise custom selections.");
    customSelections = {};
    for (const [key, value] of entries) {
      if (key.length === 0 || key.length > 50) throw new Error("Invalid merchandise custom selection name.");
      if (typeof value !== "string" || value.length > 100) {
        throw new Error(`Invalid merchandise custom selection value for ${key}.`);
      }
      customSelections[key] = value;
    }
    if (Object.keys(customSelections).length === 0) customSelections = undefined;
  }

  const rawNumber = typeof src.jerseyNumber === "number" ? String(src.jerseyNumber) : src.jerseyNumber;
  const orderStatus = (MERCH_CHECKOUT_ORDER_STATUSES as readonly string[]).includes(src.orderStatus)
    ? src.orderStatus
    : "Order Placed";

  const payload: Record<string, any> = {
    playerId: server.playerId,
    playerName,
    merchId: server.merchId,
    merchName: server.merchName,
    size: optionalBoundedString(src.size, "size", 50),
    spec: optionalBoundedString(src.spec, "spec", 200),
    customSelections,
    customPriceAdditions: server.customPriceAdditions && server.customPriceAdditions > 0 ? server.customPriceAdditions : undefined,
    jerseyName: optionalBoundedString(src.jerseyName, "jerseyName", 30),
    jerseyNumber: optionalBoundedString(rawNumber, "jerseyNumber", 10),
    quantity: 1,
    price: server.price,
    priceSnapshot: {
      unitPrice: server.price,
      quantity: 1,
      totalAmount: server.price,
      currency: "INR",
    },
    trustedSource: "server",
    orderStatus,
  };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  return payload;
}

export async function derivePayableAmount(
  db: any,
  authUid: string,
  intentData: any,
): Promise<{ amount: number; verifiedIntent: any }> {
  if (!intentData || typeof intentData !== "object") {
    throw new Error("Missing or invalid intentData.");
  }

  const type = intentData.type;

  if (type === "match") {
    const { matchId, paymentId } = intentData;
    if (!matchId || !paymentId) {
      throw new Error("matchId and paymentId are required for match payments.");
    }

    const matchSnap = await db.collection("matches").doc(matchId).get();
    if (!matchSnap.exists) {
      throw new Error("Match not found.");
    }
    const matchData = matchSnap.data() || {};

    if (matchData.abandoned === true || matchData.status === "abandoned") {
      throw new Error("Match has been abandoned; match fee obligations are waived.");
    }

    const paySnap = await db
      .collection("matches")
      .doc(matchId)
      .collection("payments")
      .doc(paymentId)
      .get();
    if (!paySnap.exists) {
      throw new Error("Match payment record not found.");
    }
    const payData = paySnap.data() || {};
    const playerId = payData.playerId;

    // Verify ownership
    const isAuthorized = await verifyPlayerOwnership(db, authUid, playerId);
    if (!isAuthorized) {
      throw new Error("Unauthorized: you cannot initiate payment for another player's obligation.");
    }

    if (payData.status === "Paid") {
      throw new Error("Match fee is already marked as Paid.");
    }
    if (payData.status === "Waived") {
      throw new Error("Match fee obligation is waived.");
    }
    if (payData.status === "Not Playing") {
      throw new Error("Player is not marked as playing in this match.");
    }

    let calculatedAmount =
      payData.feeOverride !== undefined
        ? Number(payData.feeOverride)
        : Number(matchData.fee || 0);

    if (calculatedAmount < 0) calculatedAmount = 0;

    // Authoritative Late Fees: derive from server-side match date
    const verifiedLateFees: any[] = [];
    if (intentData.lateFeeItems || intentData.includeLateFees) {
      if (matchData.date && !(await lateFeeAlreadyRecordedOrExempt(db, playerId, matchId))) {
        const computedFees = computeLateFees(
          matchData.date,
          matchId,
          playerId,
          matchData.opponent || "Match",
        );
        for (const cf of computedFees) {
          calculatedAmount += cf.amount;
          verifiedLateFees.push({
            playerId,
            label: cf.label,
            amount: cf.amount,
            templateId: `latefee_${matchId}_${cf.weeks}`,
          });
        }
      }
    }

    if (calculatedAmount <= 0) {
      throw new Error("Payable match fee amount must be greater than zero.");
    }

    return {
      amount: calculatedAmount,
      verifiedIntent: {
        type: "match",
        reservationKey: generateReservationKey(intentData, playerId),
        matchId,
        paymentId,
        playerId,
        userId: authUid,
        lateFeeItems: verifiedLateFees,
      },
    };
  } else if (type === "finance_dues") {
    const items = intentData.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("No dues items provided.");
    }

    const playerId = intentData.playerId || authUid;
    const isAuthorized = await verifyPlayerOwnership(db, authUid, playerId);
    if (!isAuthorized) {
      throw new Error("Unauthorized: you cannot initiate payment for another player's dues.");
    }

    let calculatedAmount = 0;
    const verifiedItems: any[] = [];
    const seenItemKeys = new Set<string>();

    for (const item of items) {
      if (item.type === "match" && item.matchId && item.paymentId) {
        const itemKey = `match_${item.matchId}_${item.paymentId}`;
        if (seenItemKeys.has(itemKey)) continue; // Prevent duplicate billing
        seenItemKeys.add(itemKey);

        const mSnap = await db.collection("matches").doc(item.matchId).get();
        if (!mSnap.exists) continue;
        const mData = mSnap.data() || {};
        if (mData.abandoned === true || mData.status === "abandoned") continue;

        const pSnap = await db
          .collection("matches")
          .doc(item.matchId)
          .collection("payments")
          .doc(item.paymentId)
          .get();

        if (pSnap.exists) {
          const pData = pSnap.data() || {};
          if (pData.playerId !== playerId) continue; // Boundary check: must belong to target player
          if (pData.status === "Paid" || pData.status === "Waived" || pData.status === "Not Playing") {
            continue;
          }

          const fee =
            pData.feeOverride !== undefined
              ? Number(pData.feeOverride)
              : Number(mData.fee || 0);

          if (fee > 0) {
            calculatedAmount += fee;
            verifiedItems.push({
              type: "match",
              matchId: item.matchId,
              paymentId: item.paymentId,
              amount: fee,
            });
          }
        }
      } else if (item.type === "other" && item.feeId) {
        const itemKey = `other_${item.feeId}`;
        if (seenItemKeys.has(itemKey)) continue;
        seenItemKeys.add(itemKey);

        const feeSnap = await db
          .collection("players")
          .doc(playerId)
          .collection("otherFees")
          .doc(item.feeId)
          .get();

        if (feeSnap.exists) {
          const feeData = feeSnap.data() || {};
          if (feeData.status === "Paid" || feeData.status === "Waived") continue;
          const feeAmt = Number(feeData.amount || 0);
          if (feeAmt > 0) {
            calculatedAmount += feeAmt;
            verifiedItems.push({
              type: "other",
              feeId: item.feeId,
              amount: feeAmt,
            });
          }
        }
      } else if (item.isLateFee && item.matchId) {
        const itemKey = `latefee_${item.matchId}`;
        if (seenItemKeys.has(itemKey)) continue;
        seenItemKeys.add(itemKey);

        // Derive late fee authoritatively from server records, ignore client lateFeeAmount
        // B2 interim guard: never offer a late fee already recorded (or exempted) for this match.
        if (await lateFeeAlreadyRecordedOrExempt(db, playerId, item.matchId)) continue;
        const mSnap = await db.collection("matches").doc(item.matchId).get();
        if (mSnap.exists) {
          const mData = mSnap.data() || {};
          if (mData.date && !mData.abandoned && mData.status !== "abandoned") {
            const computed = computeLateFees(
              mData.date,
              item.matchId,
              playerId,
              mData.opponent || "Match",
            );
            const totalLf = computed.reduce((s, c) => s + c.amount, 0);
            if (totalLf > 0) {
              calculatedAmount += totalLf;
              verifiedItems.push({
                isLateFee: true,
                matchId: item.matchId,
                lateFeeLabel: `Late Fee: ${mData.opponent || "Match"}`,
                lateFeeAmount: totalLf,
                lateFeeTemplateId: String(item.lateFeeTemplateId || `latefee_${item.matchId}`),
              });
            }
          }
        }
      } else if (item.type === "merch" && item.merchId) {
        const itemKey = `merch_${item.merchId}`;
        if (seenItemKeys.has(itemKey)) continue;
        seenItemKeys.add(itemKey);

        const mSnap = await db.collection("merchOrders").doc(item.merchId).get();
        if (mSnap.exists) {
          const mData = mSnap.data() || {};
          if (mData.playerId !== playerId) continue; // Boundary check
          if (mData.paymentStatus !== "Unpaid" && mData.paymentStatus !== "Failed") continue;
          if (mData.orderStatus === "Cancelled") continue;
          if (mData.quantity !== undefined && Number(mData.quantity) !== 1) continue;
          if (!mData.merchId || typeof mData.merchId !== "string") continue;

          // P1-01 (Review Correction): Client-writable `isManual` NEVER establishes
          // online payment provenance. Offline manual orders are settled offline.
          if (mData.isManual === true) continue;

          // Require strict server-only provenance (cannot be written by any client in firestore.rules)
          const hasServerProvenance =
            mData.trustedSource === "server" &&
            typeof mData.intentId === "string" &&
            mData.intentId.trim().length > 0 &&
            Number.isFinite(Number(mData.priceSnapshot?.totalAmount)) &&
            Number(mData.priceSnapshot?.totalAmount) > 0;
          if (!hasServerProvenance) continue;

          // Verify catalogue item exists and is active/available
          const catSnap = await db.collection("merchandises").doc(mData.merchId).get();
          if (!catSnap.exists) continue;
          const catData = catSnap.data() || {};
          if (catData.status === "Not Accepting Orders" || catData.isHidden === true) continue;

          // Recompute authoritative price from catalogue and verify exact match with snapshot & order price
          let verifiedPrice: number;
          try {
            const authoritativePrice = calculateAuthoritativeMerchPrice(
              catData,
              mData.customSelections || {},
            );
            const snapshotAmount = Number(mData.priceSnapshot.totalAmount);
            const orderPrice = Number(mData.price);
            if (
              !Number.isFinite(authoritativePrice) ||
              authoritativePrice <= 0 ||
              snapshotAmount !== authoritativePrice ||
              orderPrice !== authoritativePrice
            ) {
              continue;
            }
            verifiedPrice = authoritativePrice;
          } catch {
            continue;
          }

          calculatedAmount += verifiedPrice;
          verifiedItems.push({
            type: "merch",
            merchId: item.merchId,
            amount: verifiedPrice,
          });
        }
      }
    }

    if (calculatedAmount <= 0) {
      throw new Error("Total calculated payable dues must be greater than zero.");
    }

    return {
      amount: calculatedAmount,
      verifiedIntent: {
        type: "finance_dues",
        reservationKey: generateReservationKey(intentData, playerId),
        playerId,
        userId: authUid,
        items: verifiedItems,
      },
    };
  } else if (type === "subscription") {
    const planId = intentData.planId;
    if (!planId) {
      throw new Error("planId is required for studio subscriptions.");
    }
    const planSnap = await db.collection("subscriptionPlans").doc(planId).get();
    if (!planSnap.exists) {
      throw new Error("Subscription plan not found.");
    }
    const plan = planSnap.data() || {};
    const planFee = Number(plan.fee);
    if (!planFee || planFee <= 0) {
      throw new Error("Invalid plan fee amount.");
    }

    const durationDays = Number(plan.durationDays || 30);

    // B2 (§16): immutable renewal snapshot. The renewal extends exactly the expiry observed now
    // (basisExpiry) on the membership subject (linked player, else the account document).
    const subject = await resolveRenewalSubject(db, (ref: any) => ref.get(), authUid);
    const subjectSnap = await db.collection(subject.kind === "player" ? "players" : "appUsers").doc(subject.id).get();
    const basisExpiry = currentExpiryOf(subjectSnap.exists ? subjectSnap.data() : null);

    return {
      amount: planFee,
      verifiedIntent: {
        type: "subscription",
        reservationKey: generateReservationKey(intentData, authUid),
        planId,
        userId: authUid,
        durationDays,
        renewal: {
          version: 1,
          subjectKind: subject.kind,
          subjectId: subject.id,
          planId,
          planName: String(plan.name || planId),
          durationDays,
          amountPaise: toPaise(planFee),
          basisExpiry,
        },
      },
    };
  } else if (type === "merch_order") {
    const orderPayload = intentData.orderPayload;
    if (!orderPayload || (!orderPayload.merchId && !intentData.merchId)) {
      throw new Error("merchId is required for merchandise orders.");
    }
    const merchId = orderPayload?.merchId || intentData.merchId;

    // Shop availability is enforced here, server-side: a disabled Shop accepts no
    // new purchases (existing orders, payments and webhooks are unaffected).
    await assertShopOpen(db);

    const playerId = orderPayload?.playerId || authUid;
    const isAuthorized = await verifyPlayerOwnership(db, authUid, playerId);
    if (!isAuthorized) {
      throw new Error("Unauthorized: you cannot order merchandise for another player.");
    }

    const merchSnap = await db.collection("merchandises").doc(merchId).get();
    if (!merchSnap.exists) {
      throw new Error("Merchandise item not found.");
    }
    const merch = merchSnap.data() || {};
    if (merch.status === "Not Accepting Orders" || merch.isHidden === true) {
      throw new Error("This merchandise item is not currently available for purchase.");
    }
    if (orderPayload?.quantity !== undefined && Number(orderPayload.quantity) !== 1) {
      throw new Error("Invalid merchandise quantity. Only 1 item per order is supported.");
    }
    const calculatedPrice = calculateAuthoritativeMerchPrice(
      merch,
      orderPayload?.customSelections || {},
    );
    const basePrice = Number(merch.basePrice ?? merch.price ?? 0);
    const calculatedAdditions = Math.max(0, calculatedPrice - basePrice);

    if (calculatedPrice <= 0) {
      throw new Error("Payable merchandise amount must be greater than zero.");
    }

    // B1 (PX-1): display name from the verified player record when available.
    let playerRecordName: string | undefined;
    try {
      const pSnap = await db.collection("players").doc(playerId).get();
      const name = pSnap.exists ? pSnap.data()?.name : undefined;
      if (typeof name === "string" && name.trim()) playerRecordName = name.trim();
    } catch {
      playerRecordName = undefined;
    }

    return {
      amount: calculatedPrice,
      verifiedIntent: {
        type: "merch_order",
        reservationKey: generateReservationKey(intentData, playerId),
        merchId,
        userId: authUid,
        // B1 (PX-1): allowlisted fields only. The client can never choose the order id or any
        // payment field; the webhook stores this payload under mo_{intentId} (create only).
        orderPayload: buildMerchOrderPayload(orderPayload, {
          merchId,
          merchName: merch.name || "Club Merchandise",
          price: calculatedPrice,
          customPriceAdditions: calculatedAdditions,
          playerId,
          playerRecordName,
        }),
      },
    };
  }

  throw new Error(`Unsupported intent type: ${type}`);
}
