"use client";

/**
 * Player → Club → Announcements (D-20): the complete announcement list, read
 * only. Loaded page by page (newest first) through a cursor so older history
 * is only read when the member asks for it. Reuses the existing announcement
 * list and detail view (ClubAnnouncementsSection) without publishing controls.
 */
import { useEffect, useState } from "react";
import { useAnnouncementPages } from "@/hooks/useClubData";
import { ClubAnnouncementsSection } from "@/components/home/ClubAnnouncementsSection";
import { nextAnnouncementPageAction } from "@/lib/club-feed";

export function ClubAnnouncementsScreen({
  openId,
  onOpenHandled,
  onReturnFromSearch,
}: {
  openId?: string | null;
  onOpenHandled?: () => void;
  onReturnFromSearch?: () => void;
}) {
  const { items, loading, error, done, loadMore } = useAnnouncementPages(20);
  const [pendingOpen, setPendingOpen] = useState<string | null>(openId || null);

  useEffect(() => {
    if (openId) {
      setPendingOpen(openId);
    }
  }, [openId]);

  const pageAction = nextAnnouncementPageAction({
    pendingOpen,
    items,
    done,
    loading,
    error,
  });

  useEffect(() => {
    if (pageAction === "load_more") {
      void loadMore();
    } else if (pageAction === "not_found") {
      setPendingOpen(null);
      onOpenHandled?.();
    }
  }, [pageAction, loadMore, onOpenHandled]);

  const readyToOpen = pageAction === "open" ? pendingOpen : null;

  return (
    <div className="flex flex-col gap-3" data-testid="club-announcements-screen">
      {error && (
        <p className="p-4 rounded-2xl bg-surface border border-border text-sm text-text-secondary">
          Announcements couldn&apos;t be loaded. Please try again.
        </p>
      )}
      {items.length === 0 && loading ? (
        <div className="h-24 rounded-2xl bg-surface-hover animate-pulse" aria-busy="true" />
      ) : (
        <ClubAnnouncementsSection
          posts={items}
          openAnnouncementId={readyToOpen}
          onOpenHandled={() => {
            setPendingOpen(null);
            onOpenHandled?.();
          }}
          onCloseDetail={onReturnFromSearch}
        />
      )}
      {!done && (
        <button
          type="button"
          data-testid="announcements-load-more"
          onClick={() => void loadMore()}
          disabled={loading}
          className="min-h-[44px] w-full rounded-2xl border border-border bg-surface text-sm font-semibold text-scarlet hover:bg-surface-hover transition disabled:opacity-60 cursor-pointer"
        >
          {loading ? "Loading…" : "Load older announcements"}
        </button>
      )}
    </div>
  );
}
