"use client";

import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/components/AuthProvider";
import { useMemo, useRef, useState } from "react";
import { createCatchBatchState, executeCatchBatch, type CatchBatchState } from "@/lib/catch-batch";
import { Match, Player } from "@/lib/types";
import {
  IndianRupee,
  Bell,
  Plus,
  Users,
  CalendarDays,
  Search,
  PlusCircle,
  ArrowRight,
  PieChart,
  MessageSquare,
  X,
  UserX,
  Send,
  Award,
  Target,
  Minus,
  UserPlus,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Edit3,
  Megaphone,
} from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { format, isPast, parseISO } from "date-fns";
import { formatDate, normalizeIndianMobile } from "@/lib/utils";
import {
  IndependenceDayBanner,
  isIndependenceDayWindow,
} from "./festive/IndependenceDay";
import { computeMatchAvailabilityReadiness } from "@/lib/match-readiness";
import {
  filterDismissedExpiredStudioAlerts,
  getStudioAlertExpiryKey,
} from "@/lib/studio-membership";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type FinanceSnapshotTab = "dues" | "txns" | "compliance";
type MatchPickerMode = "squad" | "edit" | null;

export function AdminDashboard({
  store,
  setActiveTab,
  isSuperAdmin = false,
  isFinanceAdmin = false,
  isClubAdmin = false,
  weekendPending = 0,
}: {
  store: ReturnType<typeof useStore>;
  setActiveTab: (tab: any, action?: string) => void;
  isSuperAdmin?: boolean;
  isFinanceAdmin?: boolean;
  isClubAdmin?: boolean;
  weekendPending?: number;
}) {
  const { toast } = useToast();
  const { confirm: confirmAction } = useConfirm();
  const { user } = useAuth();
  const { matches, payments, players, otherFees, grounds, appUsers } = store;

  const canSeeClub = isSuperAdmin || isClubAdmin;
  const canSeeFinance = isSuperAdmin || isFinanceAdmin;

  const [showCatchModal, setShowCatchModal] = useState(false);
  const [matchPickerMode, setMatchPickerMode] = useState<MatchPickerMode>(null);
  const [financeTab, setFinanceTab] = useState<FinanceSnapshotTab>("dues");
  const [remindingStudioId, setRemindingStudioId] = useState<string | null>(null);
  const [dismissingStudioId, setDismissingStudioId] = useState<string | null>(null);
  const [removingStudioId, setRemovingStudioId] = useState<string | null>(null);
  const [optimisticDismissedAlerts, setOptimisticDismissedAlerts] = useState<Record<string, string>>({});

  const currentAdminUser = useMemo(
    () => (user?.uid ? appUsers.find((u) => u.id === user.uid) : undefined),
    [appUsers, user?.uid],
  );
  const dismissedExpiredAlerts = useMemo(
    () => ({
      ...(currentAdminUser?.dismissedExpiredStudioAlerts || {}),
      ...optimisticDismissedAlerts,
    }),
    [currentAdminUser?.dismissedExpiredStudioAlerts, optimisticDismissedAlerts],
  );

  // Financial summaries (Finance / Super Admin only)
  const { totalDueAmount, duePlayersCount, topDuePlayers } = useMemo(() => {
    if (!canSeeFinance) {
      return { totalDueAmount: 0, duePlayersCount: 0, topDuePlayers: [] };
    }
    let matchDue = 0;
    let feeDue = 0;
    const dueByPlayer = new Map<string, number>();

    payments.forEach((p) => {
      if (p.status === "Unpaid") {
        const match = matches.find((m) => m.id === p.matchId);
        if (match && match.result !== "Abandoned" && match.fee) {
          const amt = p.feeOverride !== undefined ? p.feeOverride : match.fee;
          matchDue += amt;
          dueByPlayer.set(p.playerId, (dueByPlayer.get(p.playerId) || 0) + amt);
        }
      }
    });

    otherFees.forEach((f) => {
      if (f.status === "Unpaid") {
        feeDue += f.amount;
        dueByPlayer.set(f.playerId, (dueByPlayer.get(f.playerId) || 0) + f.amount);
      }
    });

    const sorted = [...dueByPlayer.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pid, amount]) => ({
        player: players.find((p) => p.id === pid),
        amount,
      }))
      .filter((d) => d.player);

    return {
      totalDueAmount: matchDue + feeDue,
      duePlayersCount: dueByPlayer.size,
      topDuePlayers: sorted,
    };
  }, [canSeeFinance, matches, payments, players, otherFees]);

  const { recentTransactions, collected30d } = useMemo(() => {
    if (!canSeeFinance) return { recentTransactions: [], collected30d: 0 };
    const txns: {
      id: string;
      playerName: string;
      amount: number;
      type: string;
      date: number;
      method?: string;
    }[] = [];
    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    let recentSum = 0;

    payments.forEach((p) => {
      if (p.status === "Paid" && p.updatedAt) {
        const match = matches.find((m) => m.id === p.matchId);
        const player = players.find((pl) => pl.id === p.playerId);
        if (match && player) {
          const ts =
            typeof p.updatedAt === "object" && "seconds" in p.updatedAt
              ? p.updatedAt.seconds * 1000
              : new Date(p.updatedAt as any).getTime();
          const amt = p.feeOverride !== undefined ? p.feeOverride : match.fee || 0;
          if (ts >= thirtyDaysAgo) recentSum += amt;
          txns.push({
            id: p.id,
            playerName: player.name,
            amount: amt,
            type: "Match Fee",
            date: ts,
            method: p.paymentMethod,
          });
        }
      }
    });

    otherFees.forEach((f) => {
      if (f.status === "Paid" && f.updatedAt) {
        const player = players.find((pl) => pl.id === f.playerId);
        if (player) {
          const ts =
            typeof f.updatedAt === "object" && "seconds" in f.updatedAt
              ? f.updatedAt.seconds * 1000
              : new Date(f.updatedAt as any).getTime();
          if (ts >= thirtyDaysAgo) recentSum += f.amount;
          txns.push({
            id: f.id,
            playerName: player.name,
            amount: f.amount,
            type: f.title || "Other Fee",
            date: ts,
          });
        }
      }
    });

    return {
      recentTransactions: txns.sort((a, b) => b.date - a.date).slice(0, 6),
      collected30d: recentSum,
    };
  }, [canSeeFinance, matches, payments, players, otherFees]);

  const matchCompliance = useMemo(() => {
    if (!canSeeFinance) {
      return { overall: 0, totalPaid: 0, totalCompliant: 0, perMatch: [] };
    }
    const now = new Date();
    const recentPastMatches = matches
      .filter((m) => {
        const matchDate = new Date(m.date);
        return matchDate < now && m.result !== "Abandoned";
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);

    let totalPaid = 0;
    let totalCompliant = 0;

    const perMatch = recentPastMatches.map((m) => {
      const matchPayments = payments.filter((p) => p.matchId === m.id && p.status === "Paid");
      const matchDate = new Date(m.date);
      const fourDaysLater = new Date(matchDate);
      fourDaysLater.setDate(fourDaysLater.getDate() + 4);
      fourDaysLater.setHours(23, 59, 59, 999);

      let compliant = 0;
      const total = matchPayments.length;

      matchPayments.forEach((p) => {
        if (p.updatedAt) {
          const paidDate =
            typeof p.updatedAt === "object" && "seconds" in p.updatedAt
              ? new Date(p.updatedAt.seconds * 1000)
              : new Date(p.updatedAt as any);
          if (paidDate <= fourDaysLater) compliant++;
        }
      });

      totalPaid += total;
      totalCompliant += compliant;

      return {
        match: m,
        compliant,
        total,
        rate: total > 0 ? Math.round((compliant / total) * 100) : 0,
      };
    });

    return {
      overall: totalPaid > 0 ? Math.round((totalCompliant / totalPaid) * 100) : 0,
      totalPaid,
      totalCompliant,
      perMatch: perMatch.slice(0, 5),
    };
  }, [canSeeFinance, matches, payments]);

  // Studio metrics & alerts (Club / Super Admin only)
  const { activeStudioCount, expiredStudioMembers, renewalDueMembers } = useMemo(() => {
    if (!canSeeClub) {
      return { activeStudioCount: 0, expiredStudioMembers: [], renewalDueMembers: [] };
    }
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const oneWeekLater = new Date(now);
    oneWeekLater.setDate(oneWeekLater.getDate() + 7);

    const studioMembers = players.filter((p) => p.isStudioMember && !p.disabled);
    const expired: Player[] = [];
    const renewalDue: Player[] = [];

    studioMembers.forEach((p) => {
      const expiryStr = p.studioExpiryDate || p.studioEndDate;
      if (!expiryStr) {
        expired.push(p);
        return;
      }
      const expiryDate = new Date(expiryStr);
      expiryDate.setHours(23, 59, 59, 999);

      if (expiryDate < now) {
        expired.push(p);
      } else if (expiryDate <= oneWeekLater) {
        renewalDue.push(p);
      }
    });

    const visibleExpired = filterDismissedExpiredStudioAlerts(expired, dismissedExpiredAlerts);

    return {
      activeStudioCount: Math.max(0, studioMembers.length - expired.length),
      expiredStudioMembers: visibleExpired,
      renewalDueMembers: renewalDue,
    };
  }, [canSeeClub, players, dismissedExpiredAlerts]);

  // Upcoming matches + readiness counts (Club / Super Admin)
  const upcomingMatchesWithReadiness = useMemo(() => {
    if (!canSeeClub) return [];
    const up = matches.filter((m) => {
      const timeStr = m.time || "00:00";
      return !isPast(new Date(`${m.date}T${timeStr}`));
    });
    up.sort(
      (a, b) =>
        new Date(`${a.date}T${a.time || "00:00"}`).getTime() -
        new Date(`${b.date}T${b.time || "00:00"}`).getTime(),
    );

    return up.map((m) => {
      const matchRecs = payments.filter((p) => p.matchId === m.id);
      const readiness = computeMatchAvailabilityReadiness(players, matchRecs);
      const ground = grounds.find((g) => g.id === m.groundId);
      return {
        match: m,
        ground,
        squadCount: readiness.squadCount,
        confirmedCount: readiness.confirmedCount,
        tentativeCount: readiness.tentativeCount,
        outCount: readiness.notPlayingCount,
      };
    });
  }, [canSeeClub, matches, payments, players, grounds]);

  const nextMatchItem = upcomingMatchesWithReadiness[0] || null;

  // Modals state
  const [isGroupRemindModalOpen, setIsGroupRemindModalOpen] = useState(false);
  const [groupRemindCustomMsg, setGroupRemindCustomMsg] = useState("");
  const [selectedRemindMatch, setSelectedRemindMatch] = useState<Match | null>(null);

  const [isNoShowModalOpen, setIsNoShowModalOpen] = useState(false);
  const [noShowAmount, setNoShowAmount] = useState<number>(0);
  const [noShowComment, setNoShowComment] = useState("");
  const [noShowSearch, setNoShowSearch] = useState("");
  const [noShowSelected, setNoShowSelected] = useState<string[]>([]);
  const [isSavingNoShow, setIsSavingNoShow] = useState(false);

  const chargeablePlayers = useMemo(
    () =>
      store.players
        .filter(
          (p) =>
            !p.disabled &&
            p.inviteStatus !== "Rejected" &&
            p.inviteStatus !== "Pending",
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [store.players],
  );

  const noShowFiltered = useMemo(
    () =>
      chargeablePlayers.filter(
        (p) =>
          !noShowSearch ||
          p.name.toLowerCase().includes(noShowSearch.toLowerCase()) ||
          (p.mobile || "").includes(noShowSearch),
      ),
    [chargeablePlayers, noShowSearch],
  );

  const resetNoShow = () => {
    setIsNoShowModalOpen(false);
    setNoShowAmount(0);
    setNoShowComment("");
    setNoShowSearch("");
    setNoShowSelected([]);
    setIsSavingNoShow(false);
  };

  const handleSaveNoShow = async () => {
    if (isSavingNoShow) return;
    if (noShowSelected.length === 0) {
      toast("Pick at least one player.", "error");
      return;
    }
    if (!noShowAmount || noShowAmount <= 0) {
      toast("Set a No Show amount (₹).");
      return;
    }
    setIsSavingNoShow(true);
    try {
      for (const pid of noShowSelected) {
        await store.addOtherFee(pid, "No Show", noShowAmount, noShowComment);
      }
      toast(`No Show fee added to ${noShowSelected.length} player(s).`, "success");
      resetNoShow();
    } catch (err) {
      console.error("Failed to add No Show fee", err);
      toast("Failed to add No Show fee. Try again.", "error");
      setIsSavingNoShow(false);
    }
  };

  const handleGroupRemind = () => {
    if (!selectedRemindMatch) return;
    const ground = store.grounds.find((g) => g.id === selectedRemindMatch.groundId);

    let text = `🏏 *Upcoming Match Reminder* 🏏\n`;
    text += `*Date*: ${formatDate(selectedRemindMatch.date)}\n`;
    text += `*Time*: ${selectedRemindMatch.time || "TBD"}\n`;
    text += `*Ground*: ${ground?.name || "TBD"}\n`;
    if (ground?.mapUrl) text += `*Location*: ${ground.mapUrl}\n`;
    if (groupRemindCustomMsg.trim()) text += `\n${groupRemindCustomMsg.trim()}\n`;
    text += `\n*Squad*:\n`;

    const matchPayments = store.payments.filter(
      (p) => p.matchId === selectedRemindMatch.id && store.players.some((pl) => pl.id === p.playerId),
    );
    const playing = matchPayments.filter((p) => p.status !== "Not Playing");
    playing.forEach((p) => {
      const player = store.players.find((pl) => pl.id === p.playerId);
      if (player?.mobile) {
        let mob = player.mobile.replace(/\D/g, "");
        if (mob.startsWith("0") && mob.length === 11) mob = "91" + mob.substring(1);
        else if (mob.length === 10) mob = "91" + mob;
        text += `@+${mob} `;
      } else if (player) {
        text += `${player.name} `;
      }
    });

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    setIsGroupRemindModalOpen(false);
  };

  const handleNotifyMatch = (m: Match) => {
    const ground = store.grounds.find((g) => g.id === m.groundId);
    const startTimeLabel = m.time
      ? format(parseISO(`${m.date}T${m.time}`), "h:mm a, EEE d MMM")
      : formatDate(m.date);

    let text = `*Upcoming Match Alert*\n`;
    text += `KAvach vs ${m.opponent}\n`;
    text += `Ground Name: ${ground?.name || "TBD"}\n`;
    text += `Start Time: ${startTimeLabel}\n`;
    text += `Jersey Colour: ${m.jerseyColor || "TBD"}\n`;
    text += `Location: ${ground?.mapUrl || "TBD"}\n`;

    const matchPayments = store.payments.filter(
      (p) => p.matchId === m.id && store.players.some((pl) => pl.id === p.playerId),
    );
    const playing = matchPayments.filter((p) => p.status !== "Not Playing");

    const tags: string[] = [];
    const untagged: string[] = [];
    for (const pay of playing) {
      const player = store.players.find((pl) => pl.id === pay.playerId);
      if (!player) continue;
      const normalized = normalizeIndianMobile(player.mobile);
      if (/^\+91\d{10}$/.test(normalized)) {
        tags.push(`@${normalized}`);
      } else {
        untagged.push(player.name);
      }
    }

    text += `Players: ${tags.join(" ")}`;
    if (untagged.length > 0) {
      text += `\n\n_Could not tag (no valid mobile on file): ${untagged.join(", ")}_`;
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleStudioRemind = async (p: Player) => {
    if (!p.mobile) {
      toast(`${p.name} has no mobile number.`);
      return;
    }
    const expiry = p.studioExpiryDate || p.studioEndDate;
    const daysLeft = expiry
      ? Math.ceil((new Date(expiry).getTime() - Date.now()) / (1000 * 3600 * 24))
      : -999;

    setRemindingStudioId(p.id);
    try {
      const res = await authedFetch("/api/whatsapp/remind-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: p.mobile, daysLeft, playerName: p.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast(`Reminder sent to ${p.name}!`, "success");
    } catch (err: any) {
      toast(`Error: ${err.message}`, "error");
    } finally {
      setRemindingStudioId(null);
    }
  };

  const handleBulkStudioRemind = async (membersList: Player[]) => {
    const withMobile = membersList.filter((p) => p.mobile);
    if (withMobile.length === 0) {
      toast("No players have mobile numbers.", "error");
      return;
    }
    if (!(await confirmAction({ message: `Send WhatsApp reminder to ${withMobile.length} player(s)?` }))) return;

    setRemindingStudioId("bulk");
    let sent = 0;
    let failed = 0;
    for (const p of withMobile) {
      const expiry = p.studioExpiryDate || p.studioEndDate;
      const daysLeft = expiry
        ? Math.ceil((new Date(expiry).getTime() - Date.now()) / (1000 * 3600 * 24))
        : -999;
      try {
        const res = await authedFetch("/api/whatsapp/remind-studio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: p.mobile, daysLeft, playerName: p.name }),
        });
        if (res.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setRemindingStudioId(null);
    toast(`Sent: ${sent}${failed > 0 ? `, Failed: ${failed}` : ""}`, failed > 0 ? "error" : "success");
  };

  const handleDismissExpiredStudio = async (p: Player) => {
    const expiryKey = getStudioAlertExpiryKey(p);
    setDismissingStudioId(p.id);
    setOptimisticDismissedAlerts((prev) => ({ ...prev, [p.id]: expiryKey }));
    try {
      await store.dismissExpiredStudioAlert(p.id, expiryKey);
      toast(`Dismissed Studio alert for ${p.name}.`, "success");
    } catch (err: any) {
      setOptimisticDismissedAlerts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      toast(err?.message || "Could not dismiss Studio alert.", "error");
    } finally {
      setDismissingStudioId(null);
    }
  };

  const handleRemoveFromStudio = async (p: Player) => {
    const confirmed = await confirmAction({
      title: "Remove from Studio",
      message: `Remove ${p.name} from Studio membership? They will lose Studio membership and Studio access immediately, while their regular Club Player account, identity, and history remain intact.`,
      confirmLabel: "Remove from Studio",
      destructive: true,
    });
    if (!confirmed) return;

    setRemovingStudioId(p.id);
    try {
      await store.removeStudioMembership(p.id);
      toast(`${p.name} removed from Studio membership.`, "success");
    } catch (err: any) {
      toast(err?.message || "Failed to remove Studio membership.", "error");
    } finally {
      setRemovingStudioId(null);
    }
  };

  const roleLabels = [
    isSuperAdmin ? "Super Admin" : null,
    !isSuperAdmin && isClubAdmin ? "Club Admin" : null,
    !isSuperAdmin && isFinanceAdmin ? "Finance Admin" : null,
  ].filter(Boolean) as string[];

  const totalStudioAlerts = expiredStudioMembers.length + renewalDueMembers.length;

  // Quick actions list (role-gated, zero duplicates)
  const quickActions = [
    ...(canSeeClub
      ? [
          {
            id: "add-squad",
            label: "Add Squad",
            sub: "Pick match & squad",
            icon: Users,
            tone: "bg-brand-surface text-brand",
            onClick: () => {
              if (upcomingMatchesWithReadiness.length === 1) {
                setActiveTab("matches", `match_${upcomingMatchesWithReadiness[0].match.id}`);
              } else if (upcomingMatchesWithReadiness.length > 1) {
                setMatchPickerMode("squad");
              } else {
                setActiveTab("matches");
              }
            },
          },
          {
            id: "edit-calendar",
            label: "Edit / Calendar",
            sub: "Fixtures & schedule",
            icon: Edit3,
            tone: "bg-blue-50 text-blue-700",
            onClick: () => {
              if (upcomingMatchesWithReadiness.length > 0) {
                setMatchPickerMode("edit");
              } else {
                setActiveTab("matches", "calendar");
              }
            },
          },
          {
            id: "add-studio",
            label: "Add to Studio",
            sub: "Enroll net member",
            icon: PlusCircle,
            tone: "bg-amber-50 text-amber-700",
            onClick: () => setActiveTab("club", "studio:add_player"),
          },
          {
            id: "record-catch",
            label: "Record Catch",
            sub: "Stunning / Dropped",
            icon: Target,
            tone: "bg-emerald-50 text-emerald-700",
            onClick: () => setShowCatchModal(true),
          },
        ]
      : []),
    ...(canSeeFinance
      ? [
          {
            id: "add-no-show",
            label: "Add No Show",
            sub: "Fine absentees",
            icon: UserX,
            tone: "bg-amber-50 text-amber-700",
            onClick: () => setIsNoShowModalOpen(true),
          },
        ]
      : []),
    ...(canSeeClub
      ? [
          {
            id: "grant-badge",
            label: "Grant Badge",
            sub: "Award milestone",
            icon: Award,
            tone: "bg-yellow-50 text-yellow-700",
            onClick: () => setActiveTab("club", "badges_grant"),
          },
          {
            id: "invite-players",
            label: "Invite Players",
            sub: "WhatsApp invite",
            icon: UserPlus,
            tone: "bg-brand-surface text-brand",
            onClick: () => setActiveTab("club", "invite_player"),
          },
          ...(isSuperAdmin
            ? [
                {
                  id: "announcements",
                  label: "Announcements",
                  sub: "Publish & pin",
                  icon: Megaphone,
                  tone: "bg-blue-50 text-blue-700",
                  onClick: () => setActiveTab("club", "announcements"),
                },
              ]
            : []),
        ]
      : []),
    ...(canSeeFinance && !canSeeClub
      ? [
          {
            id: "send-reminders",
            label: "Send Reminders",
            sub: `Notify ${duePlayersCount} player${duePlayersCount === 1 ? "" : "s"}`,
            icon: Bell,
            tone: "bg-brand-surface text-brand",
            onClick: () => setActiveTab("finance", "dues"),
          },
        ]
      : []),
  ];

  const handleWeekendClick = () => {
    if (canSeeClub) setActiveTab("matches");
    else setActiveTab("finance");
  };

  return (
    <div className="flex flex-col gap-4 w-full" data-testid="admin-home">
      {isIndependenceDayWindow() && (
        <IndependenceDayBanner clubName={store.appConfig?.clubName} />
      )}

      {/* Tier 1: Header & Operational Attention Strip */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-black font-heading tracking-tight text-text-primary">
              Admin Home
            </h1>
            {roleLabels.map((role) => (
              <span
                key={role}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-brand-surface text-brand"
              >
                {role}
              </span>
            ))}
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            {isSuperAdmin
              ? "Club operations, match readiness, studio memberships & finance overview"
              : canSeeClub
                ? "Match operations, squad readiness, roster & studio overview"
                : "Dues, collections, compliance & financial operations"}
          </p>
        </div>
        {isSuperAdmin && (
          <a
            href="/admin-tools"
            className="min-h-[36px] px-3 rounded-xl border border-border bg-surface text-xs font-bold text-text-secondary hover:text-text-primary hover:bg-surface-hover transition inline-flex items-center gap-1.5 shrink-0"
          >
            <Search className="w-3.5 h-3.5" />
            Admin Tools
          </a>
        )}
      </div>

      {/* Attention Strip (Weekend Ops — Pending Approvals is already rendered by app/page.tsx) */}
      {weekendPending > 0 && (
        <div className="grid grid-cols-1 gap-2.5" data-testid="admin-attention-strip">
          <button
            type="button"
            onClick={handleWeekendClick}
            className="w-full min-h-[44px] bg-brand-surface border border-brand/20 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-brand-surface/80 transition cursor-pointer"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Clock className="w-4 h-4 text-brand shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs font-bold text-text-primary">
                  {weekendPending} Weekend Ops Task{weekendPending === 1 ? "" : "s"} Pending
                </span>
                <span className="block text-[11px] text-text-secondary truncate">
                  {canSeeClub ? "Match results, POTW or fee tasks due" : "Weekend financial tasks due"}
                </span>
              </span>
            </span>
            <span className="text-xs font-extrabold text-brand inline-flex items-center gap-0.5 shrink-0">
              Open <ChevronRight className="w-4 h-4" />
            </span>
          </button>
        </div>
      )}

      {/* Tier 2: Role-Specific KPI Cards */}
      <div
        className={`grid gap-3 ${
          canSeeClub && canSeeFinance ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"
        }`}
        data-testid="admin-kpi-grid"
      >
        {canSeeFinance && (
          <button
            type="button"
            onClick={() => setActiveTab("finance", "dues")}
            className="bg-surface rounded-2xl border border-border p-3.5 sm:p-4 text-left hover:border-brand/30 transition shadow-xs cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-text-secondary">
                Total Due
              </span>
              <IndianRupee className="w-4 h-4 text-accent" />
            </div>
            <p className="text-xl sm:text-2xl font-black text-brand mt-1.5 tabular-nums">
              ₹{totalDueAmount.toLocaleString("en-IN")}
            </p>
            <p className="text-[11px] text-text-secondary mt-1">
              {duePlayersCount} player{duePlayersCount === 1 ? "" : "s"} ·{" "}
              <span className="font-bold text-accent">Notify ›</span>
            </p>
          </button>
        )}

        {canSeeFinance && (
          <button
            type="button"
            onClick={() => setActiveTab("finance")}
            className="bg-surface rounded-2xl border border-border p-3.5 sm:p-4 text-left hover:border-brand/30 transition shadow-xs cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-text-secondary">
                Collections (30d)
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            </div>
            <p className="text-xl sm:text-2xl font-black text-text-primary mt-1.5 tabular-nums">
              ₹{collected30d.toLocaleString("en-IN")}
            </p>
            <p className="text-[11px] text-text-secondary mt-1">
              Compliance:{" "}
              <span
                className={`font-bold ${
                  matchCompliance.overall >= 75
                    ? "text-emerald-700"
                    : matchCompliance.overall >= 50
                      ? "text-amber-700"
                      : "text-rose-700"
                }`}
              >
                {matchCompliance.overall}%
              </span>
            </p>
          </button>
        )}

        {canSeeClub && (
          <button
            type="button"
            onClick={() =>
              nextMatchItem
                ? setActiveTab("matches", `match_${nextMatchItem.match.id}`)
                : setActiveTab("matches")
            }
            className="bg-surface rounded-2xl border border-border p-3.5 sm:p-4 text-left hover:border-brand/30 transition shadow-xs cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-text-secondary">
                Next Match
              </span>
              <CalendarDays className="w-4 h-4 text-emerald-700" />
            </div>
            {nextMatchItem ? (
              <>
                <p className="text-sm sm:text-base font-extrabold text-text-primary mt-1.5 truncate">
                  vs {nextMatchItem.match.opponent}
                </p>
                <p className="text-[11px] font-bold text-emerald-700 mt-1">
                  {nextMatchItem.confirmedCount} Confirmed ·{" "}
                  {nextMatchItem.squadCount > 0 ? `Squad ${nextMatchItem.squadCount}` : "Squad Open"}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-text-primary mt-1.5">No upcoming match</p>
                <p className="text-[11px] text-accent font-bold mt-1">Schedule ›</p>
              </>
            )}
          </button>
        )}

        {canSeeClub && (
          <button
            type="button"
            onClick={() => setActiveTab("club", "studio")}
            className="bg-surface rounded-2xl border border-border p-3.5 sm:p-4 text-left hover:border-brand/30 transition shadow-xs cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-text-secondary">
                Studio Nets
              </span>
              <Users className="w-4 h-4 text-amber-700" />
            </div>
            <p className="text-xl sm:text-2xl font-black text-text-primary mt-1.5 tabular-nums">
              {activeStudioCount} Active
            </p>
            <p
              className={`text-[11px] font-bold mt-1 ${
                totalStudioAlerts > 0 ? "text-rose-700" : "text-text-secondary"
              }`}
            >
              {totalStudioAlerts > 0
                ? `${expiredStudioMembers.length} Expired · ${renewalDueMembers.length} Due 7d`
                : "All memberships current"}
            </p>
          </button>
        )}
      </div>

      {/* Tier 3 & Tier 4 Desktop 2-Column Split (Left 7 / Right 5 for Super Admin; clean stack for single-domain roles) */}
      <div
        className={`grid gap-5 items-start ${
          canSeeClub && canSeeFinance ? "lg:grid-cols-12" : "grid-cols-1"
        }`}
      >
        {/* Primary Operational Column */}
        <div className={canSeeClub && canSeeFinance ? "lg:col-span-7 space-y-5 min-w-0" : "space-y-5 min-w-0"}>
          {/* Unified Quick Actions */}
          <section data-testid="admin-quick-actions" className="min-w-0">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-xs font-black uppercase tracking-wider text-text-secondary">
                Quick Actions
              </h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {quickActions.map((act) => {
                const Icon = act.icon;
                return (
                  <button
                    key={act.id}
                    type="button"
                    data-testid={`quick-action-${act.id}`}
                    onClick={act.onClick}
                    className="w-full min-w-0 min-h-[56px] bg-surface rounded-xl border border-border p-2.5 sm:p-3 flex items-center gap-2.5 text-left hover:bg-surface-hover hover:border-brand/30 transition shadow-xs cursor-pointer"
                  >
                    <span
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${act.tone}`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-text-primary leading-tight truncate">
                        {act.label}
                      </span>
                      <span className="block text-[10px] text-text-secondary truncate mt-0.5">
                        {act.sub}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Today & Upcoming Matches — Club / Super Admin */}
          {canSeeClub && (
            <section data-testid="admin-upcoming-matches">
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-xs font-black uppercase tracking-wider text-text-secondary">
                  Today &amp; Upcoming Matches
                </h2>
                <button
                  type="button"
                  onClick={() => setActiveTab("matches")}
                  className="text-xs font-bold text-accent hover:underline cursor-pointer"
                >
                  Open Match Center ›
                </button>
              </div>
              {upcomingMatchesWithReadiness.length === 0 ? (
                <div className="bg-surface rounded-2xl border border-border p-6 text-center">
                  <p className="text-sm text-text-secondary mb-3">No upcoming fixtures scheduled.</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab("matches", "add_match")}
                    className="min-h-[40px] px-4 rounded-xl bg-accent text-text-accent text-xs font-bold inline-flex items-center gap-1.5 hover:bg-accent/90 transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Schedule Match
                  </button>
                </div>
              ) : (
                <div className="flex overflow-x-auto md:grid md:grid-cols-2 gap-3 pb-2 md:pb-0 snap-x no-scrollbar">
                  {upcomingMatchesWithReadiness.slice(0, 4).map(({ match: m, ground, squadCount, confirmedCount, tentativeCount, outCount }) => (
                    <div
                      key={m.id}
                      className="min-w-[290px] md:min-w-0 snap-center bg-surface rounded-2xl border border-border border-l-4 border-l-brand p-4 shadow-xs shrink-0 flex flex-col justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-surface text-brand uppercase">
                            {format(parseISO(m.date), "EEE, d MMM")}
                            {m.time ? ` · ${format(parseISO(`${m.date}T${m.time}`), "h:mm a")}` : ""}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              squadCount > 0
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {squadCount > 0 ? `Squad ${squadCount}` : "Squad Open"}
                          </span>
                        </div>
                        <p className="text-base font-extrabold text-text-primary truncate">
                          vs {m.opponent}
                        </p>
                        <p className="text-xs text-text-secondary truncate mt-0.5">
                          {m.format || "Match"} · {ground?.name || "Ground TBD"}
                        </p>
                        <div className="mt-2.5 bg-surface-hover border border-border rounded-xl px-2.5 py-2 grid grid-cols-3 gap-1 text-center">
                          <div>
                            <span className="block text-xs font-black text-emerald-700 tabular-nums">{confirmedCount}</span>
                            <span className="block text-[9px] font-bold text-text-secondary uppercase">Confirmed</span>
                          </div>
                          <div>
                            <span className="block text-xs font-black text-amber-700 tabular-nums">{tentativeCount}</span>
                            <span className="block text-[9px] font-bold text-text-secondary uppercase">Tentative</span>
                          </div>
                          <div>
                            <span className="block text-xs font-black text-rose-700 tabular-nums">{outCount}</span>
                            <span className="block text-[9px] font-bold text-text-secondary uppercase">Not Playing</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleNotifyMatch(m)}
                          className="flex-1 min-h-[36px] bg-accent hover:bg-accent/90 text-text-accent rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1 transition cursor-pointer"
                        >
                          <Send className="w-3 h-3" /> Notify
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRemindMatch(m);
                            setIsGroupRemindModalOpen(true);
                          }}
                          className="flex-1 min-h-[36px] bg-brand-surface hover:bg-brand-surface/80 text-brand rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1 transition cursor-pointer"
                        >
                          <MessageSquare className="w-3 h-3" /> Remind
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab("matches", `match_${m.id}`)}
                          className="flex-1 min-h-[36px] bg-surface-hover hover:bg-border/50 text-text-primary border border-border rounded-lg text-xs font-bold transition cursor-pointer"
                        >
                          Squad
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Secondary / Summary Column */}
        <div className={canSeeClub && canSeeFinance ? "lg:col-span-5 space-y-4 min-w-0" : "space-y-4 min-w-0"}>
          {/* Finance Snapshot — Finance / Super Admin */}
          {canSeeFinance && (
            <section
              className="bg-surface rounded-2xl border border-border p-4 shadow-xs"
              data-testid="admin-finance-snapshot"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-extrabold text-text-primary">Finance Snapshot</h2>
                <button
                  type="button"
                  onClick={() => setActiveTab("finance")}
                  className="text-xs font-bold text-accent hover:underline cursor-pointer"
                >
                  Open Finance ›
                </button>
              </div>

              {/* Segmented Tabs */}
              <div
                role="tablist"
                aria-label="Finance snapshot"
                className="flex gap-1 bg-surface-hover p-1 rounded-xl border border-border mb-3"
              >
                {[
                  { key: "dues" as FinanceSnapshotTab, label: `Top Dues (${topDuePlayers.length})` },
                  { key: "txns" as FinanceSnapshotTab, label: "Recent Txns" },
                  { key: "compliance" as FinanceSnapshotTab, label: "Compliance" },
                ].map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={financeTab === t.key}
                    onClick={() => setFinanceTab(t.key)}
                    className={`flex-1 min-h-[34px] rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      financeTab === t.key
                        ? "bg-surface text-text-primary shadow-xs border border-border"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {financeTab === "dues" && (
                <div className="divide-y divide-border" data-testid="top-dues-section">
                  {topDuePlayers.length === 0 ? (
                    <p className="text-xs text-text-secondary py-4 text-center">No outstanding player dues.</p>
                  ) : (
                    topDuePlayers.map((d, i) => (
                      <div key={d.player!.id} className="flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-[10px] font-black text-text-muted w-4">{i + 1}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-text-primary truncate">{d.player!.name}</p>
                            <p className="text-[10px] text-text-secondary font-mono">{d.player!.mobile || ""}</p>
                          </div>
                        </div>
                        <span className="text-xs font-black text-brand tabular-nums">
                          ₹{d.amount.toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {financeTab === "txns" && (
                <div className="divide-y divide-border" data-testid="recent-transactions-section">
                  {recentTransactions.length === 0 ? (
                    <p className="text-xs text-text-secondary py-4 text-center">No recent transactions recorded.</p>
                  ) : (
                    recentTransactions.map((txn) => (
                      <div key={txn.id} className="flex items-center justify-between py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-text-primary truncate">{txn.playerName}</p>
                          <p className="text-[10px] text-text-secondary">
                            {txn.type}
                            {txn.method ? ` · ${txn.method}` : ""} · {format(new Date(txn.date), "dd MMM")}
                          </p>
                        </div>
                        <span className="text-xs font-black text-emerald-700 tabular-nums">
                          ₹{txn.amount.toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {financeTab === "compliance" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-surface-hover rounded-xl px-3 py-2 border border-border">
                    <span className="text-xs font-semibold text-text-secondary">
                      4-day post-match compliance
                    </span>
                    <span className="text-sm font-black text-emerald-700">{matchCompliance.overall}%</span>
                  </div>
                  {matchCompliance.perMatch.length === 0 ? (
                    <p className="text-xs text-text-secondary py-3 text-center">No recent completed matches.</p>
                  ) : (
                    matchCompliance.perMatch.map(({ match, compliant, total, rate }) => (
                      <div
                        key={match.id}
                        className="flex items-center justify-between py-1.5 border-b border-border last:border-b-0"
                      >
                        <div>
                          <p className="text-xs font-bold text-text-primary">vs {match.opponent}</p>
                          <p className="text-[10px] text-text-secondary">{formatDate(match.date)}</p>
                        </div>
                        <div className="text-right">
                          <span
                            className={`text-xs font-black ${
                              rate >= 75 ? "text-emerald-700" : rate >= 50 ? "text-amber-700" : "text-rose-700"
                            }`}
                          >
                            {rate}%
                          </span>
                          <p className="text-[10px] text-text-secondary">{compliant}/{total} on time</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          )}

          {/* Studio Alerts — Club / Super Admin (Compact, actionable) */}
          {canSeeClub && totalStudioAlerts > 0 && (
            <section
              className="bg-surface rounded-2xl border border-rose-200 p-4 shadow-xs"
              data-testid="admin-studio-alerts"
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-700" />
                  <h2 className="text-xs font-black uppercase tracking-wider text-rose-800">
                    Studio Alerts ({totalStudioAlerts})
                  </h2>
                </div>
                {expiredStudioMembers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleBulkStudioRemind(expiredStudioMembers)}
                    disabled={!!remindingStudioId}
                    className="px-2.5 py-1 rounded-lg bg-accent text-text-accent text-[11px] font-bold hover:bg-accent/90 transition disabled:opacity-50 cursor-pointer"
                  >
                    Notify Expired ({expiredStudioMembers.length})
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {expiredStudioMembers.slice(0, 3).map((p) => {
                  const expiry = p.studioExpiryDate || p.studioEndDate;
                  const daysAgo = expiry
                    ? Math.abs(Math.ceil((new Date(expiry).getTime() - Date.now()) / (1000 * 3600 * 24)))
                    : null;
                  return (
                    <div
                      key={p.id}
                      data-testid={`expired-studio-row-${p.id}`}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-rose-50/70 border border-rose-200/70 rounded-xl px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-text-primary truncate">{p.name}</p>
                        <p className="text-[10px] text-rose-700 font-medium">
                          {expiry ? `Expired ${daysAgo}d ago` : "No expiry date"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStudioRemind(p)}
                          disabled={
                            remindingStudioId === p.id ||
                            remindingStudioId === "bulk" ||
                            dismissingStudioId === p.id ||
                            removingStudioId === p.id
                          }
                          className="min-h-[32px] px-2.5 py-1 rounded-lg bg-rose-100 text-rose-800 text-[11px] font-bold hover:bg-rose-200/70 transition disabled:opacity-50 cursor-pointer"
                        >
                          {remindingStudioId === p.id ? "Sending..." : "Remind"}
                        </button>
                        <button
                          type="button"
                          data-testid={`dismiss-expired-studio-${p.id}`}
                          onClick={() => handleDismissExpiredStudio(p)}
                          disabled={
                            dismissingStudioId === p.id ||
                            removingStudioId === p.id
                          }
                          className="min-h-[32px] px-2.5 py-1 rounded-lg bg-white border border-border text-text-secondary text-[11px] font-bold hover:bg-surface-hover hover:text-text-primary transition disabled:opacity-50 cursor-pointer"
                        >
                          {dismissingStudioId === p.id ? "Dismissing..." : "Dismiss"}
                        </button>
                        <button
                          type="button"
                          data-testid={`remove-expired-studio-${p.id}`}
                          onClick={() => handleRemoveFromStudio(p)}
                          disabled={
                            removingStudioId === p.id ||
                            dismissingStudioId === p.id
                          }
                          className="min-h-[32px] px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold hover:bg-rose-700 transition disabled:opacity-50 cursor-pointer"
                        >
                          {removingStudioId === p.id ? "Removing..." : "Remove from Studio"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {renewalDueMembers.slice(0, 2).map((p) => {
                  const expiry = p.studioExpiryDate || p.studioEndDate;
                  const daysLeft = expiry
                    ? Math.ceil((new Date(expiry).getTime() - Date.now()) / (1000 * 3600 * 24))
                    : 0;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between bg-amber-50/70 border border-amber-200/70 rounded-xl px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-text-primary truncate">{p.name}</p>
                        <p className="text-[10px] text-amber-800 font-medium">
                          {daysLeft === 0 ? "Expires today" : `Expires in ${daysLeft}d`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleStudioRemind(p)}
                        disabled={remindingStudioId === p.id || remindingStudioId === "bulk"}
                        className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 text-[11px] font-bold hover:bg-amber-200/70 transition disabled:opacity-50 cursor-pointer"
                      >
                        {remindingStudioId === p.id ? "Sending..." : "Remind"}
                      </button>
                    </div>
                  );
                })}
              </div>
              {totalStudioAlerts > 5 && (
                <button
                  type="button"
                  onClick={() => setActiveTab("club", "studio")}
                  className="mt-2.5 w-full text-center text-xs font-bold text-accent hover:underline cursor-pointer"
                >
                  View all {totalStudioAlerts} in Studio ›
                </button>
              )}
            </section>
          )}

          {/* Announcements Shortcut — Club / Super Admin */}
          {canSeeClub && (
            <button
              type="button"
              data-testid="admin-home-announcements-link"
              onClick={() => setActiveTab("club", "announcements")}
              className="w-full min-h-[52px] bg-surface flex items-center justify-between p-3.5 rounded-2xl border border-border hover:bg-surface-hover transition shadow-xs cursor-pointer"
            >
              <span className="flex items-center gap-3 text-left">
                <span className="w-9 h-9 rounded-xl bg-brand-surface text-brand flex items-center justify-center shrink-0">
                  <Bell className="w-4 h-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-bold text-text-primary">Club Announcements</span>
                  <span className="block text-xs text-text-secondary">
                    Publish, edit and pin announcements in Club
                  </span>
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Match Picker Modal for Add Squad / Edit & Calendar */}
      {matchPickerMode && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          onClick={() => setMatchPickerMode(null)}
        >
          <div
            className="bg-surface border border-border rounded-2xl w-full max-w-md p-5 relative shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-text-primary">
                {matchPickerMode === "squad" ? "Add Squad to Match" : "Edit Match or View Calendar"}
              </h3>
              <button
                type="button"
                onClick={() => setMatchPickerMode(null)}
                className="text-text-muted hover:text-text-primary p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {matchPickerMode === "edit" && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMatchPickerMode(null);
                    setActiveTab("matches", "calendar");
                  }}
                  className="min-h-[42px] rounded-xl bg-accent text-text-accent text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-accent/90 transition cursor-pointer"
                >
                  <CalendarDays className="w-4 h-4" /> View Calendar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMatchPickerMode(null);
                    setActiveTab("matches", "add_match");
                  }}
                  className="min-h-[42px] rounded-xl bg-brand-surface text-brand text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-brand-surface/80 transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> New Match
                </button>
              </div>
            )}
            <p className="text-xs text-text-secondary">
              {matchPickerMode === "squad"
                ? "Select an upcoming match to manage its squad:"
                : "Or select an upcoming match to edit/manage:"}
            </p>
            <div className="max-h-64 overflow-y-auto divide-y divide-border border border-border rounded-xl">
              {upcomingMatchesWithReadiness.map(({ match: m, ground, squadCount, confirmedCount }) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMatchPickerMode(null);
                    setActiveTab("matches", `match_${m.id}`);
                  }}
                  className="w-full p-3 text-left hover:bg-surface-hover flex items-center justify-between gap-2 transition cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-text-primary truncate">vs {m.opponent}</p>
                    <p className="text-[11px] text-text-secondary truncate">
                      {formatDate(m.date)} · {ground?.name || "TBD"} · {confirmedCount} Confirmed
                    </p>
                  </div>
                  <span className="text-xs font-bold text-brand shrink-0">
                    {squadCount > 0 ? `${squadCount} in squad` : "Open"} ›
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Group Remind Modal */}
      {isGroupRemindModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-sm p-5 relative shadow-2xl">
            <button
              onClick={() => setIsGroupRemindModalOpen(false)}
              className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-brand mb-2 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Remind Group
            </h3>
            <p className="text-xs text-text-secondary mb-4 leading-relaxed">
              This will open WhatsApp with the match details and squad list. Select your club&apos;s WhatsApp group to send.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-secondary block mb-1">
                  Optional Custom Message
                </label>
                <textarea
                  value={groupRemindCustomMsg}
                  onChange={(e) => setGroupRemindCustomMsg(e.target.value)}
                  className="w-full bg-surface-hover border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand text-text-primary"
                  placeholder="e.g., Please reach 15 mins early!"
                  rows={3}
                />
              </div>
              <button
                onClick={handleGroupRemind}
                className="w-full bg-accent text-text-accent font-bold py-2.5 rounded-xl hover:bg-accent/90 transition shadow flex items-center justify-center gap-2 cursor-pointer"
              >
                Continue to WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add No Show Modal */}
      {isNoShowModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-5 relative shadow-2xl max-h-[90vh] flex flex-col">
            <button
              onClick={resetNoShow}
              className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition cursor-pointer"
              disabled={isSavingNoShow}
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-amber-700 mb-2 flex items-center gap-2">
              <UserX className="w-4 h-4" /> Add No Show Fee
            </h3>
            <p className="text-xs text-text-secondary mb-4 leading-relaxed">
              Charges an <span className="text-amber-700 font-bold">Other Fee</span> called <em>No Show</em> to every selected player.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-secondary block mb-1">
                  Amount (₹) *
                </label>
                <input
                  type="number"
                  min={0}
                  value={noShowAmount || ""}
                  onChange={(e) => setNoShowAmount(Number(e.target.value))}
                  placeholder="e.g. 200"
                  className="w-full bg-surface-hover border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand text-text-primary"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-secondary block mb-1">
                  Selected
                </label>
                <div className="w-full bg-surface-hover border border-border rounded-xl px-3 py-2 text-sm text-text-primary h-[38px] flex items-center">
                  {noShowSelected.length} player(s)
                </div>
              </div>
            </div>

            <div className="mb-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-text-secondary block mb-1">
                Comment (visible to players)
              </label>
              <input
                type="text"
                value={noShowComment}
                onChange={(e) => setNoShowComment(e.target.value)}
                placeholder="e.g. No show for match vs Titans on 12 Aug"
                className="w-full bg-surface-hover border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand text-text-primary"
              />
            </div>

            <div className="mb-3 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                  Select Players
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setNoShowSelected(
                      noShowSelected.length === noShowFiltered.length
                        ? []
                        : noShowFiltered.map((p) => p.id),
                    )
                  }
                  className="text-accent text-[10px] uppercase font-bold tracking-wider hover:underline cursor-pointer"
                >
                  {noShowSelected.length === noShowFiltered.length && noShowFiltered.length > 0
                    ? "Deselect All"
                    : "Select All Filtered"}
                </button>
              </div>
              <input
                type="text"
                placeholder="Search players..."
                value={noShowSearch}
                onChange={(e) => setNoShowSearch(e.target.value)}
                className="w-full bg-surface-hover border border-border rounded-t-xl px-3 py-2 text-sm focus:outline-none focus:border-brand text-text-primary"
              />
              <div className="flex-1 overflow-y-auto min-h-[8rem] max-h-[16rem] border border-t-0 border-border rounded-b-xl bg-surface-hover p-2 flex flex-col gap-1">
                {noShowFiltered.length === 0 && (
                  <div className="text-xs text-text-secondary italic p-2 text-center">No players found.</div>
                )}
                {noShowFiltered.map((p) => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition ${
                      noShowSelected.includes(p.id)
                        ? "bg-amber-50 border border-amber-300 text-text-primary"
                        : "hover:bg-surface border border-transparent text-text-secondary"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={noShowSelected.includes(p.id)}
                      onChange={() =>
                        setNoShowSelected((prev) =>
                          prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                        )
                      }
                      className="accent-amber-600"
                    />
                    <span className="text-xs truncate flex-1">{p.name}</span>
                    <span className="text-[10px] text-text-secondary font-mono">{p.mobile || ""}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleSaveNoShow}
              disabled={isSavingNoShow}
              className="w-full bg-accent text-text-accent font-bold py-2.5 rounded-xl hover:bg-accent/90 transition shadow flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSavingNoShow
                ? "Saving..."
                : `Add No Show to ${noShowSelected.length} player(s)`}
            </button>
          </div>
        </div>
      )}

      {/* Record Catches Modal */}
      {showCatchModal && (
        <RecordCatchesModal store={store} onClose={() => setShowCatchModal(false)} />
      )}
    </div>
  );
}

function RecordCatchesModal({
  store,
  onClose,
}: {
  store: ReturnType<typeof useStore>;
  onClose: () => void;
}) {
  const [catchType, setCatchType] = useState<"dropped" | "stunning">("dropped");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [matchId, setMatchId] = useState("");
  const [comment, setComment] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isSavingRef = useRef(false);
  const batchStateRef = useRef<CatchBatchState>(createCatchBatchState());

  const resetBatchState = () => {
    if (isSavingRef.current) return;
    batchStateRef.current = createCatchBatchState();
    setSaveError(null);
  };

  const handleClose = () => {
    if (isSavingRef.current || isSaving) return;
    resetBatchState();
    onClose();
  };

  const activePlayers = useMemo(
    () =>
      store.players
        .filter((p) => !p.disabled && p.inviteStatus !== "Rejected" && p.inviteStatus !== "Pending")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [store.players],
  );

  const recentMatches = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const oneMonthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    return [...store.matches]
      .filter((m) => m.date && m.date <= today && m.date >= oneMonthAgo)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 10);
  }, [store.matches]);

  const filtered = searchQ
    ? activePlayers.filter((p) => p.name.toLowerCase().includes(searchQ.toLowerCase()))
    : activePlayers;

  const togglePlayer = (id: string) => {
    if (isSavingRef.current || isSaving) return;
    resetBatchState();
    setSelectedPlayers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    if (!playerCounts[id]) setPlayerCounts((c) => ({ ...c, [id]: 1 }));
  };

  const updateCount = (id: string, delta: number) => {
    if (isSavingRef.current || isSaving) return;
    resetBatchState();
    setPlayerCounts((c) => ({ ...c, [id]: Math.max(1, (c[id] || 1) + delta) }));
  };

  const handleSave = async () => {
    if (!selectedPlayers.length || isSaving || isSavingRef.current) return;
    if (!matchId && !comment.trim()) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await executeCatchBatch({
        selectedPlayers,
        state: batchStateRef.current,
        catchType,
        playerCounts,
        matchId,
        comment,
        getPlayerName: (pid) => activePlayers.find((p) => p.id === pid)?.name || null,
        recordCatch: store.recordCatch,
      });
      if (result.allSucceeded) {
        isSavingRef.current = false;
        resetBatchState();
        onClose();
      } else {
        setSaveError(result.errorMessage || "Failed to record catch. Please retry.");
      }
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const isValid = selectedPlayers.length > 0 && (matchId || comment.trim());

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
      onClick={handleClose}
    >
      <div
        className="bg-surface rounded-2xl p-5 max-w-md w-full border border-border space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-text-primary flex items-center gap-2">
            <Target className="w-5 h-5 text-emerald-700" />
            Record Catches
          </h3>
          <button
            onClick={handleClose}
            disabled={isSaving}
            className="text-text-muted hover:text-text-primary p-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2">
          <button
            disabled={isSaving}
            onClick={() => {
              if (isSavingRef.current || isSaving) return;
              resetBatchState();
              setCatchType("stunning");
            }}
            className={`flex-1 py-2 rounded-xl text-sm font-bold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
              catchType === "stunning"
                ? "bg-emerald-600 text-white"
                : "border border-border text-text-secondary hover:text-text-primary"
            }`}
          >
            Stunning Catch
          </button>
          <button
            disabled={isSaving}
            onClick={() => {
              if (isSavingRef.current || isSaving) return;
              resetBatchState();
              setCatchType("dropped");
            }}
            className={`flex-1 py-2 rounded-xl text-sm font-bold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
              catchType === "dropped"
                ? "bg-rose-600 text-white"
                : "border border-border text-text-secondary hover:text-text-primary"
            }`}
          >
            Dropped Catch
          </button>
        </div>

        <div>
          <label className="text-[10px] text-text-secondary uppercase tracking-widest mb-1 block font-bold">
            Match (optional)
          </label>
          <select
            value={matchId}
            disabled={isSaving}
            onChange={(e) => {
              if (isSavingRef.current || isSaving) return;
              resetBatchState();
              setMatchId(e.target.value);
            }}
            className="w-full bg-surface-hover border border-border rounded-xl px-2.5 py-2 text-sm text-text-primary disabled:opacity-60"
          >
            <option value="">— Select a match —</option>
            {recentMatches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.date ? format(parseISO(m.date), "dd MMM yyyy") : "No date"} — {m.opponent || "Match"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-text-secondary uppercase tracking-widest mb-1 block font-bold">
            Comment {!matchId && <span className="text-rose-600">(required if no match)</span>}
          </label>
          <input
            type="text"
            value={comment}
            disabled={isSaving}
            onChange={(e) => {
              if (isSavingRef.current || isSaving) return;
              resetBatchState();
              setComment(e.target.value);
            }}
            placeholder="e.g. Practice session"
            className="w-full bg-surface-hover border border-border rounded-xl px-3 py-2 text-sm text-text-primary disabled:opacity-60"
          />
        </div>

        <div>
          <label className="text-[10px] text-text-secondary uppercase tracking-widest mb-1 block font-bold">
            Select Players
          </label>
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              value={searchQ}
              disabled={isSaving}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search players..."
              className="w-full bg-surface-hover border border-border rounded-xl pl-8 pr-3 py-1.5 text-sm text-text-primary disabled:opacity-60"
            />
          </div>

          {selectedPlayers.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {selectedPlayers.map((pid) => {
                const p = activePlayers.find((x) => x.id === pid);
                return (
                  <span
                    key={pid}
                    className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-2 py-0.5 rounded-full"
                  >
                    {p?.name}
                    <span className="font-bold mx-1">x{playerCounts[pid] || 1}</span>
                    <button
                      className="flex items-center cursor-pointer disabled:opacity-40"
                      onClick={() => updateCount(pid, -1)}
                      disabled={isSaving || (playerCounts[pid] || 1) <= 1}
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <button
                      className="flex items-center cursor-pointer disabled:opacity-40"
                      onClick={() => updateCount(pid, 1)}
                      disabled={isSaving}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      disabled={isSaving}
                      onClick={() => {
                        if (isSavingRef.current || isSaving) return;
                        resetBatchState();
                        setSelectedPlayers((prev) => prev.filter((x) => x !== pid));
                      }}
                      className="ml-1 hover:text-text-primary cursor-pointer disabled:opacity-40"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div className="max-h-40 overflow-y-auto space-y-0.5 border border-border rounded-xl p-1">
            {filtered.map((p) => (
              <label
                key={p.id}
                className={`flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition text-xs ${
                  selectedPlayers.includes(p.id)
                    ? "bg-emerald-50 border border-emerald-200 text-text-primary"
                    : "hover:bg-surface-hover border border-transparent text-text-secondary"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={isSaving}
                  checked={selectedPlayers.includes(p.id)}
                  onChange={() => togglePlayer(p.id)}
                  className="accent-emerald-600"
                />
                <span className="truncate flex-1">{p.name}</span>
              </label>
            ))}
          </div>
        </div>

        {saveError && (
          <p className="text-xs font-semibold text-red-600" role="alert">
            {saveError}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={isSaving || !isValid}
          className={`w-full font-bold py-2.5 rounded-xl transition shadow flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
            catchType === "stunning"
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-accent text-text-accent hover:bg-accent/90"
          }`}
        >
          {isSaving
            ? "Saving..."
            : `Record ${catchType === "stunning" ? "Stunning" : "Dropped"} Catch for ${selectedPlayers.length} player(s)`}
        </button>
      </div>
    </div>
  );
}
