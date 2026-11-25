/**
 * Player Home Dashboard (`components/HomeTab.tsx`)
 *
 * Provides the mobile-first personalised player dashboard for KAvach Play (Phase 2.1).
 * Features:
 * - Personalised greeting & search entry point
 * - Campaign-led multi-slide hero banner
 * - Authoritative personal payment summary (isolated to logged-in player)
 * - Next 4 upcoming matches (shared match card + availability selector)
 * - Quick Access: Directory, Studio, Shop, Polls & Pulse (D-20)
 * - Horizontally scrollable team birthdays carousel
 * - Club community feed preview
 * Club announcements and club performance moved to the Club tab (D-20).
 */
"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useStore } from "@/hooks/useStore";
import { Post, Player, Match, Ground } from "@/lib/types";
import { resolveMyPlayers } from "@/lib/player-identity";
import { calculatePlayerDues } from "@/lib/player-dues";
import {
  isPlayerEligibleForMatch,
  validateMatchNavigation,
} from "@/lib/match-eligibility";
import {
  MapPin,
  Clock,
  Calendar,
  ChevronRight,
  Circle,
  Search,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  IndependenceDayBanner,
  isIndependenceDayWindow,
} from "./festive/IndependenceDay";
import { useToast } from "@/components/ui/Toast";
import { availabilityBlockMessage, PROFILE_LINK_MESSAGES } from "@/lib/profile-link";

// Modular Phase 2.1 Subcomponents
import { PlayerHomeHeader } from "./home/PlayerHomeHeader";
import { CampaignHeroBanner } from "./home/CampaignHeroBanner";
import { PotwHomeSection } from "./home/PotwHomeSection";
import { PersonalPaymentCard } from "./home/PersonalPaymentCard";
import { UpcomingMatchesSection } from "./home/UpcomingMatchesSection";
import { JerseyInfographic } from "./matches/JerseyInfographic";
import { BirthdaysCarousel } from "./home/BirthdaysCarousel";
import { ClubFeedPreview } from "./home/ClubFeedPreview";
import { HomeQuickActions } from "./home/HomeQuickActions";
import { resolveGreetingName } from "@/lib/greeting";
import { getClubCalendarDate } from "@/lib/utils";
import { usePlayerGlobalSearch, PlayerSearchResultsPanel } from "./search/PlayerGlobalSearch";

