"use client";

import React, { useMemo, useState } from "react";
import { Search, Shield, X, Check } from "lucide-react";
import type { Player } from "@/lib/types";
import { getEligibleCaptainPlayers } from "@/lib/match-captain";

export interface CaptainSelectorProps {
  players: readonly Player[];
  value: string;
  onChange: (playerId: string) => void;
  disabled?: boolean;
}

export function CaptainSelector({
  players,
  value,
  onChange,
  disabled = false,
}: CaptainSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const eligible = useMemo(() => getEligibleCaptainPlayers(players), [players]);
  const selectedPlayer = useMemo(
    () => (value ? eligible.find((p) => p.id === value) || null : null),
    [eligible, value],
  );
  const isUnavailable = Boolean(value && !selectedPlayer);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.kavachId && p.kavachId.toLowerCase().includes(q)),
    );
  }, [eligible, query]);

  return (
    <div className="space-y-2" data-testid="captain-selector">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-hover px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            {selectedPlayer ? (
              <p className="text-sm font-bold text-text-primary truncate" data-testid="captain-selected-name">
                {selectedPlayer.name}
                {selectedPlayer.kavachId ? (
                  <span className="ml-1.5 text-[11px] font-medium text-text-muted">
                    ({selectedPlayer.kavachId})
                  </span>
                ) : null}
              </p>
            ) : isUnavailable ? (
              <p className="text-sm font-semibold text-amber-700 truncate" data-testid="captain-unavailable">
                Assigned player unavailable
              </p>
            ) : (
              <p className="text-sm text-text-muted" data-testid="captain-unassigned">
                No captain assigned
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {value && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              data-testid="captain-clear-btn"
              aria-label="Remove captain"
              className="min-h-[32px] px-2 rounded-lg border border-border bg-surface text-xs font-bold text-text-secondary hover:text-rose-700 hover:border-rose-200 transition cursor-pointer disabled:opacity-50"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            data-testid="captain-toggle-picker"
            className="min-h-[32px] px-2.5 rounded-lg bg-brand-surface text-brand text-xs font-bold hover:bg-brand-surface/80 transition cursor-pointer disabled:opacity-50"
          >
            {open ? "Done" : value ? "Change" : "Select Captain"}
          </button>
        </div>
      </div>

      {open && (
        <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden" data-testid="captain-picker-list">
          <div className="relative border-b border-border">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any active club player..."
              data-testid="captain-search-input"
              className="w-full pl-9 pr-8 py-2.5 text-sm bg-surface text-text-primary focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-52 overflow-y-auto divide-y divide-border/60">
            {filtered.length === 0 ? (
              <p className="py-4 px-3 text-xs text-text-muted text-center">
                No active players match &ldquo;{query}&rdquo;.
              </p>
            ) : (
              filtered.map((p) => {
                const isSelected = p.id === value;
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`captain-option-${p.id}`}
                    onClick={() => {
                      onChange(p.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 text-sm transition cursor-pointer ${
                      isSelected
                        ? "bg-brand-surface/60 text-brand font-bold"
                        : "hover:bg-surface-hover text-text-primary"
                    }`}
                  >
                    <span className="truncate">
                      {p.name}
                      {p.kavachId ? (
                        <span className="ml-1.5 text-[11px] text-text-muted font-normal">
                          {p.kavachId}
                        </span>
                      ) : null}
                    </span>
                    {isSelected && <Check className="w-4 h-4 text-brand shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
