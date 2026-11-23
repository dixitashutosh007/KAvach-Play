"use client";

/**
 * Sponsorship & subscription report (`components/finance/SponsorshipReport.tsx`).
 *
 * For a date range: match fees, what players owe/paid directly, what
 * subscriptions cover, what the club sponsors (by plan, player and match), and
 * the subscription periods (billed, collected, outstanding, unused club
 * income). Subscription cash is counted once, at the period. Read-only; data
 * from /api/finance/reports/sponsorship.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { getClubCalendarDate } from "@/lib/utils";
import type { SponsorshipReport as Report } from "@/lib/subscription-periods";
import { ErrorNote, FIELD, Metric, inr } from "./FinanceUi";

type Group = "byPlan" | "byPlayer" | "byMatch";
const GROUPS: { value: Group; label: string }[] = [
  { value: "byPlan", label: "By plan" },
  { value: "byPlayer", label: "By player" },
  { value: "byMatch", label: "By match" },
];

export function SponsorshipReport({ todayKey: todayProp }: { todayKey?: string }) {
  const todayKey = todayProp || getClubCalendarDate().dateString;
  const [from, setFrom] = useState(`${todayKey.slice(0, 7)}-01`);
  const [to, setTo] = useState(todayKey);
  const [group, setGroup] = useState<Group>("byPlan");
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/finance/reports/sponsorship?from=${from}&to=${to}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not build the report.");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the report.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Initial load only; later loads are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = data ? data[group] : [];

  return (
    <div className="flex flex-col gap-4" data-testid="finance-sponsorship-report">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-text-secondary">From</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold text-text-secondary">To</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={FIELD} />
        </label>
        <button type="button" onClick={load} disabled={loading} data-testid="report-run" className="min-h-[48px] px-4 rounded-xl bg-brand text-white text-sm font-bold disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5">
          {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Show
        </button>
      </div>

      {error && <ErrorNote message={error} onRetry={load} />}

      {data && (
        <>
          <section className="flex flex-col gap-2" aria-label="Match fees">
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
              Matches · {data.totals.matches} matches, {data.totals.players} players
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric label="Match fees" value={inr(data.totals.matchFees)} />
              <Metric label="Players pay directly" value={inr(data.totals.playerShare)} />
              <Metric label="Covered by subscriptions" value={inr(data.totals.subscriptionCovered)} />
              <Metric label="Club sponsors" value={inr(data.totals.clubSponsored)} tone="success" testId="report-club-sponsored" />
            </div>
            {data.totals.pendingAllocation > 0 && (
              <p className="text-xs text-blue-700">
                {data.totals.pendingAllocation} subscription match{data.totals.pendingAllocation === 1 ? "" : "es"} not allocated yet — amounts are set when the subscription period closes.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2" aria-label="Subscriptions">
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Subscriptions · {data.subscriptions.periods} periods</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric label="Billed" value={inr(data.subscriptions.billed)} />
              <Metric label="Collected" value={inr(data.subscriptions.collected)} tone="success" />
              <Metric label="Outstanding" value={inr(data.subscriptions.outstanding)} tone="warning" />
              <Metric label="Unused (club income)" value={inr(data.subscriptions.unusedIncome)} />
            </div>
            <p className="text-[11px] text-text-muted">
              Subscription money is counted once, here. Amounts it covers on matches are not counted again as collected. Periods overlapping the range are included{data.subscriptions.openPeriods ? `; ${data.subscriptions.openPeriods} still open` : ""}.
            </p>
          </section>

          <section className="flex flex-col gap-2" aria-label="Breakdown">
            <div className="flex gap-1 rounded-xl border border-border p-1" role="tablist" aria-label="Group by">
              {GROUPS.map((g) => (
                <button key={g.value} type="button" role="tab" aria-selected={group === g.value} onClick={() => setGroup(g.value)} className={`flex-1 min-h-[44px] rounded-lg text-xs font-bold cursor-pointer ${group === g.value ? "bg-brand text-white" : "text-text-secondary hover:bg-surface-hover"}`}>
                  {g.label}
                </button>
              ))}
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-text-secondary">No squad payments for matches in this range.</p>
            ) : (
              <ul className="rounded-2xl border border-border bg-surface divide-y divide-border" data-testid="report-rows">
                {rows.map((r) => (
                  <li key={r.key} className="px-3 py-2.5 flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-text-primary truncate">{r.label}</span>
                      <span className="block text-[11px] text-text-secondary tabular-nums">
                        {r.count} {r.count === 1 ? "fee" : "fees"} · fees {inr(r.matchFees)} · players {inr(r.playerShare)}
                        {r.subscriptionCovered ? ` · subscription ${inr(r.subscriptionCovered)}` : ""}
                        {r.pending ? ` · ${r.pending} pending` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-black tabular-nums text-emerald-700">{inr(r.clubSponsored)}</span>
                      <span className="block text-[10px] font-bold text-text-muted">club</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
