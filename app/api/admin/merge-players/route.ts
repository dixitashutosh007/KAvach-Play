/**
 * POST, PUT & PATCH /api/admin/merge-players
 *
 * Implements SEC-1F-A:
 * 1. Transactional Identity Reservation Validation:
 *    - Reads loser, keeper, appUsers, uidIndex, phoneIndex, and mergeJob inside transactions before writes.
 *    - Validates all 14 identity conditions inside the transaction before committing any identity changes.
 *    - Never silently steals, overwrites, or reassigns identity reservations.
 *    - Rejects with controlled HTTP 409 responses on any conflict.
 * 2. Exclusive Merge-Job Worker Lease & Stale Worker Fencing:
 *    - Atomic lease acquisition on `mergeJobs/{jobId}` via Firestore transaction.
 *    - Enforces lease ownership (`leaseOwner`, `leaseToken`, `leaseExpiresAt`).
 *    - Monotonically increasing fencing tokens (`fencingToken`) incremented on lease acquisition/reclamation.
 *    - Stale worker protection: every stage transaction verifies leaseOwner, leaseToken, fencingToken,
 *      and lease validity. Stale or superseded workers fail closed and cannot commit mutations.
 *    - Safe lease renewal (`renewMergeLease`) and recovery for expired/failed jobs.
 * 3. Staged, Idempotent & Resumable Merge State Machine:
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
import {
  computeKeeperPatch,
  acquireMergeLease,
  renewMergeLease,
  verifyWorkerFencingAndAdvanceStage,
  executeMergeIdentityStage,
  executeMergeCompletionStage,
  migratePaymentsStage,
  migrateOtherFeesStage,
  migrateMerchOrdersStage,
  migrateAppUsersAndIndexesStage,
  executeIndependentFinalVerification,
} from "../../../../lib/player-merge.ts";
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
 * PUT /api/admin/merge-players
 * Lease renewal endpoint for active workers.
 */
export async function PUT(req: Request) {
  try {
    const { requireClubAdmin } = await import("../../../../lib/server-auth.ts");
    const guard = await requireClubAdmin(req);
    if (!guard.ok) return guard.response;

    const body = await req.json().catch(() => ({}));
    const { jobId, leaseOwner, leaseToken, fencingToken, additionalDurationMs } = body;
    if (!jobId || !leaseOwner || !leaseToken || typeof fencingToken !== "number") {
      return NextResponse.json({ error: "Missing required lease renewal parameters." }, { status: 400 });
    }

    const db = getDb();
    const result = await renewMergeLease(db, jobId, { leaseOwner, leaseToken, fencingToken }, additionalDurationMs);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Lease renewal failed", code: err?.code || "LEASE_RENEWAL_FAILED" },
      { status: err?.status || 409 }
    );
  }
}

/**
 * PATCH /api/admin/merge-players
 * DECOMMISSIONED / RETIRED (Finding 1F-R R5).
 * Unauthenticated or raw batch repair paths bypass player locks, worker leases, fencing,
 * and financial collision controls. All player merges and repairs MUST use the atomic,
 * recoverable POST /api/admin/merge-players workflow.
 */
export async function PATCH() {
  return NextResponse.json(
    {
      error: "PATCH /api/admin/merge-players has been retired. Use POST /api/admin/merge-players for secure, atomic merge operations.",
      code: "METHOD_NOT_ALLOWED",
    },
    { status: 405, headers: { Allow: "POST, PUT" } }
  );
}

