"use client";

/**
 * Admin-only "New announcement" dialog (`components/home/AnnouncementComposer.tsx`).
 *
 * Saves through the existing post workflow with `isAnnouncement: true`.
 * Firestore rules already restrict post creation to administrators; this UI is
 * only shown to admins and is not itself a security boundary.
 */
import { useEffect, useRef, useState } from "react";
import { X, Megaphone, Loader2 } from "lucide-react";
import { AnnouncementImagePicker, exportCroppedImage, type PickedImage } from "./AnnouncementImagePicker";
import { isSafeImageSrc } from "@/lib/announcement-image";
import { toSafeHttpsHref } from "@/lib/linkify";
import {
  BANNER_DURATION_DEFAULT_SEC,
  BANNER_DURATION_MAX_SEC,
  BANNER_DURATION_MIN_SEC,
  validateDisplayDuration,
} from "@/lib/banner-duration";

export const ANNOUNCEMENT_TITLE_MAX = 100;
export const ANNOUNCEMENT_TEXT_MAX = 2000;

export interface AnnouncementDraft {
  title: string;
  text: string;
  isPinned: boolean;
  /**
   * New image as a JPEG data URL, `null` to remove the existing image, or
   * `undefined` to leave the image unchanged.
   */
  imageUrl?: string | null;
  /** Optional HTTPS destination opened from the Home banner ("" = none). */
  linkUrl?: string;
  /** Seconds shown in the Home top banner before rotating (whole number, 3–60). */
  displayDurationSec?: number;
}

/** Returns an error message, or null when the draft can be published. */
export function validateAnnouncementDraft(d: AnnouncementDraft): string | null {
  if (d.displayDurationSec !== undefined) {
    const dur = validateDisplayDuration(d.displayDurationSec);
    if (!dur.ok) return dur.error;
  }
  const link = (d.linkUrl || "").trim();
  if (link && !toSafeHttpsHref(link)) {
    return "Link must be a full https:// web address (e.g. https://example.com/page).";
  }
  const title = d.title.trim();
  const text = d.text.trim();
  if (!text) return "Please write the announcement message.";
  if (text.length > ANNOUNCEMENT_TEXT_MAX) return `Message must be ${ANNOUNCEMENT_TEXT_MAX} characters or fewer.`;
  if (title.length > ANNOUNCEMENT_TITLE_MAX) return `Title must be ${ANNOUNCEMENT_TITLE_MAX} characters or fewer.`;
  return null;
}

