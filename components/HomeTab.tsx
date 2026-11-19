/**
 * Player Home Dashboard (`components/HomeTab.tsx`)
 *
 * Provides the mobile-first personalised player dashboard for KAvach Play (Phase 2.1).
 * Features:
 * - Personalised greeting & search entry point
 * - Campaign-led multi-slide hero banner
 * - Compact personal performance summary
 * - Authoritative personal payment summary (isolated to logged-in player)
 * - Next 4 upcoming matches with 1-tap inline RSVP
 * - Latest club announcements with full reading modal
 * - Horizontally scrollable team birthdays carousel
 * - Club community feed preview
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
  Shirt,
  Circle,
  Search,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  IndependenceDayBanner,
  isIndependenceDayWindow,
} from "./festive/IndependenceDay";
import { useToast } from "@/components/ui/Toast";

// Modular Phase 2.1 Subcomponents
import { PlayerHomeHeader } from "./home/PlayerHomeHeader";
import { CampaignHeroBanner } from "./home/CampaignHeroBanner";
import { CompactPerformanceSummary } from "./home/CompactPerformanceSummary";
import { PersonalPaymentCard } from "./home/PersonalPaymentCard";
import { UpcomingMatchesSection } from "./home/UpcomingMatchesSection";
import { ClubAnnouncementsSection } from "./home/ClubAnnouncementsSection";
import { BirthdaysCarousel } from "./home/BirthdaysCarousel";
import { ClubFeedPreview } from "./home/ClubFeedPreview";
import { HomeQuickActions } from "./home/HomeQuickActions";

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
  onNavigateToTab?: (tab: any, action?: string) => void;
}) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  const { posts = [], players = [], matches = [], grounds = [], payments = [], playerStats = [], appConfig } = store;

  // Resolve logged-in player identity
  const appUser = store.appUsers.find((u) => u.id === currentUserId);
  const myPlayers = useMemo(
    () => resolveMyPlayers(players, currentUserId, appUser),
    [players, currentUserId, appUser]
  );
  const mePlayer = myPlayers[0] || null;

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
    if (!mePlayer || isAdmin) return [];
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
  const handleNavigate = (tab: string, targetId?: string) => {
    if (tab === "finance") {
      onNavigateToPayments?.();
    } else if (tab === "matches" && targetId) {
      handleGuardedNavigateToMatch(targetId);
    } else if (onNavigateToTab) {
      onNavigateToTab(tab, targetId);
    } else if (tab === "matches") {
      onNavigateToMatch?.("");
    }
  };

  // 1-Tap RSVP Handler with strict eligibility check
  const handleRsvp = async (
    matchId: string,
    availability: "Confirmed" | "Tentative" | "No"
  ) => {
    if (!mePlayer) {
      toast("Please complete or link your player profile to mark availability.", "error");
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
        if (availability === "Confirmed" && payment.status === "Not Playing") {
          await store.updatePaymentStatus(payment.id, "Unpaid", matchId);
        } else if ((availability === "No" || availability === "Tentative") && payment.status === "Unpaid") {
          await store.updatePaymentStatus(payment.id, "Not Playing", matchId);
        }
      } else {
        await store.addPaymentWithAvailability(matchId, mePlayer.id, availability);
      }
      toast(
        `Availability marked as ${
          availability === "Confirmed"
            ? "Playing"
            : availability === "Tentative"
            ? "Maybe"
            : "Not Playing"
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

  // Search Results filtering (Section 4.A) - strictly excludes ineligible matches for players
  const filteredResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;

    const matchedMatches = matches.filter(
      (m) =>
        isPlayerEligibleForMatch(mePlayer, m, payments, isAdmin) &&
        (m.opponent?.toLowerCase().includes(q) ||
          m.date?.toLowerCase().includes(q) ||
          m.format?.toLowerCase().includes(q))
    );
    const matchedAnnouncements = posts.filter(
      (p) => (p as any).title?.toLowerCase().includes(q) || p.text?.toLowerCase().includes(q)
    );
    const matchedPlayers = players.filter(
      (pl) =>
        !pl.disabled &&
        (pl.name?.toLowerCase().includes(q) || pl.kavachId?.toLowerCase().includes(q))
    );

    return {
      matches: matchedMatches,
      announcements: matchedAnnouncements,
      players: matchedPlayers,
    };
  }, [searchQuery, matches, posts, players, mePlayer, payments, isAdmin]);

  return (
    <div
      data-testid="player-home-container"
      className="p-4 sm:p-6 max-w-5xl mx-auto w-full pb-28 flex flex-col gap-5 sm:gap-6"
    >
      {/* 1. Independence Day Greeting Window (Date-gated) */}
      {isIndependenceDayWindow() && (
        <IndependenceDayBanner clubName={appConfig?.clubName} />
      )}

      {/* 2. Header & Search (Section 4.A) */}
      <PlayerHomeHeader
        player={mePlayer}
        currentUserName={currentUserName}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Search Results Display (if active query) */}
      {filteredResults ? (
        <div className="w-full bg-surface border border-border rounded-2xl p-5 shadow-xs flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="text-sm font-bold text-text-primary font-heading uppercase tracking-wider flex items-center gap-2">
              <Search className="w-4 h-4 text-scarlet" />
              <span>Search Results for &ldquo;{searchQuery}&rdquo;</span>
            </h2>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-xs text-scarlet hover:underline font-bold cursor-pointer"
            >
              Clear
            </button>
          </div>

          {/* Matched Matches */}
          {filteredResults.matches.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                Matches ({filteredResults.matches.length})
              </h3>
              <div className="flex flex-col gap-2">
                {filteredResults.matches.map((m) => (
                  <div
                    key={m.id}
                    data-testid={`search-result-match-${m.id}`}
                    onClick={() => {
                      setSearchQuery("");
                      handleGuardedNavigateToMatch(m.id);
                    }}
                    className="p-3 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center justify-between cursor-pointer transition"
                  >
                    <div>
                      <p className="text-xs font-bold text-text-primary">vs {m.opponent}</p>
                      <p className="text-[11px] text-text-secondary">
                        {m.date} • {m.format || "T20"}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-scarlet" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Matched Announcements */}
          {filteredResults.announcements.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                Announcements & Posts ({filteredResults.announcements.length})
              </h3>
              <div className="flex flex-col gap-2">
                {filteredResults.announcements.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => {
                      setSearchQuery("");
                      handleNavigate("feed");
                    }}
                    className="p-3 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center justify-between cursor-pointer transition"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-bold text-text-primary truncate">
                        {(p as any).title || p.text.slice(0, 50)}
                      </p>
                      <p className="text-[11px] text-text-secondary truncate">{p.text}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-scarlet shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Matched Players */}
          {filteredResults.players.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                Teammates ({filteredResults.players.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredResults.players.map((pl) => (
                  <div
                    key={pl.id}
                    onClick={() => {
                      setSearchQuery("");
                      handleNavigate("players");
                    }}
                    className="p-2.5 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center gap-2.5 cursor-pointer transition"
                  >
                    <div className="w-8 h-8 rounded-full bg-deep-wine/10 flex items-center justify-center font-bold text-deep-wine text-xs">
                      {pl.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-text-primary truncate">{pl.name}</p>
                      {pl.kavachId && (
                        <p className="text-[10px] font-mono font-bold text-muted-gold">
                          {pl.kavachId}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredResults.matches.length === 0 &&
            filteredResults.announcements.length === 0 &&
            filteredResults.players.length === 0 && (
              <p className="text-xs text-text-muted py-4 text-center">
                No matches, notices or teammates found matching &ldquo;{searchQuery}&rdquo;.
              </p>
            )}
        </div>
      ) : (
        <>
          {/* 3. Contextual Quick Actions (Section 5) */}
          <HomeQuickActions
            hasDues={duesSummary.hasDues}
            isFeatureEnabled={isFeatureEnabled}
            onNavigate={handleNavigate}
          />

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
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-white">
                              <Shirt className="w-3 h-3" />
                              <span>{match.jerseyColor}</span>
                            </span>
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

          {/* 5. Campaign-Led Hero Banner (Section 4.B) */}
          <CampaignHeroBanner
            tournaments={store.tournaments}
            announcements={posts}
            appConfig={appConfig}
            isFeatureEnabled={isFeatureEnabled}
            onNavigate={handleNavigate}
          />

          {/* 6. Compact Performance Summary (Section 4.C) */}
          <CompactPerformanceSummary
            player={mePlayer}
            matches={matches}
            payments={payments}
            playerStats={playerStats}
            onViewFullProfile={() => handleNavigate("profile")}
          />

          {/* 7. Personal Payment Summary (Section 4.F) */}
          <PersonalPaymentCard
            duesSummary={duesSummary}
            onNavigateToPayments={() => onNavigateToPayments?.()}
          />

          {/* 8. Upcoming Matches (Next 4 Fixtures) (Section 4.G) */}
          <UpcomingMatchesSection
            matches={upcomingMatches}
            grounds={grounds}
            payments={payments}
            player={mePlayer}
            onRsvp={handleRsvp}
            onNavigateToMatch={handleGuardedNavigateToMatch}
            onNavigateToAllMatches={() => handleNavigate("matches")}
          />

          {/* 9. Club Announcements (Section 4.D) */}
          <ClubAnnouncementsSection
            posts={posts}
            onNavigateToFeed={() => handleNavigate("feed")}
          />

          {/* 10. Team Birthdays Carousel (Section 4.E) */}
          <BirthdaysCarousel players={players} />

          {/* 11. Club Community Feed Preview (Section 4.H) */}
          <ClubFeedPreview
            posts={posts}
            onNavigateToFeed={() => handleNavigate("feed")}
          />
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
