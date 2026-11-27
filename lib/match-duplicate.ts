/**
 * Duplicate Match Detection (`lib/match-duplicate.ts`)
 *
 * Compares core scheduling/identity attributes of a candidate match against
 * existing club matches (and any in-progress partial match) using normalized
 * values. Match fee is explicitly excluded from duplicate identity.
 */

export interface DuplicateMatchCandidate {
  date?: string | null;
  time?: string | null;
  groundId?: string | null;
  opponent?: string | null;
  format?: string | null;
  matchType?: string | null;
  tournamentId?: string | null;
}

export interface ExistingMatchForDuplicateCheck extends DuplicateMatchCandidate {
  id: string;
  fee?: number | null;
  isArchived?: boolean | null;
  result?: string | null;
}

/** Normalize DD/MM/YYYY or YYYY-MM-DD into YYYY-MM-DD when possible. */
export function normalizeMatchDateForDuplicate(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return s.toLowerCase();
}

/** Normalize HH:MM (e.g. "7:00" -> "07:00"). */
export function normalizeMatchTimeForDuplicate(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hm = /^(\d{1,2}):(\d{2})/.exec(s);
  if (hm) {
    return `${hm[1].padStart(2, "0")}:${hm[2]}`;
  }
  return s.toLowerCase();
}

function normalizeText(raw: string | null | undefined, fallback = ""): string {
  return String(raw || "").trim().replace(/\s+/g, " ").toLowerCase() || fallback;
}

export function buildMatchDuplicateKey(m: DuplicateMatchCandidate): string {
  const matchType = normalizeText(m.matchType);
  const tournament = matchType === "tournament" ? normalizeText(m.tournamentId) : "";
  return [
    normalizeMatchDateForDuplicate(m.date),
    normalizeMatchTimeForDuplicate(m.time),
    normalizeText(m.groundId),
    normalizeText(m.opponent, "tbd"),
    normalizeText(m.format),
    matchType,
    tournament,
  ].join("|");
}

/**
 * Returns all non-archived existing matches that match the candidate's core
 * attributes (excluding match fee), optionally excluding an `excludeMatchId`
 * (when editing or recovering a partially created match).
 */
export function findDuplicateMatches<T extends ExistingMatchForDuplicateCheck>(
  candidate: DuplicateMatchCandidate,
  existingMatches: readonly T[],
  excludeMatchId?: string | null,
): T[] {
  const targetKey = buildMatchDuplicateKey(candidate);
  if (!normalizeMatchDateForDuplicate(candidate.date) || !normalizeText(candidate.groundId)) {
    return [];
  }
  return existingMatches.filter((m) => {
    if (!m || m.isArchived) return false;
    if (excludeMatchId && m.id === excludeMatchId) return false;
    return buildMatchDuplicateKey(m) === targetKey;
  });
}
