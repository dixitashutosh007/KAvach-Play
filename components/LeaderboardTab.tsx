import { useStore } from "@/hooks/useStore";
import { Trophy, Medal, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Player, Badge } from "@/lib/types";
import { BadgeIcon, getBadgeMeta, getBadgeTierColors, getStackableSet } from "./BadgeIcon";
import { rankLeaderboard, countBadgesByPlayer } from "@/lib/leaderboard";

type Category = "runs" | "wickets" | "stunning" | "dropped" | "badges";

const PAGE_SIZE = 10;
const MAX_ENTRIES = 30;

const CATEGORY_CONFIG: Record<Category, {
  label: string;
  shortLabel: string;
  field: keyof Player | "badgeCount";
  unit: string;
  accent: string;
  valueColor: string;
  emoji: string;
}> = {
  runs:     { label: "Top Runs",           shortLabel: "Runs",    field: "totalRuns",       unit: "Runs",    accent: "accent",      valueColor: "text-accent",      emoji: "🏏" },
  wickets:  { label: "Top Wickets",        shortLabel: "Wkts",    field: "totalWickets",    unit: "Wkts",    accent: "accent",      valueColor: "text-accent",      emoji: "🎳" },
  stunning: { label: "Stunning Catches",   shortLabel: "Stunning",field: "stunningCatches", unit: "Catches", accent: "emerald-400", valueColor: "text-emerald-400", emoji: "🧤" },
  dropped:  { label: "Dropped Catches",    shortLabel: "Drops",   field: "droppedCatches",  unit: "Drops",   accent: "red-400",     valueColor: "text-red-400",     emoji: "🫳" },
  badges:   { label: "Most Badges",        shortLabel: "Badge",   field: "badgeCount",      unit: "Badges",  accent: "yellow-400",  valueColor: "text-yellow-400",  emoji: "🏅" },
};

