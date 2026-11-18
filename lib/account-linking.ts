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

import { FieldValue } from "firebase-admin/firestore";

export interface LinkAccountParams {
  uid: string;
  verifiedPhoneNumber?: string;
  requestedPlayerId?: string;
  _simulateAbortBeforeCommit?: boolean;
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
 * Concurrency-safe, transactional player account linking with bidirectional reservations.
 */
export async function linkPlayerAccount(
  db: FirebaseFirestore.Firestore,
  params: LinkAccountParams,
): Promise<LinkAccountResult> {
  const { uid, verifiedPhoneNumber, requestedPlayerId, _simulateAbortBeforeCommit } = params;

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

  // 2. Pre-transaction Candidate Resolution & Exhaustive Duplicate Detection
  // Check if phoneIndex already exists for canonicalAuthPhone
  const existingPhoneIndexDoc = await db.collection("phoneIndex").doc(canonicalAuthPhone).get();
  let resolvedPlayerId: string;

  if (existingPhoneIndexDoc.exists) {
    resolvedPlayerId = existingPhoneIndexDoc.data()?.playerId;
    if (!resolvedPlayerId) {
      return {
        ok: false,
        status: 409,
        error: "Corrupt phone reservation index detected. Manual administrator resolution required.",
      };
    }
    if (requestedPlayerId && requestedPlayerId.trim() !== resolvedPlayerId) {
      return {
        ok: false,
        status: 409,
        error: "Phone number is already associated with another player profile.",
      };
    }
  } else {
    // Unindexed phone: exhaustively scan players collection to catch all supported formatted variations
    // (e.g. "9876500001", "+91 98765-00001", "09876500001", etc.)
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

    // Exhaustive Ambiguous duplicate identity check
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

    resolvedPlayerId = eligibleCandidates[0].id;
    if (requestedPlayerId && requestedPlayerId.trim() !== resolvedPlayerId) {
      return {
        ok: false,
        status: 403,
        error: "Requested player does not match authoritatively resolved player identity.",
      };
    }
  }

  // 3. Concurrency-Safe Four-Record Atomic Transaction
  // In accordance with Firestore rules, all 4 document reads occur before any writes.
  try {
    const txResult = await db.runTransaction(async (transaction) => {
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
      }

      // Check UID reservation collision
      if (uidIndexData) {
        if (uidIndexData.playerId && uidIndexData.playerId !== resolvedPlayerId) {
          throw new LinkingError(409, "User account is already linked to another player profile.");
        }
        if (uidIndexData.canonicalPhone && uidIndexData.canonicalPhone !== canonicalAuthPhone) {
          throw new LinkingError(409, "User account is already linked to another phone number.");
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

      // D. Full Four-Way Idempotency vs Inconsistent Legacy State Check (SEC-1B-02, SEC-1A-05)
      const isPhoneIndexLinked = phoneIndexSnap.exists &&
        phoneIndexData?.authUid === uid &&
        phoneIndexData?.playerId === resolvedPlayerId;

      const isUidIndexLinked = uidIndexSnap.exists &&
        uidIndexData?.authUid === uid &&
        uidIndexData?.playerId === resolvedPlayerId;

      const isPlayerLinked = playerData.authUid === uid;
      const isUserLinked = userData.playerId === resolvedPlayerId;

      if (isPhoneIndexLinked && isUidIndexLinked && isPlayerLinked && isUserLinked) {
        // Complete, verified 4-way consistency: idempotent success
        return { alreadyLinked: true, playerId: resolvedPlayerId };
      }

      // If any of the four records has a partial or uncoordinated mapping, fail closed
      if (isPhoneIndexLinked || isUidIndexLinked || isPlayerLinked || isUserLinked ||
          phoneIndexSnap.exists || uidIndexSnap.exists || playerData.authUid || userData.playerId) {
        throw new LinkingError(
          409,
          "Inconsistent identity mapping detected. Manual administrator resolution required.",
        );
      }

      // E. ALL FOUR WRITES AFTER READS (Atomic Persistence)
      // 1. Maintain phone reservation index
      transaction.set(
        phoneIndexRef,
        {
          playerId: resolvedPlayerId,
          authUid: uid,
          phone: canonicalAuthPhone,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: phoneIndexSnap.exists ? (phoneIndexData?.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
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
          createdAt: uidIndexSnap.exists ? (uidIndexData?.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
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

      // Simulated abort hook for testing rollback behavior
      if (_simulateAbortBeforeCommit) {
        throw new LinkingError(500, "Simulated intentional abort after staging all transaction writes.");
      }

      return { alreadyLinked: false, playerId: resolvedPlayerId };
    });

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
    return {
      ok: false,
      status: 500,
      error: "Failed to link player account due to internal transaction error.",
    };
  }
}
