import { classifyMatchPayment } from "./match-finance.ts";
import type {
  Match,
  MatchPayment,
  MerchOrder,
  OtherFee,
  Player,
  SubscriptionHistory,
} from "./types.ts";

export type TxnChannel =
  | "razorpay"
  | "cash"
  | "subscription_covered"
  | "club_sponsored"
  | "player_sponsored"
  | "offset"
  | "studio";

export interface LedgerTransaction {
  id: string;
  date: number;
  name: string;
  product: string;
  amount: number;
  channel: TxnChannel;
  isCash: boolean;
}

export interface LedgerSummary {
  transactions: LedgerTransaction[];
  gatewayTotal: number;
  cashTotal: number;
  studioTotal: number;
  actualCashTotal: number;
  subscriptionCoveredTotal: number;
  clubSponsoredTotal: number;
  playerSponsoredTotal: number;
  offsetTotal: number;
}

export function buildTransactionsLedger({
  payments = [],
  otherFees = [],
  subscriptionHistory = [],
  merchOrders = [],
  matches = [],
  players = [],
}: {
  payments?: MatchPayment[];
  otherFees?: OtherFee[];
  subscriptionHistory?: SubscriptionHistory[];
  merchOrders?: MerchOrder[];
  matches?: Match[];
  players?: Player[];
}): LedgerSummary {
  const list: LedgerTransaction[] = [];
  const seenIds = new Set<string>();
  const matchMap = new Map(matches.map((m) => [m.id, m]));
  const playerMap = new Map(players.map((pl) => [pl.id, pl]));

  const pushUnique = (txn: LedgerTransaction) => {
    if (seenIds.has(txn.id)) return;
    seenIds.add(txn.id);
    list.push(txn);
  };

  for (const p of payments) {
    const match = matchMap.get(p.matchId);
    const player = playerMap.get(p.playerId);
    if (!match || !player) continue;

    const pmtDate = p.updatedAt?.seconds || 0;
    const cls = classifyMatchPayment(p, match.fee || 0);
    if (cls.category === "excluded") continue;

    // 1. Club Sponsored (non-cash)
    if (cls.clubSponsored > 0) {
      pushUnique({
        id: `match_sponsor_${p.id}`,
        date: pmtDate,
        name: player.name,
        product: `Club Sponsored (${p.planTag || "Match Fee Plan"}) — vs ${match.opponent}`,
        amount: cls.clubSponsored,
        channel: "club_sponsored",
        isCash: false,
      });
    }

    // 2. Player Sponsored (non-cash on beneficiary; payer carries cash receipt)
    if (cls.category === "player_sponsored" && cls.playerSponsored > 0) {
      const sponsor = p.sponsoredBy ? playerMap.get(p.sponsoredBy) : undefined;
      pushUnique({
        id: `match_player_sponsor_${p.id}`,
        date: pmtDate,
        name: player.name,
        product: `Player Sponsored by ${sponsor?.name || "Member"} — vs ${match.opponent}`,
        amount: cls.playerSponsored,
        channel: "player_sponsored",
        isCash: false,
      });
      continue;
    }

    // 3. Subscription Covered (non-cash match settlement)
    if (cls.category === "subscription_covered" && cls.subscriptionCovered > 0) {
      pushUnique({
        id: `match_sub_${p.id}`,
        date: pmtDate,
        name: player.name,
        product: `Subscription Covered (${p.planTag || "Club Plan"}) — vs ${match.opponent}`,
        amount: cls.subscriptionCovered,
        channel: "subscription_covered",
        isCash: false,
      });
      continue;
    }

    // 4. Actual Cash Received (Razorpay or verified manual cash/bank/UPI)
    if (cls.cashReceived > 0) {
      const isRazorpay = cls.category === "razorpay";
      const methodLabel =
        p.manualMethod === "cash_collected"
          ? "Cash Collected"
          : p.manualMethod
            ? p.manualMethod.replace(/_/g, " ")
            : "Cash Collected";
      const productDesc = isRazorpay
        ? `Match Fee: vs ${match.opponent}`
        : `Match Fee (${methodLabel}${p.manualBy ? ` by ${p.manualBy}` : ""}): vs ${match.opponent}`;

      pushUnique({
        id: `match_pay_${p.id}`,
        date: pmtDate,
        name: player.name,
        product: productDesc,
        amount: cls.cashReceived,
        channel: isRazorpay ? "razorpay" : "cash",
        isCash: true,
      });
    }
  }

  // Only Paid otherFees belong in financial transaction totals; Cancelled fees are excluded.
  for (const f of otherFees) {
    if (f.status !== "Paid") continue;
    const player = playerMap.get(f.playerId);
    if (!player) continue;
    const isRazorpay = Boolean((f as OtherFee & { razorpayPaymentId?: string }).razorpayPaymentId);
    pushUnique({
      id: `other_fee_${f.id}`,
      date: f.updatedAt?.seconds || 0,
      name: player.name,
      product: `${f.title}${f.comment ? ` — ${f.comment}` : ""}`,
      amount: Math.max(0, Math.round(Number(f.amount) || 0)),
      channel: isRazorpay ? "razorpay" : "cash",
      isCash: true,
    });
  }

  for (const h of subscriptionHistory) {
    const player = playerMap.get(h.playerId);
    if (player && h.paidAmount > 0) {
      pushUnique({
        id: `sub_${h.id}`,
        date: h.createdAt?.seconds || 0,
        name: player.name,
        product: `Studio Plan: ${h.planName} — enrolled by ${h.adminName}`,
        amount: Math.max(0, Math.round(Number(h.paidAmount) || 0)),
        channel: "studio",
        isCash: true,
      });
    }
  }

  for (const o of merchOrders) {
    if (o.paymentStatus !== "Paid") continue;
    pushUnique({
      id: `merch_${o.id}`,
      date: o.updatedAt?.seconds || o.createdAt?.seconds || 0,
      name: o.playerName,
      product: `Shop: ${o.merchName}`,
      amount: Math.max(0, Math.round(Number(o.price) || 0)),
      channel: o.isManual ? "cash" : "razorpay",
      isCash: true,
    });
  }

  list.sort((a, b) => b.date - a.date);

  const sumBy = (ch: TxnChannel) =>
    list.filter((t) => t.channel === ch).reduce((s, t) => s + t.amount, 0);

  const gatewayTotal = sumBy("razorpay");
  const cashTotal = sumBy("cash");
  const studioTotal = sumBy("studio");

  return {
    transactions: list,
    gatewayTotal,
    cashTotal,
    studioTotal,
    actualCashTotal: gatewayTotal + cashTotal + studioTotal,
    subscriptionCoveredTotal: sumBy("subscription_covered"),
    clubSponsoredTotal: sumBy("club_sponsored"),
    playerSponsoredTotal: sumBy("player_sponsored"),
    offsetTotal: sumBy("offset"),
  };
}
