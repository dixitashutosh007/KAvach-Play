/**
 * POST /api/admin/club-stats
 *
 * Saves the club's admin-maintained totals (exact Matches Played / Matches Won)
 * to `appConfig/clubStats` inside a Firestore transaction with a
 * server-authoritative `club_stats` audit log entry and idempotency-key hash check.
 */
import crypto from "crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import { CLUB_STATS_COLLECTION, CLUB_STATS_DOC_ID, validateClubStatsInput } from "../../../../lib/club-stats.ts";

class ConflictError extends Error {}

export async function POST(req: Request) {
  const guard = await requireClubAdmin(req);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload." }, { status: 400 });
  }

  const rawKey =
    typeof (body as Record<string, unknown>)?.idempotencyKey === "string"
      ? String((body as Record<string, unknown>).idempotencyKey).trim()
      : "";
  const bodyForValidation =
    body && typeof body === "object" && !Array.isArray(body) && "idempotencyKey" in body
      ? (() => {
          const { idempotencyKey: _ik, ...rest } = body as Record<string, unknown>;
          return rest;
        })()
      : body;

  const parsed = validateClubStatsInput(bodyForValidation);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const safeAuditId =
    rawKey && /^[a-zA-Z0-9_-]{1,128}$/.test(rawKey)
      ? `club_stats_${crypto.createHash("sha256").update(`${guard.uid}:club_stats:${CLUB_STATS_DOC_ID}:${rawKey}`).digest("hex").slice(0, 32)}`
      : undefined;

  const requestHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ matchesPlayed: parsed.value.matchesPlayed, matchesWon: parsed.value.matchesWon }))
    .digest("hex");

  try {
    const db = getServerFirestore();
    const actorName = await actorNameFor(db, guard.uid);
    const statsRef = db.collection(CLUB_STATS_COLLECTION).doc(CLUB_STATS_DOC_ID);

    let deduplicated = false;
    await db.runTransaction(async (tx) => {
      if (safeAuditId) {
        const auditSnap = await tx.get(db.collection("auditLogs").doc(safeAuditId));
        if (auditSnap.exists) {
          if (auditSnap.data()?.requestHash === requestHash) {
            deduplicated = true;
            return;
          }
          throw new ConflictError("Idempotency key already used with a different payload.");
        }
      }

      const existingSnap = await tx.get(statsRef);
      const prev = existingSnap.exists ? (existingSnap.data() || {}) : {};
      const prevPlayed = prev.matchesPlayed !== undefined ? String(prev.matchesPlayed) : undefined;
      const prevWon = prev.matchesWon !== undefined ? String(prev.matchesWon) : undefined;

      tx.set(statsRef, {
        matchesPlayed: parsed.value.matchesPlayed,
        matchesWon: parsed.value.matchesWon,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: guard.uid,
      });

      const changes: { field: string; oldValue?: string; newValue?: string }[] = [];
      if (prevPlayed !== String(parsed.value.matchesPlayed)) {
        changes.push({
          field: "matchesPlayed",
          ...(prevPlayed !== undefined ? { oldValue: prevPlayed } : {}),
          newValue: String(parsed.value.matchesPlayed),
        });
      }
      if (prevWon !== String(parsed.value.matchesWon)) {
        changes.push({
          field: "matchesWon",
          ...(prevWon !== undefined ? { oldValue: prevWon } : {}),
          newValue: String(parsed.value.matchesWon),
        });
      }

      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          requestHash,
          actorId: guard.uid,
          actorName,
          action: existingSnap.exists ? "updated" : "created",
          entity: "club_stats",
          entityId: CLUB_STATS_DOC_ID,
          entityLabel: "Club Statistics",
          changes,
          summary: `Club statistics updated: ${parsed.value.matchesPlayed} played, ${parsed.value.matchesWon} won`,
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true, ...(deduplicated ? { deduplicated: true } : {}), ...parsed.value });
  } catch (err: any) {
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err?.code === 6 || String(err?.message || "").includes("ALREADY_EXISTS")) {
      return NextResponse.json({ ok: true, deduplicated: true, ...parsed.value });
    }
    console.error("[club-stats] Failed to save club statistics:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Club statistics could not be saved." }, { status: 500 });
  }
}
