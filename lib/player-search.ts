import type { Ground, Match, MatchPayment, Player, Poll, Post, Tournament } from "./types.ts";
import { isPlayerEligibleForMatch } from "./match-eligibility.ts";
import { orderPulsePolls, toPublicPlayer, type PublicPlayer } from "./club-feed.ts";

export interface PublicGroundSearchItem {
  id: string;
  name: string;
  mapUrl?: string;
  location?: string;
}

export interface PublicTournamentSearchItem {
  id: string;
  name: string;
  status: Tournament["status"];
  format?: Tournament["format"];
  jerseyColor?: Tournament["jerseyColor"];
  startDate?: string;
  endDate?: string;
  groundId?: string;
  groundName?: string;
  notes?: string;
}

export interface PublicPollSearchItem {
  id: string;
  title: string;
  type: Poll["type"];
  options?: string[];
  isActive: boolean;
  isSticked: boolean;
  createdAt?: unknown;
}

export interface PlayerSearchResults {
  matches: Match[];
  tournaments: PublicTournamentSearchItem[];
  announcements: Post[];
  feedPosts: Post[];
  players: PublicPlayer[];
  grounds: PublicGroundSearchItem[];
  polls: PublicPollSearchItem[];
}

export interface PlayerSearchInput {
  query: string;
  matches: Match[];
  tournaments?: Tournament[];
  posts: Post[];
  players: Player[];
  grounds: Ground[];
  polls: Poll[];
  payments: MatchPayment[];
  mePlayer: Player | null;
  isAdmin: boolean;
  isFeatureEnabled?: (key: string) => boolean;
  now?: number;
}

function isPostVisibleToPlayer(
  post: Post,
  isFeatureEnabled: (key: string) => boolean,
): boolean {
  if (post.isAnnouncement === true) {
    return isFeatureEnabled("announcements");
  }
  return isFeatureEnabled("feed");
}

