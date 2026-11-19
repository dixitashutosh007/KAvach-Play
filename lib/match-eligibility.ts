import type { Match, MatchPayment, Player } from "./types";

/**
 * Checks whether a match has an officially assigned squad based on the
 * real persisted MatchPayment records in Firestore.
 *
 * In KAvach Play:
 * - When an admin assigns players to a match squad (via MatchesTab or AssignFeesAdmin),
 *   those players are assigned status !== "Not Playing" (e.g. "Unpaid", "Paid", "Waived")
 *   and/or availability === "Confirmed" / "Waitlist".
 * - Open fixtures before squad assignment either have no payment docs, or have
 *   unassigned active player docs initialized with status === "Not Playing" and
 *   availability === "Pending" (or player availability RSVPs "Yes"/"Tentative"/"No"
 *   with status === "Not Playing").
 */
export function isSquadAssignedToMatch(
  matchId: string,
  payments: MatchPayment[] = []
): boolean {
  return payments.some(
    (p) =>
      p.matchId === matchId &&
      !p.guestName &&
      (p.availability === "Confirmed" ||
        p.availability === "Waitlist" ||
        (p.status !== "Not Playing" &&
          p.availability !== "Yes" &&
          p.availability !== "Tentative" &&
          p.availability !== "No"))
  );
}

/**
 * Checks whether a specific player is a confirmed or assigned member of a match squad
 * based on their MatchPayment record.
 */
export function isPlayerInAssignedSquad(
  playerId: string,
  matchId: string,
  payments: MatchPayment[] = []
): boolean {
  const payment = payments.find(
    (p) => p.matchId === matchId && p.playerId === playerId
  );
  if (!payment) return false;

  return (
    payment.availability === "Confirmed" ||
    payment.availability === "Waitlist" ||
    payment.availability === "Tentative" ||
    payment.availability === "Yes" ||
    payment.availability === "No" ||
    payment.status === "Paid" ||
    payment.status === "Unpaid" ||
    payment.status === "Waived"
  );
}

/**
 * Authoritative Player-Match Eligibility & Visibility Validator.
 *
 * Rules:
 * 1. Admins (Club Admin, Match Admin, Super Admin) have legitimate administrative
 *    authority to view and manage all active (non-archived) fixtures.
 * 2. Unlinked users (null player) cannot view personal player fixtures or submit RSVPs.
 * 3. Inactive, disabled, merged, or unverified (Rejected/Pending) players cannot
 *    participate in matches or submit RSVPs.
 * 4. Archived matches (isArchived) and Tentatively blocked fixtures (isTentative) are
 *    strictly ineligible for regular player display and RSVP.
 * 5. If a squad has been assigned to the match:
 *    - Only confirmed/assigned squad members (isPlayerInAssignedSquad) are eligible.
 *    - Players outside the assigned squad are strictly ineligible and excluded.
 * 6. If no squad has been assigned yet (genuinely open upcoming club fixture):
 *    - All active, verified club players are eligible to view the fixture and submit RSVPs.
 */
export function isPlayerEligibleForMatch(
  player: Player | null | undefined,
  match: Match | null | undefined,
  payments: MatchPayment[] = [],
  isAdmin: boolean = false
): boolean {
  if (!match) return false;

  // 1. Admin access: Admins see all non-archived matches (including tentative & all squads)
  if (isAdmin) {
    return !match.isArchived;
  }

  // 2. Unlinked user cannot participate in player matches
  if (!player) return false;

  // 3. Player must be active and not disabled/merged/pending/rejected
  if (
    player.disabled ||
    player.mergedInto ||
    player.mergeStatus === "in_progress" ||
    player.inviteStatus === "Rejected" ||
    player.inviteStatus === "Pending"
  ) {
    return false;
  }

  // 4. Ineligible match states for regular players: archived or tentative/blocked
  if (match.isArchived || match.isTentative) {
    return false;
  }

  // 5. Existing legitimate participation / squad record grants immediate eligibility
  if (isPlayerInAssignedSquad(player.id, match.id, payments)) {
    return true;
  }

  // 6. Check if the match has an officially assigned squad
  const hasSquad = isSquadAssignedToMatch(match.id, payments);
  if (hasSquad) {
    // A squad has been assigned, but this player is not in it -> Denied
    return false;
  }

  // 7. Genuinely open fixture with no assigned squad:
  // Active, verified club players are eligible to view and submit RSVPs
  return true;
}

export interface MatchNavigationResult {
  allowed: boolean;
  error?: "MATCH_NOT_FOUND" | "INELIGIBLE";
  message?: string;
}

/**
 * Authoritative Pre-flight Match Navigation Guard.
 *
 * Validates that:
 * 1. The target match exists in the current matches collection.
 * 2. The player is authoritatively eligible to view/access the target match.
 * 3. Admins retain legitimate administrative access to view all active fixtures.
 */
export function validateMatchNavigation(
  matchId: string,
  matches: Match[] = [],
  player: Player | null | undefined,
  payments: MatchPayment[] = [],
  isAdmin: boolean = false
): MatchNavigationResult {
  if (!matchId) {
    return { allowed: true };
  }
  const targetMatch = matches.find((m) => m.id === matchId);
  if (!targetMatch) {
    return {
      allowed: false,
      error: "MATCH_NOT_FOUND",
      message: "Match not found or no longer available.",
    };
  }
  if (!isPlayerEligibleForMatch(player, targetMatch, payments, isAdmin)) {
    return {
      allowed: false,
      error: "INELIGIBLE",
      message: "You are not eligible to access this match.",
    };
  }
  return { allowed: true };
}
