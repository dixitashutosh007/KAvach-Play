import crypto from "crypto";

export interface WebhookEventDetails {
  event: string;
  paymentId: string;
  orderId: string;
  capturedPaise: number;
  capturedCurrency: string;
  intentId: string;
  notes: Record<string, any>;
  isFullyPaid?: boolean;
}

/**
 * Extracts normalized transaction details from Razorpay webhook payload,
 * correctly handling event-specific structures for 'payment.captured' and 'order.paid'.
 */
export function extractWebhookEventDetails(payload: any): WebhookEventDetails | null {
  if (!payload || typeof payload !== "object") return null;

  const event = String(payload.event || "");
  // Strictly allow only supported Razorpay events
  if (event !== "payment.captured" && event !== "order.paid") {
    return null;
  }

  const paymentEntity = payload.payload?.payment?.entity;
  const orderEntity = payload.payload?.order?.entity;

  if (!paymentEntity && !orderEntity) return null;

  // Ensure paymentId and orderId are never confused (order.entity.id is ALWAYS orderId)
  let paymentId = "";
  if (paymentEntity?.id && String(paymentEntity.id).trim().startsWith("pay_")) {
    paymentId = String(paymentEntity.id).trim();
  } else if (orderEntity?.payment_id && String(orderEntity.payment_id).trim().startsWith("pay_")) {
    paymentId = String(orderEntity.payment_id).trim();
  } else if (Array.isArray(orderEntity?.payments) && orderEntity.payments.length > 0) {
    const p0 = orderEntity.payments[0];
    const pid = typeof p0 === "string" ? p0 : p0?.id;
    if (pid && String(pid).trim().startsWith("pay_")) {
      paymentId = String(pid).trim();
    }
  }

  let orderId = "";
  if (paymentEntity?.order_id && String(paymentEntity.order_id).trim().startsWith("order_")) {
    orderId = String(paymentEntity.order_id).trim();
  } else if (orderEntity?.id && String(orderEntity.id).trim().startsWith("order_")) {
    orderId = String(orderEntity.id).trim();
  }

  // Raw amount check - do NOT default to valid number if missing
  const rawAmount =
    event === "order.paid"
      ? (orderEntity?.amount_paid ?? orderEntity?.amount)
      : paymentEntity?.amount;

  const capturedPaise =
    rawAmount !== undefined && rawAmount !== null && !isNaN(Number(rawAmount))
      ? Number(rawAmount)
      : 0;

  // Strict currency extraction - do NOT default to "INR" if missing from payload
  const rawCurrency = paymentEntity?.currency || orderEntity?.currency;
  const capturedCurrency = rawCurrency ? String(rawCurrency).trim().toUpperCase() : "";

  const notes = paymentEntity?.notes || orderEntity?.notes || {};
  const intentId = String(notes.intentId || "").trim();

  // Validate full payment on order.paid
  let isFullyPaid = true;
  if (event === "order.paid" && orderEntity) {
    const totalAmount = Number(orderEntity.amount || 0);
    const paidAmount = Number(orderEntity.amount_paid || 0);
    const status = String(orderEntity.status || "").toLowerCase();
    if (paidAmount < totalAmount || (totalAmount > 0 && status !== "paid")) {
      isFullyPaid = false;
    }
  }

  return {
    event,
    paymentId,
    orderId,
    capturedPaise,
    capturedCurrency,
    intentId,
    notes,
    isFullyPaid,
  };
}

/**
 * Validates captured webhook details against the stored intent (FIN-003).
 */
