/**
 * Standard per-player match fee (`lib/match-fee.ts`). Pure.
 *
 * Encodes the EXISTING KAvach rule that the Add/Edit Match form (and the
 * tournament form) already applied inline:
 *
 *   per-player fee = round( groundFeePerMatch / 12 × (1 + margin%) )
 *
 * with a default margin of 5% (the former hard-coded 1.05). Nothing new is
 * introduced except that the margin can now be adjusted from the form.
 *
 * Fee sources (unchanged):
 *  - Practice:   ground.practiceFee
 *  - Tournament: ground.tournamentFee, or — when the match is linked to a
 *                tournament — tournament.amountPerMatch. A tournament may also
 *                carry its own per-player override (tournament.perPlayerFee),
 *                which the form keeps applying when that tournament is chosen.
 *
 * The divisor is the club's fixed 12-player basis (not the squad size), as
 * before. The stored match.fee remains the single authoritative value; the
 * margin is a form control only (no new stored field).
 */
import type { Ground, Match, Tournament } from "@/lib/types";
import { groundFeeForMatchType } from "@/lib/match-category";

export const MATCH_FEE_PLAYER_BASIS = 12;
export const DEFAULT_MARGIN_PCT = 5;
export const MIN_MARGIN_PCT = 0;
export const MAX_MARGIN_PCT = 50;

export function clampMargin(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MARGIN_PCT;
  return Math.min(MAX_MARGIN_PCT, Math.max(MIN_MARGIN_PCT, Math.round(n)));
}

export interface MatchFeeBreakdown {
  /** Where the per-match ground fee came from. */
  source: "practice" | "tournament-ground" | "tournament" | "none";
  groundFeePerMatch: number;
  perPlayerBase: number;
  marginPct: number;
  marginAmount: number;
  /** round(perPlayerBase × (1 + margin)) — the standard per-player fee. */
  feePerPlayer: number;
}

/** Per-match ground fee for the form's current ground / type / tournament. */
export function resolveGroundFee(
  ground: Pick<Ground, "practiceFee" | "tournamentFee"> | null | undefined,
  matchType: Match["matchType"] | string | null | undefined,
  tournament?: Pick<Tournament, "amountPerMatch"> | null,
): { amount: number; source: MatchFeeBreakdown["source"] } {
  if (matchType === "Tournament" && tournament && Number(tournament.amountPerMatch) > 0) {
    return { amount: Number(tournament.amountPerMatch), source: "tournament" };
  }
  const amount = groundFeeForMatchType(ground, matchType);
  if (amount <= 0) return { amount: 0, source: "none" };
  return { amount, source: matchType === "Tournament" ? "tournament-ground" : "practice" };
}

export function computeMatchFee(groundFeePerMatch: number, marginPct: number = DEFAULT_MARGIN_PCT): MatchFeeBreakdown {
  const margin = clampMargin(marginPct);
  const base = Math.max(0, Number(groundFeePerMatch) || 0) / MATCH_FEE_PLAYER_BASIS;
  const fee = Math.round(base * (1 + margin / 100));
  return {
    source: groundFeePerMatch > 0 ? "practice" : "none",
    groundFeePerMatch: Math.max(0, Number(groundFeePerMatch) || 0),
    perPlayerBase: Math.round(base),
    marginPct: margin,
    marginAmount: fee - Math.round(base),
    feePerPlayer: fee,
  };
}
