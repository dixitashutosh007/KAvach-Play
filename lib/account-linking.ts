/**
 * Server-Side Account Linking Engine (lib/account-linking.ts)
 *
 * Implements Security Remediation 1A:
 * - Eliminates substring-based phone matching in favour of strict canonical E.164 equality.
 * - Enforces collection-wide player uniqueness: rejects ambiguous multi-record phone matches (409).
 * - Enforces 1-to-1 UID <-> Player mapping: prevents UID from claiming multiple players or rebinding players.
 * - Protects against disabled and merged player claiming.
 * - Executes association atomically in a Firestore transaction: syncs players/{id}.authUid and appUsers/{uid}.playerId.
 * - Safe and idempotent for legitimate retries.
 */

import { FieldValue } from "firebase-admin/firestore";
import { normalizeIndianMobile } from "./utils.ts";

export interface LinkAccountParams {
  uid: string;
  verifiedPhoneNumber?: string;
  requestedPlayerId?: string;
}

export interface LinkAccountResult {
  ok: boolean;
  status: number;
  playerId?: string;
  error?: string;
  alreadyLinked?: boolean;
}

/**
 * Validates whether a phone number strictly matches canonical Indian E.164 format (+91XXXXXXXXXX).
 */
export function isCanonicalIndianMobile(phone: string): boolean {
  return /^\+91\d{10}$/.test(phone);
}

/**
 * Authoritatively resolves and atomically links a Firebase authenticated user to an eligible player record.
 */
