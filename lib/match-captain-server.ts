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
import { isEligibleCaptainPlayer } from "./match-captain.ts";
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
  squadAction?: "added_to_squad" | "already_in_squad" | "none";
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
  const paymentsQuery = cleanCaptainId
    ? matchRef.collection("payments").where("playerId", "==", cleanCaptainId)
    : null;

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
    let squadAction: "added_to_squad" | "already_in_squad" | "none" = "none";

    if (playerRef && cleanCaptainId && paymentsQuery) {
      const [playerSnap, paySnap] = await Promise.all([
        tx.get(playerRef),
        tx.get(paymentsQuery),
      ]);
      if (!playerSnap.exists) {
        throw new MatchCaptainHttpError(404, "Selected captain player record not found.");
      }
      const pData = playerSnap.data() || {};
      if (!isEligibleCaptainPlayer(pData)) {
        throw new MatchCaptainHttpError(
          400,
          "Selected player is inactive or unavailable and cannot be assigned as captain.",
        );
      }
      captainName = typeof pData.name === "string" && pData.name.trim() ? pData.name.trim() : cleanCaptainId;

      const primaryDocs = (paySnap?.docs || []).filter(
        (d: any) => d.exists && !d.data()?.guestName,
      );

      // Respect explicit unavailability ("No" / Out): never silently override.
      const explicitlyUnavailable = primaryDocs.some(
        (d: any) => d.data()?.availability === "No",
      );
      if (explicitlyUnavailable) {
        throw new MatchCaptainHttpError(
          400,
          `${captainName} is marked unavailable (Not Playing) for this match and cannot be assigned as captain.`,
        );
      }

      const activeSquadDoc = primaryDocs.find(
        (d: any) => d.data()?.status && d.data().status !== "Not Playing",
      );

      const now = FieldValue.serverTimestamp();
      if (activeSquadDoc) {
        // Already in squad: preserve existing payment, sponsorship, fee & availability untouched.
        squadAction = "already_in_squad";
      } else if (primaryDocs.length > 0) {
        // Promote existing seeded "Not Playing" record into squad without altering fee/sponsorship fields.
        const targetDoc = primaryDocs[0];
        const existingAvail = targetDoc.data()?.availability;
        const nextAvail =
          existingAvail === "Confirmed" || existingAvail === "Tentative"
            ? existingAvail
            : "Confirmed";
        tx.update(targetDoc.ref, {
          status: "Unpaid",
          availability: nextAvail,
          updatedAt: now,
        });
        squadAction = "added_to_squad";
      } else {
        // No payment doc exists yet: create canonical squad entry.
        const payId = crypto.randomUUID();
        const newPayRef = matchRef.collection("payments").doc(payId);
        tx.set(newPayRef, {
          id: payId,
          matchId: cleanMatchId,
          playerId: cleanCaptainId,
          status: "Unpaid",
          availability: "Confirmed",
          createdAt: now,
          updatedAt: now,
        });
        squadAction = "added_to_squad";
      }
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
    const squadAuditNote =
      squadAction === "added_to_squad"
        ? " (newly added to squad)"
        : squadAction === "already_in_squad"
          ? " (already in squad)"
          : "";
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
          ...(squadAction !== "none"
            ? [
                {
                  field: "squadInclusion",
                  oldValue: squadAction === "added_to_squad" ? "not_in_squad" : "in_squad",
                  newValue: squadAction,
                },
              ]
            : []),
        ],
        summary: cleanCaptainId
          ? `Assigned ${captainName} as captain for match vs ${opponent}${squadAuditNote}`
          : `Cleared captain assignment for match vs ${opponent}`,
      },
      tx,
    );

    return {
      matchId: cleanMatchId,
      captainId: cleanCaptainId,
      captainName,
      squadAction,
    };
  });
}
