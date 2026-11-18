/**
 * Player Merge Domain Logic (lib/player-merge.ts)
 *
 * Authoritative logic for duplicate player merging and identity reparenting (IDT-001, SEC-1F-A).
 */

import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { parseStrictIndianMobile, isCanonicalIndianMobile } from "./account-linking.ts";

export function normalizeIndianMobile(m: string): string {
  if (!m) return "";
  const digits = String(m).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0"))
    return `+91${digits.slice(1)}`;
  return m;
}

export const FILL_IF_EMPTY = [
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

export function computeKeeperPatch(
  keeper: Record<string, any>,
  loser: Record<string, any>,
): Record<string, any> {
  const patch: Record<string, any> = {};
  for (const field of FILL_IF_EMPTY) {
    const kVal = keeper[field];
    const lVal = loser[field];
    if (
      (kVal === undefined || kVal === null || kVal === "") &&
      lVal !== undefined &&
      lVal !== null &&
      lVal !== ""
    ) {
      patch[field] = lVal;
    }
  }
  if (!keeper.isStudioMember && loser.isStudioMember) {
    patch.isStudioMember = true;
  }
  if (!keeper.isWicketKeeper && loser.isWicketKeeper) {
    patch.isWicketKeeper = true;
  }
  // Reparent authUid if keeper has none and loser has one
  if (!keeper.authUid && loser.authUid) {
    patch.authUid = loser.authUid;
  }

  const canonicalMobile = keeper.mobile || loser.mobile || "";
  const normalized = normalizeIndianMobile(canonicalMobile);
  if (normalized) patch.mobile = normalized;

  return patch;
}

export function planAppUsersReparent(
  appUsers: Array<{ id: string; playerId?: string; [key: string]: any }>,
  loserId: string,
  keeperId: string,
): Array<{ uid: string; oldPlayerId?: string; newPlayerId: string }> {
  const updates: Array<{ uid: string; oldPlayerId?: string; newPlayerId: string }> = [];
  for (const user of appUsers) {
    if (user.playerId === loserId || user.id === loserId) {
      updates.push({
        uid: user.id,
        oldPlayerId: user.playerId,
        newPlayerId: keeperId,
      });
    }
  }
  return updates;
}

export class MergeConflictError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "MergeConflictError";
  }
}

export class StaleWorkerError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code: string = "STALE_WORKER_FENCING_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "StaleWorkerError";
  }
}

export interface MergeWorkerInfo {
  leaseOwner: string;
  leaseToken: string;
  fencingToken: number;
  attemptCount: number;
  leaseExpiresAt: number;
}

/**
 * Acquire exclusive merge lease on mergeJobs/{jobId} atomically in a transaction.
 * Also atomically establishes exclusive player-level locks for BOTH loser and keeper (Finding 1F-R R3).
 */
