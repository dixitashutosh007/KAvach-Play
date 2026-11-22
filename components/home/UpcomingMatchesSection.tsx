"use client";

/**
 * Player Home — upcoming fixtures (`components/home/UpcomingMatchesSection.tsx`).
 *
 * Renders the next fixtures with the SAME shared PlayerMatchCard used by the
 * Player Match Center, so Home and the Match tab cannot drift apart visually.
 *
 * Layout (same data, same cards — no duplicate rendering):
 *  - below `md`: horizontal swipe carousel with snap points; each card is 86%
 *    wide so the next one peeks in; a compact "Swipe to explore" + dots hint
 *    appears only when there is more than one match;
 *  - `md` and up: the existing two-column grid, no carousel or hint.
 */
import { useCallback, useRef, useState } from "react";
import { CalendarDays, ChevronRight, ArrowRight } from "lucide-react";
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
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  // Take up to next 4 matches
  const displayMatches = matches.slice(0, 4);

  const isCarousel = displayMatches.length > 1;

  // Track which card is in view (mobile carousel only) for the position dots.
  const onTrackScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const first = track.firstElementChild as HTMLElement | null;
    if (!first) return;
    const step = first.offsetWidth + parseFloat(getComputedStyle(track).columnGap || "0");
    if (step <= 0) return;
    setActiveIndex(Math.min(displayMatches.length - 1, Math.max(0, Math.round(track.scrollLeft / step))));
  }, [displayMatches.length]);

  const scrollToCard = (index: number) => {
    const card = trackRef.current?.children[index] as HTMLElement | undefined;
    if (!card) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // inline: start respects the scroll padding; block: nearest never moves the page vertically.
    card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "start", block: "nearest" });
  };

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
        <div>
          <div
            ref={trackRef}
            onScroll={isCarousel ? onTrackScroll : undefined}
            data-testid="upcoming-matches-track"
            data-layout={isCarousel ? "carousel" : "single"}
            aria-roledescription={isCarousel ? "carousel" : undefined}
            aria-label={isCarousel ? "Upcoming matches" : undefined}
            className={
              isCarousel
                ? // Mobile: edge-to-edge horizontal snap carousel. md+: original grid.
                  "flex gap-3 overflow-x-auto snap-x snap-mandatory overscroll-x-contain no-scrollbar -mx-4 px-4 scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 pb-1 md:grid md:grid-cols-2 md:overflow-visible md:snap-none md:mx-0 md:px-0 md:pb-0"
                : "grid grid-cols-1 md:grid-cols-2 gap-3"
            }
          >
            {displayMatches.map((match, idx) => (
              <div
                key={match.id}
                data-testid={`upcoming-match-slide-${match.id}`}
                aria-roledescription={isCarousel ? "slide" : undefined}
                aria-label={isCarousel ? `${idx + 1} of ${displayMatches.length}` : undefined}
                // Fixed slide width; the flex track stretches every slide to the
                // tallest card so all carousel cards share one height.
                className={isCarousel ? "shrink-0 w-[86%] sm:w-[70%] snap-start md:w-auto min-w-0" : undefined}
              >
                <PlayerMatchCard
                  match={match}
                  ground={grounds.find((g) => g.id === match.groundId)}
                  personalPaymentStatus={getPersonalMatchPaymentStatus(player, match, payments)}
                  availability={derivePlayerAvailability(player, match, payments).status}
                  variant={idx % 2 === 1 ? "alternate" : "default"}
                  layout="home"
                  onSelectMatch={onNavigateToMatch}
                  onRsvp={handleRsvp}
                  isUpdatingRsvp={updatingMatchId !== null}
                />
              </div>
            ))}
          </div>

          {/* Mobile-only swipe hint: one compact row, only when there is more to see */}
          {isCarousel && (
            <div className="md:hidden mt-1.5 flex items-center justify-between gap-2" data-testid="upcoming-swipe-hint">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-muted">
                Swipe to explore
                <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </span>
              <div className="flex items-center gap-0.5" role="group" aria-label="Choose match">
                {displayMatches.map((m, idx) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => scrollToCard(idx)}
                    aria-label={`Show match ${idx + 1} of ${displayMatches.length}`}
                    aria-current={idx === activeIndex ? "true" : undefined}
                    className="p-1 cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
                  >
                    <span
                      className={`block h-1.5 rounded-full transition-all motion-reduce:transition-none ${
                        idx === activeIndex ? "w-4 bg-scarlet" : "w-1.5 bg-text-muted/40"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
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
