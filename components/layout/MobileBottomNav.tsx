"use client";

import { useState } from "react";
import {
  Home as HomeIcon,
  Wallet,
  CreditCard,
  Users,
  MoreHorizontal,
} from "lucide-react";
import type { AppConfig } from "@/lib/types";
import { MoreDrawer } from "./MoreDrawer";

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

export function MobileBottomNav({
  activeTab,
  onSelectTab,
  isFeatureEnabled,
  persona,
  hasMissingMandatory,
  canDesign,
  currentPlayerId,
}: {
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  isFeatureEnabled: (key: Feature) => boolean;
  persona: "admin" | "player";
  hasMissingMandatory: boolean;
  canDesign?: boolean;
  currentPlayerId?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  if (hasMissingMandatory || persona !== "player") return null;

  const OVERFLOW_TABS: Tab[] = ["matches", "leaderboard", "studio", "shop", "design"];
  const isMoreActive = OVERFLOW_TABS.includes(activeTab);

  const btnCls = (isActive: boolean) =>
    `flex-1 py-2.5 flex flex-col items-center gap-1 cursor-pointer transition ${
      isActive
        ? "text-accent font-extrabold scale-105"
        : "text-white/40 hover:text-white/80"
    }`;
  const labelCls = "text-[9px] font-bold uppercase tracking-wider";

  return (
    <>
      <MoreDrawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onSelectTab={onSelectTab}
        activeTab={activeTab}
        isFeatureEnabled={isFeatureEnabled}
        canDesign={canDesign ?? false}
      />
      <nav className="fixed bottom-0 left-0 right-0 w-full glass !border-b-0 !border-x-0 !rounded-none md:hidden pb-safe z-30 flex items-center shadow-2xl justify-around bg-black/85 backdrop-blur-2xl px-1">
        <button onClick={() => onSelectTab("home")} className={btnCls(activeTab === "home")}>
          <HomeIcon className="w-5 h-5" />
          <span className={labelCls}>Home</span>
        </button>
        <button onClick={() => onSelectTab("finance")} className={btnCls(activeTab === "finance")}>
          <Wallet className="w-5 h-5" />
          <span className={labelCls}>Finance</span>
        </button>
        {currentPlayerId ? (
          <a
            href={`/pay/${currentPlayerId}`}
            className="flex-1 py-2.5 flex flex-col items-center gap-1 cursor-pointer text-accent hover:text-accent/80 transition"
          >
            <span className="w-10 h-10 rounded-full bg-accent flex items-center justify-center shadow-lg shadow-accent/30 -mt-4">
              <CreditCard className="w-5 h-5 text-black" />
            </span>
            <span className={`${labelCls} text-accent`}>Pay</span>
          </a>
        ) : (
          <button onClick={() => onSelectTab("finance")} className={btnCls(false)}>
            <CreditCard className="w-5 h-5" />
            <span className={labelCls}>Pay</span>
          </button>
        )}
        <button onClick={() => onSelectTab("profile")} className={btnCls(activeTab === "profile")}>
          <Users className="w-5 h-5" />
          <span className={labelCls}>Profile</span>
        </button>
        <button onClick={() => setMoreOpen(true)} className={btnCls(isMoreActive)}>
          <MoreHorizontal className="w-5 h-5" />
          <span className={labelCls}>More</span>
        </button>
      </nav>
    </>
  );
}
