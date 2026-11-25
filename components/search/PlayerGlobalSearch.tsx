"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Calendar,
  ChevronRight,
  Loader2,
  MapPin,
  Megaphone,
  MessageSquare,
  Search,
  Trophy,
  User,
  Vote,
  X,
} from "lucide-react";
import type { useStore } from "@/hooks/useStore";
import { searchPlayerAccessibleData, type PlayerSearchResults } from "@/lib/player-search";
import { createSearchReadinessCoordinator, type SearchReadinessSnapshot } from "@/lib/search-readiness";
import { formatPlayingInfo } from "@/lib/club-roster";
import type { Player } from "@/lib/types";

const INITIAL_CATEGORY_LIMIT = 4;
const SEARCH_DEBOUNCE_MS = 200;

export function usePlayerGlobalSearch({
  store,
  query,
  mePlayer,
  isAdmin,
  isFeatureEnabled,
}: {
  store: ReturnType<typeof useStore>;
  query: string;
  mePlayer: Player | null;
  isAdmin: boolean;
  isFeatureEnabled: (key: string) => boolean;
}) {
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [readiness, setReadiness] = useState<SearchReadinessSnapshot>({
    status: "idle",
    readyQuery: "",
    error: null,
  });

  const loadersRef = useRef({
    ensurePosts: store.ensurePosts,
    ensurePolls: store.ensurePolls,
    ensureTournaments: store.ensureTournaments,
  });
  loadersRef.current = {
    ensurePosts: store.ensurePosts,
    ensurePolls: store.ensurePolls,
    ensureTournaments: store.ensureTournaments,
  };

  const coordinatorRef = useRef<ReturnType<typeof createSearchReadinessCoordinator> | null>(null);
  useEffect(() => {
    const coord = createSearchReadinessCoordinator(
      () => loadersRef.current,
      (snap) => setReadiness(snap),
    );
    coordinatorRef.current = coord;
    return () => {
      coord.dispose();
      coordinatorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setIsDebouncing(false);
      setDebouncedQuery("");
      void coordinatorRef.current?.startQuery("");
      return;
    }
    setIsDebouncing(true);
    const timer = setTimeout(() => {
      setIsDebouncing(false);
      setDebouncedQuery(query);
      void coordinatorRef.current?.startQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const isLoading = isDebouncing || readiness.status === "loading";
  const error = readiness.status === "error" ? readiness.error : null;

  const results = useMemo(() => {
    if (isDebouncing || readiness.status !== "ready" || !readiness.readyQuery.trim()) {
      return null;
    }
    return searchPlayerAccessibleData({
      query: readiness.readyQuery,
      matches: store.matches,
      tournaments: store.tournaments,
      posts: store.posts,
      players: store.players,
      grounds: store.grounds,
      polls: store.polls,
      payments: store.payments,
      mePlayer,
      isAdmin,
      isFeatureEnabled,
    });
  }, [
    isDebouncing,
    readiness,
    store.matches,
    store.tournaments,
    store.posts,
    store.players,
    store.grounds,
    store.polls,
    store.payments,
    mePlayer,
    isAdmin,
    isFeatureEnabled,
  ]);

  const retry = () => {
    if (query.trim()) {
      void coordinatorRef.current?.retry();
    }
  };

  return { debouncedQuery, isLoading, error, results, retry };
}

function CategoryBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-[#FCE8ED] text-[#A30F2D] shrink-0">
      {label}
    </span>
  );
}

export function PlayerSearchResultsPanel({
  query,
  debouncedQuery,
  results,
  isLoading,
  error,
  onRetry,
  onClear,
  onNavigateMatch,
  onNavigateTab,
  onNavigateFeed,
  isFeatureEnabled,
  mode = "inline",
}: {
  query: string;
  debouncedQuery: string;
  results: PlayerSearchResults | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onClear: () => void;
  onNavigateMatch: (matchId: string) => void;
  onNavigateTab: (tab: string, targetId?: string) => void;
  onNavigateFeed: () => void;
  isFeatureEnabled: (key: string) => boolean;
  mode?: "inline" | "modal";
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpanded({});
  }, [debouncedQuery]);

  const toggleExpand = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const visibleSlice = <T,>(key: string, items: T[]): { visible: T[]; hiddenCount: number } => {
    if (expanded[key] || items.length <= INITIAL_CATEGORY_LIMIT) {
      return { visible: items, hiddenCount: 0 };
    }
    return {
      visible: items.slice(0, INITIAL_CATEGORY_LIMIT),
      hiddenCount: items.length - INITIAL_CATEGORY_LIMIT,
    };
  };

  if (!query.trim()) {
    if (mode === "inline") return null;
    return (
      <div className="py-10 text-center text-xs sm:text-sm text-text-secondary" data-testid="search-empty-state">
        Type a player name, KAvach ID, match opponent, ground, tournament, announcement, feed post, or poll.
      </div>
    );
  }

  const totalCount = results
    ? results.matches.length +
      results.tournaments.length +
      results.players.length +
      results.grounds.length +
      results.announcements.length +
      results.feedPosts.length +
      results.polls.length
    : 0;

  return (
    <div
      data-testid="player-search-results"
      className="w-full bg-surface border border-border rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col gap-4"
    >
      <div className="flex items-center justify-between border-b border-border pb-3 gap-2">
        <h2 className="text-xs sm:text-sm font-bold text-text-primary font-heading uppercase tracking-wider flex items-center gap-2 min-w-0">
          <Search className="w-4 h-4 text-[#A30F2D] shrink-0" />
          <span className="truncate">Search Results for &ldquo;{query.trim()}&rdquo;</span>
          {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#A30F2D] shrink-0" />}
        </h2>
        <button
          type="button"
          data-testid="search-clear-btn"
          onClick={onClear}
          className="text-xs text-[#A30F2D] hover:underline font-bold cursor-pointer shrink-0 min-h-[36px] px-2"
        >
          Clear
        </button>
      </div>

      {error && (
        <div
          data-testid="search-error-state"
          className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="font-bold underline cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {isLoading && !results && (
        <div className="py-8 flex items-center justify-center gap-2 text-xs text-text-secondary" data-testid="search-loading-state">
          <Loader2 className="w-4 h-4 animate-spin text-[#A30F2D]" />
          <span>Searching club records…</span>
        </div>
      )}

      {results && (
        <>
          {/* 1. Matches */}
          {results.matches.length > 0 && (() => {
            const { visible, hiddenCount } = visibleSlice("matches", results.matches);
            return (
              <section data-testid="search-group-matches">
                <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#A30F2D]" />
                  Matches ({results.matches.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {visible.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      data-testid={`search-result-match-${m.id}`}
                      onClick={() => {
                        if (isFeatureEnabled("matches")) onNavigateMatch(m.id);
                        onClear();
                      }}
                      className="w-full text-left p-3 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center justify-between gap-2 cursor-pointer transition"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-text-primary truncate">vs {m.opponent}</p>
                          <CategoryBadge label="Match" />
                        </div>
                        <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                          {m.date} • {m.format || "T20"} • {m.matchType || "Practice"}
                          {m.result && m.result !== "Pending" ? ` • ${m.result}` : ""}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#A30F2D] shrink-0" />
                    </button>
                  ))}
                </div>
                {(hiddenCount > 0 || expanded.matches) && (
                  <button
                    type="button"
                    onClick={() => toggleExpand("matches")}
                    className="mt-2 text-xs font-bold text-[#A30F2D] hover:underline cursor-pointer"
                  >
                    {expanded.matches ? "Show less" : `Show more (+${hiddenCount})`}
                  </button>
                )}
              </section>
            );
          })()}

          {/* 2. Tournaments */}
          {results.tournaments.length > 0 && (() => {
            const { visible, hiddenCount } = visibleSlice("tournaments", results.tournaments);
            return (
              <section data-testid="search-group-tournaments">
                <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-[#A30F2D]" />
                  Tournaments ({results.tournaments.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {visible.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      data-testid={`search-result-tournament-${t.id}`}
                      onClick={() => {
                        if (isFeatureEnabled("matches")) onNavigateTab("matches", `tournament_${t.id}`);
                        onClear();
                      }}
                      className="w-full text-left p-3 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center justify-between gap-2 cursor-pointer transition"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-text-primary truncate">{t.name}</p>
                          <CategoryBadge label="Tournament" />
                        </div>
                        <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                          {t.status}
                          {t.format ? ` • ${t.format}` : ""}
                          {t.groundName ? ` • ${t.groundName}` : ""}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#A30F2D] shrink-0" />
                    </button>
                  ))}
                </div>
                {(hiddenCount > 0 || expanded.tournaments) && (
                  <button
                    type="button"
                    onClick={() => toggleExpand("tournaments")}
                    className="mt-2 text-xs font-bold text-[#A30F2D] hover:underline cursor-pointer"
                  >
                    {expanded.tournaments ? "Show less" : `Show more (+${hiddenCount})`}
                  </button>
                )}
              </section>
            );
          })()}

          {/* 3. Players */}
          {results.players.length > 0 && (() => {
            const { visible, hiddenCount } = visibleSlice("players", results.players);
            return (
              <section data-testid="search-group-players">
                <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-[#A30F2D]" />
                  Players ({results.players.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {visible.map((pl) => (
                    <button
                      type="button"
                      key={pl.id}
                      data-testid={`search-result-player-${pl.id}`}
                      onClick={() => {
                        onNavigateTab("players", pl.id);
                        onClear();
                      }}
                      className="w-full text-left p-2.5 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center gap-2.5 cursor-pointer transition"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#FCE8ED] flex items-center justify-center font-bold text-[#A30F2D] text-xs shrink-0">
                        {pl.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold text-text-primary truncate">{pl.name}</p>
                          <CategoryBadge label="Player" />
                        </div>
                        <p className="text-[11px] text-text-secondary truncate">
                          {[
                            typeof pl.kavachId === "string" && pl.kavachId ? pl.kavachId : null,
                            formatPlayingInfo(pl as Player),
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                {(hiddenCount > 0 || expanded.players) && (
                  <button
                    type="button"
                    onClick={() => toggleExpand("players")}
                    className="mt-2 text-xs font-bold text-[#A30F2D] hover:underline cursor-pointer"
                  >
                    {expanded.players ? "Show less" : `Show more (+${hiddenCount})`}
                  </button>
                )}
              </section>
            );
          })()}

          {/* 4. Grounds */}
          {results.grounds.length > 0 && (() => {
            const { visible, hiddenCount } = visibleSlice("grounds", results.grounds);
            return (
              <section data-testid="search-group-grounds">
                <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#A30F2D]" />
                  Grounds ({results.grounds.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {visible.map((g) => (
                    <div
                      key={g.id}
                      data-testid={`search-result-ground-${g.id}`}
                      onClick={() => {
                        if (g.mapUrl && g.mapUrl.startsWith("https://")) {
                          window.open(g.mapUrl, "_blank", "noopener,noreferrer");
                        } else {
                          onNavigateTab("matches");
                        }
                        onClear();
                      }}
                      className="p-3 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center justify-between gap-2 cursor-pointer transition"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-text-primary truncate">{g.name}</p>
                          <CategoryBadge label="Ground" />
                        </div>
                        {g.location && (
                          <p className="text-[11px] text-text-secondary truncate mt-0.5">{g.location}</p>
                        )}
                      </div>
                      {g.mapUrl && (
                        <a
                          href={g.mapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] font-bold text-[#A30F2D] hover:underline shrink-0 flex items-center gap-1"
                        >
                          <MapPin className="w-3.5 h-3.5" /> Map
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                {(hiddenCount > 0 || expanded.grounds) && (
                  <button
                    type="button"
                    onClick={() => toggleExpand("grounds")}
                    className="mt-2 text-xs font-bold text-[#A30F2D] hover:underline cursor-pointer"
                  >
                    {expanded.grounds ? "Show less" : `Show more (+${hiddenCount})`}
                  </button>
                )}
              </section>
            );
          })()}

          {/* 5. Announcements */}
          {results.announcements.length > 0 && (() => {
            const { visible, hiddenCount } = visibleSlice("announcements", results.announcements);
            return (
              <section data-testid="search-group-announcements">
                <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Megaphone className="w-3.5 h-3.5 text-[#A30F2D]" />
                  Announcements ({results.announcements.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {visible.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      data-testid={`search-result-announcement-${p.id}`}
                      onClick={() => {
                        if (isFeatureEnabled("announcements")) onNavigateTab("announcements", p.id);
                        onClear();
                      }}
                      className="w-full text-left p-3 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center justify-between gap-2 cursor-pointer transition"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-text-primary truncate">
                            {p.title || p.text.slice(0, 50)}
                          </p>
                          <CategoryBadge label="Announcement" />
                        </div>
                        <p className="text-[11px] text-text-secondary truncate mt-0.5">{p.text}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#A30F2D] shrink-0" />
                    </button>
                  ))}
                </div>
                {(hiddenCount > 0 || expanded.announcements) && (
                  <button
                    type="button"
                    onClick={() => toggleExpand("announcements")}
                    className="mt-2 text-xs font-bold text-[#A30F2D] hover:underline cursor-pointer"
                  >
                    {expanded.announcements ? "Show less" : `Show more (+${hiddenCount})`}
                  </button>
                )}
              </section>
            );
          })()}

          {/* 6. Club Feed */}
          {results.feedPosts.length > 0 && (() => {
            const { visible, hiddenCount } = visibleSlice("feed", results.feedPosts);
            return (
              <section data-testid="search-group-feed">
                <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-[#A30F2D]" />
                  Club Feed ({results.feedPosts.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {visible.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      data-testid={`search-result-feed-${p.id}`}
                      onClick={() => {
                        if (isFeatureEnabled("feed")) onNavigateFeed();
                        onClear();
                      }}
                      className="w-full text-left p-3 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center justify-between gap-2 cursor-pointer transition"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-text-primary truncate">
                            {p.title || p.authorName || "Club Post"}
                          </p>
                          <CategoryBadge label="Feed Post" />
                        </div>
                        <p className="text-[11px] text-text-secondary truncate mt-0.5">{p.text}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#A30F2D] shrink-0" />
                    </button>
                  ))}
                </div>
                {(hiddenCount > 0 || expanded.feed) && (
                  <button
                    type="button"
                    onClick={() => toggleExpand("feed")}
                    className="mt-2 text-xs font-bold text-[#A30F2D] hover:underline cursor-pointer"
                  >
                    {expanded.feed ? "Show less" : `Show more (+${hiddenCount})`}
                  </button>
                )}
              </section>
            );
          })()}

          {/* 7. Polls & Pulse */}
          {results.polls.length > 0 && (() => {
            const { visible, hiddenCount } = visibleSlice("polls", results.polls);
            return (
              <section data-testid="search-group-polls">
                <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Vote className="w-3.5 h-3.5 text-[#A30F2D]" />
                  Polls &amp; Pulse ({results.polls.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {visible.map((poll) => (
                    <button
                      type="button"
                      key={poll.id}
                      data-testid={`search-result-poll-${poll.id}`}
                      onClick={() => {
                        if (isFeatureEnabled("polls")) onNavigateTab("pulse", poll.id);
                        onClear();
                      }}
                      className="w-full text-left p-3 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center justify-between gap-2 cursor-pointer transition"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-text-primary truncate">{poll.title}</p>
                          <CategoryBadge label="Poll" />
                        </div>
                        <p className="text-[11px] text-text-secondary truncate mt-0.5">
                          {poll.isActive ? "Active" : "Recently closed"}
                          {poll.options && poll.options.length > 0
                            ? ` • ${poll.options.slice(0, 3).join(", ")}`
                            : ""}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#A30F2D] shrink-0" />
                    </button>
                  ))}
                </div>
                {(hiddenCount > 0 || expanded.polls) && (
                  <button
                    type="button"
                    onClick={() => toggleExpand("polls")}
                    className="mt-2 text-xs font-bold text-[#A30F2D] hover:underline cursor-pointer"
                  >
                    {expanded.polls ? "Show less" : `Show more (+${hiddenCount})`}
                  </button>
                )}
              </section>
            );
          })()}

          {!isLoading && totalCount === 0 && (
            <p className="text-xs text-text-muted py-4 text-center" data-testid="search-no-results">
              No matches, tournaments, players, grounds, announcements, feed posts or polls found matching &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function PlayerGlobalSearchModal({
  open,
  onClose,
  store,
  mePlayer,
  isAdmin,
  isFeatureEnabled,
  onNavigateMatch,
  onNavigateTab,
  onNavigateFeed,
}: {
  open: boolean;
  onClose: () => void;
  store: ReturnType<typeof useStore>;
  mePlayer: Player | null;
  isAdmin: boolean;
  isFeatureEnabled: (key: string) => boolean;
  onNavigateMatch: (matchId: string) => void;
  onNavigateTab: (tab: string, targetId?: string) => void;
  onNavigateFeed: () => void;
}) {
  const [query, setQuery] = useState("");
  const { debouncedQuery, isLoading, error, results, retry } = usePlayerGlobalSearch({
    store,
    query,
    mePlayer,
    isAdmin,
    isFeatureEnabled,
  });

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="global-search-modal"
      className="fixed inset-0 z-[180] bg-black/60 backdrop-blur-xs flex items-start justify-center p-3 sm:p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#F6F7F9] rounded-2xl border border-border shadow-2xl overflow-hidden mt-10 sm:mt-14"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-surface border-b border-border p-3 sm:p-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players, matches, grounds, tournaments, polls..."
              aria-label="Global player search"
              data-testid="global-search-input"
              className="w-full pl-9 pr-9 py-2.5 bg-[#F6F7F9] border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-[#A30F2D]/30 focus:border-[#A30F2D]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search query"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close global search"
            className="min-w-[44px] min-h-[44px] rounded-xl border border-border bg-surface hover:bg-surface-hover flex items-center justify-center text-text-secondary cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 sm:p-4 max-h-[75vh] overflow-y-auto">
          <PlayerSearchResultsPanel
            query={query}
            debouncedQuery={debouncedQuery}
            results={results}
            isLoading={isLoading}
            error={error}
            onRetry={retry}
            onClear={() => {
              setQuery("");
              onClose();
            }}
            onNavigateMatch={onNavigateMatch}
            onNavigateTab={onNavigateTab}
            onNavigateFeed={onNavigateFeed}
            isFeatureEnabled={isFeatureEnabled}
            mode="modal"
          />
        </div>
      </div>
    </div>
  );
}
