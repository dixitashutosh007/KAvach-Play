import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { requireAuth } from "@/lib/server-auth";

function getDb() {
  const apps = getApps();
  let app;
  if (!apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
       app = initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
    } else {
       // On AWS / Amplify, firebase-admin has no way to auto-detect a
       // Google Cloud project. FIREBASE_SERVICE_ACCOUNT_KEY (the full JSON
       // of a service account key, single-line) is required.
       throw new Error(
         "FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. Add it in Amplify Console → Hosting → Environment variables (the entire serviceAccountKey.json content as a single-line string), then redeploy.",
       );
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
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

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
      const missing = [
        !finalKeyId && "RAZORPAY_KEY_ID (or NEXT_PUBLIC_RAZORPAY_KEY_ID)",
        !finalKeySecret && "RAZORPAY_KEY_SECRET",
      ].filter(Boolean);
      // Log to server console for Amplify CloudWatch — makes it clear which
      // env var didn't propagate to the Lambda runtime.
      console.error("[razorpay/order] Missing env vars:", missing.join(", "));
      return NextResponse.json(
        {
          error: `Razorpay keys missing at runtime: ${missing.join(", ")}. Set them in Amplify Console → Hosting → Environment variables and redeploy.`,
        },
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
