"use client";

/**
 * Player match card (`components/matches/PlayerMatchCard.tsx`).
 *
 * Shared by the Player Match Center and the Player Home upcoming fixtures, built
 * on the shared presentation in MatchCardHeader (ribbon, identity, logistics)
 * with the Playing · Maybe · Out availability buttons at the bottom.
 *
 * Player-facing only (Admin Match Centre renders its own cards): it shows NO
 * personal payment status, unpaid amount or unsettled-obligation alert. Dues
 * live on the Player Payments page; Admin financial views are unaffected.
 */
import React, { useState } from "react";
import { Sparkles, Trophy, ChevronDown, ChevronRight } from "lucide-react";
import type { Match, Ground } from "@/lib/types";
import type { PlayerAvailabilityStatus } from "@/lib/personal-match-payment";
import { MatchCardCompactBody, MatchCardHeader, MatchCardTopBar, MatchCornerTab } from "./MatchCardHeader";
import {
  AvailabilityButtons,
  toAvailabilityChoice,
  type AvailabilityChoice,
  type StoredAvailability,
} from "./AvailabilityButtons";

export interface PlayerMatchCardProps {
  match: Match;
  ground?: Ground;
  tournamentName?: string;
  availability: PlayerAvailabilityStatus | "Out";
  isImmediateNext?: boolean;
  /** Visual variant for alternating consecutive cards in lists */
  variant?: "default" | "alternate";
  /**
   * "home": Player Home upcoming-match card.
   *  - Below md: fixed-geometry mobile body (MatchCardCompactBody), format and
   *    jersey chips in the header row, card fills its carousel slide with the
   *    availability row anchored at the bottom.
   *  - md+: the standard shared header, unchanged.
   * "default": Player Match Center card (unchanged).
   */
  layout?: "default" | "home";
  onSelectMatch: (matchId: string) => void;
  onRsvp?: (matchId: string, availability: StoredAvailability) => Promise<void>;
  isUpdatingRsvp?: boolean;
  disabledRsvp?: boolean;
  disabledRsvpReason?: string;
}

const CARD_DEPTH = "shadow-[0_1px_2px_rgba(23,28,38,0.06),0_8px_20px_-10px_rgba(122,30,43,0.25)]";

/**
 * Shared surface classes so every match list uses the same card system.
 * Semantic highlights (Next Match, unsettled payment) always win over alternation.
 */
export function getMatchCardSurfaceClass({
  isImmediateNext = false,
  isUnsettledAlert = false,
  isAlternate = false,
}: {
  isImmediateNext?: boolean;
  isUnsettledAlert?: boolean;
  isAlternate?: boolean;
}): string {
  if (isImmediateNext) {
    return `bg-surface border-scarlet/50 ring-2 ring-scarlet/15 ${CARD_DEPTH}`;
  }
  if (isUnsettledAlert) {
    return `bg-surface border-amber-300 ring-2 ring-amber-100 ${CARD_DEPTH}`;
  }
  if (isAlternate) {
    return `bg-soft-blush/70 border-deep-wine/15 hover:border-deep-wine/25 ${CARD_DEPTH}`;
  }
  return `bg-surface border-border hover:border-scarlet/30 ${CARD_DEPTH}`;
}

export const MATCH_CARD_BASE_CLASS =
  "relative overflow-hidden rounded-[20px] p-3 sm:p-4 transition-all duration-200 border";

/** Equal-height carousel card (mobile only); desktop reverts to block flow. */
export const MATCH_CARD_FILL_CLASS = "h-full flex flex-col md:block md:h-auto";

