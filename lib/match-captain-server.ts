/**
 * Server-side Match Captain Assignment (`lib/match-captain-server.ts`).
 *
 * Atomically validates and persists `captainId` on `matches/{matchId}`:
 * - Validates match existence (404 if missing).
 * - When assigning a captain, validates `players/{captainId}` exists and is
 *   active (not disabled, merged, or rejected). Does NOT require the captain
 *   to be in the match's selected squad.
 * - When clearing (`null` or `""`), removes `captainId` cleanly without altering
 *   squad membership, availability, or payment records.
 * - Writes an authoritative server audit log entry.
 */
import { FieldValue } from "firebase-admin/firestore";
import { actorNameFor, writeServerAudit } from "./server-audit.ts";

export class MatchCaptainHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AssignMatchCaptainResult {
  matchId: string;
  captainId: string | null;
  captainName: string | null;
}

export async function assignMatchCaptainTx(
  db: any,
  actorUid: string,
  matchId: string,
  captainId: string | null,
): Promise<AssignMatchCaptainResult> {
  const cleanMatchId = typeof matchId === "string" ? matchId.trim() : "";
  if (!cleanMatchId) {
    throw new MatchCaptainHttpError(400, "Match ID is required.");
  }

  const cleanCaptainId =
    typeof captainId === "string" && captainId.trim() ? captainId.trim() : null;

  const matchRef = db.collection("matches").doc(cleanMatchId);
  const playerRef = cleanCaptainId ? db.collection("players").doc(cleanCaptainId) : null;

  return db.runTransaction(async (tx: any) => {
    const matchSnap = await tx.get(matchRef);
    if (!matchSnap.exists) {
      throw new MatchCaptainHttpError(404, "Match not found.");
    }
    const matchData = matchSnap.data() || {};
    const previousCaptainId =
      typeof matchData.captainId === "string" && matchData.captainId.trim()
        ? matchData.captainId.trim()
        : null;

    let captainName: string | null = null;
    if (playerRef && cleanCaptainId) {
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists) {
        throw new MatchCaptainHttpError(404, "Selected captain player record not found.");
      }
      const pData = playerSnap.data() || {};
      if (
        pData.disabled ||
        pData.mergedInto ||
        pData.mergeStatus === "in_progress" ||
        pData.inviteStatus === "Rejected"
      ) {
        throw new MatchCaptainHttpError(
          400,
          "Selected player is inactive or unavailable and cannot be assigned as captain.",
        );
      }
      captainName = typeof pData.name === "string" && pData.name.trim() ? pData.name.trim() : cleanCaptainId;
    }

    const now = FieldValue.serverTimestamp();
    if (cleanCaptainId) {
      tx.update(matchRef, {
        captainId: cleanCaptainId,
        updatedAt: now,
      });
    } else {
      tx.update(matchRef, {
        captainId: FieldValue.delete(),
        updatedAt: now,
      });
    }

    const actorName = await actorNameFor(db, actorUid);
    const opponent = typeof matchData.opponent === "string" && matchData.opponent ? matchData.opponent : "TBD";
    await writeServerAudit(
      db,
      {
        actorId: actorUid,
        actorName,
        action: "updated",
        entity: "match",
        entityId: cleanMatchId,
        entityLabel: `vs ${opponent}`,
        changes: [
          {
            field: "captainId",
            oldValue: previousCaptainId ?? "",
            newValue: cleanCaptainId ?? "",
          },
        ],
        summary: cleanCaptainId
          ? `Assigned ${captainName} as captain for match vs ${opponent}`
          : `Cleared captain assignment for match vs ${opponent}`,
      },
      tx,
    );

    return {
      matchId: cleanMatchId,
      captainId: cleanCaptainId,
      captainName,
    };
  });
}
