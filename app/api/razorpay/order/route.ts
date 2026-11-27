import { NextResponse } from "next/server.js";
import Razorpay from "razorpay";
import { requireAuth } from "../../../../lib/server-auth.ts";
import { ShopClosedError } from "../../../../lib/shop-config.ts";
import {
  getServerFirestore,
  arePaymentOperationsEnabled,
  isStagingTestCheckoutEnabled,
} from "../../../../lib/server-db.ts";
import {
  derivePayableAmount,
  validateCurrency,
  acquirePaymentReservation,
  renewReservationLease,
  activatePaymentReservation,
  releasePaymentReservation,
  recordActivationFailure,
  recordReconciliationRequired,
  reconcileAmbiguousReservation,
  isAmbiguousRazorpayError,
  validateReservationForReuse,
  generateAuthoritativeReceipt,
  setReservationIntentId,
  verifyAndRepairIntent,
} from "../../../../lib/razorpay-order.ts";

export async function POST(req: Request) {
  // 1. Strict Payment Mode Check (Production or Fail-Closed Staging Test Gate)
  const prodPaymentsEnabled = arePaymentOperationsEnabled();
  const stagingTestEnabled = !prodPaymentsEnabled && isStagingTestCheckoutEnabled();
  if (!prodPaymentsEnabled && !stagingTestEnabled) {
    return NextResponse.json(
      {
        error:
          "Payment order creation is disabled in this environment (development / sandbox mode). Live Razorpay orders cannot be created on non-production databases.",
        code: "PAYMENTS_DISABLED",
      },
      { status: 403 },
    );
  }

  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const {
      currency = "INR",
      receipt = "receipt_test_1",
      notes = {},
      intentData,
    } = body;

    // Strict Currency Enforcement (FIN-001)
    if (!validateCurrency(currency)) {
      return NextResponse.json(
        { error: "Only INR currency is supported." },
        { status: 400 },
      );
    }

    const finalKeyId = stagingTestEnabled
      ? (process.env.RAZORPAY_KEY_ID || "").trim()
      : process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
    const finalKeySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();

    if (stagingTestEnabled && !(finalKeyId || "").startsWith("rzp_test_")) {
      return NextResponse.json(
        { error: "Staging test checkout requires a verified rzp_test_ key.", code: "PAYMENTS_DISABLED" },
        { status: 403 },
      );
    }

    if (!finalKeyId || !finalKeySecret) {
      const missing = [
        !finalKeyId && "RAZORPAY_KEY_ID (or NEXT_PUBLIC_RAZORPAY_KEY_ID)",
        !finalKeySecret && "RAZORPAY_KEY_SECRET",
      ].filter(Boolean);
      console.error("[razorpay/order] Missing env vars:", missing.join(", "));
      return NextResponse.json(
        {
          error: `Razorpay keys missing at runtime: ${missing.join(", ")}. Set them in environment variables and redeploy.`,
        },
        { status: 500 },
      );
    }

    const db = getServerFirestore();
    let payableAmount: number;
    let storedIntentData: any;

    if (intentData) {
      // Derive authoritative amount server-side; client `amount` is discarded (FIN-001)
      let derived;
      try {
        derived = await derivePayableAmount(db, auth.uid, intentData);
      } catch (err) {
        if (err instanceof ShopClosedError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
        }
        throw err;
      }
      payableAmount = derived.amount;
      storedIntentData = derived.verifiedIntent;
    } else {
      return NextResponse.json(
        { error: "Payment intentData is required." },
        { status: 400 },
      );
    }

    const reservationKey = storedIntentData.reservationKey;
    let reservationAcquired = false;
    let reservationToken: string | undefined;
    const authoritativeReceipt = reservationKey
      ? generateAuthoritativeReceipt(reservationKey)
      : "rcpt_generic";

    if (reservationKey) {
      const resResult = await acquirePaymentReservation(
        db,
        reservationKey,
        auth.uid,
        payableAmount,
        currency,
      );

      if (resResult.isPaid) {
        return NextResponse.json(
          { error: resResult.error || `Obligation has already been paid via order ${resResult.orderId || ""}.` },
          { status: 409 },
        );
      }

      if (resResult.conflict && !resResult.needsReconciliation) {
        return NextResponse.json(
          { error: resResult.error || "Payment reservation conflict." },
          { status: 409 },
        );
      }

      if (resResult.needsReconciliation) {
        // Previous attempt suffered ambiguous gateway failure, expired active order, or amount change;
        // reconcile with Razorpay BEFORE checking existingOrder so changed-fee orders are superseded.
        const rzInstance = new Razorpay({
          key_id: finalKeyId,
          key_secret: finalKeySecret,
        });
        const recResult = await reconcileAmbiguousReservation(
          rzInstance,
          db,
          reservationKey,
          auth.uid,
          payableAmount,
          currency,
        );

        if (recResult.isPaid) {
          return NextResponse.json(
            { error: `Obligation has already been paid via order ${recResult.existingOrder?.orderId || ""}.` },
            { status: 409 },
          );
        }

        if (recResult.existingOrder && recResult.existingOrder.orderId) {
          if (recResult.existingOrder.isPaid) {
            return NextResponse.json(
              { error: `Obligation has already been paid via order ${recResult.existingOrder.orderId}.` },
              { status: 409 },
            );
          }

          // Verify and repair intent consistency before returning reconciled order (FIN-001)
          const repairRes = await verifyAndRepairIntent(
            db,
            recResult.existingOrder.intentId,
            recResult.existingOrder.orderId,
            {
              userId: auth.uid,
              amount: payableAmount,
              currency,
              reservationKey,
            },
          );

          if (!repairRes.ok) {
            return NextResponse.json(
              { error: `Payment intent consistency error: ${repairRes.error}` },
              { status: 409 },
            );
          }

          return NextResponse.json({
            id: recResult.existingOrder.orderId,
            amount: Math.round(recResult.existingOrder.amount * 100),
            currency: recResult.existingOrder.currency || currency,
            receipt: authoritativeReceipt,
            status: "created",
            intentId: recResult.existingOrder.intentId,
            notes: { ...notes, intentId: recResult.existingOrder.intentId, reusedExistingOrder: true },
          });
        }

        if (recResult.superseded && recResult.canRetry && recResult.reservationToken) {
          reservationAcquired = true;
          reservationToken = recResult.reservationToken;
        } else {
          return NextResponse.json(
            { error: recResult.error || "Order reconciliation pending with payment gateway. Please retry." },
            { status: 503 },
          );
        }
      } else if (resResult.existingOrder && resResult.existingOrder.orderId) {
        if (resResult.existingOrder.isPaid) {
          return NextResponse.json(
            { error: `Obligation has already been paid via order ${resResult.existingOrder.orderId}.` },
            { status: 409 },
          );
        }

        // Verify and repair intent consistency before returning existing order (FIN-001)
        const repairRes = await verifyAndRepairIntent(
          db,
          resResult.existingOrder.intentId,
          resResult.existingOrder.orderId,
          {
            userId: auth.uid,
            amount: payableAmount,
            currency,
            reservationKey,
          },
        );

        if (!repairRes.ok) {
          return NextResponse.json(
            { error: `Payment intent consistency error: ${repairRes.error}` },
            { status: 409 },
          );
        }

        return NextResponse.json({
          id: resResult.existingOrder.orderId,
          amount: Math.round(resResult.existingOrder.amount * 100),
          currency: resResult.existingOrder.currency || currency,
          receipt: authoritativeReceipt,
          status: "created",
          intentId: resResult.existingOrder.intentId,
          notes: { ...notes, intentId: resResult.existingOrder.intentId, reusedExistingOrder: true },
        });
      }

      if (resResult.isWaiting) {
        // Another concurrent request is actively creating the order right now.
        // Poll for up to 3 seconds (6 attempts x 500ms).
        let waitOrder: any = null;
        let reservationFailed = false;
        let reservationNeedsReconciliation = false;

        for (let attempt = 0; attempt < 6; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const docSnap = await db.collection("paymentReservations").doc(reservationKey).get();
          if (docSnap.exists) {
            const data = docSnap.data() || {};
            // Regression check: payment became paid during polling
            if (data.isPaid === true || data.status === "paid") {
              return NextResponse.json(
                { error: `Obligation has already been paid via order ${data.orderId || ""}.` },
                { status: 409 },
              );
            }
            if ((data.status === "active" || data.status === "activation_failed") && data.orderId) {
              waitOrder = data;
              break;
            }
            if (data.status === "reconciliation_required") {
              reservationNeedsReconciliation = true;
              break;
            }
            if (data.status === "failed") {
              reservationFailed = true;
              break;
            }
          }
        }

        if (waitOrder && waitOrder.orderId) {
          if (waitOrder.isPaid === true || waitOrder.status === "paid") {
            return NextResponse.json(
              { error: `Obligation has already been paid via order ${waitOrder.orderId}.` },
              { status: 409 },
            );
          }

          // Strictly validate identity and amount before reusing order (FIN-001)
          const validation = validateReservationForReuse(
            waitOrder,
            reservationKey,
            auth.uid,
            payableAmount,
            currency,
          );

          if (!validation.valid) {
            return NextResponse.json(
              { error: validation.reason || "Payment reservation conflict." },
              { status: 409 },
            );
          }

          // Verify and repair intent consistency before returning reused order (FIN-001)
          const repairRes = await verifyAndRepairIntent(
            db,
            waitOrder.intentId,
            waitOrder.orderId,
            {
              userId: auth.uid,
              amount: payableAmount,
              currency,
              reservationKey,
            },
          );

          if (!repairRes.ok) {
            return NextResponse.json(
              { error: `Payment intent consistency error: ${repairRes.error}` },
              { status: 409 },
            );
          }

          return NextResponse.json({
            id: waitOrder.orderId,
            amount: Math.round(waitOrder.amount * 100),
            currency: waitOrder.currency || currency,
            receipt: authoritativeReceipt,
            status: "created",
            intentId: waitOrder.intentId,
            notes: { ...notes, intentId: waitOrder.intentId, reusedExistingOrder: true },
          });
        }

        if (reservationNeedsReconciliation) {
          const rzInstance = new Razorpay({
            key_id: finalKeyId,
            key_secret: finalKeySecret,
          });
          const recResult = await reconcileAmbiguousReservation(
            rzInstance,
            db,
            reservationKey,
            auth.uid,
            payableAmount,
            currency,
          );

          if (recResult.isPaid) {
            return NextResponse.json(
              { error: `Obligation has already been paid via order ${recResult.existingOrder?.orderId || ""}.` },
              { status: 409 },
            );
          }

          if (recResult.existingOrder && recResult.existingOrder.orderId) {
            if (recResult.existingOrder.isPaid) {
              return NextResponse.json(
                { error: `Obligation has already been paid via order ${recResult.existingOrder.orderId}.` },
                { status: 409 },
              );
            }

            const repairRes = await verifyAndRepairIntent(
              db,
              recResult.existingOrder.intentId,
              recResult.existingOrder.orderId,
              {
                userId: auth.uid,
                amount: payableAmount,
                currency,
                reservationKey,
              },
            );

            if (!repairRes.ok) {
              return NextResponse.json(
                { error: `Payment intent consistency error: ${repairRes.error}` },
                { status: 409 },
              );
            }

            return NextResponse.json({
              id: recResult.existingOrder.orderId,
              amount: Math.round(recResult.existingOrder.amount * 100),
              currency: recResult.existingOrder.currency || currency,
              receipt: authoritativeReceipt,
              status: "created",
              intentId: recResult.existingOrder.intentId,
              notes: { ...notes, intentId: recResult.existingOrder.intentId, reusedExistingOrder: true },
            });
          }

          if (recResult.superseded && recResult.canRetry && recResult.reservationToken) {
            reservationAcquired = true;
            reservationToken = recResult.reservationToken;
          } else if (!recResult.canRetry) {
            return NextResponse.json(
              { error: recResult.error || "Order reconciliation pending with payment gateway. Please retry." },
              { status: 503 },
            );
          } else {
            reservationFailed = true;
          }
        }

        if (reservationFailed) {
          // The other concurrent request failed. Safely attempt to reacquire reservation through a new atomic transaction.
          const retryRes = await acquirePaymentReservation(
            db,
            reservationKey,
            auth.uid,
            payableAmount,
            currency,
          );

          if (retryRes.isPaid) {
            return NextResponse.json(
              { error: retryRes.error || `Obligation has already been paid via order ${retryRes.orderId || ""}.` },
              { status: 409 },
            );
          }

          if (retryRes.conflict) {
            return NextResponse.json(
              { error: retryRes.error || "Payment reservation conflict." },
              { status: 409 },
            );
          }

          if (retryRes.existingOrder && retryRes.existingOrder.orderId) {
            if (retryRes.existingOrder.isPaid) {
              return NextResponse.json(
                { error: `Obligation has already been paid via order ${retryRes.existingOrder.orderId}.` },
                { status: 409 },
              );
            }

            const repairRes = await verifyAndRepairIntent(
              db,
              retryRes.existingOrder.intentId,
              retryRes.existingOrder.orderId,
              {
                userId: auth.uid,
                amount: payableAmount,
                currency,
                reservationKey,
              },
            );

            if (!repairRes.ok) {
              return NextResponse.json(
                { error: `Payment intent consistency error: ${repairRes.error}` },
                { status: 409 },
              );
            }

            return NextResponse.json({
              id: retryRes.existingOrder.orderId,
              amount: Math.round(retryRes.existingOrder.amount * 100),
              currency: retryRes.existingOrder.currency || currency,
              receipt: authoritativeReceipt,
              status: "created",
              intentId: retryRes.existingOrder.intentId,
              notes: { ...notes, intentId: retryRes.existingOrder.intentId, reusedExistingOrder: true },
            });
          }

          if (retryRes.acquired) {
            reservationAcquired = true;
            reservationToken = retryRes.reservationToken;
          } else {
            return NextResponse.json(
              { error: "Payment order creation failed and reservation could not be reacquired. Please retry." },
              { status: 409 },
            );
          }
        } else {
          // Polling timed out while still reserving
          return NextResponse.json(
            { error: "Payment order creation is already in progress. Please wait a moment and retry." },
            { status: 409 },
          );
        }
      } else if (!reservationAcquired) {
        reservationAcquired = resResult.acquired;
        reservationToken = resResult.reservationToken;
      }

      // Safety assertion: NEVER proceed to order creation without acquiring reservation (FIN-001)
      if (!reservationAcquired || !reservationToken) {
        return NextResponse.json(
          { error: "Unable to acquire payment reservation. Please retry." },
          { status: 409 },
        );
      }
    }

    const instance = new Razorpay({
      key_id: finalKeyId,
      key_secret: finalKeySecret,
    });

    let intentRef: any;
    let order: any;
    let renewalTimer: NodeJS.Timeout | null = null;
    let leaseLost = false;
    let leaseLostReason: string | undefined;

    try {
      intentRef = await db.collection("razorpayIntents").add({
        ...storedIntentData,
        amount: payableAmount,
        currency,
        userId: auth.uid,
        reservationKey,
        createdAt: new Date(),
        status: "pending",
      });

      // P0: Store intentId in reservation BEFORE calling external Razorpay order creation
      if (reservationKey && reservationToken) {
        await setReservationIntentId(db, reservationKey, reservationToken, intentRef.id);
      }

      const finalNotes = { ...notes, intentId: intentRef.id, reservationKey };

      const options = {
        amount: Math.round(payableAmount * 100), // amount in smallest currency unit (paise)
        currency,
        receipt: authoritativeReceipt,
        notes: finalNotes,
      };

      // P0: Safe lease renewal while external Razorpay order creation request is in progress
      const renewalIntervalMs = process.env.RESERVATION_RENEWAL_INTERVAL_MS
        ? Number(process.env.RESERVATION_RENEWAL_INTERVAL_MS)
        : 5000;

      if (reservationKey && reservationToken) {
        renewalTimer = setInterval(async () => {
          try {
            const res = await renewReservationLease(db, reservationKey, reservationToken!);
            if (!res.renewed) {
              leaseLost = true;
              leaseLostReason = res.error;
              if (renewalTimer) clearInterval(renewalTimer);
            }
          } catch (err: any) {
            leaseLost = true;
            leaseLostReason = err?.message;
            if (renewalTimer) clearInterval(renewalTimer);
          }
        }, renewalIntervalMs);
      }

      try {
        order = await instance.orders.create(options);
      } finally {
        if (renewalTimer) {
          clearInterval(renewalTimer);
          renewalTimer = null;
        }
      }

      // If renewal failed or fencing was lost during external order creation:
      if (leaseLost) {
        return NextResponse.json(
          { error: `Payment reservation lease lost during order creation: ${leaseLostReason || "Fencing conflict"}. Please retry.` },
          { status: 409 },
        );
      }

      // Save order ID back to intent for verification in webhook (FIN-003)
      await intentRef.update({
        orderId: order.id,
        updatedAt: new Date(),
      });

      // Activate reservation with created order ID using fenced token (FIN-001)
      if (reservationKey && reservationToken) {
        await activatePaymentReservation(db, reservationKey, reservationToken, order.id, intentRef.id);
      }

      // B1 (FIN-004): return the saved intent id explicitly (the browser confirms the
      // server-created merchandise order mo_{intentId}); do not rely on the gateway echoing notes.
      return NextResponse.json({
        ...order,
        intentId: intentRef.id,
        notes: { ...(order?.notes || {}), intentId: intentRef.id },
      });
    } catch (orderErr: any) {
      if (renewalTimer) {
        clearInterval(renewalTimer);
        renewalTimer = null;
      }

      if (reservationKey && reservationAcquired && reservationToken && !leaseLost) {
        if (order && order.id) {
          // Razorpay order was successfully created, but Firestore activation (or intent update) failed.
          // Do NOT release reservation blindly! Record activation failure with orderId so it can be reconciled and reused (FIN-001).
          await recordActivationFailure(
            db,
            reservationKey,
            reservationToken,
            order.id,
            intentRef?.id,
            auth.uid,
            payableAmount,
            currency,
            orderErr.message,
          );
        } else {
          // Razorpay order creation call threw an error.
          // Distinguish between ambiguous gateway errors (timeout, 5xx) vs definitive rejections (4xx)
          const isAmbiguous = isAmbiguousRazorpayError(orderErr);
          if (isAmbiguous) {
            // Ambiguous failure: Razorpay may have created order. Mark reconciliation_required.
            await recordReconciliationRequired(
              db,
              reservationKey,
              reservationToken,
              authoritativeReceipt,
              auth.uid,
              payableAmount,
              currency,
              orderErr.message,
            );
          } else {
            // Definitive client/validation failure before order could exist
            await releasePaymentReservation(db, reservationKey, reservationToken, orderErr.message);
          }
        }
      }
      throw orderErr;
    }
  } catch (error: any) {
    console.error("Razorpay Order Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create payment order" },
      { status: 500 },
    );
  }
}
