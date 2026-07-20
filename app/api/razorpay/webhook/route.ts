import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
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

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (secret && signature) {
      const generated_signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
      if (generated_signature !== signature) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
      }
    }

    const payload = JSON.parse(rawBody);

    if (payload.event === "payment.captured" || payload.event === "order.paid") {
      const db = getDb();
      const entity = payload.payload.payment?.entity || payload.payload.order?.entity;
      const notes = entity?.notes || {};

      if (notes.intentId) {
         const intentRef = db.collection("razorpayIntents").doc(notes.intentId);
         const intentSnap = await intentRef.get();
         if (intentSnap.exists) {
            const data = intentSnap.data();
            if (data && data.status !== "paid") {
               await intentRef.update({ status: "paid", rawPayload: payload, updatedAt: new Date() });
               
               if (data.type === "match") {
                   if (data.matchId && data.paymentId) {
                     await db.collection("matches").doc(data.matchId).collection("payments").doc(data.paymentId).update({
                       status: "Paid",
                       paymentMethod: "razorpay",
                       updatedAt: new Date()
                     });
                  }
               } else if (data.type === "finance_dues") {
                  const items = data.items || [];
                  for (let i = 0; i < items.length; i++) {
                     const item = items[i];
                     if (item.matchId && item.paymentId) {
                         try {
                           await db.collection("matches").doc(item.matchId).collection("payments").doc(item.paymentId).update({
                             status: "Paid",
                             paymentMethod: "razorpay",
                             updatedAt: new Date()
                           });
                         } catch (e) {}
                     } else if (item.feeId && data.playerId) {
                         try {
                           await db.collection("players").doc(data.playerId).collection("otherFees").doc(item.feeId).update({
                             status: "Paid",
                             paymentMethod: "razorpay",
                             updatedAt: new Date()
                           });
                         } catch(e) {}
                     }
                  }
               } else if (data.type === "subscription") {
                  if (data.planId && data.userId) {
                    await db.collection("subscriptionHistory").add({
                      planId: data.planId,
                      userId: data.userId,
                      amount: data.amount || 0,
                      startDate: new Date().toISOString(),
                      endDate: new Date(Date.now() + (data.durationDays || 30) * 24 * 60 * 60 * 1000).toISOString(),
                      status: "Active",
                      createdAt: new Date()
                    });
                  }
               }
            }
         }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook error: ", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
