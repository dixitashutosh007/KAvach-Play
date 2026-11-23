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
import { useMemo } from "react";
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
}: {
  store: ReturnType<typeof useStore>;
  currentUserId: string;
  currentUserName: string;
}) {
  const { toast } = useToast();
  const { posts = [], players = [], appConfig } = store;
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
      />
    </div>
  );
}
