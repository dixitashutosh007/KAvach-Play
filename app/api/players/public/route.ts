import { NextResponse } from "next/server.js";
import { FieldPath } from "firebase-admin/firestore";
import { requireAuth } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { PUBLIC_PLAYER_FIELDS, toPublicPlayer } from "../../../../lib/club-feed.ts";
import { checkSharedRateLimit } from "../../../../lib/rate-limit-server.ts";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_SCAN_DOCS = 250;
const MAX_SEARCH_LENGTH = 80;
const ALLOWED_SORTS = new Set(["name_asc", "name_desc", "runs_desc", "wickets_desc", "catches_desc"]);

const SORT_FIELD_MAP: Record<string, { field: string; dir: "asc" | "desc" }> = {
  name_asc: { field: "name", dir: "asc" },
  name_desc: { field: "name", dir: "desc" },
  runs_desc: { field: "totalRuns", dir: "desc" },
  wickets_desc: { field: "totalWickets", dir: "desc" },
  catches_desc: { field: "stunningCatches", dir: "desc" },
};

const SELECT_FIELDS = Array.from(
  new Set([...PUBLIC_PLAYER_FIELDS, "inviteStatus", "disabled", "mergedInto", "email"]),
);

/**
 * GET /api/players/public
 *
 * DEF-R3-003, P2-API-01 & P2-API-02:
 * - Bounded Firestore cursor pagination (`.select()` + `.orderBy()` + `.startAfter()` + `.limit()`)
 * - Shared Firestore-backed rate limiter across instances
 * - Strictly non-PII `toPublicPlayer()` projection
 */
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const rawCursor = url.searchParams.get("cursor");
  const rawSearch = url.searchParams.get("search") ?? "";
  const rawSort = url.searchParams.get("sort") ?? "name_asc";

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

  const search = rawSearch.trim();
  if (search.length > MAX_SEARCH_LENGTH) {
    return NextResponse.json(
      { error: `Search query exceeds maximum length of ${MAX_SEARCH_LENGTH} characters.` },
      { status: 400 },
    );
  }

  if (!ALLOWED_SORTS.has(rawSort)) {
    return NextResponse.json({ error: "Invalid sort parameter." }, { status: 400 });
  }

  try {
    const db = getServerFirestore();
    const rate = await checkSharedRateLimit(db, "public_players", auth.uid, {
      windowMs: 60_000,
      maxRequests: 60,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many directory requests. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
      );
    }

    const { field: sortField, dir: sortDir } = SORT_FIELD_MAP[rawSort]!;
    const q = search.toLowerCase();

    let cursorSnap: FirebaseFirestore.DocumentSnapshot | null = null;
    if (cursor) {
      cursorSnap = await db.collection("players").doc(cursor).get();
      if (!cursorSnap.exists) {
        return NextResponse.json({ error: "Cursor document not found." }, { status: 400 });
      }
    }

    const players: ReturnType<typeof toPublicPlayer>[] = [];
    let scanned = 0;
    let lastScannedDoc: FirebaseFirestore.DocumentSnapshot | null = cursorSnap;
    let exhausted = false;

    while (players.length < limit + 1 && scanned < MAX_SCAN_DOCS && !exhausted) {
      const remainingScan = MAX_SCAN_DOCS - scanned;
      const batchLimit = Math.min(limit + 25, remainingScan);
      let query = db
        .collection("players")
        .select(...SELECT_FIELDS)
        .orderBy(sortField, sortDir)
        .orderBy(FieldPath.documentId(), sortDir)
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
      if (snap.docs.length < batchLimit) {
        exhausted = true;
      }

      for (const docSnap of snap.docs) {
        const p = { id: docSnap.id, ...(docSnap.data() || {}) } as Record<string, any> & { id: string };
        if (p.disabled === true || p.mergedInto) continue;
        if (p.inviteStatus === "Pending" || p.inviteStatus === "Rejected") continue;
        const nameLower = String(p.name || "").toLowerCase();
        const emailLower = String(p.email || "").toLowerCase();
        if (nameLower.includes("demo") || emailLower.includes("demo")) continue;
        if (
          q &&
          ![p.name, p.jerseyName, p.kavachId].some(
            (v) => typeof v === "string" && v.toLowerCase().includes(q),
          )
        ) {
          continue;
        }
        players.push({
          ...toPublicPlayer(p),
          inviteStatus: p.inviteStatus || "Accepted",
        } as ReturnType<typeof toPublicPlayer>);
        if (players.length >= limit + 1) break;
      }
    }

    const hasMore = players.length > limit || (!exhausted && scanned >= MAX_SCAN_DOCS);
    const pageItems = players.slice(0, limit);
    const nextCursor = hasMore && pageItems.length > 0 ? pageItems[pageItems.length - 1]!.id : null;

    return NextResponse.json({
      players: pageItems,
      pageSize: limit,
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error("[players/public] GET failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not load player directory." }, { status: 500 });
  }
}
