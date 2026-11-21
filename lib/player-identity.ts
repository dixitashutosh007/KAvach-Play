import type { AppUser, Player } from "./types.ts";

/**
 * Resolves the canonical active player profile if merged.
 * Follows mergedInto pointers up to depth 5 to avoid infinite cycles.
 */
export function resolveCanonicalPlayer(
  player: Player | null | undefined,
  players: Player[],
): Player | null {
  if (!player) return null;
  let current: Player = player;
  let depth = 0;
  while (current.mergedInto && depth < 5) {
    const keeper = players.find((p) => p.id === current.mergedInto);
    if (!keeper) break;
    current = keeper;
    depth++;
  }
  return current;
}

/**
 * Resolves the authenticated user's player profile strictly through verified links:
 * 1. players.authUid === uid (and not disabled/merged, resolving to keeper if merged)
 * 2. appUsers.playerId === players.id (and not disabled/merged, resolving to keeper if merged)
 * 3. Legacy single-collection record: players.id === uid, ONLY IF the player record
 *    does NOT belong to a different authUid (i.e. p.authUid === uid or !p.authUid)
 *
 * CRITICAL SECURITY INVARIANT:
 * Mobile-number-based identity matching is completely excluded.
 * Unverified UID-to-player matching is prevented.
 * Unlinked/guest users return null, enabling safe registration/linking flows.
 */
export function resolvePlayerForUser(
  players: Player[] | undefined | null,
  uid: string | null | undefined,
  appUser?: AppUser | null,
): Player | null {
  if (!uid || !players || players.length === 0) return null;

  // 1. Authoritative: player explicitly bound to this Firebase authUid
  const directMatch = players.find((p) => p.authUid === uid);
  if (directMatch) {
    return resolveCanonicalPlayer(directMatch, players);
  }

  // 2. Authoritative: appUser record explicitly points to player doc
  if (appUser?.playerId) {
    const appUserMatch = players.find((p) => p.id === appUser.playerId);
    if (appUserMatch) {
      return resolveCanonicalPlayer(appUserMatch, players);
    }
  }

  // 3. Fallback for legacy single-collection doc where player.id === uid,
  // strictly verifying that this player record does not belong to a different authUid
  const legacyMatch = players.find(
    (p) =>
      p.id === uid &&
      (!p.authUid || p.authUid === uid),
  );
  if (legacyMatch) {
    return resolveCanonicalPlayer(legacyMatch, players);
  }

  // No verified link found -> unlinked account / guest
  return null;
}

/**
 * Returns the list of active players associated with this authenticated user.
 * Strictly uses verified links (authUid or appUser.playerId, or non-conflicting legacy id).
 * Never matches on mobile numbers or arbitrary unverified IDs.
 */
export function resolveMyPlayers(
  players: Player[] | undefined | null,
  uid: string | null | undefined,
  appUser?: AppUser | null,
): Player[] {
  if (!uid || !players || players.length === 0) return [];

  const matched = new Map<string, Player>();
  const add = (p: Player | null | undefined) => {
    // Follow merges to the surviving (keeper) record, exactly like
    // resolvePlayerForUser, so every screen resolves the same player.
    const canonical = resolveCanonicalPlayer(p, players);
    if (canonical && !canonical.disabled && !canonical.mergedInto) {
      matched.set(canonical.id, canonical);
    }
  };

  // The primary player always comes first, so `resolveMyPlayers(...)[0]` and
  // `resolvePlayerForUser(...)` can never disagree.
  add(resolvePlayerForUser(players, uid, appUser));

  for (const p of players) {
    if (p.disabled) continue;
    const isVerifiedLink =
      p.authUid === uid || // direct verified binding
      (Boolean(appUser?.playerId) && p.id === appUser?.playerId) || // appUser pointer binding
      (p.id === uid && (!p.authUid || p.authUid === uid)); // legacy, not bound to another authUid
    if (isVerifiedLink) add(p);
  }

  return Array.from(matched.values());
}
