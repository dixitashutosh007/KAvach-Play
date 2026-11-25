/**
 * Admin → Club destination (D-18).
 *
 * Club consolidates club-management screens as contextual sections: Player
 * Roster (incl. Invite Player), Studio, Announcements, Pulse, Leaderboard &
 * Stats, Badges and Shop — all Club Admin capabilities (D-19; Reminders and the
 * Activity Log moved to Finance). Admin persona only — the Player persona never
 * renders this component (D-16).
 *
 * The visible sections are computed by `getVisibleClubSections()` from the
 * existing permission model and passed in; each section ALSO keeps its own role
 * guard below, so a stale or tampered section key renders nothing. Firestore
 * rules remain the security boundary.
 */
import { useEffect, useState } from "react";
import { useStore } from "@/hooks/useStore";
import { Users, ShoppingBag, PieChart, Trophy, Award, Video, Megaphone } from "lucide-react";
import { ClubShopPanel, type ShopAdminView } from "@/components/club/ClubShopPanel";
import { AccessDenied } from "@/components/ui/AccessDenied";
import dynamic from "next/dynamic";
import { CLUB_SECTIONS, resolveClubSection, type ClubSection } from "@/lib/admin-navigation";

const PlayersTab = dynamic(() => import("@/components/PlayersTab").then(m => ({ default: m.PlayersTab })), { ssr: false });
const ShopTab = dynamic(() => import("@/components/ShopTab").then(m => ({ default: m.ShopTab })), { ssr: false });
const OpinionTab = dynamic(() => import("@/components/OpinionTab").then(m => ({ default: m.OpinionTab })), { ssr: false });
const LeaderboardTab = dynamic(() => import("@/components/LeaderboardTab").then(m => ({ default: m.LeaderboardTab })), { ssr: false });
const BadgesTab = dynamic(() => import("@/components/BadgesTab").then(m => ({ default: m.BadgesTab })), { ssr: false });
const StudioAdminTab = dynamic(() => import("@/components/StudioAdminTab").then(m => ({ default: m.StudioAdminTab })), { ssr: false });
const ClubStatisticsAdmin = dynamic(() => import("@/components/ClubStatisticsAdmin").then(m => ({ default: m.ClubStatisticsAdmin })), { ssr: false });
const CircuitStandingsAdmin = dynamic(() => import("@/components/club/CircuitStandingsAdmin").then(m => ({ default: m.CircuitStandingsAdmin })), { ssr: false });
const KavachStatsAdmin = dynamic(() => import("@/components/club/KavachStatsAdmin").then(m => ({ default: m.KavachStatsAdmin })), { ssr: false });
const ClubRecognitionAdmin = dynamic(() => import("@/components/club/ClubRecognitionAdmin").then(m => ({ default: m.ClubRecognitionAdmin })), { ssr: false });
const AdminAnnouncementsManager = dynamic(() => import("@/components/home/AdminAnnouncementsManager").then(m => ({ default: m.AdminAnnouncementsManager })), { ssr: false });

const SECTION_ICONS: Record<ClubSection, typeof Users> = {
  players: Users,
  studio: Video,
  announcements: Megaphone,
  pulse: PieChart,
  leaderboard: Trophy,
  badges: Award,
  shop: ShoppingBag,
};

const COMPACT_LABELS: Record<ClubSection, string> = {
  players: "Roster",
  studio: "Studio",
  announcements: "Notices",
  pulse: "Pulse",
  leaderboard: "Stats",
  badges: "Badges",
  shop: "Shop",
};

export function ClubTab({
  store,
  sections,
  isClubAdmin,
  isSuperAdmin,
  isFinanceAdmin,
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
  isClubAdmin: boolean;
  isSuperAdmin: boolean;
  isFinanceAdmin?: boolean;
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
  const [denied, setDenied] = useState<string | null>(initial.denied);

  // Follow new deep links / quick actions while Club is already open.
  useEffect(() => {
    const next = resolveClubSection(defaultSubTab, sections);
    setSubTab(next.section);
    setSubAction(next.subAction);
    setDenied(next.denied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSubTab, sections.join(",")]);

  const visibleTabs = CLUB_SECTIONS.filter((s) => sections.includes(s.key));
  const show = (key: ClubSection) => !denied && subTab === key && sections.includes(key);
  const shopViewFromAction = (a: string | null): ShopAdminView | null =>
    a === "products" || a === "orders" || a === "reports" || a === "store" ? a : null;
  const [shopView, setShopView] = useState<ShopAdminView | null>(shopViewFromAction(initial.subAction));
  const [shopOpenCount, setShopOpenCount] = useState(0);
  useEffect(() => {
    if (subTab === "shop") setShopView(shopViewFromAction(subAction));
  }, [subTab, subAction]);

  return (
    <div className="space-y-4" data-testid="admin-club">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-black font-heading text-text-primary tracking-tight">Club</h1>
      </div>

      <div
        role="tablist"
        aria-label="Club sections"
        className="flex flex-wrap items-center gap-1.5 bg-surface rounded-2xl p-1.5 border border-border shadow-xs"
        data-testid="club-sub-tabs"
      >
        {visibleTabs.map(({ key, label }) => {
          const Icon = SECTION_ICONS[key];
          const isActive = !denied && subTab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={label}
              data-testid={`club-sub-tab-${key}`}
              onClick={() => {
                setSubTab(key);
                setSubAction(null);
                setDenied(null);
              }}
              className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                isActive
                  ? "bg-[#A30F2D] text-white shadow-xs"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="sm:hidden">{COMPACT_LABELS[key]}</span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>

      {denied && <AccessDenied feature={denied} requiredRole="Club Admins" />}
      {show("players") && isClubAdmin && (
        <PlayersTab
          store={store}
          persona="admin"
          isStudioAdmin={true}
          isFinanceAdmin={Boolean(isFinanceAdmin || isSuperAdmin)}
          autoOpenInvite={subAction === "invite"}
        />
      )}
      {show("studio") && (isClubAdmin || isStudioAdmin) && (
        <StudioAdminTab
          store={store}
          adminId={currentUserId}
          adminName={adminName}
          persona="admin"
          isStudioAdmin={isClubAdmin || isStudioAdmin}
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
      {show("pulse") && isClubAdmin && <OpinionTab store={store} persona="admin" />}
      {show("leaderboard") && isClubAdmin && (
        <div className="space-y-6">
          <ClubStatisticsAdmin />
          <CircuitStandingsAdmin />
          <KavachStatsAdmin store={store} />
          <LeaderboardTab store={store} persona="admin" />
        </div>
      )}
      {show("badges") && isClubAdmin && (
        <div className="space-y-6">
          <ClubRecognitionAdmin store={store} />
          <BadgesTab
            store={store}
            isClubAdmin={isClubAdmin}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            defaultView={subAction === "grant" ? "award" : undefined}
          />
        </div>
      )}
      {show("shop") && isClubAdmin && (
        <div className="space-y-4">
          <ClubShopPanel
            store={store}
            active={shopView}
            onOpen={(v) => {
              setShopView(v);
              setShopOpenCount((n) => n + 1);
            }}
          />
          <ShopTab key={`${shopView || "store"}-${shopOpenCount}`} store={store} persona="admin" isAdmin={isClubAdmin} initialView={shopView || undefined} />
        </div>
      )}
    </div>
  );
}
