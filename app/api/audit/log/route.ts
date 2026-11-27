import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireRole } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor } from "../../../../lib/server-audit.ts";

const ALLOWED_ACTIONS = new Set([
  "created",
  "updated",
  "deleted",
  "paid",
  "sent",
  "status_change",
]);

const ALLOWED_ENTITIES = new Set([
  "match",
  "player",
  "payment",
  "ground",
  "tournament",
  "subscription",
  "badge",
  "badge_type",
  "merchandise",
  "merch_order",
  "fee",
  "fee_plan",
  "fee_plan_assignment",
  "subscription_period",
  "fee_template",
  "settings",
  "reminder",
  "poll",
  "post",
  "out_of_play",
  "catch",
  "comment",
  "user_role",
  "lead",
]);

const REDACTED_CHANGE_FIELDS = new Set([
  "mobile",
  "phone",
  "email",
  "dob",
  "bloodGroup",
  "emergencyContact",
  "locality",
  "password",
  "smtpPassword",
  "resendApiKey",
  "razorpayKeySecret",
  "token",
  "secret",
]);

const SERVER_AUTHORITATIVE_ONLY_ENTITIES = new Set([
  "user_role",
  "payment",
  "subscription_period",
  "fee_plan_assignment",
]);

function sanitizeChangeVal(field: string, val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (REDACTED_CHANGE_FIELDS.has(field)) return "[REDACTED]";
  return String(val).slice(0, 200);
}

/**
 * POST /api/audit/log
 *
 * P2-AUD-01: Authoritative server-side audit log creation endpoint.
 * Direct client writes to Firestore `auditLogs` are denied (`allow create: if false`).
 * Actor identity (`actorId`, `actorName`, `actorType`) and `timestamp` are strictly
 * derived on the server; any client-supplied values for those fields are ignored.
 */
export async function POST(req: Request) {
  const auth = await requireRole(req, ["superAdmin", "clubAdmin", "financeAdmin"]);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const entity = typeof body.entity === "string" ? body.entity.trim() : "";
  const entityId = typeof body.entityId === "string" ? body.entityId.trim().slice(0, 128) : "";
  const entityLabel = typeof body.entityLabel === "string" ? body.entityLabel.trim().slice(0, 160) : "";
  const summary = typeof body.summary === "string" ? body.summary.trim().slice(0, 400) : "";

  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Invalid audit action." }, { status: 400 });
  }
  if (!ALLOWED_ENTITIES.has(entity)) {
    return NextResponse.json({ error: "Invalid audit entity." }, { status: 400 });
  }
  if (
    SERVER_AUTHORITATIVE_ONLY_ENTITIES.has(entity) ||
    (entity === "player" && action === "deleted")
  ) {
    return NextResponse.json(
      { error: "Authoritative audit events for this operation must be generated server-side." },
      { status: 403 },
    );
  }
  if (!entityId || !summary) {
    return NextResponse.json({ error: "entityId and summary are required." }, { status: 400 });
  }

  const rawChanges = Array.isArray(body.changes) ? body.changes.slice(0, 25) : [];
  const changes: { field: string; oldValue?: string; newValue?: string }[] = [];
  for (const item of rawChanges) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const field = typeof rec.field === "string" ? rec.field.trim().slice(0, 64) : "";
    if (!field) continue;
    const oldValue = sanitizeChangeVal(field, rec.oldValue);
    const newValue = sanitizeChangeVal(field, rec.newValue);
    changes.push({
      field,
      ...(oldValue !== undefined ? { oldValue } : {}),
      ...(newValue !== undefined ? { newValue } : {}),
    });
  }

  const rawKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const safeId =
    rawKey && /^[a-zA-Z0-9_-]{1,128}$/.test(rawKey)
      ? rawKey
      : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const db = getServerFirestore();
    const actorName = await actorNameFor(db, auth.uid);
    const ref = db.collection("auditLogs").doc(safeId);
    const entry = {
      id: safeId,
      actorId: auth.uid,
      actorName,
      actorType: "admin" as const,
      source: "client_activity" as const,
      action,
      entity,
      entityId,
      entityLabel: entityLabel || entityId,
      changes,
      summary,
      timestamp: FieldValue.serverTimestamp(),
    };

    try {
      await ref.create(entry);
    } catch (err: unknown) {
      const code = (err as { code?: unknown })?.code;
      if (code === 6 || String(err).includes("ALREADY_EXISTS")) {
        return NextResponse.json({ ok: true, id: safeId, deduplicated: true });
      }
      throw err;
    }

    return NextResponse.json({ ok: true, id: safeId });
  } catch (err) {
    console.error("[audit/log] POST failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not record audit log." }, { status: 500 });
  }
}
