import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireRole } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import {
  deterministicPlayerStatId,
  isEligibleForNewStats,
  validatePlayerStatInput,
} from "../../../../lib/kavach-stats-validation.ts";
import { isSafeId, POTW_AWARD_ROLES } from "../../../../lib/weekend-ops-server.ts";

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

  const parsed = validatePlayerStatInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { playerId, year, runs, wickets } = parsed.value;
  const requestedId = typeof body?.statId === "string" && body.statId.trim() ? body.statId.trim() : null;
  if (requestedId && !isSafeId(requestedId)) {
    return NextResponse.json({ error: "Invalid stat record id." }, { status: 400 });
  }
  const hasExpectedUpdatedAt = body?.expectedUpdatedAt !== undefined && body?.expectedUpdatedAt !== null;
  const expectedUpdatedAt = hasExpectedUpdatedAt ? Number(body.expectedUpdatedAt) : null;
  if (hasExpectedUpdatedAt && (!Number.isFinite(expectedUpdatedAt) || (expectedUpdatedAt as number) < 0)) {
    return NextResponse.json({ error: "Invalid expectedUpdatedAt timestamp." }, { status: 400 });
  }

  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, guard.uid);

    const saved = await db.runTransaction(async (tx) => {
      const playerRef = db.collection("players").doc(playerId);
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists) throw new RequestError(404, "Player not found.");
      const playerData = { id: playerSnap.id, ...(playerSnap.data() as any) };
      if (!isEligibleForNewStats(playerData)) {
        throw new RequestError(400, "Disabled or merged players cannot receive statistics.");
      }

      const targetId = requestedId || deterministicPlayerStatId(playerId, year);
      const statRef = db.collection("playerStats").doc(targetId);
      const dupQuery = db
        .collection("playerStats")
        .where("playerId", "==", playerId)
        .where("year", "==", year);

      const [existingSnap, allMatchingSnap] = await Promise.all([
        tx.get(statRef),
        tx.get(dupQuery),
      ]);

      const matchingIds = allMatchingSnap.docs.map((d) => d.id);
      const duplicateIds = matchingIds.filter((id) => id !== targetId);

      if (existingSnap.exists) {
        const old = existingSnap.data() || {};
        if (old.playerId !== playerId || Number(old.year) !== year) {
          throw new RequestError(409, "Stat record belongs to a different player or year.");
        }
        const currentUpdatedAtMs =
          typeof old.updatedAt?.toMillis === "function"
            ? old.updatedAt.toMillis()
            : typeof old.updatedAt === "number" && Number.isFinite(old.updatedAt)
              ? old.updatedAt
              : null;
        if (
          expectedUpdatedAt !== null &&
          (currentUpdatedAtMs === null || currentUpdatedAtMs !== expectedUpdatedAt)
        ) {
          throw new RequestError(
            409,
            "This stat record was modified by another admin. Please refresh and try again.",
          );
        }
        if (Number(old.runs ?? 0) === runs && Number(old.wickets ?? 0) === wickets) {
          return {
            id: targetId,
            playerId,
            year,
            runs,
            wickets,
            action: "unchanged" as const,
            ...(duplicateIds.length > 0
              ? {
                  duplicateWarning: `${duplicateIds.length} other duplicate record(s) exist for ${year}.`,
                  duplicateIds,
                }
              : {}),
          };
        }
        tx.update(statRef, {
          runs,
          wickets,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await writeServerAudit(
          db,
          {
            actorId: guard.uid,
            actorName,
            action: "updated",
            entity: "player_stat",
            entityId: targetId,
            entityLabel: `${playerData.name || playerId} (${year})`,
            changes: [
              { field: "runs", oldValue: String(old.runs ?? 0), newValue: String(runs) },
              { field: "wickets", oldValue: String(old.wickets ?? 0), newValue: String(wickets) },
            ],
            summary: `Updated ${year} KAvach Stats record ${targetId} for ${playerData.name || playerId}: ${runs} runs, ${wickets} wickets`,
          },
          tx,
        );
        return {
          id: targetId,
          playerId,
          year,
          runs,
          wickets,
          action: "updated" as const,
          ...(duplicateIds.length > 0
            ? {
                duplicateWarning: `${duplicateIds.length} other duplicate record(s) exist for ${year}.`,
                duplicateIds,
              }
            : {}),
        };
      }

      if (requestedId && !existingSnap.exists) {
        throw new RequestError(404, "Stat record not found.");
      }

      if (allMatchingSnap.size > 1) {
        throw new RequestError(
          409,
          `Multiple duplicate KAvach Stats records exist for this player and year (${matchingIds.join(", ")}). Please reconcile or delete the duplicate records first.`,
        );
      }

      if (allMatchingSnap.size === 1) {
        const legacyDoc = allMatchingSnap.docs[0];
        const old = legacyDoc.data() || {};
        tx.update(legacyDoc.ref, {
          runs,
          wickets,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await writeServerAudit(
          db,
          {
            actorId: guard.uid,
            actorName,
            action: "updated",
            entity: "player_stat",
            entityId: legacyDoc.id,
            entityLabel: `${playerData.name || playerId} (${year})`,
            changes: [
              { field: "runs", oldValue: String(old.runs ?? 0), newValue: String(runs) },
              { field: "wickets", oldValue: String(old.wickets ?? 0), newValue: String(wickets) },
            ],
            summary: `Updated legacy ${year} KAvach Stats record ${legacyDoc.id} for ${playerData.name || playerId}: ${runs} runs, ${wickets} wickets`,
          },
          tx,
        );
        return { id: legacyDoc.id, playerId, year, runs, wickets, action: "updated" as const };
      }

      tx.create(statRef, {
        playerId,
        year,
        runs,
        wickets,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeServerAudit(
        db,
        {
          actorId: guard.uid,
          actorName,
          action: "created",
          entity: "player_stat",
          entityId: targetId,
          entityLabel: `${playerData.name || playerId} (${year})`,
          changes: [
            { field: "year", newValue: String(year) },
            { field: "runs", newValue: String(runs) },
            { field: "wickets", newValue: String(wickets) },
          ],
          summary: `Added ${year} KAvach Stats for ${playerData.name || playerId}: ${runs} runs, ${wickets} wickets`,
        },
        tx,
      );
      return { id: targetId, playerId, year, runs, wickets, action: "created" as const };
    });

    return NextResponse.json({ ok: true, stat: saved });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[player-stats] save failed");
    return NextResponse.json({ error: "Could not save player statistics." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const guard = await requireRole(req, [...POTW_AWARD_ROLES]);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const statId = searchParams.get("statId") || "";
  if (!isSafeId(statId)) {
    return NextResponse.json({ error: "Invalid stat record id." }, { status: 400 });
  }

  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db, guard.uid);
    await db.runTransaction(async (tx) => {
      const statRef = db.collection("playerStats").doc(statId);
      const snap = await tx.get(statRef);
      if (!snap.exists) throw new RequestError(404, "Stat record not found.");
      const old = snap.data() || {};
      const playerSnap = old.playerId ? await tx.get(db.collection("players").doc(String(old.playerId))) : null;
      const playerName = playerSnap?.exists ? String(playerSnap.data()?.name || old.playerId) : String(old.playerId || "Unknown");

      tx.delete(statRef);
      await writeServerAudit(
        db,
        {
          actorId: guard.uid,
          actorName,
          action: "deleted",
          entity: "player_stat",
          entityId: statId,
          entityLabel: `${playerName} (${old.year ?? "?"})`,
          changes: [
            { field: "year", oldValue: String(old.year ?? "") },
            { field: "runs", oldValue: String(old.runs ?? 0) },
            { field: "wickets", oldValue: String(old.wickets ?? 0) },
          ],
          summary: `Removed ${old.year ?? ""} KAvach Stats record for ${playerName}`,
        },
        tx,
      );
    });
    return NextResponse.json({ ok: true, deletedId: statId });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[player-stats] delete failed");
    return NextResponse.json({ error: "Could not delete player statistics." }, { status: 500 });
  }
}
