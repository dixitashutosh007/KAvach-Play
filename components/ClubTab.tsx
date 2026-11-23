/**
 * Admin → Club destination (D-18).
 *
 * Club consolidates club-management screens as contextual sections: Player
 * Roster (incl. Invite Player), Studio, Announcements, Pulse, Leaderboard &
 * Stats, Badges, Shop, Reminders and Activity Log. Admin persona only — the
 * Player persona never renders this component (D-16).
 *
 * The visible sections are computed by `getVisibleClubSections()` from the
 * existing permission model and passed in; each section ALSO keeps its own role
 * guard below, so a stale or tampered section key renders nothing. Firestore
 * rules remain the security boundary.
 */
import { useEffect, useState } from "react";
import { useStore } from "@/hooks/useStore";
import { Users, ShoppingBag, PieChart, Trophy, Bell, Award, ScrollText, Video, Megaphone } from "lucide-react";
import dynamic from "next/dynamic";
import { CLUB_SECTIONS, resolveClubSection, type ClubSection } from "@/lib/admin-navigation";

const PlayersTab = dynamic(() => import("@/components/PlayersTab").then(m => ({ default: m.PlayersTab })), { ssr: false });
const ShopTab = dynamic(() => import("@/components/ShopTab").then(m => ({ default: m.ShopTab })), { ssr: false });
const OpinionTab = dynamic(() => import("@/components/OpinionTab").then(m => ({ default: m.OpinionTab })), { ssr: false });
const LeaderboardTab = dynamic(() => import("@/components/LeaderboardTab").then(m => ({ default: m.LeaderboardTab })), { ssr: false });
const DuesAndRemindersTab = dynamic(() => import("@/components/DuesAndRemindersTab").then(m => ({ default: m.DuesAndRemindersTab })), { ssr: false });
const BadgesTab = dynamic(() => import("@/components/BadgesTab").then(m => ({ default: m.BadgesTab })), { ssr: false });
const AuditLogTab = dynamic(() => import("@/components/AuditLogTab").then(m => ({ default: m.AuditLogTab })), { ssr: false });
const StudioAdminTab = dynamic(() => import("@/components/StudioAdminTab").then(m => ({ default: m.StudioAdminTab })), { ssr: false });
const ClubStatisticsAdmin = dynamic(() => import("@/components/ClubStatisticsAdmin").then(m => ({ default: m.ClubStatisticsAdmin })), { ssr: false });
const AdminAnnouncementsManager = dynamic(() => import("@/components/home/AdminAnnouncementsManager").then(m => ({ default: m.AdminAnnouncementsManager })), { ssr: false });

const SECTION_ICONS: Record<ClubSection, typeof Users> = {
  players: Users,
  studio: Video,
  announcements: Megaphone,
  pulse: PieChart,
  leaderboard: Trophy,
  badges: Award,
  shop: ShoppingBag,
  reminders: Bell,
  activity: ScrollText,
};

export function ClubTab({
  store,
  sections,
  isFinanceAdmin,
  isClubAdmin,
  isSuperAdmin,
  isStudioAdmin,
  currentUserId,
  currentUserName,
  adminName,
  isFeatureEnabled,
  defaultSubTab,
}: {
  store: ReturnType<typeof useStore>;
  /** Sections this user may see (from getVisibleClubSections). */
  sections: ClubSection[];
  isFinanceAdmin: boolean;
  isClubAdmin: boolean;
  isSuperAdmin: boolean;
  isStudioAdmin: boolean;
  currentUserId: string;
  currentUserName: string;
  /** Account name recorded by Studio admin actions (unchanged from the former Studio hub). */
  adminName: string;
  isFeatureEnabled: (f: any) => boolean;
  /** Section action: "section", "section:subAction", or a dashboard shortcut (badges_grant, invite_player). */
  defaultSubTab?: string | null;
}) {
  const initial = resolveClubSection(defaultSubTab, sections);
  const [subTab, setSubTab] = useState<ClubSection | null>(initial.section);
  const [subAction, setSubAction] = useState<string | null>(initial.subAction);

  // Follow new deep links / quick actions while Club is already open.
  useEffect(() => {
    const next = resolveClubSection(defaultSubTab, sections);
    setSubTab(next.section);
    setSubAction(next.subAction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSubTab, sections.join(",")]);

  const visibleTabs = CLUB_SECTIONS.filter((s) => sections.includes(s.key));
  const show = (key: ClubSection) => subTab === key && sections.includes(key);

  return (
    <div className="space-y-4" data-testid="admin-club">
      <div
        role="tablist"
        aria-label="Club sections"
        className="flex bg-surface-hover rounded-lg p-1 border border-border overflow-x-auto no-scrollbar"
        data-testid="club-sub-tabs"
      >
        {visibleTabs.map(({ key, label }) => {
          const Icon = SECTION_ICONS[key];
          return (
            <button
              key={key}
              role="tab"
              aria-selected={subTab === key}
              data-testid={`club-sub-tab-${key}`}
              onClick={() => {
                setSubTab(key);
                setSubAction(null);
              }}
              className={`shrink-0 min-h-[40px] text-[10px] font-bold uppercase py-2 px-3 rounded-md transition flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer ${
                subTab === key
                  ? "bg-accent text-text-accent"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          );
        })}
      </div>

      {show("players") && isClubAdmin && (
        <PlayersTab
          store={store}
          persona="admin"
          isStudioAdmin={true}
          autoOpenInvite={subAction === "invite"}
        />
      )}
      {show("studio") && isStudioAdmin && (
        <StudioAdminTab
          store={store}
          adminId={currentUserId}
          adminName={adminName}
          persona="admin"
          isStudioAdmin={isStudioAdmin}
          isSuperAdmin={isSuperAdmin}
          defaultAction={subAction}
          isFeatureEnabled={isFeatureEnabled}
        />
      )}
      {show("announcements") && isClubAdmin && (
        <AdminAnnouncementsManager
          store={store}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
        />
      )}
      {show("pulse") && <OpinionTab store={store} persona="admin" />}
      {show("leaderboard") && (
        <div className="space-y-6">
          {isClubAdmin && <ClubStatisticsAdmin />}
          <LeaderboardTab store={store} persona="admin" />
        </div>
      )}
      {show("badges") && isClubAdmin && (
        <BadgesTab
          store={store}
          isClubAdmin={isClubAdmin}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          defaultView={subAction === "grant" ? "award" : undefined}
        />
      )}
      {show("shop") && isClubAdmin && <ShopTab store={store} persona="admin" isAdmin={isClubAdmin} />}
      {show("reminders") && isClubAdmin && (
        <DuesAndRemindersTab store={store} isFinanceAdmin={isFinanceAdmin} />
      )}
      {show("activity") && isSuperAdmin && <AuditLogTab isSuperAdmin={isSuperAdmin} />}
    </div>
  );
}
