"use client";

/**
 * Player → Profile hub (D-20), opened from the header avatar.
 *
 * Composes EXISTING data and workflows only:
 *  - identity from the player's own player/appUser records;
 *  - personal details edited through the existing ProfileTab form (onEdit);
 *  - badges from the badges collection (own badges);
 *  - Studio membership via lib/studio-membership (same rules as StudioTab),
 *    plans from `subscriptionPlans`; joining/renewing happens on the existing
 *    Studio screen (no parallel purchase flow);
 *  - dues via calculatePlayerDues + PersonalPaymentCard → existing Pay Now;
 *  - payment history via PlayerFinanceView (match + other fees) and the
 *    member's own `subscriptionHistory` (bounded query, R2-C rule);
 *  - Out of Play via the existing OutOfPlayConfig editor + a month view;
 *  - performance: dropped / stunning catches only (no fabricated metrics).
 *
 * Profile photo upload is not offered: Firebase Storage is not configured and
 * the rules cap `photoURL` at 500 characters (documented gap, needs a
 * rules/storage change outside this UI workstream).
 */
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Pencil,
  Settings,
  User,
  Award,
  Dumbbell,
  History,
  CalendarDays,
  TrendingUp,
  ChevronRight,
  LogOut,
  ChevronLeft,
} from "lucide-react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/components/AuthProvider";
import { resolvePlayerForUser, resolveMyPlayers } from "@/lib/player-identity";
import { calculatePlayerDues } from "@/lib/player-dues";
import { getStudioMembership } from "@/lib/studio-membership";
import { dbToInputDate } from "@/lib/utils";
import { PersonalPaymentCard } from "@/components/home/PersonalPaymentCard";
import { PlayerFinanceView } from "@/components/FinanceTab";
import { OutOfPlayConfig, MyBadgesSection } from "@/components/ProfileTab";
import { BadgeIcon, getBadgeMeta } from "@/components/BadgeIcon";
import { buildMonthGrid, isDateBlocked } from "@/lib/out-of-play-calendar";
import type { OutOfPlay, SubscriptionHistory, SubscriptionPlan } from "@/lib/types";

type Chip = "overview" | "payments" | "membership" | "performance";
type Panel = null | "personal" | "badges" | "history" | "calendar" | "performance" | "account";

