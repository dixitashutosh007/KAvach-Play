"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, getDocs, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Match, Ground } from "@/lib/types";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Calendar, MapPin, Filter, Trophy } from "lucide-react";
import { dbToInputDate } from "@/lib/utils";

export default function SchedulePage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedGround, setSelectedGround] = useState("All");
  const [selectedMonth, setSelectedMonth] = useState("All");
  const [showOnlyEmpty, setShowOnlyEmpty] = useState(false);

  const getMatchDateObj = (match: Match) => {
    const parts = dbToInputDate(match.date).split("/");
    let d = new Date();
    if (parts.length === 3) {
      d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    } else {
      d = new Date(match.date);
    }
    if (match.time) {
      const [hours, mins] = match.time.split(":");
      d.setHours(parseInt(hours, 10) || 23, parseInt(mins, 10) || 59, 59, 999);
    } else {
      d.setHours(23, 59, 59, 999);
    }
    return d;
  };

  useEffect(() => {
    async function fetchData() {
      try {
        const groundsSnap = await getDocs(collection(db, "grounds"));
        const groundsData = groundsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Ground));
        setGrounds(groundsData);

        const matchesQuery = query(collection(db, "matches"));
        const matchesSnap = await getDocs(matchesQuery);
        let matchesData = matchesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Match));
        
        // Filter out archived matches and old matches
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        matchesData = matchesData.filter(m => {
          if (m.isArchived) return false;
          const mDate = getMatchDateObj(m);
          return mDate >= today;
        });

        // Generate dummy open slots for weekends up to 6 months ahead
        const dummyMatches: Match[] = [];
        const endData = new Date(today);
        endData.setMonth(endData.getMonth() + 6);
        
        let current = new Date(today);
        while (current <= endData) {
          const dayOfWeek = current.getDay();
          if (dayOfWeek === 0 || dayOfWeek === 6) { // Sunday or Saturday
             const hasMatch = matchesData.some(m => {
                 const mObj = getMatchDateObj(m);
                 return mObj.getFullYear() === current.getFullYear() && 
                        mObj.getMonth() === current.getMonth() && 
                        mObj.getDate() === current.getDate();
             });
             
             if (!hasMatch) {
                const y = current.getFullYear();
                const m = String(current.getMonth() + 1).padStart(2, "0");
                const d = String(current.getDate()).padStart(2, "0");
                
                dummyMatches.push({
                   id: "dummy-" + current.getTime(),
                   groundId: "dummy-all-grounds", // Bypass ground filter
                   date: `${y}-${m}-${d}`,
                   time: "09:00",
                   opponent: "Open Slot",
                   format: "Other",
                   matchType: "Practice",
                   fee: 0,
                   jerseyColor: "",
                   maxSquadSize: 12,
                   isArchived: false,
                   isTentative: false,
                   createdAt: new Date().toISOString(),
                   updatedAt: new Date().toISOString()
                } as any);
             }
          }
          current.setDate(current.getDate() + 1);
        }
        
        matchesData = [...matchesData, ...dummyMatches];

        matchesData.sort((a, b) => getMatchDateObj(a).getTime() - getMatchDateObj(b).getTime());

        setMatches(matchesData);
      } catch (err) {
        console.error("Error fetching schedule:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) return <LoadingScreen />;

  // Process data for filters
  const months = Array.from(
    new Set(
      matches.map((m) => {
        const d = getMatchDateObj(m);
        return d.toLocaleString("default", { month: "long", year: "numeric" });
      })
    )
  );

  const isSlotEmpty = (m: Match) => {
    if (m.isTentative) return false;
    const opp = (m.opponent || "").toLowerCase();
    const fmt = (m.format || "").toLowerCase();
    return !m.opponent || opp === "tbd" || opp.includes("open") || fmt.includes("open") || m.format === "Other" || opp.includes("slot");
  };

  const filteredMatches = matches.filter((m) => {
    if (showOnlyEmpty && !isSlotEmpty(m)) return false;

    if (selectedGround !== "All") {
      if (m.id.startsWith("dummy-")) return false;
      if (m.groundId !== selectedGround) return false;
    }

    if (selectedMonth !== "All") {
      const matchMonth = getMatchDateObj(m).toLocaleString("default", { month: "long", year: "numeric" });
      if (matchMonth !== selectedMonth) return false;
    }

    return true;
  });

  return (
    <div className="min-h-screen bg-transparent text-white p-4 font-sans pb-20">
      <div className="max-w-2xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="text-center space-y-2 py-6">
          <div className="inline-flex items-center justify-center p-3 bg-accent/20 rounded-full mb-2">
            <Trophy className="w-8 h-8 text-accent" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Match Schedule</h1>
          <p className="text-white/60 text-sm max-w-sm mx-auto leading-relaxed">
            View our upcoming cricket matches, tournaments, and explore available vacant slots.
          </p>
        </div>

        {/* Filters Panel */}
        <div className="glass p-5 rounded-2xl space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Filter className="w-4 h-4 text-accent" />
            <span className="font-semibold text-sm uppercase tracking-widest text-white/90">Filters</span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-white/60 uppercase tracking-wider font-bold">Ground</label>
              <select 
                value={selectedGround} 
                onChange={(e) => setSelectedGround(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm focus:border-accent outline-none appearance-none"
              >
                <option value="All" className="bg-neutral-900">All Grounds</option>
                {grounds.map(g => (
                  <option key={g.id} value={g.id} className="bg-neutral-900">{g.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-white/60 uppercase tracking-wider font-bold">Month</label>
              <select 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm focus:border-accent outline-none appearance-none"
              >
                <option value="All" className="bg-neutral-900">All Months</option>
                {months.map(m => (
                  <option key={m} value={m} className="bg-neutral-900">{m}</option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-3 mt-4 pt-4 border-t border-glass-border cursor-pointer w-max">
            <input 
              type="checkbox" 
              checked={showOnlyEmpty} 
              onChange={(e) => setShowOnlyEmpty(e.target.checked)}
              className="w-4 h-4 rounded bg-white/10 border-white/20 text-accent focus:ring-accent accent-accent"
            />
            <span className="text-sm font-medium">Show Only Vacant Slots (TBD/Open)</span>
          </label>
        </div>

        {/* Match List */}
        <div className="space-y-4 pt-2">
          {filteredMatches.length === 0 ? (
            <div className="text-center py-16 glass rounded-2xl">
              <div className="text-white/40 mb-2 font-medium">No matches found matching your filters.</div>
              <p className="text-white/30 text-xs">Try adjusting your filters or check back later.</p>
            </div>
          ) : (
            filteredMatches.map(match => {
              const ground = grounds.find(g => g.id === match.groundId);
              const empty = isSlotEmpty(match);
              const isTentative = match.isTentative;

              return (
                <div key={match.id} className={`p-5 rounded-2xl border transition-all ${isTentative ? 'bg-yellow-500/10 border-yellow-500/40 shadow-[0_0_15px_rgba(234,179,8,0.1)]' : empty ? 'bg-accent/10 border-accent/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'glass'}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-xl mb-1.5 flex items-center flex-wrap gap-2">
                        <Calendar className="w-5 h-5 text-accent mr-1" />
                        {getMatchDateObj(match).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })} {match.time ? `at ${match.time}` : ''}
                      </h3>
                      <div className="text-base text-white/80 flex items-center gap-2">
                        {match.isTentative ? (
                          <span className="text-yellow-500 font-medium">
                            Tentatively Blocked {match.tentativelyBlockedBy ? `by ${match.tentativelyBlockedBy}` : ''}
                          </span>
                        ) : empty ? (
                          <span className="text-accent font-medium">Vacant Slot Available</span>
                        ) : (
                          <span>vs {match.opponent}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider bg-white/10 px-2.5 py-1 rounded-full border border-white/5">
                        {match.format}
                      </div>
                    </div>
                  </div>
                  
                  {ground && (
                    <div className="text-sm font-medium text-white/80 flex items-center gap-2 mt-4 pt-3 border-t border-white/10">
                      <MapPin className="w-4 h-4 text-accent/80 shrink-0" />
                      <span className="truncate">{ground.name}</span>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  );
}
