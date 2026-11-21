/**
 * Club Statistics (`lib/club-stats.ts`). Pure, shared by the server route and UI.
 *
 * Source of truth: admin-maintained exact totals in Firestore `appConfig/clubStats`
 * ({ matchesPlayed, matchesWon, updatedAt, updatedBy }). They are NOT derived from
 * the app's match history, which does not cover the club's full history.
 * Win rate is always calculated, never stored or entered.
 */

export const CLUB_STATS_COLLECTION = "appConfig";
export const CLUB_STATS_DOC_ID = "clubStats";
export const CLUB_STATS_MAX = 100_000;

export interface ClubStatsValues {
  matchesPlayed: number;
  matchesWon: number;
}

export type ClubStatsValidation =
  | { ok: true; value: ClubStatsValues }
  | { ok: false; error: string };

function parseExactCount(raw: unknown, label: string): { ok: true; value: number } | { ok: false; error: string } {
  // Accept numbers or plain digit strings only: no "350+", decimals, signs or exponents.
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return { ok: false, error: `${label} must be a whole number (e.g. 350).` };
    raw = Number(trimmed);
  }
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    return { ok: false, error: `${label} must be a whole number (e.g. 350).` };
  }
  if (raw < 0) return { ok: false, error: `${label} cannot be negative.` };
  if (raw > CLUB_STATS_MAX) return { ok: false, error: `${label} looks too large (max ${CLUB_STATS_MAX}).` };
  return { ok: true, value: raw };
}

export function validateClubStatsInput(input: unknown): ClubStatsValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object." };
  }
  const body = input as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter((k) => k !== "matchesPlayed" && k !== "matchesWon");
  if (unknownKeys.length > 0) return { ok: false, error: `Unknown fields: ${unknownKeys.join(", ")}.` };

  const played = parseExactCount(body.matchesPlayed, "Matches played");
  if (!played.ok) return played;
  const won = parseExactCount(body.matchesWon, "Matches won");
  if (!won.ok) return won;
  if (won.value > played.value) {
    return { ok: false, error: "Matches won cannot be more than matches played." };
  }
  return { ok: true, value: { matchesPlayed: played.value, matchesWon: won.value } };
}

/** Win rate in percent (0–100), or null when no matches have been played. */
export function computeWinRate(matchesPlayed: number, matchesWon: number): number | null {
  if (!Number.isFinite(matchesPlayed) || !Number.isFinite(matchesWon) || matchesPlayed <= 0) return null;
  const won = Math.min(Math.max(0, matchesWon), matchesPlayed);
  return (won / matchesPlayed) * 100;
}

/** Display rounding: nearest whole percent (half rounds up), e.g. 70.29 → "70%". */
export function formatWinRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate)}%`;
}

/** Reads stored values defensively; returns null when absent or invalid. */
export function readStoredClubStats(data: unknown): ClubStatsValues | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const played = d.matchesPlayed;
  const won = d.matchesWon;
  if (!Number.isSafeInteger(played) || !Number.isSafeInteger(won)) return null;
  if ((played as number) < 0 || (won as number) < 0 || (won as number) > (played as number)) return null;
  return { matchesPlayed: played as number, matchesWon: won as number };
}
