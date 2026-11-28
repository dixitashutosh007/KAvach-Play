import crypto from "node:crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import { isSafeId } from "../../../../lib/weekend-ops-server.ts";
import {
  BUILTIN_BADGE_CATALOG,
  isValidBadgeAwardMode,
  isValidBadgeCategory,
  normalizeBadgeTier,
  SYSTEM_AWARDED_BADGES,
  SYSTEM_ONLY_AWARD_MODES,
} from "../../../../lib/badge-awarding.ts";

function deterministicNonStackableBadgeId(playerId: string, badgeType: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${playerId}\0${badgeType}`)
    .digest("hex")
    .slice(0, 32);
  return `ns_${digest}`;
}

function validateSuppliedIdempotencyKey(rawKey: unknown): { ok: true; value?: string } | { ok: false } {
  if (rawKey === undefined) return { ok: true, value: undefined };
  if (typeof rawKey !== "string") return { ok: false };
  const trimmed = rawKey.trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

function deterministicIdempotencyRecordId(uid: string, validKey: string | undefined): string | undefined {
  if (!validKey) return undefined;
  const digest = crypto
    .createHash("sha256")
    .update(`${uid}:badges:create:${validKey}`)
    .digest("hex")
    .slice(0, 32);
  return `bdg_idem_${digest}`;
}

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function validateBadgeTypeMetadata(id: string, data: Record<string, unknown>): void {
  if (data.active !== undefined && typeof data.active !== "boolean") {
    throw new RequestError(400, "Invalid active flag. Must be a boolean.");
  }
  if (data.stackable !== undefined && typeof data.stackable !== "boolean") {
    throw new RequestError(400, "Invalid stackable flag. Must be a boolean.");
  }
  if (data.category !== undefined && !isValidBadgeCategory(data.category)) {
    throw new RequestError(
      400,
      "Invalid category. Must be one of: tenure, milestone, performance, club, special, custom.",
    );
  }
  if (data.awardMode !== undefined && !isValidBadgeAwardMode(data.awardMode)) {
    throw new RequestError(
      400,
      "Invalid awardMode. Must be one of: manual, auto_tenure, auto_stats, system_potw.",
    );
  }

  const builtin = Object.prototype.hasOwnProperty.call(BUILTIN_BADGE_CATALOG, id)
    ? BUILTIN_BADGE_CATALOG[id]
    : undefined;

  if (builtin) {
    if (
      data.active === false ||
      (data.stackable !== undefined && data.stackable !== builtin.stackable) ||
      (data.awardMode !== undefined && data.awardMode !== builtin.awardMode) ||
      (data.category !== undefined && data.category !== builtin.category)
    ) {
      throw new RequestError(
        409,
        "Built-in badge definition conflicts with the authoritative catalogue.",
      );
    }
    return;
  }

  if (data.awardMode !== undefined && SYSTEM_ONLY_AWARD_MODES.has(data.awardMode as never)) {
    throw new RequestError(
      400,
      "Custom badge definitions cannot use system-only awardMode 'system_potw'.",
    );
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

function isTransactionContentionError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    code === 10 ||
    (code === 3 && msg.includes("Transaction is invalid or closed")) ||
    msg.includes("ABORTED") ||
    msg.includes("Transaction is invalid or closed")
  );
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

  const keyCheck = validateSuppliedIdempotencyKey(body.idempotencyKey);
  if (!keyCheck.ok) {
    return NextResponse.json(
      { error: "Invalid idempotencyKey. Must be 1-100 alphanumeric, underscore, or hyphen characters." },
      { status: 400 },
    );
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

    const isBuiltin = Object.prototype.hasOwnProperty.call(BUILTIN_BADGE_CATALOG, id);
    try {
      validateBadgeTypeMetadata(id, def);
    } catch (err) {
      if (err instanceof RequestError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    const builtinMeta = isBuiltin ? BUILTIN_BADGE_CATALOG[id] : undefined;
    const normalizedDef: Record<string, unknown> = {
      ...def,
      id,
      label,
      short: typeof def.short === "string" && def.short.trim() ? def.short.trim() : label.slice(0, 12),
      tier: normalizeBadgeTier(def.tier),
      emoji: typeof def.emoji === "string" && def.emoji.trim() ? def.emoji.trim() : "🏅",
      stackable: builtinMeta ? builtinMeta.stackable : (def.stackable ?? false),
      active: builtinMeta ? true : (def.active ?? true),
      category: builtinMeta ? builtinMeta.category : (def.category ?? "custom"),
      awardMode: builtinMeta ? builtinMeta.awardMode : (def.awardMode ?? "manual"),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    try {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("badgeTypes").doc(id);
        const snap = await tx.get(ref);
        if (snap.exists) throw new RequestError(409, "Badge type already exists.");
        tx.create(ref, normalizedDef);
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
  if (SYSTEM_AWARDED_BADGES.has(badgeType)) {
    return NextResponse.json(
      { error: "This badge can only be awarded via its dedicated server workflow." },
      { status: 400 },
    );
  }

  const requestedBadgeId =
    typeof badge.id === "string" && isSafeId(badge.id.trim())
      ? badge.id.trim()
      : crypto.randomUUID();
  const idemRecordId = deterministicIdempotencyRecordId(auth.uid, keyCheck.value);
  const safeAuditId = idemRecordId
    ? `bdg_aud_${idemRecordId.slice("bdg_idem_".length)}`
    : scopedAuditId(keyCheck.value, auth.uid, "create", requestedBadgeId);

  try {
    const outcome = await db.runTransaction(async (tx) => {
      const idemRef = idemRecordId ? db.collection("badgeAwardIdempotency").doc(idemRecordId) : null;
      const defRef = db.collection("badgeTypes").doc(badgeType);
      const ref = db.collection("badges").doc(requestedBadgeId);
      const lockId = deterministicNonStackableBadgeId(playerId, badgeType);
      const lockRef = db.collection("badgeUniquenessLocks").doc(lockId);

      const [idemSnap, defSnap, snap] = await Promise.all([
        idemRef ? tx.get(idemRef) : Promise.resolve(null),
        tx.get(defRef),
        tx.get(ref),
      ]);

      // 1. Check server-authoritative idempotency record first (independent of badge document ID).
      if (idemSnap?.exists) {
        const idemData = idemSnap.data() || {};
        if (idemData.playerId !== playerId || idemData.badgeType !== badgeType) {
          throw new RequestError(409, "Idempotency key already used for a different player or badge type.");
        }
        const originalBadgeId = String(idemData.badgeId || requestedBadgeId);
        const origSnap =
          originalBadgeId === requestedBadgeId
            ? snap
            : await tx.get(db.collection("badges").doc(originalBadgeId));
        if (!origSnap.exists) {
          throw new RequestError(
            409,
            "Original award was already processed, but the badge is no longer present (revoked). Use a new idempotencyKey for a new award.",
          );
        }
        return {
          id: originalBadgeId,
          deduplicated: true,
        };
      }

      // 2. Validate badge definition: built-in catalogue takes precedence over Firestore badgeTypes.
      let isStackable: boolean;
      let touchCustomDefRef = false;
      if (Object.prototype.hasOwnProperty.call(BUILTIN_BADGE_CATALOG, badgeType)) {
        const builtin = BUILTIN_BADGE_CATALOG[badgeType];
        if (defSnap.exists) {
          const defData = defSnap.data() || {};
          if (
            defData.active === false ||
            (defData.stackable !== undefined && Boolean(defData.stackable) !== builtin.stackable) ||
            (defData.awardMode !== undefined && defData.awardMode !== builtin.awardMode) ||
            (defData.category !== undefined && defData.category !== builtin.category)
          ) {
            throw new RequestError(
              409,
              "Built-in badge definition conflicts with the authoritative catalogue.",
            );
          }
        }
        isStackable = builtin.stackable;
      } else if (defSnap.exists) {
        const defData = defSnap.data() || {};
        if (defData.active === false) {
          throw new RequestError(400, "Badge type is inactive or archived.");
        }
        if (typeof defData.awardMode === "string" && SYSTEM_ONLY_AWARD_MODES.has(defData.awardMode as never)) {
          throw new RequestError(400, "This badge can only be awarded via its dedicated server workflow.");
        }
        isStackable = Boolean(defData.stackable);
        touchCustomDefRef = true;
      } else {
        throw new RequestError(400, "Unknown or unconfigured badge type.");
      }

      // 3. Enforce non-stackable uniqueness lock + legacy duplicate query.
      if (!isStackable) {
        const dupQuery = db
          .collection("badges")
          .where("playerId", "==", playerId)
          .where("badgeType", "==", badgeType)
          .limit(1);
        const [dupSnap, lockSnap] = await Promise.all([tx.get(dupQuery), tx.get(lockRef)]);
        if (snap.exists || !dupSnap.empty || lockSnap.exists) {
          throw new RequestError(409, "Player already holds this non-stackable badge.");
        }
      } else if (snap.exists) {
        throw new RequestError(409, "Badge document ID already exists.");
      }

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
      if (touchCustomDefRef) {
        tx.update(defRef, { lastAwardedAt: FieldValue.serverTimestamp() });
      }
      if (!isStackable) {
        tx.create(lockRef, {
          badgeId: requestedBadgeId,
          playerId,
          badgeType,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      if (idemRef) {
        tx.create(idemRef, {
          actorId: auth.uid,
          playerId,
          badgeType,
          badgeId: requestedBadgeId,
          outcome: "succeeded",
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          actorId: auth.uid,
          actorName,
          action: "created",
          entity: "badge",
          entityId: requestedBadgeId,
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

      return { id: requestedBadgeId, deduplicated: false };
    });

    return NextResponse.json({
      ok: true,
      id: outcome.id,
      ...(outcome.deduplicated ? { deduplicated: true } : {}),
    });
  } catch (err) {
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (isAlreadyExistsError(err) || isTransactionContentionError(err)) {
      if (idemRecordId) {
        const existingIdem = await db.collection("badgeAwardIdempotency").doc(idemRecordId).get();
        if (existingIdem.exists) {
          const idemData = existingIdem.data() || {};
          if (idemData.playerId !== playerId || idemData.badgeType !== badgeType) {
            return NextResponse.json(
              { error: "Idempotency key already used for a different player or badge type." },
              { status: 409 },
            );
          }
          const originalBadgeId = String(idemData.badgeId || requestedBadgeId);
          const origSnap = await db.collection("badges").doc(originalBadgeId).get();
          if (!origSnap.exists) {
            return NextResponse.json(
              {
                error:
                  "Original award was already processed, but the badge is no longer present (revoked). Use a new idempotencyKey for a new award.",
              },
              { status: 409 },
            );
          }
          return NextResponse.json({
            ok: true,
            id: originalBadgeId,
            deduplicated: true,
          });
        }
      }
      const lockSnap = await db
        .collection("badgeUniquenessLocks")
        .doc(deterministicNonStackableBadgeId(playerId, badgeType))
        .get();
      if (lockSnap.exists) {
        return NextResponse.json({ error: "Player already holds this non-stackable badge." }, { status: 409 });
      }
      const docSnap = await db.collection("badges").doc(requestedBadgeId).get();
      if (docSnap.exists) {
        return NextResponse.json({ error: "Badge document ID already exists." }, { status: 409 });
      }
      if (!Object.prototype.hasOwnProperty.call(BUILTIN_BADGE_CATALOG, badgeType)) {
        const defExists = (await db.collection("badgeTypes").doc(badgeType).get()).exists;
        if (!defExists) {
          return NextResponse.json({ error: "Unknown or unconfigured badge type." }, { status: 400 });
        }
      }
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

  const keyCheck = validateSuppliedIdempotencyKey(body.idempotencyKey);
  if (!keyCheck.ok) {
    return NextResponse.json(
      { error: "Invalid idempotencyKey. Must be 1-100 alphanumeric, underscore, or hyphen characters." },
      { status: 400 },
    );
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
      if (target === "badgeType") {
        validateBadgeTypeMetadata(id, updates);
      }
      const normalizedUpdates: Record<string, unknown> = { ...updates };
      if (target === "badgeType" && normalizedUpdates.tier !== undefined) {
        normalizedUpdates.tier = normalizeBadgeTier(normalizedUpdates.tier);
      }
      const changes = computeChanges(oldData, normalizedUpdates);
      if (changes.length === 0) return;

      const cleanUpdates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      for (const [k, v] of Object.entries(normalizedUpdates)) {
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
      const lockRef =
        target === "badge" && typeof oldData.playerId === "string" && typeof oldData.badgeType === "string"
          ? db.collection("badgeUniquenessLocks").doc(deterministicNonStackableBadgeId(oldData.playerId, oldData.badgeType))
          : null;
      const lockSnap = lockRef ? await tx.get(lockRef) : null;
      const inUseSnap =
        target === "badgeType"
          ? await tx.get(db.collection("badges").where("badgeType", "==", id).limit(1))
          : null;
      if (inUseSnap && !inUseSnap.empty) {
        throw new RequestError(
          409,
          "Cannot delete a badge type with existing awards. Archive it instead by setting active: false.",
        );
      }

      tx.delete(ref);
      if (lockRef && lockSnap?.exists && lockSnap.data()?.badgeId === id) {
        tx.delete(lockRef);
      }

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
