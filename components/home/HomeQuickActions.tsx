"use client";

import { Users, Dumbbell, ShoppingBag, BarChart3, Zap } from "lucide-react";

/**
 * Home "Quick Access" grid (D-20): Directory, Studio, Shop, Polls & Pulse.
 *
 * These are entry points, not another navigation layer — each tile opens the
 * feature directly and the feature screen offers a back link. Feature-flagged
 * entries are hidden when the club has switched the feature off. Announcements
 * moved to the Club tab.
 */
export type HomeQuickActionTarget = "players" | "studio" | "shop" | "opinion";

interface QuickAction {
  target: HomeQuickActionTarget;
  label: string;
  icon: typeof Users;
  feature?: string;
}

export const HOME_QUICK_ACTIONS: readonly QuickAction[] = [
  { target: "players", label: "Directory", icon: Users },
  { target: "studio", label: "Studio", icon: Dumbbell, feature: "studio" },
  { target: "shop", label: "Shop", icon: ShoppingBag, feature: "shop" },
  { target: "opinion", label: "Polls & Pulse", icon: BarChart3, feature: "opinion" },
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
    <section aria-labelledby="home-quick-access-title" className="flex flex-col gap-2">
      <h2 id="home-quick-access-title" className="flex items-center gap-2 text-base font-bold text-text-primary">
        <Zap className="w-5 h-5 text-scarlet" aria-hidden="true" />
        Quick Access
      </h2>
      <div role="group" data-testid="home-quick-actions" aria-label="Club quick access" className="grid grid-cols-4 gap-2">
        {actions.map(({ target, label, icon: Icon }) => (
          <button
            key={target}
            type="button"
            data-testid={`home-quick-${target}`}
            onClick={() => onNavigate(target)}
            className="min-h-[76px] flex flex-col items-center justify-center gap-1.5 px-1 py-2 rounded-2xl bg-surface border border-border hover:border-scarlet/30 hover:bg-surface-hover text-xs font-bold text-text-primary transition shadow-xs cursor-pointer text-center leading-tight"
          >
            <Icon className="w-6 h-6 text-scarlet" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
