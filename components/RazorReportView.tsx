import { useState, useMemo } from "react";
import { useStore } from "@/hooks/useStore";
import { formatDate } from "@/lib/utils";

export default function RazorReportView({
  store,
}: {
  store: ReturnType<typeof useStore>;
}) {
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  const transactions = useMemo(() => {
    type Transaction = {
      id: string;
      date: any;
      name: string;
      product: string;
      amount: number;
    };

    const list: Transaction[] = [];

    // Match Payments (Paid)
    store.payments
      .filter((p) => p.status === "Paid")
      .forEach((p) => {
        const match = store.matches.find((m) => m.id === p.matchId);
        const player = store.players.find((pl) => pl.id === p.playerId);
        if (match && player) {
          list.push({
            id: `match_pay_${p.id}`,
            date: p.updatedAt?.seconds || 0,
            name: player.name,
            product: `Match Fee: ${match.opponent}`,
            amount: match.fee,
          });
        }
      });

    // Other Fees (Paid)
    store.otherFees
      .filter((f) => f.status === "Paid")
      .forEach((f) => {
        const player = store.players.find((pl) => pl.id === f.playerId);
        if (player) {
          list.push({
            id: `other_fee_${f.id}`,
            date: f.updatedAt?.seconds || 0,
            name: player.name,
            product: `Other Fee: ${f.title}`,
            amount: f.amount,
          });
        }
      });

    // Studio Memberships (Subscription History)
    store.subscriptionHistory?.forEach((h) => {
      const player = store.players.find((pl) => pl.id === h.playerId);
      if (player && h.paidAmount > 0) {
        list.push({
          id: `sub_${h.id}`,
          date: h.createdAt?.seconds || 0,
          name: player.name,
          product: `Studio Plan: ${h.planName}`,
          amount: h.paidAmount,
        });
      }
    });

    // Shop Merchandise Orders (Paid)
    store.merchOrders?.filter((o) => o.paymentStatus === "Paid").forEach((o) => {
      list.push({
        id: `merch_${o.id}`,
        date: o.updatedAt?.seconds || o.createdAt?.seconds || 0,
        name: o.playerName,
        product: `Shop: ${o.merchName}`,
        amount: o.price,
      });
    });

    // Sort newest first
    return list.sort((a, b) => b.date - a.date);
  }, [
    store.payments,
    store.otherFees,
    store.subscriptionHistory,
    store.merchOrders,
    store.matches,
    store.players,
  ]);

  const totalPages = Math.ceil(transactions.length / itemsPerPage);
  const currentTransactions = transactions.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage,
  );

  const formatSecTime = (seconds: number) => {
    if (!seconds) return "Unknown";
    return formatDate(new Date(seconds * 1000).toISOString(), "TBD");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white">
          Razor Transactions Report
        </h2>
        <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-white/5 px-3 py-1.5 rounded-xl border border-glass-border">
          Total Revenue:{" "}
          <span className="font-mono ml-1">
            ₹{transactions.reduce((acc, t) => acc + t.amount, 0)}
          </span>
        </div>
      </div>

      <div className="glass rounded-xl overflow-hidden border border-glass-border">
        {transactions.length === 0 ? (
          <div className="p-8 text-center text-white/50 italic text-sm">
            No transactions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-black/40 border-b border-glass-border text-[10px] uppercase tracking-widest text-white/60">
                <tr>
                  <th className="px-4 py-3 font-bold">Date / Time</th>
                  <th className="px-4 py-3 font-bold">Player Name</th>
                  <th className="px-4 py-3 font-bold">Product / Context</th>
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
                    <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400">
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
