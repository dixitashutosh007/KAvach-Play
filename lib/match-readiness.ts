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

/**
 * Computes mutually exclusive readiness counts across the eligible active
 * player population, kept strictly independent from squad membership.
 */
export function computeMatchAvailabilityReadiness(
  players: readonly Pick<Player, "id" | "disabled" | "inviteStatus">[],
  matchPayments: readonly Pick<MatchPayment, "playerId" | "status" | "availability">[],
): MatchAvailabilityReadiness {
  const activeMembers = players.filter(
    (p) => !p.disabled && p.inviteStatus !== "Rejected" && p.inviteStatus !== "Pending",
  );

  // If a player has multiple payment records (e.g. host + guest), prefer the
  // primary non-Not-Playing record or the first record with an explicit response.
  const availabilityByPlayer = new Map<string, MatchPayment["availability"]>();
  for (const pay of matchPayments) {
    const existing = availabilityByPlayer.get(pay.playerId);
    if (!existing || (!hasExplicitAvailabilityResponse(existing) && hasExplicitAvailabilityResponse(pay.availability))) {
      availabilityByPlayer.set(pay.playerId, pay.availability);
    }
  }

  let confirmedCount = 0;
  let tentativeCount = 0;
  let notPlayingCount = 0;
  let unrespondedCount = 0;

  for (const member of activeMembers) {
    const category = classifyMatchAvailability(availabilityByPlayer.get(member.id));
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
