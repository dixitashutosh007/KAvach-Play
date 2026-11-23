/**
 * Club leaderboard ranking (shared by LeaderboardTab and the Profile
 * performance card so both always agree).
 *
 * Uses only existing aggregate player fields and badge records. Players who are
 * disabled or still Pending are excluded, and only positive values are ranked.
 */
import type { Player, Badge } from "./types";

export type LeaderboardCategory = "runs" | "wickets" | "stunning" | "dropped" | "badges";

export const LEADERBOARD_FIELDS: Record<LeaderboardCategory, keyof Player | "badgeCount"> = {
  runs: "totalRuns",
  wickets: "totalWickets",
  stunning: "stunningCatches",
  dropped: "droppedCatches",
  badges: "badgeCount",
};

export const LEADERBOARD_MAX_ENTRIES = 30;

export interface LeaderboardEntry {
  player: Player;
  value: number;
}

export function leaderboardEligiblePlayers(players: Player[]): Player[] {
  return players.filter((p) => !p.disabled && p.inviteStatus !== "Pending");
}

export function countBadgesByPlayer(badges: Pick<Badge, "playerId">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const b of badges) counts.set(b.playerId, (counts.get(b.playerId) || 0) + 1);
  return counts;
}

function valueFor(player: Player, category: LeaderboardCategory, badgeCounts: Map<string, number>): number {
  const field = LEADERBOARD_FIELDS[category];
  if (field === "badgeCount") return badgeCounts.get(player.id) || 0;
  const raw = (player as any)[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/** Full ranked list (value > 0, descending). Callers may cap the display length. */
export function rankLeaderboard(
  players: Player[],
  category: LeaderboardCategory,
  badgeCounts: Map<string, number>,
): LeaderboardEntry[] {
  const list = leaderboardEligiblePlayers(players).map((p) => ({ player: p, value: valueFor(p, category, badgeCounts) }));
  list.sort((a, b) => b.value - a.value);
  return list.filter((e) => e.value > 0);
}

/**
 * A player's standing in one category: their value and competition rank
 * (1 + number of players with a strictly higher value). Rank is null when the
 * player has no positive value or is not eligible for the leaderboard.
 */
export function getPlayerLeaderboardStanding(
  players: Player[],
  playerId: string,
  category: LeaderboardCategory,
  badgeCounts: Map<string, number>,
): { value: number; rank: number | null; total: number } {
  const ranked = rankLeaderboard(players, category, badgeCounts);
  const mine = ranked.find((e) => e.player.id === playerId);
  if (!mine) {
    const me = players.find((p) => p.id === playerId);
    return { value: me ? valueFor(me, category, badgeCounts) : 0, rank: null, total: ranked.length };
  }
  const rank = 1 + ranked.filter((e) => e.value > mine.value).length;
  return { value: mine.value, rank, total: ranked.length };
}
