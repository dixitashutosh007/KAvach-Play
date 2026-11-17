/**
 * POST /api/admin/merge-players
 *
 * Server-side duplicate-profile merge. Uses the Firebase Admin SDK,
 * which bypasses Firestore security rules — so the merge succeeds
 * regardless of the strict rules that govern client-side writes
 * (in particular, the payments rule that forbids changing playerId).
 *
 * Body: { loserId: string, keeperId: string, dryRun?: boolean }
 * Auth: requireAdmin (Firebase ID token with verified admin custom claim { admin: true }).
 *
 * Semantics:
 *   1. Reparent every matches/{matchId}/payments doc owned by loser → keeper
 *   2. Move every players/{loserId}/otherFees doc to players/{keeperId}
 *   3. Reparent every merchOrders doc owned by loser → keeper
 *   4. Reparent every appUsers doc linked to loser → keeper (IDT-001)
 *   5. Fill any empty field on keeper from loser (never overwrites)
 *   6. Normalize keeper's mobile to +91XXXXXXXXXX
 *   7. Mark loser as disabled + mergedInto: keeperId (soft delete)
 *   8. Supports dryRun flag to preview changes without modifying data
 */

import { NextResponse } from "next/server.js";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "../../../../firebase-applet-config.json" with { type: "json" };
import {
  computeKeeperPatch,
  normalizeIndianMobile,
} from "../../../../lib/player-merge.ts";

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

/**
 * PATCH /api/admin/merge-players
 *
 * Repair previously-merged records:
 * 1. otherFees under the keeper that still reference the loser's playerId.
 * 2. appUsers docs that still reference a merged loser player.
 */
