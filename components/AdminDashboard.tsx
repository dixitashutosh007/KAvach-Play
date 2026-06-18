import { useStore } from "@/hooks/useStore";
import { useMemo } from "react";
import { Match, Player, MatchPayment, OtherFee } from "@/lib/types";
import { Calculator, IndianRupee, Bell, Plus, Users, Landmark, Search, PlusCircle, ArrowRight } from "lucide-react";
import { format, isPast, isFuture, parseISO } from "date-fns";

export function AdminDashboard({
  store,
  setActiveTab
}: {
  store: ReturnType<typeof useStore>;
  setActiveTab: (tab: any, action?: string) => void;
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
                matchDue += match.fee;
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

  const totalDueAmount = totalDueMatch + totalDueFee;

  const { pastMatches, upcomingMatches } = useMemo(() => {
     const now = new Date();
     const past: Match[] = [];
     const up: Match[] = [];
     matches.forEach(m => {
        const timeStr = m.time || "00:00";
        const dateObj = new Date(`${m.date}T${timeStr}`);
        if (isPast(dateObj)) {
            past.push(m);
        } else {
            up.push(m);
        }
     });

     past.sort((a,b) => new Date(`${b.date}T${b.time || "00:00"}`).getTime() - new Date(`${a.date}T${a.time || "00:00"}`).getTime());
     up.sort((a,b) => new Date(`${a.date}T${a.time || "00:00"}`).getTime() - new Date(`${b.date}T${b.time || "00:00"}`).getTime());
     
     return { pastMatches: past, upcomingMatches: up };
  }, [matches]);

  return (
    <div className="flex flex-col gap-6 p-4 max-w-4xl mx-auto w-full pb-24">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
           Admin Dashboard
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="glass rounded-xl border border-glass-border p-4 flex flex-col justify-between cursor-pointer hover:bg-white/5 transition" onClick={() => setActiveTab("finance", "due_report")}>
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
            <button 
              onClick={() => setActiveTab("studio", "add_player")}
              className="glass p-4 rounded-xl border border-glass-border flex items-center gap-3 hover:bg-amber-500/10 transition group"
            >
                <div className="bg-amber-500/20 text-amber-400 p-2 rounded-lg">
                    <PlusCircle className="w-5 h-5 group-hover:scale-110 transition" />
                </div>
                <div className="text-left">
                    <p className="font-bold text-white text-sm">Add to Studio</p>
                    <p className="text-[10px] text-white/50">Add a new player</p>
                </div>
            </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
          <button onClick={() => setActiveTab("finance", "due_report")} className="glass flex items-center justify-between p-4 rounded-xl border border-glass-border hover:bg-white/5 transition">
             <div className="flex items-center gap-3">
                 <div className="bg-rose-500/20 text-rose-400 p-2 rounded-lg">
                     <Bell className="w-5 h-5" />
                 </div>
                 <div className="text-left">
                     <p className="text-sm font-bold text-white">Send Reminders</p>
                     <p className="text-[10px] text-white/50 uppercase font-black tracking-widest mt-0.5">Notify accounts</p>
                 </div>
             </div>
             <ArrowRight className="w-4 h-4 text-white/30" />
          </button>

          <button onClick={() => setActiveTab("finance", "fee")} className="glass flex items-center justify-between p-4 rounded-xl border border-glass-border hover:bg-white/5 transition">
             <div className="flex items-center gap-3">
                 <div className="bg-blue-500/20 text-blue-400 p-2 rounded-lg">
                     <Calculator className="w-5 h-5" />
                 </div>
                 <div className="text-left">
                     <p className="text-sm font-bold text-white">Assign Fees</p>
                     <p className="text-[10px] text-white/50 uppercase font-black tracking-widest mt-0.5">Custom Payments</p>
                 </div>
             </div>
             <ArrowRight className="w-4 h-4 text-white/30" />
          </button>
      </div>
      
      <div className="grid grid-cols-1 gap-4">
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
      </div>

      {/* Swipe Pane for matches */}
      <div className="mt-4">
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
                       <button onClick={() => setActiveTab("matches", `match_${m.id}`)} className="w-full bg-white/10 hover:bg-white/15 text-white/80 py-2 rounded-lg text-xs font-bold transition">Manage Match</button>
                   </div>
               ))
           )}
        </div>
      </div>

    </div>
  );
}
