import crypto from "crypto";
import { computeLateFees } from "./utils.ts";

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
  isWaiting?: boolean;
  conflict?: boolean;
  needsReconciliation?: boolean;
  error?: string;
  existingOrder?: {
    orderId: string;
    intentId: string;
    amount: number;
    currency: string;
  };
}

export interface ReservationValidationResult {
  valid: boolean;
  conflict?: boolean;
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
      const expiresAt = data.expiresAt
        ? data.expiresAt.toDate
          ? data.expiresAt.toDate()
          : new Date(data.expiresAt)
        : new Date(0);

      // Check if existing reservation is active or in activation_failed state and unexpired
      if (expiresAt > now) {
        // If an order already exists (active or activation_failed recovery)
        if ((data.status === "active" || data.status === "activation_failed") && data.orderId) {
          // Strictly validate reservation identity, amount, currency, and IDs (FIN-001)
          const validation = validateReservationForReuse(
            data,
            reservationKey,
            authUid,
            payableAmount,
            currency,
          );

          if (!validation.valid) {
            return {
              acquired: false,
              conflict: true,
              error: validation.reason,
            };
          }

          // If in activation_failed state, reconcile to active within this transaction
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
        }

        // Check if previous attempt suffered ambiguous API failure needing external reconciliation
        if (data.status === "reconciliation_required" || data.status === "reconciliation_failed") {
          return {
            acquired: false,
            needsReconciliation: true,
            error: "External order reconciliation required before new order can be created.",
          };
        }

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

    transaction.set(reservationRef, {
      reservationKey,
      status: "reserving",
      reservationToken,
      fenceVersion: newFenceVersion,
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
 * Reconciles an ambiguous reservation against Razorpay's API (FIN-001).
 * Queries Razorpay by receipt:
 * - If order found at Razorpay: activates reservation with found orderId.
 * - If confirmed no order at Razorpay (items length === 0): transitions status to 'failed', allowing safe new order creation.
 * - If Razorpay query fails or times out: transitions status to 'reconciliation_failed' and throws error.
 */
export async function reconcileAmbiguousReservation(
  razorpayInstance: any,
  db: any,
  reservationKey: string,
  authUid: string,
  payableAmount: number,
  currency: string,
): Promise<{ reconciled: boolean; existingOrder?: any; canRetry?: boolean; error?: string }> {
  const reservationRef = db.collection("paymentReservations").doc(reservationKey);

  // 1. Read reservation to get receipt
  const snap = await reservationRef.get();
  if (!snap.exists) {
    return { reconciled: false, canRetry: true };
  }
  const data = snap.data() || {};

  // Validate ownership before attempting reconciliation
  if (data.userId && data.userId !== authUid) {
    return { reconciled: false, error: "Reservation belongs to a different user." };
  }

  const receipt = data.receipt;
  if (!receipt) {
    return { reconciled: false, error: "Reservation missing receipt for reconciliation." };
  }

  try {
    // 2. Query Razorpay for orders containing this receipt
    const response = await razorpayInstance.orders.all({ receipt });
    const items = response?.items || [];
    const now = new Date();

    if (items.length > 0) {
      // Order WAS created at Razorpay! Reconcile and activate it.
      const foundOrder = items[0];
      await reservationRef.update({
        status: "active",
        orderId: foundOrder.id,
        updatedAt: now,
      });

      return {
        reconciled: true,
        existingOrder: {
          orderId: foundOrder.id,
          intentId: data.intentId || "",
          amount: data.amount || payableAmount,
          currency: data.currency || currency,
        },
      };
    } else {
      // Confirmed by Razorpay: NO order was created for this receipt!
      await reservationRef.update({
        status: "failed",
        error: "Reconciled with Razorpay: no external order exists.",
        expiresAt: now,
        updatedAt: now,
      });

      return { reconciled: true, canRetry: true };
    }
  } catch (reconcileErr: any) {
    // Razorpay query failed; transition to reconciliation_failed state
    const now = new Date();
    await reservationRef.update({
      status: "reconciliation_failed",
      reconciliationError: reconcileErr.message || "Failed to reach Razorpay during reconciliation",
      updatedAt: now,
    });
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
 */
export async function verifyPlayerOwnership(
  db: any,
  authUid: string,
  targetPlayerId: string,
): Promise<boolean> {
  if (!targetPlayerId || !authUid) return false;
  if (targetPlayerId === authUid) return true;

  // Check players collection
  try {
    const pDoc = await db.collection("players").doc(targetPlayerId).get();
    if (pDoc.exists && pDoc.data()?.authUid === authUid) {
      return true;
    }
  } catch {
    // ignore query failure and continue to appUsers check
  }

  // Check appUsers collection
  try {
    const uDoc = await db.collection("appUsers").doc(authUid).get();
    if (uDoc.exists && uDoc.data()?.playerId === targetPlayerId) {
      return true;
    }
  } catch {
    // ignore
  }

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
      if (matchData.date) {
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
          if (mData.paymentStatus === "Paid") continue;

          const price = Number(mData.price || 0);
          if (price > 0) {
            calculatedAmount += price;
            verifiedItems.push({
              type: "merch",
              merchId: item.merchId,
              amount: price,
            });
          }
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

    return {
      amount: planFee,
      verifiedIntent: {
        type: "subscription",
        reservationKey: generateReservationKey(intentData, authUid),
        planId,
        userId: authUid,
        durationDays: Number(plan.durationDays || 30),
      },
    };
  } else if (type === "merch_order") {
    const orderPayload = intentData.orderPayload;
    if (!orderPayload || (!orderPayload.merchId && !intentData.merchId)) {
      throw new Error("merchId is required for merchandise orders.");
    }
    const merchId = orderPayload?.merchId || intentData.merchId;

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
    const calculatedPrice = calculateAuthoritativeMerchPrice(
      merch,
      orderPayload?.customSelections || {},
    );

    if (calculatedPrice <= 0) {
      throw new Error("Payable merchandise amount must be greater than zero.");
    }

    return {
      amount: calculatedPrice,
      verifiedIntent: {
        type: "merch_order",
        reservationKey: generateReservationKey(intentData, playerId),
        merchId,
        userId: authUid,
        orderPayload: {
          ...(orderPayload || {}),
          merchId,
          merchName: merch.name || orderPayload?.merchName || "Club Merchandise",
          price: calculatedPrice,
          playerId,
        },
      },
    };
  }

  throw new Error(`Unsupported intent type: ${type}`);
}
