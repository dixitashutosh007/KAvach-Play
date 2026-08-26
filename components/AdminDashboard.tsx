import { useStore } from "@/hooks/useStore";
import { useMemo, useState } from "react";
import { Match, Player, MatchPayment, OtherFee } from "@/lib/types";
import { Calculator, IndianRupee, Bell, Plus, Users, Landmark, Search, PlusCircle, ArrowRight, PieChart, MessageSquare, X, WalletCards, Copy, CheckCircle2, UserX, Send } from "lucide-react";
import { format, isPast, isFuture, parseISO } from "date-fns";
import { formatDate, normalizeIndianMobile } from "@/lib/utils";
import { db } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import {
  IndependenceDayBanner,
  isIndependenceDayWindow,
} from "./festive/IndependenceDay";

export function AdminDashboard({
  store,
  setActiveTab,
  isSuperAdmin = false,
  isFinanceAdmin = false,
  isMatchAdmin = false,
  isStudioAdmin = false,
  isClubAdmin = false,
}: {
  store: ReturnType<typeof useStore>;
  setActiveTab: (tab: any, action?: string) => void;
  isSuperAdmin?: boolean;
  isFinanceAdmin?: boolean;
  isMatchAdmin?: boolean;
  isStudioAdmin?: boolean;
  isClubAdmin?: boolean;
}) {
  const { matches, payments, players, otherFees } = store;

  const { totalDueMatch, totalDueFee, duePlayersCount } = useMemo(() => {
    let matchDue = 0;
    let feeDue = 0;
    const duePlayers = new Set<string>();

    payments.forEach(p => {
        if (p.status === "Unpaid") {
            const match = matches.find(m => m.id === p.matchId);
            if (match && match.result !== "Abandoned" && match.fee) {
                matchDue += p.feeOverride !== undefined ? p.feeOverride : match.fee;
                duePlayers.add(p.playerId);
            }
        }
    });

    otherFees.forEach(f => {
        if (f.status === "Unpaid") {
             feeDue += f.amount;
             duePlayers.add(f.playerId);
        }
    });
    
    return {
        totalDueMatch: matchDue,
        totalDueFee: feeDue,
        duePlayersCount: duePlayers.size
    };
  }, [matches, payments, players, otherFees]);

  const [isGroupRemindModalOpen, setIsGroupRemindModalOpen] = useState(false);
  const [groupRemindCustomMsg, setGroupRemindCustomMsg] = useState("");
  const [selectedRemindMatch, setSelectedRemindMatch] = useState<Match | null>(null);

  // "Add No Show" quick-action modal state.
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
      alert("Pick at least one player.");
      return;
    }
    if (!noShowAmount || noShowAmount <= 0) {
      alert("Set a No Show amount (₹).");
      return;
    }
    setIsSavingNoShow(true);
    try {
      for (const pid of noShowSelected) {
        await store.addOtherFee(pid, "No Show", noShowAmount, noShowComment);
      }
      alert(`No Show fee added to ${noShowSelected.length} player(s).`);
      resetNoShow();
    } catch (err) {
      console.error("Failed to add No Show fee", err);
      alert("Failed to add No Show fee. Try again.");
      setIsSavingNoShow(false);
    }
  };
  
  const getPayoutAmount = (match: Match) => {
      const ground = store.grounds.find(g => g.id === match.groundId);
      let calculatedFee = Math.round((match.fee * 12) * 0.96);
      if (ground) {
          if (match.matchType === "Practice" && ground.practiceFee) {
              calculatedFee = ground.practiceFee;
          } else if (match.matchType === "Tournament" && ground.tournamentFee) {
              calculatedFee = ground.tournamentFee;
          }
      }
      return calculatedFee;
  };

  const handlePayout = async (match: Match) => {
      const calculatedFee = getPayoutAmount(match);
      if (window.confirm(`Mark ₹${calculatedFee} as paid to Organiser for ${match.opponent} match?`)) {
          try {
             await store.updateMatch({
                 ...match,
                 isGroundFeePaid: true,
                 groundFeePaidAmount: calculatedFee
             });
          } catch (e) {
             console.error(e);
             alert("Failed to mark as paid");
          }
      }
  };

  const handleGroupRemind = () => {
    if (!selectedRemindMatch) return;
    
    const ground = store.grounds.find(g => g.id === selectedRemindMatch.groundId);
    
    let text = `🏏 *Upcoming Match Reminder* 🏏\n`;
    text += `*Date*: ${formatDate(selectedRemindMatch.date)}\n`;
    text += `*Time*: ${selectedRemindMatch.time || 'TBD'}\n`;
    text += `*Ground*: ${ground?.name || 'TBD'}\n`;
    if (ground?.mapUrl) {
       text += `*Location*: ${ground.mapUrl}\n`;
    }
    
    if (groupRemindCustomMsg.trim()) {
       text += `\n${groupRemindCustomMsg.trim()}\n`;
    }
    
    text += `\n*Squad*:\n`;
    
    const matchPayments = store.payments.filter(
      (p) => p.matchId === selectedRemindMatch.id && store.players.some((pl) => pl.id === p.playerId)
    );
    const playing = matchPayments.filter(p => p.status !== "Not Playing");
    playing.forEach(p => {
       const player = store.players.find(pl => pl.id === p.playerId);
       if (player?.mobile) {
           let mob = player.mobile.replace(/\D/g, '');
           if (mob.startsWith('0') && mob.length === 11) mob = "91" + mob.substring(1);
           else if (mob.length === 10) mob = "91" + mob;
           text += `@+${mob} `;
       } else if (player) {
           text += `${player.name} `;
       }
    });
    
    const encoded = encodeURIComponent(text);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
    setIsGroupRemindModalOpen(false);
  };

  /**
   * Compose a per-match WhatsApp broadcast in the exact format the club
   * uses. Every player who is not explicitly "Not Playing" is tagged
   * using their mobile number, normalized to +91XXXXXXXXXX so WhatsApp
   * can actually resolve the mention (this was flaky before because
   * some numbers were stored as "9876543210", others as "919876543210",
   * others with a leading 0).
   */
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
      // normalizeIndianMobile returns +91XXXXXXXXXX for anything that
      // parses to 10 valid Indian digits, and returns the original
      // (unparsable) string otherwise — so this exact-length check
      // guarantees we never emit a broken mention tag.
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

    const encoded = encodeURIComponent(text);
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
  };

  const totalDueAmount = totalDueMatch + totalDueFee;

  const { pastMatches, upcomingMatches, payoutMatches } = useMemo(() => {
     const now = new Date();
     const past: Match[] = [];
     const up: Match[] = [];
     const payouts: Match[] = [];
     
     matches.forEach(m => {
        const timeStr = m.time || "00:00";
        const dateObj = new Date(`${m.date}T${timeStr}`);
        if (isPast(dateObj)) {
            past.push(m);
        } else {
            up.push(m);
        }
        
        if (!m.isGroundFeePaid && m.fee) {
            const timeDiff = dateObj.getTime() - Date.now();
            if (timeDiff <= 3 * 24 * 60 * 60 * 1000 && timeDiff >= -90 * 24 * 60 * 60 * 1000) {
                 payouts.push(m);
            }
        }
     });

     past.sort((a,b) => new Date(`${b.date}T${b.time || "00:00"}`).getTime() - new Date(`${a.date}T${a.time || "00:00"}`).getTime());
     up.sort((a,b) => new Date(`${a.date}T${a.time || "00:00"}`).getTime() - new Date(`${b.date}T${b.time || "00:00"}`).getTime());
     payouts.sort((a,b) => new Date(`${a.date}T${a.time || "00:00"}`).getTime() - new Date(`${b.date}T${b.time || "00:00"}`).getTime());
     
     return { pastMatches: past, upcomingMatches: up, payoutMatches: payouts };
  }, [matches]);

  return (
    <div className="flex flex-col gap-6 p-4 max-w-4xl mx-auto w-full pb-24">
      {/* Independence Day greeting — date-gated (13–16 Aug), dismissible */}
      {isIndependenceDayWindow() && (
        <IndependenceDayBanner clubName={store.appConfig?.clubName} />
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
           Admin Dashboard
        </h2>
      </div>

      {/* Finance: Total Dues + Add No Show + Send Reminders */}
      {isFinanceAdmin && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="glass rounded-xl border border-glass-border p-4 flex flex-col justify-between cursor-pointer hover:bg-white/5 transition" onClick={() => setActiveTab("dues_and_reminders")}>
                <div>
                    <IndianRupee className="w-8 h-8 text-rose-500 bg-rose-500/10 p-1.5 rounded-lg mb-2" />
                    <p className="text-xs text-white/60 font-bold uppercase tracking-widest mt-1">Total Dues</p>
                    <h3 className="text-2xl font-black text-rose-400">₹{totalDueAmount}</h3>
                </div>
                <div className="mt-3 flex flex-col xl:flex-row xl:items-center justify-between gap-1 xl:gap-2 text-[10px] xl:text-xs font-bold text-white/50 bg-black/20 p-2 rounded-lg">
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {duePlayersCount} Players Due</span>
                    <span className="text-rose-400 flex items-center gap-1">Notify <ArrowRight className="w-3 h-3" /></span>
                </div>
            </div>

            <div className="flex flex-col gap-4">
              <button onClick={() => setActiveTab("dues_and_reminders")} className="glass p-4 rounded-xl border border-glass-border flex items-center gap-3 hover:bg-rose-500/10 transition group">
                 <div className="bg-rose-500/20 text-rose-400 p-2 rounded-lg">
                     <Bell className="w-5 h-5 group-hover:scale-110 transition" />
                 </div>
                 <div className="text-left">
                     <p className="font-bold text-white text-sm">Send Reminders</p>
                     <p className="text-[10px] text-white/50">Notify accounts</p>
                 </div>
              </button>
              <button
                onClick={() => setIsNoShowModalOpen(true)}
                className="glass p-4 rounded-xl border border-orange-500/40 bg-orange-500/5 flex items-center gap-3 hover:bg-orange-500/10 transition group"
              >
                 <div className="bg-orange-500/20 text-orange-400 p-2 rounded-lg">
                     <UserX className="w-5 h-5 group-hover:scale-110 transition" />
                 </div>
                 <div className="text-left">
                     <p className="font-bold text-white text-sm">Add No Show</p>
                     <p className="text-[10px] text-white/50">Fine Absentees</p>
                 </div>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Matches: Add Match + Assign Fees + Calendar + Poll */}
      {isMatchAdmin && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setActiveTab("matches", "add_match")}
              className="glass p-4 rounded-xl border border-glass-border flex items-center gap-3 hover:bg-emerald-500/10 transition group"
            >
                <div className="bg-emerald-500/20 text-emerald-400 p-2 rounded-lg">
                    <Plus className="w-5 h-5 group-hover:scale-110 transition" />
                </div>
                <div className="text-left">
                    <p className="font-bold text-white text-sm">Add New Match</p>
                    <p className="text-[10px] text-white/50">Schedule a fixture</p>
                </div>
            </button>
            <button onClick={() => setActiveTab("matches", "assign")} className="glass flex items-center justify-between p-4 rounded-xl border border-glass-border hover:bg-white/5 transition">
               <div className="flex items-center gap-3">
                   <div className="bg-blue-500/20 text-blue-400 p-2 rounded-lg">
                       <Calculator className="w-5 h-5" />
                   </div>
                   <div className="text-left">
                       <p className="text-sm font-bold text-white">Assign Fees</p>
                       <p className="text-[10px] text-white/50 uppercase font-black tracking-widest mt-0.5">To Players</p>
                   </div>
               </div>
               <ArrowRight className="w-4 h-4 text-white/30" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => setActiveTab("matches", "calendar")} className="glass flex items-center justify-between p-4 rounded-xl border border-glass-border hover:bg-white/5 transition">
               <div className="flex items-center gap-3">
                   <div className="bg-purple-500/20 text-purple-400 p-2 rounded-lg">
                       <Landmark className="w-5 h-5" />
                   </div>
                   <div className="text-left">
                       <p className="text-sm font-bold text-white">View Calendar</p>
                       <p className="text-[10px] text-white/50 uppercase font-black tracking-widest mt-0.5">All Fixtures</p>
                   </div>
               </div>
               <ArrowRight className="w-4 h-4 text-white/30" />
            </button>
            <button onClick={() => setActiveTab("opinion", "add_poll")} className="glass flex items-center justify-between p-4 rounded-xl border border-glass-border hover:bg-white/5 transition">
               <div className="flex items-center gap-3">
                   <div className="bg-sky-500/20 text-sky-400 p-2 rounded-lg">
                       <PieChart className="w-5 h-5" />
                   </div>
                   <div className="text-left">
                       <p className="text-sm font-bold text-white">Start a Poll</p>
                       <p className="text-[10px] text-white/50 uppercase font-black tracking-widest mt-0.5">Gather Opinion</p>
                   </div>
               </div>
               <ArrowRight className="w-4 h-4 text-white/30" />
            </button>
          </div>
        </>
      )}

      {/* Studio: Add to Studio */}
      {isStudioAdmin && (
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setActiveTab("studio", "add_player")}
            className="glass p-4 rounded-xl border border-glass-border flex items-center gap-3 hover:bg-amber-500/10 transition group"
          >
              <div className="bg-amber-500/20 text-amber-400 p-2 rounded-lg">
                  <PlusCircle className="w-5 h-5 group-hover:scale-110 transition" />
              </div>
              <div className="text-left">
                  <p className="font-bold text-white text-sm">Add to Studio</p>
                  <p className="text-[10px] text-white/50">Add a new member</p>
              </div>
          </button>
        </div>
      )}
      
      {/* Club Admin: Players + Reminders */}
      {isClubAdmin && !isSuperAdmin && (
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setActiveTab("players")}
            className="glass p-4 rounded-xl border border-glass-border flex items-center gap-3 hover:bg-sky-500/10 transition group"
          >
              <div className="bg-sky-500/20 text-sky-400 p-2 rounded-lg">
                  <Users className="w-5 h-5 group-hover:scale-110 transition" />
              </div>
              <div className="text-left">
                  <p className="font-bold text-white text-sm">Manage Players</p>
                  <p className="text-[10px] text-white/50">Directory & profiles</p>
              </div>
          </button>
          <button
            onClick={() => setActiveTab("dues_and_reminders")}
            className="glass p-4 rounded-xl border border-glass-border flex items-center gap-3 hover:bg-rose-500/10 transition group"
          >
              <div className="bg-rose-500/20 text-rose-400 p-2 rounded-lg">
                  <Bell className="w-5 h-5 group-hover:scale-110 transition" />
              </div>
              <div className="text-left">
                  <p className="font-bold text-white text-sm">Send Reminders</p>
                  <p className="text-[10px] text-white/50">Payment notifications</p>
              </div>
          </button>
        </div>
      )}

      {/* Payout to Organiser Panel — Finance/Super only */}
      {isFinanceAdmin && payoutMatches.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-lg font-bold text-white tracking-tight">Payout to Organiser</h3>
          </div>
          <div className="flex flex-col gap-4">
             {payoutMatches.map(m => {
                 const calculatedFee = getPayoutAmount(m);
                 const ground = store.grounds.find(g => g.id === m.groundId);
                 const orgNumber = ground?.gpayNumber || ground?.organiserName || 'N/A';
                 return (
                     <div key={m.id} className="glass p-4 rounded-xl border border-glass-border flex flex-col md:flex-row md:items-center justify-between gap-4">
                         <div>
                             <div className="flex items-center gap-2 mb-1">
                                 <h4 className="font-bold text-white">vs {m.opponent}</h4>
                                 <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full">{format(parseISO(m.date), "MMM d")}</span>
                             </div>
                             <p className="text-xs text-white/60 mb-2">{m.format} • {m.time ? format(parseISO(`${m.date}T${m.time}`), "h:mm a") : "Time TBD"} • {ground?.name || 'Unknown Ground'}</p>
                             <div className="flex items-center gap-2 text-sm text-white/80">
                                 <WalletCards className="w-4 h-4 text-emerald-400" />
                                 <span>Organiser Contact: <strong className="text-white">{orgNumber}</strong></span>
                                 {orgNumber !== 'N/A' && (
                                     <button 
                                         onClick={() => {
                                             navigator.clipboard.writeText(orgNumber);
                                             alert("Copied Organiser Contact!");
                                         }}
                                         className="p-1 hover:bg-white/10 rounded transition"
                                         title="Copy Number"
                                     >
                                         <Copy className="w-3.5 h-3.5 text-white/50" />
                                     </button>
                                 )}
                             </div>
                         </div>
                         <div className="flex flex-col items-end gap-2 shrink-0">
                             <div className="text-right">
                                 <p className="text-[10px] uppercase font-bold tracking-widest text-white/50">Ground Fee</p>
                                 <p className="text-xl font-black text-rose-400">₹{calculatedFee}</p>
                             </div>
                             <button 
                                 onClick={() => handlePayout(m)}
                                 className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-2"
                             >
                                 <CheckCircle2 className="w-4 h-4" /> Mark Paid
                             </button>
                         </div>
                     </div>
                 )
             })}
          </div>
        </div>
      )}

      {/* Swipe Pane for matches — Match/Super only */}
      {isMatchAdmin && <div className="mt-4">
        <div className="flex items-center justify-between mb-4">
           <h3 className="text-lg font-bold text-white tracking-tight">Upcoming Matches</h3>
           <span className="text-xs text-white/50 hover:text-white cursor-pointer" onClick={() => setActiveTab("matches")}>View All</span>
        </div>
        <div className="flex overflow-x-auto gap-4 pb-4 snap-x no-scrollbar">
           {upcomingMatches.length === 0 ? (
               <div className="text-white/40 text-sm glass p-6 rounded-xl w-full text-center border border-white/5">No upcoming matches</div>
           ) : (
               upcomingMatches.map(m => (
                   <div key={m.id} className="min-w-[280px] snap-center glass p-5 rounded-2xl border border-glass-border shrink-0">
                       <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-1">{format(parseISO(m.date), "MMM d, yyyy")}</p>
                       <p className="text-lg font-bold text-white mb-2">vs {m.opponent}</p>
                       <p className="text-xs font-medium text-white/70 mb-4">{m.format} • {m.time ? format(parseISO(`${m.date}T${m.time}`), "h:mm a") : "Time TBD"}</p>
                       <div className="space-y-2">
                           <button
                             onClick={() => handleNotifyMatch(m)}
                             className="w-full bg-accent hover:opacity-90 text-black py-2 rounded-lg text-xs font-black uppercase tracking-widest transition flex items-center justify-center gap-1.5 shadow"
                             title="Share match alert on WhatsApp with players tagged"
                           >
                             <Send className="w-3.5 h-3.5" /> Notify
                           </button>
                           <div className="flex gap-2">
                               <button onClick={() => {
                                 setSelectedRemindMatch(m);
                                 setIsGroupRemindModalOpen(true);
                               }} className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> Remind</button>
                               <button onClick={() => setActiveTab("matches", `match_${m.id}`)} className="flex-1 bg-white/10 hover:bg-white/15 text-white/80 py-2 rounded-lg text-xs font-bold transition">Manage</button>
                           </div>
                       </div>
                   </div>
               ))
           )}
        </div>
      </div>}

      {/* Group Remind Modal */}
      {isGroupRemindModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0f172a] border border-glass-border rounded-xl w-full max-w-sm p-4 relative shadow-2xl animate-fade-in">
            <button
              onClick={() => setIsGroupRemindModalOpen(false)}
              className="absolute top-4 right-4 text-white/50 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-400 mb-2 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Remind Group
            </h3>
            <p className="text-xs text-white/60 mb-4 leading-relaxed">
              This will open WhatsApp with the match details and squad list. You can select your club's WhatsApp group to send the message.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                  Optional Custom Message
                </label>
                <textarea
                  value={groupRemindCustomMsg}
                  onChange={(e) => setGroupRemindCustomMsg(e.target.value)}
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/50 text-white placeholder-white/30"
                  placeholder="e.g., Please reach 15 mins early!"
                  rows={3}
                />
              </div>
              <button
                onClick={handleGroupRemind}
                className="w-full bg-emerald-500 text-black font-bold py-2.5 rounded-lg hover:bg-emerald-400 transition shadow flex items-center justify-center gap-2"
              >
                Continue to WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add No Show Modal */}
      {isNoShowModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0f172a] border border-glass-border rounded-xl w-full max-w-md p-5 relative shadow-2xl max-h-[90vh] flex flex-col">
            <button
              onClick={resetNoShow}
              className="absolute top-4 right-4 text-white/50 hover:text-white transition"
              disabled={isSavingNoShow}
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold uppercase tracking-widest text-orange-400 mb-3 flex items-center gap-2">
              <UserX className="w-4 h-4" /> Add No Show Fee
            </h3>
            <p className="text-[11px] text-white/60 mb-4 leading-relaxed">
              Charges an <span className="text-orange-400 font-bold">Other Fee</span>
              {" "}called <em>No Show</em> to every selected player. Add a
              comment (e.g. the match date) so players know what the fine
              is for.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                  Amount (₹) *
                </label>
                <input
                  type="number"
                  min={0}
                  value={noShowAmount || ""}
                  onChange={(e) => setNoShowAmount(Number(e.target.value))}
                  placeholder="e.g. 200"
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 text-white placeholder-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                  Selected
                </label>
                <div className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white h-[38px] flex items-center">
                  {noShowSelected.length} player(s)
                </div>
              </div>
            </div>

            <div className="mb-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                Comment (visible to players)
              </label>
              <input
                type="text"
                value={noShowComment}
                onChange={(e) => setNoShowComment(e.target.value)}
                placeholder="e.g. No show for match vs Titans on 12 Aug"
                className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 text-white placeholder-white/30"
              />
            </div>

            <div className="mb-3 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50">
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
                  className="text-orange-400 text-[10px] uppercase font-bold tracking-wider hover:underline"
                >
                  {noShowSelected.length === noShowFiltered.length &&
                  noShowFiltered.length > 0
                    ? "Deselect All"
                    : "Select All Filtered"}
                </button>
              </div>
              <input
                type="text"
                placeholder="Search players..."
                value={noShowSearch}
                onChange={(e) => setNoShowSearch(e.target.value)}
                className="w-full bg-black/40 border border-glass-border rounded-t-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 text-white placeholder-white/30"
              />
              <div className="flex-1 overflow-y-auto min-h-[8rem] max-h-[16rem] border border-t-0 border-glass-border rounded-b-lg bg-black/20 p-2 flex flex-col gap-1">
                {noShowFiltered.length === 0 && (
                  <div className="text-xs text-white/40 italic p-2 text-center">
                    No players found.
                  </div>
                )}
                {noShowFiltered.map((p) => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition ${
                      noShowSelected.includes(p.id)
                        ? "bg-orange-500/20 border border-orange-500/40 text-white"
                        : "hover:bg-white/5 border border-transparent text-white/70"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={noShowSelected.includes(p.id)}
                      onChange={() =>
                        setNoShowSelected((prev) =>
                          prev.includes(p.id)
                            ? prev.filter((x) => x !== p.id)
                            : [...prev, p.id],
                        )
                      }
                      className="accent-orange-500"
                    />
                    <span className="text-xs truncate flex-1">{p.name}</span>
                    <span className="text-[10px] text-white/40 font-mono">
                      {p.mobile || ""}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleSaveNoShow}
              disabled={isSavingNoShow}
              className="w-full bg-orange-500 text-black font-bold py-2.5 rounded-lg hover:bg-orange-400 transition shadow flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSavingNoShow
                ? "Saving..."
                : `Add No Show to ${noShowSelected.length} player(s)`}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
