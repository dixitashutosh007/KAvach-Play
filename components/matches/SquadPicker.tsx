"use client";

/**
 * Add players to a match squad (`components/matches/SquadPicker.tsx`).
 *
 * Existing club players only (no new-player creation here). Shows a live
 * "squad after adding / max" count, a capacity warning, search, select-all for
 * the visible list, and each player's fee: Regular (the match fee) or the
 * Finance Plan they are on for the MATCH DATE. Plans are applied afterwards
 * with the "Finance Plans" action (see FeePlanApplyDialog), which shows the
 * server's breakdown and club sponsorship before anything is written.
 */
import React from "react";
import { Check, Search, Users, AlertTriangle } from "lucide-react";
import type { FeePlan, FinancePlanAssignment, Player } from "@/lib/types";
import { previewPlayerPlan } from "@/lib/match-plan-application";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function SquadPicker({
  players,
  selectedIds,
  onToggle,
  onSetSelected,
  search,
  onSearch,
  squadCount,
  maxSquadSize,
  standardFee,
  matchDate,
  feePlans,
  assignments,
  submitting,
  confirmDuplicates,
  onSubmit,
  onCancel,
}: {
  /** Eligible existing players already filtered by the search. */
  players: Player[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSetSelected: (ids: string[]) => void;
  search: string;
  onSearch: (q: string) => void;
  /** Players already in the squad (excluding "Not Playing"). */
  squadCount: number;
  maxSquadSize: number;
  standardFee: number;
  /** Match date "YYYY-MM-DD": plans are evaluated on this date. */
  matchDate: string;
  feePlans: FeePlan[];
  assignments: FinancePlanAssignment[];
  submitting: boolean;
  confirmDuplicates: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const selected = new Set(selectedIds);
  const after = squadCount + selectedIds.length;
  const max = Math.max(1, Number(maxSquadSize) || 0);
  const spotsLeft = Math.max(0, max - squadCount);
  const over = after - max;
  const visibleIds = players.map((p) => p.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const selectedPreview = selectedIds
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => !!p)
    .map((p) => previewPlayerPlan(p, feePlans, assignments, matchDate, standardFee));
  const onFixedPlan = selectedPreview.filter((x) => x.kind !== "regular");
  const sponsorPreview = onFixedPlan.reduce((s, x) => s + x.sponsored, 0);

  return (
    <form onSubmit={onSubmit} className="p-3 sm:p-4 bg-surface border-b border-border flex flex-col gap-3" data-testid="squad-picker">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-black font-heading text-text-primary">
          <Users className="w-4 h-4 text-brand" aria-hidden="true" />
          Add existing players
        </p>
        <p
          className={`text-sm font-black tabular-nums ${over > 0 ? "text-amber-700" : "text-brand"}`}
          aria-live="polite"
          data-testid="squad-count"
        >
          {after} / {max}
        </p>
      </div>
      <p className="-mt-2 text-xs text-text-secondary" data-testid="squad-capacity">
        {squadCount} in squad · {selectedIds.length} selected ·{" "}
        {over > 0 ? (
          <span className="inline-flex items-center gap-1 font-bold text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            {over} over the squad limit
          </span>
        ) : (
          <span>{Math.max(0, spotsLeft - selectedIds.length)} spots left</span>
        )}
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" aria-hidden="true" />
        <input
          type="text"
          placeholder="Search players…"
          aria-label="Search players"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-border bg-surface text-sm focus:outline-none focus:border-brand/60"
        />
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() =>
            onSetSelected(
              allVisibleSelected
                ? selectedIds.filter((id) => !visibleIds.includes(id))
                : Array.from(new Set([...selectedIds, ...visibleIds])),
            )
          }
          disabled={visibleIds.length === 0}
          className="min-h-[36px] px-2 -ml-2 rounded-lg text-xs font-bold text-brand hover:bg-brand-surface disabled:opacity-40 cursor-pointer"
          data-testid="squad-select-all"
        >
          {allVisibleSelected ? "Deselect all" : "Select all"}
        </button>
        {selectedIds.length > 0 && (
          <button type="button" onClick={() => onSetSelected([])} className="min-h-[36px] px-2 -mr-2 rounded-lg text-xs font-bold text-text-secondary hover:bg-surface-hover cursor-pointer">
            Clear
          </button>
        )}
      </div>

      <ul className="max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-border divide-y divide-border" data-testid="squad-player-list">
        {players.length === 0 ? (
          <li className="py-6 text-center text-xs text-text-muted">No players found</li>
        ) : (
          players.map((p) => {
            const isSel = selected.has(p.id);
            const fee = previewPlayerPlan(p, feePlans, assignments, matchDate, standardFee);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isSel}
                  onClick={() => onToggle(p.id)}
                  data-testid={`squad-player-${p.id}`}
                  className={`w-full min-h-[52px] px-3 flex items-center gap-3 text-left cursor-pointer transition-colors ${isSel ? "bg-brand-surface/60" : "hover:bg-surface-hover"}`}
                >
                  <span
                    className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${isSel ? "bg-brand border-brand text-white" : "border-border bg-surface"}`}
                    aria-hidden="true"
                  >
                    {isSel && <Check className="w-3.5 h-3.5" />}
                  </span>
                  <span className="w-8 h-8 shrink-0 rounded-full bg-deep-wine/10 text-deep-wine flex items-center justify-center text-xs font-black" aria-hidden="true">
                    {(p.name || "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-bold text-text-primary truncate">{p.name}</span>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                      fee.kind === "plan"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : fee.kind === "regular"
                          ? "bg-surface-hover text-text-secondary border-border"
                          : "bg-blue-50 text-blue-700 border-blue-200"
                    }`}
                    title={fee.kind === "pending" ? "Subscription allocated when the period closes" : undefined}
                  >
                    {fee.label}
                  </span>
                  <span className="w-14 shrink-0 text-right text-sm font-black tabular-nums text-text-primary">{fee.kind === "pending" ? "Sub" : inr(fee.fee)}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      {onFixedPlan.length > 0 && (
        <p className="text-xs text-text-secondary" data-testid="squad-plan-preview">
          {onFixedPlan.length} selected {onFixedPlan.length === 1 ? "player is" : "players are"} on a Finance Plan · club sponsors{" "}
          <strong className="text-emerald-700">{inr(sponsorPreview)}</strong> once you tap <strong>Finance Plans</strong>.
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="min-h-[44px] px-4 rounded-xl border border-border text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || selectedIds.length === 0}
          data-testid="squad-add-submit"
          className={`flex-1 min-h-[44px] rounded-xl text-sm font-black text-white disabled:opacity-50 cursor-pointer ${confirmDuplicates ? "bg-red-600" : "bg-brand"}`}
        >
          {submitting
            ? "Adding…"
            : confirmDuplicates
              ? "Confirm Guest Assignment"
              : `Add ${selectedIds.length || ""} to Squad`.replace("  ", " ")}
        </button>
      </div>
    </form>
  );
}
