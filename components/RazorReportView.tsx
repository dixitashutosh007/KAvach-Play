import { useState, useMemo } from "react";
import { useStore } from "@/hooks/useStore";
import { formatDate } from "@/lib/utils";

type TxnChannel = "razorpay" | "offset" | "studio";

export default function RazorReportView({
  store,
}: {
  store: ReturnType<typeof useStore>;
}) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<TxnChannel | "all">("all");
  const itemsPerPage = 10;

  const transactions = useMemo(() => {
    type Transaction = {
      id: string;
      date: any;
      name: string;
      product: string;
      amount: number;
      channel: TxnChannel;
    };

    const list: Transaction[] = [];

    store.payments
      .filter((p) => p.status === "Paid")
      .forEach((p) => {
        const match = store.matches.find((m) => m.id === p.matchId);
        const player = store.players.find((pl) => pl.id === p.playerId);
        if (match && player) {
          const effectiveFee = p.feeOverride !== undefined ? p.feeOverride : match.fee;
          const isGateway = p.paymentMethod === "razorpay" && !p.sponsoredBy;
          let product: string;
          if (isGateway) {
            product = `Match Fee: vs ${match.opponent}`;
          } else if (p.sponsoredBy) {
            const sponsor = store.players.find((pl) => pl.id === p.sponsoredBy);
            product = `Sponsored by ${sponsor?.name || "Unknown"} — vs ${match.opponent}`;
          } else {
            product = `Player Offset${p.manualBy ? ` by ${p.manualBy}` : ""} — vs ${match.opponent}`;
          }
          list.push({
            id: `match_pay_${p.id}`,
            date: p.updatedAt?.seconds || 0,
            name: player.name,
            product,
            amount: effectiveFee,
            channel: isGateway ? "razorpay" : "offset",
          });
        }
      });

    store.otherFees
      .filter((f) => f.status === "Paid" || f.status === "Cancelled")
      .forEach((f) => {
        const player = store.players.find((pl) => pl.id === f.playerId);
        if (player) {
          let product: string;
          if (f.status === "Cancelled") {
            product = `${f.title} Deleted${f.cancelledBy ? ` by ${f.cancelledBy}` : ""}`;
          } else {
            product = `${f.title}${f.comment ? ` — ${f.comment}` : ""}`;
          }
          list.push({
            id: `other_fee_${f.id}`,
            date: (f.status === "Cancelled" ? f.cancelledAt?.seconds : f.updatedAt?.seconds) || 0,
            name: player.name,
            product,
            amount: f.amount,
            channel: "offset",
          });
        }
      });

    store.subscriptionHistory?.forEach((h) => {
      const player = store.players.find((pl) => pl.id === h.playerId);
      if (player && h.paidAmount > 0) {
        list.push({
          id: `sub_${h.id}`,
          date: h.createdAt?.seconds || 0,
          name: player.name,
          product: `Studio Plan: ${h.planName} — enrolled by ${h.adminName}`,
          amount: h.paidAmount,
          channel: "studio",
        });
      }
    });

    store.merchOrders?.filter((o) => o.paymentStatus === "Paid").forEach((o) => {
      list.push({
        id: `merch_${o.id}`,
        date: o.updatedAt?.seconds || o.createdAt?.seconds || 0,
        name: o.playerName,
        product: `Shop: ${o.merchName}`,
        amount: o.price,
        channel: o.isManual ? "offset" : "razorpay",
      });
    });

    return list.sort((a, b) => b.date - a.date);
  }, [
    store.payments,
    store.otherFees,
    store.subscriptionHistory,
    store.merchOrders,
    store.matches,
    store.players,
  ]);

  const filtered = filter === "all" ? transactions : transactions.filter((t) => t.channel === filter);
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const currentTransactions = filtered.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage,
  );

  const gatewayTotal = transactions.filter((t) => t.channel === "razorpay").reduce((s, t) => s + t.amount, 0);
  const offsetTotal = transactions.filter((t) => t.channel === "offset").reduce((s, t) => s + t.amount, 0);
  const studioTotal = transactions.filter((t) => t.channel === "studio").reduce((s, t) => s + t.amount, 0);

  const formatSecTime = (seconds: number) => {
    if (!seconds) return "Unknown";
    return formatDate(new Date(seconds * 1000).toISOString(), "TBD");
  };

  const channelBadge = (ch: TxnChannel) => {
    switch (ch) {
      case "razorpay":
        return <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/15 border border-emerald-500/25 px-1.5 py-0.5 rounded">Via Razorpay</span>;
      case "offset":
        return <span className="text-[9px] font-bold uppercase tracking-widest text-red-400 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded">Offset</span>;
      case "studio":
        return <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400 bg-blue-500/15 border border-blue-500/25 px-1.5 py-0.5 rounded">Studio</span>;
    }
  };

  const amountColor = (ch: TxnChannel) => {
    switch (ch) {
      case "razorpay": return "text-emerald-400";
      case "offset": return "text-red-400";
      case "studio": return "text-blue-400";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold tracking-tight text-white">
          Transactions
        </h2>
        <div className="flex gap-2 flex-wrap">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-white/5 px-3 py-1.5 rounded-xl border border-glass-border">
            Gateway: <span className="font-mono ml-1">₹{gatewayTotal}</span>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 bg-white/5 px-3 py-1.5 rounded-xl border border-glass-border">
            Offset: <span className="font-mono ml-1">₹{offsetTotal}</span>
          </div>
          {studioTotal > 0 && (
            <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400 bg-white/5 px-3 py-1.5 rounded-xl border border-glass-border">
              Studio: <span className="font-mono ml-1">₹{studioTotal}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-1.5">
        {(["all", "razorpay", "offset", "studio"] as const).map((f) => {
          const active = filter === f;
          const labels: Record<string, string> = { all: "All", razorpay: "Via Razorpay", offset: "Offset", studio: "Studio" };
          const counts: Record<string, number> = {
            all: transactions.length,
            razorpay: transactions.filter((t) => t.channel === "razorpay").length,
            offset: transactions.filter((t) => t.channel === "offset").length,
            studio: transactions.filter((t) => t.channel === "studio").length,
          };
          if (f === "studio" && counts.studio === 0) return null;
          return (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition ${
                active
                  ? "bg-white/15 text-white border border-white/20"
                  : "bg-white/5 text-white/50 border border-transparent hover:text-white hover:bg-white/10"
              }`}
            >
              {labels[f]} ({counts[f]})
            </button>
          );
        })}
      </div>

      <div className="glass rounded-xl overflow-hidden border border-glass-border">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-white/50 italic text-sm">
            No transactions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-black/40 border-b border-glass-border text-[10px] uppercase tracking-widest text-white/60">
                <tr>
                  <th className="px-4 py-3 font-bold">Date</th>
                  <th className="px-4 py-3 font-bold">Player</th>
                  <th className="px-4 py-3 font-bold">Description</th>
                  <th className="px-4 py-3 font-bold">Type</th>
                  <th className="px-4 py-3 font-bold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/50">
                {currentTransactions.map((t) => (
                  <tr key={t.id} className="hover:bg-white/5 transition">
                    <td className="px-4 py-3 text-white/70 font-mono text-xs">
                      {formatSecTime(t.date)}
                    </td>
                    <td
                      className="px-4 py-3 font-bold text-white max-w-[120px] truncate"
                      title={t.name}
                    >
                      {t.name}
                    </td>
                    <td
                      className="px-4 py-3 text-white/80 max-w-[200px] truncate"
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
        <div className="flex items-center justify-between glass p-2 rounded-xl border border-glass-border">
          <button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-white/5 rounded-lg text-xs font-bold transition text-white"
          >
            Previous
          </button>
          <div className="text-xs text-white/60">
            Page <span className="font-bold text-white">{page}</span> of{" "}
            {totalPages}
          </div>
          <button
            disabled={page === totalPages}
            onClick={() => setPage(page + 1)}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-white/5 rounded-lg text-xs font-bold transition text-white"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
