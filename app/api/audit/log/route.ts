import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireRole } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor } from "../../../../lib/server-audit.ts";
import {
  filterAndSanitizeAuditEntries,
  getPermittedAuditEntities,
  type AuditRoleContext,
} from "../../../../lib/audit-access.ts";

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
  "player_stat",
  "club_stats",
  "shop",
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
  "access",
  "user_role",
  "payment",
  "subscription_period",
  "fee_plan_assignment",
  "player_stat",
  "club_stats",
  "shop",
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
  if (
    SERVER_AUTHORITATIVE_ONLY_ENTITIES.has(entity) ||
    (entity === "player" && (action === "created" || action === "deleted"))
  ) {
    return NextResponse.json(
      { error: "Authoritative audit events for this operation must be generated server-side." },
      { status: 403 },
    );
  }
  if (!ALLOWED_ENTITIES.has(entity)) {
    return NextResponse.json({ error: "Invalid audit entity." }, { status: 400 });
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

function serializeTimestamp(val: unknown): number | string | null {
  if (!val) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null) {
    const maybe = val as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    const secs = maybe.seconds ?? maybe._seconds;
    if (typeof secs === "number") return secs * 1000;
  }
  return null;
}

/**
 * GET /api/audit/log
 *
 * Server-authoritative, role-filtered audit log viewer endpoint.
 * - Super Admin: all audit entities.
 * - Club Admin: operational entities only (no financial entities or financial field diffs).
 * - Finance Admin: financial & permitted entities only (no club-operational entities).
 */
export async function GET(req: Request) {
  const auth = await requireRole(req, ["superAdmin", "clubAdmin", "financeAdmin"]);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const entityFilter = (url.searchParams.get("entity") || "").trim();
  const actionFilter = (url.searchParams.get("action") || "").trim();
  const actorTypeFilter = (url.searchParams.get("actorType") || "").trim();
  const actorQuery = (url.searchParams.get("actorQuery") || "").trim().toLowerCase();
  const cursorId = (url.searchParams.get("cursor") || "").trim();
  const rawLimit = url.searchParams.get("limit");

  let pageSize = 30;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return NextResponse.json(
        { error: "Invalid limit parameter (must be 1–100)." },
        { status: 400 },
      );
    }
    pageSize = parsed;
  }

  if (entityFilter && !ALLOWED_ENTITIES.has(entityFilter)) {
    return NextResponse.json({ error: "Invalid entity filter." }, { status: 400 });
  }
  if (actionFilter && !ALLOWED_ACTIONS.has(actionFilter)) {
    return NextResponse.json({ error: "Invalid action filter." }, { status: 400 });
  }

  const roles: AuditRoleContext = {
    isSuperAdmin: auth.roles.has("superAdmin"),
    isClubAdmin: auth.roles.has("clubAdmin"),
    isFinanceAdmin: auth.roles.has("financeAdmin"),
  };
  const permitted = getPermittedAuditEntities(roles);
  if (entityFilter && permitted !== "ALL" && !permitted.includes(entityFilter)) {
    return NextResponse.json(
      { error: "Access forbidden for this audit entity." },
      { status: 403 },
    );
  }

  try {
    const db = getServerFirestore();
    let baseQuery: FirebaseFirestore.Query = db.collection("auditLogs");
    if (entityFilter) baseQuery = baseQuery.where("entity", "==", entityFilter);
    if (actionFilter) baseQuery = baseQuery.where("action", "==", actionFilter);
    if (actorTypeFilter) baseQuery = baseQuery.where("actorType", "==", actorTypeFilter);
    baseQuery = baseQuery.orderBy("timestamp", "desc");

    let lastSnap: FirebaseFirestore.DocumentSnapshot | null = null;
    if (cursorId) {
      const cursorSnap = await db.collection("auditLogs").doc(cursorId).get();
      if (!cursorSnap.exists) {
        return NextResponse.json({ error: "Cursor not found." }, { status: 400 });
      }
      lastSnap = cursorSnap;
    }

    const collected: Record<string, unknown>[] = [];
    let hasMore = false;
    let nextCursor: string | null = null;
    const batchSize = Math.min(100, Math.max(pageSize * 2, 50));
    let pagesScanned = 0;

    while (collected.length < pageSize && pagesScanned < 6) {
      pagesScanned += 1;
      let q = baseQuery.limit(batchSize);
      if (lastSnap) q = q.startAfter(lastSnap);
      const snap = await q.get();
      if (snap.empty || snap.docs.length === 0) break;

      const rawDocs: Array<
        Record<string, unknown> & {
          id: string;
          entity?: string;
          changes?: Array<{ field: string; oldValue?: unknown; newValue?: unknown }>;
          summary?: string;
          timestamp: number | string | null;
        }
      > = snap.docs.map((d) => {
        const data = (d.data() || {}) as Record<string, unknown>;
        return {
          ...data,
          id: d.id,
          timestamp: serializeTimestamp(data.timestamp),
        };
      });

      const roleFiltered = filterAndSanitizeAuditEntries(rawDocs, roles).filter((entry) => {
        if (!actorQuery) return true;
        const name = String((entry as Record<string, unknown>).actorName || "").toLowerCase();
        const id = String((entry as Record<string, unknown>).actorId || "").toLowerCase();
        return name.includes(actorQuery) || id.includes(actorQuery);
      });

      for (const item of roleFiltered) {
        if (collected.length < pageSize) {
          collected.push(item);
          nextCursor = String(item.id);
        } else {
          hasMore = true;
          break;
        }
      }

      if (hasMore) break;
      if (collected.length === pageSize && snap.docs.length === batchSize) {
        hasMore = true;
        break;
      }
      if (snap.docs.length < batchSize) break;
      lastSnap = snap.docs[snap.docs.length - 1];
    }

    let totalCount: number | null = null;
    if (!entityFilter && !actionFilter && !actorTypeFilter && !actorQuery && permitted === "ALL") {
      try {
        const countSnap = await db.collection("auditLogs").count().get();
        totalCount = countSnap.data().count;
      } catch {
        totalCount = null;
      }
    }

    return NextResponse.json({
      logs: collected,
      nextCursor: hasMore ? nextCursor : null,
      hasMore,
      permittedEntities: permitted,
      totalCount,
    });
  } catch (err) {
    console.error("[audit/log] GET failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not load audit logs." }, { status: 500 });
  }
}
