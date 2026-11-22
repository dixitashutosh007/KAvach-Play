"use client";

/**
 * Club Announcements (`components/home/ClubAnnouncementsSection.tsx`).
 *
 * Shows ONLY posts an admin published as a club announcement
 * (`isAnnouncement === true`), newest first. Everything else belongs to the
 * Club Feed. Admins with publishing rights see a "New" button.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Pin, ChevronRight, ChevronDown, X, Calendar, User, Plus, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { Post } from "@/lib/types";
import { getAnnouncementDisplay } from "./announcementDisplay";
import { announcementPosts } from "./postKinds";
import { AnnouncementComposer, type AnnouncementDraft } from "./AnnouncementComposer";
import { LinkifiedText } from "@/components/ui/LinkifiedText";
import { isSafeImageSrc } from "@/lib/announcement-image";
import { toSafeHttpsHref } from "@/lib/linkify";

const COLLAPSED_COUNT = 3;

export function ClubAnnouncementsSection({
  posts = [],
  canPublish = false,
  onPublish,
  onUpdate,
  onDelete,
  openAnnouncementId,
  onOpenHandled,
}: {
  posts: Post[];
  /** Show the admin composer (UI only; Firestore rules enforce admin-only creation). */
  canPublish?: boolean;
  onPublish?: (draft: AnnouncementDraft) => Promise<boolean>;
  /** Admin edit / pin toggle. Resolves true when saved. */
  onUpdate?: (postId: string, draft: AnnouncementDraft) => Promise<boolean>;
  /** Admin delete. Resolves true when deleted. */
  onDelete?: (postId: string) => Promise<boolean>;
  /** When set (e.g. from the top banner), scroll here and open that announcement. */
  openAnnouncementId?: string | null;
  onOpenHandled?: () => void;
}) {
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Post | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const canManage = canPublish && Boolean(onUpdate && onDelete);
  const closeDetail = () => {
    setSelectedAnnouncement(null);
    setConfirmDelete(false);
  };
  const sectionRef = useRef<HTMLElement>(null);

  const announcements = useMemo(() => announcementPosts(posts), [posts]);
  const displayItems = showAll ? announcements : announcements.slice(0, COLLAPSED_COUNT);

  useEffect(() => {
    if (!openAnnouncementId) return;
    const target = announcements.find((p) => p.id === openAnnouncementId);
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (target) setSelectedAnnouncement(target);
    onOpenHandled?.();
  }, [openAnnouncementId, announcements, onOpenHandled]);

  const getPostDateString = (post: Post) => {
    try {
      const raw =
        typeof post.createdAt === "object" && post.createdAt && "seconds" in post.createdAt
          ? (post.createdAt as any).seconds * 1000
          : post.createdAt;
      return format(new Date(raw), "MMM d, yyyy");
    } catch {
      return "Recent";
    }
  };

  return (
    <section
      ref={sectionRef}
      id="club-announcements"
      data-testid="club-announcements-section"
      aria-label="Club Announcements"
      className="w-full flex flex-col gap-3 scroll-mt-24"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-soft-blush flex items-center justify-center">
            <Bell className="w-3.5 h-3.5 text-scarlet" aria-hidden="true" />
          </div>
          <h2 className="text-xs sm:text-sm font-bold text-text-primary uppercase tracking-wider font-heading">
            Club Announcements
          </h2>
        </div>

        {canPublish && onPublish && (
          <button
            type="button"
            data-testid="new-announcement-button"
            onClick={() => setComposerOpen(true)}
            className="min-h-[40px] inline-flex items-center gap-1 px-3 rounded-xl bg-scarlet text-white text-xs font-bold hover:bg-deep-wine transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>New</span>
          </button>
        )}
      </div>

      {displayItems.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {displayItems.map((post) => {
            const display = getAnnouncementDisplay(post as any);
            const isPinned = post.isPinned === true;

            return (
              <button
                type="button"
                key={post.id}
                data-testid={`announcement-item-${post.id}`}
                onClick={() => setSelectedAnnouncement(post)}
                aria-label={`Read notice: ${display.headline || display.summary?.slice(0, 60) || "Club notice"}`}
                className={`w-full text-left bg-surface border rounded-xl overflow-hidden transition cursor-pointer flex flex-col shadow-xs hover:border-scarlet/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50 ${
                  isPinned ? "border-scarlet/30" : "border-border hover:bg-canvas-warm/40"
                }`}
              >
                {isSafeImageSrc(post.imageUrl) && (
                  <span className="block w-full aspect-video bg-surface-hover" data-testid={`announcement-image-${post.id}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={post.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                  </span>
                )}
                <span className="flex items-start gap-3 p-3 sm:p-3.5">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    isPinned ? "bg-scarlet/15 text-scarlet" : "bg-surface-hover text-text-muted"
                  }`}
                  aria-hidden="true"
                >
                  {isPinned ? <Pin className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isPinned && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-scarlet text-white">
                        Important
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-text-muted">{getPostDateString(post)}</span>
                  </div>

                  {display.headline && (
                    <h3
                      data-testid={`announcement-headline-${post.id}`}
                      className="mt-0.5 text-xs sm:text-sm font-bold text-text-primary tracking-tight font-heading line-clamp-1"
                    >
                      {display.headline}
                    </h3>
                  )}
                  {display.summary && (
                    <p
                      data-testid={`announcement-summary-${post.id}`}
                      className={`text-xs text-text-secondary line-clamp-2 font-medium ${display.headline ? "mt-0.5" : "mt-1"}`}
                    >
                      {display.summary}
                    </p>
                  )}
                  <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-scarlet">
                    <span>Read Notice</span>
                    <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                </div>
                </span>
              </button>
            );
          })}

          {announcements.length > COLLAPSED_COUNT && (
            <button
              type="button"
              data-testid="announcements-toggle"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="self-center inline-flex items-center gap-1 min-h-[40px] px-3 text-xs font-bold text-scarlet hover:text-deep-wine cursor-pointer"
            >
              <span>{showAll ? "Show fewer" : `Show all (${announcements.length})`}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <div data-testid="announcements-empty" className="bg-surface border border-border rounded-xl p-4 text-center text-xs text-text-muted">
          No club announcements right now.
        </div>
      )}

      {composerOpen && onPublish && (
        <AnnouncementComposer onClose={() => setComposerOpen(false)} onPublish={onPublish} />
      )}

      {editing && onUpdate && (
        <AnnouncementComposer
          initial={{
            title: editing.title,
            text: editing.text,
            isPinned: editing.isPinned,
            imageUrl: editing.imageUrl,
            linkUrl: editing.linkUrl,
            displayDurationSec: editing.displayDurationSec,
          }}
          onClose={() => setEditing(null)}
          onPublish={(draft) => onUpdate(editing.id, draft)}
        />
      )}

      {selectedAnnouncement && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="announcement-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <div className="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 sm:p-6 shadow-xl flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {selectedAnnouncement.isPinned && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-scarlet text-white">
                      Important Notice
                    </span>
                  )}
                  <span className="text-xs text-text-muted font-bold flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-scarlet" aria-hidden="true" />
                    {getPostDateString(selectedAnnouncement)}
                  </span>
                </div>
                <h3 id="announcement-modal-title" className="text-base sm:text-lg font-black font-heading text-text-primary">
                  {getAnnouncementDisplay(selectedAnnouncement as any).headline || "Club Notice"}
                </h3>
                {selectedAnnouncement.authorName && (
                  <p className="text-xs text-text-secondary flex items-center gap-1 mt-0.5">
                    <User className="w-3 h-3 text-text-muted" aria-hidden="true" />
                    <span>Posted by {selectedAnnouncement.authorName}</span>
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={closeDetail}
                aria-label="Close announcement"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-surface-hover text-text-muted hover:text-text-primary transition cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {isSafeImageSrc(selectedAnnouncement.imageUrl) && (
              <div className="w-full aspect-video overflow-hidden rounded-xl bg-surface-hover shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedAnnouncement.imageUrl} alt="" className="w-full h-full object-cover" />
              </div>
            )}

            {toSafeHttpsHref(selectedAnnouncement.linkUrl) && (
              <a
                href={toSafeHttpsHref(selectedAnnouncement.linkUrl) as string}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="announcement-open-link"
                className="self-start inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-scarlet text-white text-xs font-bold hover:bg-deep-wine focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
              >
                Open link
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}

            <div
              data-testid="announcement-modal-body"
              className="max-h-[60vh] overflow-y-auto text-xs sm:text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-words"
            >
              <LinkifiedText text={selectedAnnouncement.text} />
            </div>

            <div className="pt-2 border-t border-border flex flex-wrap items-center justify-end gap-2">
              {canManage && (
                <div className="mr-auto flex flex-wrap items-center gap-2" data-testid="announcement-admin-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(selectedAnnouncement);
                      closeDetail();
                    }}
                    className="min-h-[40px] px-3 rounded-xl border border-border text-xs font-bold text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const next = !(selectedAnnouncement.isPinned === true);
                      const ok = await onUpdate!(selectedAnnouncement.id, {
                        title: selectedAnnouncement.title || "",
                        text: selectedAnnouncement.text,
                        isPinned: next,
                      });
                      setBusy(false);
                      if (ok) setSelectedAnnouncement({ ...selectedAnnouncement, isPinned: next });
                    }}
                    className="min-h-[40px] px-3 rounded-xl border border-border text-xs font-bold text-text-secondary hover:text-text-primary cursor-pointer"
                  >
                    {selectedAnnouncement.isPinned ? "Remove from banner" : "Show in banner"}
                  </button>
                  {confirmDelete ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const ok = await onDelete!(selectedAnnouncement.id);
                        setBusy(false);
                        if (ok) closeDetail();
                      }}
                      className="min-h-[40px] px-3 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 cursor-pointer"
                    >
                      Confirm delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                      className="min-h-[40px] px-3 rounded-xl border border-rose-200 text-xs font-bold text-rose-700 hover:bg-rose-50 cursor-pointer"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={closeDetail}
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
