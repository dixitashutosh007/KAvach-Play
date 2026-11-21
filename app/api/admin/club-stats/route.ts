/**
 * POST /api/admin/club-stats
 *
 * Saves the club's admin-maintained totals (exact Matches Played / Matches Won)
 * to `appConfig/clubStats` in the environment's database.
 *
 * Auth: requireClubAdmin (Club Admin or Super Admin) — verified ID token,
 *       authoritative appUsers record / admin claim, disabled accounts rejected.
 * Body: { matchesPlayed: integer ≥ 0, matchesWon: integer ≥ 0 and ≤ matchesPlayed }
 * Win rate is derived on read; it is never accepted or stored.
 */
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireClubAdmin } from "@/lib/server-auth";
import { getServerFirestore } from "@/lib/server-db";
import { CLUB_STATS_COLLECTION, CLUB_STATS_DOC_ID, validateClubStatsInput } from "@/lib/club-stats";

export async function POST(req: Request) {
  const guard = await requireClubAdmin(req);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload." }, { status: 400 });
  }

  const parsed = validateClubStatsInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const db = getServerFirestore();
    await db.collection(CLUB_STATS_COLLECTION).doc(CLUB_STATS_DOC_ID).set({
      matchesPlayed: parsed.value.matchesPlayed,
      matchesWon: parsed.value.matchesWon,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: guard.uid,
    });
    return NextResponse.json({ ok: true, ...parsed.value });
  } catch (err) {
    console.error("[club-stats] Failed to save club statistics:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Club statistics could not be saved." }, { status: 500 });
  }
}