export function LeaderboardTab({
  store,
  persona,
}: {
  store: ReturnType<typeof useStore>;
  persona?: "admin" | "player";
}) {
  const showCricketStats = store.appConfig?.features?.cricketStatsLeaderboard !== false;
  const availableCategories = useMemo(() => {
    const all = Object.keys(CATEGORY_CONFIG) as Category[];
    if (showCricketStats) return all;
    return all.filter(c => c !== "runs" && c !== "wickets");
  }, [showCricketStats]);

  const [category, setCategory] = useState<Category>(availableCategories[0]);
  const [page, setPage] = useState(0);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  useEffect(() => {
    if (!availableCategories.includes(category)) {
      setCategory(availableCategories[0]);
      setPage(0);
    }
  }, [availableCategories, category]);

  const badgeCounts = useMemo(() => countBadgesByPlayer(store.badges), [store.badges]);

  const sorted = useMemo(
    () => rankLeaderboard(store.players, category, badgeCounts).slice(0, MAX_ENTRIES),
    [store.players, category, badgeCounts],
  );

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const cfg = CATEGORY_CONFIG[category];
  const isDropped = category === "dropped";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-text-primary flex items-center gap-2">
          <Trophy className="w-5 h-5 text-accent" /> Leaderboard
        </h2>
      </div>

      <div className="flex bg-surface-hover rounded-lg p-1 border border-border overflow-x-auto no-scrollbar">
        {availableCategories.map(cat => (
          <button
            key={cat}
            onClick={() => { setCategory(cat); setPage(0); }}
            className={`flex-1 min-w-0 text-[10px] font-bold uppercase py-2 px-1 rounded-md transition flex items-center justify-center gap-1 whitespace-nowrap ${
              category === cat
                ? cat === "dropped" ? "bg-red-500/20 text-red-400" : "bg-accent text-text-accent"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <span>{CATEGORY_CONFIG[cat].emoji}</span>
            <span className="hidden sm:inline">{CATEGORY_CONFIG[cat].shortLabel}</span>
            <span className="sm:hidden">{CATEGORY_CONFIG[cat].shortLabel.slice(0, 4)}</span>
          </button>
        ))}
      </div>

      <div className={`bg-surface rounded-xl overflow-hidden divide-y divide-border ${isDropped ? "border border-red-500/20" : ""}`}>
        <div className={`flex items-center px-4 py-3 font-bold text-[10px] uppercase tracking-widest ${isDropped ? "bg-red-500/5 text-red-300/70" : "bg-surface-hover text-text-secondary"}`}>
          <div className="w-8 text-center">#</div>
          <div className="flex-1">Player</div>
          <div className="w-20 text-right">{cfg.unit}</div>
        </div>

        {pageItems.length === 0 && (
          <div className="py-8 text-center text-sm text-text-muted">
            No data yet. Update player stats from Club &gt; Squad &gt; Table View.
          </div>
        )}

        {pageItems.map((entry, idx) => {
          const rank = page * PAGE_SIZE + idx + 1;
          const isBadgeCategory = category === "badges";
          return (
            <div
              key={entry.player.id}
              onClick={isBadgeCategory ? () => setSelectedPlayerId(entry.player.id) : undefined}
              className={`flex items-center px-4 py-3 group transition ${isBadgeCategory ? "cursor-pointer" : ""} ${isDropped ? "hover:bg-red-500/5" : "hover:bg-surface-hover"}`}
            >
              <div className="w-8 text-center text-[12px] font-bold text-text-muted group-hover:text-text-primary transition">
                {rank === 1 ? (
                  <Medal className={`w-4 h-4 mx-auto ${isDropped ? "text-red-400" : "text-yellow-400"}`} />
                ) : rank === 2 ? (
                  <Medal className={`w-4 h-4 mx-auto ${isDropped ? "text-red-300" : "text-slate-300"}`} />
                ) : rank === 3 ? (
                  <Medal className={`w-4 h-4 mx-auto ${isDropped ? "text-red-200" : "text-amber-600"}`} />
                ) : (
                  rank
                )}
              </div>
              <div className="flex-1 font-semibold text-text-primary ml-2 text-[14px] truncate">
                {entry.player.name}
              </div>
              <div className={`w-20 text-right font-mono font-bold text-[16px] ${cfg.valueColor}`}>
                {entry.value.toLocaleString()}
              </div>
              {isBadgeCategory && (
                <ChevronRight className="w-4 h-4 text-text-primary/30 group-hover:text-text-secondary ml-1 transition" />
              )}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1.5 rounded-lg bg-surface-hover border border-border text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-text-muted font-bold">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="p-1.5 rounded-lg bg-surface-hover border border-border text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {selectedPlayerId && (
        <PlayerBadgesModal
          playerId={selectedPlayerId}
          playerName={store.players.find(p => p.id === selectedPlayerId)?.name || "Player"}
          badges={store.badges}
          badgeTypeDefs={store.badgeTypeDefs}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </div>
  );
}

function PlayerBadgesModal({
  playerId,
  playerName,
  badges,
  badgeTypeDefs,
  onClose,
}: {
  playerId: string;
  playerName: string;
  badges: Badge[];
  badgeTypeDefs: import("@/lib/types").BadgeTypeDef[];
  onClose: () => void;
}) {
  const playerBadges = badges.filter(b => b.playerId === playerId);
  const stackable = getStackableSet(badgeTypeDefs);

  const grouped = new Map<string, Badge[]>();
  playerBadges.forEach(b => {
    const arr = grouped.get(b.badgeType) || [];
    arr.push(b);
    grouped.set(b.badgeType, arr);
  });

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl border border-border w-full max-w-md max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="font-bold text-text-primary text-lg">{playerName}</h3>
            <p className="text-xs text-text-muted">{playerBadges.length} badge{playerBadges.length !== 1 ? "s" : ""} earned</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {playerBadges.length === 0 ? (
          <div className="py-10 text-center text-sm text-text-muted">
            No badges yet.
          </div>
        ) : (
          <div className="p-5">
            <div className="flex flex-wrap gap-3">
              {Array.from(grouped.entries()).map(([badgeType, bList]) => {
                const meta = getBadgeMeta(badgeType, badgeTypeDefs);
                const colors = getBadgeTierColors(meta.tier);
                const count = stackable.has(badgeType) ? bList.length : undefined;
                return (
                  <div
                    key={badgeType}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-surface-hover min-w-[80px]"
                  >
                    <div className="relative">
                      <BadgeIcon badgeType={badgeType} size={48} customDefs={badgeTypeDefs} />
                      {count && count > 1 && (
                        <span
                          className="absolute -top-1 -right-1 text-[9px] font-bold rounded-full px-1 min-w-[16px] text-center"
                          style={{ background: colors.bg, color: "#000" }}
                        >
                          x{count}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-text-secondary text-center leading-tight font-medium">
                      {meta.short}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
