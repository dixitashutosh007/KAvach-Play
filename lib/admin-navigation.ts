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
  | "shop"
  | "reminders"
  | "activity";

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

/** Any administrative role recognised by Firestore `isAnyAdmin()` (Designer is not one). */
function isAnyAdmin(c: AdminCapabilities): boolean {
  return c.isSuperAdmin || c.isClubAdmin || c.isMatchAdmin || c.isFinanceAdmin || c.isStudioAdmin;
}

export interface ClubSectionDef {
  key: ClubSection;
  label: string;
  feature?: AdminNavFeature;
  /** Who may see this section — mirrors the screen's existing guard. */
  allowed: (c: AdminCapabilities) => boolean;
}

/** Club sections in display order. */
export const CLUB_SECTIONS: readonly ClubSectionDef[] = [
  // Player Roster / Directory incl. Invite Player and verification (was Club → Players; Club/Super Admin).
  { key: "players", label: "Player Roster", allowed: (c) => c.isClubAdmin },
  // Studio & Nets management (was its own hub; Studio/Super Admin).
  { key: "studio", label: "Studio", allowed: (c) => c.isStudioAdmin },
  // Announcement publishing/editing (moved from Player Home in D-16; Super Admin claim or Club Admin).
  { key: "announcements", label: "Announcements", allowed: (c) => c.isClubAdmin },
  // Polls management (was More → Polls & Pulse for every admin; rules: isAnyAdmin()).
  { key: "pulse", label: "Pulse", feature: "opinion", allowed: isAnyAdmin },
  // Leaderboard (read-only, was More for every admin) + Club Statistics (Club/Super Admin, gated inside).
  { key: "leaderboard", label: "Leaderboard & Stats", allowed: isAnyAdmin },
  // Badge gallery, Hall of Fame, Grant/Manage (Club/Super Admin; rules: isClubAdmin()).
  { key: "badges", label: "Badges", feature: "badges", allowed: (c) => c.isClubAdmin },
  // Merchandise management (Club/Super Admin manage the catalogue).
  { key: "shop", label: "Shop", feature: "shop", allowed: (c) => c.isClubAdmin },
  // Dues reminders (was Club → Reminders; Club/Super Admin).
  { key: "reminders", label: "Reminders", allowed: (c) => c.isClubAdmin },
  // Audit log (Super Admin only).
  { key: "activity", label: "Activity Log", allowed: (c) => c.isSuperAdmin },
];

/** Sections that make Club worth showing on their own (Leaderboard is read-only). */
const CLUB_MANAGEMENT_SECTIONS: readonly ClubSection[] = [
  "players", "studio", "announcements", "pulse", "badges", "shop", "reminders", "activity",
];

export function getVisibleClubSections(c: AdminCapabilities, isFeatureEnabled: AdminFeatureCheck = allEnabled): ClubSection[] {
  const visible = CLUB_SECTIONS.filter((s) => s.allowed(c) && (!s.feature || isFeatureEnabled(s.feature))).map((s) => s.key);
  return visible.some((k) => CLUB_MANAGEMENT_SECTIONS.includes(k)) ? visible : [];
}

export function isAdminDestinationVisible(
  tab: AdminDestination,
  c: AdminCapabilities,
  isFeatureEnabled: AdminFeatureCheck = allEnabled,
): boolean {
  switch (tab) {
    case "home":
      // Admin Dashboard + announcements/performance management: Super/Club Admin (existing guard).
      return c.isClubAdmin;
    case "matches":
      // Match Center operations: Match/Super Admin (matches/grounds/tournaments rules use isMatchAdmin()).
      return c.isMatchAdmin;
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
    (c.isMatchAdmin && pick("matches")) ||
    (c.isStudioAdmin && club.includes("studio") && pick("club", "studio")) ||
    (c.isClubAdmin && pick("club")) ||
    (c.canDesign && pick("design")) ||
    (getAdminPrimaryNav(c, isFeatureEnabled)[0] ? { tab: getAdminPrimaryNav(c, isFeatureEnabled)[0].tab } : { tab: "notifications" })
  );
}

/**
 * Canonical route for the Admin persona. Aliases map to their destination (with
 * the section carried in the action, e.g. "studio:add_player"); destinations the
 * user is not shown redirect to their landing. Returns null when no change is needed.
 */
export function resolveAdminRoute(
  tab: string,
  action: string | null | undefined,
  c: AdminCapabilities,
  isFeatureEnabled: AdminFeatureCheck = allEnabled,
): { tab: string; action?: string } | null {
  if ((ADMIN_GLOBAL_TABS as readonly string[]).includes(tab)) return null;
  const alias = ADMIN_TAB_ALIASES[tab];
  if (alias) {
    const target = { tab: alias.tab, action: action ? `${alias.section}:${action}` : alias.section };
    if (!isAdminDestinationVisible(alias.tab, c, isFeatureEnabled)) return getAdminLanding(c, isFeatureEnabled);
    if (alias.tab === "club" && !getVisibleClubSections(c, isFeatureEnabled).includes(alias.section as ClubSection)) {
      return getAdminLanding(c, isFeatureEnabled);
    }
    return target;
  }
  if (isPrimary(tab) && isAdminDestinationVisible(tab, c, isFeatureEnabled)) return null;
  return getAdminLanding(c, isFeatureEnabled);
}

/**
 * Club section to open for a Club action. Accepts "section", "section:subAction"
 * and the existing dashboard shortcuts (badges_grant, invite_player).
 */
export function resolveClubSection(
  action: string | null | undefined,
  visible: readonly ClubSection[],
): { section: ClubSection | null; subAction: string | null } {
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
  if (section && visible.includes(section as ClubSection)) return { section: section as ClubSection, subAction };
  return { section: visible[0] ?? null, subAction: null };
}
