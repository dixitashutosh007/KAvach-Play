/**
 * Match card presentation helpers (`lib/match-card-format.ts`). Pure, no Firebase.
 *
 * - Format badge from the stored `match.format` (never defaulted or inferred).
 * - Category ribbon from the stored `match.matchType` (never inferred from
 *   format or tournament linkage).
 * - Card date label "SAT · 21 NOV" using the existing date parser (no timezone
 *   or storage change).
 */
import { parseMatchDateTime } from "./personal-match-payment";

export type FormatTone = "t20" | "t30" | "other";

export interface FormatBadge {
  label: string;
  tone: FormatTone;
}

/** T20 → blue, T30 → scarlet, any other non-empty value → neutral with its own label. */
export function getMatchFormatBadge(format: string | null | undefined): FormatBadge | null {
  const raw = typeof format === "string" ? format.trim() : "";
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "T20") return { label: "T20", tone: "t20" };
  if (upper === "T30") return { label: "T30", tone: "t30" };
  return { label: raw, tone: "other" };
}

export type MatchCategory = "Tournament" | "Practice";

/** Only the exact stored categories produce a ribbon; anything else → none. */
export function getMatchCategory(matchType: string | null | undefined): MatchCategory | null {
  if (matchType === "Tournament") return "Tournament";
  if (matchType === "Practice") return "Practice";
  return null;
}

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * "SAT · 21 NOV". The year is appended only when the match falls in a different
 * calendar year from `reference` (e.g. historical cards), never for this season.
 */
export function formatMatchCardDate(dateStr: string | null | undefined, reference: Date = new Date()): string {
  if (!dateStr) return "Date TBD";
  const d = parseMatchDateTime(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const base = `${DAYS[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === reference.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}
