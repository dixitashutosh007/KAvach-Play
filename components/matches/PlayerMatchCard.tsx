"use client";

/**
 * Player match card (`components/matches/PlayerMatchCard.tsx`).
 *
 * Shared by the Player Match Center and the Player Home upcoming fixtures.
 * Uses the shared MatchCardHeader (format · jersey · opponent / date · time /
 * venue Maps link) and the three-position AvailabilitySelector.
 */
import React, { useState } from "react";
import { Sparkles, AlertCircle, Trophy, ChevronDown, ChevronRight } from "lucide-react";
import type { Match, MatchPayment, Ground } from "@/lib/types";
import {
  PersonalPaymentStatusResult,
  PlayerAvailabilityStatus,
} from "@/lib/personal-match-payment";
import { MatchCardHeader } from "./MatchCardHeader";
import {
  AvailabilitySelector,
  toAvailabilityChoice,
  type AvailabilityChoice,
  type StoredAvailability,
} from "./AvailabilitySelector";

export interface PlayerMatchCardProps {
  match: Match;
  ground?: Ground;
  tournamentName?: string;
  myPayment?: MatchPayment | null;
  personalPaymentStatus: PersonalPaymentStatusResult;
  availability: PlayerAvailabilityStatus | "Out";
  isImmediateNext?: boolean;
  isUnsettledAlert?: boolean;
  /** Visual variant for alternating consecutive cards in lists */
  variant?: "default" | "alternate";
  onSelectMatch: (matchId: string) => void;
  onRsvp?: (matchId: string, availability: StoredAvailability) => Promise<void>;
  isUpdatingRsvp?: boolean;
  disabledRsvp?: boolean;
  disabledRsvpReason?: string;
}

/** Shared surface classes so every match list uses the same card system. */
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
    return "bg-surface border-scarlet/40 ring-1 ring-scarlet/20 hover:border-scarlet/60 shadow-xs";
  }
  if (isUnsettledAlert) {
    return "bg-surface border-amber-300 ring-1 ring-amber-200 hover:border-amber-400 shadow-xs";
  }
  if (isAlternate) {
    return "bg-soft-blush border-deep-wine/10 hover:border-deep-wine/20 hover:shadow-sm";
  }
  return "bg-surface border-border hover:border-scarlet/25 hover:shadow-sm";
}

export const MATCH_CARD_BASE_CLASS =
  "relative overflow-hidden rounded-[20px] p-3 sm:p-4 shadow-xs transition-all duration-200 border";

export function AlternateAccentRail({ matchId }: { matchId: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid={`alternate-accent-${matchId}`}
      className="pointer-events-none absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full bg-dusty-red/45"
    />
  );
}

