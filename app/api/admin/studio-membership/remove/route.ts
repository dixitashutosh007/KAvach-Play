/**
 * POST /api/admin/studio-membership/remove
 *
 * Revokes Studio membership (`isStudioMember: false`) for a player on both
 * `players/{playerId}` and any linked `appUsers/{uid}` documents in a single
 * Firestore transaction, preserving player identity and subscription/payment
 * history.
 *
 * Auth: Club Admin or Super Admin (`requireClubAdmin`).
 */
import { NextResponse } from "next/server.js";
import { requireClubAdmin } from "../../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../../lib/server-db.ts";
import {
  removeStudioMembershipTx,
  StudioMembershipHttpError,
} from "../../../../../lib/studio-membership-server.ts";

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

  const playerId = (body as Record<string, unknown>).playerId;
  if (typeof playerId !== "string" || !playerId.trim()) {
    return NextResponse.json({ error: "Player ID is required." }, { status: 400 });
  }

  try {
    const db = getServerFirestore();
    const result = await removeStudioMembershipTx(db, guard.uid, playerId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof StudioMembershipHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[studio-membership/remove] failed:", err);
    return NextResponse.json(
      { error: "Could not remove Studio membership. Please try again." },
      { status: 500 },
    );
  }
}