export function AnnouncementComposer({
  onClose,
  onPublish,
  initial,
}: {
  onClose: () => void;
  /** Resolves true when the announcement was saved. */
  onPublish: (draft: AnnouncementDraft) => Promise<boolean>;
  /** Present when editing an existing announcement. */
  initial?: {
    title?: string;
    text: string;
    isPinned?: boolean;
    imageUrl?: string;
    linkUrl?: string;
    displayDurationSec?: number;
  };
}) {
  const isEdit = Boolean(initial);
  const [draft, setDraft] = useState<AnnouncementDraft>({
    title: initial?.title || "",
    text: initial?.text || "",
    isPinned: initial?.isPinned === true,
    linkUrl: initial?.linkUrl || "",
  });
  // Kept as text so the admin can clear and retype; validated on submit.
  // Older announcements without a stored value show the default.
  const [durationText, setDurationText] = useState<string>(() => {
    const stored = validateDisplayDuration(initial?.displayDurationSec);
    return String(stored.ok ? stored.value : BANNER_DURATION_DEFAULT_SEC);
  });
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(
    initial?.imageUrl && isSafeImageSrc(initial.imageUrl) ? initial.imageUrl : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const duration = validateDisplayDuration(durationText);
    if (!duration.ok) {
      setError(duration.error);
      return;
    }
    const problem = validateAnnouncementDraft({ ...draft, displayDurationSec: duration.value });
    if (problem) {
      setError(problem);
      return;
    }
    let imageUrl: string | null | undefined;
    try {
      if (picked) imageUrl = exportCroppedImage(picked);
      else if (isEdit && initial?.imageUrl && !existingImage) imageUrl = null; // removed
      else imageUrl = undefined; // unchanged / none
    } catch (err) {
      setError(err instanceof Error ? err.message : "The image could not be processed.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ok = await onPublish({
        title: draft.title.trim(),
        text: draft.text.trim(),
        isPinned: draft.isPinned,
        linkUrl: toSafeHttpsHref(draft.linkUrl) || "",
        displayDurationSec: duration.value,
        imageUrl,
      });
      if (ok) onClose();
      else setError("The announcement could not be published. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-composer-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
    >
      <form
        onSubmit={submit}
        data-testid="announcement-composer"
        className="bg-surface border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 sm:p-6 shadow-xl flex flex-col gap-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="announcement-composer-title" className="flex items-center gap-2 text-base font-black font-heading text-text-primary">
            <Megaphone className="w-4 h-4 text-scarlet" aria-hidden="true" />
            {isEdit ? "Edit announcement" : "New club announcement"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-surface-hover text-text-muted hover:text-text-primary cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Title (optional)</span>
          <input
            ref={titleRef}
            type="text"
            value={draft.title}
            maxLength={ANNOUNCEMENT_TITLE_MAX}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="e.g. AGM on Sunday"
            className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-scarlet/30 focus:border-scarlet"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Message</span>
          <textarea
            value={draft.text}
            required
            rows={5}
            maxLength={ANNOUNCEMENT_TEXT_MAX}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            placeholder="What do members need to know?"
            className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-scarlet/30 focus:border-scarlet resize-y"
          />
          <span className="self-end text-[10px] text-text-muted tabular-nums">
            {draft.text.length}/{ANNOUNCEMENT_TEXT_MAX}
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Link (optional)</span>
          <input
            type="url"
            inputMode="url"
            value={draft.linkUrl || ""}
            onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
            placeholder="https://…"
            data-testid="announcement-link-input"
            className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-scarlet/30 focus:border-scarlet"
          />
          <span className="text-[10px] text-text-muted">Members who tap this announcement in the Home banner open this page.</span>
        </label>

        <AnnouncementImagePicker
          value={picked}
          existingUrl={existingImage}
          onChange={setPicked}
          onRemoveExisting={() => setExistingImage(null)}
        />

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.isPinned}
            onChange={(e) => setDraft({ ...draft, isPinned: e.target.checked })}
            className="mt-0.5 w-4 h-4 accent-[var(--brand-scarlet)]"
          />
          <span className="text-xs text-text-secondary">
            <span className="font-bold text-text-primary">Show in the Home top banner</span>
            <br />
            Use for important notices only.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Display Duration (seconds)</span>
          <input
            type="number"
            inputMode="numeric"
            min={BANNER_DURATION_MIN_SEC}
            max={BANNER_DURATION_MAX_SEC}
            step={1}
            value={durationText}
            onChange={(e) => setDurationText(e.target.value)}
            data-testid="announcement-duration-input"
            className="w-32 bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary tabular-nums focus:outline-none focus:ring-2 focus:ring-scarlet/30 focus:border-scarlet"
          />
          <span className="text-[10px] text-text-muted">
            How long this announcement stays in the Home top banner before the next one appears
            ({BANNER_DURATION_MIN_SEC}–{BANNER_DURATION_MAX_SEC} seconds, default {BANNER_DURATION_DEFAULT_SEC}). Not a start or end date.
          </span>
        </label>

        {error && (
          <p role="alert" className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-[44px] px-4 rounded-xl border border-border text-xs font-bold uppercase tracking-wider text-text-secondary hover:text-text-primary cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] px-5 rounded-xl bg-scarlet text-white text-xs font-bold uppercase tracking-wider hover:bg-deep-wine disabled:opacity-70 cursor-pointer inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {isEdit ? "Save" : "Publish"}
          </button>
        </div>
      </form>
    </div>
  );
}
