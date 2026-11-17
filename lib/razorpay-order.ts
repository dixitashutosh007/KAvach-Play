import { computeLateFees } from "./utils.ts";

/**
 * Generates an obligation reservation key to detect duplicate concurrent payment requests (FIN-001).
 */
export function generateReservationKey(intentData: any, playerId: string): string {
  if (intentData.type === "match") {
    return `match_${intentData.matchId}_${intentData.paymentId}`;
  }
  if (intentData.type === "finance_dues") {
    const itemIds = Array.isArray(intentData.items)
      ? intentData.items.map((i: any) => i.paymentId || i.feeId || i.merchId || i.matchId).filter(Boolean).sort().join("_")
      : "";
    return `dues_${playerId}_${itemIds}`;
  }
  if (intentData.type === "subscription") {
    return `sub_${playerId}_${intentData.planId}`;
  }
  if (intentData.type === "merch_order") {
    const merchId = intentData.orderPayload?.merchId || intentData.merchId;
    return `merch_${merchId}_${playerId}`;
  }
  return `intent_${playerId}_${Date.now()}`;
}

export interface PaymentReservationResult {
  acquired: boolean;
  isWaiting?: boolean;
  conflict?: boolean;
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
 * Uses Firestore transactions on /paymentReservations/{reservationKey} to prevent concurrent
 * requests from creating duplicate Razorpay orders for the same obligation.
 */
export async function acquirePaymentReservation(
  db: any,
  reservationKey: string,
  authUid: string,
  payableAmount: number,
  currency: string,
  lockTtlMs = 30 * 1000,
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
      // If expired, or status === "failed", it will be overwritten below
    }

    // Acquire reservation lock atomically
    transaction.set(reservationRef, {
      reservationKey,
      status: "reserving",
      userId: authUid,
      amount: payableAmount,
      currency,
      createdAt: now,
      expiresAt: new Date(now.getTime() + lockTtlMs),
    });

    return { acquired: true };
  });
}

/**
 * Activates reservation with created Razorpay order details.
 * Must propagate errors if Firestore update fails (FIN-001).
 */
export async function activatePaymentReservation(
  db: any,
  reservationKey: string,
  orderId: string,
  intentId: string,
  orderTtlMs = 15 * 60 * 1000,
): Promise<void> {
  const reservationRef = db.collection("paymentReservations").doc(reservationKey);
  const now = new Date();
  await reservationRef.update({
    status: "active",
    orderId,
    intentId,
    expiresAt: new Date(now.getTime() + orderTtlMs),
    updatedAt: now,
  });
}

/**
 * Records an activation failure when a Razorpay order was already created externally.
 * Preserves the orderId so the order can be safely reconciled and reused on retry (FIN-001),
 * preventing double-creation of Razorpay orders.
 */
export async function recordActivationFailure(
  db: any,
  reservationKey: string,
  orderId: string,
  intentId: string | undefined,
  userId: string,
  amount: number,
  currency: string,
  errorMessage?: string,
  orderTtlMs = 15 * 60 * 1000,
): Promise<void> {
  try {
    const reservationRef = db.collection("paymentReservations").doc(reservationKey);
    const now = new Date();
    await reservationRef.set(
      {
        reservationKey,
        status: "activation_failed",
        orderId,
        intentId: intentId || "",
        userId,
        amount,
        currency,
        error: errorMessage || "Activation failed after order creation",
        expiresAt: new Date(now.getTime() + orderTtlMs),
        updatedAt: now,
      },
      { merge: true },
    );
  } catch (err) {
    console.error("[recordActivationFailure] Failed to record activation failure:", err);
  }
}

/**
 * Releases reservation on Razorpay failure so retries are never permanently blocked.
 * Only call when NO external Razorpay order was created (FIN-001).
 */
export async function releasePaymentReservation(
  db: any,
  reservationKey: string,
  errorMessage?: string,
): Promise<void> {
  try {
    const reservationRef = db.collection("paymentReservations").doc(reservationKey);
    const now = new Date();
    await reservationRef.update({
      status: "failed",
      error: errorMessage || "Order creation failed",
      expiresAt: now,
      updatedAt: now,
    });
  } catch {
    // ignore
  }
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
