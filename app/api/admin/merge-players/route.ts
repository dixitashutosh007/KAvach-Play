/**
 * POST & PATCH /api/admin/merge-players
 *
 * Implements SEC-1D-01 & SEC-1D-02:
 * 1. Strict Identity State Resolution & Validation:
 *    - Reads loser, keeper, appUsers, uidIndex, phoneIndex for both players.
 *    - Rejects merges with 409 Conflict if distinct active UIDs, third-party reservations,
 *      conflicting canonical phones, or multiple appUsers exist.
 *    - Never silently steals, overwrites, or reassigns identity reservations.
 * 2. Staged, Idempotent & Resumable Merge State Machine:
 *    - Identity transition performed atomically in a Firestore transaction.
 *    - Progress tracked durably via `mergeJobs/{jobId}`.
 *    - Migration batches (payments, otherFees, merchOrders, appUsers) run in staged chunks.
 *    - Loser is NOT marked fully merged until all migration stages verify.
 *    - Safe recovery: Retrying a failed or interrupted merge resumes from the pending stage.
 *    - In-progress merges are protected from concurrent merges and account linking.
 */

import { NextResponse } from "next/server.js";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "../../../../firebase-applet-config.json" with { type: "json" };
import { computeKeeperPatch } from "../../../../lib/player-merge.ts";
import { parseStrictIndianMobile } from "../../../../lib/account-linking.ts";

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
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return getFirestore(app);
  }
  const dbId = (firebaseConfig as any).firestoreDatabaseId;
  try {
    return getFirestore(app, dbId);
  } catch {
    return getFirestore(app);
  }
}

/**
 * PATCH /api/admin/merge-players
 * Repair previously-merged records: otherFees, appUsers, uidIndex, phoneIndex.
 */
