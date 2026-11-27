"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  Calendar,
  ChevronRight,
  Loader2,
  MapPin,
  Megaphone,
  Search,
  ShoppingBag,
  Sparkles,
  Trophy,
  Users,
  Video,
  Vote,
  Wallet,
  X,
} from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import type {
  AdminSearchCategory,
  AdminSearchResponse,
  AdminSearchResultItem,
} from "@/lib/admin-search";
import type { AdminDestination } from "@/lib/admin-navigation";

const SEARCH_DEBOUNCE_MS = 220;
const INITIAL_CATEGORY_LIMIT = 4;

const CATEGORY_ICONS: Record<AdminSearchCategory, typeof Search> = {
  players: Users,
  matches: Calendar,
  grounds: MapPin,
  finance: Wallet,
  announcements: Megaphone,
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
}: {
  query: string;
  enabled: boolean;
}) {
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AdminSearchResponse | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current += 1;
      setIsDebouncing(false);
      setDebouncedQuery("");
      setIsFetching(false);
      setError(null);
      setResults(null);
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

    setIsDebouncing(true);
    const timer = setTimeout(() => {
      setIsDebouncing(false);
      setDebouncedQuery(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, enabled]);

  useEffect(() => {
    if (!enabled || debouncedQuery.length < 2) return;

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
          setResults(data as AdminSearchResponse);
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

export function AdminGlobalSearchModal({
  open,
  onClose,
  isSuperAdmin,
  isClubAdmin,
  isFinanceAdmin,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
  isClubAdmin: boolean;
  isFinanceAdmin: boolean;
  onNavigate: (tab: AdminDestination, action?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { debouncedQuery, isLoading, error, results, retry } = useAdminGlobalSearch({
    query,
    enabled: open,
  });

  useEffect(() => {
    setExpanded({});
  }, [debouncedQuery]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setExpanded({});
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSeeFinance = isSuperAdmin || isFinanceAdmin;
  const canSeeClub = isSuperAdmin || isClubAdmin;

  const emptyHint = canSeeClub && canSeeFinance
    ? "Search players, matches, grounds, dues, fee plans, announcements, polls, badges, catches, no-shows, tournaments, studio, or shop."
    : canSeeClub
      ? "Search players, matches, grounds, tournaments, announcements, polls, badges, catches, studio, or shop."
      : "Search dues, match payments, fee plans, no-shows, matches, players, or studio subscriptions.";

  const handleSelect = (item: AdminSearchResultItem) => {
    onNavigate(item.destination.tab, item.destination.action);
    setQuery("");
    onClose();
  };

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
              placeholder="Admin search… (⌘K)"
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

        <div className="p-3 sm:p-4 max-h-[75vh] overflow-y-auto">
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

              {isLoading && !results && (
                <div
                  className="py-8 flex items-center justify-center gap-2 text-xs text-text-secondary"
                  data-testid="admin-search-loading-state"
                >
                  <Loader2 className="w-4 h-4 animate-spin text-[#A30F2D]" />
                  <span>Searching authorized records…</span>
                </div>
              )}

              {results && results.groups.length > 0 && (
                <div className="flex flex-col gap-5">
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
                          {visibleItems.map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              data-testid={`admin-search-result-${group.category}-${item.id}`}
                              onClick={() => handleSelect(item)}
                              className="w-full text-left p-3 bg-surface-hover hover:bg-canvas-warm rounded-xl border border-border/80 flex items-center justify-between gap-2 cursor-pointer transition min-h-[44px]"
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
                          ))}
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

              {results && !isLoading && results.groups.length === 0 && !error && (
                <p
                  className="text-xs text-text-muted py-4 text-center"
                  data-testid="admin-search-no-results"
                >
                  No authorized records found matching &ldquo;{query.trim()}&rdquo;.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