export function searchPlayerAccessibleData({
  query,
  matches,
  tournaments = [],
  posts,
  players,
  grounds,
  polls,
  payments,
  mePlayer,
  isAdmin,
  isFeatureEnabled = () => true,
  now = Date.now(),
}: PlayerSearchInput): PlayerSearchResults | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  // Disabled player accounts cannot bypass access restrictions via search
  if (!isAdmin && mePlayer?.disabled) {
    return {
      matches: [],
      tournaments: [],
      announcements: [],
      feedPosts: [],
      players: [],
      grounds: [],
      polls: [],
    };
  }

  const groundNameById = new Map(grounds.map((g) => [g.id, g.name || ""]));
  const tournamentNameById = new Map(tournaments.map((t) => [t.id, t.name || ""]));

  const matchesFeatureOn = isFeatureEnabled("matches");
  const matchedMatches = matchesFeatureOn
    ? matches.filter((m) => {
        if (!isPlayerEligibleForMatch(mePlayer, m, payments, isAdmin)) return false;
        const gName = m.groundId ? (groundNameById.get(m.groundId) || "").toLowerCase() : "";
        const tName = m.tournamentId ? (tournamentNameById.get(m.tournamentId) || "").toLowerCase() : "";
        const resultText = [m.result, m.resultMarginAmount ? String(m.resultMarginAmount) : "", m.resultMarginType]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return (
          m.opponent?.toLowerCase().includes(q) ||
          m.date?.toLowerCase().includes(q) ||
          m.format?.toLowerCase().includes(q) ||
          m.matchType?.toLowerCase().includes(q) ||
          resultText.includes(q) ||
          gName.includes(q) ||
          tName.includes(q)
        );
      })
    : [];

  // Tournaments: exclude Disabled tournaments for players; strip organiserPhone & gpayNumber
  const matchedTournaments: PublicTournamentSearchItem[] = matchesFeatureOn
    ? tournaments
        .filter((t) => {
          if (!isAdmin && t.status === "Disabled") return false;
          const gName = t.groundId ? (groundNameById.get(t.groundId) || "").toLowerCase() : "";
          return (
            t.name?.toLowerCase().includes(q) ||
            t.status?.toLowerCase().includes(q) ||
            t.format?.toLowerCase().includes(q) ||
            t.jerseyColor?.toLowerCase().includes(q) ||
            t.notes?.toLowerCase().includes(q) ||
            gName.includes(q)
          );
        })
        .map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          format: t.format,
          jerseyColor: t.jerseyColor,
          startDate: t.startDate,
          endDate: t.endDate,
          groundId: t.groundId,
          groundName: t.groundId ? groundNameById.get(t.groundId) || undefined : undefined,
          notes: t.notes,
        }))
    : [];

  const matchedAnnouncements: Post[] = [];
  const matchedFeedPosts: Post[] = [];

  for (const p of posts) {
    if (!isPostVisibleToPlayer(p, isFeatureEnabled)) continue;
    const isAnnouncement = p.isAnnouncement === true;

    const title = (p as { title?: string }).title?.toLowerCase() || "";
    const text = p.text?.toLowerCase() || "";
    const author = p.authorName?.toLowerCase() || "";
    if (title.includes(q) || text.includes(q) || author.includes(q)) {
      if (isAnnouncement) matchedAnnouncements.push(p);
      else matchedFeedPosts.push(p);
    }
  }

  // Players: exclude disabled, merged, pending, rejected; search only public cricket-profile fields
  const matchedPlayers = players
    .filter((pl) => {
      if (pl.disabled || pl.mergedInto) return false;
      if (pl.inviteStatus === "Pending" || pl.inviteStatus === "Rejected") return false;
      const wicketKeeperText = pl.isWicketKeeper ? "wicket keeper wk" : "";
      return (
        pl.name?.toLowerCase().includes(q) ||
        pl.kavachId?.toLowerCase().includes(q) ||
        pl.jerseyName?.toLowerCase().includes(q) ||
        (pl.jerseyNumber != null && String(pl.jerseyNumber).toLowerCase().includes(q)) ||
        pl.battingStyle?.toLowerCase().includes(q) ||
        pl.bowlingStyle?.toLowerCase().includes(q) ||
        wicketKeeperText.includes(q)
      );
    })
    .map((pl) => toPublicPlayer(pl as unknown as Record<string, unknown> & { id: string; name?: string }));

  // Grounds: strip organiserName / organiserPhone / gpayNumber from player search results
  const matchedGrounds: PublicGroundSearchItem[] = grounds
    .filter((g) => {
      const anyGround = g as Record<string, unknown>;
      const locationText = [anyGround.location, anyGround.address, anyGround.city]
        .filter((v): v is string => typeof v === "string")
        .join(" ")
        .toLowerCase();
      return g.name?.toLowerCase().includes(q) || locationText.includes(q);
    })
    .map((g) => {
      const anyGround = g as Record<string, unknown>;
      const location = [anyGround.location, anyGround.address, anyGround.city].find(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      return {
        id: g.id,
        name: g.name,
        mapUrl: g.mapUrl || undefined,
        ...(location ? { location } : {}),
      };
    });

  // Polls / Pulse: active polls + recently closed polls visible in Player Pulse (30-day window)
  // Strip any voter identities / response fields
  const matchedPolls: PublicPollSearchItem[] =
    isFeatureEnabled("polls") && isFeatureEnabled("opinion")
      ? orderPulsePolls(polls, now)
        .filter(
          (poll) =>
            poll.title?.toLowerCase().includes(q) ||
            (poll.options || []).some((opt) => opt.toLowerCase().includes(q)),
        )
        .map((poll) => ({
          id: poll.id,
          title: poll.title,
          type: poll.type,
          options: poll.options,
          isActive: Boolean(poll.isActive),
          isSticked: Boolean(poll.isSticked),
          createdAt: poll.createdAt,
        }))
    : [];

  return {
    matches: matchedMatches,
    tournaments: matchedTournaments,
    announcements: matchedAnnouncements,
    feedPosts: matchedFeedPosts,
    players: matchedPlayers,
    grounds: matchedGrounds,
    polls: matchedPolls,
  };
}
