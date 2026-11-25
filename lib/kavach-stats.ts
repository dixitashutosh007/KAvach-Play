import type { Player, PlayerStat } from "./types.ts";

export interface PlayerStatLeader {
  playerId: string;
  name: string;
  kavachId?: string;
  runs: number;
  wickets: number;
}

export interface KavachStatsSummary {
  year: "overall" | number;
  hasData: boolean;
  totalRuns: number;
  totalWickets: number;
  contributorsCount: number;
  topScorers: PlayerStatLeader[];
  topWicketTakers: PlayerStatLeader[];
}

export function getAvailableStatYears(playerStats: PlayerStat[] = []): number[] {
  const years = new Set<number>();
  for (const s of playerStats) {
    if (typeof s.year === "number" && Number.isFinite(s.year) && s.year > 1900) {
      years.add(s.year);
    }
  }
  return Array.from(years).sort((a, b) => b - a);
}

export function aggregateKavachStats(
  playerStats: PlayerStat[] = [],
  players: Player[] = [],
  yearFilter: "overall" | number = "overall",
): KavachStatsSummary {
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const filtered =
    yearFilter === "overall"
      ? playerStats
      : playerStats.filter((s) => s.year === yearFilter);

  if (filtered.length === 0) {
    return {
      year: yearFilter,
      hasData: false,
      totalRuns: 0,
      totalWickets: 0,
      contributorsCount: 0,
      topScorers: [],
      topWicketTakers: [],
    };
  }

  const totals = new Map<string, PlayerStatLeader>();
  let totalRuns = 0;
  let totalWickets = 0;

  for (const s of filtered) {
    const player = playerMap.get(s.playerId);
    if (player && (player.disabled || player.mergedInto)) continue;
    const runs = typeof s.runs === "number" && Number.isFinite(s.runs) ? s.runs : 0;
    const wickets = typeof s.wickets === "number" && Number.isFinite(s.wickets) ? s.wickets : 0;
    totalRuns += runs;
    totalWickets += wickets;

    const existing = totals.get(s.playerId);
    if (existing) {
      existing.runs += runs;
      existing.wickets += wickets;
    } else {
      totals.set(s.playerId, {
        playerId: s.playerId,
        name: player?.name || "Club Member",
        kavachId: player?.kavachId,
        runs,
        wickets,
      });
    }
  }

  const all = Array.from(totals.values());
  const topScorers = [...all]
    .filter((x) => x.runs > 0)
    .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
    .slice(0, 5);
  const topWicketTakers = [...all]
    .filter((x) => x.wickets > 0)
    .sort((a, b) => b.wickets - a.wickets || a.name.localeCompare(b.name))
    .slice(0, 5);

  return {
    year: yearFilter,
    hasData: all.length > 0,
    totalRuns,
    totalWickets,
    contributorsCount: all.length,
    topScorers,
    topWicketTakers,
  };
}
