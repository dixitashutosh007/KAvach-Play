import { useState, useMemo } from "react";
import { useAuth } from "./AuthProvider";
import { PieChart, Plus, Trash2, Edit2, Activity, CheckCircle2, Circle, AlertCircle, EyeOff } from "lucide-react";
import { db } from "@/lib/firebase";
import { doc, setDoc, deleteDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { Poll, PollResponse } from "@/lib/types";

export function OpinionTab({ store, persona }: { store: any; persona: "admin" | "player" }) {
  const { user } = useAuth();
  const isAdmin = persona === "admin";
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [title, setTitle] = useState("");
  const [type, setType] = useState<Poll["type"]>("singleChoice");
  const [options, setOptions] = useState<string[]>(["Option 1", "Option 2"]);
  const [sliderMin, setSliderMin] = useState<number>(1);
  const [sliderMax, setSliderMax] = useState<number>(5);
  const [sliderMinLabel, setSliderMinLabel] = useState<string>("Strongly Disagree");
  const [sliderMaxLabel, setSliderMaxLabel] = useState<string>("Strongly Agree");
  const [isSticked, setIsSticked] = useState(true);
  
  const handleAddOption = () => setOptions([...options, `Option ${options.length + 1}`]);
  const handleRemoveOption = (idx: number) => setOptions(options.filter((_, i) => i !== idx));
  const handleOptionChange = (idx: number, val: string) => {
    const newOpts = [...options];
    newOpts[idx] = val;
    setOptions(newOpts);
  };

  const startEditing = (poll: Poll) => {
    setEditingId(poll.id);
    setTitle(poll.title);
    setType(poll.type);
    setOptions(poll.options || ["Option 1", "Option 2"]);
    setSliderMin(poll.sliderMin || 1);
    setSliderMax(poll.sliderMax || 5);
    setSliderMinLabel(poll.sliderMinLabel || "Strongly Disagree");
    setSliderMaxLabel(poll.sliderMaxLabel || "Strongly Agree");
    setIsSticked(poll.isSticked);
    setIsAdding(true);
  };

  const submitPoll = async () => {
    if (!title) return alert("Title is required");
    if (type !== "slider" && options.length < 2) return alert("At least 2 options required");
    
    try {
      if (editingId) {
        await updateDoc(doc(db, "polls", editingId), {
          title,
          type,
          options: type === "slider" ? [] : options,
          sliderMin: type === "slider" ? sliderMin : 0,
          sliderMax: type === "slider" ? sliderMax : 0,
          sliderMinLabel: type === "slider" ? sliderMinLabel : "",
          sliderMaxLabel: type === "slider" ? sliderMaxLabel : "",
          isSticked,
          isEdited: true,
          updatedAt: serverTimestamp(),
        });
      } else {
        const pollId = "poll_" + Date.now();
        await setDoc(doc(db, "polls", pollId), {
          title,
          type,
          options: type === "slider" ? [] : options,
          sliderMin: type === "slider" ? sliderMin : 0,
          sliderMax: type === "slider" ? sliderMax : 0,
          sliderMinLabel: type === "slider" ? sliderMinLabel : "",
          sliderMaxLabel: type === "slider" ? sliderMaxLabel : "",
          isSticked,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setIsAdding(false);
      setEditingId(null);
      setTitle("");
      setOptions(["Option 1", "Option 2"]);
      setSliderMinLabel("Strongly Disagree");
      setSliderMaxLabel("Strongly Agree");
    } catch (err: any) {
      alert("Error saving poll: " + err.message);
    }
  };

  const togglePollStatus = async (poll: Poll) => {
    try {
      await updateDoc(doc(db, "polls", poll.id), {
        isActive: !poll.isActive,
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      alert("Error toggling status: " + err.message);
    }
  };

  const toggleStickStatus = async (poll: Poll) => {
    try {
      await updateDoc(doc(db, "polls", poll.id), {
        isSticked: !poll.isSticked,
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      alert("Error toggling stick status: " + err.message);
    }
  };

  const deletePoll = async (pollId: string) => {
    if (!confirm("Are you sure? This will remove all responses from players' profiles too.")) return;
    try {
      await deleteDoc(doc(db, "polls", pollId));
      // Optionally cleanup responses, but usually we just filter them out.
    } catch(err: any) {
      alert("Error deleting: " + err.message);
    }
  };

  const handleVote = async (pollId: string, responseVal: any) => {
    if (!user) return;
    const responseId = pollId + "_" + user.uid;
    try {
      await setDoc(doc(db, "pollResponses", responseId), {
        pollId,
        playerId: user.uid,
        response: responseVal,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      alert("Error voting: " + err.message);
    }
  };

  const activePolls = store.polls.filter((p: Poll) => p.isActive);

  return (
    <div className="space-y-6 pb-24 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center border border-accent/30">
            <PieChart className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Pulse</h2>
          </div>
        </div>
        {isAdmin && !isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="px-4 py-2 bg-accent text-black font-bold uppercase tracking-wider text-[10px] rounded-xl hover:opacity-90 transition flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add Poll
          </button>
        )}
      </div>

      {isAdding && isAdmin && (
        <div className="glass p-5 rounded-2xl border border-accent/30 space-y-4 shadow-lg">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Create New Poll</h3>
          
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-white/60 tracking-wider">Question / Title</label>
            <input 
              value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-accent outline-none"
              placeholder="e.g. Where should we host the annual party?"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-white/60 tracking-wider">Poll Type</label>
            <select
              value={type} onChange={(e: any) => setType(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-accent outline-none [&>option]:bg-emerald-950"
            >
              <option value="singleChoice">Single Choice</option>
              <option value="multipleChoice">Multiple Choice</option>
              <option value="slider">Slider (1 to 5)</option>
            </select>
          </div>

          {type !== "slider" && (
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-white/60 tracking-wider">Options</label>
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input 
                    value={opt} onChange={(e) => handleOptionChange(idx, e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-accent outline-none"
                  />
                  <button onClick={() => handleRemoveOption(idx)} className="p-2 text-rose-400 hover:bg-rose-500/20 rounded-xl">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button onClick={handleAddOption} className="text-xs text-accent font-bold mt-2">+ Add Option</button>
            </div>
          )}

          {type === "slider" && (
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/60 tracking-wider">Min Value</label>
                  <input type="number" value={sliderMin} onChange={e => setSliderMin(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/60 tracking-wider">Max Value</label>
                  <input type="number" value={sliderMax} onChange={e => setSliderMax(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/60 tracking-wider">Min Label</label>
                  <input value={sliderMinLabel} onChange={e => setSliderMinLabel(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/60 tracking-wider">Max Label</label>
                  <input value={sliderMaxLabel} onChange={e => setSliderMaxLabel(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <input type="checkbox" id="stick" checked={isSticked} onChange={e => setIsSticked(e.target.checked)} className="accent-accent w-4 h-4" />
            <label htmlFor="stick" className="text-sm text-white/80">Stick to Club Feed</label>
          </div>

          <div className="flex gap-3 pt-4">
            <button onClick={() => { setIsAdding(false); setEditingId(null); }} className="flex-1 py-2 rounded-xl bg-white/5 text-white/70 text-xs font-bold hover:bg-white/10 transition">Cancel</button>
            <button onClick={submitPoll} className="flex-1 py-2 rounded-xl bg-accent text-black text-xs font-bold hover:opacity-90 transition">{editingId ? "Update Poll" : "Save Poll"}</button>
          </div>
        </div>
      )}

      {/* Render Polls */}
      <div className="space-y-8">
        {(isAdmin ? store.polls : activePolls).length === 0 ? (
           <div className="text-center text-white/40 text-sm py-10 glass rounded-2xl border border-white/5">No polls available.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(isAdmin ? store.polls : activePolls).map((poll: Poll) => {
              const myResponse = store.pollResponses.find((r: PollResponse) => r.pollId === poll.id && r.playerId === user?.uid);
              const totalResponses = store.pollResponses.filter((r: PollResponse) => r.pollId === poll.id);

              return (
                <div key={poll.id} className={`glass rounded-2xl p-5 border relative overflow-hidden flex flex-col ${poll.isActive ? 'border-white/10' : 'border-rose-500/30 opacity-70'}`}>
                  {poll.isSticked && (
                    <div className="absolute top-0 right-0 bg-accent text-black text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-bl-xl">Sticked</div>
                  )}
                  {!poll.isActive && isAdmin && (
                    <div className="absolute top-0 right-0 bg-rose-500 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-bl-xl">Deactivated</div>
                  )}
                  {poll.isEdited && (
                    <div className={`absolute top-0 right-${(poll.isSticked || (!poll.isActive && isAdmin)) ? '12' : '0'} bg-white/20 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1 ${!(poll.isSticked || (!poll.isActive && isAdmin)) ? 'rounded-bl-xl' : ''}`}>Edited</div>
                  )}

                  <h3 className="text-base font-bold text-white pr-12 leading-tight">{poll.title}</h3>
                  <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1.5 mb-4">
                    {poll.type === "singleChoice" ? "Single Choice" : poll.type === "multipleChoice" ? "Multiple Choice" : "Slider"} 
                    {isAdmin && <span className="ml-2 bg-white/10 px-1.5 py-0.5 rounded">{totalResponses.length} Votes</span>}
                  </p>

                  <div className="mt-auto">
                    {isAdmin ? (
                      <div className="space-y-3">
                        <div className="bg-black/30 rounded-xl p-3 max-h-48 overflow-y-auto">
                           {poll.type === "slider" && (
                             <div className="text-xs text-white/60 font-mono mb-2">Range: {poll.sliderMin} to {poll.sliderMax}</div>
                           )}
                           <PollResults poll={poll} store={store} isAdmin={true} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => togglePollStatus(poll)} className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-[10px] font-bold uppercase transition flex justify-center items-center gap-1">
                            {poll.isActive ? <EyeOff className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />} {poll.isActive ? "Deactivate" : "Activate"}
                          </button>
                          <button onClick={() => toggleStickStatus(poll)} className={`flex-1 py-1.5 rounded-lg text-white text-[10px] font-bold uppercase transition flex justify-center items-center gap-1 ${poll.isSticked ? 'bg-accent/20 text-accent hover:bg-accent/30' : 'bg-white/5 hover:bg-white/10'}`}>
                            <Activity className="w-3 h-3" /> {poll.isSticked ? "Unstick" : "Stick"}
                          </button>
                          <button onClick={() => startEditing(poll)} className="w-8 flex items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deletePoll(poll.id)} className="w-8 flex items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        {myResponse ? (
                           <div className="bg-accent/10 border border-accent/20 rounded-xl p-3 text-center">
                             <div className="w-8 h-8 mx-auto bg-accent/20 rounded-full flex items-center justify-center text-accent mb-2"><CheckCircle2 className="w-5 h-5"/></div>
                             <p className="text-accent text-xs font-bold uppercase tracking-wider">Submitted</p>
                             <p className="text-[10px] text-white/60 mt-1">View your response in Profile &gt; Opinion</p>
                           </div>
                        ) : (
                           <PollInteraction poll={poll} onVote={(val) => handleVote(poll.id, val)} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function PollInteraction({ poll, onVote }: { poll: Poll, onVote: (val: any) => void }) {
  const [singleVal, setSingleVal] = useState<string>("");
  const [multiVal, setMultiVal] = useState<string[]>([]);
  const [sliderVal, setSliderVal] = useState<number>(poll.sliderMin || 1);

  const handleMultiToggle = (opt: string) => {
    if (multiVal.includes(opt)) setMultiVal(multiVal.filter(v => v !== opt));
    else setMultiVal([...multiVal, opt]);
  };

  const submit = () => {
    if (poll.type === "singleChoice") {
      if (!singleVal) return;
      onVote(singleVal);
    } else if (poll.type === "multipleChoice") {
      if (multiVal.length === 0) return;
      onVote(multiVal);
    } else {
      onVote(sliderVal);
    }
  };

  return (
    <div className="space-y-3">
      {poll.type === "singleChoice" && (
        <div className="space-y-2">
          {poll.options?.map(opt => (
            <div key={opt} onClick={() => setSingleVal(opt)} className={`p-2 rounded-xl border text-sm cursor-pointer transition flex items-center gap-2 ${singleVal === opt ? 'bg-accent/20 border-accent/40 text-white' : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'}`}>
              {singleVal === opt ? <CheckCircle2 className="w-4 h-4 text-accent" /> : <Circle className="w-4 h-4 opacity-40" />}
              {opt}
            </div>
          ))}
        </div>
      )}

      {poll.type === "multipleChoice" && (
        <div className="space-y-2">
          {poll.options?.map(opt => (
            <div key={opt} onClick={() => handleMultiToggle(opt)} className={`p-2 rounded-xl border text-sm cursor-pointer transition flex items-center gap-2 ${multiVal.includes(opt) ? 'bg-accent/20 border-accent/40 text-white' : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'}`}>
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition ${multiVal.includes(opt) ? 'border-accent bg-accent text-black' : 'border-white/30'}`}>
                {multiVal.includes(opt) && <CheckCircle2 className="w-3 h-3" />}
              </div>
              {opt}
            </div>
          ))}
        </div>
      )}

      {poll.type === "slider" && (
        <div className="space-y-4 px-2">
           <div className="flex justify-between text-xs font-mono text-white/50">
             <div className="flex flex-col items-start gap-1">
               <span>{poll.sliderMin}</span>
               {poll.sliderMinLabel && <span className="text-[10px] uppercase tracking-wider text-white/40">{poll.sliderMinLabel}</span>}
             </div>
             <span className="text-accent text-lg font-bold">{sliderVal}</span>
             <div className="flex flex-col items-end gap-1">
               <span>{poll.sliderMax}</span>
               {poll.sliderMaxLabel && <span className="text-[10px] uppercase tracking-wider text-white/40">{poll.sliderMaxLabel}</span>}
             </div>
           </div>
           <input 
             type="range" min={poll.sliderMin} max={poll.sliderMax} value={sliderVal}
             onChange={e => setSliderVal(Number(e.target.value))}
             className="w-full accent-accent"
           />
        </div>
      )}

      <button onClick={submit} className="w-full py-2.5 mt-2 bg-accent text-black text-xs font-bold uppercase tracking-wider rounded-xl hover:opacity-90 transition">
        Submit Vote
      </button>
    </div>
  );
}

export function PollResults({ poll, store, isAdmin }: { poll: Poll, store: any, isAdmin?: boolean }) {
  const responses = store.pollResponses.filter((r: PollResponse) => r.pollId === poll.id);
  const totalVotes = responses.length;

  const tally: Record<string, { count: number, voters: string[] }> = {};

  if (poll.options) {
    poll.options.forEach(opt => {
      tally[opt] = { count: 0, voters: [] };
    });
  }

  if (poll.type === "singleChoice" || poll.type === "slider") {
    responses.forEach((r: PollResponse) => {
      const val = String(r.response);
      if (!tally[val]) tally[val] = { count: 0, voters: [] };
      tally[val].count++;
      const user = store.appUsers.find((u: any) => u.id === r.playerId) || store.players.find((p: any) => p.id === r.playerId || p.authUid === r.playerId);
      tally[val].voters.push(user?.name || "Unknown Player");
    });
  } else if (poll.type === "multipleChoice") {
    responses.forEach((r: PollResponse) => {
      const vals = Array.isArray(r.response) ? r.response : [r.response];
      vals.forEach(val => {
        const v = String(val);
        if (!tally[v]) tally[v] = { count: 0, voters: [] };
        tally[v].count++;
        const user = store.appUsers.find((u: any) => u.id === r.playerId) || store.players.find((p: any) => p.id === r.playerId || p.authUid === r.playerId);
        tally[v].voters.push(user?.name || "Unknown Player");
      });
    });
  }

  const sortedTally = Object.entries(tally).sort((a, b) => b[1].count - a[1].count);

  return (
    <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
      <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/50">
        <span>Results</span>
        <span>{totalVotes} {totalVotes === 1 ? "Vote" : "Votes"}</span>
      </div>
      {sortedTally.length === 0 ? (
        <div className="text-xs text-white/40">No options to show.</div>
      ) : (
        <div className="space-y-3">
          {sortedTally.map(([opt, data]) => {
            const percentage = totalVotes > 0 ? Math.round((data.count / totalVotes) * 100) : 0;
            return (
              <div key={opt} className="space-y-1">
                <div className="flex justify-between text-xs text-white">
                  <span className="font-medium">{opt}</span>
                  <span className="text-white/60">{data.count} ({percentage}%)</span>
                </div>
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${percentage}%` }} />
                </div>
                {isAdmin && data.voters.length > 0 && (
                  <div className="text-[10px] text-white/40 leading-tight mt-1">
                    <span className="font-bold text-accent">Voters:</span> {data.voters.join(", ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
