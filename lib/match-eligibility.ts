import type { Match, MatchPayment, Player } from "./types";

/**
 * Authoritative Player-Match Eligibility & Visibility Validator.
 *
 * Rules:
 * 1. Admins (Club Admin, Match Admin, Super Admin) have administrative rights
 *    to view and manage all active (non-archived) fixtures.
 * 2. Unlinked users (null player) cannot view personal player fixtures or RSVP.
 * 3. Inactive, disabled, merged, or unverified (Rejected/Pending) players cannot
 *    participate in matches or submit RSVPs.
 * 4. Archived matches (isArchived) and Tentative/Blocked slots (isTentative) are
 *    ineligible for ordinary player display and RSVP.
 * 5. If the player has an existing payment/participation record for the match,
 *    they are explicitly linked and eligible.
 * 6. If the match has an assigned squad list (squadPlayerIds) and the player is
 *    not in it, they are not eligible for this match.
 * 7. If the match has a restricted eligible player list (eligiblePlayerIds) and
 *    the player is not in it, they are not eligible.
 * 8. If the match is an open upcoming club fixture without squad restrictions,
 *    active verified club players are eligible to view and submit RSVPs.
 */
export function isPlayerEligibleForMatch(
  player: Player | null | undefined,
  match: Match | null | undefined,
  payments: MatchPayment[] = [],
  isAdmin: boolean = false
): boolean {
  if (!match) return false;

  // 1. Admin access: Admins see all non-archived matches
  if (isAdmin) {
    return !match.isArchived;
  }

  // 2. Unlinked user cannot participate
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

  // 4. Ineligible match states for regular players: archived or tentative
  if (match.isArchived || match.isTentative) {
    return false;
  }

  // 5. Existing payment / squad record grants explicit participation
  const existingPayment = payments.find(
    (p) => p.matchId === match.id && p.playerId === player.id
  );
  if (existingPayment) {
    return true;
  }

  // 6. If match has an explicit squad announced/restricted, check player presence
  const matchSquad = (match as any).squadPlayerIds;
  if (Array.isArray(matchSquad) && matchSquad.length > 0) {
    return matchSquad.includes(player.id);
  }

  // 7. If match has an explicit eligible list, check player presence
  const eligibleIds = (match as any).eligiblePlayerIds;
  if (Array.isArray(eligibleIds) && eligibleIds.length > 0) {
    return eligibleIds.includes(player.id);
  }

  // 8. Open upcoming club match before squad assignment:
  // Active verified club players can view and RSVP
  return true;
}