export async function linkPlayerAccount(
  db: FirebaseFirestore.Firestore,
  params: LinkAccountParams,
): Promise<LinkAccountResult> {
  const { uid, verifiedPhoneNumber, requestedPlayerId } = params;

  if (!uid || typeof uid !== "string") {
    return { ok: false, status: 400, error: "Missing or invalid user identifier." };
  }

  // 1. Enforce verified phone number presence
  if (!verifiedPhoneNumber || typeof verifiedPhoneNumber !== "string" || !verifiedPhoneNumber.trim()) {
    return {
      ok: false,
      status: 400,
      error: "Missing verified phone number claim in authentication token.",
    };
  }

  // 2. Strict canonicalisation & format validation
  const canonicalAuthPhone = normalizeIndianMobile(verifiedPhoneNumber.trim());
  if (!isCanonicalIndianMobile(canonicalAuthPhone)) {
    return {
      ok: false,
      status: 400,
      error: "Verified phone number does not conform to canonical E.164 mobile format (+91XXXXXXXXXX).",
    };
  }

  // 3. Inspect caller account state in /appUsers/{uid}
  const userDoc = await db.collection("appUsers").doc(uid).get();
  const userData = userDoc.exists ? userDoc.data() || {} : {};

  if (userData.status === "Disabled") {
    return { ok: false, status: 403, error: "Account is disabled." };
  }

  // 4. One-to-One UID mapping check: verify caller UID is not already bound to another player
  if (userData.playerId) {
    if (requestedPlayerId && requestedPlayerId !== userData.playerId) {
      return {
        ok: false,
        status: 409,
        error: "User account is already linked to another player profile.",
      };
    }
  }

  const existingLinkedQuery = await db.collection("players").where("authUid", "==", uid).get();
  if (!existingLinkedQuery.empty) {
    const linkedDoc = existingLinkedQuery.docs[0];
    if (requestedPlayerId && requestedPlayerId !== linkedDoc.id) {
      return {
        ok: false,
        status: 409,
        error: "User account is already linked to another player record.",
      };
    }
    if (userData.playerId && userData.playerId !== linkedDoc.id) {
      return {
        ok: false,
        status: 409,
        error: "Inconsistent identity state: appUsers.playerId conflicts with linked player.",
      };
    }
  }

  // 5. Scan players collection for records matching canonicalAuthPhone strictly
  const allPlayersSnap = await db.collection("players").get();
  const eligibleCandidates: Array<{ id: string; data: FirebaseFirestore.DocumentData }> = [];

  for (const doc of allPlayersSnap.docs) {
    const data = doc.data() || {};
    // Skip disabled and merged records
    if (data.disabled === true || data.mergedInto) continue;
    if (!data.mobile) continue;

    const candidateNorm = normalizeIndianMobile(data.mobile);
    // Strict equality check: rejects substring, partial, prefix, or suffix matches
    if (candidateNorm === canonicalAuthPhone) {
      eligibleCandidates.push({ id: doc.id, data });
    }
  }

  // 6. Enforce unique player identity across the collection
  if (eligibleCandidates.length === 0) {
    return {
      ok: false,
      status: 404,
      error: "No eligible player record found matching verified phone number.",
    };
  }

  if (eligibleCandidates.length > 1) {
    return {
      ok: false,
      status: 409,
      error: "Multiple player records found with this phone number. Ambiguous identity requires manual administrator resolution.",
    };
  }

  const candidate = eligibleCandidates[0];

  // 7. Validate candidate eligibility & boundary conditions
  if (candidate.data.disabled === true) {
    return { ok: false, status: 403, error: "Player record is disabled." };
  }

  if (candidate.data.mergedInto) {
    return { ok: false, status: 403, error: "Player record has been merged into another profile." };
  }

  // If client supplied a requested player ID, verify it matches authoritative candidate
  if (requestedPlayerId && requestedPlayerId !== candidate.id) {
    return {
      ok: false,
      status: 403,
      error: "Requested player does not match authoritatively resolved player identity.",
    };
  }

  // Check if player is already linked
  if (candidate.data.authUid) {
    if (candidate.data.authUid === uid) {
      // Idempotent retry: verify appUser record is also aligned
      if (userData.playerId === candidate.id) {
        return { ok: true, status: 200, playerId: candidate.id, alreadyLinked: true };
      }
    } else {
      return {
        ok: false,
        status: 409,
        error: "Player record is already linked to another user account.",
      };
    }
  }

  // 8. Execute atomic transactional link
  try {
    await db.runTransaction(async (transaction) => {
      const playerRef = db.collection("players").doc(candidate.id);
      const userRef = db.collection("appUsers").doc(uid);

      const freshPlayerSnap = await transaction.get(playerRef);
      if (!freshPlayerSnap.exists) {
        throw new Error("Player record not found during transaction.");
      }
      const freshPlayerData = freshPlayerSnap.data() || {};

      if (freshPlayerData.authUid && freshPlayerData.authUid !== uid) {
        throw new Error("Player record was concurrently linked to another user.");
      }
      if (freshPlayerData.disabled === true || freshPlayerData.mergedInto) {
        throw new Error("Player record is not eligible for linking.");
      }

      const freshUserSnap = await transaction.get(userRef);
      const freshUserData = freshUserSnap.exists ? freshUserSnap.data() || {} : {};

      if (freshUserData.status === "Disabled") {
        throw new Error("User account is disabled.");
      }
      if (freshUserData.playerId && freshUserData.playerId !== candidate.id) {
        throw new Error("User account was concurrently linked to another player.");
      }

      // Atomic mutation on both collections
      transaction.update(playerRef, {
        authUid: uid,
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (freshUserSnap.exists) {
        transaction.update(userRef, {
          playerId: candidate.id,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(userRef, {
          name: freshPlayerData.name || "Player",
          role: "player",
          status: "Active",
          playerId: candidate.id,
          mobile: canonicalAuthPhone,
          email: freshPlayerData.email || "",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    return { ok: true, status: 200, playerId: candidate.id, alreadyLinked: false };
  } catch (err: any) {
    console.error(`[linkPlayerAccount] Transaction failed for user ${uid} -> player ${candidate.id}:`, err);
    return {
      ok: false,
      status: 500,
      error: err.message || "Failed to link player account due to transaction error.",
    };
  }
}
