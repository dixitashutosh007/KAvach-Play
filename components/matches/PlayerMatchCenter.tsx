"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Search,
  Calendar,
  History,
  Clock,
  Sparkles,
  ChevronDown,
  AlertCircle,
  Filter,
} from "lucide-react";
import type { Match, MatchPayment, Ground, Player, Tournament } from "@/lib/types";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/components/AuthProvider";
import { resolvePlayerForUser } from "@/lib/player-identity";
import { useToast } from "@/components/ui/Toast";
import { availabilityBlockMessage, PROFILE_LINK_MESSAGES } from "@/lib/profile-link";
import {
  isPlayerEligibleForMatch,
  validateMatchNavigation,
  isSquadAssignedToMatch,
  isPlayerInAssignedSquad,
} from "@/lib/match-eligibility";
import {
  groupPlayerMatches,
  getPersonalMatchPaymentStatus,
  derivePlayerAvailability,
} from "@/lib/personal-match-payment";
import {
  MATCH_FILTER_LABEL,
  PAST_PAGE_SIZE,
  mergePastMatches,
  type MatchListFilter,
} from "@/lib/player-match-filters";
import { MatchFilterSelect } from "./MatchFilterSelect";
import { PlayerMatchCard } from "./PlayerMatchCard";
import { MatchesLoadError } from "./MatchesLoadError";
import { PlayerMatchDetailModal } from "./PlayerMatchDetailModal";
import { MatchDateSelector } from "./AdminMatchDateList";

export interface PlayerMatchCenterProps {
  store: ReturnType<typeof useStore>;
  defaultMatchId?: string | null;
  defaultAction?: string | null;
  onNavigateToPayments?: () => void;
  isAdmin?: boolean;
}

