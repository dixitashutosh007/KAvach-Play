/**
 * Server-side Studio membership revocation helper.
 *
 * Atomically revokes `isStudioMember` on both the `players/{playerId}` record
 * and every linked `appUsers/{uid}` record (matched via `playerId` or
 * `player.authUid`), while preserving all player identity, subscription dates,
 * payment history, and subscription history.
 */
import { FieldValue } from "firebase-admin/firestore";
import { actorNameFor, writeServerAudit } from "./server-audit.ts";

export class StudioMembershipHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface RemoveStudioMembershipResult {
  playerId: string;
  playerName: string;
  updatedAppUserIds: string[];
}

export async function removeStudioMembershipTx(
  db: any,
  actorUid: string,
  playerId: string,
): Promise<RemoveStudioMembershipResult> {
  const trimmedId = typeof playerId === "string" ? playerId.trim() : "";
  if (!trimmedId) {
    throw new StudioMembershipHttpError(400, "Player ID is required.");
  }

  const playerRef = db.collection("players").doc(trimmedId);
  const linkedByPlayerIdQuery = db.collection("appUsers").where("playerId", "==", trimmedId);

  return db.runTransaction(async (tx: any) => {
    const playerSnap = await tx.get(playerRef);
    if (!playerSnap.exists) {
      throw new StudioMembershipHttpError(404, "Player record not found.");
    }

    const playerData = playerSnap.data() || {};
    const playerName =
      typeof playerData.name === "string" && playerData.name.trim()
        ? playerData.name.trim()
        : trimmedId;

    const linkedSnaps = await tx.get(linkedByPlayerIdQuery);
    const appUserRefs = new Map<string, any>();

    if (linkedSnaps && Array.isArray(linkedSnaps.docs)) {
      for (const docSnap of linkedSnaps.docs) {
        if (docSnap.exists) {
          appUserRefs.set(docSnap.id, docSnap.ref);
        }
      }
    }

    const authUid =
      typeof playerData.authUid === "string" && playerData.authUid.trim()
        ? playerData.authUid.trim()
        : null;
    if (authUid && !appUserRefs.has(authUid)) {
      const authUserRef = db.collection("appUsers").doc(authUid);
      const authUserSnap = await tx.get(authUserRef);
      if (authUserSnap.exists) {
        appUserRefs.set(authUid, authUserRef);
      }
    }

    const now = FieldValue.serverTimestamp();
    tx.update(playerRef, {
      isStudioMember: false,
      updatedAt: now,
    });

    const updatedAppUserIds: string[] = [];
    for (const [uid, ref] of appUserRefs.entries()) {
      tx.update(ref, {
        isStudioMember: false,
        updatedAt: now,
      });
      updatedAppUserIds.push(uid);
    }

    const actorName = await actorNameFor(db, actorUid);
    await writeServerAudit(
      db,
      {
        actorId: actorUid,
        actorName,
        action: "updated",
        entity: "player",
        entityId: trimmedId,
        entityLabel: playerName,
        changes: [
          {
            field: "isStudioMember",
            oldValue: String(Boolean(playerData.isStudioMember)),
            newValue: "false",
          },
        ],
        summary: `Removed Studio membership for "${playerName}"`,
      },
      tx,
    );

    return {
      playerId: trimmedId,
      playerName,
      updatedAppUserIds,
    };
  });
}
