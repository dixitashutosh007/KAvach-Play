import type { MatchPayment, Player } from "./types";

export type AvailabilityCategory =
  | "confirmed"
  | "tentative"
  | "not_playing"
  | "unresponded";

export interface MatchAvailabilityReadiness {
  confirmedCount: number;
  tentativeCount: number;
  notPlayingCount: number;
  unrespondedCount: number;
  eligibleCount: number;
  squadCount: number;
}

/**
 * Classifies a MatchPayment.availability value into one of four mutually
 * exclusive readiness categories without inventing new stored values.
 *
 * Established data-model mapping (matches lib/personal-match-payment.ts):
 * - "Yes", "Confirmed", "Waitlist" -> "confirmed" (explicit positive / waitlist response)
 * - "Tentative"                    -> "tentative"
 * - "No"                           -> "not_playing"
 * - "Pending", undefined, missing  -> "unresponded"
 */
export function classifyMatchAvailability(
  availability: MatchPayment["availability"] | string | undefined | null,
): AvailabilityCategory {
  if (
    availability === "Yes" ||
    availability === "Confirmed" ||
    availability === "Waitlist"
  ) {
    return "confirmed";
  }
  if (availability === "Tentative") {
    return "tentative";
  }
  if (availability === "No") {
    return "not_playing";
  }
  return "unresponded";
}

/**
 * Returns whether an availability value represents an explicit player/recorded
 * response (as opposed to Pending / unanswered).
 */
export function hasExplicitAvailabilityResponse(
  availability: MatchPayment["availability"] | string | undefined | null,
): boolean {
  return classifyMatchAvailability(availability) !== "unresponded";
}

function toEpochMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof ts === "object" && typeof ts.seconds === "number") {
    return ts.seconds * 1000 + (typeof ts.nanoseconds === "number" ? Math.floor(ts.nanoseconds / 1e6) : 0);
  }
  return 0;
}

/**
 * Deterministically selects the canonical availability record for a player in a
 * match, independent of Firestore document ordering.
 *
 * Rules:
 * 1. Excludes guest records (`guestName` set) so guest entries never overwrite or
 *    represent the host player's own availability.
 * 2. Prefers records with an explicit availability response over Pending/unset.
 * 3. Prefers active squad records (`status !== "Not Playing"`) over `"Not Playing"`.
 * 4. Tie-breaks deterministically by latest `updatedAt`, then by `id` ascending.
 */
export function resolveCanonicalPlayerPaymentRecord<
  T extends Pick<MatchPayment, "id" | "playerId" | "status" | "availability"> & {
    guestName?: string;
    updatedAt?: any;
  },
>(playerId: string, matchPayments: readonly T[]): T | null {
  const primaryRecords = matchPayments.filter(
    (p) => p.playerId === playerId && !p.guestName,
  );
  if (primaryRecords.length === 0) return null;
  if (primaryRecords.length === 1) return primaryRecords[0];

  const sorted = [...primaryRecords].sort((a, b) => {
    const aExplicit = hasExplicitAvailabilityResponse(a.availability) ? 1 : 0;
    const bExplicit = hasExplicitAvailabilityResponse(b.availability) ? 1 : 0;
    if (aExplicit !== bExplicit) return bExplicit - aExplicit;

    const aActive = a.status !== "Not Playing" ? 1 : 0;
    const bActive = b.status !== "Not Playing" ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;

    const aTime = toEpochMs(a.updatedAt);
    const bTime = toEpochMs(b.updatedAt);
    if (aTime !== bTime) return bTime - aTime;

    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  return sorted[0];
}

/**
 * Computes mutually exclusive readiness counts across the eligible active
 * player population, kept strictly independent from squad membership.
 */
export function computeMatchAvailabilityReadiness(
  players: readonly Pick<Player, "id" | "disabled" | "inviteStatus">[],
  matchPayments: readonly (Pick<MatchPayment, "id" | "playerId" | "status" | "availability"> & {
    guestName?: string;
    updatedAt?: any;
  })[],
): MatchAvailabilityReadiness {
  const activeMembers = players.filter(
    (p) => !p.disabled && p.inviteStatus !== "Rejected" && p.inviteStatus !== "Pending",
  );

  let confirmedCount = 0;
  let tentativeCount = 0;
  let notPlayingCount = 0;
  let unrespondedCount = 0;

  for (const member of activeMembers) {
    const canonical = resolveCanonicalPlayerPaymentRecord(member.id, matchPayments);
    const category = classifyMatchAvailability(canonical?.availability);
    if (category === "confirmed") confirmedCount++;
    else if (category === "tentative") tentativeCount++;
    else if (category === "not_playing") notPlayingCount++;
    else unrespondedCount++;
  }

  const squadCount = matchPayments.filter((p) => p.status !== "Not Playing").length;

  return {
    confirmedCount,
    tentativeCount,
    notPlayingCount,
    unrespondedCount,
    eligibleCount: activeMembers.length,
    squadCount,
  };
}
