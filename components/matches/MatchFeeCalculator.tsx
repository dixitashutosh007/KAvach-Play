"use client";

/**
 * Compact, collapsible "Match Fee Calculation" for Add / Edit Match
 * (`components/matches/MatchFeeCalculator.tsx`).
 *
 * Shows the existing rule (lib/match-fee): ground fee per match ÷ 12 players +
 * margin (default 5%, adjustable) = standard per-player fee. The final fee is
 * always visible, also when collapsed. The admin can still type a fee
 * directly, as before; a tournament's own per-player fee is shown when it
 * applies.
 */
import React, { useState } from "react";
import { ChevronDown, Info, Minus, Plus, Receipt } from "lucide-react";
import {
  MATCH_FEE_PLAYER_BASIS,
  MAX_MARGIN_PCT,
  MIN_MARGIN_PCT,
  computeMatchFee,
  type MatchFeeBreakdown,
} from "@/lib/match-fee";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const SOURCE_LABEL: Record<MatchFeeBreakdown["source"], string> = {
  practice: "Ground fee (practice)",
  "tournament-ground": "Ground fee (tournament)",
  tournament: "Tournament fee per match",
  none: "Ground fee",
};

export function MatchFeeCalculator({
  groundFeePerMatch,
  source,
  marginPct,
  onMarginChange,
  fee,
  onFeeChange,
  tournamentPerPlayerFee,
  defaultOpen = false,
}: {
  groundFeePerMatch: number;
  source: MatchFeeBreakdown["source"];
  marginPct: number;
  onMarginChange: (pct: number) => void;
  /** Current per-player fee (the value that will be saved). */
  fee: number | "";
  /** Manual override, as the previous Match Fee field allowed. */
  onFeeChange: (fee: number | "") => void;
  /** Linked tournament's own per-player fee, if any. */
  tournamentPerPlayerFee?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const calc = computeMatchFee(groundFeePerMatch, marginPct);
  const hasGroundFee = groundFeePerMatch > 0;
  const shownFee = fee === "" ? 0 : Number(fee);
  const differsFromCalc = hasGroundFee && shownFee !== calc.feePerPlayer;

  return (
    <section className="rounded-2xl border border-border bg-surface overflow-hidden" data-testid="match-fee-calculator">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="match-fee-toggle"
        className="w-full min-h-[52px] px-4 flex items-center justify-between gap-3 bg-brand-surface/50 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40"
      >
        <span className="inline-flex items-center gap-2 text-sm font-black font-heading text-brand">
          <Receipt className="w-4 h-4" aria-hidden="true" />
          Match Fee Calculation
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-base font-black font-heading text-brand tabular-nums" data-testid="match-fee-final">
            {fee === "" ? "—" : inr(shownFee)}
          </span>
          <ChevronDown className={`w-4 h-4 text-text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div className="px-4 py-3 text-sm" data-testid="match-fee-body">
          <dl className="divide-y divide-border">
            <Row label={SOURCE_LABEL[source]} value={hasGroundFee ? inr(calc.groundFeePerMatch) : "Not set"} />
            <Row label={`Per player (÷ ${MATCH_FEE_PLAYER_BASIS})`} value={hasGroundFee ? inr(calc.perPlayerBase) : "—"} />
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="inline-flex items-center gap-1 font-bold text-text-primary">
                Margin
                <span title={`Added on top of the per-player share (${MIN_MARGIN_PCT}–${MAX_MARGIN_PCT}%).`}>
                  <Info className="w-3.5 h-3.5 text-text-muted" aria-hidden="true" />
                </span>
              </dt>
              <dd className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onMarginChange(calc.marginPct - 1)}
                  disabled={calc.marginPct <= MIN_MARGIN_PCT}
                  aria-label="Decrease margin"
                  data-testid="margin-decrease"
                  className="w-10 h-10 rounded-lg border border-brand/30 text-brand flex items-center justify-center disabled:opacity-40 cursor-pointer"
                >
                  <Minus className="w-4 h-4" aria-hidden="true" />
                </button>
                <span className="w-12 text-center font-bold tabular-nums" aria-live="polite" data-testid="margin-value">
                  {calc.marginPct}%
                </span>
                <button
                  type="button"
                  onClick={() => onMarginChange(calc.marginPct + 1)}
                  disabled={calc.marginPct >= MAX_MARGIN_PCT}
                  aria-label="Increase margin"
                  data-testid="margin-increase"
                  className="w-10 h-10 rounded-lg border border-brand/30 text-brand flex items-center justify-center disabled:opacity-40 cursor-pointer"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                </button>
              </dd>
            </div>
            <Row label="Margin amount" value={hasGroundFee ? inr(calc.marginAmount) : "—"} />
          </dl>

          <label className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-brand-surface/60 px-3 py-2.5">
            <span className="font-black font-heading text-brand">Match Fee (per player)</span>
            <span className="inline-flex items-center gap-1 text-brand font-black font-heading">
              ₹
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={fee}
                onChange={(e) => onFeeChange(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))}
                data-testid="match-fee-input"
                aria-label="Match fee per player"
                className="w-24 rounded-lg border border-brand/30 bg-surface px-2 py-1.5 text-right text-lg font-black tabular-nums text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            </span>
          </label>
          {differsFromCalc && (
            <p className="mt-1.5 text-[11px] text-text-secondary" data-testid="match-fee-note">
              {tournamentPerPlayerFee !== undefined && shownFee === tournamentPerPlayerFee
                ? "Using the tournament's own per-player fee."
                : `Saved / manual fee differs from the calculated ${inr(calc.feePerPlayer)}.`}{" "}
              <button
                type="button"
                onClick={() => onFeeChange(calc.feePerPlayer)}
                className="font-bold text-brand underline underline-offset-2 cursor-pointer"
                data-testid="match-fee-use-calculated"
              >
                Use {inr(calc.feePerPlayer)}
              </button>
            </p>
          )}
          {!hasGroundFee && (
            <p className="mt-1.5 text-[11px] text-text-secondary">
              This ground has no {source === "practice" || source === "none" ? "practice/tournament" : "tournament"} fee set; enter the fee manually.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="font-bold text-text-primary tabular-nums">{value}</dd>
    </div>
  );
}