export function validateWebhookTransaction(
  intent: any,
  details: WebhookEventDetails,
): { ok: boolean; error?: string } {
  if (!intent) {
    return { ok: false, error: "Intent record is missing." };
  }

  // 1. Event verification
  if (details.event !== "payment.captured" && details.event !== "order.paid") {
    return { ok: false, error: `Unsupported webhook event type: ${details.event}` };
  }

  // 2. Order ID verification (both MUST be present and match)
  if (!intent.orderId || typeof intent.orderId !== "string" || !intent.orderId.trim()) {
    return { ok: false, error: "Stored intent is missing a valid orderId." };
  }
  if (!details.orderId || typeof details.orderId !== "string" || !details.orderId.trim()) {
    return { ok: false, error: "Incoming webhook event is missing a valid orderId." };
  }
  if (details.orderId !== intent.orderId) {
    return {
      ok: false,
      error: `Order ID mismatch: expected ${intent.orderId}, received ${details.orderId}`,
    };
  }

  // 3. Mandatory Payment ID verification for BOTH events (payment.captured AND order.paid)
  // Prevents financial fulfilment without an authoritative payment identifier
  if (!details.paymentId || !details.paymentId.startsWith("pay_") || details.paymentId.trim() === "pay_") {
    return {
      ok: false,
      error: `Missing or invalid payment ID (must start with 'pay_') for event '${details.event}'.`,
    };
  }

  // 4. Partial payment verification for order.paid
  if (details.event === "order.paid" && details.isFullyPaid === false) {
    return { ok: false, error: "Partial payment detected: order is not fully paid." };
  }

  // 5. Amount verification
  if (!details.capturedPaise || details.capturedPaise <= 0 || isNaN(details.capturedPaise)) {
    return { ok: false, error: "Missing or invalid captured amount." };
  }
  const expectedPaise = Math.round(Number(intent.amount) * 100);
  if (details.capturedPaise !== expectedPaise) {
    return {
      ok: false,
      error: `Amount mismatch: expected ${expectedPaise} paise, received ${details.capturedPaise} paise`,
    };
  }

  // 6. Currency verification (Strict: no silent defaulting on stored intent or payload)
  if (!intent.currency || typeof intent.currency !== "string" || !intent.currency.trim()) {
    return { ok: false, error: "Stored intent is missing a valid currency." };
  }
  if (!details.capturedCurrency) {
    return { ok: false, error: "Missing currency in webhook payload." };
  }
  const expectedCurrency = intent.currency.trim().toUpperCase();
  if (details.capturedCurrency !== expectedCurrency) {
    return {
      ok: false,
      error: `Currency mismatch: expected ${expectedCurrency}, received ${details.capturedCurrency}`,
    };
  }

  return { ok: true };
}

/**
 * Concurrency-safe, transactional intent fulfillment.
 * Executes atomically inside a Firestore transaction (FIN-002).
 * Prevents race conditions and duplicate record generation on simultaneous webhook deliveries.
 */
