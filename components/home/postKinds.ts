/**
 * Post classification for Player Home (`components/home/postKinds.ts`). Pure.
 *
 * - Announcements: posts an admin published as a club announcement
 *   (`isAnnouncement === true`). Shown only under Club Announcements.
 * - Feed: every other post (ad-hoc posts, automatic badge posts, ...).
 * - Banner: announcements the admin chose to pin (`isPinned === true`).
 */
import type { Post } from "@/lib/types";

export const isAnnouncementPost = (p: Partial<Post> | null | undefined): boolean =>
  Boolean(p && p.isAnnouncement === true);

export const announcementPosts = (posts: Post[] = []): Post[] => posts.filter(isAnnouncementPost);

export const feedPosts = (posts: Post[] = []): Post[] => posts.filter((p) => !isAnnouncementPost(p));

export const pinnedAnnouncements = (posts: Post[] = []): Post[] =>
  posts.filter((p) => isAnnouncementPost(p) && p.isPinned === true);
