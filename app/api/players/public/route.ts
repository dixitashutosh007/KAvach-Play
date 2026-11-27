import { NextResponse } from "next/server.js";
import { requireAuth } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { checkPublicPlayersRateLimit, toPublicPlayer } from "../../../../lib/club-feed.ts";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 200;
const MAX_SEARCH_LENGTH = 80;
const ALLOWED_SORTS = new Set(["name_asc", "name_desc", "runs_desc", "wickets_desc", "catches_desc"]);

/**
 * GET /api/players/public
 *
 * DEF-R3-003 & P2-API-01: Returns strictly non-PII public player projections (`toPublicPlayer()`)
 * for authenticated users with validated search, sort, bounded pagination, and rate limiting.
 */
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const rate = checkPublicPlayersRateLimit(auth.uid);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many directory requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const url = new URL(req.url);
  const rawPage = url.searchParams.get("page");
  const rawLimit = url.searchParams.get("limit");
  const rawSearch = url.searchParams.get("search") ?? "";
  const rawSort = url.searchParams.get("sort") ?? "name_asc";

  let page = 1;
  if (rawPage !== null) {
    if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1) {
      return NextResponse.json({ error: "Invalid page parameter." }, { status: 400 });
    }
    page = Number(rawPage);
  }

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
    const snap = await db.collection("players").get();
    const q = search.toLowerCase();

    const filtered = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }) as Record<string, any> & { id: string })
      .filter((p) => {
        if (p.disabled === true || p.mergedInto) return false;
        if (p.inviteStatus === "Pending" || p.inviteStatus === "Rejected") return false;
        const nameLower = String(p.name || "").toLowerCase();
        const emailLower = String(p.email || "").toLowerCase();
        if (nameLower.includes("demo") || emailLower.includes("demo")) return false;
        if (!q) return true;
        return [p.name, p.jerseyName, p.kavachId].some(
          (v) => typeof v === "string" && v.toLowerCase().includes(q),
        );
      })
      .map((p) => ({
        ...toPublicPlayer(p),
        inviteStatus: p.inviteStatus || "Accepted",
      }));

    filtered.sort((a, b) => {
      if (rawSort === "name_desc") return (b.name || "").localeCompare(a.name || "");
      if (rawSort === "runs_desc") return (Number(b.totalRuns) || 0) - (Number(a.totalRuns) || 0);
      if (rawSort === "wickets_desc") return (Number(b.totalWickets) || 0) - (Number(a.totalWickets) || 0);
      if (rawSort === "catches_desc") return (Number(b.stunningCatches) || 0) - (Number(a.stunningCatches) || 0);
      return (a.name || "").localeCompare(b.name || "");
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const players = filtered.slice(offset, offset + limit);
    const hasMore = offset + players.length < total;

    return NextResponse.json({
      players,
      total,
      page,
      pageSize: limit,
      totalPages,
      hasMore,
    });
  } catch (err) {
    console.error("[players/public] GET failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not load player directory." }, { status: 500 });
  }
}
