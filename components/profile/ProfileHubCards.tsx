"use client";

/**
 * Profile hub cards (D-16): personal performance standing and Studio
 * membership, shown on the Player Profile.
 *
 * Uses existing, verified data only — aggregate player fields
 * (totalRuns, totalWickets, stunningCatches), badge records and Studio
 * membership fields. No per-match performance history exists in the data model,
 * so none is shown (documented as a future enhancement).
 */
import { useMemo } from "react";
import { Trophy, Award, Video, ChevronRight } from "lucide-react";
import type { Player, Badge } from "@/lib/types";
import {
  countBadgesByPlayer,
  getPlayerLeaderboardStanding,
  type LeaderboardCategory,
} from "@/lib/leaderboard";
import { getStudioMembership, type StudioMembershipFields } from "@/lib/studio-membership";
import { dbToInputDate } from "@/lib/utils";

const CATEGORY_LABELS: Record<Exclude<LeaderboardCategory, "dropped">, string> = {
  runs: "Runs",
  wickets: "Wickets",
  stunning: "Stunning catches",
  badges: "Badges",
};

export function ProfilePerformanceCard({
  players,
  badges,
  playerId,
  showCricketStats,
  leaderboardEnabled,
  badgesEnabled,
  onOpenLeaderboard,
  onOpenBadges,
}: {
  players: Player[];
  badges: Badge[];
  playerId: string;
  showCricketStats: boolean;
  leaderboardEnabled: boolean;
  badgesEnabled: boolean;
  onOpenLeaderboard?: () => void;
  onOpenBadges?: () => void;
}) {
  const badgeCounts = useMemo(() => countBadgesByPlayer(badges), [badges]);
  const standings = useMemo(() => {
    const categories: Exclude<LeaderboardCategory, "dropped">[] = showCricketStats
      ? ["runs", "wickets", "stunning", "badges"]
      : ["stunning", "badges"];
    return categories.map((c) => ({
      category: c,
      ...getPlayerLeaderboardStanding(players, playerId, c, badgeCounts),
    }));
  }, [players, playerId, badgeCounts, showCricketStats]);

  return (
    <section
      data-testid="profile-performance-card"
      className="bg-surface rounded-xl sm:border border-border p-5"
      aria-labelledby="profile-performance-title"
    >
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-5 h-5 text-accent" aria-hidden="true" />
        <h3 id="profile-performance-title" className="text-sm font-bold text-text-primary tracking-widest uppercase">
          My Performance
        </h3>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {standings.map((s) => (
          <div key={s.category} className="bg-surface-hover border border-border rounded-xl p-3" data-testid={`profile-standing-${s.category}`}>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{CATEGORY_LABELS[s.category]}</dt>
            <dd className="mt-1">
              <span className="text-lg font-black text-text-primary">{s.value}</span>
              <span className="block text-[11px] text-text-secondary mt-0.5">
                {s.rank !== null ? `Club rank #${s.rank}` : "Not ranked yet"}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {(leaderboardEnabled && onOpenLeaderboard) || (badgesEnabled && onOpenBadges) ? (
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          {leaderboardEnabled && onOpenLeaderboard && (
            <button
              type="button"
              data-testid="profile-open-leaderboard"
              onClick={onOpenLeaderboard}
              className="min-h-[44px] flex-1 inline-flex items-center justify-between gap-2 px-4 rounded-xl border border-border bg-surface hover:bg-surface-hover text-sm font-bold text-text-primary transition cursor-pointer"
            >
              <span className="inline-flex items-center gap-2"><Trophy className="w-4 h-4 text-accent" aria-hidden="true" /> Club leaderboard</span>
              <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
            </button>
          )}
          {badgesEnabled && onOpenBadges && (
            <button
              type="button"
              data-testid="profile-open-badges"
              onClick={onOpenBadges}
              className="min-h-[44px] flex-1 inline-flex items-center justify-between gap-2 px-4 rounded-xl border border-border bg-surface hover:bg-surface-hover text-sm font-bold text-text-primary transition cursor-pointer"
            >
              <span className="inline-flex items-center gap-2"><Award className="w-4 h-4 text-accent" aria-hidden="true" /> Club badges &amp; Hall of Fame</span>
              <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

const STATUS_CLASSES: Record<string, string> = {
  Active: "bg-accent/10 text-accent border border-accent/20",
  Expired: "bg-rose-500/10 text-rose-500 border border-rose-500/20",
  Inactive: "bg-surface-hover text-text-muted border border-border",
  Paused: "bg-amber-500/10 text-amber-600 border border-amber-500/20",
};

export function ProfileStudioCard({
  player,
  appUser,
  onOpenStudio,
}: {
  player: StudioMembershipFields | null | undefined;
  appUser: StudioMembershipFields | null | undefined;
  onOpenStudio?: () => void;
}) {
  const m = getStudioMembership(player, appUser);
  const expiry = m.endDateRaw ? (m.endDateRaw.includes("-") ? dbToInputDate(m.endDateRaw) : m.endDateRaw) : null;

  return (
    <section
      data-testid="profile-studio-card"
      className="bg-surface rounded-xl sm:border border-border p-5"
      aria-labelledby="profile-studio-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Video className="w-5 h-5 text-accent" aria-hidden="true" />
          <h3 id="profile-studio-title" className="text-sm font-bold text-text-primary tracking-widest uppercase">
            Studio Membership
          </h3>
        </div>
        <span
          data-testid="profile-studio-status"
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${STATUS_CLASSES[m.status]}`}
        >
          {m.status}
        </span>
      </div>
      <p className="text-sm text-text-secondary mt-3">
        {m.status === "Inactive"
          ? "You don't have a Studio membership yet."
          : expiry
            ? `${m.status === "Expired" ? "Expired on" : "Valid until"} ${expiry}`
            : "No expiry date on record."}
      </p>
      {onOpenStudio && (
        <button
          type="button"
          data-testid="profile-open-studio"
          onClick={onOpenStudio}
          className="mt-4 min-h-[44px] w-full inline-flex items-center justify-between gap-2 px-4 rounded-xl border border-border bg-surface hover:bg-surface-hover text-sm font-bold text-text-primary transition cursor-pointer"
        >
          <span>{m.status === "Inactive" ? "View Studio plans" : "Manage membership"}</span>
          <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
