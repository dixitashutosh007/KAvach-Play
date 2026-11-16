"use client";

import { useState, useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { authedFetch } from "@/lib/authed-fetch";
import { Match } from "@/lib/types";
import { dbToInputDate, inputToDbDate } from "@/lib/utils";

type SheetFilter = "past_3m" | "past_all" | "next_1m" | "next_3m" | "next_6m" | "next_all";

const SHEET_FILTER_LABELS: Record<SheetFilter, string> = {
  past_3m: "Past 3 Months",
  past_all: "Past All",
  next_1m: "Next 1 Month",
  next_3m: "Next 3 Months",
  next_6m: "Next 6 Months",
  next_all: "Next All",
};

export function MatchSheetView({ store }: { store: ReturnType<typeof useStore> }) {
  const [dirty, setDirty] = useState<Map<string, Partial<Match>>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{
    phase: "db" | "calendar";
    current: number;
    total: number;
  } | null>(null);
  const [saveResult, setSaveResult] = useState("");
  const [filter, setFilter] = useState<SheetFilter>("next_3m");

  const getVal = (match: Match, field: keyof Match) => {
    const dirtyRow = dirty.get(match.id);
    if (dirtyRow && field in dirtyRow) return (dirtyRow as any)[field];
    return (match as any)[field];
  };

  const setField = (matchId: string, field: keyof Match, value: any) => {
    setDirty((prev) => {
      const next = new Map(prev);
      const existing = next.get(matchId) || {};
      next.set(matchId, { ...existing, [field]: value });
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveResult("");
    const updates = Array.from(dirty.entries())
      .map(([id, changes]) => {
        const match = store.matches.find(m => m.id === id);
        return match ? { match, changes } : null;
      })
      .filter(Boolean) as { match: Match; changes: Partial<Match> }[];

    try {
      setSaveProgress({ phase: "db", current: 0, total: updates.length });
      await store.bulkUpdateMatches(updates, { skipCalendarSync: true });

      setSaveProgress({ phase: "calendar", current: 0, total: updates.length });
      let calSynced = 0;
      for (const { match } of updates) {
        try {
          await authedFetch("/api/calendar/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "upsert", matchId: match.id }),
          });
          calSynced++;
        } catch {}
        setSaveProgress((p) => p ? { ...p, current: p.current + 1 } : null);
      }
      setDirty(new Map());
      setSaveResult(`Saved ${updates.length} match${updates.length > 1 ? "es" : ""}, ${calSynced} calendar update${calSynced > 1 ? "s" : ""}.`);
    } catch (err: any) {
      setSaveResult(`Save failed: ${err?.message || String(err)}`);
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  };

  const filteredMatches = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const parseMatchDate = (m: Match): Date => {
      const iso = inputToDbDate(dbToInputDate(m.date));
      const d = new Date(iso);
      return isNaN(d.getTime()) ? now : d;
    };

    const addMonths = (d: Date, months: number) => {
      const r = new Date(d);
      r.setMonth(r.getMonth() + months);
      return r;
    };

    let list = store.matches.filter(m => {
      const d = parseMatchDate(m);
      switch (filter) {
        case "past_3m": return d < now && d >= addMonths(now, -3);
        case "past_all": return d < now;
        case "next_1m": return d >= now && d <= addMonths(now, 1);
        case "next_3m": return d >= now && d <= addMonths(now, 3);
        case "next_6m": return d >= now && d <= addMonths(now, 6);
        case "next_all": return d >= now;
        default: return true;
      }
    });

    list.sort((a, b) => {
      const da = new Date(inputToDbDate(dbToInputDate(a.date))).getTime() || 0;
      const db2 = new Date(inputToDbDate(dbToInputDate(b.date))).getTime() || 0;
      return filter.startsWith("past") ? db2 - da : da - db2;
    });

    return list;
  }, [store.matches, filter]);

  const doubleBookedDates = useMemo(() => {
    const tournamentsByDate = new Map<string, number>();
    for (const m of store.matches) {
      if (m.matchType === "Tournament") {
        const iso = inputToDbDate(dbToInputDate(m.date));
        if (iso) tournamentsByDate.set(iso, (tournamentsByDate.get(iso) || 0) + 1);
      }
    }
    const result = new Set<string>();
    for (const [date, count] of tournamentsByDate) {
      if (count >= 2) result.add(date);
    }
    return result;
  }, [store.matches]);

  type SheetRow = { kind: "match"; match: Match } | { kind: "empty"; dateStr: string; dayLabel: string };

  const sheetRows = useMemo<SheetRow[]>(() => {
    const matchRows: SheetRow[] = filteredMatches.map(m => ({ kind: "match" as const, match: m }));

    if (filter.startsWith("past")) return matchRows;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const addMonths = (d: Date, months: number) => {
      const r = new Date(d);
      r.setMonth(r.getMonth() + months);
      return r;
    };
    let endDate: Date;
    switch (filter) {
      case "next_1m": endDate = addMonths(now, 1); break;
      case "next_3m": endDate = addMonths(now, 3); break;
      case "next_6m": endDate = addMonths(now, 6); break;
      default: endDate = addMonths(now, 12); break;
    }

    const matchDateSet = new Set<string>();
    for (const m of filteredMatches) {
      matchDateSet.add(inputToDbDate(dbToInputDate(m.date)));
    }

    const emptySlots: SheetRow[] = [];
    const cursor = new Date(now);
    while (cursor <= endDate) {
      const dow = cursor.getDay();
      if (dow === 0 || dow === 6) {
        const y = cursor.getFullYear();
        const mo = String(cursor.getMonth() + 1).padStart(2, "0");
        const da = String(cursor.getDate()).padStart(2, "0");
        const iso = `${y}-${mo}-${da}`;
        if (!matchDateSet.has(iso)) {
          const dayLabel = cursor.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
          emptySlots.push({ kind: "empty", dateStr: iso, dayLabel });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    const all = [...matchRows, ...emptySlots];
    all.sort((a, b) => {
      const da = a.kind === "match" ? inputToDbDate(dbToInputDate(a.match.date)) : a.dateStr;
      const db2 = b.kind === "match" ? inputToDbDate(dbToInputDate(b.match.date)) : b.dateStr;
      if (da !== db2) return da < db2 ? -1 : 1;
      if (a.kind === "empty") return 1;
      if (b.kind === "empty") return -1;
      return 0;
    });

    return all;
  }, [filteredMatches, filter]);

  const isValidUrl = (val: string) => {
    if (!val) return true;
    try { new URL(val); return true; } catch { return false; }
  };

  const autoCalcFee = (matchId: string, groundId: string, matchType: string) => {
    const ground = store.grounds.find(g => g.id === groundId);
    if (!ground) return;
    const groundFee = matchType === "Practice" ? (ground.practiceFee || 0) : (ground.tournamentFee || 0);
    if (groundFee > 0) {
      setField(matchId, "fee", Math.round((groundFee / 12) * 1.05));
    }
  };

  const inputClass = "bg-transparent border-none text-text-primary text-xs focus:bg-surface-hover focus:outline-none px-2 py-1.5 w-full";
  const selectClass = "bg-transparent border-none text-text-primary text-xs focus:bg-surface-hover focus:outline-none px-1 py-1.5 appearance-none cursor-pointer w-full [&>option]:bg-neutral-950";

  const activeTournaments = store.tournaments.filter(t => t.status === "Ongoing" || t.status === "Upcoming");

  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as SheetFilter)}
          className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-xs font-bold text-text-primary focus:border-accent focus:outline-none [&>option]:bg-neutral-950"
        >
          {(Object.keys(SHEET_FILTER_LABELS) as SheetFilter[]).map(f => (
            <option key={f} value={f}>{SHEET_FILTER_LABELS[f]}</option>
          ))}
        </select>
        <span className="text-xs text-text-muted font-bold">
          {filteredMatches.length} match{filteredMatches.length !== 1 ? "es" : ""}
          {sheetRows.filter(r => r.kind === "empty").length > 0 && (
            <span className="text-text-primary/30"> · {sheetRows.filter(r => r.kind === "empty").length} open slot{sheetRows.filter(r => r.kind === "empty").length !== 1 ? "s" : ""}</span>
          )}
        </span>
      </div>

      <div className="bg-surface rounded-xl overflow-hidden border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] border-collapse">
            <thead>
              <tr className="bg-black/60 text-text-secondary text-[10px] uppercase tracking-wider">
                <th className="text-center px-2 py-2 font-bold w-8">#</th>
                <th className="text-left px-2 py-2 font-bold">Date</th>
                <th className="text-left px-2 py-2 font-bold">Time</th>
                <th className="text-left px-2 py-2 font-bold">Ground</th>
                <th className="text-left px-2 py-2 font-bold">Type</th>
                <th className="text-left px-2 py-2 font-bold">Tournament</th>
                <th className="text-left px-2 py-2 font-bold">Opponent</th>
                <th className="text-center px-2 py-2 font-bold">Format</th>
                <th className="text-center px-2 py-2 font-bold">Jersey</th>
                <th className="text-right px-2 py-2 font-bold">Fee</th>
                <th className="text-center px-2 py-2 font-bold">Squad</th>
                <th className="text-left px-2 py-2 font-bold">Match URL</th>
                <th className="text-left px-2 py-2 font-bold">Stream URL</th>
                <th className="text-center px-2 py-2 font-bold">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sheetRows.length === 0 && (
                <tr>
                  <td colSpan={14} className="py-8 text-center text-sm text-text-muted">
                    No matches in this range.
                  </td>
                </tr>
              )}
              {sheetRows.map((row, idx) => {
                if (row.kind === "empty") {
                  return (
                    <tr key={`empty-${row.dateStr}`} className="bg-white/[0.02]">
                      <td className="text-center text-xs text-text-primary/20 font-mono px-2">-</td>
                      <td className="px-2 py-2 text-xs text-text-primary/30 font-medium" colSpan={2}>{row.dayLabel}</td>
                      <td colSpan={11} className="px-2 py-2 text-xs text-emerald-400/60 italic">Open Slot</td>
                    </tr>
                  );
                }

                const match = row.match;
                const dateVal = inputToDbDate(dbToInputDate(getVal(match, "date")));
                const currentGroundId = getVal(match, "groundId") as string;
                const currentMatchType = getVal(match, "matchType") as string;
                const matchUrlVal = (getVal(match, "matchUrl") || "") as string;
                const streamUrlVal = (getVal(match, "streamingUrl") || "") as string;
                const matchUrlInvalid = matchUrlVal && !isValidUrl(matchUrlVal);
                const streamUrlInvalid = streamUrlVal && !isValidUrl(streamUrlVal);
                const isDoubleBooked = doubleBookedDates.has(dateVal) && currentMatchType === "Tournament";

                return (
                  <tr key={match.id} className={`hover:bg-surface-hover transition ${isDoubleBooked ? "bg-orange-500/10 border-l-2 border-l-orange-400" : ""}`}>
                    <td className="text-center text-xs text-text-muted font-mono px-2">{idx + 1}</td>
                    <td className="bg-transparent px-0">
                      <input
                        type="date"
                        value={dateVal}
                        onChange={e => setField(match.id, "date", e.target.value)}
                        className={`${inputClass} max-w-[130px]`}
                      />
                    </td>
                    <td className="bg-transparent px-0">
                      <input
                        type="time"
                        value={getVal(match, "time") || "07:00"}
                        onChange={e => setField(match.id, "time", e.target.value)}
                        className={`${inputClass} max-w-[100px]`}
                      />
                    </td>
                    <td className="bg-transparent px-0">
                      <select
                        value={currentGroundId}
                        onChange={e => {
                          const newGroundId = e.target.value;
                          setField(match.id, "groundId", newGroundId);
                          autoCalcFee(match.id, newGroundId, currentMatchType);
                        }}
                        className={selectClass}
                      >
                        <option value="">—</option>
                        {store.grounds.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="bg-transparent px-0">
                      <select
                        value={currentMatchType}
                        onChange={e => {
                          const newType = e.target.value as Match["matchType"];
                          setField(match.id, "matchType", newType);
                          if (newType === "Practice") setField(match.id, "tournamentId", "");
                          autoCalcFee(match.id, currentGroundId, newType);
                        }}
                        className={selectClass}
                      >
                        <option value="Practice">Practice</option>
                        <option value="Tournament">Tournament</option>
                      </select>
                    </td>
                    <td className="bg-transparent px-0">
                      <select
                        value={(getVal(match, "tournamentId") || "") as string}
                        disabled={currentMatchType !== "Tournament"}
                        onChange={e => {
                          const tId = e.target.value;
                          setField(match.id, "tournamentId", tId);
                          const t = store.tournaments.find(t => t.id === tId);
                          if (t && t.perPlayerFee) {
                            setField(match.id, "fee", t.perPlayerFee);
                          }
                          if (t?.groundId) setField(match.id, "groundId", t.groundId);
                        }}
                        className={`${selectClass} ${currentMatchType !== "Tournament" ? "opacity-30" : ""}`}
                      >
                        <option value="">— None —</option>
                        {activeTournaments.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="bg-transparent px-0">
                      <input
                        type="text"
                        value={(getVal(match, "opponent") || "") as string}
                        onChange={e => setField(match.id, "opponent", e.target.value)}
                        className={inputClass}
                        placeholder="Opponent"
                      />
                    </td>
                    <td className="bg-transparent px-0">
                      <select
                        value={(getVal(match, "format") || "T30") as string}
                        onChange={e => setField(match.id, "format", e.target.value)}
                        className={selectClass}
                      >
                        <option value="T20">T20</option>
                        <option value="T30">T30</option>
                        <option value="Other">Other</option>
                      </select>
                    </td>
                    <td className="bg-transparent px-0">
                      <select
                        value={(getVal(match, "jerseyColor") || "Scarlet Red") as string}
                        onChange={e => setField(match.id, "jerseyColor", e.target.value)}
                        className={selectClass}
                      >
                        <option value="Scarlet Red">Scarlet Red</option>
                        <option value="Whites">Whites</option>
                      </select>
                    </td>
                    <td className="bg-transparent px-0">
                      <input
                        type="number"
                        min={0}
                        value={getVal(match, "fee") ?? ""}
                        onChange={e => setField(match.id, "fee", e.target.value === "" ? 0 : parseInt(e.target.value) || 0)}
                        className={`${inputClass} max-w-[70px] text-right`}
                        placeholder="₹"
                      />
                    </td>
                    <td className="bg-transparent px-0">
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={getVal(match, "maxSquadSize") ?? 12}
                        onChange={e => setField(match.id, "maxSquadSize", parseInt(e.target.value) || 12)}
                        className={`${inputClass} max-w-[50px] text-center`}
                      />
                    </td>
                    <td className="bg-transparent px-0">
                      <input
                        type="url"
                        value={matchUrlVal}
                        onChange={e => setField(match.id, "matchUrl", e.target.value)}
                        className={`${inputClass} ${matchUrlInvalid ? "text-red-400" : ""}`}
                        placeholder="URL"
                        title={matchUrlInvalid ? "Invalid URL" : ""}
                      />
                    </td>
                    <td className="bg-transparent px-0">
                      <input
                        type="url"
                        value={streamUrlVal}
                        onChange={e => setField(match.id, "streamingUrl", e.target.value)}
                        className={`${inputClass} ${streamUrlInvalid ? "text-red-400" : ""}`}
                        placeholder="URL"
                        title={streamUrlInvalid ? "Invalid URL" : ""}
                      />
                    </td>
                    <td className="bg-transparent px-0">
                      <select
                        value={(getVal(match, "result") || "Pending") as string}
                        onChange={e => setField(match.id, "result", e.target.value)}
                        className={selectClass}
                      >
                        <option value="Pending">Pending</option>
                        <option value="KAvach Won">Won</option>
                        <option value="KAvach Lost">Lost</option>
                        <option value="Draw">Draw</option>
                        <option value="Tie">Tie</option>
                        <option value="Abandoned">Abandoned</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {(dirty.size > 0 || saving || saveResult) && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1.5">
          {saveProgress && (
            <div className="bg-black/90 border border-border rounded-xl px-4 py-2 text-[11px] text-text-secondary min-w-[200px]">
              <div className="flex justify-between mb-1">
                <span>{saveProgress.phase === "db" ? "Saving to database…" : `Calendar ${saveProgress.current}/${saveProgress.total}`}</span>
              </div>
              <div className="h-1.5 w-full bg-surface-hover rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-200 rounded-full"
                  style={{
                    width: saveProgress.phase === "db"
                      ? "100%"
                      : `${saveProgress.total > 0 ? Math.round((saveProgress.current / saveProgress.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          {!saving && saveResult && (
            <div className="bg-black/90 border border-border rounded-xl px-4 py-2 text-[11px] text-emerald-300 font-bold">
              {saveResult}
            </div>
          )}
          {dirty.size > 0 && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-accent text-text-accent font-bold px-6 py-3 rounded-xl shadow-lg hover:bg-accent/90 transition disabled:opacity-50"
            >
              {saving ? "Saving…" : `Save Changes (${dirty.size})`}
            </button>
          )}
        </div>
      )}
    </>
  );
}
