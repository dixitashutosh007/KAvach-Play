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
import { PlayerMatchCard } from "./PlayerMatchCard";
import { MatchesLoadError } from "./MatchesLoadError";
import { PlayerMatchDetailModal } from "./PlayerMatchDetailModal";

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
  const { user, hasAdminClaim } = useAuth();

  // Resolve current logged-in player
  const appUser = store.appUsers.find((u) => u.id === user?.uid);
  const mePlayer = resolvePlayerForUser(store.players, user?.uid, appUser);

  // Authoritative admin determination: the verified `admin` custom claim or the
  // rules-protected appUsers permission flags. The free-form `role` string is
  // deliberately NOT treated as an authority (same model as app/page.tsx and
  // firestore.rules isMatchAdmin()/isClubAdmin()).
  const effectiveIsAdmin = Boolean(
    isAdmin ||
    hasAdminClaim ||
    appUser?.isClubAdmin ||
    appUser?.isMatchAdmin
  );

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
  const [activeTab, setActiveTab] = useState<"all" | "upcoming" | "recent" | "previous">("all");
  const [updatingMatchId, setUpdatingMatchId] = useState<string | null>(null);
  const [optimisticAvailability, setOptimisticAvailability] = useState<
    Record<string, "Playing" | "Maybe" | "Out">
  >({});

  // Selected match for detail view
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  // Unauthorized / Ineligible access alert message state
  const [ineligibleAccessAlert, setIneligibleAccessAlert] = useState<string | null>(null);

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

      {/* Header & Title */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl sm:text-2xl font-black font-heading tracking-tight text-text-primary">
          Match Schedule
        </h1>
        <p className="text-xs sm:text-sm text-text-secondary">
          Track upcoming club fixtures, mark availability, and manage match obligations.
        </p>
      </div>

      <MatchesLoadError message={store.matchesError} />

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
              {filteredUpcoming.map((match, idx) => {
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
                    variant={idx % 2 === 1 ? "alternate" : "default"}
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
              {filteredRecent.map((match, idx) => {
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
                    variant={idx % 2 === 1 ? "alternate" : "default"}
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
                {filteredPrevious.slice(0, previousPageSize).map((match, idx) => {
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
                      variant={idx % 2 === 1 ? "alternate" : "default"}
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
