"use client";

import { useMemo, useState } from "react";
import {
  Award,
  BarChart3,
  Calendar,
  Check,
  Copy,
  Edit3,
  FileText,
  Layers,
  PhoneCall,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { PlayerBadgeRow } from "@/components/BadgeIcon";
import { EditPlayerInline } from "@/components/EditPlayerInline";
import { classifyMatchPayment, isRealMoneyPayment } from "@/lib/match-finance";
import { formatPlayingInfo, formatWhatsAppHref } from "@/lib/club-roster";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { MatchPayment, OtherFee, Player } from "@/lib/types";

export function PlayerDetailsModal({
  store,
  player,
  onClose,
  isAdmin,
  canViewFinance = false,
  planSummary,
}: {
  store: ReturnType<typeof useStore>;
  player: Player;
  onClose: () => void;
  isAdmin: boolean;
  /** True ONLY for Finance Admin and Super Admin (ROSTER-R1). */
  canViewFinance?: boolean;
  planSummary?: { name: string; type?: string; until?: string | null; legacy?: boolean } | null;
}) {
  const { toast } = useToast();
  const { confirm: confirmAction } = useConfirm();
  const [tab, setTab] = useState<"overview" | "membership" | "activity">("overview");
  const [editing, setEditing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [paidVisibleCount, setPaidVisibleCount] = useState(5);

  const matchPayments = useMemo(
    () => store.payments.filter((p) => p.playerId === player.id),
    [store.payments, player.id],
  );
  const otherFees = useMemo(
    () => store.otherFees.filter((f) => f.playerId === player.id),
    [store.otherFees, player.id],
  );

  const unpaidMatchPayments = useMemo(
    () =>
      matchPayments.filter((p) => {
        const m = store.matches.find((mx) => mx.id === p.matchId);
        if (!m || m.result === "Abandoned") return false;
        return classifyMatchPayment(p, m.fee || 0).outstanding > 0;
      }),
    [matchPayments, store.matches],
  );
  const paidMatchPayments = useMemo(
    () => matchPayments.filter((p) => p.status === "Paid"),
    [matchPayments],
  );
  const unpaidOtherFees = useMemo(
    () => otherFees.filter((f) => f.status === "Unpaid"),
    [otherFees],
  );
  const paidOtherFees = useMemo(
    () => otherFees.filter((f) => f.status === "Paid"),
    [otherFees],
  );

  const allPaidItems = useMemo(
    () => [
      ...paidMatchPayments.map((p) => ({ kind: "match" as const, item: p })),
      ...paidOtherFees.map((f) => ({ kind: "other" as const, item: f })),
    ],
    [paidMatchPayments, paidOtherFees],
  );
  const visiblePaidItems = allPaidItems.slice(0, paidVisibleCount);
  const hasMorePaid = allPaidItems.length > paidVisibleCount;

  const totalDue = useMemo(() => {
    let sum = 0;
    for (const p of unpaidMatchPayments) {
      const m = store.matches.find((mx) => mx.id === p.matchId);
      if (m) sum += classifyMatchPayment(p, m.fee || 0).outstanding;
    }
    for (const f of unpaidOtherFees) {
      sum += f.amount || 0;
    }
    return sum;
  }, [unpaidMatchPayments, unpaidOtherFees, store.matches]);

  const matchesPlayedCount = useMemo(
    () =>
      matchPayments.filter((p) => p.status !== "Not Playing" && String(p.status) !== "Cancelled").length,
    [matchPayments],
  );

  const playerBadges = useMemo(
    () => store.badges.filter((b) => b.playerId === player.id),
    [store.badges, player.id],
  );

  const statSummary = useMemo(() => {
    const yearly = (store.playerStats || []).filter((s) => s.playerId === player.id);
    const runsFromYearly = yearly.reduce((acc, s) => acc + (s.runs || 0), 0);
    const wicketsFromYearly = yearly.reduce((acc, s) => acc + (s.wickets || 0), 0);
    return {
      runs: player.totalRuns ?? runsFromYearly,
      wickets: player.totalWickets ?? wicketsFromYearly,
      catches: player.stunningCatches ?? 0,
    };
  }, [store.playerStats, player]);

  const availableDocsCount = useMemo(() => {
    let count = 0;
    if (player.kavachId) count++;
    if (player.mobile) count++;
    if (player.email) count++;
    if (player.dob) count++;
    if (player.emergencyContact) count++;
    return count;
  }, [player]);

  const handleCopyId = async () => {
    if (!player.kavachId) return;
    try {
      await navigator.clipboard.writeText(player.kavachId);
      setCopiedId(true);
      toast(`Copied Player ID: ${player.kavachId}`, "success");
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      toast("Could not copy Player ID.", "error");
    }
  };

  const handleToggleActive = async () => {
    if (player.disabled) {
      if (
        await confirmAction({
          message: `Activate ${player.name}? They will appear in match squads and fee lists again.`,
        })
      ) {
        await store.updatePlayer(player.id, { disabled: false, disabledAt: undefined });
        toast(`${player.name} activated.`, "success");
        onClose();
      }
    } else if (
      await confirmAction({
        message: `Deactivate ${player.name}? They won't appear in matches, catches, or fees.`,
        destructive: true,
      })
    ) {
      await store.updatePlayer(player.id, {
        disabled: true,
        disabledAt: new Date().toISOString(),
      });
      toast(`${player.name} deactivated.`, "success");
      onClose();
    }
  };

  const handleToggleStudio = async () => {
    const nextStudio = !player.isStudioMember;
    const msg = nextStudio
      ? `Grant Studio membership to ${player.name}?`
      : `Remove Studio membership from ${player.name}? Their club player record and access roles will remain untouched.`;
    if (!(await confirmAction({ message: msg, destructive: !nextStudio }))) return;
    await store.updatePlayer(player.id, {
      isStudioMember: nextStudio,
      ...(nextStudio && !player.studioStartDate
        ? { studioStartDate: new Date().toISOString().slice(0, 10) }
        : {}),
    });
    toast(
      nextStudio ? "Studio membership enabled." : "Studio membership removed.",
      "success",
    );
  };

  const hasPhoto = typeof player.photoURL === "string" && player.photoURL.startsWith("https://");
  const whatsAppHref = formatWhatsAppHref(player.mobile);
  const visibleTabs: readonly ("overview" | "membership" | "activity")[] = canViewFinance
    ? ["overview", "membership", "activity"]
    : ["overview", "membership"];
  const activeTab = !canViewFinance && tab === "activity" ? "overview" : tab;

  return (
    <div
      data-testid="player-details-modal"
      className="fixed inset-0 z-[200] flex items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full h-full sm:h-auto sm:max-w-lg sm:my-8 bg-[#F6F7F9] sm:rounded-2xl border border-border overflow-hidden flex flex-col sm:max-h-[92vh] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Brand Header */}
        <div className="bg-gradient-to-r from-[#A30F2D] to-[#7B0B22] text-white px-4 py-3.5 flex items-center justify-between shrink-0">
          <h2 className="text-base font-extrabold tracking-tight">Player Details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Player Details"
            className="min-w-[40px] min-h-[40px] rounded-full hover:bg-white/15 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Profile Summary Card */}
          <div className="bg-white px-4 py-5 border-b border-border">
            <div className="flex items-center gap-4">
              {hasPhoto ? (
                <img
                  src={player.photoURL}
                  alt={player.name}
                  className="w-20 h-20 rounded-full object-cover border-2 border-[#FCE8ED] shrink-0"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center text-2xl font-black shrink-0 border-2 border-[#A30F2D]/20">
                  {player.name.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-1.5">
                <h3 className="text-xl font-black text-[#171C26] truncate" data-testid="player-details-name">
                  {player.name}
                </h3>

                {player.kavachId && (
                  <button
                    type="button"
                    data-testid="copy-player-id-btn"
                    onClick={handleCopyId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F6F7F9] border border-border text-xs font-mono font-bold text-[#171C26] hover:bg-surface-hover cursor-pointer"
                  >
                    <span>Player ID: {player.kavachId}</span>
                    {copiedId ? (
                      <Check className="w-3.5 h-3.5 text-[#15803D]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[#667085]" />
                    )}
                  </button>
                )}

                <p className="text-xs text-[#667085] font-medium">{formatPlayingInfo(player)}</p>

                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      player.disabled
                        ? "bg-red-50 text-[#DC2626] border border-red-200"
                        : "bg-emerald-50 text-[#15803D] border border-emerald-200"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        player.disabled ? "bg-[#DC2626]" : "bg-[#15803D]"
                      }`}
                    />
                    {player.disabled ? "Inactive" : "Active"}
                  </span>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      player.isStudioMember
                        ? "bg-[#FCE8ED] text-[#A30F2D] border border-[#A30F2D]/20"
                        : "bg-[#F6F7F9] text-[#667085] border border-border"
                    }`}
                  >
                    <Layers className="w-3 h-3" />
                    {player.isStudioMember ? "Studio Member" : "Regular"}
                  </span>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border mt-5 -mx-4 px-4 gap-4" role="tablist">
              {visibleTabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t}
                  data-testid={`player-details-tab-${t}`}
                  onClick={() => setTab(t)}
                  className={`pb-2.5 text-sm font-bold capitalize border-b-2 transition cursor-pointer ${
                    activeTab === t
                      ? "border-[#A30F2D] text-[#A30F2D]"
                      : "border-transparent text-[#667085] hover:text-[#171C26]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 space-y-3">
            {activeTab === "overview" && (
              <>
                {editing && isAdmin ? (
                  <div className="bg-white rounded-2xl border border-border p-4">
                    <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-[#A30F2D]">
                        Edit Player Profile
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditing(false)}
                        className="text-xs font-semibold text-[#667085] hover:text-[#171C26] cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    <EditPlayerInline player={player} store={store} onCancel={() => setEditing(false)} />
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-border divide-y divide-border overflow-hidden">
                    <div className="flex items-center gap-3 p-3.5">
                      <span className="w-9 h-9 rounded-xl bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center shrink-0">
                        <Calendar className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#171C26]">Joined Club</p>
                        <p className="text-xs text-[#667085]">
                          {player.kavachJoining || (player.createdAt?.seconds ? formatDate(new Date(player.createdAt.seconds * 1000).toISOString()) : "Not recorded")}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3.5">
                      <span className="w-9 h-9 rounded-xl bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center shrink-0">
                        <Layers className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#171C26]">Membership</p>
                        <p className="text-xs text-[#667085]">
                          {player.isStudioMember ? "Studio" : "Regular"}
                          {player.isStudioMember && player.studioStartDate
                            ? ` (since ${formatDate(player.studioStartDate)})`
                            : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3.5">
                      <span className="w-9 h-9 rounded-xl bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center shrink-0">
                        <BarChart3 className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#171C26]">Club Stats</p>
                        <p className="text-xs text-[#667085] tabular-nums">
                          Matches: {matchesPlayedCount} | Runs: {statSummary.runs.toLocaleString("en-IN")} | Wkts: {statSummary.wickets} | Catches: {statSummary.catches}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3.5">
                      <span className="w-9 h-9 rounded-xl bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center shrink-0">
                        <Award className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-[#171C26]">Badges</p>
                        <p className="text-xs text-[#667085]">{playerBadges.length} Badges</p>
                        <PlayerBadgeRow playerId={player.id} badges={store.badges} customDefs={store.badgeTypeDefs} />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3.5">
                      <span className="w-9 h-9 rounded-xl bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#171C26]">Profile &amp; Contact Records</p>
                        <p className="text-xs text-[#667085]">
                          {availableDocsCount} Verified Fields · {player.mobile || "No mobile"}
                          {player.email ? ` · ${player.email}` : ""}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Contact & Management Actions */}
                <div className="space-y-2 pt-1">
                  {whatsAppHref ? (
                    <a
                      href={whatsAppHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="contact-player-btn"
                      className="w-full min-h-[44px] rounded-xl bg-white border border-border hover:bg-surface-hover text-[#171C26] font-bold text-sm flex items-center justify-center gap-2 transition"
                    >
                      <PhoneCall className="w-4 h-4 text-[#15803D]" />
                      Contact Player on WhatsApp
                    </a>
                  ) : (
                    <div
                      data-testid="contact-player-unavailable"
                      className="w-full min-h-[40px] rounded-xl bg-white/70 border border-border text-[#667085] text-xs font-medium flex items-center justify-center"
                    >
                      No valid mobile number for WhatsApp contact
                    </div>
                  )}

                  {isAdmin && !editing && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        data-testid="edit-player-btn"
                        onClick={() => setEditing(true)}
                        className="min-h-[44px] rounded-xl bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                        Edit Player
                      </button>
                      <button
                        type="button"
                        data-testid="toggle-active-player-btn"
                        onClick={handleToggleActive}
                        className={`min-h-[44px] rounded-xl border font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer ${
                          player.disabled
                            ? "bg-emerald-50 border-emerald-200 text-[#15803D] hover:bg-emerald-100"
                            : "bg-red-50 border-red-200 text-[#DC2626] hover:bg-red-100"
                        }`}
                      >
                        {player.disabled ? (
                          <>
                            <UserCheck className="w-4 h-4" /> Activate
                          </>
                        ) : (
                          <>
                            <UserX className="w-4 h-4" /> Deactivate
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === "membership" && (
              <div className="bg-white rounded-2xl border border-border p-4 space-y-4">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-wider text-[#A30F2D]">
                    Studio Membership
                  </p>
                  <p className="text-sm font-bold text-[#171C26] mt-1">
                    {player.isStudioMember ? "Active Studio Member" : "Regular Club Member"}
                  </p>
                  {player.isStudioMember && (
                    <p className="text-xs text-[#667085] mt-1">
                      Start: {player.studioStartDate || "—"} · Expiry:{" "}
                      {player.studioExpiryDate || player.studioEndDate || "—"}
                    </p>
                  )}
                  <p className="text-[11px] text-[#667085] mt-2">
                    Studio membership is independent of club roster status and administrative access roles.
                  </p>
                </div>

                {planSummary && (
                  <div className="rounded-xl bg-[#F6F7F9] border border-border p-3 text-xs">
                    <p className="font-bold text-[#171C26]">Finance Plan: {planSummary.name}</p>
                    <p className="text-[#667085] mt-0.5">
                      {planSummary.until ? `Valid until ${planSummary.until}` : "No end date"}
                    </p>
                  </div>
                )}

                {isAdmin && (
                  <button
                    type="button"
                    data-testid="toggle-studio-membership-btn"
                    onClick={handleToggleStudio}
                    className={`w-full min-h-[44px] rounded-xl font-bold text-xs uppercase tracking-wider cursor-pointer transition ${
                      player.isStudioMember
                        ? "bg-red-50 text-[#DC2626] border border-red-200 hover:bg-red-100"
                        : "bg-[#D51F43] text-white hover:bg-[#A30F2D]"
                    }`}
                  >
                    {player.isStudioMember ? "Remove Studio Membership" : "Grant Studio Membership"}
                  </button>
                )}
              </div>
            )}

            {canViewFinance && activeTab === "activity" && (
              <div className="bg-white rounded-2xl border border-border p-4 space-y-4">
                <h4 className="text-xs font-extrabold uppercase tracking-widest text-[#A30F2D] flex items-center justify-between">
                  <span>Ledger Details</span>
                  <span className={totalDue > 0 ? "text-[#DC2626]" : "text-[#15803D]"}>
                    Due: ₹{totalDue}
                  </span>
                </h4>

                {unpaidMatchPayments.length === 0 && unpaidOtherFees.length === 0 ? (
                  <p className="text-xs text-[#667085] italic">No unpaid dues.</p>
                ) : (
                  <div>
                    <h5 className="text-[10px] uppercase font-bold text-[#DC2626] mb-2">Unpaid Dues</h5>
                    <ul className="text-xs space-y-2">
                      {unpaidMatchPayments.map((p) => {
                        const m = store.matches.find((mx) => mx.id === p.matchId);
                        if (!m) return null;
                        const dueAmt = classifyMatchPayment(p, m.fee || 0).outstanding;
                        return (
                          <li
                            key={p.id}
                            className="flex items-center justify-between text-[#171C26] border-b border-border pb-1 last:border-0"
                          >
                            <div className="flex items-center gap-2 truncate">
                              {isAdmin && (
                                <input
                                  type="checkbox"
                                  checked={false}
                                  onChange={() => store.updatePaymentStatus(p.id, "Paid", m.id)}
                                  className="accent-[#D51F43] w-3.5 h-3.5 cursor-pointer shrink-0"
                                />
                              )}
                              <span className="truncate">
                                Match vs {m.opponent} ({formatDate(m.date)})
                              </span>
                            </div>
                            <span className="font-mono text-[#DC2626]">₹{dueAmt}</span>
                          </li>
                        );
                      })}
                      {unpaidOtherFees.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center justify-between text-[#171C26] border-b border-border pb-1 last:border-0"
                        >
                          <div className="flex items-center gap-2 truncate">
                            {isAdmin && (
                              <input
                                type="checkbox"
                                checked={false}
                                onChange={() => store.updateOtherFeeStatus(player.id, f.id, "Paid")}
                                className="accent-[#D51F43] w-3.5 h-3.5 cursor-pointer shrink-0"
                              />
                            )}
                            <span className="truncate">{f.title}</span>
                          </div>
                          <span className="font-mono text-[#DC2626]">₹{f.amount}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {allPaidItems.length > 0 && (
                  <div>
                    <h5 className="text-[10px] uppercase font-bold text-[#15803D] mb-2">
                      Paid Dues <span className="text-[#667085] font-normal">({allPaidItems.length})</span>
                    </h5>
                    <ul className="text-xs space-y-2 opacity-80">
                      {visiblePaidItems.map((entry) => {
                        if (entry.kind === "match") {
                          const p = entry.item as MatchPayment;
                          const m = store.matches.find((mx) => mx.id === p.matchId);
                          if (!m) return null;
                          return (
                            <li
                              key={p.id}
                              className="flex items-center justify-between text-[#171C26] border-b border-border pb-1 last:border-0"
                            >
                              <div className="flex items-center gap-2 truncate">
                                {isAdmin &&
                                  (isRealMoneyPayment(p, m.fee) ? (
                                    <input
                                      type="checkbox"
                                      checked={true}
                                      disabled
                                      readOnly
                                      aria-label="Money collected — refund it in Manage Match → Finance to reverse"
                                      title="Money collected — refund it in Manage Match → Finance to reverse"
                                      className="accent-[#D51F43] w-3.5 h-3.5 shrink-0 opacity-60"
                                    />
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={true}
                                      onChange={() => store.updatePaymentStatus(p.id, "Unpaid", m.id)}
                                      className="accent-[#D51F43] w-3.5 h-3.5 cursor-pointer shrink-0"
                                    />
                                  ))}
                                <span className="truncate">
                                  Match vs {m.opponent} ({formatDate(m.date)})
                                </span>
                              </div>
                              <span className="font-mono text-[#15803D] line-through">
                                ₹{p.feeOverride !== undefined ? p.feeOverride : m.fee}
                              </span>
                            </li>
                          );
                        }
                        const f = entry.item as OtherFee;
                        return (
                          <li
                            key={f.id}
                            className="flex items-center justify-between text-[#171C26] border-b border-border pb-1 last:border-0"
                          >
                            <div className="flex items-center gap-2 truncate">
                              {isAdmin && (
                                <input
                                  type="checkbox"
                                  checked={true}
                                  onChange={() => store.updateOtherFeeStatus(player.id, f.id, "Unpaid")}
                                  className="accent-[#D51F43] w-3.5 h-3.5 cursor-pointer shrink-0"
                                />
                              )}
                              <span className="truncate">{f.title}</span>
                            </div>
                            <span className="font-mono text-[#15803D] line-through">₹{f.amount}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {hasMorePaid && (
                      <button
                        type="button"
                        onClick={() => setPaidVisibleCount((c) => c + 10)}
                        className="mt-2 text-xs text-[#A30F2D] hover:underline font-semibold cursor-pointer"
                      >
                        Load more ({allPaidItems.length - paidVisibleCount} remaining)
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
