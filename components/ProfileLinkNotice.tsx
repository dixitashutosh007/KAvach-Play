"use client";

/**
 * Shown in the player experience when the signed-in account does not resolve to
 * a player record (`components/ProfileLinkNotice.tsx`).
 *
 * Ordinary players are routed through registration / phone sync before they
 * reach the app, but administrators bypass that gate, so an admin whose login
 * is not linked to their player record previously had no way to link and saw
 * "Please complete or link your player profile" on every availability tap.
 *
 * This notice never links automatically. "Link" calls the existing server
 * endpoint, which verifies the phone number inside the Firebase ID token.
 */
import { Link2, Loader2, UserX } from "lucide-react";

export type ProfileLinkCandidate = { id: string; name: string } | null;

export function ProfileLinkNotice({
  signedInWithPhone,
  candidate,
  isLinking,
  onLink,
}: {
  signedInWithPhone: boolean;
  /** Player record whose mobile matches the VERIFIED login phone number. */
  candidate: ProfileLinkCandidate;
  isLinking: boolean;
  onLink: () => void;
}) {
  let body: React.ReactNode;
  if (signedInWithPhone && candidate) {
    body = (
      <>
        <p>
          We found the player record <strong className="text-text-primary">{candidate.name}</strong> with the same
          mobile number as this login. Link it to mark availability and see your fees.
        </p>
        <button
          type="button"
          data-testid="profile-link-button"
          onClick={onLink}
          disabled={isLinking}
          className="mt-2 inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-scarlet text-white text-xs font-bold hover:bg-deep-wine disabled:opacity-70 cursor-pointer"
        >
          {isLinking ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Link2 className="w-4 h-4" aria-hidden="true" />}
          Link my player record
        </button>
      </>
    );
  } else if (!signedInWithPhone) {
    body = (
      <p>
        Player records are linked using a verified mobile number, and this login uses email. Sign out and sign in with
        the mobile number on your player record (OTP), or ask a Club Admin to check your player record.
      </p>
    );
  } else {
    body = (
      <p>
        No player record has the mobile number used for this login. Ask a Club Admin to check the mobile number on your
        player record.
      </p>
    );
  }

  return (
    <div
      role="status"
      data-testid="profile-link-notice"
      className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-text-secondary"
    >
      <UserX className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-bold text-sm text-text-primary">This login isn&apos;t linked to a player record</p>
        <div className="mt-0.5 leading-relaxed">{body}</div>
      </div>
    </div>
  );
}
