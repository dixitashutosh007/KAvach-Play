"use client";

import React from "react";
import {
  Calendar,
  Clock,
  MapPin,
  ExternalLink,
  Shirt,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  XCircle,
  AlertCircle,
  Trophy,
  ChevronRight,
  Loader2,
} from "lucide-react";
import type { Match, MatchPayment, Ground } from "@/lib/types";
import {
  PersonalPaymentStatusResult,
  PlayerAvailabilityStatus,
  formatMatchDisplayDate,
  formatMatchDisplayTime,
  computeReportingTime,
} from "@/lib/personal-match-payment";

export interface PlayerMatchCardProps {
  match: Match;
  ground?: Ground;
  tournamentName?: string;
  myPayment?: MatchPayment | null;
  personalPaymentStatus: PersonalPaymentStatusResult;
  availability: PlayerAvailabilityStatus | "Out";
  isImmediateNext?: boolean;
  isUnsettledAlert?: boolean;
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
  onSelectMatch,
  onRsvp,
  isUpdatingRsvp = false,
  disabledRsvp = false,
  disabledRsvpReason,
}: PlayerMatchCardProps) {
  const isPlaying = availability === "Playing";
  const isTentative = availability === "Maybe";
  const isOut = availability === "Out" || availability === "Not Playing";
  const isPending = availability === "Pending";

  const isCompletedOrPast =
    match.result && match.result !== "Pending";

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
  const reportingTime = computeReportingTime(match.time);

  // Result Badge Color and Text
  const getResultBadge = () => {
    if (!match.result || match.result === "Pending") return null;
    const res = match.result;
    if (res === "KAvach Won") {
      const margin = match.resultMarginAmount
        ? ` by ${match.resultMarginAmount} ${match.resultMarginType || "runs"}`
        : "";
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
          <Trophy className="w-3 h-3 text-emerald-600" />
          <span>Won{margin}</span>
        </span>
      );
    }
    if (res === "KAvach Lost") {
      const margin = match.resultMarginAmount
        ? ` by ${match.resultMarginAmount} ${match.resultMarginType || "runs"}`
        : "";
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
          <span>Lost{margin}</span>
        </span>
      );
    }
    if (res === "Abandoned") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700 border border-gray-300">
          <span>Abandoned</span>
        </span>
      );
    }
    if (res === "Tie" || res === "Draw") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
          <span>{res}</span>
        </span>
      );
    }
    return null;
  };

  // Payment Status Badge
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

  return (
    <div
      data-testid={`player-match-card-${match.id}`}
      onClick={() => onSelectMatch(match.id)}
      className={`relative bg-surface rounded-2xl p-4 shadow-xs transition-all duration-200 cursor-pointer border ${
        isImmediateNext
          ? "border-scarlet/40 ring-1 ring-scarlet/20 hover:border-scarlet/60"
          : isUnsettledAlert
          ? "border-amber-300 ring-1 ring-amber-200 hover:border-amber-400"
          : "border-border hover:border-border/80 hover:shadow-sm"
      }`}
    >
      {/* Immediate Next Match Banner */}
      {isImmediateNext && (
        <div
          data-testid="next-match-highlight"
          className="mb-3 -mt-1 flex items-center justify-between bg-scarlet/10 -mx-4 -mt-4 px-4 py-1.5 rounded-t-2xl border-b border-scarlet/20 text-scarlet"
        >
          <div className="flex items-center gap-1.5 text-xs font-black tracking-wide uppercase font-heading">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Next Match</span>
          </div>
          <span className="text-[11px] font-semibold text-deep-wine">
            Immediate Fixture
          </span>
        </div>
      )}

      {/* Unsettled Older Match Alert Callout */}
      {isUnsettledAlert && (
        <div
          data-testid={`unsettled-alert-${match.id}`}
          className="mb-3 flex items-center gap-2 bg-amber-50 -mx-4 -mt-4 px-4 py-2 rounded-t-2xl border-b border-amber-200 text-amber-900 text-xs font-medium"
        >
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Unsettled Obligation:</strong> ₹
            {personalPaymentStatus.netPayable} due for this past match.
          </span>
        </div>
      )}

      {/* Card Header Tags */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-canvas-warm border border-border text-deep-wine font-heading">
            {match.format || "T20"}
          </span>

          {tournamentName && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-deep-wine bg-gold/15 border border-gold/40">
              <Trophy className="w-2.5 h-2.5 text-gold" />
              <span className="truncate max-w-[130px]">{tournamentName}</span>
            </span>
          )}

          {match.jerseyColor && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-text-secondary bg-surface-hover border border-border/60">
              <Shirt className="w-2.5 h-2.5 text-scarlet" />
              <span>{match.jerseyColor}</span>
            </span>
          )}
        </div>

        {/* Personal Payment Badge (Isolated to Logged-in Player) */}
        {renderPaymentBadge()}
      </div>

      {/* Opponent & Result Title */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-base sm:text-lg font-black font-heading text-text-primary tracking-tight leading-snug">
          vs {match.opponent}
        </h3>
        {getResultBadge()}
      </div>

      {/* Date, Time, Venue, and Reporting Time */}
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
          {reportingTime && !isCompletedOrPast && (
            <>
              <span className="text-text-muted">•</span>
              <span className="text-[11px] font-semibold text-deep-wine bg-scarlet/5 px-1.5 py-0.2 rounded border border-scarlet/15">
                Report by {reportingTime}
              </span>
            </>
          )}
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
                className="inline-flex items-center gap-1 text-[11px] font-bold text-scarlet hover:text-deep-wine shrink-0 min-h-[32px] px-1.5"
                aria-label={`Directions to ${ground.name}`}
              >
                <span>Directions</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* 1-Tap Availability RSVP Actions (for Upcoming Matches) */}
      {!isCompletedOrPast && onRsvp && (
        <div
          className="mt-3 pt-3 border-t border-border/70 flex flex-col gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold uppercase tracking-wider text-text-muted">
              Your Availability
            </span>
            <div className="flex items-center gap-1">
              {isPlaying && (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Playing</span>
                </span>
              )}
              {isTentative && (
                <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Maybe</span>
                </span>
              )}
              {isOut && (
                <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Out</span>
                </span>
              )}
              {isPending && (
                <span className="inline-flex items-center gap-1 text-scarlet font-bold">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>RSVP Needed</span>
                </span>
              )}
            </div>
          </div>

          {disabledRsvp ? (
            <div className="py-1 px-2.5 rounded-lg bg-surface-hover text-[11px] text-text-muted text-center font-medium">
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

      {/* Card Footer: Detail view link */}
      <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center justify-between text-xs text-text-secondary">
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
