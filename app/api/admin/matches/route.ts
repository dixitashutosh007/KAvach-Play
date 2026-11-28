import crypto from "node:crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireClubAdmin, requireRole } from "../../../../lib/server-auth.ts";
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

const FINANCE_ONLY_ALLOWED_FIELDS = new Set(["fee", "matchFeeBudget", "feeMarginPct"]);
const SKIP_DIFF_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

function scopedAuditId(
  rawKey: unknown,
  uid: string,
  op: string,
  matchId: string,
): string | undefined {
  if (typeof rawKey !== "string") return undefined;
  const trimmed = rawKey.trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(trimmed)) return undefined;
  const digest = crypto
    .createHash("sha256")
    .update(`${uid}:matches:${op}:${matchId}:${trimmed}`)
    .digest("hex")
    .slice(0, 32);
  return `mtch_${digest}`;
}

function isAlreadyExistsError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 6 || String(err).includes("ALREADY_EXISTS");
}

function computeMatchChanges(
  oldData: Record<string, unknown>,
  updates: Record<string, unknown>,
): { field: string; oldValue?: string; newValue?: string }[] {
  const changes: { field: string; oldValue?: string; newValue?: string }[] = [];
  for (const [field, newVal] of Object.entries(updates)) {
    if (SKIP_DIFF_FIELDS.has(field) || newVal === undefined) continue;
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
 * POST /api/admin/matches — Create a match with transactional server audit (including base fee).
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

  const match = (body.match || {}) as Record<string, unknown>;
  const opponent = typeof match.opponent === "string" ? match.opponent.trim() : "";
  const date = typeof match.date === "string" ? match.date.trim() : "";
  if (!opponent || !date) {
    return NextResponse.json({ error: "opponent and date are required." }, { status: 400 });
  }

  const matchId =
    typeof match.id === "string" && isSafeId(match.id.trim())
      ? match.id.trim()
      : crypto.randomUUID();
  const safeAuditId = scopedAuditId(body.idempotencyKey, auth.uid, "create", matchId);

  try {
    const db = getServerFirestore();
    const actorName = await actorNameFor(db, auth.uid);

    await db.runTransaction(async (tx) => {
      const ref = db.collection("matches").doc(matchId);
      const snap = await tx.get(ref);
      if (snap.exists) return;

      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(match)) {
        if (k === "id" || k === "createdAt" || k === "updatedAt" || v === undefined) continue;
        payload[k] = v;
      }
      payload.opponent = opponent;
      payload.date = date;
      payload.createdAt = FieldValue.serverTimestamp();
      payload.updatedAt = FieldValue.serverTimestamp();

      tx.create(ref, payload);

      const feeVal = typeof match.fee === "number" ? `₹${match.fee}` : undefined;
      const changes: { field: string; oldValue?: string; newValue?: string }[] = [
        { field: "opponent", newValue: opponent },
        { field: "date", newValue: date },
        ...(match.format ? [{ field: "format", newValue: String(match.format) }] : []),
        ...(match.matchType ? [{ field: "matchType", newValue: String(match.matchType) }] : []),
        ...(feeVal !== undefined ? [{ field: "fee", newValue: feeVal }] : []),
        ...(match.feeMarginPct !== undefined ? [{ field: "feeMarginPct", newValue: String(match.feeMarginPct) }] : []),
      ];

      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          actorId: auth.uid,
          actorName,
          action: "created",
          entity: "match",
          entityId: matchId,
          entityLabel: `vs ${opponent}`,
          changes,
          summary: `Created ${String(match.matchType || "Practice")} match vs ${opponent} on ${date}${feeVal ? ` (fee ${feeVal})` : ""}`,
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true, id: matchId });
  } catch (err) {
    if (safeAuditId && isAlreadyExistsError(err)) {
      return NextResponse.json({ ok: true, id: matchId, deduplicated: true });
    }
    console.error("[admin/matches] POST failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not create match." }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/matches — Update match details or base match fee with transactional server audit.
 */
export async function PATCH(req: Request) {
  const auth = await requireRole(req, ["clubAdmin", "superAdmin", "financeAdmin"]);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
  const updates =
    body.updates && typeof body.updates === "object" && !Array.isArray(body.updates)
      ? (body.updates as Record<string, unknown>)
      : {};

  if (!isSafeId(matchId)) {
    return NextResponse.json({ error: "Valid matchId is required." }, { status: 400 });
  }

  const isClubOrSuper = auth.roles.has("clubAdmin") || auth.roles.has("superAdmin");
  if (!isClubOrSuper) {
    const disallowed = Object.keys(updates).filter(
      (k) => !SKIP_DIFF_FIELDS.has(k) && !FINANCE_ONLY_ALLOWED_FIELDS.has(k),
    );
    if (disallowed.length > 0) {
      return NextResponse.json(
        { error: "Finance Admins can only update match fee fields." },
        { status: 403 },
      );
    }
  }

  const safeAuditId = scopedAuditId(body.idempotencyKey, auth.uid, "update", matchId);

  try {
    const db = getServerFirestore();
    const actorName = await actorNameFor(db, auth.uid);

    await db.runTransaction(async (tx) => {
      const ref = db.collection("matches").doc(matchId);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new RequestError(404, "Match not found.");
      }
      const oldData = snap.data() || {};
      const changes = computeMatchChanges(oldData, updates);
      if (changes.length === 0) return;

      const cleanUpdates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      for (const [k, v] of Object.entries(updates)) {
        if (SKIP_DIFF_FIELDS.has(k) || v === undefined) continue;
        cleanUpdates[k] = v;
      }

      tx.update(ref, cleanUpdates);

      const opponent = String(updates.opponent || oldData.opponent || matchId);
      const feeChanged = changes.find((c) => c.field === "fee");
      const summary = feeChanged
        ? `Updated base match fee for vs ${opponent} (${feeChanged.oldValue ? `₹${feeChanged.oldValue}` : "-"} → ₹${feeChanged.newValue})`
        : updates.matchFeeBudget !== undefined
          ? `Updated match fee budget to ₹${updates.matchFeeBudget} for match vs ${opponent}`
          : `Updated match vs ${opponent} on ${String(updates.date || oldData.date || "")}`;

      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          actorId: auth.uid,
          actorName,
          action: "updated",
          entity: "match",
          entityId: matchId,
          entityLabel: `vs ${opponent}`,
          changes,
          summary,
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true, id: matchId });
  } catch (err) {
    if (safeAuditId && isAlreadyExistsError(err)) {
      return NextResponse.json({ ok: true, id: matchId, deduplicated: true });
    }
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/matches] PATCH failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not update match." }, { status: 500 });
  }
}

