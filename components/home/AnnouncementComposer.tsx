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

export const ANNOUNCEMENT_TITLE_MAX = 100;
export const ANNOUNCEMENT_TEXT_MAX = 2000;

export interface AnnouncementDraft {
  title: string;
  text: string;
  isPinned: boolean;
}

/** Returns an error message, or null when the draft can be published. */
export function validateAnnouncementDraft(d: AnnouncementDraft): string | null {
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
}: {
  onClose: () => void;
  /** Resolves true when the announcement was saved. */
  onPublish: (draft: AnnouncementDraft) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<AnnouncementDraft>({ title: "", text: "", isPinned: false });
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
    const problem = validateAnnouncementDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ok = await onPublish({ title: draft.title.trim(), text: draft.text.trim(), isPinned: draft.isPinned });
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
        className="bg-surface border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-xl flex flex-col gap-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="announcement-composer-title" className="flex items-center gap-2 text-base font-black font-heading text-text-primary">
            <Megaphone className="w-4 h-4 text-scarlet" aria-hidden="true" />
            New club announcement
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
            Publish
          </button>
        </div>
      </form>
    </div>
  );
}
