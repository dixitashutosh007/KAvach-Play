import { NextResponse } from "next/server.js";
import { requireAuth } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { toPublicPlayer } from "../../../../lib/club-feed.ts";

/**
 * GET /api/players/public
 *
 * DEF-R3-003: Returns strictly non-PII public player projections (`toPublicPlayer()`)
 * for authenticated users so Squad, Directory, Leaderboard, and Catches work
 * without exposing private player fields (mobile, email, dob, bloodGroup,
 * emergencyContact, locality, sizes, or membership/payment data) in Firestore.
 */
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  try {
    const db = getServerFirestore();
    const snap = await db.collection("players").get();
    const players = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }) as Record<string, any> & { id: string })
      .filter((p) => {
        if (p.disabled === true || p.mergedInto) return false;
        if (p.inviteStatus === "Pending" || p.inviteStatus === "Rejected") return false;
        const nameLower = String(p.name || "").toLowerCase();
        const emailLower = String(p.email || "").toLowerCase();
        return !nameLower.includes("demo") && !emailLower.includes("demo");
      })
      .map((p) => ({
        ...toPublicPlayer(p),
        inviteStatus: p.inviteStatus || "Accepted",
      }));

    return NextResponse.json({ players });
  } catch (err) {
    console.error("[players/public] GET failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not load player directory." }, { status: 500 });
  }
}
