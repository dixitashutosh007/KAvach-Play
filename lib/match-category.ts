/**
 * Match categories (`lib/match-category.ts`). Pure, no Firebase.
 *
 * `match.matchType` is a stored category, independent of `match.format`:
 *  - "Tournament" — part of a tournament; uses the ground's tournament fee.
 *  - "Practice"   — practice session; uses the ground's practice fee.
 * (A third "Club Match" category was added and then removed at the owner's
 *  request on 2026-11-21; the club has no such category.)
 */
import type { Ground, Match } from "./types";

export const MATCH_TYPES: Match["matchType"][] = ["Practice", "Tournament"];

/** Ground fee that auto-fills the per-player fee for a category. */
export function groundFeeForMatchType(
  ground: Pick<Ground, "practiceFee" | "tournamentFee"> | null | undefined,
  matchType: string | null | undefined,
): number {
  if (!ground) return 0;
  return matchType === "Tournament" ? ground.tournamentFee || 0 : ground.practiceFee || 0;
}