export function HomeTab({
  store,
  isAdmin = false,
  currentUserId,
  currentUserName,
  onNavigateToMatch,
  onNavigateToPayments,
  onNavigateToTab,
}: {
  store: ReturnType<typeof useStore>;
  isAdmin?: boolean;
  currentUserId: string;
  currentUserName: string;
  onNavigateToMatch?: (matchId: string) => void;
  onNavigateToPayments?: () => void;
  onNavigateToTab?: (tab: any, action?: string, options?: { fromSearch?: boolean }) => void;
}) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const { posts = [], players = [], matches = [], grounds = [], polls = [], payments = [], appConfig } = store;

  // Club-local calendar day (Asia/Kolkata), so birthdays roll over at club midnight
  // rather than at the device's or UTC midnight.
  const clubToday = useMemo(() => {
    const { year, month, day } = getClubCalendarDate(new Date());
    return new Date(year, month, day);
  }, []);

  // Resolve logged-in player identity
  const appUser = store.appUsers.find((u) => u.id === currentUserId);
  const myPlayers = useMemo(
    () => resolveMyPlayers(players, currentUserId, appUser),
    [players, currentUserId, appUser]
  );
  const mePlayer = myPlayers[0] || null;

  // Announcement publishing/editing and Club Performance management are Admin
  // persona only (D-16/D-18). D-20: members read announcements and club totals
  // in the Club tab; Home links there.

  // Feature gate helper
  const isFeatureEnabled = (key: any) => {
    return appConfig?.features?.[key as keyof typeof appConfig.features] !== false;
  };

  // Authoritative personal dues calculation
  const duesSummary = useMemo(
    () => calculatePlayerDues(myPlayers, payments, matches, store.otherFees),
    [myPlayers, payments, matches, store.otherFees]
  );

  // Upcoming matches (sorted by date/time ascending, filtered by player eligibility)
  const upcomingMatches = useMemo(() => {
    const now = Date.now();
    return matches
      .filter((m) => {
        if (!isPlayerEligibleForMatch(mePlayer, m, payments, isAdmin)) return false;
        if (m.result && m.result !== "Pending") return false;
        let matchDateObj = new Date(m.date);
        if (m.time) {
          const [hours, minutes] = m.time.split(":");
          if (hours && minutes) {
            matchDateObj.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
          }
        } else {
          matchDateObj.setHours(23, 59, 59, 999);
        }
        return matchDateObj.getTime() >= now;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [matches, mePlayer, payments, isAdmin]);

  // Match Day Alerts (Starts within 18 hours, player is confirmed in squad and eligible)
  const activeMatchAlerts = useMemo(() => {
    if (!mePlayer) return [];
    const now = Date.now();

    return matches
      .filter((m) => {
        if (!isPlayerEligibleForMatch(mePlayer, m, payments, isAdmin)) return false;
        const myPay = payments.find((p) => p.playerId === mePlayer.id && p.matchId === m.id);
        const isPlaying =
          myPay &&
          myPay.status !== "Not Playing" &&
          (myPay.availability === "Confirmed" || myPay.availability === "Yes");
        if (!isPlaying) return false;

        let matchDateObj = new Date(m.date);
        if (m.time) {
          const [hours, minutes] = m.time.split(":");
          if (hours && minutes) {
            matchDateObj.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
          }
        } else {
          matchDateObj.setHours(23, 59, 59, 999);
        }

        const msDiff = matchDateObj.getTime() - now;
        const hoursBefore = appConfig?.matchConfiguration?.directionsHoursBefore ?? 18;
        const hoursAfter = appConfig?.matchConfiguration?.directionsHoursAfter ?? 2;
        const msBefore = hoursBefore * 3600000;
        const msAfter = -hoursAfter * 3600000;

        return msDiff <= msBefore && msDiff > msAfter && (!m.result || m.result === "Pending");
      })
      .map((m) => {
        let matchDateObj = new Date(m.date);
        if (m.time) {
          const [hours, minutes] = m.time.split(":");
          matchDateObj.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
        }
        const msDiff = matchDateObj.getTime() - now;
        const isStarted = msDiff < 0;
        let diffStr = "";
        if (!isStarted) {
          const h = Math.floor(msDiff / 3600000);
          const r = msDiff % 3600000;
          const min = Math.floor(r / 60000);
          diffStr = h > 0 ? `${h}h ${min}m` : `${min}m`;
        }
        return { match: m, isStarted, diffStr };
      });
  }, [matches, payments, mePlayer, isAdmin, appConfig]);

  // Centralised Guarded Match Navigation (Authoritative Pre-flight Eligibility Check)
  const handleGuardedNavigateToMatch = useCallback(
    (matchId: string) => {
      const validation = validateMatchNavigation(
        matchId,
        matches,
        mePlayer,
        payments,
        isAdmin
      );
      if (!validation.allowed) {
        if (validation.message) {
          toast(validation.message, "error");
        }
        return;
      }
      onNavigateToMatch?.(matchId);
    },
    [matches, mePlayer, payments, isAdmin, onNavigateToMatch]
  );

  // Generic navigation dispatcher
  const handleNavigate = (tab: string, targetId?: string, options?: { fromSearch?: boolean }) => {
    // Announcements and the club feed live on Home itself (there is no separate tab).
    if (tab === "announcements") {
      // D-20: announcements live in Club → Announcements.
      onNavigateToTab?.("announcements", targetId, options);
      return;
    }
    if (tab === "feed") {
      document.getElementById("club-feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (tab === "finance") {
      onNavigateToPayments?.();
    } else if (tab === "matches") {
      if (!targetId) {
        if (onNavigateToTab) {
          onNavigateToTab("matches");
        } else {
          onNavigateToMatch?.("");
        }
        return;
      }
      // If targetId is a tournament, navigate to tournament fixtures in matches tab without match eligibility check
      const isTournament =
        targetId.startsWith("tournament_") ||
        store.tournaments.some((t) => t.id === targetId);
      if (isTournament) {
        const action = targetId.startsWith("tournament_")
          ? targetId
          : `tournament_${targetId}`;
        if (onNavigateToTab) {
          onNavigateToTab("matches", action);
        } else {
          onNavigateToMatch?.("");
        }
        return;
      }
      // Target ID is an individual match: apply guarded match navigation
      handleGuardedNavigateToMatch(targetId);
    } else if (onNavigateToTab) {
      onNavigateToTab(tab, targetId, options);
    }
  };

  // 1-Tap RSVP Handler with strict eligibility check
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
    const targetMatch = matches.find((m) => m.id === matchId);
    if (!targetMatch || !isPlayerEligibleForMatch(mePlayer, targetMatch, payments, isAdmin)) {
      toast("You are not eligible to participate in this match.", "error");
      return;
    }
    const payment = payments.find((p) => p.playerId === mePlayer.id && p.matchId === matchId);
    try {
      if (payment) {
        await store.updateMatchAvailability(payment.id, availability, matchId);
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
    } catch (e) {
      console.error("Failed to update availability:", e);
      toast("Failed to update availability. Please retry.", "error");
    }
  };

  // Profile completion check for non-admin players
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [profileFormData, setProfileFormData] = useState({
    email: "",
    dob: "",
    chestSize: "",
    jerseyNumber: "",
  });

  useEffect(() => {
    if (mePlayer && !isAdmin) {
      if (!mePlayer.email || !mePlayer.dob || !mePlayer.chestSize || !mePlayer.jerseyNumber) {
        setProfileFormData({
          email: mePlayer.email || appUser?.email || "",
          dob: mePlayer.dob || "",
          chestSize: mePlayer.chestSize || "",
          jerseyNumber: mePlayer.jerseyNumber || "",
        });
        const hasDismissed = localStorage.getItem(`profilePromptDismissed_${mePlayer.id}`);
        if (!hasDismissed) {
          setShowProfilePrompt(true);
        }
      }
    }
  }, [mePlayer, isAdmin, appUser]);

  // Global Player Search (debounced + lazy-loads Posts/Polls/Tournaments on demand)
  const {
    debouncedQuery,
    isLoading: isSearchLoading,
    error: searchError,
    results: filteredResults,
    retry: retrySearch,
  } = usePlayerGlobalSearch({
    store,
    query: searchQuery,
    mePlayer,
    isAdmin,
    isFeatureEnabled,
  });

  return (
    <div
      data-testid="player-home-container"
      className="max-w-5xl mx-auto w-full flex flex-col gap-4"
    >
      {/* 1. Independence Day Greeting Window (Date-gated) */}
      {isIndependenceDayWindow() && (
        <IndependenceDayBanner clubName={appConfig?.clubName} />
      )}

      {/* 2. Header & Search (Section 4.A) */}
      <PlayerHomeHeader
        player={mePlayer}
        currentUserName={resolveGreetingName(appUser?.name, currentUserName)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Search Results Display (if active query) */}
      {searchQuery.trim() ? (
        <PlayerSearchResultsPanel
          query={searchQuery}
          debouncedQuery={debouncedQuery}
          results={filteredResults}
          isLoading={isSearchLoading}
          error={searchError}
          onRetry={retrySearch}
          onClear={() => setSearchQuery("")}
          onNavigateMatch={handleGuardedNavigateToMatch}
          onNavigateTab={(tab, targetId) => handleNavigate(tab, targetId, { fromSearch: true })}
          onNavigateFeed={() => handleNavigate("feed")}
          isFeatureEnabled={isFeatureEnabled}
          mode="inline"
        />
      ) : (
        <>
          {/* Quick-action shortcuts are intentionally not rendered on Home: every
              destination (incl. Shop) is in the primary navigation, and a lone
              "Club Shop" chip read as a stray label at the top of Home. */}

          {/* 4. Match Day High Priority Alert (if confirmed and starts within 18h) */}
          {activeMatchAlerts.length > 0 && (
            <div className="w-full flex flex-col gap-3">
              {activeMatchAlerts.map(({ match, isStarted, diffStr }) => {
                const ground = grounds.find((g) => g.id === match.groundId);
                const groundName = ground?.name || "Ground";
                const mapUrl = ground?.mapUrl || "#";

                return (
                  <div
                    key={match.id}
                    data-testid={`match-day-alert-${match.id}`}
                    onClick={() => handleGuardedNavigateToMatch(match.id)}
                    className="w-full bg-gradient-to-br from-emerald-950 via-emerald-900 to-[#063828] text-white p-5 rounded-2xl border border-emerald-500/30 shadow-sm relative overflow-hidden cursor-pointer"
                  >
                    <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500 text-white">
                            Match Day Alert
                          </span>
                          {match.jerseyColor && (
                            <JerseyInfographic color={match.jerseyColor} size="sm" />
                          )}
                        </div>
                        <h3 className="text-base sm:text-xl font-black font-heading tracking-tight text-white">
                          {isStarted ? "Match is underway!" : `Playing in ${diffStr}`} vs {match.opponent}
                        </h3>
                        <p className="text-xs text-white/80 mt-1 font-medium flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-emerald-300" />
                          <span>{groundName}</span>
                          <span>•</span>
                          <Clock className="w-3.5 h-3.5 text-emerald-300" />
                          <span>{match.time ? format(parseISO(`${match.date}T${match.time}`), "h:mm a") : "Time TBD"}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 self-start sm:self-auto">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGuardedNavigateToMatch(match.id);
                          }}
                          className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition"
                        >
                          <span>View Match</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        {mapUrl && mapUrl !== "#" && (
                          <a
                            href={mapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="min-h-[44px] px-4 py-2 rounded-xl bg-white text-emerald-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-emerald-50 transition shadow-xs"
                          >
                            <MapPin className="w-4 h-4 text-emerald-700" />
                            <span>Directions</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Campaign-Led Hero Banner */}
          <CampaignHeroBanner
            announcements={posts}
            players={players}
            currentUserId={currentUserId}
            appConfig={appConfig}
            isFeatureEnabled={isFeatureEnabled}
            onNavigate={handleNavigate}
          />

          {/* Dedicated Player of the Week Announcement (7-day window, live replacement) */}
          <PotwHomeSection posts={posts} nowMs={nowMs} />

          {/* Personal Payment Summary (Pay Now uses the existing payments flow) */}
          <PersonalPaymentCard
            duesSummary={duesSummary}
            onNavigateToPayments={() => onNavigateToPayments?.()}
          />

          {/* Upcoming Matches (next 4) with availability */}
          <UpcomingMatchesSection
            matches={upcomingMatches}
            grounds={grounds}
            payments={payments}
            player={mePlayer}
            onRsvp={handleRsvp}
            onNavigateToMatch={handleGuardedNavigateToMatch}
            onNavigateToAllMatches={() => handleNavigate("matches")}
          />

          {/* Quick Access (D-20): Directory, Studio, Shop, Polls & Pulse.
              Club announcements and club performance live in the Club tab. */}
          <HomeQuickActions isFeatureEnabled={isFeatureEnabled} onNavigate={(t) => handleNavigate(t)} />

          {/* 10. Team Birthdays Carousel (Section 4.E) */}
          <BirthdaysCarousel players={players} referenceDate={clubToday} />

          {/* 11. Club Community Feed Preview (Section 4.H) */}
          <ClubFeedPreview posts={posts} />
        </>
      )}

      {/* Essential Profile Completion Prompt */}
      {showProfilePrompt && mePlayer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-prompt-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <div className="bg-surface rounded-2xl p-6 w-full max-w-sm border border-border shadow-2xl flex flex-col items-center animate-in fade-in zoom-in-95 duration-150">
            <h2 id="profile-prompt-title" className="text-lg font-black font-heading text-text-primary mb-1">
              Complete Club Profile
            </h2>
            <p className="text-xs text-text-secondary text-center mb-5 font-medium">
              Please provide essential details to help club management coordinate team kit and matchday assignments.
            </p>
            <form
              className="w-full flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                await store.updatePlayer(mePlayer.id, {
                  email: profileFormData.email,
                  dob: profileFormData.dob,
                  chestSize: profileFormData.chestSize,
                  jerseyNumber: profileFormData.jerseyNumber,
                });
                setShowProfilePrompt(false);
              }}
            >
              <div>
                <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted mb-1 block">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={profileFormData.email}
                  onChange={(e) => setProfileFormData({ ...profileFormData, email: e.target.value })}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-scarlet"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted mb-1 block">
                  Date of Birth
                </label>
                <input
                  type="date"
                  required
                  value={profileFormData.dob}
                  onChange={(e) => setProfileFormData({ ...profileFormData, dob: e.target.value })}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-scarlet"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted mb-1 block">
                  Jersey Size
                </label>
                <select
                  required
                  value={profileFormData.chestSize}
                  onChange={(e) => setProfileFormData({ ...profileFormData, chestSize: e.target.value })}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-scarlet [&>option]:bg-surface"
                >
                  <option value="">Select Size</option>
                  {["36", "38", "40", "42", "44", "46", "S", "M", "L", "XL", "XXL"].map((sz) => (
                    <option key={sz} value={sz}>{sz}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold tracking-wider text-text-muted mb-1 block">
                  Jersey Number
                </label>
                {isAdmin ? (
                  <input
                    type="text"
                    required
                    placeholder="e.g. 7 or 18"
                    value={profileFormData.jerseyNumber}
                    onChange={(e) => setProfileFormData({ ...profileFormData, jerseyNumber: e.target.value })}
                    className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-scarlet font-mono"
                  />
                ) : (
                  <input
                    type="text"
                    disabled
                    placeholder="Assigned by Admin"
                    value={profileFormData.jerseyNumber || ""}
                    className="w-full bg-surface-hover border border-border/80 rounded-xl px-3 py-2 text-xs text-text-muted focus:outline-none opacity-60 cursor-not-allowed font-mono"
                    title="Jersey number can only be assigned or edited by administrators."
                  />
                )}
              </div>

              <div className="flex gap-2 justify-end mt-3">
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem(`profilePromptDismissed_${mePlayer.id}`, "true");
                    setShowProfilePrompt(false);
                  }}
                  className="w-full min-h-[44px] py-2 bg-surface text-text-secondary hover:text-text-primary rounded-xl font-bold uppercase tracking-wider text-xs transition border border-border cursor-pointer"
                >
                  Later
                </button>
                <button
                  type="submit"
                  className="w-full min-h-[44px] py-2 bg-scarlet text-white rounded-xl font-bold uppercase tracking-wider text-xs transition hover:bg-deep-wine cursor-pointer shadow-xs"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
