"use client";

/**
 * Manage Match — Match Financials (`components/matches/MatchFinancials.tsx`).
 *
 * `MatchFinancialsCard`: the compact summary shown under the squad — Match
 * Value (system fee = player collection + club sponsorship, with a composition
 * bar), Collection Progress (collected vs maximum player collection, paid /
 * unpaid, outstanding) and Match Profitability (actual match fee paid and the
 * projected Net Match Result = maximum player collection − actual fee paid).
 * All figures come from `buildMatchFinancialStatement` (lib/match-finance);
 * nothing is recalculated here. Payment progress never changes the net result.
 */
import React from "react";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import { netResultLabel, type MatchFinancialStatement } from "@/lib/match-finance";

export const inr = (n: number) => `${n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const pct = (n: number | null, dp = 0) => (n === null ? "—" : `${dp ? n.toFixed(dp) : Math.round(n)}%`);

export function NetResultBadge({ net, testId }: { net: number | null; testId?: string }) {
  const { label, tone } = netResultLabel(net);
  const cls =
    tone === "loss" ? "bg-rose-50 text-rose-700 border-rose-200" : tone === "surplus" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-surface-hover text-text-secondary border-border";
  const Icon = tone === "loss" ? TrendingDown : tone === "surplus" ? TrendingUp : null;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-sm font-black ${cls}`} data-testid={testId}>
      {Icon && <Icon className="w-4 h-4" aria-hidden="true" />}
      {tone === "loss" || tone === "surplus" ? `${label}: ${inr(Math.abs(net!))}` : label}
    </span>
  );
}

/** Player collection vs club sponsorship within the system match fee. */
export function CompositionBar({ s }: { s: MatchFinancialStatement }) {
  if (s.systemFee <= 0) return null;
  const playerPct = (s.maxPlayerCollection / s.systemFee) * 100;
  return (
    <div className="flex flex-col gap-1" data-testid="match-value-bar">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-hover" role="img" aria-label={`Players ${inr(s.maxPlayerCollection)}, club ${inr(s.clubSponsored)} of ${inr(s.systemFee)}`}>
        <span className="h-full bg-brand" style={{ width: `${playerPct}%` }} />
        <span className="h-full bg-[#D6A52B]" style={{ width: `${100 - playerPct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-text-secondary">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-brand" aria-hidden="true" /> Players {inr(s.maxPlayerCollection)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#D6A52B]" aria-hidden="true" /> Club {inr(s.clubSponsored)}
        </span>
      </div>
    </div>
  );
}

export function CollectionBar({ s }: { s: MatchFinancialStatement }) {
  const done = s.maxPlayerCollection > 0 ? Math.min(100, (s.collected / s.maxPlayerCollection) * 100) : 0;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-rose-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done)} aria-label="Collection progress" data-testid="collection-bar">
      <div className="h-full rounded-full bg-[#15803D]" style={{ width: `${done}%` }} />
    </div>
  );
}

export function MatchFinancialsCard({ s, onOpenFinance }: { s: MatchFinancialStatement; onOpenFinance?: () => void }) {
  const { tone } = netResultLabel(s.netResult);
  return (
    <section className="rounded-2xl border border-border bg-surface p-3 sm:p-4 flex flex-col gap-3" data-testid="match-financials-card" aria-label="Match financials">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="inline-flex items-center gap-2 text-base font-black font-heading text-text-primary">
          <BarChart3 className="w-5 h-5 text-brand" aria-hidden="true" /> Match Financials
        </h3>
        <NetResultBadge net={s.netResult} testId="financials-net-badge" />
      </div>

      {s.abandoned && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">Match abandoned — unpaid match fees are waived; paid amounts remain historical.</p>}

      {/* Match Value */}
      <div className="rounded-xl border border-border p-3 flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 text-center sm:divide-x sm:divide-border">
          <div>
            <p className="text-[11px] sm:text-xs text-text-secondary">Match Fee (System)</p>
            <p className="text-lg sm:text-2xl font-black font-heading tabular-nums text-text-primary" data-testid="fin-system-fee">{inr(s.systemFee)}</p>
          </div>
          <div>
            <p className="text-[11px] sm:text-xs text-text-secondary">Club Sponsored</p>
            <p className="text-lg sm:text-2xl font-black font-heading tabular-nums text-[#9A6B00]" data-testid="fin-club">{inr(s.clubSponsored)}</p>
          </div>
          <div>
            <p className="text-[11px] sm:text-xs text-text-secondary">Player Collection (Max)</p>
            <p className="text-lg sm:text-2xl font-black font-heading tabular-nums text-text-primary" data-testid="fin-max">{inr(s.maxPlayerCollection)}</p>
          </div>
        </div>
        <CompositionBar s={s} />
        {s.pendingAllocationCount > 0 && (
          <p className="text-[11px] text-blue-700">
            {s.pendingAllocationCount} subscription player{s.pendingAllocationCount === 1 ? "" : "s"} not allocated yet (set when the subscription period closes) — not included above.
          </p>
        )}
      </div>

      {/* Collection Progress */}
      <div className="rounded-xl border border-border p-3 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-black text-text-primary">Collection Progress</p>
          <p className="text-sm tabular-nums text-text-secondary" data-testid="fin-progress">
            <span className="font-black text-text-primary">{inr(s.collected)}</span> / {inr(s.maxPlayerCollection)} ({pct(s.collectionPct)})
          </p>
        </div>
        <CollectionBar s={s} />
        <div className="flex justify-between text-xs">
          <span className="font-bold text-emerald-700">{s.paidCount} Paid</span>
          <span className="font-bold text-rose-700" data-testid="fin-outstanding">
            {s.unpaidCount} Unpaid ({inr(s.outstanding)})
          </span>
        </div>
      </div>

      {/* Match Profitability */}
      <div className={`rounded-xl p-3 grid grid-cols-2 gap-3 ${tone === "loss" ? "bg-rose-50" : tone === "surplus" ? "bg-emerald-50" : "bg-surface-hover"}`}>
        <div>
          <p className="text-xs text-text-secondary">Actual Match Fee Paid</p>
          <p className="text-xl font-black font-heading tabular-nums text-text-primary" data-testid="fin-actual">{s.actualFeePaid === null ? "Not recorded" : inr(s.actualFeePaid)}</p>
        </div>
        <div className="border-l border-border/70 pl-3">
          <p className="text-xs text-text-secondary">Net Match Result</p>
          <p
            className={`text-xl font-black font-heading tabular-nums ${tone === "loss" ? "text-rose-700" : tone === "surplus" ? "text-emerald-700" : "text-text-primary"}`}
            data-testid="fin-net"
          >
            {s.netResult === null ? "—" : s.netResult === 0 ? "₹0" : inr(s.netResult)}
          </p>
          <p className="text-[11px] font-bold text-text-secondary">{netResultLabel(s.netResult).label}</p>
        </div>
      </div>

      {onOpenFinance && (
        <button type="button" onClick={onOpenFinance} className="self-end min-h-[40px] text-xs font-bold text-brand hover:underline cursor-pointer">
          Full statement & finance actions →
        </button>
      )}
    </section>
  );
}
