"use client";

/**
 * Profile sync popup (`components/ProfileSyncDialog.tsx`).
 *
 * Opens automatically inside the app when the signed-in login is not linked to
 * a player record but a candidate was found by the login's verified mobile
 * number or Google email. Shows the player's name with a Sync button.
 *
 * "Sync" calls the existing server-verified link flow (never a client write).
 * "Not now" hides the popup for this browser session; the in-page notice stays.
 */
import { useEffect, useRef } from "react";
import { Link2, Loader2, UserCheck } from "lucide-react";

export function profileSyncDismissKey(uid: string): string {
  return `kavach:profile-sync-dismissed:${uid}`;
}

export function ProfileSyncDialog({
  playerName,
  matchedBy,
  isSyncing,
  onSync,
  onDismiss,
}: {
  playerName: string;
  matchedBy: "mobile" | "google";
  isSyncing: boolean;
  onSync: () => void;
  onDismiss: () => void;
}) {
  const syncRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    syncRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSyncing) onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSyncing, onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-sync-title"
      aria-describedby="profile-sync-description"
      data-testid="profile-sync-dialog"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-surface border border-border w-full max-w-sm rounded-t-2xl sm:rounded-2xl p-6 shadow-xl text-center">
        <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-scarlet/10 flex items-center justify-center">
          <UserCheck className="w-6 h-6 text-scarlet" aria-hidden="true" />
        </div>
        <h2 id="profile-sync-title" className="text-lg font-black font-heading text-text-primary">
          Welcome back, {playerName}!
        </h2>
        <p id="profile-sync-description" className="mt-2 text-sm text-text-secondary leading-relaxed">
          We found your player profile using your {matchedBy === "google" ? "Google email" : "mobile number"}. Sync it
          once to mark match availability and see your fees — you won&apos;t be asked again.
        </p>
        <button
          ref={syncRef}
          type="button"
          data-testid="profile-sync-button"
          onClick={onSync}
          disabled={isSyncing}
          className="mt-5 w-full min-h-[48px] rounded-xl bg-scarlet text-white text-sm font-bold hover:bg-deep-wine disabled:opacity-70 cursor-pointer inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50 focus-visible:ring-offset-2"
        >
          {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Link2 className="w-4 h-4" aria-hidden="true" />}
          {isSyncing ? "Syncing…" : "Sync my profile"}
        </button>
        <button
          type="button"
          data-testid="profile-sync-dismiss"
          onClick={onDismiss}
          disabled={isSyncing}
          className="mt-2 w-full min-h-[44px] rounded-xl text-sm font-bold text-text-secondary hover:text-text-primary hover:bg-surface-hover cursor-pointer"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
