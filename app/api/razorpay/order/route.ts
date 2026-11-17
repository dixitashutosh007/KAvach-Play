import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { requireAuth } from "@/lib/server-auth";
import {
  derivePayableAmount,
  validateCurrency,
  acquirePaymentReservation,
  activatePaymentReservation,
  releasePaymentReservation,
  recordActivationFailure,
  recordReconciliationRequired,
  reconcileAmbiguousReservation,
  isAmbiguousRazorpayError,
  validateReservationForReuse,
} from "@/lib/razorpay-order";
import firebaseConfig from "@/firebase-applet-config.json";

function getDb() {
  const apps = getApps();
  let app;
  if (!apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      app = initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
      });
    } else {
      app = initializeApp({ projectId: firebaseConfig.projectId });
    }
  } else {
    app = apps[0];
  }
  const dbId =
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ||
    (firebaseConfig as any).firestoreDatabaseId;
  try {
    return getFirestore(app, dbId);
  } catch {
    return getFirestore(app);
  }
}

export async function POST(req: Request) {
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

    const finalKeyId =
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
    const finalKeySecret = process.env.RAZORPAY_KEY_SECRET;

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

    const db = getDb();
    let payableAmount: number;
    let storedIntentData: any;

    if (intentData) {
      // Derive authoritative amount server-side; client `amount` is discarded (FIN-001)
      const derived = await derivePayableAmount(db, auth.uid, intentData);
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

    if (reservationKey) {
      const resResult = await acquirePaymentReservation(
        db,
        reservationKey,
        auth.uid,
        payableAmount,
        currency,
      );

      if (resResult.conflict) {
        return NextResponse.json(
          { error: resResult.error || "Payment reservation conflict." },
          { status: 409 },
        );
      }

      if (resResult.existingOrder && resResult.existingOrder.orderId) {
        return NextResponse.json({
          id: resResult.existingOrder.orderId,
          amount: Math.round(resResult.existingOrder.amount * 100),
          currency: resResult.existingOrder.currency || currency,
          receipt,
          status: "created",
          notes: { ...notes, intentId: resResult.existingOrder.intentId, reusedExistingOrder: true },
        });
      }

      if (resResult.needsReconciliation) {
        // Previous attempt suffered ambiguous gateway failure; reconcile with Razorpay
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

        if (recResult.existingOrder && recResult.existingOrder.orderId) {
          return NextResponse.json({
            id: recResult.existingOrder.orderId,
            amount: Math.round(recResult.existingOrder.amount * 100),
            currency: recResult.existingOrder.currency || currency,
            receipt,
            status: "created",
            notes: { ...notes, intentId: recResult.existingOrder.intentId, reusedExistingOrder: true },
          });
        }

        if (!recResult.canRetry) {
          return NextResponse.json(
            { error: recResult.error || "Order reconciliation pending with payment gateway. Please retry." },
            { status: 503 },
          );
        }
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

          return NextResponse.json({
            id: waitOrder.orderId,
            amount: Math.round(waitOrder.amount * 100),
            currency: waitOrder.currency || currency,
            receipt,
            status: "created",
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

          if (recResult.existingOrder && recResult.existingOrder.orderId) {
            return NextResponse.json({
              id: recResult.existingOrder.orderId,
              amount: Math.round(recResult.existingOrder.amount * 100),
              currency: recResult.existingOrder.currency || currency,
              receipt,
              status: "created",
              notes: { ...notes, intentId: recResult.existingOrder.intentId, reusedExistingOrder: true },
            });
          }

          if (!recResult.canRetry) {
            return NextResponse.json(
              { error: recResult.error || "Order reconciliation pending with payment gateway. Please retry." },
              { status: 503 },
            );
          }
          reservationFailed = true;
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

          if (retryRes.conflict) {
            return NextResponse.json(
              { error: retryRes.error || "Payment reservation conflict." },
              { status: 409 },
            );
          }

          if (retryRes.existingOrder && retryRes.existingOrder.orderId) {
            return NextResponse.json({
              id: retryRes.existingOrder.orderId,
              amount: Math.round(retryRes.existingOrder.amount * 100),
              currency: retryRes.existingOrder.currency || currency,
              receipt,
              status: "created",
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
      } else {
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

    try {
      intentRef = await db.collection("razorpayIntents").add({
        ...storedIntentData,
        amount: payableAmount,
        currency,
        userId: auth.uid,
        createdAt: new Date(),
        status: "pending",
      });

      const finalNotes = { ...notes, intentId: intentRef.id, reservationKey };

      const options = {
        amount: Math.round(payableAmount * 100), // amount in smallest currency unit (paise)
        currency,
        receipt,
        notes: finalNotes,
      };

      order = await instance.orders.create(options);

      // Save order ID back to intent for verification in webhook (FIN-003)
      await intentRef.update({
        orderId: order.id,
        updatedAt: new Date(),
      });

      // Activate reservation with created order ID using fenced token (FIN-001)
      if (reservationKey && reservationToken) {
        await activatePaymentReservation(db, reservationKey, reservationToken, order.id, intentRef.id);
      }

      return NextResponse.json(order);
    } catch (orderErr: any) {
      if (reservationKey && reservationAcquired && reservationToken) {
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
              receipt,
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
