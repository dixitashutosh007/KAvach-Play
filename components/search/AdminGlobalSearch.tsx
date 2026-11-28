"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  Calendar,
  ChevronRight,
  Loader2,
  MapPin,
  Megaphone,
  MessageSquare,
  Search,
  ShoppingBag,
  Sparkles,
  Trophy,
  Users,
  Video,
  Vote,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import type {
  AdminSearchCategory,
  AdminSearchResponse,
} from "@/lib/admin-search";
import { resolveAdminCommands, type AdminSearchCommandItem } from "@/lib/admin-commands";
import type { AdminDestination } from "@/lib/admin-navigation";

const SEARCH_DEBOUNCE_MS = 150;
const INITIAL_CATEGORY_LIMIT = 4;
const CLIENT_CACHE_TTL_MS = 30_000;

export interface SavedAdminSearchState {
  query: string;
  results: AdminSearchResponse | null;
  expanded: Record<string, boolean>;
  scrollTop: number;
}

const CATEGORY_ICONS: Record<AdminSearchCategory, typeof Search> = {
  players: Users,
  matches: Calendar,
  grounds: MapPin,
  finance: Wallet,
  announcements: Megaphone,
  feedPosts: MessageSquare,
  pulse: Vote,
  badges: Award,
  catches: Sparkles,
  noShows: AlertTriangle,
  tournaments: Trophy,
  studio: Video,
  shop: ShoppingBag,
};

