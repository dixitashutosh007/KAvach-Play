/**
 * Finance Dashboard (`components/FinanceTab.tsx`)
 *
 * Handles all financial interactions related to matches and other ad-hoc fees.
 * Admins use this to track which players have or haven't paid their match fees,
 * create new fee templates, and assign individual fees. Players use this tab
 * to view their outstanding dues and mark them as paid. Also integrates a secondary
 * `WixFinanceView` for potential external e-commerce hooks.
 */
import { authedFetch } from "@/lib/authed-fetch";
import { useState, useMemo, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { Match, MatchPayment, Player, SubscriptionPlan } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import {
  Shield,
  CreditCard,
  ChevronRight,
  Check,
  Trash2 as TrashIcon,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Plus,
  Calendar,
  Info,
  Edit2,
  X,
} from "lucide-react";
import { formatDate, normalizeIndianMobile, computeLateFees } from "@/lib/utils";
import WixFinanceView from "./WixFinanceView";
import RazorReportView from "./RazorReportView";
import { CreateFeeAdmin } from "./CreateFeeAdmin";
import { FeePlansAdmin } from "./FeePlansAdmin";
import { PlansView } from "./PlansView";
import { DuesAndRemindersTab } from "./DuesAndRemindersTab";

export function FinanceTab({
  store,
  persona,
  isFinanceAdmin,
  isSuperAdmin,
  defaultAction,
}: {
  store: ReturnType<typeof useStore>;
  persona: "admin" | "player";
  isFinanceAdmin?: boolean;
  isSuperAdmin?: boolean;
  defaultAction?: string | null;
}) {
  const { user } = useAuth();

  if (persona === "admin" && isFinanceAdmin !== false) {
    return <AdminFinanceView store={store} defaultAction={defaultAction} isSuperAdmin={isSuperAdmin} />;
  } else {
    return <PlayerFinanceView store={store} userId={user?.uid} />;
  }
}

export function PlayerFinanceView({
  store,
  userId,
  showOnly,
}: {
  store: ReturnType<typeof useStore>;
  userId?: string;
  showOnly?: "dues" | "history";
}) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const appUser = store.appUsers.find((u) => u.id === userId);
  const myPlayers = store.players.filter(
    (p) =>
      p.id === userId ||
      p.authUid === userId ||
      (appUser?.mobile && p.mobile && normalizeIndianMobile(p.mobile) === normalizeIndianMobile(appUser.mobile)),
  );

  const mePlayer = myPlayers[0] || null;

  const myPayments =
    myPlayers.length > 0
      ? store.payments.filter(
          (p) =>
            myPlayers.some((mp) => mp.id === p.playerId) &&
            p.status !== "Not Playing",
        )
      : [];

  const otherFees =
    myPlayers.length > 0
      ? store.otherFees.filter((f) =>
          myPlayers.some((mp) => mp.id === f.playerId),
        )
      : [];

  const myMerchOrders = 
    myPlayers.length > 0
      ? store.merchOrders?.filter((o) => 
          myPlayers.some((mp) => mp.id === o.playerId) || o.playerId === userId
        ) || []
      : [];

  type UnifiedDue = {
    id: string; // unique generic id for UI
    type: "match" | "other" | "merch";
    title: string;
    subtitle?: string;
    amount: number;
    rawId: string;
    playerId?: string;
    matchId?: string;
    status: "Paid" | "Unpaid" | "Not Playing" | "Failed" | "Cancelled";
    updatedAtSeconds: number;
  };

  const unifiedDues: UnifiedDue[] = [];
  myPayments.forEach((p) => {
    const match = store.matches.find((m) => m.id === p.matchId);
    if (match) {
      const ground = store.grounds.find((g) => g.id === match.groundId);
      unifiedDues.push({
        id: `match_${p.id}`,
        type: "match",
        title: `vs ${match.opponent} at ${ground ? ground.name : 'Unknown Ground'}`,
        subtitle: `${formatDate(match.date)} • ${match.format}`,
        amount: p.feeOverride !== undefined ? p.feeOverride : match.fee,
        rawId: p.id,
        playerId: p.playerId,
        matchId: match.id,
        status: p.status,
        updatedAtSeconds: p.updatedAt?.seconds || 0,
      });
    }
  });

  otherFees.forEach((f) => {
    unifiedDues.push({
      id: `other_${f.id}`,
      type: "other",
      title: f.title,
      subtitle: `Custom Fee Added on ${formatDate(new Date((f.createdAt?.seconds || 0) * 1000).toISOString())}${f.comment ? ` • ${f.comment}` : ""}`,
      amount: f.amount,
      rawId: f.id,
      playerId: f.playerId,
      status: f.status,
      updatedAtSeconds: f.updatedAt?.seconds || 0,
    });
  });

  myMerchOrders.forEach((o) => {
    unifiedDues.push({
      id: `merch_${o.id}`,
      type: "merch",
      title: `Shop: ${o.merchName}`,
      subtitle: `Ordered on ${formatDate(new Date((o.createdAt?.seconds || 0) * 1000).toISOString())}`,
      amount: o.price,
      rawId: o.id,
      playerId: o.playerId,
      status: o.paymentStatus as any,
      updatedAtSeconds: o.updatedAt?.seconds || 0,
    });
  });

  const lateFeeEntries: (UnifiedDue & { linkedMatchDueId: string })[] = [];
  myPayments.forEach((p) => {
    if (p.status !== "Unpaid") return;
    if (p.feeOverride === 0) return;
    const match = store.matches.find((m: any) => m.id === p.matchId);
    if (!match) return;
    const exempted = store.otherFees.some(
      (f: any) =>
        f.playerId === p.playerId &&
        f.title?.startsWith("Late Fee Exemption:") &&
        f.title?.includes(match.id) &&
        f.status !== "Cancelled",
    );
    if (exempted) return;
    const matchLabel = `vs ${match.opponent || match.title || "Match"} (${formatDate(match.date)})`;
    const fees = computeLateFees(match.date, match.id, p.playerId, matchLabel);
    fees.forEach((lf, idx) => {
      const dueId = `latefee_${p.id}_${idx}`;
      lateFeeEntries.push({
        id: dueId,
        type: "other",
        title: lf.label,
        subtitle: "Auto-calculated late fee penalty",
        amount: lf.amount,
        rawId: `latefee_${p.matchId}_${p.playerId}_${idx}`,
        playerId: p.playerId,
        matchId: match.id,
        status: "Unpaid",
        updatedAtSeconds: 0,
        linkedMatchDueId: `match_${p.id}`,
      });
      unifiedDues.push({
        id: dueId,
        type: "other",
        title: lf.label,
        subtitle: "Auto-calculated late fee penalty",
        amount: lf.amount,
        rawId: `latefee_${p.matchId}_${p.playerId}_${idx}`,
        playerId: p.playerId,
        matchId: match.id,
        status: "Unpaid",
        updatedAtSeconds: 0,
      });
    });
  });

  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  useEffect(() => {
    // Dynamically load Razorpay SDK
    if (!document.getElementById("razorpay-checkout-js")) {
      const script = document.createElement("script");
      script.id = "razorpay-checkout-js";
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  const dues = unifiedDues.filter((p) => p.status === "Unpaid" && p.amount > 0);
  const paid = unifiedDues
    .filter((p) => p.status === "Paid")
    .sort((a, b) => b.updatedAtSeconds - a.updatedAtSeconds);

  const [selectedDues, setSelectedDues] = useState<string[]>([]);

  const toggleDue = (id: string) => {
    const isLateFee = lateFeeEntries.some((lf) => lf.id === id);
    const linkedMatchSelected = isLateFee && lateFeeEntries.some(
      (lf) => lf.id === id && selectedDues.includes(lf.linkedMatchDueId),
    );
    if (isLateFee && linkedMatchSelected) return;

    setSelectedDues((prev) => {
      if (prev.includes(id)) {
        let next = prev.filter((x) => x !== id);
        const linkedLateFees = lateFeeEntries
          .filter((lf) => lf.linkedMatchDueId === id)
          .map((lf) => lf.id);
        if (linkedLateFees.length > 0) {
          next = next.filter((x) => !linkedLateFees.includes(x));
        }
        return next;
      } else {
        let next = [...prev, id];
        const linkedLateFees = lateFeeEntries
          .filter((lf) => lf.linkedMatchDueId === id)
          .map((lf) => lf.id);
        linkedLateFees.forEach((lfId) => {
          if (!next.includes(lfId)) next.push(lfId);
        });
        return next;
      }
    });
  };

  const selectAll = () => {
    if (selectedDues.length >= dues.length) setSelectedDues([]);
    else setSelectedDues(dues.map((d) => d.id));
  };

  const totalAmountDue = dues
    .filter((d) => selectedDues.includes(d.id))
    .reduce((total, due) => total + due.amount, 0);

  const handlePay = async () => {
    if (selectedDues.length === 0) return;
    if (store.appConfig?.features?.payments === false) {
      alert("This feature is currently not available. Contact Club Admin");
      return;
    }

    const duesToPay = dues.filter((d) => selectedDues.includes(d.id));

    setIsProcessingPayment(true);
    try {
      const rzpId =
        store.appConfig?.razorpayKeyId ||
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

      if (!rzpId) {
        alert("Razorpay keys are missing (Settings -> Payment Gateway)");
        setIsProcessingPayment(false);
        return;
      }

      const res = await authedFetch("/api/razorpay/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: totalAmountDue,
          intentData: {
            type: "finance_dues",
            playerId: mePlayer?.id,
            items: duesToPay.map(d => ({
              type: d.type,
              matchId: d.type === "match" ? d.matchId : null,
              feeId: d.type === "other" ? d.rawId : null,
              merchId: d.type === "merch" ? d.rawId : null,
              paymentId: d.rawId,
            }))
          }
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create order");

      const options = {
        key: rzpId,
        amount: data.amount,
        currency: data.currency,
        name: "Kavach Play",
        description: `Payment for ${selectedDues.length} dues`,
        order_id: data.id,
        handler: async function (response: any) {
          try {
            const updates = [];
            const paidDuesDetails = [];
            for (const dueId of selectedDues) {
              const due = dues.find((d) => d.id === dueId);
              if (due) {
                paidDuesDetails.push(`${due.title} (₹${due.amount})`);
                const isLateFeeItem = due.rawId.startsWith("latefee_");
                if (isLateFeeItem && mePlayer) {
                  updates.push(
                    (async () => {
                      const feeId = await store.addOtherFee(mePlayer.id, {
                        title: due.title,
                        amount: due.amount,
                        comment: "Auto-levied late fee penalty",
                        templateId: `latefee_${due.matchId}`,
                      });
                      if (feeId) await store.updateOtherFeeStatus(mePlayer.id, feeId, "Paid", "razorpay");
                    })(),
                  );
                } else if (due.type === "match" && due.matchId) {
                  updates.push(
                    store.updatePaymentStatus(due.rawId, "Paid", due.matchId, undefined, "razorpay"),
                  );
                } else if (due.type === "other" && mePlayer) {
                  updates.push(
                    store.updateOtherFeeStatus(mePlayer.id, due.rawId, "Paid", "razorpay"),
                  );
                } else if (due.type === "merch") {
                  updates.push(
                    store.updateMerchOrder(due.rawId, { paymentStatus: "Paid", paymentMethod: "razorpay" })
                  );
                }
              }
            }
            await Promise.all(updates);
            setSelectedDues([]);
            alert("Payment Successful!");

            try {
              const playerEmail = appUser?.email || mePlayer?.email;
              const adminUsers = store.appUsers.filter((u) => u.role === "admin" || u.isFinanceAdmin);
              const adminEmails = adminUsers.map((u) => u.email).filter(Boolean);
              
              const playerName = appUser?.name || mePlayer?.name || "A player";
              const amountDetail = `₹${totalAmountDue}`;
              const duesText = paidDuesDetails.join(", ");

              if (playerEmail) {
                const welcomeTemplate = store.appConfig?.emailTemplates?.payment_success || {
                  subject: "Receipt: Payment of {{amount}} Received",
                  body: "Hi {{playerName}},\n\nWe have received your payment of {{amount}} for: {{duesText}}.\n\nThank you for your timely payment!\n\nBest regards,\n{{clubName}} Admin Team"
                };
                const renderTpl = (txt: string) => {
                  return txt
                    .replace(/{{clubName}}/g, store.appConfig?.clubName || "Kavach Play")
                    .replace(/{{playerName}}/g, playerName)
                    .replace(/{{amount}}/g, amountDetail)
                    .replace(/{{duesText}}/g, duesText)
                    .replace(/{{link}}/g, `${window.location.origin}/pay/${mePlayer?.id || "profile"}`);
                };
                await authedFetch("/api/email/send", {
                  method: "POST",
                  body: JSON.stringify({
                    to: [playerEmail],
                    subject: renderTpl(welcomeTemplate.subject),
                    text: renderTpl(welcomeTemplate.body),
                    config: store.appConfig,
                  })
                });
              }

              if (adminEmails.length > 0) {
                await authedFetch("/api/email/send", {
                  method: "POST",
                  body: JSON.stringify({
                    to: adminEmails,
                    subject: `Payment Received from ${playerName}`,
                    text: `Player ${playerName} has successfully paid ${amountDetail} for the following dues: ${duesText}.`,
                    config: store.appConfig,
                  })
                });
              }
            } catch (emailErr) {
              console.error("Failed to send payment emails", emailErr);
            }
          } catch (err) {
            console.error("Failed to update status", err);
            alert(
              "Payment successful but status update failed. Please contact admin.",
            );
          }
        },
        prefill: {
          name: appUser?.name || mePlayer?.name || "Player",
          email: appUser?.email || mePlayer?.email || "",
          contact: appUser?.mobile || mePlayer?.mobile || "",
        },
        theme: {
          color: "#10b981", // Accent color
        },
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.on("payment.failed", async function (response: any) {
        alert("Payment failed: " + response.error.description);
        try {
          const updates = [];
          for (const dueId of selectedDues) {
            const due = dues.find((d) => d.id === dueId);
            if (due) {
              if (due.type === "match" && due.matchId) {
                updates.push(
                  store.updatePaymentStatus(due.rawId, "Failed", due.matchId),
                );
              } else if (due.type === "other" && mePlayer) {
                updates.push(
                  store.updateOtherFeeStatus(mePlayer.id, due.rawId, "Failed"),
                );
              } else if (due.type === "merch") {
                updates.push(
                  store.updateMerchOrder(due.rawId, { paymentStatus: "Failed" })
                );
              }
            }
          }
          await Promise.all(updates);
        } catch (e) {
          console.error("Failed to notify admin of payment failure");
        }
      });
      paymentObject.open();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  if (!mePlayer) {
    return (
      <div className="glass rounded-xl p-8 text-center text-white/50 border border-glass-border">
        No player profile linked. Please update your profile with your mobile
        number.
      </div>
    );
  }

  const duesSection = (
    <div className="space-y-6">
      {!showOnly && (
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-white">
            My Dues & Payments
          </h2>
        </div>
      )}

      <div className="glass rounded-xl p-5 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-32 h-32 bg-red-500 opacity-10 blur-3xl rounded-full translate-x-10 -translate-y-10" />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70 mb-4 flex items-center justify-between">
          <span>Pending Dues ({dues.length})</span>
          {dues.length > 0 && (
            <button onClick={selectAll} className="text-accent hover:underline">
              {selectedDues.length === dues.length
                ? "Deselect All"
                : "Select All"}
            </button>
          )}
        </h3>

        {dues.length === 0 ? (
          <div className="text-center py-6 text-white/40 text-sm italic">
            You have no pending dues. Awesome!
          </div>
        ) : (
          <div className="space-y-2">
            {dues.map((due) => {
              const isSelected = selectedDues.includes(due.id);
              const lateFeeEntry = lateFeeEntries.find((lf) => lf.id === due.id);
              const isLockedLateFee = lateFeeEntry && selectedDues.includes(lateFeeEntry.linkedMatchDueId);
              const isLateFee = !!lateFeeEntry;

              return (
                <div
                  onClick={() => toggleDue(due.id)}
                  key={due.id}
                  className={`flex items-center justify-between p-3 rounded-lg border transition ${isLockedLateFee ? "cursor-not-allowed" : "cursor-pointer"} ${isSelected ? (isLateFee ? "bg-orange-500/10 border-orange-500/30" : "bg-accent/10 border-accent/30") : "bg-white/5 border-glass-border hover:bg-white/10"}`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`w-5 h-5 rounded shrink-0 flex items-center justify-center border transition ${isSelected ? (isLateFee ? "bg-orange-500 border-orange-500 text-black" : "bg-accent border-accent text-black") : "border-glass-border"}`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                      {isLockedLateFee && <Shield className="w-3 h-3" />}
                    </div>
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="font-bold text-sm tracking-tight leading-snug mb-1 text-white flex flex-wrap items-center gap-2">
                        <span className="break-words">{due.title}</span>
                        {isLateFee ? (
                          <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded text-[8px] uppercase font-black tracking-widest whitespace-nowrap shrink-0">
                            Late Fee
                          </span>
                        ) : due.type === "other" ? (
                          <span className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded text-[8px] uppercase font-black tracking-widest whitespace-nowrap shrink-0">
                            Other Fee
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-white/50 break-words">
                        {due.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 pl-2">
                    <div className={`font-mono font-bold ${isLateFee ? "text-orange-400" : "text-red-400"}`}>
                      ₹{due.amount}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {dues.length > 0 && (
        <div className="glass rounded-xl p-4 sticky bottom-4 z-10 border flex items-center justify-between backdrop-blur-md transition-colors duration-300 shadow-xl mt-4 bg-[#0a0a0a]/90 border-glass-border">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/60">
              Total Selected
            </div>
            <div className="text-xl font-mono font-bold text-accent">
              ₹{totalAmountDue}
            </div>
            {selectedDues.length === 0 && (
              <div className="text-[9px] text-white/40 mt-1 italic">
                Select your due or match to Pay
              </div>
            )}
          </div>
          <button
            disabled={isProcessingPayment || selectedDues.length === 0}
            onClick={handlePay}
            className={`px-6 py-2.5 rounded-lg font-bold text-sm shadow-[0_4px_12px_rgba(16,185,129,0.2)] transition flex items-center gap-2 ${selectedDues.length > 0 ? "bg-accent text-black hover:bg-accent/90" : "bg-white/10 text-white/30 cursor-not-allowed"}`}
          >
            {isProcessingPayment ? "Processing..." : "Pay Now"}{" "}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );

  const historySection = (
    <div className="glass rounded-xl p-5 border border-glass-border">
      <button
        onClick={() => setHistoryExpanded(!historyExpanded)}
        className="w-full flex items-center justify-between outline-none"
      >
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/70">
          Payment History
        </h3>
        {historyExpanded ? (
          <ChevronUp className="w-4 h-4 text-white/50" />
        ) : (
          <ChevronDown className="w-4 h-4 text-white/50" />
        )}
      </button>

      {historyExpanded && (
        <div className="mt-4">
          {paid.length === 0 ? (
            <div className="text-center py-6 text-white/40 text-sm italic">
              No payment history yet.
            </div>
          ) : (
            <div className="space-y-3">
              {paid.map((payment) => {
                return (
                  <div
                    key={payment.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10 gap-2"
                  >
                    <div>
                      <div className="font-bold text-sm flex items-center gap-2">
                        {payment.title}
                        {payment.type === "other" && (
                          <span className="text-[8px] uppercase tracking-widest text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded">
                            Other
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-white/50">
                        {payment.subtitle}
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                      <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20 whitespace-nowrap">
                        Paid
                      </span>
                      <span className="font-mono text-white/70">
                        ₹{payment.amount}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {(!showOnly || showOnly === "dues") && duesSection}
      {(!showOnly || showOnly === "history") && historySection}
    </div>
  );
}

function OtherFeesAdmin({ store }: { store: ReturnType<typeof useStore> }) {
  const [templateName, setTemplateName] = useState("");
  const [templateAmount, setTemplateAmount] = useState("");

  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [assignComment, setAssignComment] = useState("");
  const [searchPlayer, setSearchPlayer] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateName || !templateAmount) return;
    const amount = parseFloat(templateAmount);
    try {
      await store.addFeeTemplate(templateName, isNaN(amount) ? 0 : amount);
      setTemplateName("");
      setTemplateAmount("");
      alert("Fee Template added successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to create template.");
    }
  };

  const handleAssignFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate || selectedPlayers.length === 0) return;

    const template = store.feeTemplates.find((t) => t.id === selectedTemplate);
    if (!template) return;

    for (const pid of selectedPlayers) {
      await store.addOtherFee(
        pid,
        template.name,
        template.amount,
        assignComment,
        template.id,
      );
    }

    setSelectedPlayers([]);
    setAssignComment("");
    setSearchPlayer("");
    alert("Fee assigned successfully to selected players.");
  };

  const togglePlayer = (id: string) => {
    setSelectedPlayers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const filteredPlayers = store.players.filter(
    (p) =>
      !searchPlayer ||
      p.name.toLowerCase().includes(searchPlayer.toLowerCase()) ||
      p.mobile?.includes(searchPlayer),
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create Template */}
        <div className="glass rounded-xl p-5 border border-glass-border">
          <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-4">
            1. Create Custom Fee
          </h3>
          <form onSubmit={handleCreateTemplate} className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
                Fee Name
              </label>
              <input
                type="text"
                placeholder="e.g. Club Jersey"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
                Amount (₹)
              </label>
              <input
                type="number"
                placeholder="0"
                value={templateAmount}
                onChange={(e) => setTemplateAmount(e.target.value)}
                className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
                required
                min="1"
              />
            </div>
            <button
              type="submit"
              disabled={!templateName || !templateAmount}
              className="w-full bg-accent text-black font-bold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition shadow text-sm mt-2"
            >
              Save Fee Template
            </button>
          </form>

          <div className="mt-6">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">
              Saved Fees
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
              {(!store.feeTemplates || store.feeTemplates.length === 0) && (
                <div className="text-xs text-white/30 italic text-center p-4">
                  No fees created yet
                </div>
              )}
              {store.feeTemplates?.map((t) => (
                <div
                  key={t.id}
                  className="flex justify-between items-center p-2 rounded bg-black/20 border border-glass-border"
                >
                  <div>
                    <div className="text-sm font-bold text-white">{t.name}</div>
                    <div className="text-xs text-accent">₹{t.amount}</div>
                  </div>
                  <button
                    onClick={() => store.deleteFeeTemplate(t.id)}
                    className="text-red-400 hover:text-red-300 p-1"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Assign Fee */}
        <div className="glass rounded-xl p-5 border border-glass-border">
          <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-4">
            2. Assign Fee to Players
          </h3>
          {store.feeTemplates?.length === 0 ? (
            <div className="text-xs text-white/50 italic text-center p-6 border border-glass-border border-dashed rounded-xl">
              Create a Fee on the left first
            </div>
          ) : (
            <form onSubmit={handleAssignFee} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
                  Select Fee Template
                </label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value)}
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
                  required
                >
                  <option value="">-- Choose a Fee --</option>
                  {store.feeTemplates?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (₹{t.amount})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
                  Optional Description / Comment
                </label>
                <input
                  type="text"
                  placeholder="e.g. Size M, Green Color"
                  value={assignComment}
                  onChange={(e) => setAssignComment(e.target.value)}
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                    Select Players ({selectedPlayers.length} selected)
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPlayers(
                        selectedPlayers.length === filteredPlayers.length
                          ? []
                          : filteredPlayers.map((p) => p.id),
                      )
                    }
                    className="text-accent text-[10px] uppercase font-bold tracking-wider hover:underline"
                  >
                    {selectedPlayers.length === filteredPlayers.length &&
                    filteredPlayers.length > 0
                      ? "Deselect All"
                      : "Select All Filtered"}
                  </button>
                </div>

                <input
                  type="text"
                  placeholder="Search players to assign..."
                  value={searchPlayer}
                  onChange={(e) => setSearchPlayer(e.target.value)}
                  className="w-full bg-black/40 border border-glass-border rounded-t-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white mb-0"
                />

                <div className="h-40 overflow-y-auto border border-t-0 border-glass-border rounded-b-lg bg-black/20 p-2 gap-1 flex flex-col hide-scrollbar">
                  {filteredPlayers.length === 0 && (
                    <div className="text-xs text-white/40 italic p-2 text-center">
                      No players found.
                    </div>
                  )}
                  {filteredPlayers.map((p) => (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition ${selectedPlayers.includes(p.id) ? "bg-accent/20 border border-accent/30 text-white" : "hover:bg-white/5 border border-transparent text-white/70"}`}
                    >
                      <input
                        type="checkbox"
                        onChange={() => togglePlayer(p.id)}
                        checked={selectedPlayers.includes(p.id)}
                        className="accent-accent flex-shrink-0"
                      />
                      <span className="text-xs truncate font-medium">
                        {p.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={!selectedTemplate || selectedPlayers.length === 0}
                className="w-full bg-accent text-black font-bold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition shadow text-sm mt-2"
              >
                Assign to {selectedPlayers.length} Player(s)
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="glass rounded-xl overflow-hidden border border-glass-border mt-8">
        <div className="bg-black/40 p-4 border-b border-glass-border flex justify-between items-center flex-wrap gap-2">
          <h3 className="font-bold text-sm">Assigned Fees Ledger</h3>
          <div className="text-[10px] uppercase font-black text-white/60 bg-white/5 px-3 py-1 rounded-full border border-white/5">
            Total Due from Assigned Fees:{" "}
            <span className="text-red-400">
              ₹
              {store.otherFees
                ?.filter((f) => f.status === "Unpaid")
                .reduce((acc, f) => acc + (f.amount || 0), 0) || 0}
            </span>
          </div>
        </div>
        <div className="divide-y divide-glass-border/50 max-h-96 overflow-y-auto">
          {(!store.otherFees || store.otherFees.length === 0) && (
            <div className="p-6 text-center text-xs text-white/40 italic">
              No custom fees have been assigned yet.
            </div>
          )}
          {store.otherFees
            ?.sort(
              (a, b) =>
                (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
            )
            .map((fee) => {
              const p = store.players.find((x) => x.id === fee.playerId);
              const isPaid = fee.status === "Paid";
              return (
                <div
                  key={fee.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-white/5 transition gap-3"
                >
                  <div>
                    <div className="font-bold text-sm text-white">
                      {fee.title}{" "}
                      <span className="text-white/40 font-normal ml-1">
                        for
                      </span>{" "}
                      {p?.name || "Unknown"}
                    </div>
                    <div className="text-[10px] text-white/40 mt-0.5">
                      {formatDate(
                        new Date(
                          (fee.createdAt?.seconds || 0) * 1000,
                        ).toISOString(),
                      )}{" "}
                      {fee.comment && (
                        <span className="ml-2 text-white/60">
                          ({fee.comment})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                    <span className="font-mono font-bold text-accent">
                      ₹{fee.amount}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!isPaid && p?.mobile && (
                        <button
                          onClick={() => {
                             const link = `${window.location.origin}/pay/${p.id}`;
                             const text = `Hi ${p.name}, gentle reminder to clear your due of ₹${fee.amount} for ${fee.title}.\n\nPlease clear them at your earliest convenience using this link: ${link}`;
                             const encodedText = encodeURIComponent(text);
                             window.open(`https://wa.me/${p.mobile.replace("+", "")}?text=${encodedText}`, "_blank");
                          }}
                          className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-bold text-[9px] uppercase tracking-widest px-2 py-1 rounded transition whitespace-nowrap"
                        >
                          WA Remind
                        </button>
                      )}
                      {!isPaid && p?.email && (
                        <button
                          onClick={async () => {
                            const link = `${window.location.origin}/pay/${p.id}`;
                            const reminderTemplate = store.appConfig?.emailTemplates?.due_reminder || {
                              subject: "Pending Fee Reminder - {{clubName}}",
                              body: "Hi {{playerName}},\n\nThis is a friendly reminder that you have an outstanding fee of {{amount}} for: {{duesText}}.\n\nPlease log in to clear your dues at your earliest convenience using this link: {{link}}\n\nBest regards,\n{{clubName}} Admin Team",
                            };
                            const renderTpl = (txt: string) => {
                              return txt
                                .replace(/{{clubName}}/g, store.appConfig?.clubName || "Kavach Play")
                                .replace(/{{playerName}}/g, p.name || "Player")
                                .replace(/{{amount}}/g, `₹${fee.amount}`)
                                .replace(/{{duesText}}/g, fee.title || "outstanding fee")
                                .replace(/{{link}}/g, link);
                            };
                            try {
                              const res = await authedFetch("/api/email/send", {
                                method: "POST",
                                body: JSON.stringify({
                                  to: [p.email],
                                  subject: renderTpl(reminderTemplate.subject),
                                  text: renderTpl(reminderTemplate.body),
                                  config: store.appConfig,
                                })
                              });
                              
                              if (!res.ok) {
                                const errData = await res.json().catch(() => ({}));
                                throw new Error(errData.error || "Network error");
                              }
                              
                              const data = await res.json();
                              if (!data.success) {
                                throw new Error(data.error || "Failed to send");
                              }
                              alert("Email reminder sent successfully!");
                            } catch (e: any) {
                              alert(`Failed: ${e.message || "Failed to send email reminder."}`);
                            }
                          }}
                          className="bg-accent/20 hover:bg-accent/30 text-accent font-bold text-[9px] uppercase tracking-widest px-2 py-1 rounded transition whitespace-nowrap"
                        >
                          Email Remind
                        </button>
                      )}
                      <span
                        className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${isPaid ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" : "text-red-400 border-red-400/30 bg-red-400/10"}`}
                      >
                        {isPaid ? "Paid" : "Unpaid"}
                      </span>
                      <button
                        onClick={() =>
                          store.updateOtherFeeStatus(
                            fee.playerId,
                            fee.id,
                            isPaid ? "Unpaid" : "Paid",
                          )
                        }
                        className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white/70 transition border border-white/10 whitespace-nowrap"
                      >
                        Mark {isPaid ? "Unpaid" : "Paid"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function FeeManagementView({ store }: { store: ReturnType<typeof useStore> }) {
  const [feeTab, setFeeTab] = useState<"custom" | "plans" | "feePlans">("custom");
  return (
    <div className="space-y-4">
      <div className="flex bg-black/40 rounded-lg p-1 border border-glass-border">
          <button
            onClick={() => setFeeTab("custom")}
            className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition ${feeTab === "custom" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
          >
            Custom Fees
          </button>
          <button
            onClick={() => setFeeTab("plans")}
            className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition ${feeTab === "plans" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
          >
            Subscriptions
          </button>
          <button
            onClick={() => setFeeTab("feePlans")}
            className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition ${feeTab === "feePlans" ? "bg-amber-500/20 text-amber-400" : "text-white/50 hover:text-white"}`}
          >
            Match Fee Plans
          </button>
      </div>
      {feeTab === "custom" ? (
        <CreateFeeAdmin store={store} />
      ) : feeTab === "plans" ? (
        <PlansView store={store} />
      ) : (
        <FeePlansAdmin store={store} />
      )}
    </div>
  );
}

function AdminFinanceView({ store, defaultAction, isSuperAdmin }: { store: ReturnType<typeof useStore>; defaultAction?: string | null; isSuperAdmin?: boolean }) {
  const [subTab, setSubTab] = useState<
    "matches" | "wix" | "fee" | "razor" | "dues"
  >((defaultAction as any) || "matches");
  const [searchPlayer, setSearchPlayer] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterMatchId, setFilterMatchId] = useState("");
  const [editingMatchFeeId, setEditingMatchFeeId] = useState<string | null>(null);
  const [editFeeVal, setEditFeeVal] = useState<string>("");
  const [isSavingFee, setIsSavingFee] = useState(false);

  const filteredMatches = useMemo(() => {
    let m = store.matches;
    if (filterStartDate) {
      m = m.filter((match) => match.date >= filterStartDate);
    }
    if (filterEndDate) {
      m = m.filter((match) => match.date <= filterEndDate);
    }
    if (filterMatchId) {
      m = m.filter((match) => match.id === filterMatchId);
    }
    return m.sort((a, b) => b.date.localeCompare(a.date)); // Sort newest first
  }, [store.matches, filterStartDate, filterEndDate, filterMatchId]);

  // Aggregate data for the matches
  const reportData = useMemo(() => {
    return filteredMatches
      .map((match) => {
        let paymentsForMatch = store.payments.filter(
          (p) =>
            p.matchId === match.id &&
            p.status !== "Not Playing" &&
            store.players.some((pl) => pl.id === p.playerId),
        );

        if (searchPlayer) {
          paymentsForMatch = paymentsForMatch.filter((p) => {
            const pl = store.players.find((x) => x.id === p.playerId);
            return pl?.name.toLowerCase().includes(searchPlayer.toLowerCase());
          });
        }

        const playingCount = paymentsForMatch.length;
        const paidCount = paymentsForMatch.filter(
          (p) => p.status === "Paid",
        ).length;
        const unpaidCount = paymentsForMatch.filter(
          (p) => p.status === "Unpaid" && (p.feeOverride !== undefined ? p.feeOverride : match.fee) > 0,
        ).length;
        const razorpayPaidCount = paymentsForMatch.filter(
          (p) => p.status === "Paid" && p.paymentMethod !== "manual"
        ).length;
        const manualPaidCount = paymentsForMatch.filter(
          (p) => p.status === "Paid" && p.paymentMethod === "manual"
        ).length;

        const getFee = (p: any) => p.feeOverride !== undefined ? p.feeOverride : match.fee;

        const matchFeeTotal = match.matchFeeBudget !== undefined ? match.matchFeeBudget : (match.fee || 0) * 12;

        let feeCollected = 0;
        let feeCollectedCount = 0;
        let feeOffset = 0;
        let feeOffsetCount = 0;
        const sponsoredDetails: { playerName: string; amount: number; reason: string }[] = [];
        const paidPlayers: string[] = [];
        const unpaidPlayers: string[] = [];
        const paidPlayerDetails: { name: string; amount: number; method: string }[] = [];
        const unpaidPlayerDetails: { name: string; due: number; planTag?: string }[] = [];

        for (const p of paymentsForMatch) {
          const effectiveFee = p.feeOverride !== undefined ? p.feeOverride : match.fee;
          const player = store.players.find((x) => x.id === p.playerId);
          const playerName = p.guestName ? `${p.guestName} (Guest)` : (player?.name || "Player");

          if (p.status === "Paid") {
            paidPlayers.push(playerName);
            const methodLabel =
              p.paymentMethod === "razorpay"
                ? "Razorpay"
                : p.manualMethod === "club_sponsored"
                  ? "Sponsored"
                  : p.manualMethod === "part_of_plan"
                    ? "Subscription"
                    : "Cash";
            paidPlayerDetails.push({
              name: playerName,
              amount: p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : effectiveFee,
              method: methodLabel,
            });
          } else {
            unpaidPlayers.push(playerName);
            unpaidPlayerDetails.push({
              name: playerName,
              due: effectiveFee,
              planTag: p.planTag,
            });
          }

          // Calculate real money collected (Razorpay + Cash collected + Monthly subscription allocation)
          if (p.status === "Paid") {
            if (p.manualMethod === "club_sponsored") {
              // Entirely sponsored by club; 0 direct money collected
            } else if (p.manualMethod === "part_of_plan") {
              // Monthly flat fee subscription allocation
              const collected = p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : (match.fee - (p.feeOffsetAmount || 0));
              feeCollected += collected;
              feeCollectedCount++;
            } else {
              // Razorpay, cash, direct deposit, or standard manual
              const collected = p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : effectiveFee;
              feeCollected += collected;
              feeCollectedCount++;
            }
          }

          // Calculate Club Sponsored offset and breakdown for hover tooltip
          if (p.feeOffsetAmount !== undefined && p.feeOffsetAmount > 0) {
            feeOffset += p.feeOffsetAmount;
            feeOffsetCount++;
            sponsoredDetails.push({
              playerName,
              amount: p.feeOffsetAmount,
              reason: p.planTag || (p.manualMethod === "club_sponsored" ? "Club Sponsored" : "Plan Offset"),
            });
          } else if (p.manualMethod === "club_sponsored") {
            const sponsoredAmt = p.feeOverride !== undefined && p.feeOverride > 0 ? p.feeOverride : match.fee;
            feeOffset += sponsoredAmt;
            feeOffsetCount++;
            sponsoredDetails.push({
              playerName,
              amount: sponsoredAmt,
              reason: p.planTag || "Club Sponsored",
            });
          } else if (p.sponsoredBy) {
            const sponsor = store.players.find((x) => x.id === p.sponsoredBy);
            feeOffset += match.fee;
            feeOffsetCount++;
            sponsoredDetails.push({
              playerName,
              amount: match.fee,
              reason: `Sponsored by ${sponsor?.name || "Member"}`,
            });
          } else if ((p.status === "Paid" || p.feeOverride !== undefined) && p.manualMethod !== "part_of_plan" && match.fee > effectiveFee) {
            const discount = match.fee - effectiveFee;
            if (discount > 0) {
              feeOffset += discount;
              feeOffsetCount++;
              sponsoredDetails.push({
                playerName,
                amount: discount,
                reason: p.planTag || "Fixed Discount",
              });
            }
          }
        }

        const percentRecovered = matchFeeTotal > 0 ? Math.round((feeCollected * 100) / matchFeeTotal) : null;

        return {
          match,
          payments: paymentsForMatch,
          playingCount,
          paidCount,
          unpaidCount,
          paidPlayers,
          unpaidPlayers,
          paidPlayerDetails,
          unpaidPlayerDetails,
          razorpayPaidCount,
          manualPaidCount,
          totalCollected: paymentsForMatch.filter(p => p.status === "Paid").reduce((s, p) => s + getFee(p), 0),
          razorpayCollected: paymentsForMatch.filter(p => p.status === "Paid" && p.paymentMethod !== "manual").reduce((s, p) => s + getFee(p), 0),
          manualCollected: paymentsForMatch.filter(p => p.status === "Paid" && p.paymentMethod === "manual").reduce((s, p) => s + getFee(p), 0),
          totalDue: paymentsForMatch.filter(p => p.status === "Unpaid").reduce((s, p) => s + getFee(p), 0),
          feeCollected,
          feeCollectedCount,
          feeOffset,
          feeOffsetCount,
          sponsoredDetails,
          matchFeeTotal,
          percentRecovered,
          hasResults: playingCount > 0,
        };
      })
      .filter((d) => !searchPlayer || d.hasResults); // If searching, hide matches with no matches
  }, [filteredMatches, store.payments, store.players, searchPlayer]);

  const grandTotalCollected = reportData.reduce(
    (t, d) => t + d.totalCollected,
    0,
  );
  const grandTotalDue = reportData.reduce((t, d) => t + d.totalDue, 0);

  const collectedMatches = useMemo(() => {
    return reportData.filter((d) => d.feeCollected > 0 || d.feeOffset > 0 || d.paidCount > 0);
  }, [reportData]);


  return (
    <div className="space-y-6">
      <div className="flex bg-white/5 p-1.5 rounded-2xl border border-glass-border mb-4 overflow-x-auto hide-scrollbar gap-2">
        {[
          "matches",
          "dues",
          "razor",
          ...(store.appConfig?.features?.isWixEnabled ? ["wix"] : []),
          "fee",
        ].map((tab) => {
          const active = subTab === tab;
          const labels: Record<string, string> = {
            matches: "Match Fees",
            dues: "Dues",
            razor: "Transactions",
            wix: "Wix",
            fee: "Other Fees",
          };
          return (
            <button
              key={tab}
              onClick={() => setSubTab(tab as any)}
              className={`flex-1 py-2 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all duration-200 text-center cursor-pointer whitespace-nowrap ${
                active
                  ? "bg-accent text-black font-extrabold shadow-[0_2px_8px_rgba(16,185,129,0.3)]"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {subTab === "matches" && (
        <div className="space-y-4">
          <div className="glass rounded-xl p-4 border border-glass-border overflow-visible">
            <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-4">
              Match Fee Accounting
            </h3>
            {(() => {
              const showPct = collectedMatches.some((d) => d.matchFeeTotal > 0);
              return (
              <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-glass-border text-[10px] uppercase tracking-widest text-white/50">
                    <th className="py-2 pr-3 font-bold whitespace-nowrap">Match Details</th>
                    <th className="py-2 px-3 font-bold whitespace-nowrap text-center">Paid / Unpaid</th>
                    <th className="py-2 px-3 font-bold whitespace-nowrap text-right">Match Fee</th>
                    <th className="py-2 px-3 font-bold whitespace-nowrap text-right">Fee Collected</th>
                    <th className="py-2 px-3 font-bold whitespace-nowrap text-right">Club Sponsored</th>
                    {showPct && <th className="py-2 pl-3 font-bold whitespace-nowrap text-right">% Recovered</th>}
                  </tr>
                </thead>
                <tbody>
                  {collectedMatches.map((data, rowIndex) => {
                    const ground = store.grounds.find((g) => g.id === data.match.groundId);
                    return (
                      <tr key={data.match.id} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="py-2.5 pr-3">
                          <div className="text-white font-semibold text-xs">{formatDate(data.match.date)}</div>
                          <div className="text-[10px] text-white/40">{ground?.name || "—"}</div>
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap relative group">
                          <div className="inline-flex items-center gap-1.5 cursor-help px-2 py-0.5 rounded bg-white/5 border border-glass-border hover:bg-white/10 transition">
                            <span className="text-emerald-400 font-bold font-mono text-xs">{data.paidCount} Paid</span>
                            <span className="text-white/30">/</span>
                            <span className={`font-bold font-mono text-xs ${data.unpaidCount > 0 ? "text-red-400" : "text-white/40"}`}>
                              {data.unpaidCount} Unpaid
                            </span>
                            <Info className="w-3 h-3 text-white/40 group-hover:text-white transition shrink-0" />
                          </div>

                          {/* Desktop Hover Tooltip */}
                          <div
                            className={`hidden group-hover:block absolute left-1/2 -translate-x-1/2 ${
                              rowIndex < 2 ? "top-full mt-2 before:-top-3" : "bottom-full mb-2 before:-bottom-3"
                            } z-50 w-72 max-h-[380px] bg-[#0f172a]/95 border border-glass-border rounded-xl p-3 shadow-2xl backdrop-blur-xl pointer-events-auto text-left animate-in fade-in duration-150 before:content-[''] before:absolute before:left-0 before:right-0 before:h-3`}
                          >
                            <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-white">
                                Squad Payment Status
                              </span>
                              <span className="text-[10px] font-mono text-white/60 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                                {data.paidCount + data.unpaidCount} Assigned
                              </span>
                            </div>

                            <div className="space-y-3 max-h-[290px] overflow-y-auto pr-1 custom-scrollbar">
                              {/* 1. Unpaid Players FIRST */}
                              <div>
                                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-red-400 mb-1.5">
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                                    Unpaid ({data.unpaidCount})
                                  </span>
                                  {data.unpaidCount > 0 && data.totalDue > 0 && (
                                    <span className="font-mono text-red-400/80 font-normal">
                                      ₹{data.totalDue} due
                                    </span>
                                  )}
                                </div>
                                {data.unpaidPlayerDetails.length > 0 ? (
                                  <div className="space-y-1">
                                    {data.unpaidPlayerDetails.map((item, i) => (
                                      <div
                                        key={i}
                                        className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded bg-red-500/10 border border-red-500/15"
                                      >
                                        <div className="truncate flex items-center gap-1.5 min-w-0">
                                          <span className="text-red-400 text-[10px] shrink-0">✗</span>
                                          <span className="truncate text-white/90 font-medium">{item.name}</span>
                                        </div>
                                        <div className="shrink-0 flex items-center gap-1 font-mono text-[10px]">
                                          <span className="text-red-300 font-bold">₹{item.due}</span>
                                          {item.planTag && (
                                            <span className="text-[8px] text-amber-300 bg-amber-500/20 px-1 py-0.5 rounded border border-amber-500/30 truncate max-w-[85px]">
                                              {item.planTag}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-emerald-400/90 italic py-1 px-2 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-1.5">
                                    <span>✓</span> All players have paid!
                                  </div>
                                )}
                              </div>

                              {/* Divider */}
                              <div className="border-t border-white/10" />

                              {/* 2. Paid Players SECOND */}
                              <div>
                                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1.5">
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                    Paid ({data.paidCount})
                                  </span>
                                  {data.paidCount > 0 && (
                                    <span className="font-mono text-emerald-400/80 font-normal">
                                      {data.paidCount} cleared
                                    </span>
                                  )}
                                </div>
                                {data.paidPlayerDetails.length > 0 ? (
                                  <div className="space-y-1">
                                    {data.paidPlayerDetails.map((item, i) => (
                                      <div
                                        key={i}
                                        className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded bg-white/5 border border-white/5 hover:bg-white/10 transition"
                                      >
                                        <div className="truncate flex items-center gap-1.5 min-w-0">
                                          <span className="text-emerald-400 text-[10px] shrink-0">✓</span>
                                          <span className="truncate text-white/80">{item.name}</span>
                                        </div>
                                        <div className="shrink-0 flex items-center gap-1.5 text-[9px] font-mono">
                                          <span className="text-white/60">₹{item.amount}</span>
                                          <span
                                            className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                                              item.method === "Razorpay"
                                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                                                : item.method === "Sponsored"
                                                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/25"
                                                  : "bg-teal-500/15 text-teal-400 border border-teal-500/25"
                                            }`}
                                          >
                                            {item.method}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-white/40 italic py-1 px-2">No payments received yet</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {editingMatchFeeId === data.match.id ? (
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault();
                                const val = parseFloat(editFeeVal);
                                if (isNaN(val) || val < 0) return;
                                setIsSavingFee(true);
                                try {
                                  await store.updateMatch(data.match.id, { matchFeeBudget: val });
                                  setEditingMatchFeeId(null);
                                } catch (err: any) {
                                  console.error("Failed to update match fee:", err);
                                  alert(err?.message || "Failed to update match fee.");
                                } finally {
                                  setIsSavingFee(false);
                                }
                              }}
                              className="inline-flex items-center gap-1 justify-end"
                            >
                              <span className="text-white/50 text-xs">₹</span>
                              <input
                                type="number"
                                min="0"
                                value={editFeeVal}
                                onChange={(e) => setEditFeeVal(e.target.value)}
                                className="w-20 bg-black/80 border border-accent rounded px-1.5 py-0.5 text-xs text-white text-right font-mono font-bold focus:outline-none"
                                autoFocus
                              />
                              <button
                                type="submit"
                                disabled={isSavingFee}
                                className="p-1 hover:bg-emerald-500/20 text-emerald-400 rounded transition"
                                title="Save"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingMatchFeeId(null)}
                                className="p-1 hover:bg-white/10 text-white/50 hover:text-white rounded transition text-xs font-bold"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </form>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5 group/fee">
                              <div className="text-right">
                                <div className="text-white font-bold font-mono text-xs">₹{data.matchFeeTotal}</div>
                                <div className="text-[10px] text-white/40 mt-0.5 font-mono">
                                  {data.match.matchFeeBudget !== undefined ? "Custom Target" : `₹${data.match.fee} × 12 players`}
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setEditingMatchFeeId(data.match.id);
                                  setEditFeeVal(String(data.matchFeeTotal));
                                }}
                                className="opacity-0 group-hover/fee:opacity-100 p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition cursor-pointer"
                                title="Edit Match Fee"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="text-emerald-400 font-semibold font-mono">₹{data.feeCollected}</div>
                          <div className="text-[10px] text-white/40">({data.feeCollectedCount})</div>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap relative group">
                          <div className="text-amber-400 font-semibold font-mono inline-flex items-center gap-1 cursor-help">
                            <span>₹{data.feeOffset}</span>
                            {data.sponsoredDetails.length > 0 && (
                              <Info className="w-3 h-3 text-amber-400/60 group-hover:text-amber-300 transition shrink-0" />
                            )}
                          </div>
                          <div className="text-[10px] text-white/40">({data.feeOffsetCount})</div>

                          {/* Desktop Hover Tooltip */}
                          {data.sponsoredDetails.length > 0 && (
                            <div className={`hidden group-hover:block absolute right-0 ${rowIndex < 2 ? "top-full mt-2 before:-top-3" : "bottom-full mb-2 before:-bottom-3"} z-50 w-64 bg-[#0f172a]/95 border border-amber-500/30 rounded-xl p-3 shadow-2xl backdrop-blur-xl pointer-events-auto text-left animate-in fade-in duration-150 before:content-[''] before:absolute before:left-0 before:right-0 before:h-3`}>
                              <div className="flex items-center justify-between border-b border-amber-500/20 pb-1.5 mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                                  Club Sponsored
                                </span>
                                <span className="text-[10px] font-mono font-bold text-white">
                                  Total: ₹{data.feeOffset}
                                </span>
                              </div>
                              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                                {data.sponsoredDetails.map((detail, idx) => (
                                  <div key={idx} className="flex items-center justify-between text-xs py-0.5 border-b border-white/5 last:border-0">
                                    <div className="truncate pr-2">
                                      <span className="text-white font-medium block truncate">
                                        {detail.playerName}
                                      </span>
                                      <span className="text-[9px] text-white/50 block truncate">
                                        {detail.reason}
                                      </span>
                                    </div>
                                    <span className="font-mono font-bold text-amber-400 shrink-0">
                                      ₹{detail.amount}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                        {showPct && (
                          <td className="py-2.5 pl-3 text-right whitespace-nowrap font-mono">
                            {data.percentRecovered !== null ? (
                              <span className={`font-bold ${data.percentRecovered >= 80 ? "text-emerald-400" : data.percentRecovered >= 50 ? "text-amber-400" : "text-red-400"}`}>
                                {data.percentRecovered}%
                              </span>
                            ) : (
                              <span className="text-white/30">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {collectedMatches.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-glass-border">
                      <td className="py-2.5 pr-3 font-bold text-white text-xs uppercase tracking-wider">Total</td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap font-mono text-xs">
                        <span className="text-emerald-400 font-bold">{collectedMatches.reduce((s, d) => s + d.paidCount, 0)} Paid</span>
                        <span className="text-white/30 mx-1">/</span>
                        <span className="text-red-400 font-bold">{collectedMatches.reduce((s, d) => s + d.unpaidCount, 0)} Unpaid</span>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="text-white font-bold font-mono">₹{collectedMatches.reduce((s, d) => s + d.matchFeeTotal, 0)}</div>
                        <div className="text-[10px] text-white/40 font-mono">{collectedMatches.length} matches</div>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="text-emerald-400 font-bold font-mono">₹{collectedMatches.reduce((s, d) => s + d.feeCollected, 0)}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="text-amber-400 font-bold font-mono">₹{collectedMatches.reduce((s, d) => s + d.feeOffset, 0)}</div>
                      </td>
                      {showPct && (
                        <td className="py-2.5 pl-3 text-right whitespace-nowrap font-mono">
                          {(() => {
                            const totalMatchFee = collectedMatches.reduce((s, d) => s + d.matchFeeTotal, 0);
                            const totalCollected = collectedMatches.reduce((s, d) => s + d.feeCollected, 0);
                            const pct = totalMatchFee > 0 ? Math.round((totalCollected * 100) / totalMatchFee) : 0;
                            return <span className={`font-bold ${pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400"}`}>{pct}%</span>;
                          })()}
                        </td>
                      )}
                    </tr>
                  </tfoot>
                )}
              </table>
              {collectedMatches.length === 0 && (
                <div className="text-center text-white/50 text-sm py-4">
                  No match collections found.
                </div>
              )}
            </div>
              );
            })()}
          </div>
        </div>
      )}

      {subTab === "dues" && <DuesAndRemindersTab store={store} isFinanceAdmin={true} isSuperAdmin={isSuperAdmin} />}
      {subTab === "razor" && <RazorReportView store={store} />}
      {subTab === "wix" && <WixFinanceView store={store} />}

      {subTab === "fee" && <FeeManagementView store={store} />}

    </div>
  );
}
