import { useStore } from "@/hooks/useStore";
import { useState } from "react";
import {
  Video,
  Edit2,
  Trash2,
  Plus,
  Check,
  Search,
  Calendar,
  CreditCard,
  Shield,
  Bell,
} from "lucide-react";
import { SubscriptionPlan, Player } from "@/lib/types";
import { PlayersTab } from "./PlayersTab";
import { AssignFeesAdmin } from "./AssignFeesAdmin";
import { formatDate, inputToDbDate } from "@/lib/utils";

export function StudioAdminTab({
  store,
  adminId,
  adminName,
  persona,
  isStudioAdmin,
  isSuperAdmin,
  defaultAction,
}: {
  store: ReturnType<typeof useStore>;
  adminId: string;
  adminName: string;
  persona: string;
  isStudioAdmin?: boolean;
  isSuperAdmin?: boolean;
  defaultAction?: string | null;
}) {
  const [mainTab, setMainTab] = useState<"directory" | "management" | "assign-fee" | "pna">(
    defaultAction === "add_player" ? "management" : "directory",
  );
  const [subTab, setSubTab] = useState<"members" | "history">(
    "members",
  );

  return (
    <div className="space-y-6">
      {/* Master Tabs for Studio Section */}
      <div className="flex bg-black/40 rounded-lg p-1 border border-glass-border">
        <button
          onClick={() => setMainTab("directory")}
          className={`flex-[1.5] text-[11px] font-bold uppercase py-2 rounded-md transition ${mainTab === "directory" ? "bg-accent text-black" : "text-white/50 hover:text-white"}`}
        >
          Directory
        </button>
        <button
          onClick={() => setMainTab("pna")}
          className={`flex-[1.5] text-[11px] font-bold uppercase py-2 rounded-md transition ${mainTab === "pna" ? "bg-accent text-black" : "text-white/50 hover:text-white"}`}
        >
          PNA
        </button>
        <button
          onClick={() => setMainTab("management")}
          className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition flex items-center justify-center gap-1.5 ${mainTab === "management" ? "bg-accent text-black" : "text-white/50 hover:text-white"}`}
        >
          <span>🎬</span> Studio
        </button>
        <button
          onClick={() => setMainTab("assign-fee")}
          className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition ${mainTab === "assign-fee" ? "bg-accent text-black" : "text-white/50 hover:text-white"}`}
        >
          Fee
        </button>
      </div>

      {mainTab === "directory" ? (
        <div className="mt-4">
          <PlayersTab store={store} persona={persona} isStudioAdmin={isStudioAdmin} />
        </div>
      ) : mainTab === "pna" ? (
        <div className="mt-4">
          <PNAView store={store} />
        </div>
      ) : mainTab === "assign-fee" ? (
        <div className="mt-4">
          <AssignFeesAdmin store={store} />
        </div>
      ) : (
        <>
          <div className="flex bg-black/40 rounded-lg p-1 border border-glass-border mt-4">
            <button
              onClick={() => setSubTab("members")}
              className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition ${subTab === "members" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
            >
              Studio Members
            </button>
            <button
              onClick={() => setSubTab("history")}
              className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition ${subTab === "history" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
            >
              History
            </button>
          </div>

          {subTab === "members" ? (
            <MembersView
              store={store}
              adminId={adminId}
              adminName={adminName}
              defaultAction={defaultAction}
            />
          ) : (
            <HistoryView store={store} />
          )}
        </>
      )}
    </div>
  );
}

const getMembershipStatus = (player: Player) => {
  const expiryDateStr = player.studioExpiryDate || player.studioEndDate;
  if (!expiryDateStr) {
    return {
      status: "Expired",
      colorClass: "bg-red-900/40 text-red-500 border border-red-900/50",
      lineClass: "border-l-red-800 bg-red-950/20 border-red-900/30 border-l-4",
    };
  }
  const expiryTime = new Date(expiryDateStr).setHours(23, 59, 59, 999);
  const nowTime = new Date().setHours(0, 0, 0, 0);
  const diffTime = expiryTime - nowTime;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      status: "Expired",
      colorClass: "bg-red-900/40 text-red-500 border border-red-900/50",
      lineClass: "border-l-red-800 bg-red-950/20 border-red-900/30 border-l-4",
    };
  } else if (diffDays <= 3) {
    return {
      status: `Expiring in ${diffDays} days`,
      colorClass: "bg-red-500/20 text-red-400 border border-red-500/30",
      lineClass: "border-l-red-500 bg-red-500/5 border-red-500/10 border-l-4",
    };
  } else if (diffDays <= 7) {
    return {
      status: `Expiring in ${diffDays} days`,
      colorClass:
        "bg-orange-500/20 text-orange-400 border border-orange-500/30",
      lineClass:
        "border-l-orange-500 bg-orange-500/5 border-orange-500/10 border-l-4",
    };
  } else {
    return {
      status: "Active",
      colorClass:
        "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
      lineClass:
        "border-l-emerald-500 bg-emerald-500/5 border-emerald-500/10 border-l-4",
    };
  }
};

