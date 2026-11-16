/**
 * POST /api/admin/reconcile-abandoned
 *
 * Reconciles financial obligations for abandoned matches in accordance with
 * approved Option A policy (AGENTS.md):
 *   - An abandoned match creates no player match-fee obligation.
 *   - Waive/void unpaid match-fee obligations (status: "Waived", waivedReason: "Match Abandoned").
 *   - Preserve original amount, player, match, reason, timestamp and audit history.
 *   - Do NOT delete payment records.
 *   - Exclude waived obligations from outstanding dues, checkout, reminders, and collections.
 *   - Already-paid amounts remain historical transactions (never delete, never alter status).
 *   - Transition is idempotent and safely retryable.
 *
 * Auth: requireAdmin (Firebase ID token with admin claim or appUsers role).
 * Body: { dryRun?: boolean, matchId?: string }
 */

import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";
import { requireAdmin } from "@/lib/server-auth";

function ensureAdminApp() {
  const apps = getApps();
  if (apps.length) return apps[0];
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    });
  }
  return initializeApp({ projectId: firebaseConfig.projectId });
}

function getDb() {
  const app = ensureAdminApp();
  const dbId = (firebaseConfig as any).firestoreDatabaseId;
  try {
    return getFirestore(app, dbId);
  } catch {
    return getFirestore(app);
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body.dryRun);
    const targetMatchId = body.matchId ? String(body.matchId).trim() : null;

    const db = getDb();
    let matchesToReconcile: { id: string; opponent?: string; date?: string; fee?: number }[] = [];

    if (targetMatchId) {
      const matchDoc = await db.collection("matches").doc(targetMatchId).get();
      if (!matchDoc.exists) {
        return NextResponse.json({ error: `Match ${targetMatchId} not found.` }, { status: 404 });
      }
      const data = matchDoc.data() || {};
      if (data.result !== "Abandoned") {
        return NextResponse.json(
          { error: `Match ${targetMatchId} is not abandoned (result: ${data.result || "N/A"}).` },
          { status: 400 },
        );
      }
      matchesToReconcile.push({ id: matchDoc.id, ...data });
    } else {
      const snap = await db.collection("matches").where("result", "==", "Abandoned").get();
      snap.forEach((d) => {
        matchesToReconcile.push({ id: d.id, ...d.data() });
      });
    }

    const waivedList: Array<{
      matchId: string;
      paymentId: string;
      playerId: string;
      amount: number;
      previousStatus: string;
    }> = [];

    const paidPreservedList: Array<{
      matchId: string;
      paymentId: string;
      playerId: string;
      amount: number;
    }> = [];

    let alreadyWaivedCount = 0;
    let otherCount = 0;

    // Process all payments across the abandoned matches
    for (const match of matchesToReconcile) {
      const paymentsSnap = await db.collection(`matches/${match.id}/payments`).get();

      // Collect operations to perform in batches (up to 400 writes per batch)
      let currentBatch = db.batch();
      let batchCount = 0;

      for (const payDoc of paymentsSnap.docs) {
        const pay = payDoc.data();
        const effectiveAmount = pay.feeOverride !== undefined ? pay.feeOverride : (match.fee || 0);

        if (pay.status === "Unpaid") {
          waivedList.push({
            matchId: match.id,
            paymentId: payDoc.id,
            playerId: pay.playerId,
            amount: effectiveAmount,
            previousStatus: "Unpaid",
          });

          if (!dryRun) {
            currentBatch.update(payDoc.ref, {
              status: "Waived",
              waivedReason: "Match Abandoned",
              waivedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
            batchCount++;

            if (batchCount >= 400) {
              await currentBatch.commit();
              currentBatch = db.batch();
              batchCount = 0;
            }
          }
        } else if (pay.status === "Paid") {
          // Historical payment preserved per Option A
          paidPreservedList.push({
            matchId: match.id,
            paymentId: payDoc.id,
            playerId: pay.playerId,
            amount: pay.feeCollectedAmount ?? effectiveAmount,
          });
        } else if (pay.status === "Waived") {
          alreadyWaivedCount++;
        } else {
          otherCount++;
        }
      }

      if (!dryRun && batchCount > 0) {
        await currentBatch.commit();
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      scannedMatches: matchesToReconcile.length,
      abandonedMatches: matchesToReconcile.length,
      waivedCount: waivedList.length,
      paidPreservedCount: paidPreservedList.length,
      alreadyWaivedCount,
      otherCount,
      waivedList,
      paidPreservedList,
    });
  } catch (err: any) {
    console.error("[reconcile-abandoned] Failed:", err);
    return NextResponse.json(
      { error: "Internal server error during reconciliation.", details: err?.message },
      { status: 500 },
    );
  }
}
