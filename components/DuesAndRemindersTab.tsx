import { useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";

export function DuesAndRemindersTab({ store, isFinanceAdmin }: { store: any; isFinanceAdmin: boolean }) {
  const [subTab, setSubTab] = useState<"dues_report" | "email_template">("dues_report");

  // Dues Report State
  const [dueType, setDueType] = useState<"all" | "matches" | "others">("all");
  const [searchPlayer, setSearchPlayer] = useState("");
  const [filterMatchId, setFilterMatchId] = useState("");
  const [selectedDues, setSelectedDues] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Email template used by manual "Send Reminder" buttons. Automatic cron
  // scheduling was removed to control Cloud Run / Lambda costs — reminders
  // are now only sent when an admin explicitly clicks the button.
  const defaultTemplate = {
    subject: "Pending Fee Reminder - {{clubName}}",
    body: "Hi {{playerName}},\n\nThis is a friendly reminder that you have an outstanding fee of {{amount}} for: {{duesText}}.\n\nPlease log in to clear your dues at your earliest convenience using this link: {{link}}\n\nBest regards,\n{{clubName}} Admin Team",
  };
  const [emailTemplate, setEmailTemplate] = useState(
    store.appConfig?.emailTemplates?.due_reminder || defaultTemplate
  );

  const [isEmailSubOpen, setIsEmailSubOpen] = useState(true);

  const handleSaveRemindersConfig = async () => {
     try {
       await store.updateAppConfig({
          ...store.appConfig,
          emailTemplates: {
             ...(store.appConfig?.emailTemplates || {}),
             due_reminder: emailTemplate
          },
       });
       alert("Email template saved.");
     } catch (e) {
       alert("Failed to save configuration.");
     }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 bg-black/20 p-1 rounded-xl border border-glass-border overflow-x-auto hide-scrollbar">
        {[
          { key: "dues_report", label: "Report" },
          { key: "email_template", label: "Email Template" },
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


      {subTab === "email_template" && (
        <div className="glass p-6 rounded-2xl border border-glass-border space-y-6">
          <div className="bg-amber-500/5 border border-amber-500/20 text-amber-200/80 text-[11px] px-3 py-2 rounded-lg leading-snug">
            Automated cron-based reminders were removed to control server costs. Reminders are now sent only when an admin clicks the per-player <b className="text-amber-100">Send Email</b> or <b className="text-amber-100">Send WhatsApp</b> button in the Report tab. Use this section to edit the template body those buttons will send.
          </div>

          <div className="border border-glass-border rounded-xl bg-white/5 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsEmailSubOpen(!isEmailSubOpen)}
              className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 transition focus:outline-none border-b border-glass-border"
            >
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-white/80">Email Template</h4>
              {isEmailSubOpen ? <ChevronDown className="w-4 h-4 text-white/60" /> : <ChevronRight className="w-4 h-4 text-white/60" />}
            </button>
            {isEmailSubOpen && (
              <div className="p-4 space-y-4">
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
            Save Email Template
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
                   amount: pay.feeOverride !== undefined ? pay.feeOverride : m.fee,
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
            if (d.amount <= 0) return false;
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
                <div className="flex items-center flex-wrap gap-2 sm:gap-3 bg-white/5 py-1.5 px-3 rounded-xl border border-glass-border">
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
                       targetDues.forEach((d: any) => {
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
                            const res = await authedFetch("/api/email/send", {
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
                       alert(`Finished sending email reminders. Sent: ${sentCount}, Failed: ${failCount}`);
                     }}
                     className={`${hasSelection ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : 'bg-accent/20 text-accent hover:bg-accent/30'} transition text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded whitespace-nowrap`}
                   >
                     {hasSelection ? "Email Remind Selected" : "Email Remind All"}
                   </button>
                   <button
                     onClick={async () => {
                       const targetDues = hasSelection ? filteredDues.filter((d: any) => selectedDues.has(d.uid)) : filteredDues;
                       if (targetDues.length === 0) {
                         alert("No dues found to remind."); return;
                       }

                       if (!window.confirm(`Send WhatsApp API reminders to ${hasSelection ? 'SELECTED' : 'ALL'} players for their pending dues?`)) return;
                       
                       const byMobile: Record<string, any> = {};
                       targetDues.forEach((d: any) => {
                          if (!d.player.mobile) return;
                          if (!byMobile[d.player.mobile]) byMobile[d.player.mobile] = { player: d.player, dues: [], total: 0 };
                          byMobile[d.player.mobile].dues.push(d);
                          byMobile[d.player.mobile].total += d.amount;
                       });

                       const playersWithMobile = Object.values(byMobile);
                       if (playersWithMobile.length === 0) {
                         alert("None of the included players have a mobile number stored.");
                         return;
                       }
                       
                       let sentCount = 0;
                       let failCount = 0;
                       const failReasons: string[] = [];

                       for (const data of playersWithMobile) {
                          const link = `${window.location.origin}/pay/${data.player.id}`;
                          try {
                            const res = await authedFetch("/api/whatsapp/send", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                to: data.player.mobile,
                                name: data.player.name,
                                amount: data.total,
                                link: link,
                              })
                            });

                            if (res.ok) {
                              sentCount++;
                            } else {
                              failCount++;
                              // Capture server error body so the alert is diagnostic
                              let reason = `HTTP ${res.status}`;
                              try {
                                const body = await res.json();
                                if (body?.error) reason = body.error;
                                if (body?.details?.message) reason += ` — ${body.details.message}`;
                              } catch {
                                try { reason = (await res.text()).slice(0, 200); } catch {}
                              }
                              failReasons.push(`${data.player.name}: ${reason}`);
                            }
                          } catch (e: any) {
                            failCount++;
                            failReasons.push(`${data.player.name}: ${e?.message || "network/client error"}`);
                          }
                       }
                       const detail = failReasons.length
                         ? "\n\nFirst failures:\n" + failReasons.slice(0, 3).join("\n")
                         : "";
                       alert(`Finished sending WhatsApp reminders. Sent: ${sentCount}, Failed: ${failCount}${detail}`);
                     }}
                     className={`${hasSelection ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30' : 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20'} transition text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded whitespace-nowrap`}
                   >
                     {hasSelection ? "WA Remind Selected" : "WA Remind All"}
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
                            if (digits.startsWith('0') && digits.length === 11) {
                               digits = '91' + digits.substring(1);
                            } else if (digits.length === 10) {
                               digits = '91' + digits;
                            }
                            const tag = digits ? `@+${digits}` : '';
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
                                    WA (Manual)
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!item.player.mobile) {
                                        alert("Player does not have a mobile number saved.");
                                        return;
                                      }
                                      const link = `${window.location.origin}/pay/${item.player.id}`;
                                      try {
                                        const res = await authedFetch("/api/whatsapp/send", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({
                                            to: item.player.mobile,
                                            name: item.player.name,
                                            amount: item.amount,
                                            link: link,
                                          })
                                        });
                                        if (res.ok) {
                                          alert("WhatsApp API reminder sent successfully!");
                                        } else {
                                          const err = await res.json();
                                          let detailsStr = "";
                                          if (err.details) {
                                            detailsStr = `\nDetails: ${err.details.message || JSON.stringify(err.details)}`;
                                          }
                                          alert(`Failed: ${err.error || "Network error"}${detailsStr}`);
                                        }
                                      } catch(e: any) {
                                        alert(`Failed: ${e.message || "Failed to send WhatsApp API reminder."}`);
                                      }
                                    }}
                                    className="bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400 font-bold text-[9px] uppercase tracking-widest px-2 py-1 rounded transition whitespace-nowrap"
                                  >
                                    WA API
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
                                           const res = await authedFetch("/api/email/send", {
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
