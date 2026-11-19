"use client";

import { useState } from "react";
import { Bell, Pin, ChevronRight, X, Calendar, User } from "lucide-react";
import { format } from "date-fns";
import { Post } from "@/lib/types";

export function ClubAnnouncementsSection({
  posts = [],
  onNavigateToFeed,
}: {
  posts: Post[];
  onNavigateToFeed: () => void;
}) {
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Post | null>(null);

  // Filter posts that qualify as announcements or important notices
  const announcements = posts
    .filter(
      (p) =>
        (p as any).isAnnouncement ||
        (p as any).isPinned ||
        (p as any).title?.toLowerCase().includes("announcement") ||
        (p as any).title?.toLowerCase().includes("notice") ||
        p.text.toLowerCase().includes("announcement") ||
        p.text.toLowerCase().includes("notice")
    )
    .slice(0, 3);

  // If no explicit announcements found, take the top 2 recent posts
  const displayItems = announcements.length > 0 ? announcements : posts.slice(0, 2);

  const getPostDateString = (post: Post) => {
    try {
      const raw =
        typeof post.createdAt === "object" && "seconds" in post.createdAt
          ? (post.createdAt as any).seconds * 1000
          : post.createdAt;
      return format(new Date(raw), "MMM d, yyyy");
    } catch {
      return "Recent";
    }
  };

  return (
    <section
      data-testid="club-announcements-section"
      aria-label="Club Announcements"
      className="w-full flex flex-col gap-3.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-soft-blush flex items-center justify-center">
            <Bell className="w-3.5 h-3.5 text-scarlet" />
          </div>
          <h2 className="text-xs sm:text-sm font-bold text-text-primary uppercase tracking-wider font-heading">
            Club Announcements
          </h2>
        </div>

        <button
          type="button"
          onClick={onNavigateToFeed}
          className="min-h-[44px] inline-flex items-center gap-1 text-xs font-bold text-scarlet hover:text-deep-wine transition px-1 cursor-pointer"
        >
          <span>All Notices</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {displayItems.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {displayItems.map((post) => {
            const isPinned = (post as any).isPinned || (post as any).isAnnouncement;

            return (
              <div
                key={post.id}
                data-testid={`announcement-item-${post.id}`}
                onClick={() => setSelectedAnnouncement(post)}
                className={`w-full bg-surface border rounded-xl p-3.5 sm:p-4 transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs hover:border-scarlet/40 ${
                  isPinned
                    ? "border-scarlet/30 bg-gradient-to-r from-canvas-warm to-surface"
                    : "border-border hover:bg-canvas-warm/40"
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      isPinned ? "bg-scarlet/15 text-scarlet" : "bg-surface-hover text-text-muted"
                    }`}
                  >
                    {isPinned ? <Pin className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {isPinned && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-scarlet text-white">
                          Important
                        </span>
                      )}
                      <span className="text-[10px] font-bold text-text-muted">
                        {getPostDateString(post)}
                      </span>
                      {post.authorName && (
                        <span className="text-[10px] font-medium text-text-secondary truncate">
                          • {post.authorName}
                        </span>
                      )}
                    </div>

                    <h3 className="text-xs sm:text-sm font-bold text-text-primary tracking-tight font-heading truncate">
                      {(post as any).title || post.text.slice(0, 60)}
                    </h3>
                    <p className="text-xs text-text-secondary line-clamp-2 mt-0.5 font-medium">
                      {post.text}
                    </p>
                  </div>
                </div>

                <div className="self-end sm:self-center shrink-0 text-xs font-bold text-scarlet flex items-center gap-1">
                  <span>Read Notice</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-4 text-center text-xs text-text-muted">
          No announcements published at this time.
        </div>
      )}

      {/* Full Announcement Modal */}
      {selectedAnnouncement && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="announcement-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <div className="bg-surface border border-border rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {(selectedAnnouncement as any).isPinned && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-scarlet text-white">
                      Important Notice
                    </span>
                  )}
                  <span className="text-xs text-text-muted font-bold flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-scarlet" />
                    {getPostDateString(selectedAnnouncement)}
                  </span>
                </div>
                <h3
                  id="announcement-modal-title"
                  className="text-base sm:text-lg font-black font-heading text-text-primary"
                >
                  {(selectedAnnouncement as any).title || "Club Notice"}
                </h3>
                {selectedAnnouncement.authorName && (
                  <p className="text-xs text-text-secondary flex items-center gap-1 mt-0.5">
                    <User className="w-3 h-3 text-text-muted" />
                    <span>Posted by {selectedAnnouncement.authorName}</span>
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedAnnouncement(null)}
                aria-label="Close announcement"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-surface-hover text-text-muted hover:text-text-primary transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto text-xs sm:text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
              {selectedAnnouncement.text}
            </div>

            <div className="pt-2 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedAnnouncement(null)}
                className="min-h-[44px] px-5 py-2 bg-deep-wine text-white font-bold text-xs uppercase tracking-wider rounded-xl transition hover:bg-scarlet cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
