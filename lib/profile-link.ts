/**
 * Player-profile link status (`lib/profile-link.ts`). Pure, no Firebase.
 *
 * The availability actions need the signed-in account to resolve to a player
 * record through the verified identity model (players.authUid, the
 * appUsers.playerId pointer, or a legacy record whose id is the UID — see
 * lib/player-identity.ts). Nothing here creates a link; linking is performed
 * only by the server (/api/player/link-account) using the phone number in the
 * verified Firebase ID token.
 */

export type ProfileLinkState = "loading" | "linked" | "unlinked";

export function getProfileLinkState({
  playersLoaded,
  hasPlayer,
}: {
  playersLoaded: boolean;
  hasPlayer: boolean;
}): ProfileLinkState {
  if (hasPlayer) return "linked";
  if (!playersLoaded) return "loading";
  return "unlinked";
}

export const PROFILE_LINK_MESSAGES: Record<Exclude<ProfileLinkState, "linked">, string> = {
  loading: "Your player profile is still loading. Please try again in a moment.",
  unlinked:
    "This login is not linked to a player record yet, so availability cannot be saved. See the notice at the top of the screen to link it.",
};

/** Message to show when availability is blocked, or null when the player can proceed. */
export function availabilityBlockMessage(args: { playersLoaded: boolean; hasPlayer: boolean }): string | null {
  const state = getProfileLinkState(args);
  return state === "linked" ? null : PROFILE_LINK_MESSAGES[state];
}
