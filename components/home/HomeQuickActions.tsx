"use client";

import { ShoppingBag } from "lucide-react";

/**
 * Home contextual shortcuts.
 *
 * Fixtures, My Finance, Studio and Leaderboard shortcuts were removed: the bottom
 * navigation (mobile) and header navigation (desktop) already provide them, and
 * the payment card on Home carries the "Pay" action. Only shortcuts that are not
 * otherwise one tap away remain. Renders nothing when no shortcut applies.
 */
export function HomeQuickActions({
  isFeatureEnabled,
  onNavigate,
}: {
  hasDues?: boolean;
  isFeatureEnabled: (key: any) => boolean;
  onNavigate: (tab: string) => void;
}) {
  if (!isFeatureEnabled("shop")) return null;

  return (
    <div
      data-testid="home-quick-actions"
      aria-label="Quick Club Actions"
      className="w-full flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar pt-1"
    >
      <button
        type="button"
        onClick={() => onNavigate("shop")}
        className="min-h-[44px] shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface border border-border hover:border-scarlet/30 hover:bg-canvas-warm text-xs font-bold text-text-primary transition shadow-xs cursor-pointer active:scale-98"
      >
        <ShoppingBag className="w-4 h-4 text-muted-gold" aria-hidden="true" />
        <span>Club Shop</span>
      </button>
    </div>
  );
}
