/**
 * Player Merge Domain Logic (lib/player-merge.ts)
 *
 * Authoritative logic for duplicate player merging and identity reparenting (IDT-001).
 */

export function normalizeIndianMobile(m: string): string {
  if (!m) return "";
  const digits = String(m).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0"))
    return `+91${digits.slice(1)}`;
  return m;
}

export const FILL_IF_EMPTY = [
  "email",
  "dob",
  "locality",
  "bloodGroup",
  "emergencyContact",
  "battingStyle",
  "bowlingStyle",
  "chestSize",
  "waistSize",
  "jerseyNumber",
  "jerseyName",
  "studioExpiryDate",
  "studioEndDate",
  "studioPlan",
  "lastPaidDate",
  "lastPaidAmount",
  "photoURL",
] as const;

export function computeKeeperPatch(
  keeper: Record<string, any>,
  loser: Record<string, any>,
): Record<string, any> {
  const patch: Record<string, any> = {};
  for (const field of FILL_IF_EMPTY) {
    const kVal = keeper[field];
    const lVal = loser[field];
    if (
      (kVal === undefined || kVal === null || kVal === "") &&
      lVal !== undefined &&
      lVal !== null &&
      lVal !== ""
    ) {
      patch[field] = lVal;
    }
  }
  if (!keeper.isStudioMember && loser.isStudioMember) {
    patch.isStudioMember = true;
  }
  if (!keeper.isWicketKeeper && loser.isWicketKeeper) {
    patch.isWicketKeeper = true;
  }
  // Reparent authUid if keeper has none and loser has one
  if (!keeper.authUid && loser.authUid) {
    patch.authUid = loser.authUid;
  }

  const canonicalMobile = keeper.mobile || loser.mobile || "";
  const normalized = normalizeIndianMobile(canonicalMobile);
  if (normalized) patch.mobile = normalized;

  return patch;
}

export function planAppUsersReparent(
  appUsers: Array<{ id: string; playerId?: string; [key: string]: any }>,
  loserId: string,
  keeperId: string,
): Array<{ uid: string; oldPlayerId?: string; newPlayerId: string }> {
  const updates: Array<{ uid: string; oldPlayerId?: string; newPlayerId: string }> = [];
  for (const user of appUsers) {
    if (user.playerId === loserId || user.id === loserId) {
      updates.push({
        uid: user.id,
        oldPlayerId: user.playerId,
        newPlayerId: keeperId,
      });
    }
  }
  return updates;
}
