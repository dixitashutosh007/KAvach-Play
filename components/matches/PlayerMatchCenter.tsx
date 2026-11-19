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
import { isPlayerEligibleForMatch } from "@/lib/match-eligibility";
import {
  groupPlayerMatches,
  getPersonalMatchPaymentStatus,
  derivePlayerAvailability,
} from "@/lib/personal-match-payment";
import { PlayerMatchCard } from "./PlayerMatchCard";
import { PlayerMatchDetailModal } from "./PlayerMatchDetailModal";

export interface PlayerMatchCenterProps {
  store: ReturnType<typeof useStore>;
  defaultMatchId?: string | null;
  defaultAction?: string | null;
  onNavigateToPayments?: () => void;
}

export function PlayerMatchCenter({
  store,
  defaultMatchId,
  defaultAction,
  onNavigateToPayments,
}: PlayerMatchCenterProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  // Resolve current logged-in player
  const appUser = store.appUsers.find((u) => u.id === user?.uid);
  const mePlayer = resolvePlayerForUser(store.players, user?.uid, appUser);

  // Compute initial search or initial match ID from defaultAction
  const initialMatchId = useMemo(() => {
    if (defaultMatchId) return defaultMatchId;
    if (defaultAction && defaultAction.startsWith("match_")) {
      return defaultAction.replace("match_", "");
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
  const [activeTab, setActiveTab] = useState<"all" | "upcoming" | "recent" | "previous">("all");
  const [updatingMatchId, setUpdatingMatchId] = useState<string | null>(null);
  const [optimisticAvailability, setOptimisticAvailability] = useState<
    Record<string, "Playing" | "Maybe" | "Out">
  >({});

  // Selected match for detail view
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(initialMatchId);

  // Pagination for previous matches
  const [previousPageSize, setPreviousPageSize] = useState<number>(6);

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
      false,
      { recentCutoffDays: 30 }
    );
  }, [store.matches, store.payments, mePlayer]);

  // Handle browser back button (popstate) & scroll restoration
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.matchDetail) {
        setSelectedMatchId(event.state.matchDetail);
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
  }, []);

  // Open match detail with history state & scroll capture
  const handleOpenMatch = useCallback((matchId: string) => {
    if (typeof window !== "undefined") {
      scrollPositionRef.current =
        window.scrollY || document.documentElement.scrollTop || 0;
      window.history.pushState({ matchDetail: matchId }, "", window.location.href);
    }
    setSelectedMatchId(matchId);
  }, []);

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

  // 1-Tap RSVP handler with strict eligibility validation
  const handleRsvp = async (
    matchId: string,
    availability: "Confirmed" | "Tentative" | "No"
  ) => {
    if (!mePlayer) {
      toast("Please complete or link your player profile to mark availability.", "error");
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
        if (availability === "Confirmed" && existingPayment.status === "Not Playing") {
          await store.updatePaymentStatus(existingPayment.id, "Unpaid", matchId);
        } else if (availability === "No" && existingPayment.status === "Unpaid") {
          await store.updatePaymentStatus(existingPayment.id, "Not Playing", matchId);
        }
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

  const filteredRecent = useMemo(
    () => grouped.recent.filter(matchesSearch),
    [grouped.recent, matchesSearch]
  );

  const filteredPrevious = useMemo(
    () => grouped.previous.filter(matchesSearch),
    [grouped.previous, matchesSearch]
  );

  // Selected match object
  const selectedMatch = useMemo(() => {
    if (!selectedMatchId) return null;
    return store.matches.find((m) => m.id === selectedMatchId) || null;
  }, [selectedMatchId, store.matches]);

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
      className="space-y-5 pb-12 max-w-4xl mx-auto"
    >
      {/* Header & Title */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl sm:text-2xl font-black font-heading tracking-tight text-text-primary">
          Match Schedule
        </h1>
        <p className="text-xs sm:text-sm text-text-secondary">
          Track upcoming club fixtures, mark availability, and manage match obligations.
        </p>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            data-testid="match-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search opponent, ground, tournament..."
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

        {/* Tab Selector Pills */}
        <div className="flex bg-surface p-1 rounded-xl border border-border overflow-x-auto min-h-[44px] shrink-0">
          {(
            [
              { id: "all", label: "All" },
              { id: "upcoming", label: `Upcoming (${grouped.upcoming.length})` },
              { id: "recent", label: `Recent (${grouped.recent.length})` },
              { id: "previous", label: "Previous" },
            ] as const
          ).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`filter-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 min-w-[70px] py-1.5 px-3 rounded-lg text-xs font-bold transition cursor-pointer text-center ${
                  isActive
                    ? "bg-scarlet text-white shadow-xs font-black"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. UPCOMING MATCHES SECTION (Section 3.A)                                 */}
      {/* ========================================================================= */}
      {(activeTab === "all" || activeTab === "upcoming") && (
        <section
          data-testid="upcoming-matches-section"
          className="space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="text-sm sm:text-base font-black font-heading uppercase tracking-wide text-text-primary">
                Upcoming Fixtures ({filteredUpcoming.length})
              </h2>
            </div>
            {filteredUpcoming.length > 0 && (
              <span className="text-[11px] font-semibold text-text-muted">
                Sorted by nearest first
              </span>
            )}
          </div>

          {filteredUpcoming.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredUpcoming.map((match) => {
                const ground = store.grounds.find((g) => g.id === match.groundId);
                const tournamentName = match.tournamentId
                  ? tournamentMap.get(match.tournamentId)
                  : undefined;
                const myPayment = mePlayer
                  ? store.payments.find(
                      (p) => p.matchId === match.id && p.playerId === mePlayer.id
                    )
                  : null;
                const personalPaymentStatus = getPersonalMatchPaymentStatus(
                  mePlayer,
                  match,
                  store.payments
                );
                const availability =
                  optimisticAvailability[match.id] ||
                  derivePlayerAvailability(
                    mePlayer,
                    match,
                    store.payments
                  ).status;
                const isImmediateNext = grouped.nextMatch?.id === match.id;

                return (
                  <PlayerMatchCard
                    key={match.id}
                    match={match}
                    ground={ground}
                    tournamentName={tournamentName}
                    myPayment={myPayment}
                    personalPaymentStatus={personalPaymentStatus}
                    availability={availability}
                    isImmediateNext={isImmediateNext}
                    onSelectMatch={handleOpenMatch}
                    onRsvp={handleRsvp}
                    isUpdatingRsvp={updatingMatchId === match.id}
                  />
                );
              })}
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

      {/* ========================================================================= */}
      {/* 2. RECENT MATCHES SECTION (Section 3.B & 3.C Unsettled Alert)             */}
      {/* ========================================================================= */}
      {(activeTab === "all" || activeTab === "recent") && (
        <section
          data-testid="recent-matches-section"
          className="space-y-3 pt-2"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm sm:text-base font-black font-heading uppercase tracking-wide text-text-primary">
              Recent Matches ({filteredRecent.length})
            </h2>
            {grouped.unsettledOlder.length > 0 && (
              <span className="text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                {grouped.unsettledOlder.length} Unsettled
              </span>
            )}
          </div>

          {filteredRecent.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredRecent.map((match) => {
                const ground = store.grounds.find((g) => g.id === match.groundId);
                const tournamentName = match.tournamentId
                  ? tournamentMap.get(match.tournamentId)
                  : undefined;
                const myPayment = mePlayer
                  ? store.payments.find(
                      (p) => p.matchId === match.id && p.playerId === mePlayer.id
                    )
                  : null;
                const personalPaymentStatus = getPersonalMatchPaymentStatus(
                  mePlayer,
                  match,
                  store.payments
                );
                const availability =
                  optimisticAvailability[match.id] ||
                  derivePlayerAvailability(
                    mePlayer,
                    match,
                    store.payments
                  ).status;
                const isUnsettledAlert = grouped.unsettledOlder.some(
                  (m) => m.id === match.id
                );

                return (
                  <PlayerMatchCard
                    key={match.id}
                    match={match}
                    ground={ground}
                    tournamentName={tournamentName}
                    myPayment={myPayment}
                    personalPaymentStatus={personalPaymentStatus}
                    availability={availability}
                    isUnsettledAlert={isUnsettledAlert}
                    onSelectMatch={handleOpenMatch}
                  />
                );
              })}
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-2xl p-6 text-center text-text-muted text-xs sm:text-sm">
              <History className="w-8 h-8 mx-auto mb-2 text-text-muted/60" />
              <p className="font-semibold">No recent matches</p>
              <p className="text-xs text-text-muted mt-1">
                Completed matches from the last 30 days will appear here.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ========================================================================= */}
      {/* 3. PREVIOUS MATCHES SECTION (Section 3.C Progressive Disclosure)          */}
      {/* ========================================================================= */}
      {(activeTab === "all" || activeTab === "previous") && (
        <section
          data-testid="previous-matches-section"
          className="space-y-3 pt-2"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm sm:text-base font-black font-heading uppercase tracking-wide text-text-primary">
              Previous Matches & History ({filteredPrevious.length})
            </h2>
            <span className="text-[11px] font-semibold text-text-muted">
              Settled club archive
            </span>
          </div>

          {filteredPrevious.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {filteredPrevious.slice(0, previousPageSize).map((match) => {
                  const ground = store.grounds.find((g) => g.id === match.groundId);
                  const tournamentName = match.tournamentId
                    ? tournamentMap.get(match.tournamentId)
                    : undefined;
                  const myPayment = mePlayer
                    ? store.payments.find(
                        (p) => p.matchId === match.id && p.playerId === mePlayer.id
                      )
                    : null;
                  const personalPaymentStatus = getPersonalMatchPaymentStatus(
                    mePlayer,
                    match,
                    store.payments
                  );
                  const availability =
                  optimisticAvailability[match.id] ||
                  derivePlayerAvailability(
                    mePlayer,
                    match,
                    store.payments
                  ).status;

                  return (
                    <PlayerMatchCard
                      key={match.id}
                      match={match}
                      ground={ground}
                      tournamentName={tournamentName}
                      myPayment={myPayment}
                      personalPaymentStatus={personalPaymentStatus}
                      availability={availability}
                      onSelectMatch={handleOpenMatch}
                    />
                  );
                })}
              </div>

              {filteredPrevious.length > previousPageSize && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    data-testid="load-more-previous-matches"
                    onClick={() => setPreviousPageSize((prev) => prev + 6)}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-surface border border-border text-xs font-bold text-text-primary hover:bg-surface-hover hover:border-scarlet/40 transition cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                  >
                    <span>Load More Previous Matches</span>
                    <ChevronDown className="w-4 h-4 text-scarlet" />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="bg-surface border border-border rounded-2xl p-6 text-center text-text-muted text-xs sm:text-sm">
              <History className="w-8 h-8 mx-auto mb-2 text-text-muted/60" />
              <p className="font-semibold">No previous matches in archive</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
