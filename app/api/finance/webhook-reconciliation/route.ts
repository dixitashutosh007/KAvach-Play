/**
 * Razorpay webhook reconciliation API (`/api/finance/webhook-reconciliation`) — R5.
 *
 * GET  ?status=open|resolved|all (default open)  — list recorded unmatched / rejected payment events.
 * POST { id, resolution, note? }                  — record the finance outcome, once.
 *
 * Finance Admin and Super Admin only (enforced here with the Admin SDK, not by any UI).
 * Records are never deleted, and resolving one never changes payments, fees or ledgers:
 * applying money to an obligation or refunding it is done through the existing authorised
 * workflows; this endpoint records what was done. See lib/webhook-dead-letter.ts.
 */
import { NextResponse } from "next/server.js";
import { requireRole } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor } from "../../../../lib/server-audit.ts";
import {
  DEAD_LETTER_COLLECTION,
  DEAD_LETTER_RESOLUTIONS,
  DeadLetterResolveError,
  resolveWebhookDeadLetter,
  type DeadLetterResolution,
} from "../../../../lib/webhook-dead-letter.ts";

const ALLOWED_ROLES = ["superAdmin", "financeAdmin"] as const;
const MAX_LIST = 100;
const MAX_NOTE = 500;

const toIso = (v: any) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : v ?? null);

export async function GET(req: Request) {
  const guard = await requireRole(req, [...ALLOWED_ROLES]);
  if (!guard.ok) return guard.response;

  const status = new URL(req.url).searchParams.get("status") || "open";
  if (!["open", "resolved", "all"].includes(status)) {
    return NextResponse.json({ error: "status must be open, resolved or all." }, { status: 400 });
  }
  try {
    const col = getServerFirestore().collection(DEAD_LETTER_COLLECTION);
    // Single-field equality only (no composite index needed); sorted in memory.
    const snap = await (status === "all" ? col : col.where("status", "==", status)).limit(MAX_LIST).get();
    const items = snap.docs
      .map((d: any) => {
        const x = d.data() || {};
        return {
          id: d.id,
          status: x.status,
          reason: x.reason,
          classification: x.classification,
          events: x.events || [],
          orderId: x.orderId || null,
          paymentId: x.paymentId || null,
          intentId: x.intentId || null,
          amountPaise: x.amountPaise ?? null,
          currency: x.currency || null,
          deliveryCount: x.deliveryCount || 0,
          firstSeenAt: toIso(x.firstSeenAt),
          lastSeenAt: toIso(x.lastSeenAt),
          resolution: x.resolution || null,
          resolutionNote: x.resolutionNote || null,
          resolvedBy: x.resolvedBy || null,
          resolvedAt: toIso(x.resolvedAt),
        };
      })
      .sort((a: any, b: any) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[finance/webhook-reconciliation] list failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not load records. Please try again." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const guard = await requireRole(req, [...ALLOWED_ROLES]);
  if (!guard.ok) return guard.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const unknown = Object.keys(body).filter((k) => !["id", "resolution", "note"].includes(k));
  if (unknown.length) {
    return NextResponse.json({ error: `Unknown properties not permitted: ${unknown.join(", ")}.` }, { status: 400 });
  }
  const { id, resolution, note } = body;
  if (typeof id !== "string" || !/^[A-Za-z0-9_\-]{1,140}$/.test(id)) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  if (!DEAD_LETTER_RESOLUTIONS.includes(resolution)) {
    return NextResponse.json(
      { error: `resolution must be one of: ${DEAD_LETTER_RESOLUTIONS.join(", ")}.` },
      { status: 400 },
    );
  }
  if (note !== undefined && (typeof note !== "string" || note.length > MAX_NOTE)) {
    return NextResponse.json({ error: `note must be text of at most ${MAX_NOTE} characters.` }, { status: 400 });
  }
  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (resolution === "other" && !trimmedNote) {
    return NextResponse.json({ error: "A note is required when resolution is 'other'." }, { status: 400 });
  }

  const db = getServerFirestore();
  try {
    const actorName = await actorNameFor(db as any, guard.uid);
    await resolveWebhookDeadLetter(db, id, resolution as DeadLetterResolution, trimmedNote || undefined, {
      uid: guard.uid,
      name: actorName,
    });
    return NextResponse.json({ ok: true, id, status: "resolved", resolution });
  } catch (err) {
    if (err instanceof DeadLetterResolveError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finance/webhook-reconciliation] resolve failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not save the resolution. Please try again." }, { status: 503 });
  }
}
