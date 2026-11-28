import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireRole } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import {
  computeCorrectedCatchTotals,
  validateCatchInput,
  type CatchType,
} from "../../../../lib/catch-validation.ts";
import { isSafeId, POTW_AWARD_ROLES } from "../../../../lib/weekend-ops-server.ts";

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function GET(req: Request) {
  const guard = await requireRole(req, [...POTW_AWARD_ROLES]);
  if (!guard.ok) return guard.response;

  const db = getServerFirestore();
  try {
    const snap = await db
      .collection("catchLog")
      .orderBy("recordedAt", "desc")
      .limit(100)
      .get();

    const entries = snap.docs.map((d) => {
      const data = d.data() || {};
      const recordedAtMs =
        typeof data.recordedAt?.toMillis === "function"
          ? data.recordedAt.toMillis()
          : typeof data.recordedAt === "number"
            ? data.recordedAt
            : null;
      return {
        id: d.id,
        playerId: String(data.playerId || ""),
        playerName: String(data.playerName || ""),
        type: (data.type === "dropped" ? "dropped" : "stunning") as CatchType,
        count: Number(data.count || 0),
        matchId: typeof data.matchId === "string" ? data.matchId : undefined,
        comment: typeof data.comment === "string" ? data.comment : undefined,
        recordedBy: String(data.recordedBy || ""),
        recordedAtMs,
      };
    });

    return NextResponse.json({ ok: true, entries });
  } catch (err) {
    console.error("[catches] list failed");
    return NextResponse.json({ error: "Could not load catch logs." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const guard = await requireRole(req, [...POTW_AWARD_ROLES]);
  if (!guard.ok) return guard.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = validateCatchInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { playerId, type, count, matchId, comment } = parsed.value;
  let idempotencyKey: string | null = null;
  if (body?.idempotencyKey !== undefined && body?.idempotencyKey !== null) {
    if (typeof body.idempotencyKey !== "string" || !isSafeId(body.idempotencyKey.trim())) {
      return NextResponse.json({ error: "Invalid idempotencyKey." }, { status: 400 });
    }
    idempotencyKey = `catch_${body.idempotencyKey.trim()}`;
  }

  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, guard.uid);

    const created = await db.runTransaction(async (tx) => {
      const entryRef = idempotencyKey
        ? db.collection("catchLog").doc(idempotencyKey)
        : db.collection("catchLog").doc();
      const playerRef = db.collection("players").doc(playerId);

      const [existingSnap, playerSnap] = await Promise.all([
        tx.get(entryRef),
        tx.get(playerRef),
      ]);

      if (existingSnap.exists) {
        return { id: existingSnap.id, deduplicated: true };
      }
      if (!playerSnap.exists) throw new RequestError(404, "Player not found.");
      const player = playerSnap.data() || {};
      if (player.disabled || player.mergedInto) {
        throw new RequestError(400, "Disabled or merged players cannot receive catch entries.");
      }

      const playerName = String(player.name || "Player");
      const nextTotals = computeCorrectedCatchTotals(
        { stunningCatches: player.stunningCatches, droppedCatches: player.droppedCatches },
        null,
        { type, count },
      );

      tx.update(playerRef, {
        stunningCatches: nextTotals.stunningCatches,
        droppedCatches: nextTotals.droppedCatches,
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.create(entryRef, {
        playerId,
        playerName,
        type,
        count,
        ...(matchId ? { matchId } : {}),
        ...(comment ? { comment } : {}),
        recordedBy: actorName,
        recordedByUid: guard.uid,
        recordedAt: FieldValue.serverTimestamp(),
      });

      await writeServerAudit(
        db,
        {
          actorId: guard.uid,
          actorName,
          action: "created",
          entity: "catch",
          entityId: entryRef.id,
          entityLabel: playerName,
          changes: [
            { field: "type", newValue: type },
            { field: "count", newValue: String(count) },
            {
              field: type === "stunning" ? "stunningCatches" : "droppedCatches",
              oldValue: String(type === "stunning" ? player.stunningCatches || 0 : player.droppedCatches || 0),
              newValue: String(type === "stunning" ? nextTotals.stunningCatches : nextTotals.droppedCatches),
            },
          ],
          summary: `Recorded ${count} ${type} catch${count !== 1 ? "es" : ""} for ${playerName}`,
        },
        tx,
      );

      return { id: entryRef.id, deduplicated: false, totals: nextTotals };
    });

    return NextResponse.json({ ok: true, ...created });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if ((err as any)?.code === 6 && idempotencyKey) {
      return NextResponse.json({ ok: true, id: idempotencyKey, deduplicated: true });
    }
    console.error("[catches] create failed");
    return NextResponse.json({ error: "Could not record catch." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const guard = await requireRole(req, [...POTW_AWARD_ROLES]);
  if (!guard.ok) return guard.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const entryId = typeof body?.entryId === "string" ? body.entryId.trim() : "";
  if (!isSafeId(entryId)) {
    return NextResponse.json({ error: "Invalid catch log entry id." }, { status: 400 });
  }

  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, guard.uid);

    const updated = await db.runTransaction(async (tx) => {
      const entryRef = db.collection("catchLog").doc(entryId);
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists) throw new RequestError(404, "Catch log entry not found.");
      const oldEntry = entrySnap.data() || {};

      const parsed = validateCatchInput({
        playerId: oldEntry.playerId,
        type: body?.type ?? oldEntry.type,
        count: body?.count ?? oldEntry.count,
        matchId: body?.matchId !== undefined ? body.matchId : oldEntry.matchId,
        comment: body?.comment !== undefined ? body.comment : oldEntry.comment,
      });
      if (!parsed.ok) throw new RequestError(400, parsed.error);

      const playerRef = db.collection("players").doc(parsed.value.playerId);
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists) throw new RequestError(404, "Player not found.");
      const player = playerSnap.data() || {};
      if (player.disabled || player.mergedInto) {
        throw new RequestError(400, "Disabled or merged players cannot be updated.");
      }

      const oldType = (oldEntry.type === "dropped" ? "dropped" : "stunning") as CatchType;
      const oldCount = Math.max(0, Number(oldEntry.count) || 0);
      const oldComment = typeof oldEntry.comment === "string" ? oldEntry.comment : "";
      const newComment = parsed.value.comment || "";

      if (oldType === parsed.value.type && oldCount === parsed.value.count && oldComment === newComment) {
        return {
          id: entryId,
          unchanged: true,
          totals: {
            stunningCatches: Math.max(0, Number(player.stunningCatches) || 0),
            droppedCatches: Math.max(0, Number(player.droppedCatches) || 0),
          },
        };
      }

      const nextTotals = computeCorrectedCatchTotals(
        { stunningCatches: player.stunningCatches, droppedCatches: player.droppedCatches },
        { type: oldType, count: oldCount },
        { type: parsed.value.type, count: parsed.value.count },
      );

      tx.update(playerRef, {
        stunningCatches: nextTotals.stunningCatches,
        droppedCatches: nextTotals.droppedCatches,
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.update(entryRef, {
        type: parsed.value.type,
        count: parsed.value.count,
        comment: parsed.value.comment ? parsed.value.comment : FieldValue.delete(),
        updatedBy: actorName,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writeServerAudit(
        db,
        {
          actorId: guard.uid,
          actorName,
          action: "updated",
          entity: "catch",
          entityId: entryId,
          entityLabel: String(player.name || oldEntry.playerName || parsed.value.playerId),
          changes: [
            { field: "type", oldValue: oldType, newValue: parsed.value.type },
            { field: "count", oldValue: String(oldCount), newValue: String(parsed.value.count) },
          ],
          summary: `Corrected catch log for ${player.name || oldEntry.playerName}: ${oldCount} ${oldType} → ${parsed.value.count} ${parsed.value.type}`,
        },
        tx,
      );

      return { id: entryId, totals: nextTotals };
    });

    return NextResponse.json({ ok: true, ...updated });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[catches] update failed");
    return NextResponse.json({ error: "Could not correct catch entry." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const guard = await requireRole(req, [...POTW_AWARD_ROLES]);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const entryId = (searchParams.get("entryId") || "").trim();
  if (!isSafeId(entryId)) {
    return NextResponse.json({ error: "Invalid catch log entry id." }, { status: 400 });
  }

  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, guard.uid);

    await db.runTransaction(async (tx) => {
      const entryRef = db.collection("catchLog").doc(entryId);
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists) throw new RequestError(404, "Catch log entry not found.");
      const oldEntry = entrySnap.data() || {};

      const playerId = String(oldEntry.playerId || "");
      const oldType = (oldEntry.type === "dropped" ? "dropped" : "stunning") as CatchType;
      const oldCount = Math.max(0, Number(oldEntry.count) || 0);

      let playerName = String(oldEntry.playerName || playerId);
      if (playerId) {
        const playerRef = db.collection("players").doc(playerId);
        const playerSnap = await tx.get(playerRef);
        if (playerSnap.exists) {
          const player = playerSnap.data() || {};
          playerName = String(player.name || playerName);
          const nextTotals = computeCorrectedCatchTotals(
            { stunningCatches: player.stunningCatches, droppedCatches: player.droppedCatches },
            { type: oldType, count: oldCount },
            null,
          );
          tx.update(playerRef, {
            stunningCatches: nextTotals.stunningCatches,
            droppedCatches: nextTotals.droppedCatches,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      tx.delete(entryRef);

      await writeServerAudit(
        db,
        {
          actorId: guard.uid,
          actorName,
          action: "deleted",
          entity: "catch",
          entityId: entryId,
          entityLabel: playerName,
          changes: [
            { field: "type", oldValue: oldType },
            { field: "count", oldValue: String(oldCount) },
          ],
          summary: `Removed ${oldCount} ${oldType} catch entry for ${playerName}`,
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true, deletedId: entryId });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[catches] delete failed");
    return NextResponse.json({ error: "Could not remove catch entry." }, { status: 500 });
  }
}
