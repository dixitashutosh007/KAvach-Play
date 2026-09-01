import { useStore } from "@/hooks/useStore";
import { Trophy, Medal, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Player } from "@/lib/types";

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

  useEffect(() => {
    if (!availableCategories.includes(category)) {
      setCategory(availableCategories[0]);
      setPage(0);
    }
  }, [availableCategories, category]);

  const activePlayers = useMemo(
    () => store.players.filter(p => !p.disabled && p.inviteStatus !== "Pending"),
    [store.players],
  );

  const badgeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of store.badges) {
      counts.set(b.playerId, (counts.get(b.playerId) || 0) + 1);
    }
    return counts;
  }, [store.badges]);

  const sorted = useMemo(() => {
    const cfg = CATEGORY_CONFIG[category];
    const list = activePlayers.map(p => {
      const value = cfg.field === "badgeCount"
        ? (badgeCounts.get(p.id) || 0)
        : ((p as any)[cfg.field] || 0) as number;
      return { player: p, value };
    });
    list.sort((a, b) => b.value - a.value);
    return list.filter(e => e.value > 0).slice(0, MAX_ENTRIES);
  }, [activePlayers, category, badgeCounts]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const cfg = CATEGORY_CONFIG[category];
  const isDropped = category === "dropped";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <Trophy className="w-5 h-5 text-accent" /> Leaderboard
        </h2>
      </div>

      <div className="flex bg-black/40 rounded-lg p-1 border border-glass-border overflow-x-auto no-scrollbar">
        {availableCategories.map(cat => (
          <button
            key={cat}
            onClick={() => { setCategory(cat); setPage(0); }}
            className={`flex-1 min-w-0 text-[10px] font-bold uppercase py-2 px-1 rounded-md transition flex items-center justify-center gap-1 whitespace-nowrap ${
              category === cat
                ? cat === "dropped" ? "bg-red-500/20 text-red-400" : "bg-accent text-black"
                : "text-white/50 hover:text-white"
            }`}
          >
            <span>{CATEGORY_CONFIG[cat].emoji}</span>
            <span className="hidden sm:inline">{CATEGORY_CONFIG[cat].shortLabel}</span>
            <span className="sm:hidden">{CATEGORY_CONFIG[cat].shortLabel.slice(0, 4)}</span>
          </button>
        ))}
      </div>

      <div className={`glass rounded-xl overflow-hidden divide-y divide-glass-border ${isDropped ? "border border-red-500/20" : ""}`}>
        <div className={`flex items-center px-4 py-3 font-bold text-[10px] uppercase tracking-widest ${isDropped ? "bg-red-500/5 text-red-300/70" : "bg-white/5 text-white/70"}`}>
          <div className="w-8 text-center">#</div>
          <div className="flex-1">Player</div>
          <div className="w-20 text-right">{cfg.unit}</div>
        </div>

        {pageItems.length === 0 && (
          <div className="py-8 text-center text-sm text-white/50">
            No data yet. Update player stats from Club &gt; Squad &gt; Table View.
          </div>
        )}

        {pageItems.map((entry, idx) => {
          const rank = page * PAGE_SIZE + idx + 1;
          return (
            <div
              key={entry.player.id}
              className={`flex items-center px-4 py-3 group transition ${isDropped ? "hover:bg-red-500/5" : "hover:bg-white/5"}`}
            >
              <div className="w-8 text-center text-[12px] font-bold text-white/40 group-hover:text-white/80 transition">
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
              <div className="flex-1 font-semibold text-white ml-2 text-[14px] truncate">
                {entry.player.name}
              </div>
              <div className={`w-20 text-right font-mono font-bold text-[16px] ${cfg.valueColor}`}>
                {entry.value.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1.5 rounded-lg bg-white/5 border border-glass-border text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-white/50 font-bold">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="p-1.5 rounded-lg bg-white/5 border border-glass-border text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
