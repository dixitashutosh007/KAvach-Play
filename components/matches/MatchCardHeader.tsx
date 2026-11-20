"use client";

/**
 * Shared compact match-card header (`components/matches/MatchCardHeader.tsx`).
 *
 * Used by the Player Match Center, Player Home upcoming fixtures and the Admin
 * Match Center so every surface presents a fixture identically:
 *   Row 1: format badge · jersey infographic · "vs Opponent"   [result] [trailing slot]
 *   Row 2: date · start time                                    [meta slot]
 *   Row 3: venue as a Google Maps link (plain text when no venue data exists)
 */
import React from "react";
import { Calendar, Clock, MapPin, ExternalLink, Trophy } from "lucide-react";
import type { Ground, Match } from "@/lib/types";
import { formatMatchDisplayDate, formatMatchDisplayTime } from "@/lib/personal-match-payment";
import { getVenueMapsLink } from "@/lib/venue-maps";
import { JerseyInfographic } from "./JerseyInfographic";
import { getMatchResultDisplay, MATCH_RESULT_STAMP_CLASSES } from "./matchResult";

export interface MatchCardHeaderProps {
  match: Match;
  ground?: Ground | null;
  /** Rendered at the end of row 1 (e.g. expand toggle or admin actions). */
  trailing?: React.ReactNode;
  /** Rendered at the end of row 2 (e.g. personal payment badge). */
  meta?: React.ReactNode;
  /** Hide the result stamp (e.g. when a caller renders its own). */
  hideResult?: boolean;
}

export function MatchResultStamp({ match }: { match: Match }) {
  const display = getMatchResultDisplay(match.result);
  if (!display) return null;
  const showMargin =
    (display.tone === "won" || display.tone === "lost") && Boolean(match.resultMarginAmount);
  return (
    <span
      data-testid={`result-stamp-${match.id}`}
      data-result-tone={display.tone}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-black uppercase tracking-wider border font-heading shrink-0 whitespace-nowrap ${MATCH_RESULT_STAMP_CLASSES[display.tone]}`}
    >
      {display.tone === "won" && <Trophy className="w-3 h-3 text-emerald-100 shrink-0" />}
      <span>{display.label}</span>
      {showMargin && (
        <span className="font-semibold normal-case tracking-normal opacity-90 border-l border-white/40 pl-1 ml-0.5">
          by {match.resultMarginAmount} {match.resultMarginType || "runs"}
        </span>
      )}
    </span>
  );
}

export function MatchCardHeader({ match, ground, trailing, meta, hideResult = false }: MatchCardHeaderProps) {
  const venueLink = getVenueMapsLink(ground);
  const venueName = ground?.name?.trim() || "";

  return (
    <div className="flex flex-col gap-1" data-testid={`match-card-header-${match.id}`}>
      {/* Row 1 */}
      <div className="flex items-start gap-2">
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 flex-1"
          data-testid={`match-card-title-row-${match.id}`}
        >
          {match.format && (
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-canvas-warm border border-border text-deep-wine font-heading shrink-0">
              {match.format}
            </span>
          )}
          {match.jerseyColor && <JerseyInfographic color={match.jerseyColor} size="sm" />}
          <h3 className="min-w-0 text-[15px] sm:text-base font-black font-heading text-text-primary tracking-tight leading-snug break-words">
            vs {match.opponent}
          </h3>
        </div>
        {!hideResult && <MatchResultStamp match={match} />}
        {trailing}
      </div>

      {/* Row 2 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
          <Calendar className="w-3.5 h-3.5 text-scarlet shrink-0" aria-hidden="true" />
          <span>{formatMatchDisplayDate(match.date)}</span>
          <span className="text-text-muted" aria-hidden="true">•</span>
          <Clock className="w-3.5 h-3.5 text-scarlet shrink-0" aria-hidden="true" />
          <span>{formatMatchDisplayTime(match.time)}</span>
        </div>
        {meta}
      </div>

      {/* Row 3 */}
      {venueName && (
        <div className="flex items-center gap-1.5 text-xs min-w-0">
          <MapPin className="w-3.5 h-3.5 text-scarlet shrink-0" aria-hidden="true" />
          {venueLink ? (
            <a
              href={venueLink.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              data-testid={`venue-link-${match.id}`}
              aria-label={`Open ${venueName} in Google Maps (opens in a new tab)`}
              className="inline-flex items-center gap-1 min-w-0 font-semibold text-scarlet hover:text-deep-wine underline decoration-scarlet/30 underline-offset-2 hover:decoration-deep-wine rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
            >
              <span className="truncate">{venueName}</span>
              <ExternalLink className="w-3 h-3 shrink-0 opacity-70" aria-hidden="true" />
            </a>
          ) : (
            <span className="truncate font-medium text-text-primary" data-testid={`venue-text-${match.id}`}>
              {venueName}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
