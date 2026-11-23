"use client";

import { ShieldAlert } from "lucide-react";

/**
 * Polite access-denied card (D-19). Shown when an admin opens a destination,
 * section or action their role does not include. Presentation only — Firestore
 * rules and server checks remain the security boundary.
 */
export function AccessDenied({
  feature,
  requiredRole,
}: {
  /** What the user tried to open, e.g. "Settings". */
  feature: string;
  /** Who can use it, e.g. "Super Admins". */
  requiredRole: string;
}) {
  return (
    <div
      role="status"
      data-testid="access-denied"
      className="bg-surface rounded-2xl p-8 border border-border text-center space-y-3 max-w-xl mx-auto"
    >
      <div className="mx-auto w-11 h-11 rounded-full bg-brand/10 flex items-center justify-center">
        <ShieldAlert className="w-5 h-5 text-brand" aria-hidden="true" />
      </div>
      <h3 className="text-base font-bold text-text-primary">Access denied</h3>
      <p className="text-sm text-text-secondary">
        Sorry, {feature} is available to {requiredRole} only. If you need access, please ask a Super Admin.
      </p>
    </div>
  );
}

/** Message used when a save is rejected by the server's permission checks. */
export const PERMISSION_DENIED_MESSAGE =
  "Access denied — your role doesn't allow this change. Please ask a Super Admin if you need it.";
