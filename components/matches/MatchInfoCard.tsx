"use client";

/**
 * Manage Match — compact match information card (`components/matches/MatchInfoCard.tsx`).
 *
 * One card for match info and the per-player match fee (replaces the separate
 * summary, Match Info and fee blocks for admins): status badge, "KAvach XI vs
 * Opponent", type / format chips, date · time · venue (with directions), the
 * tournament, the match fee with an Edit action (opens the existing Edit Match
 * wizard), and a ⋯ menu for archive. Horizontal on desktop, stacked on mobile.
 */
import { cricHeroesHref } from "@/lib/weekend-ops";
import React, { useEffect, useRef, useState } from "react";
import { CalendarDays, Clock, ExternalLink, Lock, MapPin, MoreHorizontal, Pencil, Trophy } from "lucide-react";
import type { Ground, Match } from "@/lib/types";
import { formatMatchDisplayTime } from "@/lib/personal-match-payment";
import { getVenueMapsLink } from "@/lib/venue-maps";
import type { MatchStatus } from "@/lib/match-squad";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatInfoDate(key: string): string {
  const [y, m, d] = (key || "").split("-").map(Number);
  if (!y || !m || !d) return key || "Date TBD";
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[wd]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

const STATUS_TONE: Record<MatchStatus, string> = {
  Upcoming: "border-brand/40 text-brand bg-brand-surface",
  Today: "border-brand bg-brand text-white",
  Completed: "border-border text-text-secondary bg-surface-hover",
  Abandoned: "border-amber-300 text-amber-800 bg-amber-50",
  Tentative: "border-orange-300 text-orange-800 bg-orange-50",
};

export function MatchInfoCard({
  match,
  ground,
  tournamentName,
  status,
  financeClosed,
  onEdit,
  canArchive,
  onToggleArchive,
}: {
  match: Match;
  ground?: Ground | null;
  tournamentName?: string;
  status: MatchStatus;
  financeClosed: boolean;
  onEdit?: () => void;
  canArchive?: boolean;
  onToggleArchive?: (archived: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const directions = getVenueMapsLink(ground)?.href || null;
  const venue = ground?.name || "Venue TBD";
  const typeLabel = match.matchType === "Practice" ? "Friendly" : match.matchType;

  return (
    <section
      className="rounded-xl border border-border bg-surface/80 px-3 py-2 sm:px-3.5 sm:py-2.5"
      data-testid="match-info-card"
      aria-label="Match information"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[status]}`}
              data-testid="match-status-badge"
            >
              {status}
            </span>
            <h2
              className="text-sm sm:text-base font-black font-heading text-text-primary leading-tight truncate"
              data-testid="match-info-title"
            >
              KAvach XI vs {match.opponent || "TBD"}
            </h2>
            <span className="rounded-md bg-brand-surface px-1.5 py-0.5 text-[11px] font-bold text-brand">
              {typeLabel}
            </span>
            <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] font-bold text-text-secondary">
              {match.format}
            </span>
            {tournamentName && (
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] font-bold text-text-secondary min-w-0">
                <Trophy className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{tournamentName}</span>
              </span>
            )}
            {financeClosed && (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] font-bold text-text-secondary"
                data-testid="match-finance-closed"
              >
                <Lock className="w-3 h-3" aria-hidden="true" /> Finance closed
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {formatInfoDate(match.date)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {formatMatchDisplayTime(match.time) || "Time TBD"}
            </span>
            {directions ? (
              <a href={directions} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-w-0 hover:text-brand">
                <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{venue}</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 min-w-0">
                <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{venue}</span>
              </span>
            )}
            {cricHeroesHref(match.matchUrl) && (
              <a href={cricHeroesHref(match.matchUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-brand hover:underline">
                <ExternalLink className="w-3 h-3" aria-hidden="true" /> Match Centre
              </a>
            )}
            {match.streamingUrl && (
              <a href={match.streamingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-brand hover:underline">
                <ExternalLink className="w-3 h-3" aria-hidden="true" /> Live stream
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 sm:pl-3 sm:border-l sm:border-border shrink-0" data-testid="match-info-fee">
          <div className="flex items-baseline gap-1.5 sm:text-right sm:block">
            <p className="text-[11px] font-semibold text-text-secondary">
              Match Fee <span className="text-sm sm:text-base font-black font-heading text-text-primary tabular-nums">₹{Number(match.fee || 0).toLocaleString("en-IN")}</span>
            </p>
            <p className="text-[11px] text-text-muted">{match.jerseyColor} · max {match.maxSquadSize}</p>
          </div>
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                aria-label="Edit match"
                data-testid="details-edit-match"
                className="w-11 h-11 shrink-0 rounded-xl border border-border flex items-center justify-center text-text-primary hover:bg-surface-hover cursor-pointer"
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            {canArchive && onToggleArchive && (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="More match actions"
                  aria-expanded={menuOpen}
                  className="w-11 h-11 rounded-xl border border-border flex items-center justify-center text-text-secondary hover:bg-surface-hover cursor-pointer"
                >
                  <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
                </button>
                {menuOpen && (
                  <div role="menu" className="absolute right-0 top-12 z-30 min-w-[180px] rounded-xl border border-border bg-surface shadow-lg py-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onToggleArchive(!match.isArchived);
                      }}
                      className="w-full min-h-[44px] px-3 text-left text-sm font-semibold text-text-primary hover:bg-surface-hover cursor-pointer"
                    >
                      {match.isArchived ? "Unarchive match" : "Archive match"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
