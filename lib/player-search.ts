import type { Ground, Match, MatchPayment, Player, Poll, Post } from "./types.ts";
import { isPlayerEligibleForMatch } from "./match-eligibility.ts";
import { toPublicPlayer, type PublicPlayer } from "./club-feed.ts";

export interface PublicGroundSearchItem {
  id: string;
  name: string;
  mapUrl?: string;
}

export interface PlayerSearchResults {
  matches: Match[];
  announcements: Post[];
  players: PublicPlayer[];
  grounds: PublicGroundSearchItem[];
  polls: Poll[];
}

export interface PlayerSearchInput {
  query: string;
  matches: Match[];
  posts: Post[];
  players: Player[];
  grounds: Ground[];
  polls: Poll[];
  payments: MatchPayment[];
  mePlayer: Player | null;
  isAdmin: boolean;
  isFeatureEnabled?: (key: string) => boolean;
}

export function searchPlayerAccessibleData({
  query,
  matches,
  posts,
  players,
  grounds,
  polls,
  payments,
  mePlayer,
  isAdmin,
  isFeatureEnabled = () => true,
}: PlayerSearchInput): PlayerSearchResults | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const groundNameById = new Map(grounds.map((g) => [g.id, g.name || ""]));

  const matchedMatches = matches.filter((m) => {
    if (!isPlayerEligibleForMatch(mePlayer, m, payments, isAdmin)) return false;
    const gName = m.groundId ? (groundNameById.get(m.groundId) || "").toLowerCase() : "";
    return (
      m.opponent?.toLowerCase().includes(q) ||
      m.date?.toLowerCase().includes(q) ||
      m.format?.toLowerCase().includes(q) ||
      gName.includes(q)
    );
  });

  const matchedAnnouncements = posts.filter((p) => {
    if (p.isAnnouncement) {
      if (!isFeatureEnabled("announcements")) return false;
    } else if (!isFeatureEnabled("feed")) {
      return false;
    }
    const title = (p as { title?: string }).title?.toLowerCase() || "";
    const text = p.text?.toLowerCase() || "";
    return title.includes(q) || text.includes(q);
  });

  const matchedPlayers = players
    .filter(
      (pl) =>
        !pl.disabled &&
        !pl.mergedInto &&
        (pl.name?.toLowerCase().includes(q) || pl.kavachId?.toLowerCase().includes(q)),
    )
    .map((pl) => toPublicPlayer(pl as unknown as Record<string, unknown> & { id: string; name?: string }));

  // Strip organiserPhone / gpayNumber from player search results
  const matchedGrounds: PublicGroundSearchItem[] = grounds
    .filter((g) => g.name?.toLowerCase().includes(q))
    .map((g) => ({
      id: g.id,
      name: g.name,
      mapUrl: g.mapUrl || undefined,
    }));

  const matchedPolls = isFeatureEnabled("polls")
    ? polls.filter(
        (poll) =>
          poll.isActive !== false &&
          (poll.title?.toLowerCase().includes(q) ||
            (poll.options || []).some((opt) => opt.toLowerCase().includes(q))),
      )
    : [];

  return {
    matches: matchedMatches,
    announcements: matchedAnnouncements,
    players: matchedPlayers,
    grounds: matchedGrounds,
    polls: matchedPolls,
  };
}
