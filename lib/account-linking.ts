/**
 * Server-Side Account Linking Engine (lib/account-linking.ts)
 *
 * Implements Security Remediation 1C:
 * - Authoritative bidirectional reservations via `phoneIndex/{canonicalPhone}` AND `uidIndex/{uid}`.
 * - Enforces strict Indian mobile starting-digit constraint [6-9]\d{9} across all accepted formats.
 * - Exhaustive duplicate historical phone detection covering all accepted legacy representations
 *   (e.g., bare 10 digits, formatted with spaces, formatted with hyphens, trunk prefixes).
 * - Comprehensive four-way idempotency verification (phoneIndex, uidIndex, players, appUsers).
 * - Fails closed on any inconsistent legacy identity mapping or ambiguous candidate records.
 * - Real transaction abort test support.
 */

import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { writeServerAudit } from "./server-audit.ts";

export interface LinkAccountParams {
  uid: string;
  verifiedPhoneNumber?: string;
  requestedPlayerId?: string;
  idempotencyKey?: string;
}

export interface LinkingTxContext {
  uid: string;
  canonicalAuthPhone: string;
  resolvedPlayerId: string;
  auditId?: string;
}

export interface LinkAccountResult {
  ok: boolean;
  status: number;
  playerId?: string;
  error?: string;
  alreadyLinked?: boolean;
}

export class LinkingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "LinkingError";
  }
}

/**
 * Validates whether a phone number strictly matches canonical Indian E.164 format (+91[6-9]\d{9}).
 */
export function isCanonicalIndianMobile(phone: string): boolean {
  if (typeof phone !== "string") return false;
  return /^\+91[6-9]\d{9}$/.test(phone.trim());
}

/**
 * Strict parser for stored and input Indian mobile numbers.
 *
 * Rules:
 * - Rejects non-string, empty, or whitespace-only inputs.
 * - Rejects any alphabetic or invalid punctuation characters (only spaces, hyphens, and leading '+' permitted).
 * - Enforces Indian mobile starting digit constraint [6-9] for exactly 10 digits.
 * - Accepts ONLY explicitly documented Indian mobile formats:
 *   1. Canonical E.164: `+91[6-9]\d{9}`
 *   2. International bare: `91[6-9]\d{9}`
 *   3. Domestic trunk prefix: `0[6-9]\d{9}`
 *   4. Bare 10 digits starting with [6-9]: `[6-9]\d{9}`
 * - Allows standard formatting delimiters (spaces and single hyphens) between prefix/digit groups.
 * - Rejects arbitrary prefixes (e.g., +1, +44, +92).
 * - Rejects excessive digits (e.g., 11+ digits) without silent truncation.
 * - Rejects repeated country codes (e.g., +9191...).
 * - Rejects invalid first digits (0-5) in the 10-digit mobile number.
 * - Returns { ok: true, canonical, raw10 } or { ok: false, error }.
 */
export function parseStrictIndianMobile(input: unknown):
  | { ok: true; canonical: string; raw10: string }
  | { ok: false; error: string } {
  if (typeof input !== "string") {
    return { ok: false, error: "Phone number must be a non-empty string." };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Phone number is empty." };
  }

  // Reject alphabetic characters
  if (/[a-zA-Z]/.test(trimmed)) {
    return { ok: false, error: "Phone number contains invalid alphabetic characters." };
  }

  // Reject invalid punctuation (only digits, spaces, hyphens, and leading '+' allowed)
  if (/[^0-9+\s\-]/.test(trimmed)) {
    return { ok: false, error: "Phone number contains invalid punctuation or special characters." };
  }

  // '+' is only allowed at position 0, and at most once
  const plusIndex = trimmed.indexOf("+");
  if (plusIndex > 0 || (plusIndex === 0 && trimmed.indexOf("+", 1) !== -1)) {
    return { ok: false, error: "Plus sign '+' is only permitted at the beginning of the phone number." };
  }

  // Strip standard spacing and hyphen delimiters
  const compact = trimmed.replace(/[\s\-]/g, "");

  // Must match exactly one of the four supported Indian formats with starting digit 6-9
  let raw10: string | null = null;
  if (/^\+91([6-9]\d{9})$/.test(compact)) {
    raw10 = compact.slice(3);
  } else if (/^91([6-9]\d{9})$/.test(compact)) {
    raw10 = compact.slice(2);
  } else if (/^0([6-9]\d{9})$/.test(compact)) {
    raw10 = compact.slice(1);
  } else if (/^([6-9]\d{9})$/.test(compact)) {
    raw10 = compact;
  }

  if (!raw10) {
    return {
      ok: false,
      error: "Phone number is not a valid 10-digit Indian mobile number starting with 6-9 in a supported format (+91, 91, 0, or bare).",
    };
  }

  return {
    ok: true,
    canonical: `+91${raw10}`,
    raw10,
  };
}

