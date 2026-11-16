"use client";

import { useEffect, useRef } from "react";
import {
  CalendarDays,
  Trophy,
  Video,
  ShoppingBag,
  Image as ImageIcon,
  X,
} from "lucide-react";
import type { AppConfig } from "@/lib/types";

type Tab =
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

const MORE_ITEMS: Array<{
  tab: Tab;
  label: string;
  icon: typeof CalendarDays;
  feature?: Feature;
  requireDesign?: boolean;
}> = [
  { tab: "matches", label: "Matches", icon: CalendarDays, feature: "matches" },
  { tab: "leaderboard", label: "Leaderboard", icon: Trophy, feature: "leaderboard" },
  { tab: "studio", label: "Studio", icon: Video, feature: "studio" },
  { tab: "shop", label: "Shop", icon: ShoppingBag, feature: "shop" },
  { tab: "design", label: "Design", icon: ImageIcon, requireDesign: true },
];

export function MoreDrawer({
  open,
  onClose,
  onSelectTab,
  activeTab,
  isFeatureEnabled,
  canDesign,
}: {
  open: boolean;
  onClose: () => void;
  onSelectTab: (tab: Tab) => void;
  activeTab: Tab;
  isFeatureEnabled: (key: Feature) => boolean;
  canDesign: boolean;
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

  const visibleItems = MORE_ITEMS.filter((item) => {
    if (item.feature && !isFeatureEnabled(item.feature)) return false;
    if (item.requireDesign && !canDesign) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className="absolute bottom-0 left-0 right-0 bg-[#0a0a0a] border-t border-glass-border rounded-t-2xl pb-safe animate-slide-up"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/60">
            More
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition text-white/40 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 pb-4 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.tab;
            return (
              <button
                key={item.tab}
                onClick={() => {
                  onSelectTab(item.tab);
                  onClose();
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold tracking-wide transition cursor-pointer ${
                  isActive
                    ? "bg-accent text-black"
                    : "text-white/70 hover:bg-white/5"
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
