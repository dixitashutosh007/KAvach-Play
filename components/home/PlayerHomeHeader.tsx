"use client";

import { useMemo } from "react";
import { Search, X, Shield } from "lucide-react";
import { Player } from "@/lib/types";
import { getTimeOfDayGreeting, resolveGreetingName } from "@/lib/greeting";

export function PlayerHomeHeader({
  player,
  currentUserName,
  searchQuery,
  onSearchChange,
}: {
  player: Player | null;
  /** Fallback candidates only; placeholders such as "Player" are ignored. */
  currentUserName?: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  const greeting = useMemo(() => getTimeOfDayGreeting(), []);
  const displayName = useMemo(
    () => resolveGreetingName(player?.name, currentUserName),
    [player?.name, currentUserName],
  );

  return (
    <div className="w-full flex flex-col gap-3" data-testid="player-home-header">
      <div className="flex items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h1
            data-testid="player-home-greeting"
            className="min-w-0 text-xl sm:text-2xl font-black text-text-primary tracking-tight font-heading leading-tight break-words"
          >
            {greeting}
            {displayName ? (
              <>
                , <span className="text-deep-wine">{displayName}</span>
              </>
            ) : null}
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">Cricket • Community • KAvach</p>
        </div>

        {player?.kavachId && (
          <div className="shrink-0 inline-flex items-center gap-2 bg-surface border border-brand/20 px-2.5 py-1.5 rounded-xl shadow-xs">
            <div className="w-6 h-6 rounded-full bg-deep-wine/10 border border-deep-wine/30 flex items-center justify-center shrink-0">
              <Shield className="w-3.5 h-3.5 text-scarlet" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] uppercase font-bold tracking-wider text-text-muted leading-none">
                Player ID
              </span>
              <span className="text-xs font-mono font-black text-deep-wine leading-tight">
                {player.kavachId}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Search Entry Point (Section 4.A) */}
      <div className="relative w-full">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
          <Search className="w-4 h-4 text-text-muted" aria-hidden="true" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search matches, announcements, players..."
          aria-label="Search club dashboard"
          className="w-full pl-10 pr-10 py-2.5 bg-surface border border-border rounded-xl text-xs sm:text-sm text-text-primary placeholder:text-text-muted/70 focus:outline-none focus:ring-2 focus:ring-scarlet/30 focus:border-scarlet transition shadow-xs"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-muted hover:text-text-primary transition cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
