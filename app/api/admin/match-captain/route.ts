/**
 * POST /api/admin/match-captain
 *
 * Assigns, changes, or clears the captain for a match.
 * Auth: Club Admin or Super Admin (`requireClubAdmin`).
 */
import { NextResponse } from "next/server.js";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import {
  assignMatchCaptainTx,
  MatchCaptainHttpError,
} from "../../../../lib/match-captain-server.ts";

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
  const matchId = typeof record.matchId === "string" ? record.matchId : "";
  const captainId =
    record.captainId === null || record.captainId === undefined
      ? null
      : typeof record.captainId === "string"
        ? record.captainId
        : "";

  if (!matchId.trim()) {
    return NextResponse.json({ error: "Match ID is required." }, { status: 400 });
  }
  if (
    record.captainId !== null &&
    record.captainId !== undefined &&
    typeof record.captainId !== "string"
  ) {
    return NextResponse.json({ error: "Invalid captain ID." }, { status: 400 });
  }

  try {
    const db = getServerFirestore();
    const result = await assignMatchCaptainTx(db, guard.uid, matchId, captainId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof MatchCaptainHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[match-captain] failed:", err);
    return NextResponse.json(
      { error: "Could not update match captain. Please try again." },
      { status: 500 },
    );
  }
}
