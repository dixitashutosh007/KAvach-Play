"use client";

import React, { useState } from "react";
import {
  Calendar,
  Clock,
  MapPin,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  XCircle,
  AlertCircle,
  Trophy,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import type { Match, MatchPayment, Ground } from "@/lib/types";
import {
  PersonalPaymentStatusResult,
  PlayerAvailabilityStatus,
  formatMatchDisplayDate,
  formatMatchDisplayTime,
} from "@/lib/personal-match-payment";
import { JerseyInfographic } from "./JerseyInfographic";

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
  onRsvp?: (
    matchId: string,
    availability: "Confirmed" | "Tentative" | "No"
  ) => Promise<void>;
  isUpdatingRsvp?: boolean;
  disabledRsvp?: boolean;
  disabledRsvpReason?: string;
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

  const isPlaying = availability === "Playing";
  const isTentative = availability === "Maybe";
  const isOut = availability === "Out" || availability === "Not Playing";

  const isCompletedOrPast = Boolean(
    match.result && match.result !== "Pending"
  );

  const handleActionClick = async (
    e: React.MouseEvent,
    targetAvailability: "Confirmed" | "Tentative" | "No"
  ) => {
    e.stopPropagation();
    if (!onRsvp || isUpdatingRsvp || disabledRsvp) return;
    await onRsvp(match.id, targetAvailability);
  };

  const formattedDate = formatMatchDisplayDate(match.date);
  const formattedTime = formatMatchDisplayTime(match.time);

  // Prominent Sports Result Stamp (Section 5)
  const getResultStamp = () => {
    if (!match.result || match.result === "Pending") return null;
    const res = match.result;
    const margin = match.resultMarginAmount
      ? `by ${match.resultMarginAmount} ${match.resultMarginType || "runs"}`
      : "";

    if (res === "KAvach Won") {
      return (
        <div
          data-testid={`result-stamp-${match.id}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider bg-emerald-600 text-white shadow-xs border border-emerald-700 font-heading shrink-0"
        >
          <Trophy className="w-3.5 h-3.5 text-emerald-100 shrink-0" />
          <span>WON</span>
          {margin && (
            <span className="font-semibold text-[11px] normal-case tracking-normal opacity-90 border-l border-emerald-500/80 pl-1.5 ml-0.5">
              {margin}
            </span>
          )}
        </div>
      );
    }

    if (res === "KAvach Lost") {
      return (
        <div
          data-testid={`result-stamp-${match.id}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider bg-rose-600 text-white shadow-xs border border-rose-700 font-heading shrink-0"
        >
          <span>LOST</span>
          {margin && (
            <span className="font-semibold text-[11px] normal-case tracking-normal opacity-90 border-l border-rose-500/80 pl-1.5 ml-0.5">
              {margin}
            </span>
          )}
        </div>
      );
    }

    if (res === "Abandoned") {
      return (
        <div
          data-testid={`result-stamp-${match.id}`}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider bg-slate-200 text-slate-800 border border-slate-300 font-heading shrink-0"
        >
          <span>ABANDONED</span>
        </div>
      );
    }

    if (res === "Tie" || res === "Draw") {
      return (
        <div
          data-testid={`result-stamp-${match.id}`}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider bg-amber-500 text-white shadow-xs border border-amber-600 font-heading shrink-0"
        >
          <span>{res.toUpperCase()}</span>
        </div>
      );
    }

    return null;
  };

  // Personal Payment Status Badge
  const renderPaymentBadge = () => {
    const { status, netPayable, isWaived } = personalPaymentStatus;
    if (status === "PAID") {
      return (
        <span
          data-testid={`payment-status-${match.id}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
          <span>PAID</span>
        </span>
      );
    }
    if (status === "PARTIALLY PAID") {
      return (
        <span
          data-testid={`payment-status-${match.id}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span>PARTIALLY PAID • ₹{netPayable} due</span>
        </span>
      );
    }
    if (status === "UNPAID") {
      return (
        <span
          data-testid={`payment-status-${match.id}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-rose-50 text-rose-800 border border-rose-200"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
          <span>UNPAID • ₹{netPayable}</span>
        </span>
      );
    }
    if (status === "WAIVED" || isWaived) {
      const historicalCollected =
        personalPaymentStatus.amountPaid > 0
          ? ` • ₹${personalPaymentStatus.amountPaid} collected`
          : "";
      return (
        <span
          data-testid={`payment-status-${match.id}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-blue-50 text-blue-800 border border-blue-200"
        >
          <span>WAIVED{historicalCollected}</span>
        </span>
      );
    }
    return null;
  };

  const cardSurfaceClass = isImmediateNext
    ? "bg-surface border-scarlet/40 ring-1 ring-scarlet/20 hover:border-scarlet/60 shadow-xs"
    : isUnsettledAlert
    ? "bg-surface border-amber-300 ring-1 ring-amber-200 hover:border-amber-400 shadow-xs"
    : variant === "alternate"
    ? "bg-warm-white/70 border-border/90 hover:border-border hover:shadow-sm"
    : "bg-surface border-border hover:border-border/80 hover:shadow-sm";

  return (
    <div
      data-testid={`player-match-card-${match.id}`}
      data-variant={variant}
      onClick={() => onSelectMatch(match.id)}
      className={`relative rounded-[22px] p-3.5 sm:p-4 shadow-xs transition-all duration-200 cursor-pointer border ${cardSurfaceClass}`}
    >
      {/* Immediate Next Match Banner (Without redundant 'Immediate Fixture' label) */}
      {isImmediateNext && (
        <div
          data-testid="next-match-highlight"
          className="mb-3 -mt-3.5 -mx-3.5 sm:-mt-4 sm:-mx-4 px-3.5 sm:px-4 py-1.5 rounded-t-[21px] flex items-center justify-between bg-scarlet/10 border-b border-scarlet/20 text-scarlet"
        >
          <div className="flex items-center gap-1.5 text-xs font-black tracking-wide uppercase font-heading">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Next Match</span>
          </div>
        </div>
      )}

      {/* Unsettled Older Match Alert Callout */}
      {isUnsettledAlert && (
        <div
          data-testid={`unsettled-alert-${match.id}`}
          className="mb-3 -mt-3.5 -mx-3.5 sm:-mt-4 sm:-mx-4 px-3.5 sm:px-4 py-2 rounded-t-[21px] flex items-center gap-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs font-medium"
        >
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Unsettled Obligation:</strong> ₹
            {personalPaymentStatus.netPayable} due for this past match.
          </span>
        </div>
      )}

      {/* Header Row: Jersey visual infographic, Personal Payment Badge, and Expand/Collapse Affordance */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {match.jerseyColor && (
            <JerseyInfographic color={match.jerseyColor} size="sm" />
          )}
          {renderPaymentBadge()}
        </div>

        {/* Progressive Disclosure Toggle */}
        <button
          type="button"
          data-testid={`expand-button-${match.id}`}
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded((prev) => !prev);
          }}
          aria-expanded={isExpanded}
          aria-label={
            isExpanded ? "Collapse secondary details" : "Expand secondary details"
          }
          className="flex items-center justify-center min-w-[44px] min-h-[44px] -mr-2 text-text-muted hover:text-text-primary rounded-full hover:bg-surface-hover/80 transition-colors"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {/* Opponent & Prominent Result Stamp */}
      <div className="flex items-center justify-between gap-2.5 mb-2">
        <h3 className="text-base sm:text-lg font-black font-heading text-text-primary tracking-tight leading-snug">
          vs {match.opponent}
        </h3>
        {getResultStamp()}
      </div>

      {/* Date, Time & Venue (Report By text removed) */}
      <div className="space-y-1.5 text-xs text-text-secondary font-medium">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 text-text-primary font-semibold">
            <Calendar className="w-3.5 h-3.5 text-scarlet shrink-0" />
            <span>{formattedDate}</span>
          </div>
          <span className="text-text-muted">•</span>
          <div className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-scarlet shrink-0" />
            <span>{formattedTime}</span>
          </div>
        </div>

        {ground && (
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-1.5 truncate">
              <MapPin className="w-3.5 h-3.5 text-scarlet shrink-0" />
              <span className="truncate text-text-primary font-medium">
                {ground.name}
              </span>
            </div>
            {ground.mapUrl && (
              <a
                href={ground.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-scarlet hover:text-deep-wine shrink-0 min-h-[44px] px-2 -my-2.5"
                aria-label={`Directions to ${ground.name}`}
              >
                <span>Directions</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* Progressive Disclosure: Collapsed Secondary Match Metadata */}
      {isExpanded && (
        <div
          data-testid={`match-secondary-details-${match.id}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-2.5 pt-2.5 border-t border-border/60 flex flex-wrap items-center justify-between gap-2 text-xs animate-in fade-in duration-150"
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-canvas-warm border border-border text-deep-wine font-heading">
              {match.format || "T20"} Format
            </span>

            {tournamentName && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-deep-wine bg-gold/15 border border-gold/40">
                <Trophy className="w-2.5 h-2.5 text-gold shrink-0" />
                <span className="truncate max-w-[130px]">{tournamentName}</span>
              </span>
            )}

            {match.matchType && (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold text-text-muted bg-surface-hover border border-border/50 uppercase">
                {match.matchType}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => onSelectMatch(match.id)}
            className="inline-flex items-center gap-0.5 text-[11px] font-bold text-scarlet hover:text-deep-wine cursor-pointer min-h-[36px] py-1"
          >
            <span>{isCompletedOrPast ? "Full Scorecard" : "Full Match Details"}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1-Tap Availability Actions for Upcoming Matches (Self-Explanatory, Clean) */}
      {!isCompletedOrPast && onRsvp && (
        <div
          className="mt-3 pt-2.5 border-t border-border/70"
          onClick={(e) => e.stopPropagation()}
        >
          {disabledRsvp ? (
            <div className="py-2 px-2.5 rounded-xl bg-surface-hover text-[11px] text-text-muted text-center font-medium">
              {disabledRsvpReason || "Availability locked for this match"}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={isUpdatingRsvp}
                aria-pressed={isPlaying}
                aria-label="Mark availability as Playing"
                onClick={(e) => handleActionClick(e, "Confirmed")}
                className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-60 ${
                  isPlaying
                    ? "bg-emerald-600 text-white shadow-xs font-black"
                    : "bg-surface-hover text-emerald-800 border border-emerald-200 hover:bg-emerald-50"
                }`}
              >
                {isUpdatingRsvp && isPlaying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>Playing</span>
              </button>

              <button
                type="button"
                disabled={isUpdatingRsvp}
                aria-pressed={isTentative}
                aria-label="Mark availability as Maybe"
                onClick={(e) => handleActionClick(e, "Tentative")}
                className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-60 ${
                  isTentative
                    ? "bg-amber-600 text-white shadow-xs font-black"
                    : "bg-surface-hover text-amber-800 border border-amber-200 hover:bg-amber-50"
                }`}
              >
                {isUpdatingRsvp && isTentative ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <HelpCircle className="w-3.5 h-3.5" />
                )}
                <span>Maybe</span>
              </button>

              <button
                type="button"
                disabled={isUpdatingRsvp}
                aria-pressed={isOut}
                aria-label="Mark availability as Out"
                onClick={(e) => handleActionClick(e, "No")}
                className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-60 ${
                  isOut
                    ? "bg-rose-600 text-white shadow-xs font-black"
                    : "bg-surface-hover text-rose-800 border border-rose-200 hover:bg-rose-50"
                }`}
              >
                {isUpdatingRsvp && isOut ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                <span>Out</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Card Footer: Detail view link affordance */}
      <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between text-xs text-text-secondary">
        <span className="font-semibold text-[11px] text-text-muted">
          {isCompletedOrPast ? "Scorecard & Squad" : "Match details & Squad"}
        </span>
        <div className="flex items-center gap-0.5 font-bold text-scarlet text-[11px] group-hover:translate-x-0.5 transition-transform">
          <span>View Details</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </div>
  );
}