export function PlayerMatchCard({
  match,
  ground,
  tournamentName,
  availability,
  isImmediateNext = false,
  variant = "default",
  layout = "default",
  onSelectMatch,
  onRsvp,
  isUpdatingRsvp = false,
  disabledRsvp = false,
  disabledRsvpReason,
}: PlayerMatchCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<AvailabilityChoice | null>(null);

  const isCompletedOrPast = Boolean(match.result && match.result !== "Pending");

  const handleSelect = async (stored: StoredAvailability, choice: AvailabilityChoice) => {
    if (!onRsvp || isUpdatingRsvp || disabledRsvp || pendingChoice) return;
    setPendingChoice(choice);
    try {
      await onRsvp(match.id, stored);
    } finally {
      setPendingChoice(null);
    }
  };

  const isAlternate = variant === "alternate" && !isImmediateNext;
  const isHome = layout === "home";

  const topBarEnd = (
    <>
      {isImmediateNext && (
        <span
          data-testid="next-match-highlight"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-scarlet text-white text-[10px] font-black uppercase tracking-wider font-heading whitespace-nowrap shadow-xs"
        >
          <Sparkles className="w-3 h-3" aria-hidden="true" />
          {/* Icon-only on very narrow phones so the corner tab always fits. */}
          <span className="max-[399px]:sr-only">Next Match</span>
        </span>
      )}
      {tournamentName && (
        <button
          type="button"
          data-testid={`expand-button-${match.id}`}
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded((prev) => !prev);
          }}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse secondary details" : "Expand secondary details"}
          className="flex items-center justify-center w-8 h-8 text-text-muted hover:text-text-primary rounded-full hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      )}
      <button
        type="button"
        data-testid={`view-details-${match.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelectMatch(match.id);
        }}
        aria-label={`View details for match vs ${match.opponent}`}
        title={isCompletedOrPast ? "Scorecard & squad" : "Match details & squad"}
        // Mobile Home: no visible chevron (the whole card opens details); it stays
        // available to keyboard / screen-reader users and appears when focused.
        className={`${isHome ? "max-md:sr-only max-md:focus-visible:not-sr-only " : ""}flex items-center justify-center w-8 h-8 text-scarlet hover:text-deep-wine rounded-full hover:bg-scarlet/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50`}
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </>
  );

  return (
    <div
      data-testid={`player-match-card-${match.id}`}
      data-variant={isAlternate ? "alternate" : "default"}
      data-layout={isHome ? "home" : undefined}
      onClick={() => onSelectMatch(match.id)}
      className={`${MATCH_CARD_BASE_CLASS} cursor-pointer ${isHome ? `${MATCH_CARD_FILL_CLASS} ` : ""}${getMatchCardSurfaceClass({
        isImmediateNext,
        isAlternate,
      })}`}
    >
      <MatchCardTopBar
        match={match}
        end={topBarEnd}
        corner={<MatchCornerTab match={match} className="md:hidden" />}
      />

      {isHome ? (
        <>
          <div className="md:hidden">
            <MatchCardCompactBody match={match} ground={ground} />
          </div>
          <div className="hidden md:block">
            <MatchCardHeader match={match} ground={ground} />
          </div>
        </>
      ) : (
        <MatchCardHeader match={match} ground={ground} chipsInCornerOnMobile />
      )}

      {isExpanded && tournamentName && (
        <div
          data-testid={`match-secondary-details-${match.id}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs"
        >
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold text-deep-wine bg-gold/15 border border-gold/40">
            <Trophy className="w-3 h-3 text-gold shrink-0" aria-hidden="true" />
            <span className="truncate max-w-[220px]">{tournamentName}</span>
          </span>
        </div>
      )}

      {/* Absorbs spare height so the availability row aligns across carousel cards. */}
      {isHome && <div aria-hidden="true" className="grow md:hidden" data-testid={`match-card-spacer-${match.id}`} />}

      {!isCompletedOrPast && onRsvp && (
        <div className="mt-3 pt-3 border-t border-border/80" onClick={(e) => e.stopPropagation()}>
          {disabledRsvp ? (
            <div className="py-2 px-2.5 rounded-xl bg-surface-hover text-[11px] text-text-muted text-center font-medium">
              {disabledRsvpReason || "Availability locked for this match"}
            </div>
          ) : (
            <AvailabilityButtons
              matchId={match.id}
              value={toAvailabilityChoice(availability)}
              busy={isUpdatingRsvp || pendingChoice !== null}
              pendingChoice={pendingChoice}
              onSelect={handleSelect}
            />
          )}
        </div>
      )}
    </div>
  );
}
