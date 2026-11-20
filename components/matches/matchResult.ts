/**
 * Authoritative match-result presentation mapping (`components/matches/matchResult.ts`).
 *
 * Maps the stored `match.result` value to a display stamp. The outcome is NEVER
 * derived from scores or margins: only the recorded result field is used.
 * Pending, empty or unrecognised values produce no stamp.
 */

export type MatchResultTone = "won" | "lost" | "tied" | "abandoned" | "noResult";

export interface MatchResultDisplay {
  label: string;
  tone: MatchResultTone;
}

export function getMatchResultDisplay(
  result: string | null | undefined,
): MatchResultDisplay | null {
  const raw = typeof result === "string" ? result.trim() : "";
  if (!raw) return null;

  const normalized = raw.toLowerCase();
  switch (normalized) {
    case "kavach won":
      return { label: "WON", tone: "won" };
    case "kavach lost":
      return { label: "LOST", tone: "lost" };
    case "tie":
      return { label: "TIE", tone: "tied" };
    case "draw":
      return { label: "DRAW", tone: "tied" };
    case "abandoned":
      return { label: "ABANDONED", tone: "abandoned" };
    case "no result":
    case "nr":
      return { label: "NO RESULT", tone: "noResult" };
    default:
      // "Pending" and any unknown value: never invent an outcome.
      return null;
  }
}

export const MATCH_RESULT_STAMP_CLASSES: Record<MatchResultTone, string> = {
  won: "bg-emerald-600 text-white border-emerald-700 shadow-xs",
  lost: "bg-rose-600 text-white border-rose-700 shadow-xs",
  tied: "bg-amber-500 text-white border-amber-600 shadow-xs",
  abandoned: "bg-slate-200 text-slate-700 border-slate-300",
  noResult: "bg-slate-100 text-slate-700 border-slate-300",
};
