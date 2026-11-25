/**
 * GET / POST /api/admin/action-centre
 *
 * Club Admin Weekly Action Centre state, per-admin popup dismissals, and
 * transparent WhatsApp share-initiation tracking.
 *
 * Auth: Club Admin or Super Admin (`requireClubAdmin`).
 */
import { NextResponse } from "next/server.js";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { serverNow } from "../../../../lib/weekend-ops-server.ts";
import {
  ActionCentreHttpError,
  dismissActionCentrePopup,
  getActionCentreState,
  recordMatchSquadShare,
} from "../../../../lib/action-centre-server.ts";

export async function GET(req: Request) {
  const guard = await requireClubAdmin(req);
  if (!guard.ok) return guard.response;

  try {
    const db = getServerFirestore();
    const state = await getActionCentreState(db, guard.uid, serverNow(req));
    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    console.error("[action-centre] GET failed:", err);
    return NextResponse.json(
      { error: "Could not load Weekly Action Centre." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const guard = await requireClubAdmin(req);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const db = getServerFirestore();

  try {
    if (record.action === "dismiss_popup") {
      const res = await dismissActionCentrePopup(
        db,
        guard.uid,
        String(record.actionId || ""),
        String(record.weekId || ""),
      );
      return NextResponse.json(res);
    }
    if (record.action === "record_share") {
      const res = await recordMatchSquadShare(db, guard.uid, String(record.matchId || ""));
      return NextResponse.json(res);
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    if (err instanceof ActionCentreHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[action-centre] POST failed:", err);
    return NextResponse.json(
      { error: "Action Centre update failed." },
      { status: 500 },
    );
  }
}
