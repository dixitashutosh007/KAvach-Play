"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Visible notice shown when the realtime matches subscription fails.
 * Prevents a permission or database failure from looking like "no matches".
 */
export function MatchesLoadError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      data-testid="matches-load-error"
      className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-xs font-medium text-amber-900"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <span>{message}</span>
    </div>
  );
}