/**
 * PUT /api/admin/matches — Bulk update matches with transactional per-match server audits.
 * Processes in chunks of 200 matches (<= 400 writes per transaction, under Firestore's 500 limit).
 */
export async function PUT(req: Request) {
  const auth = await requireRole(req, ["clubAdmin", "superAdmin", "financeAdmin"]);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawUpdates = Array.isArray(body.updates) ? body.updates : [];
  if (rawUpdates.length === 0) {
    return NextResponse.json({ ok: true, updatedCount: 0 });
  }
  if (rawUpdates.length > 500) {
    return NextResponse.json({ error: "Too many matches in one bulk update (max 500)." }, { status: 400 });
  }

  const isClubOrSuper = auth.roles.has("clubAdmin") || auth.roles.has("superAdmin");
  const normalized: Array<{ matchId: string; updates: Record<string, unknown> }> = [];
  for (const item of rawUpdates) {
    if (!item || typeof item !== "object") {
      return NextResponse.json({ error: "Invalid update item." }, { status: 400 });
    }
    const rec = item as Record<string, unknown>;
    const matchId = typeof rec.matchId === "string" ? rec.matchId.trim() : "";
    const updates =
      rec.updates && typeof rec.updates === "object" && !Array.isArray(rec.updates)
        ? (rec.updates as Record<string, unknown>)
        : null;
    if (!isSafeId(matchId) || !updates) {
      return NextResponse.json({ error: "Each item requires a valid matchId and updates object." }, { status: 400 });
    }
    if (!isClubOrSuper) {
      const disallowed = Object.keys(updates).filter(
        (k) => !SKIP_DIFF_FIELDS.has(k) && !FINANCE_ONLY_ALLOWED_FIELDS.has(k),
      );
      if (disallowed.length > 0) {
        return NextResponse.json(
          { error: "Finance Admins can only update match fee fields." },
          { status: 403 },
        );
      }
    }
    normalized.push({ matchId, updates });
  }

  const rawKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const db = getServerFirestore();
  const actorName = await actorNameFor(db, auth.uid);
  const CHUNK_SIZE = 200;
  let updatedCount = 0;
  let deduplicated = false;

  try {
    for (let i = 0; i < normalized.length; i += CHUNK_SIZE) {
      const chunk = normalized.slice(i, i + CHUNK_SIZE);
      await db.runTransaction(async (tx) => {
        // Read all match docs (and any idempotency audit docs) before writes
        const refs = chunk.map((c) => db.collection("matches").doc(c.matchId));
        const auditIds = chunk.map((c) =>
          rawKey ? scopedAuditId(`${rawKey}_${c.matchId}`, auth.uid, "bulk_update", c.matchId) : undefined,
        );
        const [snaps, auditSnaps] = await Promise.all([
          Promise.all(refs.map((r) => tx.get(r))),
          Promise.all(
            auditIds.map((aid) =>
              aid ? tx.get(db.collection("auditLogs").doc(aid)) : Promise.resolve(null),
            ),
          ),
        ]);

        for (let idx = 0; idx < chunk.length; idx++) {
          const { matchId, updates } = chunk[idx];
          const snap = snaps[idx];
          if (!snap.exists) {
            throw new RequestError(404, `Match not found: ${matchId}`);
          }
          if (auditSnaps[idx]?.exists) {
            deduplicated = true;
            continue;
          }
          const oldData = snap.data() || {};
          const changes = computeMatchChanges(oldData, updates);
          if (changes.length === 0) continue;

          const cleanUpdates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
          for (const [k, v] of Object.entries(updates)) {
            if (SKIP_DIFF_FIELDS.has(k) || v === undefined) continue;
            cleanUpdates[k] = v;
          }

          const safeAuditId = auditIds[idx];

          tx.update(refs[idx], cleanUpdates);
          const opponent = String(updates.opponent || oldData.opponent || matchId);
          await writeServerAudit(
            db,
            {
              ...(safeAuditId ? { id: safeAuditId } : {}),
              actorId: auth.uid,
              actorName,
              action: "updated",
              entity: "match",
              entityId: matchId,
              entityLabel: `vs ${opponent}`,
              changes,
              summary: `Bulk updated match vs ${opponent} on ${String(updates.date || oldData.date || "")}`,
            },
            tx,
          );
          updatedCount += 1;
        }
      });
    }

    return NextResponse.json({ ok: true, updatedCount, ...(deduplicated ? { deduplicated: true } : {}) });
  } catch (err) {
    if (rawKey && isAlreadyExistsError(err)) {
      return NextResponse.json({ ok: true, updatedCount, deduplicated: true });
    }
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/matches] PUT failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not bulk update matches." }, { status: 500 });
  }
}
