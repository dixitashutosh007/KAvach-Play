import { NextResponse } from "next/server.js";
import { requireFinanceAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";

const FINANCE_PLAYER_FIELDS = [
  "id",
  "name",
  "kavachId",
  "photoURL",
  "inviteStatus",
  "disabled",
  "mergedInto",
  "isGuest",
  "isStudioMember",
  "studioStartDate",
  "studioEndDate",
  "studioExpiryDate",
  "lastPaidDate",
  "studioPlan",
  "feePlanIds",
] as const;

function toFinancePlayer(player: Record<string, unknown> & { id: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of FINANCE_PLAYER_FIELDS) {
    if (player[field] !== undefined) out[field] = player[field];
  }
  out.id = player.id;
  out.name = typeof player.name === "string" && player.name ? player.name : "Player";
  return out;
}

/**
 * GET /api/finance/players
 *
 * P2-PII-01: Narrowly scoped server-side financial player projection for Finance Admin
 * and Super Admin. Excludes all unrelated PII (mobile, email, dob, bloodGroup,
 * emergencyContact, locality, sizes, authUid).
 */
export async function GET(req: Request) {
  const auth = await requireFinanceAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const db = getServerFirestore();
    const snap = await db.collection("players").get();
    const players = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }) as Record<string, unknown> & { id: string })
      .filter((p) => {
        const nameLower = String(p.name || "").toLowerCase();
        const emailLower = String(p.email || "").toLowerCase();
        return !nameLower.includes("demo") && !emailLower.includes("demo");
      })
      .map((p) => toFinancePlayer(p));

    return NextResponse.json({ players });
  } catch (err) {
    console.error("[finance/players] GET failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not load finance player list." }, { status: 500 });
  }
}
