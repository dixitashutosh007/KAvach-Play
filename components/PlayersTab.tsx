/**
 * Roster & CRM Management (`components/PlayersTab.tsx`)
 *
 * Admin-only tab for adding, rejecting, or approving players to the club.
 * Provides a sortable list of all registered and pending players. Handles the
 * administrative duty of viewing player details, verifying new accounts, and
 * marking invites as either pending, rejected, or accepted.
 */
import { useStore } from "@/hooks/useStore";
import {
  PhoneCall,
  Send,
  Edit,
  MessageSquare,
  CheckCircle,
  UserX,
  UserCheck,
  Users,
  Calendar,
  Table2,
  X,
  UserPlus,
  Search,
  Layers,
  LayoutGrid,
  List,
  Download,
  ChevronRight,
} from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { useMemo, useRef, useState } from "react";
import { runBulkOperations } from "@/lib/bulk-operations";
import { DuplicatePlayersReport } from "./DuplicatePlayersReport";
import { PlayerBadgeRow } from "./BadgeIcon";
import { PlayerDetailsModal } from "./roster/PlayerDetailsModal";
import { classifyMatchPayment } from "@/lib/match-finance";
import {
  buildRosterCsv,
  computeRosterSummary,
  filterAndSortRoster,
  formatPlayingInfo,
  type RosterMembershipFilter,
  type RosterStatusFilter,
} from "@/lib/club-roster";
import { useFinancePlanAssignments } from "@/hooks/useFinancePlanAssignments";
import { PLAN_TYPE_LABEL, assignmentOn, legacyAssignmentsFor } from "@/lib/finance-plans";
import { getClubCalendarDate } from "@/lib/utils";
import { Player, MatchPayment, OtherFee } from "@/lib/types";
import { formatDate, dbToInputDate, inputToDbDate } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export function PlayersTab({
  store,
  persona,
  isStudioAdmin,
  autoOpenInvite,
}: {
  store: ReturnType<typeof useStore>;
  persona: string;
  isStudioAdmin?: boolean;
  autoOpenInvite?: boolean;
}) {
  const { toast } = useToast();
  const { confirm: confirmAction } = useConfirm();
  // We allow basic admin functions (adding/editing players) if they are any kind of admin,
  // but strictly, it might just be better to let all admins do basic directory edits,
  // or restrict it. Given the system, any admin (isStudioAdmin !== false) usually manages
  // the directory.
  const isAdmin = persona === "admin" && isStudioAdmin !== false;
  const [sortOption, setSortOption] = useState<
    "name" | "expiry" | "studio" | "due"
  >("name");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RosterStatusFilter>("all");
  const [membershipFilter, setMembershipFilter] = useState<RosterMembershipFilter>("all");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [visibleCount, setVisibleCount] = useState(25);
  const [selectedRosterIds, setSelectedRosterIds] = useState<string[]>([]);
  const [bulkRosterBusy, setBulkRosterBusy] = useState(false);
  const bulkRosterLockRef = useRef(false);
  // Current Finance Plan per player (admins only; read via the server API).
  const { assignments: planAssignments, loading: plansLoading, error: plansError } = useFinancePlanAssignments(isAdmin);
  // Only show plan info once it actually loaded (never a misleading "Regular").
  const showPlans = isAdmin && !plansLoading && !plansError;
  const planTodayKey = getClubCalendarDate().dateString;
  const currentPlanFor = (player: Player) => {
    const a = assignmentOn(
      [...planAssignments.filter((x) => x.playerId === player.id), ...legacyAssignmentsFor(player, store.feePlans || [])],
      player.id,
      planTodayKey,
    );
    if (!a) return null;
    const plan = (store.feePlans || []).find((p: any) => p.id === a.planId);
    return { name: a.planName, type: plan?.type, until: a.endDate, legacy: !!a.legacy };
  };
  const [viewMode, setViewMode] = useState<"list" | "grid" | "table">("list");

  // Add / Invite Player modal
  const [showInviteModal, setShowInviteModal] = useState(!!autoOpenInvite);
  const [modalMode, setModalMode] = useState<"add" | "invite">(autoOpenInvite ? "invite" : "add");
  const [inviteForm, setInviteForm] = useState({
    name: "",
    phone: "",
    email: "",
    battingStyle: "",
    isStudioMember: false,
  });
  const [standaloneInviteSending, setStandaloneInviteSending] = useState(false);
  const [standaloneInviteStatus, setStandaloneInviteStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [selectedPendingIds, setSelectedPendingIds] = useState<string[]>([]);
  const [bulkPendingBusy, setBulkPendingBusy] = useState(false);
  const bulkPendingLockRef = useRef(false);


  const getTotalDue = (playerId: string) => {
    const matchDues = store.payments
      .filter((p) => p.playerId === playerId && p.status === "Unpaid")
      .reduce((acc, p) => {
        const match = store.matches.find((m) => m.id === p.matchId);
        if (!match || match.result === "Abandoned") return acc;
        return acc + classifyMatchPayment(p, match.fee || 0).outstanding;
      }, 0);
    const otherDues = store.otherFees
      .filter((f) => f.playerId === playerId && f.status === "Unpaid")
      .reduce((acc, f) => acc + (f.amount || 0), 0);
    return matchDues + otherDues;
  };

  const pendingPlayers = store.players.filter(
    (p) => p.inviteStatus === "Pending" && !p.disabled,
  );
  const unverifiedPlayers = store.players.filter(
    (p) => p.inviteStatus === "Unverified" && !p.disabled,
  );
  const rosterSummary = useMemo(
    () => computeRosterSummary(store.players),
    [store.players],
  );
  const displayPlayers = useMemo(
    () =>
      filterAndSortRoster(store.players, {
        query: searchQuery,
        statusFilter,
        membershipFilter,
        sortOption,
        getTotalDue,
      }),
    [store.players, searchQuery, statusFilter, membershipFilter, sortOption, store.payments, store.otherFees, store.matches],
  );
  const pagedPlayers = displayPlayers.slice(0, visibleCount);
  const hasMorePlayers = displayPlayers.length > visibleCount;

  const getMembershipStatus = (player: Player) => {
    const expiryDateStr = player.studioExpiryDate || player.studioEndDate;
    if (!expiryDateStr) {
      return {
        status: "Expired",
        colorClass: "bg-red-500/10 text-red-400 border border-red-500/20",
        lineClass: "border-l-red-500 bg-red-500/5 border-red-500/20",
        label: "Expired (No date set)",
        daysLeft: -1,
      };
    }
    const expiryTime = new Date(expiryDateStr).setHours(23, 59, 59, 999);
    const nowTime = new Date().setHours(0, 0, 0, 0);
    const diffTime = expiryTime - nowTime;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        status: "Expired",
        colorClass: "bg-red-500/10 text-red-400 border border-red-500/20",
        lineClass: "border-l-red-500 bg-red-500/5 border-red-500/20",
        label: "Expired",
        daysLeft: diffDays,
      };
    } else if (diffDays <= 7) {
      return {
        status: "Expiring",
        colorClass:
          "bg-amber-500/10 text-orange-400 border border-orange-500/20",
        lineClass: "border-l-orange-500 bg-orange-500/5 border-orange-500/20",
        label: `Expiring in ${diffDays} day${diffDays === 1 ? "" : "s"}`,
        daysLeft: diffDays,
      };
    } else {
      return {
        status: "Active",
        colorClass:
          "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
        lineClass:
          "border-l-emerald-500 bg-emerald-500/5 border-emerald-500/20",
        label: `Active (${diffDays} days left)`,
        daysLeft: diffDays,
      };
    }
  };

  const handleExportCsv = () => {
    const csv = buildRosterCsv(displayPlayers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kavach-club-roster-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${displayPlayers.length} player(s) to CSV.`, "success");
  };

  const handleBulkStatusChange = async (disable: boolean) => {
    if (bulkRosterLockRef.current || bulkRosterBusy) return;
    const targets = displayPlayers.filter((p) => selectedRosterIds.includes(p.id));
    if (targets.length === 0) return;
    bulkRosterLockRef.current = true;
    try {
      const actionLabel = disable ? "Deactivate" : "Activate";
      if (
        !(await confirmAction({
          message: `${actionLabel} ${targets.length} selected player(s)?`,
          destructive: disable,
        }))
      ) {
        return;
      }
      setBulkRosterBusy(true);
      const { succeeded, failed } = await runBulkOperations(targets, async (pl) => {
        await store.updatePlayer(pl.id, {
          disabled: disable,
          disabledAt: disable ? new Date().toISOString() : undefined,
        });
      });
      if (failed.length === 0) {
        setSelectedRosterIds([]);
        toast(`${actionLabel}d ${succeeded.length} player(s).`, "success");
      } else {
        const failedIds = new Set(failed.map((f) => f.item.id));
        setSelectedRosterIds((prev) => prev.filter((id) => failedIds.has(id)));
        toast(`${actionLabel}d ${succeeded.length} player(s); ${failed.length} failed.`, "error");
      }
    } finally {
      setBulkRosterBusy(false);
      bulkRosterLockRef.current = false;
    }
  };

  return (
    <div className="space-y-4" data-testid="club-roster-screen">
      {/* Scarlet Sports-Tech Header Banner */}
      <div className="rounded-2xl bg-gradient-to-br from-[#A30F2D] to-[#7B0B22] text-white p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-black font-heading tracking-tight">
              Club Roster
            </h2>
            <p className="text-xs text-white/80 mt-0.5">
              Manage club players and memberships
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="roster-export-btn"
                onClick={handleExportCsv}
                className="min-h-[40px] px-3 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                title="Export filtered roster as CSV"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export</span>
              </button>
              <button
                type="button"
                data-testid="roster-add-player-btn"
                onClick={() => {
                  setModalMode("add");
                  setShowInviteModal(true);
                  setStandaloneInviteStatus(null);
                  setInviteForm({ name: "", phone: "", email: "", battingStyle: "", isStudioMember: false });
                }}
                className="min-h-[40px] px-3.5 rounded-xl bg-white text-[#A30F2D] hover:bg-[#FCE8ED] text-xs font-extrabold flex items-center gap-1.5 shadow cursor-pointer transition"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add Player
              </button>
            </div>
          )}
        </div>

        {/* 4 Summary KPI Cards */}
        <div className="grid grid-cols-4 gap-2" data-testid="roster-kpi-cards">
          <button
            type="button"
            onClick={() => { setStatusFilter("all"); setMembershipFilter("all"); }}
            className="rounded-xl bg-white text-[#171C26] p-2.5 text-center shadow-xs hover:bg-[#FCE8ED]/40 transition cursor-pointer"
          >
            <Users className="w-4 h-4 mx-auto text-[#A30F2D] mb-1" />
            <div className="text-lg sm:text-xl font-black leading-none tabular-nums" data-testid="kpi-total-players">
              {rosterSummary.totalPlayers}
            </div>
            <div className="text-[10px] font-semibold text-[#667085] mt-1">Players</div>
          </button>

          <button
            type="button"
            onClick={() => { setStatusFilter("active"); setMembershipFilter("all"); }}
            className="rounded-xl bg-emerald-50 text-[#171C26] p-2.5 text-center border border-emerald-200 hover:bg-emerald-100/70 transition cursor-pointer"
          >
            <UserCheck className="w-4 h-4 mx-auto text-[#15803D] mb-1" />
            <div className="text-lg sm:text-xl font-black leading-none tabular-nums text-[#15803D]" data-testid="kpi-active-players">
              {rosterSummary.activePlayers}
            </div>
            <div className="text-[10px] font-semibold text-[#15803D] mt-1">Active</div>
          </button>

          <button
            type="button"
            onClick={() => { setStatusFilter("active"); setMembershipFilter("studio"); }}
            className="rounded-xl bg-amber-50 text-[#171C26] p-2.5 text-center border border-amber-200 hover:bg-amber-100/70 transition cursor-pointer"
          >
            <Layers className="w-4 h-4 mx-auto text-[#D97706] mb-1" />
            <div className="text-lg sm:text-xl font-black leading-none tabular-nums text-[#B45309]" data-testid="kpi-studio-players">
              {rosterSummary.studioMembers}
            </div>
            <div className="text-[10px] font-semibold text-[#B45309] mt-1">Studio</div>
          </button>

          <button
            type="button"
            onClick={() => { setStatusFilter("inactive"); setMembershipFilter("all"); }}
            className="rounded-xl bg-rose-50 text-[#171C26] p-2.5 text-center border border-rose-200 hover:bg-rose-100/70 transition cursor-pointer"
          >
            <UserX className="w-4 h-4 mx-auto text-[#DC2626] mb-1" />
            <div className="text-lg sm:text-xl font-black leading-none tabular-nums text-[#DC2626]" data-testid="kpi-inactive-players">
              {rosterSummary.inactivePlayers}
            </div>
            <div className="text-[10px] font-semibold text-[#DC2626] mt-1">Inactive</div>
          </button>
        </div>
      </div>

      {/* Search & Filter Controls (No Admin Role Filters) */}
      <div className="bg-white rounded-2xl border border-border p-3 space-y-2.5 shadow-xs">
        <div className="relative">
          <Search className="w-4 h-4 text-[#667085] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            data-testid="roster-search-input"
            placeholder="Search by name or Player ID (e.g. KAV0123)"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setVisibleCount(25);
            }}
            className="w-full min-h-[42px] bg-[#F6F7F9] border border-border text-[#171C26] text-xs sm:text-sm rounded-xl pl-9 pr-3 outline-none focus:border-[#D51F43]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by Status"
            data-testid="roster-status-filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as RosterStatusFilter);
              setVisibleCount(25);
            }}
            className="min-h-[38px] bg-[#F6F7F9] border border-border text-[#171C26] text-xs font-semibold rounded-xl px-2.5 outline-none focus:border-[#D51F43] cursor-pointer"
          >
            <option value="all">Status: All</option>
            <option value="active">Status: Active</option>
            <option value="inactive">Status: Inactive</option>
          </select>

          <select
            aria-label="Filter by Membership"
            data-testid="roster-membership-filter"
            value={membershipFilter}
            onChange={(e) => {
              setMembershipFilter(e.target.value as RosterMembershipFilter);
              setVisibleCount(25);
            }}
            className="min-h-[38px] bg-[#F6F7F9] border border-border text-[#171C26] text-xs font-semibold rounded-xl px-2.5 outline-none focus:border-[#D51F43] cursor-pointer"
          >
            <option value="all">Membership: All</option>
            <option value="studio">Membership: Studio</option>
            <option value="regular">Membership: Regular</option>
          </select>

          <select
            aria-label="Sort players"
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as any)}
            className="min-h-[38px] bg-[#F6F7F9] border border-border text-[#171C26] text-xs font-semibold rounded-xl px-2.5 outline-none focus:border-[#D51F43] cursor-pointer"
          >
            <option value="name">Sort: Name</option>
            <option value="expiry">Sort: Expiry Date</option>
            <option value="studio">Sort: Studio Member</option>
            <option value="due">Sort: Due Amount</option>
          </select>

          {isAdmin && (
            <div className="ml-auto hidden sm:flex items-center bg-[#F6F7F9] border border-border rounded-xl p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-label="List view"
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer ${
                  viewMode === "list" ? "bg-white text-[#A30F2D] shadow-xs" : "text-[#667085]"
                }`}
              >
                <List className="w-3.5 h-3.5" /> List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                aria-label="Grid view"
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer ${
                  viewMode === "grid" ? "bg-white text-[#A30F2D] shadow-xs" : "text-[#667085]"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                aria-label="Bulk edit table"
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer ${
                  viewMode === "table" ? "bg-white text-[#A30F2D] shadow-xs" : "text-[#667085]"
                }`}
              >
                <Table2 className="w-3.5 h-3.5" /> Bulk Edit
              </button>
            </div>
          )}
        </div>

        {/* Bulk Selection Bar */}
        {isAdmin && selectedRosterIds.length > 0 && (
          <div
            data-testid="roster-bulk-bar"
            className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border"
          >
            <span className="text-xs font-bold text-[#171C26]">
              {selectedRosterIds.length} player(s) selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={bulkRosterBusy}
                onClick={() => handleBulkStatusChange(false)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                Activate
              </button>
              <button
                type="button"
                disabled={bulkRosterBusy}
                onClick={() => handleBulkStatusChange(true)}
                className="px-3 py-1.5 rounded-lg bg-red-50 text-[#DC2626] border border-red-200 text-xs font-bold hover:bg-red-100 disabled:opacity-50 cursor-pointer"
              >
                Deactivate
              </button>
              <button
                type="button"
                onClick={() => setSelectedRosterIds([])}
                className="px-2.5 py-1.5 text-xs font-semibold text-[#667085] hover:text-[#171C26] cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {isAdmin && <DuplicatePlayersReport store={store} />}

      <>
        {isAdmin && pendingPlayers.length > 0 && (
          <div className="space-y-2 mb-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-bold uppercase tracking-widest text-accent flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                </span>
                Pending Approvals ({pendingPlayers.length})
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    const allIds = pendingPlayers.map((p) => p.id);
                    const allSelected = allIds.every((id) => selectedPendingIds.includes(id));
                    setSelectedPendingIds(allSelected ? [] : allIds);
                  }}
                  className="text-xs font-bold text-brand hover:underline cursor-pointer"
                >
                  {pendingPlayers.every((p) => selectedPendingIds.includes(p.id))
                    ? "Deselect all"
                    : "Select all"}
                </button>
                {selectedPendingIds.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedPendingIds([])}
                      className="text-xs font-bold text-text-secondary hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      disabled={bulkPendingBusy}
                      onClick={async () => {
                        if (bulkPendingLockRef.current || bulkPendingBusy) return;
                        const targets = pendingPlayers.filter((p) => selectedPendingIds.includes(p.id));
                        if (targets.length === 0) return;
                        bulkPendingLockRef.current = true;
                        try {
                          if (!(await confirmAction({ message: `Approve ${targets.length} selected registration request(s)?` }))) return;
                          setBulkPendingBusy(true);
                          const { succeeded, failed } = await runBulkOperations(targets, async (pl) => {
                            await store.updatePlayer(pl.id, { inviteStatus: "Verified" });
                          });
                          if (failed.length === 0) {
                            setSelectedPendingIds([]);
                            toast(`Approved ${succeeded.length} player(s).`, "success");
                          } else {
                            const failedIds = new Set(failed.map((f) => f.item.id));
                            setSelectedPendingIds((prev) => prev.filter((id) => failedIds.has(id)));
                            toast(`Approved ${succeeded.length} player(s); ${failed.length} failed.`, "error");
                          }
                        } finally {
                          setBulkPendingBusy(false);
                          bulkPendingLockRef.current = false;
                        }
                      }}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition cursor-pointer"
                    >
                      Approve Selected ({selectedPendingIds.length})
                    </button>
                    <button
                      type="button"
                      disabled={bulkPendingBusy}
                      onClick={async () => {
                        if (bulkPendingLockRef.current || bulkPendingBusy) return;
                        const targets = pendingPlayers.filter((p) => selectedPendingIds.includes(p.id));
                        if (targets.length === 0) return;
                        bulkPendingLockRef.current = true;
                        try {
                          if (!(await confirmAction({ message: `Decline ${targets.length} selected registration request(s)?`, destructive: true }))) return;
                          setBulkPendingBusy(true);
                          const { succeeded, failed } = await runBulkOperations(targets, async (pl) => {
                            await store.updatePlayer(pl.id, {
                              inviteStatus: "Rejected",
                              rejectedAt: new Date().toISOString(),
                            });
                          });
                          if (failed.length === 0) {
                            setSelectedPendingIds([]);
                            toast(`Declined ${succeeded.length} request(s).`, "success");
                          } else {
                            const failedIds = new Set(failed.map((f) => f.item.id));
                            setSelectedPendingIds((prev) => prev.filter((id) => failedIds.has(id)));
                            toast(`Declined ${succeeded.length} request(s); ${failed.length} failed.`, "error");
                          }
                        } finally {
                          setBulkPendingBusy(false);
                          bulkPendingLockRef.current = false;
                        }
                      }}
                      className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 transition cursor-pointer"
                    >
                      Reject Selected ({selectedPendingIds.length})
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="bg-surface rounded-xl overflow-hidden divide-y divide-border border border-accent/25">
              {pendingPlayers.map((player) => (
                <div
                  key={player.id}
                  className="flex flex-col hover:bg-surface-hover transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${player.name}`}
                        checked={selectedPendingIds.includes(player.id)}
                        onChange={() =>
                          setSelectedPendingIds((prev) =>
                            prev.includes(player.id)
                              ? prev.filter((x) => x !== player.id)
                              : [...prev, player.id],
                          )
                        }
                        className="w-4 h-4 accent-brand shrink-0 cursor-pointer"
                      />
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 font-bold text-accent shrink-0">
                        {player.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-text-primary text-[15px] truncate">
                          {player.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-secondary">
                          <span className="flex items-center gap-1">
                            <PhoneCall className="h-3 w-3 shrink-0" />
                            {player.mobile}
                          </span>
                          {player.locality && (
                            <span className="text-text-muted">
                              • {player.locality}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        onClick={() => {
                          store.updatePlayer(player.id, {
                            inviteStatus: "Verified",
                          });
                        }}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition cursor-pointer"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Approve
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            await confirmAction({ message: `Decline registration request for ${player.name}? This will notify them via email and they can retry after 3 days.`, })
                          ) {
                            await store.updatePlayer(player.id, {
                              inviteStatus: "Rejected",
                              rejectedAt: new Date().toISOString(),
                            });
                          }
                        }}
                        className="rounded-lg bg-red-500/10 px-3 py-1.5 text-red-400 border border-red-500/20 hover:bg-red-500/20 text-xs font-bold transition cursor-pointer"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isAdmin && unverifiedPlayers.length > 0 && (
          <div className="space-y-2 mb-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-yellow-400/80 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-400/60"></span>
              </span>
              Incomplete Registrations ({unverifiedPlayers.length})
            </h3>
            <p className="text-[11px] text-text-muted -mt-1">
              These players signed in but haven&apos;t completed their profile yet.
            </p>
            <div className="bg-surface rounded-xl overflow-hidden divide-y divide-border border border-yellow-500/20">
              {unverifiedPlayers.map((player) => (
                <div
                  key={player.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 hover:bg-surface-hover transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/20 font-bold text-yellow-400 shrink-0">
                      {player.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary text-[15px] truncate">
                        {player.name}
                      </p>
                      <p className="text-[11px] text-text-muted">Profile incomplete</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      onClick={() => {
                        store.updatePlayer(player.id, { inviteStatus: "Verified" });
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-500/80 px-3 py-1.5 text-xs font-bold text-black hover:bg-emerald-400 transition cursor-pointer"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      Approve Anyway
                    </button>
                    <button
                      onClick={async () => {
                        if (await confirmAction({ message: `Remove incomplete registration for ${player.name}?`, destructive: true })) {
                          await store.deletePlayer(player.id);
                        }
                      }}
                      className="rounded-lg bg-red-500/10 px-3 py-1.5 text-red-400 border border-red-500/20 hover:bg-red-500/20 text-xs font-bold transition cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {viewMode === "table" && isAdmin ? (
          <BulkEditTable store={store} players={displayPlayers} />
        ) : viewMode === "grid" && isAdmin ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="roster-grid-view">
            {pagedPlayers.map((player) => {
              const hasPhoto = typeof player.photoURL === "string" && player.photoURL.startsWith("https://");
              return (
                <div
                  key={player.id}
                  data-testid={`roster-player-card-${player.id}`}
                  onClick={() => setSelectedPlayer(player)}
                  className="bg-white rounded-2xl border border-border p-4 hover:border-[#D51F43]/40 transition cursor-pointer flex flex-col gap-3 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        aria-label={`Select ${player.name}`}
                        checked={selectedRosterIds.includes(player.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() =>
                          setSelectedRosterIds((prev) =>
                            prev.includes(player.id) ? prev.filter((x) => x !== player.id) : [...prev, player.id],
                          )
                        }
                        className="w-4 h-4 accent-[#D51F43] shrink-0 cursor-pointer"
                      />
                      {hasPhoto ? (
                        <img src={player.photoURL} alt={player.name} className="w-11 h-11 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center font-black shrink-0">
                          {player.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-bold text-[#171C26] text-sm truncate">{player.name}</p>
                        <p className="text-[11px] font-mono text-[#667085] truncate">
                          Player ID: {player.kavachId || "Pending"}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-[#667085] truncate">{formatPlayingInfo(player)}</p>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${player.isStudioMember ? "bg-[#FCE8ED] text-[#A30F2D]" : "bg-[#F6F7F9] text-[#667085]"}`}>
                      {player.isStudioMember ? "Studio" : "Regular"}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${player.disabled ? "bg-red-50 text-[#DC2626]" : "bg-emerald-50 text-[#15803D]"}`}>
                      {player.disabled ? "Inactive" : "Active"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <div className="bg-white rounded-2xl border border-border overflow-hidden divide-y divide-border shadow-xs" data-testid="roster-list-view">
          {displayPlayers.length === 0 && (
            <div data-testid="empty-players-roster" className="py-12 text-center text-sm text-text-muted space-y-2">
              <div className="w-10 h-10 rounded-full bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center mx-auto">
                <Users className="w-5 h-5" />
              </div>
              <p className="font-bold text-[#171C26] text-xs uppercase tracking-wider">No Players Found</p>
              <p className="text-[11px] text-[#667085] max-w-xs mx-auto">
                {searchQuery ? "No members match your search criteria. Try a different name or Player ID." : "No players match the current roster filter."}
              </p>
            </div>
          )}
          {pagedPlayers.map((player) => {
            const hasPhoto = typeof player.photoURL === "string" && player.photoURL.startsWith("https://");
            return (
            <div
              key={player.id}
              data-testid={`roster-player-row-${player.id}`}
              className="flex items-center justify-between gap-3 p-3.5 sm:px-4 hover:bg-[#F6F7F9]/70 transition cursor-pointer"
              onClick={() => setSelectedPlayer(player)}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {isAdmin && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${player.name}`}
                    checked={selectedRosterIds.includes(player.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() =>
                      setSelectedRosterIds((prev) =>
                        prev.includes(player.id) ? prev.filter((x) => x !== player.id) : [...prev, player.id],
                      )
                    }
                    className="w-4 h-4 accent-[#D51F43] shrink-0 cursor-pointer"
                  />
                )}
                {hasPhoto ? (
                  <img src={player.photoURL} alt={player.name} className="w-11 h-11 rounded-full object-cover shrink-0 border border-border" />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FCE8ED] font-black text-[#A30F2D] shrink-0">
                    {player.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[#171C26] text-sm sm:text-[15px] truncate">
                    {player.name}
                  </p>
                  <p className="text-[11px] font-mono text-[#667085] truncate">
                    Player ID: {player.kavachId || "Pending"}
                  </p>
                  <p className="text-[11px] text-[#667085] truncate mt-0.5">
                    {formatPlayingInfo(player)}
                    {showPlans && (() => {
                      const fp = currentPlanFor(player);
                      return ` · ${fp ? fp.name : "Regular Plan"}`;
                    })()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      player.isStudioMember
                        ? "bg-[#FCE8ED] text-[#A30F2D] border border-[#A30F2D]/20"
                        : "bg-[#F6F7F9] text-[#667085] border border-border"
                    }`}
                  >
                    <Layers className="w-2.5 h-2.5" />
                    {player.isStudioMember ? "Studio" : "Regular"}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      player.disabled
                        ? "bg-red-50 text-[#DC2626] border border-red-200"
                        : "bg-emerald-50 text-[#15803D] border border-emerald-200"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${player.disabled ? "bg-[#DC2626]" : "bg-[#15803D]"}`} />
                    {player.disabled ? "Inactive" : "Active"}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-[#667085]" />
              </div>
            </div>
            );
          })}
        </div>
        )}

        {viewMode !== "table" && hasMorePlayers && (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + 25)}
              className="min-h-[40px] px-4 rounded-xl bg-white border border-border text-xs font-bold text-[#A30F2D] hover:bg-[#FCE8ED]/40 cursor-pointer transition"
            >
              Show more ({displayPlayers.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </>

      {selectedPlayer && (
        <PlayerDetailsModal
          store={store}
          player={store.players.find((p) => p.id === selectedPlayer.id) || selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          isAdmin={isAdmin}
          planSummary={showPlans ? currentPlanFor(selectedPlayer) : null}
        />
      )}

      {/* Add / Invite Player Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-border rounded-2xl p-5 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-[#A30F2D] font-extrabold text-base">
                <UserPlus className="w-5 h-5" /> {modalMode === "add" ? "Add Player" : "Invite Player"}
              </div>
              <button
                onClick={() => { setShowInviteModal(false); setStandaloneInviteSending(false); }}
                className="text-[#667085] hover:text-[#171C26] p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex bg-[#F6F7F9] p-1 rounded-xl border border-border">
              <button
                type="button"
                onClick={() => { setModalMode("add"); setStandaloneInviteStatus(null); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${modalMode === "add" ? "bg-[#D51F43] text-white" : "text-[#667085]"}`}
              >
                Add Directly
              </button>
              <button
                type="button"
                onClick={() => { setModalMode("invite"); setStandaloneInviteStatus(null); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${modalMode === "invite" ? "bg-[#D51F43] text-white" : "text-[#667085]"}`}
              >
                WhatsApp Invite
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#667085] mb-1">Name *</label>
                <input
                  type="text"
                  data-testid="add-player-name-input"
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Player name"
                  className="w-full bg-[#F6F7F9] border border-border rounded-xl px-3 py-2 text-xs text-[#171C26] focus:outline-none focus:border-[#D51F43]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#667085] mb-1">Phone Number *</label>
                <input
                  type="tel"
                  data-testid="add-player-phone-input"
                  value={inviteForm.phone}
                  onChange={(e) => setInviteForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="e.g. 9876543210"
                  className="w-full bg-[#F6F7F9] border border-border rounded-xl px-3 py-2 text-xs text-[#171C26] focus:outline-none focus:border-[#D51F43]"
                />
              </div>
              {modalMode === "add" && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#667085] mb-1">Email (optional)</label>
                    <input
                      type="email"
                      value={inviteForm.email}
                      onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="player@email.com"
                      className="w-full bg-[#F6F7F9] border border-border rounded-xl px-3 py-2 text-xs text-[#171C26] focus:outline-none focus:border-[#D51F43]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#667085] mb-1">Cricket Role</label>
                    <select
                      value={inviteForm.battingStyle}
                      onChange={(e) => setInviteForm((f) => ({ ...f, battingStyle: e.target.value }))}
                      className="w-full bg-[#F6F7F9] border border-border rounded-xl px-3 py-2 text-xs text-[#171C26] focus:outline-none focus:border-[#D51F43]"
                    >
                      {BATTING_STYLE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt || "Select role..."}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            {modalMode === "add" && (
              <label className="flex items-center gap-2 text-xs font-semibold text-[#171C26] cursor-pointer">
                <input
                  type="checkbox"
                  checked={inviteForm.isStudioMember}
                  onChange={(e) => setInviteForm((f) => ({ ...f, isStudioMember: e.target.checked }))}
                  className="accent-[#D51F43]"
                />
                Studio Member
              </label>
            )}

            {standaloneInviteStatus && (
              <div className={`text-xs px-3 py-2 rounded-lg font-semibold ${standaloneInviteStatus.ok ? "bg-emerald-50 text-[#15803D] border border-emerald-200" : "bg-red-50 text-[#DC2626] border border-red-200"}`}>
                {standaloneInviteStatus.msg}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => { setShowInviteModal(false); setStandaloneInviteSending(false); setStandaloneInviteStatus(null); }}
                className="px-4 py-2 text-xs font-semibold text-[#667085] hover:text-[#171C26] cursor-pointer"
              >
                Cancel
              </button>
              {modalMode === "add" ? (
                <button
                  type="button"
                  data-testid="add-player-submit-btn"
                  disabled={standaloneInviteSending || !inviteForm.name.trim() || !inviteForm.phone.trim()}
                  onClick={async () => {
                    const cleanName = inviteForm.name.trim();
                    const cleanPhone = inviteForm.phone.replace(/\D/g, "").slice(-10);
                    const cleanEmail = inviteForm.email.trim().toLowerCase();
                    if (!cleanName || cleanPhone.length < 10) {
                      toast("Enter a valid player name and 10-digit mobile number.", "error");
                      return;
                    }
                    const dup = store.players.find(
                      (p) =>
                        !p.mergedInto &&
                        ((p.mobile && p.mobile.replace(/\D/g, "").slice(-10) === cleanPhone) ||
                          (cleanEmail && p.email?.toLowerCase() === cleanEmail)),
                    );
                    if (dup) {
                      setStandaloneInviteStatus({ ok: false, msg: `Player already exists: ${dup.name} (${dup.mobile}).` });
                      return;
                    }
                    setStandaloneInviteSending(true);
                    try {
                      await store.addPlayer({
                        name: cleanName,
                        mobile: cleanPhone,
                        ...(cleanEmail ? { email: cleanEmail } : {}),
                        ...(inviteForm.battingStyle ? { battingStyle: inviteForm.battingStyle } : {}),
                        isStudioMember: inviteForm.isStudioMember,
                        inviteStatus: "Verified",
                      });
                      toast(`Added ${cleanName} to Club Roster.`, "success");
                      setShowInviteModal(false);
                    } catch (err: any) {
                      setStandaloneInviteStatus({ ok: false, msg: err?.message || "Failed to add player." });
                    } finally {
                      setStandaloneInviteSending(false);
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#D51F43] hover:bg-[#A30F2D] disabled:opacity-50 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" /> {standaloneInviteSending ? "Adding..." : "Add Player"}
                </button>
              ) : (
                <button
                  onClick={async () => {
                    if (!inviteForm.phone.trim()) { toast("Please enter a phone number.", "error"); return; }
                    setStandaloneInviteSending(true);
                    setStandaloneInviteStatus(null);
                    try {
                      const res = await authedFetch("/api/whatsapp/invite", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          to: inviteForm.phone,
                          playerName: inviteForm.name || "Player",
                        }),
                      });
                      const resData = await res.json().catch(() => ({}));
                      if (res.ok) {
                        setStandaloneInviteStatus({ ok: true, msg: `Invite sent to ${inviteForm.name || inviteForm.phone} via WhatsApp!` });
                        setTimeout(() => { setShowInviteModal(false); setStandaloneInviteStatus(null); }, 8000);
                      } else {
                        setStandaloneInviteStatus({ ok: false, msg: resData.error || "Failed to send invite. Please check WhatsApp API settings." });
                      }
                    } catch {
                      setStandaloneInviteStatus({ ok: false, msg: "Network error. Please try again." });
                    }
                    setStandaloneInviteSending(false);
                  }}
                  disabled={standaloneInviteSending || !inviteForm.phone.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#D51F43] hover:bg-[#A30F2D] disabled:opacity-50 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" /> {standaloneInviteSending ? "Sending..." : "Send Invite"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

const BATTING_STYLE_OPTIONS = [
  "",
  "Right-hand bat",
  "Left-hand bat",
  "Right-arm medium",
  "Right-arm fast",
  "Left-arm medium",
  "Left-arm fast",
  "Right-arm spin",
  "Left-arm spin",
  "All-rounder",
];

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
);
const YEARS = Array.from({ length: 12 }, (_, i) => String(2015 + i));

function BulkEditTable({
  store,
  players,
}: {
  store: ReturnType<typeof useStore>;
  players: Player[];
}) {
  const [dirty, setDirty] = useState<Map<string, Partial<Player>>>(new Map());
  const [saving, setSaving] = useState(false);

  const getVal = (player: Player, field: keyof Player) => {
    const dirtyRow = dirty.get(player.id);
    if (dirtyRow && field in dirtyRow) return (dirtyRow as any)[field];
    return (player as any)[field];
  };

  const setField = (playerId: string, field: keyof Player, value: any) => {
    setDirty((prev) => {
      const next = new Map(prev);
      const existing = next.get(playerId) || {};
      next.set(playerId, { ...existing, [field]: value });
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const entries = Array.from(dirty.entries());
      for (const [id, changes] of entries) {
        await store.updatePlayer(id, changes);
      }
      setDirty(new Map());
    } finally {
      setSaving(false);
    }
  };

  const parseKavachMonth = (val?: string) => (val ? val.split("/")[0] || "" : "");
  const parseKavachYear = (val?: string) => (val ? val.split("/")[1] || "" : "");

  const setKavachJoiningPart = (
    playerId: string,
    player: Player,
    part: "month" | "year",
    value: string,
  ) => {
    const current = getVal(player, "kavachJoining") as string | undefined;
    const month = part === "month" ? value : parseKavachMonth(current);
    const year = part === "year" ? value : parseKavachYear(current);
    if (month && year) {
      setField(playerId, "kavachJoining", `${month}/${year}`);
    } else if (!month && !year) {
      setField(playerId, "kavachJoining", "");
    } else {
      // Partial — store what we have so the other dropdown keeps its value
      setField(playerId, "kavachJoining", `${month}/${year}`);
    }
  };

  const inputClass =
    "bg-transparent border-none text-text-primary text-xs focus:bg-surface-hover focus:outline-none px-2 py-1.5 w-full";
  const selectClass =
    "bg-transparent border-none text-text-primary text-xs focus:bg-surface-hover focus:outline-none px-1 py-1.5 appearance-none cursor-pointer";

  return (
    <>
      <div className="bg-surface rounded-xl overflow-hidden border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px] border-collapse">
            <thead>
              <tr className="bg-black/60 text-text-secondary text-[10px] uppercase tracking-wider">
                <th className="text-left px-2 py-2 font-bold">Name</th>
                <th className="text-left px-2 py-2 font-bold">Phone</th>
                <th className="text-left px-2 py-2 font-bold">Role</th>
                <th className="text-center px-2 py-2 font-bold">WK</th>
                <th className="text-left px-2 py-2 font-bold">Jersey#</th>
                <th className="text-left px-2 py-2 font-bold">KAvach Joining</th>
                <th className="text-right px-2 py-2 font-bold">Runs</th>
                <th className="text-right px-2 py-2 font-bold">Wkts</th>
                <th className="text-right px-2 py-2 font-bold">Catch</th>
                <th className="text-right px-2 py-2 font-bold">Drop</th>
                <th className="text-left px-2 py-2 font-bold">Emergency</th>
                <th className="text-center px-2 py-2 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {players.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-sm text-text-muted">
                    No players to display.
                  </td>
                </tr>
              )}
              {players.map((player) => (
                <tr key={player.id} className="border-b border-border hover:bg-white/[0.03] transition">
                  <td className="bg-transparent px-0">
                    <input
                      type="text"
                      value={getVal(player, "name") ?? ""}
                      onChange={(e) => setField(player.id, "name", e.target.value)}
                      className={inputClass}
                    />
                  </td>
                  <td className="bg-transparent px-0">
                    <input
                      type="text"
                      value={getVal(player, "mobile") ?? ""}
                      onChange={(e) => setField(player.id, "mobile", e.target.value)}
                      className={inputClass}
                    />
                  </td>
                  <td className="bg-transparent px-0">
                    <select
                      value={getVal(player, "battingStyle") ?? ""}
                      onChange={(e) => setField(player.id, "battingStyle", e.target.value)}
                      className={selectClass}
                    >
                      {BATTING_STYLE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt} className="bg-surface text-text-primary">
                          {opt || "-- Select --"}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="bg-transparent text-center px-0">
                    <input
                      type="checkbox"
                      checked={!!getVal(player, "isWicketKeeper")}
                      onChange={(e) => setField(player.id, "isWicketKeeper", e.target.checked)}
                      className="accent-accent w-3.5 h-3.5 cursor-pointer"
                    />
                  </td>
                  <td className="bg-transparent px-0">
                    <input
                      type="text"
                      maxLength={3}
                      value={getVal(player, "jerseyNumber") ?? ""}
                      onChange={(e) => setField(player.id, "jerseyNumber", e.target.value)}
                      className={`${inputClass} max-w-[50px]`}
                    />
                  </td>
                  <td className="bg-transparent px-1">
                    <div className="flex items-center gap-1">
                      <select
                        value={parseKavachMonth(getVal(player, "kavachJoining") as string | undefined)}
                        onChange={(e) => setKavachJoiningPart(player.id, player, "month", e.target.value)}
                        className={`${selectClass} w-[52px]`}
                      >
                        <option value="" className="bg-surface text-text-primary">MM</option>
                        {MONTHS.map((m) => (
                          <option key={m} value={m} className="bg-surface text-text-primary">{m}</option>
                        ))}
                      </select>
                      <span className="text-text-primary/30 text-xs">/</span>
                      <select
                        value={parseKavachYear(getVal(player, "kavachJoining") as string | undefined)}
                        onChange={(e) => setKavachJoiningPart(player.id, player, "year", e.target.value)}
                        className={`${selectClass} w-[62px]`}
                      >
                        <option value="" className="bg-surface text-text-primary">YYYY</option>
                        {YEARS.map((y) => (
                          <option key={y} value={y} className="bg-surface text-text-primary">{y}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="bg-transparent px-0">
                    <input
                      type="number"
                      min={0}
                      value={getVal(player, "totalRuns") ?? ""}
                      onChange={(e) => setField(player.id, "totalRuns", e.target.value ? Number(e.target.value) : undefined)}
                      className={`${inputClass} max-w-[70px] text-right`}
                      placeholder="—"
                    />
                  </td>
                  <td className="bg-transparent px-0">
                    <input
                      type="number"
                      min={0}
                      value={getVal(player, "totalWickets") ?? ""}
                      onChange={(e) => setField(player.id, "totalWickets", e.target.value ? Number(e.target.value) : undefined)}
                      className={`${inputClass} max-w-[70px] text-right`}
                      placeholder="—"
                    />
                  </td>
                  <td className="bg-transparent px-0">
                    <input
                      type="number"
                      min={0}
                      value={getVal(player, "stunningCatches") ?? ""}
                      onChange={(e) => setField(player.id, "stunningCatches", e.target.value ? Number(e.target.value) : undefined)}
                      className={`${inputClass} max-w-[60px] text-right`}
                      placeholder="—"
                    />
                  </td>
                  <td className="bg-transparent px-0">
                    <input
                      type="number"
                      min={0}
                      value={getVal(player, "droppedCatches") ?? ""}
                      onChange={(e) => setField(player.id, "droppedCatches", e.target.value ? Number(e.target.value) : undefined)}
                      className={`${inputClass} max-w-[60px] text-right`}
                      placeholder="—"
                    />
                  </td>
                  <td className="bg-transparent px-0">
                    <input
                      type="text"
                      value={getVal(player, "emergencyContact") ?? ""}
                      onChange={(e) => setField(player.id, "emergencyContact", e.target.value)}
                      className={inputClass}
                    />
                  </td>
                  <td className="bg-transparent text-center px-2">
                    {player.disabled ? (
                      <span className="inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        Deactivated
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        Active
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {dirty.size > 0 && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-accent text-text-accent font-bold px-6 py-3 rounded-xl shadow-lg z-50 hover:bg-accent/90 transition disabled:opacity-50"
        >
          {saving ? "Saving..." : `Save Changes (${dirty.size})`}
        </button>
      )}
    </>
  );
}
