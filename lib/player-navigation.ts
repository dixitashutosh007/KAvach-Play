/**
 * Player persona navigation model (D-16, revised by D-20).
 *
 * The Player persona has exactly three primary destinations — Home, Club,
 * Matches — in that order, on desktop and mobile alike (D-20). The personal
 * Player Profile is opened from the header avatar and is not a primary
 * destination. Every other player-facing screen is a *secondary destination*
 * reached contextually (Home quick access, Club tiles, Profile cards, Pay Now)
 * with a back link — never through another menu.
 *
 * This module is deliberately persona-only: nothing here takes a role or
 * permission as input, so admin privileges cannot change what a player sees.
 * Firestore rules and server-side RBAC remain the security boundary.
 */

export type PlayerPrimaryTab = "home" | "club" | "matches";

/** Screens opened from the header (not part of the bottom navigation). */
export type PlayerGlobalTab = "profile" | "notifications";

export type PlayerSecondaryTab =
  | "players"
  | "studio"
  | "shop"
  | "opinion"
  | "pulse"
  | "announcements"
  | "leaderboard"
  | "badges"
  | "finance";

export type PlayerTab = PlayerPrimaryTab | PlayerGlobalTab | PlayerSecondaryTab;

/** Feature flags from `appConfig.features` that gate player destinations. */
export type PlayerNavFeature = "feed" | "matches" | "leaderboard" | "studio" | "shop" | "opinion" | "badges";

export interface PlayerPrimaryNavItem {
  tab: PlayerPrimaryTab;
  label: string;
  feature?: PlayerNavFeature;
}

/** The only primary navigation the Player persona ever renders, in order. */
export const PLAYER_PRIMARY_NAV: readonly PlayerPrimaryNavItem[] = [
  { tab: "home", label: "Home", feature: "feed" },
  { tab: "club", label: "Club" },
  { tab: "matches", label: "Matches", feature: "matches" },
] as const;

export interface PlayerSecondaryDestination {
  /** Where the back link returns to. */
  parent: PlayerPrimaryTab | "profile";
  label: string;
  feature?: PlayerNavFeature;
}

/** Secondary screens and the screen each one returns to. */
export const PLAYER_SECONDARY_DESTINATIONS: Readonly<Record<PlayerSecondaryTab, PlayerSecondaryDestination>> = {
  // Club destinations
  players: { parent: "club", label: "Player Directory" },
  opinion: { parent: "club", label: "Polls", feature: "opinion" },
  pulse: { parent: "club", label: "Pulse", feature: "opinion" },
  announcements: { parent: "club", label: "Club Announcements" },
  leaderboard: { parent: "club", label: "Leaderboard", feature: "leaderboard" },
  badges: { parent: "club", label: "Player Badges", feature: "badges" },
  // Home quick access
  studio: { parent: "home", label: "Studio", feature: "studio" },
  shop: { parent: "home", label: "Club Shop", feature: "shop" },
  // Profile (Payments)
  finance: { parent: "profile", label: "My Payments" },
};

const PARENT_LABELS: Record<PlayerPrimaryTab | "profile", string> = {
  home: "Home",
  club: "Club",
  matches: "Matches",
  profile: "Profile",
};

export type FeatureCheck = (feature: PlayerNavFeature) => boolean;

const allEnabled: FeatureCheck = () => true;

/** Primary items to render, in the fixed order, honouring club feature flags. */
export function getPlayerPrimaryNav(isFeatureEnabled: FeatureCheck = allEnabled): PlayerPrimaryNavItem[] {
  return PLAYER_PRIMARY_NAV.filter((item) => !item.feature || isFeatureEnabled(item.feature));
}

export function isPlayerPrimaryTab(tab: string): tab is PlayerPrimaryTab {
  return tab === "home" || tab === "club" || tab === "matches";
}

export function isPlayerGlobalTab(tab: string): tab is PlayerGlobalTab {
  return tab === "profile" || tab === "notifications";
}

export function isPlayerSecondaryTab(tab: string): tab is PlayerSecondaryTab {
  return Object.prototype.hasOwnProperty.call(PLAYER_SECONDARY_DESTINATIONS, tab);
}

/** True when `tab` is a screen the Player persona may display. */
export function isPlayerTab(tab: string): tab is PlayerTab {
  return isPlayerPrimaryTab(tab) || isPlayerGlobalTab(tab) || isPlayerSecondaryTab(tab);
}

/**
 * The primary destination that should appear active while `tab` is shown, or
 * null for header screens (Profile, Notifications) and screens reached from them.
 */
export function getPlayerNavParent(tab: string): PlayerPrimaryTab | null {
  if (isPlayerPrimaryTab(tab)) return tab;
  if (isPlayerSecondaryTab(tab)) {
    const parent = PLAYER_SECONDARY_DESTINATIONS[tab].parent;
    return parent === "profile" ? null : parent;
  }
  return null;
}

/**
 * Resolve the tab the Player persona should actually show. Admin-only or unknown
 * tabs (design, settings, grounds, dues_and_reminders, ...) and destinations
 * whose feature is disabled fall back to an enabled primary destination.
 */
export function resolvePlayerTab(tab: string, isFeatureEnabled: FeatureCheck = allEnabled): PlayerTab {
  if (isPlayerPrimaryTab(tab)) {
    const item = PLAYER_PRIMARY_NAV.find((i) => i.tab === tab)!;
    if (!item.feature || isFeatureEnabled(item.feature)) return tab;
  } else if (isPlayerGlobalTab(tab)) {
    return tab;
  } else if (isPlayerSecondaryTab(tab)) {
    const dest = PLAYER_SECONDARY_DESTINATIONS[tab];
    if (!dest.feature || isFeatureEnabled(dest.feature)) return tab;
  }
  return getPlayerPrimaryNav(isFeatureEnabled)[0]?.tab ?? "club";
}

/** Back-link details for a secondary screen, or null on a primary / header screen. */
export function getPlayerBackLink(tab: string): { parent: PlayerPrimaryTab | "profile"; parentLabel: string; label: string } | null {
  if (!isPlayerSecondaryTab(tab)) return null;
  const dest = PLAYER_SECONDARY_DESTINATIONS[tab];
  return { parent: dest.parent, parentLabel: PARENT_LABELS[dest.parent], label: dest.label };
}
