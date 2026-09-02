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
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[razorpay/webhook] RAZORPAY_WEBHOOK_SECRET env var is not configured.");
      return NextResponse.json({ error: "Webhook secret not configured." }, { status: 500 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");

    if (!signature) {
      return NextResponse.json({ error: "Missing x-razorpay-signature header." }, { status: 401 });
    }

    const generated_signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(generated_signature, "hex");
    const receivedBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
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
                     } else if (item.merchId) {
                         try {
                           await db.collection("merchOrders").doc(item.merchId).update({
                             paymentStatus: "Paid",
                             paymentMethod: "razorpay",
                             updatedAt: new Date()
                           });
                         } catch(e) {}
                     }
                  }
               } else if (data.type === "subscription") {
                  if (data.planId && data.userId) {
                    const durationDays = data.durationDays || 30;
                    const now = new Date();

                    let currentExpiry: string | undefined;
                    try {
                       const playerQuery = await db.collection("players").where("id", "==", data.userId).get();
                       if (!playerQuery.empty) {
                          const pData = playerQuery.docs[0].data();
                          currentExpiry = pData.studioExpiryDate || pData.studioEndDate;
                       }
                       if (!currentExpiry) {
                          const appUserDoc = await db.collection("appUsers").doc(data.userId).get();
                          if (appUserDoc.exists) {
                             const aData = appUserDoc.data();
                             currentExpiry = aData?.studioExpiryDate || aData?.studioEndDate;
                          }
                       }
                    } catch (_) {}

                    let baseDate = now;
                    if (currentExpiry) {
                       const exp = new Date(currentExpiry);
                       if (!isNaN(exp.getTime()) && exp > now) {
                          baseDate = exp;
                       }
                    }
                    const endDate = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

                    await db.collection("subscriptionHistory").add({
                      planId: data.planId,
                      userId: data.userId,
                      amount: data.amount || 0,
                      startDate: now.toISOString(),
                      endDate: endDate,
                      status: "Active",
                      createdAt: now
                    });

                    try {
                       const playerQuery = await db.collection("players").where("id", "==", data.userId).get();
                       if (!playerQuery.empty) {
                          await playerQuery.docs[0].ref.update({
                             studioExpiryDate: endDate,
                             updatedAt: now
                          });
                       }
                       const appUserQuery = await db.collection("appUsers").where("uid", "==", data.userId).get();
                       if (!appUserQuery.empty) {
                          await appUserQuery.docs[0].ref.update({
                             studioExpiryDate: endDate,
                             updatedAt: now
                          });
                       } else {
                          const appUserDoc = await db.collection("appUsers").doc(data.userId).get();
                          if (appUserDoc.exists) {
                             await appUserDoc.ref.update({
                                studioExpiryDate: endDate,
                                updatedAt: now
                             });
                          }
                       }
                    } catch (e) {
                       console.error("Failed to update user studioExpiryDate", e);
                    }
                  }
               } else if (data.type === "merch_order") {
                  // Intentionally no-op: the client's finalizeOrderPlacement()
                  // creates the merchOrder document with full metadata
                  // (orderStatus, MOQ sister updates, profile sync, notification
                  // emails). Writing here as well produced duplicate, incomplete
                  // orders in the Club Orders view. The razorpayIntents doc is
                  // still marked "paid" above, which is the source of truth if
                  // the client-side write ever fails.
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
