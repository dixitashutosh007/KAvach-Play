import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { requireAuth } from "@/lib/server-auth";
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

/**
 * Derives and verifies the authoritative payable amount server-side.
 * Client-supplied amounts are ignored/overridden to prevent fee tampering (FIN-001).
 */
async function derivePayableAmount(
  db: FirebaseFirestore.Firestore,
  authUid: string,
  intentData: any,
): Promise<{ amount: number; verifiedIntent: any }> {
  if (!intentData || typeof intentData !== "object") {
    throw new Error("Missing or invalid intentData.");
  }

  const type = intentData.type;

  if (type === "match") {
    const { matchId, paymentId } = intentData;
    if (!matchId || !paymentId) {
      throw new Error("matchId and paymentId are required for match payments.");
    }

    const matchSnap = await db.collection("matches").doc(matchId).get();
    if (!matchSnap.exists) {
      throw new Error("Match not found.");
    }
    const matchData = matchSnap.data() || {};

    const paySnap = await db
      .collection("matches")
      .doc(matchId)
      .collection("payments")
      .doc(paymentId)
      .get();
    if (!paySnap.exists) {
      throw new Error("Match payment record not found.");
    }
    const payData = paySnap.data() || {};

    // Verify ownership: payment.playerId must match caller's player record or authUid
    const playerId = payData.playerId;
    let isAuthorized = playerId === authUid;
    if (!isAuthorized) {
      const pDoc = await db.collection("players").doc(playerId).get();
      if (pDoc.exists && pDoc.data()?.authUid === authUid) {
        isAuthorized = true;
      }
    }
    if (!isAuthorized) {
      const uDoc = await db.collection("appUsers").doc(authUid).get();
      if (uDoc.exists && uDoc.data()?.playerId === playerId) {
        isAuthorized = true;
      }
    }
    if (!isAuthorized) {
      throw new Error("Unauthorized: you cannot initiate payment for another player's obligation.");
    }

    if (payData.status === "Paid") {
      throw new Error("Match fee is already marked as Paid.");
    }

    let calculatedAmount =
      payData.feeOverride !== undefined
        ? Number(payData.feeOverride)
        : Number(matchData.fee || 0);

    if (calculatedAmount < 0) calculatedAmount = 0;

    // Late fees if provided
    const verifiedLateFees: any[] = [];
    if (Array.isArray(intentData.lateFeeItems)) {
      for (const lf of intentData.lateFeeItems) {
        const lfAmount = Number(lf.amount || 0);
        if (lfAmount > 0) {
          calculatedAmount += lfAmount;
          verifiedLateFees.push({
            playerId,
            label: String(lf.label || "Late Fee").slice(0, 100),
            amount: lfAmount,
            templateId: String(lf.templateId || `latefee_${matchId}`),
          });
        }
      }
    }

    if (calculatedAmount <= 0) {
      throw new Error("Payable match fee amount must be greater than zero.");
    }

    return {
      amount: calculatedAmount,
      verifiedIntent: {
        type: "match",
        matchId,
        paymentId,
        playerId,
        userId: authUid,
        lateFeeItems: verifiedLateFees,
      },
    };
  } else if (type === "finance_dues") {
    const items = intentData.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("No dues items provided.");
    }

    let calculatedAmount = 0;
    const verifiedItems: any[] = [];
    const playerId = intentData.playerId || authUid;

    for (const item of items) {
      if (item.type === "match" && item.matchId && item.paymentId) {
        const pSnap = await db
          .collection("matches")
          .doc(item.matchId)
          .collection("payments")
          .doc(item.paymentId)
          .get();
        if (pSnap.exists && pSnap.data()?.status !== "Paid") {
          const mSnap = await db.collection("matches").doc(item.matchId).get();
          const pData = pSnap.data() || {};
          const mData = mSnap.data() || {};
          const fee =
            pData.feeOverride !== undefined
              ? Number(pData.feeOverride)
              : Number(mData.fee || 0);
          if (fee > 0) {
            calculatedAmount += fee;
            verifiedItems.push({
              type: "match",
              matchId: item.matchId,
              paymentId: item.paymentId,
              amount: fee,
            });
          }
        }
      } else if (item.type === "other" && item.feeId) {
        const feeSnap = await db
          .collection("players")
          .doc(playerId)
          .collection("otherFees")
          .doc(item.feeId)
          .get();
        if (feeSnap.exists && feeSnap.data()?.status !== "Paid") {
          const feeData = feeSnap.data() || {};
          const feeAmt = Number(feeData.amount || 0);
          if (feeAmt > 0) {
            calculatedAmount += feeAmt;
            verifiedItems.push({
              type: "other",
              feeId: item.feeId,
              amount: feeAmt,
            });
          }
        }
      } else if (item.isLateFee) {
        const lfAmt = Number(item.lateFeeAmount || 0);
        if (lfAmt > 0) {
          calculatedAmount += lfAmt;
          verifiedItems.push({
            isLateFee: true,
            lateFeeLabel: String(item.lateFeeLabel || "Late Fee"),
            lateFeeAmount: lfAmt,
            lateFeeTemplateId: String(item.lateFeeTemplateId || ""),
          });
        }
      } else if (item.type === "merch" && item.merchId) {
        const mSnap = await db.collection("merchOrders").doc(item.merchId).get();
        if (mSnap.exists && mSnap.data()?.paymentStatus !== "Paid") {
          const mData = mSnap.data() || {};
          const price = Number(mData.price || 0);
          if (price > 0) {
            calculatedAmount += price;
            verifiedItems.push({
              type: "merch",
              merchId: item.merchId,
              amount: price,
            });
          }
        }
      }
    }

    if (calculatedAmount <= 0) {
      throw new Error("Total calculated payable dues must be greater than zero.");
    }

    return {
      amount: calculatedAmount,
      verifiedIntent: {
        type: "finance_dues",
        playerId,
        userId: authUid,
        items: verifiedItems,
      },
    };
  } else if (type === "subscription") {
    const planId = intentData.planId;
    if (!planId) {
      throw new Error("planId is required for studio subscriptions.");
    }
    const planSnap = await db.collection("subscriptionPlans").doc(planId).get();
    if (!planSnap.exists) {
      throw new Error("Subscription plan not found.");
    }
    const plan = planSnap.data() || {};
    const planFee = Number(plan.fee);
    if (!planFee || planFee <= 0) {
      throw new Error("Invalid plan fee amount.");
    }

    return {
      amount: planFee,
      verifiedIntent: {
        type: "subscription",
        planId,
        userId: authUid,
        durationDays: Number(plan.durationDays || 30),
      },
    };
  } else if (type === "merch_order") {
    const orderPayload = intentData.orderPayload;
    if (!orderPayload || (!orderPayload.merchId && !intentData.merchId)) {
      throw new Error("merchId is required for merchandise orders.");
    }
    const merchId = orderPayload?.merchId || intentData.merchId;
    const merchSnap = await db.collection("merchandises").doc(merchId).get();
    if (!merchSnap.exists) {
      throw new Error("Merchandise item not found.");
    }
    const merch = merchSnap.data() || {};
    let calculatedPrice = Number(merch.basePrice ?? merch.price ?? 0);

    // Apply custom selections add modifiers
    if (orderPayload?.customSelections && typeof orderPayload.customSelections === "object") {
      const customFields = Array.isArray(merch.customFields) ? merch.customFields : [];
      for (const field of customFields) {
        const userChoice = orderPayload.customSelections[field.name];
        if (userChoice && Array.isArray(field.options)) {
          const opt = field.options.find((o: any) => o.value === userChoice);
          if (opt && opt.priceModifierType === "Add" && opt.priceModifierValue) {
            calculatedPrice += Number(opt.priceModifierValue);
          }
        }
      }
    }

    if (calculatedPrice <= 0) {
      throw new Error("Payable merchandise amount must be greater than zero.");
    }

    return {
      amount: calculatedPrice,
      verifiedIntent: {
        type: "merch_order",
        merchId,
        userId: authUid,
        orderPayload: {
          ...(orderPayload || {}),
          merchId,
          merchName: merch.name || orderPayload?.merchName || "Club Merchandise",
          price: calculatedPrice,
          playerId: orderPayload?.playerId || authUid,
        },
      },
    };
  }

  throw new Error(`Unsupported intent type: ${type}`);
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
      // Derive authoritative amount server-side; client `amount` is discarded
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
