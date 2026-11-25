/**
 * Player Studio membership status (shared by StudioTab and the Profile
 * membership card so both always agree).
 *
 * Extracted without behavioural change from `components/StudioTab.tsx`. Reads
 * existing player / appUser fields only.
 */
import { parseExpiryDate } from "./utils.ts";

export type StudioMembershipStatus = "Active" | "Expired" | "Inactive" | "Paused";

export interface StudioMembershipFields {
  isStudioMember?: boolean;
  studioStartDate?: string;
  studioEndDate?: string;
  studioExpiryDate?: string;
  lastPaidDate?: string;
  studioPlan?: string;
}

export interface StudioMembershipSummary {
  status: StudioMembershipStatus;
  daysRemaining: number | null;
  endDateRaw?: string;
  hasPastSubscription: boolean;
  isStudioUser: boolean;
}

export function getStudioMembership(
  player: StudioMembershipFields | null | undefined,
  appUser: StudioMembershipFields | null | undefined,
  nowMs: number = Date.now(),
): StudioMembershipSummary {
  const isStudioUser = Boolean(appUser?.isStudioMember || player?.isStudioMember);
  const endDateRaw =
    player?.studioExpiryDate ||
    player?.studioEndDate ||
    appUser?.studioExpiryDate ||
    appUser?.studioEndDate;
  const hasPastSubscription = !!(endDateRaw || player?.lastPaidDate || appUser?.lastPaidDate);

  let status: StudioMembershipStatus = "Inactive";
  let daysRemaining: number | null = null;

  if (endDateRaw) {
    const expDateObj = parseExpiryDate(endDateRaw);
    if (expDateObj && !isNaN(expDateObj.getTime())) {
      const diffMs = expDateObj.getTime() - nowMs;
      daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (daysRemaining < 0) {
        status = "Expired";
      } else if (isStudioUser) {
        status = "Active";
      } else {
        status = "Paused";
      }
    } else {
      status = isStudioUser ? "Active" : "Expired";
    }
  } else if (isStudioUser) {
    status = "Active";
  } else if (hasPastSubscription) {
    status = "Expired";
  }

  return { status, daysRemaining, endDateRaw, hasPastSubscription, isStudioUser };
}

export function getStudioAlertExpiryKey(
  player: Pick<StudioMembershipFields, "studioExpiryDate" | "studioEndDate">,
): string {
  return player.studioExpiryDate || player.studioEndDate || "no-expiry";
}

export function filterDismissedExpiredStudioAlerts<
  T extends { id: string; studioExpiryDate?: string; studioEndDate?: string },
>(
  expired: T[],
  dismissedMap?: Record<string, string> | null,
): T[] {
  if (!dismissedMap) return expired;
  return expired.filter((p) => dismissedMap[p.id] !== getStudioAlertExpiryKey(p));
}
