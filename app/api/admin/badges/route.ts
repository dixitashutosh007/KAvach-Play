import crypto from "node:crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import { isSafeId } from "../../../../lib/weekend-ops-server.ts";

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function scopedAuditId(
  rawKey: unknown,
  uid: string,
  op: string,
  targetId: string,
): string | undefined {
  if (typeof rawKey !== "string") return undefined;
  const trimmed = rawKey.trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(trimmed)) return undefined;
  const digest = crypto
    .createHash("sha256")
    .update(`${uid}:badges:${op}:${targetId}:${trimmed}`)
    .digest("hex")
    .slice(0, 32);
  return `bdg_${digest}`;
}

function isAlreadyExistsError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 6 || String(err).includes("ALREADY_EXISTS");
}

function computeChanges(
  oldData: Record<string, unknown>,
  updates: Record<string, unknown>,
  skip = new Set(["id", "createdAt", "updatedAt"]),
): { field: string; oldValue?: string; newValue?: string }[] {
  const changes: { field: string; oldValue?: string; newValue?: string }[] = [];
  for (const [field, newVal] of Object.entries(updates)) {
    if (skip.has(field) || newVal === undefined) continue;
    const oldVal = oldData[field];
    const oldStr = oldVal !== undefined && oldVal !== null ? String(oldVal) : undefined;
    const newStr = newVal !== null ? String(newVal) : undefined;
    if (oldStr !== newStr) {
      changes.push({
        field,
        ...(oldStr !== undefined ? { oldValue: oldStr.slice(0, 120) } : {}),
        ...(newStr !== undefined ? { newValue: newStr.slice(0, 120) } : {}),
      });
    }
  }
  return changes;
}

/**
 * POST /api/admin/badges — Grant a badge or create a badgeType with transactional server audit.
 */
