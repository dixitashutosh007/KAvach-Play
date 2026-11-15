import type { Match } from "./types";

export function isMatchBillable(match: Match): boolean {
  return match.result !== "Abandoned" && (match.fee > 0 || (match.matchFeeBudget ?? 0) > 0);
}
