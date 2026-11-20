"use client";

/**
 * Player Home — upcoming fixtures (`components/home/UpcomingMatchesSection.tsx`).
 *
 * Renders the next fixtures with the SAME shared PlayerMatchCard used by the
 * Player Match Center (compact header, venue Maps link, availability selector),
 * so Home and the Match tab cannot drift apart visually.
 */
import { useState } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { Match, Ground, MatchPayment, Player } from "@/lib/types";
import { PlayerMatchCard } from "@/components/matches/PlayerMatchCard";
import {
  derivePlayerAvailability,
  getPersonalMatchPaymentStatus,
} from "@/lib/personal-match-payment";

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

  // Prevent duplicate submissions across cards while one update is in flight.
  const handleRsvp = async (matchId: string, status: "Confirmed" | "Tentative" | "No") => {
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
      className="w-full flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-soft-blush flex items-center justify-center">
            <CalendarDays className="w-3.5 h-3.5 text-scarlet" aria-hidden="true" />
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
          <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {displayMatches.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {displayMatches.map((match, idx) => (
            <PlayerMatchCard
              key={match.id}
              match={match}
              ground={grounds.find((g) => g.id === match.groundId)}
              personalPaymentStatus={getPersonalMatchPaymentStatus(player, match, payments)}
              availability={derivePlayerAvailability(player, match, payments).status}
              variant={idx % 2 === 1 ? "alternate" : "default"}
              onSelectMatch={onNavigateToMatch}
              onRsvp={handleRsvp}
              isUpdatingRsvp={updatingMatchId !== null}
            />
          ))}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl p-6 text-center space-y-2">
          <CalendarDays className="w-8 h-8 text-text-muted mx-auto" aria-hidden="true" />
          <h3 className="text-sm font-bold text-text-primary font-heading">
            No Upcoming Fixtures Scheduled
          </h3>
          <p className="text-xs text-text-secondary max-w-sm mx-auto">
            New league fixtures and practice matches appear here as soon as grounds are confirmed.
          </p>
        </div>
      )}
    </section>
  );
}
