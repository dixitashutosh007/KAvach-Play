"use client";

/**
 * Admin Match Details — compact summary + collapsible sections
 * (`components/matches/MatchDetailsSummary.tsx`).
 *
 * Summary: Practice / Tournament + format chips, "vs Opponent" with the stored
 * result on the same line, date · time, ground with Get Directions, the
 * tournament name, and Playing / Paid / Unpaid counts. No travel-time
 * estimate, discussion or share actions.
 */
import React, { useState } from "react";
import { CalendarDays, ChevronDown, ExternalLink, MapPin, Trophy } from "lucide-react";
import type { Ground, Match } from "@/lib/types";
import { formatMatchCardDate, getMatchCategory } from "@/lib/match-card-format";
import { formatMatchDisplayTime } from "@/lib/personal-match-payment";
import { getVenueMapsLink } from "@/lib/venue-maps";
import { MatchOpponentName, MatchResultStamp } from "./MatchCardHeader";

export function MatchDetailsSummary({
  match,
  ground,
  tournamentName,
  playing,
  paid,
  unpaid,
  showPaymentCounts = true,
}: {
  match: Match;
  ground?: Ground | null;
  tournamentName?: string;
  playing: number;
  paid: number;
  unpaid: number;
  showPaymentCounts?: boolean;
}) {
  const category = getMatchCategory(match.matchType);
  // Validated maps link (stored URL, else a Maps search for the ground name).
  const directions = getVenueMapsLink(ground)?.href || null;

  return (
    <div className="flex flex-col gap-3" data-testid="match-details-summary">
      <div className="flex items-center gap-2 flex-wrap">
        {category && (
          <span
            className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider text-white ${
              category === "Tournament" ? "bg-violet-700" : "bg-teal-600"
            }`}
            data-testid="details-category"
          >
            {category}
          </span>
        )}
        {match.format && (
          <span className="px-2.5 py-1 rounded-lg border border-brand/30 bg-brand-surface text-[11px] font-black text-brand" data-testid="details-format">
            {match.format}
          </span>
        )}
      </div>

      <div className="flex items-start gap-3 min-w-0">
        <MatchOpponentName
          match={match}
          as="h2"
          prefix="vs "
          className="min-w-0 flex-1 text-xl sm:text-2xl font-black font-heading text-text-primary tracking-tight leading-tight break-words"
        />
        <MatchResultStamp match={match} compact className="mt-1.5" />
      </div>

      <p className="flex items-center gap-2 text-sm font-bold text-text-primary">
        <CalendarDays className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
        <span>
          {formatMatchCardDate(match.date)}
          {match.time ? ` · ${formatMatchDisplayTime(match.time)}` : ""}
        </span>
      </p>

      <div className="flex items-center gap-2 min-w-0">
        <MapPin className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{ground?.name || "Venue TBC"}</span>
        {directions && (
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg border border-brand/30 text-xs font-bold text-brand hover:bg-brand-surface"
            data-testid="details-directions"
          >
            Get Directions
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        )}
      </div>

      {tournamentName && (
        <p className="flex items-center gap-2 min-w-0 text-xs font-bold text-deep-wine">
          <Trophy className="w-4 h-4 text-muted-gold shrink-0" aria-hidden="true" />
          <span className="truncate">{tournamentName}</span>
        </p>
      )}

      <div className={`grid ${showPaymentCounts ? "grid-cols-3" : "grid-cols-1"} gap-2`} data-testid="details-counts">
        <Stat label="Playing" value={playing} tone="border-border bg-surface text-text-primary" />
        {showPaymentCounts && (
          <>
            <Stat label="Paid" value={paid} tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
            <Stat label="Unpaid" value={unpaid} tone="border-rose-200 bg-rose-50 text-rose-700" />
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border px-2 py-2.5 text-center ${tone}`}>
      <p className="text-2xl font-black font-heading tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-bold">{label}</p>
    </div>
  );
}

/** Collapsible section used for Squad, Payments and Match Info. */
export function DetailsSection({
  icon,
  title,
  defaultOpen = false,
  children,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-border bg-surface overflow-hidden" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-h-[56px] px-4 flex items-center gap-3 text-left cursor-pointer hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40"
      >
        <span className="text-brand shrink-0">{icon}</span>
        <span className="flex-1 text-base font-black font-heading text-text-primary">{title}</span>
        <ChevronDown className={`w-5 h-5 text-text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </section>
  );
}
