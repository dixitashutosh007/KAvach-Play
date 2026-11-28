import type { Player, PlayerStat } from "./types.ts";

export interface PlayerStatInput {
  playerId: unknown;
  year: unknown;
  runs: unknown;
  wickets: unknown;
}

export interface ValidatedPlayerStat {
  playerId: string;
  year: number;
  runs: number;
  wickets: number;
}

function parseStrictWholeNumber(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

export function validatePlayerStatInput(
  input: PlayerStatInput,
  currentYear: number = new Date().getFullYear(),
): { ok: true; value: ValidatedPlayerStat } | { ok: false; error: string } {
  if (typeof input.playerId !== "string" || !input.playerId.trim() || input.playerId.includes("/")) {
    return { ok: false, error: "Select a valid player." };
  }

  const year = parseStrictWholeNumber(input.year);
  if (year === null || year < 1990 || year > currentYear + 1) {
    return { ok: false, error: `Year must be a whole number between 1990 and ${currentYear + 1}.` };
  }

  const runs = parseStrictWholeNumber(input.runs);
  if (runs === null || runs < 0 || runs > 100000) {
    return { ok: false, error: "Runs must be a non-negative whole number." };
  }

  const wickets = parseStrictWholeNumber(input.wickets);
  if (wickets === null || wickets < 0 || wickets > 10000) {
    return { ok: false, error: "Wickets must be a non-negative whole number." };
  }

  return {
    ok: true,
    value: {
      playerId: input.playerId.trim(),
      year,
      runs,
      wickets,
    },
  };
}

export function isEligibleForNewStats(player: Player | null | undefined): boolean {
  return Boolean(player && !player.disabled && !player.mergedInto);
}

export interface DuplicateStatGroup {
  key: string;
  playerId: string;
  year: number;
  records: PlayerStat[];
}

export function findDuplicatePlayerStats(playerStats: PlayerStat[] = []): DuplicateStatGroup[] {
  const groups = new Map<string, PlayerStat[]>();
  for (const s of playerStats) {
    const key = `${s.playerId}_${s.year}`;
    const arr = groups.get(key) || [];
    arr.push(s);
    groups.set(key, arr);
  }
  const duplicates: DuplicateStatGroup[] = [];
  for (const [key, records] of groups.entries()) {
    if (records.length > 1) {
      duplicates.push({
        key,
        playerId: records[0].playerId,
        year: records[0].year,
        records,
      });
    }
  }
  return duplicates;
}

export function deterministicPlayerStatId(playerId: string, year: number): string {
  return `${playerId}_${year}`;
}
