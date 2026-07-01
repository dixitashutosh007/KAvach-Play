import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ReminderSchedule } from "@/lib/types";

export function DuesAndRemindersTab({ store, isFinanceAdmin }: { store: any; isFinanceAdmin: boolean }) {
  const [subTab, setSubTab] = useState<"dues_report" | "automatic_reminders">("dues_report");

  // Dues Report State
  const [dueType, setDueType] = useState<"all" | "matches" | "others">("all");
  const [searchPlayer, setSearchPlayer] = useState("");
  const [filterMatchId, setFilterMatchId] = useState("");
  const [selectedDues, setSelectedDues] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Automatic Reminders State
  const defaultTemplate = {
    subject: "Pending Fee Reminder - {{clubName}}",
    body: "Hi {{playerName}},\n\nThis is a friendly reminder that you have an outstanding fee of {{amount}} for: {{duesText}}.\n\nPlease log in to clear your dues at your earliest convenience using this link: {{link}}\n\nBest regards,\n{{clubName}} Admin Team",
  };
  const [emailTemplate, setEmailTemplate] = useState(
    store.appConfig?.emailTemplates?.due_reminder || defaultTemplate
  );
  
  const [automaticReminders, setAutomaticReminders] = useState<ReminderSchedule[]>(Array.isArray(store.appConfig?.automaticReminders) ? store.appConfig.automaticReminders : []);
  const [isEmailSubOpen, setIsEmailSubOpen] = useState(true);
  
  const handleSaveRemindersConfig = async () => {
     try {
       await store.updateAppConfig({
          ...store.appConfig,
          emailTemplates: {
             ...(store.appConfig?.emailTemplates || {}),
             due_reminder: emailTemplate
          },
          automaticReminders
       });
       alert("Reminders Configuration Saved!");
     } catch (e) {
       alert("Failed to save configuration.");
     }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 bg-black/20 p-1 rounded-xl border border-glass-border overflow-x-auto hide-scrollbar">
        {[
          { key: "dues_report", label: "Report" },
          { key: "automatic_reminders", label: "Automation" },
        ].map((tab) => {
          const active = subTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setSubTab(tab.key as any)}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest whitespace-nowrap transition-all ${
                active ? "bg-accent text-black shadow-lg shadow-accent/20" : "text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {subTab === "automatic_reminders" && (
        <div className="glass p-6 rounded-2xl border border-glass-border space-y-6">
           {/* Reminder Schedules Section */}
           <div className="border border-glass-border rounded-xl bg-white/5 overflow-hidden">
             <div className="p-4 space-y-4">
               <div className="flex items-center justify-between">
                 <div className="space-y-1">
                   <h4 className="text-[11px] font-bold uppercase tracking-widest text-white/80">Reminder Schedules</h4>
                   <p className="text-[9px] text-white/50 max-w-sm">Note: A cron service (like Vercel Cron or Google Cloud Scheduler) is required to ping <span className="font-mono text-emerald-400">/api/cron/reminders</span> hourly for these to run automatically.</p>
                 </div>
                 <div className="flex items-center gap-2">
                   <button type="button" onClick={async () => {
                     if (window.confirm("This will trigger the cron endpoint which runs schedules that match the current hour. Since you are testing, you might want to ensure you have a schedule for the current hour. Continue?")) {
                        try {
                          const res = await fetch("/api/cron/reminders");
                          const data = await res.json();
                          alert(data.message || "Executed successfully");
                        } catch (e) {
                          alert("Failed to trigger");
                        }
                     }
                   }} className="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-[10px] font-bold hover:bg-emerald-500/30 transition flex items-center gap-1 uppercase tracking-widest">
                     Test Cron
                   </button>
                   <button type="button" onClick={() => {
                     setAutomaticReminders([...automaticReminders, { id: crypto.randomUUID(), days: [], time: "09:00", feeTypes: [] }]);
                   }} className="px-3 py-1 bg-accent/20 text-accent rounded-lg text-xs font-bold hover:bg-accent/30 transition flex items-center gap-1">
                     <Plus className="w-3 h-3" /> Add Schedule
                   </button>
                 </div>
               </div>
               
               <div className="space-y-4">
                 {automaticReminders.map((schedule, idx) => (
                   <div key={schedule.id} className="bg-black/20 border border-glass-border rounded-lg p-4 space-y-3 relative">
                     <button type="button" onClick={() => setAutomaticReminders(automaticReminders.filter(s => s.id !== schedule.id))} className="absolute top-2 right-2 text-white/40 hover:text-red-400">
                       <Trash2 className="w-4 h-4" />
                     </button>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div>
                         <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-white/60">Days</label>
                         <div className="flex flex-wrap gap-2">
                           {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => (
                             <button
                               key={day}
                               type="button"
                               onClick={() => {
                                 const newDays = schedule.days.includes(day) 
                                   ? schedule.days.filter(d => d !== day)
                                   : [...schedule.days, day];
                                 setAutomaticReminders(automaticReminders.map(s => s.id === schedule.id ? { ...s, days: newDays } : s));
                               }}
                               className={`px-2 py-1 text-[10px] rounded border transition ${schedule.days.includes(day) ? 'bg-accent/20 border-accent text-accent' : 'border-glass-border text-white/50 hover:bg-white/5'}`}
                             >
                               {day.slice(0, 3)}
                             </button>
                           ))}
                         </div>
                       </div>
                       
                       <div>
                         <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-white/60">Time</label>
                         <input 
                           type="time"
                           value={schedule.time}
                           onChange={e => setAutomaticReminders(automaticReminders.map(s => s.id === schedule.id ? { ...s, time: e.target.value } : s))}
                           className="bg-black/40 border border-glass-border rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-accent"
                         />
                       </div>
                       
                       <div className="md:col-span-2">
                         <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-white/60">Fee Types to Remind</label>
                         <div className="flex flex-wrap gap-2">
                           {["matches", "studio", "others"].map(ft => (
                             <button
                               key={ft}
                               type="button"
                               onClick={() => {
                                 const newFeeTypes = schedule.feeTypes?.includes(ft) 
                                   ? schedule.feeTypes.filter(f => f !== ft)
                                   : [...(schedule.feeTypes || []), ft];
                                 setAutomaticReminders(automaticReminders.map(s => s.id === schedule.id ? { ...s, feeTypes: newFeeTypes } : s));
                               }}
                               className={`px-3 py-1 text-[11px] font-bold rounded-lg border capitalize transition ${schedule.feeTypes?.includes(ft) ? 'bg-accent/20 border-accent text-accent' : 'border-glass-border text-white/50 bg-white/5 hover:bg-white/10'}`}
                             >
                               {ft}
                             </button>
                           ))}
                         </div>
                       </div>
                     </div>
                   </div>
                 ))}
                 {automaticReminders.length === 0 && (
                   <div className="text-center py-6 border border-dashed border-glass-border rounded-lg text-white/40 text-sm">
                     No schedules configured. Add one above.
                   </div>
                 )}
               </div>
             </div>
           </div>

           <div className="mt-2 mb-4 flex justify-end">
              <button
                type="button"
                onClick={handleSaveRemindersConfig}
                className="px-6 py-2.5 bg-accent text-black text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-accent/90 transition shadow-lg w-full"
              >
                Save Schedules & Automation Settings
              </button>
            </div>

            {/* Email Section */}
           <div className="border border-glass-border rounded-xl bg-white/5 overflow-hidden">
             <button
               type="button"
               onClick={() => setIsEmailSubOpen(!isEmailSubOpen)}
               className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 transition focus:outline-none border-b border-glass-border"
             >
               <h4 className="text-[11px] font-bold uppercase tracking-widest text-white/80">Email Configuration</h4>
               {isEmailSubOpen ? <ChevronDown className="w-4 h-4 text-white/60" /> : <ChevronRight className="w-4 h-4 text-white/60" />}
             </button>
             {isEmailSubOpen && (
               <div className="p-4 space-y-4">
                 <div>
                   <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/80 cursor-pointer mb-2">
                     <input 
                       type="checkbox"
                       checked={store.appConfig?.emailAutomationEnabled !== false} // Default to true for backward compatibility
                       onChange={(e) => store.updateAppConfig({ ...store.appConfig, emailAutomationEnabled: e.target.checked })}
                       className="w-4 h-4 rounded border-glass-border bg-black/40 text-accent focus:ring-accent"
                     />
                     Enable Email Automated Reminders
                   </label>
                 </div>
                 <div>
                   <label className="block text-xs font-bold uppercase tracking-widest text-white/50 mb-1">Subject</label>
                   <input 
                     type="text"
                     value={emailTemplate.subject}
                     onChange={(e) => setEmailTemplate({ ...emailTemplate, subject: e.target.value })}
                     className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-accent text-white"
                   />
                 </div>
                 <div>
                   <label className="block text-xs font-bold uppercase tracking-widest text-white/50 mb-1">Body</label>
                   <textarea
                     value={emailTemplate.body}
                     onChange={(e) => setEmailTemplate({ ...emailTemplate, body: e.target.value })}
                     rows={10}
                     className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-accent text-white custom-scrollbar leading-relaxed"
                   />
                   <div className="mt-3 text-xs text-white/40 space-y-1">
                     <div className="font-bold uppercase tracking-widest mb-2 text-white/60">Available Variables:</div>
                     <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                       <span className="bg-white/5 px-2 py-1 rounded">{'{{clubName}}'}</span>
                       <span className="bg-white/5 px-2 py-1 rounded">{'{{playerName}}'}</span>
                       <span className="bg-white/5 px-2 py-1 rounded">{'{{amount}}'}</span>
                       <span className="bg-white/5 px-2 py-1 rounded">{'{{duesText}}'}</span>
                       <span className="bg-white/5 px-2 py-1 rounded">{'{{link}}'}</span>
                     </div>
                   </div>
                 </div>
               </div>
             )}
           </div>



           <button
             onClick={handleSaveRemindersConfig}
             className="bg-accent text-black font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-xl hover:bg-accent/90 transition shadow-lg shadow-accent/20 w-full"
           >
             Save Automation Settings
           </button>
        </div>
      )}

      {subTab === "dues_report" && (() => {
         const allDues: any[] = [];
         store.players.forEach((p: any) => {
            store.payments.filter((pay: any) => pay.playerId === p.id && pay.status === "Unpaid").forEach((pay: any) => {
              const m = store.matches.find((mx: any) => mx.id === pay.matchId);
              if(m) {
                allDues.push({
                   uid: pay.id,
                   type: 'match',
                   amount: m.fee,
                   desc: `vs ${m.opponent} (${formatDate(m.date)})`,
                   groupKey: `match_${m.id}`,
                   groupTitle: `Match Fee: vs ${m.opponent} (${formatDate(m.date)})`,
                   player: p
                });
              }
            });

            store.otherFees.filter((f: any) => f.playerId === p.id && f.status === "Unpaid").forEach((f: any) => {
                allDues.push({
                   uid: f.id,
                   type: 'other',
                   amount: f.amount,
                   desc: f.title,
                   groupKey: `other_${f.templateId || f.title}`,
                   groupTitle: `Other Fee: ${f.title}`,
                   player: p
                });
            });
         });

         const filteredDues = allDues.filter(d => {
            if (dueType === "matches" && d.type !== "match") return false;
            if (dueType === "others" && d.type !== "other") return false;
            if (filterMatchId && d.groupKey !== `match_${filterMatchId}`) return false;
            if (searchPlayer && !d.player.name.toLowerCase().includes(searchPlayer.toLowerCase())) return false;
            return true;
         });

         const groupedDuesMap: Record<string, any[]> = filteredDues.reduce((acc: any, curr: any) => {
            const k = curr.groupKey;
            if(!acc[k]) acc[k] = [];
            acc[k].push(curr);
            return acc;
         }, {});

         const groupedDues = Object.keys(groupedDuesMap).map(key => {
            const items = groupedDuesMap[key];
            return {
              key,
              title: items[0].groupTitle,
              items
            };
         });

         const grandDue = filteredDues.reduce((sum, d) => sum + d.amount, 0);
         const hasSelection = selectedDues.size > 0;

         const toggleItem = (uid: string) => {
            const next = new Set(selectedDues);
            if(next.has(uid)) next.delete(uid);
            else next.add(uid);
            setSelectedDues(next);
         };

         const toggleGroup = (key: string, items: any[]) => {
            const next = new Set(selectedDues);
            const allInGroupSelected = items.every(i => next.has(i.uid));
            if(allInGroupSelected) {
               items.forEach(i => next.delete(i.uid));
            } else {
               items.forEach(i => next.add(i.uid));
            }
            setSelectedDues(next);
         };

         const toggleCollapse = (key: string) => {
            const next = new Set(collapsedGroups);
            if(next.has(key)) next.delete(key);
            else next.add(key);
            setCollapsedGroups(next);
         };

        return (
        <div className="space-y-4">
          <div className="flex flex-col gap-4">
             <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  Dues Report
                </h2>
                <div className="flex items-center gap-3 bg-white/5 py-1.5 px-3 rounded-xl border border-glass-border">
                   <div className="text-[10px] font-bold uppercase tracking-widest text-red-400">Total Due: ₹{grandDue}</div>
                   <div className="w-px h-4 bg-glass-border"></div>

                   <button
                     onClick={async () => {
                       const targetDues = hasSelection ? filteredDues.filter((d: any) => selectedDues.has(d.uid)) : filteredDues;
                       if (targetDues.length === 0) {
                         alert("No dues found to remind."); return;
                       }

                       if (!window.confirm(`Send an email reminder to ${hasSelection ? 'SELECTED' : 'ALL'} players for their pending dues?`)) return;
                       
                       const byEmail: Record<string, any> = {};
                       targetDues.forEach(d => {
                          if (!d.player.email) return;
                          if (!byEmail[d.player.email]) byEmail[d.player.email] = { player: d.player, dues: [], total: 0 };
                          byEmail[d.player.email].dues.push(d);
                          byEmail[d.player.email].total += d.amount;
                       });

                       const playersWithEmail = Object.values(byEmail);
                       if (playersWithEmail.length === 0) {
                         alert("None of the included players have an email address stored.");
                         return;
                       }
                       
                       let sentCount = 0;
                       let failCount = 0;
                       
                       for (const data of playersWithEmail) {
                          const link = `${window.location.origin}/pay/${data.player.id}`;
                          try {
                            const reminderTemplate = store.appConfig?.emailTemplates?.due_reminder || defaultTemplate;
                            const renderTpl = (txt: string) => {
                              return txt
                                .replace(/{{clubName}}/g, store.appConfig?.clubName || "Kavach Play")
                                .replace(/{{playerName}}/g, data.player.name || "Player")
                                .replace(/{{amount}}/g, `₹${data.total}`)
                                .replace(/{{duesText}}/g, data.dues.map((d: any) => `${d.desc} (₹${d.amount})`).join(", "))
                                .replace(/{{link}}/g, link);
                            };
                            const res = await fetch("/api/email/send", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                to: [data.player.email],
                                subject: renderTpl(reminderTemplate.subject),
                                text: renderTpl(reminderTemplate.body),
                                config: store.appConfig,
                              })
                            });
                            
                            if (res.ok && (await res.json()).success) {
                              sentCount++;
                            } else {
                              failCount++;
                            }
                          } catch (e) {
                            failCount++;
                          }
                       }
                       alert(`Finished sending reminders. Sent: ${sentCount}, Failed: ${failCount}`);
                     }}
                     className={`${hasSelection ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : 'bg-accent/20 text-accent hover:bg-accent/30'} transition text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded whitespace-nowrap`}
                   >
                     {hasSelection ? "Email Remind Selected" : "Email Remind All"}
                   </button>
                   <button
                     onClick={() => {
                        const targetDues = hasSelection ? filteredDues.filter((d: any) => selectedDues.has(d.uid)) : filteredDues;
                        
                        const byGroup: Record<string, any[]> = {};
                        targetDues.forEach((d: any) => {
                           const k = d.groupTitle;
                           if(!byGroup[k]) byGroup[k] = [];
                           byGroup[k].push(d);
                        });

                        let text = `*Payment Due Report*` + (hasSelection ? ' (Selected)\n----\n' : '\n----\n');
                        
                        Object.keys(byGroup).forEach((groupTitle) => {
                          const cleanTitle = groupTitle.replace(/^(Match Fee: |Other Fee: )/, '');
                          text += `*${cleanTitle}*\n\n`;
                          byGroup[groupTitle].forEach((d: any, index: number) => {
                            let phone = d.player.mobile || '';
                            let digits = phone.replace(/\D/g, '');
                            if (digits.startsWith('91') && digits.length === 12) {
                               // format is fine
                            } else if (digits.length === 10) {
                               digits = '91' + digits;
                            } else if (digits.startsWith('0') && digits.length === 11) {
                               digits = '91' + digits.substring(1);
                            }
                            const tag = digits ? `@${digits}` : '';
                            text += `${index + 1}. ${d.player.name} ${tag}\n`;
                          });
                          text += `\n`;
                        });
                        navigator.clipboard.writeText(text.trim());
                        alert("WhatsApp Report Copied to Clipboard!");
                     }}
                     className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded whitespace-nowrap"
                   >
                     Copy WhatsApp Report
                   </button>
                </div>
             </div>

             <div className="glass rounded-xl p-4 flex flex-col gap-3">
               <div className="flex flex-col sm:flex-row gap-3">
                 <select
                    value={dueType}
                    onChange={(e) => setDueType(e.target.value as any)}
                    className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-emerald-950 flex-1"
                 >
                    <option value="all">All Types of Dues</option>
                    <option value="matches">Match Fees Only</option>
                    <option value="others">Other Fees Only</option>
                 </select>
                 <input
                   type="text"
                   placeholder="Filter by Player Name"
                   value={searchPlayer}
                   onChange={(e) => setSearchPlayer(e.target.value)}
                   className="flex-1 bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
                 />
                 {dueType === "matches" && (
                   <select
                     value={filterMatchId}
                     onChange={(e) => setFilterMatchId(e.target.value)}
                     className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-emerald-950 flex-1"
                   >
                     <option value="">All Matches</option>
                     {[...store.matches].sort((a: any, b: any) => b.date.localeCompare(a.date)).map((m: any) => (
                       <option key={m.id} value={m.id}>{m.opponent} ({formatDate(m.date)})</option>
                     ))}
                   </select>
                 )}
               </div>
             </div>
          </div>
          
          <div className="space-y-4">
            {groupedDues.length === 0 ? (
               <div className="text-center py-10 text-white/40 italic text-sm glass rounded-xl border-dashed">
                 No dues found for the current filters.
               </div>
            ) : (
                groupedDues.map((group) => {
                  const allInGroupSelected = group.items.every((i: any) => selectedDues.has(i.uid));
                  const someInGroupSelected = group.items.some((i: any) => selectedDues.has(i.uid));
                  const groupTotal = group.items.reduce((s: number, i: any) => s + i.amount, 0);
                  const isCollapsed = collapsedGroups.has(group.key);

                  return (
                    <div key={group.key} className="glass rounded-xl overflow-hidden border border-glass-border">
                      <div 
                        className="bg-white/5 p-3 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 border-b border-glass-border cursor-pointer hover:bg-white/10 transition-colors"
                        onClick={() => toggleCollapse(group.key)}
                      >
                        <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
                          <div className="text-white/50 hover:text-white/80 transition-colors">
                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          </div>
                          <input 
                            type="checkbox"
                            checked={allInGroupSelected}
                            ref={(input) => { if (input) { input.indeterminate = !allInGroupSelected && someInGroupSelected; } }}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                               toggleGroup(group.key, group.items);
                            }}
                            className="w-4 h-4 shrink-0 rounded border-glass-border bg-black/40 text-accent focus:ring-accent focus:ring-offset-0"
                          />
                          <h3 className="font-bold text-white text-sm truncate">{group.title}</h3>
                        </div>
                        <div className="text-[11px] font-bold uppercase tracking-widest text-white/50 shrink-0 pl-7 sm:pl-0">
                           {group.items.length} Pending (₹{groupTotal})
                        </div>
                      </div>
                      {!isCollapsed && (
                        <div className="flex flex-col">
                           {group.items.map((item: any, idx: number) => {
                            const isSelected = selectedDues.has(item.uid);
                            return (
                              <div key={item.uid} className={`p-3 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 transition ${idx !== group.items.length-1 ? 'border-b border-white/5' : ''} ${isSelected ? 'bg-accent/10' : 'hover:bg-white/5'}`}>
                                <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
                                  <input 
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleItem(item.uid)}
                                    className="w-4 h-4 shrink-0 rounded border-glass-border bg-black/40 text-accent focus:ring-accent focus:ring-offset-0"
                                  />
                                  <span className="font-semibold text-white/90 text-sm truncate">{item.player.name}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 sm:shrink-0 pl-7 sm:pl-0">
                                  <span className="font-mono text-red-400 text-sm mr-2">₹{item.amount}</span>
                                  <button
                                    onClick={() => {
                                      if (!item.player.mobile) {
                                        alert("Player does not have a mobile number saved.");
                                        return;
                                      }
                                      const link = `${window.location.origin}/pay/${item.player.id}`;
                                      const text = `Hi ${item.player.name}, this is a gentle reminder regarding your pending due of ₹${item.amount} for ${item.desc}.\n\nPlease clear it at your earliest convenience using this link: ${link}`;
                                      const encodedText = encodeURIComponent(text);
                                      window.open(`https://wa.me/${item.player.mobile.replace("+", "")}?text=${encodedText}`, "_blank");
                                    }}
                                    className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-bold text-[9px] uppercase tracking-widest px-2 py-1 rounded transition whitespace-nowrap"
                                  >
                                    WA App
                                  </button>

                                  {item.player.email && (
                                     <button
                                       onClick={async () => {
                                         const link = `${window.location.origin}/pay/${item.player.id}`;
                                         try {
                                           const reminderTemplate = store.appConfig?.emailTemplates?.due_reminder || defaultTemplate;
                                           const renderTpl = (txt: string) => {
                                             return txt
                                               .replace(/{{clubName}}/g, store.appConfig?.clubName || "Kavach Play")
                                               .replace(/{{playerName}}/g, item.player.name || "Player")
                                               .replace(/{{amount}}/g, `₹${item.amount}`)
                                               .replace(/{{duesText}}/g, item.desc)
                                               .replace(/{{link}}/g, link);
                                           };
                                           const res = await fetch("/api/email/send", {
                                             method: "POST",
                                             body: JSON.stringify({
                                               to: [item.player.email],
                                               subject: renderTpl(reminderTemplate.subject),
                                               text: renderTpl(reminderTemplate.body),
                                               config: store.appConfig,
                                             })
                                           });

                                           if (!res.ok) {
                                             const errData = await res.json().catch(() => ({}));
                                             throw new Error(errData.error || "Network error");
                                           }

                                           alert("Email reminder sent successfully!");
                                         } catch (e: any) {
                                           alert(`Failed: ${e.message || "Failed to send email reminder."}`);
                                         }
                                       }}
                                       className="bg-accent/20 hover:bg-accent/30 text-accent font-bold text-[9px] uppercase tracking-widest px-2 py-1 rounded transition whitespace-nowrap"
                                     >
                                       Email
                                     </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      const link = `${window.location.origin}/pay/${item.player.id}`;
                                      navigator.clipboard.writeText(link);
                                      alert("Payment link copied to clipboard!\n" + link);
                                    }}
                                    className="bg-accent/20 hover:bg-accent/30 text-accent font-bold text-[9px] uppercase tracking-widest px-2 py-1 rounded transition whitespace-nowrap"
                                  >
                                    Copy Link
                                  </button>
                                </div>
                              </div>
                            );
                         })}
                      </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
