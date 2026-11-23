/**
 * Admin persona navigation model (D-18).
 *
 * The Admin persona has six primary destinations — Home, Match Center, Club,
 * Finance, Design Studio, Settings — in that order, on desktop and mobile. Each
 * destination and each Club section is shown only to roles the EXISTING
 * permission model already authorises; nothing here grants access. Firestore
 * rules and server-side RBAC remain the security boundary, and every screen keeps
 * its own guard in app/page.tsx.
 *
 * Inputs are the *effective* flags computed in app/page.tsx (Super Admin claim
 * already folded into each role flag; `canDesign = isClubAdmin || isDesigner`).
 *
 * D-19: Match Admin and Studio Admin are retired into Club Admin. Until the
 * role-consolidation migration has run, the legacy flags still open their former
 * areas (Match Center / Club → Studio) so nobody loses access in between.
 * Destinations a role cannot use are hidden from the menu; if one is opened
 * directly, the screen shows a polite access-denied message (no silent redirect).
 */

export interface AdminCapabilities {
  isSuperAdmin: boolean;
  isClubAdmin: boolean;
  isMatchAdmin: boolean;
  isFinanceAdmin: boolean;
  isStudioAdmin: boolean;
  canDesign: boolean;
}

export type AdminDestination = "home" | "matches" | "club" | "finance" | "design" | "settings";

export type ClubSection =
  | "players"
  | "studio"
  | "announcements"
  | "pulse"
  | "leaderboard"
  | "badges"
  | "shop";

export type AdminNavFeature = "studio" | "opinion" | "badges" | "shop";
export type AdminFeatureCheck = (feature: AdminNavFeature) => boolean;
const allEnabled: AdminFeatureCheck = () => true;

export interface AdminPrimaryNavItem {
  tab: AdminDestination;
  label: string;
  /** Compact label for the six-item mobile bar. */
  shortLabel: string;
}

export const ADMIN_PRIMARY_NAV: readonly AdminPrimaryNavItem[] = [
  { tab: "home", label: "Home", shortLabel: "Home" },
  { tab: "matches", label: "Match Center", shortLabel: "Matches" },
  { tab: "club", label: "Club", shortLabel: "Club" },
  { tab: "finance", label: "Finance", shortLabel: "Finance" },
  { tab: "design", label: "Design Studio", shortLabel: "Design" },
  { tab: "settings", label: "Settings", shortLabel: "Settings" },
] as const;

/** Any administrative role (incl. Designer) — every admin sees Home (D-19). */
function isAnyAdminRole(c: AdminCapabilities): boolean {
  return c.isSuperAdmin || c.isClubAdmin || c.isMatchAdmin || c.isFinanceAdmin || c.isStudioAdmin || c.canDesign;
}

export interface ClubSectionDef {
  key: ClubSection;
  label: string;
  feature?: AdminNavFeature;
  /** Who may see this section — mirrors the screen's existing guard. */
  allowed: (c: AdminCapabilities) => boolean;
}

/** Club sections in display order (D-19: all Club Admin capabilities). */
export const CLUB_SECTIONS: readonly ClubSectionDef[] = [
  { key: "players", label: "Player Roster", allowed: (c) => c.isClubAdmin },
  // Studio: Club Admin (D-19); legacy Studio Admin flag honoured until migrated.
  { key: "studio", label: "Studio", allowed: (c) => c.isClubAdmin || c.isStudioAdmin },
  { key: "announcements", label: "Announcements", allowed: (c) => c.isClubAdmin },
  { key: "pulse", label: "Pulse", feature: "opinion", allowed: (c) => c.isClubAdmin },
  { key: "leaderboard", label: "Leaderboard & Stats", allowed: (c) => c.isClubAdmin },
  { key: "badges", label: "Badges", feature: "badges", allowed: (c) => c.isClubAdmin },
  { key: "shop", label: "Shop", feature: "shop", allowed: (c) => c.isClubAdmin },
];

export function getVisibleClubSections(c: AdminCapabilities, isFeatureEnabled: AdminFeatureCheck = allEnabled): ClubSection[] {
  return CLUB_SECTIONS.filter((s) => s.allowed(c) && (!s.feature || isFeatureEnabled(s.feature))).map((s) => s.key);
}

export function isAdminDestinationVisible(
  tab: AdminDestination,
  c: AdminCapabilities,
  isFeatureEnabled: AdminFeatureCheck = allEnabled,
): boolean {
  switch (tab) {
    case "home":
      // D-19: every admin; dashboard tiles are role-gated and denials are polite.
      return isAnyAdminRole(c);
    case "matches":
      // D-19: Club Admin (legacy Match Admin flag honoured until migrated).
      return c.isClubAdmin || c.isMatchAdmin;
    case "club":
      return getVisibleClubSections(c, isFeatureEnabled).length > 0;
    case "finance":
      return c.isFinanceAdmin;
    case "design":
      return c.canDesign;
    case "settings":
      return c.isSuperAdmin;
  }
}