export function PlayerProfileHub({
  store,
  onEdit,
  onNavigate,
  onBack,
}: {
  store: ReturnType<typeof useStore>;
  onEdit: () => void;
  onNavigate?: (tab: string) => void;
  onBack?: () => void;
}) {
  const { user, logOut } = useAuth();
  const [chip, setChip] = useState<Chip>("overview");
  const [panel, setPanel] = useState<Panel>(null);
  const appUser = store.appUsers.find((u) => u.id === user?.uid);
  const player = resolvePlayerForUser(store.players, user?.uid, appUser);
  const myPlayers = useMemo(() => resolveMyPlayers(store.players, user?.uid, appUser), [store.players, user?.uid, appUser]);
  const dues = useMemo(
    () => calculatePlayerDues(myPlayers, store.payments, store.matches, store.otherFees),
    [myPlayers, store.payments, store.matches, store.otherFees],
  );
  const myBadges = useMemo(() => (player ? store.badges.filter((b) => b.playerId === player.id) : []), [store.badges, player]);

  const name = appUser?.name || player?.name || user?.displayName || "Player";
  const photo = user?.photoURL || appUser?.photoURL || player?.photoURL || "";
  const role = [player?.battingStyle || appUser?.battingStyle, player?.bowlingStyle || appUser?.bowlingStyle].filter(Boolean).join(" · ");
  const clubName = store.appConfig?.clubName || "KAvach CC";
  const show = (c: Exclude<Chip, "overview">) => chip === "overview" || chip === c;

  const chips: { key: Chip; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "payments", label: "Payments" },
    ...(store.appConfig?.features?.studio !== false ? [{ key: "membership" as Chip, label: "Membership" }] : []),
    { key: "performance", label: "Performance" },
  ];

  if (panel) {
    return (
      <div className="flex flex-col gap-3" data-testid={`profile-panel-${panel}`}>
        <button
          type="button"
          onClick={() => setPanel(null)}
          className="self-start min-h-[44px] inline-flex items-center gap-1.5 pl-1 pr-3 rounded-xl text-sm font-bold text-text-secondary hover:text-text-primary hover:bg-surface-hover transition cursor-pointer"
          data-testid="profile-panel-back"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Profile
        </button>
        {panel === "personal" && <PersonalInfo player={player} appUser={appUser} onEdit={onEdit} />}
        {panel === "badges" && player && (
          <MyBadgesSection
            badges={store.badges}
            playerId={player.id}
            badgeTypeDefs={store.badgeTypeDefs}
            player={player}
          />
        )}
        {panel === "history" && <PaymentHistory store={store} playerId={player?.id} uid={user?.uid} />}
        {panel === "calendar" && player && <OutOfPlayPanel store={store} playerId={player.id} />}
        {panel === "performance" && <Performance stunning={player?.stunningCatches} dropped={player?.droppedCatches} />}
        {panel === "account" && (
          <div className="flex flex-col gap-2">
            <a href="/legal" target="_blank" rel="noopener noreferrer" className="min-h-[48px] flex items-center justify-between px-4 rounded-2xl bg-surface border border-border text-sm font-semibold text-text-primary hover:bg-surface-hover">
              Privacy Policy &amp; Terms <ChevronRight className="w-4 h-4 text-text-muted" />
            </a>
            <button type="button" onClick={() => logOut()} className="min-h-[48px] flex items-center gap-2 px-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-sm font-bold text-red-600 hover:bg-red-500/15 cursor-pointer">
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="player-profile-hub">
      <header className="flex items-center gap-2">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back" data-testid="profile-back" className="min-h-[44px] min-w-[44px] rounded-full hover:bg-surface-hover flex items-center justify-center cursor-pointer">
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
        )}
        <h1 className="flex-1 text-center text-xl font-black text-text-primary font-heading">Player Profile</h1>
        <button type="button" onClick={onEdit} aria-label="Edit profile" data-testid="profile-edit" className="min-h-[44px] min-w-[44px] rounded-full hover:bg-surface-hover flex items-center justify-center cursor-pointer">
          <Pencil className="w-5 h-5 text-text-primary" />
        </button>
        <button type="button" onClick={() => setPanel("account")} aria-label="Account settings" data-testid="profile-settings" className="min-h-[44px] min-w-[44px] rounded-full hover:bg-surface-hover flex items-center justify-center cursor-pointer">
          <Settings className="w-5 h-5 text-text-primary" />
        </button>
      </header>

      <section data-testid="profile-identity" className="rounded-2xl bg-gradient-to-br from-[#A30F2D] to-[#6E0A1F] text-white p-4 flex items-center gap-4">
        {photo ? (
          <Image src={photo} alt={name} width={80} height={80} className="w-20 h-20 rounded-full object-cover border-2 border-white/70 shrink-0" referrerPolicy="no-referrer" />
        ) : (
          <span className="w-20 h-20 rounded-full bg-white/15 border-2 border-white/40 flex items-center justify-center shrink-0">
            <User className="w-9 h-9 text-white" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-xl font-black truncate" data-testid="profile-name">{name}</h2>
          {role && <p className="text-sm text-white/85 line-clamp-2">{role}</p>}
          <p className="text-sm text-white/85 truncate">{clubName}</p>
          {player?.kavachId && <p className="text-sm text-white/85 mt-0.5" data-testid="profile-player-id">Player ID: {player.kavachId}</p>}
        </div>
      </section>

      <div role="tablist" aria-label="Profile sections" className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {chips.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={chip === c.key}
            data-testid={`profile-chip-${c.key}`}
            onClick={() => setChip(c.key)}
            className={`shrink-0 min-h-[40px] px-4 rounded-full text-sm font-semibold border transition cursor-pointer ${
              chip === c.key ? "bg-scarlet text-white border-scarlet" : "bg-surface text-text-primary border-border hover:bg-surface-hover"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {chip === "overview" && (
        <Row icon={User} title="Personal Information" subtitle="Playing role, batting/bowling style, joined date" onClick={() => setPanel("personal")} testId="profile-row-personal" />
      )}

      {(chip === "overview" || chip === "performance") && (
        <BadgesPreview badges={myBadges} defs={store.badgeTypeDefs} onViewAll={() => setPanel("badges")} />
      )}

      {show("membership") && store.appConfig?.features?.studio !== false && (
        <StudioMembership store={store} player={player} appUser={appUser} onOpenStudio={() => onNavigate?.("studio")} expanded={chip === "membership"} />
      )}

      {show("payments") && (
        <div data-testid="profile-dues">
          <PersonalPaymentCard duesSummary={dues} onNavigateToPayments={() => onNavigate?.("finance")} />
        </div>
      )}

      {show("payments") && (
        <Row icon={History} title="Past Payments" subtitle="Match Fees • Studio • Membership" onClick={() => setPanel("history")} testId="profile-row-history" />
      )}

      {chip === "overview" && player && (
        <Row
          icon={CalendarDays}
          title="Out of Play Calendar"
          subtitle={`${(store.outOfPlays as OutOfPlay[]).filter((o) => o.playerId === player.id).length} date range(s) blocked`}
          onClick={() => setPanel("calendar")}
          testId="profile-row-calendar"
        />
      )}

      {show("performance") && (
        <Row
          icon={TrendingUp}
          title="My Performance"
          subtitle={`Dropped Catches: ${player?.droppedCatches ?? 0}  |  Stunning Catches: ${player?.stunningCatches ?? 0}`}
          onClick={() => setPanel("performance")}
          testId="profile-row-performance"
        />
      )}
    </div>
  );
}

function Row({ icon: Icon, title, subtitle, onClick, testId }: { icon: typeof User; title: string; subtitle: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="w-full min-h-[64px] flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface border border-border hover:bg-surface-hover transition text-left cursor-pointer"
    >
      <span className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-scarlet" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-text-primary">{title}</span>
        <span className="block text-xs text-text-secondary truncate">{subtitle}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-text-muted shrink-0" aria-hidden="true" />
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="p-4 rounded-2xl bg-surface border border-border text-sm text-text-secondary">{text}</p>;
}

function PersonalInfo({ player, appUser, onEdit }: { player: any; appUser: any; onEdit: () => void }) {
  const v = (k: string) => appUser?.[k] || player?.[k] || "—";
  const rows: [string, string][] = [
    ["Name", v("name")],
    ["Batting style", v("battingStyle")],
    ["Bowling style", v("bowlingStyle")],
    ["Wicket-keeper", player?.isWicketKeeper || appUser?.isWicketKeeper ? "Yes" : "No"],
    ["Jersey", [v("jerseyNumber") !== "—" ? `#${v("jerseyNumber")}` : "", appUser?.jerseyName || player?.jerseyName || ""].filter(Boolean).join(" · ") || "—"],
    ["Joined KAvach", player?.kavachJoining || "—"],
    ["Mobile", v("mobile")],
    ["Email", v("email")],
    ["Area", v("locality")],
  ];
  return (
    <section className="flex flex-col gap-3" data-testid="profile-personal-info">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Personal Information</h2>
        <button type="button" onClick={onEdit} className="min-h-[44px] px-4 rounded-xl bg-scarlet text-white text-sm font-bold hover:bg-deep-wine cursor-pointer" data-testid="profile-personal-edit">
          Edit
        </button>
      </div>
      <dl className="rounded-2xl bg-surface border border-border divide-y divide-border">
        {rows.map(([k, val]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-sm text-text-secondary">{k}</dt>
            <dd className="text-sm font-semibold text-text-primary text-right truncate">{val}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-text-secondary">Jersey number is assigned by the club. Other fields can be edited with the Edit button.</p>
    </section>
  );
}

function BadgesPreview({ badges, defs, onViewAll }: { badges: any[]; defs: any[]; onViewAll: () => void }) {
  const types = useMemo(() => {
    const seen = new Map<string, number>();
    for (const b of badges) seen.set(b.badgeType, (seen.get(b.badgeType) || 0) + 1);
    return [...seen.entries()].slice(0, 4);
  }, [badges]);
  return (
    <section className="p-4 rounded-2xl bg-surface border border-border flex flex-col gap-3" data-testid="profile-badges">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-text-primary">
          <Award className="w-5 h-5 text-scarlet" aria-hidden="true" /> Your Badges ({badges.length})
        </h2>
        <button type="button" onClick={onViewAll} data-testid="profile-badges-all" className="min-h-[44px] px-1 text-sm font-semibold text-scarlet hover:underline cursor-pointer">
          {badges.length > 0 ? "View All" : "Explore Badges"}
        </button>
      </div>
      {types.length === 0 ? (
        <p className="text-sm text-text-secondary">No badges yet — they appear here as you earn them.</p>
      ) : (
        <ul className="grid grid-cols-4 gap-2">
          {types.map(([type, count]) => (
            <li key={type} className="flex flex-col items-center text-center">
              <BadgeIcon badgeType={type} size={48} customDefs={defs} />
              <span className="text-xs text-text-primary mt-1 leading-tight">{getBadgeMeta(type, defs).label}{count > 1 ? ` ×${count}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STATUS_CLASSES: Record<string, string> = {
  Active: "bg-emerald-600 text-white",
  Expired: "bg-rose-500/10 text-rose-600",
  Inactive: "bg-surface-hover text-text-secondary",
  Paused: "bg-amber-500/10 text-amber-700",
};

function StudioMembership({ store, player, appUser, onOpenStudio, expanded }: { store: ReturnType<typeof useStore>; player: any; appUser: any; onOpenStudio: () => void; expanded: boolean }) {
  const m = getStudioMembership(player, appUser);
  const expiry = m.endDateRaw ? (m.endDateRaw.includes("-") ? dbToInputDate(m.endDateRaw) : m.endDateRaw) : null;
  const plans = ((store.subscriptionPlans || []) as SubscriptionPlan[]).filter((p) => p.isActive !== false);
  const currentPlan = plans.find((p) => p.id === (player?.studioPlan || appUser?.studioPlan));
  const isActive = m.status === "Active";
  return (
    <section className="rounded-2xl bg-surface border border-border" data-testid="profile-studio">
      <button type="button" onClick={onOpenStudio} className="w-full min-h-[64px] flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover rounded-2xl cursor-pointer" data-testid="profile-studio-open">
        <span className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
          <Dumbbell className="w-5 h-5 text-scarlet" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-text-primary">Studio Membership</span>
          <span className="block text-xs text-text-secondary truncate" data-testid="profile-studio-detail">
            {isActive
              ? `${currentPlan ? `${currentPlan.name} · ` : ""}${expiry ? `Valid till ${expiry}` : "Active"}`
              : m.status === "Expired"
                ? `Expired${expiry ? ` on ${expiry}` : ""} — renew in Studio`
                : m.status === "Paused"
                  ? "Paused"
                  : "Not a member yet — see plans"}
          </span>
        </span>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_CLASSES[m.status]}`} data-testid="profile-studio-status">{m.status}</span>
        <ChevronRight className="w-4 h-4 text-text-muted shrink-0" aria-hidden="true" />
      </button>
      {(!isActive || expanded) && plans.length > 0 && (
        <div className="px-4 pb-4 flex flex-col gap-2" data-testid="profile-studio-plans">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">{isActive ? "Plans" : "Available plans"}</p>
          {plans.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-hover">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-primary truncate">{p.name}</span>
                <span className="block text-xs text-text-secondary">{p.durationDays} days{p.benefits ? ` · ${p.benefits}` : ""}</span>
              </span>
              <span className="text-sm font-black text-text-primary shrink-0">₹{p.fee}</span>
            </div>
          ))}
          {!isActive && (
            <button type="button" onClick={onOpenStudio} data-testid="profile-studio-join" className="min-h-[44px] rounded-xl bg-scarlet text-white text-sm font-bold hover:bg-deep-wine cursor-pointer">
              View plans &amp; join in Studio
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function PaymentHistory({ store, playerId, uid }: { store: ReturnType<typeof useStore>; playerId?: string; uid?: string }) {
  const [studio, setStudio] = useState<{ rows: SubscriptionHistory[]; loading: boolean; error: boolean }>({ rows: [], loading: true, error: false });
  useEffect(() => {
    let alive = true;
    const ts = typeof window !== "undefined" && process.env.NODE_ENV !== "production" ? (window as any).__KAVACH_TEST_STORE__ : null;
    if (!playerId) {
      setStudio({ rows: [], loading: false, error: false });
      return;
    }
    if (ts) {
      setStudio({ rows: ((ts.subscriptionHistory || []) as SubscriptionHistory[]).filter((h) => h.playerId === playerId), loading: false, error: false });
      return;
    }
    // R2-C: members may read only their own membership history.
    getDocs(query(collection(db, "subscriptionHistory"), where("playerId", "==", playerId)))
      .then((snap) => {
        if (!alive) return;
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as SubscriptionHistory)
          .sort((a, b) => ((b.createdAt as any)?.seconds || 0) - ((a.createdAt as any)?.seconds || 0));
        setStudio({ rows, loading: false, error: false });
      })
      .catch(() => alive && setStudio({ rows: [], loading: false, error: true }));
    return () => {
      alive = false;
    };
  }, [playerId, store.refreshNonce]);

  return (
    <div className="flex flex-col gap-4" data-testid="profile-payment-history">
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-bold text-text-primary">Match fees &amp; club fees</h2>
        <PlayerFinanceView store={store} userId={uid} showOnly="history" />
      </section>
      <section className="flex flex-col gap-2" data-testid="profile-studio-history">
        <h2 className="text-base font-bold text-text-primary">Studio membership payments</h2>
        {studio.loading ? (
          <div className="h-16 rounded-2xl bg-surface-hover animate-pulse" aria-busy="true" />
        ) : studio.error ? (
          <Empty text="Studio payment history couldn't be loaded." />
        ) : studio.rows.length === 0 ? (
          <Empty text="No Studio membership payments yet." />
        ) : (
          <ul className="rounded-2xl bg-surface border border-border divide-y divide-border">
            {studio.rows.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-primary truncate">{h.planName || "Studio membership"}</span>
                  <span className="block text-xs text-text-secondary">
                    {(h.createdAt as any)?.seconds ? new Date((h.createdAt as any).seconds * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    {h.newExpiryDate ? ` · valid till ${dbToInputDate(h.newExpiryDate)}` : ""}
                  </span>
                </span>
                <span className="text-sm font-black text-text-primary shrink-0">₹{h.paidAmount ?? 0}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OutOfPlayPanel({ store, playerId }: { store: ReturnType<typeof useStore>; playerId: string }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const ranges = (store.outOfPlays as OutOfPlay[]).filter((o) => o.playerId === playerId);
  const grid = buildMonthGrid(month.y, month.m);
  const label = new Date(month.y, month.m, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const shift = (n: number) => setMonth(({ y, m }) => {
    const d = new Date(y, m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  return (
    <div className="flex flex-col gap-3">
      <section className="p-4 rounded-2xl bg-surface border border-border" data-testid="out-of-play-calendar">
        <div className="flex items-center justify-between mb-2">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="min-h-[44px] min-w-[44px] rounded-full hover:bg-surface-hover flex items-center justify-center cursor-pointer">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-text-primary">{label}</h2>
          <button type="button" onClick={() => shift(1)} aria-label="Next month" className="min-h-[44px] min-w-[44px] rounded-full hover:bg-surface-hover flex items-center justify-center cursor-pointer">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-text-secondary mb-1">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.map((cell, i) =>
            cell ? (
              <span
                key={i}
                data-blocked={isDateBlocked(cell.iso, ranges) ? "true" : undefined}
                className={`h-9 rounded-lg flex items-center justify-center text-sm ${isDateBlocked(cell.iso, ranges) ? "bg-scarlet text-white font-bold" : "text-text-primary"}`}
              >
                {cell.day}
              </span>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
        <p className="mt-2 text-xs text-text-secondary">Highlighted days are marked unavailable.</p>
      </section>
      <OutOfPlayConfig store={store} playerId={playerId} />
    </div>
  );
}

function Performance({ stunning, dropped }: { stunning?: number; dropped?: number }) {
  const s = stunning ?? 0;
  const d = dropped ?? 0;
  return (
    <section className="flex flex-col gap-3" data-testid="profile-performance">
      <h2 className="text-lg font-bold text-text-primary">My Performance</h2>
      <div className="grid grid-cols-2 gap-2">
        <div className="p-4 rounded-2xl bg-surface border border-border">
          <p className="text-xs text-text-secondary">Stunning Catches</p>
          <p className="text-2xl font-black text-emerald-700" data-testid="profile-stunning">{s}</p>
        </div>
        <div className="p-4 rounded-2xl bg-surface border border-border">
          <p className="text-xs text-text-secondary">Dropped Catches</p>
          <p className="text-2xl font-black text-red-600" data-testid="profile-dropped">{d}</p>
        </div>
      </div>
      {s === 0 && d === 0 && <p className="text-sm text-text-secondary">No catches recorded for you yet.</p>}
      <p className="text-xs text-text-secondary">The club records catches only; other personal statistics aren&apos;t tracked yet.</p>
    </section>
  );
}
