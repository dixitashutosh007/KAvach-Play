"use client";

/**
 * Admin → Club → Club Statistics (`components/ClubStatisticsAdmin.tsx`).
 *
 * Club Admins / Super Admins maintain exact totals; win rate is calculated.
 * Saves go through POST /api/admin/club-stats, which re-validates and enforces
 * the Club Admin role server-side.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { BarChart3, Loader2, Save } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { useClubStats } from "@/hooks/useClubStats";
import { useToast } from "@/components/ui/Toast";
import { computeWinRate, formatWinRate, validateClubStatsInput } from "@/lib/club-stats";

export function ClubStatisticsAdmin() {
  const { stats, updatedAt, loading, error: loadError } = useClubStats();
  const { toast } = useToast();
  const [played, setPlayed] = useState("");
  const [won, setWon] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Load saved values into the form (until the admin starts editing).
  useEffect(() => {
    if (!touched && stats) {
      setPlayed(String(stats.matchesPlayed));
      setWon(String(stats.matchesWon));
    }
  }, [stats, touched]);

  const validation = validateClubStatsInput({ matchesPlayed: played, matchesWon: won });
  const preview = validation.ok ? computeWinRate(validation.value.matchesPlayed, validation.value.matchesWon) : null;
  const unchanged =
    validation.ok &&
    stats !== null &&
    validation.value.matchesPlayed === stats.matchesPlayed &&
    validation.value.matchesWon === stats.matchesWon;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!validation.ok || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      const res = await authedFetch("/api/admin/club-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.value),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError(data?.error || "Club statistics could not be saved.");
        return;
      }
      setTouched(false);
      toast("Club statistics saved", "success");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Club statistics could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-lg font-black tabular-nums text-text-primary focus:outline-none focus:ring-2 focus:ring-scarlet/30 focus:border-scarlet";

  return (
    <section className="bg-surface border border-border rounded-2xl p-4 sm:p-6 shadow-xs max-w-xl" data-testid="club-statistics-admin">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="w-4 h-4 text-scarlet" aria-hidden="true" />
        <h2 className="text-sm font-black uppercase tracking-wider text-text-primary font-heading">Club Statistics</h2>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        Enter the club&apos;s exact all-time totals. They appear on every member&apos;s Home screen. Win rate is
        calculated automatically.
      </p>

      {loadError && (
        <p role="alert" className="mb-3 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Saved statistics could not be loaded. You can still enter and save new values.
        </p>
      )}

      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Matches played</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={played}
              disabled={loading}
              onChange={(e) => {
                setTouched(true);
                setPlayed(e.target.value.replace(/[^\d]/g, ""));
              }}
              className={inputCls}
              data-testid="club-stats-played"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Matches won</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={won}
              disabled={loading}
              onChange={(e) => {
                setTouched(true);
                setWon(e.target.value.replace(/[^\d]/g, ""));
              }}
              className={inputCls}
              data-testid="club-stats-won"
            />
          </label>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-surface-hover px-3 py-2.5">
          <span className="text-xs font-bold text-text-secondary">Win rate (calculated)</span>
          <span className="text-lg font-black tabular-nums text-scarlet" data-testid="club-stats-winrate-preview">
            {formatWinRate(preview)}
          </span>
        </div>

        {touched && !validation.ok && (
          <p role="alert" className="text-xs font-medium text-rose-700">
            {validation.error}
          </p>
        )}
        {serverError && (
          <p role="alert" className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {serverError}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] text-text-muted" data-testid="club-stats-updated">
            {loading
              ? "Loading…"
              : updatedAt
                ? `Last updated ${format(updatedAt, "d MMM yyyy, h:mm a")}`
                : stats
                  ? "Last updated: unknown"
                  : "Not set yet — the Home widget stays hidden until you save."}
          </span>
          <button
            type="submit"
            disabled={saving || loading || !validation.ok || unchanged}
            className="min-h-[44px] px-5 rounded-xl bg-scarlet text-white text-xs font-bold uppercase tracking-wider hover:bg-deep-wine disabled:opacity-50 cursor-pointer inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
            Save
          </button>
        </div>
      </form>
    </section>
  );
}
