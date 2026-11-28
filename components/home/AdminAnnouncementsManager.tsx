"use client";

/**
 * Admin → Club → Announcements (D-18): club announcement publishing, editing
 * and deleting. Moved from Player Home in D-16 and from Admin Home into Club in
 * D-18; behaviour is unchanged (same store calls, same gate, Firestore rules
 * still decide whether a write is allowed).
 *
 * Every action is gated by the original `canPublishAnnouncements` check
 * (Super Admin claim or Club Admin) in addition to the Club section guard.
 */
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/components/AuthProvider";
import { resolveMyPlayers } from "@/lib/player-identity";
import { resolveGreetingName } from "@/lib/greeting";
import { ClubAnnouncementsSection } from "./ClubAnnouncementsSection";
import type { AnnouncementDraft } from "./AnnouncementComposer";

export function AdminAnnouncementsManager({
  store,
  currentUserId,
  currentUserName,
  defaultAction,
}: {
  store: ReturnType<typeof useStore>;
  currentUserId: string;
  currentUserName: string;
  defaultAction?: string | null;
}) {
  const { toast } = useToast();
  const { posts = [], players = [], appConfig } = store;
  const [selectedFeedPostId, setSelectedFeedPostId] = useState<string | null>(null);
  useEffect(() => {
    if (defaultAction?.startsWith("post:")) {
      setSelectedFeedPostId(defaultAction.replace("post:", ""));
    } else {
      setSelectedFeedPostId(null);
    }
  }, [defaultAction]);
  const selectedFeedPost = useMemo(
    () => (selectedFeedPostId ? posts.find((p) => p.id === selectedFeedPostId) || null : null),
    [selectedFeedPostId, posts],
  );
  const openAnnouncementId = defaultAction?.startsWith("open:")
    ? defaultAction.replace("open:", "")
    : null;
  const autoOpenComposer = defaultAction === "create";
  const appUser = store.appUsers.find((u) => u.id === currentUserId);
  const mePlayer = useMemo(
    () => resolveMyPlayers(players, currentUserId, appUser)[0] || null,
    [players, currentUserId, appUser],
  );

  // Same gate as before the move: super admins (verified claim) and Club Admins.
  // Firestore rules independently restrict post writes to admins.
  const { hasAdminClaim } = useAuth();
  const canPublishAnnouncements = Boolean(hasAdminClaim || appUser?.isClubAdmin);

  const handlePublishAnnouncement = async (draft: AnnouncementDraft) => {
    if (!canPublishAnnouncements || !store.addPost) return false;
    const id = await store.addPost({
      text: draft.text,
      ...(draft.title ? { title: draft.title } : {}),
      ...(typeof draft.imageUrl === "string" ? { imageUrl: draft.imageUrl } : {}),
      ...(draft.linkUrl ? { linkUrl: draft.linkUrl } : {}),
      ...(draft.displayDurationSec !== undefined ? { displayDurationSec: draft.displayDurationSec } : {}),
      isAnnouncement: true,
      isPinned: draft.isPinned,
      authorName:
        resolveGreetingName(mePlayer?.name, appUser?.name, currentUserName) ||
        appConfig?.clubName ||
        "Club Management",
      authorId: currentUserId,
    });
    if (id) {
      toast("Announcement published", "success");
      return true;
    }
    return false;
  };

  const handleUpdateAnnouncement = async (postId: string, draft: AnnouncementDraft) => {
    if (!canPublishAnnouncements || !store.updateAnnouncement) return false;
    const ok = await store.updateAnnouncement(postId, {
      text: draft.text,
      title: draft.title || undefined,
      isPinned: draft.isPinned,
      // "" removes the link; undefined (e.g. banner pin toggle) leaves it unchanged
      ...(draft.linkUrl !== undefined ? { linkUrl: draft.linkUrl || undefined } : {}),
      // undefined (e.g. banner pin toggle) leaves the stored duration unchanged
      ...(draft.displayDurationSec !== undefined ? { displayDurationSec: draft.displayDurationSec } : {}),
      // null → remove image, string → replace, undefined → leave unchanged
      ...(draft.imageUrl === null ? { imageUrl: undefined } : typeof draft.imageUrl === "string" ? { imageUrl: draft.imageUrl } : {}),
    });
    toast(ok ? "Announcement updated" : "The announcement could not be updated.", ok ? "success" : "error");
    return ok;
  };

  const handleDeleteAnnouncement = async (postId: string) => {
    if (!canPublishAnnouncements || !store.deleteAnnouncement) return false;
    const ok = await store.deleteAnnouncement(postId);
    toast(ok ? "Announcement deleted" : "The announcement could not be deleted.", ok ? "success" : "error");
    return ok;
  };

  return (
    <div data-testid="admin-announcements-manager" className="space-y-5">
      <ClubAnnouncementsSection
        posts={posts}
        canPublish={canPublishAnnouncements}
        onPublish={handlePublishAnnouncement}
        onUpdate={handleUpdateAnnouncement}
        onDelete={handleDeleteAnnouncement}
        openAnnouncementId={openAnnouncementId}
        autoOpenComposer={autoOpenComposer}
      />

      {selectedFeedPost && (
        <div
          data-testid="admin-feed-post-detail-modal"
          className="fixed inset-0 z-[170] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedFeedPostId(null)}
        >
          <div
            className="w-full max-w-lg bg-surface border border-border rounded-2xl p-5 shadow-xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-text-primary">Feed Post</h3>
                <p className="text-xs text-text-secondary">{selectedFeedPost.authorName || "Club"}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFeedPostId(null)}
                aria-label="Close post detail"
                className="min-w-[40px] min-h-[40px] rounded-xl border border-border flex items-center justify-center text-text-secondary hover:bg-surface-hover cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
              {selectedFeedPost.text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
