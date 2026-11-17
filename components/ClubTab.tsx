import { useState } from "react";
import { useStore } from "@/hooks/useStore";
import { Users, ShoppingBag, PieChart, ImageIcon, Trophy, Bell, Award, ScrollText, User, Video } from "lucide-react";
import dynamic from "next/dynamic";

const PlayersTab = dynamic(() => import("@/components/PlayersTab").then(m => ({ default: m.PlayersTab })), { ssr: false });
const ShopTab = dynamic(() => import("@/components/ShopTab").then(m => ({ default: m.ShopTab })), { ssr: false });
const OpinionTab = dynamic(() => import("@/components/OpinionTab").then(m => ({ default: m.OpinionTab })), { ssr: false });
const DesignTab = dynamic(() => import("@/components/DesignTab").then(m => ({ default: m.DesignTab })), { ssr: false });
const LeaderboardTab = dynamic(() => import("@/components/LeaderboardTab").then(m => ({ default: m.LeaderboardTab })), { ssr: false });
const DuesAndRemindersTab = dynamic(() => import("@/components/DuesAndRemindersTab").then(m => ({ default: m.DuesAndRemindersTab })), { ssr: false });
const BadgesTab = dynamic(() => import("@/components/BadgesTab").then(m => ({ default: m.BadgesTab })), { ssr: false });
const AuditLogTab = dynamic(() => import("@/components/AuditLogTab").then(m => ({ default: m.AuditLogTab })), { ssr: false });
const ProfileTab = dynamic(() => import("@/components/ProfileTab").then(m => ({ default: m.ProfileTab })), { ssr: false });
const StudioTab = dynamic(() => import("@/components/StudioTab").then(m => ({ default: m.StudioTab })), { ssr: false });

type ClubSubTab =
  | "profile"
  | "studio"
  | "shop"
  | "pulse"
  | "players"
  | "badges"
  | "design"
  | "leaderboard"
  | "reminders"
  | "activity";

export function ClubTab({
  store,
  persona,
  canDesign,
  isFinanceAdmin,
  isClubAdmin,
  isSuperAdmin,
  currentUserId,
  currentUserName,
  isFeatureEnabled,
  defaultSubTab,
}: {
  store: ReturnType<typeof useStore>;
  persona: "admin" | "player";
  canDesign: boolean;
  isFinanceAdmin: boolean;
  isClubAdmin: boolean;
  isSuperAdmin: boolean;
  currentUserId: string;
  currentUserName: string;
  isFeatureEnabled: (f: any) => boolean;
  defaultSubTab?: ClubSubTab | string | null;
}) {
  const isPlayer = persona === "player";
  const badgesDefaultView = defaultSubTab === "badges_grant" ? "award" : undefined;
  const openInviteModal = defaultSubTab === "invite_player";

  const resolvedDefault = isPlayer
    ? (defaultSubTab as ClubSubTab) || "profile"
    : defaultSubTab === "badges_grant"
      ? "badges"
      : defaultSubTab === "invite_player"
        ? "players"
        : (defaultSubTab as ClubSubTab) || "players";

  const [subTab, setSubTab] = useState<ClubSubTab>(resolvedDefault);

  const playerTabs: { key: ClubSubTab; label: string; icon: any; visible: boolean }[] = [
    { key: "profile", label: "My Card", icon: User, visible: true },
    { key: "studio", label: "Studio & Nets", icon: Video, visible: isFeatureEnabled("studio") },
    { key: "shop", label: "Shop", icon: ShoppingBag, visible: isFeatureEnabled("shop") },
    { key: "pulse", label: "Pulse", icon: PieChart, visible: isFeatureEnabled("opinion") },
    { key: "players", label: "Directory", icon: Users, visible: true },
    { key: "badges", label: "Badges", icon: Award, visible: isFeatureEnabled("badges") },
  ];

  const adminTabs: { key: ClubSubTab; label: string; icon: any; visible: boolean }[] = [
    { key: "players", label: "Players", icon: Users, visible: true },
    { key: "badges", label: "Badges", icon: Award, visible: isFeatureEnabled("badges") },
    { key: "shop", label: "Shop", icon: ShoppingBag, visible: isFeatureEnabled("shop") },
    { key: "pulse", label: "Pulse", icon: PieChart, visible: isFeatureEnabled("opinion") },
    { key: "design", label: "Design", icon: ImageIcon, visible: canDesign },
    { key: "leaderboard", label: "Leaderboard", icon: Trophy, visible: true },
    { key: "reminders", label: "Reminders", icon: Bell, visible: true },
    { key: "activity", label: "Activity", icon: ScrollText, visible: isSuperAdmin },
  ];

  const activeTabs = isPlayer ? playerTabs : adminTabs;
  const visibleTabs = activeTabs.filter((t) => t.visible);

  return (
    <div className="space-y-4">
      <div
        className="flex bg-surface-hover rounded-lg p-1 border border-border overflow-x-auto no-scrollbar"
        data-testid="club-sub-tabs"
      >
        {visibleTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            data-testid={`club-sub-tab-${key}`}
            onClick={() => setSubTab(key)}
            className={`shrink-0 text-[10px] font-bold uppercase py-2 px-3 rounded-md transition flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer ${
              subTab === key
                ? "bg-accent text-text-accent"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {subTab === "profile" && <ProfileTab store={store} />}
      {subTab === "studio" && <StudioTab store={store} />}
      {subTab === "shop" && (
        <ShopTab store={store} persona={persona} isAdmin={!isPlayer} />
      )}
      {subTab === "pulse" && (
        <OpinionTab store={store} persona={persona} />
      )}
      {subTab === "players" && (
        <PlayersTab
          store={store}
          persona={persona}
          isStudioAdmin={!isPlayer}
          autoOpenInvite={openInviteModal && !isPlayer}
        />
      )}
      {subTab === "badges" && (
        <BadgesTab
          store={store}
          isClubAdmin={isClubAdmin && !isPlayer}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          defaultView={badgesDefaultView}
        />
      )}
      {subTab === "design" && canDesign && <DesignTab store={store} />}
      {subTab === "leaderboard" && (
        <LeaderboardTab store={store} persona={persona} />
      )}
      {subTab === "reminders" && (
        <DuesAndRemindersTab store={store} isFinanceAdmin={isFinanceAdmin} />
      )}
      {subTab === "activity" && isSuperAdmin && (
        <AuditLogTab isSuperAdmin={isSuperAdmin} />
      )}
    </div>
  );
}
