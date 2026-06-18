/**
 * Player Statistics & Rankings (`components/LeaderboardTab.tsx`)
 *
 * Aggregates statistics (runs/wickets) from all recorded matches to construct
 * Top Batsman and Top Bowler leaderboards. Allows filtering by specific years
 * or viewing 'All Time' records. Admins can manually update statistics for
 * given players here. Highlights top 3 performers with special visuals.
 */
import { useStore } from "@/hooks/useStore";
import { Trophy, Medal } from "lucide-react";
import { useState } from "react";

export function LeaderboardTab({
  store,
  persona,
}: {
  store: ReturnType<typeof useStore>;
  persona?: "admin" | "player";
}) {
  const [year, setYear] = useState<number | string>(new Date().getFullYear());
  const years = ["All Time", 2026, 2025, 2024, 2023, 2022];
  const isAdmin = persona === "admin";

  const [view, setView] = useState<"batting" | "bowling" | "performers">("batting");

  const [editPlayerId, setEditPlayerId] = useState<string | null>(null);
  const [editRuns, setEditRuns] = useState<number>(0);
  const [editWickets, setEditWickets] = useState<number>(0);

  const currentStats = store.players.map((p) => {
    let potmCount = 0;
    let tpCount = 0;

    const matchesForYear = store.matches.filter(m => {
      if (year === "All Time") return true;
      if (!m.date) return false;
      return new Date(m.date).getFullYear() === Number(year);
    });

    for (const m of matchesForYear) {
      if (m.potmId === p.id) {
        potmCount += 3;
      }
      if (m.topPerformerIds && m.topPerformerIds.includes(p.id)) {
        tpCount += 1;
      }
    }

    const performerPoints = potmCount + tpCount;

    if (year === "All Time") {
      const allPlayerStats = store.playerStats.filter(
        (s) => s.playerId === p.id,
      );
      return {
        player: p,
        runs: allPlayerStats.reduce((sum, s) => sum + (s.runs || 0), 0),
        wickets: allPlayerStats.reduce((sum, s) => sum + (s.wickets || 0), 0),
        performerPoints,
      };
    } else {
      const stat = store.playerStats.find(
        (s) => s.playerId === p.id && s.year === year,
      );
      return {
        player: p,
        runs: stat?.runs || 0,
        wickets: stat?.wickets || 0,
        performerPoints,
      };
    }
  });

  const sortedStats = [...currentStats].sort((a, b) => {
    if (view === "batting") return b.runs - a.runs;
    if (view === "performers") return b.performerPoints - a.performerPoints;
    return b.wickets - a.wickets;
  });

  const handleEdit = (pId: string, runs: number, wickets: number) => {
    setEditPlayerId(pId);
    setEditRuns(runs);
    setEditWickets(wickets);
  };

  const handleSave = async (pId: string) => {
    if (year === "All Time") return; // Should not happen
    await store.updatePlayerStat(pId, year as number, editRuns, editWickets);
    setEditPlayerId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <Trophy className="w-5 h-5 text-accent" /> Leaderboard
        </h2>
        <select
          value={year}
          onChange={(e) =>
            setYear(
              e.target.value === "All Time"
                ? "All Time"
                : Number(e.target.value),
            )
          }
          className="bg-white/10 border border-glass-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none [&>option]:bg-emerald-950 font-bold"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setView("batting")}
          className={`flex-1 py-2 text-[12px] font-bold uppercase tracking-widest rounded-lg transition border ${view === "batting" ? "bg-accent/20 text-accent border-accent/50" : "bg-transparent text-white/50 border-glass-border hover:bg-white/5 hover:text-white"}`}
        >
          Batting (Runs)
        </button>
        <button
          onClick={() => setView("bowling")}
          className={`flex-1 py-2 text-[12px] font-bold uppercase tracking-widest rounded-lg transition border ${view === "bowling" ? "bg-accent/20 text-accent border-accent/50" : "bg-transparent text-white/50 border-glass-border hover:bg-white/5 hover:text-white"}`}
        >
          Bowling (Wickets)
        </button>
        <button
          onClick={() => setView("performers")}
          className={`flex-1 py-2 text-[12px] font-bold uppercase tracking-widest rounded-lg transition border ${view === "performers" ? "bg-accent/20 text-accent border-accent/50" : "bg-transparent text-white/50 border-glass-border hover:bg-white/5 hover:text-white"}`}
        >
          Performers
        </button>
      </div>

      <div className="glass rounded-xl overflow-hidden divide-y divide-glass-border mt-4">
        <div className="flex items-center px-4 py-3 bg-white/5 font-bold text-[10px] uppercase tracking-widest text-white/70">
          <div className="w-8 text-center">#</div>
          <div className="flex-1">Player</div>
          <div className="w-20 text-right">
            {view === "batting" ? "Runs" : view === "performers" ? "Pts" : "Wickets"}
          </div>
          {isAdmin && year !== "All Time" && view !== "performers" && (
            <div className="w-24 text-right">Action</div>
          )}
        </div>

        {sortedStats.slice(0, 15).map((stat, idx) => {
          const isEditing = editPlayerId === stat.player.id;
          
          let displayValue = 0;
          if (view === "batting") displayValue = stat.runs;
          else if (view === "performers") displayValue = stat.performerPoints;
          else displayValue = stat.wickets;

          return (
            <div
              key={stat.player.id}
              className="flex flex-col hover:bg-white/5 transition"
            >
              <div className="flex items-center px-4 py-3 group relative">
                <div className="w-8 text-center text-[12px] font-bold text-white/40 group-hover:text-white/80 transition">
                  {idx === 0 && displayValue > 0 ? (
                    <Medal className="w-4 h-4 text-yellow-400 mx-auto" />
                  ) : idx === 1 && displayValue > 0 ? (
                    <Medal className="w-4 h-4 text-slate-300 mx-auto" />
                  ) : idx === 2 && displayValue > 0 ? (
                    <Medal className="w-4 h-4 text-amber-600 mx-auto" />
                  ) : (
                    idx + 1
                  )}
                </div>
                <div className="flex-1 font-semibold text-white ml-2 text-[14px] truncate">
                  {stat.player.name}
                </div>
                <div className="w-20 text-right font-mono font-bold text-accent text-[16px]">
                  {displayValue}
                </div>
                {isAdmin && year !== "All Time" && view !== "performers" && (
                  <div className="w-24 text-right flex justify-end">
                    <button
                      onClick={() =>
                        handleEdit(stat.player.id, stat.runs, stat.wickets)
                      }
                      className="text-[10px] px-2.5 py-1 rounded bg-white/10 text-white/70 hover:bg-accent hover:text-black transition uppercase font-bold cursor-pointer"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
              {isAdmin && year !== "All Time" && view !== "performers" && isEditing && (
                <div className="px-4 pb-3.5 pt-1.5 flex flex-wrap gap-2.5 items-center justify-end bg-accent/5 border-t border-glass-border">
                  <span className="text-[10px] uppercase tracking-wider text-accent font-bold mr-auto">
                    Modify Stats ({year})
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase text-white/55 font-bold font-mono">
                      Runs:
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={editRuns}
                      onChange={(e) => setEditRuns(Number(e.target.value))}
                      className="w-14 bg-black/40 border border-glass-border rounded px-2 py-1 text-xs text-white font-mono focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase text-white/55 font-bold font-mono">
                      Wickets:
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={editWickets}
                      onChange={(e) => setEditWickets(Number(e.target.value))}
                      className="w-14 bg-black/40 border border-glass-border rounded px-2 py-1 text-xs text-white font-mono focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-1.5 ml-1 select-none">
                    <button
                      onClick={() => handleSave(stat.player.id)}
                      className="text-[11px] px-2.5 py-1 bg-accent text-black font-extrabold rounded hover:opacity-90 transition cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditPlayerId(null)}
                      className="text-[11px] px-2.5 py-1 bg-white/5 border border-glass-border text-white/60 hover:text-white rounded transition cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {sortedStats.length === 0 && (
          <div className="py-8 text-center text-sm text-white/50">
            No players available. Add players in the Squad tab.
          </div>
        )}
      </div>
    </div>
  );
}
