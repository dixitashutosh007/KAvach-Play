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
  Plus,
  Send,
  Edit,
  MessageSquare,
  CheckCircle,
  Trash2,
  Calendar,
  X,
} from "lucide-react";
import { useState } from "react";
import { EditPlayerInline } from "./EditPlayerInline";
import { DuplicatePlayersReport } from "./DuplicatePlayersReport";
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
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ name: "", mobile: "", email: "" });
  const [sortOption, setSortOption] = useState<
    "name" | "expiry" | "studio" | "due"
  >("name");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    store.addPlayer(formData);
    setIsAdding(false);
    setFormData({ name: "", mobile: "", email: "" });
  };

  const getTotalDue = (playerId: string) => {
    const matchDues = store.payments
      .filter((p) => p.playerId === playerId && p.status === "Unpaid")
      .reduce((acc, p) => {
        const match = store.matches.find((m) => m.id === p.matchId);
        return acc + (match?.fee || 0);
      }, 0);
    const otherDues = store.otherFees
      .filter((f) => f.playerId === playerId && f.status === "Unpaid")
      .reduce((acc, f) => acc + (f.amount || 0), 0);
    return matchDues + otherDues;
  };

  const pendingPlayers = store.players.filter(
    (p) => p.inviteStatus === "Pending" && !p.disabled,
  );
  let displayPlayers = store.players.filter(
    (p) => p.inviteStatus !== "Pending",
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
            onClick={() => setIsAdding(!isAdding)}
            className="flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-black shadow hover:bg-accent/90 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            {isAdding ? "Cancel" : "Add Player"}
          </button>
        )}
      </div>

      {isAdding && (
        <form
          onSubmit={handleSubmit}
          className="glass rounded-xl p-4 space-y-3"
        >
          <div className="rounded-md bg-accent/20 border border-accent/30 p-3 mb-2">
            <p className="text-xs text-accent flex items-center gap-2 font-medium">
              <Send className="h-4 w-4" />
              Add a player to the squad. They will be unverified until they
              verify via their device.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              Player Name
            </label>
            <input
              required
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              placeholder="e.g. MS Dhoni"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              Email ID{" "}
              <span className="text-white/40 text-[9px]">(Optional)</span>
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              placeholder="e.g. msd@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
              Mobile Number
            </label>
            <input
              required
              type="tel"
              value={formData.mobile}
              onChange={(e) =>
                setFormData({ ...formData, mobile: e.target.value })
              }
              className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              placeholder="e.g. 9876543210"
            />
          </div>
          <div className="pt-2">
            <button
              type="submit"
              className="w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-black hover:bg-accent/90 transition"
            >
              Add Player
            </button>
          </div>
        </form>
      )}

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
      </>

      {selectedPlayer && (
        <SquadPlayerDetails
          store={store}
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          isAdmin={isAdmin}
        />
      )}
    </div>
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
    if (m) totalDue += m.fee;
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
                        <span className="font-mono text-red-300">₹{m.fee}</span>
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
                        <span className="font-mono text-emerald-300 line-through">₹{m.fee}</span>
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
