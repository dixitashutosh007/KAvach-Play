"use client";

import { useEffect, useRef } from "react";
import {
  Trophy,
  Video,
  ShoppingBag,
  Image as ImageIcon,
  Settings as SettingsIcon,
  X,
  PieChart,
  Users,
  User as UserIcon,
} from "lucide-react";
import type { AppConfig } from "@/lib/types";

export type Tab =
  | "home"
  | "matches"
  | "grounds"
  | "players"
  | "leaderboard"
  | "profile"
  | "settings"
  | "studio"
  | "notifications"
  | "finance"
  | "dues_and_reminders"
  | "shop"
  | "opinion"
  | "design"
  | "club";

type Feature = keyof NonNullable<AppConfig["features"]>;

const PLAYER_MORE_ITEMS: Array<{
  tab: Tab;
  label: string;
  icon: any;
  feature?: Feature;
  requireDesign?: boolean;
}> = [
  { tab: "leaderboard", label: "Performance & Stats", icon: Trophy, feature: "leaderboard" },
  { tab: "studio", label: "Studio & Nets", icon: Video, feature: "studio" },
  { tab: "shop", label: "Club Merchandise", icon: ShoppingBag, feature: "shop" },
  { tab: "opinion", label: "Polls & Pulse", icon: PieChart, feature: "opinion" },
  { tab: "design", label: "Design Studio", icon: ImageIcon, requireDesign: true },
  { tab: "club", label: "Club Details & Info", icon: Users },
  { tab: "profile", label: "My Profile", icon: UserIcon },
];

const ADMIN_MORE_ITEMS: Array<{
  tab: Tab;
  label: string;
  icon: any;
  feature?: Feature;
  requireDesign?: boolean;
}> = [
  { tab: "settings", label: "Settings & Access", icon: SettingsIcon },
  { tab: "studio", label: "Studio & Nets", icon: Video, feature: "studio" },
  { tab: "design", label: "Design Studio", icon: ImageIcon, requireDesign: true },
  { tab: "shop", label: "Merchandise Shop", icon: ShoppingBag, feature: "shop" },
  { tab: "leaderboard", label: "Leaderboard & Stats", icon: Trophy, feature: "leaderboard" },
];

export function MoreDrawer({
  open,
  onClose,
  onSelectTab,
  activeTab,
  isFeatureEnabled,
  canDesign,
  persona,
}: {
  open: boolean;
  onClose: () => void;
  onSelectTab: (tab: Tab) => void;
  activeTab: Tab;
  isFeatureEnabled: (key: Feature) => boolean;
  canDesign: boolean;
  persona?: "admin" | "player";
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const targetItems = persona === "admin" ? ADMIN_MORE_ITEMS : PLAYER_MORE_ITEMS;
  const visibleItems = targetItems.filter((item) => {
    if (item.feature && !isFeatureEnabled(item.feature)) return false;
    if (item.requireDesign && !canDesign) return false;
    return true;
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={persona === "admin" ? "Admin Tools Navigation" : "More Secondary Navigation"}
      className="fixed inset-0 z-50 md:hidden"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-up Sheet */}
      <div
        ref={sheetRef}
        data-testid="more-drawer-sheet"
        className="absolute bottom-0 left-0 right-0 bg-surface border-t border-border rounded-t-2xl pb-safe shadow-2xl animate-slide-up max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-border/50">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-text-primary">
              {persona === "admin" ? "Admin Console Hubs" : "More Destinations"}
            </h3>
            <p className="text-[11px] text-text-muted mt-0.5">
              {persona === "admin" ? "Administrative settings and operations" : "Secondary club features and resources"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close navigation drawer"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-surface-hover transition text-text-muted hover:text-text-primary cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.tab;
            return (
              <button
                key={item.tab}
                data-testid={`more-item-${item.tab}`}
                onClick={() => {
                  onSelectTab(item.tab);
                  onClose();
                }}
                className={`w-full min-h-[44px] flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition cursor-pointer ${
                  isActive
                    ? "bg-accent text-text-accent shadow-xs"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
