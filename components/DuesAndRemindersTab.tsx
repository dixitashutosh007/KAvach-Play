import { useState, useMemo } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { ChevronDown, ChevronRight, Trash2, ArrowUpDown, Check, X, ShieldAlert } from "lucide-react";
import { formatDate, computeLateFees } from "@/lib/utils";
import type { ManualPaymentMethod } from "@/lib/types";

export function DuesAndRemindersTab({ store, isFinanceAdmin, isSuperAdmin }: { store: any; isFinanceAdmin: boolean; isSuperAdmin?: boolean }) {
  const [subTab, setSubTab] = useState<"dues_report" | "dues_table" | "email_template">("dues_report");

  // Dues Report State
  const [dueType, setDueType] = useState<"all" | "matches" | "others" | "latefees">("all");
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
          { key: "dues_table", label: "Table View" },
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


      {subTab === "dues_table" && (
        <DuesTableView store={store} isSuperAdmin={isSuperAdmin} />
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
                   player: p,
                   isLateFee: !!(f.templateId && f.templateId.startsWith("latefee_")),
                });
            });

            store.payments
              .filter((pay: any) => pay.playerId === p.id && pay.status === "Unpaid" && (pay.feeOverride === undefined || pay.feeOverride > 0))
              .forEach((pay: any) => {
                const m = store.matches.find((mx: any) => mx.id === pay.matchId);
                if (!m) return;
                const exempted = store.otherFees.some(
                  (f: any) => f.playerId === p.id && f.title?.startsWith("Late Fee Exemption:") && f.title?.includes(m.id) && f.status !== "Cancelled",
                );
                if (exempted) return;
                const matchLabel = `vs ${m.opponent || "Match"} (${formatDate(m.date)})`;
                const fees = computeLateFees(m.date, m.id, p.id, matchLabel);
                fees.forEach((lf: any, idx: number) => {
                  allDues.push({
                    uid: `latefee_${pay.id}_${idx}`,
                    type: "other",
                    amount: lf.amount,
                    desc: lf.label,
                    groupKey: `latefee_${m.id}`,
                    groupTitle: `Late Fee: ${matchLabel}`,
                    player: p,
                    isLateFee: true,
                    isVirtual: true,
                    matchId: m.id,
                  });
                });
              });
         });

         const filteredDues = allDues.filter(d => {
            if (d.amount <= 0) return false;
            if (dueType === "matches" && d.type !== "match") return false;
            if (dueType === "others" && d.type !== "other") return false;
            if (dueType === "latefees" && !d.isLateFee) return false;
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
                    <option value="latefees">Late Fees Only</option>
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
                          {group.key.startsWith("latefee_") && (
                            <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded text-[8px] uppercase font-black tracking-widest shrink-0">
                              Late Fee
                            </span>
                          )}
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
                                  {item.isLateFee && (
                                    <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1 py-0.5 rounded text-[8px] uppercase font-black tracking-widest shrink-0">
                                      Penalty
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 sm:shrink-0 pl-7 sm:pl-0">
                                  <span className={`font-mono text-sm mr-2 ${item.isLateFee ? "text-orange-400" : "text-red-400"}`}>₹{item.amount}</span>
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

const MANUAL_METHODS: { key: ManualPaymentMethod; label: string; desc: string }[] = [
  { key: "cash_collected", label: "Cash Collected", desc: "Counted as fee collected" },
  { key: "deposited_directly", label: "Deposited Directly", desc: "Counted as fee collected" },
  { key: "club_sponsored", label: "Club Sponsored", desc: "Full amount as offset (₹0 collected)" },
  { key: "part_of_plan", label: "Part of Other Plan", desc: "Enter split: collected + offset" },
];

function DuesTableView({ store, isSuperAdmin }: { store: any; isSuperAdmin?: boolean }) {
  type SortKey = "player" | "amount" | "type";
  type SortDir = "asc" | "desc";
  const [sortKey, setSortKey] = useState<SortKey>("player");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchPlayer, setSearchPlayer] = useState("");
  const [payModal, setPayModal] = useState<{
    uid: string;
    type: "match" | "other";
    playerId: string;
    matchId?: string;
    playerName: string;
    amount: number;
    desc: string;
    isLateFee?: boolean;
    isVirtual?: boolean;
  } | null>(null);
  const [exemptModal, setExemptModal] = useState<{
    playerId: string;
    playerName: string;
    matchId: string;
    matchLabel: string;
  } | null>(null);

  const allDues = useMemo(() => {
    const dues: {
      uid: string;
      type: "match" | "other";
      playerName: string;
      playerId: string;
      matchId?: string;
      amount: number;
      desc: string;
      isLateFee?: boolean;
      isVirtual?: boolean;
    }[] = [];
    store.players.forEach((p: any) => {
      store.payments
        .filter((pay: any) => pay.playerId === p.id && pay.status === "Unpaid")
        .forEach((pay: any) => {
          const m = store.matches.find((mx: any) => mx.id === pay.matchId);
          if (m) {
            dues.push({
              uid: pay.id,
              type: "match",
              playerName: p.name,
              playerId: p.id,
              matchId: m.id,
              amount: pay.feeOverride !== undefined ? pay.feeOverride : m.fee,
              desc: `vs ${m.opponent || m.title || "Match"} (${formatDate(m.date)})`,
            });
          }
        });
      store.otherFees
        .filter((f: any) => f.playerId === p.id && f.status === "Unpaid")
        .forEach((f: any) => {
          dues.push({
            uid: f.id,
            type: "other",
            playerName: p.name,
            playerId: p.id,
            amount: f.amount,
            desc: f.title,
            isLateFee: !!(f.templateId && f.templateId.startsWith("latefee_")),
          });
        });

      store.payments
        .filter((pay: any) => pay.playerId === p.id && pay.status === "Unpaid" && (pay.feeOverride === undefined || pay.feeOverride > 0))
        .forEach((pay: any) => {
          const m = store.matches.find((mx: any) => mx.id === pay.matchId);
          if (!m) return;
          const exempted = store.otherFees.some(
            (f: any) => f.playerId === p.id && f.title?.startsWith("Late Fee Exemption:") && f.title?.includes(m.id) && f.status !== "Cancelled",
          );
          if (exempted) return;
          const matchLabel = `vs ${m.opponent || "Match"} (${formatDate(m.date)})`;
          const fees = computeLateFees(m.date, m.id, p.id, matchLabel);
          fees.forEach((lf: any, idx: number) => {
            dues.push({
              uid: `latefee_${pay.id}_${idx}`,
              type: "other",
              playerName: p.name,
              playerId: p.id,
              matchId: m.id,
              amount: lf.amount,
              desc: lf.label,
              isLateFee: true,
              isVirtual: true,
            });
          });
        });
    });
    return dues;
  }, [store.players, store.payments, store.otherFees, store.matches]);

  const filtered = useMemo(() => {
    let list = allDues.filter((d) => d.amount > 0);
    if (searchPlayer) {
      list = list.filter((d) =>
        d.playerName.toLowerCase().includes(searchPlayer.toLowerCase()),
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "player") cmp = a.playerName.localeCompare(b.playerName);
      else if (sortKey === "amount") cmp = a.amount - b.amount;
      else cmp = a.type.localeCompare(b.type);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [allDues, searchPlayer, sortKey, sortDir]);

  const grandTotal = filtered.reduce((s, d) => s + d.amount, 0);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortHeader = ({ label, sKey }: { label: string; sKey: SortKey }) => (
    <button
      onClick={() => toggleSort(sKey)}
      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white transition"
    >
      {label}
      <ArrowUpDown className={`w-3 h-3 ${sortKey === sKey ? "text-accent" : "text-white/30"}`} />
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight text-white">
          All Dues
          <span className="ml-2 text-sm text-rose-400 font-mono">₹{grandTotal}</span>
        </h2>
        <input
          type="text"
          placeholder="Filter by player name..."
          value={searchPlayer}
          onChange={(e) => setSearchPlayer(e.target.value)}
          className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white sm:max-w-xs w-full"
        />
      </div>

      <div className="glass rounded-xl border border-glass-border overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_1fr_auto] sm:grid-cols-[1fr_100px_1fr_auto] gap-2 px-4 py-3 bg-white/5 border-b border-glass-border items-center">
          <SortHeader label="Player" sKey="player" />
          <SortHeader label="Amount" sKey="amount" />
          <SortHeader label="Description" sKey="type" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">Action</span>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-10 text-white/40 italic text-sm">
            No dues found.
          </div>
        ) : (
          <div className="divide-y divide-white/5 max-h-[60vh] overflow-y-auto">
            {filtered.map((d) => (
              <div
                key={d.uid}
                className="grid grid-cols-[1fr_auto_1fr_auto] sm:grid-cols-[1fr_100px_1fr_auto] gap-2 px-4 py-3 items-center hover:bg-white/5 transition"
              >
                <span className="text-sm font-semibold text-white truncate">{d.playerName}</span>
                <span className="text-sm font-mono text-rose-400">₹{d.amount}</span>
                <div className="min-w-0">
                  <span className="text-sm text-white/70 truncate block">{d.desc}</span>
                  <span className={`text-[9px] font-bold uppercase tracking-widest ${d.isLateFee ? "text-orange-400" : d.type === "match" ? "text-blue-400" : "text-amber-400"}`}>
                    {d.isLateFee ? "Late Fee" : d.type === "match" ? "Match Fee" : "Other Fee"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {d.isLateFee && d.isVirtual && isSuperAdmin && d.matchId && (
                    <button
                      onClick={() => setExemptModal({ playerId: d.playerId, playerName: d.playerName, matchId: d.matchId!, matchLabel: d.desc })}
                      className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-bold text-[9px] uppercase tracking-widest px-2 py-1.5 rounded-lg transition whitespace-nowrap"
                      title="Exempt this player from late fees for this match"
                    >
                      Exempt
                    </button>
                  )}
                  <button
                    onClick={() => setPayModal(d)}
                    className="bg-accent/20 hover:bg-accent/30 text-accent font-bold text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-lg transition whitespace-nowrap"
                  >
                    Mark Paid
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {payModal && (
        <MarkPaidModal
          due={payModal}
          store={store}
          onClose={() => setPayModal(null)}
        />
      )}

      {exemptModal && (
        <ExemptLateFeeModal
          playerId={exemptModal.playerId}
          playerName={exemptModal.playerName}
          matchId={exemptModal.matchId}
          matchLabel={exemptModal.matchLabel}
          store={store}
          onClose={() => setExemptModal(null)}
        />
      )}
    </div>
  );
}

function ExemptLateFeeModal({
  playerId,
  playerName,
  matchId,
  matchLabel,
  store,
  onClose,
}: {
  playerId: string;
  playerName: string;
  matchId: string;
  matchLabel: string;
  store: any;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const handleExempt = async () => {
    setSaving(true);
    try {
      await store.addOtherFee(playerId, {
        title: `Late Fee Exemption:${matchId}`,
        amount: 0,
        comment: `Exempted from late fees for ${matchLabel}`,
        templateId: `latefee_exempt_${matchId}`,
      });
      onClose();
    } catch {
      alert("Failed to create exemption.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1a1a2e] rounded-xl p-5 max-w-sm w-full border border-white/10 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            Exempt Late Fee
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-1">
          <p className="text-sm font-semibold text-white">{playerName}</p>
          <p className="text-xs text-white/60">{matchLabel}</p>
        </div>

        <p className="text-xs text-white/50">
          This will permanently exempt this player from all late fee penalties for this match. This action can only be undone by a Super Admin.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 text-white/70 font-bold text-xs uppercase tracking-widest px-4 py-2.5 rounded-lg transition border border-white/10"
          >
            Cancel
          </button>
          <button
            onClick={handleExempt}
            disabled={saving}
            className="flex-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-bold text-xs uppercase tracking-widest px-4 py-2.5 rounded-lg transition border border-amber-500/30 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Confirm Exemption"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MarkPaidModal({
  due,
  store,
  onClose,
}: {
  due: {
    uid: string;
    type: "match" | "other";
    playerId: string;
    matchId?: string;
    playerName: string;
    amount: number;
    desc: string;
    isLateFee?: boolean;
    isVirtual?: boolean;
  };
  store: any;
  onClose: () => void;
}) {
  const [selectedMethod, setSelectedMethod] = useState<ManualPaymentMethod | null>(null);
  const [collectedAmount, setCollectedAmount] = useState(String(Math.min(350, due.amount)));
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    if (!selectedMethod) return;
    setSaving(true);
    try {
      let feeCollectedAmt: number | undefined;
      let feeOffsetAmt: number | undefined;

      if (selectedMethod === "cash_collected" || selectedMethod === "deposited_directly") {
        feeCollectedAmt = due.amount;
        feeOffsetAmt = 0;
      } else if (selectedMethod === "club_sponsored") {
        feeCollectedAmt = 0;
        feeOffsetAmt = due.amount;
      } else if (selectedMethod === "part_of_plan") {
        const collected = Math.max(0, Math.min(due.amount, Number(collectedAmount) || 0));
        feeCollectedAmt = collected;
        feeOffsetAmt = due.amount - collected;
      }

      const methodLabel = MANUAL_METHODS.find((m) => m.key === selectedMethod)?.label || selectedMethod;

      if (due.isVirtual && due.isLateFee) {
        const feeId = await store.addOtherFee(due.playerId, {
          title: due.desc,
          amount: due.amount,
          comment: "Auto-levied late fee penalty (admin marked paid)",
          templateId: `latefee_${due.matchId}`,
        });
        if (feeId) await store.updateOtherFeeStatus(due.playerId, feeId, "Paid", "manual");
      } else if (due.type === "match" && due.matchId) {
        await store.updatePaymentStatus(
          due.uid,
          "Paid",
          due.matchId,
          undefined,
          "manual",
          methodLabel,
          selectedMethod,
          feeCollectedAmt,
          feeOffsetAmt,
        );
      } else {
        await store.updateOtherFeeStatus(due.playerId, due.uid, "Paid", "manual");
      }
      onClose();
    } catch {
      alert("Failed to update payment status.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1a1a2e] rounded-xl p-5 max-w-sm w-full border border-white/10 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-sm">Mark as Paid</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-white/5 rounded-lg p-3 space-y-1">
          <p className="text-sm font-semibold text-white">{due.playerName}</p>
          <p className="text-xs text-white/50">{due.desc}</p>
          <p className="text-lg font-black text-rose-400">₹{due.amount}</p>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Payment Method</p>
          {MANUAL_METHODS.map((m) => (
            <button
              key={m.key}
              onClick={() => setSelectedMethod(m.key)}
              className={`w-full text-left p-3 rounded-lg border transition ${
                selectedMethod === m.key
                  ? "border-accent bg-accent/10 text-white"
                  : "border-white/10 text-white/70 hover:bg-white/5"
              }`}
            >
              <span className="text-sm font-bold">{m.label}</span>
              <span className="block text-[10px] text-white/40 mt-0.5">{m.desc}</span>
            </button>
          ))}
        </div>

        {selectedMethod === "part_of_plan" && (
          <div className="space-y-2 bg-white/5 rounded-lg p-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/60 block">
              Amount to count as Fee Collected
            </label>
            <input
              type="number"
              value={collectedAmount}
              onChange={(e) => setCollectedAmount(e.target.value)}
              min={0}
              max={due.amount}
              className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
            />
            <div className="flex justify-between text-xs text-white/50">
              <span>Collected: ₹{Math.max(0, Math.min(due.amount, Number(collectedAmount) || 0))}</span>
              <span>Offset: ₹{Math.max(0, due.amount - Math.min(due.amount, Number(collectedAmount) || 0))}</span>
            </div>
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={!selectedMethod || saving}
          className="w-full bg-accent text-black font-bold uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-accent/90 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4" />
          {saving ? "Saving..." : "Confirm Payment"}
        </button>
      </div>
    </div>
  );
}
