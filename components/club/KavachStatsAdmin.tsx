"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Edit3, Plus, Trash2, AlertTriangle, Check, X } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { authedFetch } from "@/lib/authed-fetch";
import { useToast } from "@/components/ui/Toast";
import {
  findDuplicatePlayerStats,
  isEligibleForNewStats,
  validatePlayerStatInput,
} from "@/lib/kavach-stats-validation";
import { getAvailableStatYears } from "@/lib/kavach-stats";
import type { PlayerStat } from "@/lib/types";

export function KavachStatsAdmin({ store }: { store: ReturnType<typeof useStore> }) {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();

  const [playerId, setPlayerId] = useState("");
  const [year, setYear] = useState(String(currentYear));
  const [runs, setRuns] = useState("0");
  const [wickets, setWickets] = useState("0");
  const [editingStatId, setEditingStatId] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<"all" | number>("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    store.ensurePlayerStats?.();
  }, [store]);

  const activePlayers = useMemo(
    () =>
      store.players
        .filter((p) => isEligibleForNewStats(p))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [store.players],
  );

  const playerMap = useMemo(
    () => new Map(store.players.map((p) => [p.id, p])),
    [store.players],
  );

  const availableYears = useMemo(
    () => getAvailableStatYears(store.playerStats),
    [store.playerStats],
  );

  const duplicates = useMemo(
    () => findDuplicatePlayerStats(store.playerStats),
    [store.playerStats],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...store.playerStats]
      .filter((s) => {
        if (yearFilter !== "all" && s.year !== yearFilter) return false;
        if (!q) return true;
        const p = playerMap.get(s.playerId);
        return (
          p?.name?.toLowerCase().includes(q) ||
          p?.kavachId?.toLowerCase().includes(q) ||
          String(s.year).includes(q)
        );
      })
      .sort((a, b) => b.year - a.year || (playerMap.get(a.playerId)?.name || "").localeCompare(playerMap.get(b.playerId)?.name || ""));
  }, [store.playerStats, yearFilter, search, playerMap]);

  const resetForm = () => {
    setEditingStatId(null);
    setPlayerId("");
    setYear(String(currentYear));
    setRuns("0");
    setWickets("0");
    setFormError(null);
  };

  const handleEdit = (row: PlayerStat) => {
    setEditingStatId(row.id);
    setPlayerId(row.playerId);
    setYear(String(row.year));
    setRuns(String(row.runs ?? 0));
    setWickets(String(row.wickets ?? 0));
    setFormError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = validatePlayerStatInput({ playerId, year, runs, wickets }, currentYear);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }

    const targetPlayer = playerMap.get(parsed.value.playerId);
    if (!isEligibleForNewStats(targetPlayer)) {
      setFormError("Disabled or merged players cannot receive statistics.");
      return;
    }

    setSaving(true);
    try {
      const res = await authedFetch("/api/admin/player-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...parsed.value,
          ...(editingStatId ? { statId: editingStatId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save KAvach Stats.");
      if (data.stat?.duplicateWarning) {
        toast(data.stat.duplicateWarning, "error");
      } else {
        toast(
          editingStatId ? "Player statistics updated." : "Player statistics saved.",
          "success",
        );
      }
      resetForm();
    } catch (err: any) {
      const msg = err?.message || "Could not save player statistics.";
      setFormError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (statId: string) => {
    setDeletingId(statId);
    try {
      const res = await authedFetch(`/api/admin/player-stats?statId=${encodeURIComponent(statId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete stat record.");
      toast("Stat record deleted.", "success");
      if (editingStatId === statId) resetForm();
    } catch (err: any) {
      toast(err?.message || "Could not delete stat record.", "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section
      data-testid="admin-kavach-stats"
      className="bg-surface border border-border rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-text-primary flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-scarlet" />
            KAvach Stats Management
          </h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Add or correct year-wise player runs and wickets. Player Club totals update automatically.
          </p>
        </div>
      </div>

      {duplicates.length > 0 && (
        <div
          data-testid="kavach-stats-duplicates-alert"
          className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Duplicate records detected:</span>{" "}
            {duplicates
              .map((d) => `${playerMap.get(d.playerId)?.name || d.playerId} (${d.year} × ${d.records.length})`)
              .join(", ")}
            . Delete the extra row below to keep totals accurate.
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="rounded-xl bg-surface-hover/60 border border-border p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            {editingStatId ? "Edit Player Stat Record" : "Add / Update Player Stat"}
          </p>
          {editingStatId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs font-semibold text-text-secondary hover:text-text-primary flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> Cancel edit
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-text-secondary mb-1">Player</label>
            <select
              data-testid="kavach-stats-player-select"
              value={playerId}
              disabled={Boolean(editingStatId)}
              onChange={(e) => setPlayerId(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary disabled:opacity-60"
            >
              <option value="">Select active player…</option>
              {activePlayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.kavachId ? `(${p.kavachId})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-text-secondary mb-1">Year</label>
            <input
              data-testid="kavach-stats-year-input"
              type="number"
              min={1990}
              max={currentYear + 1}
              step={1}
              disabled={Boolean(editingStatId)}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary disabled:opacity-60"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-text-secondary mb-1">Runs</label>
              <input
                data-testid="kavach-stats-runs-input"
                type="number"
                min={0}
                step={1}
                value={runs}
                onChange={(e) => setRuns(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-text-secondary mb-1">Wickets</label>
              <input
                data-testid="kavach-stats-wickets-input"
                type="number"
                min={0}
                step={1}
                value={wickets}
                onChange={(e) => setWickets(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-border bg-surface px-3 text-sm text-text-primary"
              />
            </div>
          </div>
        </div>

        {formError && (
          <p className="text-xs font-semibold text-red-600" role="alert">
            {formError}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            data-testid="kavach-stats-save-btn"
            className="min-h-[42px] px-4 rounded-xl bg-scarlet hover:bg-scarlet/90 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {editingStatId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {saving ? "Saving…" : editingStatId ? "Save Changes" : "Save Stat"}
          </button>
        </div>
      </form>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <input
          type="search"
          placeholder="Filter by player or year…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64 min-h-[38px] rounded-xl border border-border bg-surface px-3 text-xs text-text-primary"
        />
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setYearFilter("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer ${
              yearFilter === "all" ? "bg-scarlet text-white border-scarlet" : "bg-surface text-text-primary border-border"
            }`}
          >
            All Years
          </button>
          {availableYears.map((yr) => (
            <button
              key={yr}
              type="button"
              onClick={() => setYearFilter(yr)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer ${
                yearFilter === yr ? "bg-scarlet text-white border-scarlet" : "bg-surface text-text-primary border-border"
              }`}
            >
              {yr}
            </button>
          ))}
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className="text-xs text-text-secondary py-4 text-center">No KAvach statistics recorded yet.</p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
          {filteredRows.map((row) => {
            const p = playerMap.get(row.playerId);
            const inactive = !isEligibleForNewStats(p);
            return (
              <div
                key={row.id}
                data-testid={`kavach-stat-row-${row.id}`}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-surface text-xs"
              >
                <div className="min-w-0">
                  <p className="font-bold text-text-primary truncate">
                    {p?.name || "Missing player"}
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-surface-hover font-mono text-[10px] text-text-secondary">
                      {row.year}
                    </span>
                    {inactive && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">
                        Inactive
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-text-secondary mt-0.5 tabular-nums">
                    {row.runs} runs · {row.wickets} wickets
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!inactive && (
                    <button
                      type="button"
                      onClick={() => handleEdit(row)}
                      aria-label={`Edit stats for ${p?.name || row.playerId}`}
                      className="min-w-[36px] min-h-[36px] rounded-lg border border-border hover:bg-surface-hover flex items-center justify-center text-text-primary cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={deletingId === row.id}
                    onClick={() => handleDelete(row.id)}
                    aria-label={`Delete stats for ${p?.name || row.playerId}`}
                    className="min-w-[36px] min-h-[36px] rounded-lg border border-border hover:bg-red-50 text-red-600 flex items-center justify-center cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
