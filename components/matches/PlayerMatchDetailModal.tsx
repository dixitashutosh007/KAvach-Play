"use client";

import React, { useEffect } from "react";
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  ExternalLink,
  Shirt,
  Trophy,
  CheckCircle2,
  HelpCircle,
  XCircle,
  AlertCircle,
  Users,
  CreditCard,
  Share2,
  Video,
  Award,
  Loader2,
} from "lucide-react";
import type { Match, MatchPayment, Ground, Player } from "@/lib/types";
import {
  PersonalPaymentStatusResult,
  PlayerAvailabilityStatus,
  formatMatchDisplayDate,
  formatMatchDisplayTime,
  computeReportingTime,
} from "@/lib/personal-match-payment";

export interface PlayerMatchDetailModalProps {
  match: Match;
  ground?: Ground;
  tournamentName?: string;
  allPlayers: Player[];
  matchPayments: MatchPayment[];
  mePlayer: Player | null;
  personalPaymentStatus: PersonalPaymentStatusResult;
  availability: PlayerAvailabilityStatus | "Out";
  onClose: () => void;
  onRsvp?: (
    matchId: string,
    availability: "Confirmed" | "Tentative" | "No"
  ) => Promise<void>;
  isUpdatingRsvp?: boolean;
  disabledRsvp?: boolean;
  disabledRsvpReason?: string;
  onNavigateToPayments?: () => void;
}

