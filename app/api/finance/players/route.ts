import { NextResponse } from "next/server.js";
import { FieldPath } from "firebase-admin/firestore";
import { requireFinanceAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 200;
const MAX_SCAN_DOCS = 250;

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

const SELECT_FIELDS = Array.from(new Set([...FINANCE_PLAYER_FIELDS, "email"]));

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
 * P2-PII-01 & P2-API-03: Bounded, field-masked (`.select()`) cursor-paginated
 * financial player projection for Finance Admin and Super Admin.
 * Excludes all unrelated PII (mobile, email, dob, bloodGroup, emergencyContact, locality, sizes, authUid).
 */
export async function GET(req: Request) {
  const auth = await requireFinanceAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const rawCursor = url.searchParams.get("cursor");

  let limit = DEFAULT_PAGE_SIZE;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > MAX_PAGE_SIZE) {
      return NextResponse.json(
        { error: `Invalid limit parameter (must be between 1 and ${MAX_PAGE_SIZE}).` },
        { status: 400 },
      );
    }
    limit = Number(rawLimit);
  }

  const cursor = rawCursor ? rawCursor.trim() : null;
  if (cursor !== null && (!cursor || cursor.length > 128 || cursor.includes("/"))) {
    return NextResponse.json({ error: "Invalid cursor parameter." }, { status: 400 });
  }

  try {
    const db = getServerFirestore();
    let cursorSnap: FirebaseFirestore.DocumentSnapshot | null = null;
    if (cursor) {
      cursorSnap = await db.collection("players").doc(cursor).get();
      if (!cursorSnap.exists) {
        return NextResponse.json({ error: "Cursor document not found." }, { status: 400 });
      }
    }

    const players: Record<string, unknown>[] = [];
    let scanned = 0;
    let lastScannedDoc: FirebaseFirestore.DocumentSnapshot | null = cursorSnap;
    let exhausted = false;

    while (players.length < limit + 1 && scanned < MAX_SCAN_DOCS && !exhausted) {
      const batchLimit = Math.min(limit + 25, MAX_SCAN_DOCS - scanned);
      let query = db
        .collection("players")
        .select(...SELECT_FIELDS)
        .orderBy(FieldPath.documentId())
        .limit(batchLimit);

      if (lastScannedDoc) {
        query = query.startAfter(lastScannedDoc);
      }

      const snap = await query.get();
      if (snap.empty) {
        exhausted = true;
        break;
      }

      scanned += snap.docs.length;
      lastScannedDoc = snap.docs[snap.docs.length - 1]!;
      if (snap.docs.length < batchLimit) exhausted = true;

      for (const d of snap.docs) {
        const p = { id: d.id, ...(d.data() || {}) } as Record<string, unknown> & { id: string };
        const nameLower = String(p.name || "").toLowerCase();
        const emailLower = String(p.email || "").toLowerCase();
        if (nameLower.includes("demo") || emailLower.includes("demo")) continue;
        players.push(toFinancePlayer(p));
        if (players.length >= limit + 1) break;
      }
    }

    const hasMore = players.length > limit || (!exhausted && scanned >= MAX_SCAN_DOCS);
    const pageItems = players.slice(0, limit);
    const nextCursor =
      hasMore && pageItems.length > 0 ? String(pageItems[pageItems.length - 1]!.id) : null;

    return NextResponse.json({
      players: pageItems,
      pageSize: limit,
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error("[finance/players] GET failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not load finance player list." }, { status: 500 });
  }
}
