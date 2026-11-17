import { NextRequest, NextResponse } from "next/server.js";
import crypto from "crypto";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  extractWebhookEventDetails,
  processWebhookIntentTransaction,
} from "../../../../lib/razorpay-webhook.ts";
import firebaseConfig from "../../../../firebase-applet-config.json" with { type: "json" };

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

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[razorpay/webhook] RAZORPAY_WEBHOOK_SECRET env var is not configured.");
      return NextResponse.json(
        { error: "Webhook secret not configured." },
        { status: 500 },
      );
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing x-razorpay-signature header." },
        { status: 401 },
      );
    }

    const generated_signature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    const expectedBuf = Buffer.from(generated_signature, "hex");
    const receivedBuf = Buffer.from(signature, "hex");
    if (
      expectedBuf.length !== receivedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);

    if (payload.event === "payment.captured" || payload.event === "order.paid") {
      const details = extractWebhookEventDetails(payload);
      if (!details || !details.intentId) {
        console.warn("[razorpay/webhook] Event received without notes.intentId.");
        return NextResponse.json({ success: true, message: "No intentId attached." });
      }

      const db = getDb();
      // FIN-002: Concurrency-safe atomic transaction
      const result = await processWebhookIntentTransaction(db, details, payload);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Transaction failed." },
          { status: 400 },
        );
      }

      console.log(
        `[razorpay/webhook] Successfully processed intent ${details.intentId} (${details.event}, alreadyProcessed: ${Boolean(result.alreadyProcessed)})`,
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[razorpay/webhook] Webhook error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