export function PlayerMatchCard({
  match,
  ground,
  tournamentName,
  personalPaymentStatus,
  availability,
  isImmediateNext = false,
  isUnsettledAlert = false,
  variant = "default",
  onSelectMatch,
  onRsvp,
  isUpdatingRsvp = false,
  disabledRsvp = false,
  disabledRsvpReason,
}: PlayerMatchCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<AvailabilityChoice | null>(null);

  const isCompletedOrPast = Boolean(match.result && match.result !== "Pending");
  const selectorValue = toAvailabilityChoice(availability);

  const handleSelect = async (stored: StoredAvailability, choice: AvailabilityChoice) => {
    if (!onRsvp || isUpdatingRsvp || disabledRsvp || pendingChoice) return;
    setPendingChoice(choice);
    try {
      await onRsvp(match.id, stored);
    } finally {
      setPendingChoice(null);
    }
  };

  const renderPaymentBadge = () => {
    const { status, netPayable, isWaived } = personalPaymentStatus;
    const base =
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border whitespace-nowrap";
    if (status === "PAID") {
      return (
        <span data-testid={`payment-status-${match.id}`} className={`${base} bg-emerald-50 text-emerald-800 border-emerald-200`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
          <span>PAID</span>
        </span>
      );
    }
    if (status === "PARTIALLY PAID") {
      return (
        <span data-testid={`payment-status-${match.id}`} className={`${base} bg-amber-50 text-amber-800 border-amber-200`}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span>PARTIALLY PAID • ₹{netPayable} due</span>
        </span>
      );
    }
    if (status === "UNPAID") {
      return (
        <span data-testid={`payment-status-${match.id}`} className={`${base} bg-rose-50 text-rose-800 border-rose-200`}>
          <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
          <span>UNPAID • ₹{netPayable}</span>
        </span>
      );
    }
    if (status === "WAIVED" || isWaived) {
      const historicalCollected =
        personalPaymentStatus.amountPaid > 0 ? ` • ₹${personalPaymentStatus.amountPaid} collected` : "";
      return (
        <span data-testid={`payment-status-${match.id}`} className={`${base} bg-blue-50 text-blue-800 border-blue-200`}>
          <span>WAIVED{historicalCollected}</span>
        </span>
      );
    }
    return null;
  };

  const isAlternate = variant === "alternate" && !isImmediateNext && !isUnsettledAlert;
  const hasSecondaryDetails = Boolean(tournamentName || match.matchType);

  return (
    <div
      data-testid={`player-match-card-${match.id}`}
      data-variant={isAlternate ? "alternate" : "default"}
      onClick={() => onSelectMatch(match.id)}
      className={`${MATCH_CARD_BASE_CLASS} cursor-pointer ${getMatchCardSurfaceClass({
        isImmediateNext,
        isUnsettledAlert,
        isAlternate,
      })}`}
    >
      {isAlternate && <AlternateAccentRail matchId={match.id} />}

      {isImmediateNext && (
        <div
          data-testid="next-match-highlight"
          className="mb-2.5 -mt-3 -mx-3 sm:-mt-4 sm:-mx-4 px-3 sm:px-4 py-1 flex items-center gap-1.5 bg-scarlet/10 border-b border-scarlet/20 text-scarlet text-[11px] font-black tracking-wide uppercase font-heading"
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Next Match</span>
        </div>
      )}

      {isUnsettledAlert && (
        <div
          data-testid={`unsettled-alert-${match.id}`}
          className="mb-2.5 -mt-3 -mx-3 sm:-mt-4 sm:-mx-4 px-3 sm:px-4 py-1.5 flex items-center gap-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs font-medium"
        >
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
          <span>
            <strong>Unsettled Obligation:</strong> ₹{personalPaymentStatus.netPayable} due for this past match.
          </span>
        </div>
      )}

      <MatchCardHeader
        match={match}
        ground={ground}
        meta={renderPaymentBadge()}
        trailing={
          hasSecondaryDetails ? (
            <button
              type="button"
              data-testid={`expand-button-${match.id}`}
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded((prev) => !prev);
              }}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? "Collapse secondary details" : "Expand secondary details"}
              className="shrink-0 flex items-center justify-center w-9 h-9 -mt-1.5 -mr-1.5 text-text-muted hover:text-text-primary rounded-full hover:bg-surface-hover/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
          ) : null
        }
      />

      {isExpanded && hasSecondaryDetails && (
        <div
          data-testid={`match-secondary-details-${match.id}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-2 pt-2 border-t border-border/60 flex flex-wrap items-center gap-1.5 text-xs"
        >
          {tournamentName && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-deep-wine bg-gold/15 border border-gold/40">
              <Trophy className="w-2.5 h-2.5 text-gold shrink-0" aria-hidden="true" />
              <span className="truncate max-w-[160px]">{tournamentName}</span>
            </span>
          )}
          {match.matchType && (
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold text-text-muted bg-surface-hover border border-border/50 uppercase">
              {match.matchType}
            </span>
          )}
        </div>
      )}

      {!isCompletedOrPast && onRsvp && (
        <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
          {disabledRsvp ? (
            <div className="py-2 px-2.5 rounded-xl bg-surface-hover text-[11px] text-text-muted text-center font-medium">
              {disabledRsvpReason || "Availability locked for this match"}
            </div>
          ) : (
            <AvailabilitySelector
              matchId={match.id}
              opponentLabel={match.opponent}
              value={selectorValue}
              busy={isUpdatingRsvp || pendingChoice !== null}
              pendingChoice={pendingChoice}
              onSelect={handleSelect}
            />
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-end">
        <button
          type="button"
          data-testid={`view-details-${match.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelectMatch(match.id);
          }}
          aria-label={`View details for match vs ${match.opponent}`}
          className="inline-flex items-center gap-0.5 font-bold text-scarlet hover:text-deep-wine text-[11px] min-h-[32px] -mb-1.5 px-1 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
        >
          <span>{isCompletedOrPast ? "Scorecard & Squad" : "Match Details & Squad"}</span>
          <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
