import { useState } from "react";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "./AuthProvider";
import { MessageSquare } from "lucide-react";
import { formatDate, dbToInputDate, computeLateFees } from "@/lib/utils";

export function AssignFeesAdmin({
  store,
  isSuperAdmin,
}: {
  store: ReturnType<typeof useStore>;
  isSuperAdmin?: boolean;
}) {
  const { user } = useAuth();
  const adminName = store.appUsers.find((u) => u.id === user?.uid)?.name || "Admin";
  const [feeType, setFeeType] = useState<"match" | "other">("match");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedMatch, setSelectedMatch] = useState<string>("");
  const [assignComment, setAssignComment] = useState("");
  const [searchPlayer, setSearchPlayer] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  // Only active, verified players can be charged. Trashed (disabled),
  // Rejected, and still-Pending signups are hidden so admins don't
  // accidentally assign a match fee to someone who can never pay it.
  const chargeableStatus = (p: (typeof store.players)[number]) => {
    if (p.disabled) return false;
    if (p.inviteStatus === "Rejected" || p.inviteStatus === "Pending") return false;
    return true;
  };

  const filteredPlayers = store.players.filter(chargeableStatus).filter(
    (p) =>
      !searchPlayer ||
      p.name.toLowerCase().includes(searchPlayer.toLowerCase()) ||
      p.mobile?.includes(searchPlayer),
  );

  const getMatchDateObj = (dateStr: any) => {
    if (!dateStr) return new Date();
    try {
      if (typeof dateStr === "object" && typeof dateStr.toDate === "function") {
        return dateStr.toDate();
      }
      if (typeof dateStr === "object" && dateStr.seconds) {
        return new Date(dateStr.seconds * 1000);
      }
      if (dateStr instanceof Date) {
        return dateStr;
      }

      const str = String(dateStr);
      // Check if it's already YYYY-MM-DD or DD-MM-YYYY
      if (str.includes("-")) {
        const parts = str.split("-");
        if (parts.length === 3) {
          if (parts[0].length === 4) {
            return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          } else if (parts[2].length === 4 || parts[2].includes("T")) {
            return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
          }
        }
      }
      
      // Check if it's DD/MM/YYYY or YYYY/MM/DD
      if (str.includes("/")) {
        const parts = str.split("/");
        if (parts.length === 3) {
          if (parts[2].length === 4) {
            return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
          } else if (parts[0].length === 4) {
            return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          }
        }
      }

      return new Date(str);
    } catch {
      return new Date();
    }
  };

  const activeMatches = [...store.matches]
    .filter((m) => !m.isArchived)
    .sort((a, b) => {
        const dateA = getMatchDateObj(a.date).getTime();
        const dateB = getMatchDateObj(b.date).getTime();
        return dateB - dateA;
    });

  const getDayDifference = (matchDateString: any) => {
    if (!matchDateString) return Infinity;
    const matchDate = getMatchDateObj(matchDateString);
    if (isNaN(matchDate.getTime())) return Infinity;
    
    const now = new Date();
    matchDate.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    const diffTime = matchDate.getTime() - now.getTime();
    return Math.round(diffTime / (1000 * 3600 * 24));
  };

  const relevantMatches = activeMatches.filter(m => {
    const diff = getDayDifference(m.date);
    return diff >= -7 && diff <= 7;
  });

  const moreMatches = activeMatches.filter(m => {
    const diff = getDayDifference(m.date);
    return (diff >= -30 && diff <= 30) && !(diff >= -7 && diff <= 7);
  });

  const otherMatches = activeMatches.filter(m => {
    const diff = getDayDifference(m.date);
    return diff < -30 || diff > 30;
  });

  const handleAssignFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPlayers.length === 0) return;

    try {
      if (feeType === "other") {
        if (!selectedTemplate) return;
        const template = store.feeTemplates.find(
          (t) => t.id === selectedTemplate,
        );
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
      } else {
        if (!selectedMatch) return;

        const paymentsForMatch = store.payments.filter(
          (p) => p.matchId === selectedMatch,
        );
        const match = store.matches.find((m) => m.id === selectedMatch);
        if (!match) return;

        const duplicateIds = selectedPlayers.filter((pid) => paymentsForMatch.some((mp) => mp.playerId === pid && mp.status !== "Not Playing"));
        if (duplicateIds.length > 0 && !confirmDuplicates) {
          setConfirmDuplicates(true);
          return;
        }

        for (const pId of selectedPlayers) {
          const existingPayments = paymentsForMatch.filter(
            (p) => p.playerId === pId && p.status !== "Not Playing"
          );
          if (existingPayments.length > 0) {
            const hostPlayer = store.players.find(p => p.id === pId);
            await store.addPaymentStatus(match.id, pId, "Unpaid", "Confirmed", `Guest of ${hostPlayer?.name || 'Player'}`);
          } else {
            const notPlayingPayment = paymentsForMatch.find(
              (p) => p.playerId === pId && p.status === "Not Playing",
            );
            if (notPlayingPayment) {
              await store.updatePaymentStatus(
                notPlayingPayment.id,
                "Unpaid",
                match.id,
                "Confirmed"
              );
            } else {
              await store.addPaymentStatus(match.id, pId, "Unpaid", "Confirmed");
            }
          }
        }
      }

      setSelectedPlayers([]);
      setAssignComment("");
      setSearchPlayer("");
      setConfirmDuplicates(false);
      setSuccessMessage("Fees assigned successfully!");
      setTimeout(() => setSuccessMessage(""), 3000);
      // No alert
    } catch (err) {
      console.error("Error assigning fees:", err);
    }
  };

  const togglePlayer = (id: string) => {
    setSelectedPlayers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass rounded-xl p-5 border border-glass-border">
          <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-4">
            Assign Fee to Players
          </h3>

          <form onSubmit={handleAssignFee} className="space-y-4">
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setFeeType("other")}
                className={`flex-1 py-1.5 rounded-md text-[11px] font-bold uppercase transition ${feeType === "other" ? "bg-accent/20 text-accent border border-accent/50" : "bg-white/5 text-white/50 hover:bg-white/10"}`}
              >
                Other Fee
              </button>
              <button
                type="button"
                onClick={() => setFeeType("match")}
                className={`flex-1 py-1.5 rounded-md text-[11px] font-bold uppercase transition ${feeType === "match" ? "bg-accent/20 text-accent border border-accent/50" : "bg-white/5 text-white/50 hover:bg-white/10"}`}
              >
                Match Fee
              </button>
            </div>

            {feeType === "other" && (
              <>
                {!store.feeTemplates || store.feeTemplates.length === 0 ? (
                  <div className="text-xs text-white/50 italic text-center p-6 border border-glass-border border-dashed rounded-xl">
                    Create a Custom Fee on the "Create Fee" tab first
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 block">
                      Select Fee Template
                    </label>
                    <select
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                      className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-emerald-950"
                      required={feeType === "other"}
                    >
                      <option value="">-- Choose a Fee --</option>
                      {store.feeTemplates?.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} (₹{t.amount})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
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
              </>
            )}

            {feeType === "match" && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1 flex justify-between items-center">
                  <span>Select Match</span>
                </label>
                <select
                  value={selectedMatch}
                  onChange={(e) => setSelectedMatch(e.target.value)}
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-emerald-950 [&>optgroup]:bg-emerald-900"
                  required={feeType === "match"}
                >
                  <option value="">-- Choose a Match --</option>
                  
                  <optgroup label="Relevant Matches (+/- 7 Days)">
                    {relevantMatches.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.opponent} (₹{m.fee}) - {formatDate(m.date)}
                      </option>
                    ))}
                    {relevantMatches.length === 0 && (
                      <option disabled>No relevant matches found.</option>
                    )}
                  </optgroup>

                  <optgroup label="More (+/- 30 Days)">
                    {moreMatches.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.opponent} (₹{m.fee}) - {formatDate(m.date)}
                      </option>
                    ))}
                    {moreMatches.length === 0 && (
                      <option disabled>No matches found in this range.</option>
                    )}
                  </optgroup>

                  <optgroup label="Other Matches">
                    {otherMatches.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.opponent} (₹{m.fee}) - {formatDate(m.date)}
                      </option>
                    ))}
                    {otherMatches.length === 0 && (
                      <option disabled>No other matches found.</option>
                    )}
                  </optgroup>
                </select>
              </div>
            )}

            {(feeType === "match" ||
              (feeType === "other" && store.feeTemplates?.length > 0)) && (
              <>
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

                {successMessage && (
                  <div className="bg-emerald-500/20 text-emerald-400 text-xs text-center p-2 rounded border border-emerald-500/40">
                    {successMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    (feeType === "other" && !selectedTemplate) ||
                    (feeType === "match" && !selectedMatch) ||
                    selectedPlayers.length === 0
                  }
                  className={`w-full ${confirmDuplicates ? "bg-red-500 text-white" : "bg-accent text-black"} font-bold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition shadow text-sm mt-2`}
                >
                  {confirmDuplicates ? "Confirm Duplicate Assignment" : `Assign to ${selectedPlayers.length} Player(s)`}
                </button>
              </>
            )}
          </form>
        </div>

        {/* Assigned Fees Ledger (only show for Other Fees) */}
        {feeType === "other" && (
          <div className="glass rounded-xl overflow-hidden border border-glass-border flex flex-col max-h-[600px]">
            <div className="bg-black/40 p-4 border-b border-glass-border flex justify-between items-center flex-wrap gap-2">
              <h3 className="font-bold text-[12px] uppercase tracking-widest text-accent">
                Assigned Fees Ledger
              </h3>
              <div className="text-[10px] uppercase font-black text-white/60 bg-white/5 px-3 py-1 rounded-full border border-white/5">
                Due:{" "}
                <span className="text-red-400">
                  ₹
                  {store.otherFees
                    ?.filter((f) => f.status === "Unpaid")
                    .reduce((acc, f) => acc + (f.amount || 0), 0) || 0}
                </span>
              </div>
            </div>
            <div className="divide-y divide-glass-border/50 overflow-y-auto">
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
                        <div className="font-bold text-sm text-white flex items-center gap-2 flex-wrap">
                          <span>{fee.title}</span>
                          {fee.templateId?.startsWith("latefee_") && (
                            <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded text-[8px] uppercase font-black tracking-widest">
                              Late Fee
                            </span>
                          )}
                          <span className="text-white/40 font-normal">
                            for
                          </span>
                          <span>{p?.name || "Unknown"}</span>
                        </div>
                        <div className="text-[10px] text-white/40 mt-0.5">
                          {fee.createdAt?.seconds
                            ? formatDate(
                                new Date(
                                  fee.createdAt.seconds * 1000,
                                ).toISOString(),
                              )
                            : ""}{" "}
                          {fee.comment && (
                            <span className="ml-2 text-white/60">
                              ({fee.comment})
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-black font-mono ${isPaid ? "text-emerald-400" : "text-red-400"}`}
                        >
                          ₹{fee.amount}
                        </span>

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
                        {(isSuperAdmin || !fee.templateId?.startsWith("latefee_")) && (
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  fee.templateId?.startsWith("latefee_")
                                    ? "This is an auto-levied late fee penalty. Are you sure you want to delete it?"
                                    : "Are you sure you want to delete this fee?",
                                )
                              ) {
                                store.deleteOtherFee(fee.playerId, fee.id, adminName);
                              }
                            }}
                            className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 transition border border-red-500/20 whitespace-nowrap"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {feeType === "match" && (
          <div className="glass rounded-xl overflow-hidden border border-glass-border flex flex-col max-h-[600px]">
            <div className="bg-black/40 p-4 border-b border-glass-border flex justify-between items-center flex-wrap gap-2">
              <h3 className="font-bold text-[12px] uppercase tracking-widest text-accent">
                {selectedMatch ? "Match Fees Ledger" : "All Unpaid Match Fees"}
              </h3>
              <div className="text-[10px] uppercase font-black text-white/60 bg-white/5 px-3 py-1 rounded-full border border-white/5">
                Due:{" "}
                <span className="text-red-400">
                  ₹
                  {store.payments
                    .filter(p => p.status === "Unpaid" && (selectedMatch ? p.matchId === selectedMatch : true))
                    .reduce((acc, p) => acc + (store.matches.find(m => m.id === p.matchId)?.fee || 0), 0)
                  }
                </span>
              </div>
            </div>
            <div className="divide-y divide-glass-border/50 overflow-y-auto">
              {(() => {
                const unpaid = store.payments.filter(p => p.status === "Unpaid" && (selectedMatch ? p.matchId === selectedMatch : true));
                if (unpaid.length === 0) {
                  return (
                    <div className="p-6 text-center text-xs text-white/40 italic">
                      No unpaid match fees found.
                    </div>
                  );
                }
                
                // Group by match
                const grouped = unpaid.reduce((acc, p) => {
                  if (!acc[p.matchId]) acc[p.matchId] = [];
                  acc[p.matchId].push(p);
                  return acc;
                }, {} as Record<string, typeof unpaid>);

                return Object.entries(grouped).map(([matchId, payments]) => {
                  const match = store.matches.find(m => m.id === matchId);
                  if (!match) return null;
                  return (
                    <div key={matchId} className="p-4 bg-white/5/30">
                      <div className="font-bold text-[11px] uppercase tracking-wider text-accent mb-2">
                        {match.opponent} ({formatDate(match.date)}) - Fee: ₹{match.fee}
                      </div>
                      <div className="space-y-2">
                        {payments.map(fee => {
                          const p = store.players.find((x) => x.id === fee.playerId);
                          return (
                            <div key={fee.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-2 rounded hover:bg-white/5 transition border border-transparent hover:border-glass-border gap-2">
                              <div>
                                <div className="font-medium text-sm text-white">
                                  {fee.guestName || p?.name || "Unknown"}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-black font-mono text-red-400">₹{match.fee}</span>

                                <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border text-red-400 border-red-400/30 bg-red-400/10`}>
                                  Unpaid
                                </span>
                                <button
                                  onClick={async () => {
                                    await store.updatePaymentStatus(fee.id, "Paid", match.id, fee.availability || "Confirmed", "manual");
                                    const exempted = store.otherFees.some(
                                      (f: any) =>
                                        f.playerId === fee.playerId &&
                                        f.title?.startsWith("Late Fee Exemption:") &&
                                        f.title?.includes(match.id) &&
                                        f.status !== "Cancelled",
                                    );
                                    if (!exempted) {
                                      const mLabel = `vs ${match.opponent || match.title || "Match"} (${formatDate(match.date)})`;
                                      const fees = computeLateFees(match.date, match.id, fee.playerId, mLabel);
                                      for (const lf of fees) {
                                        const feeId = await store.addOtherFee(fee.playerId, {
                                          title: lf.label,
                                          amount: lf.amount,
                                          comment: "Auto-levied late fee penalty (admin marked paid)",
                                          templateId: `latefee_${match.id}`,
                                        });
                                        if (feeId) await store.updateOtherFeeStatus(fee.playerId, feeId, "Paid", "manual");
                                      }
                                    }
                                  }}
                                  className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white/70 transition border border-white/10 whitespace-nowrap"
                                >
                                  Mark Paid
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
