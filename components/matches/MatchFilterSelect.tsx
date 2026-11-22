"use client";

/**
 * Compact Player Match Centre filter (`components/matches/MatchFilterSelect.tsx`):
 * All Matches / Upcoming Matches / Past Matches. A native select keeps it
 * accessible and comfortable on mobile; the active option shows in scarlet.
 */
import React from "react";
import { ChevronDown, Filter } from "lucide-react";
import { MATCH_FILTER_OPTIONS, type MatchListFilter } from "@/lib/player-match-filters";

export function MatchFilterSelect({
  value,
  onChange,
}: {
  value: MatchListFilter;
  onChange: (v: MatchListFilter) => void;
}) {
  return (
    <label className="relative inline-flex items-center shrink-0" data-testid="match-filter-wrap">
      <span className="sr-only">Match filter</span>
      <Filter className="pointer-events-none absolute left-2.5 w-4 h-4 text-scarlet" aria-hidden="true" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MatchListFilter)}
        data-testid="match-filter"
        className="appearance-none h-10 pl-8 pr-7 rounded-xl border border-scarlet/30 bg-surface text-[13px] font-bold text-scarlet shadow-xs cursor-pointer hover:border-scarlet/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/40"
      >
        {MATCH_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 w-4 h-4 text-scarlet" aria-hidden="true" />
    </label>
  );
}