function MembersView({
  store,
  adminId,
  adminName,
  defaultAction,
}: {
  store: ReturnType<typeof useStore>;
  adminId: string;
  adminName: string;
  defaultAction?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [sortOption, setSortOption] = useState<"name" | "expiry" | "plan">(
    "name",
  );
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(defaultAction === "add_player");

  // Form states
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [planId, setPlanId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [autoCalculated, setAutoCalculated] = useState({
    start: false,
    expiry: false,
    paid: false,
  });

  const studioPlayers = store.players.filter((p) => p.isStudioMember);
  const nonStudioPlayers = store.players.filter(
    (p) =>
      !p.isStudioMember &&
      (p.inviteStatus === "Accepted" || p.inviteStatus === "Verified"),
  );

  let filteredMembers = studioPlayers.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.mobile.includes(search),
  );

  if (sortOption === "name") {
    filteredMembers.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortOption === "expiry") {
    filteredMembers.sort((a, b) => {
      const aExp = a.studioExpiryDate || a.studioEndDate || "zzzz";
      const bExp = b.studioExpiryDate || b.studioEndDate || "zzzz";
      return aExp.localeCompare(bExp);
    });
  } else if (sortOption === "plan") {
    filteredMembers.sort((a, b) => {
      const p1 = a.studioPlan || "Trial";
      const p2 = b.studioPlan || "Trial";
      return p1.localeCompare(p2);
    });
  }

  const resetForm = () => {
    setEditingPlayerId(null);
    setAddingNew(false);
    setSelectedPlayerId("");
    setPlanId("");
    setStartDate("");
    setExpiryDate("");
    setPaidDate("");
    setPaidAmount(0);
    setAutoCalculated({ start: false, expiry: false, paid: false });
  };

  const handleEdit = (p: Player) => {
    setEditingPlayerId(p.id);
    setSelectedPlayerId(p.id);
    setPlanId(p.studioPlan || "");
    setStartDate(inputToDbDate(p.studioStartDate || ""));
    setExpiryDate(inputToDbDate(p.studioExpiryDate || p.studioEndDate || ""));
    setPaidDate(inputToDbDate(p.lastPaidDate || ""));
    setPaidAmount(p.lastPaidAmount || 0);
    setAutoCalculated({ start: false, expiry: false, paid: false });
  };

  const [remindingPlayerId, setRemindingPlayerId] = useState<string | null>(null);

  const handleRemind = async (p: Player) => {
    if (!p.mobile) {
      alert("Player has no mobile number.");
      return;
    }
    
    const expiry = p.studioExpiryDate || p.studioEndDate;
    if (!expiry) {
      alert("No expiry date set.");
      return;
    }

    const expiryDate = new Date(expiry);
    const now = new Date();
    const timeDiff = expiryDate.getTime() - now.getTime();
    const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));
    
    const confirmMsg = daysLeft < 0 
      ? `Send WhatsApp reminder to ${p.name}? Their subscription expired ${Math.abs(daysLeft)} days ago.`
      : daysLeft === 0
      ? `Send WhatsApp reminder to ${p.name}? Their subscription expires today.`
      : `Send WhatsApp reminder to ${p.name}? They have ${daysLeft} days left.`;

    if (confirm(confirmMsg)) {
      setRemindingPlayerId(p.id);
      try {
        const res = await fetch("/api/whatsapp/remind-studio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: p.mobile,
            daysLeft,
            playerName: p.name
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        alert("Reminder sent successfully!");
      } catch (err: any) {
        alert(`Error sending reminder: ${err.message}`);
      } finally {
        setRemindingPlayerId(null);
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const pid = editingPlayerId || selectedPlayerId;
    if (!pid) return;

    const oldPlayer = store.players.find((p) => p.id === pid);

    await store.updatePlayer(pid, {
      isStudioMember: true,
      studioPlan: planId as any,
      studioStartDate: startDate,
      studioExpiryDate: expiryDate,
      studioEndDate: expiryDate, // map both for backwards compat maybe
      lastPaidDate: paidDate,
      lastPaidAmount: paidAmount,
    });

    // Add history
    const planName =
      store.subscriptionPlans.find((plan) => plan.id === planId)?.name ||
      planId;
    await store.addSubscriptionHistory({
      playerId: pid,
      adminId,
      adminName,
      oldExpiryDate:
        oldPlayer?.studioExpiryDate || oldPlayer?.studioEndDate || undefined,
      newExpiryDate: expiryDate,
      planId,
      planName: planName,
      paidAmount,
    });

    resetForm();
  };

  const handleRemove = async (pid: string) => {
    if (confirm("Remove this player from Studio Members?")) {
      await store.updatePlayer(pid, {
        isStudioMember: false,
      });
    }
  };

  if (editingPlayerId || addingNew) {
    return (
      <div className="glass p-5 rounded-2xl border border-glass-border">
        <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">
          {addingNew ? "Add Studio Member" : "Edit Membership"}
        </h3>
        <form onSubmit={handleSave} className="space-y-4">
          {addingNew && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                Select Squad Player
              </label>
              <select
                required
                value={selectedPlayerId}
                onChange={(e) => setSelectedPlayerId(e.target.value)}
                className="w-full rounded-xl border border-glass-border bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
              >
                <option value="" disabled>
                  Choose...
                </option>
                {nonStudioPlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.mobile})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
              Subscription Plan
            </label>
            <select
              required
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value);
                const foundPlan = store.subscriptionPlans.find(
                  (sp) => sp.id === e.target.value,
                );
                if (foundPlan) {
                  setPaidAmount(foundPlan.fee);

                  // Auto-fill dates
                  const today = new Date();
                  const todayStr = today.toISOString().split("T")[0];

                  setStartDate(todayStr);
                  setPaidDate(todayStr);

                  if (foundPlan.durationDays > 0) {
                    const expiry = new Date(today);
                    expiry.setDate(expiry.getDate() + foundPlan.durationDays);
                    setExpiryDate(expiry.toISOString().split("T")[0]);
                  }

                  setAutoCalculated({
                    start: true,
                    expiry: foundPlan.durationDays > 0,
                    paid: true,
                  });
                } else {
                  setAutoCalculated({
                    start: false,
                    expiry: false,
                    paid: false,
                  });
                }
              }}
              className="w-full rounded-xl border border-glass-border bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
            >
              <option value="" disabled>
                Select Plan...
              </option>
              <option value="Trial">Trial Plan</option>
              {store.subscriptionPlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} - ₹{plan.fee}
                </option>
              ))}
              <option value="Other">Other / Custom</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                Start Date{" "}
                {autoCalculated.start && (
                  <span className="text-accent ml-2 text-[8px]">(Auto)</span>
                )}
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setAutoCalculated((prev) => ({ ...prev, start: false }));
                }}
                className={`w-full rounded-xl border bg-black/40 px-3.5 py-2.5 text-sm text-white focus:outline-none transition ${autoCalculated.start ? "border-accent/50 text-accent/90" : "border-glass-border focus:border-accent"}`}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                Expiry Date{" "}
                {autoCalculated.expiry && (
                  <span className="text-accent ml-2 text-[8px]">(Auto)</span>
                )}
              </label>
              <input
                type="date"
                required
                value={expiryDate}
                onChange={(e) => {
                  setExpiryDate(e.target.value);
                  setAutoCalculated((prev) => ({ ...prev, expiry: false }));
                }}
                className={`w-full rounded-xl border bg-black/40 px-3.5 py-2.5 text-sm text-white focus:outline-none transition ${autoCalculated.expiry ? "border-accent/50 text-accent/90" : "border-glass-border focus:border-accent"}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                Last Paid Date{" "}
                {autoCalculated.paid && (
                  <span className="text-accent ml-2 text-[8px]">(Auto)</span>
                )}
              </label>
              <input
                type="date"
                value={paidDate}
                onChange={(e) => {
                  setPaidDate(e.target.value);
                  setAutoCalculated((prev) => ({ ...prev, paid: false }));
                }}
                className={`w-full rounded-xl border bg-black/40 px-3.5 py-2.5 text-sm text-white focus:outline-none transition ${autoCalculated.paid ? "border-accent/50 text-accent/90" : "border-glass-border focus:border-accent"}`}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                Paid Amount (₹)
              </label>
              <input
                type="number"
                required
                value={paidAmount}
                onChange={(e) => setPaidAmount(Number(e.target.value))}
                className="w-full rounded-xl border border-glass-border bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={resetForm}
              className="flex-1 py-3 rounded-xl border border-white/10 text-white text-xs font-bold uppercase tracking-wider hover:bg-white/5 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-3 rounded-xl bg-accent text-black text-xs font-bold uppercase tracking-wider hover:opacity-90 transition shadow-lg"
            >
              Save Membership
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="text"
            placeholder="Search Studio members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-black/40 border border-glass-border rounded-xl text-sm text-white focus:border-accent focus:outline-none transition"
          />
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as any)}
            className="bg-black/40 border border-glass-border text-white text-xs rounded-xl px-3 py-2.5 outline-none focus:border-accent"
          >
            <option value="name">Sort by Name</option>
            <option value="expiry">Sort by Expiry Date</option>
            <option value="plan">Sort by Plan</option>
          </select>
          <button
            onClick={() => setAddingNew(true)}
            className="bg-accent text-black px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider inline-flex items-center gap-2 hover:opacity-90 transition shrink-0"
          >
            <Plus className="w-4 h-4" /> Add Member
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {filteredMembers.length === 0 ? (
          <div className="glass p-8 text-center rounded-2xl border border-glass-border">
            <Video className="w-8 h-8 text-white/20 mx-auto mb-3" />
            <p className="text-white/50 text-sm">No studio members found.</p>
          </div>
        ) : (
          filteredMembers.map((p) => {
            const status = getMembershipStatus(p);
            return (
              <div
                key={p.id}
                className={`glass p-4 rounded-xl border border-glass-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${status.lineClass}`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-white text-base">{p.name}</h4>
                    <span className="text-[9px] uppercase font-bold tracking-widest border border-accent/20 bg-accent/10 text-accent px-2 py-0.5 rounded-md">
                      {store.subscriptionPlans.find(
                        (plan) => plan.id === p.studioPlan,
                      )?.name ||
                        p.studioPlan ||
                        "Trial"}
                    </span>
                    <span
                      className={`text-[9px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-md ${status.colorClass}`}
                    >
                      {status.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-white/60">
                    <span className="flex items-center gap-1 font-mono">
                      <Calendar className="w-3.5 h-3.5 opacity-50" />{" "}
                      {p.studioExpiryDate || p.studioEndDate
                        ? `Exp: ${p.studioExpiryDate || p.studioEndDate}`
                        : "No Expiry"}
                    </span>
                    <span className="flex items-center gap-1 font-mono">
                      <CreditCard className="w-3.5 h-3.5 opacity-50" /> Paid: ₹
                      {p.lastPaidAmount || 0}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRemind(p)}
                    disabled={remindingPlayerId === p.id}
                    title="Send WhatsApp Reminder"
                    className="p-2 bg-white/5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition group border border-glass-border disabled:opacity-50"
                  >
                    <Bell className={`w-4 h-4 ${remindingPlayerId === p.id ? "animate-pulse text-accent" : ""}`} />
                  </button>
                  <button
                    onClick={() => handleEdit(p)}
                    className="p-2 bg-white/5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition group border border-glass-border"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleRemove(p.id)}
                    className="p-2 bg-rose-500/10 rounded-lg hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition group"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}



function HistoryView({ store }: { store: ReturnType<typeof useStore> }) {
  const [search, setSearch] = useState("");
  const sortedHistory = [...store.subscriptionHistory].sort((a, b) => {
    const timeA = a.createdAt?.seconds || 0;
    const timeB = b.createdAt?.seconds || 0;
    return timeB - timeA;
  });

  const filteredHistory = sortedHistory.filter((h) => {
    const player = store.players.find((p) => p.id === h.playerId);
    const nameMatch = player?.name.toLowerCase().includes(search.toLowerCase());
    return nameMatch;
  });

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
        <input
          type="text"
          placeholder="Search affected player..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-black/40 border border-glass-border rounded-xl text-sm text-white focus:border-accent focus:outline-none transition"
        />
      </div>

      <div className="space-y-3">
        {filteredHistory.length === 0 ? (
          <div className="glass p-8 text-center rounded-2xl border border-glass-border">
            <Shield className="w-8 h-8 text-white/20 mx-auto mb-3" />
            <p className="text-white/50 text-sm">
              No subscription changes recorded.
            </p>
          </div>
        ) : (
          filteredHistory.map((h) => {
            const player = store.players.find((p) => p.id === h.playerId);
            const dateStr = h.createdAt?.seconds
              ? new Date(h.createdAt.seconds * 1000).toLocaleString()
              : "Just now";
            return (
              <div
                key={h.id}
                className="glass p-4 rounded-xl border border-glass-border"
              >
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h4 className="font-bold text-white text-sm">
                      {player?.name || "Unknown Player"}{" "}
                      <span className="font-normal text-white/40 ml-1">
                        ({h.planName})
                      </span>
                    </h4>
                    <p className="text-[10px] text-white/50 font-mono mt-1">
                      Admin: {h.adminName}
                    </p>
                    <p className="text-[10px] text-white/50 font-mono">
                      Changed on: {dateStr}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="text-[10px] uppercase font-bold tracking-widest text-white/40 mb-1">
                      Expiry Change
                    </div>
                    <div className="flex items-center justify-end gap-2 text-xs">
                      <span className="text-white/60 line-through decoration-rose-500/50">
                        {h.oldExpiryDate || "None"}
                      </span>
                      <span className="text-white/40 font-bold">→</span>
                      <span className="text-accent">{h.newExpiryDate}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PNAView({ store }: { store: ReturnType<typeof useStore> }) {
  const [showPast, setShowPast] = useState(false);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Group out of plays
  const activeOps: any[] = [];
  const pastOps: any[] = [];

  store.outOfPlays.forEach((op) => {
    const p = store.players.find(player => player.id === op.playerId);
    if (!p) return;
    const endDate = new Date(op.endDate);
    endDate.setHours(23, 59, 59, 999);
    
    if (endDate >= now) {
      activeOps.push({ ...op, player: p });
    } else {
      pastOps.push({ ...op, player: p });
    }
  });

  const sortByDate = (a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
  activeOps.sort(sortByDate);
  pastOps.sort((a,b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
         <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            Players Not Available
         </h2>
      </div>

      <div className="space-y-3">
        {activeOps.length === 0 ? (
          <div className="text-center py-6 text-white/50 text-sm glass rounded-xl border border-glass-border">
            No players have upcoming unavailable dates.
          </div>
        ) : (
          activeOps.map((op) => (
             <div key={op.id} className="glass rounded-xl p-4 border border-glass-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                   <h3 className="font-bold text-white text-sm">{op.player.name}</h3>
                   <p className="text-[10px] text-white/50 uppercase tracking-widest mt-0.5">{op.player.mobile}</p>
                </div>
                 <div className="sm:text-right flex items-center justify-end gap-3 flex-wrap">
                   <div>
                     <div className="text-accent text-sm font-bold bg-accent/10 px-3 py-1 rounded inline-block">
                        {formatDate(op.startDate)} to {formatDate(op.endDate)}
                     </div>
                     {op.comment && (
                       <div className="text-xs text-white/60 mt-2 bg-black/20 p-2 rounded border border-glass-border">
                          {op.comment}
                       </div>
                     )}
                   </div>
                   <button
                     onClick={() => {
                        if (confirm(`Remove PNA for ${op.player.name}?`)) {
                           store.deleteOutOfPlay(op.id);
                        }
                     }}
                     className="bg-red-500/10 text-red-500 p-2 rounded-lg hover:bg-red-500/20 transition group ml-2"
                     title="Delete PNA"
                   >
                     <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                   </button>
                </div>
             </div>
          ))
        )}
      </div>

      {pastOps.length > 0 && (
        <div className="glass rounded-xl p-5 border border-glass-border mt-8">
          <button
            onClick={() => setShowPast(!showPast)}
            className="w-full flex items-center justify-between outline-none"
          >
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">
              Past Unavailability ({pastOps.length})
            </h3>
            <span className="text-white/50">{showPast ? "Hide" : "Show"}</span>
          </button>

          {showPast && (
            <div className="mt-4 space-y-3">
               {pastOps.map((op) => (
                 <div key={op.id} className="bg-black/20 rounded-xl p-4 border border-glass-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 opacity-60 hover:opacity-100 transition">
                    <div>
                       <h3 className="font-bold text-white text-sm">{op.player.name}</h3>
                    </div>
                    <div className="sm:text-right flex items-center justify-end gap-3 flex-wrap">
                       <div>
                         <div className="text-white/60 text-xs font-bold px-3 py-1 bg-white/5 rounded inline-block">
                            {formatDate(op.startDate)} to {formatDate(op.endDate)}
                         </div>
                         {op.comment && (
                           <div className="text-xs text-white/40 mt-1">
                              {op.comment}
                           </div>
                         )}
                       </div>
                       <button
                         onClick={() => {
                            if (confirm(`Remove past PNA for ${op.player.name}?`)) {
                               store.deleteOutOfPlay(op.id);
                            }
                         }}
                         className="bg-red-500/10 text-red-500 p-2 rounded-lg hover:bg-red-500/20 transition group ml-2"
                         title="Delete PNA"
                       >
                         <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                       </button>
                    </div>
                 </div>
               ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