export function PlayerMatchDetailModal({
  match,
  ground,
  tournamentName,
  allPlayers,
  matchPayments,
  mePlayer,
  personalPaymentStatus,
  availability,
  onClose,
  onRsvp,
  isUpdatingRsvp = false,
  disabledRsvp = false,
  disabledRsvpReason,
  onNavigateToPayments,
}: PlayerMatchDetailModalProps) {
  // ESC key support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const isPlaying = availability === "Playing";
  const isTentative = availability === "Maybe";
  const isOut = availability === "Out" || availability === "Not Playing";
  const isPending = availability === "Pending";

  const isCompletedOrPast =
    match.result && match.result !== "Pending";

  const formattedDate = formatMatchDisplayDate(match.date);
  const formattedTime = formatMatchDisplayTime(match.time);
  const reportingTime = computeReportingTime(match.time);

  // Filter squad members (players associated with this match)
  const squadMembers = matchPayments
    .filter((p) => p.status !== "Not Playing" || p.availability === "Confirmed" || p.availability === "Tentative")
    .map((p) => {
      const playerRecord = allPlayers.find((pl) => pl.id === p.playerId);
      const displayName = p.guestName || playerRecord?.name || "Player";
      const isGuest = Boolean(p.guestName);
      let memberAv = "Playing";
      if (p.availability === "Tentative") memberAv = "Maybe";
      if (p.availability === "No" || p.status === "Not Playing") memberAv = "Out";
      if (!p.availability) memberAv = "Pending";
      return {
        id: p.id,
        playerId: p.playerId,
        displayName,
        isGuest,
        availability: memberAv,
        tacticalNote: p.tacticalNote,
        isMe: mePlayer && p.playerId === mePlayer.id,
      };
    });

  // Handle Share Match
  const handleShare = () => {
    const shareText = `🏏 *KAvach Match Announcement*\nvs ${match.opponent}\n📅 ${formattedDate} at ${formattedTime}\n📍 ${ground?.name || "Venue TBD"}\n👕 Jersey: ${match.jerseyColor || "Scarlet Red"}\n\nView details on KAvach Play: ${window.location.origin}`;
    if (navigator.share) {
      navigator.share({
        title: `KAvach vs ${match.opponent}`,
        text: shareText,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(shareText);
      alert("Match details copied to clipboard!");
    }
  };

  return (
    <div
      data-testid="player-match-detail-view"
      className="space-y-5 pb-12 max-w-4xl mx-auto"
    >
      {/* Top Bar with Back Button and Share */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to matches"
          className="min-h-[44px] min-w-[44px] flex items-center gap-1.5 text-xs font-bold text-text-primary hover:text-scarlet transition cursor-pointer -ml-2 px-2"
        >
          <ArrowLeft className="w-4 h-4 text-scarlet" />
          <span>Back</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleShare}
            aria-label="Share match details"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-surface-hover border border-border text-text-secondary hover:text-scarlet transition cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="space-y-5">
          {/* Match Title & Format Badges */}
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-canvas-warm border border-border text-deep-wine font-heading">
                {match.format || "T20"}
              </span>

              {tournamentName && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold text-deep-wine bg-gold/15 border border-gold/40">
                  <Trophy className="w-3 h-3 text-gold" />
                  <span>{tournamentName}</span>
                </span>
              )}

              {match.jerseyColor && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-text-secondary bg-surface-hover border border-border/60">
                  <Shirt className="w-3 h-3 text-scarlet" />
                  <span>{match.jerseyColor}</span>
                </span>
              )}

              {match.matchType && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold text-text-muted bg-surface-hover border border-border/40 uppercase">
                  {match.matchType}
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-black font-heading text-text-primary tracking-tight">
              vs {match.opponent}
            </h1>
          </div>

          {/* Match Result Banner (if completed or abandoned) */}
          {match.result && match.result !== "Pending" && (
            <div className="bg-canvas-warm border border-border rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                  Match Outcome
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-extrabold ${
                    match.result === "KAvach Won"
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : match.result === "KAvach Lost"
                      ? "bg-rose-100 text-rose-800 border border-rose-300"
                      : match.result === "Abandoned"
                      ? "bg-gray-200 text-gray-800 border border-gray-300"
                      : "bg-amber-100 text-amber-800 border border-amber-300"
                  }`}
                >
                  {match.result}
                  {match.resultMarginAmount
                    ? ` by ${match.resultMarginAmount} ${match.resultMarginType || "runs"}`
                    : ""}
                </span>
              </div>

              {match.playerOfTheMatch && (
                <div className="flex items-center gap-2 pt-2 border-t border-border/60 text-xs">
                  <Award className="w-4 h-4 text-gold shrink-0" />
                  <span className="text-text-muted">Player of the Match:</span>
                  <span className="font-bold text-text-primary">
                    {match.playerOfTheMatch}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Schedule & Venue Card */}
          <div className="bg-surface-hover border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-scarlet/10 flex items-center justify-center shrink-0">
                <Calendar className="w-4 h-4 text-scarlet" />
              </div>
              <div className="flex-1">
                <div className="text-xs font-bold uppercase tracking-wider text-text-muted">
                  Date & Time
                </div>
                <div className="text-sm font-bold text-text-primary mt-0.5">
                  {formattedDate} • {formattedTime}
                </div>
                {reportingTime && !isCompletedOrPast && (
                  <div className="text-xs text-deep-wine font-semibold mt-0.5">
                    Player reporting time: {reportingTime}
                  </div>
                )}
              </div>
            </div>

            {ground && (
              <div className="flex items-start gap-3 pt-3 border-t border-border/60">
                <div className="w-9 h-9 rounded-xl bg-scarlet/10 flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4 text-scarlet" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-text-muted">
                    Venue
                  </div>
                  <div className="text-sm font-bold text-text-primary mt-0.5">
                    {ground.name}
                  </div>
                  {ground.mapUrl && (
                    <a
                      href={ground.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-bold text-scarlet hover:text-deep-wine mt-1 min-h-[32px]"
                    >
                      <span>Open in Google Maps</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* External Links: CricHeroes / Streaming */}
            {(match.matchUrl || match.streamingUrl) && (
              <div className="pt-3 border-t border-border/60 flex flex-wrap gap-2">
                {match.matchUrl && (
                  <a
                    href={match.matchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-border text-xs font-bold text-text-primary hover:text-scarlet min-h-[44px]"
                  >
                    <span>CricHeroes Scorecard</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {match.streamingUrl && (
                  <a
                    href={match.streamingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-scarlet/10 border border-scarlet/20 text-xs font-bold text-scarlet hover:text-deep-wine min-h-[44px]"
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>Watch Live Stream</span>
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Personal Financial Obligation Card (Strict Privacy: Logged-in Player Only) */}
          <div
            data-testid="personal-payment-detail-card"
            className="bg-surface border border-border rounded-2xl p-4 shadow-xs"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-deep-wine/10 flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-deep-wine" />
                </div>
                <h3 className="text-sm font-bold font-heading text-text-primary">
                  Your Payment Status
                </h3>
              </div>

              {/* Status Badge */}
              {personalPaymentStatus.status === "PAID" && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200">
                  PAID
                </span>
              )}
              {personalPaymentStatus.status === "PARTIALLY PAID" && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200">
                  PARTIALLY PAID
                </span>
              )}
              {personalPaymentStatus.status === "UNPAID" && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-rose-50 text-rose-800 border border-rose-200">
                  UNPAID
                </span>
              )}
              {personalPaymentStatus.status === "WAIVED" && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-blue-50 text-blue-800 border border-blue-200">
                  WAIVED
                </span>
              )}
            </div>

            {/* Financial Details */}
            <div className="space-y-1.5 text-xs text-text-secondary">
              <div className="flex justify-between items-center py-1 border-b border-border/50">
                <span>Standard Match Fee:</span>
                <span className="font-bold text-text-primary">₹{match.fee}</span>
              </div>

              {personalPaymentStatus.feeOverride !== undefined && (
                <div className="flex justify-between items-center py-1 border-b border-border/50">
                  <span>Fee Override:</span>
                  <span className="font-bold text-text-primary">
                    ₹{personalPaymentStatus.feeOverride}
                  </span>
                </div>
              )}

              {personalPaymentStatus.paidAmount > 0 && (
                <div className="flex justify-between items-center py-1 border-b border-border/50">
                  <span>Amount Paid / Settled:</span>
                  <span className="font-bold text-emerald-700">
                    ₹{personalPaymentStatus.paidAmount}
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center py-1.5 text-sm font-bold text-text-primary">
                <span>Outstanding Payable:</span>
                <span
                  className={
                    personalPaymentStatus.netPayable > 0
                      ? "text-rose-600 font-black text-base"
                      : "text-emerald-700 font-bold"
                  }
                >
                  ₹{personalPaymentStatus.netPayable}
                </span>
              </div>
            </div>

            {/* Status Explanations & Payment Link */}
            {personalPaymentStatus.status === "WAIVED" ? (
              <div className="mt-3 p-2.5 rounded-xl bg-blue-50/70 border border-blue-100 text-[11px] text-blue-900 font-medium">
                Fee obligation is waived under club policy. No action needed.
              </div>
            ) : personalPaymentStatus.status === "PAID" ? (
              <div className="mt-3 p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-100 text-[11px] text-emerald-900 font-medium">
                ✓ Fully settled. Thank you for keeping your account in good standing.
              </div>
            ) : personalPaymentStatus.netPayable > 0 && onNavigateToPayments ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigateToPayments();
                }}
                className="mt-3 w-full min-h-[44px] py-2 px-3 rounded-xl bg-scarlet text-white font-bold text-xs hover:bg-deep-wine transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <span>Pay ₹{personalPaymentStatus.netPayable} via Payments Tab</span>
              </button>
            ) : null}
          </div>

          {/* Availability Actions (for upcoming fixtures) */}
          {!isCompletedOrPast && onRsvp && (
            <div className="bg-surface border border-border rounded-2xl p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold font-heading text-text-primary">
                  Your Availability
                </h3>
                <div className="flex items-center gap-1 text-xs">
                  {isPlaying && (
                    <span className="font-bold text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Playing
                    </span>
                  )}
                  {isTentative && (
                    <span className="font-bold text-amber-700 flex items-center gap-1">
                      <HelpCircle className="w-3.5 h-3.5" /> Maybe
                    </span>
                  )}
                  {isOut && (
                    <span className="font-bold text-rose-700 flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> Out
                    </span>
                  )}
                  {isPending && (
                    <span className="font-bold text-scarlet flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> RSVP Needed
                    </span>
                  )}
                </div>
              </div>

              {disabledRsvp ? (
                <div className="py-2 px-3 rounded-xl bg-surface-hover text-xs text-text-muted text-center font-medium">
                  {disabledRsvpReason || "Availability locked for this match"}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={isUpdatingRsvp}
                    aria-pressed={isPlaying}
                    aria-label="Mark availability as Playing"
                    onClick={() => onRsvp(match.id, "Confirmed")}
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
                    onClick={() => onRsvp(match.id, "Tentative")}
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
                    onClick={() => onRsvp(match.id, "No")}
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

          {/* Squad & Teammate Availability (Strict Privacy: NO teammate payment data) */}
          <div
            data-testid="squad-availability-section"
            className="bg-surface border border-border rounded-2xl p-4 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-scarlet" />
                <h3 className="text-sm font-bold font-heading text-text-primary">
                  Squad & Teammates ({squadMembers.length})
                </h3>
              </div>
              <span className="text-[11px] font-medium text-text-muted">
                Availability Only
              </span>
            </div>

            {squadMembers.length > 0 ? (
              <div className="divide-y divide-border/60">
                {squadMembers.map((member) => (
                  <div
                    key={member.id}
                    className="py-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-semibold text-text-primary truncate">
                        {member.displayName}
                        {member.isMe && (
                          <span className="ml-1 text-[10px] text-deep-wine font-black">
                            (You)
                          </span>
                        )}
                      </span>
                      {member.isGuest && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-surface-hover text-text-muted border border-border">
                          Guest
                        </span>
                      )}
                    </div>

                    <div className="shrink-0">
                      {member.availability === "Playing" ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          Playing
                        </span>
                      ) : member.availability === "Maybe" ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          Maybe
                        </span>
                      ) : member.availability === "Out" ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                          Out
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-200">
                          Pending
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted py-2">
                Squad has not yet been announced for this match.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
