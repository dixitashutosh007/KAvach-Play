/**
 * POST /api/admin/merge-players
 *
 * Server-side duplicate-profile merge. Uses the Firebase Admin SDK,
 * which bypasses Firestore security rules — so the merge succeeds
 * regardless of the strict rules that govern client-side writes
 * (in particular, the payments rule that forbids changing playerId).
 *
 * Body: { loserId: string, keeperId: string }
 * Auth: requireAdmin (Firebase ID token with the admin claim or
 *       an appUsers/{uid}.role === 'admin' fallback).
 *
 * Semantics identical to the previous client-side mergePlayer:
 *   1. Reparent every matches/{matchId}/payments doc owned by loser → keeper
 *   2. Move every players/{loserId}/otherFees doc to players/{keeperId}
 *   3. Reparent every merchOrders doc owned by loser → keeper
 *   4. Fill any empty field on keeper from loser (never overwrites)
 *   5. Normalize keeper's mobile to +91XXXXXXXXXX
 *   6. Mark loser as disabled + mergedInto: keeperId (soft delete)
 */

import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";

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

// Same normalization as lib/utils.ts — duplicated here so the server
// route has no client-side import surface.
function normalizeIndianMobile(m: string): string {
  if (!m) return "";
  const digits = String(m).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0"))
    return `+91${digits.slice(1)}`;
  return m; // give up, return as-is
}

const FILL_IF_EMPTY = [
  "email",
  "dob",
  "locality",
  "bloodGroup",
  "emergencyContact",
  "battingStyle",
  "bowlingStyle",
  "chestSize",
  "waistSize",
  "jerseyNumber",
  "jerseyName",
  "studioExpiryDate",
  "studioEndDate",
  "studioPlan",
  "lastPaidDate",
  "lastPaidAmount",
  "photoURL",
] as const;

export async function POST(req: Request) {
  try {
    const { requireAdmin } = await import("@/lib/server-auth");
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    const body = await req.json().catch(() => ({}));
    const loserId = typeof body.loserId === "string" ? body.loserId.trim() : "";
    const keeperId = typeof body.keeperId === "string" ? body.keeperId.trim() : "";
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

    // Admin SDK writeBatch limit is 500 ops. Use a helper that flushes
    // whenever we approach the ceiling.
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

    // 1. Reparent match payments (collectionGroup query on `payments`,
    //    filtered by playerId). Admin SDK doesn't need a composite index
    //    for this kind of single-field collectionGroup where().
    const paySnap = await db
      .collectionGroup("payments")
      .where("playerId", "==", loserId)
      .get();
    let paymentsReparented = 0;
    for (const d of paySnap.docs) {
      await enqueue((b) =>
        b.update(d.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );
      paymentsReparented++;
    }

    // 2. Move otherFees under keeper
    const feeSnap = await loserRef.collection("otherFees").get();
    let feesMoved = 0;
    for (const feeDoc of feeSnap.docs) {
      await enqueue((b) =>
        b.set(
          keeperRef.collection("otherFees").doc(feeDoc.id),
          feeDoc.data(),
        ),
      );
      await enqueue((b) =>
        b.delete(loserRef.collection("otherFees").doc(feeDoc.id)),
      );
      feesMoved++;
    }

    // 3. Reparent merchOrders
    const orderSnap = await db
      .collection("merchOrders")
      .where("playerId", "==", loserId)
      .get();
    let ordersReparented = 0;
    for (const d of orderSnap.docs) {
      await enqueue((b) =>
        b.update(d.ref, {
          playerId: keeperId,
          playerName:
            (keeper as any).name || d.data().playerName || "",
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );
      ordersReparented++;
    }

    // 4. Fill-in-empties on keeper
    const keeperPatch: Record<string, any> = {};
    for (const field of FILL_IF_EMPTY) {
      const kVal = (keeper as any)[field];
      const lVal = (loser as any)[field];
      if (
        (kVal === undefined || kVal === null || kVal === "") &&
        lVal !== undefined &&
        lVal !== null &&
        lVal !== ""
      ) {
        keeperPatch[field] = lVal;
      }
    }
    if (!(keeper as any).isStudioMember && (loser as any).isStudioMember) {
      keeperPatch.isStudioMember = true;
    }
    if (!(keeper as any).isWicketKeeper && (loser as any).isWicketKeeper) {
      keeperPatch.isWicketKeeper = true;
    }
    const canonicalMobile =
      (keeper as any).mobile || (loser as any).mobile || "";
    const normalized = normalizeIndianMobile(canonicalMobile);
    if (normalized) keeperPatch.mobile = normalized;
    if (Object.keys(keeperPatch).length > 0) {
      keeperPatch.updatedAt = FieldValue.serverTimestamp();
      await enqueue((b) => b.update(keeperRef, keeperPatch));
    }

    // 5. Trash the loser
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
      paymentsReparented,
      feesMoved,
      ordersReparented,
    });
  } catch (err: any) {
    console.error("merge-players failed", err);
    return NextResponse.json(
      { error: err?.message || "merge failed", code: err?.code },
      { status: 500 },
    );
  }
}