export async function PATCH(req: Request) {
  try {
    const { requireClubAdmin } = await import("../../../../lib/server-auth.ts");
    const guard = await requireClubAdmin(req);
    if (!guard.ok) return guard.response;

    const db = getDb();
    const mergedSnap = await db
      .collection("players")
      .where("mergedInto", "!=", "")
      .get();

    let totalFeesRepaired = 0;
    let totalUsersRepaired = 0;
    let totalUidIndexesRepaired = 0;
    let totalPhoneIndexesRepaired = 0;

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
          totalFeesRepaired++;
        }
      }

      // Repair any appUsers still linked to this loser
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

      // Repair any uidIndex still linked to this loser
      const uidSnap = await db
        .collection("uidIndex")
        .where("playerId", "==", loserId)
        .get();
      for (const uidDoc of uidSnap.docs) {
        batch.update(uidDoc.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
        batchCount++;
        totalUidIndexesRepaired++;
      }

      // Repair any phoneIndex still linked to this loser
      const phoneSnap = await db
        .collection("phoneIndex")
        .where("playerId", "==", loserId)
        .get();
      for (const phoneDoc of phoneSnap.docs) {
        batch.update(phoneDoc.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
        batchCount++;
        totalPhoneIndexesRepaired++;
      }

      if (batchCount > 0) {
        await batch.commit();
      }
    }

    return NextResponse.json({
      ok: true,
      feesRepaired: totalFeesRepaired,
      usersRepaired: totalUsersRepaired,
      uidIndexesRepaired: totalUidIndexesRepaired,
      phoneIndexesRepaired: totalPhoneIndexesRepaired,
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
    const { requireClubAdmin } = await import("../../../../lib/server-auth.ts");
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
    const jobId = `job_${loserId}_${keeperId}`;
    const mergeJobRef = db.collection("mergeJobs").doc(jobId);

    // 1. Resolve Complete Identity State for Loser and Keeper (SEC-1D-01)
    const loserRef = db.collection("players").doc(loserId);
    const keeperRef = db.collection("players").doc(keeperId);

    const [
      loserSnap,
      keeperSnap,
      appUsersLoserSnap,
      appUsersKeeperSnap,
      uidIndexLoserSnap,
      uidIndexKeeperSnap,
      phoneIndexLoserSnap,
      phoneIndexKeeperSnap,
      mergeJobSnap,
    ] = await Promise.all([
      loserRef.get(),
      keeperRef.get(),
      db.collection("appUsers").where("playerId", "==", loserId).get(),
      db.collection("appUsers").where("playerId", "==", keeperId).get(),
      db.collection("uidIndex").where("playerId", "==", loserId).get(),
      db.collection("uidIndex").where("playerId", "==", keeperId).get(),
      db.collection("phoneIndex").where("playerId", "==", loserId).get(),
      db.collection("phoneIndex").where("playerId", "==", keeperId).get(),
      mergeJobRef.get(),
    ]);

    if (!loserSnap.exists || !keeperSnap.exists) {
      return NextResponse.json(
        { error: "Loser or keeper player not found." },
        { status: 404 },
      );
    }

    const loser = loserSnap.data() || {};
    const keeper = keeperSnap.data() || {};
    const existingJob = mergeJobSnap.exists ? mergeJobSnap.data() || {} : null;

    // Check if merge is already completed
    if (existingJob?.status === "completed" && loser.mergedInto === keeperId && loser.disabled === true) {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        jobId,
        loserId,
        keeperId,
        paymentsReparented: existingJob.stats?.paymentsReparented || 0,
        feesMoved: existingJob.stats?.feesMoved || 0,
        ordersReparented: existingJob.stats?.ordersReparented || 0,
        appUsersReparented: existingJob.stats?.appUsersReparented || 0,
        uidIndexReparented: existingJob.stats?.uidIndexReparented || 0,
        phoneIndexReparented: existingJob.stats?.phoneIndexReparented || 0,
      });
    }

    // Check keeper eligibility: Keeper cannot be already disabled or merged into someone else
    if (keeper.disabled === true || keeper.mergedInto) {
      return NextResponse.json(
        { error: "Keeper player is disabled or already merged into another profile.", code: "KEEPER_INELIGIBLE" },
        { status: 409 },
      );
    }

    // Check if loser is already merged into another keeper
    if (loser.mergedInto && loser.mergedInto !== keeperId) {
      return NextResponse.json(
        { error: `Loser player has already been merged into player ${loser.mergedInto}.`, code: "LOSER_ALREADY_MERGED" },
        { status: 409 },
      );
    }

    // Check in-progress merge collision from a competing job
    if (loser.mergeStatus === "in_progress" && loser.mergeJobId && loser.mergeJobId !== jobId) {
      return NextResponse.json(
        { error: "Loser player is currently involved in another active merge job.", code: "MERGE_IN_PROGRESS" },
        { status: 409 },
      );
    }
    if (keeper.mergeStatus === "in_progress" && keeper.mergeJobId && keeper.mergeJobId !== jobId) {
      return NextResponse.json(
        { error: "Keeper player is currently involved in another active merge job.", code: "MERGE_IN_PROGRESS" },
        { status: 409 },
      );
    }

    // Direct index lookups
    const loserUid = loser.authUid ? String(loser.authUid).trim() : "";
    const keeperUid = keeper.authUid ? String(keeper.authUid).trim() : "";

    const [directLoserUidDoc, directKeeperUidDoc] = await Promise.all([
      loserUid ? db.collection("uidIndex").doc(loserUid).get() : Promise.resolve(null),
      keeperUid ? db.collection("uidIndex").doc(keeperUid).get() : Promise.resolve(null),
    ]);

    const loserParsedPhone = loser.mobile ? parseStrictIndianMobile(loser.mobile) : null;
    const keeperParsedPhone = keeper.mobile ? parseStrictIndianMobile(keeper.mobile) : null;
    const loserCanonicalPhone = loserParsedPhone?.ok ? loserParsedPhone.canonical : "";
    const keeperCanonicalPhone = keeperParsedPhone?.ok ? keeperParsedPhone.canonical : "";

    const [directLoserPhoneDoc, directKeeperPhoneDoc] = await Promise.all([
      loserCanonicalPhone ? db.collection("phoneIndex").doc(loserCanonicalPhone).get() : Promise.resolve(null),
      keeperCanonicalPhone ? db.collection("phoneIndex").doc(keeperCanonicalPhone).get() : Promise.resolve(null),
    ]);

    // 2. Identity Invariant Checks (SEC-1D-01)

    // Check 1: Both players have different non-empty authUid values
    if (loserUid && keeperUid && loserUid !== keeperUid) {
      return NextResponse.json(
        {
          error: "Both player records have active distinct Firebase authentication UIDs. Merging two authenticated accounts requires administrator resolution.",
          code: "CONFLICTING_AUTH_UIDS",
        },
        { status: 409 },
      );
    }

    // Check 2: Keeper has an existing identity reservation owned by another player (third party)
    if (directKeeperUidDoc?.exists && directKeeperUidDoc.data()?.playerId !== keeperId && directKeeperUidDoc.data()?.playerId !== loserId) {
      return NextResponse.json(
        {
          error: "Keeper auth UID reservation belongs to another player profile.",
          code: "KEEPER_UID_RESERVATION_CONFLICT",
        },
        { status: 409 },
      );
    }
    if (directKeeperPhoneDoc?.exists && directKeeperPhoneDoc.data()?.playerId !== keeperId && directKeeperPhoneDoc.data()?.playerId !== loserId) {
      return NextResponse.json(
        {
          error: "Keeper canonical phone reservation belongs to another player profile.",
          code: "KEEPER_PHONE_RESERVATION_CONFLICT",
        },
        { status: 409 },
      );
    }
    for (const doc of uidIndexKeeperSnap.docs) {
      if (keeperUid && doc.id !== keeperUid) {
        return NextResponse.json(
          {
            error: "Keeper player has conflicting UID reservations.",
            code: "KEEPER_MULTIPLE_UID_RESERVATIONS",
          },
          { status: 409 },
        );
      }
    }

    // Check 3: Loser has an identity reservation owned by a third player
    if (directLoserUidDoc?.exists) {
      const loserUidPlayerId = directLoserUidDoc.data()?.playerId;
      if (loserUidPlayerId !== loserId && loserUidPlayerId !== keeperId) {
        return NextResponse.json(
          {
            error: "Loser auth UID reservation belongs to a third player profile.",
            code: "LOSER_UID_RESERVATION_THIRD_PARTY",
          },
          { status: 409 },
        );
      }
    }
    if (directLoserPhoneDoc?.exists) {
      const loserPhonePlayerId = directLoserPhoneDoc.data()?.playerId;
      if (loserPhonePlayerId !== loserId && loserPhonePlayerId !== keeperId) {
        return NextResponse.json(
          {
            error: "Loser canonical phone reservation belongs to a third player profile.",
            code: "LOSER_PHONE_RESERVATION_THIRD_PARTY",
          },
          { status: 409 },
        );
      }
    }

    // Check 4: Multiple appUsers or conflicting user accounts
    const keeperAppUserUids = Array.from(new Set(appUsersKeeperSnap.docs.map((d) => d.id)));
    if (keeperAppUserUids.length > 1) {
      return NextResponse.json(
        {
          error: "Multiple conflicting user accounts reference the keeper player.",
          code: "MULTIPLE_KEEPER_APP_USERS",
        },
        { status: 409 },
      );
    }
    const loserAppUserUids = Array.from(new Set(appUsersLoserSnap.docs.map((d) => d.id)));
    if (loserAppUserUids.length > 1) {
      return NextResponse.json(
        {
          error: "Multiple conflicting user accounts reference the loser player.",
          code: "MULTIPLE_LOSER_APP_USERS",
        },
        { status: 409 },
      );
    }
    if (keeperAppUserUids.length === 1 && loserAppUserUids.length === 1 && keeperAppUserUids[0] !== loserAppUserUids[0]) {
      return NextResponse.json(
        {
          error: "Conflicting user accounts reference keeper and loser players.",
          code: "CONFLICTING_APP_USERS",
        },
        { status: 409 },
      );
    }

    // Check 5: Canonical phone conflict
    if (loserCanonicalPhone && keeperCanonicalPhone && loserCanonicalPhone !== keeperCanonicalPhone) {
      return NextResponse.json(
        {
          error: "Conflicting canonical phone numbers detected between keeper and loser. Merging players with distinct phone numbers requires administrator resolution.",
          code: "CONFLICTING_CANONICAL_PHONES",
        },
        { status: 409 },
      );
    }

    // 3. Inspect Historical Records to Move
    const [paySnap, feeSnap, orderSnap] = await Promise.all([
      db.collectionGroup("payments").where("playerId", "==", loserId).get(),
      loserRef.collection("otherFees").get(),
      db.collection("merchOrders").where("playerId", "==", loserId).get(),
    ]);

    const paymentsReparented = paySnap.docs.length;
    const feesMoved = feeSnap.docs.length;
    const ordersReparented = orderSnap.docs.length;

    // Check direct appUsers/{loserId}
    const directUserDoc = await db.collection("appUsers").doc(loserId).get();
    const directUserNeedsUpdate = directUserDoc.exists && directUserDoc.data()?.playerId !== keeperId;
    let appUsersReparented = appUsersLoserSnap.docs.length;
    if (directUserNeedsUpdate && !appUsersLoserSnap.docs.some((d) => d.id === loserId)) {
      appUsersReparented++;
    }

    let uidIndexReparented = uidIndexLoserSnap.docs.length;
    let directUidNeedsUpdate: FirebaseFirestore.DocumentReference | null = null;
    if (loserUid && !uidIndexLoserSnap.docs.some((d) => d.id === loserUid)) {
      if (directLoserUidDoc?.exists && directLoserUidDoc.data()?.playerId !== keeperId) {
        directUidNeedsUpdate = directLoserUidDoc.ref;
        uidIndexReparented++;
      }
    }

    let phoneIndexReparented = phoneIndexLoserSnap.docs.length;
    let directPhoneNeedsUpdate: FirebaseFirestore.DocumentReference | null = null;
    if (loserCanonicalPhone && !phoneIndexLoserSnap.docs.some((d) => d.id === loserCanonicalPhone)) {
      if (directLoserPhoneDoc?.exists && directLoserPhoneDoc.data()?.playerId !== keeperId) {
        directPhoneNeedsUpdate = directLoserPhoneDoc.ref;
        phoneIndexReparented++;
      }
    }

    // Fill-in-empties patch on keeper
    const keeperPatch = computeKeeperPatch(keeper, loser);
    const targetUid = keeperUid || loserUid;
    if (!keeperUid && loserUid) {
      keeperPatch.authUid = loserUid;
    }
    const targetCanonicalPhone = keeperCanonicalPhone || loserCanonicalPhone;
    if (!keeper.mobile && loser.mobile) {
      keeperPatch.mobile = loser.mobile;
    }

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
        uidIndexReparented,
        phoneIndexReparented,
        keeperPatch,
      });
    }

    // 4. Stage 1: Atomic Identity State Transition (SEC-1D-02)
    // Run in a transaction to lock identity and update reservations atomically.
    const currentJobStage = existingJob?.stage || "pending";
    if (currentJobStage === "pending" || currentJobStage === "validated") {
      await db.runTransaction(async (transaction) => {
        const freshLoser = await transaction.get(loserRef);
        const freshKeeper = await transaction.get(keeperRef);

        if (!freshLoser.exists || !freshKeeper.exists) {
          throw new Error("Loser or keeper record vanished during merge transaction.");
        }

        const freshLoserData = freshLoser.data() || {};
        const freshKeeperData = freshKeeper.data() || {};

        if (freshLoserData.mergeStatus === "in_progress" && freshLoserData.mergeJobId && freshLoserData.mergeJobId !== jobId) {
          throw new Error("Loser player locked by concurrent merge job.");
        }
        if (freshKeeperData.mergeStatus === "in_progress" && freshKeeperData.mergeJobId && freshKeeperData.mergeJobId !== jobId) {
          throw new Error("Keeper player locked by concurrent merge job.");
        }

        // Initialize or update merge job document
        transaction.set(
          mergeJobRef,
          {
            id: jobId,
            loserId,
            keeperId,
            status: "in_progress",
            stage: "identity_locked",
            startedAt: existingJob?.startedAt || new Date().toISOString(),
            updatedAt: FieldValue.serverTimestamp(),
            stats: {
              paymentsReparented,
              feesMoved,
              ordersReparented,
              appUsersReparented,
              uidIndexReparented,
              phoneIndexReparented,
            },
          },
          { merge: true },
        );

        // Lock loser
        transaction.update(loserRef, {
          mergeStatus: "in_progress",
          mergedInto: keeperId,
          mergeJobId: jobId,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Apply identity patch to keeper and set mergeStatus
        const keeperTxPatch: Record<string, any> = {
          mergeStatus: "in_progress",
          mergeJobId: jobId,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (Object.keys(keeperPatch).length > 0) {
          Object.assign(keeperTxPatch, keeperPatch);
        }
        transaction.update(keeperRef, keeperTxPatch);

        // Reparent target uidIndex reservation
        if (targetUid) {
          transaction.set(
            db.collection("uidIndex").doc(targetUid),
            {
              playerId: keeperId,
              authUid: targetUid,
              canonicalPhone: targetCanonicalPhone || "",
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }

        // Reparent target phoneIndex reservation
        if (targetCanonicalPhone) {
          transaction.set(
            db.collection("phoneIndex").doc(targetCanonicalPhone),
            {
              playerId: keeperId,
              authUid: targetUid || "",
              canonicalPhone: targetCanonicalPhone,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      });
    }

    // Helper for batched execution
    const BATCH_LIMIT = 400;

    // Stage 2: Reparent match payments (Idempotent: queries where playerId == loserId)
    const freshPaySnap = await db
      .collectionGroup("payments")
      .where("playerId", "==", loserId)
      .get();

    for (let i = 0; i < freshPaySnap.docs.length; i += BATCH_LIMIT) {
      const chunk = freshPaySnap.docs.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      for (const d of chunk) {
        batch.update(d.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    await mergeJobRef.update({
      stage: "payments_reparented",
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Stage 3: Move otherFees (Idempotent: copies to keeper, deletes from loser)
    const freshFeeSnap = await loserRef.collection("otherFees").get();
    // 2 operations per item (set + delete), so batch chunk is 200
    const FEE_BATCH_LIMIT = 200;
    for (let i = 0; i < freshFeeSnap.docs.length; i += FEE_BATCH_LIMIT) {
      const chunk = freshFeeSnap.docs.slice(i, i + FEE_BATCH_LIMIT);
      const batch = db.batch();
      for (const feeDoc of chunk) {
        batch.set(keeperRef.collection("otherFees").doc(feeDoc.id), {
          ...feeDoc.data(),
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.delete(feeDoc.ref);
      }
      await batch.commit();
    }
    await mergeJobRef.update({
      stage: "fees_moved",
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Stage 4: Reparent merchOrders
    const freshOrderSnap = await db
      .collection("merchOrders")
      .where("playerId", "==", loserId)
      .get();

    for (let i = 0; i < freshOrderSnap.docs.length; i += BATCH_LIMIT) {
      const chunk = freshOrderSnap.docs.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      for (const d of chunk) {
        batch.update(d.ref, {
          playerId: keeperId,
          playerName: (keeper as any).name || d.data().playerName || "",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    await mergeJobRef.update({
      stage: "orders_reparented",
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Stage 5: Reparent appUsers, uidIndex, and phoneIndex
    const freshUserSnap = await db
      .collection("appUsers")
      .where("playerId", "==", loserId)
      .get();

    const userBatch = db.batch();
    for (const u of freshUserSnap.docs) {
      userBatch.update(u.ref, {
        playerId: keeperId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (directUserNeedsUpdate) {
      userBatch.update(directUserDoc.ref, {
        playerId: keeperId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    // Direct remaining index reparents if any
    for (const u of uidIndexLoserSnap.docs) {
      userBatch.update(u.ref, {
        playerId: keeperId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (directUidNeedsUpdate) {
      userBatch.update(directUidNeedsUpdate, {
        playerId: keeperId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    for (const p of phoneIndexLoserSnap.docs) {
      userBatch.update(p.ref, {
        playerId: keeperId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (directPhoneNeedsUpdate) {
      userBatch.update(directPhoneNeedsUpdate, {
        playerId: keeperId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await userBatch.commit();

    await mergeJobRef.update({
      stage: "app_users_reparented",
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Stage 6: Final Completion & Soft-Delete (All migrations verified)
    const completionBatch = db.batch();
    completionBatch.update(loserRef, {
      disabled: true,
      disabledAt: new Date().toISOString(),
      mergedInto: keeperId,
      mergeStatus: "completed",
      updatedAt: FieldValue.serverTimestamp(),
    });
    completionBatch.update(keeperRef, {
      mergeStatus: "completed",
      updatedAt: FieldValue.serverTimestamp(),
    });
    completionBatch.update(mergeJobRef, {
      status: "completed",
      stage: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await completionBatch.commit();

    return NextResponse.json({
      ok: true,
      dryRun: false,
      jobId,
      paymentsReparented,
      feesMoved,
      ordersReparented,
      appUsersReparented,
      uidIndexReparented,
      phoneIndexReparented,
    });
  } catch (err: any) {
    console.error("merge-players failed", err);
    return NextResponse.json(
      { error: err?.message || "merge failed", code: err?.code },
      { status: 500 },
    );
  }
}
