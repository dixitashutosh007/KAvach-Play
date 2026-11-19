"use client";

import { useState } from "react";
import {
  CalendarDays,
  Clock,
  MapPin,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertCircle,
  ChevronRight,
  Shirt,
  Calendar,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { Match, Ground, MatchPayment, Player } from "@/lib/types";

export function UpcomingMatchesSection({
  matches = [],
  grounds = [],
  payments = [],
  player,
  onRsvp,
  onNavigateToMatch,
  onNavigateToAllMatches,
}: {
  matches: Match[];
  grounds: Ground[];
  payments: MatchPayment[];
  player: Player | null;
  onRsvp: (matchId: string, availability: "Confirmed" | "Tentative" | "No") => Promise<void>;
  onNavigateToMatch: (matchId: string) => void;
  onNavigateToAllMatches: () => void;
}) {
  const [updatingMatchId, setUpdatingMatchId] = useState<string | null>(null);

  // Take up to next 4 matches
  const displayMatches = matches.slice(0, 4);

  const getMatchPayment = (matchId: string) => {
    if (!player) return null;
    return payments.find((p) => p.playerId === player.id && p.matchId === matchId);
  };

  const getEffectiveAvailability = (payment?: MatchPayment | null) => {
    if (!payment) return "Pending";
    if (payment.availability) return payment.availability;
    if (payment.status === "Paid" || payment.status === "Unpaid") return "Confirmed";
    if (payment.status === "Not Playing") return "No";
    return "Pending";
  };

  const handleAction = async (
    matchId: string,
    status: "Confirmed" | "Tentative" | "No"
  ) => {
    if (updatingMatchId) return;
    setUpdatingMatchId(matchId);
    try {
      await onRsvp(matchId, status);
    } finally {
      setUpdatingMatchId(null);
    }
  };

  return (
    <section
      data-testid="upcoming-matches-section"
      aria-label="Upcoming Match Fixtures"
      className="w-full flex flex-col gap-3.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-soft-blush flex items-center justify-center">
            <CalendarDays className="w-3.5 h-3.5 text-scarlet" />
          </div>
          <h2 className="text-xs sm:text-sm font-bold text-text-primary uppercase tracking-wider font-heading">
            Upcoming Fixtures
          </h2>
        </div>

        <button
          type="button"
          onClick={onNavigateToAllMatches}
          className="min-h-[44px] inline-flex items-center gap-1 text-xs font-bold text-scarlet hover:text-deep-wine transition px-1 cursor-pointer"
        >
          <span>All Matches ({matches.length})</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {displayMatches.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {displayMatches.map((match) => {
            const payment = getMatchPayment(match.id);
            const ground = grounds.find((g) => g.id === match.groundId);
            const availability = getEffectiveAvailability(payment);

            const isPlaying = availability === "Confirmed" || availability === "Yes";
            const isTentative = availability === "Tentative";
            const isOut = availability === "No";
            const isPending = !isPlaying && !isTentative && !isOut;
            const isUpdating = updatingMatchId === match.id;

            let formattedDate = match.date;
            try {
              formattedDate = format(new Date(match.date), "EEE, MMM d, yyyy");
            } catch {
              // fallback
            }

            let formattedTime = "Time TBD";
            if (match.time) {
              try {
                formattedTime = format(parseISO(`${match.date}T${match.time}`), "h:mm a");
              } catch {
                formattedTime = match.time;
              }
            }

            return (
              <div
                key={match.id}
                data-testid={`match-card-${match.id}`}
                className="bg-surface border border-border rounded-2xl p-4 shadow-xs flex flex-col justify-between gap-3 transition hover:border-scarlet/30"
              >
                {/* Header Row: Format, Jersey, and RSVP Badge */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-canvas-warm border border-border text-deep-wine font-heading">
                        {match.format || "T20"}
                      </span>
                      {match.jerseyColor && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-text-secondary bg-surface-hover border border-border/60">
                          <Shirt className="w-2.5 h-2.5 text-scarlet" />
                          <span>{match.jerseyColor}</span>
                        </span>
                      )}
                    </div>

                    {/* Status Badge */}
                    {isPlaying ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Playing</span>
                      </span>
                    ) : isTentative ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        <HelpCircle className="w-3 h-3 text-amber-600" />
                        <span>Maybe</span>
                      </span>
                    ) : isOut ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                        <XCircle className="w-3 h-3 text-rose-600" />
                        <span>Not Playing</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-scarlet/10 text-scarlet border border-scarlet/20">
                        <AlertCircle className="w-3 h-3" />
                        <span>RSVP Needed</span>
                      </span>
                    )}
                  </div>

                  {/* Opponent & Match Title */}
                  <h3 className="text-base sm:text-lg font-black font-heading text-text-primary tracking-tight leading-snug">
                    vs {match.opponent}
                  </h3>

                  {/* Date, Time, Venue Details */}
                  <div className="mt-2 flex flex-col gap-1 text-xs text-text-secondary font-medium">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-scarlet shrink-0" />
                      <span>{formattedDate}</span>
                      <span className="text-text-muted">•</span>
                      <Clock className="w-3.5 h-3.5 text-scarlet shrink-0" />
                      <span>{formattedTime}</span>
                    </div>

                    {ground && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-scarlet shrink-0" />
                        {ground.mapUrl ? (
                          <a
                            href={ground.mapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-scarlet hover:text-deep-wine font-semibold hover:underline truncate"
                          >
                            {ground.name}
                          </a>
                        ) : (
                          <span className="truncate">{ground.name}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 1-Tap RSVP Availability Actions (Section 4.G) */}
                <div className="pt-2 border-t border-border/60 flex flex-col gap-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted flex items-center justify-between">
                    <span>Your Availability</span>
                    <button
                      type="button"
                      onClick={() => onNavigateToMatch(match.id)}
                      className="text-scarlet hover:text-deep-wine cursor-pointer font-bold lowercase first-letter:uppercase"
                    >
                      details & directions &rarr;
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      disabled={isUpdating}
                      aria-pressed={isPlaying}
                      aria-label="Mark availability as Playing"
                      onClick={() => handleAction(match.id, "Confirmed")}
                      className={`min-h-[44px] px-2 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-60 ${
                        isPlaying
                          ? "bg-emerald-600 text-white shadow-xs font-black"
                          : "bg-canvas-warm text-emerald-800 border border-emerald-200/80 hover:bg-emerald-50"
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Playing</span>
                    </button>

                    <button
                      type="button"
                      disabled={isUpdating}
                      aria-pressed={isTentative}
                      aria-label="Mark availability as Maybe"
                      onClick={() => handleAction(match.id, "Tentative")}
                      className={`min-h-[44px] px-2 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-60 ${
                        isTentative
                          ? "bg-amber-600 text-white shadow-xs font-black"
                          : "bg-canvas-warm text-amber-800 border border-amber-200/80 hover:bg-amber-50"
                      }`}
                    >
                      <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Maybe</span>
                    </button>

                    <button
                      type="button"
                      disabled={isUpdating}
                      aria-pressed={isOut}
                      aria-label="Mark availability as Not Playing"
                      onClick={() => handleAction(match.id, "No")}
                      className={`min-h-[44px] px-2 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-60 ${
                        isOut
                          ? "bg-rose-600 text-white shadow-xs font-black"
                          : "bg-canvas-warm text-rose-800 border border-rose-200/80 hover:bg-rose-50"
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Out</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl p-6 text-center space-y-2">
          <CalendarDays className="w-8 h-8 text-text-muted mx-auto" />
          <h3 className="text-sm font-bold text-text-primary font-heading">
            No Upcoming Fixtures Scheduled
          </h3>
          <p className="text-xs text-text-secondary max-w-sm mx-auto">
            Stay tuned! New league fixtures and practice matches are published here as soon as grounds are confirmed.
          </p>
        </div>
      )}
    </section>
  );
}
