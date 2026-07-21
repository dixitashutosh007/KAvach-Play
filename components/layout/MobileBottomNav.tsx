"use client";

import {
  Home as HomeIcon,
  Trophy,
  CalendarDays,
  Users,
  Video,
  ShoppingBag,
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
  | "opinion";

type Feature = keyof NonNullable<AppConfig["features"]>;

/**
 * Bottom navigation for players on mobile. Only rendered when the player
 * is fully onboarded (hasMissingMandatory is false) and in the "player"
 * persona; admins get the desktop sidebar. Each button is gated by the
 * relevant feature flag.
 */
export function MobileBottomNav({
  activeTab,
  onSelectTab,
  isFeatureEnabled,
  persona,
  hasMissingMandatory,
}: {
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  isFeatureEnabled: (key: Feature) => boolean;
  persona: "admin" | "player";
  hasMissingMandatory: boolean;
}) {
  if (hasMissingMandatory || persona !== "player") return null;

  const btnCls = (isActive: boolean) =>
    `flex-1 py-2.5 flex flex-col items-center gap-1 cursor-pointer transition ${
      isActive
        ? "text-accent font-extrabold scale-105"
        : "text-white/40 hover:text-white/80"
    }`;
  const labelCls = "text-[9px] font-bold uppercase tracking-wider";

  return (
    <nav className="fixed bottom-0 left-0 right-0 w-full glass !border-b-0 !border-x-0 !rounded-none md:hidden pb-safe z-30 flex items-center shadow-2xl justify-around bg-black/85 backdrop-blur-2xl px-1">
      {isFeatureEnabled("feed") && (
        <button onClick={() => onSelectTab("home")} className={btnCls(activeTab === "home")}>
          <HomeIcon className="w-5 h-5" />
          <span className={labelCls}>Feed</span>
        </button>
      )}
      {isFeatureEnabled("matches") && (
        <button onClick={() => onSelectTab("matches")} className={btnCls(activeTab === "matches")}>
          <CalendarDays className="w-5 h-5" />
          <span className={`${labelCls} text-center leading-tight`}>Matches</span>
        </button>
      )}
      {isFeatureEnabled("leaderboard") && (
        <button onClick={() => onSelectTab("leaderboard")} className={btnCls(activeTab === "leaderboard")}>
          <Trophy className="w-5 h-5" />
          <span className={labelCls}>Stats</span>
        </button>
      )}
      {isFeatureEnabled("studio") && (
        <button onClick={() => onSelectTab("studio")} className={btnCls(activeTab === "studio")}>
          <Video className="w-5 h-5" />
          <span className={labelCls}>Studio</span>
        </button>
      )}
      {isFeatureEnabled("shop") && (
        <button onClick={() => onSelectTab("shop")} className={btnCls(activeTab === "shop")}>
          <ShoppingBag className="w-5 h-5" />
          <span className={labelCls}>Shop</span>
        </button>
      )}
      <button onClick={() => onSelectTab("profile")} className={btnCls(activeTab === "profile")}>
        <Users className="w-5 h-5" />
        <span className={labelCls}>Profile</span>
      </button>
    </nav>
  );
}
