import { NextResponse } from "next/server.js";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { allocateNextKavachId } from "../../../../lib/kavach-id.ts";
import { isSafeId } from "../../../../lib/weekend-ops-server.ts";

export async function POST(req: Request) {
  const guard = await requireClubAdmin(req);
  if (!guard.ok) return guard.response;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let playerId: string | undefined;
  if (body?.playerId !== undefined && body?.playerId !== null) {
    if (typeof body.playerId !== "string" || !isSafeId(body.playerId.trim())) {
      return NextResponse.json({ error: "Invalid playerId." }, { status: 400 });
    }
    playerId = body.playerId.trim();
  }
  const year = typeof body?.year === "number" ? body.year : new Date().getFullYear();

  try {
    const db = getServerFirestore();
    const result = await allocateNextKavachId(db, { year, playerId });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    const msg = err?.message || "Failed to allocate Player ID.";
    return NextResponse.json({ error: msg }, { status: msg === "Player not found." ? 404 : 500 });
  }
}
