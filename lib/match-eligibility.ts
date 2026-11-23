import type { Match, MatchPayment, Player } from "./types";

/**
 * Checks whether a match has an officially assigned squad based on the
 * real persisted MatchPayment records in Firestore.
 *
 * In KAvach Play:
 * - When an admin assigns players to a match squad (via MatchesTab),
 *   those players are assigned an active match fee obligation: status !== "Not Playing"
 *   (e.g. "Unpaid", "Paid", "Waived").
 * - Player-controlled availability RSVPs ("Confirmed", "Tentative", "Yes", "No", "Pending")
 *   with status === "Not Playing" represent player availability responses, NOT admin squad assignments.
 * - An ordinary player RSVP (even if marked "Confirmed") does NOT establish a squad assignment.
 */
export function isSquadAssignedToMatch(
  matchId: string,
  payments: MatchPayment[] = []
): boolean {
  return payments.some(
    (p) =>
      p.matchId === matchId &&
      !p.guestName &&
      p.status !== "Not Playing" &&
      p.status !== "Failed" &&
      (p.status === "Unpaid" || p.status === "Paid" || p.status === "Waived")
  );
}

/**
 * Checks whether a specific player is an authoritative assigned member of a match squad
 * based on their real persisted MatchPayment records in Firestore.
 *
 * Requirements:
 * - A player is considered part of the assigned squad ONLY if they have an authoritative
 *   admin squad assignment: an active match fee obligation (status !== "Not Playing" && status !== "Failed",
 *   specifically "Paid" | "Unpaid" | "Waived").
 * - Administrative removal (status === "Not Playing") and failed transactions (status === "Failed")
 *   are strictly authoritative across every eligibility path. Stale or legacy availability values
 *   (including "Waitlist", "Confirmed", "Yes", "Tentative", "No") strictly cannot override a removal status.
 * - No separate administrative waitlist workflow exists in KAvach Play. "Waived" is an authoritative
 *   financial status (for waived fees or abandoned fixtures), not a waitlist representation.
 * - Player-controlled availability RSVPs ("Confirmed", "Playing", "Tentative", "Yes", "No", "Out")
 *   with status === "Not Playing" strictly do NOT establish squad membership.
 * - If an admin removes a player from the squad (setting status === "Not Playing"),
 *   their squad membership is revoked immediately, even if previous availability remains.
 */
export function isPlayerInAssignedSquad(
  playerId: string,
  matchId: string,
  payments: MatchPayment[] = []
): boolean {
  return payments.some(
    (p) =>
      p.matchId === matchId &&
      p.playerId === playerId &&
      !p.guestName &&
      p.status !== "Not Playing" &&
      p.status !== "Failed" &&
      (p.status === "Paid" || p.status === "Unpaid" || p.status === "Waived")
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
 *    - Only players with authoritative squad assignment (isPlayerInAssignedSquad) are eligible.
 *    - Players excluded from the assigned squad are strictly denied, even if they previously
 *      submitted an RSVP (Yes, No, Tentative) while the fixture was open.
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

  // 5. Check if the match has an officially assigned squad
  const hasSquad = isSquadAssignedToMatch(match.id, payments);
  if (hasSquad) {
    // If a squad has been assigned, player MUST be an authoritative member of the assigned squad.
    // Historical RSVPs (e.g. "Yes", "No", "Tentative") with status "Not Playing" do NOT grant access.
    return isPlayerInAssignedSquad(player.id, match.id, payments);
  }

  // 6. Genuinely open fixture with no assigned squad:
  // Active, verified club players are eligible to view the fixture and submit RSVPs
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
