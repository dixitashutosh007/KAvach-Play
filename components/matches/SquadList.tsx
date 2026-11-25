"use client";

/**
 * Manage Match — squad list (`components/matches/SquadList.tsx`).
 *
 * Desktop (sm+): compact table — Player · Finance Plan · Player Pays · Club
 * Sponsors · Status · ⋯. Mobile: compact rows (avatar, name, plan badge,
 * player / club amounts, status, ⋯) with no horizontal scrolling. Search and
 * "View all N players". Amounts come from the shared `paymentShare` rule
 * (lib/match-finance); actions from `squadRowActions` (lib/match-squad). The
 * parent performs each action through the existing store calls / server routes.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, CircleAlert, MoreVertical, Search, Trash2 } from "lucide-react";
import type { FeePlan, MatchPayment } from "@/lib/types";
import { planBadge, squadRowActions, type PlanBadgeTone, type RowAction, type RowActionContext, type RowActionId } from "@/lib/match-squad";

export interface SquadRow {
  payment: MatchPayment;
  name: string;
  photoURL?: string;
  isYou?: boolean;
}

const BADGE: Record<PlanBadgeTone, string> = {
  regular: "bg-surface-hover text-text-secondary border-border",
  fixed: "bg-amber-50 text-amber-800 border-amber-200",
  monthly: "bg-violet-50 text-violet-800 border-violet-200",
  sponsored: "bg-emerald-50 text-emerald-800 border-emerald-200",
  percentage: "bg-rose-50 text-rose-700 border-rose-200",
  override: "bg-surface text-brand border-brand/40 border-dashed",
  other: "bg-surface-hover text-text-secondary border-border",
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const INITIAL_ROWS = 8;

function Avatar({ name, photoURL }: { name: string; photoURL?: string }) {
  return photoURL ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoURL} alt="" className="w-9 h-9 shrink-0 rounded-full object-cover bg-surface-hover" />
  ) : (
    <span className="w-9 h-9 shrink-0 rounded-full bg-deep-wine/10 text-deep-wine flex items-center justify-center text-sm font-black" aria-hidden="true">
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}

function StatusChip({ paid, compact }: { paid: boolean; compact?: boolean }) {
  return paid ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
      {compact ? <span className="sr-only">Paid</span> : "Paid"}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
      <CircleAlert className="w-3.5 h-3.5" aria-hidden="true" />
      {compact ? <span className="sr-only">Unpaid</span> : "Unpaid"}
    </span>
  );
}

function RowMenu({ name, actions, onAction }: { name: string; actions: RowAction[]; onAction: (id: RowActionId) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setNote(null);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!actions.length) return <span className="w-10" aria-hidden="true" />;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setNote(null);
        }}
        aria-label={`Actions for ${name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="w-10 h-10 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-hover cursor-pointer"
      >
        <MoreVertical className="w-5 h-5" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-30 w-[min(17rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface shadow-lg py-1">
          {actions.map((a) => (
            <button
              key={a.id + a.label}
              type="button"
              role="menuitem"
              aria-disabled={!!a.disabledReason}
              onClick={() => {
                if (a.disabledReason) {
                  setNote(a.disabledReason);
                  return;
                }
                setOpen(false);
                onAction(a.id);
              }}
              className={`w-full min-h-[44px] px-3 text-left text-sm font-semibold cursor-pointer hover:bg-surface-hover ${
                a.disabledReason ? "text-text-muted" : a.destructive ? "text-rose-700" : "text-text-primary"
              }`}
            >
              {a.label}
            </button>
          ))}
          {note && (
            <p role="status" className="mx-2 my-1 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function SquadList({
  rows,
  plans,
  ctx,
  onAction,
  onBulkRemove,
  bulkRemoving = false,
}: {
  rows: SquadRow[];
  plans: FeePlan[];
  ctx: RowActionContext;
  onAction: (id: RowActionId, row: SquadRow) => void;
  onBulkRemove?: (rows: SquadRow[]) => Promise<void>;
  bulkRemoving?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const enriched = useMemo(
    () =>
      rows
        .map((r) => ({ row: r, badge: planBadge(r.payment, plans), ...squadRowActions(r.payment, ctx) }))
        .filter((x) => !!x.share)
        .sort((a, b) => a.row.name.localeCompare(b.row.name)),
    [rows, plans, ctx],
  );
  const q = query.trim().toLowerCase();
  const filtered = q ? enriched.filter((x) => x.row.name.toLowerCase().includes(q) || x.badge.label.toLowerCase().includes(q)) : enriched;
  const visible = showAll || q ? filtered : filtered.slice(0, INITIAL_ROWS);

  const canBulkRemove = !!onBulkRemove && ctx.canManageSquad && !ctx.financeClosed;
  const removableVisibleIds = useMemo(
    () =>
      canBulkRemove
        ? visible
            .filter((x) => !x.share!.paid && x.actions.some((a) => a.id === "remove"))
            .map((x) => x.row.payment.id)
        : [],
    [canBulkRemove, visible],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allRemovableSelected =
    removableVisibleIds.length > 0 && removableVisibleIds.every((id) => selectedSet.has(id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleBulkRemoveClick = async () => {
    if (!onBulkRemove || bulkRemoving || selectedIds.length === 0) return;
    const targets = enriched
      .filter((x) => selectedSet.has(x.row.payment.id) && !x.share!.paid && x.actions.some((a) => a.id === "remove"))
      .map((x) => x.row);
    if (targets.length === 0) return;
    await onBulkRemove(targets);
    setSelectedIds([]);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="squad-list">
      {enriched.length > 5 && (
        <label className="relative block">
          <span className="sr-only">Search squad</span>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search player…"
            data-testid="squad-search"
            className="w-full min-h-[44px] rounded-xl border border-border bg-surface pl-9 pr-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </label>
      )}

      {canBulkRemove && removableVisibleIds.length > 0 && (
        <div
          className="flex items-center justify-between gap-2 flex-wrap px-2 py-1.5 rounded-xl bg-surface-hover border border-border"
          data-testid="squad-bulk-bar"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setSelectedIds(
                  allRemovableSelected
                    ? selectedIds.filter((id) => !removableVisibleIds.includes(id))
                    : Array.from(new Set([...selectedIds, ...removableVisibleIds])),
                )
              }
              className="min-h-[34px] px-2.5 rounded-lg text-xs font-bold text-brand hover:bg-brand-surface cursor-pointer"
              data-testid="squad-bulk-select-all"
            >
              {allRemovableSelected ? "Deselect all" : "Select all"}
            </button>
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="min-h-[34px] px-2 rounded-lg text-xs font-bold text-text-secondary hover:bg-surface cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          {selectedIds.length > 0 && (
            <button
              type="button"
              disabled={bulkRemoving}
              onClick={handleBulkRemoveClick}
              data-testid="squad-bulk-remove-btn"
              className="min-h-[34px] px-3 rounded-lg bg-rose-600 text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              {bulkRemoving ? "Removing…" : `Remove Selected (${selectedIds.length})`}
            </button>
          )}
        </div>
      )}

      {enriched.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">No players in the squad yet.</p>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-secondary">No player matches “{query}”.</p>
      ) : (
        <div className="rounded-xl border border-border overflow-visible">
          {/* Desktop header */}
          <div className="hidden sm:grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_88px_100px_96px_44px] gap-3 px-3 py-2 bg-surface-hover text-[11px] font-bold uppercase tracking-wide text-text-muted rounded-t-xl">
            <span>Player</span>
            <span>Finance Plan</span>
            <span className="text-right">Player Pays</span>
            <span className="text-right">Club Sponsors</span>
            <span>Status</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="divide-y divide-border" data-testid="squad-rows">
            {visible.map(({ row, badge, share, actions }) => {
              const isRemovable = canBulkRemove && !share!.paid && actions.some((a) => a.id === "remove");
              const isSel = selectedSet.has(row.payment.id);
              return (
              <li key={row.payment.id} data-testid={`squad-row-${row.payment.id}`} className={isSel ? "bg-brand-surface/40" : undefined}>
                {/* Desktop row */}
                <div className="hidden sm:grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_88px_100px_96px_44px] items-center gap-3 px-3 py-2">
                  <span className="flex items-center gap-2.5 min-w-0">
                    {isRemovable && (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSel}
                        aria-label={`Select ${row.name}`}
                        onClick={() => toggleSelect(row.payment.id)}
                        className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center cursor-pointer ${
                          isSel ? "bg-brand border-brand text-white" : "border-border bg-surface"
                        }`}
                      >
                        {isSel && <Check className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <Avatar name={row.name} photoURL={row.photoURL} />
                    <span className="truncate text-sm font-bold text-text-primary">
                      {row.name}
                      {row.isYou && <span className="ml-1.5 text-[10px] font-bold uppercase text-brand">You</span>}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className={`inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-xs font-bold ${BADGE[badge.tone]}`} title={badge.matchOnly ? "This match only" : undefined}>
                      {badge.label}
                    </span>
                    {badge.matchOnly && <span className="block text-[10px] text-text-muted">This match only</span>}
                  </span>
                  <span className="text-right text-sm font-bold tabular-nums text-text-primary">{share!.kind === "pending" ? "Sub" : inr(share!.contribution)}</span>
                  <span className="text-right text-sm tabular-nums text-text-secondary">{inr(share!.sponsorship)}</span>
                  <span>
                    <StatusChip paid={share!.paid} />
                  </span>
                  <RowMenu name={row.name} actions={actions} onAction={(id) => onAction(id, row)} />
                </div>
                {/* Mobile row */}
                <div className="sm:hidden flex items-center gap-2.5 px-2.5 py-2">
                  {isRemovable && (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSel}
                      aria-label={`Select ${row.name}`}
                      onClick={() => toggleSelect(row.payment.id)}
                      className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center cursor-pointer ${
                        isSel ? "bg-brand border-brand text-white" : "border-border bg-surface"
                      }`}
                    >
                      {isSel && <Check className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <Avatar name={row.name} photoURL={row.photoURL} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-text-primary">
                      {row.name}
                      {row.isYou && <span className="ml-1 text-[10px] font-bold uppercase text-brand">You</span>}
                    </span>
                    <span className={`mt-0.5 inline-block max-w-full truncate rounded-full border px-1.5 py-px text-[11px] font-bold ${BADGE[badge.tone]}`}>
                      {badge.label}
                      {badge.matchOnly ? " · match" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block text-sm font-black text-text-primary">{share!.kind === "pending" ? "Sub" : inr(share!.contribution)}</span>
                    <span className="block text-[11px] text-text-muted">club {inr(share!.sponsorship)}</span>
                  </span>
                  <StatusChip paid={share!.paid} compact />
                  <RowMenu name={row.name} actions={actions} onAction={(id) => onAction(id, row)} />
                </div>
              </li>
              );
            })}
          </ul>
          {!q && filtered.length > INITIAL_ROWS && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              data-testid="squad-view-all"
              className="w-full min-h-[44px] border-t border-border text-sm font-bold text-brand hover:bg-brand-surface cursor-pointer rounded-b-xl"
            >
              {showAll ? "Show fewer" : `View all ${filtered.length} players`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
