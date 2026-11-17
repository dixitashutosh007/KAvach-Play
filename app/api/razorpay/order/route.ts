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

    if (reservationKey) {
      const resResult = await acquirePaymentReservation(
        db,
        reservationKey,
        auth.uid,
        payableAmount,
        currency,
      );

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

      if (resResult.isWaiting) {
        // Another concurrent request is actively creating the order right now.
        // Wait / poll for up to 3 seconds.
        let waitOrder: any = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const docSnap = await db.collection("paymentReservations").doc(reservationKey).get();
          if (docSnap.exists) {
            const data = docSnap.data() || {};
            if (data.status === "active" && data.orderId) {
              waitOrder = data;
              break;
            }
            if (data.status === "failed") {
              break;
            }
          }
        }
        if (waitOrder && waitOrder.orderId) {
          return NextResponse.json({
            id: waitOrder.orderId,
            amount: Math.round(waitOrder.amount * 100),
            currency: waitOrder.currency || currency,
            receipt,
            status: "created",
            notes: { ...notes, intentId: waitOrder.intentId, reusedExistingOrder: true },
          });
        }
      }

      reservationAcquired = resResult.acquired;
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

      const finalNotes = { ...notes, intentId: intentRef.id };

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

      // Activate reservation with created order ID (FIN-001)
      if (reservationKey) {
        await activatePaymentReservation(db, reservationKey, order.id, intentRef.id);
      }

      return NextResponse.json(order);
    } catch (orderErr: any) {
      if (reservationKey && reservationAcquired) {
        await releasePaymentReservation(db, reservationKey, orderErr.message);
      }
      throw orderErr;
    }
  } catch (error: any) {
    console.error("Razorpay Order Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create payment order" },
      { status: 400 },
    );
  }
}
