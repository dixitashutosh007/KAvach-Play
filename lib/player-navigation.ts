/**
 * Player persona navigation model (D-16).
 *
 * The Player persona has exactly three primary destinations — Home, Profile,
 * Matches — in that order, on desktop and mobile alike. Every other player-facing
 * screen is a *secondary destination* that belongs to one of those three parents
 * and is reached contextually (Home quick links, Profile cards, Pay Now), never
 * through another menu.
 *
 * This module is deliberately persona-only: nothing here takes a role or
 * permission as input, so admin privileges cannot change what a player sees.
 * Firestore rules and server-side RBAC remain the security boundary.
 */

export type PlayerPrimaryTab = "home" | "profile" | "matches";

export type PlayerSecondaryTab =
  | "players"
  | "studio"
  | "shop"
  | "opinion"
  | "notifications"
  | "leaderboard"
  | "badges"
  | "finance";

export type PlayerTab = PlayerPrimaryTab | PlayerSecondaryTab;

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
  { tab: "profile", label: "Profile" },
  { tab: "matches", label: "Matches", feature: "matches" },
] as const;

export interface PlayerSecondaryDestination {
  parent: PlayerPrimaryTab;
  label: string;
  feature?: PlayerNavFeature;
}

/** Secondary screens and the primary destination each one belongs to. */
export const PLAYER_SECONDARY_DESTINATIONS: Readonly<Record<PlayerSecondaryTab, PlayerSecondaryDestination>> = {
  players: { parent: "home", label: "Club Directory" },
  studio: { parent: "home", label: "Studio", feature: "studio" },
  shop: { parent: "home", label: "Club Shop", feature: "shop" },
  opinion: { parent: "home", label: "Polls & Pulse", feature: "opinion" },
  notifications: { parent: "home", label: "Notifications" },
  leaderboard: { parent: "profile", label: "Leaderboard", feature: "leaderboard" },
  badges: { parent: "profile", label: "Club Badges", feature: "badges" },
  finance: { parent: "profile", label: "My Payments" },
};

const PRIMARY_LABELS: Record<PlayerPrimaryTab, string> = {
  home: "Home",
  profile: "Profile",
  matches: "Matches",
};

export type FeatureCheck = (feature: PlayerNavFeature) => boolean;

const allEnabled: FeatureCheck = () => true;

/** Primary items to render, in the fixed order, honouring club feature flags. */
export function getPlayerPrimaryNav(isFeatureEnabled: FeatureCheck = allEnabled): PlayerPrimaryNavItem[] {
  return PLAYER_PRIMARY_NAV.filter((item) => !item.feature || isFeatureEnabled(item.feature));
}

export function isPlayerPrimaryTab(tab: string): tab is PlayerPrimaryTab {
  return tab === "home" || tab === "profile" || tab === "matches";
}

export function isPlayerSecondaryTab(tab: string): tab is PlayerSecondaryTab {
  return Object.prototype.hasOwnProperty.call(PLAYER_SECONDARY_DESTINATIONS, tab);
}

/** True when `tab` is a screen the Player persona may display. */
export function isPlayerTab(tab: string): tab is PlayerTab {
  return isPlayerPrimaryTab(tab) || isPlayerSecondaryTab(tab);
}

/** The primary destination that should appear active while `tab` is shown. */
export function getPlayerNavParent(tab: string): PlayerPrimaryTab | null {
  if (isPlayerPrimaryTab(tab)) return tab;
  if (isPlayerSecondaryTab(tab)) return PLAYER_SECONDARY_DESTINATIONS[tab].parent;
  return null;
}

/**
 * Resolve the tab the Player persona should actually show. Admin-only or unknown
 * tabs (club, design, settings, grounds, dues_and_reminders, ...) and destinations
 * whose feature is disabled fall back to an enabled primary destination.
 */
export function resolvePlayerTab(tab: string, isFeatureEnabled: FeatureCheck = allEnabled): PlayerTab {
  if (isPlayerPrimaryTab(tab)) {
    const item = PLAYER_PRIMARY_NAV.find((i) => i.tab === tab)!;
    if (!item.feature || isFeatureEnabled(item.feature)) return tab;
  } else if (isPlayerSecondaryTab(tab)) {
    const dest = PLAYER_SECONDARY_DESTINATIONS[tab];
    if (!dest.feature || isFeatureEnabled(dest.feature)) return tab;
  }
  return getPlayerPrimaryNav(isFeatureEnabled)[0]?.tab ?? "profile";
}

/** Back-link details for a secondary screen, or null on a primary screen. */
export function getPlayerBackLink(tab: string): { parent: PlayerPrimaryTab; parentLabel: string; label: string } | null {
  if (!isPlayerSecondaryTab(tab)) return null;
  const dest = PLAYER_SECONDARY_DESTINATIONS[tab];
  return { parent: dest.parent, parentLabel: PRIMARY_LABELS[dest.parent], label: dest.label };
}
