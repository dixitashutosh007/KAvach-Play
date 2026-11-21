"use client";

/**
 * Club Feed preview (`components/home/ClubFeedPreview.tsx`).
 *
 * Ad-hoc club posts (admin and automatic posts such as badge awards). Club
 * announcements are excluded — they live only under Club Announcements.
 */
import { useMemo, useState } from "react";
import { MessageSquare, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { Post } from "@/lib/types";
import { feedPosts } from "./postKinds";

const COLLAPSED_COUNT = 3;
const EXPANDED_COUNT = 20;

export function ClubFeedPreview({ posts = [] }: { posts: Post[] }) {
  const [expanded, setExpanded] = useState(false);
  const feed = useMemo(() => feedPosts(posts), [posts]);
  const recentPosts = feed.slice(0, expanded ? EXPANDED_COUNT : COLLAPSED_COUNT);

  const getPostDateString = (post: Post) => {
    try {
      const raw =
        typeof post.createdAt === "object" && "seconds" in post.createdAt
          ? (post.createdAt as any).seconds * 1000
          : post.createdAt;
      return format(new Date(raw), "MMM d, yyyy • h:mm a");
    } catch {
      return "Recent";
    }
  };

  return (
    <section
      id="club-feed"
      data-testid="club-feed-preview-section"
      aria-label="Club Community Feed"
      className="w-full flex flex-col gap-3.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-soft-blush flex items-center justify-center">
            <MessageSquare className="w-3.5 h-3.5 text-scarlet" />
          </div>
          <h2 className="text-xs sm:text-sm font-bold text-text-primary uppercase tracking-wider font-heading">
            Club Feed
          </h2>
        </div>

        {feed.length > COLLAPSED_COUNT && (
          <button
            type="button"
            data-testid="feed-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="min-h-[44px] inline-flex items-center gap-1 text-xs font-bold text-scarlet hover:text-deep-wine transition px-1 cursor-pointer"
          >
            <span>{expanded ? "Show fewer" : `All Posts (${feed.length})`}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        )}
      </div>

      {recentPosts.length > 0 ? (
        <div className="flex flex-col gap-3">
          {recentPosts.map((post) => {
            const commentsCount = post.comments?.length || 0;
            const hasMedia = !!((post as any).mediaUrl || (post as any).imageUrl);
            const mediaUrl = (post as any).mediaUrl || (post as any).imageUrl;

            return (
              <div
                key={post.id}
                data-testid={`feed-post-${post.id}`}
                className="bg-surface border border-border rounded-xl p-4 shadow-xs flex flex-col gap-2.5 transition hover:border-scarlet/30"
              >
                {/* Author & Timestamp */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-deep-wine/10 border border-deep-wine/20 flex items-center justify-center font-bold text-xs text-deep-wine shrink-0">
                      {(post.authorName || "P").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-text-primary truncate font-heading">
                        {post.authorName || "Club Member"}
                      </p>
                      <p className="text-[10px] text-text-muted">
                        {getPostDateString(post)}
                      </p>
                    </div>
                  </div>

                  {commentsCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-text-secondary bg-surface-hover px-2 py-0.5 rounded-md">
                      <MessageSquare className="w-3 h-3 text-scarlet" />
                      <span>{commentsCount}</span>
                    </span>
                  )}
                </div>

                {/* Content preview */}
                {(post as any).title && (
                  <h4 className="text-xs sm:text-sm font-bold text-text-primary font-heading">
                    {(post as any).title}
                  </h4>
                )}
                <p className="text-xs sm:text-sm text-text-secondary leading-relaxed line-clamp-3">
                  {post.text}
                </p>

                {/* Media Image if present */}
                {hasMedia && (
                  <div className="relative rounded-lg overflow-hidden max-h-48 mt-1 border border-border">
                    <img
                      src={mediaUrl}
                      alt={(post as any).title || "Club post media"}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-4 text-center text-xs text-text-muted">
          No club posts yet.
        </div>
      )}
    </section>
  );
}
