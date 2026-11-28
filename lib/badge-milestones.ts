import type { Player } from "./types.ts";

export interface MilestoneDef {
  key: string;
  threshold: number;
  label: string;
}

export const TENURE_MILESTONES: readonly MilestoneDef[] = [
  { key: "year_1", threshold: 1, label: "1 Year" },
  { key: "year_2", threshold: 2, label: "2 Years" },
  { key: "year_3", threshold: 3, label: "3 Years" },
  { key: "year_4", threshold: 4, label: "4 Years" },
  { key: "year_5", threshold: 5, label: "5 Years" },
];

export const RUNS_MILESTONES: readonly MilestoneDef[] = [
  { key: "runs_1k", threshold: 1000, label: "1,000 Runs" },
  { key: "runs_2k", threshold: 2000, label: "2,000 Runs" },
  { key: "runs_5k", threshold: 5000, label: "5,000 Runs" },
  { key: "runs_10k", threshold: 10000, label: "10,000 Runs" },
];

export const WICKETS_MILESTONES: readonly MilestoneDef[] = [
  { key: "wickets_100", threshold: 100, label: "100 Wickets" },
  { key: "wickets_200", threshold: 200, label: "200 Wickets" },
  { key: "wickets_300", threshold: 300, label: "300 Wickets" },
  { key: "wickets_500", threshold: 500, label: "500 Wickets" },
];

/**
 * Parse "MM/YYYY" joining string and return complete years since joining.
 * Returns null if missing or invalid so callers can distinguish unknown from 0.
 */
export function parseTenureYears(joiningStr?: string | null, now: Date = new Date()): number | null {
  if (typeof joiningStr !== "string" || !joiningStr.trim()) return null;
  const parts = joiningStr.trim().split("/");
  if (parts.length !== 2) return null;
  const month = Number.parseInt(parts[0], 10);
  const year = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(month) || !Number.isFinite(year) || month < 1 || month > 12 || year < 1900) {
    return null;
  }
  let years = now.getFullYear() - year;
  if (now.getMonth() + 1 < month) {
    years -= 1;
  }
  return Math.max(0, years);
}

export function computeTenureYears(joiningStr?: string | null, now: Date = new Date()): number {
  return parseTenureYears(joiningStr, now) ?? 0;
}

/**
 * Cumulative milestone policy:
 * - Players retain all lower milestones when achieving higher ones.
 * - Multiple newly qualified milestones can be granted in one evaluation.
 * - Historical awards are never silently revoked if stats or joining dates are corrected downward;
 *   corrections only prevent future unearned milestones from being granted.
 */
export function evaluateCumulativeMilestones(
  value: number,
  milestones: readonly MilestoneDef[],
  existingBadgeTypes: ReadonlySet<string>,
): { qualified: string[]; missing: string[] } {
  const safeVal = Number.isFinite(value) ? Math.max(0, value) : 0;
  const qualified: string[] = [];
  const missing: string[] = [];

  for (const m of milestones) {
    if (safeVal >= m.threshold) {
      qualified.push(m.key);
      if (!existingBadgeTypes.has(m.key)) {
        missing.push(m.key);
      }
    }
  }

  return { qualified, missing };
}

export interface MilestoneProgress {
  current: number;
  target: number;
  percent: number;
  unit: string;
}

/**
 * Compute reliable progress toward a milestone badge ONLY when the underlying
 * player statistic or joining date is present and valid. Returns null otherwise.
 */
export function computeMilestoneProgress(
  badgeType: string,
  player?: Pick<Player, "kavachJoining" | "totalRuns" | "totalWickets"> | null,
  now: Date = new Date(),
): MilestoneProgress | null {
  if (!player) return null;

  const tenure = TENURE_MILESTONES.find((m) => m.key === badgeType);
  if (tenure) {
    const years = parseTenureYears(player.kavachJoining, now);
    if (years === null) return null;
    return {
      current: Math.min(years, tenure.threshold),
      target: tenure.threshold,
      percent: Math.min(100, Math.round((years / tenure.threshold) * 100)),
      unit: "yrs",
    };
  }

  const runs = RUNS_MILESTONES.find((m) => m.key === badgeType);
  if (runs) {
    if (typeof player.totalRuns !== "number" || !Number.isFinite(player.totalRuns)) return null;
    const val = Math.max(0, player.totalRuns);
    return {
      current: Math.min(val, runs.threshold),
      target: runs.threshold,
      percent: Math.min(100, Math.round((val / runs.threshold) * 100)),
      unit: "runs",
    };
  }

  const wickets = WICKETS_MILESTONES.find((m) => m.key === badgeType);
  if (wickets) {
    if (typeof player.totalWickets !== "number" || !Number.isFinite(player.totalWickets)) return null;
    const val = Math.max(0, player.totalWickets);
    return {
      current: Math.min(val, wickets.threshold),
      target: wickets.threshold,
      percent: Math.min(100, Math.round((val / wickets.threshold) * 100)),
      unit: "wkts",
    };
  }

  return null;
}
