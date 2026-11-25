import { useState, useMemo } from "react";
import { useStore } from "@/hooks/useStore";
import { formatDate } from "@/lib/utils";
import { buildTransactionsLedger, type TxnChannel } from "@/lib/transactions-ledger";

export default function RazorReportView({
  store,
}: {
  store: ReturnType<typeof useStore>;
}) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<TxnChannel | "all">("all");
  const itemsPerPage = 10;

  const ledger = useMemo(
    () =>
      buildTransactionsLedger({
        payments: store.payments,
        otherFees: store.otherFees,
        subscriptionHistory: store.subscriptionHistory,
        merchOrders: store.merchOrders,
        matches: store.matches,
        players: store.players,
      }),
    [
      store.payments,
      store.otherFees,
      store.subscriptionHistory,
      store.merchOrders,
      store.matches,
      store.players,
    ],
  );
  const {
    transactions,
    gatewayTotal,
    cashTotal,
    studioTotal,
    subscriptionCoveredTotal,
    clubSponsoredTotal,
    playerSponsoredTotal,
    offsetTotal,
  } = ledger;

  const filtered = filter === "all" ? transactions : transactions.filter((t) => t.channel === filter);
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const currentTransactions = filtered.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage,
  );

  const formatSecTime = (seconds: number) => {
    if (!seconds) return "Unknown";
    return formatDate(new Date(seconds * 1000).toISOString(), "TBD");
  };

  const channelBadge = (ch: TxnChannel) => {
    switch (ch) {
      case "razorpay":
        return <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/15 border border-emerald-500/25 px-1.5 py-0.5 rounded">Via Razorpay</span>;
      case "cash":
        return <span className="text-[9px] font-bold uppercase tracking-widest text-teal-400 bg-teal-500/15 border border-teal-500/25 px-1.5 py-0.5 rounded">Cash Collected</span>;
      case "subscription_covered":
        return <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 bg-indigo-500/15 border border-indigo-500/25 px-1.5 py-0.5 rounded">Subscription Covered</span>;
      case "club_sponsored":
        return <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400 bg-amber-500/15 border border-amber-500/25 px-1.5 py-0.5 rounded">Club Sponsored</span>;
      case "player_sponsored":
        return <span className="text-[9px] font-bold uppercase tracking-widest text-purple-400 bg-purple-500/15 border border-purple-500/25 px-1.5 py-0.5 rounded">Player Sponsored</span>;
      case "offset":
        return <span className="text-[9px] font-bold uppercase tracking-widest text-rose-400 bg-rose-500/15 border border-rose-500/25 px-1.5 py-0.5 rounded">Offset</span>;
      case "studio":
        return <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400 bg-blue-500/15 border border-blue-500/25 px-1.5 py-0.5 rounded">Studio</span>;
    }
  };

  const amountColor = (ch: TxnChannel) => {
    switch (ch) {
      case "razorpay": return "text-emerald-400";
      case "cash": return "text-teal-400";
      case "subscription_covered": return "text-indigo-400";
      case "club_sponsored": return "text-amber-400";
      case "player_sponsored": return "text-purple-400";
      case "offset": return "text-rose-400";
      case "studio": return "text-blue-400";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold tracking-tight text-text-primary">
          Transactions
        </h2>
        <div className="flex gap-2 flex-wrap">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-surface-hover px-3 py-1.5 rounded-xl border border-border">
            Gateway: <span className="font-mono ml-1">₹{gatewayTotal}</span>
          </div>
          {cashTotal > 0 && (
            <div className="text-[10px] font-bold uppercase tracking-widest text-teal-400 bg-surface-hover px-3 py-1.5 rounded-xl border border-border">
              Cash: <span className="font-mono ml-1">₹{cashTotal}</span>
            </div>
          )}
          {subscriptionCoveredTotal > 0 && (
            <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 bg-surface-hover px-3 py-1.5 rounded-xl border border-border">
              Subscription Covered (Non-Cash): <span className="font-mono ml-1">₹{subscriptionCoveredTotal}</span>
            </div>
          )}
          {clubSponsoredTotal > 0 && (
            <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400 bg-surface-hover px-3 py-1.5 rounded-xl border border-border">
              Club Sponsored: <span className="font-mono ml-1">₹{clubSponsoredTotal}</span>
            </div>
          )}
          {playerSponsoredTotal > 0 && (
            <div className="text-[10px] font-bold uppercase tracking-widest text-purple-400 bg-surface-hover px-3 py-1.5 rounded-xl border border-border">
              Player Sponsored (Non-Cash): <span className="font-mono ml-1">₹{playerSponsoredTotal}</span>
            </div>
          )}
          {offsetTotal > 0 && (
            <div className="text-[10px] font-bold uppercase tracking-widest text-rose-400 bg-surface-hover px-3 py-1.5 rounded-xl border border-border">
              Offset: <span className="font-mono ml-1">₹{offsetTotal}</span>
            </div>
          )}
          {studioTotal > 0 && (
            <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400 bg-surface-hover px-3 py-1.5 rounded-xl border border-border">
              Studio: <span className="font-mono ml-1">₹{studioTotal}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(["all", "razorpay", "cash", "subscription_covered", "club_sponsored", "player_sponsored", "studio"] as const).map((f) => {
          const active = filter === f;
          const labels: Record<string, string> = {
            all: "All",
            razorpay: "Via Razorpay",
            cash: "Cash Collected",
            subscription_covered: "Subscription Covered",
            club_sponsored: "Club Sponsored",
            player_sponsored: "Player Sponsored",
            studio: "Studio",
          };
          const counts: Record<string, number> = {
            all: transactions.length,
            razorpay: transactions.filter((t) => t.channel === "razorpay").length,
            cash: transactions.filter((t) => t.channel === "cash").length,
            subscription_covered: transactions.filter((t) => t.channel === "subscription_covered").length,
            club_sponsored: transactions.filter((t) => t.channel === "club_sponsored").length,
            player_sponsored: transactions.filter((t) => t.channel === "player_sponsored").length,
            studio: transactions.filter((t) => t.channel === "studio").length,
          };
          if (f !== "all" && f !== "razorpay" && counts[f] === 0) return null;
          return (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition ${
                active
                  ? "bg-surface-hover text-text-primary border border-border"
                  : "bg-surface-hover text-text-muted border border-transparent hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              {labels[f]} ({counts[f]})
            </button>
          );
        })}
      </div>

      <div className="bg-surface rounded-xl overflow-hidden border border-border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-text-muted italic text-sm">
            No transactions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-surface-hover border-b border-border text-[10px] uppercase tracking-widest text-text-secondary">
                <tr>
                  <th className="px-4 py-3 font-bold">Date</th>
                  <th className="px-4 py-3 font-bold">Player</th>
                  <th className="px-4 py-3 font-bold">Description</th>
                  <th className="px-4 py-3 font-bold">Type</th>
                  <th className="px-4 py-3 font-bold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {currentTransactions.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-hover transition">
                    <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                      {formatSecTime(t.date)}
                    </td>
                    <td
                      className="px-4 py-3 font-bold text-text-primary max-w-[120px] truncate"
                      title={t.name}
                    >
                      {t.name}
                    </td>
                    <td
                      className="px-4 py-3 text-text-primary max-w-[200px] truncate"
                      title={t.product}
                    >
                      {t.product}
                    </td>
                    <td className="px-4 py-3">
                      {channelBadge(t.channel)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${amountColor(t.channel)}`}>
                      ₹{t.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-surface p-2 rounded-xl border border-border">
          <button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
            className="px-4 py-2 bg-surface-hover hover:bg-surface-hover disabled:opacity-50 disabled:hover:bg-surface-hover rounded-lg text-xs font-bold transition text-text-primary"
          >
            Previous
          </button>
          <div className="text-xs text-text-secondary">
            Page <span className="font-bold text-text-primary">{page}</span> of{" "}
            {totalPages}
          </div>
          <button
            disabled={page === totalPages}
            onClick={() => setPage(page + 1)}
            className="px-4 py-2 bg-surface-hover hover:bg-surface-hover disabled:opacity-50 disabled:hover:bg-surface-hover rounded-lg text-xs font-bold transition text-text-primary"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
