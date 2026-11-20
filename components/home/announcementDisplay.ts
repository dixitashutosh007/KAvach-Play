/**
 * Announcement presentation helper (`components/home/announcementDisplay.ts`).
 *
 * The Home section already carries the "Club Announcements" heading, so cards
 * must not repeat a generic "Club Announcement"/"Notice" label, and must not show
 * the same text as both headline and summary.
 */

const GENERIC_TITLE =
  /^\s*(?:club\s+|important\s+)?(?:announcement|announcements|notice|notices|update|updates)\s*[:\-–—]?\s*$/i;
const GENERIC_PREFIX =
  /^\s*(?:club\s+|important\s+)?(?:announcement|announcements|notice|notices)\s*[:\-–—]\s*/i;

export interface AnnouncementLike {
  title?: string | null;
  text?: string | null;
  isPinned?: boolean;
  isAnnouncement?: boolean;
}

export interface AnnouncementDisplay {
  /** Short headline; null when the post has no distinct headline. */
  headline: string | null;
  /** Body summary; null when it would merely repeat the headline. */
  summary: string | null;
  /** Category chip, only when it adds meaning beyond the section heading. */
  category: "Important" | null;
}

const normalize = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();

export function getAnnouncementDisplay(post: AnnouncementLike): AnnouncementDisplay {
  const rawTitle = (post.title || "").trim();
  const title = rawTitle && !GENERIC_TITLE.test(rawTitle) ? rawTitle.replace(GENERIC_PREFIX, "").trim() : "";
  const text = (post.text || "").replace(GENERIC_PREFIX, "").trim();
  const category = post.isPinned || post.isAnnouncement ? "Important" : null;

  if (title) {
    const summary = text && normalize(text) !== normalize(title) ? text : null;
    return { headline: title, summary, category };
  }

  // No distinct title: use a short first line as the headline when the body has one.
  const newline = text.indexOf("\n");
  if (newline > 0) {
    const firstLine = text.slice(0, newline).trim();
    const rest = text.slice(newline + 1).trim();
    if (firstLine && firstLine.length <= 90 && rest) {
      return { headline: firstLine, summary: rest, category };
    }
  }
  return { headline: null, summary: text || null, category };
}