export async function PATCH(req: Request) {
  try {
    const { requireClubAdmin } = await import("@/lib/server-auth");
    const guard = await requireClubAdmin(req);
    if (!guard.ok) return guard.response;

    const db = getDb();
    const mergedSnap = await db
      .collection("players")
      .where("mergedInto", "!=", "")
      .get();

    let totalFeesRepaired = 0;
    let totalUsersRepaired = 0;

    for (const loserDoc of mergedSnap.docs) {
      const loserId = loserDoc.id;
      const keeperId = loserDoc.data().mergedInto;
      if (!keeperId) continue;

      const keeperRef = db.collection("players").doc(keeperId);
      const feesSnap = await keeperRef.collection("otherFees").get();
      const batch = db.batch();
      let batchCount = 0;

      for (const feeDoc of feesSnap.docs) {
        if (feeDoc.data().playerId === loserId) {
          batch.update(feeDoc.ref, {
            playerId: keeperId,
            updatedAt: FieldValue.serverTimestamp(),
          });
          batchCount++;
        }
      }

      // Also repair any appUsers still linked to this loser
      const usersSnap = await db
        .collection("appUsers")
        .where("playerId", "==", loserId)
        .get();

      for (const userDoc of usersSnap.docs) {
        batch.update(userDoc.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
        batchCount++;
        totalUsersRepaired++;
      }

      if (batchCount > 0) {
        await batch.commit();
        totalFeesRepaired += batchCount - (usersSnap.docs.length);
      }
    }

    return NextResponse.json({
      ok: true,
      feesRepaired: totalFeesRepaired,
      usersRepaired: totalUsersRepaired,
    });
  } catch (err: any) {
    console.error("merge-players repair failed", err);
    return NextResponse.json(
      { error: err?.message || "repair failed", code: err?.code },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const { requireClubAdmin } = await import("@/lib/server-auth");
    const guard = await requireClubAdmin(req);
    if (!guard.ok) return guard.response;

    const body = await req.json().catch(() => ({}));
    const loserId = typeof body.loserId === "string" ? body.loserId.trim() : "";
    const keeperId = typeof body.keeperId === "string" ? body.keeperId.trim() : "";
    const dryRun = Boolean(body.dryRun);

    if (!loserId || !keeperId) {
      return NextResponse.json(
        { error: "loserId and keeperId are required." },
        { status: 400 },
      );
    }
    if (loserId === keeperId) {
      return NextResponse.json(
        { error: "loserId and keeperId must differ." },
        { status: 400 },
      );
    }

    const db = getDb();
    const loserRef = db.collection("players").doc(loserId);
    const keeperRef = db.collection("players").doc(keeperId);
    const [loserSnap, keeperSnap] = await Promise.all([
      loserRef.get(),
      keeperRef.get(),
    ]);
    if (!loserSnap.exists || !keeperSnap.exists) {
      return NextResponse.json(
        { error: "Loser or keeper player not found." },
        { status: 404 },
      );
    }
    const loser = loserSnap.data() || {};
    const keeper = keeperSnap.data() || {};

    // 1. Check match payments to reparent
    const paySnap = await db
      .collectionGroup("payments")
      .where("playerId", "==", loserId)
      .get();
    const paymentsReparented = paySnap.docs.length;

    // 2. Check otherFees to move
    const feeSnap = await loserRef.collection("otherFees").get();
    const feesMoved = feeSnap.docs.length;

    // 3. Check merchOrders to reparent
    const orderSnap = await db
      .collection("merchOrders")
      .where("playerId", "==", loserId)
      .get();
    const ordersReparented = orderSnap.docs.length;

    // 4. Check appUsers to reparent (IDT-001)
    const userQuerySnap = await db
      .collection("appUsers")
      .where("playerId", "==", loserId)
      .get();

    // Also check direct doc appUsers/{loserId}
    const directUserDoc = await db.collection("appUsers").doc(loserId).get();
    const directUserNeedsUpdate =
      directUserDoc.exists && directUserDoc.data()?.playerId !== keeperId;

    let appUsersReparented = userQuerySnap.docs.length;
    if (directUserNeedsUpdate && !userQuerySnap.docs.some((d) => d.id === loserId)) {
      appUsersReparented++;
    }

    // 5. Fill-in-empties on keeper
    const keeperPatch = computeKeeperPatch(keeper, loser);

    // Dry Run early exit
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        loserId,
        keeperId,
        loserName: (loser as any).name || "Unknown",
        keeperName: (keeper as any).name || "Unknown",
        paymentsReparented,
        feesMoved,
        ordersReparented,
        appUsersReparented,
        keeperPatch,
      });
    }

    // Live Execution with writeBatch batching
    const BATCH_LIMIT = 400;
    let batch = db.batch();
    let opCount = 0;
    const flush = async () => {
      if (opCount === 0) return;
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    };
    const enqueue = async (fn: (b: FirebaseFirestore.WriteBatch) => void) => {
      fn(batch);
      opCount++;
      if (opCount >= BATCH_LIMIT) await flush();
    };

    // 1. Reparent match payments
    for (const d of paySnap.docs) {
      await enqueue((b) =>
        b.update(d.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );
    }

    // 2. Move otherFees under keeper
    for (const feeDoc of feeSnap.docs) {
      await enqueue((b) =>
        b.set(
          keeperRef.collection("otherFees").doc(feeDoc.id),
          { ...feeDoc.data(), playerId: keeperId, updatedAt: FieldValue.serverTimestamp() },
        ),
      );
      await enqueue((b) =>
        b.delete(loserRef.collection("otherFees").doc(feeDoc.id)),
      );
    }

    // 3. Reparent merchOrders
    for (const d of orderSnap.docs) {
      await enqueue((b) =>
        b.update(d.ref, {
          playerId: keeperId,
          playerName: (keeper as any).name || d.data().playerName || "",
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );
    }

    // 4. Reparent appUsers (IDT-001)
    for (const u of userQuerySnap.docs) {
      await enqueue((b) =>
        b.update(u.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );
    }
    if (directUserNeedsUpdate) {
      await enqueue((b) =>
        b.update(directUserDoc.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );
    }

    // 5. Update keeper with patched fields
    if (Object.keys(keeperPatch).length > 0) {
      keeperPatch.updatedAt = FieldValue.serverTimestamp();
      await enqueue((b) => b.update(keeperRef, keeperPatch));
    }

    // 6. Trash the loser (soft delete)
    await enqueue((b) =>
      b.update(loserRef, {
        disabled: true,
        disabledAt: new Date().toISOString(),
        mergedInto: keeperId,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    );

    await flush();

    return NextResponse.json({
      ok: true,
      dryRun: false,
      paymentsReparented,
      feesMoved,
      ordersReparented,
      appUsersReparented,
    });
  } catch (err: any) {
    console.error("merge-players failed", err);
    return NextResponse.json(
      { error: err?.message || "merge failed", code: err?.code },
      { status: 500 },
    );
  }
}