export async function acquireMergeLease(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  loserId: string,
  keeperId: string,
  options?: { workerId?: string; leaseDurationMs?: number }
): Promise<{
  ok: boolean;
  alreadyCompleted?: boolean;
  workerInfo?: MergeWorkerInfo;
  existingJob?: FirebaseFirestore.DocumentData | null;
  error?: string;
  code?: string;
  status?: number;
}> {
  if (loserId === keeperId) {
    return {
      ok: false,
      status: 400,
      error: "Cannot merge a player into themselves.",
      code: "INVALID_MERGE_TARGET",
    };
  }

  const leaseDurationMs = options?.leaseDurationMs || 60000;
  const mergeJobRef = db.collection("mergeJobs").doc(jobId);
  const loserRef = db.collection("players").doc(loserId);
  const keeperRef = db.collection("players").doc(keeperId);

  return await db.runTransaction(async (transaction) => {
    const [jobSnap, loserSnap, keeperSnap] = await Promise.all([
      transaction.get(mergeJobRef),
      transaction.get(loserRef),
      transaction.get(keeperRef),
    ]);

    if (!loserSnap.exists || !keeperSnap.exists) {
      return {
        ok: false,
        status: 404,
        error: "Loser or keeper player not found.",
        code: "PLAYER_NOT_FOUND",
      };
    }

    const loser = loserSnap.data() || {};
    const keeper = keeperSnap.data() || {};
    const existingJob = jobSnap.exists ? jobSnap.data() || {} : null;

    // Check if merge is already completed
    if (existingJob?.status === "completed" && loser.mergedInto === keeperId && loser.disabled === true) {
      return {
        ok: true,
        alreadyCompleted: true,
        existingJob,
      };
    }

    // Check keeper eligibility
    if (keeper.disabled === true || keeper.mergedInto) {
      return {
        ok: false,
        status: 409,
        error: "Keeper player is disabled or already merged into another profile.",
        code: "KEEPER_INELIGIBLE",
      };
    }

    // Check if loser is already merged into another keeper
    if (loser.mergedInto && loser.mergedInto !== keeperId) {
      return {
        ok: false,
        status: 409,
        error: `Loser player has already been merged into player ${loser.mergedInto}.`,
        code: "LOSER_ALREADY_MERGED",
      };
    }

    // Check player-level locks for BOTH loser and keeper (Finding 1F-R R3)
    // 1. Loser lock check
    if (loser.mergeStatus === "in_progress" && loser.mergeJobId && loser.mergeJobId !== jobId) {
      const competingJobSnap = await transaction.get(db.collection("mergeJobs").doc(loser.mergeJobId));
      if (competingJobSnap.exists) {
        const competingJob = competingJobSnap.data() || {};
        if (competingJob.status === "in_progress" && Date.now() < (competingJob.leaseExpiresAt || 0)) {
          return {
            ok: false,
            status: 409,
            error: "Loser player is currently involved in another active merge job.",
            code: "MERGE_IN_PROGRESS",
          };
        }
      }
      return {
        ok: false,
        status: 409,
        error: "Loser player is locked by another merge job.",
        code: "PLAYER_LOCKED_BY_ANOTHER_JOB",
      };
    }

    // 2. Keeper lock check
    if (keeper.mergeStatus === "in_progress" && keeper.mergeJobId && keeper.mergeJobId !== jobId) {
      const competingJobSnap = await transaction.get(db.collection("mergeJobs").doc(keeper.mergeJobId));
      if (competingJobSnap.exists) {
        const competingJob = competingJobSnap.data() || {};
        if (competingJob.status === "in_progress" && Date.now() < (competingJob.leaseExpiresAt || 0)) {
          return {
            ok: false,
            status: 409,
            error: "Keeper player is currently involved in another active merge job.",
            code: "MERGE_IN_PROGRESS",
          };
        }
      }
      return {
        ok: false,
        status: 409,
        error: "Keeper player is locked by another merge job.",
        code: "KEEPER_LOCKED_BY_ANOTHER_JOB",
      };
    }

    // Check existing lease on THIS job
    const now = Date.now();
    const currentLeaseExpiresAt = existingJob?.leaseExpiresAt || 0;
    const hasActiveLease =
      existingJob?.status === "in_progress" &&
      now < currentLeaseExpiresAt;

    if (hasActiveLease) {
      return {
        ok: false,
        status: 409,
        error: "Merge job is currently locked by another worker lease.",
        code: "ACTIVE_LEASE_EXISTS",
      };
    }

    // Lease is free to acquire
    const fencingToken = (existingJob?.fencingToken || 0) + 1;
    const attemptCount = (existingJob?.attemptCount || 0) + 1;
    const leaseOwner = options?.workerId || `worker_${crypto.randomUUID()}`;
    const leaseToken = `lease_${crypto.randomUUID()}`;
    const leaseExpiresAt = now + leaseDurationMs;

    const workerInfo: MergeWorkerInfo = {
      leaseOwner,
      leaseToken,
      fencingToken,
      attemptCount,
      leaseExpiresAt,
    };

    // Atomically set job lease
    transaction.set(
      mergeJobRef,
      {
        id: jobId,
        jobId,
        loserId,
        keeperId,
        status: "in_progress",
        stage: existingJob?.stage || "pending",
        leaseOwner,
        leaseToken,
        fencingToken,
        attemptCount,
        leaseExpiresAt,
        startedAt: existingJob?.startedAt || new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
        lastHeartbeatAt: new Date().toISOString(),
        lastError: null,
        stats: existingJob?.stats || {},
      },
      { merge: true }
    );

    // Atomically lock BOTH loser and keeper player documents (Finding 1F-R R3)
    transaction.update(loserRef, {
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeFencingToken: fencingToken,
      mergeLeaseOwner: leaseOwner,
      mergeLeaseExpiresAt: leaseExpiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(keeperRef, {
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      mergeFencingToken: fencingToken,
      mergeLeaseOwner: leaseOwner,
      mergeLeaseExpiresAt: leaseExpiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      workerInfo,
      existingJob,
    };
  });
}

/**
 * Renew an active merge lease. Validates current worker ownership and non-expired lease.
 */
export async function renewMergeLease(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  worker: { leaseOwner: string; leaseToken: string; fencingToken: number },
  additionalDurationMs = 60000
): Promise<{ ok: boolean; newExpiresAt: number }> {
  const mergeJobRef = db.collection("mergeJobs").doc(jobId);
  return await db.runTransaction(async (transaction) => {
    const jobSnap = await transaction.get(mergeJobRef);
    if (!jobSnap.exists) {
      throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
    }
    const job = jobSnap.data() || {};
    const now = Date.now();
    if (
      job.leaseOwner !== worker.leaseOwner ||
      job.leaseToken !== worker.leaseToken ||
      job.fencingToken !== worker.fencingToken ||
      job.status !== "in_progress" ||
      now >= (job.leaseExpiresAt || 0)
    ) {
      throw new StaleWorkerError(
        409,
        "Cannot renew lease: lease is invalid, expired, or superseded.",
        "LEASE_RENEWAL_FAILED"
      );
    }

    // ALL READS BEFORE WRITES (Firestore transaction requirement)
    const loserSnap = job.loserId ? await transaction.get(db.collection("players").doc(job.loserId)) : null;
    const keeperSnap = job.keeperId ? await transaction.get(db.collection("players").doc(job.keeperId)) : null;

    // ALL WRITES AFTER READS
    const newExpiresAt = now + additionalDurationMs;
    transaction.update(mergeJobRef, {
      leaseExpiresAt: newExpiresAt,
      lastHeartbeatAt: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update lease expiration on locked player documents
    if (loserSnap?.exists && loserSnap.data()?.mergeJobId === jobId && loserSnap.data()?.mergeStatus === "in_progress") {
      transaction.update(loserSnap.ref, {
        mergeLeaseExpiresAt: newExpiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (keeperSnap?.exists && keeperSnap.data()?.mergeJobId === jobId && keeperSnap.data()?.mergeStatus === "in_progress") {
      transaction.update(keeperSnap.ref, {
        mergeLeaseExpiresAt: newExpiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return { ok: true, newExpiresAt };
  });
}

/**
 * Validates worker fencing tokens and advances the job stage inside a transaction.
 */
export async function verifyWorkerFencingAndAdvanceStage(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  worker: MergeWorkerInfo,
  nextStage: string,
  statsPatch?: Record<string, any>
): Promise<void> {
  const mergeJobRef = db.collection("mergeJobs").doc(jobId);
  await db.runTransaction(async (transaction) => {
    const jobSnap = await transaction.get(mergeJobRef);
    if (!jobSnap.exists) {
      throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
    }
    const job = jobSnap.data() || {};
    const now = Date.now();
    if (
      job.leaseOwner !== worker.leaseOwner ||
      job.leaseToken !== worker.leaseToken ||
      job.fencingToken !== worker.fencingToken ||
      job.status !== "in_progress" ||
      now >= (job.leaseExpiresAt || 0)
    ) {
      throw new StaleWorkerError(
        409,
        "Stale worker detected: lease has expired, been reclaimed, or superseded.",
        "STALE_WORKER_FENCING_ERROR"
      );
    }

    const updates: Record<string, any> = {
      stage: nextStage,
      updatedAt: FieldValue.serverTimestamp(),
      lastHeartbeatAt: new Date().toISOString(),
    };
    if (statsPatch) {
      for (const [k, v] of Object.entries(statsPatch)) {
        updates[`stats.${k}`] = v;
      }
    }
    transaction.update(mergeJobRef, updates);
  });
}

/**
 * Stage 1: Atomic Identity State Transition & 14-Condition Reservation Validation.
 */
export async function executeMergeIdentityStage(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  loserId: string,
  keeperId: string,
  worker: MergeWorkerInfo,
  keeperPatch?: Record<string, any>,
  targetUid?: string,
  targetCanonicalPhone?: string,
  stats?: Record<string, any>
): Promise<void> {
  const mergeJobRef = db.collection("mergeJobs").doc(jobId);
  const loserRef = db.collection("players").doc(loserId);
  const keeperRef = db.collection("players").doc(keeperId);

  await db.runTransaction(async (transaction) => {
    // 1. Transactional reads of job, loser, and keeper
    const [jobSnap, loserSnap, keeperSnap] = await Promise.all([
      transaction.get(mergeJobRef),
      transaction.get(loserRef),
      transaction.get(keeperRef),
    ]);

    if (!jobSnap.exists) {
      throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
    }
    const job = jobSnap.data() || {};
    const now = Date.now();

    // Stale worker fencing verification
    if (
      job.leaseOwner !== worker.leaseOwner ||
      job.leaseToken !== worker.leaseToken ||
      job.fencingToken !== worker.fencingToken ||
      job.status !== "in_progress" ||
      now >= (job.leaseExpiresAt || 0)
    ) {
      throw new StaleWorkerError(
        409,
        "Stale worker detected: lease has expired, been reclaimed, or superseded.",
        "STALE_WORKER_FENCING_ERROR"
      );
    }

    if (!loserSnap.exists || !keeperSnap.exists) {
      throw new MergeConflictError(404, "Loser or keeper record not found during transaction.", "PLAYER_NOT_FOUND");
    }

    const loser = loserSnap.data() || {};
    const keeper = keeperSnap.data() || {};

    if (keeper.disabled === true || keeper.mergedInto) {
      throw new MergeConflictError(409, "Keeper player is disabled or already merged into another profile.", "KEEPER_INELIGIBLE");
    }
    if (loser.mergedInto && loser.mergedInto !== keeperId) {
      throw new MergeConflictError(409, `Loser player has already been merged into player ${loser.mergedInto}.`, "LOSER_ALREADY_MERGED");
    }

    // Derive identity values and patch FRESH from transactional snapshots (Finding 1F-R R6)
    const freshKeeperPatch = computeKeeperPatch(keeper, loser);

    // Identity state identifiers
    const loserUid = loser.authUid ? String(loser.authUid).trim() : "";
    const keeperUid = keeper.authUid ? String(keeper.authUid).trim() : "";
    const freshTargetUid = keeperUid || loserUid || "";

    const loserPhoneRaw = loser.mobile !== undefined ? String(loser.mobile).trim() : "";
    const keeperPhoneRaw = keeper.mobile !== undefined ? String(keeper.mobile).trim() : "";

    let loserCanonicalPhone = "";
    if (loserPhoneRaw) {
      const parsed = parseStrictIndianMobile(loserPhoneRaw);
      if (!parsed.ok || !isCanonicalIndianMobile(parsed.canonical)) {
        throw new MergeConflictError(409, "Malformed or invalid identity reservation record detected.", "MALFORMED_RESERVATION_RECORD");
      }
      loserCanonicalPhone = parsed.canonical;
    }

    let keeperCanonicalPhone = "";
    if (keeperPhoneRaw) {
      const parsed = parseStrictIndianMobile(keeperPhoneRaw);
      if (!parsed.ok || !isCanonicalIndianMobile(parsed.canonical)) {
        throw new MergeConflictError(409, "Malformed or invalid identity reservation record detected.", "MALFORMED_RESERVATION_RECORD");
      }
      keeperCanonicalPhone = parsed.canonical;
    }

    const freshTargetCanonicalPhone = keeperCanonicalPhone || loserCanonicalPhone || "";

    // Condition 1: Conflicting auth UIDs
    if (loserUid && keeperUid && loserUid !== keeperUid) {
      throw new MergeConflictError(
        409,
        "Both player records have active distinct Firebase authentication UIDs. Merging two authenticated accounts requires administrator resolution.",
        "CONFLICTING_AUTH_UIDS"
      );
    }

    // Condition 7: Conflicting canonical phones
    if (loserCanonicalPhone && keeperCanonicalPhone && loserCanonicalPhone !== keeperCanonicalPhone) {
      throw new MergeConflictError(
        409,
        "Conflicting canonical phone numbers detected between keeper and loser. Merging players with distinct phone numbers requires administrator resolution.",
        "CONFLICTING_CANONICAL_PHONES"
      );
    }

    // Read direct index and user documents inside transaction
    const [
      directLoserUidDoc,
      directKeeperUidDoc,
      directLoserPhoneDoc,
      directKeeperPhoneDoc,
      directLoserAppUserDoc,
      directKeeperAppUserDoc,
      uidIndexKeeperSnap,
      uidIndexLoserSnap,
      phoneIndexKeeperSnap,
      phoneIndexLoserSnap,
      appUsersKeeperSnap,
      appUsersLoserSnap,
    ] = await Promise.all([
      loserUid ? transaction.get(db.collection("uidIndex").doc(loserUid)) : Promise.resolve(null),
      keeperUid ? transaction.get(db.collection("uidIndex").doc(keeperUid)) : Promise.resolve(null),
      loserCanonicalPhone ? transaction.get(db.collection("phoneIndex").doc(loserCanonicalPhone)) : Promise.resolve(null),
      keeperCanonicalPhone ? transaction.get(db.collection("phoneIndex").doc(keeperCanonicalPhone)) : Promise.resolve(null),
      loserUid ? transaction.get(db.collection("appUsers").doc(loserUid)) : Promise.resolve(null),
      keeperUid ? transaction.get(db.collection("appUsers").doc(keeperUid)) : Promise.resolve(null),
      transaction.get(db.collection("uidIndex").where("playerId", "==", keeperId)),
      transaction.get(db.collection("uidIndex").where("playerId", "==", loserId)),
      transaction.get(db.collection("phoneIndex").where("playerId", "==", keeperId)),
      transaction.get(db.collection("phoneIndex").where("playerId", "==", loserId)),
      transaction.get(db.collection("appUsers").where("playerId", "==", keeperId)),
      transaction.get(db.collection("appUsers").where("playerId", "==", loserId)),
    ]);

    // Condition 12: Validate malformed reservation records
    const checkMalformedIndex = (docSnap: FirebaseFirestore.DocumentSnapshot | null, isPhone: boolean) => {
      if (!docSnap || !docSnap.exists) return;
      const d = docSnap.data() || {};
      if (typeof d.playerId !== "string" || !d.playerId.trim()) {
        throw new MergeConflictError(409, "Malformed or invalid identity reservation record detected.", "MALFORMED_RESERVATION_RECORD");
      }
      if (isPhone) {
        if (d.canonicalPhone !== undefined && (typeof d.canonicalPhone !== "string" || !isCanonicalIndianMobile(d.canonicalPhone))) {
          throw new MergeConflictError(409, "Malformed or invalid identity reservation record detected.", "MALFORMED_RESERVATION_RECORD");
        }
        if (d.phone !== undefined && (typeof d.phone !== "string" || !isCanonicalIndianMobile(d.phone))) {
          throw new MergeConflictError(409, "Malformed or invalid identity reservation record detected.", "MALFORMED_RESERVATION_RECORD");
        }
        const phoneVal = d.canonicalPhone || d.phone || docSnap.id;
        if (!isCanonicalIndianMobile(phoneVal)) {
          throw new MergeConflictError(409, "Malformed or invalid identity reservation record detected.", "MALFORMED_RESERVATION_RECORD");
        }
      } else {
        if (d.authUid !== undefined && (typeof d.authUid !== "string" || !d.authUid.trim())) {
          throw new MergeConflictError(409, "Malformed or invalid identity reservation record detected.", "MALFORMED_RESERVATION_RECORD");
        }
        const uidVal = d.authUid || docSnap.id;
        if (typeof uidVal !== "string" || !uidVal.trim()) {
          throw new MergeConflictError(409, "Malformed or invalid identity reservation record detected.", "MALFORMED_RESERVATION_RECORD");
        }
      }
    };

    checkMalformedIndex(directLoserUidDoc, false);
    checkMalformedIndex(directKeeperUidDoc, false);
    checkMalformedIndex(directLoserPhoneDoc, true);
    checkMalformedIndex(directKeeperPhoneDoc, true);

    // Condition 3: Keeper UID reservation belongs to another player
    if (directKeeperUidDoc?.exists) {
      const pid = directKeeperUidDoc.data()?.playerId;
      if (pid !== keeperId && pid !== loserId) {
        throw new MergeConflictError(409, "Keeper auth UID reservation belongs to another player profile.", "KEEPER_UID_RESERVATION_CONFLICT");
      }
    }

    // Condition 5: Keeper phone reservation belongs to another player
    if (directKeeperPhoneDoc?.exists) {
      const pid = directKeeperPhoneDoc.data()?.playerId;
      if (pid !== keeperId && pid !== loserId) {
        throw new MergeConflictError(409, "Keeper canonical phone reservation belongs to another player profile.", "KEEPER_PHONE_RESERVATION_CONFLICT");
      }
    }

    // Condition 2: Loser UID reservation belongs to a third player
    if (directLoserUidDoc?.exists) {
      const pid = directLoserUidDoc.data()?.playerId;
      if (pid !== loserId && pid !== keeperId) {
        throw new MergeConflictError(409, "Loser auth UID reservation belongs to a third player profile.", "LOSER_UID_RESERVATION_THIRD_PARTY");
      }
    }

    // Condition 4: Loser phone reservation belongs to a third player
    if (directLoserPhoneDoc?.exists) {
      const pid = directLoserPhoneDoc.data()?.playerId;
      if (pid !== loserId && pid !== keeperId) {
        throw new MergeConflictError(409, "Loser canonical phone reservation belongs to a third player profile.", "LOSER_PHONE_RESERVATION_THIRD_PARTY");
      }
    }

    // Condition 6 & 8: Multiple / ambiguous / orphaned UID reservations or appUsers (Finding 1F-R R7)
    for (const doc of uidIndexKeeperSnap.docs) {
      if (keeperUid && doc.id !== keeperUid) {
        throw new MergeConflictError(409, "Keeper player has conflicting UID reservations.", "KEEPER_MULTIPLE_UID_RESERVATIONS");
      }
      if (!keeperUid) {
        throw new MergeConflictError(409, "Keeper player has orphaned UID reservation but no authUid.", "ORPHANED_UID_RESERVATION");
      }
    }
    for (const doc of uidIndexLoserSnap.docs) {
      if (loserUid && doc.id !== loserUid) {
        throw new MergeConflictError(409, "Loser player has conflicting UID reservations.", "LOSER_MULTIPLE_UID_RESERVATIONS");
      }
      if (!loserUid) {
        throw new MergeConflictError(409, "Loser player has orphaned UID reservation but no authUid.", "ORPHANED_UID_RESERVATION");
      }
    }

    // Check multiple / orphaned phone reservations (Finding 1F-R R7)
    for (const doc of phoneIndexKeeperSnap.docs) {
      if (keeperCanonicalPhone && doc.id !== keeperCanonicalPhone) {
        throw new MergeConflictError(409, "Keeper player has conflicting phone reservations.", "KEEPER_MULTIPLE_PHONE_RESERVATIONS");
      }
      if (!keeperCanonicalPhone) {
        throw new MergeConflictError(409, "Keeper player has orphaned phone reservation but no mobile.", "ORPHANED_PHONE_RESERVATION");
      }
    }
    for (const doc of phoneIndexLoserSnap.docs) {
      if (loserCanonicalPhone && doc.id !== loserCanonicalPhone) {
        throw new MergeConflictError(409, "Loser player has conflicting phone reservations.", "LOSER_MULTIPLE_PHONE_RESERVATIONS");
      }
      if (!loserCanonicalPhone) {
        throw new MergeConflictError(409, "Loser player has orphaned phone reservation but no mobile.", "ORPHANED_PHONE_RESERVATION");
      }
    }

    const keeperAppUserUids = Array.from(new Set(appUsersKeeperSnap.docs.map((d) => d.id)));
    if (keeperAppUserUids.length > 1) {
      throw new MergeConflictError(409, "Multiple conflicting user accounts reference the keeper player.", "MULTIPLE_KEEPER_APP_USERS");
    }
    const loserAppUserUids = Array.from(new Set(appUsersLoserSnap.docs.map((d) => d.id)));
    if (loserAppUserUids.length > 1) {
      throw new MergeConflictError(409, "Multiple conflicting user accounts reference the loser player.", "MULTIPLE_LOSER_APP_USERS");
    }
    if (keeperAppUserUids.length === 1 && loserAppUserUids.length === 1 && keeperAppUserUids[0] !== loserAppUserUids[0]) {
      throw new MergeConflictError(409, "Conflicting user accounts reference keeper and loser players.", "CONFLICTING_APP_USERS");
    }

    // Condition 5 (extended): players.authUid conflicts with appUsers.playerId
    if (directLoserAppUserDoc?.exists) {
      const p = directLoserAppUserDoc.data()?.playerId;
      if (p && p !== loserId && p !== keeperId) {
        throw new MergeConflictError(409, "Player authUid conflicts with appUser record playerId.", "AUTH_UID_APP_USER_MISMATCH");
      }
    }
    if (directKeeperAppUserDoc?.exists) {
      const p = directKeeperAppUserDoc.data()?.playerId;
      if (p && p !== keeperId && p !== loserId) {
        throw new MergeConflictError(409, "Player authUid conflicts with appUser record playerId.", "AUTH_UID_APP_USER_MISMATCH");
      }
    }

    // Condition 9: uidIndex and phoneIndex disagree
    if (directLoserUidDoc?.exists && directLoserPhoneDoc?.exists) {
      const uPhone = directLoserUidDoc.data()?.canonicalPhone;
      if (uPhone && loserCanonicalPhone && uPhone !== loserCanonicalPhone) {
        throw new MergeConflictError(409, "uidIndex and phoneIndex disagree on canonical phone mapping.", "INDEX_RESERVATIONS_DISAGREE");
      }
      const pUid = directLoserPhoneDoc.data()?.authUid;
      if (pUid && loserUid && pUid !== loserUid) {
        throw new MergeConflictError(409, "phoneIndex and uidIndex disagree on authUid mapping.", "INDEX_RESERVATIONS_DISAGREE");
      }
    }
    if (directKeeperUidDoc?.exists && directKeeperPhoneDoc?.exists) {
      const uPhone = directKeeperUidDoc.data()?.canonicalPhone;
      if (uPhone && keeperCanonicalPhone && uPhone !== keeperCanonicalPhone) {
        throw new MergeConflictError(409, "uidIndex and phoneIndex disagree on canonical phone mapping.", "INDEX_RESERVATIONS_DISAGREE");
      }
      const pUid = directKeeperPhoneDoc.data()?.authUid;
      if (pUid && keeperUid && pUid !== keeperUid) {
        throw new MergeConflictError(409, "phoneIndex and uidIndex disagree on authUid mapping.", "INDEX_RESERVATIONS_DISAGREE");
      }
    }

    // All 14 checks passed: commit Stage 1 transactional writes
    transaction.update(mergeJobRef, {
      stage: "identity_locked",
      stats: stats || {},
      updatedAt: FieldValue.serverTimestamp(),
      lastHeartbeatAt: new Date().toISOString(),
    });

    transaction.update(loserRef, {
      mergeStatus: "in_progress",
      mergedInto: keeperId,
      mergeJobId: jobId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const keeperTxPatch: Record<string, any> = {
      mergeStatus: "in_progress",
      mergeJobId: jobId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (Object.keys(freshKeeperPatch).length > 0) {
      Object.assign(keeperTxPatch, freshKeeperPatch);
    }
    transaction.update(keeperRef, keeperTxPatch);

    // Reparent target uidIndex reservation (no unconditional overwrites)
    if (freshTargetUid) {
      const targetUidRef = db.collection("uidIndex").doc(freshTargetUid);
      const targetSnap = freshTargetUid === loserUid ? directLoserUidDoc : (freshTargetUid === keeperUid ? directKeeperUidDoc : null);
      if (targetSnap?.exists) {
        transaction.update(targetUidRef, {
          playerId: keeperId,
          authUid: freshTargetUid,
          canonicalPhone: freshTargetCanonicalPhone || "",
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(targetUidRef, {
          playerId: keeperId,
          authUid: freshTargetUid,
          canonicalPhone: freshTargetCanonicalPhone || "",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // Reparent target phoneIndex reservation (no unconditional overwrites)
    if (freshTargetCanonicalPhone) {
      const targetPhoneRef = db.collection("phoneIndex").doc(freshTargetCanonicalPhone);
      const targetSnap = freshTargetCanonicalPhone === loserCanonicalPhone ? directLoserPhoneDoc : (freshTargetCanonicalPhone === keeperCanonicalPhone ? directKeeperPhoneDoc : null);
      if (targetSnap?.exists) {
        transaction.update(targetPhoneRef, {
          playerId: keeperId,
          authUid: freshTargetUid || "",
          canonicalPhone: freshTargetCanonicalPhone,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(targetPhoneRef, {
          playerId: keeperId,
          authUid: freshTargetUid || "",
          canonicalPhone: freshTargetCanonicalPhone,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  });
}

/**
 * Stage 6: Final Completion & Soft-Delete (Guarded by Fencing Check in Transaction).
 */
export async function executeMergeCompletionStage(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  loserId: string,
  keeperId: string,
  worker: MergeWorkerInfo
): Promise<void> {
  const mergeJobRef = db.collection("mergeJobs").doc(jobId);
  const loserRef = db.collection("players").doc(loserId);
  const keeperRef = db.collection("players").doc(keeperId);

  await db.runTransaction(async (transaction) => {
    const [jobSnap, loserSnap, keeperSnap] = await Promise.all([
      transaction.get(mergeJobRef),
      transaction.get(loserRef),
      transaction.get(keeperRef),
    ]);

    if (!jobSnap.exists) {
      throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
    }
    const job = jobSnap.data() || {};
    const now = Date.now();

    if (
      job.leaseOwner !== worker.leaseOwner ||
      job.leaseToken !== worker.leaseToken ||
      job.fencingToken !== worker.fencingToken ||
      job.status !== "in_progress" ||
      now >= (job.leaseExpiresAt || 0)
    ) {
      throw new StaleWorkerError(
        409,
        "Stale worker detected: lease has expired, been reclaimed, or superseded.",
        "STALE_WORKER_FENCING_ERROR"
      );
    }

    transaction.update(loserRef, {
      disabled: true,
      disabledAt: new Date().toISOString(),
      mergedInto: keeperId,
      mergeStatus: "completed",
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(keeperRef, {
      mergeStatus: "completed",
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(mergeJobRef, {
      status: "completed",
      stage: "completed",
      completedAt: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
      lastHeartbeatAt: new Date().toISOString(),
    });
  });
}

export function areFeesIdentical(src: Record<string, any>, dest: Record<string, any>): boolean {
  if (Number(src.amount) !== Number(dest.amount)) return false;
  if ((src.title || "").trim() !== (dest.title || "").trim()) return false;
  if ((src.status || "") !== (dest.status || "")) return false;
  if ((src.templateId || "") !== (dest.templateId || "")) return false;
  if ((src.paymentMethod || "") !== (dest.paymentMethod || "")) return false;
  if ((src.razorpayPaymentId || "") !== (dest.razorpayPaymentId || "")) return false;
  const srcPaid = Number(src.paidAmount || src.feeCollectedAmount || 0);
  const destPaid = Number(dest.paidAmount || dest.feeCollectedAmount || 0);
  if (srcPaid !== destPaid) return false;
  if ((src.receiptId || "") !== (dest.receiptId || "")) return false;
  if ((src.waivedReason || "") !== (dest.waivedReason || "")) return false;
  const srcRefund = (src.refundId || src.refundReference || "");
  const destRefund = (dest.refundId || dest.refundReference || "");
  if (srcRefund !== destRefund) return false;
  if ((src.cancelledBy || "") !== (dest.cancelledBy || "")) return false;
  return true;
}

export interface MigrationStageOptions {
  batchLimit?: number;
  onAfterChunkCommit?: (chunkIndex: number, count: number) => Promise<void> | void;
}

/**
 * Stage 2: Bounded, Resumable Migration of Match Payments (Finding 1F-R R1, R2, R4, R9).
 * Every chunk commit is transactionally guarded by worker fencing and lease validation.
 */
export async function migratePaymentsStage(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  loserId: string,
  keeperId: string,
  worker: MergeWorkerInfo,
  options?: MigrationStageOptions
): Promise<{ count: number }> {
  const batchLimit = options?.batchLimit || 100;
  const mergeJobRef = db.collection("mergeJobs").doc(jobId);

  let hasMore = true;
  let totalProcessed = 0;
  let chunkIndex = 0;

  while (hasMore) {
    const pageSnap = await db
      .collectionGroup("payments")
      .where("playerId", "==", loserId)
      .limit(batchLimit)
      .get();

    if (pageSnap.empty) {
      hasMore = false;
      break;
    }

    await db.runTransaction(async (transaction) => {
      // 1. Transactionally read mergeJobRef to verify fencing and lease (Finding 1F-R R1)
      const jobSnap = await transaction.get(mergeJobRef);
      if (!jobSnap.exists) {
        throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
      }
      const job = jobSnap.data() || {};
      const now = Date.now();
      if (
        job.leaseOwner !== worker.leaseOwner ||
        job.leaseToken !== worker.leaseToken ||
        job.fencingToken !== worker.fencingToken ||
        job.status !== "in_progress" ||
        now >= (job.leaseExpiresAt || 0)
      ) {
        throw new StaleWorkerError(
          409,
          "Stale worker detected: lease has expired, been reclaimed, or superseded.",
          "STALE_WORKER_FENCING_ERROR"
        );
      }

      // 2. Process payments in chunk with financial collision protection
      for (const d of pageSnap.docs) {
        transaction.update(d.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // 3. Atomically update job progress, heartbeat, and extend lease (Finding 1F-R R2, R8)
      chunkIndex++;
      totalProcessed += pageSnap.docs.length;
      const newExpiresAt = now + 60000;
      transaction.update(mergeJobRef, {
        "stats.paymentsReparented": totalProcessed,
        "stats.paymentsReparentedChunks": chunkIndex,
        "stats.lastCommittedChunk": `payments_chunk_${chunkIndex}`,
        leaseExpiresAt: newExpiresAt,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    if (options?.onAfterChunkCommit) {
      await options.onAfterChunkCommit(chunkIndex - 1, totalProcessed);
    }

    if (pageSnap.docs.length < batchLimit) {
      hasMore = false;
    }
  }

  await verifyWorkerFencingAndAdvanceStage(db, jobId, worker, "payments_reparented", {
    paymentsReparented: totalProcessed,
  });
  return { count: totalProcessed };
}

/**
 * Stage 3: Collision-Protected, Resumable Migration of OtherFees (Finding 1F-R R1, R4).
 * Compares authoritative financial identity, value, and audit fields. Rejects conflicts with 409.
 */
export async function migrateOtherFeesStage(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  loserId: string,
  keeperId: string,
  worker: MergeWorkerInfo,
  options?: MigrationStageOptions
): Promise<{ count: number }> {
  const loserRef = db.collection("players").doc(loserId);
  const keeperRef = db.collection("players").doc(keeperId);
  const mergeJobRef = db.collection("mergeJobs").doc(jobId);

  const batchLimit = options?.batchLimit || 50;
  let hasMore = true;
  let totalMoved = 0;
  let totalSkipped = 0;
  let chunkIndex = 0;

  while (hasMore) {
    const pageSnap = await loserRef.collection("otherFees").limit(batchLimit).get();
    if (pageSnap.empty) {
      hasMore = false;
      break;
    }

    const destRefs = pageSnap.docs.map((d) => keeperRef.collection("otherFees").doc(d.id));

    await db.runTransaction(async (transaction) => {
      // 1. Transactionally read mergeJobRef to verify fencing and lease (Finding 1F-R R1)
      const jobSnap = await transaction.get(mergeJobRef);
      if (!jobSnap.exists) {
        throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
      }
      const job = jobSnap.data() || {};
      const now = Date.now();
      if (
        job.leaseOwner !== worker.leaseOwner ||
        job.leaseToken !== worker.leaseToken ||
        job.fencingToken !== worker.fencingToken ||
        job.status !== "in_progress" ||
        now >= (job.leaseExpiresAt || 0)
      ) {
        throw new StaleWorkerError(
          409,
          "Stale worker detected: lease has expired, been reclaimed, or superseded.",
          "STALE_WORKER_FENCING_ERROR"
        );
      }

      // 2. Read destination fees in transaction
      const destSnaps = await Promise.all(destRefs.map((ref) => transaction.get(ref)));

      let chunkMoved = 0;
      let chunkSkipped = 0;

      for (let idx = 0; idx < pageSnap.docs.length; idx++) {
        const srcDoc = pageSnap.docs[idx];
        const srcData = srcDoc.data() || {};
        const destSnap = destSnaps[idx];

        if (destSnap.exists) {
          const destData = destSnap.data() || {};
          if (areFeesIdentical(srcData, destData)) {
            // Identical authoritative record: safe idempotent deduplication
            transaction.delete(srcDoc.ref);
            chunkSkipped++;
          } else {
            // Conflicting financial record: abort without modifying either doc (Finding 1F-R R4)
            transaction.update(mergeJobRef, {
              lastError: `Financial record collision: keeper already has fee ${srcDoc.id} with different content.`,
              "stats.conflicts": FieldValue.increment(1),
              updatedAt: FieldValue.serverTimestamp(),
            });
            throw new MergeConflictError(
              409,
              `Financial record collision detected: keeper already has fee ${srcDoc.id} with different content. Manual resolution required.`,
              "FINANCIAL_RECORD_COLLISION"
            );
          }
        } else {
          // Destination does not exist: copy to keeper and delete from loser
          transaction.set(destRefs[idx], {
            ...srcData,
            playerId: keeperId,
            updatedAt: FieldValue.serverTimestamp(),
          });
          transaction.delete(srcDoc.ref);
          chunkMoved++;
        }
      }

      chunkIndex++;
      totalMoved += chunkMoved;
      totalSkipped += chunkSkipped;
      const newExpiresAt = now + 60000;

      transaction.update(mergeJobRef, {
        "stats.feesMoved": totalMoved,
        "stats.feesSkipped": totalSkipped,
        "stats.feesMovedChunks": chunkIndex,
        "stats.lastCommittedChunk": `fees_chunk_${chunkIndex}`,
        leaseExpiresAt: newExpiresAt,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    if (options?.onAfterChunkCommit) {
      await options.onAfterChunkCommit(chunkIndex - 1, totalMoved + totalSkipped);
    }

    if (pageSnap.docs.length < batchLimit) {
      hasMore = false;
    }
  }

  await verifyWorkerFencingAndAdvanceStage(db, jobId, worker, "fees_moved", {
    feesMoved: totalMoved,
    feesSkipped: totalSkipped,
  });
  return { count: totalMoved + totalSkipped };
}

/**
 * Stage 4: Bounded Migration of Merch Orders (Finding 1F-R R1, R9).
 * Every chunk commit is transactionally guarded by worker fencing and lease validation.
 */
export async function migrateMerchOrdersStage(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  loserId: string,
  keeperId: string,
  worker: MergeWorkerInfo,
  keeperName?: string,
  options?: MigrationStageOptions
): Promise<{ count: number }> {
  const batchLimit = options?.batchLimit || 100;
  const mergeJobRef = db.collection("mergeJobs").doc(jobId);

  let hasMore = true;
  let totalProcessed = 0;
  let chunkIndex = 0;

  while (hasMore) {
    const pageSnap = await db
      .collection("merchOrders")
      .where("playerId", "==", loserId)
      .limit(batchLimit)
      .get();

    if (pageSnap.empty) {
      hasMore = false;
      break;
    }

    await db.runTransaction(async (transaction) => {
      // 1. Transactionally read mergeJobRef to verify fencing and lease (Finding 1F-R R1)
      const jobSnap = await transaction.get(mergeJobRef);
      if (!jobSnap.exists) {
        throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
      }
      const job = jobSnap.data() || {};
      const now = Date.now();
      if (
        job.leaseOwner !== worker.leaseOwner ||
        job.leaseToken !== worker.leaseToken ||
        job.fencingToken !== worker.fencingToken ||
        job.status !== "in_progress" ||
        now >= (job.leaseExpiresAt || 0)
      ) {
        throw new StaleWorkerError(
          409,
          "Stale worker detected: lease has expired, been reclaimed, or superseded.",
          "STALE_WORKER_FENCING_ERROR"
        );
      }

      // 2. Update each merch order
      for (const d of pageSnap.docs) {
        transaction.update(d.ref, {
          playerId: keeperId,
          playerName: keeperName || d.data().playerName || "",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // 3. Update job progress and renew lease
      chunkIndex++;
      totalProcessed += pageSnap.docs.length;
      const newExpiresAt = now + 60000;
      transaction.update(mergeJobRef, {
        "stats.ordersReparented": totalProcessed,
        "stats.ordersReparentedChunks": chunkIndex,
        "stats.lastCommittedChunk": `orders_chunk_${chunkIndex}`,
        leaseExpiresAt: newExpiresAt,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    if (options?.onAfterChunkCommit) {
      await options.onAfterChunkCommit(chunkIndex - 1, totalProcessed);
    }

    if (pageSnap.docs.length < batchLimit) {
      hasMore = false;
    }
  }

  await verifyWorkerFencingAndAdvanceStage(db, jobId, worker, "orders_reparented", {
    ordersReparented: totalProcessed,
  });
  return { count: totalProcessed };
}

/**
 * Stage 5: Bounded Migration of AppUsers and Identity Indexes (Finding 1F-R R1, R9).
 * Every chunk commit is transactionally guarded by worker fencing and lease validation.
 */
export async function migrateAppUsersAndIndexesStage(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  loserId: string,
  keeperId: string,
  worker: MergeWorkerInfo,
  options?: MigrationStageOptions
): Promise<{ count: number }> {
  const batchLimit = options?.batchLimit || 100;
  const mergeJobRef = db.collection("mergeJobs").doc(jobId);

  const [freshUserSnap, directUserDoc, freshUidSnap, freshPhoneSnap] = await Promise.all([
    db.collection("appUsers").where("playerId", "==", loserId).get(),
    db.collection("appUsers").doc(loserId).get(),
    db.collection("uidIndex").where("playerId", "==", loserId).get(),
    db.collection("phoneIndex").where("playerId", "==", loserId).get(),
  ]);

  const operations: Array<FirebaseFirestore.DocumentReference> = [];
  for (const u of freshUserSnap.docs) {
    operations.push(u.ref);
  }
  if (directUserDoc.exists && directUserDoc.data()?.playerId === loserId) {
    operations.push(directUserDoc.ref);
  }
  for (const u of freshUidSnap.docs) {
    operations.push(u.ref);
  }
  for (const p of freshPhoneSnap.docs) {
    operations.push(p.ref);
  }

  let totalProcessed = 0;
  let chunkIndex = 0;

  for (let i = 0; i < operations.length; i += batchLimit) {
    const chunk = operations.slice(i, i + batchLimit);

    await db.runTransaction(async (transaction) => {
      // 1. Transactionally read mergeJobRef to verify fencing and lease (Finding 1F-R R1)
      const jobSnap = await transaction.get(mergeJobRef);
      if (!jobSnap.exists) {
        throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
      }
      const job = jobSnap.data() || {};
      const now = Date.now();
      if (
        job.leaseOwner !== worker.leaseOwner ||
        job.leaseToken !== worker.leaseToken ||
        job.fencingToken !== worker.fencingToken ||
        job.status !== "in_progress" ||
        now >= (job.leaseExpiresAt || 0)
      ) {
        throw new StaleWorkerError(
          409,
          "Stale worker detected: lease has expired, been reclaimed, or superseded.",
          "STALE_WORKER_FENCING_ERROR"
        );
      }

      // 2. Update each doc in chunk
      for (const ref of chunk) {
        transaction.update(ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // 3. Update job progress and renew lease
      chunkIndex++;
      totalProcessed += chunk.length;
      const newExpiresAt = now + 60000;
      transaction.update(mergeJobRef, {
        "stats.appUsersReparented": totalProcessed,
        "stats.appUsersReparentedChunks": chunkIndex,
        "stats.lastCommittedChunk": `appusers_chunk_${chunkIndex}`,
        leaseExpiresAt: newExpiresAt,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    if (options?.onAfterChunkCommit) {
      await options.onAfterChunkCommit(chunkIndex - 1, totalProcessed);
    }
  }

  await verifyWorkerFencingAndAdvanceStage(db, jobId, worker, "app_users_reparented", {
    appUsersReparented: freshUserSnap.docs.length,
    uidIndexReparented: freshUidSnap.docs.length,
    phoneIndexReparented: freshPhoneSnap.docs.length,
  });
  return { count: totalProcessed };
}

/**
 * Stage 6: Independent Final Verification & Completion (Finding 1F-R R10).
 * Fail-closed verification proves complete migration before soft-delete and completion.
 */
export async function executeIndependentFinalVerification(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  loserId: string,
  keeperId: string,
  worker: MergeWorkerInfo
): Promise<void> {
  const loserRef = db.collection("players").doc(loserId);
  const keeperRef = db.collection("players").doc(keeperId);

  // 1. Verify no payments still reference loser
  const paymentsSnap = await db.collectionGroup("payments").where("playerId", "==", loserId).get();
  if (!paymentsSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${paymentsSnap.docs.length} payments still reference loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 2. Verify no merchOrders still reference loser
  const ordersSnap = await db.collection("merchOrders").where("playerId", "==", loserId).get();
  if (!ordersSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${ordersSnap.docs.length} merchandise orders still reference loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 3. Verify no otherFees remain under loser
  const feesSnap = await loserRef.collection("otherFees").get();
  if (!feesSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${feesSnap.docs.length} otherFees records still exist under loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 4. Verify no appUsers still reference loser
  const usersSnap = await db.collection("appUsers").where("playerId", "==", loserId).get();
  if (!usersSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${usersSnap.docs.length} appUsers still reference loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 5. Verify no uidIndex records still reference loser
  const uidSnap = await db.collection("uidIndex").where("playerId", "==", loserId).get();
  if (!uidSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${uidSnap.docs.length} uidIndex records still reference loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 6. Verify no phoneIndex records still reference loser
  const phoneSnap = await db.collection("phoneIndex").where("playerId", "==", loserId).get();
  if (!phoneSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${phoneSnap.docs.length} phoneIndex records still reference loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 7. Verify keeper player document state
  const keeperSnap = await keeperRef.get();
  if (!keeperSnap.exists) {
    throw new MergeConflictError(404, "Keeper player document missing during final verification.", "FINAL_VERIFICATION_FAILED");
  }
  const keeperData = keeperSnap.data() || {};
  if (keeperData.disabled === true || (keeperData.mergedInto && keeperData.mergedInto !== keeperId)) {
    throw new MergeConflictError(409, "Keeper player is disabled or merged into another record.", "FINAL_VERIFICATION_FAILED");
  }

  // 8. Verify keeper authoritative phone reservation (Finding 1F-R R10: fail closed if missing)
  if (keeperData.mobile) {
    const parsed = parseStrictIndianMobile(keeperData.mobile);
    if (!parsed.ok) {
      throw new MergeConflictError(
        409,
        "Final verification failed: keeper mobile number is invalid.",
        "FINAL_VERIFICATION_FAILED"
      );
    }
    const piSnap = await db.collection("phoneIndex").doc(parsed.canonical).get();
    if (!piSnap.exists || piSnap.data()?.playerId !== keeperId) {
      throw new MergeConflictError(
        409,
        `Final verification failed: expected keeper phone reservation missing or does not map to keeper playerId.`,
        "FINAL_VERIFICATION_FAILED"
      );
    }
  }

  // 9. Verify keeper authoritative UID reservation (Finding 1F-R R10: fail closed if missing)
  if (keeperData.authUid) {
    const uiSnap = await db.collection("uidIndex").doc(keeperData.authUid).get();
    if (!uiSnap.exists || uiSnap.data()?.playerId !== keeperId) {
      throw new MergeConflictError(
        409,
        `Final verification failed: expected keeper UID reservation missing or does not map to keeper playerId.`,
        "FINAL_VERIFICATION_FAILED"
      );
    }
    const appUserSnap = await db.collection("appUsers").doc(keeperData.authUid).get();
    if (appUserSnap.exists && appUserSnap.data()?.playerId !== keeperId) {
      throw new MergeConflictError(
        409,
        `Final verification failed: keeper appUser account does not map to keeper playerId.`,
        "FINAL_VERIFICATION_FAILED"
      );
    }
  }

  // 10. Execute atomic completion stage with fencing token verification
  await executeMergeCompletionStage(db, jobId, loserId, keeperId, worker);
}