/**
 * Executes the atomic four-document read-and-write transaction for identity linking.
 * Exported for internal and test-harness usage (e.g. verified rollback testing) without
 * exposing test-only flags on the public LinkAccountParams interface.
 */
export async function executeLinkingTransaction(
  db: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
  ctx: LinkingTxContext,
): Promise<{ alreadyLinked: boolean; playerId: string }> {
  const { uid, canonicalAuthPhone, resolvedPlayerId, auditId } = ctx;

  const phoneIndexRef = db.collection("phoneIndex").doc(canonicalAuthPhone);
  const uidIndexRef = db.collection("uidIndex").doc(uid);
  const playerRef = db.collection("players").doc(resolvedPlayerId);
  const userRef = db.collection("appUsers").doc(uid);

  // ALL FOUR READS FIRST
  const phoneIndexSnap = await transaction.get(phoneIndexRef);
  const uidIndexSnap = await transaction.get(uidIndexRef);
  const playerSnap = await transaction.get(playerRef);
  const userSnap = await transaction.get(userRef);

  // A. Verify player document existence & eligibility
  if (!playerSnap.exists) {
    throw new LinkingError(404, "Player record not found.");
  }
  const playerData = playerSnap.data() || {};

  if (playerData.disabled === true) {
    throw new LinkingError(403, "Player record is disabled.");
  }
  if (playerData.mergedInto) {
    throw new LinkingError(403, "Player record has been merged into another profile.");
  }
  // Active merge coordination & stale worker protection (SEC-1F-A)
  if (playerData.mergeStatus === "in_progress" || playerData.mergeJobId) {
    if (playerData.mergeJobId) {
      const jobSnap = await transaction.get(db.collection("mergeJobs").doc(playerData.mergeJobId));
      if (jobSnap.exists) {
        const jobData = jobSnap.data() || {};
        if (jobData.status === "in_progress") {
          if (Date.now() < (jobData.leaseExpiresAt || 0)) {
            throw new LinkingError(409, "Player record is currently undergoing an active administrative merge.");
          } else {
            // Lease is expired, but merge was not completed: partial / stale worker state
            throw new LinkingError(409, "Player record is locked by an interrupted or expired merge job.");
          }
        }
        if (jobData.status !== "completed") {
          throw new LinkingError(409, "Player record is in an incomplete or unfinalized merge state.");
        }
      } else {
        throw new LinkingError(409, "Player record is currently undergoing an administrative merge. Please retry later.");
      }
    } else {
      throw new LinkingError(409, "Player record is currently undergoing an administrative merge. Please retry later.");
    }
  }

  // Strictly parse stored mobile on player document
  const storedMobileParsed = parseStrictIndianMobile(playerData.mobile);
  if (!storedMobileParsed.ok || storedMobileParsed.canonical !== canonicalAuthPhone) {
    throw new LinkingError(403, "Player phone number does not match verified token phone number.");
  }

  // B. Verify user document state
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  if (userData.status === "Disabled") {
    throw new LinkingError(403, "Account is disabled.");
  }

  // C. Cross-record ownership and collision validation
  const phoneIndexData = phoneIndexSnap.exists ? phoneIndexSnap.data() || {} : null;
  const uidIndexData = uidIndexSnap.exists ? uidIndexSnap.data() || {} : null;

  // Check phone reservation collision
  if (phoneIndexData) {
    if (phoneIndexData.authUid && phoneIndexData.authUid !== uid) {
      throw new LinkingError(409, "Phone number is already associated with another user account.");
    }
    if (phoneIndexData.playerId && phoneIndexData.playerId !== resolvedPlayerId) {
      throw new LinkingError(409, "Phone number is already associated with another player profile.");
    }
    if (phoneIndexData.canonicalPhone && phoneIndexData.canonicalPhone !== canonicalAuthPhone) {
      throw new LinkingError(409, "Phone reservation canonical phone does not match requested phone.");
    }
  }

  // Check UID reservation collision
  if (uidIndexData) {
    if (uidIndexData.playerId && uidIndexData.playerId !== resolvedPlayerId) {
      throw new LinkingError(409, "User account is already linked to another player profile.");
    }
    if (uidIndexData.canonicalPhone && uidIndexData.canonicalPhone !== canonicalAuthPhone) {
      throw new LinkingError(409, "User account is already linked to another phone number.");
    }
    if (uidIndexData.authUid && uidIndexData.authUid !== uid) {
      throw new LinkingError(409, "UID reservation does not match requested user account.");
    }
  }

  // Check user account document collision
  if (userData.playerId && userData.playerId !== resolvedPlayerId) {
    throw new LinkingError(409, "User account is already linked to another player profile.");
  }

  // Check player record document collision
  if (playerData.authUid && playerData.authUid !== uid) {
    throw new LinkingError(409, "Player record is already linked to another user account.");
  }

  // D. Full Four-Way Idempotency vs Inconsistent Legacy State Check (SEC-1B-02, SEC-1A-05, SEC-1F-06)
  const isPhoneIndexLinked =
    phoneIndexSnap.exists &&
    phoneIndexData?.authUid === uid &&
    phoneIndexData?.playerId === resolvedPlayerId &&
    (phoneIndexData?.canonicalPhone === canonicalAuthPhone ||
      (!phoneIndexData?.canonicalPhone && phoneIndexData?.phone === canonicalAuthPhone));

  const isUidIndexLinked =
    uidIndexSnap.exists &&
    uidIndexData?.authUid === uid &&
    uidIndexData?.playerId === resolvedPlayerId &&
    uidIndexData?.canonicalPhone === canonicalAuthPhone;

  const isPlayerLinked =
    playerData.authUid === uid &&
    !playerData.disabled &&
    !playerData.mergedInto;

  const isUserLinked =
    userData.playerId === resolvedPlayerId &&
    userData.status !== "Disabled";

  if (isPhoneIndexLinked && isUidIndexLinked && isPlayerLinked && isUserLinked) {
    // Complete, verified 4-way consistency: idempotent success
    return { alreadyLinked: true, playerId: resolvedPlayerId };
  }

  // If any of the four records has a partial or uncoordinated mapping, fail closed
  if (
    isPhoneIndexLinked ||
    isUidIndexLinked ||
    isPlayerLinked ||
    isUserLinked ||
    phoneIndexSnap.exists ||
    uidIndexSnap.exists ||
    playerData.authUid ||
    userData.playerId
  ) {
    throw new LinkingError(
      409,
      "Inconsistent identity mapping detected. Manual administrator resolution required.",
    );
  }

  // E. ALL FOUR WRITES AFTER READS (Atomic Persistence)
  // 1. Maintain phone reservation index (SEC-1F-06: canonicalPhone authoritative field)
  transaction.set(
    phoneIndexRef,
    {
      playerId: resolvedPlayerId,
      authUid: uid,
      canonicalPhone: canonicalAuthPhone,
      phone: canonicalAuthPhone,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: phoneIndexSnap.exists
        ? phoneIndexData?.createdAt || FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // 2. Maintain UID reservation index
  transaction.set(
    uidIndexRef,
    {
      playerId: resolvedPlayerId,
      authUid: uid,
      canonicalPhone: canonicalAuthPhone,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: uidIndexSnap.exists
        ? uidIndexData?.createdAt || FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // 3. Update player record
  transaction.update(playerRef, {
    authUid: uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // 4. Update or create appUser record
  if (userSnap.exists) {
    transaction.update(userRef, {
      playerId: resolvedPlayerId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    transaction.set(userRef, {
      name: playerData.name || "Player",
      role: "player",
      status: "Active",
      playerId: resolvedPlayerId,
      mobile: canonicalAuthPhone,
      email: playerData.email || "",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  if (typeof (transaction as any)?.set === "function") {
    await writeServerAudit(
      db,
      {
        actorId: uid,
        actorName: String(playerData.name || "Player"),
        actorType: "player",
        action: "updated",
        entity: "player",
        entityId: resolvedPlayerId,
        entityLabel: String(playerData.name || resolvedPlayerId),
        changes: [{ field: "authUid", oldValue: String(playerData.authUid || ""), newValue: uid }],
        summary: `Linked account ${uid} to player ${resolvedPlayerId}`,
        id: auditId || `link_${uid}_${resolvedPlayerId}_${crypto.randomUUID().slice(0, 12)}`,
      },
      transaction as any,
    );
  }

  return { alreadyLinked: false, playerId: resolvedPlayerId };
}

/**
 * Concurrency-safe, transactional player account linking with bidirectional reservations.
 */
export async function linkPlayerAccount(
  db: FirebaseFirestore.Firestore,
  params: LinkAccountParams,
): Promise<LinkAccountResult> {
  try {
    const { uid, verifiedPhoneNumber, requestedPlayerId } = params;

  // 1. Parameter Validation
  if (!uid || typeof uid !== "string" || !uid.trim()) {
    return { ok: false, status: 400, error: "Missing or invalid user identifier." };
  }

  if (!verifiedPhoneNumber || typeof verifiedPhoneNumber !== "string" || !verifiedPhoneNumber.trim()) {
    return {
      ok: false,
      status: 400,
      error: "Missing verified phone number claim in authentication token.",
    };
  }

  // Validate verified phone against canonical E.164 with starting digit constraint [6-9]
  const authPhoneParsed = parseStrictIndianMobile(verifiedPhoneNumber);
  if (!authPhoneParsed.ok || !isCanonicalIndianMobile(authPhoneParsed.canonical)) {
    return {
      ok: false,
      status: 400,
      error: "Verified phone number does not conform to canonical E.164 mobile format (+91[6-9]XXXXXXXXX).",
    };
  }
  const canonicalAuthPhone = authPhoneParsed.canonical;

  if (requestedPlayerId !== undefined) {
    if (typeof requestedPlayerId !== "string" || !requestedPlayerId.trim()) {
      return { ok: false, status: 400, error: "Invalid requestedPlayerId." };
    }
    if (requestedPlayerId.length > 100 || !/^[a-zA-Z0-9_\-]+$/.test(requestedPlayerId.trim())) {
      return { ok: false, status: 400, error: "requestedPlayerId contains invalid characters or exceeds 100 chars." };
    }
  }

  // 2. Candidate Resolution & Duplicate Phone Detection across ALL players (SEC-1C-02)
  // Even if a phoneIndex exists, we must inspect the historical players population to guarantee
  // that no legacy or unindexed duplicates exist that would make resolution ambiguous.
  const allPlayersSnap = await db.collection("players").get();
  const eligibleCandidates: Array<{ id: string; data: FirebaseFirestore.DocumentData }> = [];

  for (const doc of allPlayersSnap.docs) {
    const data = doc.data() || {};
    if (data.disabled === true || data.mergedInto) continue;
    if (!data.mobile) continue;

    const parsedStored = parseStrictIndianMobile(data.mobile);
    if (parsedStored.ok && parsedStored.canonical === canonicalAuthPhone) {
      eligibleCandidates.push({ id: doc.id, data });
    }
  }

  // Duplicate / ambiguous check across historical players (Test 4, Test 5, Test 6)
  if (eligibleCandidates.length > 1) {
    return {
      ok: false,
      status: 409,
      error: "Multiple player records found with this phone number. Ambiguous identity requires manual administrator resolution.",
    };
  }

  if (eligibleCandidates.length === 0) {
    return {
      ok: false,
      status: 404,
      error: "No eligible player record found matching verified phone number.",
    };
  }

  const resolvedCandidate = eligibleCandidates[0];
  const resolvedPlayerId = resolvedCandidate.id;
  if (requestedPlayerId && requestedPlayerId.trim() !== resolvedPlayerId) {
    return {
      ok: false,
      status: 403,
      error: "Requested player does not match authoritatively resolved player identity.",
    };
  }

  // 3. Inspect existing phoneIndex reservation if present (SEC-1C-02)
  const existingPhoneIndexDoc = await db.collection("phoneIndex").doc(canonicalAuthPhone).get();
  if (existingPhoneIndexDoc.exists) {
    const phoneIndexData = existingPhoneIndexDoc.data() || {};
    if (phoneIndexData.playerId && phoneIndexData.playerId !== resolvedPlayerId) {
      return {
        ok: false,
        status: 409,
        error: "Phone number is already associated with another player profile.",
      };
    }
    if (phoneIndexData.authUid && phoneIndexData.authUid !== uid) {
      return {
        ok: false,
        status: 409,
        error: "Phone number is already associated with another user account.",
      };
    }
  }

  // 4. Inspect existing uidIndex reservation if present (SEC-1C-02, Test 7, Test 8)
  const existingUidIndexDoc = await db.collection("uidIndex").doc(uid).get();
  if (existingUidIndexDoc.exists) {
    const uidIndexData = existingUidIndexDoc.data() || {};
    const uidPlayerId = uidIndexData.playerId;
    if (!uidPlayerId) {
      return {
        ok: false,
        status: 409,
        error: "Corrupt user reservation index detected. Manual administrator resolution required.",
      };
    }
    // Test 7: Orphaned player reference in uidIndex
    if (!allPlayersSnap.docs.some((d) => d.id === uidPlayerId)) {
      return {
        ok: false,
        status: 409,
        error: "Existing user reservation references non-existent player record.",
      };
    }
    // Test 8: phoneIndex and uidIndex disagreement
    if (existingPhoneIndexDoc.exists) {
      const phonePlayerId = existingPhoneIndexDoc.data()?.playerId;
      if (phonePlayerId && phonePlayerId !== uidPlayerId) {
        return {
          ok: false,
          status: 409,
          error: "Inconsistent identity mapping detected. Manual administrator resolution required.",
        };
      }
    }
    if (uidPlayerId !== resolvedPlayerId) {
      return {
        ok: false,
        status: 409,
        error: "User account is already linked to another player profile.",
      };
    }
    if (uidIndexData.canonicalPhone && uidIndexData.canonicalPhone !== canonicalAuthPhone) {
      return {
        ok: false,
        status: 409,
        error: "User account is already linked to another phone number.",
      };
    }
  }

  // 5. SEC-1C-01: Detect existing player.authUid mappings across ALL players
  const existingAuthPlayersSnap = await db
    .collection("players")
    .where("authUid", "==", uid)
    .get();

  const activeAuthPlayers = existingAuthPlayersSnap.docs.filter(
    (d) => !d.data()?.disabled && !d.data()?.mergedInto,
  );

  if (activeAuthPlayers.length > 1) {
    return {
      ok: false,
      status: 409,
      error: "Multiple player records found associated with this user account. Manual administrator resolution required.",
    };
  }

  if (activeAuthPlayers.length === 1 && activeAuthPlayers[0].id !== resolvedPlayerId) {
    return {
      ok: false,
      status: 409,
      error: "User account is already linked to another player record.",
    };
  }

  // 6. Concurrency-Safe Four-Record Atomic Transaction
  const safeOpKey =
    params.idempotencyKey && /^[a-zA-Z0-9_-]{1,48}$/.test(params.idempotencyKey)
      ? params.idempotencyKey
      : crypto.randomUUID().slice(0, 12);
  const auditId = `link_${uid}_${resolvedPlayerId}_${safeOpKey}`;
  try {
    const txResult = await db.runTransaction(
      async (transaction) => {
        return executeLinkingTransaction(db, transaction, {
          uid,
          canonicalAuthPhone,
          resolvedPlayerId,
          auditId,
        });
      },
      { maxAttempts: 15 },
    );

    return {
      ok: true,
      status: 200,
      playerId: txResult.playerId,
      alreadyLinked: txResult.alreadyLinked,
    };
  } catch (err: any) {
    if (err instanceof LinkingError) {
      return { ok: false, status: err.status, error: err.message };
    }
    console.error(`[linkPlayerAccount] Transaction failed for user ${uid} -> player ${resolvedPlayerId}:`, err);
    const errMessage = String(err?.message || "");
    const errDetails = String(err?.details || "");
    const isTransactionClosed =
      errMessage.includes("Transaction is invalid or closed") ||
      errDetails.includes("Transaction is invalid or closed");
    const isAborted =
      err?.code === 10 ||
      err?.code === "aborted" ||
      errMessage.toLowerCase().includes("aborted");
    const isContentionPrecondition =
      (err?.code === 9 || err?.code === "failed-precondition") &&
      (errMessage.toLowerCase().includes("contention") ||
        errMessage.toLowerCase().includes("concurrent"));

    const isContention = isTransactionClosed || isAborted || isContentionPrecondition;
    if (isContention) {
      // If the transaction aborted due to contention, check if the concurrent request already committed
      // the complete four-way link for this exact user and player (idempotent concurrency success)
      try {
        const [phoneSnap, uidSnap, playerSnap, userSnap] = await Promise.all([
          db.collection("phoneIndex").doc(canonicalAuthPhone).get(),
          db.collection("uidIndex").doc(uid).get(),
          db.collection("players").doc(resolvedPlayerId).get(),
          db.collection("appUsers").doc(uid).get(),
        ]);

        if (phoneSnap.exists && uidSnap.exists && playerSnap.exists && userSnap.exists) {
          const pData = playerSnap.data() || {};
          const uData = userSnap.data() || {};
          const piData = phoneSnap.data() || {};
          const uiData = uidSnap.data() || {};

          const isPiValid =
            piData.authUid === uid &&
            piData.playerId === resolvedPlayerId &&
            (piData.canonicalPhone === canonicalAuthPhone ||
              (!piData.canonicalPhone && piData.phone === canonicalAuthPhone));

          const isUiValid =
            uiData.authUid === uid &&
            uiData.playerId === resolvedPlayerId &&
            uiData.canonicalPhone === canonicalAuthPhone;

          const isPlayerValid =
            pData.authUid === uid &&
            !pData.disabled &&
            !pData.mergedInto;

          const isUserValid =
            uData.playerId === resolvedPlayerId &&
            uData.status !== "Disabled";

          if (isPiValid && isUiValid && isPlayerValid && isUserValid) {
            return { ok: true, status: 200, playerId: resolvedPlayerId, alreadyLinked: true };
          } else {
            console.warn(
              `[linkPlayerAccount] Contention idempotency verification rejected: Inconsistent four-way state found.`,
              {
                pi: { authUid: piData.authUid, playerId: piData.playerId, phone: piData.canonicalPhone },
                ui: { authUid: uiData.authUid, playerId: uiData.playerId, phone: uiData.canonicalPhone },
                player: { authUid: pData.authUid },
                user: { playerId: uData.playerId },
              },
            );
          }
        }
      } catch (checkErr) {
        console.error(`[linkPlayerAccount] Contention verification check failed:`, checkErr);
      }

      return {
        ok: false,
        status: 409,
        error: "Concurrent update conflict detected. Please retry.",
      };
    }
    return {
      ok: false,
      status: 500,
      error: "Failed to link player account due to internal transaction error.",
    };
  }
} catch (topErr: any) {
  if (topErr instanceof LinkingError) {
    return { ok: false, status: topErr.status, error: topErr.message };
  }
  console.error(`[linkPlayerAccount] Top-level failure:`, topErr);
  return {
    ok: false,
    status: 500,
    error: "Failed to link player account due to internal server error.",
  };
}
}

export interface UnlinkIdentityResult {
  hadIdentityLinks: boolean;
  unlinkedAppUsers: string[];
  deletedUidIndexes: string[];
  deletedPhoneIndexes: string[];
}

/**
 * Validates and optionally unlinks all identity/account-linking records
 * (`appUsers`, `uidIndex`, `phoneIndex`) for a player inside a Firestore transaction.
 *
 * P2-DEL-01:
 * - Never leaves stale `phoneIndex` or `uidIndex` reservations pointing to a deleted player.
 * - Fails closed (409) if any index or `appUsers` record belongs to a different player.
 * - Preserves `appUsers` login records by clearing `playerId: null` rather than blindly deleting accounts.
 * - Refuses removal unless `allowUnlink` is explicitly true.
 */
export async function inspectAndUnlinkPlayerIdentityInTx(
  db: FirebaseFirestore.Firestore,
  tx: FirebaseFirestore.Transaction,
  opts: {
    playerId: string;
    playerData: Record<string, unknown>;
    allowUnlink: boolean;
    actorUid: string;
    actorName: string;
    auditId: string;
  },
): Promise<UnlinkIdentityResult> {
  const { playerId, playerData, allowUnlink, actorUid, actorName, auditId } = opts;
  const authUid = typeof playerData.authUid === "string" && playerData.authUid ? playerData.authUid : null;
  const parsedPhone = parseStrictIndianMobile(playerData.mobile);
  const canonicalPhone = parsedPhone.ok ? parsedPhone.canonical : null;

  const [usersByPlayerSnap, uidIdxByPlayerSnap, phoneIdxByPlayerSnap, authUserSnap, authUidIdxSnap, phoneIdxSnap] =
    await Promise.all([
      tx.get(db.collection("appUsers").where("playerId", "==", playerId)),
      tx.get(db.collection("uidIndex").where("playerId", "==", playerId)),
      tx.get(db.collection("phoneIndex").where("playerId", "==", playerId)),
      authUid ? tx.get(db.collection("appUsers").doc(authUid)) : Promise.resolve(null),
      authUid ? tx.get(db.collection("uidIndex").doc(authUid)) : Promise.resolve(null),
      canonicalPhone ? tx.get(db.collection("phoneIndex").doc(canonicalPhone)) : Promise.resolve(null),
    ]);

  if (authUidIdxSnap?.exists) {
    const d = authUidIdxSnap.data() || {};
    if (d.playerId && d.playerId !== playerId) {
      throw new LinkingError(409, "Identity conflict: uidIndex belongs to a different player.");
    }
  }
  if (phoneIdxSnap?.exists) {
    const d = phoneIdxSnap.data() || {};
    if (d.playerId && d.playerId !== playerId) {
      throw new LinkingError(409, "Identity conflict: phoneIndex belongs to a different player.");
    }
  }
  if (authUserSnap?.exists) {
    const d = authUserSnap.data() || {};
    if (d.playerId && d.playerId !== playerId) {
      throw new LinkingError(409, "Identity conflict: appUsers account is linked to a different player.");
    }
  }

  const appUserRefs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const d of usersByPlayerSnap.docs) appUserRefs.set(d.id, d.ref);
  if (authUserSnap?.exists && authUserSnap.data()?.playerId === playerId) {
    appUserRefs.set(authUserSnap.id, authUserSnap.ref);
  }

  const uidIndexRefs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const d of uidIdxByPlayerSnap.docs) uidIndexRefs.set(d.id, d.ref);
  if (authUidIdxSnap?.exists && authUidIdxSnap.data()?.playerId === playerId) {
    uidIndexRefs.set(authUidIdxSnap.id, authUidIdxSnap.ref);
  }

  const phoneIndexRefs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const d of phoneIdxByPlayerSnap.docs) phoneIndexRefs.set(d.id, d.ref);
  if (phoneIdxSnap?.exists && phoneIdxSnap.data()?.playerId === playerId) {
    phoneIndexRefs.set(phoneIdxSnap.id, phoneIdxSnap.ref);
  }

  const hadIdentityLinks =
    Boolean(authUid) || appUserRefs.size > 0 || uidIndexRefs.size > 0 || phoneIndexRefs.size > 0;

  if (hadIdentityLinks && !allowUnlink) {
    throw new LinkingError(
      409,
      "Player has linked account or identity-index records; disable the player or perform a validated unlink first.",
    );
  }

  if (!hadIdentityLinks) {
    return {
      hadIdentityLinks: false,
      unlinkedAppUsers: [],
      deletedUidIndexes: [],
      deletedPhoneIndexes: [],
    };
  }

  for (const ref of phoneIndexRefs.values()) tx.delete(ref);
  for (const ref of uidIndexRefs.values()) tx.delete(ref);
  for (const ref of appUserRefs.values()) {
    tx.update(ref, {
      playerId: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await writeServerAudit(
    db,
    {
      actorId: actorUid,
      actorName,
      actorType: "admin",
      action: "updated",
      entity: "player",
      entityId: playerId,
      entityLabel: String(playerData.name || playerId),
      changes: [
        { field: "appUsersUnlinked", oldValue: String(appUserRefs.size), newValue: "0" },
        { field: "uidIndexRemoved", oldValue: String(uidIndexRefs.size), newValue: "0" },
        { field: "phoneIndexRemoved", oldValue: String(phoneIndexRefs.size), newValue: "0" },
      ],
      summary: `Validated unlink of identity records before deleting player "${String(playerData.name || playerId)}"`,
      id: auditId,
    },
    tx as any,
  );

  return {
    hadIdentityLinks: true,
    unlinkedAppUsers: [...appUserRefs.keys()],
    deletedUidIndexes: [...uidIndexRefs.keys()],
    deletedPhoneIndexes: [...phoneIndexRefs.keys()],
  };
}
