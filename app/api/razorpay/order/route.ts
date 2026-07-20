import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getDb() {
  const apps = getApps();
  let app;
  if (!apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
       app = initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
       app = initializeApp();
    }
  } else {
    app = apps[0];
  }
  const dbId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";
  try {
    return getFirestore(app, dbId);
  } catch (e) {
    return getFirestore(app);
  }
}

export async function POST(req: Request) {
  try {
    const {
      amount,
      currency = "INR",
      receipt = "receipt_test_1",
      notes = {},
      intentData,
    } = await req.json();

    const finalKeyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
    const finalKeySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!finalKeyId || !finalKeySecret) {
      return NextResponse.json(
        { error: "Razorpay keys are not configured in environment variables." },
        { status: 500 },
      );
    }

    const instance = new Razorpay({
      key_id: finalKeyId,
      key_secret: finalKeySecret,
    });

    let finalNotes = notes;

    if (intentData) {
       const db = getDb();
       const intentRef = await db.collection("razorpayIntents").add({
          ...intentData,
          amount,
          createdAt: new Date(),
          status: "pending"
       });
       finalNotes = { ...notes, intentId: intentRef.id };
    }

    const options = {
      amount: amount * 100, // amount in smallest currency unit
      currency,
      receipt,
      notes: finalNotes,
    };

    const order = await instance.orders.create(options);

    return NextResponse.json(order);
  } catch (error: any) {
    console.error("Razorpay Order Error:", error);
    return NextResponse.json(
      { error: error.message || "Something went wrong" },
      { status: 500 },
    );
  }
}
