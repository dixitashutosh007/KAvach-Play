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
    if (existingJob?.status === "completed") {
      if (loser.mergedInto === keeperId && loser.disabled === true && loser.mergeStatus === "completed") {
        return {
          ok: true,
          alreadyCompleted: true,
          existingJob,
        };
      }
      return {
        ok: false,
        status: 409,
        error: "Merge job is marked completed but player records are in incomplete merge state. Requires operator resolution.",
        code: "INCOMPLETE_COMPLETED_JOB",
      };
    }

    // Check for malformed player locks (mergeStatus in_progress without mergeJobId)
    if (loser.mergeStatus === "in_progress" && (!loser.mergeJobId || typeof loser.mergeJobId !== "string" || !loser.mergeJobId.trim())) {
      return {
        ok: false,
        status: 409,
        error: "Loser player has mergeStatus in_progress but is missing mergeJobId. Ambiguous lock requires operator resolution.",
        code: "MALFORMED_PLAYER_LOCK",
      };
    }
    if (keeper.mergeStatus === "in_progress" && (!keeper.mergeJobId || typeof keeper.mergeJobId !== "string" || !keeper.mergeJobId.trim())) {
      return {
        ok: false,
        status: 409,
        error: "Keeper player has mergeStatus in_progress but is missing mergeJobId. Ambiguous lock requires operator resolution.",
        code: "MALFORMED_PLAYER_LOCK",
      };
    }

    // Check cross-job lock conflict (loser and keeper locked to different merge jobs)
    if (
      loser.mergeJobId &&
      keeper.mergeJobId &&
      loser.mergeJobId !== keeper.mergeJobId &&
      loser.mergeStatus === "in_progress" &&
      keeper.mergeStatus === "in_progress"
    ) {
      return {
        ok: false,
        status: 409,
        error: `Loser is locked by job ${loser.mergeJobId} while keeper is locked by job ${keeper.mergeJobId}. Cross-job conflict requires operator resolution.`,
        code: "CROSS_JOB_LOCK_CONFLICT",
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

    // Check player-level locks for BOTH loser and keeper (Finding 1F-R R3 & Stale Lock Recovery)
    const now = Date.now();

    // 1. Loser lock check
    if (loser.mergeStatus === "in_progress" && loser.mergeJobId && loser.mergeJobId !== jobId) {
      const competingJobSnap = await transaction.get(db.collection("mergeJobs").doc(loser.mergeJobId));
      if (competingJobSnap.exists) {
        const competingJob = competingJobSnap.data() || {};
        if (competingJob.status === "in_progress" && now < (competingJob.leaseExpiresAt || 0)) {
          return {
            ok: false,
            status: 409,
            error: "Loser player is currently involved in another active merge job.",
            code: "MERGE_IN_PROGRESS",
          };
        }
        if (competingJob.status === "completed" && loser.mergedInto && loser.mergedInto !== keeperId) {
          return {
            ok: false,
            status: 409,
            error: `Loser player has already been merged into player ${loser.mergedInto}.`,
            code: "LOSER_ALREADY_MERGED",
          };
        }
        // Competing job exists but is expired or failed: require explicit operator resolution for foreign job
        return {
          ok: false,
          status: 409,
          error: "Loser player is locked by another merge job.",
          code: "PLAYER_LOCKED_BY_ANOTHER_JOB",
        };
      } else {
        // Competing job document does NOT exist in mergeJobs (orphaned foreign lock)
        // Missing, null, or malformed lock metadata must NEVER count as proof of expiry (fail closed with 409 MALFORMED_PLAYER_LOCK)
        if (!loser.mergeLeaseOwner || typeof loser.mergeLeaseOwner !== "string" || !loser.mergeLeaseOwner.trim()) {
          return {
            ok: false,
            status: 409,
            error: "Loser player is locked by an orphaned merge job but has missing or invalid mergeLeaseOwner. Ambiguous lock requires operator resolution.",
            code: "MALFORMED_PLAYER_LOCK",
          };
        }
        if (typeof loser.mergeFencingToken !== "number" || !Number.isInteger(loser.mergeFencingToken) || loser.mergeFencingToken <= 0) {
          return {
            ok: false,
            status: 409,
            error: "Loser player is locked by an orphaned merge job but has missing or invalid mergeFencingToken. Ambiguous lock requires operator resolution.",
            code: "MALFORMED_PLAYER_LOCK",
          };
        }
        if (typeof loser.mergeLeaseExpiresAt !== "number" || !Number.isFinite(loser.mergeLeaseExpiresAt) || loser.mergeLeaseExpiresAt <= 0) {
          return {
            ok: false,
            status: 409,
            error: "Loser player is locked by an orphaned merge job but has missing or invalid mergeLeaseExpiresAt. Ambiguous lock requires operator resolution.",
            code: "MALFORMED_PLAYER_LOCK",
          };
        }

        // Reclaim only when expiry is explicitly a finite number in the past (now >= mergeLeaseExpiresAt)
        if (now < loser.mergeLeaseExpiresAt) {
          return {
            ok: false,
            status: 409,
            error: "Loser player is locked by another unexpired merge lease.",
            code: "PLAYER_LOCKED_BY_ANOTHER_JOB",
          };
        }
        // Expired lock with missing job AND complete, consistent lock metadata: can be safely reclaimed by this new job
      }
    }

    // 2. Keeper lock check
    if (keeper.mergeStatus === "in_progress" && keeper.mergeJobId && keeper.mergeJobId !== jobId) {
      const competingJobSnap = await transaction.get(db.collection("mergeJobs").doc(keeper.mergeJobId));
      if (competingJobSnap.exists) {
        const competingJob = competingJobSnap.data() || {};
        if (competingJob.status === "in_progress" && now < (competingJob.leaseExpiresAt || 0)) {
          return {
            ok: false,
            status: 409,
            error: "Keeper player is currently involved in another active merge job.",
            code: "KEEPER_LOCKED",
          };
        }
        return {
          ok: false,
          status: 409,
          error: "Keeper player is locked by another merge job.",
          code: "KEEPER_LOCKED_BY_ANOTHER_JOB",
        };
      } else {
        // Competing job document missing in mergeJobs (orphaned foreign lock)
        // Missing, null, or malformed lock metadata must NEVER count as proof of expiry (fail closed with 409 MALFORMED_PLAYER_LOCK)
        if (!keeper.mergeLeaseOwner || typeof keeper.mergeLeaseOwner !== "string" || !keeper.mergeLeaseOwner.trim()) {
          return {
            ok: false,
            status: 409,
            error: "Keeper player is locked by an orphaned merge job but has missing or invalid mergeLeaseOwner. Ambiguous lock requires operator resolution.",
            code: "MALFORMED_PLAYER_LOCK",
          };
        }
        if (typeof keeper.mergeFencingToken !== "number" || !Number.isInteger(keeper.mergeFencingToken) || keeper.mergeFencingToken <= 0) {
          return {
            ok: false,
            status: 409,
            error: "Keeper player is locked by an orphaned merge job but has missing or invalid mergeFencingToken. Ambiguous lock requires operator resolution.",
            code: "MALFORMED_PLAYER_LOCK",
          };
        }
        if (typeof keeper.mergeLeaseExpiresAt !== "number" || !Number.isFinite(keeper.mergeLeaseExpiresAt) || keeper.mergeLeaseExpiresAt <= 0) {
          return {
            ok: false,
            status: 409,
            error: "Keeper player is locked by an orphaned merge job but has missing or invalid mergeLeaseExpiresAt. Ambiguous lock requires operator resolution.",
            code: "MALFORMED_PLAYER_LOCK",
          };
        }

        // Reclaim only when expiry is explicitly a finite number in the past (now >= mergeLeaseExpiresAt)
        if (now < keeper.mergeLeaseExpiresAt) {
          return {
            ok: false,
            status: 409,
            error: "Keeper player is locked by another unexpired merge lease.",
            code: "KEEPER_LOCKED_BY_ANOTHER_JOB",
          };
        }
        // Expired lock with missing job AND complete, consistent lock metadata: can be safely reclaimed by this new job
      }
    }

    // Check existing lease on THIS job
    if (existingJob?.status === "in_progress") {
      // 1. Validate persisted job lease metadata completeness (Finding 1F-R Section 3)
      if (!existingJob.leaseOwner || typeof existingJob.leaseOwner !== "string" || !existingJob.leaseOwner.trim()) {
        return {
          ok: false,
          status: 409,
          error: "Active merge job has missing or invalid leaseOwner. Ambiguous state requires operator resolution.",
          code: "MALFORMED_JOB_LEASE",
        };
      }
      if (!existingJob.leaseToken || typeof existingJob.leaseToken !== "string" || !existingJob.leaseToken.trim()) {
        return {
          ok: false,
          status: 409,
          error: "Active merge job has missing or invalid leaseToken. Ambiguous state requires operator resolution.",
          code: "MALFORMED_JOB_LEASE",
        };
      }
      if (typeof existingJob.fencingToken !== "number" || !Number.isInteger(existingJob.fencingToken) || existingJob.fencingToken <= 0) {
        return {
          ok: false,
          status: 409,
          error: "Active merge job has missing or invalid fencingToken. Ambiguous state requires operator resolution.",
          code: "MALFORMED_JOB_LEASE",
        };
      }
      if (typeof existingJob.leaseExpiresAt !== "number" || !Number.isFinite(existingJob.leaseExpiresAt) || existingJob.leaseExpiresAt <= 0) {
        return {
          ok: false,
          status: 409,
          error: "Active merge job has missing or invalid leaseExpiresAt. Ambiguous state requires operator resolution.",
          code: "MALFORMED_JOB_LEASE",
        };
      }

      // 2. Validate player lock exact agreement with active job
      // Loser checks
      if (loser.mergeJobId !== jobId) {
        return {
          ok: false,
          status: 409,
          error: "Loser player lock jobId disagrees with active merge job.",
          code: "PLAYER_LOCK_MISMATCH",
        };
      }
      if (loser.mergeStatus !== "in_progress") {
        return {
          ok: false,
          status: 409,
          error: "Loser player mergeStatus is not in_progress.",
          code: "PLAYER_LOCK_MISMATCH",
        };
      }
      if (!loser.mergeLeaseOwner || loser.mergeLeaseOwner !== existingJob.leaseOwner) {
        return {
          ok: false,
          status: 409,
          error: "Loser player leaseOwner is missing or disagrees with active merge job.",
          code: "PLAYER_LOCK_MISMATCH",
        };
      }
      if (typeof loser.mergeFencingToken !== "number" || loser.mergeFencingToken !== existingJob.fencingToken) {
        return {
          ok: false,
          status: 409,
          error: "Loser player fencingToken is missing or disagrees with active merge job.",
          code: "PLAYER_LOCK_MISMATCH",
        };
      }
      if (typeof loser.mergeLeaseExpiresAt !== "number" || loser.mergeLeaseExpiresAt !== existingJob.leaseExpiresAt) {
        return {
          ok: false,
          status: 409,
          error: "Loser player leaseExpiresAt is missing or disagrees with active merge job.",
          code: "PLAYER_LOCK_MISMATCH",
        };
      }

      // Keeper checks
      if (keeper.mergeJobId !== jobId) {
        return {
          ok: false,
          status: 409,
          error: "Keeper player lock jobId disagrees with active merge job.",
          code: "PLAYER_LOCK_MISMATCH",
        };
      }
      if (keeper.mergeStatus !== "in_progress") {
        return {
          ok: false,
          status: 409,
          error: "Keeper player mergeStatus is not in_progress.",
          code: "PLAYER_LOCK_MISMATCH",
        };
      }
      if (!keeper.mergeLeaseOwner || keeper.mergeLeaseOwner !== existingJob.leaseOwner) {
        return {
          ok: false,
          status: 409,
          error: "Keeper player leaseOwner is missing or disagrees with active merge job.",
          code: "PLAYER_LOCK_MISMATCH",
        };
      }
      if (typeof keeper.mergeFencingToken !== "number" || keeper.mergeFencingToken !== existingJob.fencingToken) {
        return {
          ok: false,
          status: 409,
          error: "Keeper player fencingToken is missing or disagrees with active merge job.",
          code: "PLAYER_LOCK_MISMATCH",
        };
      }
      if (typeof keeper.mergeLeaseExpiresAt !== "number" || keeper.mergeLeaseExpiresAt !== existingJob.leaseExpiresAt) {
        return {
          ok: false,
          status: 409,
          error: "Keeper player leaseExpiresAt is missing or disagrees with active merge job.",
          code: "PLAYER_LOCK_MISMATCH",
        };
      }

      // Check unexpired vs expired
      const isJobUnexpired = now < existingJob.leaseExpiresAt;
      const isLoserUnexpired = now < loser.mergeLeaseExpiresAt;
      const isKeeperUnexpired = now < keeper.mergeLeaseExpiresAt;

      if (isJobUnexpired) {
        if (!isLoserUnexpired || !isKeeperUnexpired) {
          return {
            ok: false,
            status: 409,
            error: "Job lease is unexpired but player lock lease is expired. Ambiguous state requires operator resolution.",
            code: "PLAYER_LOCK_MISMATCH",
          };
        }
        return {
          ok: false,
          status: 409,
          error: "Merge job is currently locked by another worker lease.",
          code: "ACTIVE_LEASE_EXISTS",
        };
      } else {
        // Job is expired
        if (isLoserUnexpired || isKeeperUnexpired) {
          return {
            ok: false,
            status: 409,
            error: "Job lease is expired but player lock lease is unexpired. Ambiguous state requires operator resolution.",
            code: "PLAYER_LOCK_MISMATCH",
          };
        }
        // Both job and players are expired with identical matching credentials -> safe to reclaim!
      }
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

    // Strict validation of both player locks (Finding 1F-R R2/R3)
    if (!loserSnap?.exists || !keeperSnap?.exists) {
      throw new StaleWorkerError(
        409,
        "Cannot renew lease: required player record not found.",
        "LEASE_RENEWAL_FAILED"
      );
    }

    const loser = loserSnap.data() || {};
    const keeper = keeperSnap.data() || {};

    if (
      loser.mergeJobId !== jobId ||
      loser.mergeStatus !== "in_progress" ||
      loser.mergeFencingToken !== worker.fencingToken ||
      loser.mergeLeaseOwner !== worker.leaseOwner ||
      loser.mergeLeaseExpiresAt !== job.leaseExpiresAt
    ) {
      throw new StaleWorkerError(
        409,
        "Cannot renew lease: loser player lock is missing, inconsistent, or superseded.",
        "LEASE_RENEWAL_FAILED"
      );
    }

    if (
      keeper.mergeJobId !== jobId ||
      keeper.mergeStatus !== "in_progress" ||
      keeper.mergeFencingToken !== worker.fencingToken ||
      keeper.mergeLeaseOwner !== worker.leaseOwner ||
      keeper.mergeLeaseExpiresAt !== job.leaseExpiresAt
    ) {
      throw new StaleWorkerError(
        409,
        "Cannot renew lease: keeper player lock is missing, inconsistent, or superseded.",
        "LEASE_RENEWAL_FAILED"
      );
    }

    // ALL WRITES AFTER READS
    const newExpiresAt = now + additionalDurationMs;
    transaction.update(mergeJobRef, {
      leaseExpiresAt: newExpiresAt,
      lastHeartbeatAt: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(loserSnap.ref, {
      mergeLeaseExpiresAt: newExpiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(keeperSnap.ref, {
      mergeLeaseExpiresAt: newExpiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    });

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
    // 1. Transactional reads of all essential guard records
    const [
      jobSnap,
      loserSnap,
      keeperSnap,
      residualPaymentsSnap,
      residualFeesSnap,
      residualUsersSnap,
      residualUidSnap,
      residualPhoneSnap,
      residualOrdersSnap,
    ] = await Promise.all([
      transaction.get(mergeJobRef),
      transaction.get(loserRef),
      transaction.get(keeperRef),
      transaction.get(db.collectionGroup("payments").where("playerId", "==", loserId).limit(1)),
      transaction.get(loserRef.collection("otherFees").limit(1)),
      transaction.get(db.collection("appUsers").where("playerId", "==", loserId).limit(1)),
      transaction.get(db.collection("uidIndex").where("playerId", "==", loserId).limit(1)),
      transaction.get(db.collection("phoneIndex").where("playerId", "==", loserId).limit(1)),
      transaction.get(db.collection("merchOrders").where("playerId", "==", loserId).limit(1)),
    ]);

    if (!jobSnap.exists) {
      throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
    }
    const job = jobSnap.data() || {};
    const now = Date.now();

    // Verify worker fencing and active lease strictly (fail closed on any missing/malformed/mismatched credential)
    if (
      job.status !== "in_progress" ||
      !job.leaseOwner || typeof job.leaseOwner !== "string" || !job.leaseOwner.trim() ||
      !worker.leaseOwner || typeof worker.leaseOwner !== "string" || !worker.leaseOwner.trim() ||
      job.leaseOwner !== worker.leaseOwner ||
      !job.leaseToken || typeof job.leaseToken !== "string" || !job.leaseToken.trim() ||
      !worker.leaseToken || typeof worker.leaseToken !== "string" || !worker.leaseToken.trim() ||
      job.leaseToken !== worker.leaseToken ||
      typeof job.fencingToken !== "number" || !Number.isInteger(job.fencingToken) || job.fencingToken <= 0 ||
      typeof worker.fencingToken !== "number" || !Number.isInteger(worker.fencingToken) || worker.fencingToken <= 0 ||
      job.fencingToken !== worker.fencingToken ||
      typeof job.leaseExpiresAt !== "number" || !Number.isFinite(job.leaseExpiresAt) ||
      now >= job.leaseExpiresAt
    ) {
      throw new StaleWorkerError(
        409,
        "Stale worker detected: lease has expired, been reclaimed, or superseded.",
        "STALE_WORKER_FENCING_ERROR"
      );
    }

    // Verify player locks are consistent with this job
    if (!loserSnap.exists || !keeperSnap.exists) {
      throw new MergeConflictError(404, "Player records not found during completion.", "PLAYER_NOT_FOUND");
    }
    const loser = loserSnap.data() || {};
    const keeper = keeperSnap.data() || {};

    // Strict 10-field lock validation on loser (fail closed on missing, malformed or mismatched fields)
    if (
      loser.mergeJobId !== jobId ||
      loser.mergeStatus !== "in_progress" ||
      !loser.mergeLeaseOwner || typeof loser.mergeLeaseOwner !== "string" || loser.mergeLeaseOwner !== job.leaseOwner ||
      typeof loser.mergeFencingToken !== "number" || loser.mergeFencingToken !== job.fencingToken ||
      typeof loser.mergeLeaseExpiresAt !== "number" || !Number.isFinite(loser.mergeLeaseExpiresAt) || loser.mergeLeaseExpiresAt !== job.leaseExpiresAt
    ) {
      throw new MergeConflictError(409, "Loser player lock missing, incomplete or tampered with before completion.", "FINAL_VERIFICATION_FAILED");
    }

    // Strict 10-field lock validation on keeper (fail closed on missing, malformed or mismatched fields)
    if (
      keeper.mergeJobId !== jobId ||
      keeper.mergeStatus !== "in_progress" ||
      !keeper.mergeLeaseOwner || typeof keeper.mergeLeaseOwner !== "string" || keeper.mergeLeaseOwner !== job.leaseOwner ||
      typeof keeper.mergeFencingToken !== "number" || keeper.mergeFencingToken !== job.fencingToken ||
      typeof keeper.mergeLeaseExpiresAt !== "number" || !Number.isFinite(keeper.mergeLeaseExpiresAt) || keeper.mergeLeaseExpiresAt !== job.leaseExpiresAt
    ) {
      throw new MergeConflictError(409, "Keeper player lock missing, incomplete or tampered with before completion.", "FINAL_VERIFICATION_FAILED");
    }

    // Verify zero residual documents created during verification window (Finding 1F-R R10)
    if (
      !residualPaymentsSnap.empty ||
      !residualFeesSnap.empty ||
      !residualUsersSnap.empty ||
      !residualUidSnap.empty ||
      !residualPhoneSnap.empty ||
      !residualOrdersSnap.empty
    ) {
      throw new MergeConflictError(
        409,
        "Final verification failed: concurrent records referencing loser were detected during completion window.",
        "FINAL_VERIFICATION_FAILED"
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

/**
 * Validates a rupee-denominated financial field (Finding 1F-R Section 5).
 * - Accept finite, non-negative numbers or valid numeric strings.
 * - Allow no more than two decimal places.
 * - Reject NaN, Infinity, malformed strings, negative values, and unsafe ranges.
 * - Does NOT silently round invalid precision into a valid amount.
 */
export function validateRupeeAmount(
  val: any,
  fieldName = "amount",
  options?: { required?: boolean; maxAmount?: number }
): { ok: boolean; value?: number; error?: string } {
  if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) {
    if (options?.required) {
      return { ok: false, error: `${fieldName} is a required financial amount and cannot be missing or empty.` };
    }
    return { ok: true, value: undefined };
  }

  let num: number;
  if (typeof val === "string") {
    const trimmed = val.trim();
    // Strict format: non-negative, optional single decimal point, at most 2 decimal places
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      if (/^\d+\.\d{3,}$/.test(trimmed)) {
        return { ok: false, error: `${fieldName} has invalid precision: more than 2 decimal places in rupees ('${trimmed}').` };
      }
      return { ok: false, error: `${fieldName} contains invalid non-numeric string: '${val}'.` };
    }
    num = Number(trimmed);
  } else if (typeof val === "number") {
    if (!Number.isFinite(val) || Number.isNaN(val)) {
      return { ok: false, error: `${fieldName} is NaN or non-finite.` };
    }
    if (val < 0) {
      return { ok: false, error: `${fieldName} cannot be negative: ${val}.` };
    }
    // Check precision on numeric value (must not have more than 2 decimal places)
    const roundedPaise = Math.round(val * 100);
    if (Math.abs(val * 100 - roundedPaise) > 1e-6) {
      return { ok: false, error: `${fieldName} has invalid precision: more than 2 decimal places in rupees (${val}).` };
    }
    num = val;
  } else {
    return { ok: false, error: `${fieldName} has invalid type: ${typeof val}.` };
  }

  const max = options?.maxAmount ?? 10_000_000;
  if (num > max) {
    return { ok: false, error: `${fieldName} exceeds maximum allowable boundary: ${num}.` };
  }

  return { ok: true, value: Math.round(num * 100) / 100 };
}

/**
 * Validates a paise-denominated financial field (Finding 1F-R Section 5).
 * - Require finite, non-negative integers.
 * - Reject fractional paise (no decimal point or non-integers).
 * - Reject malformed strings, negative values, and unsafe ranges.
 */
export function validatePaiseAmount(
  val: any,
  fieldName = "paise",
  options?: { required?: boolean; maxPaise?: number }
): { ok: boolean; value?: number; error?: string } {
  if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) {
    if (options?.required) {
      return { ok: false, error: `${fieldName} is a required paise amount and cannot be missing or empty.` };
    }
    return { ok: true, value: undefined };
  }

  let num: number;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!/^\d+$/.test(trimmed)) {
      if (/^\d+\.\d+$/.test(trimmed)) {
        return { ok: false, error: `${fieldName} must be an integer paise amount; received fractional paise: '${trimmed}'.` };
      }
      return { ok: false, error: `${fieldName} contains invalid non-numeric string: '${val}'.` };
    }
    num = Number(trimmed);
  } else if (typeof val === "number") {
    if (!Number.isFinite(val) || Number.isNaN(val)) {
      return { ok: false, error: `${fieldName} is NaN or non-finite.` };
    }
    if (val < 0) {
      return { ok: false, error: `${fieldName} cannot be negative: ${val}.` };
    }
    if (!Number.isInteger(val)) {
      return { ok: false, error: `${fieldName} must be an integer paise amount; received fractional paise: ${val}.` };
    }
    num = val;
  } else {
    return { ok: false, error: `${fieldName} has invalid type: ${typeof val}.` };
  }

  const max = options?.maxPaise ?? 1_000_000_000;
  if (num > max) {
    return { ok: false, error: `${fieldName} exceeds maximum allowable boundary: ${num}.` };
  }

  return { ok: true, value: num };
}

/**
 * Strict numeric parser and validator for financial fields (Finding 1F-R R4).
 * Enforces finite numbers, non-negative bounds, 2-decimal rupee precision,
 * and rejects NaN, Infinity, non-numeric strings, and out-of-boundary values.
 */
export function parseAuthoritativeAmount(
  val: any,
  fieldName = "amount",
  options?: { allowZero?: boolean; allowNegative?: boolean; maxAmount?: number }
): { ok: boolean; value?: number; error?: string } {
  return validateRupeeAmount(val, fieldName, { required: false, maxAmount: options?.maxAmount });
}

/**
 * Resolves authoritative and legacy financial alias values for a record (Finding 1F-R R4).
 * Fails closed (returns ok: false, conflictReason: string) if contradictory alias values
 * are populated on the same document or if required amount is missing.
 */
export function resolveFinancialRecordValues(record: Record<string, any>): {
  ok: boolean;
  conflictReason?: string;
  values?: {
    amount: number;
    title: string;
    status: string;
    templateId: string;
    paymentMethod: string;
    razorpayPaymentId: string;
    paidAmount: number;
    receiptId: string;
    waivedReason: string;
    refundId: string;
    refundAmount: number;
    cancelledBy: string;
    currency: string;
  };
} {
  if (!record || typeof record !== "object") {
    return { ok: false, conflictReason: "Record must be a valid object." };
  }

  // 1. Authoritative base amount (Required: never default missing financial amount to zero per Section 5)
  const parsedAmt = validateRupeeAmount(record.amount, "amount", { required: true });
  if (!parsedAmt.ok) {
    return { ok: false, conflictReason: parsedAmt.error };
  }
  const amount = parsedAmt.value!;

  // 2. Paid Amount Aliases: paidAmount vs feeCollectedAmount (Rupees)
  const parsedPaid = validateRupeeAmount(record.paidAmount, "paidAmount", { required: false });
  if (!parsedPaid.ok) {
    return { ok: false, conflictReason: parsedPaid.error };
  }
  const parsedCollected = validateRupeeAmount(record.feeCollectedAmount, "feeCollectedAmount", { required: false });
  if (!parsedCollected.ok) {
    return { ok: false, conflictReason: parsedCollected.error };
  }

  const hasPaidAmount = parsedPaid.value !== undefined;
  const hasFeeCollected = parsedCollected.value !== undefined;

  if (hasPaidAmount && hasFeeCollected) {
    if (parsedPaid.value !== parsedCollected.value) {
      return {
        ok: false,
        conflictReason: `Contradictory paid amount aliases: paidAmount=${parsedPaid.value} vs feeCollectedAmount=${parsedCollected.value}`,
      };
    }
  }
  const paidAmount = hasPaidAmount ? parsedPaid.value! : (hasFeeCollected ? parsedCollected.value! : 0);

  // 3. Refund Identifier Aliases: refundId vs refundReference
  const refId = record.refundId !== undefined && record.refundId !== null ? String(record.refundId).trim() : "";
  const refRef = record.refundReference !== undefined && record.refundReference !== null ? String(record.refundReference).trim() : "";
  if (refId && refRef && refId !== refRef) {
    return {
      ok: false,
      conflictReason: `Contradictory refund identifier aliases: refundId=${refId} vs refundReference=${refRef}`,
    };
  }
  const refundId = refId || refRef;

  // 4. Refund Amount Aliases: refundAmount (Rupees) vs refundedPaise (Paise)
  const parsedRefAmt = validateRupeeAmount(record.refundAmount, "refundAmount", { required: false });
  if (!parsedRefAmt.ok) {
    return { ok: false, conflictReason: parsedRefAmt.error };
  }
  const parsedRefPaise = validatePaiseAmount(record.refundedPaise, "refundedPaise", { required: false });
  if (!parsedRefPaise.ok) {
    return { ok: false, conflictReason: parsedRefPaise.error };
  }

  const hasRefundAmount = parsedRefAmt.value !== undefined;
  const hasRefundedPaise = parsedRefPaise.value !== undefined;

  if (hasRefundAmount && hasRefundedPaise) {
    const expectedPaise = Math.round(parsedRefAmt.value! * 100);
    const actualPaise = parsedRefPaise.value!;
    if (expectedPaise !== actualPaise) {
      return {
        ok: false,
        conflictReason: `Contradictory refund aliases: refundAmount=${parsedRefAmt.value} (${expectedPaise} paise) vs refundedPaise=${parsedRefPaise.value} paise`,
      };
    }
  }
  const refundAmount = hasRefundAmount
    ? parsedRefAmt.value!
    : (hasRefundedPaise ? Math.round(parsedRefPaise.value!) / 100 : 0);

  // 5. Payment Method Aliases: paymentMethod vs paymentMode vs channel
  const pm = record.paymentMethod !== undefined && record.paymentMethod !== null ? String(record.paymentMethod).trim() : "";
  const pMode = record.paymentMode !== undefined && record.paymentMode !== null ? String(record.paymentMode).trim() : "";
  const ch = record.channel !== undefined && record.channel !== null ? String(record.channel).trim() : "";
  const methods = [pm, pMode, ch].filter(Boolean);
  if (methods.length > 1) {
    const first = methods[0].toLowerCase();
    for (let i = 1; i < methods.length; i++) {
      if (methods[i].toLowerCase() !== first) {
        return { ok: false, conflictReason: `Contradictory payment method aliases: ${methods.join(" vs ")}` };
      }
    }
  }
  const paymentMethod = pm || pMode || ch;

  // 6. Payment Status Aliases: status vs paymentStatus
  const st = record.status !== undefined && record.status !== null ? String(record.status).trim() : "";
  const pSt = record.paymentStatus !== undefined && record.paymentStatus !== null ? String(record.paymentStatus).trim() : "";
  if (st && pSt && st.toLowerCase() !== pSt.toLowerCase()) {
    return { ok: false, conflictReason: `Contradictory payment status aliases: status=${st} vs paymentStatus=${pSt}` };
  }
  const status = st || pSt;

  // 7. Currency
  const rawCurrency = record.currency !== undefined && record.currency !== null ? String(record.currency).trim().toUpperCase() : "INR";
  if (rawCurrency !== "INR") {
    return { ok: false, conflictReason: `Unsupported currency: '${rawCurrency}'. Only INR is supported.` };
  }

  return {
    ok: true,
    values: {
      amount,
      title: record.title !== undefined && record.title !== null ? String(record.title).trim() : "",
      status,
      templateId: record.templateId !== undefined && record.templateId !== null ? String(record.templateId).trim() : "",
      paymentMethod,
      razorpayPaymentId: record.razorpayPaymentId !== undefined && record.razorpayPaymentId !== null ? String(record.razorpayPaymentId).trim() : "",
      paidAmount,
      receiptId: record.receiptId !== undefined && record.receiptId !== null ? String(record.receiptId).trim() : "",
      waivedReason: record.waivedReason !== undefined && record.waivedReason !== null ? String(record.waivedReason).trim() : "",
      refundId,
      refundAmount,
      cancelledBy: record.cancelledBy !== undefined && record.cancelledBy !== null ? String(record.cancelledBy).trim() : "",
      currency: "INR",
    },
  };
}

export function areFeesIdentical(src: Record<string, any>, dest: Record<string, any>): boolean {
  const srcRes = resolveFinancialRecordValues(src);
  const destRes = resolveFinancialRecordValues(dest);

  // If either record contains contradictory internal aliases, fail closed (cannot assume identical)
  if (!srcRes.ok || !destRes.ok || !srcRes.values || !destRes.values) {
    return false;
  }

  const s = srcRes.values;
  const d = destRes.values;

  if (s.amount !== d.amount) return false;
  if (s.title !== d.title) return false;
  if (s.status !== d.status) return false;
  if (s.templateId !== d.templateId) return false;
  if (s.paymentMethod !== d.paymentMethod) return false;
  if (s.razorpayPaymentId !== d.razorpayPaymentId) return false;
  if (s.paidAmount !== d.paidAmount) return false;
  if (s.receiptId !== d.receiptId) return false;
  if (s.waivedReason !== d.waivedReason) return false;
  if (s.refundId !== d.refundId) return false;
  if (s.refundAmount !== d.refundAmount) return false;
  if (s.cancelledBy !== d.cancelledBy) return false;
  if (s.currency !== d.currency) return false;

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

  // Authoritative cumulative progress: read prior state from mergeJob (Finding 1F-R R8)
  const initialJobSnap = await mergeJobRef.get();
  const initialStats = initialJobSnap.data()?.stats || {};
  let cumulativeReparented = Number(initialStats.paymentsReparented || 0);
  let chunkIndex = Number(initialStats.paymentsReparentedChunks || 0);

  let hasMore = true;

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

      // 2. Process payments in chunk
      for (const d of pageSnap.docs) {
        transaction.update(d.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // 3. Atomically update job progress, heartbeat, and extend lease (Finding 1F-R R2, R8)
      const prevReparented = Number(job.stats?.paymentsReparented || 0);
      const prevChunks = Number(job.stats?.paymentsReparentedChunks || 0);
      const newTotal = prevReparented + pageSnap.docs.length;
      const newChunks = prevChunks + 1;
      cumulativeReparented = newTotal;
      chunkIndex = newChunks;

      transaction.update(mergeJobRef, {
        "stats.paymentsReparented": newTotal,
        "stats.paymentsReparentedChunks": newChunks,
        "stats.lastCommittedChunk": `payments_chunk_${newChunks}`,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    if (options?.onAfterChunkCommit) {
      await options.onAfterChunkCommit(chunkIndex - 1, cumulativeReparented);
    }

    if (pageSnap.docs.length < batchLimit) {
      hasMore = false;
    }
  }

  await verifyWorkerFencingAndAdvanceStage(db, jobId, worker, "payments_reparented", {
    paymentsReparented: cumulativeReparented,
    paymentsReparentedChunks: chunkIndex,
  });
  return { count: cumulativeReparented };
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

  // Authoritative cumulative progress: read prior state from mergeJob (Finding 1F-R R8)
  const initialJobSnap = await mergeJobRef.get();
  const initialStats = initialJobSnap.data()?.stats || {};
  let cumulativeMoved = Number(initialStats.feesMoved || 0);
  let cumulativeSkipped = Number(initialStats.feesSkipped || 0);
  let chunkIndex = Number(initialStats.feesMovedChunks || 0);

  let hasMore = true;

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
          // Destination does not exist: validate source financial record before copying (Finding 1F-R R4)
          const srcRes = resolveFinancialRecordValues(srcData);
          if (!srcRes.ok) {
            transaction.update(mergeJobRef, {
              lastError: `Malformed financial record: fee ${srcDoc.id} failed validation: ${srcRes.conflictReason}`,
              "stats.conflicts": FieldValue.increment(1),
              updatedAt: FieldValue.serverTimestamp(),
            });
            throw new MergeConflictError(
              409,
              `Malformed financial record detected in fee ${srcDoc.id}: ${srcRes.conflictReason}. Manual resolution required.`,
              "FINANCIAL_RECORD_MALFORMED"
            );
          }
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

      const prevMoved = Number(job.stats?.feesMoved || 0);
      const prevSkipped = Number(job.stats?.feesSkipped || 0);
      const prevChunks = Number(job.stats?.feesMovedChunks || 0);

      const newMoved = prevMoved + chunkMoved;
      const newSkipped = prevSkipped + chunkSkipped;
      const newChunks = prevChunks + 1;
      cumulativeMoved = newMoved;
      cumulativeSkipped = newSkipped;
      chunkIndex = newChunks;

      transaction.update(mergeJobRef, {
        "stats.feesMoved": newMoved,
        "stats.feesSkipped": newSkipped,
        "stats.feesMovedChunks": newChunks,
        "stats.lastCommittedChunk": `fees_chunk_${newChunks}`,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    if (options?.onAfterChunkCommit) {
      await options.onAfterChunkCommit(chunkIndex - 1, cumulativeMoved + cumulativeSkipped);
    }

    if (pageSnap.docs.length < batchLimit) {
      hasMore = false;
    }
  }

  await verifyWorkerFencingAndAdvanceStage(db, jobId, worker, "fees_moved", {
    feesMoved: cumulativeMoved,
    feesSkipped: cumulativeSkipped,
    feesMovedChunks: chunkIndex,
  });
  return { count: cumulativeMoved + cumulativeSkipped };
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

  // Authoritative cumulative progress: read prior state from mergeJob (Finding 1F-R R8)
  const initialJobSnap = await mergeJobRef.get();
  const initialStats = initialJobSnap.data()?.stats || {};
  let cumulativeOrders = Number(initialStats.ordersReparented || 0);
  let chunkIndex = Number(initialStats.ordersReparentedChunks || 0);

  let hasMore = true;

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
      const prevOrders = Number(job.stats?.ordersReparented || 0);
      const prevChunks = Number(job.stats?.ordersReparentedChunks || 0);
      const newOrders = prevOrders + pageSnap.docs.length;
      const newChunks = prevChunks + 1;
      cumulativeOrders = newOrders;
      chunkIndex = newChunks;

      transaction.update(mergeJobRef, {
        "stats.ordersReparented": newOrders,
        "stats.ordersReparentedChunks": newChunks,
        "stats.lastCommittedChunk": `orders_chunk_${newChunks}`,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    if (options?.onAfterChunkCommit) {
      await options.onAfterChunkCommit(chunkIndex - 1, cumulativeOrders);
    }

    if (pageSnap.docs.length < batchLimit) {
      hasMore = false;
    }
  }

  await verifyWorkerFencingAndAdvanceStage(db, jobId, worker, "orders_reparented", {
    ordersReparented: cumulativeOrders,
    ordersReparentedChunks: chunkIndex,
  });
  return { count: cumulativeOrders };
}

/**
 * Stage 5: Bounded Migration of AppUsers and Identity Indexes (Finding 1F-R R1, R9).
 * All reads and writes are strictly bounded and paginated. Never loads entire matching
 * collections into in-memory arrays.
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

  // Authoritative cumulative progress: read prior state from mergeJob (Finding 1F-R R8)
  const initialJobSnap = await mergeJobRef.get();
  const initialStats = initialJobSnap.data()?.stats || {};
  let cumulativeUsers = Number(initialStats.appUsersReparented || 0);
  let cumulativeUid = Number(initialStats.uidIndexReparented || 0);
  let cumulativePhone = Number(initialStats.phoneIndexReparented || 0);
  let chunkIndex = Number(initialStats.appUsersReparentedChunks || 0);

  // 1. Paginated bounded migration of appUsers matching loserId (Finding 1F-R R9)
  let hasMoreUsers = true;
  while (hasMoreUsers) {
    const pageSnap = await db
      .collection("appUsers")
      .where("playerId", "==", loserId)
      .limit(batchLimit)
      .get();

    if (pageSnap.empty) {
      hasMoreUsers = false;
      break;
    }

    await db.runTransaction(async (transaction) => {
      const jobSnap = await transaction.get(mergeJobRef);
      if (!jobSnap.exists) throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
      const job = jobSnap.data() || {};
      const now = Date.now();
      if (
        job.leaseOwner !== worker.leaseOwner ||
        job.leaseToken !== worker.leaseToken ||
        job.fencingToken !== worker.fencingToken ||
        job.status !== "in_progress" ||
        now >= (job.leaseExpiresAt || 0)
      ) {
        throw new StaleWorkerError(409, "Stale worker detected: lease has expired, been reclaimed, or superseded.", "STALE_WORKER_FENCING_ERROR");
      }

      for (const d of pageSnap.docs) {
        transaction.update(d.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const prevUsers = Number(job.stats?.appUsersReparented || 0);
      const prevChunks = Number(job.stats?.appUsersReparentedChunks || 0);
      const newUsers = prevUsers + pageSnap.docs.length;
      const newChunks = prevChunks + 1;
      cumulativeUsers = newUsers;
      chunkIndex = newChunks;

      transaction.update(mergeJobRef, {
        "stats.appUsersReparented": newUsers,
        "stats.appUsersReparentedChunks": newChunks,
        "stats.lastCommittedChunk": `appusers_chunk_${newChunks}`,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    if (options?.onAfterChunkCommit) {
      await options.onAfterChunkCommit(chunkIndex - 1, cumulativeUsers);
    }

    if (pageSnap.docs.length < batchLimit) {
      hasMoreUsers = false;
    }
  }

  // 2. Direct appUsers document check if doc ID is loserId
  const directUserDoc = await db.collection("appUsers").doc(loserId).get();
  if (directUserDoc.exists && directUserDoc.data()?.playerId === loserId) {
    await db.runTransaction(async (transaction) => {
      const jobSnap = await transaction.get(mergeJobRef);
      if (!jobSnap.exists) throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
      const job = jobSnap.data() || {};
      if (job.fencingToken !== worker.fencingToken || job.status !== "in_progress") {
        throw new StaleWorkerError(409, "Stale worker detected.", "STALE_WORKER_FENCING_ERROR");
      }
      transaction.update(directUserDoc.ref, {
        playerId: keeperId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      cumulativeUsers++;
      transaction.update(mergeJobRef, {
        "stats.appUsersReparented": cumulativeUsers,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  // 3. Paginated bounded migration of uidIndex matching loserId (Finding 1F-R R9)
  let hasMoreUid = true;
  while (hasMoreUid) {
    const pageSnap = await db
      .collection("uidIndex")
      .where("playerId", "==", loserId)
      .limit(batchLimit)
      .get();

    if (pageSnap.empty) {
      hasMoreUid = false;
      break;
    }

    await db.runTransaction(async (transaction) => {
      const jobSnap = await transaction.get(mergeJobRef);
      if (!jobSnap.exists) throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
      const job = jobSnap.data() || {};
      const now = Date.now();
      if (
        job.leaseOwner !== worker.leaseOwner ||
        job.leaseToken !== worker.leaseToken ||
        job.fencingToken !== worker.fencingToken ||
        job.status !== "in_progress" ||
        now >= (job.leaseExpiresAt || 0)
      ) {
        throw new StaleWorkerError(409, "Stale worker detected.", "STALE_WORKER_FENCING_ERROR");
      }

      for (const d of pageSnap.docs) {
        transaction.update(d.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const prevUid = Number(job.stats?.uidIndexReparented || 0);
      const newUid = prevUid + pageSnap.docs.length;
      cumulativeUid = newUid;

      transaction.update(mergeJobRef, {
        "stats.uidIndexReparented": newUid,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    if (pageSnap.docs.length < batchLimit) {
      hasMoreUid = false;
    }
  }

  // 4. Paginated bounded migration of phoneIndex matching loserId (Finding 1F-R R9)
  let hasMorePhone = true;
  while (hasMorePhone) {
    const pageSnap = await db
      .collection("phoneIndex")
      .where("playerId", "==", loserId)
      .limit(batchLimit)
      .get();

    if (pageSnap.empty) {
      hasMorePhone = false;
      break;
    }

    await db.runTransaction(async (transaction) => {
      const jobSnap = await transaction.get(mergeJobRef);
      if (!jobSnap.exists) throw new StaleWorkerError(404, "Merge job not found.", "MERGE_JOB_NOT_FOUND");
      const job = jobSnap.data() || {};
      const now = Date.now();
      if (
        job.leaseOwner !== worker.leaseOwner ||
        job.leaseToken !== worker.leaseToken ||
        job.fencingToken !== worker.fencingToken ||
        job.status !== "in_progress" ||
        now >= (job.leaseExpiresAt || 0)
      ) {
        throw new StaleWorkerError(409, "Stale worker detected.", "STALE_WORKER_FENCING_ERROR");
      }

      for (const d of pageSnap.docs) {
        transaction.update(d.ref, {
          playerId: keeperId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const prevPhone = Number(job.stats?.phoneIndexReparented || 0);
      const newPhone = prevPhone + pageSnap.docs.length;
      cumulativePhone = newPhone;

      transaction.update(mergeJobRef, {
        "stats.phoneIndexReparented": newPhone,
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    if (pageSnap.docs.length < batchLimit) {
      hasMorePhone = false;
    }
  }

  const totalProcessed = cumulativeUsers + cumulativeUid + cumulativePhone;
  await verifyWorkerFencingAndAdvanceStage(db, jobId, worker, "app_users_reparented", {
    appUsersReparented: cumulativeUsers,
    uidIndexReparented: cumulativeUid,
    phoneIndexReparented: cumulativePhone,
    appUsersReparentedChunks: chunkIndex,
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
  worker: MergeWorkerInfo,
  options?: { batchLimit?: number }
): Promise<void> {
  const batchLimit = options?.batchLimit || 50;
  const loserRef = db.collection("players").doc(loserId);
  const keeperRef = db.collection("players").doc(keeperId);

  // 1. Verify no payments still reference loser (bounded query - Finding 1F-R R9)
  const paymentsSnap = await db
    .collectionGroup("payments")
    .where("playerId", "==", loserId)
    .limit(batchLimit)
    .get();
  if (!paymentsSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${paymentsSnap.docs.length} payments still reference loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 2. Verify no merchOrders still reference loser (bounded query - Finding 1F-R R9)
  const ordersSnap = await db
    .collection("merchOrders")
    .where("playerId", "==", loserId)
    .limit(batchLimit)
    .get();
  if (!ordersSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${ordersSnap.docs.length} merchandise orders still reference loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 3. Verify no otherFees remain under loser (bounded query - Finding 1F-R R9)
  const feesSnap = await loserRef.collection("otherFees").limit(batchLimit).get();
  if (!feesSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${feesSnap.docs.length} otherFees records still exist under loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 4. Verify no appUsers still reference loser (bounded query - Finding 1F-R R9)
  const usersSnap = await db
    .collection("appUsers")
    .where("playerId", "==", loserId)
    .limit(batchLimit)
    .get();
  if (!usersSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${usersSnap.docs.length} appUsers still reference loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 5. Verify no uidIndex records still reference loser (bounded query - Finding 1F-R R9)
  const uidSnap = await db
    .collection("uidIndex")
    .where("playerId", "==", loserId)
    .limit(batchLimit)
    .get();
  if (!uidSnap.empty) {
    throw new MergeConflictError(
      409,
      `Final verification failed: ${uidSnap.docs.length} uidIndex records still reference loser player.`,
      "FINAL_VERIFICATION_FAILED"
    );
  }

  // 6. Verify no phoneIndex records still reference loser (bounded query - Finding 1F-R R9)
  const phoneSnap = await db
    .collection("phoneIndex")
    .where("playerId", "==", loserId)
    .limit(batchLimit)
    .get();
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

/**
 * Persists structured failure state in mergeJobs/{jobId} (Finding 1F-R R2/R3).
 * Records failed stage, error code, and error message while preserving committed progress.
 * Strictly verifies worker lease identity, fencing generation, and active in-progress status
 * inside an atomic transaction, preventing stale workers from downgrading completed or superseded jobs.
 */
export async function recordMergeJobFailure(
  db: FirebaseFirestore.Firestore,
  jobId: string,
  worker: MergeWorkerInfo | null,
  error: any,
  currentStage: string
): Promise<{ recorded: boolean; reason?: string }> {
  if (!jobId || typeof jobId !== "string" || !jobId.trim()) {
    return { recorded: false, reason: "INVALID_JOB_ID" };
  }
  const mergeJobRef = db.collection("mergeJobs").doc(jobId);
  try {
    return await db.runTransaction(async (transaction) => {
      const jobSnap = await transaction.get(mergeJobRef);
      if (!jobSnap.exists) {
        return { recorded: false, reason: "JOB_NOT_FOUND" };
      }
      const job = jobSnap.data() || {};
      const now = Date.now();

      // 1. Never overwrite a completed or recovered/failed job
      if (job.status !== "in_progress") {
        return { recorded: false, reason: `JOB_NOT_IN_PROGRESS_${String(job.status || "UNKNOWN").toUpperCase()}` };
      }

      // 2. Strict validation of persisted job lease metadata (Fail closed if missing - Section 4)
      if (!job.leaseOwner || typeof job.leaseOwner !== "string" || !job.leaseOwner.trim()) {
        return { recorded: false, reason: "MISSING_JOB_LEASE_OWNER" };
      }
      if (!job.leaseToken || typeof job.leaseToken !== "string" || !job.leaseToken.trim()) {
        return { recorded: false, reason: "MISSING_JOB_LEASE_TOKEN" };
      }
      if (typeof job.fencingToken !== "number" || !Number.isInteger(job.fencingToken)) {
        return { recorded: false, reason: "MISSING_JOB_FENCING_TOKEN" };
      }

      // 3. Strict worker details validation
      if (!worker) {
        return { recorded: false, reason: "MISSING_WORKER_INFO" };
      }
      if (!worker.leaseOwner || typeof worker.leaseOwner !== "string" || !worker.leaseOwner.trim()) {
        return { recorded: false, reason: "MISSING_WORKER_LEASE_OWNER" };
      }
      if (!worker.leaseToken || typeof worker.leaseToken !== "string" || !worker.leaseToken.trim()) {
        return { recorded: false, reason: "MISSING_WORKER_LEASE_TOKEN" };
      }
      if (typeof worker.fencingToken !== "number" || !Number.isInteger(worker.fencingToken)) {
        return { recorded: false, reason: "MISSING_WORKER_FENCING_TOKEN" };
      }

      // 4. Exact equality of every lease credential with the worker
      if (job.leaseOwner !== worker.leaseOwner) {
        return { recorded: false, reason: "WORKER_LEASE_OWNER_MISMATCH" };
      }
      if (job.leaseToken !== worker.leaseToken) {
        return { recorded: false, reason: "WORKER_LEASE_TOKEN_MISMATCH" };
      }
      if (job.fencingToken !== worker.fencingToken) {
        return { recorded: false, reason: "WORKER_FENCING_TOKEN_MISMATCH" };
      }

      // 5. Expired or invalid lease check (require finite number > now; fail closed otherwise)
      if (
        typeof job.leaseExpiresAt !== "number" ||
        !Number.isFinite(job.leaseExpiresAt) ||
        now >= job.leaseExpiresAt
      ) {
        return { recorded: false, reason: "LEASE_EXPIRED" };
      }

      // 6. Atomically persist structured failure state
      transaction.update(mergeJobRef, {
        status: "failed",
        failedStage: currentStage || job.stage || "unknown",
        errorCode: error?.code || "INTERNAL_ERROR",
        errorMessage: error?.message || String(error),
        failedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { recorded: true };
    });
  } catch (logErr) {
    console.error("Failed to persist merge job failure state:", logErr);
    return { recorded: false, reason: "TRANSACTION_ERROR" };
  }
}