/**
 * POST /api/admin/merge-players
 * Orchestrates exclusive lease acquisition, transactional reservation verification,
 * and staged resumable merge.
 */
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
    const loserRef = db.collection("players").doc(loserId);
    const keeperRef = db.collection("players").doc(keeperId);

    // Pre-flight checks for dryRun or early stats
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

    if (keeper.disabled === true || keeper.mergedInto) {
      return NextResponse.json(
        { error: "Keeper player is disabled or already merged into another profile.", code: "KEEPER_INELIGIBLE" },
        { status: 409 },
      );
    }
    if (loser.mergedInto && loser.mergedInto !== keeperId) {
      return NextResponse.json(
        { error: `Loser player has already been merged into player ${loser.mergedInto}.`, code: "LOSER_ALREADY_MERGED" },
        { status: 409 },
      );
    }

    // Inspect historical records to move
    const [paySnap, feeSnap, orderSnap, appUsersLoserSnap, uidIndexLoserSnap, phoneIndexLoserSnap] = await Promise.all([
      db.collectionGroup("payments").where("playerId", "==", loserId).get(),
      loserRef.collection("otherFees").get(),
      db.collection("merchOrders").where("playerId", "==", loserId).get(),
      db.collection("appUsers").where("playerId", "==", loserId).get(),
      db.collection("uidIndex").where("playerId", "==", loserId).get(),
      db.collection("phoneIndex").where("playerId", "==", loserId).get(),
    ]);

    const paymentsReparented = paySnap.docs.length;
    const feesMoved = feeSnap.docs.length;
    const ordersReparented = orderSnap.docs.length;
    const appUsersReparented = appUsersLoserSnap.docs.length;
    const uidIndexReparented = uidIndexLoserSnap.docs.length;
    const phoneIndexReparented = phoneIndexLoserSnap.docs.length;

    const keeperPatch = computeKeeperPatch(keeper, loser);
    const loserUid = loser.authUid ? String(loser.authUid).trim() : "";
    const keeperUid = keeper.authUid ? String(keeper.authUid).trim() : "";
    const targetUid = keeperUid || loserUid;
    if (!keeperUid && loserUid) {
      keeperPatch.authUid = loserUid;
    }

    const loserParsedPhone = loser.mobile ? parseStrictIndianMobile(loser.mobile) : null;
    const keeperParsedPhone = keeper.mobile ? parseStrictIndianMobile(keeper.mobile) : null;
    const loserCanonicalPhone = loserParsedPhone?.ok ? loserParsedPhone.canonical : "";
    const keeperCanonicalPhone = keeperParsedPhone?.ok ? keeperParsedPhone.canonical : "";
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

    // 1. Acquire exclusive merge lease atomically (Gate 1F-A)
    const leaseResult = await acquireMergeLease(db, jobId, loserId, keeperId);
    if (!leaseResult.ok) {
      return NextResponse.json(
        { error: leaseResult.error, code: leaseResult.code },
        { status: leaseResult.status || 409 }
      );
    }
    if (leaseResult.alreadyCompleted) {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        jobId,
        loserId,
        keeperId,
        paymentsReparented: leaseResult.existingJob?.stats?.paymentsReparented || 0,
        feesMoved: leaseResult.existingJob?.stats?.feesMoved || 0,
        ordersReparented: leaseResult.existingJob?.stats?.ordersReparented || 0,
        appUsersReparented: leaseResult.existingJob?.stats?.appUsersReparented || 0,
        uidIndexReparented: leaseResult.existingJob?.stats?.uidIndexReparented || 0,
        phoneIndexReparented: leaseResult.existingJob?.stats?.phoneIndexReparented || 0,
      });
    }

    const workerInfo = leaseResult.workerInfo!;
    const existingJob = leaseResult.existingJob;
    const currentJobStage = existingJob?.stage || "pending";
    const stats = {
      paymentsReparented,
      feesMoved,
      ordersReparented,
      appUsersReparented,
      uidIndexReparented,
      phoneIndexReparented,
    };

    // 2. Stage 1: Atomic Identity State Transition & 14 Invariant Checks
    // Always align identity state and reservations on initiation or retry unless already completed
    if (currentJobStage !== "completed") {
      await executeMergeIdentityStage(
        db,
        jobId,
        loserId,
        keeperId,
        workerInfo,
        keeperPatch,
        targetUid,
        targetCanonicalPhone,
        stats
      );
    }

    // Stage 2: Reparent match payments in bounded chunks (Finding 1F-04)
    await migratePaymentsStage(db, jobId, loserId, keeperId, workerInfo);

    // Stage 3: Move otherFees with collision protection (Finding 1F-03)
    await migrateOtherFeesStage(db, jobId, loserId, keeperId, workerInfo);

    // Stage 4: Reparent merchOrders in bounded chunks (Finding 1F-04)
    await migrateMerchOrdersStage(db, jobId, loserId, keeperId, workerInfo, (keeper as any).name);

    // Stage 5: Reparent appUsers and identity indexes in bounded chunks (Finding 1F-04)
    await migrateAppUsersAndIndexesStage(db, jobId, loserId, keeperId, workerInfo);

    // Stage 6: Independent final verification & completion (Finding 1F-05)
    await executeIndependentFinalVerification(db, jobId, loserId, keeperId, workerInfo);

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
      { error: err?.message || "merge failed", code: err?.code || "INTERNAL_ERROR" },
      { status: err?.status || 500 },
    );
  }
}