export function useAdminGlobalSearch({
  query,
  enabled,
  initialResults = null,
}: {
  query: string;
  enabled: boolean;
  initialResults?: AdminSearchResponse | null;
}) {
  const [debouncedQuery, setDebouncedQuery] = useState(
    initialResults && initialResults.query === query.trim() ? query.trim() : "",
  );
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AdminSearchResponse | null>(initialResults);
  const [retryCounter, setRetryCounter] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const queryCacheRef = useRef<Map<string, { data: AdminSearchResponse; expiresAt: number }>>(new Map());

  useEffect(() => {
    if (initialResults) {
      setResults(initialResults);
      if (initialResults.query) {
        queryCacheRef.current.set(initialResults.query.toLowerCase(), {
          data: initialResults,
          expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
        });
      }
    }
  }, [initialResults]);

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current += 1;
      setIsDebouncing(false);
      setDebouncedQuery("");
      setIsFetching(false);
      setError(null);
      abortRef.current?.abort();
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      requestIdRef.current += 1;
      setIsDebouncing(false);
      setDebouncedQuery("");
      setIsFetching(false);
      setError(null);
      setResults(null);
      abortRef.current?.abort();
      return;
    }

    const cached = queryCacheRef.current.get(trimmed.toLowerCase());
    if (cached && cached.expiresAt > Date.now() && retryCounter === 0) {
      setIsDebouncing(false);
      setIsFetching(false);
      setError(null);
      setResults(cached.data);
      setDebouncedQuery(trimmed);
      return;
    }

    setIsDebouncing(true);
    const timer = setTimeout(() => {
      setIsDebouncing(false);
      setDebouncedQuery(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, enabled, retryCounter]);

  useEffect(() => {
    if (!enabled || debouncedQuery.length < 2) return;

    const cached = queryCacheRef.current.get(debouncedQuery.toLowerCase());
    if (cached && cached.expiresAt > Date.now() && retryCounter === 0) {
      setResults(cached.data);
      setIsFetching(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const reqId = ++requestIdRef.current;

    setIsFetching(true);
    setError(null);

    const isSyntheticTest =
      process.env.NODE_ENV !== "production" &&
      typeof window !== "undefined" &&
      (window as unknown as { __KAVACH_TEST_USER__?: unknown }).__KAVACH_TEST_USER__ !== undefined;
    const fetchFn = isSyntheticTest ? fetch : authedFetch;

    fetchFn(`/api/admin/search?q=${encodeURIComponent(debouncedQuery)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Search request failed.");
        }
        if (!controller.signal.aborted && requestIdRef.current === reqId) {
          const typed = data as AdminSearchResponse;
          queryCacheRef.current.set(debouncedQuery.toLowerCase(), {
            data: typed,
            expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
          });
          setResults(typed);
          setIsFetching(false);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || requestIdRef.current !== reqId) return;
        setError(err instanceof Error ? err.message : "Unable to search right now.");
        setIsFetching(false);
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, enabled, retryCounter]);

  const retry = useCallback(() => {
    if (query.trim().length >= 2) {
      queryCacheRef.current.delete(query.trim().toLowerCase());
      setRetryCounter((n) => n + 1);
    }
  }, [query]);

  return {
    debouncedQuery,
    isLoading: isDebouncing || isFetching,
    error,
    results,
    retry,
  };
}

interface SelectableEntry {
  key: string;
  destination: { tab: AdminDestination; action?: string };
}

export function AdminGlobalSearchModal({
  open,
  onClose,
  isSuperAdmin,
  isClubAdmin,
  isFinanceAdmin,
  onNavigate,
  preservedState,
  onSaveState,
}: {
  open: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
  isClubAdmin: boolean;
  isFinanceAdmin: boolean;
  onNavigate: (tab: AdminDestination, action?: string) => void;
  preservedState?: SavedAdminSearchState | null;
  onSaveState?: (state: SavedAdminSearchState) => void;
}) {
  const [query, setQuery] = useState(preservedState?.query || "");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(preservedState?.expanded || {});
  const [activeIndex, setActiveIndex] = useState(-1);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const roles = useMemo(
    () => ({ isSuperAdmin, isClubAdmin, isFinanceAdmin }),
    [isSuperAdmin, isClubAdmin, isFinanceAdmin],
  );

  const { debouncedQuery, isLoading, error, results, retry } = useAdminGlobalSearch({
    query,
    enabled: open,
    initialResults: preservedState?.results || null,
  });

  // Restore preserved state when re-opening via Back to Search
  useEffect(() => {
    if (open && preservedState) {
      setQuery(preservedState.query);
      setExpanded(preservedState.expanded || {});
      requestAnimationFrame(() => {
        if (scrollContainerRef.current && preservedState.scrollTop > 0) {
          scrollContainerRef.current.scrollTop = preservedState.scrollTop;
        }
      });
    } else if (!open) {
      setActiveIndex(-1);
    }
  }, [open, preservedState]);

  useEffect(() => {
    if (!preservedState || debouncedQuery !== preservedState.query) {
      setExpanded({});
    }
    setActiveIndex(-1);
  }, [debouncedQuery, preservedState]);

  // Instant local command & date resolution (authoritatively filtered server-side too)
  const localCmds = useMemo(() => resolveAdminCommands(query, roles), [query, roles]);
  const isCurrentServerResult = Boolean(results && results.query === query.trim());
  const commands: AdminSearchCommandItem[] =
    isCurrentServerResult && results?.commands ? results.commands : localCmds.commands;
  const dateResults: AdminSearchCommandItem[] =
    isCurrentServerResult && results?.dateResults ? results.dateResults : localCmds.dateResults;

  // Build flat keyboard-selectable list matching render order
  const selectableItems = useMemo<SelectableEntry[]>(() => {
    const list: SelectableEntry[] = [];
    for (const c of commands) list.push({ key: `cmd:${c.id}`, destination: c.destination });
    for (const d of dateResults) list.push({ key: `date:${d.id}`, destination: d.destination });
    if (results?.groups) {
      for (const group of results.groups) {
        const isExpanded = Boolean(expanded[group.category]);
        const visible =
          isExpanded || group.items.length <= INITIAL_CATEGORY_LIMIT
            ? group.items
            : group.items.slice(0, INITIAL_CATEGORY_LIMIT);
        for (const item of visible) {
          list.push({ key: `rec:${group.category}:${item.id}`, destination: item.destination });
        }
      }
    }
    return list;
  }, [commands, dateResults, results, expanded]);

  const handleSelectDestination = useCallback(
    (destination: { tab: AdminDestination; action?: string }) => {
      onSaveState?.({
        query,
        results,
        expanded,
        scrollTop: scrollContainerRef.current?.scrollTop || 0,
      });
      onNavigate(destination.tab, destination.action);
      onClose();
    },
    [onSaveState, query, results, expanded, onNavigate, onClose],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        if (selectableItems.length === 0) return;
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % selectableItems.length);
      } else if (e.key === "ArrowUp") {
        if (selectableItems.length === 0) return;
        e.preventDefault();
        setActiveIndex((prev) => (prev <= 0 ? selectableItems.length - 1 : prev - 1));
      } else if (e.key === "Enter" && selectableItems.length > 0) {
        const target = selectableItems[activeIndex >= 0 ? activeIndex : 0];
        if (target) {
          e.preventDefault();
          handleSelectDestination(target.destination);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, selectableItems, activeIndex, handleSelectDestination]);

  if (!open) return null;

  const canSeeFinance = isSuperAdmin || isFinanceAdmin;
  const canSeeClub = isSuperAdmin || isClubAdmin;

  const emptyHint = canSeeClub && canSeeFinance
    ? "Search players, matches, dues, commands (Add Match, Unpaid, Dues, Add No Show, Announcement, Badge) or dates (29 Dec)…"
    : canSeeClub
      ? "Search players, matches, announcements, badges, commands (Add Match, Announcement, Badge) or dates (29 Dec)…"
      : "Search dues, payments, matches, commands (Unpaid Players, View Dues, Add No Show) or dates (29 Dec)…";

  const hasAnyResults =
    commands.length > 0 ||
    dateResults.length > 0 ||
    Boolean(results && results.groups.length > 0);

  return (
    <div
      data-testid="admin-global-search-modal"
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
              placeholder="Admin search or command… (⌘K)"
              aria-label="Global admin search"
              data-testid="admin-global-search-input"
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
            aria-label="Close admin search"
            className="min-w-[44px] min-h-[44px] rounded-xl border border-border bg-surface hover:bg-surface-hover flex items-center justify-center text-text-secondary cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div ref={scrollContainerRef} className="p-3 sm:p-4 max-h-[75vh] overflow-y-auto">
          {query.trim().length < 2 ? (
            <div
              className="py-10 px-4 text-center text-xs sm:text-sm text-text-secondary"
              data-testid="admin-search-empty-state"
            >
              {query.trim().length === 1 ? "Type at least 2 characters to search." : emptyHint}
            </div>
          ) : (
            <div
              data-testid="admin-search-results"
              className="w-full bg-surface border border-border rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col gap-4"
            >
              <div className="flex items-center justify-between border-b border-border pb-3 gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-text-primary font-heading uppercase tracking-wider flex items-center gap-2 min-w-0">
                  <Search className="w-4 h-4 text-[#A30F2D] shrink-0" />
                  <span className="truncate">Admin Search for &ldquo;{query.trim()}&rdquo;</span>
                  {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#A30F2D] shrink-0" />}
                </h2>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-xs text-[#A30F2D] hover:underline font-bold cursor-pointer shrink-0 min-h-[36px] px-2"
                >
                  Clear
                </button>
              </div>

              {error && (
                <div
                  data-testid="admin-search-error-state"
                  className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </span>
                  <button
                    type="button"
                    onClick={retry}
                    className="font-bold underline cursor-pointer shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* 1. Quick Actions */}
              {commands.length > 0 && (
                <section data-testid="admin-search-group-commands">
                  <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-[#A30F2D]" />
                    Quick Actions ({commands.length})
                  </h3>
                  <div className="flex flex-col gap-2">
                    {commands.map((cmd) => {
                      const isActive = selectableItems[activeIndex]?.key === `cmd:${cmd.id}`;
                      return (
                        <button
                          type="button"
                          key={cmd.id}
                          data-testid={`admin-search-command-${cmd.id}`}
                          aria-selected={isActive}
                          onClick={() => handleSelectDestination(cmd.destination)}
                          className={`w-full text-left p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition min-h-[44px] ${
                            isActive
                              ? "bg-[#FCE8ED]/60 border-[#A30F2D] ring-1 ring-[#A30F2D]/30"
                              : "bg-surface-hover hover:bg-canvas-warm border-border/80"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs font-bold text-text-primary truncate">{cmd.title}</p>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-[#A30F2D] text-white shrink-0">
                                {cmd.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-text-secondary mt-0.5 truncate">{cmd.subtitle}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-[#A30F2D] shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* 2. Date / Schedule Results */}
              {dateResults.length > 0 && (
                <section data-testid="admin-search-group-dates">
                  <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#A30F2D]" />
                    Date / Schedule
                  </h3>
                  <div className="flex flex-col gap-2">
                    {dateResults.map((d) => {
                      const isActive = selectableItems[activeIndex]?.key === `date:${d.id}`;
                      return (
                        <button
                          type="button"
                          key={d.id}
                          data-testid={`admin-search-date-${d.resolvedDate}`}
                          aria-selected={isActive}
                          onClick={() => handleSelectDestination(d.destination)}
                          className={`w-full text-left p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition min-h-[44px] ${
                            isActive
                              ? "bg-[#FCE8ED]/60 border-[#A30F2D] ring-1 ring-[#A30F2D]/30"
                              : "bg-surface-hover hover:bg-canvas-warm border-border/80"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs font-bold text-text-primary truncate">{d.title}</p>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-[#FCE8ED] text-[#A30F2D] shrink-0">
                                {d.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-text-secondary mt-0.5 truncate">{d.subtitle}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-[#A30F2D] shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {isLoading && !results && !hasAnyResults && (
                <div
                  className="py-8 flex items-center justify-center gap-2 text-xs text-text-secondary"
                  data-testid="admin-search-loading-state"
                >
                  <Loader2 className="w-4 h-4 animate-spin text-[#A30F2D]" />
                  <span>Searching authorized records…</span>
                </div>
              )}

              {/* 3. Matching Records */}
              {results && results.groups.length > 0 && (
                <div className="flex flex-col gap-5" data-testid="admin-search-records-section">
                  {results.groups.map((group) => {
                    const Icon = CATEGORY_ICONS[group.category] || Search;
                    const isExpanded = Boolean(expanded[group.category]);
                    const visibleItems =
                      isExpanded || group.items.length <= INITIAL_CATEGORY_LIMIT
                        ? group.items
                        : group.items.slice(0, INITIAL_CATEGORY_LIMIT);
                    const hiddenCount = group.items.length - visibleItems.length;

                    return (
                      <section
                        key={group.category}
                        data-testid={`admin-search-group-${group.category}`}
                      >
                        <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5 text-[#A30F2D]" />
                          {group.label} ({group.totalMatched})
                        </h3>
                        <div className="flex flex-col gap-2">
                          {visibleItems.map((item) => {
                            const isActive =
                              selectableItems[activeIndex]?.key === `rec:${group.category}:${item.id}`;
                            return (
                              <button
                                type="button"
                                key={item.id}
                                data-testid={`admin-search-result-${group.category}-${item.id}`}
                                aria-selected={isActive}
                                onClick={() => handleSelectDestination(item.destination)}
                                className={`w-full text-left p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition min-h-[44px] ${
                                  isActive
                                    ? "bg-[#FCE8ED]/60 border-[#A30F2D] ring-1 ring-[#A30F2D]/30"
                                    : "bg-surface-hover hover:bg-canvas-warm border-border/80"
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="text-xs font-bold text-text-primary truncate">
                                      {item.title}
                                    </p>
                                    {item.badges?.map((badge) => (
                                      <span
                                        key={badge}
                                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-[#FCE8ED] text-[#A30F2D] shrink-0"
                                      >
                                        {badge}
                                      </span>
                                    ))}
                                  </div>
                                  {item.subtitle && (
                                    <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                                      {item.subtitle}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {item.meta && (
                                    <span className="text-xs font-bold text-[#171C26] tabular-nums">
                                      {item.meta}
                                    </span>
                                  )}
                                  <ChevronRight className="w-4 h-4 text-[#A30F2D]" />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {(hiddenCount > 0 || isExpanded) && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => ({
                                ...prev,
                                [group.category]: !prev[group.category],
                              }))
                            }
                            className="mt-2 text-xs font-bold text-[#A30F2D] hover:underline cursor-pointer"
                          >
                            {isExpanded ? "Show less" : `Show more (+${hiddenCount})`}
                          </button>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}

              {results && !isLoading && !hasAnyResults && !error && (
                <p
                  className="text-xs text-text-muted py-4 text-center"
                  data-testid="admin-search-no-results"
                >
                  No authorized records or commands found matching &ldquo;{query.trim()}&rdquo;.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