/** Primary items to render, in fixed order, for this user's permissions. */
export function getAdminPrimaryNav(c: AdminCapabilities, isFeatureEnabled: AdminFeatureCheck = allEnabled): AdminPrimaryNavItem[] {
  return ADMIN_PRIMARY_NAV.filter((i) => isAdminDestinationVisible(i.tab, c, isFeatureEnabled));
}

/**
 * Legacy / secondary tab ids that now live inside a destination. Existing quick
 * actions and deep links keep working by being canonicalised to their parent.
 */
export const ADMIN_TAB_ALIASES: Readonly<Record<string, { tab: AdminDestination; section: string }>> = {
  studio: { tab: "club", section: "studio" },
  opinion: { tab: "club", section: "pulse" },
  leaderboard: { tab: "club", section: "leaderboard" },
  shop: { tab: "club", section: "shop" },
  badges: { tab: "club", section: "badges" },
  players: { tab: "club", section: "players" },
  grounds: { tab: "matches", section: "grounds" },
  dues_and_reminders: { tab: "finance", section: "dues" },
};

/** Former Club sections that now live in another destination (D-19). */
export const CLUB_ACTION_REDIRECTS: Readonly<Record<string, { tab: AdminDestination; action: string }>> = {
  reminders: { tab: "finance", action: "dues" },
  activity: { tab: "finance", action: "activity" },
};

/** Screens available to every admin outside the six destinations (header controls). */
export const ADMIN_GLOBAL_TABS = ["notifications", "profile"] as const;

function isPrimary(tab: string): tab is AdminDestination {
  return ADMIN_PRIMARY_NAV.some((i) => i.tab === tab);
}

/** Destination that should appear active for `tab`, or null for global screens. */
export function getAdminNavParent(tab: string): AdminDestination | null {
  if (isPrimary(tab)) return tab;
  return ADMIN_TAB_ALIASES[tab]?.tab ?? null;
}

/** Where an admin lands when entering Admin persona (existing role priority). */
export function getAdminLanding(c: AdminCapabilities, isFeatureEnabled: AdminFeatureCheck = allEnabled): { tab: string; action?: string } {
  const pick = (tab: AdminDestination, action?: string) =>
    isAdminDestinationVisible(tab, c, isFeatureEnabled) ? (action ? { tab, action } : { tab }) : null;
  const club = getVisibleClubSections(c, isFeatureEnabled);
  return (
    (c.isSuperAdmin && pick("home")) ||
    (c.isFinanceAdmin && pick("finance")) ||
    (c.isClubAdmin && pick("home")) ||
    (c.isMatchAdmin && pick("matches")) ||
    (c.isStudioAdmin && club.includes("studio") && pick("club", "studio")) ||
    (c.canDesign && pick("design")) ||
    (getAdminPrimaryNav(c, isFeatureEnabled)[0] ? { tab: getAdminPrimaryNav(c, isFeatureEnabled)[0].tab } : { tab: "home" })
  );
}

/**
 * Canonical route for the Admin persona. Legacy tab ids map to their destination
 * (section carried in the action, e.g. "studio:add_player"); former Club sections
 * now in Finance are moved there. Destinations the user may not use are NOT
 * redirected — the screen shows a polite access-denied message (D-19).
 * Returns null when no change is needed.
 */
export function resolveAdminRoute(
  tab: string,
  action?: string | null,
): { tab: string; action?: string } | null {
  if ((ADMIN_GLOBAL_TABS as readonly string[]).includes(tab)) return null;
  const alias = ADMIN_TAB_ALIASES[tab];
  if (alias) {
    const target = { tab: alias.tab, action: action ? `${alias.section}:${action}` : alias.section };
    return resolveAdminRoute(target.tab, target.action) ?? target;
  }
  if (tab === "club" && action) {
    const redirect = CLUB_ACTION_REDIRECTS[action.split(":")[0]];
    if (redirect) return { tab: redirect.tab, action: redirect.action };
  }
  return null;
}

/**
 * Club section to open for a Club action. Accepts "section", "section:subAction"
 * and the existing dashboard shortcuts (badges_grant, invite_player).
 */
export function resolveClubSection(
  action: string | null | undefined,
  visible: readonly ClubSection[],
): { section: ClubSection | null; subAction: string | null; denied: string | null } {
  let section: string | null = null;
  let subAction: string | null = null;
  if (action === "badges_grant") {
    section = "badges";
    subAction = "grant";
  } else if (action === "invite_player") {
    section = "players";
    subAction = "invite";
  } else if (action) {
    const [s, ...rest] = action.split(":");
    section = s === "stats" ? "leaderboard" : s;
    subAction = rest.length ? rest.join(":") : null;
  }
  if (section && visible.includes(section as ClubSection)) return { section: section as ClubSection, subAction, denied: null };
  // A known section the user may not open → polite denial (D-19); unknown → first section.
  const known = CLUB_SECTIONS.find((d) => d.key === section);
  return { section: known ? null : visible[0] ?? null, subAction: null, denied: known ? known.label : null };
}
