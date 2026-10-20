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
  Trash2,
  Calendar,
  Table2,
  X,
  UserPlus,
  ExternalLink,
} from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { useState } from "react";
import { EditPlayerInline } from "./EditPlayerInline";
import { DuplicatePlayersReport } from "./DuplicatePlayersReport";
import { PlayerBadgeRow } from "./BadgeIcon";
import { Player } from "@/lib/types";
import { formatDate, dbToInputDate, inputToDbDate } from "@/lib/utils";

export function PlayersTab({
  store,
  persona,
  isStudioAdmin,
}: {
  store: ReturnType<typeof useStore>;
  persona: string;
  isStudioAdmin?: boolean;
}) {
  // We allow basic admin functions (adding/editing players) if they are any kind of admin,
  // but strictly, it might just be better to let all admins do basic directory edits,
  // or restrict it. Given the system, any admin (isStudioAdmin !== false) usually manages
  // the directory.
  const isAdmin = persona === "admin" && isStudioAdmin !== false;
  const [sortOption, setSortOption] = useState<
    "name" | "expiry" | "studio" | "due"
  >("name");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "table">("list");

  // Per-player invite modal state (existing players)
  const [invitePlayer, setInvitePlayer] = useState<Player | null>(null);
  const clubName = store.appConfig?.clubName || "KAvach Cricket Club";
  const getDefaultInviteMsg = (name: string) =>
    `*Welcome to ${clubName}!* 🏏\n\nHi *${name}*, we are glad to have you as a Club member!\n\nPlease register on our *Play App* to access all club features:\n👉 https://play.kavachcricket.com\n\n*What you can do on the app:*\n✅ View & pay match fees\n✅ Club subscription management\n✅ Match schedules & details\n✅ Leaderboards & stats\n✅ Team announcements\n\n📋 _Make sure to provide all required details correctly before submitting._\n\nSee you on the field! 🙌`;
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteSending, setInviteSending] = useState(false);

  // Standalone Invite Player modal (invite anyone by name + phone)
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: "", phone: "" });
  const [standaloneInviteMsg, setStandaloneInviteMsg] = useState("");
  const [standaloneInviteSending, setStandaloneInviteSending] = useState(false);


  const getTotalDue = (playerId: string) => {
    const matchDues = store.payments
      .filter((p) => p.playerId === playerId && p.status === "Unpaid")
      .reduce((acc, p) => {
        const match = store.matches.find((m) => m.id === p.matchId);
        return acc + (p.feeOverride !== undefined ? p.feeOverride : (match?.fee || 0));
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
  let displayPlayers = store.players.filter(
    (p) => p.inviteStatus !== "Pending" && p.inviteStatus !== "Unverified",
  );
  displayPlayers = displayPlayers.filter((p) => (showDisabled ? p.disabled : !p.disabled));
  if (searchQuery.trim() !== "") {
    const q = searchQuery.toLowerCase();
    displayPlayers = displayPlayers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.mobile.includes(q) ||
        (p.email && p.email.toLowerCase().includes(q))
    );
  }

  if (sortOption === "name") {
    displayPlayers.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortOption === "expiry") {
    displayPlayers.sort((a, b) => {
      const aExp = a.studioExpiryDate || a.studioEndDate || "zzzz"; // push no-expiry to bottom
      const bExp = b.studioExpiryDate || b.studioEndDate || "zzzz";
      return aExp.localeCompare(bExp);
    });
  } else if (sortOption === "studio") {
    displayPlayers.sort((a, b) =>
      a.isStudioMember === b.isStudioMember ? 0 : a.isStudioMember ? -1 : 1,
    );
  } else if (sortOption === "due") {
    displayPlayers.sort((a, b) => getTotalDue(b.id) - getTotalDue(a.id));
  }

  const getMembershipStatus = (player: Player) => {
    const expiryDateStr = player.studioExpiryDate || player.studioEndDate;
    if (!expiryDateStr) {
      return {
        status: "Expired",
        colorClass: "bg-red-500/10 text-red-400 border border-red-500/20",
        lineClass: "border-l-red-500 bg-red-950/10 border-red-500/20",
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
        lineClass: "border-l-red-500 bg-red-950/10 border-red-500/20",
        label: "Expired",
        daysLeft: diffDays,
      };
    } else if (diffDays <= 7) {
      return {
        status: "Expiring",
        colorClass:
          "bg-amber-500/10 text-orange-400 border border-orange-500/20",
        lineClass: "border-l-orange-500 bg-amber-950/10 border-orange-500/20",
        label: `Expiring in ${diffDays} day${diffDays === 1 ? "" : "s"}`,
        daysLeft: diffDays,
      };
    } else {
      return {
        status: "Active",
        colorClass:
          "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
        lineClass:
          "border-l-emerald-500 bg-emerald-950/10 border-emerald-500/20",
        label: `Active (${diffDays} days left)`,
        daysLeft: diffDays,
      };
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-1">
          Squad <span className="opacity-50 text-sm ml-1">({store.players.length})</span>
        </h2>
        {isAdmin && (
          <button
            onClick={() => {
              setShowInviteModal(true);
              setInviteForm({ name: "", phone: "" });
              setStandaloneInviteMsg(getDefaultInviteMsg(""));
            }}
            className="flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-500 transition"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Invite Player
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4 justify-between">
        <input
          type="text"
          placeholder="Search players..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-black/40 border border-glass-border text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-accent flex-1 max-w-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setViewMode(viewMode === "list" ? "table" : "list")}
              className={`text-xs px-3 py-2 rounded-xl font-bold border transition flex items-center gap-1.5 ${viewMode === "table" ? "bg-accent/20 text-accent border-accent/30" : "bg-white/5 text-white/60 border-glass-border hover:bg-white/10"}`}
            >
              <Table2 className="h-3.5 w-3.5" />
              {viewMode === "table" ? "Table View" : "Table View"}
            </button>
          )}
          <button
            onClick={() => setShowDisabled(!showDisabled)}
            className={`text-xs px-3 py-2 rounded-xl font-bold border transition ${showDisabled ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-white/5 text-white/60 border-glass-border hover:bg-white/10"}`}
          >
            {showDisabled ? "Viewing Trash" : "View Trash"}
          </button>
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as any)}
            className="bg-black/40 border border-glass-border text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-accent"
          >
            <option value="name">Sort by Name</option>
            <option value="expiry">Sort by Expiry Date</option>
            <option value="studio">Sort by Studio Member</option>
            <option value="due">Sort by Due Amount</option>
          </select>
        </div>
      </div>

      {isAdmin && <DuplicatePlayersReport store={store} />}

      <>
        {isAdmin && pendingPlayers.length > 0 && (
          <div className="space-y-2 mb-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-accent flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
              </span>
              Pending Approvals ({pendingPlayers.length})
            </h3>
            <div className="glass rounded-xl overflow-hidden divide-y divide-glass-border border border-accent/25">
              {pendingPlayers.map((player) => (
                <div
                  key={player.id}
                  className="flex flex-col hover:bg-white/5 transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 font-bold text-accent shrink-0">
                        {player.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white text-[15px] truncate">
                          {player.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-white/60">
                          <span className="flex items-center gap-1">
                            <PhoneCall className="h-3 w-3 shrink-0" />
                            {player.mobile}
                          </span>
                          {player.locality && (
                            <span className="text-white/40">
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
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-emerald-400 transition cursor-pointer"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Approve
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            window.confirm(
                              `Decline registration request for ${player.name}? This will notify them via email and they can retry after 3 days.`,
                            )
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
            <p className="text-[11px] text-white/40 -mt-1">
              These players signed in but haven&apos;t completed their profile yet.
            </p>
            <div className="glass rounded-xl overflow-hidden divide-y divide-glass-border border border-yellow-500/20">
              {unverifiedPlayers.map((player) => (
                <div
                  key={player.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 hover:bg-white/5 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/20 font-bold text-yellow-400 shrink-0">
                      {player.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white text-[15px] truncate">
                        {player.name}
                      </p>
                      <p className="text-[11px] text-white/40">Profile incomplete</p>
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
                        if (window.confirm(`Remove incomplete registration for ${player.name}?`)) {
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
        ) : (
        <div className="glass rounded-xl overflow-hidden divide-y divide-glass-border">
          {displayPlayers.length === 0 && (
            <div className="py-8 text-center text-sm text-white/50">
              No players added yet.
            </div>
          )}
          {displayPlayers.map((player) => (
            <div
              key={player.id}
              className="flex flex-col hover:bg-white/5 transition cursor-pointer"
              onClick={() => setSelectedPlayer(player)}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 font-bold text-white relative shrink-0">
                    {player.name.charAt(0).toUpperCase()}
                    {player.isStudioMember && (
                      <span className="absolute -bottom-1 -right-1 bg-accent text-[9px] rounded-full p-0.5">
                        🎬
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-white text-[15px] truncate">
                      {player.name}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-white/60">
                      <span className="flex items-center gap-1">
                        <PhoneCall className="h-3 w-3 shrink-0" />
                        {player.mobile}
                      </span>
                      {player.email && (
                        <span className="flex items-center gap-1 border-l border-white/20 pl-2">
                          ✉️ {player.email}
                        </span>
                      )}
                      <span
                        className={`flex items-center gap-1 border-l border-white/20 pl-2 font-bold ${getTotalDue(player.id) > 0 ? "text-red-400" : "text-emerald-400"}`}
                      >
                        Due: ₹{getTotalDue(player.id)}
                      </span>
                    </div>
                    <PlayerBadgeRow playerId={player.id} badges={store.badges} customDefs={store.badgeTypeDefs} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 self-end sm:self-auto">
                  <div
                    className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border ${
                      player.inviteStatus === "Accepted" ||
                      player.inviteStatus === "Verified"
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : player.inviteStatus === "Pending"
                          ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                          : player.inviteStatus === "Rejected"
                            ? "bg-red-500/20 text-red-500 border-red-500/30"
                            : "bg-white/10 text-white/70 border-glass-border"
                    }`}
                  >
                    {player.inviteStatus === "Invited"
                      ? "Unverified"
                      : player.inviteStatus || "Unverified"}
                  </div>
                  {isAdmin && (
                    <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
                      {!player.disabled && (
                        <button
                          onClick={() => {
                            setInvitePlayer(player);
                            setInviteMessage(getDefaultInviteMsg(player.name));
                          }}
                          title="Send Invite to Register on Play App"
                          className="flex items-center gap-1 px-2 py-1 rounded-md transition cursor-pointer bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30 text-[10px] font-semibold"
                        >
                          <UserPlus className="h-3.5 w-3.5" /> Invite
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (player.disabled) {
                            if (window.confirm(`Are you sure you want to restore ${player.name}?`)) {
                              store.updatePlayer(player.id, {
                                disabled: false,
                                disabledAt: undefined,
                              });
                            }
                          } else {
                            if (
                              window.confirm(
                                `Are you sure you want to move ${player.name} to trash? They can request a fresh signup after a 3-day cool-down.`,
                              )
                            ) {
                              store.updatePlayer(player.id, {
                                disabled: true,
                                disabledAt: new Date().toISOString(),
                              });
                            }
                          }
                        }}
                        title={player.disabled ? "Restore Player" : "Move to Trash"}
                        className={`p-1.5 rounded-md transition cursor-pointer text-xs font-bold px-2 ${player.disabled ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" : "hover:bg-red-500/10 text-white/60 hover:text-red-400"}`}
                      >
                        {player.disabled ? "Restore" : <Trash2 className="h-4 w-4" />}
                      </button>
                      {player.disabled && (
                        <button
                          onClick={async () => {
                            if (
                              window.confirm(
                                `Permanently delete ${player.name}? This action cannot be undone and may orphan payment/match records.`
                              )
                            ) {
                              await store.deletePlayer(player.id);
                            }
                          }}
                          title="Permanently Delete"
                          className="p-1.5 rounded-md text-red-400 hover:bg-red-500/20 bg-red-500/10 transition cursor-pointer text-xs font-bold px-3 ml-1"
                        >
                          Perm Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        )}
      </>

      {selectedPlayer && (
        <SquadPlayerDetails
          store={store}
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          isAdmin={isAdmin}
        />
      )}

      {/* Standalone Invite Player Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-5 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-base">
                <UserPlus className="w-5 h-5" /> Invite Player
              </div>
              <button
                onClick={() => { setShowInviteModal(false); setStandaloneInviteSending(false); }}
                className="text-white/40 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-white/60">
              Send a WhatsApp welcome message to invite someone to register on the Play App.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-white/70 mb-1">Name</label>
                <input
                  type="text"
                  value={inviteForm.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setInviteForm((f) => ({ ...f, name }));
                    setStandaloneInviteMsg(getDefaultInviteMsg(name));
                  }}
                  placeholder="Player name"
                  className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-white/70 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={inviteForm.phone}
                  onChange={(e) => setInviteForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="e.g. 9876543210"
                  className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-white/70 mb-1">
                Message Preview <span className="text-white/40 font-normal">(editable)</span>
              </label>
              <textarea
                rows={8}
                value={standaloneInviteMsg}
                onChange={(e) => setStandaloneInviteMsg(e.target.value)}
                className="w-full bg-black/40 border border-border rounded-lg p-2.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-emerald-500 leading-relaxed"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={() => { setShowInviteModal(false); setStandaloneInviteSending(false); }}
                className="px-4 py-2 text-xs font-semibold text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!inviteForm.phone.trim()) { alert("Please enter a phone number."); return; }
                  setStandaloneInviteSending(true);
                  try {
                    const res = await authedFetch("/api/whatsapp/invite", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        to: inviteForm.phone,
                        playerName: inviteForm.name || "Player",
                      }),
                    });
                    if (res.ok) {
                      alert(`Invite sent to ${inviteForm.name || inviteForm.phone} via WhatsApp!`);
                    } else {
                      const cleanNum = inviteForm.phone.replace(/\D/g, "");
                      const waNum = cleanNum.length === 10 ? `91${cleanNum}` : cleanNum;
                      const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(standaloneInviteMsg)}`;
                      window.open(waUrl, "_blank");
                      alert("WhatsApp API not available. Opened invite in personal WhatsApp instead.");
                    }
                  } catch {
                    const cleanNum = inviteForm.phone.replace(/\D/g, "");
                    const waNum = cleanNum.length === 10 ? `91${cleanNum}` : cleanNum;
                    const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(standaloneInviteMsg)}`;
                    window.open(waUrl, "_blank");
                  }
                  setShowInviteModal(false);
                  setStandaloneInviteSending(false);
                }}
                disabled={standaloneInviteSending || !inviteForm.phone.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition shadow-sm"
              >
                <Send className="w-3.5 h-3.5" /> {standaloneInviteSending ? "Sending..." : "Send Invite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Per-Player Invite Modal */}
      {invitePlayer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-5 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-base">
                <UserPlus className="w-5 h-5" /> Invite {invitePlayer.name}
              </div>
              <button
                onClick={() => { setInvitePlayer(null); setInviteSending(false); }}
                className="text-white/40 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-white/60">
              Send a WhatsApp welcome message to <strong className="text-white">{invitePlayer.name}</strong> with the Play App registration link. Edit the message below before sending.
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-white/70 mb-1">
                Message Preview
              </label>
              <textarea
                rows={6}
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                className="w-full bg-black/40 border border-border rounded-lg p-2.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-emerald-500 leading-relaxed"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={() => { setInvitePlayer(null); setInviteSending(false); }}
                className="px-4 py-2 text-xs font-semibold text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setInviteSending(true);
                  try {
                    const res = await authedFetch("/api/whatsapp/invite", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        to: invitePlayer.mobile,
                        playerName: invitePlayer.name,
                      }),
                    });
                    if (res.ok) {
                      alert(`Invite sent to ${invitePlayer.name} via WhatsApp!`);
                    } else {
                      const cleanNum = invitePlayer.mobile.replace(/\D/g, "");
                      const waUrl = `https://wa.me/${cleanNum}?text=${encodeURIComponent(inviteMessage)}`;
                      window.open(waUrl, "_blank");
                      alert("WhatsApp API not available. Opened invite in personal WhatsApp instead.");
                    }
                  } catch {
                    const cleanNum = invitePlayer.mobile.replace(/\D/g, "");
                    const waUrl = `https://wa.me/${cleanNum}?text=${encodeURIComponent(inviteMessage)}`;
                    window.open(waUrl, "_blank");
                  }
                  setInvitePlayer(null);
                  setInviteSending(false);
                }}
                disabled={inviteSending}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition shadow-sm"
              >
                <Send className="w-3.5 h-3.5" /> {inviteSending ? "Sending..." : "Send Invite"}
              </button>
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
    "bg-transparent border-none text-white text-xs focus:bg-white/5 focus:outline-none px-2 py-1.5 w-full";
  const selectClass =
    "bg-transparent border-none text-white text-xs focus:bg-white/5 focus:outline-none px-1 py-1.5 appearance-none cursor-pointer";

  return (
    <>
      <div className="glass rounded-xl overflow-hidden border border-glass-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px] border-collapse">
            <thead>
              <tr className="bg-black/60 text-white/70 text-[10px] uppercase tracking-wider">
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
                  <td colSpan={12} className="py-8 text-center text-sm text-white/50">
                    No players to display.
                  </td>
                </tr>
              )}
              {players.map((player) => (
                <tr key={player.id} className="border-b border-glass-border hover:bg-white/[0.03] transition">
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
                        <option key={opt} value={opt} className="bg-[#0f172a] text-white">
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
                        <option value="" className="bg-[#0f172a] text-white">MM</option>
                        {MONTHS.map((m) => (
                          <option key={m} value={m} className="bg-[#0f172a] text-white">{m}</option>
                        ))}
                      </select>
                      <span className="text-white/30 text-xs">/</span>
                      <select
                        value={parseKavachYear(getVal(player, "kavachJoining") as string | undefined)}
                        onChange={(e) => setKavachJoiningPart(player.id, player, "year", e.target.value)}
                        className={`${selectClass} w-[62px]`}
                      >
                        <option value="" className="bg-[#0f172a] text-white">YYYY</option>
                        {YEARS.map((y) => (
                          <option key={y} value={y} className="bg-[#0f172a] text-white">{y}</option>
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
                      <span className="inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-red-500/20 text-red-400 border border-red-500/30">
                        Disabled
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
          className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-accent text-black font-bold px-6 py-3 rounded-xl shadow-lg z-50 hover:bg-accent/90 transition disabled:opacity-50"
        >
          {saving ? "Saving..." : `Save Changes (${dirty.size})`}
        </button>
      )}
    </>
  );
}

function SquadPlayerDetails({
  store,
  player,
  onClose,
  isAdmin,
}: {
  store: ReturnType<typeof useStore>;
  player: Player;
  onClose: () => void;
  isAdmin: boolean;
}) {
  const matchPayments = store.payments.filter((p) => p.playerId === player.id);
  const otherFees = store.otherFees.filter((f) => f.playerId === player.id);

  // Separate ledgers
  const unpaidMatchPayments = matchPayments.filter((p) => p.status === "Unpaid");
  const paidMatchPayments = matchPayments.filter((p) => p.status === "Paid");
  
  const unpaidOtherFees = otherFees.filter((f) => f.status === "Unpaid");
  const paidOtherFees = otherFees.filter((f) => f.status === "Paid");

  let totalDue = 0;
  unpaidMatchPayments.forEach((p) => {
    const m = store.matches.find((mx) => mx.id === p.matchId);
    if (m) totalDue += p.feeOverride !== undefined ? p.feeOverride : m.fee;
  });
  unpaidOtherFees.forEach((f) => (totalDue += f.amount));

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg my-8 bg-[#0f172a] rounded-xl border border-glass-border overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[#0f172a] p-4 flex justify-between items-center z-10 border-b border-glass-border">
          <h2 className="text-xl font-bold text-white tracking-tight">
            {player.name}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-full transition"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 custom-scrollbar">
          <div className="mb-6 bg-white/5 border border-glass-border rounded-xl p-4">
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-accent mb-3 flex items-center justify-between">
              <span>Ledger Details</span>
              <span className={totalDue > 0 ? "text-red-400" : "text-emerald-400"}>
                Due: ₹{totalDue}
              </span>
            </h4>

            {unpaidMatchPayments.length === 0 && unpaidOtherFees.length === 0 ? (
              <p className="text-xs text-white/50 italic mb-4">No unpaid dues.</p>
            ) : (
              <div className="mb-4">
                <h5 className="text-[10px] uppercase font-bold text-red-400 mb-2">Unpaid Dues</h5>
                <ul className="text-xs space-y-2">
                  {unpaidMatchPayments.map((p) => {
                    const m = store.matches.find((mx) => mx.id === p.matchId);
                    return m ? (
                      <li
                        key={p.id}
                        className="flex items-center justify-between text-white/80 border-b border-white/5 pb-1 last:border-0"
                      >
                        <div className="flex items-center gap-2 truncate">
                          {isAdmin && (
                            <input 
                              type="checkbox" 
                              checked={false} 
                              onChange={() => store.updatePaymentStatus(p.id, "Paid", m.id)}
                              className="accent-accent w-3 h-3 cursor-pointer shrink-0" 
                            />
                          )}
                          <span className="truncate">
                            Match vs {m.opponent} ({formatDate(m.date)})
                          </span>
                        </div>
                        <span className="font-mono text-red-300">₹{p.feeOverride !== undefined ? p.feeOverride : m.fee}</span>
                      </li>
                    ) : null;
                  })}
                  {unpaidOtherFees.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between text-white/80 border-b border-white/5 pb-1 last:border-0"
                    >
                      <div className="flex items-center gap-2 truncate">
                        {isAdmin && (
                           <input 
                              type="checkbox" 
                              checked={false} 
                              onChange={() => store.updateOtherFeeStatus(player.id, f.id, "Paid")}
                              className="accent-accent w-3 h-3 cursor-pointer shrink-0" 
                           />
                        )}
                        <span className="truncate">{f.title}</span>
                      </div>
                      <span className="font-mono text-red-300">₹{f.amount}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {paidMatchPayments.length > 0 || paidOtherFees.length > 0 ? (
              <div>
                <h5 className="text-[10px] uppercase font-bold text-emerald-400 mb-2">Paid Dues</h5>
                <ul className="text-xs space-y-2 opacity-70">
                  {paidMatchPayments.map((p) => {
                    const m = store.matches.find((mx) => mx.id === p.matchId);
                    return m ? (
                      <li
                        key={p.id}
                        className="flex items-center justify-between text-white/80 border-b border-white/5 pb-1 last:border-0"
                      >
                        <div className="flex items-center gap-2 truncate">
                          {isAdmin && (
                            <input 
                               type="checkbox" 
                               checked={true} 
                               onChange={() => store.updatePaymentStatus(p.id, "Unpaid", m.id)}
                               className="accent-accent w-3 h-3 cursor-pointer shrink-0" 
                            />
                          )}
                          <span className="truncate">
                            Match vs {m.opponent} ({formatDate(m.date)})
                          </span>
                        </div>
                        <span className="font-mono text-emerald-300 line-through">₹{p.feeOverride !== undefined ? p.feeOverride : m.fee}</span>
                      </li>
                    ) : null;
                  })}
                  {paidOtherFees.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between text-white/80 border-b border-white/5 pb-1 last:border-0"
                    >
                      <div className="flex items-center gap-2 truncate">
                          {isAdmin && (
                            <input 
                               type="checkbox" 
                               checked={true} 
                               onChange={() => store.updateOtherFeeStatus(player.id, f.id, "Unpaid")}
                               className="accent-accent w-3 h-3 cursor-pointer shrink-0" 
                            />
                          )}
                        <span className="truncate">{f.title}</span>
                      </div>
                      <span className="font-mono text-emerald-300 line-through">₹{f.amount}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-white/50 mb-3 block border-b border-glass-border pb-2">
              Edit Profile
            </h4>
            <EditPlayerInline player={player} store={store} onCancel={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}
