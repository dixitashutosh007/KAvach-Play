import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
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
      const db = getDb();
      const entity =
        payload.payload.payment?.entity || payload.payload.order?.entity;
      const notes = entity?.notes || {};

      if (!notes.intentId) {
        console.warn("[razorpay/webhook] Event received without notes.intentId.");
        return NextResponse.json({ success: true, message: "No intentId attached." });
      }

      const intentRef = db.collection("razorpayIntents").doc(notes.intentId);
      const intentSnap = await intentRef.get();
      if (!intentSnap.exists) {
        console.error(`[razorpay/webhook] Intent document ${notes.intentId} not found.`);
        return NextResponse.json({ error: "Intent not found." }, { status: 404 });
      }

      const intent = intentSnap.data() || {};

      // Idempotency guard: if already marked paid, do not re-process
      if (intent.status === "paid") {
        return NextResponse.json({
          success: true,
          message: "Payment intent already processed.",
        });
      }

      // FIN-003: Strict transaction validation (Amount, Currency, Order ID)
      const expectedPaise = Math.round(Number(intent.amount) * 100);
      const capturedPaise = Math.round(Number(entity.amount));
      const expectedCurrency = (intent.currency || "INR").toUpperCase();
      const capturedCurrency = String(entity.currency || "").toUpperCase();

      if (capturedCurrency !== expectedCurrency) {
        console.error(
          `[razorpay/webhook] Currency mismatch for intent ${notes.intentId}: expected ${expectedCurrency}, received ${capturedCurrency}`,
        );
        return NextResponse.json(
          { error: "Currency mismatch between payment and intent." },
          { status: 400 },
        );
      }

      if (capturedPaise !== expectedPaise) {
        console.error(
          `[razorpay/webhook] Amount mismatch for intent ${notes.intentId}: expected ${expectedPaise} paise, captured ${capturedPaise} paise`,
        );
        return NextResponse.json(
          { error: "Amount mismatch between payment and intent." },
          { status: 400 },
        );
      }

      if (
        intent.orderId &&
        entity.order_id &&
        entity.order_id !== intent.orderId
      ) {
        console.error(
          `[razorpay/webhook] Order ID mismatch for intent ${notes.intentId}: expected ${intent.orderId}, received ${entity.order_id}`,
        );
        return NextResponse.json(
          { error: "Order ID mismatch." },
          { status: 400 },
        );
      }

      // FIN-002: Atomic batch processing. Intent status is updated to 'paid'
      // in the SAME atomic commit as downstream changes, preventing partial updates.
      const batch = db.batch();
      const now = new Date();

      if (intent.type === "match") {
        if (intent.matchId && intent.paymentId) {
          const paymentRef = db
            .collection("matches")
            .doc(intent.matchId)
            .collection("payments")
            .doc(intent.paymentId);
          batch.update(paymentRef, {
            status: "Paid",
            paymentMethod: "razorpay",
            razorpayPaymentId: entity.id || "",
            feeCollectedAmount: intent.amount || 0,
            updatedAt: now,
          });
        }
        if (Array.isArray(intent.lateFeeItems)) {
          for (const lf of intent.lateFeeItems) {
            const feeDocId = crypto.randomUUID();
            const feeRef = db
              .collection("players")
              .doc(lf.playerId)
              .collection("otherFees")
              .doc(feeDocId);
            batch.set(feeRef, {
              id: feeDocId,
              playerId: lf.playerId,
              title: lf.label || "Late Fee",
              amount: lf.amount || 0,
              comment: "Auto-levied late fee penalty",
              templateId: lf.templateId || "",
              status: "Paid",
              paymentMethod: "razorpay",
              razorpayPaymentId: entity.id || "",
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      } else if (intent.type === "finance_dues") {
        const items = Array.isArray(intent.items) ? intent.items : [];
        for (const item of items) {
          if (item.type === "match" && item.matchId && item.paymentId) {
            const paymentRef = db
              .collection("matches")
              .doc(item.matchId)
              .collection("payments")
              .doc(item.paymentId);
            batch.update(paymentRef, {
              status: "Paid",
              paymentMethod: "razorpay",
              razorpayPaymentId: entity.id || "",
              feeCollectedAmount: item.amount || 0,
              updatedAt: now,
            });
          } else if (item.type === "other" && item.feeId && intent.playerId) {
            const feeRef = db
              .collection("players")
              .doc(intent.playerId)
              .collection("otherFees")
              .doc(item.feeId);
            batch.update(feeRef, {
              status: "Paid",
              paymentMethod: "razorpay",
              razorpayPaymentId: entity.id || "",
              updatedAt: now,
            });
          } else if (item.isLateFee && intent.playerId) {
            const feeDocId = crypto.randomUUID();
            const feeRef = db
              .collection("players")
              .doc(intent.playerId)
              .collection("otherFees")
              .doc(feeDocId);
            batch.set(feeRef, {
              id: feeDocId,
              playerId: intent.playerId,
              title: item.lateFeeLabel || "Late Fee",
              amount: item.lateFeeAmount || 0,
              comment: "Auto-levied late fee penalty",
              templateId: item.lateFeeTemplateId || "",
              status: "Paid",
              paymentMethod: "razorpay",
              razorpayPaymentId: entity.id || "",
              createdAt: now,
              updatedAt: now,
            });
          } else if (item.type === "merch" && item.merchId) {
            const merchOrderRef = db.collection("merchOrders").doc(item.merchId);
            batch.update(merchOrderRef, {
              paymentStatus: "Paid",
              razorpayPaymentId: entity.id || "",
              updatedAt: now,
            });
          }
        }
      } else if (intent.type === "subscription") {
        if (intent.planId && intent.userId) {
          const durationDays = Number(intent.durationDays || 30);
          const toYMD = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

          // IDT-003: Check player document by direct ID first, then authUid
          let currentExpiry: string | undefined;
          let playerDocRef: FirebaseFirestore.DocumentReference | null = null;
          try {
            const directPlayerSnap = await db.collection("players").doc(intent.userId).get();
            if (directPlayerSnap.exists) {
              playerDocRef = directPlayerSnap.ref;
              const pData = directPlayerSnap.data() || {};
              currentExpiry = pData.studioExpiryDate || pData.studioEndDate;
            } else {
              const authUidQuery = await db
                .collection("players")
                .where("authUid", "==", intent.userId)
                .get();
              if (!authUidQuery.empty) {
                playerDocRef = authUidQuery.docs[0].ref;
                const pData = authUidQuery.docs[0].data() || {};
                currentExpiry = pData.studioExpiryDate || pData.studioEndDate;
              }
            }

            if (!currentExpiry) {
              const appUserSnap = await db.collection("appUsers").doc(intent.userId).get();
              if (appUserSnap.exists) {
                const aData = appUserSnap.data() || {};
                currentExpiry = aData.studioExpiryDate || aData.studioEndDate;
              }
            }
          } catch (e) {
            console.warn("[webhook] Could not determine currentExpiry:", e);
          }

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
          batch.set(subHistoryRef, {
            planId: intent.planId,
            playerId: intent.userId,
            adminId: "webhook",
            adminName: "Razorpay Webhook",
            oldExpiryDate: currentExpiry || undefined,
            newExpiryDate: endDate,
            planName: intent.planId,
            paidAmount: intent.amount || 0,
            razorpayPaymentId: entity.id || "",
            createdAt: now,
          });

          if (playerDocRef) {
            batch.update(playerDocRef, {
              studioExpiryDate: endDate,
              studioEndDate: endDate,
              isStudioMember: true,
              updatedAt: now,
            });
          }

          const appUserRef = db.collection("appUsers").doc(intent.userId);
          batch.set(
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
      } else if (intent.type === "merch_order") {
        // FIN-004: Fulfill merchandise order server-side
        const orderPayload = intent.orderPayload || {};
        const orderId = orderPayload.id || crypto.randomUUID();
        const orderRef = db.collection("merchOrders").doc(orderId);
        batch.set(orderRef, {
          ...orderPayload,
          id: orderId,
          paymentStatus: "Paid",
          orderStatus: orderPayload.orderStatus || "Order Placed",
          isManual: false,
          razorpayPaymentId: entity.id || "",
          createdAt: now,
          updatedAt: now,
        });
      }

      // Update intent status to 'paid' in the atomic batch
      batch.update(intentRef, {
        status: "paid",
        razorpayPaymentId: entity.id || "",
        rawPayload: payload,
        updatedAt: now,
      });

      // Commit all operations atomically
      await batch.commit();
      console.log(`[razorpay/webhook] Successfully processed intent ${notes.intentId} (${intent.type})`);
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
