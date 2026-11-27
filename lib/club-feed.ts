/**
 * Player Club feed helpers (D-20). Pure — no Firebase or DOM — so the Club
 * previews, full lists and tests share one implementation.
 */

export const CLUB_RECENT_DAYS = 30;
export const CLUB_ANNOUNCEMENT_PREVIEW = 2;
export const CLUB_PULSE_PREVIEW = 2;
export const DIRECTORY_PAGE_SIZE = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the "recent" window (default: 30 days before `now`). */
export function recentWindowStart(now: number = Date.now(), days: number = CLUB_RECENT_DAYS): Date {
  return new Date(now - days * DAY_MS);
}

/** Milliseconds for a Firestore Timestamp, `{ seconds }`, Date, ISO string or number; null if unknown. */
export function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "object") {
    const v = value as { toMillis?: () => number; seconds?: number };
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  return null;
}

/** Items created within the recent window, newest first. */
export function withinRecentWindow<T extends { createdAt?: unknown }>(
  items: readonly T[],
  now: number = Date.now(),
  days: number = CLUB_RECENT_DAYS,
): T[] {
  const start = recentWindowStart(now, days).getTime();
  return items
    .filter((i) => {
      const t = toMillis(i.createdAt);
      return t !== null && t >= start;
    })
    .sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0));
}

export interface PollLike {
  id: string;
  isActive?: boolean;
  isSticked?: boolean;
  createdAt?: unknown;
}

/**
 * Polls for the Club Pulse preview: active polls first (pinned first), then
 * recently created closed polls, de-duplicated, newest first within each group.
 */
export function orderPulsePolls<T extends PollLike>(polls: readonly T[], now: number = Date.now()): T[] {
  const start = recentWindowStart(now).getTime();
  const seen = new Set<string>();
  const unique = polls.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const newest = (a: T, b: T) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0);
  const active = unique.filter((p) => p.isActive).sort((a, b) => Number(!!b.isSticked) - Number(!!a.isSticked) || newest(a, b));
  const recentClosed = unique
    .filter((p) => !p.isActive && (toMillis(p.createdAt) ?? 0) >= start)
    .sort(newest);
  return [...active, ...recentClosed];
}

/** Public, non-private player fields that other players may see (R2-B). */
export const PUBLIC_PLAYER_FIELDS = [
  "id",
  "name",
  "photoURL",
  "kavachId",
  "jerseyName",
  "jerseyNumber",
  "battingStyle",
  "bowlingStyle",
  "isWicketKeeper",
  "kavachJoining",
  "stunningCatches",
  "droppedCatches",
  "totalRuns",
  "totalWickets",
] as const;

export type PublicPlayerField = (typeof PUBLIC_PLAYER_FIELDS)[number];
export type PublicPlayer = Partial<Record<PublicPlayerField, unknown>> & { id: string; name: string };

/**
 * Strip a player record down to the public fields before it is rendered to
 * another player. Private fields (mobile, email, dob, bloodGroup,
 * emergencyContact, locality, sizes, payment data) never reach the view.
 */
export function toPublicPlayer(player: Record<string, unknown> & { id: string; name?: string }): PublicPlayer {
  const out: Record<string, unknown> = {};
  for (const f of PUBLIC_PLAYER_FIELDS) if (player[f] !== undefined) out[f] = player[f];
  out.id = player.id;
  out.name = typeof player.name === "string" && player.name ? player.name : "Player";
  return out as PublicPlayer;
}

/** Directory listing: active, non-pending players matching `search`, sorted by name. */
export function filterDirectory<T extends { id: string; name?: string; disabled?: boolean; inviteStatus?: string; jerseyName?: string; kavachId?: string }>(
  players: readonly T[],
  search: string,
): T[] {
  const q = search.trim().toLowerCase();
  return players
    .filter((p) => !p.disabled && p.inviteStatus !== "Pending" && p.inviteStatus !== "Rejected")
    .filter((p) => {
      if (!q) return true;
      return [p.name, p.jerseyName, p.kavachId].some((v) => typeof v === "string" && v.toLowerCase().includes(q));
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/**
 * Resolve a single player by ID for public directory profile display.
 * Excludes disabled, merged, pending, and rejected records and strips PII via toPublicPlayer().
 */
export function resolvePublicDirectoryPlayer(
  players: readonly (Record<string, unknown> & { id: string; name?: string; disabled?: boolean; mergedInto?: string; inviteStatus?: string })[],
  targetId: string | null | undefined,
): PublicPlayer | null {
  if (!targetId) return null;
  const p = players.find((x) => x.id === targetId);
  if (!p || p.disabled || p.mergedInto || p.inviteStatus === "Pending" || p.inviteStatus === "Rejected") {
    return null;
  }
  return toPublicPlayer(p);
}

/**
 * Pure pagination state decision for opening a target announcement ID across paginated results.
 */
export function nextAnnouncementPageAction({
  pendingOpen,
  items,
  done,
  loading,
  error,
}: {
  pendingOpen: string | null;
  items: readonly { id: string }[];
  done: boolean;
  loading: boolean;
  error: string | null;
}): "idle" | "open" | "load_more" | "wait" | "not_found" {
  if (!pendingOpen) return "idle";
  if (items.some((p) => p.id === pendingOpen)) return "open";
  if (error || done) return "not_found";
  if (loading) return "wait";
  return "load_more";
}

const PUBLIC_PLAYERS_RATE_WINDOW_MS = 60_000;
const PUBLIC_PLAYERS_RATE_MAX = 60;
const publicPlayersRateBuckets = new Map<string, number[]>();

export function _resetPublicPlayersRateLimitForTesting() {
  publicPlayersRateBuckets.clear();
}

export function checkPublicPlayersRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - PUBLIC_PLAYERS_RATE_WINDOW_MS;
  const timestamps = (publicPlayersRateBuckets.get(key) || []).filter((t) => t > cutoff);
  if (timestamps.length >= PUBLIC_PLAYERS_RATE_MAX) {
    const oldest = timestamps[0]!;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + PUBLIC_PLAYERS_RATE_WINDOW_MS - now) / 1000));
    publicPlayersRateBuckets.set(key, timestamps);
    return { allowed: false, retryAfterSec };
  }
  timestamps.push(now);
  publicPlayersRateBuckets.set(key, timestamps);
  return { allowed: true, retryAfterSec: 0 };
}