export async function POST(req: Request) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const target = body.target === "badgeType" ? "badgeType" : "badge";
  const db = getServerFirestore();
  const actorName = await actorNameFor(db, auth.uid);

  if (target === "badgeType") {
    const def = (body.badgeTypeDef || {}) as Record<string, unknown>;
    const id = typeof def.id === "string" ? def.id.trim() : "";
    const label = typeof def.label === "string" ? def.label.trim() : "";
    if (!isSafeId(id) || !label) {
      return NextResponse.json({ error: "Valid badgeTypeDef id and label are required." }, { status: 400 });
    }
    const safeAuditId = scopedAuditId(body.idempotencyKey, auth.uid, "create_type", id);

    try {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("badgeTypes").doc(id);
        const snap = await tx.get(ref);
        if (snap.exists) throw new RequestError(409, "Badge type already exists.");
        tx.create(ref, {
          ...def,
          id,
          label,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await writeServerAudit(
          db,
          {
            ...(safeAuditId ? { id: safeAuditId } : {}),
            actorId: auth.uid,
            actorName,
            action: "created",
            entity: "badge_type",
            entityId: id,
            entityLabel: label,
            changes: [
              { field: "label", newValue: label },
              ...(def.tier ? [{ field: "tier", newValue: String(def.tier) }] : []),
            ],
            summary: `Created badge type "${label}"`,
          },
          tx,
        );
      });
      return NextResponse.json({ ok: true, id });
    } catch (err) {
      if (safeAuditId && isAlreadyExistsError(err)) {
        return NextResponse.json({ ok: true, id, deduplicated: true });
      }
      if (err instanceof RequestError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("[admin/badges] POST badgeType failed:", err instanceof Error ? err.message : "unknown");
      return NextResponse.json({ error: "Could not create badge type." }, { status: 500 });
    }
  }

  const badge = (body.badge || {}) as Record<string, unknown>;
  const playerId = typeof badge.playerId === "string" ? badge.playerId.trim() : "";
  const playerName = typeof badge.playerName === "string" ? badge.playerName.trim() : "";
  const badgeType = typeof badge.badgeType === "string" ? badge.badgeType.trim() : "";
  if (!isSafeId(playerId) || !badgeType) {
    return NextResponse.json({ error: "Valid playerId and badgeType are required." }, { status: 400 });
  }

  const badgeId =
    typeof badge.id === "string" && isSafeId(badge.id.trim())
      ? badge.id.trim()
      : crypto.randomUUID();
  const safeAuditId = scopedAuditId(body.idempotencyKey, auth.uid, "create", badgeId);

  try {
    await db.runTransaction(async (tx) => {
      const ref = db.collection("badges").doc(badgeId);
      const snap = await tx.get(ref);
      if (snap.exists) return;

      const payload: Record<string, unknown> = {
        playerId,
        playerName: playerName || playerId,
        badgeType,
        awardedBy: auth.uid,
        awardedByName: actorName,
        awardedAt: FieldValue.serverTimestamp(),
        redeemed: Boolean(badge.redeemed),
      };
      if (typeof badge.matchId === "string" && badge.matchId.trim()) payload.matchId = badge.matchId.trim();
      if (typeof badge.note === "string" && badge.note.trim()) payload.note = badge.note.trim();

      tx.create(ref, payload);

      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          actorId: auth.uid,
          actorName,
          action: "created",
          entity: "badge",
          entityId: badgeId,
          entityLabel: `${badgeType} → ${playerName || playerId}`,
          changes: [
            { field: "playerId", newValue: playerId },
            { field: "playerName", newValue: playerName || playerId },
            { field: "badgeType", newValue: badgeType },
            ...(payload.note ? [{ field: "note", newValue: String(payload.note) }] : []),
          ],
          summary: `Awarded "${badgeType}" badge to ${playerName || playerId}`,
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true, id: badgeId });
  } catch (err) {
    if (safeAuditId && isAlreadyExistsError(err)) {
      return NextResponse.json({ ok: true, id: badgeId, deduplicated: true });
    }
    console.error("[admin/badges] POST failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not award badge." }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/badges — Update a badge or badgeType with transactional server audit.
 */
export async function PATCH(req: Request) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const target = body.target === "badgeType" ? "badgeType" : "badge";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const updates =
    body.updates && typeof body.updates === "object" && !Array.isArray(body.updates)
      ? (body.updates as Record<string, unknown>)
      : {};
  if (!isSafeId(id)) {
    return NextResponse.json({ error: "Valid id is required." }, { status: 400 });
  }

  const db = getServerFirestore();
  const actorName = await actorNameFor(db, auth.uid);
  const collectionName = target === "badgeType" ? "badgeTypes" : "badges";
  const entity = target === "badgeType" ? "badge_type" : "badge";
  const safeAuditId = scopedAuditId(body.idempotencyKey, auth.uid, `update_${target}`, id);

  try {
    await db.runTransaction(async (tx) => {
      const ref = db.collection(collectionName).doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new RequestError(404, `${target === "badgeType" ? "Badge type" : "Badge"} not found.`);
      }
      const oldData = snap.data() || {};
      const changes = computeChanges(oldData, updates);
      if (changes.length === 0) return;

      const cleanUpdates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      for (const [k, v] of Object.entries(updates)) {
        if (k === "id" || k === "createdAt" || v === undefined) continue;
        cleanUpdates[k] = v;
      }

      tx.update(ref, cleanUpdates);
      const label =
        target === "badgeType"
          ? String(updates.label || oldData.label || id)
          : String(oldData.badgeType || id);

      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          actorId: auth.uid,
          actorName,
          action: "updated",
          entity,
          entityId: id,
          entityLabel: label,
          changes,
          summary:
            target === "badgeType"
              ? `Updated badge type "${label}"`
              : `Updated badge "${label}" for ${String(oldData.playerName || oldData.playerId || "player")}`,
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (safeAuditId && isAlreadyExistsError(err)) {
      return NextResponse.json({ ok: true, id, deduplicated: true });
    }
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/badges] PATCH failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not update badge." }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/badges?target=badge|badgeType&id=<id>&idempotencyKey=<key>
 */
export async function DELETE(req: Request) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const target = url.searchParams.get("target") === "badgeType" ? "badgeType" : "badge";
  const id = (url.searchParams.get("id") || "").trim();
  const idempotencyKey = url.searchParams.get("idempotencyKey");
  if (!isSafeId(id)) {
    return NextResponse.json({ error: "Valid id is required." }, { status: 400 });
  }
  if (target === "badge" && id.startsWith("potw_")) {
    return NextResponse.json(
      { error: "POTW badges must be retracted via /api/admin/player-of-weekend." },
      { status: 400 },
    );
  }

  const db = getServerFirestore();
  const actorName = await actorNameFor(db, auth.uid);
  const collectionName = target === "badgeType" ? "badgeTypes" : "badges";
  const entity = target === "badgeType" ? "badge_type" : "badge";
  const safeAuditId = scopedAuditId(idempotencyKey, auth.uid, `delete_${target}`, id);

  try {
    await db.runTransaction(async (tx) => {
      const ref = db.collection(collectionName).doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new RequestError(404, `${target === "badgeType" ? "Badge type" : "Badge"} not found.`);
      }
      const oldData = snap.data() || {};
      tx.delete(ref);

      if (target === "badgeType") {
        const label = String(oldData.label || id);
        await writeServerAudit(
          db,
          {
            ...(safeAuditId ? { id: safeAuditId } : {}),
            actorId: auth.uid,
            actorName,
            action: "deleted",
            entity,
            entityId: id,
            entityLabel: label,
            changes: [{ field: "label", oldValue: label }],
            summary: `Deleted badge type "${label}"`,
          },
          tx,
        );
      } else {
        const badgeType = String(oldData.badgeType || id);
        const playerName = String(oldData.playerName || oldData.playerId || "player");
        await writeServerAudit(
          db,
          {
            ...(safeAuditId ? { id: safeAuditId } : {}),
            actorId: auth.uid,
            actorName,
            action: "deleted",
            entity,
            entityId: id,
            entityLabel: `${badgeType} → ${playerName}`,
            changes: [
              { field: "badgeType", oldValue: badgeType },
              { field: "playerName", oldValue: playerName },
            ],
            summary: `Revoked "${badgeType}" badge from ${playerName}`,
          },
          tx,
        );
      }
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (safeAuditId && isAlreadyExistsError(err)) {
      return NextResponse.json({ ok: true, id, deduplicated: true });
    }
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/badges] DELETE failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not delete badge." }, { status: 500 });
  }
}
