import { useState } from "react";
import { useStore } from "@/hooks/useStore";
import { Users, ShoppingBag, PieChart, ImageIcon, Trophy, Bell, Award } from "lucide-react";
import dynamic from "next/dynamic";

const PlayersTab = dynamic(() => import("@/components/PlayersTab").then(m => ({ default: m.PlayersTab })), { ssr: false });
const ShopTab = dynamic(() => import("@/components/ShopTab").then(m => ({ default: m.ShopTab })), { ssr: false });
const OpinionTab = dynamic(() => import("@/components/OpinionTab").then(m => ({ default: m.OpinionTab })), { ssr: false });
const DesignTab = dynamic(() => import("@/components/DesignTab").then(m => ({ default: m.DesignTab })), { ssr: false });
const LeaderboardTab = dynamic(() => import("@/components/LeaderboardTab").then(m => ({ default: m.LeaderboardTab })), { ssr: false });
const DuesAndRemindersTab = dynamic(() => import("@/components/DuesAndRemindersTab").then(m => ({ default: m.DuesAndRemindersTab })), { ssr: false });
const BadgesTab = dynamic(() => import("@/components/BadgesTab").then(m => ({ default: m.BadgesTab })), { ssr: false });

type ClubSubTab = "players" | "shop" | "pulse" | "design" | "leaderboard" | "reminders" | "badges";

export function ClubTab({
  store,
  persona,
  canDesign,
  isFinanceAdmin,
  isClubAdmin,
  currentUserId,
  currentUserName,
  isFeatureEnabled,
  defaultSubTab,
}: {
  store: ReturnType<typeof useStore>;
  persona: string;
  canDesign: boolean;
  isFinanceAdmin: boolean;
  isClubAdmin: boolean;
  currentUserId: string;
  currentUserName: string;
  isFeatureEnabled: (f: string) => boolean;
  defaultSubTab?: ClubSubTab | null;
}) {
  const [subTab, setSubTab] = useState<ClubSubTab>(defaultSubTab || "players");

  const tabs: { key: ClubSubTab; label: string; icon: any; visible: boolean }[] = [
    { key: "players", label: "Players", icon: Users, visible: true },
    { key: "badges", label: "Badges", icon: Award, visible: isFeatureEnabled("badges") },
    { key: "shop", label: "Shop", icon: ShoppingBag, visible: isFeatureEnabled("shop") },
    { key: "pulse", label: "Pulse", icon: PieChart, visible: isFeatureEnabled("opinion") },
    { key: "design", label: "Design", icon: ImageIcon, visible: canDesign },
    { key: "leaderboard", label: "Board", icon: Trophy, visible: true },
    { key: "reminders", label: "Reminders", icon: Bell, visible: true },
  ];

  const visibleTabs = tabs.filter(t => t.visible);

  return (
    <div className="space-y-4">
      <div className="flex bg-black/40 rounded-lg p-1 border border-glass-border overflow-x-auto no-scrollbar" data-testid="club-sub-tabs">
        {visibleTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            data-testid={`club-sub-tab-${key}`}
            onClick={() => setSubTab(key)}
            className={`flex-1 min-w-0 text-[10px] font-bold uppercase py-2 px-1 rounded-md transition flex items-center justify-center gap-1 whitespace-nowrap ${
              subTab === key ? "bg-accent text-black" : "text-white/50 hover:text-white"
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.slice(0, 4)}</span>
          </button>
        ))}
      </div>

      {subTab === "players" && (
        <PlayersTab store={store} persona={persona} isStudioAdmin={true} />
      )}
      {subTab === "badges" && (
        <BadgesTab
          store={store}
          isClubAdmin={isClubAdmin}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
        />
      )}
      {subTab === "shop" && (
        <ShopTab store={store} persona={persona} isAdmin={true} />
      )}
      {subTab === "pulse" && (
        <OpinionTab store={store} persona={persona} />
      )}
      {subTab === "design" && canDesign && (
        <DesignTab store={store} />
      )}
      {subTab === "leaderboard" && (
        <LeaderboardTab store={store} persona={persona} />
      )}
      {subTab === "reminders" && (
        <DuesAndRemindersTab store={store} isFinanceAdmin={isFinanceAdmin} />
      )}
    </div>
  );
}
