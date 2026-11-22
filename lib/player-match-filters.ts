/**
 * Player Match Centre — regular-listing filter (`lib/player-match-filters.ts`). Pure.
 *
 * Exactly three options: All / Upcoming / Past. "Past" is every accessible
 * completed or past match (the former Recent and Previous groups from
 * groupPlayerMatches), de-duplicated and newest first.
 */
import type { Match } from "@/lib/types";
import { parseMatchDateTime } from "@/lib/personal-match-payment";

export type MatchListFilter = "all" | "upcoming" | "past";

export const MATCH_FILTER_OPTIONS: { value: MatchListFilter; label: string }[] = [
  { value: "all", label: "All Matches" },
  { value: "upcoming", label: "Upcoming Matches" },
  { value: "past", label: "Past Matches" },
];

export const MATCH_FILTER_LABEL: Record<MatchListFilter, string> = {
  all: "All Matches",
  upcoming: "Upcoming Matches",
  past: "Past Matches",
};

export const PAST_PAGE_SIZE = 10;

/** Recent + Previous groups → one de-duplicated past list, newest first. */
export function mergePastMatches(recent: Match[], previous: Match[]): Match[] {
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const m of [...recent, ...previous]) {
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.sort(
    (a, b) => parseMatchDateTime(b.date, b.time).getTime() - parseMatchDateTime(a.date, a.time).getTime(),
  );
}
