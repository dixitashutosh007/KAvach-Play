"use client";

import { Users, Video, ShoppingBag, PieChart, Megaphone } from "lucide-react";

/**
 * Home "Club" quick-access row (D-16).
 *
 * The Player persona has only three primary destinations (Home, Profile,
 * Matches). Club features that used to live in the More drawer / Club tab are
 * reached from here instead: each chip opens the feature directly. These are
 * entry points, not another navigation layer. Feature-flagged entries are
 * hidden when the club has switched the feature off.
 */
export type HomeQuickActionTarget = "players" | "studio" | "shop" | "opinion" | "announcements";

interface QuickAction {
  target: HomeQuickActionTarget;
  label: string;
  icon: typeof Users;
  feature?: string;
}

export const HOME_QUICK_ACTIONS: readonly QuickAction[] = [
  { target: "players", label: "Directory", icon: Users },
  { target: "studio", label: "Studio", icon: Video, feature: "studio" },
  { target: "shop", label: "Shop", icon: ShoppingBag, feature: "shop" },
  { target: "opinion", label: "Polls & Pulse", icon: PieChart, feature: "opinion" },
  { target: "announcements", label: "Announcements", icon: Megaphone },
];

export function HomeQuickActions({
  isFeatureEnabled,
  onNavigate,
}: {
  isFeatureEnabled: (key: any) => boolean;
  onNavigate: (target: HomeQuickActionTarget) => void;
}) {
  const actions = HOME_QUICK_ACTIONS.filter((a) => !a.feature || isFeatureEnabled(a.feature));
  if (actions.length === 0) return null;

  return (
    <div
      role="group"
      data-testid="home-quick-actions"
      aria-label="Club quick access"
      className="w-full flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar pt-1"
    >
      {actions.map(({ target, label, icon: Icon }) => (
        <button
          key={target}
          type="button"
          data-testid={`home-quick-${target}`}
          onClick={() => onNavigate(target)}
          className="min-h-[44px] shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface border border-border hover:border-scarlet/30 hover:bg-canvas-warm text-xs font-bold text-text-primary transition shadow-xs cursor-pointer active:scale-98"
        >
          <Icon className="w-4 h-4 text-scarlet" aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
