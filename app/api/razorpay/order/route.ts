import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { requireAuth } from "@/lib/server-auth";
import { derivePayableAmount, validateCurrency } from "@/lib/razorpay-order";
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

    const instance = new Razorpay({
      key_id: finalKeyId,
      key_secret: finalKeySecret,
    });

    const intentRef = await db.collection("razorpayIntents").add({
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

    const order = await instance.orders.create(options);

    // Save order ID back to intent for verification in webhook (FIN-003)
    await intentRef.update({
      orderId: order.id,
      updatedAt: new Date(),
    });

    return NextResponse.json(order);
  } catch (error: any) {
    console.error("Razorpay Order Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create payment order" },
      { status: 400 },
    );
  }
}
