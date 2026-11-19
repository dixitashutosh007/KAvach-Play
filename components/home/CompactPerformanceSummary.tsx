"use client";

import { useMemo } from "react";
import { Trophy, ChevronRight, Activity, Flame } from "lucide-react";
import { Player, Match, MatchPayment, PlayerStat } from "@/lib/types";

export function CompactPerformanceSummary({
  player,
  matches = [],
  payments = [],
  playerStats = [],
  onViewFullProfile,
}: {
  player: Player | null;
  matches?: Match[];
  payments?: MatchPayment[];
  playerStats?: PlayerStat[];
  onViewFullProfile: () => void;
}) {
  // Aggregate real stats
  const performance = useMemo(() => {
    if (!player) {
      return {
        matchesPlayed: 0,
        runs: 0,
        wickets: 0,
        catches: 0,
        hasStats: false,
      };
    }

    // 1. Matches played: count matches where player participated (confirmed squad or paid payment record)
    const playedMatches = matches.filter(
      (m) =>
        m.result &&
        m.result !== "Pending" &&
        m.result !== "Abandoned" &&
        payments.some(
          (p) =>
            p.playerId === player.id &&
            p.matchId === m.id &&
            (p.status === "Paid" ||
              p.availability === "Confirmed" ||
              (p.status !== "Not Playing" && p.status !== "Waived"))
        )
    );
    const matchesPlayed = playedMatches.length;

    // 2. Runs & Wickets from player or playerStats
    const pStat = playerStats.find((s) => s.playerId === player.id);
    const runs = player.totalRuns ?? pStat?.runs ?? 0;
    const wickets = player.totalWickets ?? pStat?.wickets ?? 0;
    const catches = (player.stunningCatches ?? 0) + (player.droppedCatches ? 0 : 0);

    const hasStats = matchesPlayed > 0 || runs > 0 || wickets > 0 || catches > 0;

    return {
      matchesPlayed,
      runs,
      wickets,
      catches,
      hasStats,
    };
  }, [player, matches, payments, playerStats]);

  return (
    <section
      data-testid="compact-performance-summary"
      aria-label="Personal Performance Summary"
      className="w-full bg-surface border border-border rounded-2xl p-4 shadow-xs"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-soft-blush flex items-center justify-center">
            <Trophy className="w-3.5 h-3.5 text-scarlet" />
          </div>
          <h2 className="text-xs sm:text-sm font-bold text-text-primary uppercase tracking-wider font-heading">
            Personal Performance
          </h2>
        </div>

        <button
          type="button"
          onClick={onViewFullProfile}
          className="min-h-[44px] inline-flex items-center gap-1 text-xs font-bold text-scarlet hover:text-deep-wine transition px-1 cursor-pointer"
        >
          <span>Digital Pass</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {performance.hasStats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Matches Played */}
          <div className="bg-canvas-warm/70 border border-border/80 rounded-xl p-2.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Matches
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl sm:text-2xl font-black font-heading text-text-primary">
                {performance.matchesPlayed}
              </span>
              <span className="text-[10px] font-bold text-text-secondary">caps</span>
            </div>
          </div>

          {/* Runs Scored */}
          {performance.runs > 0 ? (
            <div className="bg-canvas-warm/70 border border-border/80 rounded-xl p-2.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                Runs
              </span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-xl sm:text-2xl font-black font-heading text-deep-wine">
                  {performance.runs}
                </span>
                <span className="text-[10px] font-bold text-text-secondary">scored</span>
              </div>
            </div>
          ) : (
            <div className="bg-canvas-warm/70 border border-border/80 rounded-xl p-2.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                Batting
              </span>
              <span className="text-xs font-bold text-text-primary mt-1 truncate">
                {player?.battingStyle || "RHB"}
              </span>
            </div>
          )}

          {/* Wickets Taken */}
          {performance.wickets > 0 ? (
            <div className="bg-canvas-warm/70 border border-border/80 rounded-xl p-2.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                Wickets
              </span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-xl sm:text-2xl font-black font-heading text-scarlet">
                  {performance.wickets}
                </span>
                <span className="text-[10px] font-bold text-text-secondary">taken</span>
              </div>
            </div>
          ) : (
            <div className="bg-canvas-warm/70 border border-border/80 rounded-xl p-2.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                Bowling
              </span>
              <span className="text-xs font-bold text-text-primary mt-1 truncate">
                {player?.bowlingStyle || "Medium"}
              </span>
            </div>
          )}

          {/* Highlights / Catches */}
          <div className="bg-canvas-warm/70 border border-border/80 rounded-xl p-2.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Catches
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl sm:text-2xl font-black font-heading text-muted-gold">
                {player?.stunningCatches || 0}
              </span>
              <span className="text-[10px] font-bold text-text-secondary">held</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-canvas-warm/60 border border-border/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-text-secondary font-medium">
            <Activity className="w-4 h-4 text-scarlet" />
            <span>No season match statistics recorded yet.</span>
          </div>
          <button
            type="button"
            onClick={onViewFullProfile}
            className="font-bold text-scarlet hover:underline"
          >
            Update Profile
          </button>
        </div>
      )}
    </section>
  );
}