export function PlayerMatchCenter({
  store,
  defaultMatchId,
  defaultAction,
  onNavigateToPayments,
  isAdmin = false,
}: PlayerMatchCenterProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  // Resolve current logged-in player
  const appUser = store.appUsers.find((u) => u.id === user?.uid);
  const mePlayer = resolvePlayerForUser(store.players, user?.uid, appUser);

  // Player persona (D-16): eligibility is evaluated exactly as for a regular
  // player. Admin rights held by the signed-in user are deliberately NOT read
  // here; the parent only passes isAdmin=true for an admin-persona context.
  const effectiveIsAdmin = Boolean(isAdmin);

  // Compute initial search or initial match ID from defaultAction / defaultMatchId / URL
  const initialMatchId = useMemo(() => {
    if (defaultMatchId) return defaultMatchId;
    if (defaultAction && defaultAction.startsWith("match_")) {
      return defaultAction.replace("match_", "");
    }
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlMatchId = params.get("match") || params.get("matchId");
      if (urlMatchId) return urlMatchId;
    }
    return null;
  }, [defaultMatchId, defaultAction]);

  const initialSearch = useMemo(() => {
    if (defaultAction && defaultAction.startsWith("tournament_")) {
      const tournId = defaultAction.replace("tournament_", "");
      const tourn = (store.tournaments || []).find((t) => t.id === tournId);
      return tourn?.name || "";
    }
    return "";
  }, [defaultAction, store.tournaments]);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  // Regular-listing filter: exactly All / Upcoming / Past. Plain component
  // state (defaults to All on each visit); independent of the calendar.
  const [matchFilter, setMatchFilter] = useState<MatchListFilter>("all");
  const [updatingMatchId, setUpdatingMatchId] = useState<string | null>(null);
  const [optimisticAvailability, setOptimisticAvailability] = useState<
    Record<string, "Playing" | "Maybe" | "Out">
  >({});

  // Selected match for detail view
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  // Unauthorized / Ineligible access alert message state
  const [ineligibleAccessAlert, setIneligibleAccessAlert] = useState<string | null>(null);

  // Pagination for previous matches
  const [pastPageSize, setPastPageSize] = useState<number>(PAST_PAGE_SIZE);

  // Scroll restoration ref
  const scrollPositionRef = useRef<number>(0);

  // Map of tournaments by ID for quick lookup
  const tournamentMap = useMemo(() => {
    const map = new Map<string, string>();
    (store.tournaments || []).forEach((t) => {
      map.set(t.id, t.name);
    });
    return map;
  }, [store.tournaments]);

  // Group player matches using authoritative rules
  const grouped = useMemo(() => {
    return groupPlayerMatches(
      store.matches || [],
      mePlayer,
      store.payments || [],
      effectiveIsAdmin,
      { recentCutoffDays: 30 }
    );
  }, [store.matches, store.payments, mePlayer, effectiveIsAdmin]);

  // Validate initialMatchId on mount or when data changes
  useEffect(() => {
    if (!initialMatchId) return;

    // Fail closed if data is still loading
    if (!store.matches || store.matches.length === 0) return;

    const check = validateMatchNavigation(
      initialMatchId,
      store.matches || [],
      mePlayer,
      store.payments || [],
      effectiveIsAdmin
    );


    if (check.allowed) {
      setSelectedMatchId(initialMatchId);
      setIneligibleAccessAlert(null);
    } else {
      setSelectedMatchId(null);
      setIneligibleAccessAlert(
        check.message || "The requested match is unavailable or restricted to assigned squad members."
      );
      // Clean invalid URL parameters so browser history does not loop
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        if (params.has("match") || params.has("matchId")) {
          params.delete("match");
          params.delete("matchId");
          const newSearch = params.toString() ? `?${params.toString()}` : "";
          window.history.replaceState(null, "", `${window.location.pathname}${newSearch}`);
        }
      }
    }
  }, [initialMatchId, store.matches, mePlayer, store.payments, effectiveIsAdmin]);

  // Continuous guard: if selectedMatchId becomes ineligible (e.g. eligibility revoked, match archived, or player unassigned)
  useEffect(() => {
    if (!selectedMatchId) return;

    const check = validateMatchNavigation(
      selectedMatchId,
      store.matches || [],
      mePlayer,
      store.payments || [],
      effectiveIsAdmin
    );

    if (!check.allowed) {
      setSelectedMatchId(null);
      setIneligibleAccessAlert(
        check.message || "Match access restricted: you are not authorized to view this match."
      );
      if (typeof window !== "undefined" && window.history.state?.matchDetail === selectedMatchId) {
        window.history.replaceState({ matchDetail: null }, "", window.location.pathname);
      }
    }
  }, [selectedMatchId, store.matches, mePlayer, store.payments, effectiveIsAdmin]);

  // Handle browser back button (popstate) & scroll restoration with authoritative validation
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.matchDetail) {
        const targetId = event.state.matchDetail;
        const check = validateMatchNavigation(
          targetId,
          store.matches || [],
          mePlayer,
          store.payments || [],
          effectiveIsAdmin
        );

        if (check.allowed) {
          setSelectedMatchId(targetId);
          setIneligibleAccessAlert(null);
        } else {
          setSelectedMatchId(null);
          setIneligibleAccessAlert(
            check.message || "The requested match is unavailable or restricted to assigned squad members."
          );
          if (typeof window !== "undefined") {
            window.history.replaceState({ matchDetail: null }, "", window.location.pathname);
          }
        }
      } else {
        setSelectedMatchId(null);
        // Restore previous scroll position
        if (scrollPositionRef.current > 0) {
          const targetY = scrollPositionRef.current;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.scrollTo({ top: targetY, behavior: "auto" });
            });
          });
          scrollPositionRef.current = 0;
        }
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [store.matches, mePlayer, store.payments, effectiveIsAdmin]);

  // Open match detail with guarded validation, history state & scroll capture
  const handleOpenMatch = useCallback((matchId: string) => {
    const check = validateMatchNavigation(
      matchId,
      store.matches || [],
      mePlayer,
      store.payments || [],
      effectiveIsAdmin
    );

    if (!check.allowed) {
      toast(check.message || "You are not eligible to view this match.", "error");
      setIneligibleAccessAlert(
        check.message || "You are not eligible to view this match."
      );
      return;
    }

    setIneligibleAccessAlert(null);
    if (typeof window !== "undefined") {
      scrollPositionRef.current =
        window.scrollY || document.documentElement.scrollTop || 0;
      window.history.pushState({ matchDetail: matchId }, "", window.location.href);
    }
    setSelectedMatchId(matchId);
  }, [store.matches, mePlayer, store.payments, effectiveIsAdmin, toast]);

  // Close match detail
  const handleCloseMatch = useCallback(() => {
    if (typeof window !== "undefined" && window.history.state?.matchDetail) {
      window.history.back();
    } else {
      setSelectedMatchId(null);
      if (scrollPositionRef.current > 0) {
        const targetY = scrollPositionRef.current;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.scrollTo({ top: targetY, behavior: "auto" });
          });
        });
        scrollPositionRef.current = 0;
      }
    }
  }, []);

  // Availability handler with strict eligibility validation
  const handleRsvp = async (
    matchId: string,
    availability: "Confirmed" | "Tentative" | "No"
  ) => {
    const blocked = availabilityBlockMessage({
      playersLoaded: store.playersLoaded !== false,
      hasPlayer: Boolean(mePlayer),
    });
    if (blocked || !mePlayer) {
      toast(blocked || PROFILE_LINK_MESSAGES.unlinked, "error");
      return;
    }

    const targetMatch = store.matches.find((m) => m.id === matchId);
    if (!targetMatch || !isPlayerEligibleForMatch(mePlayer, targetMatch, store.payments, false)) {
      toast("You are not eligible to participate in this match.", "error");
      return;
    }

    setUpdatingMatchId(matchId);
    const targetStatus =
      availability === "Confirmed"
        ? "Playing"
        : availability === "Tentative"
        ? "Maybe"
        : "Out";
    setOptimisticAvailability((prev) => ({ ...prev, [matchId]: targetStatus }));

    const existingPayment = store.payments.find(
      (p) => p.playerId === mePlayer.id && p.matchId === matchId
    );

    try {
      if (existingPayment) {
        await store.updateMatchAvailability(existingPayment.id, availability, matchId);
      } else {
        await store.addPaymentWithAvailability(matchId, mePlayer.id, availability);
      }

      toast(
        `Availability updated: ${
          availability === "Confirmed"
            ? "Playing"
            : availability === "Tentative"
            ? "Maybe"
            : "Out"
        }`,
        "success"
      );
    } catch (err) {
      console.error("Failed to update availability:", err);
      setOptimisticAvailability((prev) => {
        const copy = { ...prev };
        delete copy[matchId];
        return copy;
      });
      toast("Failed to update availability. Please retry.", "error");
    } finally {
      setUpdatingMatchId(null);
    }
  };

  // Helper to filter matches by search query (opponent, ground, tournament)
  const matchesSearch = useCallback(
    (match: Match) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const opponentMatches = match.opponent?.toLowerCase().includes(q);
      const ground = store.grounds.find((g) => g.id === match.groundId);
      const groundMatches = ground?.name?.toLowerCase().includes(q);
      const tournamentName = match.tournamentId ? tournamentMap.get(match.tournamentId) : "";
      const tournamentMatches = tournamentName?.toLowerCase().includes(q);
      const formatMatches = match.format?.toLowerCase().includes(q);
      return Boolean(opponentMatches || groundMatches || tournamentMatches || formatMatches);
    },
    [searchQuery, store.grounds, tournamentMap]
  );

  // Filtered collections
  const filteredUpcoming = useMemo(
    () => grouped.upcoming.filter(matchesSearch),
    [grouped.upcoming, matchesSearch]
  );

  // Past = every accessible completed/past match (the old Recent + Previous
  // groups), de-duplicated by id and sorted newest first.
  const filteredPast = useMemo(
    () => mergePastMatches(grouped.recent, grouped.previous).filter(matchesSearch),
    [grouped.recent, grouped.previous, matchesSearch]
  );

  // Selected match object with authoritative pre-flight validation (Fail Closed)
  const selectedMatch = useMemo(() => {
    if (!selectedMatchId) return null;
    const check = validateMatchNavigation(
      selectedMatchId,
      store.matches || [],
      mePlayer,
      store.payments || [],
      effectiveIsAdmin
    );
    if (!check.allowed) return null; // Fail closed: Never expose match details
    return (store.matches || []).find((m) => m.id === selectedMatchId) || null;
  }, [selectedMatchId, store.matches, mePlayer, store.payments, effectiveIsAdmin]);

  // Selected match personal payment info
  const selectedMatchPayment = useMemo(() => {
    if (!selectedMatch || !mePlayer) return null;
    return (
      store.payments.find(
        (p) => p.matchId === selectedMatch.id && p.playerId === mePlayer.id
      ) || null
    );
  }, [selectedMatch, mePlayer, store.payments]);

  const selectedPersonalPaymentStatus = useMemo(() => {
    if (!selectedMatch) {
      return {
        status: "NOT_APPLICABLE" as const,
        label: null,
        amountDue: 0,
        netPayable: 0,
        amountPaid: 0,
        paidAmount: 0,
        totalFee: 0,
        isWaived: false,
        feeOverride: undefined,
        paymentRecord: null,
      };
    }
    return getPersonalMatchPaymentStatus(mePlayer, selectedMatch, store.payments);
  }, [selectedMatch, mePlayer, store.payments]);

  const selectedAvailability = useMemo(() => {
    if (!selectedMatch) return "Pending" as const;
    if (optimisticAvailability[selectedMatch.id]) {
      return optimisticAvailability[selectedMatch.id];
    }
    return derivePlayerAvailability(mePlayer, selectedMatch, store.payments).status;
  }, [mePlayer, selectedMatch, store.payments, optimisticAvailability]);

  // Shared player card renderer for every list and the calendar's date panel.
  // Player-facing: no payment status, unpaid amounts or admin controls.
  const upcomingIds = useMemo(() => new Set(grouped.upcoming.map((m) => m.id)), [grouped.upcoming]);
  const renderPlayerCard = (
    match: Match,
    idx: number,
    opts: { canRsvp?: boolean; isImmediateNext?: boolean } = {},
  ) => (
    <PlayerMatchCard
      key={match.id}
      match={match}
      ground={store.grounds.find((g) => g.id === match.groundId)}
      tournamentName={match.tournamentId ? tournamentMap.get(match.tournamentId) : undefined}
      availability={
        optimisticAvailability[match.id] ||
        derivePlayerAvailability(mePlayer, match, store.payments).status
      }
      isImmediateNext={opts.isImmediateNext}
      variant={idx % 2 === 1 ? "alternate" : "default"}
      onSelectMatch={handleOpenMatch}
      {...(opts.canRsvp
        ? { onRsvp: handleRsvp, isUpdatingRsvp: updatingMatchId === match.id }
        : {})}
    />
  );

  // If a match is selected, render the cohesive player match detail view
  if (selectedMatch) {
    return (
      <PlayerMatchDetailModal
        match={selectedMatch}
        ground={store.grounds.find((g) => g.id === selectedMatch.groundId)}
        tournamentName={
          selectedMatch.tournamentId
            ? tournamentMap.get(selectedMatch.tournamentId)
            : undefined
        }
        allPlayers={store.players || []}
        matchPayments={(store.payments || []).filter(
          (p) => p.matchId === selectedMatch.id
        )}
        mePlayer={mePlayer}
        personalPaymentStatus={selectedPersonalPaymentStatus}
        availability={selectedAvailability}
        onClose={handleCloseMatch}
        onRsvp={handleRsvp}
        isUpdatingRsvp={updatingMatchId === selectedMatch.id}
        onNavigateToPayments={onNavigateToPayments}
      />
    );
  }

  return (
    <div
      data-testid="player-match-center"
      className="space-y-4 max-w-4xl mx-auto"
    >
      {/* Ineligible / Unauthorized Access Alert Banner */}
      {ineligibleAccessAlert && (
        <div
          data-testid="ineligible-match-alert"
          className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3 shadow-xs animate-in fade-in duration-200"
        >
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <div className="font-bold text-sm text-rose-900">Match Access Restricted</div>
            <p className="mt-0.5 text-rose-800 leading-relaxed">{ineligibleAccessAlert}</p>
            <button
              type="button"
              onClick={() => setIneligibleAccessAlert(null)}
              className="mt-2 text-[11px] font-bold text-rose-700 underline hover:text-rose-900 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Header & match filter */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-1">
          <h1 className="text-xl sm:text-2xl font-black font-heading tracking-tight text-text-primary">
            Match Schedule
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary">
            Track club fixtures and mark your availability.
          </p>
        </div>
        <MatchFilterSelect value={matchFilter} onChange={setMatchFilter} />
      </div>

      <MatchesLoadError message={store.matchesError} />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          data-testid="match-search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search opponent, ground, tournament..."
          aria-label="Search matches by opponent or venue"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface border border-border text-xs sm:text-sm placeholder:text-text-muted focus:outline-hidden focus:ring-1 focus:ring-scarlet min-h-[44px]"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-text-muted hover:text-text-primary p-1"
          >
            Clear
          </button>
        )}
      </div>

      {/* Monthly date selector + selected-date panel (a contextual preview of
          one date). Fed only with the matches this player may see. It never
          changes the regular listing below, and the filter never clears it. */}
      <MatchDateSelector
        variant="player"
        storageKeyPrefix="playerMatches"
        matches={grouped.allEligible}
        loaded={store.isLoaded !== false}
        renderMatchCard={(match, idx) => renderPlayerCard(match, idx, { canRsvp: upcomingIds.has(match.id) })}
      />

      {/* Divider between the date preview and the regular listing */}
      <div className="flex items-center gap-3 pt-1" role="separator" aria-hidden="true" data-testid="listing-divider">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">Match list</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Regular listing (driven only by the filter and search) */}
      <section aria-labelledby="regular-listing-heading" data-testid="regular-match-listing" data-filter={matchFilter} className="space-y-4">
        <h2 id="regular-listing-heading" className="text-base sm:text-lg font-black font-heading tracking-tight text-text-primary">
          {MATCH_FILTER_LABEL[matchFilter]}
        </h2>

        {(matchFilter === "all" || matchFilter === "upcoming") && (
          <section data-testid="upcoming-matches-section" className="space-y-3">
            {matchFilter === "all" && (
              <h3 className="flex items-center gap-2 text-xs sm:text-sm font-black font-heading uppercase tracking-wide text-text-primary">
                <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                Upcoming ({filteredUpcoming.length})
              </h3>
            )}
            {filteredUpcoming.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {filteredUpcoming.map((match, idx) =>
                  renderPlayerCard(match, idx, { canRsvp: true, isImmediateNext: grouped.nextMatch?.id === match.id })
                )}
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-2xl p-6 text-center text-text-muted text-xs sm:text-sm">
                <Calendar className="w-8 h-8 mx-auto mb-2 text-text-muted/60" />
                <p className="font-semibold">No upcoming fixtures scheduled</p>
                <p className="text-xs text-text-muted mt-1">
                  New matches will appear here when scheduled by the club administrators.
                </p>
              </div>
            )}
          </section>
        )}

        {(matchFilter === "all" || matchFilter === "past") && (
          <section data-testid="past-matches-section" className={`space-y-3 ${matchFilter === "all" ? "pt-2" : ""}`}>
            {matchFilter === "all" && (
              <h3 className="flex items-center gap-2 text-xs sm:text-sm font-black font-heading uppercase tracking-wide text-text-primary">
                <History className="w-4 h-4 text-text-muted" aria-hidden="true" />
                Past ({filteredPast.length})
              </h3>
            )}
            {filteredPast.length > 0 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredPast.slice(0, pastPageSize).map((match, idx) => renderPlayerCard(match, idx))}
                </div>
                {filteredPast.length > pastPageSize && (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      data-testid="load-more-past-matches"
                      onClick={() => setPastPageSize((prev) => prev + PAST_PAGE_SIZE)}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-surface border border-border text-xs font-bold text-text-primary hover:bg-surface-hover hover:border-scarlet/40 transition cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                    >
                      <span>Show more past matches ({filteredPast.length - pastPageSize})</span>
                      <ChevronDown className="w-4 h-4 text-scarlet" />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-surface border border-border rounded-2xl p-6 text-center text-text-muted text-xs sm:text-sm">
                <History className="w-8 h-8 mx-auto mb-2 text-text-muted/60" />
                <p className="font-semibold">No past matches</p>
              </div>
            )}
          </section>
        )}
      </section>
    </div>
  );
}

