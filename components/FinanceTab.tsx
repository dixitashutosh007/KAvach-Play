/**
 * Finance Dashboard (`components/FinanceTab.tsx`)
 *
 * Handles all financial interactions related to matches and other ad-hoc fees.
 * Admins use this to track which players have or haven't paid their match fees,
 * create new fee templates, and assign individual fees. Players use this tab
 * to view their outstanding dues and mark them as paid.
 */
import { authedFetch } from "@/lib/authed-fetch";
import { isMatchBillable } from "@/lib/matchBillable";
import {
  summarizeMatchFinance,
  summarizeClubFinanceOverview,
  partitionMatchFinancePlayers,
  summarizePlayerFinancialProfile,
} from "@/lib/match-finance";
import { useState, useMemo, useEffect, useRef } from "react";
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
import { resolveMyPlayers } from "@/lib/player-identity";
import RazorReportView from "./RazorReportView";
import { CreateFeeAdmin } from "./CreateFeeAdmin";
import { FeePlansAdmin } from "./FeePlansAdmin";
import { PlansView } from "./PlansView";
import { DuesAndRemindersTab } from "./DuesAndRemindersTab";
import { AuditLogTab } from "./AuditLogTab";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export function FinanceTab({
  store,
  persona,
  isFinanceAdmin,
  isSuperAdmin,
  defaultAction,
  onNavigateToSettings,
}: {
  store: ReturnType<typeof useStore>;
  persona: "admin" | "player";
  isFinanceAdmin?: boolean;
  isSuperAdmin?: boolean;
  defaultAction?: string | null;
  onNavigateToSettings?: () => void;
}) {
  const { user } = useAuth();

  if (persona === "admin" && isFinanceAdmin !== false) {
    return (
      <AdminFinanceView
        store={store}
        defaultAction={defaultAction}
        isSuperAdmin={isSuperAdmin}
        onNavigateToSettings={onNavigateToSettings}
      />
    );
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
  const { toast } = useToast();
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const appUser = store.appUsers.find((u) => u.id === userId);
  const myPlayers = resolveMyPlayers(store.players, userId, appUser);

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
    status: "Paid" | "Unpaid" | "Not Playing" | "Failed" | "Cancelled" | "Waived";
    updatedAtSeconds: number;
  };

  const unifiedDues: UnifiedDue[] = [];
  myPayments.forEach((p) => {
    const match = store.matches.find((m) => m.id === p.matchId);
    if (match && isMatchBillable(match)) {
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
    if (!match || !isMatchBillable(match)) return;
    const matchLabel = `vs ${match.opponent || "Match"} (${formatDate(match.date)})`;
    const exempted = store.otherFees.some(
      (f: any) =>
        f.playerId === p.playerId &&
        f.title?.startsWith("Late Fee Exemption:") &&
        f.title?.includes(match.id) &&
        f.status !== "Cancelled",
    );
    if (exempted) return;

    // FIN-007: Do not re-levy or duplicate automatic late fees if already recorded in otherFees
    const alreadyRecorded = store.otherFees.some(
      (f: any) =>
        f.playerId === p.playerId &&
        f.status !== "Cancelled" &&
        (
          (f.title?.startsWith("Late Fee") && (f.title?.includes(match.id) || f.title?.includes(matchLabel) || f.comment?.includes(match.id))) ||
          (f.templateId && f.templateId.includes(`latefee_${match.id}`))
        ),
    );
    if (alreadyRecorded) return;

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
      toast("This feature is currently not available. Contact Club Admin");
      return;
    }

    const duesToPay = dues.filter((d) => selectedDues.includes(d.id));

    setIsProcessingPayment(true);
    try {
      const rzpId =
        store.appConfig?.razorpayKeyId ||
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

      if (!rzpId) {
        toast("Razorpay keys are missing (Settings -> Payment Gateway)", "error");
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
            items: duesToPay.map(d => {
              const isLateFee = d.rawId.startsWith("latefee_");
              return {
                type: d.type,
                matchId: d.type === "match" ? d.matchId : null,
                feeId: (d.type === "other" && !isLateFee) ? d.rawId : null,
                merchId: d.type === "merch" ? d.rawId : null,
                paymentId: d.rawId,
                ...(isLateFee ? {
                  isLateFee: true,
                  lateFeeLabel: d.title,
                  lateFeeAmount: d.amount,
                  lateFeeTemplateId: `latefee_${d.matchId}`,
                } : {}),
              };
            })
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
                if (due.rawId.startsWith("latefee_")) {
                  // Late fees are created and marked Paid server-side by the webhook
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
                    store.updateMerchOrder(due.rawId, { paymentStatus: "Paid" })
                  );
                }
              }
            }
            await Promise.all(updates);
            setSelectedDues([]);
            toast("Payment Successful!", "success");

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
            toast(
              "Payment successful but status update failed. Please contact admin.",
            "error");
          }
        },
        prefill: {
          name: appUser?.name || mePlayer?.name || "Player",
          email: appUser?.email || mePlayer?.email || "",
          contact: appUser?.mobile || mePlayer?.mobile || "",
        },
        theme: {
          color: "#D51F43", // Primary action brand color
        },
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.on("payment.failed", async function (response: any) {
        toast("Payment failed: " + response.error.description, "error");
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
      toast("Error: " + err.message, "error");
    } finally {
      setIsProcessingPayment(false);
    }
  };

  if (!mePlayer) {
    return (
      <div className="bg-surface rounded-xl p-8 text-center text-text-muted border border-border">
        No player profile linked. Please update your profile with your mobile
        number.
      </div>
    );
  }

  const duesSection = (
    <div className="space-y-6">
      {!showOnly && (
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-text-primary">
            My Dues & Payments
          </h2>
        </div>
      )}

      <div className="bg-surface rounded-xl p-5 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-32 h-32 bg-red-500 opacity-10 blur-3xl rounded-full translate-x-10 -translate-y-10" />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-4 flex items-center justify-between">
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
          <div className="text-center py-6 text-text-muted text-sm italic">
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
                  className={`flex items-center justify-between p-3 rounded-lg border transition ${isLockedLateFee ? "cursor-not-allowed" : "cursor-pointer"} ${isSelected ? (isLateFee ? "bg-orange-500/10 border-orange-500/30" : "bg-accent/10 border-accent/30") : "bg-surface-hover border-border hover:bg-surface-hover"}`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`w-5 h-5 rounded shrink-0 flex items-center justify-center border transition ${isSelected ? (isLateFee ? "bg-orange-500 border-orange-500 text-black" : "bg-accent border-accent text-text-accent") : "border-border"}`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                      {isLockedLateFee && <Shield className="w-3 h-3" />}
                    </div>
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="font-bold text-sm tracking-tight leading-snug mb-1 text-text-primary flex flex-wrap items-center gap-2">
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
                      <div className="text-[10px] text-text-muted break-words">
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
        <div className="bg-surface rounded-xl p-4 sticky bottom-4 z-10 border flex items-center justify-between backdrop-blur-md transition-colors duration-300 shadow-xl mt-4 bg-surface/90 border-border">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
              Total Selected
            </div>
            <div className="text-xl font-mono font-bold text-accent">
              ₹{totalAmountDue}
            </div>
            {selectedDues.length === 0 && (
              <div className="text-[9px] text-text-muted mt-1 italic">
                Select your due or match to Pay
              </div>
            )}
          </div>
          <button
            disabled={isProcessingPayment || selectedDues.length === 0}
            onClick={handlePay}
            className={`px-6 py-2.5 rounded-lg font-bold text-sm shadow-[0_4px_12px_rgba(213,31,67,0.2)] transition flex items-center gap-2 ${selectedDues.length > 0 ? "bg-accent text-text-accent hover:bg-accent/90" : "bg-surface-hover text-text-primary/30 cursor-not-allowed"}`}
          >
            {isProcessingPayment ? "Processing..." : "Pay Now"}{" "}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );

  const historySection = (
    <div className="bg-surface rounded-xl p-5 border border-border">
      <button
        onClick={() => setHistoryExpanded(!historyExpanded)}
        className="w-full flex items-center justify-between outline-none"
      >
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">
          Payment History
        </h3>
        {historyExpanded ? (
          <ChevronUp className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {historyExpanded && (
        <div className="mt-4">
          {paid.length === 0 ? (
            <div className="text-center py-6 text-text-muted text-sm italic">
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
                      <div className="text-[10px] text-text-muted">
                        {payment.subtitle}
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                      <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20 whitespace-nowrap">
                        Paid
                      </span>
                      <span className="font-mono text-text-secondary">
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
  const { toast } = useToast();
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
      toast("Fee Template added successfully!", "success");
    } catch (err) {
      console.error(err);
      toast("Failed to create template.", "error");
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
    toast("Fee assigned successfully to selected players.", "success");
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
        <div className="bg-surface rounded-xl p-5 border border-border">
          <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-4">
            1. Create Custom Fee
          </h3>
          <form onSubmit={handleCreateTemplate} className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 block">
                Fee Name
              </label>
              <input
                type="text"
                placeholder="e.g. Club Jersey"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-text-primary"
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 block">
                Amount (₹)
              </label>
              <input
                type="number"
                placeholder="0"
                value={templateAmount}
                onChange={(e) => setTemplateAmount(e.target.value)}
                className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-text-primary"
                required
                min="1"
              />
            </div>
            <button
              type="submit"
              disabled={!templateName || !templateAmount}
              className="w-full bg-accent text-text-accent font-bold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition shadow text-sm mt-2"
            >
              Save Fee Template
            </button>
          </form>

          <div className="mt-6">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
              Saved Fees
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
              {(!store.feeTemplates || store.feeTemplates.length === 0) && (
                <div className="text-xs text-text-primary/30 italic text-center p-4">
                  No fees created yet
                </div>
              )}
              {store.feeTemplates?.map((t) => (
                <div
                  key={t.id}
                  className="flex justify-between items-center p-2 rounded bg-surface-hover border border-border"
                >
                  <div>
                    <div className="text-sm font-bold text-text-primary">{t.name}</div>
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
        <div className="bg-surface rounded-xl p-5 border border-border">
          <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-4">
            2. Assign Fee to Players
          </h3>
          {store.feeTemplates?.length === 0 ? (
            <div className="text-xs text-text-muted italic text-center p-6 border border-border border-dashed rounded-xl">
              Create a Fee on the left first
            </div>
          ) : (
            <form onSubmit={handleAssignFee} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 block">
                  Select Fee Template
                </label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value)}
                  className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-text-primary"
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
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 block">
                  Optional Description / Comment
                </label>
                <input
                  type="text"
                  placeholder="e.g. Size M, Green Color"
                  value={assignComment}
                  onChange={(e) => setAssignComment(e.target.value)}
                  className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-text-primary"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
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
                  className="w-full bg-surface-hover border border-border rounded-t-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-text-primary mb-0"
                />

                <div className="h-40 overflow-y-auto border border-t-0 border-border rounded-b-lg bg-surface-hover p-2 gap-1 flex flex-col hide-scrollbar">
                  {filteredPlayers.length === 0 && (
                    <div className="text-xs text-text-muted italic p-2 text-center">
                      No players found.
                    </div>
                  )}
                  {filteredPlayers.map((p) => (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition ${selectedPlayers.includes(p.id) ? "bg-accent/20 border border-accent/30 text-text-primary" : "hover:bg-surface-hover border border-transparent text-text-secondary"}`}
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
                className="w-full bg-accent text-text-accent font-bold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition shadow text-sm mt-2"
              >
                Assign to {selectedPlayers.length} Player(s)
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="bg-surface rounded-xl overflow-hidden border border-border mt-8">
        <div className="bg-surface-hover p-4 border-b border-border flex justify-between items-center flex-wrap gap-2">
          <h3 className="font-bold text-sm">Assigned Fees Ledger</h3>
          <div className="text-[10px] uppercase font-black text-text-secondary bg-surface-hover px-3 py-1 rounded-full border border-border">
            Total Due from Assigned Fees:{" "}
            <span className="text-red-400">
              ₹
              {store.otherFees
                ?.filter((f) => f.status === "Unpaid")
                .reduce((acc, f) => acc + (f.amount || 0), 0) || 0}
            </span>
          </div>
        </div>
        <div className="divide-y divide-border max-h-96 overflow-y-auto">
          {(!store.otherFees || store.otherFees.length === 0) && (
            <div className="p-6 text-center text-xs text-text-muted italic">
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
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-surface-hover transition gap-3"
                >
                  <div>
                    <div className="font-bold text-sm text-text-primary">
                      {fee.title}{" "}
                      <span className="text-text-muted font-normal ml-1">
                        for
                      </span>{" "}
                      {p?.name || "Unknown"}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {formatDate(
                        new Date(
                          (fee.createdAt?.seconds || 0) * 1000,
                        ).toISOString(),
                      )}{" "}
                      {fee.comment && (
                        <span className="ml-2 text-text-secondary">
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
                      {fee.status === "Unpaid" && p?.mobile && (
                        <button
                          onClick={async () => {
                            try {
                              const res = await authedFetch("/api/whatsapp/send", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  action: "due_reminder",
                                  playerId: p.id,
                                }),
                              });
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) {
                                throw new Error(data.error || "Failed to send WhatsApp reminder.");
                              }
                              toast("WhatsApp reminder sent successfully!", "success");
                            } catch (e: any) {
                              toast(`Failed: ${e.message || "Failed to send WhatsApp reminder."}`, "error");
                            }
                          }}
                          className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-bold text-[9px] uppercase tracking-widest px-2 py-1 rounded transition whitespace-nowrap cursor-pointer"
                        >
                          WA Remind
                        </button>
                      )}
                      {fee.status === "Unpaid" && p?.email && (
                        <button
                          onClick={async () => {
                            try {
                              const res = await authedFetch("/api/email/send", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  action: "due_reminder",
                                  playerId: p.id,
                                }),
                              });
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok || !data.success) {
                                throw new Error(data.error || "Failed to send email reminder.");
                              }
                              toast("Email reminder sent successfully!", "success");
                            } catch (e: any) {
                              toast(`Failed: ${e.message || "Failed to send email reminder."}`, "error");
                            }
                          }}
                          className="bg-accent/20 hover:bg-accent/30 text-accent font-bold text-[9px] uppercase tracking-widest px-2 py-1 rounded transition whitespace-nowrap cursor-pointer"
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
                        className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-surface-hover hover:bg-surface-hover text-text-secondary transition border border-border whitespace-nowrap"
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
      <div className="flex bg-surface-hover rounded-lg p-1 border border-border">
          <button
            onClick={() => setFeeTab("custom")}
            className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition ${feeTab === "custom" ? "bg-surface-hover text-text-primary" : "text-text-muted hover:text-text-primary"}`}
          >
            Custom Fees
          </button>
          <button
            onClick={() => setFeeTab("plans")}
            className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition ${feeTab === "plans" ? "bg-surface-hover text-text-primary" : "text-text-muted hover:text-text-primary"}`}
          >
            Subscriptions
          </button>
          <button
            onClick={() => setFeeTab("feePlans")}
            className={`flex-1 text-[11px] font-bold uppercase py-2 rounded-md transition ${feeTab === "feePlans" ? "bg-amber-500/20 text-amber-400" : "text-text-muted hover:text-text-primary"}`}
          >
            Finance Plans
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

function AdminFinanceView({
  store,
  defaultAction,
  isSuperAdmin,
  onNavigateToSettings,
}: {
  store: ReturnType<typeof useStore>;
  defaultAction?: string | null;
  isSuperAdmin?: boolean;
  onNavigateToSettings?: () => void;
}) {
  const { toast } = useToast();
  const { confirm: confirmAction } = useConfirm();
  type FinanceSubTab = "overview" | "matches" | "dues" | "razor" | "plans" | "fee" | "activity";
  const normalizeSubTab = (a?: string | null): FinanceSubTab => {
    if (a === "overview" || a === "matches" || a === "dues" || a === "razor" || a === "plans" || a === "fee" || a === "activity") {
      return a;
    }
    return "overview";
  };
  const [subTab, setSubTab] = useState<FinanceSubTab>(normalizeSubTab(defaultAction));
  // Follow quick actions / deep links while Finance is already open (D-19:
  // Reminders = "dues", Activity Log = "activity").
  useEffect(() => {
    if (defaultAction) {
      setSubTab(normalizeSubTab(defaultAction));
    }
  }, [defaultAction]);
  const [searchPlayer, setSearchPlayer] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterMatchId, setFilterMatchId] = useState("");
  const [editingMatchFeeId, setEditingMatchFeeId] = useState<string | null>(null);
  const [editFeeVal, setEditFeeVal] = useState<string>("");
  const [isSavingFee, setIsSavingFee] = useState(false);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [remindingMatchPlayerKey, setRemindingMatchPlayerKey] = useState<string | null>(null);
  const remindLockRef = useRef(false);
  const [profileSearch, setProfileSearch] = useState("");
  const [selectedProfilePlayerId, setSelectedProfilePlayerId] = useState<string | null>(null);

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

        return summarizeMatchFinance(match, paymentsForMatch, store.players);
      })
      .filter((d) => !searchPlayer || d.hasResults); // If searching, hide matches with no matches
  }, [filteredMatches, store.payments, store.players, searchPlayer]);

  const clubOverview = useMemo(
    () => summarizeClubFinanceOverview(reportData, isMatchBillable),
    [reportData],
  );
  const grandTotalCollected = clubOverview.actualCashReceived;
  const grandTotalDue = clubOverview.outstanding;
  const collectedMatches = clubOverview.includedMatches;

  const overviewExtras = useMemo(() => {
    const unpaidOtherFees = (store.otherFees || []).filter((f) => f.status === "Unpaid");
    const unpaidOtherFeesTotal = unpaidOtherFees.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const playersWithDues = new Set<string>();
    for (const f of unpaidOtherFees) {
      if (f.playerId) playersWithDues.add(f.playerId);
    }
    for (const d of collectedMatches) {
      if (!isMatchBillable(d.match)) continue;
      for (const p of d.payments) {
        if (p.status === "Unpaid") {
          playersWithDues.add(p.playerId);
        }
      }
    }
    const matchesWithDuesCount = collectedMatches.filter(
      (d) => isMatchBillable(d.match) && d.totalDue > 0,
    ).length;

    const studioMembers = (store.players || []).filter((p) => p.isStudioMember && !p.disabled);
    const todayIso = new Date().toISOString().slice(0, 10);
    const expiredStudioCount = studioMembers.filter((p) => {
      const exp = p.studioExpiryDate || p.studioEndDate;
      return !exp || exp < todayIso;
    }).length;

    return {
      unpaidOtherFeesTotal,
      totalActiveDues: grandTotalDue + unpaidOtherFeesTotal,
      playersWithDuesCount: playersWithDues.size,
      matchesWithDuesCount,
      activeStudioCount: Math.max(0, studioMembers.length - expiredStudioCount),
      expiredStudioCount,
    };
  }, [store.otherFees, store.players, collectedMatches, grandTotalDue]);

  const profileSearchResults = useMemo(() => {
    const q = profileSearch.trim().toLowerCase();
    if (!q) return [];
    return (store.players || [])
      .filter(
        (p) =>
          !p.disabled &&
          (p.name.toLowerCase().includes(q) ||
            (p.kavachId && p.kavachId.toLowerCase().includes(q)) ||
            (p.mobile && p.mobile.includes(q))),
      )
      .slice(0, 8);
  }, [store.players, profileSearch]);

  const selectedPlayerProfile = useMemo(() => {
    if (!selectedProfilePlayerId) return null;
    const pl = (store.players || []).find((p) => p.id === selectedProfilePlayerId);
    if (!pl) return null;
    return summarizePlayerFinancialProfile(
      pl,
      store.matches || [],
      store.payments || [],
      store.otherFees || [],
    );
  }, [selectedProfilePlayerId, store.players, store.matches, store.payments, store.otherFees]);

  const handleSendMatchPlayerReminder = async (matchId: string, playerId: string, playerName: string, amount: number) => {
    if (remindLockRef.current) return;
    const ok = await confirmAction({
      message: `Send WhatsApp payment reminder to ${playerName} for ₹${amount}?`,
    });
    if (!ok) return;
    remindLockRef.current = true;
    const key = `${matchId}:${playerId}`;
    setRemindingMatchPlayerKey(key);
    try {
      const res = await authedFetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "due_reminder", playerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to initiate reminder.");
      toast(`WhatsApp reminder initiated for ${playerName}.`, "success");
    } catch (err: any) {
      toast(err?.message || "Failed to initiate WhatsApp reminder.", "error");
    } finally {
      remindLockRef.current = false;
      setRemindingMatchPlayerKey(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-finance-workspace">
      <div
        role="tablist"
        aria-label="Finance sections"
        data-testid="finance-sub-tabs"
        className="flex flex-nowrap bg-surface-hover p-1.5 rounded-2xl border border-border mb-4 overflow-x-auto no-scrollbar gap-1.5"
      >
        {(
          [
            { key: "overview", label: "Overview" },
            { key: "matches", label: "Match Finance" },
            { key: "dues", label: "Player Dues" },
            { key: "razor", label: "Transactions" },
            { key: "plans", label: "Studio & Plans" },
            { key: "fee", label: "Fee Mgmt" },
            { key: "activity", label: "Activity Log" },
          ] as const
        ).map((tab) => {
          const active = subTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`finance-tab-${tab.key}`}
              onClick={() => setSubTab(tab.key)}
              className={`shrink-0 py-2 px-3 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all duration-200 text-center cursor-pointer whitespace-nowrap ${
                active
                  ? "bg-[#A30F2D] text-white font-extrabold shadow-[0_2px_8px_rgba(163,15,45,0.25)]"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {subTab === "overview" && (
        <div className="space-y-4" data-testid="finance-overview-section">
          <div className="bg-surface rounded-2xl p-4 sm:p-5 border border-border space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-text-primary">
                  Finance Overview
                </h2>
                <p className="text-xs text-text-secondary mt-0.5">
                  Authoritative club totals across {collectedMatches.length} match{collectedMatches.length === 1 ? "" : "es"}
                </p>
              </div>
              {isSuperAdmin && onNavigateToSettings && (
                <button
                  type="button"
                  onClick={onNavigateToSettings}
                  className="text-xs font-bold text-[#A30F2D] hover:underline cursor-pointer"
                >
                  Settings → Email Settings
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: "Total Collected", value: `₹${grandTotalCollected}`, sub: "Actual cash received", target: "razor" as FinanceSubTab, tone: "text-emerald-700" },
                { label: "Match Outstanding", value: `₹${grandTotalDue}`, sub: `${overviewExtras.matchesWithDuesCount} matches due`, target: "matches" as FinanceSubTab, tone: "text-rose-700" },
                { label: "Club Sponsored", value: `₹${clubOverview.sponsored}`, sub: "Plans & offsets", target: "matches" as FinanceSubTab, tone: "text-amber-700" },
                { label: "Sub Covered", value: `₹${clubOverview.subscriptionCovered}`, sub: "Monthly allocations", target: "plans" as FinanceSubTab, tone: "text-blue-700" },
                { label: "Total Active Dues", value: `₹${overviewExtras.totalActiveDues}`, sub: `Incl. ₹${overviewExtras.unpaidOtherFeesTotal} other fees`, target: "dues" as FinanceSubTab, tone: "text-[#A30F2D]" },
                { label: "Players with Dues", value: `${overviewExtras.playersWithDuesCount}`, sub: "Open balances", target: "dues" as FinanceSubTab, tone: "text-text-primary" },
                { label: "Matches with Dues", value: `${overviewExtras.matchesWithDuesCount}`, sub: "Pending collections", target: "matches" as FinanceSubTab, tone: "text-text-primary" },
                { label: "Studio Overview", value: `${overviewExtras.activeStudioCount} Active`, sub: `${overviewExtras.expiredStudioCount} expired`, target: "plans" as FinanceSubTab, tone: "text-text-primary" },
              ].map((card) => (
                <button
                  key={card.label}
                  type="button"
                  onClick={() => setSubTab(card.target)}
                  className="rounded-xl border border-border bg-surface-hover/60 p-3 text-left hover:border-[#A30F2D]/40 hover:bg-surface transition cursor-pointer"
                >
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                    {card.label}
                  </span>
                  <span className={`block text-lg font-black tabular-nums mt-1 ${card.tone}`}>
                    {card.value}
                  </span>
                  <span className="block text-[11px] text-text-muted mt-0.5 truncate">
                    {card.sub} →
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {subTab === "matches" && (
        <div className="space-y-4">
          {/* Club Finance Overview -> Match-wise -> Player-wise */}
          {(() => {
            const totalExpected = clubOverview.totalExpected;
            const totalSub = clubOverview.subscriptionCovered;
            const totalSponsored = clubOverview.sponsored;
            const cashPct = clubOverview.cashCollectionPct;
            const settledPct = clubOverview.settlementPct;
            return (
              <div
                data-testid="club-finance-overview"
                className="bg-surface rounded-xl p-4 border border-border space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-extrabold uppercase tracking-widest text-accent">
                      Club Finance Overview
                    </h3>
                    <p className="text-[11px] text-text-secondary">
                      Club totals across {collectedMatches.length} match{collectedMatches.length === 1 ? "" : "es"}
                      {cashPct !== null ? ` · ${cashPct}% cash · ${settledPct ?? 0}% settled` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="overview-to-player-dues"
                    onClick={() => setSubTab("dues")}
                    className="text-xs font-bold text-scarlet hover:underline cursor-pointer"
                  >
                    Player-wise Dues →
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                  <div className="bg-surface-hover p-2.5 rounded-lg">
                    <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Expected</div>
                    <div className="font-mono font-bold text-text-primary mt-0.5">₹{totalExpected}</div>
                  </div>
                  <div className="bg-surface-hover p-2.5 rounded-lg">
                    <div className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold">Actual Cash</div>
                    <div className="font-mono font-bold text-emerald-400 mt-0.5">₹{grandTotalCollected}</div>
                    {clubOverview.historicalAbandonedCash > 0 && (
                      <div className="text-[9px] text-text-muted mt-0.5">
                        incl. ₹{clubOverview.historicalAbandonedCash} historical (abandoned)
                      </div>
                    )}
                  </div>
                  <div className="bg-surface-hover p-2.5 rounded-lg">
                    <div className="text-[9px] uppercase tracking-wider text-blue-400 font-bold">Sub Covered</div>
                    <div className="font-mono font-bold text-blue-400 mt-0.5">₹{totalSub}</div>
                  </div>
                  <div className="bg-surface-hover p-2.5 rounded-lg">
                    <div className="text-[9px] uppercase tracking-wider text-amber-400 font-bold">Sponsored</div>
                    <div className="font-mono font-bold text-amber-400 mt-0.5">₹{totalSponsored}</div>
                  </div>
                  <div className="bg-surface-hover p-2.5 rounded-lg">
                    <div className="text-[9px] uppercase tracking-wider text-red-400 font-bold">Outstanding</div>
                    <div className="font-mono font-bold text-red-400 mt-0.5">₹{grandTotalDue}</div>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="bg-surface rounded-xl p-4 border border-border overflow-visible">
            <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-4">
              Match Fee Accounting
            </h3>
            {(() => {
              const showPct = collectedMatches.some((d) => d.matchFeeTotal > 0);
              return (
              <>
              {/* Mobile Match Fee Accounting Cards (< md, UX-P1-03) */}
              <div data-testid="mobile-finance-cards" className="md:hidden space-y-3">
                {collectedMatches.map((data) => {
                  const ground = store.grounds.find((g) => g.id === data.match.groundId);
                  return (
                    <div
                      key={data.match.id}
                      className="bg-surface rounded-xl p-3.5 border border-border space-y-2.5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-text-primary font-bold text-xs">
                            {formatDate(data.match.date)}
                          </div>
                          <div className="text-[10px] text-text-muted mt-0.5">
                            {ground?.name || "Ground TBD"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-[11px]">
                          <span className="text-emerald-400 font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                            {data.paidCount} Paid
                          </span>
                          <span className={`font-bold px-1.5 py-0.5 rounded ${
                            data.unpaidCount > 0
                              ? "text-red-400 bg-red-500/10 border border-red-500/20"
                              : "text-text-muted bg-surface-hover"
                          }`}>
                            {data.unpaidCount} Due
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border text-center text-xs">
                        <div className="bg-surface-hover p-2 rounded-lg">
                          <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">Expected</div>
                          <div className="font-mono font-bold text-text-primary mt-0.5">₹{data.matchFeeTotal}</div>
                        </div>
                        <div className="bg-surface-hover p-2 rounded-lg">
                          <div className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold">Cash Recv</div>
                          <div className="font-mono font-bold text-emerald-400 mt-0.5">₹{data.feeCollected}</div>
                        </div>
                        <div className="bg-surface-hover p-2 rounded-lg">
                          <div className="text-[9px] uppercase tracking-wider text-blue-400 font-bold">Sub Covered</div>
                          <div className="font-mono font-bold text-blue-400 mt-0.5">₹{data.subscriptionCovered}</div>
                        </div>
                        <div className="bg-surface-hover p-2 rounded-lg">
                          <div className="text-[9px] uppercase tracking-wider text-amber-400 font-bold">Sponsored</div>
                          <div className="font-mono font-bold text-amber-400 mt-0.5">₹{data.feeOffset}</div>
                        </div>
                      </div>

                      {data.cashCollectionPct !== null && (
                        <div className="pt-1 space-y-1">
                          <div className="flex justify-between text-[10px] font-bold">
                            <span className="text-text-muted uppercase tracking-wider">Settlement / Cash %</span>
                            <span className={data.cashCollectionPct >= 80 ? "text-emerald-400" : data.cashCollectionPct >= 50 ? "text-amber-400" : "text-red-400"}>
                              {data.settlementPct ?? 0}% settled · {data.cashCollectionPct}% cash
                            </span>
                          </div>
                          <div className="w-full bg-surface-hover rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${data.cashCollectionPct >= 80 ? "bg-emerald-500" : data.cashCollectionPct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                              style={{ width: `${Math.min(100, Math.max(0, data.cashCollectionPct))}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="pt-2 border-t border-border flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-text-muted">
                          Actual fee: <strong className="text-text-primary">{data.actualFeePaid != null ? `₹${data.actualFeePaid}` : "Not set"}</strong>
                          {" · "}Out: <strong className="text-rose-600">₹{data.totalDue}</strong>
                        </span>
                        <button
                          type="button"
                          data-testid={`expand-match-finance-${data.match.id}`}
                          onClick={() =>
                            setExpandedMatchId((cur) => (cur === data.match.id ? null : data.match.id))
                          }
                          className="font-bold text-[#A30F2D] hover:underline cursor-pointer"
                        >
                          {expandedMatchId === data.match.id ? "Hide Details" : "View Players"}
                        </button>
                      </div>

                      {expandedMatchId === data.match.id && (() => {
                        const part = partitionMatchFinancePlayers(data.match, data.payments, store.players);
                        return (
                          <div className="pt-2 border-t border-border space-y-2.5 text-xs" data-testid={`match-finance-details-${data.match.id}`}>
                            <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
                              <div className="rounded bg-surface-hover p-1.5">
                                <span className="block text-text-muted">Paid</span>
                                <strong className="text-emerald-700">{part.paid.length}</strong>
                              </div>
                              <div className="rounded bg-surface-hover p-1.5">
                                <span className="block text-text-muted">Unpaid</span>
                                <strong className="text-rose-700">{part.unpaid.length}</strong>
                              </div>
                              <div className="rounded bg-surface-hover p-1.5">
                                <span className="block text-text-muted">Sponsored</span>
                                <strong className="text-amber-700">{part.sponsored.length}</strong>
                              </div>
                            </div>
                            {part.unpaid.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold uppercase text-rose-700">Unpaid ({part.unpaid.length})</p>
                                {part.unpaid.map((u) => (
                                  <div key={u.paymentId} className="flex items-center justify-between gap-2 rounded-lg bg-rose-50/70 px-2 py-1.5">
                                    <span className="truncate font-semibold text-text-primary">{u.name} · {u.dueStatus}</span>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <span className="font-mono font-bold text-rose-700">₹{u.due}</span>
                                      <button
                                        type="button"
                                        disabled={remindingMatchPlayerKey === `${data.match.id}:${u.playerId}`}
                                        onClick={() => handleSendMatchPlayerReminder(data.match.id, u.playerId, u.name, u.due)}
                                        className="px-2 py-0.5 rounded bg-[#A30F2D] text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                                      >
                                        Remind
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {part.paid.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold uppercase text-emerald-700">Paid ({part.paid.length})</p>
                                {part.paid.map((p) => (
                                  <div key={p.paymentId} className="flex items-center justify-between gap-2 rounded-lg bg-surface-hover px-2 py-1">
                                    <span className="truncate text-text-primary">{p.name}</span>
                                    <span className="font-mono text-text-secondary shrink-0">₹{p.amount} · {p.method}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {part.sponsored.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold uppercase text-amber-700">Sponsored ({part.sponsored.length})</p>
                                {part.sponsored.map((s) => (
                                  <div key={s.paymentId} className="flex items-center justify-between gap-2 rounded-lg bg-amber-50/70 px-2 py-1">
                                    <span className="truncate text-text-primary">{s.name} ({s.details})</span>
                                    <span className="font-mono font-bold text-amber-700 shrink-0">₹{s.amount}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table (>= md) */}
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-widest text-text-muted">
                    <th className="py-2 pr-3 font-bold whitespace-nowrap">Match Details</th>
                    <th className="py-2 px-3 font-bold whitespace-nowrap text-center">Paid / Unpaid</th>
                    <th className="py-2 px-3 font-bold whitespace-nowrap text-right">Expected</th>
                    <th className="py-2 px-3 font-bold whitespace-nowrap text-right">Cash Received</th>
                    <th className="py-2 px-3 font-bold whitespace-nowrap text-right">Sub Covered</th>
                    <th className="py-2 px-3 font-bold whitespace-nowrap text-right">Sponsored</th>
                    {showPct && <th className="py-2 pl-3 font-bold whitespace-nowrap text-right">Settled / Cash %</th>}
                  </tr>
                </thead>
                <tbody>
                  {collectedMatches.map((data, rowIndex) => {
                    const ground = store.grounds.find((g) => g.id === data.match.groundId);
                    return (
                      <tr key={data.match.id} className="border-b border-border hover:bg-surface-hover transition">
                        <td className="py-2.5 pr-3">
                          <div className="text-text-primary font-semibold text-xs">{formatDate(data.match.date)}</div>
                          <div className="text-[10px] text-text-muted">{ground?.name || "—"}</div>
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap relative group">
                          <div className="inline-flex items-center gap-1.5 cursor-help px-2 py-0.5 rounded bg-surface-hover border border-border hover:bg-surface-hover transition">
                            <span className="text-emerald-400 font-bold font-mono text-xs">{data.paidCount} Paid</span>
                            <span className="text-text-primary/30">/</span>
                            <span className={`font-bold font-mono text-xs ${data.unpaidCount > 0 ? "text-red-400" : "text-text-muted"}`}>
                              {data.unpaidCount} Unpaid
                            </span>
                            <Info className="w-3 h-3 text-text-muted group-hover:text-text-primary transition shrink-0" />
                          </div>

                          {/* Desktop Hover Tooltip */}
                          <div
                            className={`hidden group-hover:block absolute left-1/2 -translate-x-1/2 ${
                              rowIndex < 2 ? "top-full mt-2 before:-top-3" : "bottom-full mb-2 before:-bottom-3"
                            } z-50 w-72 max-h-[380px] bg-surface/95 border border-border rounded-xl p-3 shadow-2xl backdrop-blur-xl pointer-events-auto text-left animate-in fade-in duration-150 before:content-[''] before:absolute before:left-0 before:right-0 before:h-3`}
                          >
                            <div className="flex items-center justify-between border-b border-border pb-1.5 mb-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-text-primary">
                                Squad Payment Status
                              </span>
                              <span className="text-[10px] font-mono text-text-secondary bg-surface-hover px-1.5 py-0.5 rounded border border-border">
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
                                          <span className="truncate text-text-primary font-medium">{item.name}</span>
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
                              <div className="border-t border-border" />

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
                                        className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded bg-surface-hover border border-border hover:bg-surface-hover transition"
                                      >
                                        <div className="truncate flex items-center gap-1.5 min-w-0">
                                          <span className="text-emerald-400 text-[10px] shrink-0">✓</span>
                                          <span className="truncate text-text-primary">{item.name}</span>
                                        </div>
                                        <div className="shrink-0 flex items-center gap-1.5 text-[9px] font-mono">
                                          <span className="text-text-secondary">₹{item.amount}</span>
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
                                  <div className="text-[10px] text-text-muted italic py-1 px-2">No payments received yet</div>
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
                                  toast(err?.message || "Failed to update match fee.", "error");
                                } finally {
                                  setIsSavingFee(false);
                                }
                              }}
                              className="inline-flex items-center gap-1 justify-end"
                            >
                              <span className="text-text-muted text-xs">₹</span>
                              <input
                                type="number"
                                min="0"
                                value={editFeeVal}
                                onChange={(e) => setEditFeeVal(e.target.value)}
                                className="w-20 bg-black/80 border border-accent rounded px-1.5 py-0.5 text-xs text-text-primary text-right font-mono font-bold focus:outline-none"
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
                                className="p-1 hover:bg-surface-hover text-text-muted hover:text-text-primary rounded transition text-xs font-bold"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </form>
                          ) : (
                            <div className="text-right">
                              <div className="text-text-primary font-bold font-mono text-xs">₹{data.matchFeeTotal}</div>
                              <div className="text-[10px] text-text-muted mt-0.5 font-mono">
                                {data.paidCount + data.unpaidCount} eligible · ₹{data.totalDue} due
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="text-emerald-400 font-semibold font-mono">₹{data.feeCollected}</div>
                          <div className="text-[10px] text-text-muted">({data.feeCollectedCount})</div>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="text-blue-400 font-semibold font-mono">₹{data.subscriptionCovered}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap relative group">
                          <div className="text-amber-400 font-semibold font-mono inline-flex items-center gap-1 cursor-help">
                            <span>₹{data.feeOffset}</span>
                            {data.sponsoredDetails.length > 0 && (
                              <Info className="w-3 h-3 text-amber-400/60 group-hover:text-amber-300 transition shrink-0" />
                            )}
                          </div>
                          <div className="text-[10px] text-text-muted">({data.feeOffsetCount})</div>

                          {/* Desktop Hover Tooltip */}
                          {data.sponsoredDetails.length > 0 && (
                            <div className={`hidden group-hover:block absolute right-0 ${rowIndex < 2 ? "top-full mt-2 before:-top-3" : "bottom-full mb-2 before:-bottom-3"} z-50 w-64 bg-surface/95 border border-amber-500/30 rounded-xl p-3 shadow-2xl backdrop-blur-xl pointer-events-auto text-left animate-in fade-in duration-150 before:content-[''] before:absolute before:left-0 before:right-0 before:h-3`}>
                              <div className="flex items-center justify-between border-b border-amber-500/20 pb-1.5 mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                                  Club Sponsored
                                </span>
                                <span className="text-[10px] font-mono font-bold text-text-primary">
                                  Total: ₹{data.feeOffset}
                                </span>
                              </div>
                              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                                {data.sponsoredDetails.map((detail, idx) => (
                                  <div key={idx} className="flex items-center justify-between text-xs py-0.5 border-b border-border last:border-0">
                                    <div className="truncate pr-2">
                                      <span className="text-text-primary font-medium block truncate">
                                        {detail.playerName}
                                      </span>
                                      <span className="text-[9px] text-text-muted block truncate">
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
                            {data.cashCollectionPct !== null ? (
                              <div className="space-y-0.5">
                                <div className={`font-bold ${data.cashCollectionPct >= 80 ? "text-emerald-400" : data.cashCollectionPct >= 50 ? "text-amber-400" : "text-red-400"}`}>
                                  {data.cashCollectionPct}% cash
                                </div>
                                <div className="text-[10px] text-text-muted">
                                  {data.settlementPct ?? 0}% settled
                                </div>
                              </div>
                            ) : (
                              <span className="text-text-primary/30">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {collectedMatches.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-border">
                      <td className="py-2.5 pr-3 font-bold text-text-primary text-xs uppercase tracking-wider">Total</td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap font-mono text-xs">
                        <span className="text-emerald-400 font-bold">{collectedMatches.reduce((s, d) => s + d.paidCount, 0)} Paid</span>
                        <span className="text-text-primary/30 mx-1">/</span>
                        <span className="text-red-400 font-bold">{collectedMatches.reduce((s, d) => s + d.unpaidCount, 0)} Unpaid</span>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="text-text-primary font-bold font-mono">₹{collectedMatches.reduce((s, d) => s + d.matchFeeTotal, 0)}</div>
                        <div className="text-[10px] text-text-muted font-mono">{collectedMatches.length} matches</div>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="text-emerald-400 font-bold font-mono">₹{collectedMatches.reduce((s, d) => s + d.feeCollected, 0)}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="text-blue-400 font-bold font-mono">₹{collectedMatches.reduce((s, d) => s + d.subscriptionCovered, 0)}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="text-amber-400 font-bold font-mono">₹{collectedMatches.reduce((s, d) => s + d.feeOffset, 0)}</div>
                      </td>
                      {showPct && (
                        <td className="py-2.5 pl-3 text-right whitespace-nowrap font-mono">
                          {(() => {
                            const totalExpected = collectedMatches.reduce((s, d) => s + d.matchFeeTotal, 0);
                            const totalCash = collectedMatches.reduce((s, d) => s + d.feeCollected, 0);
                            const totalSub = collectedMatches.reduce((s, d) => s + d.subscriptionCovered, 0);
                            if (totalExpected <= 0) return <span className="text-text-primary/30">—</span>;
                            const cashPct = Math.round((totalCash * 10000) / totalExpected) / 100;
                            const settledPct = Math.round(((totalCash + totalSub) * 10000) / totalExpected) / 100;
                            return (
                              <div>
                                <div className={`font-bold ${cashPct >= 80 ? "text-emerald-400" : cashPct >= 50 ? "text-amber-400" : "text-red-400"}`}>{cashPct}% cash</div>
                                <div className="text-[10px] text-text-muted">{settledPct}% settled</div>
                              </div>
                            );
                          })()}
                        </td>
                      )}
                    </tr>
                  </tfoot>
                )}
              </table>
              </div>

              {collectedMatches.length === 0 && (
                <div
                  data-testid="empty-finance-collections"
                  className="text-center py-10 px-4 bg-surface rounded-xl border border-border border-dashed space-y-2 mt-2"
                >
                  <div className="w-10 h-10 rounded-full bg-brand/10 text-brand flex items-center justify-center mx-auto">
                    <Shield className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold uppercase tracking-wider text-text-primary">
                    No Match Collections Found
                  </p>
                  <p className="text-[11px] text-text-muted max-w-xs mx-auto">
                    Try adjusting your date range or player search above to see accounting records.
                  </p>
                </div>
              )}
              </>
              );
            })()}
          </div>
        </div>
      )}

      {subTab === "dues" && (
        <div className="space-y-4">
          <div className="bg-surface rounded-2xl border border-border p-4 space-y-3" data-testid="player-financial-profile-lookup">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-text-primary">
                  Player Financial Profile
                </h3>
                <p className="text-[11px] text-text-secondary">
                  Search by name, KAvach ID, or mobile to inspect full match &amp; fee history
                </p>
              </div>
              {selectedPlayerProfile && (
                <button
                  type="button"
                  onClick={() => setSelectedProfilePlayerId(null)}
                  className="text-xs font-bold text-[#A30F2D] hover:underline cursor-pointer"
                >
                  Clear Selection
                </button>
              )}
            </div>
            <input
              type="text"
              value={profileSearch}
              onChange={(e) => setProfileSearch(e.target.value)}
              placeholder="Search player name, KAvach ID, or mobile..."
              data-testid="player-finance-search-input"
              className="w-full rounded-xl border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-[#A30F2D]"
            />
            {profileSearchResults.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {profileSearchResults.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => {
                      setSelectedProfilePlayerId(pl.id);
                      setProfileSearch("");
                    }}
                    className="px-2.5 py-1 rounded-lg border border-border bg-surface-hover text-xs font-bold text-text-primary hover:border-[#A30F2D] cursor-pointer"
                  >
                    {pl.name} {pl.kavachId ? `(${pl.kavachId})` : ""}
                  </button>
                ))}
              </div>
            )}
            {selectedPlayerProfile && (
              <div className="rounded-xl border border-border bg-surface-hover/50 p-3.5 space-y-3" data-testid="player-financial-profile-card">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-text-primary">{selectedPlayerProfile.player.name}</p>
                    <p className="text-[11px] text-text-secondary">
                      {selectedPlayerProfile.player.kavachId || selectedPlayerProfile.player.id}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] font-bold uppercase text-text-muted">Total Outstanding</span>
                    <span className="text-base font-black text-rose-700 tabular-nums">
                      ₹{selectedPlayerProfile.totalOutstanding}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-center">
                  <div className="rounded-lg bg-surface p-2 border border-border">
                    <span className="block text-[10px] text-text-muted">Match Paid</span>
                    <strong className="text-emerald-700 tabular-nums">₹{selectedPlayerProfile.totalPaidMatches}</strong>
                  </div>
                  <div className="rounded-lg bg-surface p-2 border border-border">
                    <span className="block text-[10px] text-text-muted">Sponsored</span>
                    <strong className="text-amber-700 tabular-nums">₹{selectedPlayerProfile.totalSponsored}</strong>
                  </div>
                  <div className="rounded-lg bg-surface p-2 border border-border">
                    <span className="block text-[10px] text-text-muted">Sub Covered</span>
                    <strong className="text-blue-700 tabular-nums">₹{selectedPlayerProfile.totalSubscriptionCovered}</strong>
                  </div>
                  <div className="rounded-lg bg-surface p-2 border border-border">
                    <span className="block text-[10px] text-text-muted">Other Fees Due</span>
                    <strong className="text-rose-700 tabular-nums">₹{selectedPlayerProfile.otherFeesOutstanding}</strong>
                  </div>
                </div>
                {selectedPlayerProfile.matchEntries.length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {selectedPlayerProfile.matchEntries.slice(0, 6).map((me) => (
                      <div key={me.matchId} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-surface border border-border/60">
                        <span className="truncate">{me.date} · vs {me.opponent}</span>
                        <span className="font-mono text-[11px] shrink-0">
                          {me.statusLabel} {me.outstanding > 0 ? `(₹${me.outstanding} due)` : me.paid > 0 ? `(₹${me.paid})` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DuesAndRemindersTab
            store={store}
            isFinanceAdmin={true}
            isSuperAdmin={isSuperAdmin}
            onNavigateToSettings={onNavigateToSettings}
          />
        </div>
      )}
      {subTab === "razor" && <RazorReportView store={store} />}

      {subTab === "plans" && (
        <div className="space-y-6" data-testid="finance-studio-plans-section">
          <div className="bg-surface rounded-2xl border border-border p-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-text-primary">
                Studio Subscriptions Overview
              </h3>
              <p className="text-xs text-text-secondary">
                {overviewExtras.activeStudioCount} active · {overviewExtras.expiredStudioCount} expired
              </p>
            </div>
          </div>
          <PlansView store={store} />
          <FeePlansAdmin store={store} />
        </div>
      )}

      {subTab === "fee" && <CreateFeeAdmin store={store} />}

      {/* D-19: the Activity Log (audit trail) moved here from Club. Purge controls
          stay Super Admin only; reading is enforced by Firestore rules. */}
      {subTab === "activity" && <AuditLogTab isSuperAdmin={!!isSuperAdmin} />}

    </div>
  );
}