export async function processWebhookIntentTransaction(
  db: any,
  details: WebhookEventDetails,
  rawPayload?: any,
): Promise<{ success: boolean; alreadyProcessed?: boolean; error?: string }> {
  if (!details.intentId) {
    return { success: false, error: "Missing intentId in event details." };
  }

  const intentRef = db.collection("razorpayIntents").doc(details.intentId);

  return await db.runTransaction(async (transaction: any) => {
    // 1. Transactional read of intent
    const intentSnap = await transaction.get(intentRef);
    if (!intentSnap.exists) {
      throw new Error(`Intent not found: ${details.intentId}`);
    }

    const intent = intentSnap.data() || {};

    // 2. Validate transaction against intent (FIN-003) - MUST validate before idempotency check
    const validation = validateWebhookTransaction(intent, details);
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    // 3. Idempotency & Replay check: if already processed, enforce identical replay vs conflicting replay
    if (intent.status === "paid") {
      if (
        intent.razorpayPaymentId &&
        String(intent.razorpayPaymentId).trim() !== String(details.paymentId).trim()
      ) {
        throw new Error(
          `Conflicting payment ID replay: intent was already fulfilled with payment ${intent.razorpayPaymentId}, received ${details.paymentId}`,
        );
      }
      return { success: true, alreadyProcessed: true };
    }

    const now = new Date();
    const type = intent.type;

    // 3. Perform any necessary reads BEFORE writes (Firestore transaction requirement)
    let currentExpiry: string | undefined;
    let playerDocRef: any = null;

    // Collect and resolve all player references before writes to safely redirect merged players
    // and block active merges with retryable abort (Finding 1F-R R10).
    const playerIdsToRead = new Set<string>();
    if (intent.userId) playerIdsToRead.add(String(intent.userId).trim());
    if (intent.playerId) playerIdsToRead.add(String(intent.playerId).trim());
    if (Array.isArray(intent.lateFeeItems)) {
      for (const lf of intent.lateFeeItems) {
        if (lf?.playerId) playerIdsToRead.add(String(lf.playerId).trim());
      }
    }

    const resolvedPlayerMap: Record<string, string> = {};
    for (const pid of playerIdsToRead) {
      if (!pid) continue;
      const pSnap = await transaction.get(db.collection("players").doc(pid));
      if (pSnap.exists) {
        const pData = pSnap.data() || {};
        if (pData.mergeStatus === "in_progress") {
          throw new Error(`Player ${pid} merge is currently in progress; retry requested.`);
        }
        if (pData.mergedInto && typeof pData.mergedInto === "string" && pData.mergedInto.trim()) {
          resolvedPlayerMap[pid] = pData.mergedInto.trim();
        } else {
          resolvedPlayerMap[pid] = pid;
        }

        if (type === "subscription" && (pid === intent.userId || resolvedPlayerMap[pid] === intent.userId)) {
          let subPlayerSnap = pSnap;
          if (pData.mergedInto) {
            const keeperSnap = await transaction.get(db.collection("players").doc(pData.mergedInto.trim()));
            if (keeperSnap.exists) {
              subPlayerSnap = keeperSnap;
            }
          }
          playerDocRef = subPlayerSnap.ref;
          const subData = subPlayerSnap.data() || {};
          currentExpiry = subData.studioExpiryDate || subData.studioEndDate;
        }
      } else {
        resolvedPlayerMap[pid] = pid;
      }
    }

    // 4. Downstream state transitions within the transaction (FIN-002)
    if (type === "match") {
      if (intent.matchId && intent.paymentId) {
        const paymentRef = db
          .collection("matches")
          .doc(intent.matchId)
          .collection("payments")
          .doc(intent.paymentId);

        transaction.update(paymentRef, {
          status: "Paid",
          paymentMethod: "razorpay",
          razorpayPaymentId: details.paymentId,
          feeCollectedAmount: intent.amount || 0,
          updatedAt: now,
        });
      }

      if (Array.isArray(intent.lateFeeItems)) {
        for (const lf of intent.lateFeeItems) {
          const targetPlayerId = resolvedPlayerMap[lf.playerId] || lf.playerId;
          const feeDocId = crypto.randomUUID();
          const feeRef = db
            .collection("players")
            .doc(targetPlayerId)
            .collection("otherFees")
            .doc(feeDocId);

          transaction.set(feeRef, {
            id: feeDocId,
            playerId: targetPlayerId,
            ...(targetPlayerId !== lf.playerId ? { originalPlayerId: lf.playerId } : {}),
            title: lf.label || "Late Fee",
            amount: lf.amount || 0,
            comment: "Auto-levied late fee penalty",
            templateId: lf.templateId || "",
            status: "Paid",
            paymentMethod: "razorpay",
            razorpayPaymentId: details.paymentId,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    } else if (type === "finance_dues") {
      const items = Array.isArray(intent.items) ? intent.items : [];
      for (const item of items) {
        if (item.type === "match" && item.matchId && item.paymentId) {
          const paymentRef = db
            .collection("matches")
            .doc(item.matchId)
            .collection("payments")
            .doc(item.paymentId);

          transaction.update(paymentRef, {
            status: "Paid",
            paymentMethod: "razorpay",
            razorpayPaymentId: details.paymentId,
            feeCollectedAmount: item.amount || 0,
            updatedAt: now,
          });
        } else if (item.type === "other" && item.feeId && intent.playerId) {
          const targetPlayerId = resolvedPlayerMap[intent.playerId] || intent.playerId;
          const feeRef = db
            .collection("players")
            .doc(targetPlayerId)
            .collection("otherFees")
            .doc(item.feeId);

          transaction.update(feeRef, {
            status: "Paid",
            paymentMethod: "razorpay",
            razorpayPaymentId: details.paymentId,
            updatedAt: now,
          });
        } else if (item.isLateFee && intent.playerId) {
          const targetPlayerId = resolvedPlayerMap[intent.playerId] || intent.playerId;
          const feeDocId = crypto.randomUUID();
          const feeRef = db
            .collection("players")
            .doc(targetPlayerId)
            .collection("otherFees")
            .doc(feeDocId);

          transaction.set(feeRef, {
            id: feeDocId,
            playerId: targetPlayerId,
            ...(targetPlayerId !== intent.playerId ? { originalPlayerId: intent.playerId } : {}),
            title: item.lateFeeLabel || "Late Fee",
            amount: item.lateFeeAmount || 0,
            comment: "Auto-levied late fee penalty",
            templateId: item.lateFeeTemplateId || "",
            status: "Paid",
            paymentMethod: "razorpay",
            razorpayPaymentId: details.paymentId,
            createdAt: now,
            updatedAt: now,
          });
        } else if (item.type === "merch" && item.merchId) {
          const merchOrderRef = db.collection("merchOrders").doc(item.merchId);
          transaction.update(merchOrderRef, {
            paymentStatus: "Paid",
            razorpayPaymentId: details.paymentId,
            updatedAt: now,
          });
        }
      }
    } else if (type === "subscription") {
      if (intent.planId && intent.userId) {
        const targetUserId = resolvedPlayerMap[intent.userId] || intent.userId;
        const durationDays = Number(intent.durationDays || 30);
        const toYMD = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

        let baseDate = now;
        if (currentExpiry) {
          const exp = new Date(currentExpiry);
          if (!isNaN(exp.getTime()) && exp > now) {
            baseDate = exp;
          }
        }
        const endDateObj = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
        const endDate = toYMD(endDateObj);

        const subHistoryRef = db.collection("subscriptionHistory").doc();
        transaction.set(subHistoryRef, {
          planId: intent.planId,
          playerId: targetUserId,
          ...(targetUserId !== intent.userId ? { originalPlayerId: intent.userId } : {}),
          adminId: "webhook",
          adminName: "Razorpay Webhook",
          oldExpiryDate: currentExpiry || undefined,
          newExpiryDate: endDate,
          planName: intent.planId,
          paidAmount: intent.amount || 0,
          razorpayPaymentId: details.paymentId,
          createdAt: now,
        });

        if (playerDocRef) {
          transaction.update(playerDocRef, {
            studioExpiryDate: endDate,
            studioEndDate: endDate,
            isStudioMember: true,
            updatedAt: now,
          });
        }

        const appUserRef = db.collection("appUsers").doc(intent.userId);
        transaction.set(
          appUserRef,
          {
            studioExpiryDate: endDate,
            studioEndDate: endDate,
            isStudioMember: true,
            updatedAt: now,
          },
          { merge: true },
        );
      }
    } else if (type === "merch_order") {
      const orderPayload = intent.orderPayload || {};
      const orderId = orderPayload.id || crypto.randomUUID();
      const orderRef = db.collection("merchOrders").doc(orderId);

      transaction.set(orderRef, {
        ...orderPayload,
        id: orderId,
        paymentStatus: "Paid",
        orderStatus: orderPayload.orderStatus || "Order Placed",
        isManual: false,
        razorpayPaymentId: details.paymentId,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Mark intent 'paid' atomically within the transaction
    transaction.update(intentRef, {
      status: "paid",
      razorpayPaymentId: details.paymentId,
      rawPayload: rawPayload || null,
      updatedAt: now,
    });

    if (intent.reservationKey) {
      const reservationRef = db.collection("paymentReservations").doc(intent.reservationKey);
      transaction.set(
        reservationRef,
        {
          status: "active",
          isPaid: true,
          paidAt: now,
          razorpayPaymentId: details.paymentId,
          updatedAt: now,
        },
        { merge: true },
      );
    }

    return { success: true };
  });
}
