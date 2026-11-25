import type { Player } from "./types.ts";

export type RosterStatusFilter = "all" | "active" | "inactive";
export type RosterMembershipFilter = "all" | "studio" | "regular";
export type RosterSortOption = "name" | "expiry" | "studio" | "due";

export interface RosterSummary {
  totalPlayers: number;
  activePlayers: number;
  studioMembers: number;
  inactivePlayers: number;
}

export function isMainRosterPlayer(p: Player): boolean {
  return p.inviteStatus !== "Pending" && p.inviteStatus !== "Unverified" && !p.mergedInto;
}

export function computeRosterSummary(players: Player[] = []): RosterSummary {
  const roster = players.filter(isMainRosterPlayer);
  let activePlayers = 0;
  let studioMembers = 0;
  let inactivePlayers = 0;

  for (const p of roster) {
    if (p.disabled) {
      inactivePlayers += 1;
    } else {
      activePlayers += 1;
      if (p.isStudioMember) studioMembers += 1;
    }
  }

  return {
    totalPlayers: roster.length,
    activePlayers,
    studioMembers,
    inactivePlayers,
  };
}

export function filterAndSortRoster(
  players: Player[] = [],
  {
    query = "",
    statusFilter = "all",
    membershipFilter = "all",
    sortOption = "name",
    getTotalDue = () => 0,
  }: {
    query?: string;
    statusFilter?: RosterStatusFilter;
    membershipFilter?: RosterMembershipFilter;
    sortOption?: RosterSortOption;
    getTotalDue?: (playerId: string) => number;
  } = {},
): Player[] {
  const q = query.trim().toLowerCase();

  const filtered = players.filter((p) => {
    if (!isMainRosterPlayer(p)) return false;

    if (statusFilter === "active" && p.disabled) return false;
    if (statusFilter === "inactive" && !p.disabled) return false;

    if (membershipFilter === "studio" && !p.isStudioMember) return false;
    if (membershipFilter === "regular" && p.isStudioMember) return false;

    if (q) {
      const nameMatch = p.name?.toLowerCase().includes(q);
      const kavachIdMatch = p.kavachId?.toLowerCase().includes(q);
      const mobileMatch = p.mobile?.includes(q);
      const emailMatch = p.email?.toLowerCase().includes(q);
      if (!nameMatch && !kavachIdMatch && !mobileMatch && !emailMatch) return false;
    }

    return true;
  });

  if (sortOption === "name") {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortOption === "expiry") {
    filtered.sort((a, b) => {
      const aExp = a.studioExpiryDate || a.studioEndDate || "zzzz";
      const bExp = b.studioExpiryDate || b.studioEndDate || "zzzz";
      return aExp.localeCompare(bExp);
    });
  } else if (sortOption === "studio") {
    filtered.sort((a, b) =>
      a.isStudioMember === b.isStudioMember ? a.name.localeCompare(b.name) : a.isStudioMember ? -1 : 1,
    );
  } else if (sortOption === "due") {
    filtered.sort((a, b) => getTotalDue(b.id) - getTotalDue(a.id));
  }

  return filtered;
}

export function formatPlayingInfo(player: Pick<Player, "battingStyle" | "isWicketKeeper" | "jerseyNumber">): string {
  const parts: string[] = [];
  if (player.isWicketKeeper) parts.push("Wicket Keeper");
  if (player.battingStyle) parts.push(player.battingStyle);
  if (player.jerseyNumber) parts.push(`#${player.jerseyNumber}`);
  return parts.length > 0 ? parts.join(" · ") : "Cricket Member";
}

export function buildRosterCsv(players: Player[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Name", "Player ID", "Mobile", "Email", "Cricket Role", "Membership", "Status", "Joined"];
  const rows = players.map((p) => [
    p.name,
    p.kavachId || "",
    p.mobile || "",
    p.email || "",
    formatPlayingInfo(p),
    p.isStudioMember ? "Studio" : "Regular",
    p.disabled ? "Inactive" : "Active",
    p.kavachJoining || "",
  ]);
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}
